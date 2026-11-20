# FlowCBT — Konvensi Kode (WAJIB untuk semua kontributor/agent)

Repo monorepo: `backend/` (Go 1.22+) + `frontend/` (React 18 + TS + Tailwind v4).

## Backend

- Entry: `backend/cmd/api` (API) & `backend/cmd/worker` (job worker, di bangun nanti).
- Pattern modul fitur — lihat contoh `internal/users/handlers_auth.go` dan `internal/billing`:
  - `internal/<modul>/` berisi `Module struct{ a *app.App }`, `Init(a *app.App) *Module`, `func (m *Module) Routes(r chi.Router)`.
  - Router utama (`internal/api/router.go` + `modules.go`) MEMASANG modul secara eksplisit. **Jangan** mengedit file milik modul lain.
- Error: gunakan `httpx.Error(w, err)` dengan `httpx.NewErr(status, "STABIL_CODE", "pesan")`. Kode stabil ada di `internal/httpx`.
- Context informasi user: `ctxinfo.TenantID/UserID/Role/StudentID(ctx)`.
- **Isolasi tenant (RLS):** SEMUA query tabel data tenant WAJIB via
  `m.a.DB.WithTenant(ctx, tenantID, func(tx pgx.Tx) error { ... })` (pool App, RLS aktif).
  Pool Admin (`m.a.DB.Admin`) hanya untuk: auth/registrasi, superadmin, billing, dan lookup publik
  (mis. cari exam oleh kode sebelum tenant diketahui).
- Skema DB (baca): `backend/internal/db/migrations/0001_init.up.sql`. Migrasi baru: file
  `000N_<nama>.up.sql` di folder yang sama; perubahan skema harus backward-compatible.
- Penilaian soal WAJIB lewat `internal/grading` (Grade, FinalScore, ApplyPenalty) — jangan duplikasi logika.
- Gaya respons: `httpx.OK(w, map[string]any{"data": ...})` untuk objek/list; `httpx.Created` saat buat.
  Daftar besar: query param `?q=&limit=&cursor=&sort=`.
- Audit log untuk aksi sensitif: INSERT ke `audit_logs` (tenant scoping tetap).
- Sebelum selesai: `go build ./...` dan `go test ./...` HARUS lulus di folder backend.

## Frontend

- Struktur:
  - `src/lib/api.ts` — fetch client (jangan tulis fetch manual; gunakan `api<T>(path, opts)`).
  - `src/lib/theme.ts` — hook tema gelap/terang (FR-11.1).
  - `src/stores/auth.ts` — zustand.
  - Area guru: `src/guru/**` (layout sidebar, halaman per PRD §11.1 app).
  - Area siswa: `src/siswa/**` (mobile-first, PWA).
  - Komponen bersama: `src/components/**`.
- CSS: class komponen sudah disediakan di `src/styles.css` (card, btn-primary, btn-ghost, btn-danger,
  input, label, badge, table-base, responsive-table, skeleton). Tailwind v4 dengan token warna
  semantic: `bg-surface text-text border-border text-muted bg-primary` dsb. Mode gelap otomatis via class `dark`.
- Mobile-first: target sentuh ≥44px, tabel pakai `responsive-table` (td diberi `data-th`),
  modal jadi bottom sheet (class `sheet` bila tersedia), tidak boleh scroll horizontal layar 360px.
- Bahasa UI: Indonesia yang ramah/sehari-hari.
- Sebelum selesai: `npm run build` HARUS lulus (tsc strict).

## API umum (kontrak)

- Base `/api/v1`, JSON, `Authorization: Bearer <JWT>`.
- Sukses: `{"data": ...}`; error: `{"code": "QUOTA_EXCEEDED", "message": "..."}`.
- Pagination: `?limit=&cursor=`; pencarian `?q=`; filter spesifik per list.

## banyak hal yang belum ada — periksa dulu sebelum memakai

- Worker job queue (email dsb) belum ada; jangan bergantung padanya.
- Redis belum ada; rate limit in-memory di `auth.RateLimiter`.
- Object storage belum ada; media upload dikirim ke disk lokal `data/uploads/<tenant>/`
  oleh modul media yang sudah/sedang dibangun; jika modul media belum tersedia, jangan tersandung.

## Halaman & endpoint target per progres — baca `docs/PROGRESS.md`.
