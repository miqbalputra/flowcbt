// Riwayat ujian siswa (/s/history) — tabel ringkas + pencarian.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SiswaLayout, Panel, EmptyState } from '../components/SiswaLayout'
import { fmtDateTime } from '../types'
import { IconChart2, IconSearch, IconTrophy, IconAlertCircle } from '@/components/icons'
import { api } from '@/lib/api'

interface HistoryItem {
  id: string
  exam_name: string
  submitted_at?: string
  score?: number
  final_score?: number
  [k: string]: unknown
}

export default function History() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    api<HistoryItem[]>('/student/me/history')
      .then(r => {
        const raw = (r as unknown as { data?: unknown })?.data ?? r
        setItems(
          Array.isArray(raw)
            ? (raw as HistoryItem[]).map((r, i) => ({ ...r, id: String(r.id ?? r.exam_id ?? `h${i}`) }))
            : [],
        )
        setLoading(false)
      })
      .catch(e => {
        setError((e as { message?: string })?.message || 'Gagal memuat riwayat — periksa koneksimu.')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items
    return items.filter(it => it.exam_name.toLowerCase().includes(s))
  }, [items, q])

  // Nilai akhir skala 100 (FR-8.2) — final_score; fallback ke score.
  const finalOf = (i: HistoryItem) =>
    typeof i.final_score === 'number' ? i.final_score : typeof i.score === 'number' ? i.score : null

  const avg = useMemo(() => {
    const scores = items.map(finalOf).filter((v): v is number => v !== null)
    if (!scores.length) return null
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
  }, [items])

  return (
    <SiswaLayout title="Riwayat Ujian" subtitle="Catatan seluruh ujian yang pernah kamu serahkan" width="lg" titleIcon={<IconChart2 size={17} />}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="section-label">Total ujian</div>
            <div className="mono mt-1 text-2xl font-bold leading-none">{items.length}</div>
          </div>
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="section-label">Rata-rata nilai</div>
            <div className="mono mt-1 text-2xl font-bold leading-none text-primary">{avg ?? '—'}</div>
          </div>
        </div>

        <Panel
          title="Daftar Riwayat"
          icon={<IconChart2 size={15} />}
          flush
          action={
            <div className="relative w-44 sm:w-64">
              <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                className="input !min-h-9 pl-9 text-[13px]"
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari ujian…"
                aria-label="Cari riwayat ujian"
              />
            </div>
          }
        >
          {loading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map(i => <div key={i} className="skeleton h-14 w-full" />)}
            </div>
          ) : error ? (
            <div className="p-3">
              <div className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-soft p-3 text-sm">
                <IconAlertCircle size={17} className="mt-0.5 shrink-0 text-danger" />
                <div>
                  <p className="font-semibold text-danger">Gagal memuat riwayat</p>
                  <p className="mt-0.5 text-muted">{error}</p>
                  <button className="btn-ghost btn-sm mt-2" onClick={load}>Coba lagi</button>
                </div>
              </div>
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="Belum ada riwayat ujian" hint="Setelah kamu menyerahkan ujian, hasilnya tercatat di halaman ini." />
          ) : filtered.length === 0 ? (
            <p role="status" className="px-4 py-8 text-center text-sm text-muted">
              Tidak ada ujian yang cocok dengan “{q.trim()}”.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="table-base responsive-table">
                <thead>
                  <tr>
                    <th scope="col">Ujian</th>
                    <th scope="col">Dikirim</th>
                    <th scope="col" className="num">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(it => (
                    <tr key={it.id}>
                      <td data-th="Ujian">
                        <span className="block max-w-[22rem] truncate font-semibold">{it.exam_name}</span>
                      </td>
                      <td data-th="Dikirim" className="text-muted">{fmtDateTime(it.submitted_at)}</td>
                      <td data-th="Nilai" className="num">
                        {finalOf(it) !== null ? (
                          <span className="badge border border-success-line bg-success-soft text-success">
                            <IconTrophy size={11} /> <span className="mono font-bold">{finalOf(it)}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted">Belum dirilis</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Link to="/s/exams" className="btn-ghost btn-block">Kembali ke daftar ujian</Link>
      </div>
    </SiswaLayout>
  )
}
