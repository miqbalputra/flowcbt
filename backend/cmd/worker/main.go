package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"flowcbt/backend/internal/attempt"
	"flowcbt/backend/internal/billing"
	"flowcbt/backend/internal/platform"
	"flowcbt/backend/internal/server"
)

// worker menjalankan job periodik (PRD cmd/worker): auto-submit deadline, retensi 7 hari,
// pembersihan snapshot, rekonsiliasi. Di dev berjalan in-process (ticker); produksi bisa diganti asynq/Redis.
const heartbeatFile = "/tmp/flowcbt-worker.heartbeat"

func main() {
	// C-13: healthcheck untuk image distroless (tidak ada shell).
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		info, err := os.Stat(heartbeatFile)
		if err != nil || time.Since(info.ModTime()) > 2*time.Minute {
			os.Exit(1)
		}
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

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	att := &attempt.Service{DB: deps.DB, Audit: deps.Audit, Clock: deps.Clock}
	ret := deps.Retention

	// C-16: leader election berbasis advisory lock. Satu replika aktif; replika lain
	// menunggu (tidak menjalankan auto-submit/purge yang bisa bentrok).
	lockConn, err := deps.DB.System.Acquire(ctx)
	if err != nil {
		log.Error("acquire worker lock connection", "err", err)
		os.Exit(1)
	}
	defer lockConn.Release()
	var leader bool
	if err := lockConn.QueryRow(ctx, `SELECT pg_try_advisory_lock(727001)`).Scan(&leader); err != nil || !leader {
		log.Info("worker standby — advisory lock dipegang replika lain")
		<-ctx.Done()
		return
	}
	defer func() { _, _ = lockConn.Exec(context.Background(), `SELECT pg_advisory_unlock(727001)`) }()

	log.Info("worker started", "env", cfg.Env, "leader", true)
	tick := time.NewTicker(30 * time.Second)
	defer tick.Stop()
	tickFast := time.NewTicker(10 * time.Second)
	defer tickFast.Stop()

	run := func() {
		// C-13/C-16: sinyal hidup ditulis di awal — kegagalan job tetap teramati,
		// bukan membuat worker terlihat mati.
		_ = os.WriteFile(heartbeatFile, []byte(time.Now().UTC().Format(time.RFC3339)), 0o600)
		n, err := att.AutoSubmitExpired(ctx)
		if err != nil {
			log.Error("auto-submit", "err", err)
		} else if n > 0 {
			log.Info("auto-submit", "count", n)
		}
		g, err := att.GradePendingAttempts(ctx)
		if err != nil {
			log.Error("grade-pending", "err", err)
		} else if g > 0 {
			log.Info("grade-pending", "count", g)
		}
		if err := ret.Evaluate(ctx); err != nil {
			log.Error("retention evaluate", "err", err)
		}
		if err := ret.Reminders(ctx); err != nil {
			log.Error("retention reminders", "err", err)
		}
		// B-10: kirim email dari outbox dengan retry/backoff.
		if sent, err := deps.Notify.ProcessOutbox(ctx, 20); err != nil {
			log.Error("email outbox", "err", err)
		} else if sent > 0 {
			log.Info("email outbox", "sent", sent)
		}
		// B-10: konsumen file_jobs (tenant_export).
		if n, err := billing.ProcessFileJobs(ctx, deps.DB, deps.Storage, 10); err != nil {
			log.Error("file jobs", "err", err)
		} else if n > 0 {
			log.Info("file jobs", "done", n)
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
			if g, err := att.GradePendingAttempts(ctx); err == nil && g > 0 {
				log.Info("grade-pending", "count", g)
			}
		case <-tick.C:
			run()
		}
	}
}
