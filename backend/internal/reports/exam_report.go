package reports

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// examStatsSQL — statistik satu ujian dari attempts selesai (PRD FR-9.8):
// rata-rata, median, min/max, tingkat kelulusan (vs KKM), durasi rata-rata,
// dan distribusi nilai per bucket.
var examStatsSQL = `
WITH ex AS (SELECT id, passing_score FROM exams WHERE id=$1),
d AS (
  SELECT COALESCE(a.final_score, a.score) AS fs,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(a.submitted_at, a.deadline_at) - a.started_at)))) AS dur
  FROM attempts a, ex
  WHERE a.exam_id = ex.id AND a.status IN (` + doneStatuses + `)
),
s AS (
  SELECT
    (SELECT COUNT(1) FROM d) AS submitted,
    AVG(fs) AS avg_f,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fs) AS med_f,
    MIN(fs) AS min_f, MAX(fs) AS max_f,
    COUNT(1) FILTER (WHERE fs >= COALESCE(ex.passing_score, 0)) AS passers,
    AVG(dur) AS avg_dur,
    COUNT(1) FILTER (WHERE fs < 60) AS b0,
    COUNT(1) FILTER (WHERE fs >= 60 AND fs < 70) AS b1,
    COUNT(1) FILTER (WHERE fs >= 70 AND fs < 80) AS b2,
    COUNT(1) FILTER (WHERE fs >= 80 AND fs < 90) AS b3,
    COUNT(1) FILTER (WHERE fs >= 90) AS b4
  FROM d, ex
)
SELECT
  ` + participantsExpr("ex") + `::bigint AS participants,
  COALESCE(s.submitted, 0)::bigint,
  COALESCE(s.avg_f, 0)::float8,
  COALESCE(s.med_f, 0)::float8,
  COALESCE(s.min_f, 0)::float8,
  COALESCE(s.max_f, 0)::float8,
  COALESCE(s.passers, 0)::float8,
  COALESCE(s.avg_dur, 0)::float8,
  COALESCE(s.b0, 0)::bigint, COALESCE(s.b1, 0)::bigint, COALESCE(s.b2, 0)::bigint,
  COALESCE(s.b3, 0)::bigint, COALESCE(s.b4, 0)::bigint
FROM s, ex`

// examStudentsSQL — rekap per siswa utk satu ujian (FR-3.6): peserta
// ditugaskan × percobaan (attempt belum mulai ikut tampil), kelas dari
// snapshot attempt; dipakai bersama handler rekap & export.
var examStudentsSQL = `
WITH ex AS (SELECT id, max_attempts FROM exams WHERE id=$1),
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
SELECT
  a.id::text AS attempt_id, pe.student_id, pe.student_name,
  COALESCE(NULLIF(a.class_snapshot->>'name',''), c.name, '') AS class,
  pe.attempt_no,
  COALESCE(a.status, 'not_started') AS status,
  a.started_at,
  CASE WHEN a.started_at IS NULL THEN 0
    ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(a.submitted_at, a.deadline_at, now())) - a.started_at)))::bigint
  END AS duration_seconds,
  a.score::float8, a.final_score::float8, a.penalty_points::float8,
  COALESCE(a.cheating_status, 'none') AS cheating_status, a.submitted_at
FROM pe
LEFT JOIN attempts a ON a.exam_id=(SELECT id FROM ex)
  AND a.student_id=pe.student_id AND a.attempt_no=pe.attempt_no
LEFT JOIN classes c ON c.id = pe.class_id
WHERE (pe.attempt_no = 1 OR a.id IS NOT NULL)
  AND ($2::uuid IS NULL OR COALESCE(NULLIF(a.class_snapshot->>'class_id','')::uuid, pe.class_id) = $2::uuid)
ORDER BY pe.student_name, pe.attempt_no`

// attemptRow hasil scan examStudentsSQL (urutan kolom sumber).
type attemptRow struct {
	AttemptID       *string
	StudentID       string
	Name            string
	Class           string
	AttemptNo       int
	Status          string
	StartedAt       *time.Time
	DurationSeconds int64
	Score           *float64
	FinalScore      *float64
	PenaltyPoints   *float64
	CheatingStatus  string
	SubmittedAt     *time.Time
}

func scanAttemptRows(rows pgx.Rows, each func(attemptRow)) error {
	defer rows.Close()
	for rows.Next() {
		var a attemptRow
		if err := rows.Scan(&a.AttemptID, &a.StudentID, &a.Name, &a.Class, &a.AttemptNo, &a.Status,
			&a.StartedAt, &a.DurationSeconds, &a.Score, &a.FinalScore, &a.PenaltyPoints,
			&a.CheatingStatus, &a.SubmittedAt); err != nil {
			return err
		}
		each(a)
	}
	return rows.Err()
}

// examReport — GET /reports/exams/{id}?class_id=
func (m *Module) examReport(w http.ResponseWriter, r *http.Request) {
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

	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	var (
		exam map[string]any
		st   map[string]any
		list = []map[string]any{}
	)
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		var (
			id, name, subject, code, status string
			openAt, closeAt                 time.Time
			dur                             int
			passing                         *float64
		)
		err := tx.QueryRow(r.Context(), `
			SELECT id::text, name, subject_name, exam_code, status, open_at, close_at,
				duration_minutes, passing_score::float8
			FROM exams WHERE id=$1`, examID).
			Scan(&id, &name, &subject, &code, &status, &openAt, &closeAt, &dur, &passing)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NewErr(http.StatusNotFound, "NOT_FOUND", "Ujian tidak ditemukan")
		}
		if err != nil {
			return err
		}
		exam = map[string]any{
			"id": id, "name": name, "subject_name": subject, "exam_code": code, "status": status,
			"open_at": openAt, "close_at": closeAt, "duration_minutes": dur,
			"passing_score": nilPtr(passing),
		}

		var (
			participants, submitted               int64
			avg, med, minF, maxF, passers, avgDur float64
			b0, b1, b2, b3, b4                    int64
		)
		if err := tx.QueryRow(r.Context(), examStatsSQL, examID).
			Scan(&participants, &submitted, &avg, &med, &minF, &maxF, &passers, &avgDur,
				&b0, &b1, &b2, &b3, &b4); err != nil {
			return err
		}
		passRate := 0.0
		if submitted > 0 {
			passRate = passers / float64(submitted)
		}
		st = map[string]any{
			"participants": participants, "submitted": submitted,
			"avg": avg, "median": med, "min": minF, "max": maxF,
			"pass_rate": passRate, "avg_duration_seconds": avgDur,
			"distribution": []map[string]any{
				{"bucket": "0-59", "count": b0},
				{"bucket": "60-69", "count": b1},
				{"bucket": "70-79", "count": b2},
				{"bucket": "80-89", "count": b3},
				{"bucket": "90-100", "count": b4},
			},
		}

		rows, err := tx.Query(r.Context(), examStudentsSQL, examID, optArg(classID))
		if err != nil {
			return err
		}
		return scanAttemptRows(rows, func(a attemptRow) {
			list = append(list, map[string]any{
				"attempt_id": nilPtr(a.AttemptID), "student_id": a.StudentID,
				"name": a.Name, "class": a.Class,
				"attempt_no": a.AttemptNo, "status": a.Status,
				"duration_seconds": a.DurationSeconds,
				"score":            nilPtr(a.Score), "final_score": nilPtr(a.FinalScore),
				"cheating_status": a.CheatingStatus, "submitted_at": nilPtr(a.SubmittedAt),
			})
		})
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{"exam": exam, "stats": st, "students": list}})
}
