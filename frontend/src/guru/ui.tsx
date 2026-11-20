// Komponen UI kecil bersama area guru: page header, state kosong, skeleton, error, badge.
import type { ReactNode } from 'react'
import { statusBadge } from './types'

export function PageHeader({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-lg sm:text-xl font-bold">{title}</h2>
        {desc && <p className="text-sm text-muted mt-0.5">{desc}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function EmptyState({ icon = '📭', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="card text-center py-8">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="text-sm text-muted mt-1">{children}</div>}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as { message?: string }
  return (
    <div className="card text-sm" role="alert">
      <div className="font-medium text-danger mb-1">⚠ Gagal memuat — backend mungkin sedang tidak tersedia</div>
      <div className="text-muted mb-2">{e?.message || 'Coba muat ulang halaman.'}</div>
      {onRetry && (
        <button type="button" className="btn-ghost text-sm" onClick={onRetry}>↻ Coba lagi</button>
      )}
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

/** status badge kecil (draft/published/paid/…) */
export function StatusBadge({ status }: { status: unknown }) {
  const s = statusBadge(status)
  return (
    <span className={`badge bg-transparent border border-current ${s.cls}`}>{s.label}</span>
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
