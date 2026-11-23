package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"flowcbt/backend/internal/api"
	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/auth"
	"flowcbt/backend/internal/config"
	"flowcbt/backend/internal/db"
)

func main() {
	cfg := config.Load()
	if err := cfg.FailFast(); err != nil {
		slog.Error("tolak start", "err", err)
		os.Exit(1)
	}
	ctx := context.Background()

	if err := db.Migrate(ctx, cfg.DatabaseURL, db.EmbeddedMigrations(), slog.Default()); err != nil {
		slog.Error("migrasi gagal", "err", err)
		os.Exit(1)
	}
	database, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabaseAppURL)
	if err != nil {
		slog.Error("koneksi DB gagal", "err", err)
		os.Exit(1)
	}
	seed(ctx, database, cfg)

	a := app.New(cfg, database)
	srv := &http.Server{
		Addr:    ":" + cfg.HTTPPort,
		Handler: api.NewRouter(a),
		// WriteTimeout HARUS 0: koneksi SSE laporan real-time (FR-9.3) hidup
		// hingga 30 menit. Batas baca header ketat (slowloris); batas body
		// dilakukan per-request di httpx.Decode.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		slog.Info("FlowCBT API berjalan", "port", cfg.HTTPPort, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server berhenti", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	slog.Info("mematikan server...")
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	database.Close()
}

// seed memastikan superadmin platform ada.
func seed(ctx context.Context, d *db.DB, cfg *config.Config) {
	var count int
	if err := d.Admin.QueryRow(ctx, `SELECT COUNT(1) FROM users WHERE role='superadmin'`).Scan(&count); err != nil {
		return
	}
	if count > 0 {
		return
	}
	hash, err := auth.HashPassword(cfg.SeedSuperAdminPass)
	if err != nil {
		return
	}
	_, err = d.Admin.Exec(ctx, `
		INSERT INTO users(name, email, password_hash, role, status, email_verified_at)
		VALUES ('Super Admin FlowCBT', $1, $2, 'superadmin', 'active', now())
		ON CONFLICT DO NOTHING`, cfg.SeedSuperAdminEmail, hash)
	if err != nil {
		slog.Warn("seed superadmin", "err", err)
	} else {
		slog.Info("superadmin dibuat", "email", cfg.SeedSuperAdminEmail)
	}
}
