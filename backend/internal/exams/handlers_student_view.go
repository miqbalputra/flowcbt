// handlers_student_view.go — view siswa untuk mulai & pemulihan attempt:
//
//	GET /student/exams/{examID}   — info ujian + tata tertib (tanpa soal)
//	(alias top-level /attempts/{id} didefinisikan di module.go)
package exams

import (
	"net/http"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

type examRulesView struct {
	AntiCheatEnabled bool    `json:"anti_cheat_enabled"`
	ToleranceSeconds int     `json:"tolerance_seconds"`
	PenaltyPoints    float64 `json:"penalty_points"`
	MaxPenalty       float64 `json:"max_penalty"`
	FlagThreshold    int     `json:"flag_threshold"`
	AutoSubmit       bool    `json:"auto_submit"`
	CameraEnabled    bool    `json:"camera_enabled"`
	CameraRequired   bool    `json:"camera_required"`
	SnapshotMinS     int     `json:"snapshot_min_s"`
	SnapshotMaxS     int     `json:"snapshot_max_s"`
}

type studentExamView struct {
	ID                 string        `json:"id"`
	Name               string        `json:"name"`
	SubjectName        string        `json:"subject_name"`
	ExamCode           string        `json:"exam_code"`
	OpenAt             time.Time     `json:"open_at"`
	CloseAt            time.Time     `json:"close_at"`
	DurationMinutes    int           `json:"duration_minutes"`
	MaxAttempts        int           `json:"max_attempts"`
	AttemptsUsed       int           `json:"attempts_used"`
	LoginMode          string        `json:"login_mode"`
	Paused             bool          `json:"paused"`
	ScoreReleased      bool          `json:"score_released"`
	RequireAllAnswered bool          `json:"require_all_answered"`
	FreeNavigation     bool          `json:"free_navigation"`
	QuestionCount      int           `json:"question_count"`
	TotalPoints        float64       `json:"total_points"`
	Rules              examRulesView `json:"rules"`
}

// studentExam GET /student/exams/{examID}
func (m *Module) studentExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	sid := ctxinfo.StudentID(r.Context())
	ctx := r.Context()
	var out studentExamView
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(ctx, tx, examID)
		if err != nil {
			return err
		}
		ac := e.antiCheat()
		out = studentExamView{
			ID: e.ID, Name: e.Name, SubjectName: e.SubjectName, ExamCode: e.ExamCode,
			OpenAt: e.OpenAt, CloseAt: e.CloseAt,
			DurationMinutes: e.DurationMinutes, MaxAttempts: e.MaxAttempts,
			LoginMode: e.LoginMode, Paused: e.Paused, ScoreReleased: e.ScoreReleased,
			RequireAllAnswered: e.RequireAllAnswered, FreeNavigation: e.FreeNavigation,
			Rules: examRulesView{
				AntiCheatEnabled: ac.Enabled, ToleranceSeconds: ac.ToleranceSeconds,
				PenaltyPoints: ac.PenaltyPoints, MaxPenalty: ac.MaxPenalty,
				FlagThreshold: ac.FlagThreshold, AutoSubmit: ac.AutoSubmit,
				CameraEnabled: ac.CameraEnabled, CameraRequired: ac.CameraMode == "wajib",
				SnapshotMinS: ac.SnapshotMinS, SnapshotMaxS: ac.SnapshotMaxS,
			},
		}
		if e.QuestionSetVersionID != "" {
			_ = tx.QueryRow(ctx, `
				SELECT COUNT(1), COALESCE(SUM(points),0) FROM questions WHERE set_version_id=$1`,
				e.QuestionSetVersionID).Scan(&out.QuestionCount, &out.TotalPoints)
		}
		if sid != "" {
			_ = tx.QueryRow(ctx, `
				SELECT COUNT(1) FROM attempts WHERE exam_id=$1 AND student_id=$2`,
				examID, sid).Scan(&out.AttemptsUsed)
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}
