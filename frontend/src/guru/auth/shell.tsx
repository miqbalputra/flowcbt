// Kerangka halaman auth — area terpisah dari app guru, mobile-first, toggle tema (PRD §11)
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xl font-bold text-primary">🌸 FlowCBT</div>
          <ThemeToggle />
        </div>
        <div className="card">
          <h1 className="font-bold text-lg mb-1">{title}</h1>
          {children}
        </div>
        <p className="text-center text-xs text-muted">Ujian online untuk sekolah Anda — FlowCBT</p>
      </div>
    </div>
  )
}
