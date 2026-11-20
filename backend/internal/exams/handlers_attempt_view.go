// handlers_attempt_view.go — GET paket attempt (tanpa kunci jawaban),
// hasil per soal (setelah rilis), dan riwayat pengerjaan siswa (FR-6.x, FR-5.4).
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

// ---------------------------------------------------------------------------
// GET /student/attempts/{attemptID} — paket + jawaban tersimpan + server_time
// ---------------------------------------------------------------------------

// packageQuestion satu soal untuk klien (TANPA answer_key/explanation).
type packageQuestion struct {
	ID             string          `json:"id"`
	OrderNo        int             `json:"order_no"`
	Type           string          `json:"type"`
	Stimulus       *stimulusView   `json:"stimulus,omitempty"`
	Body           string          `json:"body"`
	Options        json.RawMessage `json:"options"`
	Points         float64         `json:"points"`
	ShuffleOptions bool            `json:"shuffle_options"`
	Answered       bool            `json:"answered"`
	Flagged        bool            `json:"flagged"`
}

// stimulusView stimulus (AKM) untukinvisible di FE.
type stimulusView struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

// attemptView respons GET attempt.
type attemptView struct {
	Attempt        attemptMeta     `json:"attempt"`
	Package        packageView     `json:"package"`
	Answers        map[string]any  `json:"answers"`
	Flags          map[string]bool `json:"flags"`
	ServerTime     time.Time       `json:"server_time"`
	Rules          examRulesView   `json:"rules"`
	FreeNavigation bool            `json:"free_navigation"`
	RequireAll     bool            `json:"require_all_answered"`
}

// attemptMeta meta singkat attempt.
type attemptMeta struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	AttemptNo       int        `json:"attempt_no"`
	ExamID          string     `json:"exam_id"`
	ExamName        string     `json:"exam_name"`
	StartedAt       *time.Time `json:"started_at"`
	DeadlineAt      *time.Time `json:"deadline_at"`
	DurationMinutes int        `json:"duration_minutes"`
	PenaltyPoints   float64    `json:"penalty_points"`
	CheatingStatus  string     `json:"cheating_status"`
	ExamPaused      bool       `json:"exam_paused"`
}

// packageView isi paket.
type packageView struct {
	Questions      []packageQuestion `json:"questions"`
	ExplainVisible bool              `json:"explain_visible"`
}

func (m *Module) getAttempt(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	ctx := r.Context()

	var out attemptView
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// Kepemilikan: pemilik (student_id=SID) atau device_token cocok (guest
		// berganti perangkat disajikan data attempt sama, FR-6.5).
		a, err := loadAttemptOwned(ctx, tx, r, attemptID)
		if err != nil {
			return err
		}
		e, err := loadExam(ctx, tx, a.ExamID)
		if err != nil {
			return err
		}

		out.Attempt = attemptMeta{
			ID: a.ID, Status: a.Status, AttemptNo: a.AttemptNo, ExamID: e.ID,
			ExamName: e.Name, StartedAt: a.StartedAt, DeadlineAt: a.DeadlineAt,
			DurationMinutes: e.DurationMinutes, PenaltyPoints: a.PenaltyPoints,
			CheatingStatus: a.CheatingStatus, ExamPaused: e.Paused,
		}
		ac := e.antiCheat()
		out.Rules = examRulesView{
			AntiCheatEnabled: ac.Enabled, ToleranceSeconds: ac.ToleranceSeconds,
			PenaltyPoints: ac.PenaltyPoints, MaxPenalty: ac.MaxPenalty,
			FlagThreshold: ac.FlagThreshold, AutoSubmit: ac.AutoSubmit,
			CameraEnabled: ac.CameraEnabled, CameraRequired: ac.CameraMode == "wajib",
			SnapshotMinS: ac.SnapshotMinS, SnapshotMaxS: ac.SnapshotMaxS,
		}
		out.FreeNavigation = e.FreeNavigation
		out.RequireAll = e.RequireAllAnswered

		// Paket dari package_json (urutan stabil): soal dirakit helper bersama.
		qs, err := loadVersionQuestions(ctx, tx, e.QuestionSetVersionID)
		if err != nil {
			return err
		}
		byID := map[string]versionQuestion{}
		for _, q := range qs {
			byID[q.ID] = q
		}

		// Jawaban tersimpan (idempoten, sumber kebenaran server).
		answers := map[string]any{}
		flags := map[string]bool{}
		answerRows, err := tx.Query(ctx, `
			SELECT question_id::text, answer, flag_ragu FROM attempt_answers WHERE attempt_id=$1`, a.ID)
		if err != nil {
			return err
		}
		defer answerRows.Close()
		for answerRows.Next() {
			var qid string
			var answer any
			var flag bool
			if err := answerRows.Scan(&qid, &answer, &flag); err != nil {
				return err
			}
			answers[qid] = answer
			if flag {
				flags[qid] = true
			}
		}
		if err := answerRows.Err(); err != nil {
			return err
		}

		out.Answers = answers
		out.Flags = flags
		out.Package.Questions = []packageQuestion{}
		out.Package.ExplainVisible = a.Status == "submitted" || a.Status == "graded" || a.Status == "expired"
		out.Package.Questions, err = assembleQuestions(ctx, tx, a, e, qs)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	out.ServerTime = nowTS()
	httpx.OK(w, map[string]any{"data": out})
}

// assembleQuestions rakit daftar packageQuestion (urutan package_json,
// opsi terkunci, stimulus) — dipakai getAttempt & start package.
func assembleQuestions(ctx context.Context, tx pgx.Tx, a *attemptRecord,
	e *examRecord, qs []versionQuestion) ([]packageQuestion, error) {
	var answers map[string]any
	var flags map[string]bool
	anRows, err := tx.Query(ctx, `SELECT question_id::text, answer, flag_ragu FROM attempt_answers WHERE attempt_id=$1`, a.ID)
	if err != nil {
		return nil, err
	}
	defer anRows.Close()
	answers = map[string]any{}
	flags = map[string]bool{}
	for anRows.Next() {
		var qid string
		var answer any
		var flag bool
		if err := anRows.Scan(&qid, &answer, &flag); err != nil {
			return nil, err
		}
		answers[qid] = answer
		if flag {
			flags[qid] = true
		}
	}
	if err := anRows.Err(); err != nil {
		return nil, err
	}

	var pkg attemptPackage
	_ = json.Unmarshal([]byte(a.PackageJSON), &pkg)
	byID := map[string]versionQuestion{}
	for _, q := range qs {
		byID[q.ID] = q
	}
	stim, err := loadStimuli(ctx, tx, e.QuestionSetVersionID)
	if err != nil {
		return nil, err
	}
	order := pkg.Order
	if len(order) == 0 {
		for _, qq := range qs {
			order = append(order, qq.ID)
		}
	}
	out := []packageQuestion{}
	for orderNo, qid := range order {
		q, ok := byID[qid]
		if !ok {
			continue
		}
		pq := packageQuestion{
			ID: q.ID, OrderNo: orderNo + 1, Type: q.Type, Body: q.Body,
			Options: q.Options, Points: q.Points, ShuffleOptions: q.ShuffleOpts,
			Answered: answers[qid] != nil && string(serializeAnswer(answers[qid])) != "null",
			Flagged:  flags[qid],
		}
		if ids, okO := pkg.OptionsOrder[qid]; okO && len(ids) > 0 {
			pq.Options = reorderOptions(q.Options, ids)
		}
		if q.StimulusID != nil {
			if s, okS := stim[*q.StimulusID]; okS {
				pq.Stimulus = &stimulusView{ID: s.ID, Title: s.Title, Content: s.Content}
			}
		}
		out = append(out, pq)
	}
	return out, nil
}

// loadAttemptOwned cek kepemilikan attempt oleh siswa pemanggil (atau device
// cookie yang sama — resume lintas reload). Bukan pemilik → 404 (AC-9).
func loadAttemptOwned(ctx context.Context, tx pgx.Tx, r *http.Request, attemptID string) (*attemptRecord, error) {
	a, err := loadAttempt(ctx, tx, attemptID)
	if err != nil {
		return nil, err
	}
	sid := ctxinfo.StudentID(r.Context())
	if sid != "" && a.StudentID == sid {
		return a, nil
	}
	// Fallback perangkat: cookie fdev sama dengan device_token attempt.
	if c, cerr := r.Cookie(deviceCookieName); cerr == nil && c.Value != "" && a.DeviceToken == c.Value {
		return a, nil
	}
	return nil, httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Attempt tidak ditemukan")
}

// loadStimuli stimulus per versi (untuk tampilan AKM).
func loadStimuli(ctx context.Context, tx pgx.Tx, versionID string) (map[string]stimulusView, error) {
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT st.id::text, st.title, st.content
		FROM stimuli st
		JOIN questions q ON q.stimulus_id = st.id
		WHERE q.set_version_id=$1`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]stimulusView{}
	for rows.Next() {
		var id string
		var s stimulusView
		if err := rows.Scan(&id, &s.Title, &s.Content); err != nil {
			return nil, err
		}
		s.ID = id
		out[id] = s
	}
	return out, rows.Err()
}

// reorderOptions susun ulang opsi [{id,text}] sesuai ids terkunci.
func reorderOptions(raw json.RawMessage, ids []string) json.RawMessage {
	var opts []map[string]any
	if err := json.Unmarshal(raw, &opts); err != nil {
		return raw
	}
	byID := map[string]map[string]any{}
	for _, o := range opts {
		if id, ok := o["id"].(string); ok {
			byID[id] = o
		}
	}
	out := make([]map[string]any, 0, len(opts))
	for _, id := range ids {
		if o, ok := byID[id]; ok {
			out = append(out, o)
		}
	}
	if len(out) != len(opts) {
		return raw
	}
	b, err := json.Marshal(out)
	if err != nil {
		return raw
	}
	return b
}

// serializeAnswer normalisasi jawaban ke JSON bytes.
func serializeAnswer(v any) json.RawMessage {
	switch t := v.(type) {
	case json.RawMessage:
		return t
	case []byte:
		return json.RawMessage(t)
	default:
		b, _ := json.Marshal(v)
		return b
	}
}

// ---------------------------------------------------------------------------
// GET /student/attempts/{attemptID}/result — hasil per soal (FR-5.4)
// ---------------------------------------------------------------------------

// resultQuestion satu soal dalam hasil.
type resultQuestion struct {
	QuestionID  string          `json:"question_id"`
	IsCorrect   *bool           `json:"is_correct"` // null = menunggu guru
	Score       float64         `json:"score"`
	MaxPoints   float64         `json:"max_points"`
	Explanation string          `json:"explanation,omitempty"` // hanya bila show_explanation
	YourAnswer  json.RawMessage `json:"your_answer"`
}

// attemptResult hasil attempt (setelah rilis nilai).
type attemptResult struct {
	Score             *float64         `json:"score"`
	FinalScore        *float64         `json:"final_score"`
	PenaltyPoints     float64          `json:"penalty_points"`
	Status            string           `json:"status"`
	FinalScorePending bool             `json:"final_score_pending"`
	PerQuestion       []resultQuestion `json:"per_question"`
	ViolationsCount   int              `json:"violations_count"`
}

func (m *Module) getResult(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	attemptID, err := urlUUID(r, "attemptID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	ctx := r.Context()
	var out attemptResult
	err = m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		a, err := loadAttemptOwned(ctx, tx, r, attemptID)
		if err != nil {
			return err
		}
		e, err := loadExam(ctx, tx, a.ExamID)
		if err != nil {
			return err
		}
		// Belum rilis → 403 SCORE_HIDDEN (FR-5.4).
		if !e.ScoreReleased {
			return httpx.NewErr(http.StatusForbidden, "SCORE_HIDDEN",
				"Nilai belum dirilis guru")
		}

		out = attemptResult{
			Status: a.Status, PenaltyPoints: a.PenaltyPoints,
			PerQuestion: []resultQuestion{},
		}
		if a.Status == "submitted" || a.Status == "graded" {
			score := a.Score
			final := a.FinalScore
			out.Score = &score
			out.FinalScore = &final
		}

		// Ada uraian yang belum dinilai guru → pending (FR-8.2).
		out.FinalScorePending = hasUngradedEssay(ctx, tx, a.ID)

		// Per soal (urutan versi).
		qs, err := loadVersionQuestions(ctx, tx, e.QuestionSetVersionID)
		if err != nil {
			return err
		}
		ansRows, err := tx.Query(ctx, `
			SELECT question_id::text, COALESCE(is_correct::int,-1), score::float8, answer
			FROM attempt_answers WHERE attempt_id=$1`, a.ID)
		if err != nil {
			return err
		}
		defer ansRows.Close()
		ansBy := map[string]struct {
			correct int
			score   float64
			answer  json.RawMessage
		}{}
		for ansRows.Next() {
			var qid string
			var row struct {
				correct int
				score   float64
				answer  json.RawMessage
			}
			if err := ansRows.Scan(&qid, &row.correct, &row.score, &row.answer); err != nil {
				return err
			}
			ansBy[qid] = row
		}
		if err := ansRows.Err(); err != nil {
			return err
		}
		for _, q := range qs {
			rq := resultQuestion{QuestionID: q.ID, MaxPoints: q.Points}
			if row, ok := ansBy[q.ID]; ok {
				rq.Score = row.score
				rq.YourAnswer = row.answer
				if row.correct == 1 {
					t := true
					rq.IsCorrect = &t
				} else if row.correct == 0 {
					f := false
					rq.IsCorrect = &f
				} // -1 → null (menunggu manual)
			}
			if e.ShowExplanation {
				rq.Explanation = q.Explanation
			}
			out.PerQuestion = append(out.PerQuestion, rq)
		}
		return tx.QueryRow(ctx,
			`SELECT COUNT(1) FROM attempt_violations WHERE attempt_id=$1 AND cancelled=false`, a.ID).
			Scan(&out.ViolationsCount)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

// ---------------------------------------------------------------------------
// GET /student/me/history — riwayat ujian siswa (FR-6.4)
// ---------------------------------------------------------------------------

// historyItem satu baris riwayat.
type historyItem struct {
	ExamID          string     `json:"exam_id"`
	ExamName        string     `json:"exam_name"`
	Subject         string     `json:"subject"`
	AttemptNo       int        `json:"attempt_no"`
	StartedAt       *time.Time `json:"started_at"`
	SubmittedAt     *time.Time `json:"submitted_at"`
	DurationSeconds *int64     `json:"duration_seconds"`
	Score           *float64   `json:"score"`
	FinalScore      *float64   `json:"final_score"`
	Status          string     `json:"status_attempt"`
	CheatingStatus  string     `json:"cheating_status"`
}

const myHistorySQL = `
SELECT a.exam_id::text, e.name, e.subject_name, a.attempt_no, a.started_at,
	a.submitted_at, a.score::float8, a.final_score::float8, a.status,
	a.cheating_status, e.score_released
FROM attempts a
JOIN exams e ON e.id = a.exam_id
WHERE a.student_id=$1
ORDER BY a.started_at DESC NULLS LAST, a.created_at DESC
LIMIT 200`

func (m *Module) myHistory(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	sid := ctxinfo.StudentID(r.Context())
	if sid == "" {
		httpx.Error(w, httpx.ErrUnauthorized)
		return
	}
	items := []historyItem{}
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), myHistorySQL, sid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it historyItem
			var released bool
			var score, final *float64
			if err := rows.Scan(&it.ExamID, &it.ExamName, &it.Subject, &it.AttemptNo,
				&it.StartedAt, &it.SubmittedAt, &score, &final, &it.Status,
				&it.CheatingStatus, &released); err != nil {
				return err
			}
			if it.StartedAt != nil && it.SubmittedAt != nil {
				d := int64(it.SubmittedAt.Sub(*it.StartedAt).Seconds())
				it.DurationSeconds = &d
			}
			if released {
				it.Score = score
				it.FinalScore = final
			}
			items = append(items, it)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": items})
}
