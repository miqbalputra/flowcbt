# FlowCBT

**Computer Based Test (CBT) Ujian Online Multi-Sekolah, Berbayar (SaaS)** — sesuai `PRD_FlowCBT.md` v1.2.

Platform ujian berbasis komputer untuk sekolah/lembaga dari jenjang apa pun: guru membuat soal format AKM, menjadwalkan ujian, dan memantau real-time; siswa mengerjakan lewat browser (HP/komputer) dengan **mode offline penuh** — jawaban tersimpan lokal dan tersinkron otomatis saat online kembali.

## Stack

| Lapisan | Teknologi |
|---|---|
| Backend | Go 1.22+ (chi, pgx, golang-migrate), arsitektur modular `internal/<modul>` |
| Database | PostgreSQL 16 dengan **Row-Level Security** per tenant |
| Frontend | React 18 + TypeScript + Vite + Tailwind, PWA (offline-first, IndexedDB) |
| Worker | Go worker (retensi data 7 hari, job email) |
| Deploy | VPS + Coolify (Docker) — lihat `deploy/` |

## Struktur Repository

```
├── backend/
│   ├── cmd/api         # API server (migrasi otomatis saat start)
│   ├── cmd/worker      # Worker jobqueue (retensi, email)
│   ├── cmd/seed        # Seeder data demo
│   ├── cmd/probe       # Probe kesehatan DB/API
│   └── internal/       # users, billing, students, questionsets,
│                       # exams, reports, grading, auth, db, httpx, ...
├── frontend/           # React SPA + PWA (area guru src/guru, siswa src/siswa)
├── deploy/             # Dockerfile, docker-compose, catatan Coolify
├── docs/               # PROGRESS.md, konvensi
├── scripts/            # make-icons.sh (restore ikon PWA)
├── tests/              # smoke_e2e.py (53 asersi: AC-1..AC-12 + SSE + PDF)
├── CONVENTIONS.md      # Konvensi wajib kode (RLS, modul, grading)
└── PRD_FlowCBT.md      # Product Requirements Document v1.2
```

## Menjalankan Lingkungan Pengembangan

### 1. Database

```bash
# PostgreSQL 16 di Docker (host port 5433)
docker run -d --name flowcbt-pg -p 5433:5432 \
  -e POSTGRES_USER=flowcbt -e POSTGRES_PASSWORD=flowcbt_dev \
  -e POSTGRES_DB=flowcbt postgres:16

# Role aplikasi RLS (sekali saja)
docker exec -i flowcbt-pg psql -U flowcbt -d flowcbt <<'SQL'
CREATE ROLE flowcbt_app LOGIN PASSWORD 'app_user_dev';
GRANT USAGE ON SCHEMA public TO flowcbt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowcbt_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowcbt_app;
SQL
```

### 2. Migrasi & Seed

Migrasi berjalan otomatis saat API start. Data demo:

```bash
cd backend
go run ./cmd/seed
```

### 3. API & Worker

```bash
cd backend
go build -o /tmp/flowcbt-api ./cmd/api
DATABASE_URL='postgres://flowcbt:flowcbt_dev@localhost:5433/flowcbt?sslmode=disable' \
PORT=8080 /tmp/flowcbt-api

# Worker (retensi 7 hari + email jobs, interval 60 dtk)
go build -o /tmp/flowcbt-worker ./cmd/worker
DATABASE_URL='postgres://flowcbt:flowcbt_dev@localhost:5433/flowcbt?sslmode=disable' /tmp/flowcbt-worker
```

Health check: `curl http://localhost:8080/healthz`

### 4. Frontend

```bash
cd frontend
npm install
npm run dev        # dev server
npm run build      # build produksi + PWA (service worker)
```

### 5. Ikon PWA (pasca-clone)

File PNG tidak disimpan di git (commit ini dipush via GitHub API yang hanya
mendukung teks) — regenerasi sekali saja:

```bash
./scripts/make-icons.sh   # buat ulang 4 file PNG dari scripts/icons.b64.txt
```

## Operasional Server Produksi (systemd + backup)

Layanan di VPS ini dikelola systemd — auto-restart saat crash/reboot, log di
journald (berotasi otomatis), backup database harian:

```bash
# unit (lihat deploy/systemd/ untuk versi repo):
#   flowcbt-api.service        — API Go di :8080
#   flowcbt-webserve.service   — static+proxy di :5173 (serve frontend/dist)
#   flowcbt-worker.service     — retensi, queue email, pembersih snapshot proktor
#   flowcbt-backup.timer       — pg_dump harian 02:30 → /opt/flowcbt/backups (retensi 14)
#   flowcbt-watchdog.timer     — cek layanan tiap 5 menit + webhook opsional (WATCH_WEBHOOK_URL)

systemctl status flowcbt-api flowcbt-webserve flowcbt-worker   # status
journalctl -u flowcbt-api -f                                  # log live
sudo systemctl start flowcbt-backup.service                    # backup manual
gunzip -c /opt/flowcbt/backups/<file>.sql.gz | \
  docker exec -i flowcbt-pg psql -U flowcbt -d flowcbt          # restore
```

**Kunci rahasia** hidup di `/opt/flowcbt/flowcbt.env` (mode 600). API & worker
**menolak menyala** (`config.FailFast`) bila `APP_ENV=production` masih
memakai secret/password default (JWT dev, seed `Admin#12345`, DB
`flowcbt_dev`) atau tanpa `SNAPSHOT_ENCRYPTION_KEY` (enkripsi foto proktor
at-rest, 64 karakter hex — `openssl rand -hex 32`). Deploy baru:
`go -C backend build -o /opt/flowcbt/bin/flowcbt-api ./cmd/api`
lalu `sudo systemctl restart flowcbt-api`.

**Referensi & uji beban**: `deploy/openapi.yaml` (spesifikasi API parsial)
dan `deploy/loadtest/k6-smoke.js` (`k6 run deploy/loadtest/k6-smoke.js`).

## Akun Demo (hasil `cmd/seed`)

| Peran | Login | Password |
|---|---|---|
| Guru/Admin sekolah | `guru@demo.cbt` | `Guru#12345` |
| Siswa (30 akun) | `siswa2001` … `siswa2030` | `Siswa#123` |
| Super Admin platform | `superadmin@flowcbt.id` | `Admin#12345` |

Ujian demo: **kode `DEMO01`, token `AA3141`** (terbuka 4 jam sejak seed).
Siswa juga bisa login **tanpa akun** (guest): isi nama + kelas + kode + token.

## Menjalankan Smoke Test E2E

```bash
# API & worker harus berjalan; seeder sudah dijalankan
cd /home/ubuntu/project/App_CBT
python3 tests/smoke_e2e.py
# Harap: 43 PASS / 0 FAIL (mencakup AC-1..AC-12 PRD)
```

## Uji Coba Alur Lengkap (Manual)

1. **Guru** — login → import siswa (template xlsx/csv) → buat paket soal (5 tipe AKM: PG, PG kompleks, menjodohkan, isian, uraian) → publish (validasi kuota) → buat ujian (wizard: info → soal → peserta → jadwal → publish) → catat kode + token.
2. **Siswa** — login (`siswa2001`) → pilih ujian → masukkan token → baca tata tertib → kerjakan (matikan Wi-Fi untuk uji offline: jawaban tetap tersimpan, indikator 🔴; nyalakan lagi → sinkron otomatis 🟢) → selesai → nilai.
3. **Guru** — pantau Laporan Real-Time (progres, status koneksi, pelanggaran) → nilai uraian → lihat laporan historis & analisis butir → export.

## Keamanan & Integritas (Ringkas)

- Argon2id untuk password; JWT access + refresh (rotasi).
- RLS PostgreSQL per tenant + `app.tenant_id` diset per transaksi; data lintas tenant → 404.
- Kunci jawaban **tidak pernah** dikirim ke klien; penilaian & penalti dihitung di server.
- Sinkronisasi jawaban idempoten (`client_event_id`), resolusi konflik last-write-wins per `sequence_number`.
- Anti-cheat: deteksi keluar aplikasi dengan toleransi + penalti/laporan curang; token ujian + rate limiting.
- Audit log untuk aksi sensitif (override nilai, reset attempt, pembatalan penalti).

## Status & Roadmap

Lihat `docs/PROGRESS.md`. MVP (P0) tuntas + inti P1 (SSE real-time, export PDF, guest login, proctoring snapshot, item analysis, retensi+export-all, Super Admin) — smoke test 53/53. Berikutnya: Mayar/SMTP produksi (butuh kredensial), E2E Playwright offline, uji beban k6, deploy Coolify.
