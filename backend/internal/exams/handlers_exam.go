// handlers_exam.go — endpoint staf untuk kelola ujian (PRD M5, FR-5.1..5.5):
// daftar/buat/ubah/hapus, publish + kuota billing, unpublish + refund kredit,
// regenerasi token, penugasan peserta, dan rilis nilai.
package exams

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---- Bentuk respons staf ----

// examCounts hitungan peserta per ujian (subquery list & detail).
type examCounts struct {
	Participants int `json:"participants"`
	InProgress   int `json:"in_progress"`
	Submitted    int `json:"submitted"`
}

// examListItem item GET /exams.
type examListItem struct {
	ID                   string     `json:"id"`
	QuestionSetID        string     `json:"question_set_id"`
	Name                 string     `json:"name"`
	SubjectName          string     `json:"subject_name"`
	ExamCode             string     `json:"exam_code"`
	Token                string     `json:"token"`
	Status               string     `json:"status"`
	Paused               bool       `json:"paused"`
	OpenAt               time.Time  `json:"open_at"`
	CloseAt              time.Time  `json:"close_at"`
	DurationMinutes      int        `json:"duration_minutes"`
	MaxAttempts          int        `json:"max_attempts"`
	ShowScoreImmediately bool       `json:"show_score_immediately"`
	ScoreReleased        bool       `json:"score_released"`
	CreatedAt            time.Time  `json:"created_at"`
	Counts               examCounts `json:"counts"`
}

// examDetail GET /exams/{examID}: ujian + anti_cheat + penugasan + set soal.
type examDetail struct {
	examListItem
	TokenActive          bool            `json:"token_active"`
	TimeStyle            string          `json:"time_style"`
	ScorePolicy          string          `json:"score_policy"`
	ShowExplanation      bool            `json:"show_explanation"`
	ShuffleQuestions     bool            `json:"shuffle_questions"`
	ShuffleOptions       bool            `json:"shuffle_options"`
	FreeNavigation       bool            `json:"free_navigation"`
	RequireAllAnswered   bool            `json:"require_all_answered"`
	LoginMode            string          `json:"login_mode"`
	GuestNisRequired     bool            `json:"guest_nis_required"`
	PassingScore         *float64        `json:"passing_score"`
	AntiCheat            AntiCheat       `json:"anti_cheat"`
	QuestionSetVersionID string          `json:"question_set_version_id"`
	UpdatedAt            time.Time       `json:"updated_at"`
	Assignments          assignmentsOut  `json:"assignments"`
	QuestionSet          questionSetInfo `json:"question_set"`
}

// assignmentsOut hasil REPLACE penugasan.
type assignmentsOut struct {
	ClassIDs   []string `json:"class_ids"`
	StudentIDs []string `json:"student_ids"`
}

// questionSetInfo ringkasan paket soal terhubung.
type questionSetInfo struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	SubjectName    string `json:"subject_name"`
	ExamCode       string `json:"exam_code"`
	CurrentVersion int    `json:"current_version"`
	Status         string `json:"status"`
}

// listExamsSQL kolom eksplisit untuk daftar ujian (+hitungan peserta).
const listExamsSQL = `
SELECT e.id::text, e.question_set_id::text, e.name, e.subject_name, e.exam_code,
	e.token, e.status, e.paused, e.open_at, e.close_at, e.duration_minutes,
	e.max_attempts, e.show_score_immediately, e.score_released, e.created_at,
	` + participantsCountSQL + ` AS c_participants,
	(SELECT COUNT(1) FROM attempts a WHERE a.exam_id=e.id AND a.status='in_progress')  AS c_progress,
	(SELECT COUNT(DISTINCT a.student_id) FROM attempts a
		WHERE a.exam_id=e.id AND a.status IN ('submitted','graded','pending_sync'))      AS c_submitted
FROM exams e
`

// participantsCountSQL: jumlah peserta ditugaskan; assignment kosong =
// semua siswa aktif tenant (PIN disepakati, konsisten dgn modul reports).
const participantsCountSQL = `CASE WHEN
	(SELECT COUNT(1) FROM exam_assignments ea WHERE ea.exam_id=e.id) > 0 THEN
	(SELECT COUNT(DISTINCT s.id) FROM students s WHERE s.status='active' AND (
		EXISTS (SELECT 1 FROM exam_assignments ea2 WHERE ea2.exam_id=e.id AND ea2.target_type='student' AND ea2.student_id=s.id)
		OR s.class_id IN (SELECT ea3.class_id FROM exam_assignments ea3 WHERE ea3.exam_id=e.id AND ea3.target_type='class')))
	ELSE (SELECT COUNT(1) FROM students s2 WHERE s2.status='active') END`

// ---------------------------------------------------------------------------
// GET /exams?status=&q=&limit=&cursor=
// ---------------------------------------------------------------------------

func (m *Module) listExams(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	limit := parseLimitStr(r.URL.Query().Get("limit"), 20, 100)

	conds := []string{"1=1"}
	args := []any{}
	add := func(cond string, v ...any) {
		for _, a := range v {
			args = append(args, a)
			cond = strings.Replace(cond, "?", "$"+strconv.Itoa(len(args)), 1)
		}
		conds = append(conds, cond)
	}
	if st := strings.TrimSpace(r.URL.Query().Get("status")); st != "" {
		if st != "draft" && st != "published" && st != "archived" {
			httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST",
				"Parameter status tidak valid (draft|published|archived)"))
			return
		}
		add("e.status = ?", st)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		add("(e.name ILIKE '%'||?||'%' OR e.exam_code ILIKE '%'||?||'%' OR e.subject_name ILIKE '%'||?||'%')", q, q, q)
	}
	if cur := strings.TrimSpace(r.URL.Query().Get("cursor")); cur != "" {
		ca, id, err := decodeExamCursor(cur)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		args = append(args, ca, id)
		conds = append(conds, `(e.created_at, e.id) < ($`+strconv.Itoa(len(args)-1)+`::timestamptz, $`+strconv.Itoa(len(args))+`::uuid)`)
	}

	query := listExamsSQL + " WHERE " + strings.Join(conds, " AND ") +
		" ORDER BY e.created_at DESC, e.id DESC LIMIT " + strconv.Itoa(limit+1)

	items := []examListItem{}
	next := ""
	hasMore := false
	err := m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			it, err := scanExamListItem(rows)
			if err != nil {
				return err
			}
			items = append(items, *it)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if len(items) > limit {
		items = items[:limit]
		hasMore = true
	}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		next = encodeExamCursor(last.CreatedAt, last.ID)
	}
	httpx.OK(w, map[string]any{"data": items, "meta": map[string]any{
		"limit": limit, "next_cursor": next}})
}

// scanExamListItem memindai baris list (exam + counts).
func scanExamListItem(rows pgx.Rows) (*examListItem, error) {
	var it examListItem
	var participants int
	err := rows.Scan(&it.ID, &it.QuestionSetID, &it.Name, &it.SubjectName,
		&it.ExamCode, &it.Token, &it.Status, &it.Paused, &it.OpenAt, &it.CloseAt,
		&it.DurationMinutes, &it.MaxAttempts, &it.ShowScoreImmediately,
		&it.ScoreReleased, &it.CreatedAt, &participants, &it.Counts.InProgress,
		&it.Counts.Submitted)
	if err != nil {
		return nil, err
	}
	it.Counts.Participants = participants
	return &it, nil
}

// ---- cursor keyset (created_at, id) berbasis base64url ----

func encodeExamCursor(ca time.Time, id string) string {
	b, _ := json.Marshal(map[string]string{"ca": ca.UTC().Format(time.RFC3339Nano), "id": id})
	e := base64.RawURLEncoding.EncodeToString(b)
	return e
}

func decodeExamCursor(s string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, "", httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter cursor tidak valid")
	}
	var c struct {
		CA string `json:"ca"`
		ID string `json:"id"`
	}
	if err := json.Unmarshal(b, &c); err != nil || c.ID == "" {
		return time.Time{}, "", httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter cursor tidak valid")
	}
	ca, err := time.Parse(time.RFC3339Nano, c.CA)
	if err != nil {
		return time.Time{}, "", httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter cursor tidak valid")
	}
	return ca, c.ID, nil
}

// parseLimitStr limit query param dengan default & batas atas.
func parseLimitStr(s string, def, max int) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// ---------------------------------------------------------------------------
// POST /exams
// ---------------------------------------------------------------------------

func (m *Module) createExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	var req saveExamReq
	if !m.decode(w, r, &req) {
		return
	}
	openAt, closeAt, err := parseWindow(req.OpenAt, req.CloseAt)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if req.LoginMode != "account" && req.LoginMode != "guest" && req.LoginMode != "both" {
		req.LoginMode = "both"
	}
	if req.ScorePolicy != "highest" && req.ScorePolicy != "last" && req.ScorePolicy != "avg" {
		req.ScorePolicy = "highest"
	}
	if req.TimeStyle != "grace" && req.TimeStyle != "hard_close" {
		req.TimeStyle = "grace"
	}
	maxAttempts := 1
	if req.MaxAttempts != nil && *req.MaxAttempts >= 1 {
		maxAttempts = *req.MaxAttempts
	}
	showScore := true
	if req.ShowScoreImmediately != nil {
		showScore = *req.ShowScoreImmediately
	}
	freeNav := true
	if req.FreeNavigation != nil {
		freeNav = *req.FreeNavigation
	}
	ac := req.AntiCheat.toAntiCheat()

	var out examDetail
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		// Salin subject_name & exam_code dari question set (FR-5.1).
		_, subject, examCode, _, err := loadQuestionSetInfo(r.Context(), tx, req.QuestionSetID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Paket soal tidak ditemukan")
			}
			return err
		}
		token, err := uniqueToken(r.Context(), tx)
		if err != nil {
			return err
		}
		acJSON, _ := json.Marshal(ac)
		var passing any
		if req.PassingScore != nil {
			passing = *req.PassingScore
		}
		newID := ""
		err = tx.QueryRow(r.Context(), `
			INSERT INTO exams(tenant_id, question_set_id, name, subject_name, exam_code, token,
				open_at, close_at, duration_minutes, time_style, max_attempts, score_policy,
				show_score_immediately, show_explanation, shuffle_questions, shuffle_options,
				free_navigation, require_all_answered, login_mode, guest_nis_required,
				passing_score, anti_cheat, status, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'draft',$23)
			RETURNING id::text`,
			tenantID, req.QuestionSetID, req.Name, subject, examCode, token,
			openAt, closeAt, req.DurationMinutes, req.TimeStyle, maxAttempts, req.ScorePolicy,
			showScore, req.ShowExplanation, req.ShuffleQuestions, req.ShuffleOptions,
			freeNav, req.RequireAllAnswered, req.LoginMode, req.GuestNisRequired,
			passing, acJSON, ctxinfo.UserID(r.Context())).Scan(&newID)
		if err != nil {
			return examDBError(err)
		}
		if err := audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"exam_create", "exam", newID, map[string]any{"name": req.Name}); err != nil {
			return err
		}
		out.ID = newID
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Respons detail ringkas: baca ulang lewat loader agar konsisten.
	if err := m.fillExamDetail(r, tenantID, out.ID, &out); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.Created(w, map[string]any{"data": out})
}

// examDBError terjemahan constraint DB → error API ramah.
func examDBError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			if strings.Contains(pgErr.ConstraintName, "code") {
				return httpx.NewErr(http.StatusConflict, "EXAM_CODE_TAKEN",
					"Kode ujian sudah dipakai (satu paket soal = satu ujian)")
			}
			if strings.Contains(pgErr.ConstraintName, "token") {
				return httpx.NewErr(http.StatusConflict, "TOKEN_TAKEN", "Token bentrok, coba lagi")
			}
		case "23503":
			return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Data rujukan tidak ditemukan")
		}
	}
	return err
}

// fillExamDetail baca ulang ujian lengkap (dipakai create & update).
func (m *Module) fillExamDetail(r *http.Request, tenantID, examID string, dst *examDetail) error {
	return m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		dst.examListItem = examListItem{
			ID: e.ID, QuestionSetID: e.QuestionSetID, Name: e.Name,
			SubjectName: e.SubjectName, ExamCode: e.ExamCode, Token: e.Token,
			Status: e.Status, Paused: e.Paused, OpenAt: e.OpenAt, CloseAt: e.CloseAt,
			DurationMinutes: e.DurationMinutes, MaxAttempts: e.MaxAttempts,
			ShowScoreImmediately: e.ShowScoreImmediately, ScoreReleased: e.ScoreReleased,
			CreatedAt: e.CreatedAt,
		}
		dst.TokenActive = e.TokenActive
		dst.TimeStyle = e.TimeStyle
		dst.ScorePolicy = e.ScorePolicy
		dst.ShowExplanation = e.ShowExplanation
		dst.ShuffleQuestions = e.ShuffleQuestions
		dst.ShuffleOptions = e.ShuffleOptions
		dst.FreeNavigation = e.FreeNavigation
		dst.RequireAllAnswered = e.RequireAllAnswered
		dst.LoginMode = e.LoginMode
		dst.GuestNisRequired = e.GuestNisRequired
		dst.PassingScore = nil
		if e.PassingScore > 0 {
			v := e.PassingScore
			dst.PassingScore = &v
		}
		dst.AntiCheat = e.antiCheat()
		dst.QuestionSetVersionID = e.QuestionSetVersionID
		dst.UpdatedAt = e.UpdatedAt
		dst.Assignments, err = loadAssignments(r.Context(), tx, e.ID)
		if err != nil {
			return err
		}
		title, subject, examCode, curVer, err := loadQuestionSetInfo(r.Context(), tx, e.QuestionSetID)
		if err != nil {
			return err
		}
		var qsStatus string
		if err := tx.QueryRow(r.Context(), `SELECT status FROM question_sets WHERE id=$1`, e.QuestionSetID).Scan(&qsStatus); err != nil {
			return err
		}
		dst.QuestionSet = questionSetInfo{ID: e.QuestionSetID, Title: title,
			SubjectName: subject, ExamCode: examCode, CurrentVersion: curVer, Status: qsStatus}
		return m.fillCounts(r.Context(), tx, e.ID, &dst.Counts)
	})
}

// (helper placeholder antiCheatTimeStyle/scorePolicy sudah dihapus —
// field TimeStyle/ScorePolicy kini dibaca langsung dari examRecord.)

// ---------------------------------------------------------------------------
// GET /exams/{examID}
// ---------------------------------------------------------------------------

func (m *Module) getExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var out examDetail
	if err := m.fillExamDetail(r, tenantID, examID, &out); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

// loadAssignments baca penugasan (kelas ∪ siswa).
func loadAssignments(ctx context.Context, tx pgx.Tx, examID string) (assignmentsOut, error) {
	var out assignmentsOut
	out.ClassIDs = []string{}
	out.StudentIDs = []string{}
	rows, err := tx.Query(ctx, `
		SELECT target_type, COALESCE(class_id::text,''), COALESCE(student_id::text,'')
		FROM exam_assignments WHERE exam_id=$1 ORDER BY class_id NULLS LAST, student_id NULLS LAST`, examID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var typ, cid, sid string
		if err := rows.Scan(&typ, &cid, &sid); err != nil {
			return out, err
		}
		if typ == "class" {
			out.ClassIDs = append(out.ClassIDs, cid)
		} else {
			out.StudentIDs = append(out.StudentIDs, sid)
		}
	}
	return out, rows.Err()
}

// fillCounts hitung peserta/berjalan/selesai untuk satu ujian.
// participantsCountSQL merujuk alias e (exams) → FROM exams e wajib ada.
func (m *Module) fillCounts(ctx context.Context, tx pgx.Tx, examID string, c *examCounts) error {
	return tx.QueryRow(ctx, `
		SELECT
			`+participantsCountSQL+`,
			(SELECT COUNT(1) FROM attempts a WHERE a.exam_id=e.id AND a.status='in_progress'),
			(SELECT COUNT(DISTINCT a.student_id) FROM attempts a
				WHERE a.exam_id=e.id AND a.status IN ('submitted','graded','pending_sync'))
		FROM exams e WHERE e.id=$1`,
		examID).Scan(&c.Participants, &c.InProgress, &c.Submitted)
}

// ---------------------------------------------------------------------------
// PUT /exams/{examID}
// ---------------------------------------------------------------------------

func (m *Module) updateExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req saveExamReq
	if !m.decode(w, r, &req) {
		return
	}
	openAt, closeAt, err := parseWindow(req.OpenAt, req.CloseAt)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if req.LoginMode != "account" && req.LoginMode != "guest" && req.LoginMode != "both" {
		req.LoginMode = "both"
	}
	if req.ScorePolicy != "highest" && req.ScorePolicy != "last" && req.ScorePolicy != "avg" {
		req.ScorePolicy = "highest"
	}
	if req.TimeStyle != "grace" && req.TimeStyle != "hard_close" {
		req.TimeStyle = "grace"
	}
	maxAttempts := 1
	if req.MaxAttempts != nil && *req.MaxAttempts >= 1 {
		maxAttempts = *req.MaxAttempts
	}
	showScore := true
	if req.ShowScoreImmediately != nil {
		showScore = *req.ShowScoreImmediately
	}
	freeNav := true
	if req.FreeNavigation != nil {
		freeNav = *req.FreeNavigation
	}
	ac := req.AntiCheat.toAntiCheat()
	acJSON, _ := json.Marshal(ac)
	var passing any
	if req.PassingScore != nil {
		passing = *req.PassingScore
	}

	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		// soal tidak boleh diganti setelah ada attempt / sudah publish (409).
		if req.QuestionSetID != e.QuestionSetID {
			var attempts int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM attempts WHERE exam_id=$1`, examID).Scan(&attempts); err != nil {
				return err
			}
			if attempts > 0 || e.Status != "draft" {
				return httpx.NewErr(http.StatusConflict, "QUESTION_SET_LOCKED",
					"Paket soal tidak dapat digunakan karena ujian sudah dikerjakan/terbit")
			}
		}
		// Validasi paket soal tujuan ada (tenant-scoped).
		if _, _, _, _, err := loadQuestionSetInfo(r.Context(), tx, req.QuestionSetID); err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Paket soal tidak ditemukan")
			}
			return err
		}
		tag, err := tx.Exec(r.Context(), `
			UPDATE exams SET question_set_id=$2, name=$3, open_at=$4, close_at=$5,
				duration_minutes=$6, time_style=$7, max_attempts=$8, score_policy=$9,
				show_score_immediately=$10, show_explanation=$11, shuffle_questions=$12,
				shuffle_options=$13, free_navigation=$14, require_all_answered=$15,
				login_mode=$16, guest_nis_required=$17, passing_score=$18, anti_cheat=$19,
				updated_at=now()
			WHERE id=$1`,
			examID, req.QuestionSetID, req.Name, openAt, closeAt,
			req.DurationMinutes, req.TimeStyle, maxAttempts, req.ScorePolicy,
			showScore, req.ShowExplanation, req.ShuffleQuestions, req.ShuffleOptions,
			freeNav, req.RequireAllAnswered, req.LoginMode, req.GuestNisRequired,
			passing, acJSON)
		if err != nil {
			return examDBError(err)
		}
		if tag.RowsAffected() == 0 {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"exam_update", "exam", examID, map[string]any{"name": req.Name})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var out examDetail
	if err := m.fillExamDetail(r, tenantID, examID, &out); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

// ---------------------------------------------------------------------------
// DELETE /exams/{examID} — draft+tanpa attempt: hard delete; published tanpa
// attempt: archive; ada attempt: 409.
// ---------------------------------------------------------------------------

func (m *Module) deleteExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	archived := false
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		var attempts int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(1) FROM attempts WHERE exam_id=$1`, examID).Scan(&attempts); err != nil {
			return err
		}
		if attempts > 0 {
			return httpx.NewErr(http.StatusConflict, "EXAM_IN_USE",
				"Ujian sudah memiliki riwayat pengerjaan dan tidak dapat dihapus")
		}
		if e.Status == "draft" {
			if _, err := tx.Exec(r.Context(), `DELETE FROM exams WHERE id=$1`, examID); err != nil {
				return err
			}
		} else {
			archived = true
			if _, err := tx.Exec(r.Context(),
				`UPDATE exams SET status='archived', updated_at=now() WHERE id=$1`, examID); err != nil {
				return err
			}
		}
		action := "exam_delete"
		if archived {
			action = "exam_archive"
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()), action, "exam", examID, nil)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	msg := map[string]any{"deleted": !archived}
	if archived {
		msg["status"] = "archived"
	}
	httpx.OK(w, map[string]any{"data": msg})
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/publish — urutan AC-7:
//  1. ujian draft & assignment terisi (bila login_mode != guest)
//  2. paket soal punya versi publish → kunci question_set_version_id
//  3. kuota billing (trial=1 ujian aktif; monthly=ok; per_exam=kredit)
//     Semua perubahan exams dilakukan dalam tx (tenant atau admin utk kredit).
// ---------------------------------------------------------------------------

func (m *Module) publishExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}

	// (1)&(2) validasi tenant-scoped dalam satu tx tenant.
	var versionID string
	var showScore bool
	var creditsExamID *string
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		if e.Status == "published" {
			return httpx.NewErr(http.StatusConflict, "ALREADY_PUBLISHED", "Ujian sudah terbit")
		}
		if e.Status != "draft" {
			return httpx.NewErr(http.StatusBadRequest, "NOT_DRAFT", "Hanya ujian draft yang dapat diterbitkan")
		}
		showScore = e.ShowScoreImmediately

		if e.LoginMode != "guest" {
			var assigned int
			if err := tx.QueryRow(r.Context(),
				`SELECT COUNT(1) FROM exam_assignments WHERE exam_id=$1`, examID).Scan(&assigned); err != nil {
				return err
			}
			if assigned == 0 {
				return httpx.NewErr(http.StatusBadRequest, "ASSIGNMENT_EMPTY",
					"Ujian belum memiliki peserta. Tetapkan kelas/siswa terlebih dahulu")
			}
		}
		err = tx.QueryRow(r.Context(), `
			SELECT id::text FROM question_set_versions
			WHERE question_set_id=$1 ORDER BY version DESC LIMIT 1`, e.QuestionSetID).Scan(&versionID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusBadRequest, "NEEDS_PUBLISH",
					"Paket soal belum dipublikasikan; terbitkan paket soal dulu")
			}
			return err
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}

	// (3) kuota lewat modul billing (pool admin internal).
	dec, err := m.billing.CheckExamQuota(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	switch dec.Source {
	case "monthly":
		// ok tanpa pemotongan.
	case "per_exam":
		// Potong kredit dalam satu admin tx sekaligus set status publish.
		err = m.a.DB.WithAdminTx(r.Context(), func(atx pgx.Tx) error {
			var creditID string
			err := atx.QueryRow(r.Context(), `
				SELECT id::text FROM exam_credits
				WHERE tenant_id=$1 AND used < quantity ORDER BY created_at LIMIT 1`,
				tenantID).Scan(&creditID)
			if err != nil {
				if err == pgx.ErrNoRows {
					return httpx.ErrQuotaExceeded
				}
				return err
			}
			creditsExamID = &creditID
			if err := m.billing.ConsumeCredit(r.Context(), atx, tenantID, examID); err != nil {
				return err
			}
			tag, err := atx.Exec(r.Context(), `
				UPDATE exams SET status='published', question_set_version_id=$2,
					score_released=$3, credits_exam_id=$4, updated_at=now()
				WHERE id=$1 AND status='draft'`,
				examID, versionID, showScore, creditID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return httpx.NewErr(http.StatusConflict, "CONFLICT", "Ujian sudah berubah status")
			}
			return nil
		})
		if err != nil {
			creditsExamID = nil
			httpx.Error(w, err)
			return
		}
	case "trial":
		// Trial: cukup 1 ujian published sumber trial per tenant.
		err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
			var published int
			if err := tx.QueryRow(r.Context(), `
				SELECT COUNT(1) FROM exams WHERE status='published' AND credits_exam_id IS NULL`).Scan(&published); err != nil {
				return err
			}
			if published >= 1 {
				return httpx.ErrQuotaExceeded
			}
			tag, err := tx.Exec(r.Context(), `
				UPDATE exams SET status='published', question_set_version_id=$2,
					score_released=$3, updated_at=now()
				WHERE id=$1 AND status='draft'`,
				examID, versionID, showScore)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return httpx.NewErr(http.StatusConflict, "CONFLICT", "Ujian sudah berubah status")
			}
			return nil
		})
		if err != nil {
			httpx.Error(w, err)
			return
		}
	default:
		httpx.Error(w, httpx.ErrQuotaExceeded)
		return
	}

	// Audit log (tx tenant terpisah, kecil & aman).
	_ = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		meta := map[string]any{"source": dec.Source}
		if creditsExamID != nil {
			meta["credit_id"] = *creditsExamID
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"exam_publish", "exam", examID, meta)
	})

	// Respons: token aktif & kode ujian.
	var out examDetail
	if err := m.fillExamDetail(r, tenantID, examID, &out); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"token": out.Token, "exam_code": out.ExamCode, "status": out.Status,
	}})
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/unpublish — kembali draft; refund kredit per_exam.
// ---------------------------------------------------------------------------

func (m *Module) unpublishExam(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var refundedCredit *string
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		if e.Status != "published" {
			return httpx.NewErr(http.StatusBadRequest, "NOT_PUBLISHED", "Ujian tidak sedang terbit")
		}
		var attempts int
		if err := tx.QueryRow(r.Context(),
			`SELECT COUNT(1) FROM attempts WHERE exam_id=$1`, examID).Scan(&attempts); err != nil {
			return err
		}
		if attempts > 0 {
			return httpx.NewErr(http.StatusConflict, "EXAM_IN_USE",
				"Ujian tidak dapat ditutup; sudah ada pengerjaan")
		}
		if e.CreditsExamID != "" {
			cid := e.CreditsExamID
			refundedCredit = &cid
		}
		tag, err := tx.Exec(r.Context(), `
			UPDATE exams SET status='draft', score_released=false, updated_at=now() WHERE id=$1`, examID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	// Refund kredit (admin tx) bila ujian sumber per_exam.
	if refundedCredit != nil {
		err = m.a.DB.WithAdminTx(r.Context(), func(atx pgx.Tx) error {
			if _, err := atx.Exec(r.Context(), `
				UPDATE exam_credits SET used = used - 1 WHERE id=$1 AND used > 0`, *refundedCredit); err != nil {
				return err
			}
			_, err := atx.Exec(r.Context(), `UPDATE exams SET credits_exam_id=NULL WHERE id=$1`, examID)
			return err
		})
		if err != nil {
			httpx.Error(w, err)
			return
		}
	}
	_ = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"exam_unpublish", "exam", examID, nil)
	})
	httpx.OK(w, map[string]any{"data": map[string]any{"status": "draft", "refunded": refundedCredit != nil}})
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/token/regenerate
// ---------------------------------------------------------------------------

func (m *Module) regenerateToken(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var token string
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := examExistsMust(r.Context(), tx, examID); err != nil {
			return err
		}
		token, err = uniqueToken(r.Context(), tx)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(r.Context(),
			`UPDATE exams SET token=$2, token_active=true, updated_at=now() WHERE id=$1`,
			examID, token)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"exam_token_regenerate", "exam", examID, nil)
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"token": token}})
}

// examExistsMust versi loadExam ringan untuk perubahan tidak-butuh-baris.
func examExistsMust(ctx context.Context, tx pgx.Tx, examID string) error {
	okE, err := examExists(ctx, tx, examID)
	if err != nil {
		return err
	}
	if !okE {
		return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
	}
	return nil
}

// ---------------------------------------------------------------------------
// PUT /exams/{examID}/assignments — REPLACE penugasan.
// ---------------------------------------------------------------------------

func (m *Module) setAssignments(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req assignmentsReq
	if !m.decode(w, r, &req) {
		return
	}
	classIDs := uniqNonEmpty(req.ClassIDs)
	studentIDs := uniqNonEmpty(req.StudentIDs)
	if len(classIDs)+len(studentIDs) > 5000 {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Terlalu banyak penugasan"))
		return
	}
	var out assignmentsOut
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := examExistsMust(r.Context(), tx, examID); err != nil {
			return err
		}
		// Validasi keberadaan kelas/siswa (tenant-scoped via RLS).
		for _, cid := range classIDs {
			var okC bool
			if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM classes WHERE id=$1)`, cid).Scan(&okC); err != nil {
				return err
			}
			if !okC {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Kelas tidak ditemukan: "+cid)
			}
		}
		for _, sid := range studentIDs {
			var okS bool
			if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM students WHERE id=$1)`, sid).Scan(&okS); err != nil {
				return err
			}
			if !okS {
				return httpx.NewErr(http.StatusBadRequest, "VALIDATION", "Siswa tidak ditemukan: "+sid)
			}
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM exam_assignments WHERE exam_id=$1`, examID); err != nil {
			return err
		}
		for _, cid := range classIDs {
			if _, err := tx.Exec(r.Context(), `
				INSERT INTO exam_assignments(tenant_id, exam_id, target_type, class_id)
				VALUES ($1,$2,'class',$3)`, tenantID, examID, cid); err != nil {
				return examDBError(err)
			}
		}
		for _, sid := range studentIDs {
			if _, err := tx.Exec(r.Context(), `
				INSERT INTO exam_assignments(tenant_id, exam_id, target_type, student_id)
				VALUES ($1,$2,'student',$3)`, tenantID, examID, sid); err != nil {
				return examDBError(err)
			}
		}
		if err := audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"exam_assignments", "exam", examID,
			map[string]any{"class_count": len(classIDs), "student_count": len(studentIDs)}); err != nil {
			return err
		}
		out, err = loadAssignments(r.Context(), tx, examID)
		return err
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

// uniqNonEmpty dedupe & buang string kosong.
func uniqNonEmpty(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

// ---------------------------------------------------------------------------
// PUT /exams/{examID}/release-scores — guru merilis nilai (FR-5.4).
// ---------------------------------------------------------------------------

func (m *Module) releaseScores(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req releaseScoresReq
	if !m.decode(w, r, &req) {
		return
	}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE exams SET score_released=$2, updated_at=now() WHERE id=$1`,
			examID, req.Released)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"release_scores", "exam", examID, map[string]any{"released": req.Released})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"score_released": req.Released}})
}
