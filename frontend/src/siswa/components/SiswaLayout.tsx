// Kerangka halaman Area Siswa — header sticky 56px dgn logo + tema + status
// koneksi. Menyediakan juga TextField ber-ikon (dipakai Login/Guest/Start) dan
// EmptyState ber-ikon outline (tanpa emoji).
import type { InputHTMLAttributes, ReactNode } from 'react'
import { LogoMark, IconEmpty } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ConnStatus } from './ConnStatus'

export function SiswaLayout({
  title,
  subtitle,
  titleIcon,
  children,
}: {
  title: string
  subtitle?: string
  /** Ikon konteks 18px sebelum teks judul (bila relevan) — tanpa emoji. */
  titleIcon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2.5 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <LogoMark size={20} />
            <div className="min-w-0">
              <h1 className="flex items-center gap-1.5 truncate text-sm font-bold leading-tight sm:text-base">
                {titleIcon && <span className="shrink-0 text-muted" aria-hidden>{titleIcon}</span>}
                <span className="truncate">{title}</span>
              </h1>
              {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ConnStatus />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-8">{children}</main>
    </div>
  )
}

/** Input satu baris dgn ikon kiri (18px, muted, pl-9) — sebaris label. */
export function TextField({
  label,
  icon,
  mono = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  icon?: ReactNode
  /** font-mono + tracking-widest + uppercase (kode/token/NIS). */
  mono?: boolean
}) {
  const { id, className, ...others } = rest
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted [&_svg]:block"
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          className={`input ${icon ? 'pl-9' : ''} ${mono ? 'font-mono tracking-widest uppercase' : ''} ${className ?? ''}`}
          spellCheck={mono ? false : others.spellCheck}
          {...others}
        />
      </div>
    </div>
  )
}

/** Empty state dgn ikon outline sederhana (tanpa emoji besar). */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <IconEmpty size={32} className="text-muted" />
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted">{hint}</p>}
    </div>
  )
}
