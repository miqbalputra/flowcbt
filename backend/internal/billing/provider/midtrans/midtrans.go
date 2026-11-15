// Package midtrans: adapter Midtrans Snap (PRD FR-10.4). Sandbox/production via env.
package midtrans

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"flowcbt/backend/internal/billing"

	"github.com/jackc/pgx/v5"
)

type Provider struct {
	ServerKey    string
	ClientKey    string
	IsProduction bool
	HTTP         *http.Client
}

func (p *Provider) Name() string { return "midtrans" }

func (p *Provider) snapBase() string {
	if p.IsProduction {
		return "https://app.midtrans.com"
	}
	return "https://app.sandbox.midtrans.com"
}

func (p *Provider) CreateCheckout(ctx context.Context, req billing.CheckoutRequest) (string, string, error) {
	url := p.snapBase() + "/snap/v1/transactions"
	body := map[string]any{
		"transaction_details": map[string]any{
			"order_id": req.OrderID, "gross_amount": req.AmountIDR,
		},
		"item_details": []any{map[string]any{
			"id": req.PlanCode, "price": req.AmountIDR, "quantity": 1, "name": "FlowCBT " + req.PlanCode,
		}},
	}
	b, _ := json.Marshal(body)
	hc := p.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 20 * time.Second}
	}
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(string(b)))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.SetBasicAuth(p.ServerKey, "")
	resp, err := hc.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	var out struct {
		Token       string `json:"token"`
		RedirectURL string `json:"redirect_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", err
	}
	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("midtrans error %d", resp.StatusCode)
	}
	return out.RedirectURL, out.Token, nil
}

// VerifySignature: signature_key = sha512(order_id + status_code + gross_amount + serverKey) (dokumen Midtrans).
func (p *Provider) VerifySignature(ctx context.Context, provider string, body []byte, signature string) bool {
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return false
	}
	orderID, _ := m["order_id"].(string)
	status, _ := m["status_code"].(string)
	gross, _ := m["gross_amount"].(string)
	sum := sha256.Sum256([]byte(orderID + status + gross + p.ServerKey))
	return hex.EncodeToString(sum[:]) == signature
}

// HandleWebhook: status settlement/capture → aktifkan paket.
func (p *Provider) HandleWebhook(ctx context.Context, tx pgx.Tx, payload []byte) error {
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return err
	}
	status, _ := m["transaction_status"].(string)
	orderID, _ := m["order_id"].(string)
	switch status {
	case "settlement", "capture":
		return billing.ActivateForTest(ctx, tx, orderID)
	case "deny", "expire", "cancel":
		_, err := tx.Exec(ctx, `UPDATE payments SET status='failed' WHERE order_id=$1`, orderID)
		return err
	}
	return nil
}
