# Runbook Insiden FlowCBT (C-09)

> Prinsip: **nyatakan dulu, lalu perbaiki**. Gunakan `docs/INCIDENT-TEMPLATE.md`
> untuk mencatat timeline. Selalu cek `GET /livez` vs `/readyz` lebih dulu.

## 1. DB down / koneksi gagal

- Gejala: `/readyz` 503, `/livez` 200, banyak error `unhandled error` di log.
- Langkah:
  1. Cek container/service postgres & `DATABASE_URL`.
  2. Cek pool: `SELECT 1` lewat role `flowcbt_app` dan `flowcbt_system`.
  3. Jika perlu restart, pastikan **tidak ada ujian aktif** (`scripts/check-deploy-freeze.sh`).
  4. Setelah pulih, verifikasi `/readyz` 200 lalu jalankan smoke.
- Eskalasi: DBA / platform owner.

## 2. Redis down

- Gejala: rate limiter fail-closed → endpoint `/auth/*` mengembalikan 503 di produksi.
- Langkah: cek `REDIS_URL`, ping Redis, restart service. Jangan menonaktifkan fail-closed.
- Catatan: desain fail-closed sengaja dipilih (B-06) agar auth tidak lolos saat Redis mati.

## 3. Storage penuh / upload gagal

- Gejala: 413/500 saat upload media, `PutObject` error.
- Langkah: cek `client_max_body_size` nginx (20m), kuota bucket, lifecycle snapshot.
- Jika ada object yatim dari purge gagal: cek tabel/file_jobs & log worker.

## 4. Purge salah / data terhapus

- **Hentikan worker** segera (advisory lock dilepas saat proses mati).
- Jangan jalankan `PurgeDue` lagi sampai root cause jelas.
- Pulihkan dari backup terbaru → `docs/BACKUP-RESTORE.md`.
- Catat tenant yang terdampak & ajukan postmortem.

## 5. Ujian aktif saat outage

- Prioritas: jawaban siswa tersimpan di IndexedDB (PWA) dan akan sync otomatis.
- Jangan restart api/worker sebelum ujian selesai — gunakan jalur **break glass**
  (approval 2 orang) bila sangat mendesak, dan catat di audit log.
- Setelah pulih, cek `answers:sync` ACK & laporan live.

## 6. Suspected breach / refresh token dicuri

- Rotasi token sudah mendeteksi reuse & mencabut family (B-09).
- Jika ada indikasi kompromi: rotasi `JWT_SECRET` + `INTERNAL_TOKEN`,
  cabut semua refresh token (`TRUNCATE refresh_tokens` lewat role system),
  paksa login ulang, lalu audit `audit_logs`.

## 7. SSE mati / laporan live tidak update

- Cek koneksi: heartbeat `: keepalive` tiap 15 dtk harus terlihat.
- Cek topic: publisher mengirim ke `live:<tenant>` dan `live:<tenant>:<exam>`.
- Cek `sse_dropped_total` di `/metrics`; jika naik, perbesar buffer atau
  turunkan frekuensi publish.
- Pastikan nginx `proxy_buffering off` (sudah di `web/nginx.conf`).
