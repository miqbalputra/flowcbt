// Kerangka halaman Area Siswa — header sticky 56px, tema, status koneksi.
// Padding kartu standar (card p-4 maks 1rem), tanpa dekoratif besar.
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ConnStatus } from './ConnStatus'

export function SiswaLayout({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-full flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold leading-tight sm:text-base">{title}</h1>
            {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
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

/** Empty state dengan ikon outline sederhana (tanpa emoji besar). */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted" aria-hidden>
        <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M14 3v5h5M8.5 12h7M8.5 15.5h4.5" />
      </svg>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-xs text-xs text-muted">{hint}</p>}
    </div>
  )
}
