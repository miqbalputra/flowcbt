// Halaman Audit Log — jejak aksi sensitif per tenant (backend /api/v1/audit-logs).
// Tabel mengikuti pola global: .table-scroll + .table-base.responsive-table
// (otomatis menjadi kartu di mobile via data-th). Filter: aksi, kata kunci,
// rentang tanggal; paginasi cursor "Muat lebih".
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { EmptyState, PageHeader, Panel, SearchBox, SkeletonRows, TableToolbar } from './ui'
import { asDict, asList, errMessage, qs, unwrap } from './types'
import { IconHistory } from '@/components/icons'
import { toast } from '@/components/toast'

type Row = {
  id: number
  created_at: string
  actor: string
  actor_role: string
  action: string
  entity: string
  entity_id: string
  meta: string
}

/** warna badge aksi berdasarkan kategori (konsisten dengan halaman lain) */
const ACTION_TONE: [RegExp, string][] = [
  [/delete|purge|hapus/i, '!border-danger-line bg-danger-soft text-danger'],
  [/update|change|reset|regrade|override|extend|renumber/i, '!border-warn-line bg-warn-soft text-warn'],
  [/publish|create|release|checkout|wa_sent|login/i, '!border-success-line bg-success-soft text-success'],
]
const actionTone = (a: string) =>
  ACTION_TONE.find(([re]) => re.test(a))?.[1] ?? '!border-primary-line bg-primary-soft text-primary'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Admin Sekolah',
  teacher: 'Guru',
  superadmin: 'Super Admin',
  sistem: 'Sistem',
}

/** "25 Nov 2026 · 04.58" — ringkas satu baris */
function fmtWaktu(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  const tgl = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })
  const jam = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).replace(':', '.')
  return `${tgl} · ${jam}`
}

export default function AuditLog() {
  const [action, setAction] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [next, setNext] = useState('')
  const [loading, setLoading] = useState(false)

  const actions = useQuery({
    queryKey: ['audit-actions'],
    queryFn: async () => asList(unwrap(await api('/audit-logs/actions')).actions),
  })

  async function load(cursor = '') {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { limit: 50 }
      if (action) params.action = action
      if (q.trim()) params.q = q.trim()
      if (from) params.from = new Date(from + 'T00:00:00').toISOString()
      if (to) params.to = new Date(to + 'T23:59:59').toISOString()
      if (cursor) params.cursor = cursor
      const res = unwrap(await api('/audit-logs' + qs(params)))
      const d = asDict(res)
      const got = asList(d.rows) as Row[]
      setRows(prev => (cursor ? [...prev, ...got] : got))
      setNext(String(d.next_cursor ?? ''))
    } catch (e) {
      toast(errMessage(e), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, q, from, to])

  const hasFilter = Boolean(action || q.trim() || from || to)

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Analitik"
        title="Audit Log"
        desc="Semua aksi sensitif di lembaga Anda: buat/publish ujian, rilis nilai, kirim kartu, login, pengaturan akun."
        icon={<IconHistory size={18} />}
      />

      <Panel title="Jejak aktivitas" icon={<IconHistory size={15} />} flush>
        {/* toolbar filter */}
        <div className="border-b border-border p-3">
          <TableToolbar count={rows.length} label="entri">
            <div className="flex flex-1 flex-wrap items-end gap-2">
              <SearchBox
                className="w-full sm:w-60"
                label="Cari audit log"
                placeholder="Cari entitas / isi meta…"
                value={q}
                onChange={setQ}
              />
              <div>
                <label className="label !mb-1 !text-[11px]" htmlFor="au-action">Aksi</label>
                <select
                  id="au-action"
                  className="input !min-h-10 !w-auto text-xs"
                  value={action}
                  onChange={e => setAction(e.target.value)}
                >
                  <option value="">Semua aksi</option>
                  {actions.data?.map(a => <option key={String(a)} value={String(a)}>{String(a)}</option>)}
                </select>
              </div>
              <div>
                <label className="label !mb-1 !text-[11px]" htmlFor="au-from">Dari</label>
                <input
                  id="au-from"
                  type="date"
                  className="input !min-h-10 !w-auto text-xs"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label !mb-1 !text-[11px]" htmlFor="au-to">Sampai</label>
                <input
                  id="au-to"
                  type="date"
                  className="input !min-h-10 !w-auto text-xs"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                />
              </div>
              {hasFilter && (
                <button type="button" className="btn-quiet btn-sm mb-0.5" onClick={() => { setAction(''); setQ(''); setFrom(''); setTo('') }}>
                  Reset filter
                </button>
              )}
            </div>
          </TableToolbar>
        </div>

        {loading && rows.length === 0 ? (
          <div className="p-3"><SkeletonRows rows={6} cols={5} /></div>
        ) : rows.length === 0 ? (
          <div className="p-3">
            <EmptyState icon={<IconHistory size={20} />} title="Belum ada jejak aktivitas">
              Aksi seperti publish ujian, rilis nilai, dan kirim kartu akan tercatat di sini.
            </EmptyState>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table min-w-[880px]">
              <thead>
                <tr>
                  <th className="w-[168px]">Waktu</th>
                  <th className="w-[160px]">Aktor</th>
                  <th className="w-[180px]">Aksi</th>
                  <th className="w-[110px]">Entitas</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td data-th="Waktu" className="whitespace-nowrap">
                      <span className="mono text-xs text-muted">{fmtWaktu(r.created_at)}</span>
                    </td>
                    <td data-th="Aktor">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium" title={r.actor}>{r.actor || '—'}</div>
                        {r.actor_role && (
                          <div className="text-[11px] text-muted">{ROLE_LABEL[r.actor_role] ?? r.actor_role}</div>
                        )}
                      </div>
                    </td>
                    <td data-th="Aksi">
                      <span className={`badge whitespace-nowrap font-mono text-[11px] ${actionTone(r.action)}`}>
                        {r.action}
                      </span>
                    </td>
                    <td data-th="Entitas" className="text-xs text-muted">{r.entity || '—'}</td>
                    <td data-th="Detail" className="min-w-0">
                      <details className="group">
                        <summary
                          className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 outline-none [&::-webkit-details-marker]:hidden"
                          title={r.entity_id}
                        >
                          <span className="mono w-0 max-w-[260px] flex-1 truncate rounded border border-border bg-canvas px-1.5 py-0.5 text-[11px] text-muted group-open:w-auto group-open:max-w-none group-open:flex-none">
                            {r.entity_id || r.meta || '—'}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted group-open:hidden">rincian</span>
                          <span className="shrink-0 text-[10px] text-muted hidden group-open:inline">tutup</span>
                        </summary>
                        {r.meta && (
                          <pre className="mono mt-1.5 max-h-48 overflow-auto rounded-md border border-border bg-canvas p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap text-text">
                            {prettyMeta(r.meta)}
                          </pre>
                        )}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {next && (
          <div className="border-t border-border p-3">
            <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={() => void load(next)}>
              {loading ? 'Memuat…' : 'Muat lebih'}
            </button>
          </div>
        )}
        {!loading && rows.length > 0 && !next && (
          <div className="border-t border-border px-3 py-2 text-center text-xs text-muted">
            Semua {rows.length} entri ditampilkan
          </div>
        )}
      </Panel>
    </div>
  )
}

function prettyMeta(meta: string): string {
  try {
    return JSON.stringify(JSON.parse(meta), null, 2)
  } catch {
    return meta
  }
}
