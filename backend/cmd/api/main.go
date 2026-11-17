package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"flowcbt/backend/internal/platform"
	"flowcbt/backend/internal/server"
)

func main() {
	// C-13: image distroless tidak punya shell/wget. Binary yang sama diperintahkan
	// Dockerfile HEALTHCHECK untuk memeriksa server lokal lewat mode ini.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		healthcheck()
		return
	}
	cfg := platform.LoadConfig()
	if err := cfg.Validate(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	log := platform.NewLogger(cfg.Env)

	deps := server.NewDeps(cfg, log)
	if deps == nil {
		os.Exit(1)
	}
	defer deps.DB.Close()

	r := server.Router(deps)
	// C-02: batasi slowloris. WriteTimeout sengaja 0 karena endpoint SSE
	// (/api/v1/reports/live/stream) butuh koneksi panjang; B-07 akan menambahkan
	// heartbeat + SetWriteDeadline per-write sebelum timeout diaktifkan kembali.
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       120 * time.Second,
		WriteTimeout:      0,
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		log.Info("api listening", "addr", cfg.HTTPAddr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server", "err", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	log.Info("shutting down")
	shutCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
	defer c()
	_ = srv.Shutdown(shutCtx)

	var _ = slog.Default
}

func healthcheck() {
	addr := os.Getenv("HEALTHCHECK_ADDR")
	if addr == "" {
		addr = "http://127.0.0.1:8080/healthz"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(addr)
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusInternalServerError {
		os.Exit(1)
	}
}
