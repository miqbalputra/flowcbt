package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// PaymentProvider adalah antarmuka gateway pembayaran (PRD FR-10.4): Midtrans & Mayar (+ mock untuk dev/test).
type PaymentProvider interface {
	Name() string
	CreateCheckout(ctx context.Context, req CheckoutRequest) (checkoutURL, providerRef string, err error)
	VerifySignature(ctx context.Context, provider string, body []byte, signature string) bool
	HandleWebhook(ctx context.Context, tx pgx.Tx, payload []byte) error
}

type CheckoutRequest struct {
	OrderID   string
	AmountIDR int
	PlanCode  string
	Purpose   string // per_exam | monthly | upgrade
	TenantID  string
}

// activatePayment mengaktifkan paket setelah pembayaran terkonfirmasi (dipakai semua provider).
func activatePayment(ctx context.Context, tx pgx.Tx, orderID string) error {
	var (
		payID, tenantID, planID, purpose, status string
		amount                                   int
	)
	if err := tx.QueryRow(ctx,
		`SELECT id, tenant_id, plan_id, purpose, amount_idr, status FROM payments WHERE order_id=$1`, orderID).
		Scan(&payID, &tenantID, &planID, &purpose, &amount, &status); err != nil {
		return httpx.NotFound("order tidak ditemukan")
	}
	// B-04: notifikasi settlement kedua (atau webhook dengan body berbeda) harus aman.
	// Sudah paid → ACK tanpa mengulang kredit/langganan/invoice.
	if status == "paid" {
		return nil
	}
	if status != "pending" {
		return httpx.NotFound("order tidak dalam status pending")
	}
	if _, err := tx.Exec(ctx, `UPDATE payments SET status='paid', paid_at=now() WHERE id=$1`, payID); err != nil {
		return err
	}
	var planType string
	var quota *int
	var days *int
	var studentLimit int
	if err := tx.QueryRow(ctx, `SELECT type, exam_quota, duration_days, student_max FROM plans WHERE id=$1`, planID).
		Scan(&planType, &quota, &days, &studentLimit); err != nil {
		return err
	}
	now := time.Now().UTC()
	switch purpose {
	case "per_exam":
		if _, err := tx.Exec(ctx,
			`INSERT INTO exam_credits (tenant_id, plan_id, payment_id, quantity, used, student_limit) VALUES ($1,$2,$3,$4,0,$5)`,
			tenantID, planID, payID, *quota, studentLimit); err != nil {
			return err
		}
	case "monthly":
		dur := 30
		if days != nil {
			dur = *days
		}
		// akhiri SEMUA langganan aktif (trial/free incluido) — ada unique index satu aktif per tenant
		if _, err := tx.Exec(ctx,
			`UPDATE subscriptions SET status='expired' WHERE tenant_id=$1 AND status='active'`, tenantID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO subscriptions (tenant_id, plan_id, type, status, student_limit, exam_quota, exams_used, starts_at, ends_at, payment_id)
			 VALUES ($1,$2,'monthly','active',$3,NULL,0,$4,$5,$6)`,
			tenantID, planID, studentLimit, now, now.AddDate(0, 0, dur), payID); err != nil {
			return err
		}
		// perpanjangan membatalkan mode baca-saja & jadwal purge (AC-11)
		if _, err := tx.Exec(ctx,
			`UPDATE tenants SET status='active', access_ended_at=NULL, read_only_since=NULL, purge_after=NULL WHERE id=$1`, tenantID); err != nil {
			return err
		}
	case "upgrade":
		// prorata sederhana: tambah hari sesuai proporsi harga (PRD 3.2) — diimplementasikan sebagai perpanjangan bulanan +30 hari
		if _, err := tx.Exec(ctx,
			`UPDATE subscriptions SET ends_at = ends_at + interval '30 days' WHERE tenant_id=$1 AND status='active' AND type='monthly'`, tenantID); err != nil {
			return err
		}
	}
	// invoice
	invoiceNo := fmt.Sprintf("INV-%s-%s", now.Format("20060102"), strings.ToUpper(orderID[len(orderID)-6:]))
	var billingName, billingEmail string
	if err := tx.QueryRow(ctx, `SELECT name, email FROM users WHERE tenant_id=$1 AND role='owner' LIMIT 1`, tenantID).
		Scan(&billingName, &billingEmail); err != nil {
		billingName = "Tenant"
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO invoices (tenant_id, payment_id, invoice_no, billing_name, billing_email, amount_idr) VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (payment_id) DO NOTHING`,
		tenantID, payID, invoiceNo, billingName, billingEmail, amount); err != nil {
		return err
	}
	return nil
}

// helpers untuk decode payload webhook generik.
func decodePayload(payload []byte) map[string]any {
	var m map[string]any
	_ = json.Unmarshal(payload, &m)
	return m
}

func payloadOrderID(m map[string]any) string {
	for _, k := range []string{"order_id", "orderId", "id", "external_id"} {
		if v, ok := m[k].(string); ok {
			return v
		}
	}
	return ""
}

func payloadStatus(m map[string]any) string {
	for _, k := range []string{"transaction_status", "status", "state"} {
		if v, ok := m[k].(string); ok {
			return strings.ToLower(v)
		}
	}
	return ""
}
