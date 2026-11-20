// Kerangka halaman auth — area terpisah dari app guru, mobile-first, toggle tema (PRD §11)
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">FlowCBT</div>
            <div className="text-xs text-muted">Ujian online untuk sekolah Anda</div>
          </div>
          <ThemeToggle />
        </div>
        <div className="card">
          <h1 className="font-bold text-lg mb-0.5">{title}</h1>
          {subtitle && <p className="text-sm text-muted mb-2">{subtitle}</p>}
          <div className={subtitle ? '' : 'mt-2'}>{children}</div>
        </div>
        <p className="text-center text-xs text-muted">FlowCBT — CBT multi-sekolah, siap offline</p>
      </div>
    </div>
  )
}
