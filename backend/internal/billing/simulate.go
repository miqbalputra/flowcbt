package billing

// simulate.go — penandaan pembayaran secara manual (khusus development).
// Endpoint ini memanggil applyPurchase sesuai skema DEV agreement.

import (
	"net/http"

	"flowcbt/backend/internal/ctxinfo"
	"flowcbt/backend/internal/httpx"
)

// simulatePay — POST /billing/simulate-pay {order_id} (owner).
func (m *Module) simulatePay(w http.ResponseWriter, r *http.Request) {
	c := ctxinfo.Claims(r.Context())
	if c == nil || c.TenantID == "" {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "UNAUTHORIZED", "Tidak terautentikasi"))
		return
	}
	var req struct {
		OrderID string `json:"order_id" validate:"required"`
	}
	if err := httpx.Decode(r, &req); err != nil {
		httpx.Error(w, err)
		return
	}
	if err := m.applyPurchase(r.Context(), req.OrderID); err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.OK(w, map[string]any{"data": map[string]any{
		"order_id": req.OrderID,
		"status":   "paid",
	}})
}
