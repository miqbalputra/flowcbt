// Riwayat ujian siswa (/s/history) — pencarian klien + daftar kartu padat.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SiswaLayout, EmptyState } from '../components/SiswaLayout'
import { fmtDateTime } from '../types'
import { IconCalendar, IconSearch } from '@/components/icons'
import { api } from '@/lib/api'

interface HistoryItem {
  id: string
  exam_name: string
  submitted_at?: string
  score?: number
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
        setItems(Array.isArray(r) ? r : [])
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

  return (
    <SiswaLayout title="Riwayat ujian">
      <div className="space-y-3">
        {loading && (
          <ul className="space-y-2" aria-label="Memuat…">
            {[0, 1, 2].map(i => (
              <li key={i} className="skeleton h-16 w-full" />
            ))}
          </ul>
        )}
        {!loading && error && (
          <div className="card text-sm" style={{ borderColor: 'var(--c-danger)' }} role="alert">
            <p className="font-semibold text-danger">Gagal memuat riwayat — periksa koneksimu.</p>
            {error && <p className="mt-1 text-muted">{error}</p>}
            <button className="btn-primary mt-3 w-full" onClick={load}>
              Coba lagi
            </button>
          </div>
        )}
        {!loading && !error && (
          items.length === 0 ? (
            <EmptyState title="Belum ada riwayat ujian" hint="Setelah kamu menyerahkan ujian, hasilnya tercatat di halaman ini." />
          ) : (
            <>
              {/* pencarian (type=search, directive §D) */}
              <div className="relative">
                <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">
                  <IconSearch size={16} />
                </span>
                <input
                  type="search"
                  className="input pl-9"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder={`Cari di ${items.length} ujian…`}
                  aria-label="Cari riwayat ujian"
                />
              </div>
              {filtered.length === 0 ? (
                <p role="status" className="py-6 text-center text-sm text-muted">
                  Tidak ada ujian yang cocok dengan “{q.trim()}”.
                </p>
              ) : (
                <ul className="space-y-2">
                  {filtered.map(it => (
                    <li key={it.id} className="card flex items-center justify-between gap-3 !p-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{it.exam_name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          <IconCalendar size={14} className="shrink-0" aria-hidden />
                          {fmtDateTime(it.submitted_at)}
                        </span>
                      </span>
                      {typeof it.score === 'number' && (
                        <span
                          className="badge shrink-0 border"
                          style={{ background: 'var(--c-success-soft)', color: 'var(--c-success)', borderColor: 'var(--c-success)' }}
                        >
                          Nilai <span className="font-mono font-bold">{it.score}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        )}
        <Link to="/s/exams" className="btn-ghost mt-2 w-full text-center">
          Kembali ke daftar ujian
        </Link>
      </div>
    </SiswaLayout>
  )
}
