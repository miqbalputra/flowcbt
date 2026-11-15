// Package notify: notifikasi in-app + email via job (M13, FR-13.x).
package notify

import (
	"context"

	"flowcbt/backend/internal/platform"

	"github.com/jackc/pgx/v5"
)

type Service struct {
	DB     *platform.DB
	Mailer platform.Mailer
}

// NotifyUser membuat notifikasi in-app untuk user tertentu.
func (s *Service) NotifyUser(ctx context.Context, tenantID, userID, typ, title, body string, data map[string]any) {
	_ = s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO notifications (tenant_id, recipient_type, user_id, type, title, body, data) VALUES ($1,'user',$2,$3,$4,$5,$6)`,
			tenantID, userID, typ, title, body, data)
		return err
	})
}

// NotifyStudent membuat notifikasi in-app untuk siswa.
func (s *Service) NotifyStudent(ctx context.Context, tenantID, studentID, typ, title, body string, data map[string]any) {
	_ = s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO notifications (tenant_id, recipient_type, student_id, type, title, body, data) VALUES ($1,'student',$2,$3,$4,$5,$6)`,
			tenantID, studentID, typ, title, body, data)
		return err
	})
}

// List untuk user yang sedang login.
func (s *Service) List(ctx context.Context, tenantID, userID string) ([]map[string]any, error) {
	var out []map[string]any
	err := s.DB.WithTenantTx(ctx, tenantID, func(tx pgx.Tx) error {
		rws, err := tx.Query(ctx,
			`SELECT id, type, title, body, read_at, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, userID)
		if err != nil {
			return err
		}
		defer rws.Close()
		for rws.Next() {
			var id, typ, title string
			var body *string
			var readAt, created any
			if err := rws.Scan(&id, &typ, &title, &body, &readAt, &created); err != nil {
				return err
			}
			out = append(out, map[string]any{"id": id, "type": typ, "title": title, "body": body, "read_at": readAt, "created_at": created})
		}
		return rws.Err()
	})
	return out, err
}
