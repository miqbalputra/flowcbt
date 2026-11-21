// Komponen UI kecil bersama area guru: page header, state kosong, skeleton, error, badge,
// toolbar tabel & sort kolom (directive §3A — data tables enterprise). TANPA emoji: ikon SVG.
import type { ReactNode } from 'react'
import { IconEmpty, IconRefresh, IconSearch, IconWarn } from '@/components/icons'
import { statusBadge } from './types'

export function PageHeader({ title, desc, action, icon }: { title: string; desc?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0 flex items-start gap-2.5">
        {icon && <span className="text-muted shrink-0 mt-1" aria-hidden>{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold tracking-tight">{title}</h2>
          {desc && <p className="text-sm text-muted mt-0.5">{desc}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** state kosong — icon kini ReactNode (komponen ikon), bukan emoji */
export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card text-center py-8">
      <div className="w-10 h-10 mx-auto mb-2.5 rounded-lg bg-canvas border border-border text-muted flex items-center justify-center">
        {icon ?? <IconEmpty size={18} />}
      </div>
      <div className="font-medium">{title}</div>
      {children && <div className="text-sm text-muted mt-1">{children}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { message?: string }
  return (
    <div className="card text-sm flex items-start gap-3" role="alert">
      <span className="text-danger shrink-0 mt-0.5" aria-hidden><IconWarn size={18} /></span>
      <div className="min-w-0">
        <div className="font-medium text-danger mb-1">Gagal memuat — backend mungkin sedang tidak tersedia</div>
        <div className="text-muted mb-2">{e?.message || 'Coba muat ulang halaman.'}</div>
        {onRetry && (
          <button type="button" className="btn-ghost text-sm" onClick={onRetry}>
            <IconRefresh size={14} /> Coba lagi
          </button>
        )}
      </div>
    </div>
  )
}

export function SkeletonRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="card !p-3 flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** status badge kecil (draft/published/paid/…) — gaya soft dari statusBadge() */
export function StatusBadge({ status }: { status: unknown }) {
  const s = statusBadge(status)
  return (
    <span className={`badge ${s.cls}`}>{s.label}</span>
  )
}

/* ---------- Tabel data: toolbar + sort (directive §3A) ---------- */

export type SortDir = 'asc' | 'desc'

const COLLATOR = new Intl.Collator('id', { sensitivity: 'base', numeric: true })

/** Urutkan salinan rows memakai Collator lokal (id, case-insensitive, angka natural).
 * Nilai kosong selalu di akhir, apapun arah. TIDAK mengubah array asli. */
export function sortRowsBy<T>(rows: T[], getVal: (row: T) => unknown, dir: SortDir, numeric = false): T[] {
  const mul = dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const va = getVal(a)
    const vb = getVal(b)
    const ea = va === null || va === undefined || va === ''
    const eb = vb === null || vb === undefined || vb === ''
    if (ea && eb) return 0
    if (ea) return 1
    if (eb) return -1
    if (numeric) {
      const na = Number(va)
      const nb = Number(vb)
      const fa = Number.isFinite(na)
      const fb = Number.isFinite(nb)
      if (fa && fb) return (na - nb) * mul
      if (fa) return -1
      if (fb) return 1
      return 0
    }
    return COLLATOR.compare(String(va), String(vb)) * mul
  })
}

/** Header kolom sortable: klik = asc → desc → netral. Indikator ↑/↓, netral ↕ redup. */
export function SortHeader({ label, active, dir, onClick }: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Urutkan ${label}`}
      className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-xs ${active ? 'text-primary' : 'text-muted hover:text-text'}`}
    >
      {label}
      <span aria-hidden className={`text-[11px] leading-none w-3 text-center ${active ? '' : 'opacity-50'}`}>
        {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  )
}

/** Toolbar di atas tabel: kiri hitungan "X item", kanan search/filter (directive §3A). */
export function TableToolbar({ count, label = 'item', children }: { count?: number; label?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {count !== undefined && (
        <span className="text-xs font-medium uppercase tracking-wider text-muted whitespace-nowrap mr-auto">
          <span className="font-mono">{count}</span> {label}
        </span>
      )}
      {children && <div className="flex flex-wrap items-center gap-2 ml-auto">{children}</div>}
    </div>
  )
}

/** Input pencarian dengan ikon kiri (IconSearch absolut, input pl-9). */
export function SearchBox({ value, onChange, placeholder, label, className = '' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
      <input
        type="search"
        className="input pl-9"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

/** bar distribusi/track sederhana pakai div (tanpa library chart) */
export function BarRow({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="truncate mr-2">{label}</span>
        <span className="text-muted shrink-0">{hint ?? value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-border/40 overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

/** donut pakai conic-gradient (tanpa library chart) */
export function Donut({ parts, size = 132 }: { parts: { value: number; color: string; label: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1
  let acc = 0
  const stops = parts.map(p => {
    const from = (acc / total) * 100
    acc += Math.max(0, p.value)
    const to = (acc / total) * 100
    return `${p.color} ${from}% ${to}%`
  })
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div
        className="rounded-full shrink-0"
        style={{
          width: size, height: size,
          background: `conic-gradient(${stops.join(', ')})`,
          WebkitMask: 'radial-gradient(circle 55%, transparent 55%, black 56%)',
          mask: 'radial-gradient(circle 55%, transparent 55%, black 56%)',
        }}
        role="img"
        aria-label={parts.map(p => `${p.label}: ${p.value}`).join(', ')}
      />
      <div className="space-y-1 text-sm">
        {parts.map(p => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: p.color }} />
            <span>{p.label}</span>
            <span className="text-muted">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
