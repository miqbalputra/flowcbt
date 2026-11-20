// Koreksi uraian (FR-8.3/8.4): daftar attempt yang menunggu penilaian manual,
// detail per siswa, beri skor + catatan (audit log); re-grade.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { PageHeader, ErrorBox, EmptyState } from '../ui'
import { renderSimpleHtml } from '@/lib/sanitize'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { asList, asDict, errMessage, fmtDateTime } from '../types'

export default function GradingPage() {
  const { id = '' } = useParams() // exam id
  const qc = useQueryClient()
  const [exam, setExam] = useState<Record<string, unknown> | null>(null)
  const [attempts, setAttempts] = useState<Record<string, unknown>[]>([])
  const [err, setErr] = useState<Error | null>(null)
  const [open, setOpen] = useState<Record<string, unknown> | null>(null)
  const [scores, setScores] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const e = await send(`/exams/${id}`)
      setExam((e as { data?: Record<string, unknown> }).data ?? asDict(e))
      const r = await api(`/exams/${id}/attempts`)
      const rows = asList((r as { data?: unknown }).data)
      setAttempts(rows)
      setErr(null)
    } catch (e2) {
      setErr(new Error(errMessage(e2)))
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
      toast('Nilai tersimpan & attempt dinilai ulang ✔', 'success')
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

  return (
    <div className="space-y-4">
      <PageHeader title="Koreksi Uraian" desc={String(exam?.name ?? 'Ujian')} />
      {err && <ErrorBox error={err} onRetry={() => void load()} />}
      {needs.length === 0 ? (
        <EmptyState icon="✅" title="Tidak ada uraian menunggu penilaian">
          Semua nilai sudah final untuk ujian ini.
        </EmptyState>
      ) : (
        <table className="table-base responsive-table">
          <thead>
            <tr><th>Siswa</th><th>Kelas</th><th>Status</th><th>Nilai Sementara</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {needs.map(a => (
              <tr key={String(a.id)}>
                <td data-th="Siswa">{String(a.student_name ?? '-')}</td>
                <td data-th="Kelas">{String(a.student_class || '-')}</td>
                <td data-th="Status">{String(a.status)}</td>
                <td data-th="Nilai sementara">{String(a.final_score ?? a.score ?? '—')}</td>
                <td data-th="Aksi">
                  <button className="btn-primary btn-sm" onClick={() => void openGrading(a)}>Nilaii</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={`Nilai uraian — ${String(asDict(open?.attempt)?.student_name ?? '')}`}>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto">
          {asList(open?.questions).filter((q: Record<string, unknown>) => q.type === 'essay').map((q: Record<string, unknown>) => (
            <div key={String(q.question_id)} className="rounded-lg border border-border p-3 space-y-2">
              <div className="text-xs text-muted">Soal #{String(q.order_no)} · maks {String(q.max_points)} poin</div>
              <div className="whitespace-pre-wrap text-sm" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(q.body ?? '')) }} />
              <div className="rounded bg-bg p-2 text-sm whitespace-pre-wrap">
                {q.student_answer ? studentText(q.student_answer) : 'tidak dijawab'}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={Number(q.max_points)} className="input !w-28"
                  value={scores[String(q.question_id)] ?? 0}
                  onChange={e => setScores(p => ({ ...p, [String(q.question_id)]: Number(e.target.value) }))}
                />
                <span className="text-sm text-muted">/ {String(q.max_points)} poin</span>
              </div>
            </div>
          ))}
          <input className="input" placeholder="Catatan/alasan (opsional, masuk audit log)"
            value={reason} onChange={e => setReason(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy} onClick={() => void saveScores()}>
            {busy ? 'Menyimpan…' : 'Simpan nilai & skor ulang'}
          </button>
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
