// Laporan real-time (FR-9.1): daftar ujian yang sedang berjalan
// Update real-time via SSE (FR-9.3); bila SSE gagal → polling tetap jalan.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useLiveStream } from '@/lib/useLiveStream'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows } from '../ui'
import {  asDict, asList, fmtDuration, unwrap } from '../types'

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

  return (
    <div className="space-y-4">
      <PageHeader title="Laporan Live" desc="Ujian yang sedang berjalan — klik untuk memantau per siswa."
        action={
          <span className={`badge ${liveStatus === 'live' ? 'bg-success-soft text-success' : 'badge-soft text-muted'}`}>
            {liveStatus === 'live' ? '● Real-time' : liveStatus === 'connecting' ? '● Menyambung…' : '● Polling 30 dtk'}
          </span>
        } />

      {live.isLoading ? (
        <SkeletonRows rows={3} cols={4} />
      ) : live.isError ? (
        <ErrorBox error={live.error} />
      ) : rows.length === 0 ? (
        <EmptyState icon="📊" title="Tidak ada ujian berjalan" children="Nanti muncul otomatis saat ujian dibuka." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {rows.map((r, i) => {
            const d = asDict(r)
            const counts = asDict(d.counts)
            const working = Number(counts.working ?? 0)
            const done = Number(counts.done ?? 0)
            const notStarted = Number(counts.not_started ?? 0)
            const closeIn = Number(d.close_in_seconds ?? 0)
            return (
              <button key={d.exam_id ?? i} type="button" className="card text-left hover:border-primary"
                onClick={() => nav(`/reports/live/${d.exam_id}`)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{String(d.name ?? d.subject_name ?? 'Ujian')}</div>
                    <div className="text-sm text-muted truncate">{String(d.subject_name ?? '')}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {asList(d.classes).map((c, j) => <span key={j} className="badge bg-primary-soft text-primary mr-1">{String(asDict(c).name ?? '')}</span>)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-muted">Tutup dalam</div>
                    <div className={`text-sm font-bold ${closeIn > 0 && closeIn < 300 ? 'text-danger' : ''}`}>
                      {closeIn > 0 ? fmtDuration(closeIn) : '—'}
                    </div>
                  </div>
                </div>
                {/* progres peserta (bar div sederhana) */}
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">
                      Mengerjakan {working} · Selesai {done} · Belum {notStarted}
                    </span>
                    <span className="text-muted">Peserta: {Number(counts.participants ?? 0)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-border/40 overflow-hidden flex">
                    <div className="h-full bg-primary" style={{ width: `${Math.round((working / Math.max(1, working + done + notStarted)) * 100)}%` }} />
                    <div className="h-full bg-success" style={{ width: `${Math.round((done / Math.max(1, working + done + notStarted)) * 100)}%` }} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
