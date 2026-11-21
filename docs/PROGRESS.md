# PROGRESS — Status Pembangunan FlowCBT

Update terakhir: SSE real-time (FR-9.3) + export PDF (FR-9.11/3.7) selesai; smoke test E2E 51/51 PASS.

## Status Smoke Test E2E (tests/smoke_e2e.py)

**53 PASS / 0 FAIL** — mencakup AC-1 s.d. AC-12 dari PRD (offline answering,
auto-sync, idempotensi, submit offline, deadline, batas percobaan, publish
gating, penalti, isolasi tenant, import siswa, retensi stub, mobile payload).

## Kontrak API aktif (backend internal/api)

| Modul | Status | Catatan |
|---|---|---|
| auth guru (register/verify/login/refresh/logout/me/reset/change-email) | ✅ | internal/users |
| billing: plans, subscription, checkout, simulate-pay, webhooks, superadmin console, export-all, prorata | ✅ | internal/billing |
| classes & students + import/export xlsx/csv + track record + guru mgmt + auth siswa (login/guest) | ✅ | internal/students |
| question sets/questions (5 tipe AKM) + publish/version + import/export template + media | ✅ | internal/questionsets |
| exams CRUD + publish gating kuota + token + assignments + sync idempoten + submit + violations/penalti + cheating report + grading guru + regrade | ✅ | internal/exams |
| laporan live/history/exam stats/item-analysis/export xlsx+csv | ✅ | internal/reports |
| worker (retensi 7 hari + email jobs) | ✅ | cmd/worker |
| seeder data demo | ✅ | cmd/seed (tenant SMA Demo CBT, guru@demo.cbt / Guru#12345, 30 siswa, ujian DEMO01/AA3141) |
| superadmin | ✅ | superadmin@flowcbt.id / Admin#12345 |

## Halaman frontend

| Area | Status | Catatan |
|---|---|---|
| Fondasi router + tema dark/light + api client (auto-refresh) | ✅ | |
| src/guru/** (dashboard, siswa, kelas, soal, wizard ujian, monitoring, grading, laporan, billing, settings) | ✅ | |
| src/siswa/** (PWA offline-first: IndexedDB queue, sync, timer server, anti-cheat, review, history) | ✅ | |
| PWA build (service worker + manifest, precache) | ✅ | vite-plugin-pwa |

## Perbaikan penting saat integrasi (2026-11-20)

1. `grading.Grade` — pre-parse `json.RawMessage`/`[]byte` dari DB agar semua
   tipe soal (matching map, short answer string, mcq_complex array) dinilai benar.
2. `billing.applyPurchase` — urutan kolom SELECT vs Scan tertukar
   (status↔plan_id) sehingga simulate-pay/webhook tidak pernah menerapkan
   pembayaran. Diperbaiki; kredit ujian kini bertambah.
3. `reports` — CTE `ex` kurang kolom `question_set_id`/`question_set_version_id`
   (live detail), `COALESCE(cheating_status,'none')` untuk baris tanpa attempt
   (rekap & export).
4. `exams` — `recomputeScore` parameter `$2` tak terpakai; `regrade` menutup
   rows sebelum query lanjutan (conn busy); regrade kini **mempertahankan skor
   manual guru** (FR-8.3/8.4); placeholder uraian pakai `graded_by='auto'`
   agar `final_score_pending` akurat di submit/result/monitoring/grading.
5. `students` — GET /students/{id}: nil-pointer panic dihapus; ID tak-valid
   → 404 (AC-9).

## Tambahan 2026-11-20 (putaran 4 — Enterprise Design System per directive user)

Overhaul visual ke sistem enterprise Slate + Precision Blue sesuai directive:
- Token: slate scale (#f8fafc/#fff/slate-200/#0f172a; dark #0f172a/#1e293b/#334155),
  Precision Blue #2563eb (tombol) / #60a5fa (aksen dark), Emerald #059669, Amber
  #d97706, Crimson #dc2626; font-mono (JetBrains Mono/Fira Code) utk timer/kode/nomor.
- Anti-AI: nol rounded-2xl/3xl, border-first shadow-xs, radius md/lg saja.
- Engin ujian siswa: split-panel desktop (grid [1fr_360px]), header utilitas 56px
  (judul+kode mono, timer mono, fokus merah <=5 menit, badge sinkron, kontrol
  ukuran teks A-/A+, tema, pill profil), action bar 64px sticky (Sebelumnya ·
  Ragu amber · Selanjutnya/Selesaikan), option card full-width (border-2 biru
  saat pilih, kotak huruf mono, 48px), peta soal .q-nav 40px (hijau-jawab,
  amber-ragu+⚑, abu-kosong, ring-biru-aktif), keyboard A-E/1-5/R/panah.
- Workspace guru: tabel dense sticky-header + toolbar count + sort ↑↓ (Nama/
  Kelas/Tanggal/Nilai), batch pilih semua → Pindah Kelas/Hapus dgn progres,
  dashboard metric font-mono + tren (tanpa mengarang data), paket aktif
  highlight, badge soft semua status, modal/toast crisp, auth shells rapi.
- Mobile: nomor target sentuh 48px utk jawaban, tabel per kartu complete
  data-th, tanpa overflow di 375px, bottom nav + sheet peta soal.

Verifikasi: tsc/build/PWA lulus; smoke 53/53; grep nol rounded-2xl/3xl &
nol bg-primary text- non-token; dev server berjalan utk uji langsung.

## Tambahan 2026-11-20 (putaran 3 — audit UI/UX & keandalan penuh)

Audit menyeluruh oleh 2 auditor (UI/UX + keandalan): 25 + 34 temuan → diperbaiki.

**Desain & UX:**
- ToastProvider terpasang (semua toast kini benar-benar tampil); ErrorBoundary global
  (crash render → kartu pemulihan, bukan layar putih).
- Token warna WCAG AA diukur ulang untuk light/dark (muted 7.4:1, primary-fg dark 6.3:1,
  danger/success/warn naik di kedua tema); theme-color & manifest sinkron token.
- Sinkronisasi HTML soal: helper `renderSimpleHtml` dipindah ke `lib/sanitize.ts`,
  diterapkan di halaman ujian siswa & koreksi guru (anti-XSS).
- Tombol tabel → `.btn-sm` (36px), checkbox `accent-color`, focus-visible ring,
  modal fokus awal+restore, search `aria-label`+`type=search`, wizard `aria-current` +
  error inline + beforeunload, ekstra waktu guru jadi menit, bottom nav 5 slot + "Lainnya",
  safe-area iOS, status attempt lewat `attemptStatus`, busy state export, konfirmasi hapus
  wacana, riwayat siswa punya state error, start ujian progress jujur per tahap.

**Keandalan:**
- [KRITIS] Sesi siswa kini tersimpan (`persistSession`) — area siswa berfungsi dari login.
- [KRITIS] Validator sync menerima `violation` & `submit` → antrean offline tak macet.
- [KRITIS] Timer siswa: `deadline_at` normalisasi epoch ms + `server_offset_ms` (tahan
  jam perangkat melenceng); merge recovery menghormati event lokal belum-ACK.
- [KRITIS] Submit offline: event `join submit` diantrekan sebelum submitSafe; Done.tsx
  mem-flush tiap 5 dtk sampai ACK ("Menunggu sinkronisasi" → "Terkirim").
- [KRITIS] Foto proktor kini multipart asli (bukan FormData ter-JSON); 4xx → buang lokal.
- Keamanan: webhook Mayar HMAC-SHA256 + fail-closed produksi; rate limit refresh/
  verify/forgot/reset 5/menit; eviksi rate-limiter map; MaxBytesReader 5MB body JSON;
  wbek `ON CONFLICT` unique per-attempt (migrasi 0005, dedupe aman).
- Keandalan server: `/readyz` (ping kedua pool), recoverer JSON + req_id,
  WriteTimeout 0 (SSE hidup penuh), conn pool lifetime, nginx 25m, worker panic-recover
  per job + backoff email + SMTP opsional (`SMTP_HOST`).
- Klien: fetch timeout + retry GET + sesi kadaluarsa → login sesuai area; SSE token segar
  saat reconnect + cooldown retry; polling jeda saat SSE live.

Unit test baru: auth limiter, webhook HMAC/fail-closed, recoverer JSON, worker email.

## Tambahan 2026-11-20 (putaran 2)

- **SSE real-time (FR-9.3):** `GET /reports/live/stream?token=&exam_id=` — snapshot tiap 5 dtk,
  auth via query token (EventSource), auto-reconnect + batas sesi 30 mnt; frontend hook
  `useLiveStream` dengan fallback polling otomatis + indikator status "Real-time".
- **Export PDF (FR-9.11, FR-3.7):** paket `internal/pdfgen` (go-pdf/fpdf) — rekap nilai per
  ujian (`?format=pdf`) & track record siswa (`/students/{id}/track-record?format=pdf`);
  tombol XLSX/CSV/PDF di laporan + PDF di profil siswa.

## Tambahan 2026-11-20 (putaran 5 — Enterprise UI/UX directive)

- **Overhaul Slate + Precision Blue** (tanpa gradien purple/glow, radius ketat
  `rounded-md/lg`, border `slate-200/800` di atas shadow) di seluruh guru + siswa.
- **Font self-hosted:** Inter Variable untuk UI, JetBrains Mono Variable khusus kode
  ujian, token, nomor soal, timer & nilai (via `@fontsource-variable`).
- **Ikon SVG stroke set** (`components/icons.tsx`, ~45 ikon + LogoMark) — audit
  emoji = 0 di seluruh UI guru & siswa.
- **Surface rapi:** SearchBox berikon, badge status pill lembut, chips tipe soal,
  EmptyState ilustratif, PageHeader dengan ikon, auth split-brand 2 kolom.
- Smoke E2E 53/53 hijau; build PWA precache 22 entri.

## Tambahan 2026-11-21 (putaran 6 — "Portal Ujian" gaya ANBK/Pusmendik)

Audit UI/UX menyeluruh bermula dari referensi simulasi TKA Pusmendik (via snapshot arsip),
dengan palet khas FlowCBT (Slate + Precision Blue, aksen ink `#0f1e33` + garis aksen 3px).
Spesifikasi di `docs/DESIGN_SYSTEM.md`.

### Desain
- **Editor siswa (Attempt)**: appbar institusional + identity, strip peserta/timer/sinkron/
  font-size/fullscreen, split panel `soal | Daftar Soal` full-height (CSS `exam-main` flex),
  bar aksi bawah 48px (Kembali/Ragu/Lanjut bersifat teks di mobile), peta soal bottom-sheet.
- **AuthPortal siswa full-bleed** (login & tamu): split brand layar penuh di desktop.
- **Tabs** responsif (label pendek + padding adaptif → 4 tab muat di 375px), aksi tabel
  bergaya outline konsisten (`tbody .btn-quiet` + varian danger), StatCard label tuntas
  (tanpa truncasi), tombol merah destruktif hanya outline.
- Istilah Indonesia konsisten: Published→Terbit, Draft→Draf, Unpublish→Tarik Terbit(an),
  Publish→Terbitkan; durasi live "7 j 46 mnt" (bukan "466 mnt").

### Perbaikan data/logika (hasil audit)
- **Resume attempt (FR-6.1/FR-7.8):** `/student/me/exams` mengembalikan
  `active_attempt_id`; attempt in_progress tetap bucket "open" meski kuota percobaan habis;
  dashboard siswa tombol "Lanjutkan" langsung ke runner; runner hidrat dari server
  (paket soal + jawaban) bila cache perangkat kosong / ganti browser.
- **Editor Bank Soal (KRITIS):** normalisasi tipe kanonik backend (mcq/mcq_complex/
  matching/short_answer/essay ↔ pg/pg_kompleks/menjodohkan/isian/uraian), answer_key
  (correct/pairs/answers/rubric), options {id,text}; payload simpan kini valid —
  7/7 soal demo tersimpan 200 OK; toolbar format teks (B/I/U/daftar) untuk teks soal.
  Backend: rentang pasangan menjodohkan dilonggarkan 2–10 (sebelumnya 4–6 menolak data sah).
- **Pagination guru:** `next_cursor` numerik kini dikenali → "Muat lebih banyak" muncul
  (siswa 31, sebelumnya 25 terpotong).
- **Countdown badge "dilaporkan curang"** di laporan live: hanya bila status bukan
  none/kosong (sebelumnya semua baris berbadge).
- **Billing:** kartu paket menampilkan satuan harga benar (per bulan / sekali bayar /
  14 hari), kuota peserta (min–maks siswa) dan kuota ujian; trial nonaktif utk dibeli;
  invoice kolom "Tanggal" (created_at) + modal "Detail transaksi" (link PDF internal
  dihapus — tidak pernah tersedia).
- **Nilai skala-100:** Riwayat siswa & halaman Done memakai final_score (80) bukan skor
  mentah (17); Done menampilkan skor mentah + penalti pelanggaran transparan (AC-8),
  status "Nilai sementara" bila uraian belum dinilai.
- **Statistik paket soal:** `question_count` (kontrak sebenarnya) → "Total soal" benar.

### Verifikasi
- `tsc` 0 error; build PWA OK (precache 22); smoke E2E API **53/53 PASS**;
  `go test ./internal/questionsets ./internal/grading` hijau.
- Playwright: 16 halaman guru × (1440/375) tanpa horizontal overflow & tanpa console
  error; alur siswa (login → dashboard → Lanjutkan → attempt) di 1440 & 375 OK;
  jendela demo DEMO01 diperpanjang 8 jam untuk pengujian.

## Remaining backlog (P1/P2, tidak memblokir MVP)

- E2E PWA offline di browser nyata (Playwright), uji beban k6.
- Integrasi Mayar/Midtrans produksi (butuh kredensial merchant).
- Email SMTP nyata (butuh kredensial SMTP; job queue & template sudah siap).
- Snapshot expiry cleanup worker — verifikasi berkala.
- OpenAPI spec export + dokumentasi deploy lanjutan.
