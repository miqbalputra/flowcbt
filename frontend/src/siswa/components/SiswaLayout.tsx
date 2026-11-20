// Kerangka halaman Area Siswa — header sticky + tema + status koneksi.
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ConnStatus } from './ConnStatus'

export function SiswaLayout({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string
  subtitle?: string
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-full flex flex-col bg-bg text-text">
      <header className="sticky top-0 z-40 border-b border-border bg-surface shadow-sm">
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
      <main className="mx-auto w-full max-w-3xl flex-1 p-4">{children}</main>
    </div>
  )
}
