// Komponen UI bersama area guru/admin — Design System v3 "Portal Ujian".
// Tambahan v3: Panel, SectionHeading, StatCard, Callout, Tabs, ProgressBar.
// API lama (PageHeader, EmptyState, ErrorBox, SkeletonRows, StatusBadge,
// sortRowsBy, SortHeader, TableToolbar, SearchBox, BarRow, Donut) tetap.
import type { ReactNode } from 'react'
import {
  IconChevronDown,
  IconChevronUp,
  IconEmpty,
  IconInfo,
  IconRefresh,
  IconSearch,
  IconSort,
  IconWarn,
} from '@/components/icons'
import { statusBadge } from './types'

/* ------------------------------- header ------------------------------- */

export function PageHeader({
  title,
  desc,
  action,
  icon,
  eyebrow,
}: {
  title: string
  desc?: string
  action?: ReactNode
  icon?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-primary"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && <div className="section-label mb-0.5">{eyebrow}</div>}
          <h1 className="truncate text-lg font-bold leading-tight tracking-tight sm:text-xl">{title}</h1>
          {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
        </div>
      </div>
      {action && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{action}</div>
      )}
    </div>
  )
}

/** Judul bagian di dalam halaman (di atas grid/daftar). */
export function SectionHeading({
  title,
  desc,
  action,
  icon,
}: {
  title: string
  desc?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          {icon && <span className="text-muted" aria-hidden>{icon}</span>}
          {title}
        </h2>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* -------------------------------- panel -------------------------------- */

export function Panel({
  title,
  action,
  children,
  flush = false,
  footer,
  icon,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  flush?: boolean
  footer?: ReactNode
  icon?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel-hd">
          <h2 className="panel-title min-w-0">
            {icon && <span aria-hidden>{icon}</span>}
            <span className="truncate">{title}</span>
          </h2>
          {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
        </header>
      )}
      <div className={flush ? 'panel-bd-flush' : `panel-bd ${bodyClassName}`}>{children}</div>
      {footer && <footer className="panel-ft">{footer}</footer>}
    </section>
  )
}

/* -------------------------------- stats -------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  action,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'primary' | 'success' | 'warn' | 'danger'
  action?: ReactNode
}) {
  const tile: Record<string, string> = {
    default: 'bg-canvas text-muted border-border',
    primary: 'bg-primary-soft text-primary border-primary-line',
    success: 'bg-success-soft text-success border-success-line',
    warn: 'bg-warn-soft text-warn border-warn-line',
    danger: 'bg-danger-soft text-danger border-danger-line',
  }
  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <div className="section-label leading-tight">{label}</div>
        <div className="flex items-center gap-1.5">
          {action}
          {icon && (
            <span aria-hidden className={`flex h-7 w-7 items-center justify-center rounded-md border ${tile[tone]}`}>
              {icon}
            </span>
          )}
        </div>
      </div>
      <div className="px-3.5 pb-3 pt-1.5">
        <div className="mono truncate text-2xl font-bold leading-none tracking-tight">{value}</div>
        {hint && <div className="mt-1.5 truncate text-xs text-muted">{hint}</div>}
      </div>
    </div>
  )
}

/* ------------------------------ feedback ------------------------------ */

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
      <div className="mb-0.5 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-canvas text-muted">
        {icon ?? <IconEmpty size={20} />}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { message?: string }
  return (
    <div
      className="flex items-start gap-3 rounded-lg border p-3 text-sm"
      style={{ borderColor: 'var(--c-danger-line)', background: 'var(--c-danger-soft)' }}
      role="alert"
    >
      <span className="mt-0.5 shrink-0 text-danger" aria-hidden><IconWarn size={18} /></span>
      <div className="min-w-0">
        <div className="mb-0.5 font-semibold text-danger">Gagal memuat data</div>
        <div className="mb-2 text-muted">{e?.message || 'Backend mungkin sedang tidak tersedia. Coba muat ulang halaman.'}</div>
        {onRetry && (
          <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>
            <IconRefresh size={14} /> Coba lagi
          </button>
        )}
      </div>
    </div>
  )
}

export function Callout({
  tone = 'info',
  title,
  children,
  icon,
}: {
  tone?: 'info' | 'success' | 'warn' | 'danger'
  title?: string
  children?: ReactNode
  icon?: ReactNode
}) {
  const map = {
    info: { border: 'var(--c-primary-line)', bg: 'var(--c-primary-soft)', fg: 'var(--c-primary)' },
    success: { border: 'var(--c-success-line)', bg: 'var(--c-success-soft)', fg: 'var(--c-success)' },
    warn: { border: 'var(--c-warn-line)', bg: 'var(--c-warn-soft)', fg: 'var(--c-warn)' },
    danger: { border: 'var(--c-danger-line)', bg: 'var(--c-danger-soft)', fg: 'var(--c-danger)' },
  }[tone]
  return (
    <div className="flex items-start gap-2.5 rounded-md border p-2.5 text-sm" style={{ borderColor: map.border, background: map.bg }}>
      <span className="mt-0.5 shrink-0" style={{ color: map.fg }} aria-hidden>
        {icon ?? <IconInfo size={16} />}
      </span>
      <div className="min-w-0">
        {title && <div className="font-semibold" style={{ color: map.fg }}>{title}</div>}
        <div className="text-text">{children}</div>
      </div>
    </div>
  )
}

export function SkeletonRows({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="card flex gap-3 !p-3">
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
  return <span className={`badge ${s.cls}`}>{s.label}</span>
}

/* -------------------------------- tabs -------------------------------- */

export type TabItem = { key: string; label: string; count?: number; icon?: ReactNode }

/** Tab garis bawah (gaya portal): aktif = border-b-2 primary + teks tebal. */
export function Tabs({
  items,
  value,
  onChange,
  ariaLabel = 'Tab',
}: {
  items: TabItem[]
  value: string
  onChange: (key: string) => void
  ariaLabel?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-0.5 overflow-x-auto border-b border-border">
      {items.map(it => {
        const active = it.key === value
        return (
          <button
            key={it.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-1 border-b-2 px-2 text-[12.5px] transition-colors sm:gap-1.5 sm:px-3 sm:text-sm ${
              active
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-muted hover:border-border-strong hover:text-text'
            }`}
          >
            {it.icon && <span aria-hidden>{it.icon}</span>}
            {it.label}
            {typeof it.count === 'number' && (
              <span className={`mono rounded px-0.5 text-[10.5px] font-bold sm:px-1 sm:text-[11px] ${active ? 'bg-primary-soft text-primary' : 'bg-canvas text-muted'}`}>
                {it.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------ progress ------------------------------ */

export function ProgressBar({ value, max = 100, tone = 'primary', label }: { value: number; max?: number; tone?: 'primary' | 'success' | 'warn' | 'danger'; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0
  const color = { primary: 'var(--c-primary)', success: 'var(--c-success-bg)', warn: 'var(--c-warn-bg)', danger: 'var(--c-danger-bg)' }[tone]
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${pct}%`, background: color }} />
    </div>
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
      <span aria-hidden className={`inline-flex w-3.5 justify-center ${active ? '' : 'opacity-50'}`}>
        {active ? (dir === 'asc' ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />) : <IconSort size={13} />}
      </span>
    </button>
  )
}

/** Toolbar di atas tabel: kiri hitungan "X item", kanan search/filter. */
export function TableToolbar({ count, label = 'item', children }: { count?: number; label?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {count !== undefined && (
        <span className="mr-auto whitespace-nowrap text-xs text-muted">
          <span className="mono font-semibold text-text">{count}</span> {label}
        </span>
      )}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
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
      <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
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
        <span className="mr-2 truncate">{label}</span>
        <span className="mono shrink-0 text-muted">{hint ?? value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-sm bg-canvas">
        <div className="h-full rounded-sm bg-primary" style={{ width: `${w}%` }} />
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
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="shrink-0 rounded-full"
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
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span>{p.label}</span>
            <span className="mono text-muted">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
