// Laporan per ujian (FR-9.8..9.11): statistik, distribusi, nilai siswa, analisis butir, export
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { downloadFile } from '../files'
import { toast } from '@/components/toast'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, BarRow, SortHeader, StatusBadge, TableToolbar, sortRowsBy, type SortDir } from '../ui'
import {  asDict, asList, attemptStatus, qtypeLabel, fmtDate, fmtDuration, unwrap, unwrapList, qRows } from '../types'
import { IconChart2, IconDownload, IconStudents } from '@/components/icons'

export default function ReportExam() {
  const { id } = useParams()

  const report = useQuery({ queryKey: ['reports', 'exam', id], queryFn: async () => unwrap(await api(`/reports/exams/${id}`)) })
  const items = useQuery({ queryKey: ['reports', 'exam', id, 'item-analysis'], queryFn: () => unwrapList(api(`/reports/exams/${id}/item-analysis`)) })

  const [classFilter, setClassFilter] = useState('')
  const [exporting, setExporting] = useState<'' | 'xlsx' | 'csv' | 'pdf'>('')
  // sort kolom Nilai Akhir: asc → desc → netral (client-side, directive §3A)
  const [sort, setSort] = useState<SortDir | null>(null)
  function toggleScoreSort() {
    setSort(prev => (prev === null ? 'desc' : prev === 'desc' ? 'asc' : null))
  }
  const d = report.data ? asDict(report.data) : {}
  const exam = asDict(d.exam)
  const stats = asDict(d.stats)
  const students = asList(d.students ?? [])
  const classes = (() => {
    const seen = new Map<string, string>()
    for (const s of students) {
      const cid = String(s.class_id ?? '')
      if (cid && !seen.has(cid)) seen.set(cid, String(s.class_name ?? s.class ?? cid))
    }
    return [...seen.entries()]
  })()
  const rows = students.filter(s => !classFilter || String(s.class_id ?? '') === classFilter)
  const sortedRows = sort
    ? sortRowsBy(rows, s => Number(s.final_score ?? s.score), sort, true)
    : rows
  const distribution = asList(stats.distribution ?? [])

  async function exportRekap(format: 'xlsx' | 'csv' | 'pdf') {
    setExporting(format)
    try {
      const name = String(exam.name ?? 'ujian').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await downloadFile(`/reports/exams/${id}/export?format=${format}`, `rekap-${name}.${format}`)
      toast(`Rekap ${format.toUpperCase()} diunduh`, 'success')
    } catch (e) {
      toast(String((e as Error).message || 'Gagal mengunduh'), 'error')
    } finally {
      setExporting('')
    }
  }

  if (report.isLoading) return <div className="space-y-4"><PageHeader title="Laporan Ujian" /><SkeletonRows rows={6} cols={4} /></div>
  if (report.isError) return <div className="space-y-4"><PageHeader title="Laporan Ujian" /><ErrorBox error={report.error} /></div>

  const ST_CARDS: [string, string][] = [
    ['Rata-rata', String(stats.avg ?? '—')],
    ['Median', String(stats.median ?? '—')],
    ['Tertinggi', String(stats.max ?? '—')],
    ['Terendah', String(stats.min ?? '—')],
    ['Kelulusan (KKM)', `${Math.round(Number(stats.pass_rate ?? 0) * 100)}%`],
    ['Durasi rata-rata', fmtDuration(stats.avg_duration_seconds)],
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={String(exam.name ?? 'Laporan Ujian')}
        desc={`${String(exam.subject_name ?? '')}${exam.close_at ? ` · selesai ${fmtDate(exam.close_at)}` : ''}`}
        action={
          <div className="flex flex-wrap gap-1.5 justify-end">
            <button className="btn-ghost text-sm" disabled={exporting !== ''} onClick={() => void exportRekap('xlsx')}>
              {exporting === 'xlsx' ? 'Mengunduh…' : <><IconDownload size={14} /> XLSX</>}
            </button>
            <button className="btn-ghost text-sm" disabled={exporting !== ''} onClick={() => void exportRekap('csv')}>
              {exporting === 'csv' ? 'Mengunduh…' : <><IconDownload size={14} /> CSV</>}
            </button>
            <button className="btn-ghost text-sm" disabled={exporting !== ''} onClick={() => void exportRekap('pdf')}>
              {exporting === 'pdf' ? 'Mengunduh…' : <><IconDownload size={14} /> PDF</>}
            </button>
          </div>
        }
      />

      {/* kartu statistik (FR-9.8) — label uppercase + angka mono */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {ST_CARDS.map(([label, value]) => (
          <div key={label} className="card">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted truncate">{label}</div>
            <div className="mt-1 font-mono font-bold text-xl leading-tight truncate">{value}</div>
          </div>
        ))}
      </div>

      {/* distribusi nilai (histogram sederhana) */}
      {distribution.length > 0 && (
        <div className="card space-y-3">
          <h3 className="font-semibold">Distribusi nilai</h3>
          {(() => {
            const maxCount = Math.max(1, ...distribution.map(b => Number(asDict(b)[1] ?? 0)))
            return distribution.map((b, i) => {
              const bd = asDict(b)
              const range = String(bd[0] ?? bd.range ?? `-${i}`)
              const count = Number(bd[1] ?? bd.count ?? 0)
              return <BarRow key={range + i} label={range} value={count} max={maxCount} />
            })
          })()}
        </div>
      )}

      {/* tabel nilai siswa + filter kelas (FR-3.6, FR-9.10) */}
      <div className="space-y-2">
        <TableToolbar count={rows.length} label="siswa">
          <select className="input sm:!w-auto sm:max-w-44" value={classFilter} onChange={e => setClassFilter(e.target.value)} aria-label="Filter kelas">
            <option value="">Semua kelas</option>
            {classes.map(([cid, label]) => <option key={cid} value={cid}>{label}</option>)}
          </select>
        </TableToolbar>
        {rows.length === 0 ? (
          <EmptyState icon={<IconStudents />} title="Tidak ada peserta pada kelas ini" />
        ) : (
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th>Siswa</th>
                  <th>Kelas</th>
                  <th>Percobaan</th>
                  <th aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Nilai Akhir" active={!!sort} dir={sort ?? 'desc'} onClick={toggleScoreSort} />
                  </th>
                  <th>Durasi</th>
                  <th>Status</th>
                  <th>Track record</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((s, i) => {
                  const st = attemptStatus(s.status)
                  return (
                    <tr key={s.student_id ?? s.attempt_id ?? i}>
                      <td data-th="Siswa" className="font-medium">{String(s.name ?? '—')}</td>
                      <td data-th="Kelas">{String(s.class_name ?? s.class ?? '—')}</td>
                      <td data-th="Percobaan">ke-{String(s.attempt_no ?? 1)}</td>
                      <td data-th="Nilai Akhir" className="font-mono font-bold">{String(s.final_score ?? s.score ?? '—')}</td>
                      <td data-th="Durasi">{fmtDuration(s.duration_seconds ?? s.duration)}</td>
                      <td data-th="Status"><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td data-th="Track">
                        {s.student_id ? (
                          <Link className="text-primary text-xs hover:underline" to={`/students/${s.student_id}`}>
                            profil →
                          </Link>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* analisis butir soal (FR-9.9) */}
      <div className="card space-y-3">
        <h3 className="font-semibold">Analisis butir soal</h3>
        {items.isLoading ? (
          <SkeletonRows rows={3} cols={3} />
        ) : items.isError ? (
          <ErrorBox error={items.error} />
        ) : qRows(items).length === 0 ? (
          <p className="text-sm text-muted">Belum cukup data untuk analisis butir.</p>
        ) : (
          <div className="space-y-2.5">
            {qRows(items).map((it, i) => {
              const row = asDict(it)
              const correctPct = Number(row.correct_pct ?? 0)
              const hard = correctPct < 30 ? 'text-danger' : correctPct < 55 ? 'text-warn' : 'text-success'
              return (
                <div key={row.question_id ?? i} className="space-y-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="truncate mr-2">
                      <b>#{Number(row.order_no ?? i + 1)}</b> · {qtypeLabel(row.type)}
                      {row.points !== undefined && <span className="text-muted"> · {String(row.points)} poin</span>}
                    </span>
                    <span className={`shrink-0 font-bold ${hard}`}>{Math.round(correctPct)}% benar</span>
                  </div>
                  <div className={`h-2 rounded-full bg-border/40 ${hard}`}>
                    <div className="h-full rounded-full bg-current" style={{ width: `${Math.max(2, Math.min(100, Math.round(correctPct)))}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
