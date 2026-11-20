package billing

// checkout.go — pembuatan payment & riwayat invoice (PRD M10).
// FR-10.1: paket & harga; FR-10.2: langganan & kredit.

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// checkout — POST /billing/checkout {plan_code, provider:"midtrans"|"mayar"}.
// Membuat payment 'pending'; pembayaran nyata dikonfirmasi lewat webhook
// gateway atau simulate-pay (khusus env development).
func (m *Module) checkout(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	if c == nil || c.TenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "UNAUTHORIZED", "Tidak terautentikasi"))
		return
	}
	var req struct {
		PlanCode string `json:"plan_code" validate:"required"`
		Provider string `json:"provider" validate:"required"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	req.Provider = trimLower(req.Provider)
	if req.Provider != "midtrans" && req.Provider != "mayar" {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST",
			"provider harus midtrans atau mayar"))
		return
	}

	// 1) Paket harus ada & aktif.
	var (
		planID      string
		planKind    string
		planPrice   int
		planMaxStud int
	)
	err := m.a.DB.Admin.QueryRow(r.Context(), `
		SELECT id, kind, price_idr, max_students FROM plans
		WHERE code=$1 AND active=true`, req.PlanCode).
		Scan(&planID, &planKind, &planPrice, &planMaxStud)
	if errors.Is(err, pgx.ErrNoRows) {
		httpx.Error(w, httpx.NewErr(http.StatusNotFound, "PLAN_NOT_FOUND",
			"Paket tidak ditemukan"))
		return
	} else if err != nil {
		httpx.Error(w, err)
		return
	}

	// 2) Tier mengikuti jumlah siswa aktif terdaftar (PRD 3.1).
	nStudents, err := m.countActiveStudents(r.Context(), c.TenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if planMaxStud > 0 && nStudents > planMaxStud {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "TIER_TOO_LOW",
			"Jumlah siswa melebihi batas paket, pilih tier lebih besar"))
		return
	}

	// 3) Tiket order_id unik: "FT-YYYYMMDD-XXXX".
	orderID := newOrderID()
	for i := 0; i < 5; i++ {
		var dup bool
		if err := m.a.DB.Admin.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM payments WHERE order_id=$1)`, orderID).Scan(&dup); err != nil {
			httpx.Error(w, err)
			return
		}
		if !dup {
			break
		}
		orderID = newOrderID()
	}

	// 4) Simpan payment pending + invoice_url (halaman bayar internal).
	_, err = m.a.DB.Admin.Exec(r.Context(), `
		INSERT INTO payments(tenant_id, provider, order_id, plan_id, kind, amount_idr, status, invoice_url)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
		c.TenantID, req.Provider, orderID, planID, planKind, planPrice, "/billing/pay/"+orderID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	if err := m.auditLog(r.Context(), c.TenantID, c.UserID, "checkout", "payment", orderID,
		map[string]any{"plan_code": req.PlanCode, "provider": req.Provider}); err != nil {
		slog.Warn("billing: audit checkout gagal", "err", err)
	}

	httpx.Created(w, map[string]any{"data": map[string]any{
		"order_id":     orderID,
		"amount_idr":   planPrice,
		"provider":     req.Provider,
		"redirect_url": "/billing/pay/" + orderID,
		"status":       "pending",
		"created_at":   time.Now().UTC(),
	}})
}

// invoices — GET /billing/invoices (owner): riwayat payment terbaru.
func (m *Module) invoices(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	if c == nil || c.TenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "UNAUTHORIZED", "Tidak terautentikasi"))
		return
	}
	rows, err := m.a.DB.Admin.Query(r.Context(), `
		SELECT p.order_id, p.provider, p.kind, p.amount_idr, p.status,
		       COALESCE(pl.name, ''), p.invoice_url, p.created_at
		FROM payments p
		LEFT JOIN plans pl ON pl.id = p.plan_id
		WHERE p.tenant_id = $1
		ORDER BY p.created_at DESC
		LIMIT 100`, c.TenantID)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	defer rows.Close()

	invoices := []map[string]any{}
	for rows.Next() {
		var (
			orderID, provider, kind, status string
			amount                          int
			invoiceURL                      *string
			createdAt                       time.Time
			planName                        string
		)
		if err := rows.Scan(&orderID, &provider, &kind, &amount, &status, &planName, &invoiceURL, &createdAt); err != nil {
			httpx.Error(w, err)
			return
		}
		item := map[string]any{
			"order_id":   orderID,
			"provider":   provider,
			"kind":       kind,
			"amount_idr": amount,
			"status":     status,
			"created_at": createdAt,
		}
		if planName != "" {
			item["plan_name"] = planName
		}
		if invoiceURL != nil && *invoiceURL != "" {
			item["invoice_url"] = *invoiceURL
		}
		invoices = append(invoices, item)
	}
	httpx.OK(w, map[string]any{"data": invoices})
}

// ---- helper pembantu modul billing ----

// trimLower memotong spasi & lowercase (normalisasi input kecil).
func trimLower(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// randSuffix menghasilkan suffix acak sepanjang n karakter alfanumerik.
func randSuffix(n int) string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, n)
	for i := range b {
		x, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			b[i] = '0'
			continue
		}
		b[i] = charset[x.Int64()]
	}
	return string(b)
}

// newOrderID — "FT-" + YYYYMMDD + "-" + 4 karakter acak.
func newOrderID() string {
	return fmt.Sprintf("FT-%s-%s", time.Now().Format("20060102"), randSuffix(4))
}

// countActiveStudents menghitung siswa aktif tenant (non-tamu, non-merge).
func (m *Module) countActiveStudents(ctx context.Context, tenantID string) (int, error) {
	var n int
	err := m.a.DB.Admin.QueryRow(ctx, `
		SELECT COUNT(1) FROM students
		WHERE tenant_id=$1 AND status='active' AND is_guest=false AND merged_into_id IS NULL`,
		tenantID).Scan(&n)
	return n, err
}

// auditLog mencatat aksi sensitif ke audit_logs (tenant scoping tetap).
func (m *Module) auditLog(ctx context.Context, tenantID, actorID, action, entity, entityID string, meta map[string]any) error {
	var tid, aid *string
	if tenantID != "" {
		tid = &tenantID
	}
	if actorID != "" {
		aid = &actorID
	}
	metaJSON, _ := json.Marshal(meta)
	_, err := m.a.DB.Admin.Exec(ctx, `
		INSERT INTO audit_logs(tenant_id, actor_id, actor_role, action, entity, entity_id, meta)
		VALUES ($1, $2, 'owner', $3, $4, $5, $6::jsonb)`,
		tid, aid, action, entity, entityID, string(metaJSON))
	return err
}

var (
	_ = json.Marshal
	_ = pgx.ErrNoRows
	_ = rand.Reader
	_ = big.NewInt
	_ = http.MethodGet
	_ pgx.Tx
)
