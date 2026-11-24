// Anti-Curang (FR-5.8C) — ringkasan kecurangan lintas ujian.
// GET /exams/cheating-summary → kartu totals + tabel per ujian + breakdown
// jenis pelanggaran. Detail & keputusan guru tetap di /exams/{id}/cheating.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { EmptyState, ErrorBox, PageHeader, Panel, SkeletonRows, StatCard } from './ui'
import { unwrap } from './types'
import {
  IconRight,
  IconShield,
} from '@/components/icons'

const VIO_LABEL: Record<string, string> = {
  tab_hidden: 'Keluar tab',
  blur: 'Jendela tidak fokus',
  fullscreen_exit: 'Keluar layar penuh',
  camera_off: 'Kamera mati',
  no_face: 'Wajah tidak terdeteksi',
  multi_face: 'Lebih dari satu wajah',
}
const vioLabel = (t: string) => VIO_LABEL[t] ?? t.replace(/_/g, ' ')

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draf',
  published: 'Terbit',
  paused: 'Dijeda',
  closed: 'Ditutup',
  archived: 'Arsip',
}

type SumExam = {
  exam_id: string
  name: string
  subject_name: string
  exam_code: string
  status: string
  anti_cheat_enabled: boolean
  attempts: number
  violators: number
  violations: number
  warned: number
  flagged: number
  penalty_points: number
}

const num = (a: any) => (typeof a === 'number' ? a : Number(a ?? 0) || 0)

function ExamNameCell({ e }: { e: SumExam }) {
  return (
    <div className="min-w-0">
      <Link to={`/exams/${e.exam_id}/cheating`} className="font-medium hover:text-primary hover:underline">
        {e.name}
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span className="mono">{e.exam_code || '—'}</span>
        {!!e.subject_name && <span>· {e.subject_name}</span>}
        <span
          className={`rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
            e.status === 'published' ? 'bg-success-soft text-success' : 'bg-canvas text-muted'
          }`}
        >
          {STATUS_LABEL[e.status] ?? e.status}
        </span>
      </div>
    </div>
  )
}

export default function CheatingOverview() {
  const q = useQuery({
    queryKey: ['cheating-summary'],
    queryFn: async () => {
      const d = unwrap(await api('/exams/cheating-summary')) as Record<string, any>
      return {
        exams: (d.exams ?? []) as SumExam[],
        byType: ((d.by_type ?? []) as Array<Record<string, any>>).map(t => ({ type: String(t.type), n: num(t.n) })),
        totals: (d.totals ?? {}) as Record<string, any>,
      }
    },
  })

  const exams = q.data?.exams ?? []
  const flagged = exams.reduce((s, e) => s + num(e.flagged), 0)
  const warned = exams.reduce((s, e) => s + num(e.warned), 0)
  const violations = exams.reduce((s, e) => s + num(e.violations), 0)
  const penalty = exams.reduce((s, e) => s + num(e.penalty_points), 0)
  const maxType = Math.max(1, ...(q.data?.byType.map(t => t.n) ?? [1]))

  const needsAction = exams.filter(e => num(e.flagged) + num(e.warned) + num(e.violations) > 0)
  const clean = exams.filter(e => num(e.flagged) + num(e.warned) + num(e.violations) === 0)

  return (
    <div>
      <PageHeader
        eyebrow="ANALITIK"
        title="Anti-Curang"
        desc="Ringkasan pelanggaran ujian lintas kelas — keluar tab, jendela tidak fokus, layar penuh, kamera proktor. Keputusan penalti diambil per ujian."
        icon={<IconShield size={20} />}
      />

      {q.isLoading ? (
        <SkeletonRows rows={5} cols={6} />
      ) : q.isError ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : exams.length === 0 ? (
        <EmptyState icon={<IconShield size={28} />} title="Belum ada ujian">
          Ringkasan anti-curang muncul setelah ujian pertama dibuat dan dikerjakan peserta.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {/* ---- Kartu ringkas ---- */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Dilaporkan curang"
              value={flagged}
              hint="peserta"
              tone={flagged > 0 ? 'danger' : 'default'}
              icon={<IconShield size={16} />}
            />
            <StatCard
              label="Diperingatkan"
              value={warned}
              hint="peserta dalam ambang peringatan"
              tone={warned > 0 ? 'warn' : 'default'}
            />
            <StatCard
              label="Peristiwa pelanggaran"
              value={violations}
              hint="total event tercatat"
              tone={violations > 0 ? 'primary' : 'default'}
            />
            <StatCard label="Poin penalti" value={penalty} hint="akumulasi semua ujian" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* ---- Kolom utama: perlu ditindak ---- */}
            <Panel className="lg:col-span-2" title="Perlu ditindak">
              <p className="mb-3 text-sm text-muted">
                Ujian dengan pelanggaran atau status kecurangan — buka untuk melihat bukti &amp; ambil keputusan.
              </p>
              {needsAction.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-success-line bg-success-soft px-3 py-3 text-sm font-medium text-success">
                  <IconShield size={16} /> Tidak ada ujian dengan pelanggaran tercatat.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table-base responsive-table">
                    <thead>
                      <tr>
                        <th scope="col">Ujian</th>
                        <th scope="col" className="num">Peserta</th>
                        <th scope="col" className="num">Pelanggaran</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="num">Penalti</th>
                        <th scope="col"><span className="sr-only">Aksi</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {needsAction.map(e => (
                        <tr key={e.exam_id}>
                          <td data-th="Ujian"><ExamNameCell e={e} /></td>
                          <td data-th="Peserta" className="num">{num(e.attempts)}</td>
                          <td data-th="Pelanggaran" className="num">
                            {num(e.violators)}<span className="text-muted">/{num(e.violations)}</span>
                          </td>
                          <td data-th="Status">
                            <div className="flex flex-wrap gap-1">
                              {num(e.warned) > 0 && (
                                <span className="rounded border border-warn-line bg-warn-soft px-1.5 py-px text-[11px] font-semibold text-warn">
                                  {num(e.warned)} diperingatkan
                                </span>
                              )}
                              {num(e.flagged) > 0 && (
                                <span className="rounded border border-danger-line bg-danger-soft px-1.5 py-px text-[11px] font-semibold text-danger">
                                  {num(e.flagged)} curang
                                </span>
                              )}
                            </div>
                          </td>
                          <td data-th="Penalti" className="num">{num(e.penalty_points)} pts</td>
                          <td data-th="">
                            <Link className="btn-ghost btn-sm" to={`/exams/${e.exam_id}/cheating`}>
                              Laporan <IconRight size={12} className="inline-block align-[-1px]" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            {/* ---- Kolom kanan: jenis pelanggaran + ujian bersih ---- */}
            <div className="space-y-4">
              <Panel title="Jenis pelanggaran">
                <p className="mb-3 text-sm text-muted">Distribusi semua peristiwa yang tercatat di server.</p>
                {(q.data?.byType.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted">Belum ada pelanggaran tercatat.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {q.data!.byType.map((t: { type: string; n: number }) => (
                      <li key={t.type} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{vioLabel(t.type)}</span>
                          <span className="mono text-xs text-muted">{t.n}</span>
                        </div>
                        <div
                          className="mt-1 h-1.5 rounded-full bg-canvas"
                          role="img"
                          aria-label={`${vioLabel(t.type)}: ${t.n} peristiwa`}
                        >
                          <div
                            className="h-full rounded-full bg-danger transition-[width] duration-300"
                            style={{ width: `${(t.n / maxType) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Ujian tanpa temuan">
                <p className="mb-2 text-sm text-muted">Tetap pantau berkala.</p>
                {clean.length === 0 ? (
                  <p className="text-sm text-muted">Semua ujian punya temuan pelanggaran.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {clean.slice(0, 8).map(e => (
                      <li key={e.exam_id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <Link
                            to={`/exams/${e.exam_id}/cheating`}
                            className="truncate text-sm font-medium hover:text-primary hover:underline"
                          >
                            {e.name}
                          </Link>
                          <div className="text-xs text-muted">
                            <span className="mono">{e.exam_code || '—'}</span> · {num(e.attempts)} peserta
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
                            e.anti_cheat_enabled
                              ? 'bg-primary-soft text-primary'
                              : 'bg-canvas text-muted'
                          }`}
                          title={e.anti_cheat_enabled ? 'Anti-curang aktif' : 'Anti-curang mati'}
                        >
                          {e.anti_cheat_enabled ? 'dijaga' : 'open'}
                        </span>
                      </li>
                    ))}
                    {clean.length > 8 && (
                      <li className="pt-2 text-xs text-muted">+{clean.length - 8} ujian lainnya</li>
                    )}
                  </ul>
                )}
              </Panel>
            </div>
          </div>

          <p className="text-xs text-muted">
            Penalti selalu dihitung di server; pelanggaran offline tersinkron saat peserta kembali
            online. Buka <Link className="lnk underline hover:text-primary" to="/reports/live">Pantauan Live</Link>{' '}
            untuk memantau pelanggaran secara real-time.
          </p>
        </div>
      )}
    </div>
  )
}
