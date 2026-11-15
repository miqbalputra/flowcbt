// Package admin: Super Admin console minimal (M12, FR-12.1–12.3): tenant, paket, pembayaran, metrik.
package admin

import (
	"net/http"
	"time"

	"flowcbt/backend/internal/httpx"
	"flowcbt/backend/internal/platform"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Service struct {
	DB    *platform.DB
	Clock platform.Clock
}

func (s *Service) Routes(r chi.Router) {
	r.Route("/admin", func(r chi.Router) {
		r.Get("/tenants", s.listTenants)
		r.Post("/tenants/{id}/status", s.setTenantStatus)
		r.Get("/plans", s.listPlans)
		r.Put("/plans/{id}", s.updatePlan)
		r.Get("/payments", s.listPayments)
		r.Get("/metrics", s.metrics)
	})
}

func (s *Service) listTenants(w http.ResponseWriter, r *http.Request) {
	var rows []map[string]any
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT t.id, t.code, t.name, t.level, t.status, t.created_at, t.access_ended_at, t.purge_after,
			        u.active_students, t.storage_used_bytes, t.storage_quota_bytes
			 FROM tenants t LEFT JOIN tenant_usage u ON u.tenant_id=t.id ORDER BY t.created_at DESC LIMIT 200`)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, code, name, level, status string
			var created time.Time
			var ended, purge any
			var active *int64
			var used, quota int64
			if err := rws.Scan(&id, &code, &name, &level, &status, &created, &ended, &purge, &active, &used, &quota); err != nil {
				return err
			}
			rows = append(rows, map[string]any{
				"id": id, "code": code, "name": name, "level": level, "status": status,
				"created_at": created, "access_ended_at": ended, "purge_after": purge,
				"active_students": active, "storage_used": used, "storage_quota": quota,
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

func (s *Service) setTenantStatus(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status string `json:"status"` // active | suspended | read_only
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	id := chi.URLParam(r, "id")
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `UPDATE tenants SET status=$1 WHERE id=$2`, in.Status, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("tenant tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) listPlans(w http.ResponseWriter, r *http.Request) {
	var rows []map[string]any
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(), `SELECT id, code, name, type, price_idr, student_min, student_max, exam_quota, duration_days, is_active, sort_order FROM plans ORDER BY sort_order`)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, code, name, typ string
			var price, smin, smax, sort int
			var quota, days *int
			var active bool
			if err := rws.Scan(&id, &code, &name, &typ, &price, &smin, &smax, &quota, &days, &active, &sort); err != nil {
				return err
			}
			rows = append(rows, map[string]any{"id": id, "code": code, "name": name, "type": typ, "price_idr": price, "student_min": smin, "student_max": smax, "exam_quota": quota, "duration_days": days, "is_active": active, "sort_order": sort})
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

func (s *Service) updatePlan(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PriceIDR   *int   `json:"price_idr"`
		StudentMin *int   `json:"student_min"`
		StudentMax *int   `json:"student_max"`
		ExamQuota  *int   `json:"exam_quota"`
		IsActive   *bool  `json:"is_active"`
	}
	if err := httpx.DecodeJSON(r, &in); err != nil {
		httpx.WriteError(w, err)
		return
	}
	id := chi.URLParam(r, "id")
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(),
			`UPDATE plans SET price_idr=COALESCE($1, price_idr), student_min=COALESCE($2, student_min), student_max=COALESCE($3, student_max),
			    exam_quota=COALESCE($4, exam_quota), is_active=COALESCE($5, is_active) WHERE id=$6`,
			in.PriceIDR, in.StudentMin, in.StudentMax, in.ExamQuota, in.IsActive, id)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.NotFound("paket tidak ditemukan")
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) listPayments(w http.ResponseWriter, r *http.Request) {
	var rows []map[string]any
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		rws, err := tx.Query(r.Context(),
			`SELECT p.order_id, p.tenant_name_snap, p.provider, p.amount_idr, p.status, p.paid_at, p.created_at, pl.name
			 FROM payments p JOIN plans pl ON pl.id=p.plan_id ORDER BY p.created_at DESC LIMIT 200`)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var order, tenant, provider, status, plan string
			var amount int
			var paid, created *time.Time
			if err := rws.Scan(&order, &tenant, &provider, &amount, &status, &paid, &created, &plan); err != nil {
				return err
			}
			rows = append(rows, map[string]any{"order_id": order, "tenant": tenant, "provider": provider, "amount_idr": amount, "status": status, "paid_at": paid, "created_at": created, "plan": plan})
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

func (s *Service) metrics(w http.ResponseWriter, r *http.Request) {
	var out map[string]any
	err := s.DB.WithSystemTx(r.Context(), func(tx pgx.Tx) error {
		q := func(sql string) any {
			var v any
			_ = tx.QueryRow(r.Context(), sql).Scan(&v)
			return v
		}
		out = map[string]any{
			"tenants":            q(`SELECT count(*) FROM tenants`),
			"tenants_active":     q(`SELECT count(*) FROM tenants WHERE status='active'`),
			"users":              q(`SELECT count(*) FROM users`),
			"students":           q(`SELECT count(*) FROM students WHERE merged_into_id IS NULL`),
			"exams_published":    q(`SELECT count(*) FROM exams WHERE status='published'`),
			"attempts_total":     q(`SELECT count(*) FROM attempts`),
			"attempts_in_progress": q(`SELECT count(*) FROM attempts WHERE status='in_progress'`),
			"payments_paid":      q(`SELECT count(*) FROM payments WHERE status='paid'`),
			"revenue_idr":        q(`SELECT COALESCE(sum(amount_idr),0) FROM payments WHERE status='paid'`),
			"flagged":            q(`SELECT count(*) FROM attempts WHERE cheating_status='flagged'`),
		}
		return nil
	})
	if err != nil {
		httpx.WriteError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
