// Track record siswa (FR-3.7): identitas, ringkasan nilai, tren (bar sederhana), riwayat attempt.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { downloadFile } from '../files'
import { toast } from '@/components/toast'
import { EmptyState, ErrorBox, PageHeader, Panel, SkeletonRows, StatCard } from '../ui'
import { asDict, asList, attemptStatus, fmtDate, fmtDuration, unwrap } from '../types'
import { IconChart2, IconClock, IconDownload, IconExam, IconStudents, IconTrendUp } from '@/components/icons'

/** label sumbu grafik: 12/01 */
function shortDate(v: unknown): string {
  const d = new Date(String(v ?? ''))
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' })
}

/** badge attempt dengan border *-line sesuai tone (tanpa mengubah statusBadge bersama) */
function attemptBadge(status: unknown): { label: string; cls: string } {
  const st = attemptStatus(status)
  const line = st.cls.includes('success')
    ? 'border-success-line'
    : st.cls.includes('danger')
      ? 'border-danger-line'
      : st.cls.includes('warn')
        ? 'border-warn-line'
        : st.cls.includes('primary')
          ? 'border-primary-line'
          : 'border-border'
  return { label: st.label, cls: `${st.cls} ${line}` }
}

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
  const best = withScore.length ? Math.max(...withScore.map(x => x.s)) : null
  const latest = withScore[0] ?? null

  const chart = withScore.slice(0, 12).reverse()

  const identityFields = ([
    ['Nama', student.full_name ?? student.name],
    ['NIS', student.nis ?? student.student_code],
    ['Kelas', student.class_name ?? student.class],
    ['Jenis kelamin', student.gender ? (String(student.gender).toUpperCase() === 'P' ? 'Perempuan' : 'Laki-laki') : undefined],
    ['Username', student.username],
    ['Terdaftar', student.created_at],
  ] as [string, unknown][]).filter(([, v]) => v !== undefined && v !== null && v !== '')

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Track Record"
        title={String(student.full_name ?? student.name ?? 'Profil Siswa')}
        desc="Ringkasan nilai dan track record seluruh ujian yang pernah diikuti."
        icon={<IconStudents size={18} />}
        action={
          <>
            <button type="button" className="btn-ghost btn-sm" disabled={exporting} onClick={() => void exportPDF()}>
              {exporting ? 'Mengunduh…' : <><IconDownload size={14} /> PDF</>}
            </button>
            <Link to="/students" className="btn-quiet btn-sm">Kembali ke daftar</Link>
          </>
        }
      />

      {detail.isLoading || track.isLoading ? (
        <SkeletonRows rows={4} cols={4} />
      ) : detail.isError || track.isError ? (
        <ErrorBox
          error={(detail.error ?? track.error) as unknown}
          onRetry={() => { void detail.refetch(); void track.refetch() }}
        />
      ) : (
        <>
          {/* ringkasan nilai */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <StatCard
              label="Ujian diikuti"
              value={String(attempts.length)}
              hint={withScore.length ? `${withScore.length} sudah bernilai` : 'belum ada nilai'}
              icon={<IconExam size={14} />}
            />
            <StatCard
              label="Rata-rata nilai"
              value={String(avg ?? '—')}
              hint="seluruh attempt"
              tone="success"
              icon={<IconChart2 size={14} />}
            />
            <StatCard
              label="Nilai tertinggi"
              value={String(best ?? '—')}
              hint={withScore.length ? `dari ${withScore.length} nilai` : 'skor terbaik'}
              tone="primary"
              icon={<IconTrendUp size={14} />}
            />
            <StatCard
              label="Nilai terakhir"
              value={String(latest?.s ?? '—')}
              hint={latest ? fmtDate(latest.a.date ?? latest.a.start_at ?? latest.a.created_at) : 'belum ada ujian'}
              icon={<IconClock size={14} />}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* identitas */}
            <Panel title="Identitas siswa" icon={<IconStudents size={15} />}>
              {identityFields.length === 0 ? (
                <p className="text-sm text-muted">Data identitas belum tersedia.</p>
              ) : (
                <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
                  {identityFields.map(([k, v]) => {
                    const isCode = k === 'NIS' || k === 'Username'
                    const text = typeof v === 'string' && /^\d{4}-/.test(v) ? fmtDate(v) : String(v)
                    return (
                      <div key={k} className="min-w-0">
                        <dt className="section-label">{k}</dt>
                        <dd className={`mt-0.5 truncate text-[13px] font-semibold ${isCode ? 'mono' : ''}`} title={text}>
                          {text}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              )}
            </Panel>

            {/* tren nilai (bar sederhana, tanpa library) */}
            <Panel
              title="Tren nilai"
              icon={<IconTrendUp size={15} />}
              action={
                <span className="text-xs text-muted">
                  Rata-rata <span className="mono font-bold text-text">{avg ?? '—'}</span>
                </span>
              }
            >
              {withScore.length === 0 ? (
                <EmptyState icon={<IconTrendUp size={20} />} title="Belum ada nilai">
                  Grafik tren muncul setelah siswa menyelesaikan ujian.
                </EmptyState>
              ) : (
                <>
                  <div className="rounded-md border border-border bg-canvas p-3">
                    <div
                      className="flex h-32 items-end gap-1.5 sm:h-40 sm:gap-2"
                      role="img"
                      aria-label={`Tren nilai ${chart.length} ujian terakhir: ${chart.map(x => x.s).join(', ')}`}
                    >
                      {chart.map(({ a, s }, i) => {
                        const h = Math.max(4, Math.round((s / maxScore) * 100))
                        const label = String(a.subject_name ?? a.exam_name ?? 'Ujian')
                        return (
                          <div
                            key={a.attempt_id ?? a.id ?? i}
                            className="flex h-full min-w-0 flex-1 flex-col justify-end"
                            title={`${label} — nilai ${s}`}
                          >
                            <span className="mono mb-1 hidden text-center text-[10px] leading-none text-muted sm:block">{s}</span>
                            <div
                              className="w-full rounded-t-sm border border-primary-line bg-primary"
                              style={{ height: `${h}%`, maxHeight: 'calc(100% - 16px)' }}
                            />
                          </div>
                        )
                      })}
                    </div>
                    <div className="mt-1.5 hidden gap-1.5 sm:flex sm:gap-2">
                      {chart.map(({ a }, i) => (
                        <span
                          key={a.attempt_id ?? a.id ?? i}
                          className="mono min-w-0 flex-1 truncate text-center text-[9px] text-muted"
                        >
                          {shortDate(a.date ?? a.start_at ?? a.created_at)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="hint mt-2">
                    Urutan kronologis, maksimal 12 ujian terakhir. Skala 0–<span className="mono">{maxScore}</span>.
                  </p>
                </>
              )}
            </Panel>
          </div>

          {/* riwayat attempt */}
          <Panel
            title="Riwayat ujian"
            icon={<IconExam size={15} />}
            flush
            action={
              <span className="badge border border-border bg-canvas text-muted">
                <span className="mono font-bold">{attempts.length}</span> attempt
              </span>
            }
          >
            {attempts.length === 0 ? (
              <EmptyState icon={<IconExam size={20} />} title="Belum pernah ikut ujian">
                Riwayat attempt akan muncul di sini setelah siswa mengerjakan ujian.
              </EmptyState>
            ) : (
              <div className="table-scroll">
                <table className="table-base responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Mapel</th>
                      <th scope="col">Tanggal</th>
                      <th scope="col">Percobaan</th>
                      <th scope="col" className="num">Nilai</th>
                      <th scope="col">Durasi</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a, i) => {
                      const st = attemptBadge(a.status ?? a.state)
                      return (
                        <tr key={a.attempt_id ?? a.id ?? i}>
                          <td data-th="Mapel" className="font-semibold">
                            {String(a.subject_name ?? a.exam_name ?? a.exam_subject ?? '—')}
                          </td>
                          <td data-th="Tanggal" className="whitespace-nowrap">{fmtDate(a.date ?? a.start_at ?? a.created_at)}</td>
                          <td data-th="Percobaan" className="whitespace-nowrap">
                            ke-<span className="mono">{String(a.attempt_no ?? 1)}</span>
                          </td>
                          <td data-th="Nilai" className="num">
                            <span className="mono font-bold">{String(a.score ?? a.final_score ?? '—')}</span>
                          </td>
                          <td data-th="Durasi" className="whitespace-nowrap">
                            <span className="mono text-xs text-muted">{fmtDuration(a.duration_seconds ?? a.duration)}</span>
                          </td>
                          <td data-th="Status">
                            <span className={`badge border ${st.cls}`}>{st.label}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
