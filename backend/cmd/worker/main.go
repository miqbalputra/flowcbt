package main

// Worker FlowCBT — loop job periodik tanpa Redis (plain loop):
//  1. Retensi (PRD 3.2, AC-11): tenant dengan akses berakhir → mode
//     baca-saja 7 hari, kemudian penandaan penghapusan permanen.
//  2. Email jobs: proses jobs kind='email' (pending) — kirim SMTP nyata
//     bila SMTP_HOST diset (net/smtp sederhana), selain itu log-only.
//     Model retry nyata: gagal → attempts++ dan run_at mundur eksponensial
//     (2^attempts menit); attempts >= 5 → failed. Sukses → done.
//  3. Snapshot proctor kedaluwarsa dibersihkan dari DB.
//
// Keandalan: setiap tahap DAN setiap job email dibungkus recover — panic
// satu job dicatat (dengan stack, log server) dan tidak mematikan loop.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/smtp"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"flowcbt/backend/internal/app"
	"flowcbt/backend/internal/config"
	"flowcbt/backend/internal/db"
)

const maxEmailAttempts = 5

// jobItem satu baris job yang dipegang worker untuk diproses.
type jobItem struct {
	ID      int64
	Payload []byte
}

func main() {
	cfg := config.Load()
	if err := cfg.FailFast(); err != nil {
		slog.Error("tolak start", "err", err)
		os.Exit(1)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	database, err := db.Connect(ctx, cfg.DatabaseURL, cfg.DatabaseAppURL)
	if err != nil {
		slog.Error("worker: koneksi db gagal", "err", err)
		os.Exit(1)
	}
	defer database.Close()

	a := app.New(cfg, database)

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		slog.Info("worker: sinyal berhenti diterima")
		cancel()
	}()

	slog.Info("worker berjalan", "interval", "60s")
	runOnce(ctx, a) // langsung eksekusi sekali di awal

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("worker berhenti")
			return
		case <-ticker.C:
			runOnce(ctx, a)
		}
	}
}

// runOnce menjalankan seluruh job siklus worker. Setiap tahap dibungkus
// recover (safeRun) agar panic satu tahap tidak mematikan loop worker.
func runOnce(ctx context.Context, a *app.App) {
	safeRun(ctx, a, "retensi", runRetention)
	safeRun(ctx, a, "email", runEmailJobs)
	safeRun(ctx, a, "proctor-snapshots", cleanupProctorSnapshots)
}

// safeRun menjalankan satu tahap worker dengan perlindungan recover:
// panic → log error + stack (log server), loop tetap hidup.
func safeRun(ctx context.Context, a *app.App, tahap string, fn func(context.Context, *app.App)) {
	defer func() {
		if rec := recover(); rec != nil {
			stack := make([]byte, 8192)
			n := runtime.Stack(stack, false)
			slog.Error("worker: tahap panic dipulihkan",
				"tahap", tahap, "err", rec, "stack", string(stack[:n]))
		}
	}()
	fn(ctx, a)
}

// runRetention menandai tenant hak aksesnya berakhir → mode baca-saja
// selama 7 hari (PRD 3.2 / AC-11). rights_ends_at dihitung dari titik
// terakhir antara trial_ends_at dan close_at ujian terakhir.
func runRetention(ctx context.Context, a *app.App) {
	const q = `
		WITH target AS (
			SELECT t.id,
			       GREATEST(
			           COALESCE(t.trial_ends_at, t.created_at),
			           COALESCE((SELECT MAX(e.close_at) FROM exams e
			                     WHERE e.tenant_id = t.id), t.created_at)
			       ) AS rights_ends
			FROM tenants t
			WHERE t.status = 'active'
			  AND COALESCE(t.trial_ends_at, t.created_at) < now()
			  AND NOT EXISTS (SELECT 1 FROM subscriptions s
			                  WHERE s.tenant_id = t.id AND s.status='active'
			                    AND (s.ends_at IS NULL OR s.ends_at > now()))
			  AND COALESCE((SELECT SUM(ec.quantity - ec.used) FROM exam_credits ec
			                WHERE ec.tenant_id = t.id), 0) <= 0
		)
		UPDATE tenants t SET
			status='read_only',
			rights_ends_at=x.rights_ends,
			retention_started_at=x.rights_ends,
			retention_delete_at=x.rights_ends + interval '7 days',
			updated_at=now()
		FROM target x WHERE t.id = x.id`
	tag, err := a.DB.Admin.Exec(ctx, q)
	if err != nil {
		slog.Warn("worker retensi gagal", "err", err)
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		slog.Info("worker retensi: tenant masuk baca-saja", "jumlah", n)
	}
}

// runEmailJobs memproses jobs kind='email': status pending, belum melewati
// batas retry (attempts < maxEmailAttempts) dan run_at <= now.
// Per-job dibungkus recover; hasil proses dicatat dengan model retry nyata:
//   - sukses  → done
//   - gagal   → attempts++ & run_at = now() + 2^attempts menit (backoff
//     eksponensial); attempts mencapai maxEmailAttempts → failed + last_error.
func runEmailJobs(ctx context.Context, a *app.App) {
	rows, err := a.DB.Admin.Query(ctx, `
		SELECT id, payload FROM jobs
		WHERE kind='email' AND status='pending' AND attempts < $1 AND run_at <= now()
		ORDER BY run_at LIMIT 20`, maxEmailAttempts)
	if err != nil {
		slog.Warn("worker email query gagal", "err", err)
		return
	}
	var jobs []jobItem
	for rows.Next() {
		var it jobItem
		if err := rows.Scan(&it.ID, &it.Payload); err != nil {
			continue
		}
		jobs = append(jobs, it)
	}
	rows.Close()

	for _, jb := range jobs {
		// Recover per job: panic satu job dianggap kegagalan job itu —
		// dicatat dengan stack, siklus & job lain lanjut.
		derr := func() (err error) {
			defer func() {
				if rec := recover(); rec != nil {
					stack := make([]byte, 8192)
					n := runtime.Stack(stack, false)
					slog.Error("worker email job panic", "id", jb.ID, "err", rec,
						"stack", string(stack[:n]))
					err = fmt.Errorf("panic job email: %v", rec)
				}
			}()
			return processEmailJob(ctx, a, jb)
		}()
		markEmailOutcome(ctx, a, jb.ID, derr)
	}
}

// emailPayload bentuk payload job kind='email'. Bidang alias ditoleransi
// agar job dari modul/produsen lama tetap terbaca.
type emailPayload struct {
	To      string `json:"to"`
	Email   string `json:"email"` // alias To
	Subject string `json:"subject"`
	Body    string `json:"body"`
	Text    string `json:"text"` // alias Body
}

// processEmailJob mengirim satu email job.
// Bila SMTP_HOST diset → kirim via net/smtp (tanpa library tambahan);
// selain itu log-only dan dianggap sukses (mode simulasi dev).
func processEmailJob(_ context.Context, _ *app.App, jb jobItem) error {
	var p emailPayload
	if err := json.Unmarshal(jb.Payload, &p); err != nil {
		return fmt.Errorf("payload tidak valid: %w", err)
	}
	to := p.To
	if to == "" {
		to = p.Email
	}
	to = sanitizeHeader(to)
	body := p.Body
	if body == "" {
		body = p.Text
	}
	if to == "" || !strings.Contains(to, "@") {
		return errors.New("payload email tanpa penerima (to) yang valid")
	}
	subject := sanitizeHeader(p.Subject)
	if host := strings.TrimSpace(os.Getenv("SMTP_HOST")); host != "" {
		if err := sendViaSMTP(host, to, subject, body); err != nil {
			return fmt.Errorf("smtp kirim: %w", err)
		}
		slog.Info("job email terkirim (SMTP)", "id", jb.ID, "to", to, "subject", subject)
		return nil
	}
	// Log-only: SMTP belum dikonfigurasi — isi email dijejak di log agar
	// bisa diaudit; job tetap sukses sesuai kebijakan simulasi.
	slog.Info("job email (log-only, SMTP_HOST belum diset)",
		"id", jb.ID, "to", to, "subject", subject, "payload", string(jb.Payload))
	return nil
}

// sanitizeHeader mencegah header injection: buang CR/LF dari nilai header.
func sanitizeHeader(v string) string {
	v = strings.ReplaceAll(v, "\r", " ")
	v = strings.ReplaceAll(v, "\n", " ")
	return strings.TrimSpace(v)
}

// sendViaSMTP mengirim email sederhana (text/plain) via net/smtp.
// SMTP_PORT default 587; SMTP_FROM default no-reply@flowcbt.local;
// SMTP_USER/SMTP_PASS (plain auth, hanya bila user diset).
func sendViaSMTP(host, to, subject, body string) error {
	host = strings.TrimSpace(host)
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if port == "" {
		port = "587"
	}
	from := sanitizeHeader(os.Getenv("SMTP_FROM"))
	if from == "" {
		from = "no-reply@flowcbt.local"
	}
	var auth smtp.Auth
	if user := os.Getenv("SMTP_USER"); user != "" {
		auth = smtp.PlainAuth("", user, os.Getenv("SMTP_PASS"), host)
	}
	msg := bytes.Join([][]byte{
		[]byte("From: " + from),
		[]byte("To: " + to),
		[]byte("Subject: " + subject),
		[]byte("MIME-Version: 1.0"),
		[]byte("Content-Type: text/plain; charset=UTF-8"),
		[]byte("Date: " + time.Now().Format(time.RFC1123Z)),
		[]byte(""),
		[]byte(body),
	}, []byte("\r\n"))
	return smtp.SendMail(host+":"+port, auth, from, []string{to}, msg)
}

// markEmailOutcome mencatat hasil proses job:
//   - sukses → done (attempts++);
//   - gagal  → attempts++; bila mencapai maxEmailAttempts → failed
//     (+ last_error); selain itu tetap pending dengan backoff
//     run_at = now() + 2^attempts_epoch menit.
func markEmailOutcome(ctx context.Context, a *app.App, id int64, deliverErr error) {
	if deliverErr == nil {
		if _, err := a.DB.Admin.Exec(ctx,
			`UPDATE jobs SET status='done', attempts=attempts+1 WHERE id=$1 AND status='pending'`, id); err != nil {
			slog.Warn("worker email update gagal", "id", id, "err", err)
		}
		return
	}
	tag, err := a.DB.Admin.Exec(ctx, `
		UPDATE jobs SET
			attempts = attempts + 1,
			run_at = now() + (power(2, attempts + 1) * interval '1 minute'),
			last_error = $2,
			status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE status END
		WHERE id=$1 AND status='pending'`, id, deliverErr.Error(), maxEmailAttempts)
	if err != nil {
		slog.Warn("worker email update gagal (retry)", "id", id, "err", err)
		return
	}
	if tag.RowsAffected() == 0 {
		slog.Warn("worker email: job sudah tidak pending", "id", id)
		return
	}
	slog.Warn("worker email job gagal, dijadwalkan ulang (backoff eksponensial)",
		"id", id, "err", deliverErr)
}

// cleanupProctorSnapshots menghapus baris snapshot yang kedaluwarsa
// (expires_at < now); berkas fisik tetap dibiarkan v1.
func cleanupProctorSnapshots(ctx context.Context, a *app.App) {
	_, err := a.DB.Admin.Exec(ctx,
		`DELETE FROM proctor_snapshots WHERE expires_at < now()`)
	if err != nil {
		slog.Warn("worker pembersihan snapshot gagal", "err", err)
	}
}
