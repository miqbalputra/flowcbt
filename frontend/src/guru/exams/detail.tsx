// Detail ujian (published/pending): edit jadwal, regen token, daftar peserta,
// aksi pengawas (tambah waktu / reset percobaan / force submit), unpublish, link live.
// Tampilan Design System v3: identitas + token + aksi pengawas dalam Panel terpisah.
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { ConfirmDialog, Modal } from '@/components/modal'
import {
  Callout,
  EmptyState,
  ErrorBox,
  PageHeader,
  Panel,
  ProgressBar,
  SearchBox,
  SkeletonRows,
  StatCard,
  StatusBadge,
  TableToolbar,
} from '../ui'
import {
  asDict,
  attemptStatus,
  copyText,
  errMessage,
  fmtDateTime,
  qRows,
  unwrap,
  unwrapList,
} from '../types'
import {
  IconCalendar,
  IconChart2,
  IconCheck,
  IconCopy,
  IconEdit,
  IconExam,
  IconKey,
  IconPlay,
  IconRefresh,
  IconShield,
  IconStudents,
  IconX,
} from '@/components/icons'

/** ISO → nilai input datetime-local (zona lokal WIB area guru) */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Sched = { open_at: string; close_at: string; duration_minutes: number }
const EMPTY_SCHED: Sched = { open_at: '', close_at: '', duration_minutes: 60 }

/** badge status attempt — border *-line + bg *-soft (selalu bertulisan) */
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

/** cheating_status dianggap ditandai bila bukan kosong/none/clean */
const isFlagged = (v: unknown) => {
  const s = String(v ?? '')
  return s !== '' && s !== 'none' && s !== 'clean'
}

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
  const [search, setSearch] = useState('')

  const exam = useQuery({ queryKey: ['exam', id], queryFn: async () => unwrap(await api(`/exams/${id}`)) })
  const attempts = useQuery({ queryKey: ['exams', id, 'attempts'], queryFn: async () => unwrapList(await api(`/exams/${id}/attempts`)) })

  const e = exam.data ? asDict(exam.data) : {}
  const isPublished = String(e.status ?? '') === 'published'
  const rows = qRows(attempts)

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
      toast('Jadwal ujian diperbarui', 'success')
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
      toast(`+${extendMinutes} menit untuk ${String(extend.student_name ?? 'siswa')}`, 'success')
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

  if (exam.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Ujian · Detail"
          title="Detail Ujian"
          desc="Memuat identitas dan peserta ujian."
          icon={<IconExam size={18} />}
        />
        <Panel><SkeletonRows rows={5} cols={3} /></Panel>
      </div>
    )
  }
  if (exam.isError) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow="Ujian · Detail"
          title="Detail Ujian"
          desc="Identitas ujian tidak dapat dimuat."
          icon={<IconExam size={18} />}
        />
        <Panel><ErrorBox error={exam.error} onRetry={() => void exam.refetch()} /></Panel>
      </div>
    )
  }

  // angka ringkasan memakai counts server bila tersedia, fallback ke daftar attempt
  const counts = asDict(e.counts)
  const participantCount = Number(counts.participants ?? rows.length) || 0
  const inProgress = Number(counts.in_progress ?? rows.filter(r => ['in_progress', 'working'].includes(String(r.status ?? ''))).length) || 0
  const finished = Number(counts.submitted ?? rows.filter(r =>
    ['submitted', 'done', 'graded', 'expired', 'forced_submit', 'disqualified'].includes(String(r.status ?? ''))
  ).length) || 0
  const flaggedRows = rows.filter(r => isFlagged(r.cheating_status)).length

  const keyword = search.trim().toLowerCase()
  const shown = keyword
    ? rows.filter(r => [r.student_name, r.student_class].some(v => String(v ?? '').toLowerCase().includes(keyword)))
    : rows

  const token = typeof e.token === 'string' ? e.token : ''
  const durationText = e.duration_minutes !== undefined && e.duration_minutes !== null
    ? `${Number(e.duration_minutes)} menit`
    : '—'
  const attemptLimit = e.max_attempts !== undefined && e.max_attempts !== null ? String(e.max_attempts) : '—'
  const questionSetTitle = String(asDict(e.question_set).title ?? '—')

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Ujian · Detail"
        title={String(e.name ?? 'Detail Ujian')}
        desc={String(e.subject_name ?? 'Manajemen sesi ujian')}
        icon={<IconExam size={18} />}
        action={
          <Link to={`/reports/live/${id}`} className="btn-ghost">
            <IconChart2 size={16} /> Pantau Live
          </Link>
        }
      />

      {/* KPI peserta */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <StatCard label="Peserta" value={String(participantCount)} hint="peserta terdaftar" icon={<IconStudents size={14} />} />
        <StatCard label="Mengerjakan" value={String(inProgress)} hint="sedang berjalan" tone="primary" icon={<IconPlay size={14} />} />
        <StatCard label="Selesai" value={String(finished)} hint="terkirim / dinilai" tone="success" icon={<IconCheck size={14} />} />
        <StatCard label="Ditandai" value={String(flaggedRows)} hint="perlu keputusan pengawas" tone={flaggedRows > 0 ? 'danger' : 'default'} icon={<IconShield size={14} />} />
      </div>

      {flaggedRows > 0 && isPublished && (
        <Callout tone="warn" title="Ada peserta ditandai" icon={<IconShield size={16} />}>
          <span className="mono font-semibold">{flaggedRows}</span> peserta perlu keputusan pengawas — buka{' '}
          <Link to={`/exams/${id}/cheating`} className="font-semibold text-primary hover:underline">laporan kecurangan</Link>.
        </Callout>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* kiri: identitas + jadwal */}
        <div className="min-w-0 space-y-4">
          <Panel title="Identitas Ujian" icon={<IconExam size={15} />}>
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="section-label">Status</dt>
                <dd className="mt-1"><StatusBadge status={e.status} /></dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Kode ujian</dt>
                <dd className="mono mt-1 break-all text-sm font-semibold">{String(e.exam_code ?? '—')}</dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Mata pelajaran</dt>
                <dd className="mt-1 truncate text-sm font-medium">{String(e.subject_name ?? '—')}</dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Paket soal</dt>
                <dd className="mt-1 truncate text-sm font-medium">{questionSetTitle}</dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Durasi</dt>
                <dd className="mono mt-1 text-sm font-semibold">{durationText}</dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Percobaan</dt>
                <dd className="mono mt-1 text-sm font-semibold">{attemptLimit}</dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Dibuka</dt>
                <dd className="mono mt-1 break-words text-xs">{fmtDateTime(e.open_at)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="section-label">Ditutup</dt>
                <dd className="mono mt-1 break-words text-xs">{fmtDateTime(e.close_at)}</dd>
              </div>
            </dl>
          </Panel>

          <Panel
            title="Jadwal Ujian"
            icon={<IconCalendar size={15} />}
            footer={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="hint">Perubahan jadwal langsung berlaku untuk peserta.</p>
                <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={() => void saveSchedule()}>
                  Simpan jadwal
                </button>
              </div>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label" htmlFor="ed-open">Buka (WIB)</label>
                <input
                  id="ed-open"
                  type="datetime-local"
                  className="input"
                  value={sched.open_at}
                  onChange={ev => setSched(s => ({ ...s, open_at: ev.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="ed-close">Tutup (WIB)</label>
                <input
                  id="ed-close"
                  type="datetime-local"
                  className="input"
                  value={sched.close_at}
                  onChange={ev => setSched(s => ({ ...s, close_at: ev.target.value }))}
                />
              </div>
              <div>
                <label className="label" htmlFor="ed-dur">Durasi (menit)</label>
                <input
                  id="ed-dur"
                  type="number"
                  min={1}
                  className="input"
                  value={sched.duration_minutes}
                  onChange={ev => setSched(s => ({ ...s, duration_minutes: Number(ev.target.value) || 0 }))}
                />
              </div>
            </div>
          </Panel>
        </div>

        {/* kanan: token + aksi pengawas */}
        <div className="space-y-4">
          <Panel title="Token Ujian" icon={<IconKey size={15} />} bodyClassName="space-y-2.5">
            <div className="rounded-md border border-border bg-canvas px-3 py-2.5">
              <div className="section-label">Token aktif</div>
              <div className="mono mt-1 break-all text-xl font-bold tracking-[0.12em]">{token || '—'}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={!token}
                onClick={() => void copyText(token, 'Token disalin')}
                title="Salin token"
              >
                <IconCopy size={13} /> Salin token
              </button>
              {isPublished && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => void regenToken()}>
                  <IconRefresh size={14} /> Generate ulang token
                </button>
              )}
            </div>
            <p className="hint">Peserta memasukkan token ini sebelum menekan Mulai.</p>
          </Panel>

          <Panel title="Aksi Pengawas" icon={<IconShield size={15} />} bodyClassName="space-y-2">
            <Link to={`/exams/${id}/grading`} className="btn-ghost w-full !justify-start">
              <IconEdit size={15} /> Koreksi uraian
            </Link>
            {isPublished && (
              <Link to={`/exams/${id}/cheating`} className="btn-ghost w-full !justify-start">
                <IconShield size={15} /> Laporan kecurangan
              </Link>
            )}
            {isPublished && (
              <button
                type="button"
                className="btn-ghost w-full !text-danger hover:!border-danger-line"
                disabled={busy}
                onClick={() => setUnpublishing(true)}
              >
                <IconX size={15} /> Tarik Terbitan
              </button>
            )}
            <p className="hint">Setiap aksi pengawas tercatat di audit log.</p>
          </Panel>
        </div>
      </div>

      {/* daftar peserta */}
      <Panel
        title="Peserta"
        icon={<IconStudents size={15} />}
        action={<span className="chip mono">{rows.length}</span>}
        flush
      >
        <div className="border-b border-border p-3">
          <TableToolbar count={shown.length} label="peserta">
            <SearchBox
              className="w-full sm:w-64"
              label="Cari peserta"
              placeholder="Cari nama / kelas…"
              value={search}
              onChange={setSearch}
            />
          </TableToolbar>
        </div>

        {attempts.isLoading ? (
          <div className="p-3"><SkeletonRows rows={4} cols={5} /></div>
        ) : attempts.isError ? (
          <div className="p-3"><ErrorBox error={attempts.error} onRetry={() => void attempts.refetch()} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconStudents size={20} />} title="Belum ada yang mengerjakan" />
        ) : shown.length === 0 ? (
          <EmptyState icon={<IconStudents size={20} />} title="Tidak ada peserta yang cocok">
            Ubah kata kunci pencarian nama atau kelas.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table-base responsive-table">
              <thead>
                <tr>
                  <th scope="col">Siswa</th>
                  <th scope="col">Kelas</th>
                  <th scope="col" className="num">Percobaan</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progres</th>
                  <th scope="col" className="num">Nilai</th>
                  <th scope="col" className="num">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const answered = Number(r.answered ?? r.progress_answered ?? 0)
                  const total = Number(r.total_questions ?? r.progress_total ?? 0)
                  const score = r.score ?? r.final_score ?? '—'
                  return (
                    <tr key={r.id ?? i}>
                      <td data-th="Siswa" className="font-medium">
                        <span className="block max-w-[16rem] truncate">{String(r.student_name ?? '—')}</span>
                      </td>
                      <td data-th="Kelas">{String(r.student_class ?? '—')}</td>
                      <td data-th="Percobaan" className="num">ke-{String(r.attempt_no ?? 1)}</td>
                      <td data-th="Status">
                        <div className="space-y-1">
                          <div><span className={`badge ${attemptTone(r.status)}`}>{attemptStatus(r.status).label}</span></div>
                          {isFlagged(r.cheating_status) && (
                            <div>
                              <span className="badge !border-danger-line bg-danger-soft text-danger">
                                <IconShield size={11} /> Dilaporkan curang
                              </span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td data-th="Progres">
                        {total > 0 ? (
                          <div className="min-w-[88px]">
                            <div className="mono text-xs">
                              {answered}/{total}
                            </div>
                            <ProgressBar
                              value={answered}
                              max={total}
                              label={`Progres ${answered} dari ${total} soal`}
                            />
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td data-th="Nilai" className="num mono">{String(score)}</td>
                      <td data-th="Aksi">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => { setExtendMinutes(5); setExtend(r) }}
                          >
                            + Waktu
                          </button>
                          <button type="button" className="btn-quiet btn-sm" onClick={() => setResetting(r)}>
                            Reset
                          </button>
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => setForcing(r)}
                          >
                            <span className="text-danger">Paksa selesai</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

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
          <input
            id="ext-min"
            type="number"
            min={1}
            step={1}
            className="input"
            value={extendMinutes}
            onChange={ev => setExtendMinutes(Number(ev.target.value) || 0)}
          />
          <p className="hint mt-1">= {extendMinutes * 60} detik</p>
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
        open={unpublishing} title="Tarik terbitan ujian?" danger busy={busy} confirmLabel="Ya, tarik terbitan"
        message="Ujian disembunyikan dari siswa & kembali jadi draft. Ungpublish dibolehkan selama belum ada pengerjaan."
        onConfirm={unpublish} onClose={() => setUnpublishing(false)}
      />
    </div>
  )
}
