// handlers_grading.go — mesin penilaian attempt (WAJIB lewat internal/grading),
// pelaporan pelanggaran anti-cheat (AC-8), dan snapshot proktor.
package exams

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"flowcbt/backend/internal/grading"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// gradeAttempt — nilai semua soal attempt & simpan skor (PRD FR-8.1/8.2).
// Pending manual (uraian) → attemptsstatus tetap 'submitted'; semua otomatis
// → 'graded'. Return: pendingManual.
// ---------------------------------------------------------------------------

func gradeAttempt(ctx context.Context, tx pgx.Tx, a *attemptRecord, e *examRecord, tenantID string, preserveManual bool) (bool, error) {
	qs, err := loadVersionQuestions(ctx, tx, e.QuestionSetVersionID)
	if err != nil {
		return false, err
	}

	// Jawaban tersimpan (qid → raw JSON).
	ansBy := map[string]json.RawMessage{}
	// Skor manual yang dipertahankan (re-grade tidak boleh menghapus
	// koreksi guru — FR-8.3/8.4).
	manualScore := map[string]float64{}
	if preserveManual {
		mrows, err := tx.Query(ctx, `
			SELECT question_id::text, score FROM attempt_answers
			WHERE attempt_id=$1 AND graded_by='manual'`, a.ID)
		if err != nil {
			return false, err
		}
		for mrows.Next() {
			var qid string
			var sc float64
			if err := mrows.Scan(&qid, &sc); err != nil {
				mrows.Close()
				return false, err
			}
			manualScore[qid] = sc
		}
		if err := mrows.Err(); err != nil {
			mrows.Close()
			return false, err
		}
		mrows.Close()
	}
	ansRows, err := tx.Query(ctx, `
		SELECT question_id::text, answer FROM attempt_answers WHERE attempt_id=$1`, a.ID)
	if err != nil {
		return false, err
	}
	for ansRows.Next() {
		var qid string
		var ans json.RawMessage
		if err := ansRows.Scan(&qid, &ans); err != nil {
			ansRows.Close()
			return false, err
		}
		ansBy[qid] = ans
	}
	if err := ansRows.Err(); err != nil {
		ansRows.Close()
		return false, err
	}
	ansRows.Close()

	var totalScore, maxScore float64
	pendingManual := false
	for _, q := range qs {
		maxScore += q.Points
		// Skor manual tersimpan → pertahankan (jangan tertimpa re-grade).
		if ms, ok := manualScore[q.ID]; ok {
			totalScore += ms
			continue
		}
		var raw any
		if b, ok := ansBy[q.ID]; ok && len(b) > 0 && string(b) != "null" {
			raw = b
		}
		// Penilaian WAJIB lewat paket grading (CONVENTIONS.md).
		res := grading.Grade(&grading.Question{
			ID:          q.ID,
			Type:        q.Type,
			Points:      q.Points,
			ScoringMode: q.ScoringMode,
			AnswerKey:   q.AnswerKey,
			Options:     q.Options,
		}, raw)

		if res.Status == grading.StatusPendingManual {
			// Uraian: menunggu penilaian guru → placeholder skor 0 dengan
			// graded_by='auto' (bukan 'manual', agar bisa dibedakan dari
			// koreksi guru — FR-8.1/8.2).
			pendingManual = true
			if err := upsertGradedAnswer(ctx, tx, a.ID, tenantID, q.ID,
				ansBy, 0, nil, "auto", q.Points); err != nil {
				return false, err
			}
			continue
		}
		totalScore += res.Score
		correct := res.Correct
		if err := upsertGradedAnswer(ctx, tx, a.ID, tenantID, q.ID,
			ansBy, res.Score, &correct, "auto", q.Points); err != nil {
			return false, err
		}
	}

	final := gradingFinal(totalScore, maxScore, a.PenaltyPoints)
	newStatus := "graded"
	if pendingManual {
		newStatus = "submitted"
	}
	if _, err := tx.Exec(ctx, `
		UPDATE attempts SET score=$2, max_score=$3, final_score=$4, status=$5
		WHERE id=$1`, a.ID, totalScore, maxScore, final, newStatus); err != nil {
		return false, err
	}
	a.Score = totalScore
	a.MaxScore = maxScore
	a.FinalScore = final
	a.Status = newStatus
	return pendingManual, nil
}

// upsertGradedAnswer simpan hasil penilaian per soal. Soal tak dijawab tetap
// miliki baris dengan skor 0 (agar analisis butir lengkap).
func upsertGradedAnswer(ctx context.Context, tx pgx.Tx, attemptID, tenantID, questionID string,
	ansBy map[string]json.RawMessage, score float64, correct *bool, gradedBy string, maxPoints float64) error {
	answer := ansBy[questionID]
	if len(answer) == 0 {
		answer = json.RawMessage(`{}`)
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO attempt_answers(tenant_id, attempt_id, question_id, answer, is_correct, score, graded_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,now())
		ON CONFLICT (attempt_id, question_id) DO UPDATE
			SET is_correct=EXCLUDED.is_correct, score=EXCLUDED.score,
				graded_by=EXCLUDED.graded_by, updated_at=now()`,
		tenantID, attemptID, questionID, answer, correct, score, gradedBy)
	return err
}

// tenantIDOf dihapus — tenant dioper eksplisit ke gradeAttempt & upsertGradedAnswer.

// ---------------------------------------------------------------------------
// POST /student/attempts/{attemptID}/violations {client_event_id, type, ...}
// AC-8 & FR-5.8
// ---------------------------------------------------------------------------

func (m *Module) reportViolation(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if !m.a.RL.Allow("viol:%s:"+attemptID, 30) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	var req violationReq
	if !m.decode(w, r, &req) {
		return
	}
	ctx := r.Context()

	var resp violationResp
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

		// Attempt tidak sedang berjalan → hanya laporkan keadaan (tanpa efek).
		if a.Status != "in_progress" && a.Status != "pending_sync" {
			return violationState(ctx, tx, a, ac, &resp)
		}

		// Anti-cheat mati → pelanggaran tidak dicatat.
		if !ac.Enabled {
			return violationState(ctx, tx, a, ac, &resp)
		}

		// Idempoten: (attempt_id, client_event_id) unik (AC-3, migrasi 0005).
		var startedAt *time.Time
		if req.StartedAt != "" {
			if t, perr := time.Parse(time.RFC3339, req.StartedAt); perr == nil {
				startedAt = &t
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO attempt_violations(tenant_id, attempt_id, type, started_at, duration_ms, penalty_applied, client_event_id)
			VALUES ($1,$2,$3,$4,$5,0,$6)
			ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
			tenantID, a.ID, req.Type, startedAt, req.DurationMS, req.ClientEventID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			// Penalti bertambah satu pelanggaran (WAJIB internal/grading).
			np := grading.ApplyPenalty(a.PenaltyPoints, ac.PenaltyPoints, 1, ac.MaxPenalty)
			if _, err := tx.Exec(ctx,
				`UPDATE attempt_violations SET penalty_applied=$2
				 WHERE attempt_id=$1 AND client_event_id=$3`,
				a.ID, np-a.PenaltyPoints, req.ClientEventID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`UPDATE attempts SET penalty_points=$2 WHERE id=$1`, a.ID, np); err != nil {
				return err
			}
			a.PenaltyPoints = np
		}

		// Status kecurangan berdasarkan total pelanggaran aktif (AC-8).
		var total int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM attempt_violations WHERE attempt_id=$1 AND cancelled=false`, a.ID).
			Scan(&total); err != nil {
			return err
		}
		newStatus := a.CheatingStatus
		switch {
		case total >= ac.FlagThreshold:
			newStatus = "flagged"
		case total >= 1:
			if a.CheatingStatus == "none" {
				newStatus = "warned"
			} else {
				newStatus = a.CheatingStatus
			}
		}
		if newStatus != a.CheatingStatus {
			if _, err := tx.Exec(ctx,
				`UPDATE attempts SET cheating_status=$2 WHERE id=$1`, a.ID, newStatus); err != nil {
				return err
			}
			a.CheatingStatus = newStatus
		}
		return violationState(ctx, tx, a, ac, &resp)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}

	// Auto-submit bila threshold tercapai (AC-8) — tx terpisah kecil.
	if resp.ShouldAutoSubmit && resp.AttemptActive {
		err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
			a, err := loadAttempt(r.Context(), tx, attemptID)
			if err != nil {
				return err
			}
			if a.Status != "in_progress" && a.Status != "pending_sync" {
			return nil
			}
			e, err := loadExam(r.Context(), tx, a.ExamID)
			if err != nil {
				return err
			}
			autoID := "auto-submit-" + a.ID
			if _, err := insertSubmitEvent(r.Context(), tx, tenantID, a.ID, autoID,
				"auto_submit", map[string]any{"trigger": "anti_cheat"}); err != nil {
				return err
			}
			if _, err := finalizeAttempt(r.Context(), tx, tenantID, a, e, nowTS()); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			httpx.Error(w, err)
			return
		}
	}
	httpx.OK(w, map[string]any{"data": resp})
}

// violationState isi ringkasan respons pelanggaran dari keadaan attempt.
func violationState(ctx context.Context, tx pgx.Tx, a *attemptRecord, ac AntiCheat, resp *violationResp) error {
	var total int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(1) FROM attempt_violations WHERE attempt_id=$1 AND cancelled=false`, a.ID).
		Scan(&total); err != nil {
		return err
	}
	threshold := ac.FlagThreshold
	autoAt := ac.AutoSubmitAt
	if autoAt <= 0 {
		autoAt = threshold
	}
	resp.Violations = total
	resp.TotalPenalty = a.PenaltyPoints
	resp.CheatingStatus = a.CheatingStatus
	resp.ShouldAutoSubmit = ac.Enabled && ac.AutoSubmit && total >= autoAt &&
		(a.Status == "in_progress" || a.Status == "pending_sync")
	resp.AttemptActive = a.Status == "in_progress" || a.Status == "pending_sync"
	if total >= threshold {
		resp.WarnLeft = 0
	} else {
		resp.WarnLeft = threshold - total
	}
	return nil
}

// ---------------------------------------------------------------------------
// POST /student/attempts/{attemptID}/snapshots — multipart "photo" (FR-5.8)
// ---------------------------------------------------------------------------

const snapshotMaxBytes = 5 << 20 // 5 MB

func (m *Module) uploadSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if !m.a.RL.Allow("snap:%s:"+attemptID, 15) {
		httpx.Error(w, httpx.ErrRateLimited)
		return
	}
	if err := r.ParseMultipartForm(snapshotMaxBytes); err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Form unggahan tidak valid"))
		return
	}
	file, header, err := r.FormFile("photo")
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Berkas photo wajib ada"))
		return
	}
	defer file.Close()
	if header.Size > snapshotMaxBytes {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Foto melebihi 5 MB"))
		return
	}
	buf, err := io.ReadAll(io.LimitReader(file, snapshotMaxBytes+1))
	if err != nil || len(buf) > snapshotMaxBytes {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Foto melebihi 5 MB"))
		return
	}
	ext := snapshotExt(buf)
	if ext == "" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Format foto harus JPEG/PNG"))
		return
	}
	trigger := r.FormValue("trigger")
	if trigger == "" {
		trigger = "manual"
	}

	// Enkripsi at-rest bila key dikonfigurasi (FR-6.3/audit P2 #3):
	// materi ujian menulis file, foto wajah siswa tak boleh terbaca
	// oleh siapa pun yang memegang akses disk tanpa kunci.
	if key := m.a.Cfg.SnapshotEncryptionKey; key != "" {
		enc, err := encryptSnapshot(key, buf)
		if err != nil {
			httpx.Error(w, httpx.NewErr(http.StatusInternalServerError, "SNAPSHOT_ENCRYPT", "Gagal mengenkripsi foto"))
			return
		}
		buf = enc
	}
	var snapID string
	var url string
	ctx := r.Context()
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		a, err := loadAttemptOwned(ctx, tx, r, attemptID)
		if err != nil {
			return err
		}
		e, err := loadExam(ctx, tx, a.ExamID)
		if err != nil {
			return err
		}
		snapID, err = newUUID()
		if err != nil {
			return err
		}
		// Simpan ke disk lokal (CONVENTIONS.md: media modul lain; untuk snapshot
		// proktor disimpan oleh modul ini agar garansi AC-4 tetap lokal).
		objectKey := filepath.Join("data", "uploads", tenantID, "exam-snapshots",
			a.ExamID, a.ID, snapID+ext)
		dir := filepath.Dir(objectKey)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		// 0o600: hanya pemilik proses yang boleh membaca foto siswa.
		if err := os.WriteFile(objectKey, buf, 0o600); err != nil {
			return err
		}
		flags := map[string]any{"taken_at_client": r.FormValue("taken_at"), "trigger": trigger}
		expires := e.CloseAt.Add(30 * 24 * time.Hour)
		if err := tx.QueryRow(ctx, `
			INSERT INTO proctor_snapshots(tenant_id, attempt_id, object_key, taken_at, flags, expires_at)
			VALUES ($1,$2,$3,now(),$4,$5) RETURNING id::text`,
			tenantID, a.ID, objectKey, jsonRaw(flags), expires).Scan(&snapID); err != nil {
			_ = os.Remove(objectKey)
			return err
		}
		url = snapshotURL(e.ID, a.ID, snapID)
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.Created(w, map[string]any{"data": map[string]any{"id": snapID, "url": url}})
}

// snapshotExt sniff magic bytes → ekstensi; ” bila bukan gambar valid.
func snapshotExt(b []byte) string {
	if len(b) > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF {
		return ".jpg"
	}
	if len(b) > 8 && string(b[1:4]) == "PNG" {
		return ".png"
	}
	return ""
}

// ---------------------------------------------------------------------------
// GET /exams/{examID}/snapshots/{attemptID}/{snapID} — unduh foto (staf).
// ---------------------------------------------------------------------------

func (m *Module) serveSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	snapID, err := urlUUID(r, "snapID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var objectKey string
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var aExam string
		if err := tx.QueryRow(r.Context(), `
			SELECT ps.object_key, a.exam_id::text
			FROM proctor_snapshots ps
			JOIN attempts a ON a.id = ps.attempt_id
			WHERE ps.id=$1 AND ps.attempt_id=$2`, snapID, attemptID).Scan(&objectKey, &aExam); err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Snapshot tidak ditemukan")
			}
			return err
		}
		if aExam != examID {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Snapshot tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	b, err := os.ReadFile(objectKey)
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Berkas tidak tersedia"))
		return
	}
	// File lama (pra-enkripsi) tetap terbaca — passthrough legacy.
	b, err = decryptSnapshotIfEncrypted(m.a.Cfg.SnapshotEncryptionKey, b)
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusInternalServerError, "SNAPSHOT_DECRYPT", "Foto tidak dapat didekripsi — cek SNAPSHOT_ENCRYPTION_KEY"))
		return
	}
	ctype := "image/jpeg"
	if filepath.Ext(objectKey) == ".png" {
		ctype = "image/png"
	}
	w.Header().Set("Content-Type", ctype)
	_, _ = w.Write(b)
}
