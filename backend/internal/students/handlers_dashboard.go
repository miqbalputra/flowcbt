package students

import (
	"errors"
	"net/http"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// ---------- Dashboard (FR-2.1) ----------

// GET /dashboard — rollup cepat untuk halaman utama guru/admin.
func (m *Module) dashboard(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	tenantID := ctxinfo.TenantID(ctx)

	var (
		examsRunning, examsScheduled, examsOpenNow int
		classesCount                               int
		lastAvg                                    float64
		lastExamName                               string
	)
	err := m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error {
		// Ujian berjalan: published & now di antara open_at..close_at.
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM exams
			WHERE status='published' AND now() >= open_at AND now() <= close_at`).
			Scan(&examsRunning); err != nil {
			return err
		}
		// Dapat dibuka saat ini: published, jendela aktif, tidak pause, token aktif.
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM exams
			WHERE status='published' AND NOT paused AND token_active
			  AND now() >= open_at AND now() <= close_at`).
			Scan(&examsOpenNow); err != nil {
			return err
		}
		// Terjadwal: published & belum dibuka.
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM exams
			WHERE status='published' AND open_at > now()`).
			Scan(&examsScheduled); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(1) FROM classes WHERE archived=false`).Scan(&classesCount); err != nil {
			return err
		}
		// Rata-rata nilai ujian terakhir yang punya submit/graded.
		var avg *float64
		err := tx.QueryRow(ctx, `
			SELECT e.name, AVG(a.final_score)
			FROM attempts a JOIN exams e ON e.id = a.exam_id
			WHERE a.status IN ('submitted','graded')
			  AND a.exam_id = (
			    SELECT a2.exam_id FROM attempts a2 JOIN exams e2 ON e2.id = a2.exam_id
			    WHERE a2.status IN ('submitted','graded')
			    ORDER BY e2.created_at DESC, e2.id DESC LIMIT 1)
			GROUP BY e.name`).Scan(&lastExamName, &avg)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if avg != nil {
			lastAvg = *avg
		}
		return nil
	})
	if err != nil {
		httpx.Error(w, err)
		return
	}

	q, err := m.billing.Quota(ctx, tenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"exams_running":   examsRunning,
		"exams_scheduled": examsScheduled,
		"exams_open_now":  examsOpenNow,
		"students_count":  q.StudentsCount,
		"classes_count":   classesCount,
		"last_exam_avg":   lastAvg,
		"last_exam_name":  lastExamName,
		"quota":           q,
	}})
}
