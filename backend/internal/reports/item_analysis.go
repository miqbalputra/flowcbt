package reports

import (
	"net/http"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// itemAnalysisSQL — analisis butir soal (PRD FR-9.9): agregat per soal atas
// attempt selesai. Soal diambil dari paket soal versi yang diujikan
// (set_version_id menempel versi ujian; baru versi ujian NULL pada draft).
var itemAnalysisSQL = `
SELECT q.id::text, q.order_no, q.type, q.points::float8,
  COALESCE(g.answered_count, 0)::bigint AS answered_count,
  COALESCE(g.correct_score_avg_pct, 0)::float8 AS correct_score_avg_pct,
  COALESCE(g.correct_count, 0)::bigint AS correct_count,
  CASE WHEN COALESCE(g.answered_count, 0) > 0
    THEN (g.correct_count::float8 / g.answered_count) * 100 ELSE 0 END::float8 AS correct_pct,
  COALESCE(g.time_unknown, 0)::bigint AS time_unknown
FROM exams e
JOIN questions q ON q.question_set_id = e.question_set_id
  AND q.set_version_id IS NOT DISTINCT FROM e.question_set_version_id
LEFT JOIN LATERAL (
  SELECT COUNT(1) AS answered_count,
    AVG(CASE WHEN q.points > 0 THEN (aa.score / q.points) * 100 END)::float8 AS correct_score_avg_pct,
    COUNT(1) FILTER (WHERE aa.is_correct = true) AS correct_count,
    COUNT(1) FILTER (WHERE COALESCE(aa.answer #>> '{client_ts}', '') = '') AS time_unknown
  FROM attempt_answers aa
  JOIN attempts a ON a.id = aa.attempt_id AND a.exam_id = e.id
    AND a.status IN (` + doneStatuses + `)
  WHERE aa.question_id = q.id
) g ON true
WHERE e.id = $1
ORDER BY q.order_no`

// distractorSQL — agregasi pilihan jawaban siswa utk soal pilihan ganda.
// Kunci pilihan dibaca toleran dari JSON jawaban (pick/choice/key/value/selected,
// atau string/angka mentah) — kontrak disepakati modul pengerjaan (wave 2).
var distractorSQL = `
SELECT q.id::text AS question_id, p.pick AS option_id, COUNT(1)::bigint AS cnt
FROM exams e
JOIN questions q ON q.question_set_id = e.question_set_id
  AND q.set_version_id IS NOT DISTINCT FROM e.question_set_version_id
JOIN attempt_answers aa ON aa.question_id = q.id
JOIN attempts a ON a.id = aa.attempt_id AND a.exam_id = e.id
  AND a.status IN (` + doneStatuses + `)
CROSS JOIN LATERAL (
  SELECT COALESCE(
    aa.answer #>> '{pick}', aa.answer #>> '{choice}', aa.answer #>> '{key}',
    aa.answer #>> '{value}', aa.answer #>> '{selected}',
    CASE WHEN jsonb_typeof(aa.answer) = 'string' THEN aa.answer #>> '{}' END,
    CASE WHEN jsonb_typeof(aa.answer) = 'number' THEN aa.answer #>> '{}' END
  ) AS pick
) p
WHERE e.id = $1 AND q.type IN ('mcq','mcq_complex') AND p.pick IS NOT NULL AND p.pick <> ''
GROUP BY q.id, p.pick
ORDER BY q.id, cnt DESC`

// itemAnalysis — GET /reports/exams/{id}/item-analysis
func (m *Module) itemAnalysis(w http.ResponseWriter, r *http.Request) {
	examID, err := urlUUID(r, "examId")
	if err != nil {
		httpx.Error(w, err)
		return
	}
	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	items := []map[string]any{}
	distractors := map[string][]map[string]any{}
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), itemAnalysisSQL, examID)
		if err != nil {
			return err
		}
		defer rows.Close()
		mcqTypes := map[string]bool{"mcq": true, "mcq_complex": true}
		for rows.Next() {
			var (
				id, typ                                string
				orderNo                                int
				points, correctScoreAvgPct, correctPct float64
				answered, correctCount, timeUnknown    int64
			)
			if err := rows.Scan(&id, &orderNo, &typ, &points, &answered, &correctScoreAvgPct,
				&correctCount, &correctPct, &timeUnknown); err != nil {
				return err
			}
			items = append(items, map[string]any{
				"question_id": id, "order_no": orderNo, "type": typ, "points": points,
				"answered_count": answered, "correct_score_avg_pct": correctScoreAvgPct,
				"correct_count": correctCount, "correct_pct": correctPct,
				"time_unknown": timeUnknown,
			})
			if mcqTypes[typ] {
				distractors[id] = []map[string]any{}
			}
		}
		if err := rows.Err(); err != nil {
			return err
		}

		drows, err := tx.Query(r.Context(), distractorSQL, examID)
		if err != nil {
			return err
		}
		defer drows.Close()
		for drows.Next() {
			var questionID, optionID string
			var cnt int64
			if err := drows.Scan(&questionID, &optionID, &cnt); err != nil {
				return err
			}
			if _, ok := distractors[questionID]; ok {
				distractors[questionID] = append(distractors[questionID],
					map[string]any{"option_id": optionID, "count": cnt})
			}
		}
		return drows.Err()
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	for _, it := range items {
		it["distractors"] = distractors[it["question_id"].(string)]
	}
	httpx.OK(w, map[string]any{"data": items})
}
