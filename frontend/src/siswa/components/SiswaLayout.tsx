// Kerangka Area Siswa — "Portal Ujian" gaya lembaga ujian nasional.
// Kepala institusional gelap + garis aksen biru, konten terpusat, footer resmi.
// Menyediakan TextField ber-ikon, Panel, MetaRow, EmptyState — tanpa emoji.
import type { InputHTMLAttributes, ReactNode } from 'react'
import { LogoMark, IconEmpty } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ConnStatus } from './ConnStatus'

export function SiswaLayout({
  title,
  subtitle,
  titleIcon,
  children,
  width = 'md',
  footerNote,
}: {
  title: string
  subtitle?: string
  titleIcon?: ReactNode
  children: ReactNode
  /** md = 768px (default), lg = 1024px, xl = 1200px (halaman ujian) */
  width?: 'md' | 'lg' | 'xl'
  footerNote?: string
}) {
  const max = width === 'xl' ? 'max-w-6xl' : width === 'lg' ? 'max-w-5xl' : 'max-w-3xl'
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="appbar sticky top-0 z-40">
        <div className={`mx-auto flex h-14 w-full ${max} items-center gap-3 px-4`}>
          <LogoMark size={22} />
          <div className="hidden shrink-0 border-l border-ink-line pl-3 sm:block">
            <div className="text-[13px] font-bold leading-tight tracking-tight">FlowCBT</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-muted">Sistem Ujian</div>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight sm:text-[15px]">
              {titleIcon && <span className="shrink-0 text-ink-muted" aria-hidden>{titleIcon}</span>}
              <span className="truncate">{title}</span>
            </h1>
            {subtitle && <div className="truncate text-[11px] text-ink-muted">{subtitle}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="hidden sm:block"><ConnStatus /></span>
            <ThemeToggle tone="inverse" />
          </div>
        </div>
      </header>

      <main className={`mx-auto w-full ${max} flex-1 px-4 py-4 pb-10 sm:py-5`}>{children}</main>

      <footer className="border-t border-border bg-surface">
        <div className={`mx-auto flex w-full ${max} flex-col gap-1 px-4 py-3 text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between`}>
          <span>FlowCBT — Ujian Berbasis Komputer</span>
          <span className="flex items-center gap-1.5">
            <span className="sm:hidden"><ConnStatus /></span>
            {footerNote ?? 'Hubungi pengawas bila mengalami kendala teknis.'}
          </span>
        </div>
      </footer>
    </div>
  )
}

/** Panel berjudul (gaya kartu formulir institusi). */
export function Panel({
  title,
  action,
  children,
  flush = false,
  icon,
  footer,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  flush?: boolean
  icon?: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="panel">
      {(title || action) && (
        <header className="panel-hd">
          <h2 className="panel-title min-w-0">
            {icon && <span aria-hidden>{icon}</span>}
            <span className="truncate">{title}</span>
          </h2>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={flush ? 'panel-bd-flush' : 'panel-bd'}>{children}</div>
      {footer && <footer className="panel-ft">{footer}</footer>}
    </section>
  )
}

/** Baris label–nilai untuk ringkasan identitas ujian. */
export function MetaRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className={`min-w-0 text-right text-[13px] font-medium ${mono ? 'mono' : ''}`}>{value}</dd>
    </div>
  )
}

/** Input satu baris dgn ikon kiri (18px, muted, pl-9) — sebaris label. */
export function TextField({
  label,
  icon,
  mono = false,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  icon?: ReactNode
  /** font-mono + tracking-widest + uppercase (kode/token/NIS). */
  mono?: boolean
  hint?: string
}) {
  const { id, className, ...others } = rest
  return (
    <div>
      <label className="auth-label" htmlFor={id}>{label}</label>
      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted [&_svg]:block"
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          className={`auth-input ${icon ? 'pl-10' : ''} ${mono ? 'mono tracking-[0.18em] uppercase' : ''} ${className ?? ''}`}
          spellCheck={mono ? false : others.spellCheck}
          {...others}
        />
      </div>
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  )
}

/** Empty state dgn ikon outline sederhana (tanpa emoji besar). */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <IconEmpty size={30} className="text-muted" />
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted">{hint}</p>}
    </div>
  )
}
