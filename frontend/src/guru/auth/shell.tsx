// Kerangka halaman auth staf — panel identitas institusi (kiri) + formulir (kanan).
// Mobile: panel atas ringkas, formulir di bawah. Tanpa emoji.
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { IconChart2, IconShield, IconStudents, IconWifi, LogoMark } from '@/components/icons'

const POINTS = [
  { Ico: IconShield, title: 'Ujian terkendali', body: 'Token, tata tertib, penalti, dan kamera opsional.' },
  { Ico: IconWifi, title: 'Offline-first', body: 'Siswa tetap mengerjakan saat koneksi terputus.' },
  { Ico: IconChart2, title: 'Laporan otomatis', body: 'Nilai objektif langsung, pantauan real-time.' },
  { Ico: IconStudents, title: 'Multi-sekolah', body: 'Data setiap lembaga terisolasi penuh.' },
]

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col lg:flex-row">
        {/* panel identitas */}
        <aside className="appbar flex flex-col justify-between px-5 py-5 sm:px-7 lg:w-[46%] lg:py-8">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={30} />
              <div>
                <div className="text-[15px] font-bold leading-tight tracking-tight">FlowCBT</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Ruang Kerja Ujian</div>
              </div>
            </div>

            <h1 className="mt-6 hidden max-w-sm text-xl font-bold leading-snug lg:block">
              Kelola ujian sekolah<br />tanpa ribet teknis.
            </h1>
            <p className="mt-2 hidden max-w-sm text-[13px] leading-relaxed text-ink-muted lg:block">
              Bank soal AKM, penjadwalan, pengawasan real-time, dan rekap nilai dalam satu tempat.
            </p>

            <ul className="mt-6 hidden space-y-3 lg:block">
              {POINTS.map(({ Ico, title: t, body }) => (
                <li key={t} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-ink-line bg-white/5 text-ink-fg" aria-hidden>
                    <Ico size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold">{t}</div>
                    <p className="text-[12px] leading-snug text-ink-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-ink-line pt-3">
            <span className="text-[11px] text-ink-muted">CBT multi-sekolah · siap offline · PWA</span>
            <ThemeToggle tone="inverse" />
          </div>
        </aside>

        {/* formulir */}
        <main className="flex flex-1 items-start justify-center px-4 py-6 sm:px-6 lg:items-center lg:py-8">
          <div className="w-full max-w-md">
            <div className="mb-4">
              <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
              {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            </div>
            <div className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">{children}</div>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
              FlowCBT · Sistem Ujian Berbasis Komputer untuk sekolah dan lembaga.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
