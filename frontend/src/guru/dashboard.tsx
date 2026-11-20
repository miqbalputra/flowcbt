// Dashboard guru/admin (FR-2.1..2.3, M10) — status langganan & sisa kuota dari /billing/subscription
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows } from './ui'
import { asDict, asList, fmtDate, fmtRp, unwrap, unwrapList } from './types'

const SHORTCUTS = [
  { to: '/question-sets/new/edit', icon: '✏️', label: 'Buat Soal', desc: 'Buat paket soal baru' },
  { to: '/exams/new', icon: '📝', label: 'Buat Ujian', desc: 'Jadwalkan ujian dari paket soal' },
  { to: '/students?import=1', icon: '📥', label: 'Import Siswa', desc: 'Unduh template & unggah daftar siswa' },
  { to: '/reports/live', icon: '📊', label: 'Lihat Laporan', desc: 'Pantauan ujian real-time' },
]

function StatCard({ icon, label, value, hint }: { icon: string; label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden>{icon}</span>
        <div className="min-w-0">
          <div className="text-xs text-muted">{label}</div>
          <div className="font-bold text-lg truncate">{value}</div>
          {hint && <div className="text-xs text-muted truncate">{hint}</div>}
        </div>
      </div>
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

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" desc="Ringkasan hari ini di lembaga Anda 👋" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {dash.isLoading ? (
          <div className="col-span-2 lg:col-span-4 space-y-3"><SkeletonRows rows={2} /></div>
        ) : dash.isError ? (
          <div className="col-span-2 lg:col-span-4"><ErrorBox error={dash.error} /></div>
        ) : (
          <>
            <StatCard icon="📝" label="Ujian berjalan" value={String(d.running_exams ?? d.active_exams ?? 0)} hint="sedang dikerjakan siswa" />
            <StatCard icon="⏰" label="Ujian terjadwal" value={String(d.scheduled_exams ?? 0)} hint="belum dibuka" />
            <StatCard icon="🧑‍🎓" label="Total siswa" value={String(d.total_students ?? d.students ?? 0)} />
            <StatCard icon="🎯" label="Rata-rata nilai" value={String(d.avg_last_score ?? d.avg_score ?? '—')} hint="ujian terakhir" />
          </>
        )}
      </div>

      {/* status langganan & sisa kuota (M10) */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">💳 Langganan</h3>
          <Link to="/billing" className="btn-ghost text-sm">Kelola</Link>
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
                    <div key={q.code ?? i} className="rounded-lg border border-border p-3 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="truncate mr-2">{String(q.name ?? q.code ?? 'Kuota')}</span>
                        <span className="text-muted shrink-0">{used}/{limit || '∞'}</span>
                      </div>
                      <div className="h-2 rounded-full bg-border/40">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${limit ? Math.min(100, Math.round((used / limit) * 100)) : 0}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">Kuota paket: {fmtRp(s.exams_left ?? s.credit_idr ?? 0)} / sisa ujian {String(s.exams_left ?? s.exam_credits ?? '—')}</p>
            )}
          </>
        )}
      </div>

      {/* pintasan cepat (FR-2.2) */}
      <div>
        <h3 className="font-semibold mb-2">Pintasan cepat</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SHORTCUTS.map(sc => (
            <button key={sc.to} type="button" onClick={() => nav(sc.to)} className="card text-left hover:border-primary">
              <div className="text-2xl mb-1" aria-hidden>{sc.icon}</div>
              <div className="font-medium text-sm">{sc.label}</div>
              <div className="text-xs text-muted">{sc.desc}</div>
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
              <Link to={`/reports/live/${row.id}`} className="btn-ghost text-sm shrink-0">Pantau →</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
