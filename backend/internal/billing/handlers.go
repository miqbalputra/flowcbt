package billing

// handlers.go — registrasi rute modul billing.
// Semua endpoint billing terkumpul di sini: paket publik, langganan tenant,
// checkout, riwayat invoice, webhook gateway, dan konsol superadmin.

import (
	"net/http"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpmw"
	"flowcbt/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// Routes: paket harga (publik), langganan tenant, invoice, dan webhook.
func (m *Module) Routes(r chi.Router) {
	r.Get("/plans", m.listPlans)

	r.Group(func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner", "teacher", "superadmin"))
		r.Get("/billing/subscription", m.subscription)
	})

	r.Group(func(r chi.Router) {
		r.Use(httpmw.RequireAuth(m.a.Cfg.JWTSecret, "owner"))
		r.Post("/billing/checkout", m.checkout)
		r.Get("/billing/invoices", m.invoices)
		r.Get("/billing/export-all", m.exportAll)
		r.Post("/billing/simulate-pay", m.simulatePay)
	})

	r.Post("/webhooks/payment/midtrans", m.webhookMidtrans)
	r.Post("/webhooks/payment/mayar", m.webhookMayar)
	m.RoutesAdmin(r)
}

func (m *Module) listPlans(w http.ResponseWriter, r *http.Request) {
	rows, err := m.a.DB.Admin.Query(r.Context(), `
		SELECT code, name, kind, price_idr, min_students, max_students, exam_quota, duration_days, description
		FROM plans WHERE active=true ORDER BY sort_order`)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	defer rows.Close()
	plans := []map[string]any{}
	for rows.Next() {
		var code, name, kind, desc string
		var price, minS, maxS int
		var quota, dur *int
		if err := rows.Scan(&code, &name, &kind, &price, &minS, &maxS, &quota, &dur, &desc); err != nil {
			httpx.Error(w, err)
			return
		}
		p := map[string]any{
			"code": code, "name": name, "kind": kind, "price_idr": price,
			"min_students": minS, "max_students": maxS, "description": desc,
		}
		if quota != nil {
			p["exam_quota"] = *quota
		}
		if dur != nil {
			p["duration_days"] = *dur
		}
		plans = append(plans, p)
	}
	httpx.OK(w, map[string]any{"data": plans})
}

func (m *Module) subscription(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	if c.TenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "NO_TENANT", "Akun tanpa tenant"))
		return
	}
	q, err := m.Quota(r.Context(), c.TenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": q})
}
