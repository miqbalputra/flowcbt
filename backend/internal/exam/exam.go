// Package exam: CRUD ujian, token, ruang, penugasan→peserta, publish (gating kuota AC-7), aksi pengawas (M5).
package exam

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	DB      *platform.DB
	Audit   *audit.Writer
	Clock   platform.Clock
	Billing *billing.Service
}

type Exam struct {
	ID               string     `json:"id"`
	QuestionSetID    string     `json:"question_set_id"`
	QuestionSetTitle string     `json:"question_set_title,omitempty"`
	Name             string     `json:"name"`
	Status           string     `json:"status"`
	OpenAt           *time.Time `json:"open_at,omitempty"`
	CloseAt          *time.Time `json:"close_at,omitempty"`
	DurationMinutes  *int       `json:"duration_minutes,omitempty"`
	ClosePolicy      string     `json:"close_policy"`
	LoginMode        string     `json:"login_mode"`
	MaxAttempts      *int       `json:"max_attempts,omitempty"`
	ScorePolicy      string     `json:"score_policy"`
	PassingScore     *float64   `json:"passing_score,omitempty"`
	ShowScoreImmediately bool   `json:"show_score_immediately"`
	ShowReview       bool       `json:"show_review"`
	ShowExplanations bool       `json:"show_explanations"`
	ShuffleQuestions bool       `json:"shuffle_questions"`
	ShuffleOptions   bool       `json:"shuffle_options"`
	FreeNavigation   bool       `json:"free_navigation"`
	RequireAllAnswered bool     `json:"require_all_answered"`
	AnticheatEnabled bool       `json:"anticheat_enabled"`
	LeaveToleranceSeconds int   `json:"leave_tolerance_seconds"`
	PenaltyMode      string     `json:"penalty_mode"`
	PenaltyValue     float64    `json:"penalty_value"`
	PenaltyMax       float64    `json:"penalty_max"`
	FlagThreshold    *int       `json:"flag_threshold,omitempty"`
	AutoSubmitThreshold *int    `json:"auto_submit_threshold,omitempty"`
	CameraEnabled    bool       `json:"camera_enabled"`
	CameraDenyPolicy string     `json:"camera_deny_policy"`
	QuotaSource      *string    `json:"quota_source,omitempty"`
	PublishedAt      *time.Time `json:"published_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	Token            string     `json:"token,omitempty"` // hanya untuk guru
}

// Routes mendaftarkan rute di dalam subrouter /exams (dipanggil sekali dari server).
func (s *Service) Routes(r chi.Router) {
	r.Get("/", s.list)
	r.Post("/", s.create)
	r.Get("/{id}", s.get)
	r.Put("/{id}", s.update)
	r.Delete("/{id}", s.cancel)
	r.Post("/{id}/publish", s.publish)
	r.Post("/{id}/unpublish", s.unpublish)
	r.Post("/{id}/token/regenerate", s.regenerateToken)
	r.Put("/{id}/assignments", s.setAssignments)
	r.Get("/{id}/participants", s.listParticipants)
	r.Post("/{id}/participants/{studentId}/extend-time", s.extendTime)
	r.Post("/{id}/participants/{studentId}/reset-attempt", s.resetAttempt)
	r.Post("/{id}/participants/{studentId}/force-submit", s.forceSubmit)
	r.Post("/{id}/pause", s.pause)
	r.Post("/{id}/close", s.closeExam)
	r.Get("/{id}/cheating-report", s.cheatingReport)
}

type examInput struct {
	QuestionSetID    string   `json:"question_set_id"`
	Name             string   `json:"name"`
	OpenAt           *string  `json:"open_at"`
	CloseAt          *string  `json:"close_at"`
	DurationMinutes  *int     `json:"duration_minutes"`
	ClosePolicy      string   `json:"close_policy"`
	LoginMode        string   `json:"login_mode"`
	MaxAttempts      *int     `json:"max_attempts"`
	ScorePolicy      string   `json:"score_policy"`
	PassingScore     *float64 `json:"passing_score"`
	ShowScoreImmediately *bool `json:"show_score_immediately"`
	ShowReview       *bool    `json:"show_review"`
	ShowExplanations *bool    `json:"show_explanations"`
	ShuffleQuestions *bool    `json:"shuffle_questions"`
	ShuffleOptions   *bool    `json:"shuffle_options"`
	FreeNavigation   *bool    `json:"free_navigation"`
	RequireAllAnswered *bool  `json:"require_all_answered"`
	AnticheatEnabled *bool    `json:"anticheat_enabled"`
	LeaveToleranceSeconds *int `json:"leave_tolerance_seconds"`
	PenaltyMode      string   `json:"penalty_mode"`
	PenaltyValue     *float64 `json:"penalty_value"`
	PenaltyMax       *float64 `json:"penalty_max"`
	FlagThreshold    *int     `json:"flag_threshold"`
	AutoSubmitThreshold *int   `json:"auto_submit_threshold"`
	CameraEnabled    *bool    `json:"camera_enabled"`
	CameraDenyPolicy string   `json:"camera_deny_policy"`
}

func parseTime(s *string) (*time.Time, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *s)
	if err != nil {
		return nil, fmt.Errorf("format waktu harus RFC3339 (mis. 2026-11-20T08:00:00+07:00): %s", *s)
	}
	return &t, nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	status := r.URL.Query().Get("status")
	var rows []Exam
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		query := `SELECT e.id, e.question_set_id, qs.title, e.name, e.status, e.open_at, e.close_at, e.duration_minutes,
		   e.close_policy, e.login_mode, e.max_attempts, e.score_policy, e.passing_score, e.show_score_immediately,
		   e.show_review, e.show_explanations, e.shuffle_questions, e.shuffle_options, e.free_navigation, e.require_all_answered,
		   e.anticheat_enabled, e.leave_tolerance_seconds, e.penalty_mode, e.penalty_value, e.penalty_max, e.flag_threshold,
		   e.auto_submit_threshold, e.camera_enabled, e.camera_deny_policy, e.quota_source, e.published_at, e.created_at,
		   (SELECT t.token FROM exam_tokens t WHERE t.exam_id=e.id AND t.is_active=true AND t.room_id IS NULL LIMIT 1)
		FROM exams e JOIN question_sets qs ON qs.id=e.question_set_id WHERE e.tenant_id=$1`
		args := []any{tid}
		if status != "" {
			query += ` AND e.status=$2`
			args = append(args, status)
		}
		query += ` ORDER BY e.created_at DESC LIMIT 200`
		rws, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var e Exam
			var token *string
			if err := rws.Scan(&e.ID, &e.QuestionSetID, &e.QuestionSetTitle, &e.Name, &e.Status, &e.OpenAt, &e.CloseAt, &e.DurationMinutes,
				&e.ClosePolicy, &e.LoginMode, &e.MaxAttempts, &e.ScorePolicy, &e.PassingScore, &e.ShowScoreImmediately, &e.ShowReview,
				&e.ShowExplanations, &e.ShuffleQuestions, &e.ShuffleOptions, &e.FreeNavigation, &e.RequireAllAnswered,
				&e.AnticheatEnabled, &e.LeaveToleranceSeconds, &e.PenaltyMode, &e.PenaltyValue, &e.PenaltyMax, &e.FlagThreshold,
				&e.AutoSubmitThreshold, &e.CameraEnabled, &e.CameraDenyPolicy, &e.QuotaSource, &e.PublishedAt, &e.CreatedAt, &token); err != nil {
				return err
			}
			if token != nil {
				e.Token = *token
			}
			rows = append(rows, e)
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []Exam{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// create: buat ujian draft dari paket soal (wajib sudah publish — punya published_version_id).
func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	var in examInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || in.QuestionSetID == "" {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "name dan question_set_id wajib"))
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	actor := httpx.ActorIDFrom(r.Context())
	openAt, err := parseTime(in.OpenAt)
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, err.Error()))
		return
	}
	closeAt, err := parseTime(in.CloseAt)
	if err != nil {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, err.Error()))
		return
	}
	var examID string
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var pubVer *string
		if err := tx.QueryRow(r.Context(),
			`SELECT published_version_id FROM question_sets WHERE tenant_id=$1 AND id=$2 AND status='published'`, tid, in.QuestionSetID).
			Scan(&pubVer); err != nil || pubVer == nil {
			return httpx.BadRequest(httpx.CodeValidation, "paket soal harus di-publish lebih dulu")
		}
		policies := map[string]string{"close_policy": "grace", "login_mode": "both", "score_policy": "highest", "penalty_mode": "points", "camera_deny_policy": "block"}
		getStr := func(v, def string) string {
			if v == "" {
				return policies[def] + "" + def // fallback
			}
			return v
		}
		_ = getStr
		cp := in.ClosePolicy
		if cp == "" {
			cp = "grace"
		}
		lm := in.LoginMode
		if lm == "" {
			lm = "both"
		}
		sp := in.ScorePolicy
		if sp == "" {
			sp = "highest"
		}
		pm := in.PenaltyMode
		if pm == "" {
			pm = "points"
		}
		cdp := in.CameraDenyPolicy
		if cdp == "" {
			cdp = "block"
		}
		showScore := boolPtr(in.ShowScoreImmediately, true)
		showReview := boolPtr(in.ShowReview, false)
		showExpl := boolPtr(in.ShowExplanations, false)
		shufQ := boolPtr(in.ShuffleQuestions, true)
		shufO := boolPtr(in.ShuffleOptions, true)
		freeNav := boolPtr(in.FreeNavigation, true)
		reqAll := boolPtr(in.RequireAllAnswered, false)
		anti := boolPtr(in.AnticheatEnabled, true)
		lt := intPtr(in.LeaveToleranceSeconds, 3)
		pv := floatPtr(in.PenaltyValue, 5)
		pmax := floatPtr(in.PenaltyMax, 30)
		cam := boolPtr(in.CameraEnabled, false)
		return tx.QueryRow(r.Context(),
			`INSERT INTO exams (tenant_id, question_set_id, set_version_id, name, status, open_at, close_at, duration_minutes, close_policy, login_mode, max_attempts, score_policy, passing_score, show_score_immediately, show_review, show_explanations, shuffle_questions, shuffle_options, free_navigation, require_all_answered, anticheat_enabled, leave_tolerance_seconds, penalty_mode, penalty_value, penalty_max, flag_threshold, auto_submit_threshold, camera_enabled, camera_deny_policy, created_by)
			 VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
			 RETURNING id`,
			tid, in.QuestionSetID, *pubVer, in.Name, openAt, closeAt, in.DurationMinutes, cp, lm, in.MaxAttempts, sp, in.PassingScore,
			showScore, showReview, showExpl, shufQ, shufO, freeNav, reqAll, anti, lt, pm, pv, pmax, in.FlagThreshold, in.AutoSubmitThreshold, cam, cdp, actor).
			Scan(&examID)
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	s.Audit.Log(r.Context(), s.DB.System, tid, "user", actor, "exam.create", "exam", examID, nil, "")
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": examID})
}

func boolPtr(v *bool, def bool) bool {
	if v == nil {
		return def
	}
	return *v
}
func intPtr(v *int, def int) int {
	if v == nil {
		return def
	}
	return *v
}
func floatPtr(v *float64, def float64) float64 {
	if v == nil {
		return def
	}
	return *v
}

func (s *Service) get(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var e Exam
	var token *string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		return tx.QueryRow(r.Context(),
			`SELECT e.id, e.question_set_id, qs.title, e.name, e.status, e.open_at, e.close_at, e.duration_minutes,
			   e.close_policy, e.login_mode, e.max_attempts, e.score_policy, e.passing_score, e.show_score_immediately,
			   e.show_review, e.show_explanations, e.shuffle_questions, e.shuffle_options, e.free_navigation, e.require_all_answered,
			   e.anticheat_enabled, e.leave_tolerance_seconds, e.penalty_mode, e.penalty_value, e.penalty_max, e.flag_threshold,
			   e.auto_submit_threshold, e.camera_enabled, e.camera_deny_policy, e.quota_source, e.published_at, e.created_at,
			   (SELECT t.token FROM exam_tokens t WHERE t.exam_id=e.id AND t.is_active=true AND t.room_id IS NULL LIMIT 1)
			FROM exams e JOIN question_sets qs ON qs.id=e.question_set_id WHERE e.tenant_id=$1 AND e.id=$2`, tid, id).
			Scan(&e.ID, &e.QuestionSetID, &e.QuestionSetTitle, &e.Name, &e.Status, &e.OpenAt, &e.CloseAt, &e.DurationMinutes,
				&e.ClosePolicy, &e.LoginMode, &e.MaxAttempts, &e.ScorePolicy, &e.PassingScore, &e.ShowScoreImmediately, &e.ShowReview,
				&e.ShowExplanations, &e.ShuffleQuestions, &e.ShuffleOptions, &e.FreeNavigation, &e.RequireAllAnswered,
				&e.AnticheatEnabled, &e.LeaveToleranceSeconds, &e.PenaltyMode, &e.PenaltyValue, &e.PenaltyMax, &e.FlagThreshold,
				&e.AutoSubmitThreshold, &e.CameraEnabled, &e.CameraDenyPolicy, &e.QuotaSource, &e.PublishedAt, &e.CreatedAt, &token)
	})
	if err != nil {
		httpx.WriteError(w, httpx.NotFound("ujian tidak ditemukan"))
		return
	}
	if token != nil {
		e.Token = *token
	}
	httpx.WriteJSON(w, http.StatusOK, e)
}

func (s *Service) update(w http.ResponseWriter, r *http.Request) {
	var in examInput
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	openAt, _ := parseTime(in.OpenAt)
	closeAt, _ := parseTime(in.CloseAt)
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE exams SET name=$1, open_at=$2, close_at=$3, duration_minutes=$4, close_policy=$5, login_mode=$6, max_attempts=$7,
			 score_policy=$8, passing_score=$9, show_score_immediately=$10, show_review=$11, show_explanations=$12,
			 shuffle_questions=$13, shuffle_options=$14, free_navigation=$15, require_all_answered=$16,
			 anticheat_enabled=$17, leave_tolerance_seconds=$18, penalty_mode=$19, penalty_value=$20, penalty_max=$21,
			 flag_threshold=$22, auto_submit_threshold=$23, camera_enabled=$24, camera_deny_policy=$25
			 WHERE tenant_id=$26 AND id=$27 AND status='draft'`,
			in.Name, openAt, closeAt, in.DurationMinutes, strOr(in.ClosePolicy, "grace"), strOr(in.LoginMode, "both"), in.MaxAttempts,
			strOr(in.ScorePolicy, "highest"), in.PassingScore, boolPtr(in.ShowScoreImmediately, true), boolPtr(in.ShowReview, false),
			boolPtr(in.ShowExplanations, false), boolPtr(in.ShuffleQuestions, true), boolPtr(in.ShuffleOptions, true),
			boolPtr(in.FreeNavigation, true), boolPtr(in.RequireAllAnswered, false), boolPtr(in.AnticheatEnabled, true),
			intPtr(in.LeaveToleranceSeconds, 3), strOr(in.PenaltyMode, "points"), floatPtr(in.PenaltyValue, 5), floatPtr(in.PenaltyMax, 30),
			in.FlagThreshold, in.AutoSubmitThreshold, boolPtr(in.CameraEnabled, false), strOr(in.CameraDenyPolicy, "block"),
			tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.BadRequest(httpx.CodeValidation, "ujian tidak ditemukan atau sudah dipublish")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "exam.update", "exam", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func strOr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func (s *Service) cancel(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE exams SET status='cancelled' WHERE tenant_id=$1 AND id=$2 AND status='draft'`, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.BadRequest(httpx.CodeValidation, "hanya ujian draft yang bisa dibatalkan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// publish: validasi kelengkapan → cek kuota (AC-7) → konsumsi kuota → status published + token + resolve peserta.
func (s *Service) publish(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())

	// gating kuota (AC-7)
	if s.Billing != nil {
		if err := s.Billing.EnsurePublishable(r.Context(), tid); err != nil {
			httpx.WriteError(w, err)
			return
		}
	}
	var source, refID string
	var err error
	// konsumsi kuota dulu (di luar tx ujian agar rapi), lalu update exam
	if s.Billing != nil {
		source, refID, err = s.Billing.ConsumeForPublish(r.Context(), tid, id)
		if err != nil {
			httpx.WriteError(w, err)
			return
		}
	}
	var token string
	err = s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var status string
		var openAt, closeAt *time.Time
		var dur *int
		var verID *string
		if err := tx.QueryRow(r.Context(),
			`SELECT status, open_at, close_at, duration_minutes, set_version_id FROM exams WHERE tenant_id=$1 AND id=$2`, tid, id).
			Scan(&status, &openAt, &closeAt, &dur, &verID); err != nil {
			return httpx.NotFound("ujian tidak ditemukan")
		}
		if status != "draft" {
			return httpx.Conflict("EXAM_NOT_DRAFT", "ujian sudah dipublish/ditutup")
		}
		if openAt == nil || closeAt == nil || dur == nil || verID == nil {
			return httpx.BadRequest(httpx.CodeValidation, "jadwal buka/tutup, durasi, dan paket soal (published) wajib diisi sebelum publish")
		}
		if !closeAt.After(*openAt) {
			return httpx.BadRequest(httpx.CodeValidation, "waktu tutup harus setelah waktu buka")
		}
		token = platform.RandomToken(6)
		if _, err := tx.Exec(r.Context(),
			`UPDATE exams SET status='published', published_at=now(), quota_source=$1, quota_ref_id=$2 WHERE tenant_id=$3 AND id=$4`,
			nullStr(source), nullAny(refID), tid, id); err != nil {
			return err
		}
		token = platform.RandomToken(6)
		for i := 0; i < 3; i++ {
			tag, terr := tx.Exec(r.Context(),
				`INSERT INTO exam_tokens (token, tenant_id, exam_id, is_active) VALUES ($1,$2,$3,true)
				 ON CONFLICT (token) DO NOTHING`, token, tid, id)
			if terr != nil {
				return terr
			}
			if tag.RowsAffected() == 1 {
				break // token unik terpasang (M-9: collision terdeteksi, bukan lolos diam-diam)
			}
			token = platform.RandomToken(6)
		}
		s.resolveParticipants(r.Context(), tx, tid, id)
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "exam.publish", "exam", id, map[string]any{"token": token, "quota_source": source}, "")
		return nil
	})
	if err != nil {
		// rollback konsumsi kuota bila publish gagal — refund ke sumber yang KITA konsumsi (H1)
		if s.Billing != nil && source != "" {
			_ = s.Billing.RefundForConsume(r.Context(), tid, source, refID)
		}
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "token": token, "quota_source": source, "ref_id": refID})
}

// resolveParticipants: penugasan kelas/siswa → exam_participants (FR-4.2/5.6).
func (s *Service) resolveParticipants(ctx context.Context, tx pgx.Tx, tenantID, examID string) {
	_, _ = tx.Exec(ctx,
		`INSERT INTO exam_participants (tenant_id, exam_id, student_id, source)
		 SELECT $1, $2, st.id, 'assignment' FROM exam_assignments a
		 JOIN students st ON (a.target_type='student' AND st.id=a.student_id)
		                 OR (a.target_type='class' AND st.class_id=a.class_id AND st.status='active' AND st.merged_into_id IS NULL)
		 WHERE a.tenant_id=$1 AND a.exam_id=$2
		 ON CONFLICT (exam_id, student_id) DO NOTHING`, tenantID, examID)
}

// unpublish: batalkan publish selama belum ada yang mengerjakan → kredit dikembalikan (PRD 3.2).
func (s *Service) unpublish(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		var used int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM attempts WHERE tenant_id=$1 AND exam_id=$2`, tid, id).Scan(&used); err != nil {
			return err
		}
		if used > 0 {
			return httpx.Conflict("ALREADY_STARTED", "sudah ada yang mengerjakan; tidak bisa unpublish")
		}
		// refund kuota dulu (dibaca dari quota_source/quota_ref_id), baru kolom di-null-kan — satu tx (K-2)
		if s.Billing != nil {
			if _, err := billing.RefundQuotaTx(r.Context(), tx, tid, id); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE exams SET status='draft', published_at=NULL, quota_source=NULL, quota_ref_id=NULL WHERE tenant_id=$1 AND id=$2 AND status='published'`, tid, id); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE exam_tokens SET is_active=false WHERE tenant_id=$1 AND exam_id=$2`, tid, id); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "exam.unpublish", "exam", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) regenerateToken(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	var token string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `UPDATE exam_tokens SET is_active=false WHERE tenant_id=$1 AND exam_id=$2`, tid, id); err != nil {
			return err
		}
		token = platform.RandomToken(6)
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO exam_tokens (token, tenant_id, exam_id, is_active) VALUES ($1,$2,$3,true)`, token, tid, id); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "exam.token_regenerate", "exam", id, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"token": token})
}

// setAssignments: ganti penugasan (kelas/siswa) — FR-4.2.
func (s *Service) setAssignments(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Classes   []string `json:"class_ids"`
		Students  []string `json:"student_ids"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `DELETE FROM exam_assignments WHERE tenant_id=$1 AND exam_id=$2`, tid, id); err != nil {
			return err
		}
		for _, cid := range in.Classes {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO exam_assignments (tenant_id, exam_id, target_type, class_id) VALUES ($1,$2,'class',$3) ON CONFLICT DO NOTHING`, tid, id, cid); err != nil {
				return err
			}
		}
		for _, sid := range in.Students {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO exam_assignments (tenant_id, exam_id, target_type, student_id) VALUES ($1,$2,'student',$3) ON CONFLICT DO NOTHING`, tid, id, sid); err != nil {
				return err
			}
		}
		s.resolveParticipants(r.Context(), tx, tid, id)
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "exam.assignments", "exam", id, map[string]any{"classes": len(in.Classes), "students": len(in.Students)}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) listParticipants(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT st.id, st.name, st.student_code, COALESCE(c.name,''), st.is_guest, ep.source, ep.extra_time_seconds,
			        (SELECT count(*) FROM attempts a WHERE a.exam_id=ep.exam_id AND a.student_id=ep.student_id)
			 FROM exam_participants ep JOIN students st ON st.id=ep.student_id LEFT JOIN classes c ON c.id=st.class_id
			 WHERE ep.tenant_id=$1 AND ep.exam_id=$2 ORDER BY c.name, st.name`, tid, id)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var sid, name, code, className, source string
			var guest bool
			var extra, attempts int
			if err := rws.Scan(&sid, &name, &code, &className, &guest, &source, &extra, &attempts); err != nil {
				return err
			}
			rows = append(rows, map[string]any{"student_id": sid, "name": name, "student_code": code, "class": className, "is_guest": guest, "source": source, "extra_time_seconds": extra, "attempts": attempts})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// extendTime: tambah waktu individu (FR-5.7) → deadline attempt aktif diperpanjang.
func (s *Service) extendTime(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Seconds int `json:"seconds"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "studentId")
	actor := httpx.ActorIDFrom(r.Context())
	if in.Seconds <= 0 {
		httpx.WriteError(w, httpx.BadRequest(httpx.CodeValidation, "seconds harus > 0"))
		return
	}
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(),
			`UPDATE exam_participants SET extra_time_seconds = extra_time_seconds + $1 WHERE tenant_id=$2 AND exam_id=$3 AND student_id=$4`,
			in.Seconds, tid, id, sid); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE attempts SET deadline_at = deadline_at + make_interval(secs => $1), extra_time_seconds = extra_time_seconds + $1
			 WHERE tenant_id=$2 AND exam_id=$3 AND student_id=$4 AND status='in_progress'`, in.Seconds, tid, id, sid); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "exam.extend_time", "attempt", sid, map[string]any{"seconds": in.Seconds}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// resetAttempt: batalkan attempt berjalan agar siswa bisa mengulang (FR-5.7).
func (s *Service) resetAttempt(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "studentId")
	actor := httpx.ActorIDFrom(r.Context())
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE attempts SET status='cancelled' WHERE tenant_id=$1 AND exam_id=$2 AND student_id=$3 AND status IN ('in_progress','pending_sync')`,
			tid, id, sid)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("tidak ada attempt aktif untuk direset")
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "attempt.reset", "attempt", sid, map[string]any{"exam": id}, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// forceSubmit: paksa selesai attempt berjalan (FR-5.7) — penilaian dijalankan.
func (s *Service) forceSubmit(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "studentId")
	actor := httpx.ActorIDFrom(r.Context())
	var attemptID string
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(),
			`SELECT id FROM attempts WHERE tenant_id=$1 AND exam_id=$2 AND student_id=$3 AND status IN ('in_progress','pending_sync') ORDER BY attempt_no DESC LIMIT 1`,
			tid, id, sid).Scan(&attemptID); err != nil {
			return httpx.NotFound("tidak ada attempt aktif")
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE attempts SET status='submitted', submit_reason='force', submitted_at=now() WHERE id=$1`, attemptID); err != nil {
			return err
		}
		s.Audit.Log(r.Context(), tx, tid, "user", actor, "attempt.force_submit", "attempt", attemptID, nil, "")
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	// nilai dihitung di luar tx oleh pemanggil (attempt.Service) — di sini cukup tandai; worker/endpoint lain menilai.
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "attempt_id": attemptID})
}

func (s *Service) pause(w http.ResponseWriter, r *http.Request) {
	s.setStatus(w, r, "paused")
}

func (s *Service) closeExam(w http.ResponseWriter, r *http.Request) {
	s.setStatus(w, r, "closed")
}

func (s *Service) setStatus(w http.ResponseWriter, r *http.Request, status string) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE exams SET status=$1 WHERE tenant_id=$2 AND id=$3 AND status='published'`, status, tid, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.Conflict("EXAM_NOT_PUBLISHED", "ujian tidak dalam status published")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "status": status})
}

// cheatingReport: daftar siswa yang ditandai + linimasa pelanggaran (FR-5.8C).
func (s *Service) cheatingReport(w http.ResponseWriter, r *http.Request) {
	tid := httpx.TenantIDFrom(r.Context())
	id := chi.URLParam(r, "id")
	var rows []map[string]any
	err := s.DB.WithTenantTx(r.Context(), tid, func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT a.id, st.name, st.student_code, a.violation_count, a.cheating_status, a.penalty_points, a.final_score, a.status,
			        (SELECT jsonb_agg(jsonb_build_object('type', v.type, 'started_at', v.started_at, 'duration_ms', v.duration_ms, 'counted', v.counted, 'penalty', v.penalty_applied) ORDER BY v.started_at)
			         FROM attempt_violations v WHERE v.attempt_id = a.id)
			 FROM attempts a JOIN students st ON st.id=a.student_id
			 WHERE a.tenant_id=$1 AND a.exam_id=$2 AND a.violation_count > 0
			 ORDER BY a.violation_count DESC`, tid, id)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var aid, name, code, chStatus, status string
			var vc int
			var penalty float64
			var final *float64
			var timeline []byte
			if err := rws.Scan(&aid, &name, &code, &vc, &chStatus, &penalty, &final, &status, &timeline); err != nil {
				return err
			}
			rows = append(rows, map[string]any{
				"attempt_id": aid, "name": name, "student_code": code, "violation_count": vc,
				"cheating_status": chStatus, "penalty_points": penalty, "final_score": final, "status": status,
				"violations": jsonRaw(timeline),
			})
		}
		return rws.Err()
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

func jsonRaw(b []byte) any {
	if len(b) == 0 {
		return []any{}
	}
	var v any
	if err := jsonUnmarshal(b, &v); err != nil {
		return []any{}
	}
	return v
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullAny(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var _ = fmt.Sprint
