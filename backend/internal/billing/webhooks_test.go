package billing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/config"
)

// TestWebhookMayarFailClosedProduction — tanpa MAYAR_WEBHOOK_SECRET di
// production notifikasi DITOLAK 503 (#3b fail-closed), bukan diproses entah
// oleh siapa pun.
func TestWebhookMayarFailClosedProduction(t *testing.T) {
	t.Setenv("MAYAR_WEBHOOK_SECRET", "")
	cfg := &config.Config{Env: "production"}
	m := Init(app.New(cfg, nil))
	req := httptest.NewRequest(http.MethodPost, "/webhooks/payment/mayar",
		strings.NewReader(`{"order_id":"o-1","status":"PAID"}`))
	rr := httptest.NewRecorder()
	m.webhookMayar(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("production tanpa secret seharusnya 503, dapat %d (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "WEBHOOK_NOT_CONFIGURED") {
		t.Errorf("body seharusnya WEBHOOK_NOT_CONFIGURED: %s", rr.Body.String())
	}
}

// TestWebhookMayarFailOpenDevelopment — tanpa secret di development masih
// diproses (simulasi lokal; syarat sukses jalur ini menempuh jalur tanpa DB:
// status tak dikenal → default 'pending' → tidak menyentuh pool).
func TestWebhookMayarFailOpenDevelopment(t *testing.T) {
	t.Setenv("MAYAR_WEBHOOK_SECRET", "")
	cfg := &config.Config{Env: "development"}
	m := Init(app.New(cfg, nil))
	req := httptest.NewRequest(http.MethodPost, "/webhooks/payment/mayar",
		strings.NewReader(`{"external_id":"inv-1","status":"PENDING_WAITING_PAYMENT"}`))
	rr := httptest.NewRecorder()
	m.webhookMayar(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("development tanpa secret seharusnya 200 (simulasi), dapat %d (%s)", rr.Code, rr.Body.String())
	}
}

// TestWebhookMayarHMACValid — verifikasi HMAC-SHA256 atas body mentah
// (#3a) diterima: signature benar → 200.
func TestWebhookMayarHMACValid(t *testing.T) {
	t.Setenv("MAYAR_WEBHOOK_SECRET", "testsecret")
	cfg := &config.Config{Env: "development"}
	m := Init(app.New(cfg, nil))
	body := `{"order_id":"o-1","status":"PENDING"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/payment/mayar", strings.NewReader(body))
	mac := hmac.New(sha256.New, []byte("testsecret"))
	mac.Write([]byte(body))
	req.Header.Set("X-Callback-Signature", hex.EncodeToString(mac.Sum(nil)))
	rr := httptest.NewRecorder()
	m.webhookMayar(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("HMAC valid seharusnya 200, dapat %d (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"ok":true`) {
		t.Errorf("body seharusnya {\"ok\":true}: %s", rr.Body.String())
	}
}

// TestWebhookMayarHMACInvalid — signature salah → 401 SIGNATURE_INVALID.
func TestWebhookMayarHMACInvalid(t *testing.T) {
	t.Setenv("MAYAR_WEBHOOK_SECRET", "testsecret")
	cfg := &config.Config{Env: "development"}
	m := Init(app.New(cfg, nil))
	body := `{"order_id":"o-1","status":"PAID"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/payment/mayar", strings.NewReader(body))
	req.Header.Set("X-Callback-Signature", "0000")
	rr := httptest.NewRecorder()
	m.webhookMayar(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("HMAC salah seharusnya 401, dapat %d (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "SIGNATURE_INVALID") {
		t.Errorf("body seharusnya SIGNATURE_INVALID: %s", rr.Body.String())
	}
}

// TestStatusKenali mapping status gateway → internal.
func TestStatusKenali(t *testing.T) {
	cases := map[string]string{
		"settlement": "paid", "capture": "paid",
		"expire": "expired",
		"deny":   "failed", "cancel": "failed",
		"waiting": "pending",
	}
	for in, want := range cases {
		if got := statusKenali(in); got != want {
			t.Errorf("statusKenali(%q)=%q, mau %q", in, got, want)
		}
	}
}
