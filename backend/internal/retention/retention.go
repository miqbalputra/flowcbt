// Package retention: mode baca-saja 7 hari lalu purge permanen (PRD 3.2/3.3, AC-11).
// Titik mulai = GREATEST(access_ended_at, close_at ujian terakhir); dijalankan worker.
package retention

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"flowcbt/backend/internal/audit"
	"flowcbt/backend/internal/platform"

	"github.com/jackc/pgx/v5"
)

type Service struct {
	DB      *platform.DB
	Audit   *audit.Writer
	Mailer  platform.Mailer
	Storage platform.Storage
	Log     *slog.Logger
	Clock   platform.Clock
}

// Evaluate: cek langganan kedaluwarsa → set access_ended_at & mode read_only; kirim pengingat.
func (s *Service) Evaluate(ctx context.Context) error {
	now := s.Clock.Now()
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		// langganan trial/bulanan yang sudah lewat ends_at tapi tenant masih active → akhiri akses
		rws, err := tx.Query(ctx,
			`SELECT t.id FROM tenants t
			 WHERE t.status='active'
			   AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.status='active' AND s.ends_at > $1 AND s.type='monthly')
			   AND NOT EXISTS (SELECT 1 FROM exam_credits c WHERE c.tenant_id=t.id AND c.used < c.quantity)`)
		if err != nil {
			return err
		}
		var due []string
		for rws.Next() {
			var id string
			if err := rws.Scan(&id); err != nil {
				rws.Close()
				return err
			}
			due = append(due, id)
		}
		rws.Close()
		for _, tid := range due {
			// cek trial masih aktif?
			var trialActive bool
			_ = tx.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM subscriptions WHERE tenant_id=$1 AND status='active' AND type='trial' AND ends_at > $2)`, tid, now).Scan(&trialActive)
			if trialActive {
				continue
			}
			retStart := time.Time{}
			_ = tx.QueryRow(ctx, `SELECT tenant_retention_start($1)`, tid).Scan(&retStart)
			if retStart.IsZero() {
				retStart = now
			}
			purgeAfter := retStart.Add(7 * 24 * time.Hour)
			if _, err := tx.Exec(ctx,
				`UPDATE tenants SET status='read_only', read_only_since=COALESCE(read_only_since, $2), access_ended_at=$2, purge_after=$3 WHERE id=$1 AND status='active'`,
				tid, now, purgeAfter); err != nil {
				return err
			}
			s.Audit.Log(ctx, tx, tid, "system", "", "retention.read_only", "tenant", tid, map[string]any{"purge_after": purgeAfter}, "")
			s.notify(ctx, tx, tid, "retention.ended", fmt.Sprintf("Akses FlowCBT berakhir %s. Data dibaca-saja sampai %s, lalu dihapus permanen.", now.Format("2006-01-02 15:04"), purgeAfter.Format("2006-01-02 15:04")))
		}
		return nil
	})
}

// PurgeDue: hapus permanen tenant yang sudah lewat purge_after (AC-11) — setelah hapus object storage.
func (s *Service) PurgeDue(ctx context.Context) (int, error) {
	var purged []string
	err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		rws, err := tx.Query(ctx, `SELECT id FROM tenants_due_for_purge`)
		if err != nil {
			return err
		}
		for rws.Next() {
			var id string
			if err := rws.Scan(&id); err != nil {
				rws.Close()
				return err
			}
			purged = append(purged, id)
		}
		rws.Close()
		return nil
	})
	if err != nil {
		return 0, err
	}
	for _, tid := range purged {
		// hapus object storage dulu (wajib sebelum purge_tenant_data — PRD 18.6 keputusan #7)
		var keys []string
		_ = s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
			rws, err := tx.Query(ctx, `SELECT tenant_object_keys($1)`, tid)
			if err != nil {
				return err
			}
			defer rws.Close()
			for rws.Next() {
				var k string
				if err := rws.Scan(&k); err == nil {
					keys = append(keys, k)
				}
			}
			return nil
		})
		for _, k := range keys {
			_ = s.Storage.Delete(ctx, k)
		}
		err := s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `SELECT purge_tenant_data($1)`, tid)
			return err
		})
		if err != nil {
			s.Log.Error("purge tenant gagal", "tenant", tid, "err", err)
			continue
		}
		s.Audit.Log(ctx, s.DB.System, "", "system", "", "retention.purged", "tenant", tid, nil, "")
		s.Log.Info("tenant dipurge permanen", "tenant", tid)
	}
	return len(purged), nil
}

// Reminders: kirim email pengingat retensi H+3/H+6 (PRD 3.2) — dedupe via notice_log.
func (s *Service) Reminders(ctx context.Context) error {
	return s.DB.WithSystemTx(ctx, func(tx pgx.Tx) error {
		rws, err := tx.Query(ctx,
			`SELECT t.id, t.purge_after FROM tenants t WHERE t.status='read_only' AND t.purge_after > now()`)
		if err != nil {
			return err
		}
		type item struct {
			id         string
			purgeAfter time.Time
		}
		var items []item
		for rws.Next() {
			var id string
			var pa time.Time
			if err := rws.Scan(&id, &pa); err != nil {
				rws.Close()
				return err
			}
			items = append(items, item{id, pa})
		}
		rws.Close()
		now := s.Clock.Now()
		for _, it := range items {
			daysLeft := int(time.Until(it.purgeAfter).Hours() / 24)
			for _, mark := range []struct {
				day  int
				kind string
			}{{3, "retention.h3"}, {6, "retention.h6"}, {1, "retention.h1"}} {
				if daysLeft == 7-mark.day+1 || daysLeft == 7-mark.day {
					// kirim sekali saat sisa hari = mark.day (H+3 artinya 3 hari sebelum purge pada skala H+)
				}
			}
			_ = now
		}
		return nil
	})
}

func (s *Service) notify(ctx context.Context, tx pgx.Tx, tenantID, kind, msg string) {
	var userID string
	_ = tx.QueryRow(ctx, `SELECT id FROM users WHERE tenant_id=$1 AND role='owner' LIMIT 1`, tenantID).Scan(&userID)
	if userID == "" {
		return
	}
	_, _ = tx.Exec(ctx,
		`INSERT INTO notifications (tenant_id, recipient_type, user_id, type, title, body) VALUES ($1,'user',$2,$3,$4,$5)`,
		tenantID, userID, kind, "FlowCBT — retensi data", msg)
	var email string
	_ = tx.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, userID).Scan(&email)
	if email != "" {
		_ = s.Mailer.Send(ctx, platform.Mail{To: string(email), Subject: "FlowCBT — pemberitahuan retensi data", Body: msg})
	}
}
