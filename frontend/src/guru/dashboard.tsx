// Dashboard guru/admin (FR-2.1..2.3, M10) — status langganan & sisa kuota dari /billing/subscription
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { ErrorBox, PageHeader, SkeletonRows } from './ui'
import { asDict, asList, fmtDate, fmtRp, unwrap } from './types'

const SHORTCUTS = [
  { to: '/question-sets/new/edit', icon: '✏️', label: 'Buat Soal', desc: 'Buat paket soal baru' },
  { to: '/exams/new', icon: '📝', label: 'Ujian Baru', desc: 'Jadwalkan ujian dari paket soal' },
  { to: '/students?import=1', icon: '📥', label: 'Import Siswa', desc: 'Unduh template & unggah daftar siswa' },
  { to: '/reports/live', icon: '📊', label: 'Rekap', desc: 'Pantauan & laporan ujian' },
]

/** Persen perubahan — HANYA bila angka pembanding benar-benar ada (tidak mengarang tren) */
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
    <span className={`badge shrink-0 ${up ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
      {up ? '↑' : '↓'} {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  )
}

/** Kartu metrik: label uppercase kecil + angka besar monospace (directive §3B) */
function StatCard({ label, value, hint, trend }: { label: string; value: string; hint?: string; trend?: number | null }) {
  return (
    <div className="card">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2 min-w-0">
        <span className="font-mono font-bold text-2xl sm:text-3xl leading-none tracking-tight truncate">{value}</span>
        {trend !== null && trend !== undefined && <TrendBadge pct={trend} />}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted truncate">{hint}</div>}
    </div>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: async () => unwrap(await api('/dashboard')) })
  const sub = useQuery({ queryKey: ['billing', 'subscription'], queryFn: async () => unwrap(await api('/billing/subscription')) })

  const d = dash.data ? asDict(dash.data) : {}
  const s = sub.data ? asDict(sub.data) : {}
  const quotas = sub.data ? asList(s.quotas ?? s.quota ?? []) : []

  // tren rata-rata nilai: hanya bila backend menyediakan pembanding periode sebelumnya
  const avgCur = d.avg_last_score ?? d.avg_score
  const avgPrev = d.prev_avg_score ?? d.prev_avg ?? d.avg_prev_score
  const avgTrend = trendPct(avgCur, avgPrev)

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" desc="Ringkasan hari ini di lembaga Anda." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {dash.isLoading ? (
          <div className="col-span-2 lg:col-span-4 space-y-3"><SkeletonRows rows={2} /></div>
        ) : dash.isError ? (
          <div className="col-span-2 lg:col-span-4"><ErrorBox error={dash.error} /></div>
        ) : (
          <>
            <StatCard label="Ujian berjalan" value={String(d.running_exams ?? d.active_exams ?? 0)} hint="sedang dikerjakan siswa" />
            <StatCard label="Ujian terjadwal" value={String(d.scheduled_exams ?? 0)} hint="belum dibuka" />
            <StatCard label="Total siswa" value={String(d.total_students ?? d.students ?? 0)} />
            <StatCard label="Rata-rata nilai" value={String(avgCur ?? '—')} hint="ujian terakhir" trend={avgTrend} />
          </>
        )}
      </div>

      {/* status langganan & sisa kuota (M10) */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Langganan</h3>
          <Link to="/billing" className="btn-ghost btn-sm">Kelola</Link>
        </div>
        {sub.isLoading ? (
          <SkeletonRows rows={2} />
        ) : sub.isError ? (
          <ErrorBox error={sub.error} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span>Paket: <b className="text-primary">{String(s.plan_name ?? s.plan_code ?? 'Gratis')}</b></span>
              {s.status && <span>Status: <b>{String(s.status)}</b></span>}
              {s.current_period_end && <span className="text-muted">Berakhir {fmtDate(s.current_period_end)}</span>}
            </div>
            {quotas.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {quotas.map((q, i) => {
                  const used = Number(q.used ?? 0)
                  const limit = Number(q.limit ?? 0)
                  return (
                    <div key={q.code ?? i} className="rounded-lg border border-border px-3 py-2.5 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="truncate mr-2">{String(q.name ?? q.code ?? 'Kuota')}</span>
                        <span className="text-muted shrink-0 font-mono">{used}/{limit || '∞'}</span>
                      </div>
                      <div className="h-2 rounded-full bg-border/40">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${limit ? Math.min(100, Math.round((used / limit) * 100)) : 0}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">Kuota paket: {fmtRp(s.exams_left ?? s.credit_idr ?? 0)} / sisa ujian <span className="font-mono">{String(s.exams_left ?? s.exam_credits ?? '—')}</span></p>
            )}
          </>
        )}
      </div>

      {/* aksi cepat (FR-2.2) — ghost + border, bukan kartu warna-warni */}
      <div>
        <h3 className="font-semibold mb-2">Aksi cepat</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SHORTCUTS.map(sc => (
            <button
              key={sc.to}
              type="button"
              onClick={() => nav(sc.to)}
              className="btn-ghost !justify-start h-auto text-left px-3.5 py-3 hover:!border-primary"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden>{sc.icon}</span> {sc.label}
                </span>
                <span className="block text-xs text-muted truncate mt-0.5">{sc.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ujian berjalan hari ini — ringkas */}
      {dash.data && !dash.isError && Array.isArray(d.live_exams) && (
        <div>
          <h3 className="font-semibold mb-2">Sedang berjalan</h3>
          {asList(d.live_exams).map((row, i) => (
            <div key={row.id ?? i} className="card mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{String(row.name ?? 'Ujian')}</div>
                <div className="text-xs text-muted truncate">{String(row.subject_name ?? '')}</div>
              </div>
              <Link to={`/reports/live/${row.id}`} className="btn-ghost btn-sm shrink-0">Pantau →</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
