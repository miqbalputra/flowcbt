// Kerangka halaman masuk Area Siswa — panel identitas institusi (kiri, gelap)
// + formulir (kanan, terang). Dipakai Login akun & Login tamu.
import type { ReactNode } from 'react'
import { LogoMark, IconCheck, IconClipboard, IconShield, IconStudents } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'

const STEPS = [
  { icon: <IconClipboard size={15} />, title: 'Masuk ruang ujian', body: 'Gunakan akun sekolah atau data diri + kode ujian.' },
  { icon: <IconShield size={15} />, title: 'Baca tata tertib', body: 'Setujui ketentuan dan masukkan token dari pengawas.' },
  { icon: <IconCheck size={15} />, title: 'Kerjakan dengan tenang', body: 'Jawaban tersimpan otomatis, tetap aman saat offline.' },
]

export function AuthPortal({
  title,
  subtitle,
  children,
  footer,
  guestLink,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  guestLink?: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="flex min-h-dvh w-full flex-col lg:flex-row">
        {/* ---------------- panel identitas ---------------- */}
        <aside className="appbar flex flex-col justify-between px-5 py-5 sm:px-7 lg:w-[46%] lg:py-8">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark size={30} />
              <div>
                <div className="text-[15px] font-bold leading-tight tracking-tight">FlowCBT</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Sistem Ujian Berbasis Komputer</div>
              </div>
            </div>

            <h1 className="mt-6 hidden text-xl font-bold leading-snug lg:block">
              Ruang ujian peserta —<br />tenang, jelas, dan terpercaya.
            </h1>
            <p className="mt-2 hidden max-w-sm text-[13px] leading-relaxed text-ink-muted lg:block">
              Masuk untuk melihat jadwal ujian, mengerjakan soal, dan melihat hasilmu. Tidak perlu instal aplikasi.
            </p>

            <ol className="mt-5 hidden space-y-3 lg:block">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex items-start gap-2.5">
                  <span className="mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ink-line bg-white/5 text-[11px] font-bold text-ink-fg">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <span className="text-ink-muted" aria-hidden>{s.icon}</span>
                      {s.title}
                    </div>
                    <p className="text-[12px] leading-snug text-ink-muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-line pt-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
              <IconStudents size={13} /> Butuh bantuan? Hubungi pengawas.
            </span>
            <ThemeToggle tone="inverse" />
          </div>
        </aside>

        {/* ---------------- formulir ---------------- */}
        <main className="flex flex-1 items-start justify-center px-4 py-6 sm:px-6 lg:items-center lg:py-8">
          <div className="w-full max-w-md">
            <div className="mb-4 lg:mb-5">
              <h2 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h2>
              {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            </div>
            <div className="rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">{children}</div>
            {footer && <div className="mt-3 text-center text-[13px] text-muted">{footer}</div>}
            {guestLink && <div className="mt-2 text-center text-[13px] text-muted">{guestLink}</div>}
            <p className="mt-5 text-center text-[11px] leading-relaxed text-muted">
              Dengan masuk, kamu menyetujui ketentuan penggunaan dan kebijakan privasi FlowCBT.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
