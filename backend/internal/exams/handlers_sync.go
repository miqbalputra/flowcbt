// handlers_sync.go — POST /student/attempts/{attemptID}/answers:sync (PRD M7,
// AC-2/AC-3/AC-5): antrean jawaban offline sinkron idempoten via
// client_event_id; last-write-wins per soal berdasar seq; event setelah
// deadline+toleransi ditolak (AC-5) tapi tetap tercatat.
package exams

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

func (m *Module) syncAnswers(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req syncReq
	if !m.decode(w, r, &req) {
		return
	}
	ctx := r.Context()
	now := nowTS()

	resp := syncResp{
		Acked:      []string{},
		Rejected:   []syncReject{},
		ServerTime: now,
	}

	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		a, err := loadAttemptOwned(ctx, tx, r, attemptID)
		if err != nil {
			return err
		}
		e, err := loadExam(ctx, tx, a.ExamID)
		if err != nil {
			return err
		}
		ac := e.antiCheat()

		// Gerbang status attempt (AC-2):
		//   in_progress        → terima bebas
		//   pending_sync/submitted/graded/expired → hanya sampai deadline+toleransi
		deadline := toleranceDeadline(a, e, ac)
		switch a.Status {
		case "in_progress":
			// ok
		case "pending_sync", "submitted", "graded", "expired":
			if deadline != nil && now.After(*deadline) && a.Status == "expired" {
				// Attempt kedaluwarsa: tolak seluruh antrean.
				for _, ev := range req.Events {
					resp.Rejected = append(resp.Rejected, syncReject{
						ClientEventID: ev.ClientEventID, Reason: "attempt_expired"})
				}
				resp.Status = a.Status
				return nil
			}
			// lanjut: masih dalam batas toleransi.
		default:
			return httpx.NewErr(http.StatusConflict, "ATTEMPT_NOT_ACTIVE",
				"Attempt tidak dalam status pengerjaan (status: "+a.Status+")")
		}

		for _, ev := range req.Events {
			// Validasi deadline khusus event answer (AC-5): pakai client_ts.
			if ev.Type == "answer" && deadline != nil && ev.ClientTS > 0 {
				evTime := time.UnixMilli(ev.ClientTS)
				if evTime.After(*deadline) {
					reason := "late_after_deadline"
					// Catat event sebagai bukti antrean (payload.rejected=true),
					// jangan simpan jawabannya.
					payload := map[string]any{"rejected": true, "reason": reason}
					if _, err := insertSyncEvent(ctx, tx, tenantID, a.ID, ev, payload); err != nil {
						return err
					}
					resp.Rejected = append(resp.Rejected, syncReject{
						ClientEventID: ev.ClientEventID, Reason: reason})
					continue
				}
			}

			// Insert event idempoten: duplikat client_event_id → ACK tanpa efek.
			inserted, err2 := insertSyncEvent(ctx, tx, tenantID, a.ID, ev, nil)
			if err2 != nil {
				return err2
			}
			if !inserted {
				resp.Acked = append(resp.Acked, ev.ClientEventID)
				continue
			}
			resp.Acked = append(resp.Acked, ev.ClientEventID)

			// Efek samping event.
			switch ev.Type {
			case "answer":
				if err := applyAnswerEvent(ctx, tx, tenantID, a.ID, ev); err != nil {
					return err
				}
			case "flag":
				// Tandai ragu (payload.flag). Bila payload.answer ada, jawaban
				// ikut ter-upsert; flag saja → hanya ubah flag_ragu.
				if err := applyFlagEvent(ctx, tx, tenantID, a.ID, ev); err != nil {
					return err
				}
			case "nav":
				// Navigasi halaman: hanya jejak event (append-only).
			case "violation":
				// Pelanggaran anti-cheat tersinkron dari antrean offline
				// (FR-5.8: "pelanggaran dicatat meski offline; penalti dihitung
				// di server dari event yang tersinkron"). Reuse inti pelanggaran.
				vr, err := m.violationFromEvent(ctx, tx, r, a, e, ev)
				if err != nil {
					return err
				}
				// Status hanya dinaikkan; tidak menimpa 'submitted' yang
				// sudah final bila batch memuat submit + violation.
				if vr != nil && vr.Violations >= ac.FlagThreshold && resp.Status != "submitted" {
					resp.Status = "flagged"
				}
			case "submit":
				// Submit dari antrean offline (AC-4): finalisasi attempt.
				sub, err := submitFromQueue(ctx, tx, tenantID, a, e, ev, now)
				if err != nil {
					return err
				}
				if sub {
					resp.Status = "submitted"
				}
			}
		}
		// Hanya isi status dari keadaan attempt bila belum di-set oleh efek
		// event di atas (flagged/submitted). BUG lama: penimpaan tanpa syarat
		// `resp.Status = a.Status` menghapus status flagged/expired dari
		// response — klien kehilangan sinyal penguncian (AC-5/AC-8).
		if resp.Status == "" {
			resp.Status = a.Status
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": resp})
}

// toleranceDeadline batas penerimaan jawaban: deadline + toleransi
// (10% durasi ujian, min 30 detik — PRD §10.4/AC-2).
func toleranceDeadline(a *attemptRecord, e *examRecord, ac AntiCheat) *time.Time {
	if a.DeadlineAt == nil {
		return nil
	}
	grace := time.Duration(ac.ToleranceSeconds) * time.Second
	replay := time.Duration(e.DurationMinutes) * time.Minute / 10
	if replay < 30*time.Second {
		replay = 30 * time.Second
	}
	d := a.DeadlineAt.Add(grace).Add(replay)
	return &d
}

// insertSyncEvent INSERT attempt_events idempoten; return false bila duplikat
// (client_event_id sudah ada untuk attempt ini → ACK tanpa efek, AC-3;
// sejak migrasi 0005 uniknya berscope per attempt, bukan global).
func insertSyncEvent(ctx context.Context, tx pgx.Tx, tenantID, attemptID string,
	ev syncEventReq, extraPayload map[string]any) (bool, error) {
	payload := map[string]any{}
	if len(ev.Payload.Answer) > 0 {
		payload["answer"] = ev.Payload.Answer
	}
	if ev.Payload.Flag != nil {
		payload["flag"] = *ev.Payload.Flag
	}
	for k, v := range extraPayload {
		payload[k] = v
	}
	var clientTS *time.Time
	if ev.ClientTS > 0 {
		t := time.UnixMilli(ev.ClientTS)
		clientTS = &t
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO attempt_events(tenant_id, attempt_id, client_event_id, type, payload, client_ts, seq)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
		tenantID, attemptID, ev.ClientEventID, ev.Type, jsonRaw(payload), clientTS, ev.Seq)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// applyAnswerEvent simpan jawaban (last-write-wins per soal via seq, AC-3):
// UPSERT attempt_answers ON CONFLICT (attempt_id, question_id) DO UPDATE ...
// WHERE EXCLUDED.seq >= attempt_answers.seq.
// question_id diambil dari field top-level ATAU payload.question_id (klien).
func applyAnswerEvent(ctx context.Context, tx pgx.Tx, tenantID, attemptID string, ev syncEventReq) error {
	var answer any
	if len(ev.Payload.Answer) > 0 {
		answer = ev.Payload.Answer
	} else {
		answer = json.RawMessage(`{}`)
	}
	flag := false
	if ev.Payload.Flag != nil {
		flag = *ev.Payload.Flag
	}
	qid := ev.QuestionID
	if qid == "" {
		qid = ev.Payload.QuestionID
	}
	if qid == "" {
		// Event answer tanpa question_id tidak valid tapi tetap tercatat.
		return nil
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO attempt_answers(tenant_id, attempt_id, question_id, answer, flag_ragu, seq, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,now())
		ON CONFLICT (attempt_id, question_id) DO UPDATE
			SET answer     = CASE WHEN EXCLUDED.seq >= attempt_answers.seq
				THEN EXCLUDED.answer ELSE attempt_answers.answer END,
			flag_ragu      = EXCLUDED.flag_ragu,
			seq            = CASE WHEN EXCLUDED.seq >= attempt_answers.seq
				THEN EXCLUDED.seq ELSE attempt_answers.seq END,
			updated_at     = now()`,
		tenantID, attemptID, qid, answer, flag, ev.Seq)
	return err
}

// applyFlagEvent tandai/batalkan tanda ragu per soal (UPSERT — bila soal belum
// terjawab, baris dibuat dengan jawaban kosong).
func applyFlagEvent(ctx context.Context, tx pgx.Tx, tenantID, attemptID string, ev syncEventReq) error {
	if ev.Payload.Flag == nil {
		return nil
	}
	qid := ev.QuestionID
	if qid == "" {
		qid = ev.Payload.QuestionID
	}
	if qid == "" {
		return nil
	}
	flag := *ev.Payload.Flag
	_, err := tx.Exec(ctx, `
		INSERT INTO attempt_answers(tenant_id, attempt_id, question_id, answer, flag_ragu, seq, updated_at)
		VALUES ($1,$2,$3,'null',$4,$5,now())
		ON CONFLICT (attempt_id, question_id) DO UPDATE
			SET flag_ragu = EXCLUDED.flag_ragu, updated_at = now()`,
		tenantID, attemptID, qid, flag, ev.Seq)
	return err
}

// submitFromQueue finalisasi attempt dari event submit antrean offline (AC-4).
// Return true bila attempt baru ter-finalisasi saat ini.
func submitFromQueue(ctx context.Context, tx pgx.Tx, tenantID string,
	a *attemptRecord, e *examRecord, ev syncEventReq, now time.Time) (bool, error) {
	if a.Status != "in_progress" && a.Status != "pending_sync" {
		return false, nil // sudah final (idempoten)
	}
	if a.StartedAt != nil && now.Before(*a.StartedAt) {
		return false, nil
	}
	payload := map[string]any{"from_queue": true}
	if _, err := insertSubmitEvent(ctx, tx, tenantID, a.ID, ev.ClientEventID, "submit", payload); err != nil {
		return false, err
	}
	if _, err := finalizeAttempt(ctx, tx, tenantID, a, e, now); err != nil {
		return false, err
	}
	a.Status = "submitted"
	return true, nil
}
