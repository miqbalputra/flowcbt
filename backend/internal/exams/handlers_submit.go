// handlers_submit.go — submit attempt idempoten + penilaian otomatis (M8,
// AC-4; FR-8.1/8.2 via internal/grading), pelaporan pelanggaran anti-cheat
// (AC-8, FR-5.8), dan snapshot proktor (multipart, disk lokal).
package exams

import (
	"context"
	"net/http"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// submitResult hasil submit (ditegaskan kembali saat submit ulang/idempoten).
type submitResult struct {
	AttemptID         string    `json:"attempt_id"`
	Status            string    `json:"status"`
	Score             *float64  `json:"score"`
	FinalScore        *float64  `json:"final_score"`
	FinalScorePending bool      `json:"final_score_pending"`
	ShowScore         bool      `json:"show_score"`
	Code              string    `json:"code,omitempty"` // SCORE_HIDDEN bila belum rilis
	SubmittedAt       time.Time `json:"submitted_at"`
}

// ---------------------------------------------------------------------------
// POST /student/attempts/{attemptID}/submit {client_event_id, client_elapsed_ms}
// ---------------------------------------------------------------------------

func (m *Module) submitAttempt(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req submitReq
	if !m.decode(w, r, &req) {
		return
	}
	ctx := r.Context()
	now := nowTS()

	var res submitResult
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

		// (i) Idempoten: event submit dengan client_event_id sama → kembalikan
		// hasil tersimpan tanpa efek kedua (AC-3/AC-4).
		var dupe bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM attempt_events WHERE client_event_id=$1 AND attempt_id=$2)`,
			req.ClientEventID, attemptID).Scan(&dupe); err != nil {
			return err
		}
		if dupe {
			res, err = storedSubmitResult(ctx, tx, a, e, now)
			return err
		}

		// (ii) Validasi status & waktu.
		if a.Status != "in_progress" && a.Status != "pending_sync" {
			if a.Status == "submitted" || a.Status == "graded" {
				res, err = storedSubmitResult(ctx, tx, a, e, now) // sudah menyerahkan → sama
				return err
			}
			return httpx.NewErr(http.StatusConflict, "ATTEMPT_NOT_ACTIVE",
				"Attempt tidak dapat disubmit (status: "+a.Status+")")
		}
		if a.StartedAt != nil && now.Before(*a.StartedAt) {
			return httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Waktu submit tidak valid")
		}

		// Garansi jawaban (AC-4): submit lewat deadline ditandai late tetapi
		// tetap diterima pada mode grace. hard_close ditolak setelah toleransi.
		late := false
		if dl := toleranceDeadline(a, e, ac); dl != nil && now.After(*dl) {
			if e.TimeStyle == "hard_close" {
				return httpx.NewErr(http.StatusGone, "ATTEMPT_EXPIRED",
					"Waktu pengerjaan telah berakhir (taat batas ketat)")
			}
			late = true
		}

		payload := map[string]any{"client_elapsed_ms": req.ClientElapsedMS, "late": late}
		if late {
			payload["auto_submit"] = true // per klien diperlakukan auto-submit
		}
		if _, err := insertSubmitEvent(ctx, tx, tenantID, a.ID, req.ClientEventID, "submit", payload); err != nil {
			return err
		}
		res, err = finalizeAttempt(ctx, tx, tenantID, a, e, now)
		if err != nil {
			return err
		}
		if late {
			res.Code = "SUBMITTED_LATE"
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": res})
}

// storedSubmitResult bangun respons dari keadaan attempt tersimpan (idempoten).
func storedSubmitResult(ctx context.Context, tx pgx.Tx, a *attemptRecord, e *examRecord, now time.Time) (submitResult, error) {
	res := submitResult{AttemptID: a.ID, Status: a.Status, ShowScore: e.ScoreReleased}
	if a.SubmittedAt != nil {
		res.SubmittedAt = *a.SubmittedAt
	} else {
		res.SubmittedAt = now
	}
	if a.Status == "submitted" || a.Status == "graded" {
		score := a.Score
		final := a.FinalScore
		res.Score = &score
		res.FinalScore = &final
		// Uraian menunggu guru → final_score_pending (FR-8.2).
		res.FinalScorePending = hasUngradedEssay(ctx, tx, a.ID)
	}
	if !e.ScoreReleased {
		res.Code = "SCORE_HIDDEN"
	}
	return res, nil
}

// insertSubmitEvent catat event submit/auto_submit idempoten (AC-3).
func insertSubmitEvent(ctx context.Context, tx pgx.Tx, tenantID, attemptID,
	clientEventID, typ string, payload map[string]any) (bool, error) {
	tag, err := tx.Exec(ctx, `
		INSERT INTO attempt_events(tenant_id, attempt_id, client_event_id, type, payload, seq)
		VALUES ($1,$2,$3,$4,$5,
			COALESCE((SELECT MAX(seq)+1 FROM attempt_events WHERE attempt_id=$2),1))
		ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
		tenantID, attemptID, clientEventID, typ, jsonRaw(payload))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// finalizeAttempt marchsha attempt → submitted, jalankan penilaian otomatis,
// tetapkan status akhir & skor final (dipakai submit, force-submit, auto-submit).
func finalizeAttempt(ctx context.Context, tx pgx.Tx, tenantID string,
	a *attemptRecord, e *examRecord, now time.Time) (submitResult, error) {
	// (1) Kunci status submitted (submitted_at server time).
	tag, err := tx.Exec(ctx, `
		UPDATE attempts SET status='submitted', submitted_at=$2 WHERE id=$1
		AND status IN ('in_progress','pending_sync')`, a.ID, now)
	if err != nil {
		return submitResult{}, err
	}
	if tag.RowsAffected() == 0 {
		// Attempt sudah difinalisasi jalur lain (double submit / race
		// dengan force-submit atau auto-submit). JANGAN regrade — skor &
		// penalti dijamin tidak dihitung dobel (idempoten): muat ulang
		// keadaan ter-stored dan bangun respons darinya.
		fresh, rerr := loadAttempt(ctx, tx, a.ID)
		if rerr != nil {
			return submitResult{}, rerr
		}
		*a = *fresh // sinkronkan record in-memory pemanggil
		return storedSubmitResult(ctx, tx, fresh, e, now)
	}
	a.Status = "submitted"
	a.SubmittedAt = &now

	// (2) Penilaian otomatis (WAJIB via internal/grading).
	pendingManual, err := gradeAttempt(ctx, tx, a, e, tenantID, false)
	if err != nil {
		return submitResult{}, err
	}
	a.PendingManual = pendingManual

	res := submitResult{
		AttemptID:         a.ID,
		Status:            a.Status, // submitted (ada uraian) / graded
		FinalScorePending: pendingManual,
		ShowScore:         e.ScoreReleased,
		SubmittedAt:       now,
	}
	if e.ScoreReleased {
		score := a.Score
		final := a.FinalScore
		res.Score = &score
		res.FinalScore = &final
	} else {
		res.Code = "SCORE_HIDDEN"
	}
	return res, nil
}
