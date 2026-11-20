package db

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.up.sql
var migrationsFS embed.FS

// EmbeddedMigrations memetakan nama file -> SQL untuk dipakai Migrate.
func EmbeddedMigrations() map[string]string {
	out := map[string]string{}
	entries, _ := migrationsFS.ReadDir("migrations")
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		b, err := migrationsFS.ReadFile("migrations/" + e.Name())
		if err == nil {
			out[e.Name()] = string(b)
		}
	}
	return out
}

// DB memegang dua pool:
//   - Admin: superuser, bypass RLS. Dipakai untuk auth (login cek email global),
//     migrasi, superadmin console, dan alur awal siswa (lookup kode ujian).
//   - App: role non-superuser, RLS aktif. Semua query data tenant WAJIB lewat sini.
type DB struct {
	Admin *pgxpool.Pool
	App   *pgxpool.Pool
}

func Connect(ctx context.Context, adminURL, appURL string) (*DB, error) {
	adminCfg, err := pgxpool.ParseConfig(adminURL)
	if err != nil {
		return nil, fmt.Errorf("parse admin url: %w", err)
	}
	adminCfg.MaxConns = 10
	// Lifecycle koneksi (keandalan): hindari koneksi lintas failover yang
	// menggantung tanpa disadari & perbarui koneksi secara merata.
	adminCfg.MaxConnLifetime = 30 * time.Minute  // siklus koneksi teratur
	adminCfg.MaxConnIdleTime = 30 * time.Second  // buang idle lama
	adminCfg.HealthCheckPeriod = 1 * time.Minute // cek kesehatan berkala
	admin, err := pgxpool.NewWithConfig(ctx, adminCfg)
	if err != nil {
		return nil, fmt.Errorf("connect admin: %w", err)
	}
	appCfg, err := pgxpool.ParseConfig(appURL)
	if err != nil {
		admin.Close()
		return nil, fmt.Errorf("parse app url: %w", err)
	}
	appCfg.MaxConns = 20
	appCfg.MaxConnLifetime = 30 * time.Minute
	appCfg.MaxConnIdleTime = 30 * time.Second
	appCfg.HealthCheckPeriod = 1 * time.Minute
	app, err := pgxpool.NewWithConfig(ctx, appCfg)
	if err != nil {
		admin.Close()
		return nil, fmt.Errorf("connect app: %w", err)
	}
	if err := admin.Ping(ctx); err != nil {
		admin.Close()
		app.Close()
		return nil, fmt.Errorf("ping admin: %w", err)
	}
	if err := app.Ping(ctx); err != nil {
		admin.Close()
		app.Close()
		return nil, fmt.Errorf("ping app (RLS role): %w", err)
	}
	return &DB{Admin: admin, App: app}, nil
}

func (d *DB) Close() {
	if d.Admin != nil {
		d.Admin.Close()
	}
	if d.App != nil {
		d.App.Close()
	}
}

// WithTenant menjalankan fn dalam satu transaksi pada pool App (RLS),
// dengan SET LOCAL app.tenant_id sehingga semua query dibatasi tenant tersebut.
// Bila transaksi gagal karena serialisasi/deadlock (SQLSTATE 40001/40P01) —
// kondisi normal saat beban tinggi (lonjakan Mulai/Submit) — fn diulang
// maksimum 3 kali dengan jeda singkat (keandalan data > latensi).
func (d *DB) WithTenant(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			// tunggu sebelum ulang: 50ms, 150ms
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(50*(attempt)) * time.Millisecond):
			}
		}
		err := d.withTenantOnce(ctx, tenantID, fn)
		if err == nil {
			return nil
		}
		lastErr = err
		if !retryableTxErr(err) {
			return err
		}
	}
	return lastErr
}

func (d *DB) withTenantOnce(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	tx, err := d.App.Begin(ctx)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", tenantID); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// retryableTxErr: konflik konkurensi Postgres yang wajar diulang.
func retryableTxErr(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 40001 serialization_failure, 40P01 deadlock_detected
		return pgErr.Code == "40001" || pgErr.Code == "40P01"
	}
	return strings.Contains(err.Error(), "deadlock detected") ||
		strings.Contains(err.Error(), "serialization failure")
}

// WithAdminTx menjalankan fn dalam transaksi pada pool Admin (bypass RLS).
// Hanya untuk operasi lintas-tenant yang sah: auth, registrasi, superadmin.
func (d *DB) WithAdminTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := d.Admin.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// Migrate menjalankan file migrasi SQL sekali (dipetakan nama -> SQL, sudah embed).
// Berjalan lewat koneksi superuser dengan simple protocol agar
// multi-statement per file didukung.
func Migrate(ctx context.Context, adminURL string, files map[string]string, logger *slog.Logger) error {
	names := []string{}
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	connCfg, err := pgx.ParseConfig(adminURL)
	if err != nil {
		return err
	}
	// simple protocol supaya satu file berisi banyak statement bisa dieksekusi.
	connCfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	conn, err := pgx.ConnectConfig(ctx, connCfg)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`); err != nil {
		return err
	}
	for _, name := range names {
		var exists bool
		if err := conn.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)", name).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sqlBytes := []byte(files[name])
		tx, err := conn.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migrate %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES ($1)", name); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		if logger != nil {
			logger.Info("migrasi diterapkan", "file", name)
		}
	}
	return nil
}

type Logger interface {
	Printf(format string, args ...any)
}
