// Kerangka halaman auth — split-brand (desktop 2 kolom) / ringkas (mobile), toggle tema (PRD §11)
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { IconChart2, IconShield, IconStudents, LogoMark } from '@/components/icons'

const SELLING_POINTS = [
  { Ico: IconShield, label: 'Anti-cheat & offline penuh' },
  { Ico: IconChart2, label: 'Nilai otomatis & laporan real-time' },
  { Ico: IconStudents, label: 'Tanpa instalasi — cukup browser' },
]

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm md:max-w-xl md:grid md:grid-cols-[1fr_1.15fr] bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
        {/* kolom brand — hanya desktop */}
        <div className="hidden md:flex flex-col justify-between border-r border-border p-7">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={40} />
              <div>
                <div className="font-bold text-xl leading-tight tracking-tight">FlowCBT</div>
                <div className="text-xs text-muted">Ujian Online</div>
              </div>
            </div>
            <p className="text-sm text-muted mt-5 leading-relaxed">
              Ujian online untuk sekolah Anda — tetap jalan walau internet putus.
            </p>
            <ul className="mt-6 space-y-3">
              {SELLING_POINTS.map(({ Ico, label }) => (
                <li key={label} className="flex items-center gap-2.5 text-sm">
                  <span className="w-7 h-7 shrink-0 rounded-md bg-primary-soft text-primary flex items-center justify-center" aria-hidden>
                    <Ico size={15} />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted mt-8">CBT multi-sekolah · siap offline · PWA</p>
        </div>

        {/* kolom form */}
        <div className="p-5 sm:p-7">
          <div className="flex items-center justify-between md:justify-end">
            <div className="md:hidden flex items-center gap-2">
              <LogoMark size={24} />
              <span className="font-bold tracking-tight">FlowCBT</span>
            </div>
            <ThemeToggle />
          </div>
          <h1 className="font-bold text-lg mt-3 md:mt-0">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5 mb-3">{subtitle}</p>}
          <div className={subtitle ? '' : 'mt-3'}>{children}</div>
        </div>
      </div>
    </div>
  )
}
