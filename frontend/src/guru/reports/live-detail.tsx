// Pantauan live per ujian (FR-9.2..9.5) — polling 10 detik via TanStack Query refetchInterval.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { useLiveStream } from '@/lib/useLiveStream'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import { Donut, ErrorBox, PageHeader, SkeletonRows } from '../ui'
import { asDict, asList, attemptStatus, copyText, errMessage, fmtDateTime, unwrap } from '../types'
import { IconChart2, IconLeft, IconWifi, IconWifiOff } from '@/components/icons'

export default function ReportLiveExam() {
  const { examId } = useParams()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [classId, setClassId] = useState('')
  const [extending, setExtending] = useState<Record<string, any> | null>(null)
  const [extraMinutes, setExtraMinutes] = useState(5)
  const [resetting, setResetting] = useState<Record<string, any> | null>(null)
  const [forcing, setForcing] = useState<Record<string, any> | null>(null)

  // Real-time via SSE (FR-9.3): snapshot → perbarui cache; filter ikut stream.
  const liveStatus = useLiveStream(
    '/reports/live/stream',
    { exam_id: examId ?? '', class_id: classId, q: search },
    data => { qc.setQueryData(['reports', 'live', examId], data) },
    !!examId,
  )

  const live = useQuery({
    queryKey: ['reports', 'live', examId],
    queryFn: async () => unwrap(await api(`/reports/live/${examId}`)),
    // polling jeda saat SSE hidup (FR-9.3 — hindari muat ganda)
    refetchInterval: liveStatus === 'live' ? false : 10_000,
  })

  const d = live.data ? asDict(live.data) : {}
  const exam = asDict(d.exam ?? {})
  const summary = asDict(d.summary ?? {})
  const allStudents = asList(d.students ?? [])

  const classOptions = (() => {
    const seen = new Map<string, string>()
    for (const s of allStudents) {
      const cid = String(s.class_id ?? '')
      if (cid && !seen.has(cid)) seen.set(cid, String(s.class ?? cid))
    }
    return [...seen.entries()]
  })()

  const students = allStudents.filter(s =>
    (!classId || String(s.class_id ?? '') === classId) &&
    (!search || String(s.name ?? '').toLowerCase().includes(search.toLowerCase())))

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['reports', 'live', examId] })
    void qc.invalidateQueries({ queryKey: ['exams'] })
    void qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  async function extendTime() {
    if (!extending) return
    if (!(extraMinutes > 0)) { toast('Isi durasi tambahan (menit)', 'error'); return }
    setBusy(true)
    try {
      await send(`/exams/${exam.id}/participants/${extending.student_id}/extend-time`, { seconds: extraMinutes * 60 }, 'PUT')
      toast(`+${extraMinutes} menit untuk ${String(extending.name ?? 'siswa')} ⏱`, 'success')
      setExtending(null)
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
      await api(`/exams/${exam.id}/participants/${resetting.student_id}/reset-attempt`, { method: 'PUT' })
      toast(`Percobaan ${String(resetting.name ?? '')} direset — siswa bisa mengerjakan ulang`, 'success')
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
      await api(`/exams/${exam.id}/participants/${forcing.student_id}/force-submit`, { method: 'PUT' })
      toast(`${String(forcing.name ?? '')} dipaksa selesai`, 'success')
      setForcing(null)
      refresh()
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const working = Number(summary.working ?? 0)
  const done = Number(summary.done ?? 0)
  const notStarted = Number(summary.not_started ?? 0)
  const total = Number(summary.total ?? 0)

  if (live.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="Pantauan Live" icon={<IconChart2 size={18} />} action={<Link className="btn-ghost text-sm" to="/reports/live"><IconLeft size={14} /> Semua live</Link>} />
        <ErrorBox error={live.error} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={String(exam.name ?? 'Pantauan Live')}
        desc={String(exam.subject_name ?? '')}
        action={<Link className="btn-ghost text-sm" to="/reports/live"><IconLeft size={14} /> Semua live</Link>} icon={<IconChart2 size={18} />}
      />

      {/* ringkasan: donut div (FR-9.2) */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Progres peserta</h3>
          <span className={`text-xs font-medium px-2 py-1 rounded-full ${liveStatus === 'live' ? 'bg-success-soft text-success' : live.isFetching ? 'bg-primary-soft text-primary' : 'badge-soft text-muted'}`}>
            {liveStatus === 'live' ? '● Real-time' : live.isFetching ? '⏳ menyegarkan…' : '● polling 10 dtk'}
          </span>
        </div>
        {live.isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-32 w-36" />
            <div className="skeleton h-4 w-48" />
          </div>
        ) : (
          <>
            <Donut
              parts={[
                { value: working, color: 'var(--c-primary)', label: 'Mengerjakan' },
                { value: done, color: 'var(--c-success)', label: 'Selesai' },
                { value: notStarted, color: 'var(--c-border)', label: 'Belum mulai' },
              ]}
            />
            <p className="text-sm text-muted">Total peserta: {total || working + done + notStarted}</p>
          </>
        )}
      </div>

      {/* filter & pencarian */}
      <div className="flex gap-2 flex-wrap items-center">
        <select className="input max-w-44" value={classId} onChange={e => setClassId(e.target.value)} aria-label="Filter kelas">
          <option value="">Semua kelas</option>
          {classOptions.map(([cid, label]) => <option key={cid} value={cid}>{label}</option>)}
        </select>
        <input className="input max-w-56" type="search" aria-label="Cari nama siswa" placeholder="Cari nama siswa…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* tabel siswa dengan status & aksi pengawas (FR-9.2, FR-9.4) */}
      <div className="overflow-x-auto lg:overflow-visible">
      <table className="table-base responsive-table">
        <thead>
          <tr><th>Nama</th><th>Kelas</th><th>Progres</th><th>Status</th><th>Koneksi</th><th>Pelanggaran</th><th>Nilai</th><th>Aksi</th></tr>
        </thead>
        <tbody>
          {students.map((s, i) => {
            const st = attemptStatus(s.status)
            const online = Boolean(s.online ?? String(s.connection ?? 'online') === 'online')
            const violations = Number(s.violations ?? 0)
            return (
              <tr key={s.attempt_id ?? s.student_id ?? i}>
                <td data-th="Nama" className="font-medium">
                  {String(s.name ?? '—')}
                  {String(s.student_id ?? '') !== '' && (
                    <div className="text-xs">
                      <button type="button" className="text-primary hover:underline" onClick={() => nav(`/students/${s.student_id}`)}>
                        track record →
                      </button>
                    </div>
                  )}
                </td>
                <td data-th="Kelas">{String(s.class ?? '—')}</td>
                <td data-th="Progres">
                  <b>{Number(s.answered ?? 0)}/{Number(s.total ?? 0)}</b>
                  <div className="h-1.5 rounded-full bg-border/40 mt-1 max-w-24">
                    <div className="h-full rounded-full bg-primary"
                      style={{ width: `${Number(s.total ?? 0) > 0 ? Math.round((Number(s.answered ?? 0) / Number(s.total)) * 100) : 0}%` }} />
                  </div>
                </td>
                <td data-th="Status"><span className={`badge ${st.cls}`}>{st.label}</span></td>
                <td data-th="Koneksi">
                  <span className={`inline-flex items-center gap-1.5 text-xs ${online ? 'text-success' : 'text-danger'}`}>
                    {online ? <IconWifi size={14} /> : <IconWifiOff size={14} />}
                    {online ? 'Online' : 'Offline'}
                  </span>
                </td>
                <td data-th="Pelanggaran">
                  {violations > 0
                    ? <span className={`badge ${violations >= 3 ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'}`}>{violations}×</span>
                    : <span className="text-xs text-muted">—</span>}
                  {Boolean(s.cheating) && <div><span className="badge bg-danger-soft text-danger">dilaporkan</span></div>}
                </td>
                <td data-th="Nilai">
                  {s.score !== undefined && s.score !== null ? String(s.score)
                    : s.final_score !== undefined && s.final_score !== null ? String(s.final_score) : '—'}
                </td>
                <td data-th="Aksi">
                  <div className="flex gap-1.5 flex-wrap">
                    <button type="button" className="btn-ghost btn-sm" onClick={() => { setExtraMinutes(5); setExtending(s) }}>+ Waktu</button>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setResetting(s)}>Reset</button>
                    <button type="button" className="btn-danger btn-sm" onClick={() => setForcing(s)}>Paksa selesai</button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>

      <Modal
        open={!!extending}
        onClose={() => setExtending(null)}
        title={`Tambah waktu — ${String(extending?.name ?? '')}`}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setExtending(null)} disabled={busy}>Batal</button>
            <button type="button" className="btn-primary" onClick={() => void extendTime()} disabled={busy}>
              {busy ? 'Menyimpan…' : 'Tambah waktu'}
            </button>
          </>
        }
      >
        <div>
          <label className="label" htmlFor="lv-min">Tambahan waktu (menit)</label>
          <input id="lv-min" type="number" min={1} step={1} className="input" value={extraMinutes}
            onChange={e => setExtraMinutes(Number(e.target.value) || 0)} />
          <p className="text-xs text-muted mt-1">= {extraMinutes * 60} detik</p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!resetting} title="Reset percobaan?" busy={busy}
        message={`Percobaan ${resetting?.name ?? ''} dihapus & siswa mengerjakan ulang dari awal.`}
        confirmLabel="Ya, reset"
        onConfirm={resetAttempt} onClose={() => setResetting(null)}
      />
      <ConfirmDialog
        open={!!forcing} title="Paksa selesai?" danger busy={busy} confirmLabel="Ya, paksa selesai"
        message={`Jawaban ${forcing?.name ?? ''} dikumpulkan sekarang apa adanya.`}
        onConfirm={forceSubmit} onClose={() => setForcing(null)}
      />
    </div>
  )
}
