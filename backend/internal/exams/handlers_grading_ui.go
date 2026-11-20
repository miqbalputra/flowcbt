// handlers_grading_ui.go — penilaian manual guru (PRD FR-8.3, FR-8.4):
//
//	GET /attempts/{attemptID}/grading                                  (staf)
//	PUT  /attempts/{attemptID}/answers/{qid}/score {score,reason}      (staf)
//
// Override skor + alasan masuk audit_logs. Setelah semua uraian dinilai,
// attempt berpindah ke status graded & nilai final dihitung ulang.
package exams

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

type attemptMetaGrading struct {
	ID             string     `json:"id"`
	StudentID      string     `json:"student_id"`
	StudentName    string     `json:"student_name"`
	StudentClass   string     `json:"student_class"`
	AttemptNo      int        `json:"attempt_no"`
	Status         string     `json:"status"`
	StartedAt      *time.Time `json:"started_at"`
	SubmittedAt    *time.Time `json:"submitted_at"`
	DeadlineAt     *time.Time `json:"deadline_at"`
	Score          *float64   `json:"score"`
	MaxScore       *float64   `json:"max_score"`
	FinalScore     *float64   `json:"final_score"`
	FinalPending   bool       `json:"final_score_pending"`
	PenaltyPoints  float64    `json:"penalty_points"`
	CheatingStatus string     `json:"cheating_status"`
	ExamID         string     `json:"exam_id"`
	ExamName       string     `json:"exam_name"`
}

type gradingQuestion struct {
	QuestionID    string          `json:"question_id"`
	OrderNo       int             `json:"order_no"`
	Type          string          `json:"type"`
	MaxPoints     float64         `json:"max_points"`
	Body          string          `json:"body"`
	Options       json.RawMessage `json:"options"`
	AnswerKey     json.RawMessage `json:"answer_key"`
	StudentAnswer json.RawMessage `json:"student_answer"`
	Flagged       bool            `json:"flagged"`
	Score         float64         `json:"score"`
	GradedBy      string          `json:"graded_by"`
	IsCorrect     *bool           `json:"is_correct"`
	NeedsManual   bool            `json:"needs_manual"`
	Explanation   string          `json:"explanation"`
}

type gradingView struct {
	Attempt   attemptMetaGrading `json:"attempt"`
	Questions []gradingQuestion  `json:"questions"`
}

func (m *Module) getGrading(w http.ResponseWriter, r *http.Request) {
	tenantID := ctxinfo.TenantID(r.Context())
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	ctx := r.Context()
	var out gradingView
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		a, err := loadAttempt(ctx, tx, attemptID)
		if err != nil {
			return err
		}
		e, err := loadExam(ctx, tx, a.ExamID)
		if err != nil {
			return err
		}
		sName, sClass := "", ""
		if a.StudentID != "" {
			var nm *string
			if err := tx.QueryRow(ctx, `SELECT name FROM students WHERE id=$1`, a.StudentID).Scan(&nm); err == nil && nm != nil {
				sName = *nm
			}
		}
		var classSnapStr string
		_ = tx.QueryRow(ctx, `SELECT class_snapshot::text FROM attempts WHERE id=$1`, attemptID).Scan(&classSnapStr)
		var cs struct {
			Name string `json:"name"`
		}
		_ = json.Unmarshal([]byte(classSnapStr), &cs)
		sClass = cs.Name
		pending := hasUngradedEssay(ctx, tx, a.ID)
		out.Attempt = attemptMetaGrading{
			ID: a.ID, StudentID: a.StudentID, StudentName: sName, StudentClass: sClass,
			AttemptNo: a.AttemptNo, Status: a.Status, StartedAt: a.StartedAt,
			SubmittedAt: a.SubmittedAt, DeadlineAt: a.DeadlineAt,
			Score: scorePtr(a.Score), MaxScore: scorePtr(a.MaxScore), FinalScore: scorePtr(a.FinalScore),
			FinalPending: pending, PenaltyPoints: a.PenaltyPoints,
			CheatingStatus: a.CheatingStatus, ExamID: e.ID, ExamName: e.Name,
		}
		qs, err := loadVersionQuestions(ctx, tx, e.QuestionSetVersionID)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT question_id::text, answer, flag_ragu, score, graded_by, is_correct
			FROM attempt_answers WHERE attempt_id=$1`, attemptID)
		if err != nil {
			return err
		}
		defer rows.Close()
		type rw struct {
			answer   json.RawMessage
			flag     bool
			score    float64
			gradedBy string
			correct  *bool
		}
		scores := map[string]rw{}
		for rows.Next() {
			var qid string
			var v rw
			if err := rows.Scan(&qid, &v.answer, &v.flag, &v.score, &v.gradedBy, &v.correct); err != nil {
				return err
			}
			scores[qid] = v
		}
		if err := rows.Err(); err != nil {
			return err
		}
		out.Questions = []gradingQuestion{}
		for _, q := range qs {
			gq := gradingQuestion{
				QuestionID: q.ID, OrderNo: q.OrderNo, Type: q.Type, MaxPoints: q.Points,
				Body: q.Body, Options: q.Options, AnswerKey: q.AnswerKey, Explanation: q.Explanation,
				GradedBy: "auto",
			}
			if v, ok := scores[q.ID]; ok {
				gq.StudentAnswer = v.answer
				gq.Flagged = v.flag
				gq.Score = v.score
				gq.GradedBy = v.gradedBy
				gq.IsCorrect = v.correct
			}
			gq.NeedsManual = q.Type == "essay" && gq.GradedBy != "manual"
			out.Questions = append(out.Questions, gq)
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

func hasUngradedEssay(ctx context.Context, tx pgx.Tx, attemptID string) bool {
	var ungraded int
	_ = tx.QueryRow(ctx, `
		SELECT COUNT(1) FROM questions q
		JOIN attempt_answers aa ON aa.question_id = q.id AND aa.attempt_id=$1
		WHERE q.type='essay' AND aa.graded_by <> 'manual'`, attemptID).Scan(&ungraded)
	return ungraded > 0
}

// putAnswerScore guru memberi skor pada satu jawaban (uraian atau override
// soal objektif) + alasan walau opsional — selalu masuk audit log (FR-8.3).
func (m *Module) putAnswerScore(w http.ResponseWriter, r *http.Request) {
	tenantID := ctxinfo.TenantID(r.Context())
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	qid, err := urlUUID(r, "questionID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req struct {
		Score  *float64 `json:"score" validate:"required"`
		Reason string   `json:"reason"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if req.Score == nil || *req.Score < 0 {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Skor tidak valid"))
		return
	}
	ctx := r.Context()
	maxPts := 0.0
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		a, err := loadAttempt(ctx, tx, attemptID)
		if err != nil {
			return err
		}
		if a.Status != "submitted" && a.Status != "graded" {
			return httpx.NewErr(http.StatusConflict, "ATTEMPT_NOT_ACTIVE", "Attempt belum selesai dikerjakan")
		}
		// maks poin soal ini dari versi
		var attemptQuestion struct {
			Points float64
		}
		if err := tx.QueryRow(ctx, `
			SELECT q.points FROM questions q
			JOIN exams e ON e.question_set_version_id = q.set_version_id
			JOIN attempts at ON at.exam_id = e.id AND at.id=$1::uuid
			WHERE q.id=$2::uuid`, attemptID, qid).Scan(&attemptQuestion.Points); err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Soal tidak ada pada ujian ini")
			}
			return err
		}
		maxPts = attemptQuestion.Points
		if *req.Score > maxPts {
			*req.Score = maxPts
		}
		if _, err := tx.Exec(ctx, `
			UPDATE attempt_answers SET score=$1, graded_by='manual', updated_at=now()
			WHERE attempt_id=$2 AND question_id=$3`, *req.Score, attemptID, qid); err != nil {
			return err
		}
		// hitung ulang agregat + status
		return recomputeScore(ctx, tx, a.ID)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	meta := map[string]any{"score": *req.Score, "max": maxPts, "reason": req.Reason}
	_, _ = m.a.DB.Admin.Exec(ctx, `
		INSERT INTO audit_logs(tenant_id, actor_id, actor_role, action, entity, entity_id, meta)
		VALUES ($1,$2,$3,'grade_override','attempt_answer',$4,$5)`,
		tenantID, ctxinfo.UserID(r.Context()), ctxinfo.Role(r.Context()), attemptID+"/"+qid, meta)
	httpx.OK(w, map[string]any{"data": map[string]any{"score": *req.Score, "max_points": maxPts}})
}

// recomputeScore menghitung ulang score/max/final + status attempt setelah
// perubahan penilaian (dipakai putAnswerScore & regrade).
func recomputeScore(ctx context.Context, tx pgx.Tx, attemptID string) error {
	a, err := loadAttempt(ctx, tx, attemptID)
	if err != nil {
		return err
	}
	e, err := loadExam(ctx, tx, a.ExamID)
	if err != nil {
		return err
	}
	var maxScore float64
	if err := tx.QueryRow(ctx, `SELECT COALESCE(SUM(points),0) FROM questions WHERE set_version_id=$1`, e.QuestionSetVersionID).Scan(&maxScore); err != nil {
		return err
	}
	var totalScore float64
	var ungraded int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(aa.score),0),
			(SELECT COUNT(1) FROM questions q WHERE q.set_version_id=$2 AND q.type='essay'
			  AND (SELECT graded_by FROM attempt_answers aa WHERE aa.attempt_id=$1 AND aa.question_id=q.id) <> 'manual')
		FROM attempt_answers aa WHERE aa.attempt_id=$1`, attemptID, e.QuestionSetVersionID).
		Scan(&totalScore, &ungraded); err != nil {
		return err
	}
	final := gradingFinal(totalScore, maxScore, a.PenaltyPoints)
	newStatus := a.Status
	if newStatus == "submitted" || newStatus == "graded" {
		if ungraded > 0 {
			// masih menunggu penilaian manual (nilai sementara)
		} else {
			newStatus = "graded"
		}
	}
	_, err = tx.Exec(ctx, `
		UPDATE attempts SET score=$1, max_score=$2, final_score=$3, status=$4 WHERE id=$5`,
		totalScore, maxScore, final, newStatus, attemptID)
	return err
}

func scorePtr(v float64) *float64 { return &v }

func jsonFloat(f float64) string {
	b, _ := json.Marshal(f)
	return string(b)
}
