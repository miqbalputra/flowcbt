package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"flowcbt/backend/internal/attempt"
	"flowcbt/backend/internal/platform"
	"flowcbt/backend/internal/server"
)

// worker menjalankan job periodik (PRD cmd/worker): auto-submit deadline, retensi 7 hari,
// pembersihan snapshot, rekonsiliasi. Di dev berjalan in-process (ticker); produksi bisa diganti asynq/Redis.
func main() {
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

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	att := &attempt.Service{DB: deps.DB, Audit: deps.Audit, Clock: deps.Clock}
	ret := deps.Retention

	log.Info("worker started", "env", cfg.Env)
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	tickFast := time.NewTicker(10 * time.Second)
	defer tickFast.Stop()

	run := func() {
		n, err := att.AutoSubmitExpired(ctx)
		if err != nil {
			log.Error("auto-submit", "err", err)
		} else if n > 0 {
			log.Info("auto-submit", "count", n)
		}
		if err := ret.Evaluate(ctx); err != nil {
			log.Error("retention evaluate", "err", err)
		}
		p, err := ret.PurgeDue(ctx)
		if err != nil {
			log.Error("retention purge", "err", err)
		} else if p > 0 {
			log.Info("retention purge", "count", p)
		}
	}
	run()
	for {
		select {
		case <-ctx.Done():
			log.Info("worker stopped")
			return
		case <-tickFast.C:
			if n, err := att.AutoSubmitExpired(ctx); err == nil && n > 0 {
				log.Info("auto-submit", "count", n)
			}
		case <-tick.C:
			run()
		}
	}
}
