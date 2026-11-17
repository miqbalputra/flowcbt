# Prosedur Rollback Deploy (C-09)

## Kapan rollback

- 5xx > 1% setelah deploy dan tidak membaik dalam 10 menit.
- Alur ujian (start → sync → submit) gagal pada smoke pasca-deploy.
- Migrasi menyebabkan error constraint/RLS yang tidak bisa diperbaiki cepat.

## Urutan aman

1. **Cek freeze:** `bash scripts/check-deploy-freeze.sh`. Jika ada ujian aktif,
   rollback hanya lewat approval break-glass 2 orang + catat di `audit_logs`.
2. **Redeploy SHA sebelumnya** (api, worker, web) — image di-tag dengan git SHA.
3. **Database:**
   - Jika migrasi baru masih kompatibel (mis. 000011–000013 bersifat additive),
     **jangan rollback migrasi** — cukup rollback aplikasi.
   - Jika migrasi merusak: `go run ./cmd/migrate -dir db/migrations down` satu versi,
     lalu verifikasi `/readyz` dan smoke.
4. **Verifikasi:** healthcheck, smoke, metrik 5xx turun, SSE heartbeat normal.

## Setelah rollback

- Isi `docs/INCIDENT-TEMPLATE.md`.
- Jangan deploy ulang sampai root cause diketahui & test regresi ditambahkan.
