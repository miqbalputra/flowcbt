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
