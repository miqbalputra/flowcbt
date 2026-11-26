// Command palette global (Ctrl+K / Cmd+K) — pencarian lintas ujian, bank soal,
// siswa, kelas (GET /api/v1/search) + indeks HALAMAN & FITUR internal yang bisa
// dicari via kata kunci (mis. "kartu", "curang", "2fa", "riwayat"). Navigasi
// keyboard penuh (panah wrap-around, Home/End, Enter, Esc), riwayat hasil
// terakhir (localStorage), highlight teks cocok, skeleton loading, dan state
// error yang jelas.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import {
  IconSearch, IconX, IconBank, IconExam, IconStudents, IconClass,
  IconDashboard, IconChart2, IconShield, IconSettings, IconCredit,
  IconClock, IconHistory, IconPlay, IconPlus, IconGrid, IconClipboard,
} from '@/components/icons'

type Dict = Record<string, unknown>
const asDict = (v: unknown): Dict => (v && typeof v === 'object' ? (v as Dict) : {})
const asList = (v: unknown): Dict[] => (Array.isArray(v) ? (v as Dict[]) : [])

type Hit = { id: string; title: string; sub: string; to: string; group: string }
type Group = { key: string; label: string; items: Hit[] }

const GROUP_ICON: Record<string, typeof IconSearch> = {
  pages: IconGrid,
  exams: IconExam,
  qsets: IconBank,
  students: IconStudents,
  classes: IconClass,
}
const GROUP_TONE: Record<string, string> = {
  pages: 'border-border bg-canvas text-muted',
  exams: 'border-primary-line bg-primary-soft text-primary',
  qsets: 'border-warn-line bg-warn-soft text-warn',
  students: 'border-success-line bg-success-soft text-success',
  classes: 'border-ink-line bg-canvas text-text',
}
const groupTone = (k: string) => GROUP_TONE[k] ?? 'border-border bg-canvas text-muted'

// ---------- Indeks halaman & fitur internal (bisa dicari via kata kunci) ----------
type PageEntry = {
  to: string; label: string; sub: string; Icon: typeof IconSearch
  keywords: string[]; tone: string
}
const PAGES: PageEntry[] = [
  { to: '/dashboard', label: 'Dashboard', sub: 'Ringkasan hari ini', Icon: IconDashboard, tone: 'pages', keywords: ['beranda', 'utama', 'ringkasan', 'home', 'statistik', 'hari ini'] },
  { to: '/exams', label: 'Ujian', sub: 'Daftar semua ujian & tes', Icon: IconExam, tone: 'exams', keywords: ['ujian', 'tes', 'tes online', 'jadwal', 'daftar ujian', 'exam'] },
  { to: '/exams/new', label: 'Buat Ujian Baru', sub: 'Wizard membuat ujian', Icon: IconPlus, tone: 'exams', keywords: ['buat ujian', 'ujian baru', 'tambah ujian', 'buat tes', 'tes baru', 'new exam'] },
  { to: '/exams', label: 'Kartu Ujian', sub: 'Buka detail ujian → tab Kartu Ujian', Icon: IconClipboard, tone: 'exams', keywords: ['kartu', 'kartu ujian', 'nomor peserta', 'no peserta', 'pdf', 'unduh kartu', 'kartu peserta', 'wa whatsapp'] },
  { to: '/question-sets', label: 'Bank Soal', sub: 'Kumpulan paket soal', Icon: IconBank, tone: 'qsets', keywords: ['bank soal', 'soal', 'paket', 'buat soal', 'editor soal', 'kumpulan soal', 'kisi-kisi'] },
  { to: '/students', label: 'Siswa', sub: 'Data & akun siswa', Icon: IconStudents, tone: 'students', keywords: ['siswa', 'peserta', 'murid', 'import siswa', 'data siswa', 'nis', 'kelas siswa'] },
  { to: '/classes', label: 'Kelas', sub: 'Rombongan belajar', Icon: IconClass, tone: 'classes', keywords: ['kelas', 'rombel', 'rombongan belajar', 'kelas baru'] },
  { to: '/reports', label: 'Laporan', sub: 'Hasil & analitik nilai', Icon: IconChart2, tone: 'pages', keywords: ['laporan', 'hasil', 'nilai', 'analitik', 'grafik', 'rapor', 'statistik nilai'] },
  { to: '/reports/live', label: 'Pantauan Live', sub: 'Pantau peserta secara real-time', Icon: IconPlay, tone: 'pages', keywords: ['live', 'pantau', 'monitoring', 'real-time', 'langsung', 'sedang berlangsung', 'pantauan'] },
  { to: '/reports/history', label: 'Riwayat Ujian', sub: 'Arsip ujian yang sudah lewat', Icon: IconClock, tone: 'pages', keywords: ['riwayat', 'arsip', 'history', 'ujian lama', 'sudah lewat', 'lampau'] },
  { to: '/cheating', label: 'Anti-Curang', sub: 'Pantau & tinjau kecurangan', Icon: IconShield, tone: 'pages', keywords: ['anti curang', 'curang', 'kecurangan', 'salin', 'copy paste', 'monitor', 'pelanggaran', 'kecurangan ujian', 'curang'] },
  { to: '/audit', label: 'Audit Log', sub: 'Jejak semua aksi penting', Icon: IconHistory, tone: 'pages', keywords: ['audit', 'log', 'aktivitas', 'jejak', 'riwayat aksi', 'siapa melakukan'] },
  { to: '/billing', label: 'Langganan', sub: 'Paket, kuota & tagihan', Icon: IconCredit, tone: 'pages', keywords: ['langganan', 'paket', 'kuota', 'tagihan', 'bayar', 'billing', 'harga', 'upgrade', 'paket aktif'] },
  { to: '/settings', label: 'Pengaturan', sub: 'Akun, keamanan & preferensi', Icon: IconSettings, tone: 'pages', keywords: ['pengaturan', 'akun', 'profil', 'sandi', 'password', 'kata sandi', '2fa', 'otp', 'keamanan', 'tema', 'gelap terang', 'preferensi', 'sekolah'] },
]

/** Enam halaman utama untuk empty state "Jelajah". */
const QUICK_PAGES = PAGES.slice(0, 6)

/** Cocokkan query (bisa multi kata) terhadap label+sub+keywords; skor: label diawali > label mengandung > kata kunci. */
function matchPages(q: string): Hit[] {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  return PAGES.map(p => {
    const label = p.label.toLowerCase()
    const hay = label + ' ' + p.sub.toLowerCase() + ' ' + p.keywords.join(' ')
    if (!tokens.every(t => hay.includes(t))) return null
    const score = label.startsWith(q.toLowerCase()) ? 3 : label.includes(tokens[0]) ? 2 : 1
    return { p, score }
  }).filter((x): x is { p: PageEntry; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ p }) => ({ id: 'page-' + p.to + '-' + p.label, title: p.label, sub: p.sub, to: p.to, group: 'Halaman & Fitur' }))
}

// ---------- riwayat hasil yang dibuka (max 6, per browser) ----------
const RECENT_KEY = 'flowcbt.palette.recent'
type RecentItem = { to: string; title: string; sub: string; group: string }

function loadRecents(): RecentItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((r: unknown) => asDict(r).to && asDict(r).title).slice(0, 6) : []
  } catch { return [] }
}
function saveRecent(to: string, title: string, sub: string, group: string) {
  try {
    const rest = loadRecents().filter(r => r.to !== to)
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ to, title, sub, group }, ...rest].slice(0, 6)))
  } catch { /* kuota penuh / private mode — abaikan */ }
}

/** Split title menjadi [sebelum, cocok, sesudah] untuk highlight. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0 || q.length === 0) return <span className="truncate">{text}</span>
  return (
    <span className="truncate">
      {text.slice(0, i)}
      <mark className="bg-transparent font-bold text-primary">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </span>
  )
}

/** Bulatan ikon ala item daftar modern. */
function IconBubble({ children, tone }: { children: React.ReactNode; tone: string }) {
  return (
    <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${tone}`}>
      {children}
    </span>
  )
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { open, setOpen }
}

type Status = 'idle' | 'loading' | 'ok' | 'error'

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const query = q.trim()

  // halaman & fitur yang cocok dengan kata kunci (instan, tanpa menunggu server)
  const pageHits = useMemo(() => (query.length < 2 ? [] : matchPages(query)), [query])

  // baris navigasi saat query kosong: riwayat + tautan pintas
  const emptyRows: Hit[] = useMemo(() => [
    ...recent.map(r => ({ id: 'recent-' + r.to, title: r.title, sub: r.sub, to: r.to, group: 'Terakhir dibuka' })),
    ...QUICK_PAGES.map(p => ({ id: 'quick-' + p.to + p.label, title: p.label, sub: p.sub, to: p.to, group: 'Jelajah' })),
  ], [recent])

  const serverItems = useMemo(() => groups.flatMap(g => g.items), [groups])
  const flat = useMemo<Hit[]>(
    () => (query.length < 2 ? emptyRows : [...pageHits, ...serverItems]),
    [query, emptyRows, pageHits, serverItems],
  )

  // ---------- fokus input saat dibuka ----------
  useEffect(() => {
    if (open) {
      setQ('')
      setGroups([])
      setActive(0)
      setStatus('idle')
      setRecent(loadRecents())
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // ---------- debounce pencarian server (entitas) ----------
  useEffect(() => {
    if (!open || query.length < 2) { setStatus('idle'); setGroups([]); return }
    let cancelled = false
    setStatus('loading')
    const t = setTimeout(async () => {
      try {
        const res = await api('/search?q=' + encodeURIComponent(query))
        if (cancelled) return
        const d = asDict(res)
        setGroups(asList(d.groups).map(g => ({
          key: String(g.key),
          label: String(g.label),
          items: asList(g.items).map(h => ({ ...asDict(h), group: String(g.label) } as unknown as Hit)),
        })))
        setActive(0)
        setStatus('ok')
      } catch {
        if (!cancelled) { setGroups([]); setStatus('error') }
      }
    }, 220)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open])

  // ---------- keyboard ----------
  const go = (h: Hit) => {
    if (query.length >= 2) saveRecent(h.to, h.title, h.sub, h.group)
    onClose()
    nav(h.to)
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (flat.length ? (a + 1) % flat.length : 0)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (flat.length ? (a - 1 + flat.length) % flat.length : 0)) }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
      else if (e.key === 'End') { e.preventDefault(); setActive(flat.length - 1) }
      else if (e.key === 'Enter' && flat[active]) { e.preventDefault(); go(flat[active]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    setActive(a => Math.min(a, Math.max(0, flat.length - 1)))
  }, [flat.length])

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const optId = (i: number) => `cp-opt-${i}`
  const pageIcon = (h: Hit) => PAGES.find(p => p.label === h.title)?.Icon ?? IconGrid
  const pageTone = (h: Hit) => PAGES.find(p => p.label === h.title)?.tone ?? 'pages'

  const renderRow = (h: Hit, idx: number, icon: React.ReactNode, tone: string, opts?: { secondary?: string; right?: string; secondaryBlock?: boolean }) => (
    <button
      key={h.id}
      type="button"
      id={optId(idx)}
      data-idx={idx}
      role="option"
      aria-selected={idx === active}
      className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 text-left ${idx === active ? 'bg-primary-soft' : 'hover:bg-canvas'}`}
      onMouseEnter={() => setActive(idx)}
      onClick={() => go(h)}
    >
      <IconBubble tone={groupTone(tone)}>{icon}</IconBubble>
      <span className="min-w-0 flex-1 text-sm font-medium">
        <Highlight text={h.title} q={query} />
        {opts?.secondary && (opts.secondaryBlock
          ? <span className="block truncate text-[11px] font-normal text-muted">{opts.secondary}</span>
          : <span className="ml-2 whitespace-nowrap text-[11px] font-normal text-muted">{opts.secondary}</span>)}
      </span>
      {opts?.right && <span className="mono shrink-0 text-[11px] text-muted">{opts.right}</span>}
    </button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/45 px-4 backdrop-blur-[3px] cp-fade"
      role="dialog"
      aria-modal="true"
      aria-label="Pencarian global"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="cp-pop mt-[11vh] w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        {/* ---------- input ---------- */}
        <div className="flex min-h-13 items-center gap-3 border-b border-border px-4">
          <IconSearch size={17} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={inputRef}
            className="h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            placeholder="Cari ujian, soal, siswa, atau fitur (mis. kartu, curang, 2fa)…"
            value={q}
            onChange={e => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-listbox"
            aria-activedescendant={flat[active] ? optId(active) : undefined}
            aria-label="Kata kunci pencarian"
            autoComplete="off"
            spellCheck={false}
          />
          {q && (
            <button type="button" className="btn-quiet h-8 w-8 !p-0" aria-label="Bersihkan kata kunci" onClick={() => { setQ(''); inputRef.current?.focus() }}>
              <IconX size={14} />
            </button>
          )}
          <kbd className="mono hidden rounded-md border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-muted sm:inline">ESC</kbd>
        </div>

        {/* ---------- isi ---------- */}
        <div ref={listRef} id="cp-listbox" role="listbox" aria-label="Hasil pencarian" className="max-h-[48vh] overflow-y-auto overscroll-contain p-2">
          {query.length < 2 && (
            <>
              {recent.length > 0 && (
                <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/80">
                  <span className="inline-flex items-center gap-1.5"><IconClock size={11} /> Terakhir dibuka</span>
                </div>
              )}
              {recent.map((r, i) => (
                <button
                  key={'recent-' + r.to}
                  type="button"
                  id={optId(i)}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 text-left ${i === active ? 'bg-primary-soft' : 'hover:bg-canvas'}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go({ id: 'recent-' + r.to, ...r })}
                >
                  <span aria-hidden className="mono flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-canvas text-lg leading-none">↩</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="block truncate text-[11px] text-muted">{r.group} · {r.sub || 'Terakhir diakses'}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted">Riwayat</span>
                </button>
              ))}
              <div className={recent.length ? 'px-2 pb-1 pt-3' : 'px-2 pb-1 pt-2'}>
                <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted/80">Jelajah</span>
              </div>
              {QUICK_PAGES.map((p, j) => {
                const i = recent.length + j
                return (
                  <button
                    key={'quick-' + p.to + p.label}
                    type="button"
                    id={optId(i)}
                    data-idx={i}
                    role="option"
                    aria-selected={i === active}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 text-left ${i === active ? 'bg-primary-soft' : 'hover:bg-canvas'}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go({ id: 'quick-' + p.to + p.label, title: p.label, sub: p.sub, to: p.to, group: 'Jelajah' })}
                  >
                    <IconBubble tone={groupTone(p.tone)}><p.Icon size={14} /></IconBubble>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.label}</span>
                      <span className="block truncate text-[11px] text-muted">{p.sub}</span>
                    </span>
                  </button>
                )
              })}
            </>
          )}

          {query.length >= 2 && (
            <>
              {/* ---------- hasil instan: halaman & fitur ---------- */}
              {pageHits.length > 0 && (
                <Fragment>
                  <div className="flex items-baseline gap-1.5 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/80">
                    Halaman & Fitur <span className="font-semibold normal-case tracking-normal text-muted/60">· {pageHits.length}</span>
                  </div>
                  {pageHits.map(h => {
                    const idx = flat.indexOf(h)
                    const P = pageIcon(h)
                    return renderRow(h, idx, <P size={14} />, pageTone(h), { secondary: h.sub, secondaryBlock: true })
                  })}
                </Fragment>
              )}

              {/* ---------- loading server ---------- */}
              {status === 'loading' && (
                <div className="p-2" aria-hidden>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="flex items-center gap-3 rounded-lg px-2.5 py-2.5">
                      <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-canvas" />
                      <span className="min-w-0 flex-1 space-y-1.5">
                        <span className="block h-3 w-1/3 animate-pulse rounded bg-canvas" />
                        <span className="block h-2.5 w-1/5 animate-pulse rounded bg-canvas" />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ---------- error server (halaman tetap tampil di atas) ---------- */}
              {status === 'error' && (
                <div className="px-3 py-4 text-center">
                  <p className="mb-1 text-xs text-muted">Pencarian data (ujian/siswa/soal) gagal dimuat — coba lagi.</p>
                  <button type="button" className="btn btn-sm" onClick={() => { setQ(q + ' '); setQ(q) }}>Coba lagi</button>
                </div>
              )}

              {/* ---------- kosong total ---------- */}
              {status === 'ok' && serverItems.length === 0 && pageHits.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="mb-1 text-sm font-medium">Tidak ada hasil untuk “{query}”</p>
                  <p className="text-xs text-muted">Coba kata kunci lain — nama ujian, kode, NIS, nama siswa, atau fitur seperti “kartu”, “curang”, “2fa”.</p>
                </div>
              )}

              {/* ---------- hasil server per grup ---------- */}
              {groups.map(g =>
                g.items.length === 0 ? null : (
                  <Fragment key={g.key}>
                    <div className="flex items-baseline gap-1.5 px-2 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-[0.09em] text-muted/80">
                      {g.label}
                      <span className="font-semibold normal-case tracking-normal text-muted/60">· {g.items.length}</span>
                    </div>
                    {g.items.map(h => {
                      const idx = flat.indexOf(h)
                      const G = GROUP_ICON[g.key] ?? IconSearch
                      return renderRow(h, idx, <G size={14} />, g.key, { secondary: h.group, right: h.sub })
                    })}
                  </Fragment>
                ),
              )}
            </>
          )}
        </div>

        {/* ---------- footer hint ---------- */}
        <div className="flex items-center gap-4 border-t border-border bg-canvas/60 px-4 py-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><kbd className="mono rounded border border-border bg-surface px-1.5 py-px">↑↓</kbd> navigasi</span>
          <span className="inline-flex items-center gap-1.5"><kbd className="mono rounded border border-border bg-surface px-1.5 py-px">↵</kbd> buka</span>
          <span className="inline-flex items-center gap-1.5"><kbd className="mono rounded border border-border bg-surface px-1.5 py-px">Esc</kbd> tutup</span>
          <span className="ml-auto hidden sm:inline">Cari juga fitur: kartu, curang, audit, 2fa…</span>
        </div>
      </div>
    </div>
  )
}
