# FlowCBT — Design System v3 ("Portal Ujian", Pusmendik-inspired)

Dokumen ini mengikat semua halaman. Acuan implementasi: `frontend/src/guru/dashboard.tsx`,
`frontend/src/guru/layout.tsx`, `frontend/src/siswa/pages/Attempt.tsx`,
`frontend/src/siswa/pages/Start.tsx`, `frontend/src/guru/ui.tsx`.

## Prinsip
1. **Tenang & institusional.** Kepala halaman tegas, isi rapi, tanpa dekorasi berlebih.
2. **Border dulu, shadow nyaris tidak ada.** Radius maksimal 8px (`rounded-md`/`rounded-lg`).
3. **Kepadatan informasi tinggi.** Spasi vertikal 8–20px; label kecil uppercase untuk konteks.
4. **Angka selalu monospace** (`class="mono"`): nilai, timer, kode, nomor soal, kuota.
5. **Tanpa emoji.** Ikon hanya dari `@/components/icons`.
6. **Status tidak hanya warna** — selalu ada teks/ikon.
7. **Mobile-first**: target sentuh ≥ 44px, tabel → kartu (`.responsive-table`), tidak ada scroll horizontal halaman.

## Token (Tailwind)
`bg-bg`, `bg-surface`, `bg-canvas`, `border-border`, `border-border-strong`, `text-text`,
`text-muted`, `text-primary`, `bg-primary`, `bg-primary-soft`, `border-primary-line`,
`text-success|bg-success-soft|border-success-line`, `text-warn|bg-warn-soft|border-warn-line`,
`text-danger|bg-danger-soft|border-danger-line`, `bg-ink`, `text-ink-fg`, `text-ink-muted`,
`border-ink-line`.

Kelas util: `.card`, `.panel`, `.panel-hd`, `.panel-title`, `.panel-bd`, `.panel-ft`,
`.section-label`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-quiet`, `.btn-dark`, `.btn-sm`,
`.btn-lg`, `.btn-block`, `.input`, `.label`, `.hint`, `.choice`, `.badge`, `.badge-soft`,
`.chip`, `.table-scroll`, `.table-base`, `.responsive-table`, `.q-nav*`, `.progress`,
`.skeleton`, `.mono`, `.rule-accent`, `.safe-bottom`, `.touch-target`.

## Komponen bersama (`@/guru/ui`)
- `<PageHeader eyebrow title desc icon action />` — judul + garis bawah; `action` = tombol.
- `<Panel title icon action footer flush bodyClassName>` — kartu berjudul.
- `<StatCard label value hint icon tone action />` — KPI; nilai mono.
- `<Tabs items={[{key,label,count}]} value onChange />` — tab garis bawah.
- `<Callout tone="info|success|warn|danger" title icon>`.
- `<EmptyState icon title>…</EmptyState>`, `<ErrorBox error onRetry />`, `<SkeletonRows rows cols />`.
- `<SearchBox value onChange label placeholder />`, `<TableToolbar count>`, `<SortHeader />`, `sortRowsBy`.
- `<ProgressBar value max tone />`, `<BarRow />`, `<Donut />`, `<StatusBadge status />`.

## Pola halaman guru
```
<PageHeader eyebrow="…" title="…" desc="…" icon={<Icon… size={18}/>} action={…} />
<div className="space-y-4">
  <div className="grid gap-2.5 sm:gap-3 lg:grid-cols-4">StatCards…</div>
  <Panel title="…" icon={…} flush>
    <div className="p-3 border-b border-border">toolbar: SearchBox + filter + tombol</div>
    <div className="table-scroll"><table className="table-base responsive-table">…</table></div>
  </Panel>
</div>
```
- Tabel: `thead` → `th scope="col"`; kolom angka `className="num"`; sel `data-th="Label"` untuk mobile.
- Baris status: `<StatusBadge status={…} />` atau badge soft dengan border `-line`.
- Tombol aksi baris: `btn-ghost btn-sm` / `btn-quiet btn-sm`, ikon 13–15px.
- Form: label `.label`, input `.input`, bantuan `.hint`; kelompokkan dalam `Panel` atau section dengan `.section-label`.
- Wizard: stepper nomor (kotak mono 24px) + garis; langkah aktif `bg-primary text-white`, selesai `bg-success-soft text-success`.

## Larangan
- Jangan ubah `guru/ui.tsx`, `guru/layout.tsx`, `guru/dashboard.tsx`, `components/*`, `styles.css`.
- Jangan ubah logika fetch/mutation, route, tipe data, atau teks fungsional penting.
- Jangan menambah dependensi.
- Jangan memakai `rounded-2xl/3xl`, gradien, atau shadow besar.
- Jangan menjalankan `npm run build` (cukup `npx tsc --noEmit`).
