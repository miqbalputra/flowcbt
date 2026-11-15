package platform

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB membungkus pool koneksi. Query tenant berjalan via WithTenantTx yang
// men-set `app.tenant_id` (RLS). WithSystemTx khusus proses lintas-tenant
// (login, webhook, worker retensi) yang memakai role BYPASSRLS.
type DB struct {
	App    *pgxpool.Pool // role flowcbt_app (RLS aktif)
	System *pgxpool.Pool // role flowcbt_system (BYPASSRLS)
}

func NewDB(ctx context.Context, cfg Config) (*DB, error) {
	appURL := cfg.DatabaseURL
	if cfg.AppDBUser != "" {
		appURL = replaceDBUser(appURL, cfg.AppDBUser, cfg.AppDBPassword)
	}
	sysURL := cfg.DatabaseURL
	if cfg.SystemDBUser != "" {
		sysURL = replaceDBUser(sysURL, cfg.SystemDBUser, cfg.SystemDBPass)
	}
	appPool, err := pgxpool.New(ctx, appURL)
	if err != nil {
		return nil, fmt.Errorf("app pool: %w", err)
	}
	sysPool, err := pgxpool.New(ctx, sysURL)
	if err != nil {
		return nil, fmt.Errorf("system pool: %w", err)
	}
	return &DB{App: appPool, System: sysPool}, nil
}

func replaceDBUser(rawURL, user, pass string) string {
	// bentuk sederhana: ganti userinfo pada postgres://user:pass@host/db
	out := rawURL
	if i := indexOf(rawURL, "://"); i >= 0 {
		rest := rawURL[i+3:]
		if j := indexOf(rest, "@"); j >= 0 {
			out = rawURL[:i+3] + user + ":" + pass + rest[j:]
		}
	}
	return out
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func (db *DB) Close() {
	if db.App != nil {
		db.App.Close()
	}
	if db.System != nil {
		db.System.Close()
	}
}

// WithTenantTx menjalankan fn dalam transaksi role app dengan app.tenant_id di-set (RLS).
func (db *DB) WithTenantTx(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	return db.withPoolTx(ctx, db.App, tenantID, fn)
}

// WithSystemTx menjalankan fn tanpa RLS (role sistem, BYPASSRLS) — dipakai login/webhook/worker.
func (db *DB) WithSystemTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return db.withPoolTx(ctx, db.System, "", fn)
}

func (db *DB) withPoolTx(ctx context.Context, pool *pgxpool.Pool, tenantID string, fn func(pgx.Tx) error) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire conn: %w", err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if tenantID != "" {
		if _, err := tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID); err != nil {
			return fmt.Errorf("set tenant: %w", err)
		}
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TenantQuery menjalankan query baca dalam transaksi dengan tenant di-set.
func (db *DB) TenantQuery(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	return db.WithTenantTx(ctx, tenantID, fn)
}
