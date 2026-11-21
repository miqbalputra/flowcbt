# PRD — FlowCBT

**Computer Based Test (CBT) Ujian Online Multi-Sekolah, Berbayar (SaaS)**

| Item | Detail |
|---|---|
| Nama Produk | FlowCBT |
| Versi Dokumen | 1.2 (final untuk implementasi v1) |
| Tanggal | 15 November 2026 |
| Stack | Backend: Golang · Database: PostgreSQL · Frontend: React |
| Model Bisnis | SaaS multi-tenant, langganan per ujian atau per bulan |
| Platform | Web responsif (desktop & mobile), PWA (installable, offline-capable) |

---

## Daftar Isi

1. Ringkasan Produk
2. Persona, Peran & Matriks Hak Akses
3. Model Bisnis, Langganan & Retensi Data
4. Ruang Lingkup & Prioritas Fitur
5. Kebutuhan Fungsional (M1–M13)
6. Kebutuhan Non-Fungsional
7. Arsitektur Teknis & Infrastruktur (VPS + Coolify)
8. Model Data
9. Rancangan API
10. Alur Pengguna & Kriteria Penerimaan
11. Spesifikasi UI/UX & Peta Halaman
12. Keamanan & Integritas Ujian
13. Metrik Keberhasilan
14. Rencana Rilis & Strategi Pengujian
15. Risiko & Mitigasi
16. Asumsi & Ketergantungan
17. Keputusan Produk (Final v1)
18. Lampiran

---

## 1. Ringkasan Produk

FlowCBT adalah platform ujian berbasis komputer (CBT) yang dapat digunakan oleh sekolah/lembaga dari jenjang apa pun (PAUD sampai perguruan tinggi, bimbel, pesantren, PKBM, kursus). Guru/admin mendaftar sendiri, membuat soal dengan format AKM, menjadwalkan ujian, dan memantau pelaksanaan secara real-time. Siswa mengerjakan ujian lewat browser di HP atau komputer, **tetap bisa mengerjakan saat koneksi terputus** dan jawaban akan **tersinkronisasi otomatis** saat online kembali.

### 1.1 Masalah yang Diselesaikan
1. Ujian berbasis kertas mahal, lambat dikoreksi, dan rekap nilai manual.
2. Aplikasi CBT yang ada sering rumit, bergantung pada jaringan stabil, dan tidak ramah mobile.
3. Sekolah kecil tidak sanggup membeli/mengelola server CBT sendiri.
4. Riwayat nilai siswa tersebar dan sulit dilacak antar-ujian.

### 1.2 Tujuan (Goals)
- **G1** — Guru dapat membuat dan mempublikasikan ujian lengkap dalam < 10 menit.
- **G2** — Siswa dapat menyelesaikan ujian tanpa kehilangan jawaban meskipun koneksi putus (zero answer loss).
- **G3** — Pemantauan real-time dan rekap nilai otomatis, tanpa koreksi manual untuk soal objektif.
- **G4** — Model berlangganan yang mudah dibeli siapa saja (self-service) dengan isolasi data antar sekolah.
- **G5** — UI 100% nyaman di mobile dan desktop, mendukung dark/light mode.

### 1.3 Non-Goals (v1)
- Proctoring AI lanjutan (pengenalan identitas wajah, deteksi suara/objek). v1 hanya snapshot kamera + deteksi wajah dasar (lihat FR-5.8).
- White-label (logo/domain sendiri per sekolah) — **tidak dibutuhkan**.
- Bank soal bersama / marketplace antar guru — **tidak dibutuhkan**.
- Aplikasi native Android/iOS (cukup PWA).
- Video conference / kelas online.
- Koreksi uraian otomatis berbasis AI (roadmap; v1 koreksi manual oleh guru).

---

## 2. Persona, Peran & Matriks Hak Akses

| Peran | Deskripsi | Hak Akses Utama |
|---|---|---|
| **Super Admin (Platform)** | Tim FlowCBT | Kelola tenant, paket, harga, pembayaran, monitoring platform |
| **Admin Sekolah (Owner)** | Pendaftar pertama/penanggung jawab langganan | Semua fitur tenant, kelola guru, billing |
| **Guru** | Pembuat soal & pengawas | Kelola soal, ujian, siswa pada kelas yang ditugaskan, laporan |
| **Siswa** | Peserta ujian | Mengerjakan ujian yang ditugaskan, lihat riwayat & nilai (jika diizinkan) |

> **Catatan:** Guru yang mendaftar mandiri otomatis menjadi Admin Sekolah dari tenant barunya (tenant personal/lembaga).

### 2.1 Matriks Hak Akses

| Kemampuan | Super Admin | Admin Sekolah | Guru | Siswa |
|---|:-:|:-:|:-:|:-:|
| Kelola tenant, paket, harga | ✅ | — | — | — |
| Beli/kelola langganan & invoice | — | ✅ | — | — |
| Undang/kelola guru | — | ✅ | — | — |
| Kelola kelas & siswa (import/export) | — | ✅ | ✅ (kelas yang ditugaskan) | — |
| Buat/ubah soal & ujian | — | ✅ | ✅ (milik sendiri; bisa dibagikan ke guru lain di tenant) | — |
| Pantau ujian real-time & aksi pengawas | — | ✅ | ✅ | — |
| Nilai uraian & putuskan laporan curang | — | ✅ | ✅ | — |
| Lihat laporan & track record siswa | — | ✅ | ✅ (kelas yang ditugaskan) | Hanya miliknya (sesuai izin ujian) |
| Mengerjakan ujian | — | — | — | ✅ |
| Export semua data tenant | — | ✅ | — | — |

---

## 3. Model Bisnis, Langganan & Retensi Data

### 3.1 Paket & Harga

**Paket Gratis (sekaligus Trial)**

| Paket | Jumlah Siswa | Harga | Kuota Ujian | Masa Berlaku |
|---|---|---|---|---|
| Gratis / Trial | 1–10 | Rp0 | 1x ujian | 14 hari sejak daftar |

**Paket Per Ujian (bayar sekali, bundel kuota ujian)**

| Paket | Jumlah Siswa | Harga | Kuota Ujian |
|---|---|---|---|
| Per Ujian — Kecil | 11–40 | Rp10.000 | 3x ujian |
| Per Ujian — Menengah | 41–70 | Rp20.000 | 7x ujian |
| Per Ujian — Besar | 71–100 | Rp30.000 | 12x ujian |

**Paket Bulanan (ujian tanpa batas)**

| Paket | Jumlah Siswa | Harga |
|---|---|---|
| Bulanan — Menengah | 1–50 | Rp50.000 / bulan |
| Bulanan — Besar | 51–100 | Rp70.000 / bulan |

Semua harga dan kuota disimpan sebagai **konfigurasi** (tabel `plans`), bisa diubah Super Admin tanpa deploy ulang. Rentang jumlah siswa 1–100 tercakup penuh tanpa celah antar-tier.

**Ketentuan paket:**
- Batas jumlah siswa = jumlah siswa aktif terdaftar di tenant (termasuk peserta tamu yang sudah dibuat).
- "1x ujian" = 1 Ujian (exam session) yang dipublikasikan, berlaku untuk semua peserta dalam batas tier.
- Paket per ujian dibeli sesuai tier jumlah siswa saat pembelian.

### 3.2 Aturan Bisnis
- **Fitur lengkap di semua paket**, termasuk anti-cheat/proctoring. Pembeda hanya jumlah siswa dan kuota ujian.
- Ujian hanya bisa **dipublikasi** bila ada kuota aktif (kredit ujian tersisa, langganan bulanan aktif, atau trial). Kredit terpakai saat publish; membatalkan publish sebelum ada yang mengerjakan mengembalikan kredit.
- Ujian yang **sedang berlangsung tidak boleh terputus** akibat kuota/langganan habis (grace sampai ujian ditutup).
- **Retensi data 7 hari:** tenant masuk mode **baca-saja** selama **7 hari** ketika hak akses berakhir dan tidak diperpanjang. Hitungan 7 hari dimulai pada waktu yang **lebih akhir** antara (a) berakhirnya hak akses (trial habis, langganan bulanan berakhir, atau kredit ujian habis) dan (b) `close_at` ujian terakhir, sehingga hasil ujian selalu tersedia minimal 7 hari setelah ujian terakhir ditutup. Setelah itu data tenant (siswa, soal, hasil, snapshot kamera) **dihapus permanen**.
  - Pengingat email saat berakhir, H+3, dan H+6 beserta tombol **Export Semua Data** (siswa, nilai, soal) yang tersedia selama masa baca-saja.
  - Perpanjangan dalam 7 hari memulihkan akses penuh tanpa kehilangan data.
  - Sebelum dihapus, job penghapusan memverifikasi bahwa tidak ada transaksi/perpanjangan yang tertunda.
- Pembayaran lewat **Midtrans dan Mayar** (pelanggan memilih saat checkout). Invoice otomatis via email.
- **Tier mengikuti jumlah siswa.** Menambah siswa yang melewati batas tier ditolak dengan ajakan upgrade.
- **Upgrade** bulanan: bayar selisih harga dengan prorata sisa hari. **Downgrade** berlaku periode berikutnya dan hanya bila jumlah siswa ≤ batas tier tujuan. Kredit per ujian tier lebih rendah tidak bisa dipakai bila siswa melebihi tier tersebut; tenant membayar selisih harga paket.
- **Kredit per ujian tidak kedaluwarsa.** Bila langganan bulanan aktif dan kredit juga ada, sistem memakai langganan bulanan lebih dulu sehingga kredit tidak terpotong.
- **Di atas 100 siswa:** belum ada paket di v1; tampilkan "Hubungi kami"/daftar tunggu dan blokir penambahan siswa ke-101.
- **Paket gratis sekali per tenant.** Anti-penyalahgunaan: satu email terverifikasi, deteksi duplikasi nama lembaga/nomor HP.
- **Penyimpanan media** (gambar/audio soal) per tenant: default 1 GB (konfigurasi). Jumlah guru tidak dibatasi.

### 3.3 Kebijakan Retensi Data (Ringkasan)

| Data | Selama akses aktif | Setelah akses berakhir |
|---|---|---|
| Siswa, kelas, soal, ujian, hasil, track record | Disimpan | Baca-saja 7 hari → hapus permanen |
| Snapshot kamera | 30 hari setelah ujian selesai | Ikut retensi tenant bila lebih pendek |
| Event pelanggaran & log pengerjaan | Disimpan bersama hasil | Ikut hasil |
| Audit log | 12 bulan | Ikut retensi tenant |
| Invoice & transaksi pembayaran | Disimpan (kebutuhan akuntansi/pajak) | Disimpan, hanya data penagihan tanpa data siswa |
| Backup database | 14 hari bergulir | Data tenant yang dihapus ikut hilang dari backup setelah siklus bergulir selesai |

### 3.4 Catatan Unit Economics
- Biaya payment gateway untuk transaksi kecil (mis. Rp10.000) relatif besar terhadap nominalnya; tinjau margin per paket setelah beta dengan angka biaya aktual dari Midtrans dan Mayar.
- Paket bulanan baru lebih hemat daripada paket per ujian bagi sekolah yang rutin ujian banyak; pantau komposisi pembelian untuk menyesuaikan harga lewat konfigurasi.
- Biaya variabel utama: penyimpanan snapshot kamera/media, bandwidth, dan email; pantau per tenant.

---

## 4. Ruang Lingkup & Prioritas Fitur

### 4.1 Ringkasan Modul

| # | Modul | Pengguna |
|---|---|---|
| M1 | Autentikasi, Registrasi & Multi-Tenant | Semua |
| M2 | Dashboard Guru/Admin | Guru, Admin |
| M3 | Manajemen Siswa & Kelas | Guru, Admin |
| M4 | Bank Soal & Pembuat Soal (AKM) | Guru, Admin |
| M5 | Pengaturan & Penjadwalan Ujian | Guru, Admin |
| M6 | Antarmuka Ujian Siswa (CBT Client) | Siswa |
| M7 | Mode Offline & Sinkronisasi | Siswa |
| M8 | Penilaian | Sistem, Guru |
| M9 | Laporan Real-Time & Historis | Guru, Admin |
| M10 | Billing & Langganan | Admin, Super Admin |
| M11 | Tema (Dark/Light) & UX Responsif | Semua |
| M12 | Super Admin Console | Super Admin |
| M13 | Notifikasi & Email | Semua |

### 4.2 Prioritas Fitur

| Prioritas | Cakupan |
|---|---|
| **P0 — MVP (beta tertutup)** | Registrasi/login, multi-tenant; siswa & kelas + import/export; editor soal 5 tipe AKM + draft/publish + import/export template; pengaturan ujian & token; UI siswa (butir soal, daftar soal, selesai); mode offline + sinkronisasi; penilaian otomatis + koreksi uraian; laporan real-time & historis dasar + track record siswa; dark/light mode; deteksi keluar aplikasi dengan penalti; billing minimal (Midtrans; paket gratis, per ujian, bulanan) |
| **P1 — Rilis publik** | Login siswa tanpa akun + peserta tamu; proctoring kamera + laporan kecurangan; Mayar; analisis butir soal; export PDF; retensi 7 hari otomatis + Export Semua Data; notifikasi email lengkap; Super Admin console penuh |
| **P2 — Setelah rilis** | Auto-renew, kupon, paket tahunan; i18n Inggris/Arab (RTL); proctoring AI lanjutan; penilaian uraian berbantuan AI; paket di atas 100 siswa |

---

## 5. Kebutuhan Fungsional

### M1 — Autentikasi, Registrasi & Multi-Tenant

**FR-1.1 Registrasi Admin/Guru (Form).** Form: nama lengkap, email, nomor HP (opsional), password, nama sekolah/lembaga, jenjang (PAUD/TK, SD/MI, SMP/MTs, SMA/SMK/MA, Perguruan Tinggi, Kursus/Bimbel, Lainnya). Verifikasi email wajib sebelum akses penuh.

**FR-1.2 Login Admin/Guru.** Email + password; opsi *Login with Google*; lupa/reset password via email; rate limiting dan lockout sementara setelah percobaan gagal.

**FR-1.3 Login Siswa (mendukung dua metode sekaligus).** Guru memilih per ujian: *akun saja*, *tanpa akun saja*, atau *keduanya* (default).
1. **Dengan akun:** username/NIS + password (dibuat otomatis saat import, dapat direset guru).
2. **Tanpa akun:** siswa mengisi **data diri** (nama lengkap, jenis kelamin, kelas, NIS bila diwajibkan guru) + **kode ujian + token**.
   - Sistem mencocokkan ke data siswa terdaftar (NIS, atau nama + kelas ternormalisasi). Cocok → attempt tertaut ke siswa tersebut dan masuk track record-nya.
   - Tidak cocok → dibuat **peserta tamu** (`is_guest = true`) dengan ID unik. Guru dapat **menggabungkan (merge)** peserta tamu ke siswa terdaftar agar track record menyatu.
   - Satu identitas hanya boleh punya satu sesi aktif per ujian; sesi tamu diikat ke perangkat (cookie httpOnly) agar bisa dilanjutkan, termasuk setelah offline.
   - Rate limiting pada kode/token untuk mencegah tebak-tebakan.

**FR-1.4 Multi-Tenant.** Setiap sekolah = 1 tenant. Seluruh data (siswa, soal, ujian, hasil) terisolasi per `tenant_id` (enforced di query layer dan Postgres Row-Level Security).

**FR-1.5 Manajemen Guru.** Admin dapat mengundang guru via email, mengatur peran (Admin/Guru), dan membatasi akses guru pada kelas/mapel tertentu.

**FR-1.6 Sesi & Keamanan.** JWT access token (singkat) + refresh token (rotasi); satu siswa hanya boleh punya **satu sesi aktif** per ujian (login ganda ditolak/menggantikan sesi lama sesuai pengaturan).

---

### M2 — Dashboard Guru/Admin

**FR-2.1** Ringkasan: ujian berjalan saat ini, ujian terjadwal, jumlah siswa, rata-rata nilai ujian terakhir, status langganan & sisa kuota.
**FR-2.2** Pintasan cepat: Buat Soal, Buat Ujian, Import Siswa, Lihat Laporan.
**FR-2.3** Navigasi utama: *Siswa · Soal · Ujian · Laporan · Langganan · Pengaturan*.

---

### M3 — Manajemen Siswa & Kelas

**FR-3.1 CRUD Kelas.** Nama kelas (mis. "X IPA 1"), tahun ajaran, wali kelas (opsional). Kelas dapat diarsipkan.

**FR-3.2 CRUD Siswa.** Field wajib: **Nama, Jenis Kelamin (L/P), Kelas**. Field opsional: NIS/NISN, email, nomor HP wali, foto. Siswa memiliki **ID unik** (UUID internal + kode siswa) yang menjadi kunci track record sepanjang waktu.

**FR-3.3 Import Siswa.**
- Unduh template (.xlsx/.csv) dengan kolom: `Nama`, `Jenis Kelamin`, `Kelas` (+ opsional `NIS`).
- Upload → **preview & validasi** (baris error ditandai, mis. gender tidak valid, kelas kosong, duplikat) → konfirmasi.
- Kelas yang belum ada dapat dibuat otomatis (opsi).
- Pembuatan username/password awal otomatis; dapat diekspor untuk dibagikan (kartu login siswa PDF).

**FR-3.3b Batas Kuota Siswa.** Import/penambahan siswa dan pembuatan peserta tamu memeriksa batas tier tenant. Jika melewati batas, proses ditolak (import menampilkan sisa kuota) disertai tombol Upgrade.

**FR-3.4 Export Siswa.** Export daftar siswa ke .xlsx/.csv (filter kelas).

**FR-3.5 Pindah/Naik Kelas.** Aksi massal ubah kelas; **riwayat nilai tetap melekat pada siswa** meskipun kelas berubah (snapshot kelas disimpan pada tiap hasil ujian).

**FR-3.6 Rekapitulasi Nilai per Ujian.** Tabel nilai seluruh siswa untuk satu ujian (nama, kelas, nilai, status, durasi, waktu submit); filter kelas; export .xlsx/.csv/PDF.

**FR-3.7 Tracking Siswa Tertentu.** Halaman profil siswa berisi:
- Daftar seluruh ujian yang pernah diikuti: mata pelajaran, tanggal, percobaan ke-, nilai, durasi, status.
- Grafik tren nilai (per mapel / keseluruhan).
- Detail per percobaan: jawaban tiap soal, benar/salah, skor per soal, waktu pengerjaan, riwayat event (mulai, putus koneksi, sinkron, submit).
- Export profil/track record ke PDF/.xlsx.

---

### M4 — Bank Soal & Pembuat Soal (Format AKM)

**FR-4.1 Paket Soal (Question Set).**
- Field: **Nama mata pelajaran**, judul paket, deskripsi, jenjang/kelas (tag), **kode ujian** (unik per tenant, bisa digenerate otomatis), status (**Draft/Published**).
- Dapat diduplikasi, diarsipkan, dan dicari.

**FR-4.2 Target Peserta ("Untuk siapa").** Penugasan ujian dapat berupa:
1. **Satu kelas tertentu**
2. **Beberapa kelas sekaligus**
3. **Siswa tertentu** (pilih manual / multi-select / import daftar)
Kombinasi diperbolehkan (mis. kelas A + 3 siswa remedial).

**FR-4.3 Tipe Soal (AKM).**

| Tipe | Deskripsi | Penilaian Otomatis |
|---|---|---|
| **Pilihan Ganda** | Pilih satu jawaban benar | Ya (benar/salah) |
| **Pilihan Ganda Kompleks** | Pilih lebih dari satu jawaban benar | Ya (semua-atau-tidak, atau parsial — dipilih guru) |
| **Menjodohkan** | Pasangkan item kiri dengan item kanan (drag-drop/tarik garis di desktop; tap-pilih pasangan di mobile) | Ya (semua benar, atau parsial per pasangan) |
| **Isian Singkat** | Jawaban angka/kata/nama singkat | Ya (kunci jawaban multi-variasi, case-insensitive, normalisasi spasi/angka) |
| **Uraian** | Jawaban kalimat panjang | Manual oleh guru (rubrik skor) |

**FR-4.4 Editor Soal.**
- Rich text: bold, italic, daftar, tabel sederhana, **rumus matematika (LaTeX/KaTeX)**, gambar, dan audio (opsional, untuk listening).
- Teks stimulus/wacana yang dapat dipakai bersama beberapa soal (khas AKM literasi).
- Bobot/poin per soal; opsi **acak urutan soal** dan **acak urutan pilihan**.
- Pembahasan/penjelasan jawaban (opsional, ditampilkan ke siswa jika diizinkan).
- Pratinjau tampilan siswa (desktop & mobile) sebelum publish.
- Drag & drop untuk mengurutkan soal; duplikasi & hapus soal.
- **Autosave** draft setiap perubahan.

**FR-4.5 Import Template Soal.** Unduh template .xlsx per tipe soal → isi → upload → preview & validasi → simpan sebagai draft. Gambar via URL atau upload zip (opsional v1.1).

**FR-4.6 Export Template Soal yang Sudah Diisi.** Export paket soal ke .xlsx (format sama dengan template import) dan opsional ke PDF/Word (naskah soal + kunci jawaban).

**FR-4.7 Simpan Draft & Publish.**
- **Draft:** bisa diubah bebas, tidak terlihat siswa.
- **Publish:** validasi kelengkapan (setiap soal punya kunci jawaban, poin, dsb.), cek kuota langganan, lalu soal terkunci sebagian (perubahan setelah ada yang mengerjakan dibatasi/versioning, lihat FR-4.8).
- Unpublish diperbolehkan selama belum ada pengerjaan.

**FR-4.8 Versioning Soal.** Setiap publish membuat versi baru (`question_set_version`). Tiap percobaan siswa terikat ke versi tertentu agar riwayat nilai konsisten walau soal direvisi.

**FR-4.9 Token.** Token ujian (mis. 6 karakter alfanumerik) digenerate otomatis; dapat di-regenerate, diaktifkan/dinonaktifkan, dan opsional **token per sesi/ruang**. Siswa wajib memasukkan token untuk memulai.

---

### M5 — Pengaturan & Penjadwalan Ujian

Satu paket soal dapat dijadwalkan menjadi satu atau lebih **Ujian (Exam Session)**.

**FR-5.1 Jadwal Buka–Tutup.** `open_at` dan `close_at` (zona waktu tenant; default WIB, dapat diubah). Di luar rentang tersebut siswa tidak bisa memulai.

**FR-5.2 Durasi Pengerjaan.** Batas waktu (menit) sejak siswa menekan *Mulai* — tampil sebagai **timer hitung mundur** pada layar siswa. Waktu pengerjaan tidak boleh melewati `close_at` (opsi: *hard close* memotong waktu, atau *grace* sampai durasi habis).

**FR-5.3 Jumlah Percobaan.** Batas maksimal pengerjaan (1, 2, 3, … atau tak terbatas). Aturan nilai akhir bila lebih dari satu percobaan: **nilai tertinggi / terakhir / rata-rata**.

**FR-5.4 Tampilan Nilai.** Opsi: **nilai langsung muncul** setelah selesai, atau **disembunyikan** sampai guru merilis. Opsi tambahan: tampilkan/ sembunyikan pembahasan & kunci jawaban.

**FR-5.5 Pengaturan Tambahan.**
- Acak soal / acak opsi.
- Navigasi bebas atau satu arah (tidak bisa kembali).
- Wajib menjawab semua soal sebelum selesai (opsional).
- Anti-cheat & proctoring (deteksi keluar aplikasi, penalti nilai, kamera) — lihat **FR-5.8**.
- Tampilkan nilai KKM/ambang kelulusan.

**FR-5.6 Penugasan Peserta.** Sesuai FR-4.2; daftar peserta ujian dapat dilihat dan diubah selama ujian belum selesai.

**FR-5.7 Aksi Pengawas (Guru) saat Ujian.** Tambah waktu individu/semua, reset/izinkan ulang percobaan siswa tertentu, paksa selesai (force submit), keluarkan sesi aktif (reset login), jeda/tutup ujian darurat.

**FR-5.8 Proctoring & Anti-Cheat.** Dikonfigurasi per ujian oleh guru.

*A. Deteksi keluar/pindah aplikasi.*
- Dideteksi: tab/aplikasi berpindah (`visibilitychange`), jendela kehilangan fokus, keluar dari mode layar penuh, layar terkunci/aplikasi masuk background.
- Konfigurasi: aktif/nonaktif; **toleransi** (detik, default 3) agar gangguan singkat tidak langsung dihitung; **kebijakan** yang bisa digabung:
  1. **Peringatan** ke siswa ("Pelanggaran ke-n, sisa kesempatan m").
  2. **Pengurangan nilai** per pelanggaran (X poin atau X%, dengan batas penalti maksimum).
  3. **Dilaporkan curang** otomatis (`cheating_status = flagged`) setelah N pelanggaran.
  4. **Auto-submit** setelah N pelanggaran (opsional).
- Aturan ditampilkan di halaman tata tertib dan siswa wajib menyetujui sebelum mulai.
- Pelanggaran dicatat **meski offline** (event lokal → sinkron); penalti dihitung **di server** dari event yang tersinkron.
- Nilai ditampilkan transparan: *nilai asli, penalti, nilai akhir*. Guru dapat meninjau dan **membatalkan penalti/laporan** dengan alasan (masuk audit log).

*B. Proctoring kamera (opsional per ujian).*
- Layar persetujuan sebelum mulai (penggunaan kamera, tujuan, lama simpan). Untuk siswa di bawah umur, sekolah bertanggung jawab atas persetujuan wali.
- Mekanisme: **snapshot foto berkala acak** (default tiap 30–90 detik) dan snapshot saat terjadi pelanggaran, resolusi rendah (JPEG kecil). **Tidak ada rekaman video/audio.**
- Deteksi wajah ringan di sisi klien, hanya untuk **menandai** (tidak ada wajah, lebih dari satu wajah, kamera dimatikan). Tanda ini tidak mengurangi nilai otomatis kecuali guru mengaktifkannya; keputusan akhir ada di guru.
- Izin kamera ditolak → kebijakan guru: *tidak bisa mulai* atau *boleh mulai dan ditandai*.
- Snapshot disimpan terenkripsi di object storage, hanya bisa dilihat guru/admin tenant (akses tercatat di audit log), dihapus otomatis 30 hari setelah ujian selesai atau lebih cepat mengikuti retensi tenant (7 hari).
- Offline: snapshot diantrekan lokal dengan batas jumlah/ukuran, dikirim setelah jawaban tersinkron (jawaban selalu prioritas).
- Guru dapat menonaktifkan kamera untuk ujian di perangkat/jaringan terbatas.

*Nilai default (dapat diubah guru per ujian; disimpan sebagai konfigurasi):*

| Parameter | Default |
|---|---|
| Toleransi keluar aplikasi | 3 detik |
| Pengurangan nilai per pelanggaran | 5 poin (skala 100) |
| Batas maksimum total penalti | 30 poin |
| Ambang "Dilaporkan Curang" | 3 pelanggaran |
| Auto-submit | Nonaktif (opsional, mis. pada 5 pelanggaran) |
| Kamera | Nonaktif; bila diaktifkan guru, mode default **wajib** |
| Interval snapshot | Acak sekitar 60 detik (rentang 30–90 detik) |
| Penandaan wajah tidak terdeteksi/lebih dari satu | Hanya penanda, tanpa penalti otomatis |

*C. Laporan Kecurangan.* Halaman per ujian: siswa yang ditandai, jumlah dan linimasa pelanggaran, galeri snapshot, dan keputusan guru (**Valid / Batalkan penalti / Diskualifikasi** — nilai 0 atau attempt dibatalkan). Dapat diexport.

> **Catatan:** semua deteksi berbasis browser bersifat *deterrent*, bukan jaminan mutlak (mis. layar terbagi atau perangkat kedua tidak selalu terdeteksi).

---

### M6 — Antarmuka Ujian Siswa (CBT Client)

**FR-6.1 Dashboard Siswa.** Daftar ujian: *Sedang Dibuka*, *Akan Datang*, *Selesai* (dengan nilai bila diizinkan). Info per ujian: mapel, jadwal, durasi, sisa percobaan. Tombol **Mulai/Lanjutkan**.

**FR-6.2 Alur Mulai Ujian.** Pilih ujian → masukkan **token** → halaman petunjuk/tata tertib → konfirmasi *Mulai*. Server mencatat `started_at` dan menetapkan `deadline` (otoritas waktu ada di server).

**FR-6.3 Butir Soal (Halaman Soal).**
- Menampilkan satu soal per layar (opsi: scroll semua) dengan stimulus, gambar, dan rumus.
- Header: nama ujian, **timer**, indikator status koneksi (Online / Offline / Menyinkronkan), tombol tema.
- Tombol **Sebelumnya / Berikutnya**, **Ragu-ragu** (tandai), dan **Daftar Soal**.
- Input jawaban sesuai tipe soal (lihat FR-4.3), dengan target sentuh besar di mobile.
- Jawaban tersimpan otomatis setiap perubahan (lokal dulu, lalu sinkron).

**FR-6.4 Daftar Soal (Navigasi).**
- Grid nomor soal dengan status warna + ikon (tidak hanya warna, demi aksesibilitas): **belum dijawab, sudah dijawab, ragu-ragu, sedang dibuka**.
- Desktop: panel samping; mobile: bottom sheet/drawer.
- Klik nomor untuk lompat ke soal.

**FR-6.5 Selesai Mengerjakan.**
- Tombol **Selesai** → halaman **konfirmasi/review**: ringkasan jumlah terjawab, belum dijawab, dan ragu-ragu; peringatan jika masih ada yang kosong.
- Konfirmasi final → submit. Jika offline, status *"Menunggu sinkronisasi"* dan submit akan dikirim otomatis saat online.
- Setelah submit: layar selesai; tampilkan nilai langsung atau pesan "Nilai akan diumumkan guru" sesuai pengaturan.
- **Auto-submit** saat waktu habis.

**FR-6.6 Riwayat Siswa.** Siswa dapat melihat riwayat ujian dan nilai miliknya (sesuai izin pengaturan ujian).

---

### M7 — Mode Offline & Sinkronisasi

Persyaratan inti: **koneksi terputus → tetap bisa mengerjakan → otomatis sinkron saat online**.

**FR-7.1 PWA.** Aplikasi siswa berupa PWA (Service Worker + manifest), dapat di-install ke home screen, dan aset statis ter-cache sehingga halaman ujian tetap terbuka saat offline.

**FR-7.2 Pra-muat Soal.** Saat siswa menekan *Mulai* (dalam kondisi online), seluruh soal + media (gambar/audio) untuk percobaan itu diunduh dan disimpan di **IndexedDB**. Progress unduhan ditampilkan; ujian baru dimulai setelah paket soal lengkap tersimpan. Soal dikirim **tanpa kunci jawaban** (penilaian dilakukan di server).

**FR-7.3 Penyimpanan Jawaban Lokal.** Setiap perubahan jawaban ditulis ke IndexedDB sebagai **event/antrean** dengan: `client_event_id` (UUID), `attempt_id`, `question_id`, `answer_payload`, `client_timestamp`, `sequence_number`.

**FR-7.4 Sinkronisasi Otomatis.**
- Saat online, antrean dikirim **batch** ke server (`POST /attempts/{id}/answers:sync`) secara periodik (mis. tiap 5–10 dtk) dan segera saat koneksi pulih (event `online`, Background Sync bila didukung).
- Server **idempoten** berdasarkan `client_event_id` (kirim ulang aman, tanpa duplikasi).
- Resolusi konflik per soal: *last-write-wins* berdasarkan `sequence_number` (monoton per attempt), bukan jam perangkat.
- Retry dengan exponential backoff; antrean tidak dihapus sampai server mengkonfirmasi (ACK).

**FR-7.5 Timer saat Offline.** Timer berjalan di klien memakai jam monotonic (`performance.now`) yang dikalibrasi terhadap waktu server saat terakhir online. `deadline` ditetapkan server saat mulai. Saat kembali online, server memvalidasi: jawaban yang dibuat **sebelum deadline** (berdasar elapsed time klien yang dilaporkan + toleransi) diterima; di luar itu ditolak/ditandai.

**FR-7.6 Submit saat Offline.** Tombol *Selesai* menandai attempt "selesai lokal" dan mengunci input. Status: *"Jawaban tersimpan di perangkat — menunggu internet"*. Setelah sinkron sukses, status berubah menjadi *"Terkirim"*. Siswa **dilarang menutup/menghapus data browser** selama menunggu (peringatan jelas); jika tab ditutup, data tetap ada di IndexedDB dan dilanjutkan saat dibuka kembali.

**FR-7.7 Indikator Status.** Banner/ikon persisten: 🟢 Online & tersinkron, 🟡 Menyinkronkan (n jawaban menunggu), 🔴 Offline (jawaban tersimpan lokal). Pesan non-teknis, mudah dipahami siswa.

**FR-7.8 Pemulihan.** Bila perangkat mati/browser crash, siswa dapat login kembali dan **melanjutkan** attempt dari data lokal + data server (gabungan, server sebagai sumber akhir untuk yang sudah ter-ACK).

**FR-7.9 Keamanan Data Offline.** Paket soal di IndexedDB tidak berisi kunci jawaban; dibersihkan setelah attempt tersinkron penuh. Opsi enkripsi ringan (Web Crypto) untuk payload soal.

> **Batasan:** Login pertama, pengambilan paket soal, dan token wajib online. Setelah soal ter-cache, sisa pengerjaan dapat sepenuhnya offline.

---

### M8 — Penilaian

**FR-8.1 Penilaian Otomatis (di server).**
- PG: benar = poin penuh.
- PG Kompleks: mode *all-or-nothing* atau *parsial* (poin proporsional, dengan penalti jawaban salah opsional) — dipilih guru per soal.
- Menjodohkan: *all-or-nothing* atau parsial per pasangan.
- Isian Singkat: cocok dengan salah satu kunci (normalisasi: trim, lowercase, hapus spasi ganda; angka dengan toleransi format desimal `,`/`.`).
- Uraian: status *Menunggu penilaian*; guru memberi skor 0–maks poin + komentar.

**FR-8.1b Rumus Penilaian Parsial.**
- *PG Kompleks (parsial):* skor = poin × max(0, (jumlah benar dipilih − jumlah salah dipilih) ÷ jumlah kunci benar).
- *Menjodohkan (parsial):* skor = poin × (pasangan benar ÷ total pasangan).
- *PG, Isian Singkat, dan mode all-or-nothing:* poin penuh jika benar, 0 jika salah.
- Skor soal dibulatkan 2 desimal; nilai akhir dibulatkan sesuai pengaturan tenant (default 2 desimal).

**FR-8.2 Skor Akhir.** `nilai = (total poin diperoleh / total poin maksimum) × 100` (skala dapat dikonfigurasi). Untuk uraian yang belum dinilai, nilai berstatus **Sementara** sampai dinilai. Penalti pelanggaran (FR-5.8) diterapkan setelah skor dihitung.

**FR-8.3 Koreksi Manual.** Antarmuka guru untuk menilai uraian (per soal atau per siswa) dengan rubrik; guru juga dapat **override** skor soal otomatis (mis. isian singkat yang benar tapi beda penulisan) disertai alasan (audit log).

**FR-8.4 Re-grade.** Bila kunci jawaban dikoreksi, guru dapat menjalankan penilaian ulang untuk seluruh attempt pada versi soal tersebut.

---

### M9 — Laporan Ujian

#### 9A. Laporan Real-Time
**FR-9.1** Daftar **ujian yang sedang berjalan** (mapel, kelas, sisa waktu penutupan).
**FR-9.2** Untuk tiap ujian berjalan, tampilkan:
- Jumlah dan persentase: **Sedang mengerjakan · Belum mengerjakan · Sudah selesai** (dengan **grafik** donut/bar).
- Tabel/daftar siswa per status dengan **nama dan kelas**, progres soal terjawab (mis. 18/40), status koneksi (online/offline), dan waktu aktivitas terakhir.
- Filter per kelas dan pencarian nama.
**FR-9.3** Pembaruan real-time via **WebSocket/SSE** (fallback polling 10 dtk).
**FR-9.4** Aksi pengawas dari halaman ini (lihat FR-5.7).
**FR-9.5** Peringatan dan indikator pada daftar siswa: offline > N menit, jumlah pelanggaran keluar aplikasi, status *Dilaporkan Curang*, tanda kamera (tautan ke FR-5.8C).

#### 9B. Laporan Ujian Terdahulu
**FR-9.6** Daftar seluruh ujian yang telah selesai dengan **pilihan paket soal**.
**FR-9.7** **Pencarian & filter**: nama mata pelajaran, judul, kode ujian, kelas, rentang tanggal, status, guru pembuat; pencarian teks bebas.
**FR-9.8** Detail laporan per ujian: rata-rata, nilai tertinggi/terendah, median, tingkat kelulusan (vs KKM), distribusi nilai (histogram), durasi rata-rata.
**FR-9.9** **Analisis butir soal**: persentase benar per soal, tingkat kesukaran, daya pembeda (opsional), distraktor yang paling banyak dipilih.
**FR-9.10** **Track record per siswa** (terhubung FR-3.7): setiap siswa memiliki rekam jejak seluruh ujian sejak awal dengan **identitas unik per siswa**; dapat dibuka dari laporan mana pun.
**FR-9.11** Export laporan: .xlsx, .csv, PDF.

---

### M10 — Billing & Langganan

**FR-10.1** Halaman paket & harga; pembelian self-service (checkout via payment gateway).
**FR-10.2** Kredit ujian (paket per ujian) dan langganan bulanan; tampilkan status, sisa kuota, tanggal berakhir.
**FR-10.3** Riwayat transaksi, invoice PDF, email pengingat sebelum berakhir (H-7, H-3, H-1).
**FR-10.4** Integrasi **Midtrans dan Mayar** lewat antarmuka `PaymentProvider` (create checkout, handle webhook, cek status). Webhook per provider memverifikasi signature, idempoten, dan mengaktifkan paket otomatis. Ada rekonsiliasi harian terhadap status di provider.
**FR-10.5** Perpanjangan manual / auto-renew (opsional v1.1), upgrade/downgrade paket.
**FR-10.6** Kupon/diskon (Super Admin) — opsional v1.1.

---

### M11 — Tema & UX Responsif

**FR-11.1 Dark/Light Mode.** Toggle tersedia di semua halaman (guru & siswa); default mengikuti `prefers-color-scheme`; pilihan tersimpan (localStorage + profil). Seluruh komponen memenuhi kontras WCAG AA di kedua tema.
**FR-11.2 Responsif.** Pendekatan mobile-first dengan breakpoint (≤640, 641–1024, ≥1025 px). Tabel pada mobile berubah menjadi kartu/daftar; modal menjadi bottom sheet; target sentuh ≥ 44×44 px.
**FR-11.3 Aksesibilitas.** Navigasi keyboard, label ARIA, fokus terlihat, ukuran font dapat diperbesar, status tidak hanya bergantung warna.
**FR-11.4 Bahasa.** Bahasa Indonesia (default), arsitektur i18n siap untuk Inggris & Arab (RTL — roadmap).
**FR-11.5 Performa.** Bundle awal siswa ringan (code-splitting), berjalan baik di HP spesifikasi rendah dan jaringan 3G.

---

### M12 — Super Admin Console
**FR-12.1** Daftar tenant, status langganan, penggunaan kuota; aktif/nonaktifkan tenant.
**FR-12.2** Konfigurasi paket, harga, batas kuota, kupon.
**FR-12.3** Monitoring transaksi dan metrik platform (ujian aktif, peserta konkuren, error rate).
**FR-12.4** Impersonasi terbatas untuk dukungan (dengan audit log & persetujuan).

---

### M13 — Notifikasi & Email

**FR-13.1** Email transaksional: verifikasi email, reset password, undangan guru, invoice/bukti bayar, pengingat langganan (H-7, H-3, H-1), pemberitahuan akses berakhir dan penghapusan data (saat berakhir, H+3, H+6).
**FR-13.2** Notifikasi dalam aplikasi (guru): ujian akan dibuka/ditutup, uraian menunggu penilaian, siswa dilaporkan curang, kuota hampir habis (siswa/ujian).
**FR-13.3** Notifikasi siswa: pengingat ujian akan dibuka (opsional), nilai dirilis.
**FR-13.4** Email dikirim lewat job queue dengan retry; template Bahasa Indonesia; tautan berumur terbatas.

---

## 6. Kebutuhan Non-Fungsional

| Kategori | Persyaratan |
|---|---|
| **Performa** | Respons API p95 < 300 ms (non-upload). Halaman soal siswa muncul < 2 dtk (jaringan 4G). |
| **Skalabilitas** | Target awal pada 1 VPS: ±1.000 siswa konkuren (validasi dengan uji beban; tenant maks. 100 siswa). API stateless sehingga bisa dipindah ke VPS lebih besar/ditambah instance. Lonjakan serentak saat *Mulai* dan *Submit* diatasi dengan rate limit, antrean, dan cache paket soal. |
| **Ketersediaan** | Uptime ≥ 99,5% (single VPS). Backup Postgres harian + WAL ke object storage di luar VPS; restore diuji berkala. Risiko single point of failure diterima di fase awal. |
| **Keandalan Data** | Tidak ada kehilangan jawaban yang telah ter-ACK; jawaban lokal bertahan sampai sinkron. RPO ≤ 5 menit, RTO ≤ 1 jam. |
| **Keamanan** | HTTPS/TLS wajib; hash password (argon2id/bcrypt); JWT rotasi; RBAC; RLS multi-tenant; rate limiting; proteksi CSRF/XSS/SQLi; validasi & sanitasi rich text; audit log aksi sensitif. |
| **Privasi** | Patuh UU PDP Indonesia; data siswa (termasuk anak) minimal & terenkripsi saat transit/diam; kebijakan retensi & hapus data atas permintaan tenant. |
| **Kompatibilitas** | Chrome, Edge, Firefox, Safari (iOS 15+), Android Chrome 90+, WebView. |
| **Observability** | Logging terstruktur, metrics (Prometheus), tracing, alert (error rate, antrean sync, latensi). |
| **Maintainability** | Test coverage inti ≥ 70%; CI/CD; migrasi database versioned. |

---

## 7. Arsitektur Teknis & Infrastruktur (VPS + Coolify)

### 7.1 Gambaran Umum

```
┌───────────────────────────┐        ┌──────────────────────────┐
│  React PWA (Siswa)        │        │  React SPA (Guru/Admin)  │
│  Service Worker+IndexedDB │        │                          │
└────────────┬──────────────┘        └────────────┬─────────────┘
             │ HTTPS (REST/JSON) + WebSocket/SSE  │
             ▼                                    ▼
        ┌──────────────────────────────────────────────┐
        │  Reverse Proxy / CDN (TLS, cache aset)       │
        └────────────────────┬─────────────────────────┘
                             ▼
        ┌──────────────────────────────────────────────┐
        │  Golang API (stateless, N instance)          │
        │  auth · tenant · exam · attempt · grading    │
        │  report · billing · import/export · realtime │
        └──────┬────────────┬────────────┬─────────────┘
               ▼            ▼            ▼
        ┌──────────┐  ┌───────────┐  ┌───────────────┐
        │PostgreSQL│  │Redis      │  │Object Storage │
        │(primary +│  │cache,     │  │(S3/MinIO):    │
        │ replica) │  │pub/sub,   │  │gambar, audio, │
        │          │  │rate limit │  │file import/   │
        │          │  │           │  │export         │
        └──────────┘  └───────────┘  └───────────────┘
               ▲
        ┌──────┴────────┐
        │ Worker (Go)   │  import/export besar, re-grade, email,
        │ job queue     │  rekap laporan, webhook billing
        └───────────────┘
```

### 7.2 Stack & Pustaka (Rekomendasi)

| Lapisan | Pilihan |
|---|---|
| Backend | Go 1.22+, router `chi`/`gin`, `sqlc` atau `pgx`, `golang-migrate`, `go-playground/validator` |
| Database | PostgreSQL 16 (RLS, JSONB, partisi tabel jawaban/event) |
| Cache/Realtime | Redis (cache paket soal, pub/sub realtime, rate limit) |
| Job Queue | `asynq` (Redis) atau `river` (Postgres) |
| Frontend | React 18 + TypeScript, Vite, React Router, TanStack Query, Zustand, Tailwind CSS + shadcn/ui, `react-hook-form` + `zod` |
| Offline | Workbox (service worker), `idb`/Dexie (IndexedDB) |
| Editor Soal | TipTap (rich text) + KaTeX |
| Import/Export | `excelize` (Go) untuk .xlsx; PDF via `chromedp`/`gofpdf` |
| Pembayaran | Midtrans dan Mayar (abstraksi `PaymentProvider`) |
| Email | SMTP/SES/Resend |
| Deploy | **VPS Ubuntu + Coolify** (Docker; layanan API, worker, frontend, PostgreSQL, Redis, MinIO/S3 dikelola di Coolify); deploy otomatis dari Git (webhook), SSL otomatis via Coolify/Traefik; CI GitHub Actions untuk test |

### 7.3 Desain Kunci

1. **Otoritas waktu di server.** Server menetapkan `started_at` dan `deadline`; klien hanya menampilkan.
2. **Soal tanpa kunci ke klien.** Penilaian selalu di server.
3. **Event-sourced answers.** Jawaban disimpan sebagai event append-only + proyeksi jawaban terakhir per soal → audit & rekonstruksi mudah.
4. **Idempotensi.** Semua endpoint sinkron menerima `client_event_id`.
5. **Caching paket soal.** Paket soal versi terbit di-cache (Redis/CDN privat) agar lonjakan *Mulai* serentak tidak membebani DB.
6. **Isolasi tenant.** `tenant_id` pada semua tabel + RLS + indeks komposit.

### 7.4 Infrastruktur & Deployment (VPS Ubuntu + Coolify)

**Topologi awal (satu VPS, dikelola Coolify):**

| Layanan | Keterangan |
|---|---|
| `flowcbt-api` | Go API (stateless), health check `/healthz` |
| `flowcbt-worker` | Go worker (import/export, email, re-grade, retensi, rekonsiliasi pembayaran) |
| `flowcbt-web` | React (build statis, disajikan Nginx/Caddy), mencakup PWA siswa dan SPA guru |
| `postgres` | PostgreSQL 16 dengan volume persisten |
| `redis` | Cache, pub/sub realtime, antrean job, rate limit |
| `minio` atau S3-compatible eksternal | Media soal, snapshot kamera, file import/export |

**Praktik deployment:**
- Dua lingkungan: **staging** dan **production** (resource berbeda; staging boleh di VPS terpisah/kecil).
- Deploy otomatis dari Git (branch `main` → staging, tag rilis → production) lewat Coolify; migrasi database dijalankan sebagai langkah terpisah dan harus *backward-compatible*.
- **Deploy freeze** saat ada ujian berjalan (cek endpoint internal jumlah ujian aktif sebelum rilis produksi).
- Domain & SSL otomatis lewat proxy Coolify; subdomain terpisah untuk `app` (guru), `ujian` (siswa), dan `api`.
- Semua rahasia (JWT, kunci Midtrans/Mayar, SMTP, S3) sebagai environment variable terenkripsi di Coolify; tidak ada di repo.

**Keandalan & keamanan server:**
- Backup Postgres terjadwal (harian + arsip WAL bila diperlukan) ke **object storage di luar VPS**; restore diuji tiap bulan.
- Backup volume media bila memakai MinIO lokal.
- Firewall hanya membuka 80/443 (dan SSH dengan key saja), fail2ban, pembaruan keamanan otomatis, akun non-root.
- Pooling koneksi Postgres (pgxpool, atau PgBouncer bila perlu); batas koneksi disesuaikan.
- Monitoring: uptime check eksternal, metrics (CPU/RAM/disk, latensi API, antrean sync, jumlah siswa konkuren), log terstruktur terpusat, alert ke WhatsApp/Telegram/email.
- Estimasi awal spesifikasi VPS: 4 vCPU, 8 GB RAM, SSD NVMe; **validasi dengan uji beban** sebelum rilis dan tingkatkan sesuai hasil.

**Jalur skala berikutnya:** pindah Postgres ke VPS/managed terpisah → tambah instance API di server kedua → read replica untuk laporan.

---

## 8. Model Data (Skema Tingkat Tinggi)

```
tenants(id, name, level, timezone, status, created_at)
users(id, tenant_id, name, email, password_hash, role[owner|teacher], status, ...)
subscriptions(id, tenant_id, plan_id, type[monthly|per_exam], starts_at, ends_at, status)
plans(id, name, type, price, participant_quota, limits_json)
exam_credits(id, tenant_id, exam_id?, quantity, used, expires_at)
payments(id, tenant_id, provider, provider_ref, amount, status, paid_at, invoice_url)

classes(id, tenant_id, name, academic_year, homeroom_teacher_id?, archived)
students(id, tenant_id, student_code[unik], nis?, name, gender[L|P], class_id,
         username, password_hash, status, created_at)
student_class_history(id, student_id, class_id, from_date, to_date)

question_sets(id, tenant_id, subject_name, title, description, exam_code, level_tag,
              status[draft|published|archived], current_version, created_by)
question_set_versions(id, question_set_id, version, published_at, snapshot_json?)
questions(id, set_version_id, order_no, type[mcq|mcq_complex|matching|short_answer|essay],
          stimulus_id?, body, options_json, answer_key_json, points, scoring_mode,
          explanation, shuffle_options)
stimuli(id, tenant_id, content, media)

exams(id, tenant_id, question_set_version_id, name, token, token_active,
      open_at, close_at, duration_minutes, max_attempts, score_policy[highest|last|avg],
      show_score_immediately, show_review, shuffle_questions, shuffle_options,
      free_navigation, require_all_answered, tab_switch_policy, passing_score, status)
exam_assignments(id, exam_id, target_type[class|student], class_id?, student_id?)
exam_participants(exam_id, student_id, extra_time_seconds, attempts_override)

attempts(id, exam_id, student_id, attempt_no, class_snapshot, penalty_points, cheating_status[none|warned|flagged|disqualified],
         status[in_progress|submitted|graded|expired],
         started_at, deadline_at, submitted_at, score, max_score, final_score_pending, device_info)
attempt_answers(id, attempt_id, question_id, answer_json, flagged, is_correct?, score,
                graded_by[auto|manual], seq, updated_at)
attempt_events(id, attempt_id, client_event_id[unik], type[answer|flag|nav|submit|focus_lost|online|offline|sync],
               payload_json, client_ts, server_ts, seq)   -- partisi per bulan

attempt_violations(id, attempt_id, type[tab_hidden|blur|fullscreen_exit|camera_off|no_face|multi_face],
                   started_at, duration_ms, penalty_applied, client_event_id)
proctor_snapshots(id, attempt_id, object_key, taken_at, flags_json, expires_at)
students.is_guest, students.merged_into_id   -- peserta tamu & penggabungan
audit_logs(id, tenant_id, actor_id, action, entity, entity_id, meta_json, created_at)
```

**Indeks penting:** `(tenant_id, …)` pada semua tabel; `attempts(exam_id, status)`; `attempts(student_id, started_at)`; `attempt_events(attempt_id, seq)`; unik `attempt_events(client_event_id)`; unik `students(tenant_id, student_code)`; unik `question_sets(tenant_id, exam_code)`.

---

## 9. Rancangan API (Ringkas)

**Konvensi:**
- Base `/api/v1`, format JSON, auth `Bearer <JWT>`; dokumentasi OpenAPI dihasilkan dari kode/spec dan menjadi kontrak frontend.
- Error standar `{code, message, details}` dengan kode stabil (mis. `QUOTA_EXCEEDED`, `ATTEMPT_EXPIRED`, `TOKEN_INVALID`); HTTP status sesuai semantik.
- Pagination berbasis cursor/limit untuk daftar besar; filter dan sort lewat query string.
- Header `Idempotency-Key` pada operasi pembayaran dan pembuatan resource; endpoint sinkron jawaban idempoten via `client_event_id`.
- Rate limit per IP dan per akun (lebih ketat pada login, token, dan guest login); respons `429` dengan `Retry-After`.
- Semua query ter-scope `tenant_id` dari token, bukan dari input klien.


**Auth & Tenant**
- `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout`
- `POST /auth/verify-email` · `POST /auth/forgot-password` · `POST /auth/reset-password`
- `POST /student/auth/login` · `POST /student/auth/guest` (data diri + kode ujian + token)

**Siswa & Kelas**
- `GET/POST /classes` · `PUT/DELETE /classes/{id}`
- `GET/POST /students` · `GET/PUT/DELETE /students/{id}`
- `GET /students/import/template` · `POST /students/import/preview` · `POST /students/import/commit`
- `GET /students/export`
- `GET /students/{id}/track-record`

**Soal**
- `GET/POST /question-sets` · `GET/PUT/DELETE /question-sets/{id}`
- `POST /question-sets/{id}/questions` · `PUT/DELETE /questions/{id}` · `POST /questions/reorder`
- `POST /question-sets/{id}/publish` · `POST /question-sets/{id}/unpublish`
- `GET /question-sets/import/template` · `POST /question-sets/import` · `GET /question-sets/{id}/export`
- `POST /media/upload`

**Ujian**
- `GET/POST /exams` · `GET/PUT/DELETE /exams/{id}`
- `POST /exams/{id}/token/regenerate`
- `PUT /exams/{id}/assignments`
- `POST /exams/{id}/participants/{studentId}/extend-time` · `.../reset-attempt` · `.../force-submit`

**Pengerjaan (Siswa)**
- `GET /me/exams`
- `POST /exams/{id}/start` (body: token) → `attempt_id`, `deadline_at`, paket soal
- `GET /attempts/{id}` (pemulihan)
- `POST /attempts/{id}/answers:sync` (batch event, idempoten)
- `POST /attempts/{id}/submit`
- `POST /attempts/{id}/violations` · `POST /attempts/{id}/snapshots`
- `GET /exams/{id}/cheating-report` · `PUT /attempts/{id}/cheating-decision`
- `GET /attempts/{id}/result`

**Penilaian & Laporan**
- `GET /exams/{id}/attempts` · `GET /attempts/{id}/grading` · `PUT /attempts/{id}/answers/{qid}/score`
- `POST /exams/{id}/regrade`
- `GET /reports/live` · `GET /reports/live/{examId}` · `WS /reports/live/stream`
- `GET /reports/history?q=&subject=&class=&from=&to=` · `GET /reports/exams/{id}` · `GET /reports/exams/{id}/item-analysis`
- `GET /reports/exams/{id}/export?format=xlsx|csv|pdf`

**Billing**
- `GET /plans` · `POST /billing/checkout` · `GET /billing/subscription` · `GET /billing/invoices`
- `POST /webhooks/payment/midtrans` · `POST /webhooks/payment/mayar` (publik, verifikasi signature)
- `GET /billing/export-all` (export semua data tenant)

---

## 10. Alur Pengguna & Kriteria Penerimaan

### 10.1 Guru: Dari Daftar Sampai Ujian Berjalan
1. Daftar via form → verifikasi email → login.
2. (Opsional) Import siswa lewat template (Nama, Jenis Kelamin, Kelas) → preview → konfirmasi.
3. Buat paket soal: isi nama mapel → pilih target (kelas/siswa) → tambah soal AKM → simpan draft.
4. Beli paket (per ujian / bulanan) bila belum aktif.
5. Publish → atur jadwal buka–tutup, durasi, jumlah percobaan, tampilan nilai → token & kode ujian dihasilkan.
6. Bagikan kode + token ke siswa.
7. Pantau **Laporan Real-Time** saat ujian berlangsung.
8. Nilai uraian (jika ada) → rilis nilai → lihat **Laporan Terdahulu** dan export.

### 10.2 Siswa: Mengerjakan Ujian
1. Login → dashboard ujian → pilih ujian.
2. Masukkan token → baca tata tertib → *Mulai* (soal diunduh).
3. Mengerjakan: jawab, tandai ragu-ragu, buka **Daftar Soal**; jika internet putus, tetap lanjut (indikator 🔴), jawaban tersimpan lokal.
4. Internet pulih → sinkron otomatis (indikator 🟢).
5. Klik **Selesai** → review ringkasan → konfirmasi → terkirim.
6. Lihat nilai (jika diizinkan) / riwayat ujian.

### 10.3 Skenario Offline (Edge Case)
| Skenario | Perilaku |
|---|---|
| Putus saat menjawab | Lanjut mengerjakan; antrean lokal; banner merah |
| Putus lalu waktu habis | Auto-submit lokal; sinkron saat online; server validasi terhadap deadline + toleransi |
| Tab ditutup saat offline | Data tetap di IndexedDB; lanjut saat dibuka |
| Ganti perangkat saat offline | Tidak didukung; jawaban belum tersinkron tidak ikut. Siswa diberi peringatan |
| Sinkron ganda / retry | Idempoten via `client_event_id` |
| Jam perangkat dimanipulasi | Dihitung dari elapsed monotonic + validasi server |
| Browser dibersihkan sebelum sinkron | Jawaban lokal hilang; guru bisa reset attempt (peringatan jelas sebelum ujian) |

### 10.4 Kriteria Penerimaan Fitur Kritis

| # | Fitur | Kriteria Penerimaan |
|---|---|---|
| AC-1 | Offline answering | **Given** soal sudah ter-cache, **when** koneksi diputus dan siswa menjawab 10 soal, **then** semua jawaban tersimpan di perangkat dan tampil kembali setelah reload tab. |
| AC-2 | Auto-sync | **Given** ada 10 jawaban dalam antrean lokal, **when** koneksi pulih, **then** semua terkirim otomatis dalam ≤ 15 detik, tanpa duplikasi, dan indikator berubah ke "Tersinkron". |
| AC-3 | Idempotensi | **Given** batch yang sama dikirim dua kali, **then** server menyimpan sekali dan membalas ACK keduanya. |
| AC-4 | Submit offline | **Given** siswa menekan Selesai saat offline, **then** input terkunci, status "menunggu sinkronisasi", dan saat online attempt menjadi *submitted* dengan jawaban lengkap. |
| AC-5 | Deadline | **Given** waktu pengerjaan habis, **then** attempt otomatis ter-submit; jawaban yang dibuat setelah deadline + toleransi ditolak dan ditandai di log. |
| AC-6 | Batas percobaan | **Given** percobaan maksimum tercapai, **then** tombol Mulai dinonaktifkan dan server menolak start baru (`409`). |
| AC-7 | Publish gating | **Given** tenant tanpa kuota aktif, **when** guru menekan Publish, **then** ditolak dengan pesan dan tautan pembelian paket. |
| AC-8 | Penalti | **Given** penalti aktif dan siswa keluar aplikasi lebih dari toleransi, **then** pelanggaran tercatat, peringatan tampil, dan nilai akhir berkurang sesuai konfigurasi (nilai asli, penalti, nilai akhir terlihat terpisah). |
| AC-9 | Isolasi tenant | **Given** pengguna tenant A, **when** mengakses ID resource tenant B, **then** respons `404`; ada tes otomatis untuk semua endpoint. |
| AC-10 | Import siswa | **Given** file berisi 500 baris dengan 5 baris salah, **then** preview menampilkan 495 valid dan 5 error beserta nomor baris dan alasannya; hanya baris valid yang disimpan setelah konfirmasi. |
| AC-11 | Retensi | **Given** akses berakhir 7 hari lalu tanpa perpanjangan, **then** job menghapus data tenant dan mencatat audit; perpanjangan sebelum hari ke-7 membatalkan penghapusan. |
| AC-12 | Mobile | **Given** layar 360×640, **then** seluruh alur siswa (login → mulai → jawab 5 tipe soal → daftar soal → selesai) dapat dilakukan tanpa scroll horizontal dan dengan target sentuh ≥ 44 px. |

---

## 11. Spesifikasi UI/UX & Peta Halaman

- **Prinsip:** sederhana, minim klik, jelas, bahasa sehari-hari, konsisten.
- **Guru (desktop-first, tetap nyaman di mobile):** sidebar navigasi (menjadi bottom nav/drawer di mobile), tabel dengan filter & pencarian (menjadi kartu di mobile), wizard pembuatan ujian bertahap (Info → Soal → Peserta → Jadwal → Publish).
- **Siswa (mobile-first):** satu kolom, tombol besar, timer sticky, navigasi soal via bottom sheet, mode layar penuh, minim distraksi.
- **Tema:** token warna (CSS variables) untuk light/dark; aksen konsisten; animasi ringan (hormati `prefers-reduced-motion`).
- **Umpan Balik:** skeleton loading, toast, status sinkron jelas, pesan error yang menjelaskan solusi.
- **Menjodohkan di mobile:** pola tap-pilih-kiri lalu tap-pilih-kanan (alternatif drag-and-drop) dengan garis/penanda warna.

### 11.1 Peta Halaman (Sitemap)

**Guru/Admin (`app.`)**
`/login` · `/register` · `/dashboard` · `/classes` · `/students` · `/students/:id` (track record) · `/question-sets` · `/question-sets/:id/edit` · `/exams` · `/exams/new` (wizard) · `/exams/:id` (detail & aksi pengawas) · `/exams/:id/cheating` · `/reports/live` · `/reports/history` · `/reports/exams/:id` · `/billing` · `/settings` (profil, guru, tema)

**Siswa (`ujian.`)**
`/login` · `/guest` (tanpa akun) · `/exams` · `/exams/:id/start` (token & tata tertib) · `/attempt/:id` (butir soal) · `/attempt/:id/review` (konfirmasi selesai) · `/attempt/:id/done` · `/history`

**Super Admin**
`/admin/tenants` · `/admin/plans` · `/admin/payments` · `/admin/metrics`

---

## 12. Keamanan & Integritas Ujian

- Token ujian + kode ujian; token dapat dirotasi; rate limiting login/token (anti brute-force).
- Satu sesi aktif per siswa; deteksi login ganda.
- Acak urutan soal & opsi per siswa.
- Anti-cheat sesuai FR-5.8: deteksi keluar aplikasi dengan penalti/laporan curang, serta proctoring kamera opsional.
- Copy-paste dan klik kanan dinonaktifkan di area soal (deterrent).
- Soal tidak menyertakan kunci jawaban di sisi klien; penilaian dan penalti dihitung di server.
- Audit log: perubahan soal, kunci, nilai, reset attempt, pembatalan penalti, akses snapshot.
- Enkripsi in transit (TLS) dan at rest (backup, object storage); sanitasi HTML rich text (allowlist) untuk mencegah XSS.
- Data foto kamera diperlakukan sebagai data pribadi: persetujuan, retensi pendek, akses terbatas.

---

## 13. Metrik Keberhasilan (KPI)

| Metrik | Target (6 bulan pasca-peluncuran) |
|---|---|
| Tenant terdaftar | ≥ 100 |
| Konversi trial → berbayar | ≥ 15% |
| Kehilangan jawaban (ter-ACK atau lokal) | 0 kasus |
| Keberhasilan sinkron offline | ≥ 99,5% |
| Waktu pembuatan ujian pertama | < 10 menit (median) |
| Crash/error rate sisi siswa | < 0,5% sesi |
| Kepuasan pengguna (CSAT) | ≥ 4,3 / 5 |
| Uptime jam ujian | ≥ 99,5% |

---

## 14. Rencana Rilis & Strategi Pengujian

| Fase | Durasi (perkiraan) | Cakupan |
|---|---|---|
| **Fase 0 — Fondasi** | 2–3 minggu | Setup repo, CI/CD, desain UI/token tema, skema DB, auth & multi-tenant |
| **Fase 1 — Core Soal & Siswa** | 4–5 minggu | Siswa/kelas + import/export, editor soal 5 tipe AKM, draft/publish, import/export template soal |
| **Fase 2 — Ujian & Siswa Client** | 5–6 minggu | Pengaturan ujian, token, UI siswa (butir soal, daftar soal, selesai), penilaian otomatis, dark/light mode |
| **Fase 3 — Offline & Sinkronisasi** | 3–4 minggu | PWA, IndexedDB, antrean sync, timer offline, pemulihan, uji jaringan buruk |
| **Fase 3b — Anti-Cheat & Proctoring** | 3–4 minggu | Deteksi keluar aplikasi + penalti, snapshot kamera, deteksi wajah ringan, laporan kecurangan, login siswa tanpa akun |
| **Fase 4 — Laporan** | 3–4 minggu | Laporan real-time, laporan historis, track record siswa, analisis butir, export |
| **Fase 5 — Billing & Beta** | 3–4 minggu | Paket & kuota, integrasi Midtrans + Mayar, retensi 7 hari & export data, invoice, Super Admin console, setup Coolify/backup, uji beban, beta tertutup |
| **Fase 6 — Peluncuran** | 2 minggu | Hardening, dokumentasi, onboarding, rilis publik |

**Kriteria MVP (P0, beta tertutup):** Fase 0–3 + deteksi keluar aplikasi dengan penalti (bagian dari Fase 3b) + laporan dasar + billing (paket gratis, per ujian, bulanan) dengan Midtrans aktif. Login siswa tanpa akun, kamera, dan Mayar masuk P1 (rilis publik); lihat Bagian 4.2.

### 14.1 Strategi Pengujian & Kualitas

| Jenis | Cakupan |
|---|---|
| Unit test (Go) | Mesin penilaian (semua tipe soal, rumus parsial, normalisasi isian), penalti, kuota/tier, retensi |
| Integration test | API + PostgreSQL asli (testcontainers), RLS/isolasi tenant, webhook Midtrans/Mayar idempoten |
| E2E (Playwright) | Alur guru dan siswa di viewport desktop dan mobile |
| E2E offline | Emulasi jaringan putus/lambat/flapping saat ujian, reload tab, tutup-buka browser, submit offline |
| Uji beban (k6) | Skenario ±1.000 siswa: mulai serentak, sinkron jawaban, submit serentak; ukur p95, error rate, antrean |
| Keamanan | Cek OWASP Top 10, tes otomatis isolasi tenant, review dependency, uji brute-force token |
| Aksesibilitas | Pemeriksaan otomatis (axe) + uji keyboard; kontras dark/light |
| Perangkat nyata | Android low-end, iPhone Safari, Chrome desktop, layar kecil 360 px |

**Definition of Done:** fitur memiliki kriteria penerimaan terpenuhi, test otomatis lulus, tampil benar di dark/light dan mobile/desktop, tercatat di audit log (bila sensitif), dan terdokumentasi di OpenAPI.

---

## 15. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Lonjakan konkuren saat mulai/submit | API lambat/gagal | Cache paket soal, rate limit adaptif, antrean, uji beban sebelum rilis |
| Data lokal hilang (browser dibersihkan) | Jawaban hilang | Autosync agresif saat online, peringatan, fitur reset attempt oleh guru |
| Kecurangan | Kredibilitas rendah | Acak soal/opsi, logging pelanggaran, token, satu sesi; roadmap proctoring |
| Dukungan Safari/iOS terbatas (Background Sync) | Sinkron tertunda | Sinkron saat app aktif + event `online` + polling; jangan bergantung hanya pada Background Sync |
| Kebocoran antar-tenant | Pelanggaran data | RLS, tes otomatis isolasi tenant, audit |
| Kompleksitas editor rumus/gambar | Jadwal molor | Gunakan TipTap + KaTeX; batasi fitur media di MVP |
| Sengketa pembayaran/webhook | Pendapatan salah | Webhook idempoten, rekonsiliasi harian |
| Data anak & foto kamera (UU PDP) | Risiko hukum/reputasi | Kamera opsional per ujian, persetujuan eksplisit, snapshot kecil tanpa video/audio, retensi pendek, akses tercatat |
| Penghapusan data 7 hari menghilangkan track record | Sekolah kehilangan riwayat | Pengingat berulang, tombol Export Semua Data, pemulihan bila diperpanjang dalam 7 hari |
| Single VPS (SPOF) | Downtime saat jam ujian | Backup di luar VPS, monitoring, rencana restore terdokumentasi, siap upgrade/migrasi |
| Penalti keluar aplikasi tidak adil (notifikasi, telepon masuk) | Keluhan siswa/guru | Toleransi detik, penalti dapat dibatalkan guru, batas penalti maksimum |

---

## 16. Asumsi & Ketergantungan

- Pengguna memiliki browser modern; siswa minimal memiliki satu kali koneksi saat memulai ujian.
- Akun Midtrans dan Mayar disetujui dan aktif (verifikasi bisnis); VPS Ubuntu dengan Coolify sudah terpasang.
- Layanan email & object storage tersedia.
- Domain, SSL, dan infrastruktur cloud dipersiapkan sebelum beta.

---

## 17. Keputusan Produk (Final v1)

### 17.1 Keputusan

| # | Topik | Keputusan |
|---|---|---|
| 1 | Harga & kuota | Gratis 1–10 siswa (1x ujian, 14 hari); per ujian: 11–40 Rp10.000/3x, 41–70 Rp20.000/7x, 71–100 Rp30.000/12x; bulanan: 1–50 Rp50.000, 51–100 Rp70.000 (Bagian 3.1) |
| 2 | Trial | Sama dengan paket gratis: 1–10 siswa, 1x ujian, 14 hari, fitur lengkap |
| 3 | Login siswa | Dua metode: username/password dan tanpa akun (data diri + kode + token) |
| 4 | Nilai uraian | Koreksi manual oleh guru |
| 5 | Proctoring | Kamera + anti-cheat; keluar/pindah aplikasi → pengurangan nilai atau dilaporkan curang (FR-5.8) |
| 6 | Retensi data | 7 hari setelah akses berakhir tanpa perpanjangan, lalu dihapus (aturan titik mulai: Bagian 3.2) |
| 7 | White-label | Tidak ada |
| 8 | Bank soal bersama | Tidak ada |
| 9 | Payment gateway | Midtrans dan Mayar |
| 10 | Hosting | VPS Ubuntu, deploy via Coolify (Bagian 7.4) |
| 11 | Di atas 100 siswa | Belum ada paket di v1 ("Hubungi kami") |
| 12 | Kredit per ujian | Tidak kedaluwarsa |
| 13 | Perpindahan tier | Upgrade bayar selisih; downgrade periode berikutnya (Bagian 3.2) |
| 14 | Nilai default anti-cheat/kamera | Lihat tabel default di FR-5.8 (semuanya dapat diubah guru) |

### 17.2 Hal yang Ditinjau Setelah Beta

1. **Margin per paket** setelah biaya gateway, penyimpanan, dan bandwidth dihitung dengan angka nyata.
2. **Retensi 7 hari:** apakah cukup bagi sekolah, mengingat riwayat nilai ikut terhapus; evaluasi jumlah keluhan/permintaan pemulihan.
3. **Default penalti dan kamera:** apakah terlalu ketat/longgar berdasarkan data pelanggaran dan keluhan.
4. **Kapasitas VPS:** hasil uji beban dan data konkurensi nyata untuk menentukan kapan memisahkan database/menambah instance.
5. **Kebutuhan paket di atas 100 siswa** berdasarkan jumlah permintaan "Hubungi kami".

---

## 18. Lampiran

### 18.1 Contoh Struktur Template Import Siswa

| Nama | Jenis Kelamin | Kelas | NIS (opsional) |
|---|---|---|---|
| Ahmad Fauzi | L | X IPA 1 | 12345 |
| Siti Aisyah | P | X IPA 1 | 12346 |

### 18.2 Contoh Struktur Template Import Soal (Ringkas)

| tipe | pertanyaan | opsi_A | opsi_B | opsi_C | opsi_D | kunci | poin | pembahasan |
|---|---|---|---|---|---|---|---|---|
| pg | Ibu kota Indonesia? | Jakarta | Bandung | Medan | Surabaya | A | 2 | — |
| pg_kompleks | Pilih bilangan prima | 2 | 4 | 5 | 9 | A,C | 3 | — |
| menjodohkan | Pasangkan negara–ibu kota | (pasangan kiri\|kanan; dipisah `;`) | | | | Indonesia\|Jakarta;Jepang\|Tokyo | 4 | — |
| isian | 7 + 8 = … | | | | | 15 | 2 | — |
| uraian | Jelaskan proses fotosintesis | | | | | (rubrik) | 10 | — |

### 18.3 Status Attempt (State Machine)

```
not_started ──start──▶ in_progress ──submit(online)──────────▶ submitted ──▶ graded
                           │  │                                   ▲            │
                           │  └─submit(offline)─▶ pending_sync ───┘            └─▶ awaiting_manual_grading ──▶ graded
                           │
                           ├─ waktu habis ─▶ auto-submit ─▶ submitted
                           └─ pelanggaran ≥ ambang (opsi) ─▶ auto-submit; cheating_status = flagged
                                                          └─ keputusan guru: valid | penalti dibatalkan | disqualified
```

- `pending_sync`: sudah selesai di perangkat, menunggu terkirim ke server.
- `awaiting_manual_grading`: ada soal uraian yang belum dinilai; nilai berstatus **Sementara**.
- `disqualified`: attempt dibatalkan oleh guru; nilai 0 dan tidak dihitung pada rata-rata.

### 18.4 Glosarium
- **CBT** — Computer Based Test.
- **AKM** — Asesmen Kompetensi Minimum.
- **Tenant** — satu sekolah/lembaga pelanggan dengan data terisolasi.
- **Attempt** — satu percobaan pengerjaan ujian oleh seorang siswa.
- **PWA** — Progressive Web App.
- **RLS** — Row-Level Security (PostgreSQL).
- **Idempoten** — permintaan yang diulang menghasilkan hasil sama tanpa efek ganda.

### 18.5 Riwayat Revisi

| Versi | Perubahan |
|---|---|
| 1.0 | Draft awal: seluruh modul, arsitektur, model data, API, roadmap |
| 1.1 | Keputusan produk: harga awal, login dua metode, proctoring, retensi 7 hari, Midtrans + Mayar, VPS + Coolify |
| 1.2 | Harga final (tier 1–100 siswa tanpa celah), aturan tier/upgrade, titik mulai retensi, nilai default anti-cheat & kamera, matriks hak akses, prioritas P0–P2, modul notifikasi, infrastruktur Coolify, konvensi API, kriteria penerimaan, peta halaman, strategi pengujian, state machine attempt |
