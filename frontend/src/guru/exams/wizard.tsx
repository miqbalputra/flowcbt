// Wizard 5 langkah buat ujian (FR-5.1..5.5, §11): Info → Peserta → Jadwal → Aturan → Ringkas+Publish
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { send } from '../rpc'
import { toast } from '@/components/toast'
import { Modal } from '@/components/modal'
import { ErrorBox, PageHeader, SkeletonRows } from '../ui'
import {  asDict, asList, copyText, errMessage, fmtDateTime, qs, unwrap, unwrapList, qRows } from '../types'
import { IconCheck, IconCopy } from '@/components/icons'

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

  const qsets = useQuery({ queryKey: ['question-sets', 'for-exam'], queryFn: () => unwrapList(api('/question-sets?limit=50')) })
  const classes = useQuery({ queryKey: ['classes', 'picker'], queryFn: () => unwrapList(api('/classes?limit=50')) })
  const students = useQuery({
    queryKey: ['students', 'picker', studentSearch],
    queryFn: () => unwrapList(api(`/students${qs({ limit: 50, q: studentSearch || undefined })}`)),
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

  return (
    <div className="space-y-4">
      <PageHeader title="Buat Ujian" desc="5 langkah singkat: info, peserta, jadwal, aturan, terbitkan." />

      {/* indikator langkah */}
      <ol className="flex gap-1.5 overflow-x-auto pb-1">
        {STEPS.map((label, i) => (
          <li key={label} className="shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              aria-current={i === step ? 'step' : undefined}
              onClick={() => { if (i < step) { setStepError(''); setStep(i) } }}
              disabled={i > step}
              className={`min-h-[36px] px-2.5 rounded-full text-xs font-medium border ${i === step ? 'bg-primary-bg text-primary-fg border-primary-bg' : i < step ? 'border-primary text-primary' : 'border-border text-muted'}`}
            >
              {i + 1}. {label}
            </button>
            {i < STEPS.length - 1 && <span className="text-muted" aria-hidden>›</span>}
          </li>
        ))}
      </ol>

      {/* pesan masalah langkah aktif (inline, selain toast) */}
      {stepError && <p role="alert" className="text-sm text-danger">{stepError}</p>}

      {/* ---------- langkah 1: info ---------- */}
      {step === 0 && (
        <div className="card space-y-3">
          {qsets.isError && <ErrorBox error={qsets.error} />}
          <div>
            <label className="label" htmlFor="ex-name">Nama ujian</label>
            <input id="ex-name" className="input" placeholder="PTS Ganjil Matematika" value={form.name}
              onChange={e => set('name', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ex-qs">Paket soal (draft/published)</label>
            {qsets.isLoading ? (
              <div className="skeleton h-11 w-full" />
            ) : (
              <select id="ex-qs" className="input" value={form.question_set_id}
                onChange={e => {
                  const q = qRows(qsets).find(r => String(r.id) === e.target.value)
                  setForm(f => ({
                    ...f, question_set_id: e.target.value,
                    subject_name: String(q?.subject_name ?? f.subject_name), // prefill mapel
                  }))
                }}>
                <option value="">— pilih paket —</option>
                {qRows(qsets).filter(r => r.status !== 'archived').map((r, i) => (
                  <option key={r.id ?? i} value={String(r.id ?? '')}>
                    [{String(r.status ?? '?')}] {String(r.title ?? '')} · {String(r.subject_name ?? '')}
                  </option>
                ))}
              </select>
            )}
          </div>
          {chosenSet && (
            <p className="text-xs text-muted">
              {String(chosenSet.questions_count ?? 0)} soal · kode {String(chosenSet.exam_code ?? '—')}
            </p>
          )}
        </div>
      )}

      {/* ---------- langkah 2: peserta (FR-5.6) ---------- */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="card space-y-2">
            <h3 className="font-semibold text-sm">Kelas (bisa beberapa)</h3>
            {classes.isError ? <ErrorBox error={classes.error} /> : qRows(classes).length === 0 ? (
              <p className="text-sm text-muted">Belum ada kelas — bikin dulu di menu Kelas.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {qRows(classes).map((c, i) => {
                  const cid = String(c.id ?? '')
                  const checked = form.class_ids.includes(cid)
                  return (
                    <label key={cid || i} className="flex items-center gap-2 rounded-lg border border-border p-2.5 min-h-[44px] cursor-pointer text-sm">
                      <input type="checkbox" className="shrink-0" checked={checked}
                        onChange={e => set('class_ids', e.target.checked ? [...form.class_ids, cid] : form.class_ids.filter(x => x !== cid))} />
                      <span className="truncate">{String(c.name ?? '—')}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <div className="card space-y-2">
            <h3 className="font-semibold text-sm">Siswa tertentu (kombinasi boleh)</h3>
            <input className="input" type="search" aria-label="Cari siswa" placeholder="Cari siswa…" value={studentSearch}
              onChange={e => setStudentSearch(e.target.value)} />
            {students.isError ? <ErrorBox error={students.error} /> : qRows(students).length === 0 ? (
              <p className="text-sm text-muted">Tidak ada hasil.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1.5">
                {qRows(students).map((s, i) => {
                  const sid = String(s.id ?? '')
                  const checked = form.student_ids.includes(sid)
                  return (
                    <label key={sid || i} className={`flex items-center gap-2 rounded-lg border p-2.5 min-h-[44px] cursor-pointer text-sm ${checked ? 'border-primary' : 'border-border'}`}>
                      <input type="checkbox" className="shrink-0" checked={checked}
                        onChange={e => set('student_ids', e.target.checked ? [...form.student_ids, sid] : form.student_ids.filter(x => x !== sid))} />
                      <span className="min-w-0 truncate">{String(s.full_name ?? s.name ?? '—')}</span>
                      <span className="ml-auto text-xs text-muted shrink-0">{String(s.class_name ?? '')}</span>
                    </label>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-muted">Terpilih: {form.class_ids.length} kelas · {form.student_ids.length} siswa</p>
          </div>
        </div>
      )}

      {/* ---------- langkah 3: jadwal (FR-5.1..5.4) ---------- */}
      {step === 2 && (
        <div className="card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ex-open">Buka (WIB)</label>
              <input id="ex-open" type="datetime-local" className="input" value={form.open_at}
                onChange={e => set('open_at', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="ex-close">Tutup (WIB)</label>
              <input id="ex-close" type="datetime-local" className="input" value={form.close_at}
                onChange={e => set('close_at', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ex-dur">Durasi pengerjaan (menit sejak siswa menekan Mulai)</label>
            <input id="ex-dur" type="number" min={1} className="input" value={form.duration_minutes}
              onChange={e => set('duration_minutes', Number(e.target.value) || 0)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ex-att">Percobaan maksimal</label>
              <input id="ex-att" type="number" min={1} max={10} className="input" value={form.max_attempts}
                onChange={e => set('max_attempts', Number(e.target.value) || 1)} />
            </div>
            <div>
              <label className="label" htmlFor="ex-policy">Aturan nilai akhir</label>
              <select id="ex-policy" className="input" value={form.score_policy} onChange={e => set('score_policy', e.target.value as ExamForm['score_policy'])}>
                <option value="highest">Nilai tertinggi</option>
                <option value="last">Nilai terakhir</option>
                <option value="average">Rata-rata</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input type="checkbox" checked={form.show_score} onChange={e => set('show_score', e.target.checked)} />
            Nilai langsung tampil setelah siswa selesai
          </label>
          <div>
            <span className="label !mb-0">Maks. waktu tombol tutup (Batas Waktu)</span>
            <select className="input" value={form.close_policy} onChange={e => set('close_policy', e.target.value as ExamForm['close_policy'])}>
              <option value="grace">Grace — biarkan habis durasi walau telat dikit</option>
              <option value="hard">Hard close — dipotong di close_at</option>
            </select>
          </div>
          <div>
            <span className="label !mb-0">Mode login siswa</span>
            <select className="input" value={form.login_mode} onChange={e => set('login_mode', e.target.value as ExamForm['login_mode'])}>
              {LOGIN_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ---------- langkah 4: aturan (FR-5.5, FR-5.8) ---------- */}
      {step === 3 && (
        <div className="card space-y-3">
          <h3 className="font-semibold text-sm">Aturan pengerjaan</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="checkbox" checked={form.shuffle_questions} onChange={e => set('shuffle_questions', e.target.checked)} />
              Acak urutan soal
            </label>
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="checkbox" checked={form.shuffle_options} onChange={e => set('shuffle_options', e.target.checked)} />
              Acak urutan pilihan
            </label>
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="checkbox" checked={form.free_navigation} onChange={e => set('free_navigation', e.target.checked)} />
              Navigasi bebas (bisa mundur)
            </label>
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="checkbox" checked={form.require_all_answered} onChange={e => set('require_all_answered', e.target.checked)} />
              Wajib semua soal dijawab
            </label>
          </div>
          <div>
            <label className="label" htmlFor="ex-kkm">Nilai KKM / ambang kelulusan</label>
            <input id="ex-kkm" type="number" min={0} max={100} className="input sm:max-w-40" value={form.kkm_score}
              onChange={e => set('kkm_score', Number(e.target.value) || 0)} />
          </div>
          <hr className="border-border" />
          <h3 className="font-semibold text-sm">Anti-cheat: deteksi keluar aplikasi</h3>
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input type="checkbox" checked={form.anti_cheat_enabled} onChange={e => set('anti_cheat_enabled', e.target.checked)} />
            Aktifkan deteksi keluar aplikasi
          </label>
          {form.anti_cheat_enabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="ex-tol">Toleransi (detik)</label>
                  <input id="ex-tol" type="number" min={0} className="input" value={form.anti_cheat_tolerance_seconds}
                    onChange={e => set('anti_cheat_tolerance_seconds', Number(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="label" htmlFor="ex-pen">Pengurangan poin / pelanggaran</label>
                  <input id="ex-pen" type="number" min={0} max={100} className="input" value={form.anti_cheat_penalty_points}
                    onChange={e => set('anti_cheat_penalty_points', Number(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="label" htmlFor="ex-max">Batas total penalti (poin)</label>
                  <input id="ex-max" type="number" min={0} max={100} className="input" value={form.anti_cheat_max_penalty}
                    onChange={e => set('anti_cheat_max_penalty', Number(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="label" htmlFor="ex-flag">Ambang "dilaporkan curang" (n pelanggaran)</label>
                  <input id="ex-flag" type="number" min={1} max={10} className="input" value={form.anti_cheat_flag_threshold}
                    onChange={e => set('anti_cheat_flag_threshold', Number(e.target.value) || 3)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-sm min-h-[44px]">
                  <input type="checkbox" checked={form.anti_cheat_auto_submit} onChange={e => set('anti_cheat_auto_submit', e.target.checked)} />
                  Auto-submit (default off)
                </label>
                <label className="flex items-center gap-2 text-sm min-h-[44px]">
                  <input type="checkbox" checked={form.anti_cheat_camera} onChange={e => set('anti_cheat_camera', e.target.checked)} />
                  Kamera (default off)
                </label>
              </div>
            </>
          )}
          <p className="text-xs text-muted">Aturan ini tampil di halaman tata tertib & siswa wajib setuju sebelum mulai.</p>
        </div>
      )}

      {/* ---------- langkah 5: ringkasan + publish (FR-5.7) ---------- */}
      {step === 4 && !done && (
        <div className="card space-y-3">
          <h3 className="font-semibold">Ringkasan</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-muted">Nama</dt><dd className="font-medium break-words">{form.name}</dd></div>
            <div><dt className="text-xs text-muted">Paket soal</dt><dd className="font-medium">{String(qRows(qsets).find(r => String(r.id) === form.question_set_id)?.title ?? '—')}</dd></div>
            <div><dt className="text-xs text-muted">Peserta</dt><dd className="font-medium">{form.class_ids.length} kelas · {form.student_ids.length} siswa</dd></div>
            <div><dt className="text-xs text-muted">Durasi</dt><dd className="font-medium">{form.duration_minutes} menit · percobaan {form.max_attempts}×</dd></div>
            <div><dt className="text-xs text-muted">Buka — tutup</dt><dd className="font-medium">{fmtDateTime(form.open_at)} → {fmtDateTime(form.close_at)}</dd></div>
            <div><dt className="text-xs text-muted">Anti-cheat</dt><dd className="font-medium">{form.anti_cheat_enabled ? `aktif (toleransi ${form.anti_cheat_tolerance_seconds} dtk, penalti -${form.anti_cheat_penalty_points})` : 'nonaktif'}</dd></div>
          </dl>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button type="button" className="btn-ghost flex-1" disabled={busy} onClick={() => void submit(false)}>
              Simpan Draft
            </button>
            <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void submit(true)}>
              {busy ? 'Membuat…' : 'Buat & Publish'}
            </button>
          </div>
        </div>
      )}

      {/* sukses publish → token & kode ujian */}
      {done && (
        <div className="card space-y-3 border-success">
          <h3 className="font-semibold text-lg flex items-center gap-2"><IconCheck size={18} className="text-success" /> Ujian dipublish!</h3>
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted w-20 shrink-0">Kode ujian</span>
              <b className="font-mono">{done.code}</b>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted w-20 shrink-0">Token</span>
              <b className="font-mono break-all">{done.token}</b>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => void copyText(waMessage, 'Pesan WhatsApp disalin')}>
              <IconCopy size={14} /> Salin pesan WA
            </button>
            <button type="button" className="btn-primary flex-1" onClick={() => nav('/exams')}>
              Ke daftar ujian
            </button>
          </div>
        </div>
      )}

      {/* nav bawah wizard */}
      {!done && step > 0 && (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={() => setStep(s => s - 1)} disabled={busy}>← Kembali</button>
          {step < STEPS.length - 1 && <button type="button" className="btn-primary flex-1" onClick={next} disabled={busy}>Lanjut →</button>}
        </div>
      )}
      {!done && step === 0 && (
        <button type="button" className="btn-primary w-full" onClick={next} disabled={busy || qsets.isLoading}>Lanjut ke Peserta →</button>
      )}
    </div>
  )
}
