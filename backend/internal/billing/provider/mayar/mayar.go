// Package mayar: adapter Mayar (PRD FR-10.4, P1). Pola sama dengan Midtrans via antarmuka PaymentProvider.
package mayar

import (
	"context"
	"crypto/hmac"
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
	APIKey string
	BaseURL string // default https://api.mayar.id
	HTTP   *http.Client
}

func (p *Provider) Name() string { return "mayar" }

func (p *Provider) base() string {
	if p.BaseURL != "" {
		return p.BaseURL
	}
	return "https://api.mayar.id"
}

func (p *Provider) CreateCheckout(ctx context.Context, req billing.CheckoutRequest) (string, string, error) {
	hc := p.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: 20 * time.Second}
	}
	body := map[string]any{
		"name": req.OrderID, "amount": req.AmountIDR, "description": "FlowCBT " + req.PlanCode,
	}
	b, _ := json.Marshal(body)
	httpReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, p.base()+"/v1/payments", strings.NewReader(string(b)))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.APIKey)
	resp, err := hc.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	var out struct {
		Data struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", err
	}
	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("mayar error %d", resp.StatusCode)
	}
	return out.Data.URL, out.Data.ID, nil
}

func (p *Provider) VerifySignature(ctx context.Context, provider string, body []byte, signature string) bool {
	mac := hmac.New(sha256.New, []byte(p.APIKey))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil)) == signature
}

func (p *Provider) HandleWebhook(ctx context.Context, tx pgx.Tx, payload []byte) error {
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return err
	}
	data, _ := m["data"].(map[string]any)
	orderID, _ := data["name"].(string)
	status, _ := data["status"].(string)
	if status == "paid" || status == "success" {
		return billing.ActivateForTest(ctx, tx, orderID)
	}
	return nil
}
