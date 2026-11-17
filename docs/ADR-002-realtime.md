# ADR-002: Strategi realtime laporan live

- **Status:** Diterima
- **Tanggal:** 17 November 2026
- **Konteks:** SSE in-process (`realtime.Hub`) tidak bekerja jika API dijalankan
  lebih dari satu replika: subscriber terhubung ke replika A, event terjadi di
  replika B. Heartbeat juga tidak ada sehingga proxy memutus koneksi idle.

## Keputusan

1. Untuk **single-replica** (dev / deploy kecil), `Hub` in-process dipertahankan,
   tetapi sudah dilengkapi heartbeat 15 detik, `retry:`, dan metrik drop (B-07).
2. Untuk **multi-replica produksi**, gunakan **Redis Pub/Sub** di belakang
   antarmuka `Hub` yang sama. Event dari `syncAnswers`/`submit`/`violations`
   dipublikasikan ke topik `live:<tenant>` dan `live:<tenant>:<exam>`.
3. Klien guru memakai **fetch-stream dengan header Authorization**, bukan
   `EventSource`, karena endpoint SSE tetap berada di belakang `AuthN`.

## Alternatif yang dipertimbangkan

- **Postgres LISTEN/NOTIFY:** tidak perlu komponen baru (Redis sudah ada untuk
  rate limit), tapi NOTIFY tidak persisten dan payload terbatas 8 KB. Dipilih
  sebagai fallback bila Redis tidak tersedia.
- **WebSocket:** overkill untuk aliran satu arah (server → guru).

## Konsekuensi

- `Hub` harus tetap menjadi antarmuka; implementasi Redis bisa ditambahkan tanpa
  mengubah handler.
- Perlu metrik `sse_clients` dan `sse_dropped_total` (sudah ada sebagian di
  `/metrics`) untuk mengingatkan bila koneksi mati saat ujian aktif.
