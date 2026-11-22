// Kerangka halaman masuk Area Siswa — mengikuti pola halaman guru:
// panel gelap bercerita (dot texture + glow, mock kartu ujian, statistik
// sesi, strip fitur) + formulir terbuka tanpa card (kanan).
// Dipakai /s/login (tab Akun & tab Kartu ujian). /s/guest redirect ke sana.
// Tanpa emoji.
import type { ReactNode } from 'react'
import { LogoMark, IconClock, IconExam, IconInfo, IconShield } from '@/components/icons'
import { ThemeToggle } from '@/components/ThemeToggle'

const FEATURES = [
  'Tanpa instal',
  'Offline-first',
  'Auto-save jawaban',
  'Tata tertib',
  'Anti-curang',
  'Hasil cepat',
]

/** mock kartu peserta — meniru kartu ujian TKA yang dipegang peserta */
const CARD = {
  exam: 'Tryout Numerasi #1',
  code: 'DEMO01',
  token: 'L4EJXB',
  no: 'TA-26-03-10-0028-0001-2',
  name: 'Bunga Lestari · XI IPA 1',
}

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
      <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
        {/* ===== panel cerita (desktop) ===== */}
        <aside className="auth-visual text-ink-fg relative hidden overflow-hidden lg:flex lg:flex-col">
          <div className="auth-layer flex h-full flex-col px-8 py-7 xl:px-10">
            <div className="flex items-center gap-2.5">
              <LogoMark size={30} />
              <div>
                <div className="text-[15px] font-bold leading-tight tracking-tight">FlowCBT</div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Portal Peserta Ujian</div>
              </div>
            </div>

            <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center py-8">
              <div className="animate-rise">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                  Ruang ujian peserta
                </p>
                <h1 className="mt-3 max-w-[14ch] text-[42px] font-bold leading-[1.04] tracking-tight xl:text-[46px]">
                  Duduk, tenang, kerjakan.
                </h1>
                <div className="mt-3 grid max-w-[46ch] gap-2 text-[13px] leading-relaxed">
                  <p className="flex items-start gap-2 text-ink-muted">
                    <span className="mono mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded border border-ink-line bg-white/5 text-[10px] font-bold text-ink-fg" aria-hidden>1</span>
                    <span><span className="font-semibold text-ink-fg">Akun sekolah</span> — username, NIS, atau kode siswa + kata sandi.</span>
                  </p>
                  <p className="flex items-start gap-2 text-ink-muted">
                    <span className="mono mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded border border-ink-line bg-white/5 text-[10px] font-bold text-ink-fg" aria-hidden>2</span>
                    <span><span className="font-semibold text-ink-fg">Kartu ujian</span> — kode ujian + token + nomor peserta (masuk sebagai tamu).</span>
                  </p>
                </div>
              </div>

              {/* mock kartu ujian */}
              <div className="mt-8 animate-rise rise-1" aria-hidden>
                <div className="rounded-2xl border border-ink-line bg-ink-2 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-fg/10">
                        <IconExam size={13} />
                      </span>
                      <span className="text-[13px] font-semibold">{CARD.exam}</span>
                    </div>
                    <span className="rounded border border-ink-line px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                      jalur kartu ujian
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      ['Kode', CARD.code],
                      ['Token', CARD.token],
                      ['Nomor peserta', CARD.no],
                    ].map(([l, v]) => (
                      <div key={l} className="rounded-lg border border-ink-line bg-ink px-2.5 py-1.5">
                        <div className="text-[9.5px] font-semibold uppercase tracking-wide text-ink-muted">{l}</div>
                        <div className="mono mt-0.5 truncate text-[11.5px] font-bold">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <IconShield size={12} />
                    {CARD.name}
                  </div>
                </div>
              </div>

              {/* dua kartu kecil: suasana sesi */}
              <div className="mt-3 grid grid-cols-2 gap-3 animate-rise rise-2" aria-hidden>
                <div className="rounded-xl border border-ink-line bg-ink-2/60 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    <IconClock size={12} /> sisa waktu
                  </div>
                  <div className="mono mt-1.5 text-[19px] font-bold leading-none">43:12</div>
                  <div className="mt-1 text-[11px] text-ink-muted">soal 12/20 · tersimpan otomatis</div>
                </div>
                <div className="rounded-xl border border-ink-line bg-ink-2/60 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    <IconShield size={12} /> tata tertib
                  </div>
                  <div className="mt-1.5 text-[19px] font-bold leading-none">02 langkah</div>
                  <div className="mt-1 text-[11px] text-ink-muted">layar penuh · tetap fokus</div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-ink-line pt-4">
              <ul className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                {FEATURES.map(f => (
                  <li key={f} className="text-[11px] text-ink-muted">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* ===== formulir (terbuka, tanpa card) ===== */}
        <section className="flex flex-col px-5 py-6 sm:px-10 lg:py-10">
          <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
            <div className="mb-6 flex items-center justify-between animate-rise">
              <span className="inline-flex items-center gap-2">
                <LogoMark size={22} />
                <span className="text-[17px] font-bold tracking-tight">FlowCBT</span>
              </span>
              <ThemeToggle />
            </div>

            <div className="animate-rise rise-1">
              <h2 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[28px]">{title}</h2>
              {subtitle && <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{subtitle}</p>}
            </div>

            <div className="mt-6 animate-rise rise-2">{children}</div>

            {guestLink && (
              <p className="mt-5 text-center text-sm text-muted animate-rise rise-3">{guestLink}</p>
            )}
            {footer && (
              <p className="mt-5 text-center text-sm text-muted animate-rise rise-3">{footer}</p>
            )}

            <p className="mt-8 flex items-center gap-1.5 text-[11px] text-muted">
              <IconInfo size={13} />
              Butuh bantuan? Angkat tangan — pengawas siap membantu.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
