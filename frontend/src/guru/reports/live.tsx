// Laporan real-time (FR-9.1): daftar ujian yang sedang berjalan
// Update real-time via SSE (FR-9.3); bila SSE gagal → polling tetap jalan.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useLiveStream, type LiveStreamStatus } from '@/lib/useLiveStream'
import { Donut, EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SkeletonRows, StatCard } from '../ui'
import { asDict, asList, fmtDuration, unwrap } from '../types'
import { IconChart2, IconCheck, IconClock, IconPlay, IconRight, IconStudents } from '@/components/icons'

/** Indikator sumber data: SSE hidup, menyambung, atau fallback polling. */
const LIVE_BADGE: Record<LiveStreamStatus, { label: string; cls: string }> = {
  live: { label: 'Real-time', cls: 'border-success-line bg-success-soft text-success' },
  connecting: { label: 'Menyambung…', cls: 'border-warn-line bg-warn-soft text-warn' },
  polling: { label: 'Polling 30 dtk', cls: 'border-border bg-canvas text-muted' },
}

function LiveBadge({ status }: { status: LiveStreamStatus }) {
  const b = LIVE_BADGE[status]
  return (
    <span className={`badge border ${b.cls}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {b.label}
    </span>
  )
}

export default function ReportsLive() {
  const nav = useNavigate()
  const qc = useQueryClient()

  // Real-time: snapshot SSE → perbarui cache query (data sama bentuknya).
  const liveStatus = useLiveStream('/reports/live/stream', {}, data => {
    qc.setQueryData(['reports', 'live'], data)
  })

  const live = useQuery({
    queryKey: ['reports', 'live'],
    queryFn: async () => unwrap(await api('/reports/live')),
    // polling jeda saat SSE hidup (hindari muat ganda, FR-9.3)
    refetchInterval: liveStatus === 'live' ? false : 30_000,
  })

  const rows = live.isLoading ? [] : live.isError ? [] : asList(live.data)
  const ready = !live.isLoading && !live.isError
  const stat = (n: number) => (ready ? String(n) : '—')

  // agregat lintas ujian berjalan (turunan tampilan, bukan query baru)
  const totals = rows.reduce(
    (acc, r) => {
      const counts = asDict(asDict(r).counts)
      acc.working += Number(counts.working ?? 0)
      acc.done += Number(counts.done ?? 0)
      acc.notStarted += Number(counts.not_started ?? 0)
      acc.participants += Number(counts.participants ?? 0)
      return acc
    },
    { working: 0, done: 0, notStarted: 0, participants: 0 },
  )
  const finishedPct = totals.participants > 0 ? Math.min(100, Math.round((totals.done / totals.participants) * 100)) : 0

  const donutParts = [
    { value: totals.working, color: 'var(--c-primary)', label: 'Mengerjakan' },
    { value: totals.done, color: 'var(--c-success)', label: 'Selesai' },
    { value: totals.notStarted, color: 'var(--c-border)', label: 'Belum mulai' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Pemantauan Ujian"
        title="Laporan Live"
        desc="Ujian yang sedang berjalan — klik untuk memantau per siswa."
        icon={<IconChart2 size={18} />}
        action={<LiveBadge status={liveStatus} />}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard
          label="Ujian berjalan"
          value={stat(rows.length)}
          hint="sedang dibuka saat ini"
          tone="primary"
          icon={<IconPlay size={14} />}
        />
        <StatCard
          label="Total peserta"
          value={stat(totals.participants)}
          hint="terdaftar pada ujian berjalan"
          icon={<IconStudents size={14} />}
        />
        <StatCard
          label="Mengerjakan"
          value={stat(totals.working)}
          hint="percobaan aktif"
          tone="primary"
          icon={<IconClock size={14} />}
        />
        <StatCard
          label="Selesai"
          value={stat(totals.done)}
          hint={ready ? `${finishedPct}% dari total peserta` : 'memuat data…'}
          tone="success"
          icon={<IconCheck size={14} />}
        />
      </div>

      {live.isLoading ? (
        <Panel title="Ujian Berjalan" icon={<IconPlay size={15} />}>
          <SkeletonRows rows={3} cols={4} />
        </Panel>
      ) : live.isError ? (
        <Panel title="Ujian Berjalan" icon={<IconPlay size={15} />}>
          <ErrorBox error={live.error} onRetry={() => live.refetch()} />
        </Panel>
      ) : rows.length === 0 ? (
        <Panel title="Ujian Berjalan" icon={<IconPlay size={15} />}>
          <EmptyState icon={<IconChart2 />} title="Tidak ada ujian berjalan">
            Nanti muncul otomatis saat ujian dibuka.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel
            title="Ujian Berjalan"
            icon={<IconPlay size={15} />}
            action={
              <span className="badge border border-border bg-canvas text-muted">
                <span className="mono">{rows.length}</span> ujian
              </span>
            }
            bodyClassName="space-y-2.5"
          >
            {rows.map((r, i) => {
              const d = asDict(r)
              const counts = asDict(d.counts)
              const working = Number(counts.working ?? 0)
              const done = Number(counts.done ?? 0)
              const notStarted = Number(counts.not_started ?? 0)
              const participants = Number(counts.participants ?? 0)
              const closeIn = Number(d.close_in_seconds ?? 0)
              const denom = Math.max(1, working + done + notStarted)
              const urgent = closeIn > 0 && closeIn < 300
              return (
                <button
                  key={d.exam_id ?? i}
                  type="button"
                  onClick={() => nav(`/reports/live/${d.exam_id}`)}
                  className="w-full rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-primary-line hover:bg-primary-soft/30 sm:p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold leading-snug">
                        {String(d.name ?? d.subject_name ?? 'Ujian')}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">{String(d.subject_name ?? '')}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="section-label">Tutup dalam</div>
                      <div className={`mono mt-0.5 text-sm font-bold ${urgent ? 'text-danger' : ''}`}>
                        {closeIn > 0 ? fmtDuration(closeIn) : '—'}
                      </div>
                    </div>
                  </div>

                  {String(d.classes ?? '').trim().length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {String(d.classes ?? '').split(',').map(x => x.trim()).filter(Boolean).map((c, j) => (
                        <span key={j} className="badge border border-primary-line bg-primary-soft text-primary">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2.5">
                    <div>
                      <div className="section-label">Mengerjakan</div>
                      <div className="mono mt-0.5 text-sm font-bold">{working}</div>
                    </div>
                    <div>
                      <div className="section-label">Selesai</div>
                      <div className="mono mt-0.5 text-sm font-bold">{done}</div>
                    </div>
                    <div>
                      <div className="section-label">Belum mulai</div>
                      <div className="mono mt-0.5 text-sm font-bold">{notStarted}</div>
                    </div>
                  </div>

                  {/* komposisi status (bar tersegmentasi, tanpa library chart) */}
                  <div className="mt-2 flex h-2 overflow-hidden rounded-sm bg-canvas">
                    <div className="h-full bg-primary" style={{ width: `${Math.round((working / denom) * 100)}%` }} />
                    <div className="h-full bg-success" style={{ width: `${Math.round((done / denom) * 100)}%` }} />
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted">
                    <span>
                      Peserta <span className="mono font-semibold text-text">{participants}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-primary">
                      Pantau <IconRight size={12} />
                    </span>
                  </div>
                </button>
              )
            })}
          </Panel>

          <div className="space-y-4">
            <Panel title="Komposisi Status" icon={<IconChart2 size={15} />}>
              <Donut parts={donutParts} size={112} />
              <div className="mt-3 space-y-2 border-t border-border pt-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">Total peserta</span>
                  <span className="mono font-bold">{totals.participants}</span>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted">Peserta selesai</span>
                    <span className="mono font-semibold">{finishedPct}%</span>
                  </div>
                  <ProgressBar value={totals.done} max={Math.max(1, totals.participants)} tone="success" label="Peserta selesai" />
                </div>
                <p className="hint">
                  Hitungan gabungan dari {rows.length} ujian berjalan; diperbarui otomatis
                  {liveStatus === 'live' ? ' lewat koneksi real-time.' : ' setiap 30 detik.'}
                </p>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
