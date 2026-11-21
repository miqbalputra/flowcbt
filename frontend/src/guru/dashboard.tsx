// Dashboard guru/admin (FR-2.1..2.3, M10) — ringkasan operasional harian.
// Sumber data: GET /dashboard (exams_running, exams_scheduled, students_count,
// last_exam_avg, quota) + GET /reports/live untuk daftar ujian berjalan.
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { ErrorBox, PageHeader, Panel, SkeletonRows, StatCard, EmptyState } from './ui'
import {
  IconCalendar, IconChart2, IconCredit, IconExam, IconPlus, IconShield,
  IconStudents, IconTrendDown, IconTrendUp, IconUpload, IconPlay, IconClock, IconBank,
} from '@/components/icons'
import { asDict, asList, fmtDate, fmtDuration, unwrap, type Ico } from './types'

const SHORTCUTS: { to: string; Ico: Ico; label: string; desc: string }[] = [
  { to: '/question-sets/new/edit', Ico: IconPlus, label: 'Buat Bank Soal', desc: 'Paket soal AKM baru' },
  { to: '/exams/new', Ico: IconExam, label: 'Jadwalkan Ujian', desc: 'Dari paket soal terbit' },
  { to: '/students?import=1', Ico: IconUpload, label: 'Import Siswa', desc: 'Template & unggah massal' },
  { to: '/reports/live', Ico: IconChart2, label: 'Pantau Ujian', desc: 'Status real-time peserta' },
]

function trendPct(cur: unknown, prev: unknown): number | null {
  const c = Number(cur)
  const p = Number(prev)
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null
  const pct = ((c - p) / Math.abs(p)) * 100
  return Number.isFinite(pct) ? Math.round(pct * 10) / 10 : null
}

function TrendBadge({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <span className={`badge ${up ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
      {up ? <IconTrendUp size={11} /> : <IconTrendDown size={11} />}
      {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: async () => unwrap(await api('/dashboard')) })
  const live = useQuery({ queryKey: ['reports', 'live'], queryFn: async () => unwrap(await api('/reports/live')), refetchInterval: 15_000 })

  const d = dash.data ? asDict(dash.data) : {}
  const quota = d.quota ? asDict(d.quota) : {}
  const liveExams = live.data ? asList(live.data) : []

  const running = Number(d.exams_running ?? d.running_exams ?? 0)
  const scheduled = Number(d.exams_scheduled ?? d.scheduled_exams ?? 0)
  const studentsCount = Number(d.students_count ?? d.total_students ?? 0)
  const avgCur = d.last_exam_avg ?? d.avg_last_score
  const avgTrend = trendPct(avgCur, d.prev_avg_score)

  const quotaStatus = String(quota.status ?? 'active')
  const monthly = Boolean(quota.monthly_active)
  const planLabel = monthly ? String(quota.monthly_plan || 'Bulanan') : quotaStatus === 'trial' ? 'Trial' : 'Gratis / Kredit'
  const maxStudents = Number(quota.max_students ?? 0)
  const credits = Number(quota.exam_credits_remaining ?? 0)
  const studentsQuotaUsed = Number(quota.students_count ?? studentsCount)
  const periodEnd = quota.monthly_ends_at ?? quota.trial_ends_at ?? quota.rights_ends_at
  const accessOk = quota.access_ok !== false

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ringkasan Operasional"
        title="Dashboard"
        desc="Kondisi ujian dan langganan lembaga Anda hari ini."
        icon={<IconChart2 size={18} />}
        action={
          <>
            <Link to="/students?import=1" className="btn-ghost btn-sm">
              <IconUpload size={14} /> Import siswa
            </Link>
            <Link to="/exams/new" className="btn-primary btn-sm">
              <IconPlus size={14} /> Ujian baru
            </Link>
          </>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {dash.isLoading ? (
          <div className="col-span-2 lg:col-span-4"><SkeletonRows rows={2} /></div>
        ) : dash.isError ? (
          <div className="col-span-2 lg:col-span-4"><ErrorBox error={dash.error} onRetry={() => void dash.refetch()} /></div>
        ) : (
          <>
            <StatCard
              label="Ujian berjalan"
              value={String(running)}
              hint="sedang dalam jadwal"
              tone="primary"
              icon={<IconPlay size={14} />}
            />
            <StatCard
              label="Ujian terjadwal"
              value={String(scheduled)}
              hint="menunggu jadwal buka"
              icon={<IconCalendar size={14} />}
            />
            <StatCard
              label="Total siswa"
              value={String(studentsCount)}
              hint={maxStudents > 0 ? `kuota tier ${maxStudents} siswa` : 'aktif terdaftar'}
              icon={<IconStudents size={14} />}
            />
            <StatCard
              label="Rata-rata nilai"
              value={avgCur !== null && avgCur !== undefined && avgCur !== 0 ? String(avgCur) : '—'}
              hint={String(d.last_exam_name ?? 'ujian terakhir')}
              tone="success"
              icon={<IconChart2 size={14} />}
              action={avgTrend !== null ? <TrendBadge pct={avgTrend} /> : undefined}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* kiri: ujian berjalan + aksi cepat */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Ujian Sedang Berlangsung"
            icon={<IconPlay size={15} />}
            action={<Link to="/reports/live" className="btn-quiet btn-sm">Lihat semua</Link>}
            flush
          >
            {live.isLoading ? (
              <div className="p-3"><SkeletonRows rows={2} cols={3} /></div>
            ) : live.isError ? (
              <div className="p-3"><ErrorBox error={live.error} onRetry={() => void live.refetch()} /></div>
            ) : liveExams.length === 0 ? (
              <EmptyState title="Tidak ada ujian berjalan" >
                Ujian yang sedang dibuka akan muncul di sini beserta status pesertanya.
              </EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table-base responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Ujian</th>
                      <th scope="col">Mata pelajaran</th>
                      <th scope="col" className="num">Peserta</th>
                      <th scope="col" className="num">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveExams.map((row, i) => {
                      const counts = asDict(row.counts)
                      return (
                        <tr key={String(row.exam_id ?? i)}>
                          <td data-th="Ujian">
                            <span className="block max-w-[16rem] truncate font-semibold">{String(row.name ?? 'Ujian')}</span>
                            <span className="mono text-[11px] text-muted">
                              tutup dalam {fmtDuration(Number(row.close_in_seconds ?? 0))}
                            </span>
                          </td>
                          <td data-th="Mapel" className="text-muted">{String(row.subject_name ?? '—')}</td>
                          <td data-th="Peserta" className="num">
                            <span className="mono">{Number(counts.working ?? 0)}</span>
                            <span className="text-[11px] text-muted"> / {Number(counts.participants ?? 0)}</span>
                          </td>
                          <td data-th="Aksi" className="num">
                            <Link to={`/reports/live/${row.exam_id}`} className="btn-ghost btn-sm">
                              Pantau <IconChart2 size={13} />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <IconClock size={15} className="text-muted" /> Aksi cepat
            </h2>
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {SHORTCUTS.map(sc => (
                <button
                  key={sc.to}
                  type="button"
                  onClick={() => nav(sc.to)}
                  className="group flex flex-col items-start gap-1.5 rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-primary hover:bg-primary-soft/40"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded border border-border bg-canvas text-primary group-hover:border-primary-line group-hover:bg-surface" aria-hidden>
                    <sc.Ico size={15} />
                  </span>
                  <span className="text-[13px] font-semibold leading-tight">{sc.label}</span>
                  <span className="text-[11px] leading-snug text-muted">{sc.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* kanan: langganan + kesiapan */}
        <div className="space-y-4">
          <Panel
            title="Langganan & Kuota"
            icon={<IconCredit size={15} />}
            action={<Link to="/billing" className="btn-ghost btn-sm">Kelola</Link>}
          >
            {dash.isLoading ? (
              <SkeletonRows rows={2} cols={2} />
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="section-label">Paket aktif</div>
                    <div className="truncate text-[15px] font-bold text-primary">{planLabel}</div>
                  </div>
                  <span
                    className={`badge border ${
                      accessOk ? 'border-success-line bg-success-soft text-success' : 'border-warn-line bg-warn-soft text-warn'
                    }`}
                  >
                    {accessOk ? 'Aktif' : 'Baca-saja'}
                  </span>
                </div>
                {periodEnd && <p className="text-xs text-muted">Berlaku sampai {fmtDate(periodEnd)}</p>}

                <div className="space-y-2.5">
                  <div>
                    <div className="flex justify-between text-[12px]">
                      <span className="mr-2">Siswa terdaftar</span>
                      <span className="mono shrink-0 text-muted">{studentsQuotaUsed}/{maxStudents || '—'}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-canvas">
                      <div
                        className="h-full rounded-sm bg-primary"
                        style={{ width: `${maxStudents ? Math.min(100, Math.round((studentsQuotaUsed / maxStudents) * 100)) : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded border border-border bg-canvas px-2.5 py-2 text-[12px]">
                    <span className="text-muted">Sisa kredit ujian</span>
                    <span className="mono font-semibold">{monthly ? 'Tanpa batas' : `${credits} ujian`}</span>
                  </div>
                  {quota.retention_delete_at ? (
                    <p className="text-[11px] text-warn">
                      Akses berakhir — data dihapus {fmtDate(quota.retention_delete_at)}.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Kesiapan Platform" icon={<IconShield size={15} />}>
            <ul className="space-y-2 text-[12.5px]">
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Mode offline siswa</span>
                <span className="badge border border-success-line bg-success-soft text-success">Aktif</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Laporan real-time</span>
                <span className="badge border border-success-line bg-success-soft text-success">SSE</span>
              </li>
              <li className="flex items-center justify-between gap-2">
                <span className="text-muted">Bank soal</span>
                <span className="inline-flex items-center gap-1 text-muted"><IconBank size={12} /> 5 tipe AKM</span>
              </li>
            </ul>
            <div className="mt-2.5 border-t border-border pt-2">
              <Link to="/settings" className="btn-quiet btn-sm w-full !justify-start !px-1.5">
                <IconShield size={14} /> Buka pengaturan keamanan
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
