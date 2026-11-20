package billing

// purchase.go — pemfinalan pembayaran (PRD M10).
//
// applyPurchase dipanggil webhook payment gateway (webhooks.go) dan
// simulate-pay setelah notifikasi lunas terverifikasi:
//   - payments.status 'pending' → 'paid' (idempoten);
//   - langganan aktif lama diekspire, subscription baru dibuat;
//   - tenant yang sempat read_only dipulihkan ke 'active'.

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"flowcbt/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

// errPaymentNotFound — order_id tidak dikenal saat pemfinalan (404).
var errPaymentNotFound = httpx.NewErr(http.StatusNotFound, "PAYMENT_NOT_FOUND", "Payment tidak ditemukan")

// planInfo data plan untuk perhitungan langganan hasil pembelian.
type planInfo struct {
	Kind         string // monthly | per_exam | trial
	DurationDays *int   // NULL = default
	ExamQuota    *int   // NULL = tanpa batas (bulanan)
}

// applyPurchase — payment pending → paid + berikan hak paket.
func (m *Module) applyPurchase(ctx context.Context, orderID string) error {
	tx, err := m.a.DB.Admin.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // noop setelah Commit

	var (
		payID     string
		payTenant string
		planID    *string
		payStatus string
	)
	if err := tx.QueryRow(ctx, `
		SELECT id::text, COALESCE(tenant_id::text,''), COALESCE(plan_id::text,''), status
		FROM payments WHERE order_id = $1 FOR UPDATE`, orderID).
		Scan(&payID, &payTenant, &planID, &payStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errPaymentNotFound
		}
		return err
	}
	if payStatus != "pending" {
		// Sudah final (webhook ulang / rekonsiliasi) — idempoten.
		return nil
	}

	// Baca plan utk kind, durasi, dan kuota ujian.
	var plan planInfo
	plan.Kind = "monthly" // fallback aman
	if planID != nil && *planID != "" {
		var d *int
		var q *int
		var kind string
		if err := tx.QueryRow(ctx, `SELECT kind, duration_days, exam_quota FROM plans WHERE id=$1`,
			*planID).Scan(&kind, &d, &q); err == nil {
			plan.Kind = kind
			plan.DurationDays = d
			plan.ExamQuota = q
		}
	}

	// 1) payment lunas.
	if _, err := tx.Exec(ctx, `
		UPDATE payments SET status='paid', paid_at=now(), snapshot_at=now(), updated_at=now()
		WHERE id=$1`, payID); err != nil {
		return err
	}

	// 2) Langganan aktif lama diekspire, lalu subscription baru dibuat.
	if _, err := tx.Exec(ctx,
		`UPDATE subscriptions SET status='expired' WHERE tenant_id=$1 AND status='active'`,
		payTenant); err != nil {
		return err
	}

	// 3) Subscription baru mengikuti kind paket.
	durDays := 30
	if plan.DurationDays != nil && *plan.DurationDays > 0 {
		durDays = *plan.DurationDays
	}
	endsAt := time.Now().AddDate(0, 0, durDays)
	if _, err := tx.Exec(ctx, `
		INSERT INTO subscriptions(tenant_id, plan_id, kind, starts_at, ends_at, status, payment_id)
		VALUES ($1, $2, $3, now(), $4, 'active', $5)`,
		payTenant, planID, plan.Kind, endsAt, payID); err != nil {
		return err
	}

	// 4) Kuota ujian utk paket per ujian (exam_quota dari plan).
	if plan.ExamQuota != nil && *plan.ExamQuota > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO exam_credits(tenant_id, payment_id, quantity, used, note)
			VALUES ($1, $2, $3, 0, $4)`,
			payTenant, payID, *plan.ExamQuota, "Kuota ujian paket per ujian"); err != nil {
			return err
		}
	}

	// 5) Pulihkan tenant dari masa baca-saja (perpanjangan dalam retensi).
	if _, err := tx.Exec(ctx, `
		UPDATE tenants SET status='active', retention_started_at=NULL, retention_delete_at=NULL, updated_at=now()
		WHERE id=$1 AND status IN ('read_only','suspended')`, payTenant); err != nil {
		return err
	}

	slog.Info("purchase diterapkan", "order_id", orderID, "tenant", payTenant, "kind", plan.Kind)
	return tx.Commit(ctx)
}
