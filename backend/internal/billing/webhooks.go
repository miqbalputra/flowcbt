package billing

// webhooks.go — callback payment gateway (tanpa auth; verifikasi signature).
//
// Kontrak (PRD M10 / FR-10.4):
//   POST /webhooks/payment/midtrans — notifikasi Midtrans:
//     {order_id, status_code, gross_amount, signature_key, transaction_status}.
//     Verifikasi: sha512(order_id + status_code + gross_amount + SERVER_KEY)
//     sama dengan signature_key. Idempoten: hanya transition 'pending'.
//   POST /webhooks/payment/mayar — {external_id|order_id, status}:
//     bila MAYAR_WEBHOOK_SECRET diset, HMAC-SHA256 body divalidasi
//     terhadap header X-Callback-Signature; status PAID → payment lunas.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"flowcbt/backend/internal/httpx"
)

// midtransServerKey membaca SERVER_KEY Midtrans dari environment.
func midtransServerKey() string { return strings.TrimSpace(os.Getenv("MIDTRANS_SERVER_KEY")) }

// konstanEq membandingkan dua string secara konstan-waktu (anti timing-attack).
func konstanEq(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// statusKenali memetakan transaction_status gateway → status internal.
func statusKenali(transactionStatus string) string {
	switch transactionStatus {
	case "settlement", "capture":
		return "paid"
	case "expire":
		return "expired"
	case "deny", "cancel":
		return "failed"
	default:
		return "pending"
	}
}

// webhookMidtrans — POST /webhooks/payment/midtrans.
// settlement/capture → payment 'paid' + hak paket; expire/deny/cancel → gagal.
func (m *Module) webhookMidtrans(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Body tidak terbaca"))
		return
	}
	var notif struct {
		OrderID           string `json:"order_id"`           // order_id dari checkout
		StatusCode        string `json:"status_code"`        // "200" sukses
		GrossAmount       string `json:"gross_amount"`       // "40000.00"
		SignatureKey      string `json:"signature_key"`      // sha512(order_id+status_code+gross_amount+SERVER_KEY)
		TransactionStatus string `json:"transaction_status"` // capture|settlement|deny|cancel|expire
		PaymentType       string `json:"payment_type"`
	}
	if err := json.Unmarshal(body, &notif); err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Body tidak valid"))
		return
	}
	serverKey := midtransServerKey()
	want := fmt.Sprintf("%x", sha512.Sum512([]byte(
		notif.OrderID+notif.StatusCode+notif.GrossAmount+serverKey)))
	if !konstanEq(notif.SignatureKey, want) {
		httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "SIGNATURE_INVALID",
			"Tanda tangan webhook tidak valid"))
		return
	}

	switch statusKenali(notif.TransactionStatus) {
	case "paid":
		if err := m.settlePaymentByOrderID(r.Context(), notif.OrderID); err != nil {
			httpx.Error(w, err)
			return
		}
	case "expired":
		_, _ = m.a.DB.Admin.Exec(r.Context(),
			`UPDATE payments SET status='expired', updated_at=now()
			 WHERE order_id=$1 AND status='pending'`, notif.OrderID)
	case "failed":
		_, _ = m.a.DB.Admin.Exec(r.Context(),
			`UPDATE payments SET status='failed', updated_at=now()
			 WHERE order_id=$1 AND status='pending'`, notif.OrderID)
	}
	httpx.OK(w, map[string]any{"ok": true})
}

// webhookMayar — POST /webhooks/payment/mayar.
// Mayar mengirim {external_id, status}; bila MAYAR_WEBHOOK_SECRET diset,
// verifikasi HMAC-SHA256 atas body mentah via header X-Callback-Signature.
//
// Keandalan (fail-closed):
//   - Secret diset   → tanda tangan WAJIB cocok (HMAC-SHA256, perbandingan
//     konstan-waktu — bukan sha512 plain prefix-secret yang lama).
//   - Secret kosong  → di production notifikasi DITOLAK 503 (fail-closed,
//     log error agar on-call tahu konfigurasi kurang); di development
//     tetap diproses untuk kenyamanan simulasi lokal.
func (m *Module) webhookMayar(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Body tidak terbaca"))
		return
	}
	secret := strings.TrimSpace(os.Getenv("MAYAR_WEBHOOK_SECRET"))
	if secret == "" && m.a.Cfg.Env == "production" {
		slog.Error("webhook mayar ditolak: MAYAR_WEBHOOK_SECRET tidak diset di production (fail-closed)",
			"remote", r.RemoteAddr)
		httpx.Error(w, httpx.NewErr(http.StatusServiceUnavailable, "WEBHOOK_NOT_CONFIGURED",
			"Verifikasi webhook belum dikonfigurasi; notifikasi ditolak"))
		return
	}
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		want := hex.EncodeToString(mac.Sum(nil))
		got := r.Header.Get("X-Callback-Signature")
		if !konstanEq(want, got) {
			httpx.Error(w, httpx.NewErr(http.StatusUnauthorized, "SIGNATURE_INVALID",
				"Tanda tangan webhook tidak valid"))
			return
		}
	}

	var p struct {
		ExternalID string `json:"external_id"` // id invoice Mayar
		OrderID    string `json:"order_id"`    // order_id dari checkout
		Status     string `json:"status"`      // PAID|paid|EXPIRED|...
	}
	if err := json.Unmarshal(body, &p); err != nil {
		httpx.Error(w, httpx.NewErr(http.StatusBadRequest, "BAD_REQUEST", "Body tidak valid"))
		return
	}
	orderID := p.OrderID
	if orderID == "" {
		orderID = p.ExternalID
	}
	switch statusKenali(p.Status) {
	case "paid":
		if err := m.applyPurchase(r.Context(), orderID); err != nil {
			httpx.Error(w, err)
			return
		}
	case "expired":
		_, _ = m.a.DB.Admin.Exec(r.Context(),
			`UPDATE payments SET status='expired', updated_at=now()
			 WHERE order_id=$1 AND status='pending'`, orderID)
	case "failed":
		_, _ = m.a.DB.Admin.Exec(r.Context(),
			`UPDATE payments SET status='failed', updated_at=now()
			 WHERE order_id=$1 AND status='pending'`, orderID)
	}
	httpx.OK(w, map[string]any{"ok": true})
}

// settlePaymentByOrderID mem-final-kan order 'pending' → lunas lalu
// menerapkan hak paket (applyPurchase) dalam satu transaksi Admin.
func (m *Module) settlePaymentByOrderID(ctx context.Context, orderID string) error {
	tag, err := m.a.DB.Admin.Exec(ctx, `
		UPDATE payments SET status='paid', paid_at=now(), snapshot_at=now()
		WHERE order_id=$1 AND status='pending'`, orderID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NewErr(http.StatusNotFound, "PAYMENT_NOT_FOUND", "Payment tidak ditemukan")
	}
	return m.applyPurchase(ctx, orderID)
}
