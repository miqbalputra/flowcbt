package reports

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// historySQL — dasar GET /reports/history (PRD FR-9.6, FR-9.7): exams JOIN
// agregat attempts. Filter dinamis (q, subject, status, from, to) dan keyset
// pagination (close_at DESC, id DESC) dirakit di handler; tanpa draft kecuali
// diminta eksplisit.
var historySQL = `
SELECT e.id::text, e.name, e.subject_name, e.exam_code, e.status, e.open_at, e.close_at,
  ` + participantsExpr("e") + `::bigint AS participants,
  COALESCE(d.submitted, 0)::bigint AS submitted,
  COALESCE(d.avg_score, 0)::float8 AS avg_score,
  COALESCE(u.name, '') AS principal
FROM exams e
LEFT JOIN users u ON u.id = e.created_by
LEFT JOIN LATERAL (
  SELECT COUNT(1) AS submitted,
    AVG(CASE WHEN a.final_score IS NOT NULL THEN a.final_score ELSE a.score END)::float8 AS avg_score
  FROM attempts a
  WHERE a.exam_id = e.id AND a.status IN (` + doneStatuses + `)
) d ON true`

type historyRow struct {
	ExamID, Name, Subject, Code, Status, Principal string
	OpenAt, CloseAt                                time.Time
	Participants, Submitted                        int64
	AvgScore                                       float64
}

// historyList — GET /reports/history?q=&subject=&status=&from=&to=&limit=&cursor=
func (m *Module) historyList(w http.ResponseWriter, r *http.Request) {
	qp := r.URL.Query()
	limit := parseLimit(qp.Get("limit"), 20, 100)

	var cur *pageCursor
	if cs := strings.TrimSpace(qp.Get("cursor")); cs != "" {
		c, err := decodeCursor(cs)
		if err != nil {
			httpx.Error(w, err)
			return
		}
		cur = &c
	}

	conds := []string{"e.status <> 'draft'"}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, fmt.Sprintf(cond, len(args)))
	}
	if q := strings.TrimSpace(qp.Get("q")); q != "" {
		add(`(e.name ILIKE '%%'||$%d||'%%' OR e.exam_code ILIKE '%%'||$%d||'%%' OR e.subject_name ILIKE '%%'||$%d||'%%')`, q)
	}
	if subject := strings.TrimSpace(qp.Get("subject")); subject != "" {
		add(`e.subject_name ILIKE $%d`, subject)
	}
	if status := strings.TrimSpace(qp.Get("status")); status != "" {
		switch status {
		case "published", "archived", "draft":
			add(`e.status = $%d`, status)
		default:
			httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter status tidak valid (draft|published|archived)"))
			return
		}
	}
	if from := strings.TrimSpace(qp.Get("from")); from != "" {
		t, err := time.Parse("2006-01-02", from)
		if err != nil {
			httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter from tidak valid (YYYY-MM-DD)"))
			return
		}
		add(`e.open_at >= $%d::timestamptz`, t.Format(time.RFC3339))
	}
	if to := strings.TrimSpace(qp.Get("to")); to != "" {
		t, err := time.Parse("2006-01-02", to)
		if err != nil {
			httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Parameter to tidak valid (YYYY-MM-DD)"))
			return
		}
		add(`e.open_at < ($%d::timestamptz + interval '1 day')`, t.Format(time.RFC3339))
	}
	if cur != nil {
		args = append(args, cur.CloseAt.Format(time.RFC3339Nano), cur.ID)
		conds = append(conds, fmt.Sprintf(`(e.close_at, e.id) < ($%d::timestamptz, $%d::uuid)`, len(args)-1, len(args)))
	}

	query := historySQL + " WHERE " + strings.Join(conds, " AND ") +
		" ORDER BY e.close_at DESC, e.id DESC LIMIT " + strconv.Itoa(limit+1)

	tenantID, err := tenantOf(r)
	if err != nil {
		httpx.Error(w, err)
		return
	}

	items := []map[string]any{}
	next := ""
	err = m.a.DB.WithTenant(r.Context(), tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		rs := []historyRow{}
		for rows.Next() {
			var h historyRow
			if err := rows.Scan(&h.ExamID, &h.Name, &h.Subject, &h.Code, &h.Status, &h.OpenAt, &h.CloseAt,
				&h.Participants, &h.Submitted, &h.AvgScore, &h.Principal); err != nil {
				return err
			}
			rs = append(rs, h)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if len(rs) > limit {
			rs = rs[:limit]
			last := rs[len(rs)-1]
			next = encodeCursor(pageCursor{CloseAt: last.CloseAt, ID: last.ExamID})
		}
		for _, h := range rs {
			items = append(items, map[string]any{
				"exam_id": h.ExamID, "name": h.Name, "subject_name": h.Subject,
				"exam_code": h.Code, "status": h.Status,
				"open_at": h.OpenAt, "close_at": h.CloseAt,
				"participants": h.Participants, "submitted": h.Submitted,
				"avg_score": h.AvgScore, "principal": h.Principal,
			})
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": items, "next_cursor": next})
}
