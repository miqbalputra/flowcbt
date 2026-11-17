package notify

import (
	"context"
	"fmt"
	"time"

	"flowcbt/backend/internal/platform"

	"github.com/jackc/pgx/v5"
)

// EnqueueEmail menulis email ke outbox (B-10). Dipanggil dari request path — tidak
// melakukan I/O SMTP, sehingga SMTP mati tidak menambah latensi atau kehilangan email.
func (s *Service) EnqueueEmail(ctx context.Context, tenantID, to, subject, body, kind string) error {
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO email_outbox (tenant_id, to_email, subject, body, kind) VALUES ($1,$2,$3,$4,$5)`,
			tenantID, to, subject, body, kind)
		return err
	})
}

type outboxItem struct {
	ID       string
	TenantID string
	To       string
	Subject  string
	Body     string
	Attempts int
}

// ProcessOutbox mengirim email yang jatuh tempo dengan retry/backoff eksponensial.
// Maksimal 5 percobaan, lalu status 'failed' untuk inspeksi (bukan dibuang diam-diam).
func (s *Service) ProcessOutbox(ctx context.Context, batch int) (sent int, err error) {
	if s == nil || s.DB == nil || s.Mailer == nil {
		return 0, nil
	}
	if batch <= 0 {
		batch = 20
	}
	// Pulihkan baris yang ditinggalkan worker crash saat status 'sending'.
	_, _ = s.DB.System.Exec(ctx,
		`UPDATE email_outbox SET status='queued', next_attempt_at=now()
		 WHERE status='sending' AND created_at < now() - interval '5 minutes'`)

	rows, err := s.DB.System.Query(ctx,
		`SELECT id, tenant_id, to_email, subject, body, attempts FROM email_outbox
		 WHERE status IN ('queued','failed') AND next_attempt_at <= now() AND attempts < 5
		 ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, batch)
	if err != nil {
		return 0, err
	}
	var items []outboxItem
	for rows.Next() {
		var it outboxItem
		if err := rows.Scan(&it.ID, &it.TenantID, &it.To, &it.Subject, &it.Body, &it.Attempts); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, it)
	}
	rows.Close()
	if len(items) == 0 {
		return 0, nil
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	if _, err := s.DB.System.Exec(ctx,
		`UPDATE email_outbox SET status='sending' WHERE id = ANY($1::uuid[]) AND status IN ('queued','failed')`, ids); err != nil {
		return 0, err
	}

	for _, it := range items {
		sendErr := s.Mailer.Send(ctx, platform.Mail{To: it.To, Subject: it.Subject, Body: it.Body})
		attempts := it.Attempts + 1
		if sendErr == nil {
			if _, err := s.DB.System.Exec(ctx,
				`UPDATE email_outbox SET status='sent', sent_at=now(), attempts=$1, last_error=NULL WHERE id=$2`, attempts, it.ID); err != nil {
				return sent, err
			}
			sent++
			continue
		}
		backoff := time.Duration(1<<min(attempts, 4)) * time.Minute
		status := "failed"
		if attempts >= 5 {
			status = "failed" // sudah mentok; tetap disimpan untuk inspeksi
		}
		_, _ = s.DB.System.Exec(ctx,
			`UPDATE email_outbox SET status=$1, attempts=$2, next_attempt_at=now()+$3::interval, last_error=$4 WHERE id=$5`,
			status, attempts, backoff.String(), fmt.Sprint(sendErr), it.ID)
	}
	return sent, nil
}
