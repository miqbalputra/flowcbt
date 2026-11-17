# FlowCBT v1.3 — SaaS CBT Multi-Sekolah

Implementasi aplikasi sesuai PRD v1.3: **Golang + PostgreSQL 16 (RLS) + React PWA**.

## Struktur

```
flowcbt/
├── backend/            # Go API (chi + pgx), migrasi 000001–000010, unit+integration test
│   ├── cmd/api         # server HTTP :8080
│   ├── cmd/worker      # ticker: auto-submit attempt kedaluwarsa + retensi/purge 7 hari
│   ├── cmd/migrate     # golang-migrate runner
│   ├── db/migrations/  # 10 migrasi up/down (verbatim dari PRD §18.6)
│   └── internal/       # auth, classroom, student, questionbank, exam, attempt,
│                       # grading, report, realtime(SSE), billing, retention, admin, ...
├── web/                # pnpm workspace
│   ├── apps/teacher    # PWA guru/admin (vite :5173, build/preview :4173)
│   ├── apps/student    # PWA siswa offline-first (vite :5174, build/preview :4174, sw.js)
│   └── packages/       # ui (tema dark/light), api-client, shared (tipe), config
├── deploy/docker-compose.dev.yml   # postgres:16 + redis + minio + mailpit (PRD §18.7)
├── docs/ADR-001-dev-sandbox.md    # penyimpangan dev sandbox
└── scripts/            # dev-pg.mjs (PG16 tanpa Docker), e2e-smoke.mjs, smoke.sh
```

## Menjalankan (dev)

```bash
# 1. PostgreSQL 16 lokal tanpa Docker (sandbox) — atau pakai docker compose di mesin biasa
make dev-pg                       # aktif di 127.0.0.1:55432, db flowcbt

export DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/flowcbt?sslmode=disable'
export APP_ENV=dev                # dev: email otomatis terverifikasi, mailer = log
make migrate                      # terapkan 10 migrasi
make api                          # API di :8080   (env: HTTP_ADDR)
make worker                       # auto-submit + retensi (ganti asynq saat deploy, lihat ADR-001)

# 2. Web
make web-install
make web-build                    # hasil build: web/apps/*/dist
cd web/apps/teacher && pnpm dev   # :5173
cd web/apps/student && pnpm dev   # :5174 (PWA offline, service worker aktif)

# 3. Verifikasi
make be-test                      # go test ./... (grading + AC-5/8/9/10/11 + webhook)
cd web/apps/student && pnpm vitest run   # 7 test mesin offline (outbox/LWW/AC-3)
make smoke                        # E2E 40 langkah: register→...→guest (butuh API aktif)
```

## Deploy Produksi via Coolify

Panduan lengkap men-deploy FlowCBT di satu VPS Ubuntu yang dikelola [Coolify](https://coolify.io).
Ringkasan env cepat: `deploy/README-coolify.md`.

### Prasyarat

| Item | Kebutuhan |
|---|---|
| VPS | Ubuntu 22.04/24.04, 4 GB RAM + (disarankan 8 GB), 80+ GB disk, IP publik |
| Coolify | Terpasang mandiri (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh \| bash`) atau pakai Coolify Cloud |
| Domain | Dua subdomain, mis. `app.domainmu.com` (guru) and `ujian.domainmu.com` (siswa), A/AAAA record mengarah ke VPS |
| Akun pendukung | SMTP untuk email (Resend/SES/SMTP hosting), Midtrans/Mayar untuk billing (bisa `PAYMENT_PROVIDER=mock` dulu saat staging) |

### Topologi layanan di Coolify

| Service | Sumber | Keterangan |
|---|---|---|
| `postgres` | image `postgres:16` | volume persisten; wajib `POSTGRES_DB=flowcbt` |
| `redis` | image `redis:7` | cache, pub/sub realtime, rate limit |
| `minio` | image `minio/minio` | media soal + snapshot kamera (atau S3 eksternal: `STORAGE_KIND=s3` + `S3_*`) |
| `flowcbt-api` | Git repo, `backend/` + `Dockerfile.api` | Go API, healthcheck `GET /healthz`, port 8080 |
| `flowcbt-worker` | Git repo, `backend/` + `Dockerfile.worker` | auto-submit, retensi/purge, email |
| `flowcbt-web` | Git repo, `web/` + `Dockerfile.web` | nginx: guru di `/`, siswa di `/exam/`, proxy `/api/v1/` → api |

### Langkah 1 — VPS & Coolify

1. Update server, pasang Docker + Coolify, buka firewall port `22`, `80`, `443`.
2. Akses dashboard Coolify di `https://<ip-atau-domain>:8000`, buat akun admin.

### Langkah 2 — Infrastruktur dasar (postgres, redis, minio)

Buat tiga resource **Docker Compose / image** terpisah dalam satu project Coolify, semuanya IKUT jaringan privat Coolify:

1. **postgres:16** — env `POSTGRES_PASSWORD` (kuat, simpan!), `POSTGRES_DB=flowcbt`, `POSTGRES_USER=postgres`. Volume untuk `/var/lib/postgresql/data`.
2. **redis:7** — tanpa env khusus.
3. **minio** — image `minio/minio`, command `server /data --console-address ":9001"`, env `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`, volume `/data`. Buat bucket `flowcbt` dari console `:9001`.

Catat hostname internal tiap service (format Coolify umum: `nama-service:port`, `postgres:5432`, `redis:6379`, `minio:9000`).

### Langkah 3 — Database migrasi (sekali, atau saat update skema)

Buat resource sekali-jalan (one-off / job) dari repositori ini:

- **Repo/branch:** repo GitHub ini, branch `main`
- **Dockerfile:** `backend/Dockerfile.api`
- **Command override:** `./migrate -dir db/migrations up` (binary `migrate` sudah ada di image api)
- **Env:**

| Env | Nilai |
|---|---|
| `APP_ENV` | `production` |
| `DATABASE_URL` | `postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/flowcbt?sslmode=disable` |
| `APP_DB_PASSWORD` | password acak ≥ 32 karakter (di-set ke role `flowcbt_app` oleh migrate) |
| `SYSTEM_DB_PASSWORD` | password acak ≥ 32 karakter (di-set ke role `flowcbt_system`) |

`cmd/migrate` otomatis `ALTER ROLE flowcbt_app/flowcbt_system LOGIN PASSWORD ...` dari nilai env tersebut. Jalankan job → sukses → lanjut.

### Langkah 4 — Deploy `flowcbt-api`

Resource Git baru: pilih repo ini, branch `main`, build context `backend`, Dockerfile `Dockerfile.api`. Port `8080`, healthcheck `/healthz`. Env:

| Env | Nilai | Wajib |
|---|---|---|
| `APP_ENV` | `production` | ✅ |
| `DATABASE_URL` | `postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/flowcbt?sslmode=disable` | ✅ |
| `APP_DB_PASSWORD` / `SYSTEM_DB_PASSWORD` | sama dengan langkah migrasi | ✅ |
| `JWT_SECRET` | acak ≥ 32 karakter (`openssl rand -base64 48`) | ✅ |
| `CORS_ALLOWED_ORIGINS` | `https://app.domainmu.com,https://ujian.domainmu.com` | ✅ |
| `INTERNAL_TOKEN` | acak ≥ 32 karakter | ✅ |
| `PUBLIC_BASE_URL` | `https://api.domainmu.com` (atau domain API) | ✅ |
| `APP_URL` / `STUDENT_APP_URL` | `https://app.domainmu.com` / `https://ujian.domainmu.com` | ✅ |
| `REDIS_URL` | `redis://redis:6379` | disarankan |
| `STORAGE_KIND` | `s3` + `S3_ENDPOINT=http://minio:9000`, `S3_BUCKET=flowcbt`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | ✅ (media & snapshot) |
| `MAILER_KIND` | `smtp` + `SMTP_HOST/USER/PASS/FROM` | ✅ (email verifikasi/invoice) |
| `PAYMENT_PROVIDER` | `midtrans` / `mayar` / `mock` + kredensialnya | optional awal |

Tanpa env bertanda ✅ yang valid, API **menolak start** (fail-fast) — itu memang disengaja. Deploy, pastikan hijau.

### Langkah 5 — Deploy `flowcbt-worker`

Resource Git sama, context `backend`, Dockerfile `Dockerfile.worker`, tanpa port. Env minimal sama dengan api (`APP_ENV`, `DATABASE_URL`, `APP_DB_PASSWORD`, `SYSTEM_DB_PASSWORD`, `JWT_SECRET`, `REDIS_URL`, `STORAGE_KIND` + `S3_*`, `MAILER_KIND` + `SMTP_*`, dll).

### Langkah 6 — Deploy `flowcbt-web` + domain

Resource Git: context `web/`, Dockerfile `Dockerfile.web` (build Vite dengan `VITE_API_BASE=/api/v1`, image nginx). Lalu di tab **Domains** Coolify:

| Domain (jenis) | Target port | Peta ke |
|---|---|---|
| `app.domainmu.com` (https) | `80` | SPA guru/admin |
| `ujian.domainmu.com` (https) | `80` | PWA siswa |

Ya, keduanya ke port sama — nginx kongsi satu image dan memakai nama host/path (`/exam/`) untuk membedakan aplikasi. Coolify memasang SSL Let's Encrypt otomatis. Set API publik di-proxy: tambah domain `api.domainmu.com` → `flowcbt-api:8080` (atau proxy `/api/v1/` lewat web, yang sudah tersedia).

### Langkah 7 — Verifikasi pasca-deploy

```bash
# API hidup
curl -fsS https://api.domainmu.com/healthz           # → {"status":"ok"} (200)
# Proteksi endpoint internal
curl -o /dev/null -sw '%{http_code}' https://api.domainmu.com/internal/active-exams   # → 401
# Web guru & siswa ter-serve
curl -o /dev/null -sw '%{http_code}' https://app.domainmu.com/                        # → 200
curl -o /dev/null -sw '%{http_code}' https://ujian.domainmu.com/exam/                 # → 200
```

Lalu uji manual: register admin sekolah → verifikasi email (cek inbox SMTP) → login → buat kelas & import siswa → buat paket soal → publish ujian (cek kuota) → login siswa di `ujian.*` dan kerjakan ujian sampai selesai.

### Pembaruan aplikasi

- Push ke `main` → CI (GitHub Actions) harus **hijau** → di Coolify klik **Redeploy** (atau webhook auto-deploy).
- Ada ujian berjalan? Patuhi **deploy freeze**: jangan redeploy api/web sebelum ujian selesai (lihat PRD §7.4 dan `GET /internal/active-exams`).
- Jika ada migrasi baru: jalankan ulang job migrasi (Langkah 3) **sebelum** redeploy api.

### Backup & retensi (wajib)

1. Di Coolify atau cron host: `pg_dump` harian + WAL, dikirim ke object storage **di luar VPS** (PRD: RPO ≤ 5 menit, backup 14 hari bergulir).
2. **Uji restore** berkala — backup tanpa restore test bukan backup.
3. Volume MinIO ikut di-backup (media soal & snapshot).

### Troubleshooting umum

| Gejala | Penyebab umum |
|---|---|
| API langsung exit saat start | `Config.Validate` menolak env: baca log — biasanya `JWT_SECRET` pendek / default, `CORS_ALLOWED_ORIGINS` kosong, atau password DB default |
| Web alias 502 | service `api` belum sehat atau hostname internal salah — cek preview URL internal Coolify |
| Email tak terkirim | `MAILER_KIND=log` (default, hanya menulis ke log) — set `smtp` + kredensial |
| CORS error dari browser | domain di `CORS_ALLOWED_ORIGINS` tidak persis sama (skema + host, tanpa trailing slash) |
| Gagal upload media | `S3_*` salah / bucket belum dibuat / `STORAGE_KIND` masih `local` |

## Akun & peran
- **Guru/admin**: register membuat tenant baru + trial (batas siswa & kuota ujian).
- **Siswa**: login dengan NIS/akun sekolah, atau **mode tamu** dengan token ujian 6 karakter.
- **Platform admin**: endpoint `/api/v1/admin/*` (butuh role `platform_admin`).

## Sorotan yang sudah diverifikasi (AC)

- AC-3 idempotensi sync jawaban (`client_event_id`, duplikat → `duplicate:true`)
- AC-5 event lewat deadline ditandai `accepted:false` (toleransi 60 dtk), auto-submit oleh worker
- AC-6 batas percobaan (`ATTEMPT_LIMIT_REACHED`), AC-7 kuota publish ujian (trial→kredit→langganan, refund saat unpublish)
- AC-8 penalti kecurangan (poin dikurangi, di-cap, skor akhir di-clamp 0–100)
- AC-9 RLS: tenant A tidak bisa membaca data tenant B (integration test)
- AC-10 import siswa: preview/commit per-baris dengan nomor baris + alasan error
- AC-11 retensi: tenant `read_only` setelah akses berakhir, purge total setelah +7 hari
- Webhook pembayaran idempotent; paket soal ke siswa tidak mengandung kunci jawaban.

Lihat `docs/ADR-001-dev-sandbox.md` untuk perbedaan dev sandbox vs deployment produksi.

## Dokumen operasional

| File | Isi |
|---|---|
| `docs/SLO.md` | Target availability, latensi, RPO/RTO, error budget & alert |
| `docs/RUNBOOK.md` | Langkah penanganan insiden (DB/Redis/storage/purge/outage ujian) |
| `docs/INCIDENT-TEMPLATE.md` | Template pencatatan insiden & postmortem |
| `docs/BACKUP-RESTORE.md` | Prosedur backup, restore drill & catatan hasil |
| `docs/ROLLBACK.md` | Kapan & bagaimana rollback deploy/migrasi |
| `docs/ADR-002-realtime.md` | Keputusan arsitektur SSE/Redis untuk laporan live |
| `rencana_update.md` | Rencana perbaikan F0–F3 beserta status temuan |
