// Laporan — halaman indeks (sebelumnya /reports 404 karena hanya sub-route
// /reports/live dan /reports/history yang terdaftar).
// Isi: ringkasan angka + pintu masuk ke Pantauan Live dan Riwayat Ujian.
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SkeletonRows, StatCard } from '../ui'
import { asDict, asList, fmtDateTime, unwrap } from '../types'
import {
  IconChart2,
  IconCheck,
  IconClock,
  IconExam,
  IconHistory,
  IconPlay,
  IconRight,
  IconStudents,
} from '@/components/icons'

type LiveRow = Record<string, unknown>

export default function ReportsHome() {
  const nav = useNavigate()

  const live = useQuery({
    queryKey: ['reports', 'live'],
    queryFn: async () => unwrap(await api('/reports/live')),
    refetchInterval: 30_000,
  })
  const history = useQuery({
    queryKey: ['reports', 'history', '', '', '', '', ''],
    queryFn: async () => unwrap(await api('/reports/history')),
  })

  const liveRows = live.isError ? [] : asList(live.data)
  const histRows = history.isError ? [] : asList(history.data)

  const totals = liveRows.reduce(
    (acc, r) => {
      const c = asDict(asDict(r).counts)
      acc.working += Number(c.working ?? 0)
      acc.done += Number(c.done ?? 0)
      acc.notStarted += Number(c.not_started ?? 0)
      acc.participants += Number(c.participants ?? 0)
      return acc
    },
    { working: 0, done: 0, notStarted: 0, participants: 0 },
  )
  const donePct = totals.participants > 0 ? Math.min(100, Math.round((totals.done / totals.participants) * 100)) : 0
  const avgArchive = (() => {
    const vals = histRows
      .map(r => Number(asDict(r).avg_score ?? asDict(r).avg ?? NaN))
      .filter(v => Number.isFinite(v) && v > 0)
    if (!vals.length) return null
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
  })()

  const stat = (n: number) => (live.isLoading ? '—' : String(n))
  const recentLive = liveRows.slice(0, 3).map(asDict) as LiveRow[]
  const recentHist = histRows.slice(0, 3).map(asDict) as LiveRow[]

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Analitik & Evaluasi"
        title="Laporan"
        desc="Pantau ujian yang sedang berjalan dan telusuri arsip hasil ujian."
        icon={<IconChart2 size={18} />}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard
          label="Ujian berjalan"
          value={stat(liveRows.length)}
          hint="dibuka saat ini"
          tone="primary"
          icon={<IconPlay size={14} />}
        />
        <StatCard
          label="Mengerjakan"
          value={stat(totals.working)}
          hint="percobaan aktif"
          icon={<IconClock size={14} />}
        />
        <StatCard
          label="Arsip ujian"
          value={history.isLoading ? '—' : String(histRows.length)}
          hint={avgArchive ? `rata-rata nilai ${avgArchive}` : 'ujian selesai'}
          tone="success"
          icon={<IconHistory size={14} />}
        />
        <StatCard
          label="Peserta selesai"
          value={stat(totals.done)}
          hint={totals.participants > 0 ? `${donePct}% dari peserta` : 'belum ada peserta'}
          tone="primary"
          icon={<IconCheck size={14} />}
        />
      </div>

      {/* Pintu masuk dua laporan utama */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => nav('/reports/live')}
          className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-xs transition-colors hover:border-primary-line hover:bg-primary-soft/30"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary-line bg-primary-soft text-primary">
            <IconPlay size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-bold">Pantauan Live</span>
              <IconRight size={14} className="ml-auto text-muted transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              Ujian yang sedang dibuka, progres per siswa, dan sisa waktu — diperbarui real-time.
            </span>
            <span className="mt-2 flex items-center gap-2">
              <span className="badge border border-primary-line bg-primary-soft text-primary">
                <span className="mono">{live.isLoading ? '—' : liveRows.length}</span> ujian berjalan
              </span>
              <span className="badge border border-border bg-canvas text-muted">
                <span className="mono">{live.isLoading ? '—' : totals.working}</span> mengerjakan
              </span>
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => nav('/reports/history')}
          className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-xs transition-colors hover:border-primary-line hover:bg-primary-soft/30"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-success-line bg-success-soft text-success">
            <IconHistory size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-bold">Riwayat Ujian</span>
              <IconRight size={14} className="ml-auto text-muted transition-transform group-hover:translate-x-0.5" />
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              Arsip ujian selesai dengan filter mapel, status, dan rentang tanggal.
            </span>
            <span className="mt-2 flex items-center gap-2">
              <span className="badge border border-success-line bg-success-soft text-success">
                <span className="mono">{history.isLoading ? '—' : histRows.length}</span> ujian
              </span>
              <span className="badge border border-border bg-canvas text-muted">
                rata-rata <span className="mono">{avgArchive ?? '—'}</span>
              </span>
            </span>
          </span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title="Ujian Berjalan"
          icon={<IconExam size={15} />}
          action={
            liveRows.length > 0 ? (
              <button type="button" className="btn-quiet btn-sm" onClick={() => nav('/reports/live')}>
                Semua <IconRight size={12} />
              </button>
            ) : undefined
          }
          bodyClassName="space-y-2"
        >
          {live.isLoading ? (
            <SkeletonRows rows={2} cols={2} />
          ) : live.isError ? (
            <ErrorBox error={live.error} onRetry={() => live.refetch()} />
          ) : recentLive.length === 0 ? (
            <EmptyState icon={<IconPlay />} title="Tidak ada ujian berjalan">
              Nanti muncul otomatis saat ujian dibuka.
            </EmptyState>
          ) : (
            recentLive.map((d, i) => {
              const c = asDict(d.counts)
              const working = Number(c.working ?? 0)
              const done = Number(c.done ?? 0)
              const notStarted = Number(c.not_started ?? 0)
              const participants = Number(c.participants ?? 0)
              const pct = participants > 0 ? Math.round(((working + done) / participants) * 100) : 0
              return (
                <button
                  key={String(d.exam_id ?? i)}
                  type="button"
                  onClick={() => nav('/reports/live/' + String(d.exam_id ?? ''))}
                  className="w-full rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:border-primary-line hover:bg-primary-soft/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold">{String(d.name ?? 'Ujian')}</span>
                    <span className="mono shrink-0 text-xs text-muted">{pct}%</span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar value={pct} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="badge border border-border bg-canvas">
                      <IconStudents size={11} /> <span className="mono">{participants}</span>
                    </span>
                    <span className="badge border border-primary-line bg-primary-soft text-primary">
                      mengerjakan <span className="mono">{working}</span>
                    </span>
                    <span className="badge border border-success-line bg-success-soft text-success">
                      selesai <span className="mono">{done}</span>
                    </span>
                    <span className="badge border border-border bg-canvas">
                      belum <span className="mono">{notStarted}</span>
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </Panel>

        <Panel
          title="Arsip Terbaru"
          icon={<IconHistory size={15} />}
          action={
            histRows.length > 0 ? (
              <button type="button" className="btn-quiet btn-sm" onClick={() => nav('/reports/history')}>
                Semua <IconRight size={12} />
              </button>
            ) : undefined
          }
          bodyClassName="space-y-2"
        >
          {history.isLoading ? (
            <SkeletonRows rows={2} cols={2} />
          ) : history.isError ? (
            <ErrorBox error={history.error} onRetry={() => history.refetch()} />
          ) : recentHist.length === 0 ? (
            <EmptyState icon={<IconHistory />} title="Belum ada arsip">
              Ujian yang selesai akan muncul di sini.
            </EmptyState>
          ) : (
            recentHist.map((d, i) => {
              const id = String(d.exam_id ?? d.id ?? '')
              return (
                <button
                  key={id || i}
                  type="button"
                  onClick={() => nav('/reports/exams/' + id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:border-primary-line hover:bg-primary-soft/30"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{String(d.name ?? 'Ujian')}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {String(d.subject_name ?? '')}
                      {d.close_at ? ` · ${fmtDateTime(d.close_at)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="section-label block">Rata-rata</span>
                    <span className="mono text-sm font-bold">{String(d.avg_score ?? d.avg ?? '—')}</span>
                  </span>
                </button>
              )
            })
          )}
        </Panel>
      </div>
    </div>
  )
}
