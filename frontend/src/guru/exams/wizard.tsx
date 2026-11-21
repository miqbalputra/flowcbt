// Wizard 5 langkah buat ujian (FR-5.1..5.5, §11): Info → Peserta → Jadwal → Aturan → Ringkas+Publish.
// Tampilan Design System v3: stepper nomor mono + garis, satu Panel per langkah.
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import {
  Callout,
  EmptyState,
  ErrorBox,
  PageHeader,
  Panel,
  SearchBox,
  SkeletonRows,
} from '../ui'
import { asDict, copyText, errMessage, fmtDateTime, qs, unwrap, unwrapList, qRows } from '../types'
import {
  IconCalendar,
  IconCheck,
  IconClipboard,
  IconCopy,
  IconExam,
  IconLeft,
  IconRight,
  IconSettings,
  IconStudents,
  IconWarn,
} from '@/components/icons'

type ExamForm = {
  name: string
  question_set_id: string
  subject_name: string
  class_ids: string[]
  student_ids: string[]
  open_at: string
  close_at: string
  duration_minutes: number
  max_attempts: number
  score_policy: 'highest' | 'last' | 'average'
  show_score: boolean
  close_policy: 'hard' | 'grace'
  login_mode: 'account' | 'no_account' | 'both'
  shuffle_questions: boolean
  shuffle_options: boolean
  free_navigation: boolean
  require_all_answered: boolean
  kkm_score: number
  // anti-cheat (FR-5.8) — default sesuai tabel PRD
  anti_cheat_enabled: boolean
  anti_cheat_tolerance_seconds: number
  anti_cheat_penalty_points: number
  anti_cheat_max_penalty: number
  anti_cheat_flag_threshold: number
  anti_cheat_auto_submit: boolean
  anti_cheat_camera: boolean
}

const DEFAULTS: ExamForm = {
  name: '', question_set_id: '', subject_name: '',
  class_ids: [], student_ids: [],
  open_at: '', close_at: '',
  duration_minutes: 60, max_attempts: 1, score_policy: 'highest', show_score: true, close_policy: 'grace', login_mode: 'both',
  shuffle_questions: false, shuffle_options: false, free_navigation: true, require_all_answered: false, kkm_score: 70,
  anti_cheat_enabled: true, anti_cheat_tolerance_seconds: 3, anti_cheat_penalty_points: 5,
  anti_cheat_max_penalty: 30, anti_cheat_flag_threshold: 3, anti_cheat_auto_submit: false, anti_cheat_camera: false,
}

const STEPS = ['Info', 'Peserta', 'Jadwal', 'Aturan', 'Ringkas & Publish']
const STEP_SHORT = ['Info', 'Peserta', 'Jadwal', 'Aturan', 'Publish']
const STEP_ICONS = [IconExam, IconStudents, IconCalendar, IconSettings, IconClipboard]
const LOGIN_MODES = [
  { value: 'account', label: 'Akun (username/NIS + password)' },
  { value: 'no_account', label: 'Tanpa akun (data diri + kode)' },
  { value: 'both', label: 'Keduanya (default)' },
]
const dtLocal = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const isoFrom = (local: string) => (local ? new Date(local).toISOString() : undefined)

export default function ExamWizard() {
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<ExamForm>(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ token: string; code: string } | null>(null)
  const [studentSearch, setStudentSearch] = useState('')
  const [stepError, setStepError] = useState('')

  const set = <K extends keyof ExamForm>(k: K, v: ExamForm[K]) => setForm(f => ({ ...f, [k]: v }))

  // Peringatan sebelum tutup/reload bila ada isian tahap 1-4 yang belum disimpan
  const hasInput = !done && JSON.stringify(form) !== JSON.stringify(DEFAULTS)
  useEffect(() => {
    if (!hasInput) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = 'Ada isian ujian yang belum disimpan — yakin ingin keluar?'
      return e.returnValue
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasInput])

  const qsets = useQuery({ queryKey: ['question-sets', 'for-exam'], queryFn: async () => unwrapList(await api('/question-sets?limit=50')) })
  const classes = useQuery({ queryKey: ['classes', 'picker'], queryFn: async () => unwrapList(await api('/classes?limit=50')) })
  const students = useQuery({
    queryKey: ['students', 'picker', studentSearch],
    queryFn: async () => unwrapList(await api(`/students${qs({ limit: 50, q: studentSearch || undefined })}`)),
    placeholderData: prev => prev,
  })

  const chosenSet = qRows(qsets).find(r => String(r.id) === form.question_set_id)

  function stepProblem(): string {
    if (step === 0) {
      if (!form.name.trim()) return 'Nama ujian wajib diisi'
      if (!form.question_set_id) return 'Pilih paket soal dulu'
    }
    if (step === 1 && form.class_ids.length === 0 && form.student_ids.length === 0) return 'Pilih minimal satu kelas atau siswa'
    if (step === 2) {
      if (!form.open_at || !form.close_at) return 'Isi jadwal buka & tutup'
      if (new Date(form.close_at) <= new Date(form.open_at)) return 'Tutup harus setelah dibuka'
      if (form.duration_minutes <= 0) return 'Durasi minimal 1 menit'
      if (form.max_attempts <= 0) return 'Percobaan minimal 1'
    }
    return ''
  }

  function next() {
    const problem = stepProblem()
    if (problem) {
      setStepError(problem)
      toast(problem, 'error')
      return
    }
    setStepError('')
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  // antrean transisi langkah 1→5
  async function submit(publish: boolean) {
    setBusy(true)
    try {
      const created = unwrap(await send('/exams', ({
          name: form.name.trim(),
          question_set_id: form.question_set_id,
          subject_name: form.subject_name || undefined,
          open_at: isoFrom(form.open_at),
          close_at: isoFrom(form.close_at),
          duration_minutes: form.duration_minutes,
          max_attempts: form.max_attempts,
          score_policy: form.score_policy,
          show_score: form.show_score,
          close_policy: form.close_policy,
          login_mode: form.login_mode,
          shuffle_questions: form.shuffle_questions,
          shuffle_options: form.shuffle_options,
          free_navigation: form.free_navigation,
          require_all_answered: form.require_all_answered,
          kkm_score: form.kkm_score,
          anti_cheat_enabled: form.anti_cheat_enabled,
          anti_cheat_tolerance_seconds: form.anti_cheat_tolerance_seconds,
          anti_cheat_penalty_points: form.anti_cheat_penalty_points,
          anti_cheat_max_penalty: form.anti_cheat_max_penalty,
          anti_cheat_flag_threshold: form.anti_cheat_flag_threshold,
          anti_cheat_auto_submit: form.anti_cheat_auto_submit,
          anti_cheat_camera: form.anti_cheat_camera,
        }), 'POST'))
      const examId = String(asDict(created).id ?? '')
      await send(`/exams/${examId}/assignments`, ({ class_ids: form.class_ids, student_ids: form.student_ids }), 'PUT')
      if (!publish) {
        toast('Ujian disimpan sebagai draft', 'success')
        nav(`/exams/${examId}`)
        return
      }
      const pub = unwrap(await api(`/exams/${examId}/publish`, { method: 'POST' }))
      const pd = asDict(pub)
      setDone({ token: String(pd.token ?? '—'), code: String(pd.exam_code ?? '—') })
      toast('Ujian dipublish', 'success')
    } catch (err) {
      toast(errMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const waMessage = done
    ? [
        `Halo! Ujian *${form.name}* sudah dibuka ya,`,
        `Kode ujian: *${done.code}*`,
        `Token: *${done.token}*`,
        `Dibuka: ${fmtDateTime(form.open_at)} — ditutup: ${fmtDateTime(form.close_at)} (WIB)`,
        'Mau pakai FlowCBT. Semangat mengerjakan!',
      ].join('\n')
    : ''

  const StepIcon = STEP_ICONS[step] ?? IconExam

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akademik · Ujian"
        title="Buat Ujian"
        desc="5 langkah singkat: info, peserta, jadwal, aturan, terbitkan."
        icon={<IconExam size={18} />}
        action={<Link to="/exams" className="btn-ghost">Ke daftar ujian</Link>}
      />

      {/* indikator langkah bernomor */}
      <Panel title="Progres Pembuatan" icon={<IconClipboard size={15} />} bodyClassName="space-y-2.5">
        <ol className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Langkah pembuatan ujian">
          {STEPS.map((label, i) => {
            const active = i === step
            const doneStep = i < step
            return (
              <li key={label} className="min-w-0">
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  onClick={() => { if (i < step) { setStepError(''); setStep(i) } }}
                  disabled={i > step}
                  className={`flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border px-1.5 py-1.5 text-left transition-colors sm:justify-start sm:px-2 ${
                    active
                      ? 'border-primary-bg bg-primary-bg text-primary-fg'
                      : doneStep
                        ? 'border-success-line bg-success-soft text-success hover:border-success'
                        : 'border-border bg-surface text-muted'
                  } ${i > step ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  <span
                    aria-hidden
                    className={`mono flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
                      active
                        ? 'border-primary-fg/40 bg-primary-fg/15 text-primary-fg'
                        : doneStep
                          ? 'border-success-line bg-surface text-success'
                          : 'border-border bg-canvas text-muted'
                    }`}
                  >
                    {doneStep ? <IconCheck size={12} /> : i + 1}
                  </span>
                  <span
                    className={`hidden min-w-0 truncate text-[12px] font-semibold sm:block ${
                      active ? 'text-primary-fg' : ''
                    }`}
                  >
                    {STEP_SHORT[i]}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
        <p className="text-xs text-muted sm:hidden">
          Langkah <span className="mono font-semibold text-text">{step + 1}</span> dari{' '}
          <span className="mono font-semibold text-text">{STEPS.length}</span> · {STEPS[step]}
        </p>
        <p className="hidden text-xs text-muted sm:block">
          Langkah aktif ditandai biru, langkah selesai hijau. Klik langkah sebelumnya untuk kembali.
        </p>
      </Panel>

      {/* pesan masalah langkah aktif (inline, selain toast) */}
      {stepError && (
        <div role="alert">
          <Callout tone="danger" title="Lengkapi langkah ini" icon={<IconWarn size={16} />}>
            {stepError}
          </Callout>
        </div>
      )}

      {/* ---------- langkah 1: info ---------- */}
      {step === 0 && (
        <Panel title="Info Ujian" icon={<StepIcon size={15} />} bodyClassName="space-y-3">
          {qsets.isError && <ErrorBox error={qsets.error} onRetry={() => void qsets.refetch()} />}
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <label className="label" htmlFor="ex-name">Nama ujian</label>
              <input
                id="ex-name"
                className="input"
                placeholder="PTS Ganjil Matematika"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
              <p className="hint mt-1">Tampil di halaman peserta, token, dan laporan.</p>
            </div>
            <div>
              <label className="label" htmlFor="ex-qs">Paket soal (draft/published)</label>
              {qsets.isLoading ? (
                <div className="skeleton h-11 w-full" />
              ) : (
                <select
                  id="ex-qs"
                  className="input"
                  value={form.question_set_id}
                  onChange={e => {
                    const q = qRows(qsets).find(r => String(r.id) === e.target.value)
                    setForm(f => ({
                      ...f,
                      question_set_id: e.target.value,
                      subject_name: String(q?.subject_name ?? f.subject_name), // prefill mapel
                    }))
                  }}
                >
                  <option value="">— pilih paket —</option>
                  {qRows(qsets).filter(r => r.status !== 'archived').map((r, i) => (
                    <option key={r.id ?? i} value={String(r.id ?? '')}>
                      [{String(r.status ?? '?')}] {String(r.title ?? '')} · {String(r.subject_name ?? '')}
                    </option>
                  ))}
                </select>
              )}
              <p className="hint mt-1">Paket menentukan butir soal, kunci, dan total poin.</p>
            </div>
          </div>
          {chosenSet && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-canvas px-2.5 py-2 text-xs text-muted">
              <span><span className="mono font-semibold text-text">{String(chosenSet.questions_count ?? 0)}</span> soal</span>
              <span aria-hidden>·</span>
              <span>kode <span className="mono font-semibold text-text">{String(chosenSet.exam_code ?? '—')}</span></span>
            </div>
          )}
        </Panel>
      )}

      {/* ---------- langkah 2: peserta (FR-5.6) ---------- */}
      {step === 1 && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel
            title="Kelas"
            icon={<IconStudents size={15} />}
            action={<span className="chip mono">{form.class_ids.length} dipilih</span>}
          >
            {classes.isLoading ? (
              <SkeletonRows rows={3} cols={2} />
            ) : classes.isError ? (
              <ErrorBox error={classes.error} onRetry={() => void classes.refetch()} />
            ) : qRows(classes).length === 0 ? (
              <EmptyState icon={<IconStudents size={20} />} title="Belum ada kelas">
                Bikin dulu di menu Kelas.
              </EmptyState>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {qRows(classes).map((c, i) => {
                  const cid = String(c.id ?? '')
                  const checked = form.class_ids.includes(cid)
                  return (
                    <label key={cid || i} className="choice !items-center" data-active={checked ? 'true' : 'false'}>
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={checked}
                        onChange={e => set('class_ids', e.target.checked ? [...form.class_ids, cid] : form.class_ids.filter(x => x !== cid))}
                      />
                      <span className="min-w-0 truncate text-sm">{String(c.name ?? '—')}</span>
                    </label>
                  )
                })}
              </div>
            )}
            <p className="hint mt-2.5">Boleh pilih beberapa kelas sekaligus.</p>
          </Panel>

          <Panel
            title="Siswa Tertentu"
            icon={<IconStudents size={15} />}
            action={<span className="chip mono">{form.student_ids.length} dipilih</span>}
          >
            <div className="space-y-2.5">
              <SearchBox
                label="Cari siswa"
                placeholder="Cari siswa…"
                value={studentSearch}
                onChange={setStudentSearch}
              />
              {students.isLoading ? (
                <SkeletonRows rows={3} cols={2} />
              ) : students.isError ? (
                <ErrorBox error={students.error} onRetry={() => void students.refetch()} />
              ) : qRows(students).length === 0 ? (
                <EmptyState icon={<IconStudents size={20} />} title="Tidak ada hasil." />
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
                  {qRows(students).map((s, i) => {
                    const sid = String(s.id ?? '')
                    const checked = form.student_ids.includes(sid)
                    return (
                      <label
                        key={sid || i}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-sm ${
                          checked ? 'border-primary bg-primary-soft' : 'border-border bg-surface'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={checked}
                          onChange={e => set('student_ids', e.target.checked ? [...form.student_ids, sid] : form.student_ids.filter(x => x !== sid))}
                        />
                        <span className="min-w-0 flex-1 truncate">{String(s.full_name ?? s.name ?? '—')}</span>
                        <span className="shrink-0 text-xs text-muted">{String(s.class_name ?? '')}</span>
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="hint">
                Terpilih: <span className="mono font-semibold text-text">{form.class_ids.length}</span> kelas ·{' '}
                <span className="mono font-semibold text-text">{form.student_ids.length}</span> siswa
              </p>
            </div>
          </Panel>
        </div>
      )}

      {/* ---------- langkah 3: jadwal (FR-5.1..5.4) ---------- */}
      {step === 2 && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel title="Jadwal Ujian" icon={<IconCalendar size={15} />} bodyClassName="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="ex-open">Buka (WIB)</label>
                <input
                  id="ex-open"
                  type="datetime-local"
                  className="input"
                  value={form.open_at}
                  onChange={e => set('open_at', e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="ex-close">Tutup (WIB)</label>
                <input
                  id="ex-close"
                  type="datetime-local"
                  className="input"
                  value={form.close_at}
                  onChange={e => set('close_at', e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="ex-dur">Durasi pengerjaan (menit sejak siswa menekan Mulai)</label>
              <input
                id="ex-dur"
                type="number"
                min={1}
                className="input sm:max-w-40"
                value={form.duration_minutes}
                onChange={e => set('duration_minutes', Number(e.target.value) || 0)}
              />
              <p className="hint mt-1">Waktu berjalan di server sejak peserta menekan Mulai.</p>
            </div>
          </Panel>

          <Panel title="Percobaan & Akses" icon={<IconSettings size={15} />} bodyClassName="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="ex-att">Percobaan maksimal</label>
                <input
                  id="ex-att"
                  type="number"
                  min={1}
                  max={10}
                  className="input"
                  value={form.max_attempts}
                  onChange={e => set('max_attempts', Number(e.target.value) || 1)}
                />
              </div>
              <div>
                <label className="label" htmlFor="ex-policy">Aturan nilai akhir</label>
                <select
                  id="ex-policy"
                  className="input"
                  value={form.score_policy}
                  onChange={e => set('score_policy', e.target.value as ExamForm['score_policy'])}
                >
                  <option value="highest">Nilai tertinggi</option>
                  <option value="last">Nilai terakhir</option>
                  <option value="average">Rata-rata</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="ex-close-policy">Maks. waktu tombol tutup (Batas Waktu)</label>
              <select
                id="ex-close-policy"
                className="input"
                value={form.close_policy}
                onChange={e => set('close_policy', e.target.value as ExamForm['close_policy'])}
              >
                <option value="grace">Grace — biarkan habis durasi walau telat dikit</option>
                <option value="hard">Hard close — dipotong di close_at</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="ex-login">Mode login siswa</label>
              <select
                id="ex-login"
                className="input"
                value={form.login_mode}
                onChange={e => set('login_mode', e.target.value as ExamForm['login_mode'])}
              >
                {LOGIN_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.show_score}
                onChange={e => set('show_score', e.target.checked)}
              />
              Nilai langsung tampil setelah siswa selesai
            </label>
          </Panel>
        </div>
      )}

      {/* ---------- langkah 4: aturan (FR-5.5, FR-5.8) ---------- */}
      {step === 3 && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel title="Aturan Pengerjaan" icon={<IconSettings size={15} />} bodyClassName="space-y-3">
            <div className="grid gap-2">
              {([
                ['shuffle_questions', 'Acak urutan soal'],
                ['shuffle_options', 'Acak urutan pilihan'],
                ['free_navigation', 'Navigasi bebas (bisa mundur)'],
                ['require_all_answered', 'Wajib semua soal dijawab'],
              ] as const).map(([key, label]) => (
                <label key={key} className="choice !items-center" data-active={form[key] ? 'true' : 'false'}>
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={e => set(key, e.target.checked)}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
            <div>
              <label className="label" htmlFor="ex-kkm">Nilai KKM / ambang kelulusan</label>
              <input
                id="ex-kkm"
                type="number"
                min={0}
                max={100}
                className="input sm:max-w-40"
                value={form.kkm_score}
                onChange={e => set('kkm_score', Number(e.target.value) || 0)}
              />
              <p className="hint mt-1">Dipakai untuk penanda lulus/belum lulus di laporan.</p>
            </div>
          </Panel>

          <Panel title="Anti-cheat: deteksi keluar aplikasi" icon={<IconWarn size={15} />} bodyClassName="space-y-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.anti_cheat_enabled}
                onChange={e => set('anti_cheat_enabled', e.target.checked)}
              />
              Aktifkan deteksi keluar aplikasi
            </label>
            {form.anti_cheat_enabled && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="ex-tol">Toleransi (detik)</label>
                    <input
                      id="ex-tol"
                      type="number"
                      min={0}
                      className="input"
                      value={form.anti_cheat_tolerance_seconds}
                      onChange={e => set('anti_cheat_tolerance_seconds', Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="ex-pen">Pengurangan poin / pelanggaran</label>
                    <input
                      id="ex-pen"
                      type="number"
                      min={0}
                      max={100}
                      className="input"
                      value={form.anti_cheat_penalty_points}
                      onChange={e => set('anti_cheat_penalty_points', Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="ex-max">Batas total penalti (poin)</label>
                    <input
                      id="ex-max"
                      type="number"
                      min={0}
                      max={100}
                      className="input"
                      value={form.anti_cheat_max_penalty}
                      onChange={e => set('anti_cheat_max_penalty', Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="ex-flag">Ambang "dilaporkan curang" (n pelanggaran)</label>
                    <input
                      id="ex-flag"
                      type="number"
                      min={1}
                      max={10}
                      className="input"
                      value={form.anti_cheat_flag_threshold}
                      onChange={e => set('anti_cheat_flag_threshold', Number(e.target.value) || 3)}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="choice !items-center" data-active={form.anti_cheat_auto_submit ? 'true' : 'false'}>
                    <input
                      type="checkbox"
                      checked={form.anti_cheat_auto_submit}
                      onChange={e => set('anti_cheat_auto_submit', e.target.checked)}
                    />
                    <span className="text-sm">Auto-submit (default off)</span>
                  </label>
                  <label className="choice !items-center" data-active={form.anti_cheat_camera ? 'true' : 'false'}>
                    <input
                      type="checkbox"
                      checked={form.anti_cheat_camera}
                      onChange={e => set('anti_cheat_camera', e.target.checked)}
                    />
                    <span className="text-sm">Kamera (default off)</span>
                  </label>
                </div>
              </>
            )}
            <p className="hint">Aturan ini tampil di halaman tata tertib & siswa wajib setuju sebelum mulai.</p>
          </Panel>
        </div>
      )}

      {/* ---------- langkah 5: ringkasan + publish (FR-5.7) ---------- */}
      {step === 4 && !done && (
        <Panel
          title="Ringkasan & Publish"
          icon={<StepIcon size={15} />}
          footer={
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void submit(false)}>
                Simpan Draft
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit(true)}>
                {busy ? 'Membuat…' : 'Buat & Publish'}
              </button>
            </div>
          }
        >
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0">
              <dt className="section-label">Nama</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold">{form.name}</dd>
            </div>
            <div className="min-w-0">
              <dt className="section-label">Paket soal</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold">
                {String(qRows(qsets).find(r => String(r.id) === form.question_set_id)?.title ?? '—')}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="section-label">Peserta</dt>
              <dd className="mt-0.5 text-sm font-semibold">
                <span className="mono">{form.class_ids.length}</span> kelas ·{' '}
                <span className="mono">{form.student_ids.length}</span> siswa
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="section-label">Durasi</dt>
              <dd className="mt-0.5 text-sm font-semibold">
                <span className="mono">{form.duration_minutes}</span> menit · percobaan{' '}
                <span className="mono">{form.max_attempts}</span>×
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="section-label">Buka — tutup</dt>
              <dd className="mono mt-0.5 break-words text-xs font-semibold">
                {fmtDateTime(form.open_at)} → {fmtDateTime(form.close_at)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="section-label">Anti-cheat</dt>
              <dd className="mt-0.5 break-words text-sm font-semibold">
                {form.anti_cheat_enabled
                  ? `aktif (toleransi ${form.anti_cheat_tolerance_seconds} dtk, penalti -${form.anti_cheat_penalty_points})`
                  : 'nonaktif'}
              </dd>
            </div>
          </dl>
          <p className="hint mt-3">Ujian tersimpan sebagai draft bila memilih Simpan Draft, atau langsung terbit dengan token.</p>
        </Panel>
      )}

      {/* sukses publish → token & kode ujian */}
      {done && (
        <Panel title="Ujian Dipublish" icon={<IconCheck size={15} />} bodyClassName="space-y-3">
          <Callout tone="success" title="Ujian dipublish!" icon={<IconCheck size={16} />}>
            Bagikan kode dan token berikut kepada peserta sebelum jadwal buka.
          </Callout>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-canvas p-3">
              <div className="section-label">Kode ujian</div>
              <div className="mono mt-1 break-all text-lg font-bold">{done.code}</div>
            </div>
            <div className="rounded-md border border-border bg-canvas p-3">
              <div className="section-label">Token</div>
              <div className="mono mt-1 break-all text-lg font-bold">{done.token}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="btn-ghost sm:flex-1"
              onClick={() => void copyText(waMessage, 'Pesan WhatsApp disalin')}
            >
              <IconCopy size={14} /> Salin pesan WA
            </button>
            <button type="button" className="btn-primary sm:flex-1" onClick={() => nav('/exams')}>
              Ke daftar ujian
            </button>
          </div>
        </Panel>
      )}

      {/* nav bawah wizard */}
      {!done && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 ? (
            <button type="button" className="btn-ghost" onClick={() => setStep(s => s - 1)} disabled={busy}>
              <IconLeft size={15} /> Kembali
            </button>
          ) : (
            <span className="hidden sm:block" />
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn-primary"
              onClick={next}
              disabled={busy || (step === 0 && qsets.isLoading)}
            >
              {step === 0 ? 'Lanjut ke Peserta' : 'Lanjut'} <IconRight size={15} />
            </button>
          ) : (
            <p className="hint hidden sm:block">Periksa ringkasan sebelum publish.</p>
          )}
        </div>
      )}
    </div>
  )
}
