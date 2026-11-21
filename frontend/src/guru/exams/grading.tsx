// Koreksi uraian (FR-8.3/8.4): daftar attempt yang menunggu penilaian manual,
// detail per siswa, beri skor + catatan (audit log); re-grade.
// Tampilan Design System v3: KPI ringkas + tabel attempt + form skor per soal.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from '../rpc'
import {
  Callout,
  EmptyState,
  ErrorBox,
  PageHeader,
  Panel,
  SearchBox,
  SkeletonRows,
  StatCard,
  TableToolbar,
} from '../ui'
import { renderSimpleHtml } from '@/lib/sanitize'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { asList, asDict, attemptStatus, errMessage, fmtDateTime } from '../types'
import { IconCheck, IconEdit, IconExam, IconInfo } from '@/components/icons'

/** badge status attempt — border *-line + bg *-soft */
const ATTEMPT_TONE: Record<string, string> = {
  in_progress: '!border-primary-line bg-primary-soft text-primary',
  working: '!border-primary-line bg-primary-soft text-primary',
  submitted: '!border-success-line bg-success-soft text-success',
  done: '!border-success-line bg-success-soft text-success',
  graded: '!border-success-line bg-success-soft text-success',
  expired: '!border-warn-line bg-warn-soft text-warn',
  forced_submit: '!border-warn-line bg-warn-soft text-warn',
  needs_grading: '!border-warn-line bg-warn-soft text-warn',
  disqualified: '!border-danger-line bg-danger-soft text-danger',
}
const attemptTone = (s: unknown) => ATTEMPT_TONE[String(s ?? '')] ?? '!border-border bg-canvas text-muted'

export default function GradingPage() {
  const { id = '' } = useParams() // exam id
  const qc = useQueryClient()
  const [exam, setExam] = useState<Record<string, unknown> | null>(null)
  const [attempts, setAttempts] = useState<Record<string, unknown>[]>([])
  const [err, setErr] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, unknown> | null>(null)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    try {
      const e = await send(`/exams/${id}`)
      setExam((e as { data?: Record<string, unknown> }).data ?? asDict(e))
      const r = await api(`/exams/${id}/attempts`)
      const rows = asList((r as { data?: unknown }).data)
      setAttempts(rows)
      setErr(null)
    } catch (e2) {
      setErr(new Error(errMessage(e2)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const needs = attempts.filter(a =>
    a?.status === 'submitted' || a?.final_score_pending === true)

  async function openGrading(a: Record<string, unknown>) {
    try {
      const v = await api(`/attempts/${String(a.id)}/grading`)
      const data = asDict((v as { data?: unknown }).data)
      setOpen(data)
      const sc: Record<string, number> = {}
      for (const q of asList(data.questions)) {
        if (q.type === 'essay') sc[String(q.question_id)] = Number(q.score ?? 0)
      }
      setScores(sc)
      setErr(null)
    } catch (e2) {
      toast(errMessage(e2), 'error')
    }
  }

  async function saveScores() {
    if (!open) return
    setBusy(true)
    try {
      const att = asDict(open.attempt)
      for (const q of asList(open.questions)) {
        if (q.type !== 'essay') continue
        const val = Number(scores[String(q.question_id)] ?? 0)
        if (val === Number(q.score ?? 0)) continue
        await send(`/attempts/${String(att.id)}/answers/${q.question_id}/score`,
          { score: val, reason: reason || 'koreksi uraian' }, 'PUT')
      }
      await send(`/exams/${id}/regrade`, {})
      toast('Nilai tersimpan & attempt dinilai ulang', 'success')
      setOpen(null)
      setReason('')
      void qc.invalidateQueries({ queryKey: ['exams', id, 'attempts'] })
      const r = await api(`/exams/${id}/attempts`)
      setAttempts(asList((r as { data?: unknown }).data))
    } catch (e2) {
      toast(errMessage(e2), 'error')
    } finally {
      setBusy(false)
    }
  }

  const keyword = search.trim().toLowerCase()
  const shown = keyword
    ? needs.filter(a => [a.student_name, a.student_class].some(v => String(v ?? '').toLowerCase().includes(keyword)))
    : needs

  const submitted = attempts.filter(a => a?.status === 'submitted').length
  const essayQs = asList(open?.questions).filter(q => q.type === 'essay')

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Ujian · Penilaian"
        title="Koreksi Uraian"
        desc={String(exam?.name ?? 'Ujian')}
        icon={<IconEdit size={18} />}
        action={
          <Link to={`/exams/${id}`} className="btn-ghost btn-sm !min-h-11">
            <IconExam size={14} /> Info ujian
          </Link>
        }
      />

      {!err && (
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">
          <StatCard
            label="Perlu dinilai"
            value={String(needs.length)}
            hint="attempt menunggu skor uraian"
            tone={needs.length > 0 ? 'warn' : 'success'}
            icon={<IconEdit size={14} />}
          />
          <StatCard
            label="Total attempt"
            value={String(attempts.length)}
            hint="tercatat pada ujian ini"
            icon={<IconExam size={14} />}
          />
          <StatCard
            label="Terkirim"
            value={String(submitted)}
            hint="status submitted"
            tone="primary"
            icon={<IconCheck size={14} />}
          />
        </div>
      )}

      <Callout tone="info" title="Penilaian manual tercatat" icon={<IconInfo size={16} />}>
        Skor dan catatan disimpan per soal di audit log; menyimpan akan menjalankan regrade otomatis.
      </Callout>

      {err ? (
        <Panel><ErrorBox error={err} onRetry={() => void load()} /></Panel>
      ) : (
        <Panel
          title="Attempt Menunggu Penilaian"
          icon={<IconEdit size={15} />}
          action={<span className="chip mono">{needs.length}</span>}
          flush
        >
          <div className="border-b border-border p-3">
            <TableToolbar count={shown.length} label="attempt">
              <SearchBox
                className="w-full sm:w-64"
                label="Cari peserta yang perlu dinilai"
                placeholder="Cari nama / kelas…"
                value={search}
                onChange={setSearch}
              />
            </TableToolbar>
          </div>

          {loading ? (
            <div className="p-3"><SkeletonRows rows={4} cols={4} /></div>
          ) : needs.length === 0 ? (
            <EmptyState icon={<IconCheck size={18} className="text-success" />} title="Tidak ada uraian menunggu penilaian">
              Semua nilai sudah final untuk ujian ini.
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState icon={<IconEdit size={18} />} title="Tidak ada attempt yang cocok">
              Ubah kata kunci pencarian nama atau kelas.
            </EmptyState>
          ) : (
            <div className="table-scroll">
              <table className="table-base responsive-table">
                <thead>
                  <tr>
                    <th scope="col">Siswa</th>
                    <th scope="col">Kelas</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">Nilai Sementara</th>
                    <th scope="col" className="num">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(a => (
                    <tr key={String(a.id)}>
                      <td data-th="Siswa" className="font-medium">
                        <span className="block max-w-[16rem] truncate">{String(a.student_name ?? '-')}</span>
                      </td>
                      <td data-th="Kelas">{String(a.student_class || '-')}</td>
                      <td data-th="Status">
                        <span className={`badge ${attemptTone(a.status)}`}>{attemptStatus(a.status).label}</span>
                      </td>
                      <td data-th="Nilai sementara" className="num mono">
                        {String(a.final_score ?? a.score ?? '—')}
                      </td>
                      <td data-th="Aksi">
                        <div className="flex justify-end">
                          <button type="button" className="btn-ghost btn-sm" onClick={() => void openGrading(a)}>
                            <IconEdit size={13} /> Nilai
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={`Nilai uraian — ${String(asDict(open?.attempt)?.student_name ?? '')}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setOpen(null)} disabled={busy}>
              Batal
            </button>
            <button type="button" className="btn-primary" onClick={() => void saveScores()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Simpan nilai & skor ulang'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {essayQs.length === 0 ? (
            <EmptyState icon={<IconEdit size={18} />} title="Tidak ada soal uraian" />
          ) : (
            essayQs.map(q => {
              const qid = String(q.question_id)
              const maxPoints = Number(q.max_points ?? 0)
              return (
                <div key={qid} className="rounded-md border border-border">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-canvas px-3 py-2">
                    <span className="section-label">Soal #{String(q.order_no)}</span>
                    <span className="mono text-xs text-muted">maks {maxPoints} poin</span>
                  </div>
                  <div className="space-y-2.5 p-3">
                    <div
                      className="break-words text-sm"
                      dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(q.body ?? '')) }}
                    />
                    <div>
                      <div className="section-label mb-1">Jawaban siswa</div>
                      <div className="whitespace-pre-wrap break-words rounded border border-border bg-canvas p-2 text-sm">
                        {q.student_answer ? studentText(q.student_answer) : 'tidak dijawab'}
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor={`score-${qid}`}>Skor</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id={`score-${qid}`}
                          type="number"
                          min={0}
                          max={maxPoints}
                          className="input !w-28"
                          value={scores[qid] ?? 0}
                          onChange={e => setScores(p => ({ ...p, [qid]: Number(e.target.value) }))}
                        />
                        <span className="mono text-xs text-muted">/ {maxPoints} poin</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
          <div>
            <label className="label" htmlFor="grade-reason">Catatan / alasan</label>
            <input
              id="grade-reason"
              className="input"
              placeholder="Catatan/alasan (opsional, masuk audit log)"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
            <p className="hint mt-1">Catatan disimpan bersama perubahan skor di audit log.</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function studentText(ans: unknown): string {
  if (ans == null) return ''
  if (typeof ans === 'string') return ans
  try { return JSON.stringify(ans, null, 1) } catch { return String(ans) }
}

// fmtDateTime dipakai bila butuh menampilkan pengiriman
export function GradingSubtitle({ submittedAt }: { submittedAt?: unknown }) {
  return <div className="text-xs text-muted">{fmtDateTime(submittedAt)}</div>
}
