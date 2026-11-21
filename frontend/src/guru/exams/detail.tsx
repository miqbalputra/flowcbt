// Detail ujian (published/pending): edit jadwal, regen token, daftar peserta,
// aksi pengawas (tambah waktu / reset percobaan / force submit), unpublish, link live.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { EmptyState, ErrorBox, PageHeader, SkeletonRows, StatusBadge } from '../ui'
import {  asDict, asList, attemptStatus, copyText, errMessage, fmtDateTime, fmtDuration, unwrap, unwrapList } from '../types'
import { IconKey, IconStudents } from '@/components/icons'

/** ISO → nilai input datetime-local (zona lokal WIB area guru) */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Sched = { open_at: string; close_at: string; duration_minutes: number }
const EMPTY_SCHED: Sched = { open_at: '', close_at: '', duration_minutes: 60 }

export default function ExamDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [extend, setExtend] = useState<Record<string, any> | null>(null)
  const [extendMinutes, setExtendMinutes] = useState(5)
  const [resetting, setResetting] = useState<Record<string, any> | null>(null)
  const [forcing, setForcing] = useState<Record<string, any> | null>(null)
  const [unpublishing, setUnpublishing] = useState(false)
  const [sched, setSched] = useState<Sched>(EMPTY_SCHED)

  const exam = useQuery({ queryKey: ['exam', id], queryFn: async () => unwrap(await api(`/exams/${id}`)) })
  const attempts = useQuery({ queryKey: ['exams', id, 'attempts'], queryFn: () => unwrapList(api(`/exams/${id}/attempts`)) })

  const e = exam.data ? asDict(exam.data) : {}
  const isPublished = String(e.status ?? '') === 'published'
  const rows = attempts.isLoading ? [] : attempts.isError ? [] : asList(attempts.data).filter(r => asDict(r).id)

  // isi form jadwal dari server sekali, tanpa menimpa editan berjalan
  useEffect(() => {
    if (!exam.data) return
    const d = asDict(exam.data)
    setSched({
      open_at: toLocalInput(String(d.open_at ?? '')),
      close_at: toLocalInput(String(d.close_at ?? '')),
      duration_minutes: Number(d.duration_minutes ?? 60),
    })
  }, [exam.data])

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['exam', id] })
    void qc.invalidateQueries({ queryKey: ['exams'] })
    void qc.invalidateQueries({ queryKey: ['exams', id, 'attempts'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function saveSchedule() {
    if (!sched.open_at || !sched.close_at) { toast('Isi jadwal buka & tutup dulu', 'error'); return }
    if (new Date(sched.close_at) <= new Date(sched.open_at)) { toast('Tutup harus setelah dibuka', 'error'); return }
    setBusy(true)
    try {
      await send(`/exams/${id}`, ({
          open_at: new Date(sched.open_at).toISOString(),
          close_at: new Date(sched.close_at).toISOString(),
          duration_minutes: sched.duration_minutes || undefined,
        }), 'PUT')
      toast('Jadwal ujian diperbarui ⏰', 'success')
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function regenToken() {
    setBusy(true)
    try {
      const res = unwrap(await api(`/exams/${id}/token/regenerate`, { method: 'POST' }))
      const token = String(asDict(res).token ?? '')
      await copyText(token, 'Token baru disalin')
      toast(`Token baru: ${token}`, 'success')
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function extendTime() {
    if (!extend) return
    if (!(extendMinutes > 0)) { toast('Isi durasi tambahan (menit)', 'error'); return }
    setBusy(true)
    try {
      await send(`/exams/${id}/participants/${extend.student_id}/extend-time`, { seconds: extendMinutes * 60 }, 'PUT')
      toast(`+${extendMinutes} menit untuk ${String(extend.student_name ?? 'siswa')} ⏱`, 'success')
      setExtend(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function resetAttempt() {
    if (!resetting) return
    setBusy(true)
    try {
      await api(`/exams/${id}/participants/${resetting.student_id}/reset-attempt`, { method: 'PUT' })
      toast(`Percobaan ${String(resetting.student_name ?? '')} direset`, 'success')
      setResetting(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function forceSubmit() {
    if (!forcing) return
    setBusy(true)
    try {
      await api(`/exams/${id}/participants/${forcing.student_id}/force-submit`, { method: 'PUT' })
      toast(`${String(forcing.student_name ?? '')} dipaksa selesai`, 'success')
      setForcing(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function unpublish() {
    setBusy(true)
    try {
      await api(`/exams/${id}/unpublish`, { method: 'POST' })
      toast('Ujian kembali ke draft', 'success')
      setUnpublishing(false)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (exam.isLoading) return <div className="space-y-4"><PageHeader title="Detail Ujian" /><SkeletonRows rows={5} cols={5} /></div>
  if (exam.isError) return <div className="space-y-4"><PageHeader title="Detail Ujian" /><ErrorBox error={exam.error} /></div>

  return (
    <div className="space-y-4">
      <PageHeader
        title={String(e.name ?? 'Detail Ujian')}
        desc={String(e.subject_name ?? '')}
        action={
          <div className="flex gap-2 flex-wrap">
            <Link to={`/reports/live/${id}`} className="btn-ghost text-sm">Live</Link>
            <Link to={`/exams/${id}/grading`} className="btn-ghost text-sm">Koreksi Uraian</Link>
            {isPublished && (
              <Link to={`/exams/${id}/cheating`} className="btn-ghost text-sm">Kecurangan</Link>
            )}
            {isPublished && (
              <button type="button" className="btn-danger text-sm" disabled={busy} onClick={() => setUnpublishing(true)}>Unpublish</button>
            )}
          </div>
        }
      />

      {/* kartu status & token */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={e.status} />
          {typeof e.exam_code === 'string' && e.exam_code && <span>Kode ujian: <b className="font-mono">{e.exam_code}</b></span>}
          {e.open_at && <span className="text-muted">Buka {fmtDateTime(e.open_at)}</span>}
          {e.close_at && <span className="text-muted">— tutup {fmtDateTime(e.close_at)}</span>}
          {typeof e.token === 'string' && e.token && (
            <button type="button" className="btn-ghost btn-sm font-mono"
              onClick={() => void copyText(e.token, 'Token disalin')} title="Salin token">
              <IconKey size={12} /> {e.token}
            </button>
          )}
        </div>
        {isPublished && (
          <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => void regenToken()}>
            Generate ulang token
          </button>
        )}
      </div>

      {/* edit jadwal */}
      <div className="card space-y-3">
        <h3 className="font-semibold text-sm">Edit jadwal</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="ed-open">Buka (WIB)</label>
            <input id="ed-open" type="datetime-local" className="input" value={sched.open_at}
              onChange={ev => setSched(s => ({ ...s, open_at: ev.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="ed-close">Tutup (WIB)</label>
            <input id="ed-close" type="datetime-local" className="input" value={sched.close_at}
              onChange={ev => setSched(s => ({ ...s, close_at: ev.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="ed-dur">Durasi (menit)</label>
            <input id="ed-dur" type="number" min={1} className="input" value={sched.duration_minutes}
              onChange={ev => setSched(s => ({ ...s, duration_minutes: Number(ev.target.value) || 0 }))} />
          </div>
        </div>
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={() => void saveSchedule()}>
          Simpan jadwal
        </button>
      </div>

      {/* daftar peserta */}
      <div>
        <h3 className="font-semibold mb-2">Peserta ({rows.length})</h3>
        {attempts.isLoading ? (
          <SkeletonRows rows={4} cols={5} />
        ) : attempts.isError ? (
          <ErrorBox error={attempts.error} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconStudents />} title="Belum ada yang mengerjakan" />
        ) : (
          <div className="overflow-x-auto lg:overflow-visible">
          <table className="table-base responsive-table">
            <thead>
              <tr><th>Siswa</th><th>Kelas</th><th>Percobaan</th><th>Status</th><th>Progres</th><th>Nilai</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = attemptStatus(r.status)
                const answered = Number(r.progress_answered ?? 0)
                const total = Number(r.progress_total ?? 0)
                return (
                  <tr key={r.id ?? i}>
                    <td data-th="Siswa" className="font-medium">{String(r.student_name ?? '—')}</td>
                    <td data-th="Kelas">{String(r.student_class ?? '—')}</td>
                    <td data-th="Percobaan">ke-{String(r.attempt_no ?? 1)}</td>
                    <td data-th="Status">
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      {Boolean(r.cheating_status) && String(r.cheating_status) !== 'clean' && (
                        <div className="mt-1"><span className="badge bg-danger-soft text-danger">Dilaporkan curang</span></div>
                      )}
                    </td>
                    <td data-th="Progres">
                      {total > 0 ? `${answered}/${total}` : '—'}
                      <div className="h-1.5 rounded-full bg-border/40 mt-1 max-w-20">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${total ? Math.round((answered / total) * 100) : 0}%` }} />
                      </div>
                    </td>
                    <td data-th="Nilai" className="font-mono">{r.score !== undefined && r.score !== null ? String(r.score) : r.final_score !== undefined ? String(r.final_score) : '—'}</td>
                    <td data-th="Aksi">
                      <div className="flex gap-1.5 flex-wrap">
                        <button type="button" className="btn-ghost btn-sm"
                          onClick={() => { setExtendMinutes(5); setExtend(r) }}>+ Waktu</button>
                        <button type="button" className="btn-ghost btn-sm"
                          onClick={() => setResetting(r)}>Reset</button>
                        <button type="button" className="btn-danger btn-sm"
                          onClick={() => setForcing(r)}>Paksa selesai</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* modal tambah waktu */}
      <Modal
        open={!!extend}
        onClose={() => setExtend(null)}
        title={`Tambah waktu — ${String(extend?.student_name ?? '')}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setExtend(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void extendTime()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Tambah waktu'}
            </button>
          </>
        }
      >
        <div>
          <label className="label" htmlFor="ext-min">Tambahan waktu (menit)</label>
          <input id="ext-min" type="number" min={1} step={1} className="input" value={extendMinutes}
            onChange={ev => setExtendMinutes(Number(ev.target.value) || 0)} />
          <p className="text-xs text-muted mt-1">= {extendMinutes * 60} detik</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!resetting} title="Reset percobaan?" busy={busy}
        message={`Hapus percobaan ${resetting?.student_name ?? ''} sehingga bisa mengerjakan ulang dari awal?`}
        onConfirm={resetAttempt} onClose={() => setResetting(null)}
      />
      <ConfirmDialog
        open={!!forcing} title="Paksa selesai?" danger busy={busy} confirmLabel="Ya, paksa selesai"
        message={`Jawaban ${forcing?.student_name ?? ''} akan dikumpulkan apa adanya sekarang.`}
        onConfirm={forceSubmit} onClose={() => setForcing(null)}
      />
      <ConfirmDialog
        open={unpublishing} title="Unpublish ujian?" danger busy={busy} confirmLabel="Ya, unpublish"
        message="Ujian disembunyikan dari siswa & kembali jadi draft. Ungpublish dibolehkan selama belum ada pengerjaan."
        onConfirm={unpublish} onClose={() => setUnpublishing(false)}
      />
    </div>
  )
}
