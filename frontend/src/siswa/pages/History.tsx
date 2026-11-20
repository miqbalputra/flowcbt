// Riwayat ujian siswa (/s/history).
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SiswaLayout } from '../components/SiswaLayout'
import { fmtDateTime } from '../types'
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

  return (
    <SiswaLayout title="Riwayat ujian">
      {loading && (
        <ul className="space-y-2" aria-label="Memuat…">
          {[0, 1, 2].map(i => (
            <li key={i} className="skeleton h-16 w-full" />
          ))}
        </ul>
      )}
      {!loading && error && (
        <div className="card !border-danger text-sm" role="alert">
          <p className="font-semibold text-danger">Gagal memuat riwayat — periksa koneksimu.</p>
          {error && <p className="mt-1 text-muted">{error}</p>}
          <button className="btn-primary mt-3 w-full" onClick={load}>
            Coba lagi
          </button>
        </div>
      )}
      {!loading && !error && (
        items.length === 0 ? (
          <p className="text-sm text-muted">Belum ada riwayat ujian.</p>
        ) : (
          <ul className="space-y-2">
            {items.map(it => (
              <li key={it.id} className="card flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{it.exam_name}</span>
                  <span className="text-xs text-muted">{fmtDateTime(it.submitted_at)}</span>
                </span>
                {typeof it.score === 'number' && <span className="font-bold">{it.score}</span>}
              </li>
            ))}
          </ul>
        )
      )}
      <Link to="/s/exams" className="btn-ghost mt-4 w-full text-center">
        Kembali ke daftar ujian
      </Link>
    </SiswaLayout>
  )
}
