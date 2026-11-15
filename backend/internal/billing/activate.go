package billing

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ActivateForTest mengekspos activatePayment untuk provider eksternal (mock/midtrans/mayar).
func ActivateForTest(ctx context.Context, tx pgx.Tx, orderID string) error {
	return activatePayment(ctx, tx, orderID)
}
