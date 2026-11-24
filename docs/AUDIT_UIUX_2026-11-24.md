# Audit UI/UX FlowCBT — 2026-11-24 (dari login sampai terdalam)

## Metode & cakupan
- Playwright (Chromium): **47 halaman** — 4 publik (login/register/forgot/reset) × (1440 & 375),
  20 halaman guru (dashboard s.d. editor paket soal, detail ujian, kartu, koreksi, live detail, billing, settings)
  di 1440, 11 halaman guru di 375, serta alur siswa penuh: `/s/login` (tab kartu, lookup otomatis) → `/s/exams`
  → `/s/exams/:id/start` → runner `/s/attempt/:id` (jawab soal, peta soal) → review, di 1440 & 375.
  Dark mode juga di-screenshot (login, dashboard, students, editor).
- Metrik otomatis per halaman: console/page error, HTTP≥400, overflow-x, target sentuh <24px,
  input tanpa label, img tanpa alt, emoji di teks UI, rasio kontras (WCAG), ada/tidaknya h1 & title.
- Bukti mentah: `/tmp/rt/audit2/result.json`, `/tmp/rt/audit2/deep-siswa.json`, screenshot `/tmp/rt/audit2/shots/*.png`.
- Data demo dikembalikan ke kondisi semula setelah audit (reset attempt + restore jendela DEMO01; counts 3 in_progress/2 submitted).

## Skor ringkas
| Aspek | Nilai | Bukti |
|---|---|---|
| Keandalan halaman | **Sangat baik** | 0 console error, 0 page error, 0 HTTP≥400 di 47 halaman |
| Responsif | **Baik** | 0 overflow horizontal di 1440 & 375 |
| Aksesibilitas dasar | **Baik, satu celah** | semua input berlabel, 0 img tanpa alt, semua halaman punya h1 (kecuali runner by design); **tapi 177 target <24px** |
| Kontras warna | **Lulus AA** | terendah: teks muted 5.11:1, tombol primary 5.17:1, panel dark siswa 7.58:1 |
| Konsistensi visual | **Baik, beberapa catatan** | 0 emoji di UI; masih ada simbol panah teks & radius 2xl di mock auth |
| Dark mode | **Sangat baik** | semua token terbaca, tidak ada bocor terang |

## Yang sudah kuat (jangan diubah)
- Login guru & portal siswa (split brand ala referensi, mock kartu/produk, statistik mini) — rapi di 1440 & 375, dark mode bagus.
- Dashboard, Laporan (hub + live + detail dengan histogram progres & status stack), Bank Soal (kartu ala Google Form/Drive),
  editor soal (KPI, status simpan, lompat masalah), detail ujian (KPI + aksi pengawas), kartu ujian, koreksi, billing, settings —
  konsisten: slate + precision blue, border-first, tanpa gradien/emoji, ikon SVG.
- Runner ujian siswa: split panel desktop, opsi 48px, peta soal, timer mono, hint keyboard — 0 target kecil, 0 error.
- Alur kartu: lookup otomatis terbukti ("Kartu valid — identitas otomatis").

## Temuan

### Mayor
1. **Target sentuh < 24px (177处, WCAG 2.5.8 min 24px)** — terutama:
   - `input[type=checkbox/radio]` native **18×18px** (`src/styles.css:440`) — 16+ di tabel siswa, checkbox kunci jawaban di editor, checkbox persetujuan (terbungkus label besar, ini yang aman).
   - Sort header tabel **16px** (`src/guru/ui.tsx:357`, indikator `↕`).
   - Link nama baris tabel **~20px**, link auth "Lupa password?" 18px / "Daftar sekolah" 17px / "Masuk" 17px.
   - Drag handle "Geser soal N" 19×19px dan link "Pengaturan" 18px di editor.
   - Terparah di mobile: `/students` 50 target kecil, editor 27.
2. **Format tanggal tidak konsisten**: input `datetime-local` tampil ala browser (en-US: `11/22/2026, 06:00 PM`) di detail ujian (`detail.tsx:351/361`) & wizard (`wizard.tsx:433/443`), sementara label lain menulis "22 Nov 2026, 18.00". Guru Indonesia akan bingung bulan/hari tertukar.
3. **Simbol panah dipakai sebagai "ikon"**: `↑ ↓ ↕` di sort header (`ui.tsx:357`), `↔` pada menjodohkan (`qsets/editor.tsx:1085`, `siswa/QuestionView.tsx:311,314`), `→` pada tombol "Laporan →" (`cheating.tsx:181`). Bertentangan dengan ikon SVG yang sudah rapi; render bisa beda antar perangkat/OS.

### Minor
4. **3 tombol teks per baris** pada tabel (Edit / Reset sandi / Hapus di siswa; ikon aksi di kartu) — clutter saat 30 baris; pertimbangkan menu overflow (ikon titik-tiga).
5. `rounded-2xl` masih ada pada mock chat/bubble auth shell (`auth/shell.tsx:65,74`, `AuthPortal.tsx:77`) — sengaja meniru referensi, tapi tidak konsisten dengan aturan radius ketat md/lg di halaman lain.
6. Warna hardcode kecil: `PAIR_COLORS` menjodohkan (`QuestionView.tsx:170`), `text-[#FCA5A5]` timer darurat (`Attempt.tsx:445`).
7. Runner tidak punya `h1` (pakai appbar) — konsisten secara internal, tapi tidak dengan pola halaman lain.
8. Tabel live detail: 2 baris per peserta (nama + link "Track record" kecil) → halaman sangat panjang saat 30+ peserta.

### Sistem (positif, terverifikasi)
- Error boundary + toast global aktif; pesan error form diterjemahkan ramah (mis. token kosong → tombol terkunci + hint).
- SSE real-time dengan fallback polling; indikator koneksi/sinkron ada.
- Tidak ada `console.log`, TODO, atau emoji tersisa di UI.

## Rekomendasi prioritas
1. Naikkan checkbox/radio ke ≥24px (atau 20px + padding area sentuh 44px via pseudo-element) — satu ubahan di `styles.css` memperbaiki banyak halaman.
2. Ganti `datetime-local` dengan dua field (tanggal + jam) yang diformat Indonesia, atau tampilkan preview "22 Nov 2026, 18.00" di samping input.
3. Ganti semua simbol panah dengan ikon SVG dari `icons.tsx` (tambah `IconSort`, `IconArrowRight`, `IconLeftRight` bila belum ada).
4. Perbesar link sekunder auth (Lupa password?/Daftar/Masuk) jadi ≥24px tinggi area sentuh.
5. Opsional: menu overflow untuk aksi baris tabel; kompasikan baris ganda di live detail.
