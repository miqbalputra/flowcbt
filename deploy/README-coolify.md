# Deploy Coolify — FlowCBT (PRD §7.4)

Tiga image, dibangun dari repo ini:

| Service | Context | Dockerfile | Image |
|---|---|---|---|
| flowcbt-api | `backend/` | `Dockerfile.api` | distroless, nonroot, healthcheck `GET /healthz` |
| flowcbt-worker | `backend/` | `Dockerfile.worker` | distroless, nonroot, tanpa port |
| flowcbt-web | `web/` | `Dockerfile.web` | nginx: teacher di `/`, student di `/exam/`, proxy `/api/v1/` → `http://api:8080` |

## Env wajib produksi (APP_ENV=production tanpa ini → API/worker menolak start)

| Env | Contoh | Keterangan |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:…@postgres:5432/flowcbt` | koneksi migrasi/sistem |
| `APP_DB_PASSWORD` / `SYSTEM_DB_PASSWORD` | random 32+ | nilai default ditolak |
| `JWT_SECRET` | random 32+ karakter | default `dev-insecure-secret-change-me` ditolak |
| `CORS_ALLOWED_ORIGINS` | `https://app.domain.com,https://ujian.domain.com` | allowlist origin; tanpa ini ditolak |
| `INTERNAL_TOKEN` | random 32+ karakter | bearer untuk `GET /internal/active-exams` (deploy freeze) |
| `PUBLIC_BASE_URL`, `APP_URL`, `STUDENT_APP_URL` | https | domain nyata |
| `STORAGE_KIND=s3`, `S3_*` | — | media + snapshot kamera |
| `REDIS_URL` | — | cache/realtime/rate-limit |
| `PAYMENT_PROVIDER`, `MIDTRANS_*` / `MAYAR_*` | — | billing |

## Urutan deploy

1. `postgres`, `redis`, `minio` naik dulu (volume persisten).
2. Jalankan migrasi satu kali (`cmd/migrate` — bisa pakai image api dengan command override, atau job sekali-jalan).
3. `flowcbt-api`, `flowcbt-worker`, `flowcbt-web` mengikuti; sebar domain `app.*` → web:80, `ujian.*` → web:80 (routing path: `/exam/` = student).
4. TTL: sertifikat & domain via Coolify proxy (Traefik).

## Catatan uji lokal (terverifikasi)

- Ketiga image berhasil di-build (`docker build` exit 0).
- Container api (mode produksi): `/healthz` → 200; `/internal/active-exams` tanpa token → 401, dengan `INTERNAL_TOKEN` → 200.
- Container web: `/` = SPA guru, `/exam/` = PWA siswa, header aset `immutable`.
- Sandbox dev ini membatasi akses container→host DB (postgres listen 127.0.0.1); uji end-to-end penuh dilakukan di staging Coolify di mana postgres dalam satu jaringan container.
