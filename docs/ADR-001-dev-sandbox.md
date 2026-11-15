# ADR-001: Penyimpangan dev/sandbox terhadap PRD v1.3

Dokumen ini mencatat semua penyimpangan implementasi dari PRD §18.7 (arsitektur deployment)
yang dipakai selama pengembangan di sandbox, beserta alasannya. Semua penyimpangan ini
**khusus untuk dev/test lokal**; untuk produksi gunakan `deploy/docker-compose.dev.yml`.

| Aspek | PRD / produksi | Implementasi saat ini | Alasan |
|---|---|---|---|
| PostgreSQL 16 | container `postgres:16` via Docker Compose | `embedded-postgres` (npm) menjalankan PG16 asli di port 55432 (`make dev-pg`) | sandbox tidak punya Docker daemon; tetap PostgreSQL 16 sungguhan, bukan stub |
| Job queue | asynq / river (butuh Redis) | worker in-process dengan ticker di `backend/cmd/worker` (auto-submit + retensi 7 hari) | tidak ada Redis di sandbox; antarmuka sama, tinggal ganti implementasi saat deploy |
| Redis | rate-limit & cache terdistribusi | rate-limit in-memory (`platform/ratelimit.Mem`) | tanpa Redis; untuk multi-instance, ganti ke `RedisLimiter` |
| Object storage | MinIO/S3 | `STORAGE_DRIVER=local` menyimpan ke disk lokal; interface `storage.Storage` sama, adapter S3/minio tersedia (`storage_s3.go`) | tanpa Docker |
| Mailer | SMTP | mailer log (mencetak email ke log, mis. link verifikasi) | tanpa SMTP; `APP_ENV=dev` otomatis verifikasi email agar alur tetap bisa diuji |
| Payment provider | Midtrans / Mayar (live) | adapter `mock` + adapter midtrans/mayar siap pakai (env `PAYMENTS_PROVIDER`); kolom `payments.provider` CHECK ditambah `'mock'` | tanpa credential/sandbox network ke PGW; webhook tetap diuji end-to-end (idempotensi via `payment_webhook_events`) |
| TLS / domain | HTTPS via reverse proxy | HTTP polos di `127.0.0.1:8080` | sandbox; tambahkan Caddy/nginx di depan saat deploy |

## Yang TIDAK disimpangkan

- Semua 10 migrasi database (000001–000010) sama persis dengan PRD §18.6 (kecuali nilai
  tambahan `'mock'` pada CHECK constraint seperti tabel di atas).
- RLS PostgreSQL dengan `app.tenant_id` per transaksi, dua role DB (`flowcbt_app` /
  `flowcbt_system`), diverifikasi oleh integration test AC-9.
- Semua endpoint API, AC-1..AC-12, skema JWT + rotasi refresh dengan deteksi reuse,
  idempotensi `answers:sync` via `client_event_id`, anti-cheat, grading, billing
  (trial/per-exam/monthly + refund saat unpublish), retensi 7 hari + purge, SSE live report.
