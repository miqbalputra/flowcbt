// Track record siswa (FR-3.7): profil, riwayat attempt, tren nilai (bar sederhana pakai div)
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { downloadFile } from '../files'
import { toast } from '@/components/toast'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows } from '../ui'
import {  asDict, asList, asDict as d, attemptStatus, fmtDate, fmtDuration, unwrap } from '../types'

export default function StudentDetail() {
  const { id } = useParams()
  const [exporting, setExporting] = useState(false)
  const detail = useQuery({
    queryKey: ['students', id],
    queryFn: async () => unwrap(await api(`/students/${id}`)),
  })
  const track = useQuery({
    queryKey: ['students', id, 'track-record'],
    queryFn: async () => unwrap(await api(`/students/${id}/track-record`)),
  })

  async function exportPDF() {
    setExporting(true)
    try {
      await downloadFile(`/students/${id}/track-record?format=pdf`, `track-record-${id}.pdf`)
      toast('PDF track record diunduh', 'success')
    } catch (e) {
      toast(String((e as Error).message || 'Gagal mengunduh'), 'error')
    } finally {
      setExporting(false)
    }
  }

  const p = detail.data ? asDict(detail.data) : {}
  const t = track.data ? asDict(track.data) : {}
  const attempts = asList(t.attempts ?? t.history ?? t.results ?? [])
  const student = asDict(t.student ?? p)

  const withScore = attempts.map(a => ({ a, s: Number(a.score ?? a.final_score ?? 0) })).filter(x => Number.isFinite(x.s))
  const maxScore = Math.max(0, ...withScore.map(x => x.s), 1)
  const avg = withScore.length ? Math.round(withScore.reduce((acc, x) => acc + x.s, 0) / withScore.length) : null

  return (
    <div className="space-y-4">
      <PageHeader
        title={String(student.full_name ?? student.name ?? 'Profil Siswa')}
        desc="Track record seluruh ujian yang pernah diikuti."
        action={
          <div className="flex gap-2">
            <button className="btn-ghost text-sm" disabled={exporting} onClick={() => void exportPDF()}>
              {exporting ? 'Mengunduh…' : '⬇ PDF'}
            </button>
            <Link to="/students" className="btn-ghost text-sm">← Daftar siswa</Link>
          </div>
        }
      />

      {detail.isLoading || track.isLoading ? (
        <SkeletonRows rows={4} cols={4} />
      ) : detail.isError || track.isError ? (
        <ErrorBox error={(detail.error ?? track.error) as unknown} />
      ) : (
        <>
          {/* profil */}
          <div className="card grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {([
              ['Nama', student.full_name ?? student.name],
              ['NIS', student.nis ?? student.student_code],
              ['Kelas', student.class_name ?? student.class],
              ['Jenis kelamin', student.gender ? (String(student.gender).toUpperCase() === 'P' ? 'Perempuan' : 'Laki-laki') : undefined],
              ['Username', student.username],
              ['Terdaftar', student.created_at],
            ] as [string, unknown][]).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
              <div key={k}>
                <div className="text-xs text-muted">{k}</div>
                <div className={`font-medium ${k === 'NIS' || k === 'Username' ? 'font-mono' : ''}`}>{typeof v === 'string' && /^\d{4}-/.test(v) ? fmtDate(v) : String(v)}</div>
              </div>
            ))}
          </div>

          {/* tren nilai (bar sederhana, tanpa library) */}
          {withScore.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold">📈 Tren nilai</h3>
                <span className="text-sm text-muted">Rata-rata {avg ?? '—'}</span>
              </div>
              <div className="space-y-2">
                {withScore.slice(0, 12).reverse().map(({ a, s }, i) => (
                  <div key={a.attempt_id ?? a.id ?? i}>
                    <div className="flex justify-between text-xs text-muted">
                      <span className="truncate mr-2">{String(a.subject_name ?? a.exam_name ?? 'Ujian')}</span>
                      <span className="shrink-0">{s}</span>
                    </div>
                    <div className="h-2 rounded-full bg-border/40">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (s / maxScore) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* riwayat attempt */}
          <div>
            <h3 className="font-semibold mb-2">🗂 Riwayat ujian</h3>
            {attempts.length === 0 ? (
              <EmptyState icon="🗂" title="Belum pernah ikut ujian" />
            ) : (
              <table className="table-base responsive-table">
                <thead>
                  <tr><th>Mapel</th><th>Tanggal</th><th>Percobaan</th><th>Nilai</th><th>Durasi</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {attempts.map((a, i) => {
                    const st = attemptStatus(a.status ?? a.state)
                    return (
                      <tr key={a.attempt_id ?? a.id ?? i}>
                        <td data-th="Mapel" className="font-medium">{String(a.subject_name ?? a.exam_name ?? a.exam_subject ?? '—')}</td>
                        <td data-th="Tanggal">{fmtDate(a.date ?? a.start_at ?? a.created_at)}</td>
                        <td data-th="Percobaan">ke-{String(a.attempt_no ?? 1)}</td>
                        <td data-th="Nilai" className="font-bold">{String(a.score ?? a.final_score ?? '—')}</td>
                        <td data-th="Durasi">{fmtDuration(a.duration_seconds ?? a.duration)}</td>
                        <td data-th="Status"><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
