// Kerangka halaman auth staf — panel identitas institusi (kiri) + formulir (kanan).
// Mobile: brand strip ringkas di atas, formulir di bawah. Tanpa emoji.
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
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col lg:flex-row">
        {/* panel identitas */}
        <aside className="auth-visual text-ink-fg flex flex-col justify-between px-5 py-5 sm:px-7 lg:w-[47%] lg:py-8">
          <div className="auth-glow flex h-full flex-col">
            <div className="flex items-center gap-2.5">
              <LogoMark size={32} />
              <div>
                <div className="text-[15px] font-bold leading-tight tracking-tight">FlowCBT</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Ruang Kerja Ujian</div>
              </div>
            </div>

            <div className="mt-auto hidden pt-10 lg:block">
              <p className="max-w-xs text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                CBT modern untuk sekolah unggulan
              </p>
              <h1 className="mt-2.5 max-w-sm text-[26px] font-bold leading-tight tracking-tight">
                Kelola ujian sekolah<br />tanpa ribet teknis.
              </h1>
              <p className="mt-2.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">
                Bank soal AKM, penjadwalan, pengawasan real-time, dan rekap nilai —
                dalam satu ruang kerja yang rapi.
              </p>

              <ul className="mt-7 grid max-w-md grid-cols-2 gap-3.5">
                {POINTS.map(({ Ico, title: t, body }) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-ink-line bg-white/5 text-ink-fg"
                      aria-hidden
                    >
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

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-ink-line pt-3">
              <span className="text-[11px] text-ink-muted">CBT multi-sekolah · siap offline · PWA</span>
              <ThemeToggle tone="inverse" />
            </div>
          </div>
        </aside>

        {/* formulir */}
        <main className="flex flex-1 items-start justify-center px-4 py-6 sm:px-6 lg:items-center lg:py-8">
          <div className="w-full max-w-[430px]">
            <div className="mb-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Ruang Kerja Staf</div>
              <h2 className="mt-1.5 text-[22px] font-bold tracking-tight">{title}</h2>
              {subtitle && <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>}
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">{children}</div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted">
              Sesi dienkripsi · Data terisolasi per sekolah
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
