// handlers_monitor.go — pemantauan & aksi pengawas ujian (PRD FR-5.7, FR-8.4,
// FR-5.8C): daftar attempt per ujian, tambah waktu, reset attempt siswa,
// paksa submitting, regrade, laporan kecurangan & keputusan guru.
package exams

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/grading"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// GET /exams/{examID}/attempts?class_id=&q=&limit=&cursor=
// ---------------------------------------------------------------------------

// monitorAttempt satu baris pemantauan pengerjaan (FR-5.7).
type monitorAttempt struct {
	ID                string     `json:"id"`
	StudentID         string     `json:"student_id"`
	StudentName       string     `json:"student_name"`
	StudentClass      string     `json:"student_class"`
	AttemptNo         int        `json:"attempt_no"`
	Status            string     `json:"status"`
	StartedAt         *time.Time `json:"started_at"`
	DeadlineAt        *time.Time `json:"deadline_at"`
	SubmittedAt       *time.Time `json:"submitted_at"`
	Answered          int        `json:"answered"`
	TotalQuestions    int        `json:"total_questions"`
	Connection        string     `json:"connection"` // online|offline|never
	LastActivity      *time.Time `json:"last_activity"`
	Violations        int        `json:"violations"`
	CheatingStatus    string     `json:"cheating_status"`
	Score             *float64   `json:"score"`
	MaxScore          *float64   `json:"max_score"`
	FinalScore        *float64   `json:"final_score"`
	FinalScorePending bool       `json:"final_score_pending"`
	PenaltyPoints     float64    `json:"penalty_points"`

	// internal (tidak di-serialize): created_at untuk kursor keyset.
	_cursorCA time.Time
}

const listAttemptsSQL = `
SELECT a.id::text, a.student_id::text, s.name, COALESCE(c.name,''), a.attempt_no,
	a.status, a.started_at, a.deadline_at, a.submitted_at,
	(SELECT COUNT(1) FROM attempt_answers aa WHERE aa.attempt_id=a.id) AS answered,
	COALESCE(jsonb_array_length(a.package_json->'order'),
		(SELECT COUNT(1) FROM questions q WHERE q.set_version_id = e.question_set_version_id)) AS total_q,
	(SELECT MAX(ev.server_ts) FROM attempt_events ev WHERE ev.attempt_id=a.id) AS last_activity,
	(SELECT COUNT(1) FROM attempt_violations v WHERE v.attempt_id=a.id AND v.cancelled=false) AS violations,
	a.cheating_status, a.score::float8, a.max_score::float8, a.final_score::float8,
	EXISTS (SELECT 1 FROM questions q JOIN attempt_answers aa2
	        ON aa2.question_id=q.id AND aa2.attempt_id=a.id
	        WHERE q.type='essay' AND aa2.graded_by <> 'manual') AS pending_manual,
	a.penalty_points::float8, a.created_at
FROM attempts a
JOIN students s ON s.id = a.student_id
LEFT JOIN classes c ON c.id = s.class_id
JOIN exams e ON e.id = a.exam_id
`

func (m *Module) listAttempts(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	limit := parseLimitStr(r.URL.Query().Get("limit"), 50, 200)

	conds := []string{"a.exam_id = $1"}
	args := []any{examID}
	add := func(cond string, v ...any) {
		for _, a := range v {
			args = append(args, a)
			cond = strings.Replace(cond, "?", "$"+strconv.Itoa(len(args)), 1)
		}
		conds = append(conds, cond)
	}
	if cid := strings.TrimSpace(r.URL.Query().Get("class_id")); cid != "" {
		add("s.class_id = ?", cid)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		add("(s.name ILIKE '%'||?||'%' OR s.student_code ILIKE '%'||?||'%' OR s.nis ILIKE '%'||?||'%')", q, q, q)
	}
	if st := strings.TrimSpace(r.URL.Query().Get("status")); st != "" {
		add("a.status = ?", st)
	}
	if cur := strings.TrimSpace(r.URL.Query().Get("cursor")); cur != "" {
		ca, id, err := decodeExamCursor(cur)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		args = append(args, ca, id)
		conds = append(conds, `(a.created_at, a.id) < ($`+strconv.Itoa(len(args)-1)+`::timestamptz, $`+strconv.Itoa(len(args))+`::uuid)`)
	}

	query := listAttemptsSQL + " WHERE " + strings.Join(conds, " AND ") +
		" ORDER BY a.created_at DESC, a.id DESC LIMIT " + strconv.Itoa(limit+1)

	items := []monitorAttempt{}
	now := nowTS()
	hasMore := false
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it monitorAttempt
			var score, maxScore, finalScore *float64
			var pendingManual bool
			var createdAt time.Time
			if err := rows.Scan(&it.ID, &it.StudentID, &it.StudentName, &it.StudentClass,
				&it.AttemptNo, &it.Status, &it.StartedAt, &it.DeadlineAt, &it.SubmittedAt,
				&it.Answered, &it.TotalQuestions, &it.LastActivity, &it.Violations,
				&it.CheatingStatus, &score, &maxScore, &finalScore, &pendingManual,
				&it.PenaltyPoints, &createdAt); err != nil {
				return err
			}
			it.Score = score
			it.MaxScore = maxScore
			it.FinalScore = finalScore
			it.FinalScorePending = pendingManual || it.Status == "in_progress" || it.Status == "pending_sync"
			it.Connection = connectionStatus(now, it.LastActivity)
			it._cursorCA = createdAt
			items = append(items, it)
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
	next := ""
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		next = encodeExamCursor(last._cursorCA, last.ID)
	}
	httpx.OK(w, map[string]any{"data": items, "meta": map[string]any{
		"limit": limit, "next_cursor": next,
	}})
}

// connectionStatus: 'online' bila aktivitas terakhir < 60 detik.
func connectionStatus(now time.Time, last *time.Time) string {
	if last == nil {
		return "never"
	}
	if now.Sub(*last) < 60*time.Second {
		return "online"
	}
	return "offline"
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/participants/{studentID}/extend-time {seconds}
// ---------------------------------------------------------------------------

func (m *Module) extendTime(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	studentID, err := urlUUID(r, "studentID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req extendTimeReq
	if !m.decode(w, r, &req) {
		return
	}
	var newDeadline *time.Time
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := examExistsMust(r.Context(), tx, examID); err != nil {
			return err
		}
		a, err := scanAttemptRecord(tx.QueryRow(r.Context(), `
			SELECT `+attemptSelect+` FROM attempts
			WHERE exam_id=$1 AND student_id=$2 AND status='in_progress'
			ORDER BY attempt_no DESC LIMIT 1`, examID, studentID))
		if err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusNotFound, "NOT_FOUND",
					"Tidak ada attempt yang sedang berjalan untuk siswa ini")
			}
			return err
		}
		if a.DeadlineAt == nil {
			return httpx.NewErr(http.StatusConflict, "CONFLICT", "Attempt belum memiliki batas waktu")
		}
		if err := tx.QueryRow(r.Context(), `
			UPDATE attempts SET deadline_at = deadline_at + make_interval(secs => $2)
			WHERE id=$1 RETURNING deadline_at`, a.ID, req.Seconds).Scan(&newDeadline); err != nil {
			return err
		}
		// Catat tambahan waktu ke peserta (dipakai ulang bila attempt baru).
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO exam_participants(tenant_id, exam_id, student_id, extra_time_seconds)
			VALUES ($1,$2,$3,$4)
			ON CONFLICT (exam_id, student_id)
			DO UPDATE SET extra_time_seconds = exam_participants.extra_time_seconds + EXCLUDED.extra_time_seconds`,
			tenantID, examID, studentID, req.Seconds); err != nil {
			return err
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"extend_time", "attempt", a.ID, map[string]any{
				"student_id": studentID, "seconds": req.Seconds})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"attempt_id": studentID, "deadline_at": newDeadline, "extended_seconds": req.Seconds,
	}})
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/participants/{studentID}/reset-attempt
// Hapus attempt terakhir siswa (anak-anaknya dulu — FK tidak cascade) agar
// siswa memulai segar. Syarat: ujian published & attempt tidak sedang berjalan.
// ---------------------------------------------------------------------------

func (m *Module) resetAttempt(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	studentID, err := urlUUID(r, "studentID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var removedNo int
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		if e.Status != "published" {
			return httpx.NewErr(http.StatusBadRequest, "NOT_PUBLISHED",
				"Reset attempt hanya untuk ujian yang sedang terbit")
		}
		// Attempt terakhir siswa pada ujian ini.
		a, err := scanAttemptRecord(tx.QueryRow(r.Context(), `
			SELECT `+attemptSelect+` FROM attempts
			WHERE exam_id=$1 AND student_id=$2
			ORDER BY attempt_no DESC LIMIT 1`, examID, studentID))
		if err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusNotFound, "NOT_FOUND",
					"Siswa belum memiliki attempt pada ujian ini")
			}
			return err
		}
		if a.Status == "in_progress" || a.Status == "pending_sync" {
			return httpx.NewErr(http.StatusConflict, "ATTEMPT_ACTIVE",
				"Attempt sedang berjalan; paksa submit dahulu sebelum reset")
		}
		// FK tidak cascade: hapus anak secara manual (urutan bebas).
		for _, table := range []string{
			"attempt_answers", "attempt_events", "attempt_violations", "proctor_snapshots",
		} {
			if _, err := tx.Exec(r.Context(),
				`DELETE FROM `+table+` WHERE attempt_id=$1`, a.ID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM attempts WHERE id=$1`, a.ID); err != nil {
			return err
		}
		removedNo = a.AttemptNo
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"reset_attempt", "exam", examID, map[string]any{
				"student_id": studentID, "attempt_no": a.AttemptNo})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"reset": true, "removed_attempt_no": removedNo,
	}})
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/participants/{studentID}/force-submit
// ---------------------------------------------------------------------------

func (m *Module) forceSubmit(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	studentID, err := urlUUID(r, "studentID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var res submitResult
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := examExistsMust(r.Context(), tx, examID); err != nil {
			return err
		}
		a, err := scanAttemptRecord(tx.QueryRow(r.Context(), `
			SELECT `+attemptSelect+` FROM attempts
			WHERE exam_id=$1 AND student_id=$2 AND status IN ('in_progress','pending_sync')
			ORDER BY attempt_no DESC LIMIT 1`, examID, studentID))
		if err != nil {
			if err == pgx.ErrNoRows {
				return httpx.NewErr(http.StatusNotFound, "NOT_FOUND",
					"Tidak ada attempt aktif untuk siswa ini")
			}
			return err
		}
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		res, err = finalizeAttempt(r.Context(), tx, tenantID, a, e, nowTS())
		if err != nil {
			return err
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"force_submit", "attempt", a.ID, map[string]any{"student_id": studentID})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": res})
}

// ---------------------------------------------------------------------------
// POST /exams/{examID}/regrade — nilai ulang semua attempt (FR-8.4).
// ---------------------------------------------------------------------------

func (m *Module) regrade(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	regraded := 0
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := examExistsMust(r.Context(), tx, examID); err != nil {
			return err
		}
		rows, err := tx.Query(r.Context(), `
			SELECT `+attemptSelect+` FROM attempts
			WHERE exam_id=$1 AND status IN ('submitted','graded')`, examID)
		if err != nil {
			return err
		}
		// Kumpulkan dulu (query dalam iterasi tx sama dengan UPDATE rawan
		// libpq "busy"); gradeAttempt dipanggil setelahnya per attempt.
		list := []*attemptRecord{}
		for rows.Next() {
			a, err := scanAttemptRecord(rows)
			if err != nil {
				rows.Close()
				return err
			}
			list = append(list, a)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		e, err := loadExam(r.Context(), tx, examID)
		if err != nil {
			return err
		}
		for _, a := range list {
			if _, err := gradeAttempt(r.Context(), tx, a, e, tenantID, true); err != nil {
				return err
			}
			regraded++
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"regrade", "exam", examID, map[string]any{"regraded": regraded})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"exam_id": examID, "regraded": regraded}})
}

// ---------------------------------------------------------------------------
// GET /exams/{examID}/cheating-report (FR-5.8C)
// ---------------------------------------------------------------------------

// violationItem satu pelanggaran dalam laporan.
type violationItem struct {
	ID         int64      `json:"id"`
	Type       string     `json:"type"`
	StartedAt  *time.Time `json:"started_at"`
	DurationMS int        `json:"duration_ms"`
	CreatedAt  time.Time  `json:"created_at"`
}

// snapshotItem satu snapshot proktor dalam laporan.
type snapshotItem struct {
	ID      string          `json:"id"`
	URL     string          `json:"url"`
	TakenAt time.Time       `json:"taken_at"`
	Flags   json.RawMessage `json:"flags"`
}

// cheatingRow satu attempt dalam laporan kecurangan.
type cheatingRow struct {
	AttemptID       string          `json:"attempt_id"`
	StudentID       string          `json:"student_id"`
	StudentName     string          `json:"student_name"`
	StudentClass    string          `json:"student_class"`
	CheatingStatus  string          `json:"cheating_status"`
	ViolationItems  []violationItem `json:"violations"`
	ViolationsCount int             `json:"violations_count"`
	PenaltyNote     *string         `json:"penalty_note"`
	Score           *float64        `json:"score"`
	FinalScore      *float64        `json:"final_score"`
	Proctor         []snapshotItem  `json:"proctor"`
}

func (m *Module) cheatingReport(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	rows0 := []cheatingRow{}
	ids := []string{}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		if err := examExistsMust(r.Context(), tx, examID); err != nil {
			return err
		}
		rows, err := tx.Query(r.Context(), `
			SELECT a.id::text, a.student_id::text, s.name, COALESCE(c.name,''),
				a.cheating_status, a.penalty_note, a.score::float8, a.final_score::float8
			FROM attempts a
			JOIN students s ON s.id=a.student_id
			LEFT JOIN classes c ON c.id=s.class_id
			WHERE a.exam_id=$1 AND (a.cheating_status <> 'none'
				OR EXISTS (SELECT 1 FROM attempt_violations v WHERE v.attempt_id=a.id AND v.cancelled=false))
			ORDER BY a.created_at DESC`, examID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var cr cheatingRow
			cr.ViolationItems = []violationItem{}
			cr.Proctor = []snapshotItem{}
			if err := rows.Scan(&cr.AttemptID, &cr.StudentID, &cr.StudentName,
				&cr.StudentClass, &cr.CheatingStatus, &cr.PenaltyNote,
				&cr.Score, &cr.FinalScore); err != nil {
				return err
			}
			rows0 = append(rows0, cr)
			ids = append(ids, cr.AttemptID)
		}
		return rows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if len(ids) == 0 {
		httpx.OK(w, map[string]any{"data": rows0})
		return
	}

	// Violas & snapshot untuk semua attempt sekali query (per attempt di-clone
	// ke row terkait).
	vioBy := map[string][]violationItem{}
	snapBy := map[string][]snapshotItem{}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		vrows, err := tx.Query(r.Context(), `
			SELECT id, attempt_id::text, type, started_at, duration_ms, created_at
			FROM attempt_violations WHERE attempt_id = ANY($1) AND cancelled=false
			ORDER BY created_at`, ids)
		if err != nil {
			return err
		}
		defer vrows.Close()
		for vrows.Next() {
			var id int64
			var aid string
			var it violationItem
			if err := vrows.Scan(&id, &aid, &it.Type, &it.StartedAt, &it.DurationMS, &it.CreatedAt); err != nil {
				return err
			}
			it.ID = id
			vioBy[aid] = append(vioBy[aid], it)
		}
		if err := vrows.Err(); err != nil {
			return err
		}
		srows, err := tx.Query(r.Context(), `
			SELECT id::text, attempt_id::text, taken_at, flags, object_key
			FROM proctor_snapshots WHERE attempt_id = ANY($1)
			ORDER BY taken_at`, ids)
		if err != nil {
			return err
		}
		defer srows.Close()
		for srows.Next() {
			var aid, objKey string
			var it snapshotItem
			if err := srows.Scan(&it.ID, &aid, &it.TakenAt, &it.Flags, &objKey); err != nil {
				return err
			}
			it.URL = snapshotURL(examID, aid, it.ID)
			snapBy[aid] = append(snapBy[aid], it)
		}
		return srows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	for i := range rows0 {
		rows0[i].ViolationItems = vioBy[rows0[i].AttemptID]
		if rows0[i].ViolationItems == nil {
			rows0[i].ViolationItems = []violationItem{}
		}
		rows0[i].ViolationsCount = len(rows0[i].ViolationItems)
		rows0[i].Proctor = snapBy[rows0[i].AttemptID]
		if rows0[i].Proctor == nil {
			rows0[i].Proctor = []snapshotItem{}
		}
	}
	httpx.OK(w, map[string]any{"data": rows0})
}

// snapshotURL path publik (staf) unduh snapshot.
func snapshotURL(examID, attemptID, snapID string) string {
	return "/api/v1/exams/" + examID + "/snapshots/" + attemptID + "/" + snapID
}

// ---------------------------------------------------------------------------
// PUT /exams/{examID}/cheating-decision {attempt_id, decision, reason}
// ---------------------------------------------------------------------------

func (m *Module) cheatingDecision(w http.ResponseWriter, r *http.Request) {
	tenantID, okT := m.tenant(w, r)
	if !okT {
		return
	}
	examID, err := urlUUID(r, "examID")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	var req cheatDecisionReq
	if !m.decode(w, r, &req) {
		return
	}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		a, err := loadAttempt(r.Context(), tx, req.AttemptID)
		if err != nil {
			return err
		}
		if a.ExamID != examID {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Attempt bukan milik ujian ini")
		}
		switch req.Decision {
		case "valid":
			// Keputusan: attempt sah → semua penalti dihapus, nilai final
			// dihitung ulang tanpa penalti. Pelanggaran tetap histori (FR-5.8C).
			final := gradingFinal(a.Score, a.MaxScore, 0)
			if _, err := tx.Exec(r.Context(), `
				UPDATE attempts SET penalty_points=0, final_score=$2, cheating_status='none',
					penalty_note=$3 WHERE id=$1`,
				a.ID, final, noteOf("valid", req.Reason)); err != nil {
				return err
			}
		case "cancel_penalty":
			// Penalti dibatalkan; riwayat pelanggaran ditandai dibatalkan.
			final := gradingFinal(a.Score, a.MaxScore, 0)
			if _, err := tx.Exec(r.Context(), `
				UPDATE attempts SET penalty_points=0, final_score=$2, penalty_note=$3 WHERE id=$1`,
				a.ID, final, noteOf("cancel_penalty", req.Reason)); err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `
				UPDATE attempt_violations SET cancelled=true, cancel_reason=$2
				WHERE attempt_id=$1 AND cancelled=false`, a.ID, req.Reason); err != nil {
				return err
			}
		case "disqualify":
			// Diskualifikasi: nilai dinolkan permanen (FR-5.8C).
			if _, err := tx.Exec(r.Context(), `
				UPDATE attempts SET status='disqualified', score=0, final_score=0,
					cheating_status='disqualified', penalty_note=$2 WHERE id=$1`,
				a.ID, noteOf("disqualify", req.Reason)); err != nil {
				return err
			}
		}
		return audit(r.Context(), tx, tenantID, ctxinfo.Claims(r.Context()),
			"cheating_decision", "attempt", a.ID,
			map[string]any{"decision": req.Decision, "reason": req.Reason})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"attempt_id": req.AttemptID, "decision": req.Decision,
	}})
}

// noteOf label penalti_note standar.
func noteOf(decision, reason string) string {
	if strings.TrimSpace(reason) == "" {
		return "keputusan: " + decision
	}
	return "keputusan " + decision + ": " + reason
}

// gradingFinal nilai akhir 0..100 lewat paket grading (WAJIB, FR-8.2).
func gradingFinal(score, maxScore, penalty float64) float64 {
	return grading.FinalScore(score, maxScore, penalty)
}
