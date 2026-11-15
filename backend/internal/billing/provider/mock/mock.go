// Package mock adalah PaymentProvider untuk dev/sandbox/test tanpa akun Midtrans/Mayar.
// Mensimulasikan checkout sukses via webhook /webhooks/payment/mock.
package mock

import (
	"context"
	"encoding/json"
	"fmt"

	"flowcbt/backend/internal/billing"

	"github.com/jackc/pgx/v5"
)

type Provider struct {
	BaseURL string // URL publik API, untuk membuat tautan "checkout" mock
}

func (p *Provider) Name() string { return "mock" }

func (p *Provider) CreateCheckout(ctx context.Context, req billing.CheckoutRequest) (string, string, error) {
	ref := "MOCK-" + req.OrderID
	return fmt.Sprintf("%s/mock-checkout?order_id=%s&amount=%d", p.BaseURL, req.OrderID, req.AmountIDR), ref, nil
}

func (p *Provider) VerifySignature(ctx context.Context, provider string, body []byte, signature string) bool {
	return true // mock selalu lolos (webhook mock memanggil endpoint publik)
}

// HandleWebhook: payload {"order_id":"...","transaction_status":"settlement"}
func (p *Provider) HandleWebhook(ctx context.Context, tx pgx.Tx, payload []byte) error {
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return err
	}
	orderID, _ := m["order_id"].(string)
	status, _ := m["transaction_status"].(string)
	if status == "settlement" || status == "paid" || status == "success" {
		return billing.ActivateForTest(ctx, tx, orderID)
	}
	return nil
}
