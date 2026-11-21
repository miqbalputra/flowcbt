// Laporan per ujian (FR-9.8..9.11): statistik, distribusi, nilai siswa, analisis butir, export
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { downloadFile } from '../files'
import { toast } from '@/components/toast'
import {
  BarRow, EmptyState, ErrorBox, PageHeader, Panel, ProgressBar, SkeletonRows,
  SortHeader, StatCard, TableToolbar, sortRowsBy, type SortDir,
} from '../ui'
import { asDict, asList, attemptStatus, fmtDate, fmtDuration, qtypeLabel, qRows, unwrap, unwrapList } from '../types'
import {
  IconChart, IconChart2, IconCheck, IconClock, IconDownload, IconStudents,
  IconTrendDown, IconTrendUp,
} from '@/components/icons'

/** warna garis badge mengikuti tone teks dari attemptStatus() */
function softLine(cls: string): string {
  if (cls.includes('danger')) return 'border-danger-line'
  if (cls.includes('warn')) return 'border-warn-line'
  if (cls.includes('success')) return 'border-success-line'
  if (cls.includes('primary')) return 'border-primary-line'
  return 'border-border'
}

export default function ReportExam() {
  const { id } = useParams()

  const report = useQuery({ queryKey: ['reports', 'exam', id], queryFn: async () => unwrap(await api(`/reports/exams/${id}`)) })
  const items = useQuery({ queryKey: ['reports', 'exam', id, 'item-analysis'], queryFn: async () => unwrapList(await api(`/reports/exams/${id}/item-analysis`)) })

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

  if (report.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Laporan per Ujian" title="Laporan Ujian" icon={<IconChart2 size={18} />} />
        <Panel title="Statistik Ujian" icon={<IconChart2 size={15} />}>
          <SkeletonRows rows={6} cols={4} />
        </Panel>
      </div>
    )
  }
  if (report.isError) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Laporan per Ujian" title="Laporan Ujian" icon={<IconChart2 size={18} />} />
        <Panel title="Statistik Ujian" icon={<IconChart2 size={15} />}>
          <ErrorBox error={report.error} onRetry={() => void report.refetch()} />
        </Panel>
      </div>
    )
  }

  const participantCount = Number(stats.participants ?? 0)
  const submittedCount = Number(stats.submitted ?? 0)

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Laporan per Ujian"
        title={String(exam.name ?? 'Laporan Ujian')}
        desc={`${String(exam.subject_name ?? '')}${exam.close_at ? ` · selesai ${fmtDate(exam.close_at)}` : ''}`}
        icon={<IconChart2 size={18} />}
        action={
          <>
            <button type="button" className="btn-ghost btn-sm" disabled={exporting !== ''} onClick={() => void exportRekap('xlsx')}>
              {exporting === 'xlsx' ? 'Mengunduh…' : <><IconDownload size={13} /> XLSX</>}
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={exporting !== ''} onClick={() => void exportRekap('csv')}>
              {exporting === 'csv' ? 'Mengunduh…' : <><IconDownload size={13} /> CSV</>}
            </button>
            <button type="button" className="btn-ghost btn-sm" disabled={exporting !== ''} onClick={() => void exportRekap('pdf')}>
              {exporting === 'pdf' ? 'Mengunduh…' : <><IconDownload size={13} /> PDF</>}
            </button>
          </>
        }
      />

      {/* kartu statistik (FR-9.8) — label uppercase + angka mono */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
        <StatCard
          label="Rata-rata"
          value={String(stats.avg ?? '—')}
          hint="nilai akhir peserta"
          tone="primary"
          icon={<IconChart2 size={14} />}
        />
        <StatCard
          label="Median"
          value={String(stats.median ?? '—')}
          hint="titik tengah sebaran"
          icon={<IconChart size={14} />}
        />
        <StatCard
          label="Tertinggi"
          value={String(stats.max ?? '—')}
          hint="nilai maksimum"
          tone="success"
          icon={<IconTrendUp size={14} />}
        />
        <StatCard
          label="Terendah"
          value={String(stats.min ?? '—')}
          hint="nilai minimum"
          tone="warn"
          icon={<IconTrendDown size={14} />}
        />
        <StatCard
          label="Kelulusan (KKM)"
          value={`${Math.round(Number(stats.pass_rate ?? 0) * 100)}%`}
          hint="peserta mencapai KKM"
          tone="primary"
          icon={<IconCheck size={14} />}
        />
        <StatCard
          label="Durasi rata-rata"
          value={fmtDuration(stats.avg_duration_seconds)}
          hint="waktu pengerjaan"
          icon={<IconClock size={14} />}
        />
      </div>

      {/* distribusi nilai (histogram sederhana) */}
      {distribution.length > 0 && (
        <Panel
          title="Distribusi Nilai"
          icon={<IconChart size={15} />}
          action={
            <span className="text-xs text-muted">
              <span className="mono font-semibold text-text">{submittedCount}</span> dari{' '}
              <span className="mono font-semibold text-text">{participantCount}</span> peserta
            </span>
          }
          bodyClassName="space-y-3"
        >
          {(() => {
            const maxCount = Math.max(1, ...distribution.map(b => Number(asDict(b)[1] ?? 0)))
            return distribution.map((b, i) => {
              const bd = asDict(b)
              const range = String(bd[0] ?? bd.bucket ?? bd.range ?? `-${i}`)
              const count = Number(bd[1] ?? bd.count ?? 0)
              return <BarRow key={range + i} label={range} value={count} max={maxCount} />
            })
          })()}
        </Panel>
      )}

      {/* tabel nilai siswa + filter kelas (FR-3.6, FR-9.10) */}
      <Panel title="Nilai Siswa" icon={<IconStudents size={15} />} flush>
        <div className="border-b border-border p-3">
          <TableToolbar count={rows.length} label="siswa">
            <select
              className="input sm:max-w-44"
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
              aria-label="Filter kelas"
            >
              <option value="">Semua kelas</option>
              {classes.map(([cid, label]) => <option key={cid} value={cid}>{label}</option>)}
            </select>
          </TableToolbar>
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={<IconStudents />} title="Tidak ada peserta pada kelas ini" />
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Siswa</th>
                  <th scope="col">Kelas</th>
                  <th scope="col">Percobaan</th>
                  <th scope="col" className="num" aria-sort={sort ? (sort === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <SortHeader label="Nilai Akhir" active={!!sort} dir={sort ?? 'desc'} onClick={toggleScoreSort} />
                  </th>
                  <th scope="col">Durasi</th>
                  <th scope="col">Status</th>
                  <th scope="col">Track record</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((s, i) => {
                  const st = attemptStatus(s.status)
                  return (
                    <tr key={s.student_id ?? s.attempt_id ?? i}>
                      <td data-th="Siswa" className="font-semibold">{String(s.name ?? '—')}</td>
                      <td data-th="Kelas">{String(s.class_name ?? s.class ?? '—')}</td>
                      <td data-th="Percobaan"><span className="mono">ke-{String(s.attempt_no ?? 1)}</span></td>
                      <td data-th="Nilai Akhir" className="num font-bold">{String(s.final_score ?? s.score ?? '—')}</td>
                      <td data-th="Durasi" className="mono whitespace-nowrap">{fmtDuration(s.duration_seconds ?? s.duration)}</td>
                      <td data-th="Status">
                        <span className={`badge border ${softLine(st.cls)} ${st.cls}`}>{st.label}</span>
                      </td>
                      <td data-th="Track record">
                        {s.student_id ? (
                          <Link className="btn-quiet btn-sm !px-0 !text-primary" to={`/students/${s.student_id}`}>
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
      </Panel>

      {/* analisis butir soal (FR-9.9) */}
      <Panel
        title="Analisis Butir Soal"
        icon={<IconChart2 size={15} />}
        action={
          qRows(items).length > 0 ? (
            <span className="badge border border-border bg-canvas text-muted">
              <span className="mono">{qRows(items).length}</span> butir
            </span>
          ) : undefined
        }
      >
        {items.isLoading ? (
          <SkeletonRows rows={3} cols={3} />
        ) : items.isError ? (
          <ErrorBox error={items.error} onRetry={() => void items.refetch()} />
        ) : qRows(items).length === 0 ? (
          <EmptyState icon={<IconChart2 />} title="Belum cukup data untuk analisis butir">
            Analisis muncul setelah ada jawaban siswa yang dinilai.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {qRows(items).map((it, i) => {
              const row = asDict(it)
              const correctPct = Number(row.correct_pct ?? 0)
              const tone = correctPct < 30 ? 'danger' : correctPct < 55 ? 'warn' : 'success'
              const hard = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-success'
              return (
                <div key={row.question_id ?? i} className="rounded-md border border-border bg-surface p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        <span className="mono">#{Number(row.order_no ?? i + 1)}</span> · {qtypeLabel(row.type)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">
                        {row.points !== undefined && (
                          <>
                            <span className="mono">{String(row.points)}</span> poin ·{' '}
                          </>
                        )}
                        <span className="mono">{Number(row.correct_count ?? 0)}</span>
                        {' / '}
                        <span className="mono">{Number(row.answered_count ?? 0)}</span> benar
                      </div>
                    </div>
                    <span className={`mono shrink-0 whitespace-nowrap text-sm font-bold ${hard}`}>{Math.round(correctPct)}% benar</span>
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar
                      value={Math.max(2, Math.min(100, Math.round(correctPct)))}
                      tone={tone}
                      label={`Persentase benar butir ${Number(row.order_no ?? i + 1)}`}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}
