package reports

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// liveListSQL — GET /reports/live
// Ujian published yang sedang berjalan (now antara open..close) + hitungan
// status pengerjaan dari attempts (PRD FR-9.1, FR-9.2).
var liveListSQL = `
SELECT e.id::text, e.name, e.subject_name,
  COALESCE((SELECT string_agg(DISTINCT c.name, ', ') FROM exam_assignments ea
    JOIN classes c ON c.id = ea.class_id
    WHERE ea.exam_id = e.id AND ea.target_type='class'), '') AS classes,
  GREATEST(0, CEIL(EXTRACT(EPOCH FROM (e.close_at - now()))))::bigint AS close_in_seconds,
  COALESCE(cnt.working, 0)::bigint,
  COALESCE(cnt.done, 0)::bigint,
  COALESCE(cnt.started_students, 0)::bigint,
  ` + participantsExpr("e") + `::bigint AS participants
FROM exams e
LEFT JOIN LATERAL (
  SELECT COUNT(1) FILTER (WHERE a.status = 'in_progress') AS working,
    COUNT(1) FILTER (WHERE a.status IN (` + doneStatuses + `)) AS done,
    COUNT(DISTINCT a.student_id) AS started_students
  FROM attempts a WHERE a.exam_id = e.id
) cnt ON true
WHERE e.status='published' AND now() >= e.open_at AND now() <= e.close_at
ORDER BY e.close_at, e.name`

// liveList — GET /reports/live
func (m *Module) liveList(w http.ResponseWriter, r *http.Request) {
	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	items, err := m.liveListData(r.Context(), tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": items})
}

// liveListData membangun daftar ujian berjalan + hitungan status (dipakai
// REST /reports/live dan stream SSE).
func (m *Module) liveListData(ctx context.Context, tenantID string) ([]map[string]any, error) {
	items := []map[string]any{}
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, liveListSQL)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var (
				id, name, subject, classes           string
				closeIn, working, done, started, par int64
			)
			if err := rows.Scan(&id, &name, &subject, &classes, &closeIn, &working, &done, &started, &par); err != nil {
				return err
			}
			notStarted := par - started
			if notStarted < 0 {
				notStarted = 0
			}
			items = append(items, map[string]any{
				"exam_id": id, "name": name, "subject_name": subject, "classes": classes,
				"close_in_seconds": closeIn,
				"counts": map[string]any{
					"working": working, "not_started": notStarted, "done": done, "participants": par,
				},
			})
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

// liveSummarySQL — ringkasan satu ujian berjalan (dipakai di detail live).
var liveSummarySQL = `
SELECT
  COALESCE(cnt.working, 0)::bigint AS working,
  COALESCE(cnt.done, 0)::bigint AS done,
  COALESCE(cnt.started_students, 0)::bigint AS started_students,
  ` + participantsExpr("ex") + `::bigint AS participants
FROM exams ex
LEFT JOIN LATERAL (
  SELECT COUNT(1) FILTER (WHERE a.status = 'in_progress') AS working,
    COUNT(1) FILTER (WHERE a.status IN (` + doneStatuses + `)) AS done,
    COUNT(DISTINCT a.student_id) AS started_students
  FROM attempts a WHERE a.exam_id = ex.id
) cnt ON true
WHERE ex.id = $1`

// liveDetail — GET /reports/live/{examId}?class_id=&q=
func (m *Module) liveDetail(w http.ResponseWriter, r *http.Request) {
	examID, err := urlUUID(r, "examId")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	classID := strings.TrimSpace(r.URL.Query().Get("class_id"))
	if classID != "" && !uuidRe.MatchString(classID) {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter class_id tidak valid"))
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("q"))

	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	out, err := m.liveDetailData(r.Context(), tenantID, examID, classID, search)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": out})
}

// liveDetailData membangun detail live satu ujian: meta ujian + ringkasan +
// daftar siswa per status (dipakai REST /reports/live/{id} dan stream SSE).
func (m *Module) liveDetailData(ctx context.Context, tenantID, examID, classID, search string) (map[string]any, error) {
	var (
		out      map[string]any
		students = []map[string]any{}
	)
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var id, name, subject string
		var openAt, closeAt time.Time
		var dur int
		err := tx.QueryRow(ctx, `
			SELECT id::text, name, subject_name, open_at, close_at, duration_minutes
			FROM exams WHERE id=$1`, examID).
			Scan(&id, &name, &subject, &openAt, &closeAt, &dur)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		if err != nil {
			return err
		}
		out = map[string]any{"exam": map[string]any{
			"id": id, "name": name, "subject_name": subject,
			"open_at": openAt, "close_at": closeAt, "duration_minutes": dur,
		}}

		var working, done, started, par int64
		if err := tx.QueryRow(ctx, liveSummarySQL, examID).Scan(&working, &done, &started, &par); err != nil {
			return err
		}
		notStarted := par - started
		if notStarted < 0 {
			notStarted = 0
		}
		out["summary"] = map[string]any{
			"working": working, "not_started": notStarted, "done": done, "participants": par,
		}

		rows, err := tx.Query(ctx, liveStudentsSQL, examID, optArg(classID), optArg(search))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var (
				studentID, studentName, studentClass string
				attemptID                            *string
				attemptNo                            int
				status, cheating                     string
				answered, totalQ, violations         int64
				online                               bool
				lastActivity                         *time.Time
				score, finalScore                    *float64
			)
			if err := rows.Scan(&studentID, &studentName, &studentClass, &attemptID, &attemptNo, &status,
				&answered, &totalQ, &online, &lastActivity, &violations, &cheating, &score, &finalScore); err != nil {
				return err
			}
			students = append(students, map[string]any{
				"attempt_id": nilPtr(attemptID), "student_id": studentID,
				"student_name": studentName, "student_class": studentClass,
				"attempt_no": attemptNo, "status": status,
				"answered": answered, "total_questions": totalQ,
				"online": online, "last_activity": nilPtr(lastActivity),
				"violations": violations, "cheating_status": cheating,
				"score": nilPtr(score), "final_score": nilPtr(finalScore),
			})
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	out["students"] = students
	return out, nil
}

// liveStudentsSQL — baris per (peserta × percobaan): online dulu, lalu
// belum mulai, lalu selesai (PRD FR-9.2); kelas dari snapshot attempt.
// online: aktivitas terakhir (MAX attempt_events.server_ts) < 60 detik.
var liveStudentsSQL = `
WITH ex AS (SELECT id, max_attempts, question_set_id, question_set_version_id FROM exams WHERE id=$1),
pa AS (
  SELECT s.id AS student_id, COALESCE(NULLIF(s.name,''),'Tanpa Nama') AS student_name, s.class_id
  FROM students s
  WHERE s.status='active' AND (
    (SELECT COUNT(1) FROM exam_assignments ea WHERE ea.exam_id=(SELECT id FROM ex)) = 0
    OR EXISTS (SELECT 1 FROM exam_assignments ea WHERE ea.exam_id=(SELECT id FROM ex)
      AND ea.target_type='student' AND ea.student_id=s.id)
    OR s.class_id IN (SELECT ea.class_id FROM exam_assignments ea
      WHERE ea.exam_id=(SELECT id FROM ex) AND ea.target_type='class'))
),
pe AS (
  SELECT pa.student_id, pa.student_name, pa.class_id, gs.attempt_no
  FROM pa CROSS JOIN ex
  CROSS JOIN LATERAL generate_series(1, ex.max_attempts) gs(attempt_no)
)
SELECT pe.student_id, pe.student_name,
  COALESCE(NULLIF(a.class_snapshot->>'name',''), c.name, '') AS student_class,
  a.id::text AS attempt_id, pe.attempt_no,
  COALESCE(a.status, 'not_started') AS status,
  COALESCE(ans.answered, 0)::bigint AS answered,
  COALESCE(tq.total_questions, 0)::bigint AS total_questions,
  (la.last_activity IS NOT NULL AND la.last_activity > now() - interval '60 seconds') AS online,
  la.last_activity,
  COALESCE(v.violations, 0)::bigint AS violations,
  COALESCE(a.cheating_status, 'none') AS cheating_status,
  a.score::float8, a.final_score::float8
FROM pe
LEFT JOIN attempts a ON a.exam_id=(SELECT id FROM ex)
  AND a.student_id=pe.student_id AND a.attempt_no=pe.attempt_no
LEFT JOIN classes c ON c.id = pe.class_id
LEFT JOIN LATERAL (SELECT COUNT(1) AS answered FROM attempt_answers aa WHERE aa.attempt_id=a.id) ans ON true
LEFT JOIN LATERAL (SELECT MAX(ev.server_ts) AS last_activity FROM attempt_events ev WHERE ev.attempt_id=a.id) la ON true
LEFT JOIN LATERAL (SELECT COUNT(1) AS violations FROM attempt_violations vv
  WHERE vv.attempt_id=a.id AND NOT vv.cancelled) v ON true
CROSS JOIN LATERAL (
  SELECT COUNT(1) AS total_questions FROM questions q, ex
  WHERE q.question_set_id=ex.question_set_id
    AND q.set_version_id IS NOT DISTINCT FROM ex.question_set_version_id
) tq
WHERE (pe.attempt_no = 1 OR a.id IS NOT NULL)
  AND ($2::uuid IS NULL OR COALESCE(NULLIF(a.class_snapshot->>'class_id','')::uuid, pe.class_id) = $2::uuid)
  AND ($3::text IS NULL OR pe.student_name ILIKE '%'||$3||'%')
ORDER BY online DESC,
  CASE WHEN COALESCE(a.status,'not_started') = 'not_started' THEN 0 ELSE 1 END,
  CASE COALESCE(a.status,'not_started')
    WHEN 'in_progress' THEN 0 WHEN 'pending_sync' THEN 1 WHEN 'submitted' THEN 2
    WHEN 'graded' THEN 3 WHEN 'expired' THEN 4 WHEN 'disqualified' THEN 5 ELSE 6 END,
  pe.student_name, pe.attempt_no`
