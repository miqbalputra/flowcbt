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

## Tambahan 2026-11-21 (putaran 7 — teks soal jadi TEKS BIASA, tanpa HTML)

Keputusan produk: guru **tidak lagi** menulis tag HTML. Hint lama
"Boleh HTML sederhana: `<b> <i> <ul> <li> <table>`" + toolbar B/I/U/daftar
dihapus — guru SMP/SMA bingung dan tag bocor sebagai teks. Menggantikan rencana
TipTap/rich text (PRD §12 "sanitasi rich text") dengan pendekatan yang lebih
sederhana dan lebih aman: teks biasa masuk, HTML aman keluar saat render.

### Editor Bank Soal
- Kotak **Teks soal** & **Isi wacana** kini teks biasa. Tombol tinggal `1.` dan `•`
  (pasang/lepas penanda daftar di baris kursor) + pratinjau tampilan siswa.
- **Daftar otomatis:** Enter di butir daftar melanjutkan penomoran/butir
  (`1.` → `2.`, `•` → `•`, indentasi dipertahankan); Enter pada butir kosong
  mengakhiri daftar. Berlaku juga di opsi, pasangan menjodohkan, rubrik, pembahasan.
- **Huruf kapital otomatis** saat mengetik: awal teks, awal baris, dan setelah
  `.` `!` `?`. Angka tidak disentuh (`5 km` tetap kecil, `3.14` aman), penanda
  daftar (`1.`, `a.`, `ii.`, `-`) tidak diubah.
- Kursor dijaga dengan `flushSync` (bukan `requestAnimationFrame` — rAF sempat
  "mencuri" kursor saat mengetik cepat/paste; ditemukan lewat uji Playwright).

### Render (guru & siswa)
- `lib/sanitize.ts` ditulis ulang: `htmlToText()` (kompatibilitas data lama),
  `autoCapitalize()`, `renderText()` (paragraf + `<ol>/<ul>` + kapital),
  `renderInline()` (opsi/pasangan). Semua teks di-escape lebih dulu → tidak ada
  tag kiriman pengguna yang lolos (lebih ketat dari allowlist tag sebelumnya).
- Kelas CSS baru `.rich-text` mengembalikan gaya daftar/paragraf yang direset
  preflight Tailwind (butir, nomor, huruf `a)`/`A)`, `li::marker` muted).
- Data lama ber-`<p>/<br>/<li>` otomatis dikonversi ke teks biasa saat dibuka &
  disimpan ulang (isi tetap, `<b>` tebal hilang); soal tanpa tag tetap utuh.
- Normalisasi juga dipakai di pratinjau, halaman grading guru, layar ujian siswa,
  kartu wacana, dan opsi/pasangan (tidak ada lagi HTML mentah tampil sebagai teks).
- Logika Enter/penanda dipisah ke `guru/qsets/textEdit.ts` (fungsi murni) agar
  bisa diuji tanpa DOM.

### Verifikasi
- `tsc` 0 error; `npm run build` lulus (precache 22 entri).
- Uji perilaku di Chromium (Playwright): ketik butir bernomor dengan huruf kecil →
  nomor lanjut + kapital benar; Enter pada butir kosong keluar daftar; ketik di
  tengah teks tidak menggeser kursor; tombol `1.`/`•` bekerja; 0 error konsol.
- Uji renderer (node): paragraf, daftar angka/butir/huruf, `start` non-1,
  HTML lama (`<p>`, `<ul>`, `<li>`), entitas backend (`&lt;`), XSS (`<script>`,
  `<img onerror>`), teks kosong.

## Tambahan 2026-11-22 (putaran 8 — teks soal BERFORMAT ala Google Form)

Keputusan: putaran 7 (teks biasa) diganti editor WYSIWYG ringan. Guru **tidak**
menulis tag HTML; yang tersimpan hanya HTML dari allowlist.

### `frontend/src/components/RichEditor.tsx` (baru)
- `contentEditable` + toolbar B / I / U / daftar butir / daftar nomor / x² / x₂ /
  hapus format. `execCommand` dipakai hanya untuk format inline
  (`styleWithCSS=false` → menghasilkan `<b>/<i>/<u>`, bukan `<span style>`).
- **Daftar dibuat manual via DOM**, bukan `insertOrderedList`: Chromium menaruh
  `<ol>` di dalam `<p>` (HTML tidak sah) — ditemukan lewat uji Playwright.
- Enter di baris `1. …`/`- …` → butir daftar; Enter di butir kosong → keluar
  daftar (Chromium tidak keluar sendiri karena ada `<br>` pengisi).
- Penanda teks yang meniru nomor butir (`1. abc` di dalam `<li>`) dibuang sebelum
  Enter supaya tidak tampil ganda. `markerLen()` menghitung panjang penanda dari
  sisa teks (bug awal: `m[0].length` memakan seluruh baris).
- **Baris baru tidak mewarisi format** baris sebelumnya (`resetBlankBlock()` +
  `clearPendingStyle()` — Chromium menyimpan "typing style" walau DOM diganti).
- Ctrl+A + Delete yang menyisakan `<ol><li><br></li></ol>` dibersihkan jadi satu
  paragraf (`onInput`) agar ketikan berikutnya tidak jadi butir daftar.
- Tempel selalu teks biasa → `renderText()`; satu baris disisipkan inline,
  banyak baris jadi blok baru setelah paragraf kursor (`insertBlocksAfterCaret`).
- Kapital otomatis saat mengetik lewat `beforeinput`. Catatan: React memetakan
  event ini via polyfill `textInput` sehingga `inputType` **undefined** —
  penjagaan harus mengizinkan `inputType` kosong. NBSP (U+00A0) dari Chromium
  (spasi di ujung baris) dinormalkan agar aturan "setelah . ! ?" tetap berlaku.

### Penyimpanan & render
- `lib/sanitize.ts`: `sanitizeRich()` (tokenizer allowlist: `b/strong→b`,
  `i/em→i`, `u`, `s`, `sup`, `sub`, `br`, `p/div`, `ul/ol/li`; atribut dibuang;
  `<script>/<style>` beserta isinya dibuang), `renderRich()` (HTML → sanitasi,
  teks biasa → `renderText`), `tidyRich()` (buang `<br>` pengisi di ujung `<p>/<li>`).
- Entitas di segmen teks di-decode dulu sebelum di-escape: `innerHTML` Chromium
  menulis NBSP sebagai `&nbsp;`, dan escape mentah membuat `&amp;nbsp;` yang
  tampil harfiah (bug ditemukan saat uji simpan→muat ulang).
- Badan soal & isi wacana memakai `RichEditor`; pratinjau, grading, dan layar
  siswa memakai `renderRich`. Opsi/pasangan tetap `renderInline`/`htmlToText`.
- Backend: allowlist `sanitizeHTML` ditambah `s` (coret) agar setara FE.

### Perbaikan bug non-format yang ketemu saat uji
- `PUT /api/v1/question-sets/{id}` → 500 `INTERNAL`: FE tidak mengirim
  `exam_code`, handler menulis `''` sehingga menabrak unique `(tenant_id,
  exam_code)` dan **menghapus kode ujian** paket. Kini `exam_code` kosong =
  pertahankan nilai lama. FE juga mengirim `level_tag` (string dipisah koma)
  sesuai kontrak backend, bukan `level_tags` (array) yang dulu diabaikan.
- `Modal`: efek berfokus ulang berjalan setiap render karena `onClose` selalu
  fungsi baru → fokus lompat keluar dari input saat mengetik (wacana/modal
  lain). `onClose` dipindah ke ref; efek hanya bergantung pada `open`.
- Salinan bantuan yang masih menyebut "tanpa kode HTML"/"teks biasa" diperbarui.

### Verifikasi
- `tsc -b --noEmit` 0 error, `npm run build` lulus, `go vet`/`go test ./...` hijau
  (termasuk kasus baru: daftar + `b/i/u/s/sup/sub` lolos `sanitizeHTML`).
- Playwright (Chromium, data lokal): ketik `1. …` → `<ol>` tanpa penanda ganda;
  Enter pada butir kosong keluar daftar; B/I/U via tombol & Ctrl+B; sup hanya
  pada karakter terpilih; baris setelah sup bersih; Ctrl+A+Delete lalu mengetik
  bersih; tempel multi-baris → `<p>/<ol>/<ul>` sah; simpan draft → muat ulang →
  format bertahan, tanpa atribut `style`/`class`, tanpa `&amp;amp;`; pratinjau
  merender daftar + format; layar siswa (`/s/attempt/...`) tetap normal; 375 px
  tanpa overflow horizontal; 0 error konsol.
- Catatan data uji: `&amp;nbsp;` yang terlanjur tersimpan dari uji putaran ini
  dibersihkan lewat SQL (`replace(..., '&amp;nbsp;', '&nbsp;')` di `questions`,
  `stimuli`).

## Tambahan 2026-11-22 (putaran 9 — Kartu Ujian gaya TKA + WhatsApp)

Permintaan: kartu peserta seperti **TKA asli** (template PDF dari Google Drive),
unduh PDF semua/per siswa, dan kirim otomatis lewat WhatsApp.

### Template & tata letak cetak
- Template TKA diunduh dari Drive (`1RqVpJBb7ETT1X4sJH4JyWw58fhPux6F4`, 8 hlm)
  lalu direplikasi dengan `fpdf` (`internal/cards/pdf.go`): **3 peserta per
  halaman A4**, tiap peserta **2 salinan** (PANITIA kiri, PESERTA kanan).
- Kepala halaman 3 baris (pemerintah/kementerian → satuan pendidikan), lalu
  tabel 4 baris: Nomor Peserta, Nama Peserta, Tmp & Tanggal Lahir, Asal Sekolah;
  bawah: kotak foto 3×4, tanda tangan "Kota, tanggal / Kepala Satuan Pendidikan,
  / nama / NIP", dan QR.
- Foto dibaca **hanya** dari media lokal (`/api/v1/media/{tenant}/{file}` →
  `UploadDir`); tanpa jaringan. Tanpa foto → kotak placeholder "FOTO 3x4".

### Nomor peserta
- Format TKA: `TA-{yy}-{region_code}-{school_code}-{urut:04d}-{check digit Luhn}`
  contoh `TA-26-03-10-0028-0001-2`.
- Disimpan stabil di tabel `exam_cards` (unique `exam_id+student_id` dan
  `exam_id+number`), ada `POST /exams/{id}/cards/renumber` untuk menata ulang.
- `region_code`/`school_code` diisi lewat modal **Identitas sekolah**
  (`GET/PUT /school-profile`), sekaligus untuk kepala kartu (kota, kepala
  sekolah, NIP).

### PDF & WhatsApp
- `GET /exams/{id}/cards/pdf` (semua peserta) dan
  `GET /exams/{id}/cards/{studentID}/pdf` (satu peserta).
- QR memakai `github.com/skip2/go-qrcode`, payload
  `FLOWCBT|{examCode}|{number}|{studentCode}`.
- Teks WhatsApp dibuat backend (nama, nomor peserta, kelas, TTL, ujian, jadwal
  WIB, durasi, token, tautan PDF) → FE hanya menyusun `https://wa.me/<62…>?text=`.
  `08xx` dinormalkan ke `628xx`; tautan PDF muncul bila `PUBLIC_BASE_URL` diisi
  (env baru, default kosong) dan **tetap** butuh login guru untuk mengunduh.

### File
- Backend baru: `internal/cards/{module,data,handlers,pdf}.go`; migrasi
  `0006_exam_cards.up.sql` (kolom tenants: address, city, principal_name,
  principal_nip, region_code, school_code; students: birth_place, birth_date,
  phone; tabel `exam_cards` + RLS + grant).
- Frontend baru: `guru/exams/cards.tsx` (statistik, tabel desktop + list mobile,
  unduh PDF semua/per siswa, tautan WA + salin teks, modal identitas sekolah),
  route `/exams/:id/cards`, tombol **Kartu Ujian** di detail ujian, ikon
  `IconPrint`/`IconPhone`.
- `students.tsx`: field tempat/tanggal lahir, HP siswa, HP orang tua; modal edit
  memuat detail dulu (list tak memuat data lahir/HP).

### Bug yang ketemu saat uji (diperbaiki)
- `GET /api/v1/students/{id}` **mengabaikan id**: `studentSelect` berakhir dengan
  klausa `JOIN ... ON`, lalu detail menambahkan `` ` AND s.id=$1` `` sehingga
  filter menempel ke ON dan **selalu mengembalikan siswa pertama tenant** (yang
  muncul: tamu "Tamu Satu"). Kini `studentDetailByID` memakai `WHERE`, dengan
  `scanStudentDetail` (15 kolom) — sekaligus menghapus query kontak kedua.
- Query kontak memilih 5 kolom tapi hanya 4 tujuan `Scan` → `parent_phone`
  bergeser ke `phone`, HP ortu hilang dan HP siswa selalu kosong.
- `students.tsx` mengirim `full_name` padahal API memakai `name` → simpan edit
  tidak berubah. Regresi dijaga `TestStudentDetailByIDFiltersInWhere` &
  `TestStudentDetailSelectFifteenColumns`.
- Kartu statistik "Jadwal" memotong tanggal di 375 px ("22 Nov 20…") → tanggal
  ringkas + tahun di baris keterangan.
- Catatan data uji: dua siswa demo (NIS 2001/2011) sempat berubah nama jadi
  "Tamu Satu" akibat bug di atas; sudah dikembalikan lewat SQL.

### Verifikasi
- `go vet ./...`, `go test ./...`, `tsc -b --noEmit`, `npm run build` hijau.
- PDF: 30 peserta → 10 halaman, 30× "Nomor Peserta"; per siswa → 1 halaman;
  render PNG dibandingkan dengan template TKA.
- Playwright (Chromium, data lokal): 30 baris kartu, nomor
  `TA-26-03-10-0028-0001-2`, href WA benar, unduh semua (`kartu-DEMO01.pdf`) &
  per siswa (`kartu-TA-26-….pdf`), simpan identitas sekolah 200, form siswa
  simpan→muat ulang bertahan, 375 px tanpa overflow, 0 error konsol.

## Tambahan 2026-11-22 (putaran 10 — kartu PDF dirapikan, identik dengan template TKA)

Template TKA dianalisis langsung dari PDF-nya (stream konten + `pdftotext -bbox`):
halaman 869×1229 unit (1u = 0,2417 mm), font 11u (≈7,5pt) dengan baseline persis.

### Geometri yang kini ditiru apa adanya (`internal/cards/pdf.go`)
- Kepala halaman: 3 baris bold dipusatkan, baseline 53/65/77u —
  "KARTU PESERTA {ujian}" / "{sekolah}" / "TAHUN PELAJARAN {tahun}".
- Kartu 393×278u di x=42/443u dan y=88/374/660u (3 peserta × 2 salinan per halaman).
- Kotak kartu dengan garis horizontal di y=53/76/99/123/147u; garis vertikal x=339u
  **hanya pada baris pertama** — itulah kotak PANITIA/PESERTA (dulu salah: label
  peran menempel di kepala kartu).
- Lambang **Tut Wuri Handayani** diekstrak dari template (`pdfimages`) lalu
  disimpan sebagai **base64 di `internal/cards/emblem.go`** (tool push GitHub
  hanya bisa mengirim teks — PNG biner rusak bila dikirim mentah, karena itu
  tidak lagi memakai `go:embed assets/emblem.png`), di-decode saat init dan
  digambar 40×40u di (6,6) — menggantikan lingkaran inisial lama.
- Judul kartu 3 baris bold dipusatkan (baseline 19/31/43u).
- Tabel: label x=5,78u, kolon x=133,69u, nilai x=146,75u, baseline baris+16u,
  **tanpa garis vertikal antar kolom** (ciri khas template); nilai teks biasa
  (bukan bold) dan menjorok bila terlalu panjang.
- Bagian bawah: kotak foto 82×109u di (11,157); teks x=102,78u dengan baseline
  167 ("Purbalingga, 22 November 2026"), 179 ("Kepala Satuan Pendidikan,"),
  253 (nama kepala), 265 ("NIP. …"); QR 60×60u di (322,205).
- Area stempel/tanda tangan dibiarkan kosong (data per sekolah, tidak ada di
  template generik); foto tampil bila siswa mengunggah, selain itu kotak
  berlabel "FOTO 3x4".

### Verifikasi
- `go vet`/`go test ./...` hijau; PDF 30 peserta → 10 halaman; render PNG halaman 1
  dibandingkan berdampingan dengan template: posisi kotak, garis, lambang, peran
  PANITIA/PESERTA, dan QR sama.

## Tambahan 2026-11-22 (putaran 11 — login dari kartu: kode ujian + token + nomor peserta)

Pertanyaan user: "diberikan kartu ujian, login pakai apa? ada token? nomor pesertanya?
apakah nomor peserta otomatis terdeteksi?" Jawabannya kini: **ya**.

### Alur login dengan kartu
- Kartu kini juga memuat **kode ujian + token** (footer kecil di bawah kartu pada PDF,
  plus baris baru pada pesan WhatsApp: kode ujian, token, dan tautan masuk `/s/guest`).
- Form `/s/guest` (peserta tamu) kini punya field **Nomor peserta (dari kartu ujian)**.
  Setelah kode ujian + token + nomor terisi, frontend memanggil
  `POST /student/auth/card-lookup` (debounce 450ms) — bila kartu valid, identitas
  (nama, kelas, NIS, jenis kelamin) **terisi otomatis** dan field dikunci (readOnly)
  dengan lencana "Kartu valid". Nomor boleh diketik tanpa tanda hubung/spasi
  (`normalizeCardNumber` + `regexp_replace` di SQL menyamakan keduanya).
- Submit mengirim `card_number` ke `POST /student/auth/guest`; backend resolve
  siswa dari `exam_cards` (exam + nomor) — tanpa nama/JK manual pun tetap masuk dan
  `is_guest_matched=true` (sesi tetap dibuat sebagai siswa terdaftar pada kartu).
- Validasi lama dipertahankan: tanpa nomor kartu, nama + jenis kelamin tetap wajib.
  Nomor kartu salah → 404 `CARD_NOT_FOUND`; kode/token salah → 401 `TOKEN_INVALID`.
  Rate limit: lookup 30/menit per ip+kode, guest 20/menit (plus varian ":card").
- Bug lama ikut diperbaiki: form tamu dulu tidak mengirim `gender` padahal backend
  mewajibkannya → login tamu manual selalu 400. Kini ada select jenis kelamin.

### Berkas
- Backend: `internal/students/auth_student.go` (card-lookup, card_number di guest,
  findCardStudent, normalizeCardNumber + test), `students.go` (route baru),
  `internal/cards/data.go` (pesan WA memuat kode ujian + token + tautan masuk),
  `internal/cards/pdf.go` (footer halaman: kode ujian, token, alamat masuk).
- Frontend: `siswa/pages/Guest.tsx` (field nomor peserta + auto-lookup + JK),
  `siswa/lib/student-api.ts` (cardLookup, card_number di guestLogin).

### Verifikasi
- `go vet`/`go test ./...` (termasuk `TestNormalizeCardNumber`), `tsc -b --noEmit`,
  `npm run build` hijau.
- API: lookup valid (dengan/ tanpa tanda hubung) → 200 berisi nama/kelas/NIS/JK;
  nomor salah → 404; token salah → 401; guest login via kartu saja → sesi + identitas
  benar (mis. Bunga Lestari, NIS 2002, X-1).
- Playwright 375px: isi kode+token+nomor (huruf kecil, spasi) → nama/kelas/JK terisi
  otomatis, lencana "Kartu valid", submit → masuk ke `/s/exams` dan ujian DEMO01
  muncul; nomor salah → pesan "tidak terdaftar"; 0 error konsol (kecuali 404 uji sengaja).

## Tambahan 2026-11-22 (putaran 12 — /reports rusak, audit menyeluruh, insiden RCE dev server)

### 1. `/reports` tidak bisa diakses → halaman indeks dibuat
Route `/reports` memang belum pernah ada (hanya `/reports/live`,
`/reports/history`, `/reports/exams/:id`) sehingga publik melihat 404 SPA.
Kini ada hub **Laporan** (`frontend/src/guru/reports/index.tsx`): ringkasan
statistik, kartu **Pantauan Live** + **Riwayat Ujian**, daftar ujian berjalan
(attendance bar) dan arsip terbaru. Route ditambahkan di `App.tsx`
(`/reports` → `ReportsHome`), ikon `IconHistory` ditambahkan.

### 2. Bug hasil audit (ditemukan & diperbaiki)
- `guru/exams/grading.tsx`: memuat detail ujian dengan `send()` (default POST)
  → 405 Method Not Allowed. Diganti `api()` (GET).
- `siswa/db.ts`: store `queue` di IndexedDB **tidak pernah punya index
  `by_attempt`** padahal semua kode sync memakai `getAllFromIndex('queue',
  'by_attempt', …)` → `NotFoundError: index not found`, antrean jawaban tidak
  pernah terkirim dan sinkronisasi diam-diam gagal. DB dinaikkan ke **v2**
  dengan migrasi `upgrade(db, old, new, tx)` yang membuat index tersebut, plus
  jaring pengaman `getQueueFor()`/`eventsForAttempt()` (fallback `getAll` +
  filter) untuk DB lama. Diuji: DB v1 lama → otomatis jadi v2 + index dibuat,
  0 error.
- `siswa/pages/Start.tsx`: tombol **Mulai Ujian** aktif walau token kosong →
  server membalas `VALIDATION` mentah. Kini tombol nonaktif sampai token
  terisi (4–12 karakter), hint berubah sesuai keadaan, dan pesan validasi
  diterjemahkan ("Token tidak valid atau belum diisi…").
- Token kini **terisi otomatis** di halaman Mulai: `rememberExamToken()` di
  `lib/util.ts` menyimpan token yang berhasil dipakai login tamu (sessionStorage)
  dan `Start.tsx` membacanya lewat `lastExamToken()` — peserta tidak perlu
  mengetik token dua kali.

### 3. Insiden keamanan: Vite dev server terbuka ke publik
Selama audit, Vite 5.4.0 (dev server) yang dijalankan `--host 0.0.0.0:5173`
menerima percobaan **RCE** lewat injeksi `import.meta.glob` (payload
`RCE_B64:QzA=` + `globalThis._oc=…`); overlay error-nya muncul di semua klien
(membuat uji Playwright gagal intermiten). Pemeriksaan sistem: tidak ada
persistensi (`authorized_keys` kosong, crontab normal, tidak ada proses/berkas
aneh, tidak ada koneksi keluar mencurigakan).
Mitigasi:
- dev server dimatikan; Vite di-upgrade `5.4.0` → **5.4.21**;
- `vite.config.ts` → `host: '127.0.0.1'` + `strictPort`, dengan komentar
  peringatan agar tidak diekspos;
- akses publik dilayani **server statis Go** baru `backend/cmd/webserve`
  (`-addr 0.0.0.0:5173 -dist frontend/dist -api http://127.0.0.1:8080`):
  menyajikan SPA + proxy `/api` (flush SSE untuk `/reports/live/stream`),
  `/healthz`, dan security headers (X-Content-Type-Options, Referrer-Policy,
  X-Frame-Options, CSP dasar).

### 4. Hasil audit (hijau)
- Playwright guru 1280 & 375: dashboard, kelas, siswa, bank soal, ujian, detail
  ujian, kartu, kecurangan, penilaian, **/reports + 3 sub-halaman**, billing,
  pengaturan → 0 error konsol, 0 HTTP ≥400, tidak ada halaman 404,
  tidak ada overflow horizontal.
- API smoke: auth/me, dashboard, classes, students(+detail/track-record/export/
  template), teachers, question-sets(+detail), exams(+detail/attempts/cheating/
  cards/cards-pdf), reports live/history/exam/item-analysis/export, billing,
  `/plans`, school-profile → 200; SSE live mengirim snapshot.
- **Alur peserta E2E** (Playwright, publik): login tamu (kode `DEMO01`, token
  `L4EJXB`, kartu `TA-26-03-10-0028-0004-9`) → identitas terisi otomatis →
  halaman Mulai (token sudah prefill, tombol terkunci sampai setuju) → runner →
  jawab 7 soal → review → **Selesai & Kirim** → `/done` "Jawaban berhasil
  diserahkan", nilai sementara 15. Di sisi guru, attempt muncul sebagai
  `submitted` dengan skor 3 (PG) dan uraian menunggu penilaian.
  0 error konsol, 0 HTTP ≥400.
- `go vet ./...`, `go test ./...`, `npx tsc -b --noEmit`, `npm run build` hijau.

### Berkas
- Baru: `frontend/src/guru/reports/index.tsx`, `backend/cmd/webserve/main.go`.
- Ubah: `App.tsx`, `components/icons.tsx`, `guru/exams/grading.tsx`,
  `siswa/db.ts`, `siswa/lib/queue.ts`, `siswa/lib/util.ts`,
  `siswa/pages/Guest.tsx`, `siswa/pages/Start.tsx`, `frontend/vite.config.ts`,
  `frontend/package.json` + lock (vite 5.4.21).

### Catatan operasional
- **Jangan** mengekspos `npm run dev` ke internet. Untuk publik:
  `cd frontend && npm run build`, lalu
  `go run ./cmd/webserve -addr 0.0.0.0:5173 -dist ../frontend/dist -api http://127.0.0.1:8080`.
- Vite dev tetap bisa dipakai lokal di `http://127.0.0.1:5173` (host default).

## Tambahan 2026-11-22 (putaran 13 — builder soal gaya Google Form)

### Masalah
Kartu soal di editor paket soal terlalu besar dan berlapis-lapis: tiap soal
setinggi **536–764 px** (header chip tipe + poin + status, kotak teks berbingkai
tebal dengan hint panjang, kotak opsi berbingkai per baris, field poin &
pembahasan selalu terbuka). Guru merasa pembuatan soal membingungkan.

### Perubahan (frontend saja)
- **Kartu soal baru gaya Google Form** (`guru/qsets/editor.tsx` + `styles.css`,
  kelas `.gf-*`): kartu putih bergaris tipis dengan aksen kiri biru, padding
  rapat, tanpa label "TEKS SOAL"/"OPSI JAWABAN".
  - Pertanyaan = kolom bergaris bawah (bukan kotak), placeholder "Pertanyaan",
    font 15 px; toolbar B/I/U/daftar/pangkat tetap ada tapi kecil (26 px).
  - **Dropdown tipe soal** di bawah pertanyaan (Pilihan Ganda, PG Kompleks,
    Menjodohkan, Isian Singkat, Uraian) — tipe bisa diganti tanpa kehilangan
    teks/poin/pembahasan; opsi ikut terbawa saat pindah PG ↔ PG Kompleks.
  - Opsi jawaban = bulatan/kotak centang + teks bergaris bawah, "Tambah opsi"
    berupa tautan, tombol hapus muncul saat hover; petunjuk kecil
    "Bulatan kiri = kunci jawaban" / "Centang = jawaban benar".
  - Menjodohkan: dua kolom bergaris (kiri ↔ kanan) langsung 2 baris.
  - Isian: baris kunci jawaban bergaris + "Tambah kunci".
  - Uraian: satu baris keterangan; rubrik pindah ke pengaturan.
  - **Pengaturan lanjutan** (poin, pembahasan, acak opsi, skoring, rubrik)
    dilipat per soal dan dibuka lewat tautan "Pengaturan" di baris tipe.
- **Payload lebih toleran** (`questionPayload`): baris opsi/pasangan/kunci yang
  kosong dibuang dan label A–E dirapatkan (perilaku Google Form), sehingga draft
  tidak lagi ditolak server dengan pesan mentah "opsi C: teks kosong".
- **Validasi ramah sebelum kirim** (`payloadProblem`): "Soal 2: isi minimal 2
  pilihan jawaban", "Soal 1: pilih kunci jawaban…", "Soal 3: isi minimal 2
  pasangan…", dst. Semua soal diperiksa dulu supaya tidak ada simpan separuh.
- Soal PG/PG Kompleks baru langsung berisi **2 opsi** (seperti Google Form) dengan
  tautan "Tambah opsi" sampai 5; soal menjodohkan baru langsung 2 pasangan
  (syarat minimum backend).
- Perbaikan bug: soal Isian baru tidak menampilkan baris kunci (karena
  `strArr([''])` menyaring string kosong) — kini selalu ada satu baris kunci.

### Hasil
- Tinggi kartu: **536–764 px → 229–331 px** (≈55–65% lebih ringkas); kartu PG
  baru yang masih kosong = **278 px**, PG 2 opsi = 263 px, isian = 229 px,
  uraian = 189 px (pengaturan tertutup).
- Playwright: kelima tipe dibuat lewat modal, diisi, disimpan, halaman di-reload
  → tipe & kunci (PG A, PG kompleks A+C, pasangan Indonesia–Jakarta/Jepang–Tokyo,
  kunci isian 15, rubrik uraian) semuanya tersimpan; pratinjau siswa terbuka;
  0 error konsol, 0 HTTP ≥400; tanpa overflow di 375 px.
- Ganti tipe lewat dropdown (PG → Isian) mempertahankan teks soal, lalu tersimpan
  sebagai `short_answer` setelah reload.
- Audit guru 1280/375 tetap hijau; `tsc -b --noEmit` + `npm run build` hijau.

### Berkas
- `frontend/src/guru/qsets/editor.tsx` — kartu soal baru, `changeType`,
  `compactOptions`, `payloadProblem`.
- `frontend/src/styles.css` — blok CSS "BUILDER SOAL — kartu ringkas gaya Google
  Form" (`.gf-card`, `.gf-q`, `.gf-type`, `.gf-opt`, `.gf-line`, `.gf-add`,
  `.gf-more`).

## Tambahan 2026-11-22 (putaran 14 — bank soal + builder naik kelas "enterprise")

### Bank Soal (daftar paket) — dari tabel ke kartu
- Tabel datar diganti **kartu** gaya daftar Google Form/GDrive (`article.qcard`):
  badge status, waktu relatif ("3 jam lalu"), judul 2 baris + deskripsi 1 baris,
  chip meta (mapel · kode · jumlah soal), tombol "Buka editor" + aksi ikon
  (duplikat / export / arsip) di footer kartu.
- **Urutkan**: Terbaru diperbarui / Judul A–Z (seleksi di toolbar).
- Tab status, pencarian, KPI ringkasan, empty state, skeleton tetap dipertahankan.

### Editor (builder) — informasi yang membantu, tetap gaya Google Form
- KPI bertambah jadi 5: Jumlah soal, Total poin, **Estimasi waktu** (PG 1,5 ·
  PG kompleks 2,5 · menjodohkan 2 · isian 1 · uraian 5 menit), Wacana,
  Siap publikasi.
- **Status simpan enterprise**: lencana kuning "Belum disimpan" muncul begitu
  isi berubah (signature kanonik = proyeksi payload server, jadi hasil
  muat-ulang dihitung sama), **Ctrl/Cmd+S** menyimpan cepat, setelah sukses
  tampil "Tersimpan HH:MM", dan `beforeunload` menjaga saat tab ditutup
  dengan perubahan belum tersimpan.
- **Daftar masalah bisa diklik**: setiap item ("#3 Kunci jawaban PG belum
  dipilih") menggulir + menyorot kartu soal terkait (ring biru `gf-flash`).
- **Wacana kini bisa ditempelkan per soal** lewat Pengaturan lanjutan
  (select "Wacana / stimulus"), tampil di kartu dengan label kecil "WACANA",
  dan tetap ada penjelasan kecil untuk guru.
- Kartu soal memakai `.gf-card` (aksen kiri biru ala Google Form) — sebelumnya
  masih memakai `.panel` tanpa aksen.

### Bug diperbaiki
- `addStimulus` menyimpan wacana dengan id `local-…` → soal yang menempel
  wacana BARU gagal divalidasi server (`stimulus_id` harus UUID). Kini id
  ASLI hasil `POST /stimuli` yang dipakai (verifikasi: tempel → simpan →
  reload → label WACANA + isi teks + select terisi UUID).
- `question.stimuli_id` vs `stimulus_id` tidak konsisten (wacana dari server
  tidak pernah tampil di kartu). Keduanya dinormalisasi saat muat.
- Signature kotor membandingkan mentahan objek → form tampak "belum
  disimpan" padahal tidak; kini membandingkan proyeksi kanonik + baseline
  di-reset saat data termuat.

### Verifikasi (Playwright)
- Bank soal: kartu termuat, chip meta 3/kartu, urut judul vs terbaru mengubah
  urutan, klik judul → editor, tanpa overflow 375 px.
- Editor: toast ramah "Soal 1: pilih kunci jawaban…" tanpa HTTP ≥400 (divalidasi
  klien); klik masalah → kartu disorot; pilih kunci → "Belum disimpan" muncul →
  Ctrl+S → hilang + "Tersimpan 21:52"; wacana ditempel → simpan → reload:
  label WACANA + teks stimulus + select terisi UUID.
- Alur 5 tipe (buat → isi → simpan → reload) tetap hijau; audit guru 1280/375
  0 error konsol, 0 HTTP ≥400; `tsc -b`, `npm run build` hijau.

### Berkas
- `frontend/src/guru/qsets.tsx` — grid kartu, sort, waktu relatif.
- `frontend/src/guru/qsets/editor.tsx` — KPI estimasi, status simpan (sigRef),
  Ctrl+S, beforeunload, lompat masalah, wacana per soal, gf-card.
- `frontend/src/styles.css` — `.qcard`, `.dirty-dot`, `.qsaved`, `.gf-flash`.

## Tambahan 2026-11-22 (putaran 15 — de-slop: hapus aksen "garis tebal", rapikan kelas desain)

### Masalah
Beberapa aksen bergaris tebal membuat tampilan terlihat "template AI":
strip biru 3px di puncak app bar, aksen kiri 4px pada kartu soal, bar kiri 3px
pada kartu pilihan (choice) aktif, dan strip atas panel `rule-accent`.

### Perubahan (semua di `frontend/src/styles.css`, tanpa logika)
- **App bar**: strip biru 3px di atas dihapus — tinggal ink slate + hairline
  (`.appbar::before` dihapus).
- **Kartu soal (`.gf-card`)**: aksen kiri 4px dihapus → hairline seragam
  1px, radius 10px, `--shadow-xs` sehari-hari, `--shadow-sm` saat hover/fokus
  (fokus diberi `--c-primary-line` supaya posisi kursor tetap jelas).
- **Kartu pilihan (`.choice` aktif)**: bar kiri `inset 3px` dihapus → border
  `--c-primary-line` + latar `--c-primary-soft`.
- **`.rule-accent`** (header halaman Selesai peserta): tanpa strip warna.
- Radius kartu/panel diseragamkan 8px → **10px** (`.card`, `.panel`).
- Tab underline (`border-b-2`) & garis atas nav mobile dipertahankan — itu
  pola standar tab bar, bukan aksen dekoratif.

### Verifikasi
- Screenshot sebelum/sesudah: dashboard (strip atas hilang), builder 7 kartu
  (semua kartu tepi rata tanpa bar kiri), billing/kartu aktif (tanpa bar kiri),
  wizard ujian, kartu ujian, pengaturan, portal peserta.
- Playwright audit guru 1280/375 → 0 error konsol, 0 HTTP ≥400, tanpa 404,
  tanpa overflow; alur builder 5 tipe tetap hijau (simpan + reload); pratinjau
  modal jalan; `tsc -b` + `npm run build` hijau.

## Remaining backlog (P1/P2, tidak memblokir MVP)

- E2E PWA offline di browser nyata (Playwright), uji beban k6.
- Integrasi Mayar/Midtrans produksi (butuh kredensial merchant).
- Email SMTP nyata (butuh kredensial SMTP; job queue & template sudah siap).
- Snapshot expiry cleanup worker — verifikasi berkala.
- OpenAPI spec export + dokumentasi deploy lanjutan.
