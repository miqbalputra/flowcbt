package attempt

import (
	"context"
	"encoding/json"
	"net/http"

	"flowcbt/backend/internal/grading"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// gradeAttempt menilai attempt di server (FR-8.1/8.2): skor per soal via mesin murni,
// penalti dari pelanggaran (FR-5.8), nilai akhir skala 100. Dipakai submit, sync offline, auto-submit, re-grade.
func (s *Service) gradeAttempt(ctx context.Context, tenantID, attemptID, reason string) error {
	return s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var (
			examID, setVerID, status string
			antiEnabled               bool
			penaltyMode               string
			penaltyVal, penaltyMax    float64
			flagThr, autoSub          *int
			passing                   *float64
			decimals                  int
		)
		if err := tx.QueryRow(ctx,
			`SELECT a.exam_id, a.set_version_id, a.status, e.anticheat_enabled, e.penalty_mode, e.penalty_value, e.penalty_max,
			        e.flag_threshold, e.auto_submit_threshold, e.passing_score, t.score_decimals
			 FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN tenants t ON t.id=a.tenant_id
			 WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE`, tenantID, attemptID).
			Scan(&examID, &setVerID, &status, &antiEnabled, &penaltyMode, &penaltyVal, &penaltyMax,
				&flagThr, &autoSub, &passing, &decimals); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		if status == "graded" || status == "cancelled" {
			return nil
		}
		// hitung pelanggaran yang melewati toleransi (FR-5.8A)
		var vCount int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM attempt_violations WHERE attempt_id=$1 AND counted`, attemptID).Scan(&vCount); err != nil {
			return err
		}
		// muat soal + kunci (hanya di server)
		type qRow struct {
			id, qtype, opts, key       string
			points                     float64
			scoringMode                string
			wrongPen                   bool
		}
		var qs []qRow
		rws, err := tx.Query(ctx,
			`SELECT id, type, options_json::text, COALESCE(answer_key_json::text,'null'), points, scoring_mode, partial_wrong_penalty
			 FROM questions WHERE set_version_id=$1 ORDER BY order_no`, setVerID)
		if err != nil {
			return err
		}
		for rws.Next() {
			var q qRow
			if err := rws.Scan(&q.id, &q.qtype, &q.opts, &q.key, &q.points, &q.scoringMode, &q.wrongPen); err != nil {
				rws.Close()
				return err
			}
			qs = append(qs, q)
		}
		rws.Close()
		if err := rws.Err(); err != nil {
			return err
		}
		// jawaban terakhir per soal
		answers := map[string]json.RawMessage{}
		aws, err := tx.Query(ctx, `SELECT question_id, answer_json FROM attempt_answers WHERE attempt_id=$1 AND answer_json IS NOT NULL`, attemptID)
		if err != nil {
			return err
		}
		for aws.Next() {
			var qid string
			var ans json.RawMessage
			if err := aws.Scan(&qid, &ans); err != nil {
				aws.Close()
				return err
			}
			answers[qid] = ans
		}
		aws.Close()

		var raw, max float64
		hasEssay := false
		for _, q := range qs {
			max += q.points
			if q.qtype == "essay" {
				hasEssay = true
				continue
			}
			gq := grading.Question{
				Type: q.qtype, OptionsJSON: json.RawMessage(q.opts), AnswerKeyJSON: json.RawMessage(q.key),
				Points: q.points, ScoringMode: q.scoringMode, PartialWrongPenalty: q.wrongPen,
			}
			ans := answers[q.id]
			var res grading.ScoreResult
			if len(ans) > 0 && string(ans) != "null" {
				res = grading.Score(gq, ans)
			}
			raw += res.Score
			if _, err := tx.Exec(ctx,
				`UPDATE attempt_answers SET is_correct=$1, auto_score=$2, score=$2, graded_by='auto' WHERE attempt_id=$3 AND question_id=$4`,
				res.IsCorrect, res.Score, attemptID, q.id); err != nil {
				return err
			}
		}
		// penalti (dihitung di server, FR-5.8A/AC-8)
		penalty := 0.0
		if antiEnabled {
			penalty = grading.Penalty(vCount, penaltyMode, penaltyVal, penaltyMax)
		}
		final := grading.FinalScore(raw, max, penalty, decimals)
		var passed any
		if passing != nil {
			p := final >= *passing
			passed = p
		}
		newStatus := "graded"
		provisional := false
		if hasEssay {
			newStatus = "awaiting_manual_grading"
			provisional = true
		}
		// status awal pending_sync (submit offline) → submitted saat tersinkron (AC-4)
		if status == "pending_sync" && reason == "offline_sync" {
			// akan langsung dinilai; status akhir tetap newStatus
		}
		cheatStatus := "none"
		if flagThr != nil && vCount >= *flagThr {
			cheatStatus = "flagged"
		}
		if _, err := tx.Exec(ctx,
			`UPDATE attempts SET status=$1, submit_reason=$2, submitted_at=COALESCE(submitted_at, now()),
			    raw_score=$3, max_score=$4, penalty_points=$5, final_score=$6, score_provisional=$7, passed=$8,
			    violation_count=$9, cheating_status = CASE WHEN cheating_status IN ('disqualified') THEN cheating_status ELSE $10 END
			 WHERE id=$11`,
			newStatus, nullStr2(reason), raw, max, penalty, final, provisional, passed, vCount, cheatStatus, attemptID); err != nil {
			return err
		}
		// sesi dikunci saat submit (FR-1.6)
		if _, err := tx.Exec(ctx,
			`UPDATE attempt_sessions SET revoked_at=now(), revoked_by='submit' WHERE attempt_id=$1 AND revoked_at IS NULL`, attemptID); err != nil {
			return err
		}
		s.Audit.Log(ctx, tx, tenantID, "system", "", "attempt.grade", "attempt", attemptID,
			map[string]any{"raw": raw, "max": max, "penalty": penalty, "final": final, "status": newStatus, "reason": reason}, "")
		_ = examID
		return nil
	})
}

// --- GET /attempts/{id}/grading (guru): daftar jawaban + skor per soal ---

func (s *Service) gradingDetail(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	attemptID := chi.URLParam(r, "id")
	var out []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT aa.question_id, q.order_no, q.type, q.body_html, q.points, q.answer_key_json::text, q.rubric_json::text,
			        aa.answer_json, aa.flagged, aa.is_correct, aa.auto_score, aa.score, aa.graded_by, aa.grader_comment, aa.override_reason
			 FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id
			 WHERE aa.attempt_id=$1 ORDER BY q.order_no`, attemptID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var qid, qtype, body string
			var key, rubric *string
			var order int
			var points float64
			var ans json.RawMessage
			var flagged bool
			var correct *bool
			var auto, score *float64
			var gradedBy, comment, reason *string
			if err := rws.Scan(&qid, &order, &qtype, &body, &points, &key, &rubric, &ans, &flagged, &correct, &auto, &score, &gradedBy, &comment, &reason); err != nil {
				return err
			}
			out = append(out, map[string]any{
				"question_id": qid, "order_no": order, "type": qtype, "body_html": body, "points": points,
				"answer_key": strOrNull(key), "rubric": strOrNull(rubric),
				"answer": rawOrNull(ans), "flagged": flagged, "is_correct": correct,
				"auto_score": auto, "score": score, "graded_by": gradedBy, "grader_comment": comment, "override_reason": reason,
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if out == nil {
		out = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func jsonOrNull(s string) any {
	if s == "" || s == "null" {
		return nil
	}
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return nil
	}
	return v
}

func strOrNull(s *string) any {
	if s == nil {
		return nil
	}
	return jsonOrNull(*s)
}

// --- PUT /attempts/{id}/answers/{qid}/score: koreksi manual / override (FR-8.3) + audit ---

func (s *Service) putScore(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	attemptID := chi.URLParam(r, "id")
	qid := chi.URLParam(r, "qid")
	actor := httpx.ActorIDFrom(r.Context())
	var in struct {
		Score   float64 `json:"score"`
		Comment string  `json:"comment"`
		Reason  string  `json:"override_reason"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE attempt_answers SET score=$1, graded_by='manual', grader_id=$2, grader_comment=$3, override_reason=NULLIF($4,''), updated_at=now()
			 WHERE attempt_id=$5 AND question_id=$6`,
			in.Score, actor, nullStr2(in.Comment), nullStr2(in.Reason), attemptID, qid)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("jawaban soal tidak ditemukan")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "answer.score_override", "attempt_answer", qid,
			map[string]any{"attempt": attemptID, "score": in.Score, "reason": in.Reason}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	// hitung ulang nilai attempt (FR-8.3)
	if err := s.regradeAttempt(r.Context(), tid, attemptID); err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// regradeAttempt menghitung ulang total attempt dari skor per soal (dipakai koreksi manual & re-grade).
func (s *Service) regradeAttempt(ctx context.Context, tenantID, attemptID string) error {
	return s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		var (
			examID, status          string
			penaltyMode             string
			penaltyVal, penaltyMax  float64
			antiEnabled             bool
			passing                 *float64
			decimals                int
		)
		if err := tx.QueryRow(ctx,
			`SELECT a.exam_id, a.status, e.penalty_mode, e.penalty_value, e.penalty_max, e.anticheat_enabled, e.passing_score, t.score_decimals
			 FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN tenants t ON t.id=a.tenant_id
			 WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE`, tenantID, attemptID).
			Scan(&examID, &status, &penaltyMode, &penaltyVal, &penaltyMax, &antiEnabled, &passing, &decimals); err != nil {
			return err
		}
		if status == "cancelled" {
			return nil
		}
		var raw, max float64
		var ungradedEssay int
		_ = tx.QueryRow(ctx, `SELECT COALESCE(sum(points),0) FROM questions q JOIN attempts a ON a.set_version_id=q.set_version_id WHERE a.id=$1`, attemptID).Scan(&max)
		if _, err := tx.Exec(ctx,
			`SELECT COALESCE(sum(COALESCE(score, auto_score, 0)),0) FROM attempt_answers WHERE attempt_id=$1`, attemptID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(sum(COALESCE(aa.score, aa.auto_score, 0)),0) FROM attempt_answers aa WHERE aa.attempt_id=$1`, attemptID).Scan(&raw); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id
			 WHERE aa.attempt_id=$1 AND q.type='essay' AND aa.score IS NULL`, attemptID).Scan(&ungradedEssay); err != nil {
			return err
		}
		var penalty float64
		if antiEnabled {
			var vCount int
			_ = tx.QueryRow(ctx, `SELECT count(*) FROM attempt_violations WHERE attempt_id=$1 AND counted`, attemptID).Scan(&vCount)
			penalty = grading.Penalty(vCount, penaltyMode, penaltyVal, penaltyMax)
		}
		// penalti dibatalkan guru (cheating_status=penalty_cancelled) → penalty 0
		var chStatus string
		_ = tx.QueryRow(ctx, `SELECT cheating_status FROM attempts WHERE id=$1`, attemptID).Scan(&chStatus)
		if chStatus == "penalty_cancelled" {
			penalty = 0
		}
		final := grading.FinalScore(raw, max, penalty, decimals)
		if chStatus == "disqualified" {
			final = 0
		}
		var passed any
		if passing != nil {
			p := final >= *passing && chStatus != "disqualified"
			passed = p
		}
		newStatus := status
		provisional := false
		if ungradedEssay > 0 && status != "graded" {
			newStatus = "awaiting_manual_grading"
			provisional = true
		} else if status == "awaiting_manual_grading" && ungradedEssay == 0 {
			newStatus = "graded"
		}
		if _, err := tx.Exec(ctx,
			`UPDATE attempts SET raw_score=$1, max_score=$2, penalty_points=$3, final_score=$4, score_provisional=$5, passed=$6, status=$7 WHERE id=$8`,
			raw, max, penalty, final, provisional, passed, newStatus, attemptID); err != nil {
			return err
		}
		_ = examID
		return nil
	})
}

// --- PUT /attempts/{id}/cheating-decision (FR-5.8C): Valid / Batalkan penalti / Diskualifikasi ---

func (s *Service) cheatingDecision(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	attemptID := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	var in struct {
		Decision string `json:"decision"` // valid | penalty_cancelled | disqualified
		Reason   string `json:"reason"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	if in.Decision != "valid" && in.Decision != "penalty_cancelled" && in.Decision != "disqualified" {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "decision harus: valid | penalty_cancelled | disqualified"))
		return
	}
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(r.Context(),
			`UPDATE attempts SET cheating_status=$1, cheating_decided_by=$2, cheating_decided_at=now(), cheating_reason=$3 WHERE tenant_id=$4 AND id=$5`,
			in.Decision, actor, nullStr2(in.Reason), tid, attemptID)
		if err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "attempt.cheating_decision", "attempt", attemptID,
			map[string]any{"decision": in.Decision, "reason": in.Reason}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	_ = s.regradeAttempt(r.Context(), tid, attemptID)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// --- POST /exams/{id}/regrade (FR-8.4) ---

func (s *Service) regradeExam(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	examID := chi.URLParam(r, "id")
	var ids []string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT id FROM attempts WHERE tenant_id=$1 AND exam_id=$2 AND status IN ('submitted','awaiting_manual_grading','graded')`, tid, examID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id string
			if err := rws.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	for _, id := range ids {
		_ = s.regradeAttempt(r.Context(), tid, id)
	}
	s.Audit.Log(r.Context(), s.DB.System, tid, "user", httpx.ActorIDFrom(r.Context()), "exam.regrade", "exam", examID, map[string]any{"attempts": len(ids)}, "")
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "regraded": len(ids)})
}

// --- POST /attempts/{id}/violations (FR-5.8A): pelanggaran dicatat meski offline (event lokal → sinkron) ---

func (s *Service) addViolations(w http.ResponseWriter, r *http.Request) {
	claims := httpx.ClaimsFrom(r.Context())
	tid := claims.TenantID
	attemptID := chi.URLParam(r, "id")
	var in struct {
		Violations []struct {
			ClientEventID string  `json:"client_event_id"`
			Type          string  `json:"type"`
			StartedAt     string  `json:"started_at"`
			DurationMS    int     `json:"duration_ms"`
		} `json:"violations"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	var counted int
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var studentID, status string
		var leaveTol int
		var antiEnabled bool
		if err := tx.QueryRow(r.Context(),
			`SELECT a.student_id, a.status, e.leave_tolerance_seconds, e.anticheat_enabled
			 FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.tenant_id=$1 AND a.id=$2`, tid, attemptID).
			Scan(&studentID, &status, &leaveTol, &antiEnabled); err != nil {
			return httpx.NotFound("attempt tidak ditemukan")
		}
		if claims.Role == "student" && studentID != claims.Sub {
			return httpx.Forbidden("bukan attempt Anda")
		}
		for _, v := range in.Violations {
			if v.ClientEventID == "" {
				continue
			}
			startedAt, _ := parseTime(v.StartedAt)
			isCounted := antiEnabled && v.DurationMS > leaveTol*1000
			if isCounted {
				counted++
			}
			_, err := tx.Exec(r.Context(),
				`INSERT INTO attempt_violations (tenant_id, attempt_id, client_event_id, type, started_at, duration_ms, counted)
				 VALUES ($1,$2,$3,$4,$5,$6,$7)
				 ON CONFLICT (attempt_id, client_event_id) DO NOTHING`,
				tid, attemptID, v.ClientEventID, v.Type, startedAt, v.DurationMS, isCounted)
			if err != nil {
				return err
			}
		}
		if counted > 0 {
			if _, err := tx.Exec(r.Context(),
				`UPDATE attempts SET violation_count = (SELECT count(*) FROM attempt_violations WHERE attempt_id=$1 AND counted), last_seen_at=now() WHERE id=$1`, attemptID); err != nil {
				return err
			}
			// auto-submit bila melewati ambang (FR-5.8A opsional)
			var autoThr *int
			_ = tx.QueryRow(r.Context(), `SELECT auto_submit_threshold FROM exams e JOIN attempts a ON a.exam_id=e.id WHERE a.id=$1`, attemptID).Scan(&autoThr)
			if autoThr != nil {
				var vc int
				_ = tx.QueryRow(r.Context(), `SELECT violation_count FROM attempts WHERE id=$1`, attemptID).Scan(&vc)
				if vc >= *autoThr {
					if _, err := tx.Exec(r.Context(),
						`UPDATE attempts SET status='pending_sync', submit_reason='violation' WHERE id=$1 AND status='in_progress'`, attemptID); err != nil {
						return err
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	// bila ada auto-submit, nilai sekarang
	_ = s.regradeIfSubmitted(r.Context(), tid, attemptID)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "newly_counted": counted})
}

func (s *Service) regradeIfSubmitted(ctx context.Context, tid, attemptID string) error {
	var status string
	if err := s.DB.WithTenantTx(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status FROM attempts WHERE tenant_id=$1 AND id=$2`, tid, attemptID).Scan(&status)
	}); err != nil {
		return err
	}
	if status == "pending_sync" || status == "submitted" {
		return s.gradeAttempt(ctx, tid, attemptID, "violation")
	}
	return nil
}
