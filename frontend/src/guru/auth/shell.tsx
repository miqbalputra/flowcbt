// Kerangka halaman auth staf — pola "tebar.app": panel gelap bercerita
// dengan mock percakapan produk (kiri, desktop) + formulir terbuka tanpa
// card (kanan). Mobile: hanya formulir + logo. Tanpa emoji.
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LogoMark, IconChart2, IconClock, IconExam, IconInfo, IconShield } from '@/components/icons'

const FEATURES = [
  'Bank soal AKM',
  'Offline-first',
  'Proktor & penalti',
  'Kartu ujian PDF',
  'Pantauan live',
  'Multi-sekolah',
]

/** bubble percakapan mock — meniru cara kerja ruang kerja, bukti produk */
const STORY = [
  {
    me: true,
    text: 'Buat tryout numerasi 20 soal untuk XI IPA dan jadwalkan Kamis 07.30.',
  },
  {
    me: false,
    head: 'FlowCBT',
    lines: [
      'Paket “Tryout Numerasi #1” siap — 20 soal campuran AKM.',
      'Kamis 07.30 · XI IPA 1–3 · 84 peserta · token sekali-pakai.',
      'Kartu ujian PDF dan pantauan live siap dipakai.',
    ],
  },
]

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
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
                <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Ruang Kerja Ujian</div>
              </div>
            </div>

            <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center py-8">
              <div className="animate-rise">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                  CBT modern untuk sekolah unggulan
                </p>
                <h1 className="mt-3 max-w-[13ch] text-[42px] font-bold leading-[1.04] tracking-tight xl:text-[46px]">
                  Ujian sekolah, rapi terkendali.
                </h1>
                <p className="mt-3 max-w-[44ch] text-[15px] leading-relaxed text-ink-muted">
                  Bank soal, jadwal, kartu ujian, dan laporan nilai — satu ruang kerja
                  yang tenang bahkan saat internet sekolah sedang sulit.
                </p>
              </div>

              {/* mock percakapan */}
              <div className="mt-8 flex flex-col gap-3 animate-rise rise-1" aria-hidden>
                <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-ink-2 px-3.5 py-2.5 text-[13px] leading-snug border border-ink-line">
                  {STORY[0].text}
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-px w-6 bg-ink-line" />
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    <IconShield size={12} /> anti-curang aktif
                  </span>
                </div>
                <div className="rounded-2xl border border-ink-line bg-ink-2 p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink-fg/10">
                      <LogoMark size={14} />
                    </span>
                    <span className="text-[13px] font-semibold">{STORY[1].head}</span>
                  </div>
                  <ul className="mt-2.5 space-y-1.5">
                    {STORY[1].lines!.map(l => (
                      <li key={l} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-muted" />
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* dua kartu kecil: bukti informasi produk */}
              <div className="mt-4 grid grid-cols-2 gap-3 animate-rise rise-2" aria-hidden>
                <div className="rounded-xl border border-ink-line bg-ink-2/60 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    <IconChart2 size={12} /> pantauan live
                  </div>
                  <div className="mt-1.5 text-[19px] font-bold leading-none">28/84</div>
                  <div className="mt-1 text-[11px] text-ink-muted">peserta mengerjakan · 2 selesai</div>
                </div>
                <div className="rounded-xl border border-ink-line bg-ink-2/60 px-3.5 py-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                    <IconClock size={12} /> berjalan 43 menit
                  </div>
                  <div className="mt-1.5 text-[19px] font-bold leading-none">17 menit tersisa</div>
                  <div className="mt-1 text-[11px] text-ink-muted">2 peserta diberi perpanjangan waktu</div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-ink-line pt-4">
              <ul className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2">
                {FEATURES.map(f => (
                  <li key={f} className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <IconExam size={12} />
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
            {/* logo ringkas — tampil di semua ukuran, jadi jangkar brand di mobile */}
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

            <p className="mt-8 flex items-center gap-1.5 text-[11px] text-muted">
              <IconInfo size={13} />
              Sesi dienkripsi · Data terisolasi per sekolah
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
