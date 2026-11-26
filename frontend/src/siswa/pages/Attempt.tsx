// Attempt runner (/s/attempt/:id) — LAYAR UJIAN gaya portal ujian nasional.
// Struktur: kepala institusional (identitas ujian + timer) → strip peserta &
// status sinkron → grid [soal | panel Daftar Soal] → bar aksi bawah.
// LOGIKA TIDAK BERUBAH (offline-first, idempoten, AC-1..AC-12):
// - Jawaban ditulis SEGERA ke IndexedDB (queue event, seq monoton) — FR-7.3.
// - Engine sync (lib/sync.ts) mengirim batch saat online; status sinkron di
//   header memakai getEngineState/subscribeSync (FR-7.4, AC-2/AC-3).
// - Timer memakai deadline_at server + server_offset (epoch ms) — FR-7.5.
// - Merge recovery dgn getQueuedQuestionIds — FR-7.8.
// - Anti-cheat listeners (visibility/blur/fullscreen) — FR-5.8A.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getAttempt, putAnswer, saveAttempt, getQueuedQuestionIds } from '../db'
import { enqueue, registerAttempt, unregisterAttempt, uuid, setAttemptStart, kick, enqueueSubmit } from '../lib/sync'
import { reportViolation, getServerAttempt, toEpochMs, type ServerAttemptView } from '../lib/student-api'
import { fmtClock, getProfile } from '../lib/util'
import { QuestionView, StimulusCard, type AnswerValue } from '../components/QuestionView'
import { ConnStatus } from '../components/ConnStatus'
import { Modal } from '@/components/modal'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  IconAlertCircle, IconCheck, IconClock, IconExpand, IconFlag, IconGrid,
  IconLeft, IconRight, IconShrink, LogoMark,
} from '@/components/icons'
import { toast } from '@/components/toast'
import { renderRich } from '@/lib/sanitize'
import type { AttemptRecord, FetchedQuestion, StudentProfile } from '../types'

type Rules = {
  anti_cheat_enabled?: boolean
  tolerance_seconds?: number
  penalty_points?: number
  max_penalty?: number
  flag_threshold?: number
  auto_submit?: boolean
  camera_enabled?: boolean
}

/** Skala font 3 langkah: 14 / 16 / 18 px. */
const FS_STEPS = [14, 16, 18] as const
const FS_KEY = 'flowcbt.fsz'

const TYPE_LABEL: Record<string, string> = {
  mcq: 'Pilihan Ganda',
  mcq_complex: 'PG Kompleks',
  matching: 'Menjodohkan',
  short_answer: 'Isian Singkat',
  essay: 'Uraian',
}

export default function Attempt() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [rec, setRec] = useState<AttemptRecord | null>(null)
  const [rules, setRules] = useState<Rules>({})
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [flagged, setFlagged] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState<Record<string, boolean>>({}) // belum dicatat server
  const [idx, setIdx] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [sheet, setSheet] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [violate, setViolate] = useState<{ n: number; left: number } | null>(null)
  const [locked, setLocked] = useState(false)
  const [isFs, setIsFs] = useState(false)
  const [fsStep, setFsStep] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(FS_KEY))
      return Number.isInteger(v) && v >= 0 && v <= FS_STEPS.length - 1 ? v : 1
    } catch {
      return 1
    }
  })

  useEffect(() => {
    let alive = true
    void (async () => {
      let r0 = await getAttempt(id)
      if (!alive) return

      // FR-7.8 — pemulihan lintas perangkat/tab: bila paket tidak ada di
      // perangkat (cache dibersihkan / ganti browser), ambil dari server.
      if (!r0) {
        try {
          const v = await getServerAttempt(id)
          const meta = (v.attempt ?? {}) as Record<string, unknown>
          if (meta.id && meta.status && meta.status !== 'in_progress') {
            toast('Ujian ini sudah dikirim. Menampilkan hasil…', 'info')
            nav(`/s/attempt/${id}/done`, { replace: true })
            return
          }
          const pkg = (v as { package?: { questions?: FetchedQuestion[] } }).package
          const questions = pkg?.questions ?? []
          if (meta.id && questions.length) {
            r0 = {
              attempt_id: id,
              exam_name: String(meta.exam_name ?? 'Ujian'),
              exam_code: typeof meta.exam_code === 'string' ? meta.exam_code : undefined,
              subject_name: typeof meta.subject_name === 'string' ? meta.subject_name : undefined,
              questions,
              deadline_at: toEpochMs(meta.deadline_at) || 0,
              server_offset: v.server_offset_ms || 0,
              started_at: toEpochMs(meta.started_at) || Date.now(),
              status: 'in_progress',
              profile: getProfile(),
              flags: (v.flags ?? {}) as Record<string, boolean>,
              answers: (v.answers ?? {}) as Record<string, unknown>,
            } as AttemptRecord
            await saveAttempt(r0)
          }
        } catch {
          /* offline / bukan pemilik → jatuh ke pesan di bawah */
        }
      }
      if (!alive) return
      if (!r0) {
        toast('Ujian tidak ditemukan di perangkat ini dan gagal dimuat dari server.', 'error')
        nav('/s/exams', { replace: true })
        return
      }
      // Normalisasi data lama: deadline/started bisa string RFC3339.
      const r: AttemptRecord = {
        ...r0,
        deadline_at: toEpochMs(r0.deadline_at) || 0,
        started_at: toEpochMs(r0.started_at) || Date.now(),
        server_offset: Number(r0.server_offset) || 0,
      }
      if (r.deadline_at !== r0.deadline_at || r.started_at !== r0.started_at) void saveAttempt(r)
      setRec(r)
      setAttemptStart(r.started_at || Date.now())
      registerAttempt(id)
      void mergeFromServer(r)
    })()
    return () => {
      alive = false
      unregisterAttempt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // detak detik
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // status layar penuh (tombol di header)
  useEffect(() => {
    const on = () => setIsFs(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const qs: FetchedQuestion[] = rec?.questions ?? []
  const q = qs[Math.min(idx, Math.max(0, qs.length - 1))]
  const profile: StudentProfile = rec?.profile ?? getProfile()

  // Waktu server = acuan (FR-7.5)
  const deadlineEff = rec?.deadline_at ? rec.deadline_at - (rec.server_offset || 0) : 0
  const remainingMs = deadlineEff ? deadlineEff - now : 0
  const expired = (deadlineEff > 0 && remainingMs <= 0) || rec?.status === 'expired'

  const saveAnswer = useCallback(
    async (qid: string, val: AnswerValue) => {
      if (locked || expired) return
      setAnswers(p => ({ ...p, [qid]: val }))
      setDirty(p => ({ ...p, [qid]: true }))
      await enqueue({
        client_event_id: uuid(),
        attempt_id: id,
        type: 'answer',
        question_id: qid,
        payload: { question_id: qid, answer: val },
        client_ts: Date.now(),
        seq: 0,
      })
      void putAnswer({ attempt_id: id, question_id: qid, answer: val, flag: false, seq: 0, dirty: true, updated_at: Date.now() })
    },
    [id, locked, expired],
  )

  const toggleFlag = useCallback(
    async (qid: string | undefined) => {
      if (!qid || locked) return
      const nv = !flagged[qid]
      setFlagged(p => ({ ...p, [qid]: nv }))
      await enqueue({
        client_event_id: uuid(),
        attempt_id: id,
        type: 'flag',
        question_id: qid,
        payload: { question_id: qid, flag: nv },
        client_ts: Date.now(),
        seq: 0,
      })
      void putAnswer({ attempt_id: id, question_id: qid, answer: answers[qid] ?? null, flag: nv, seq: 0, dirty: true, updated_at: Date.now() })
    },
    [id, flagged, answers, locked],
  )

  async function mergeFromServer(r: AttemptRecord) {
    if (!navigator.onLine) return
    try {
      const v = await getServerAttempt(id)
      if (!v) return
      const rr = v as ServerAttemptView
      const dl = rr.attempt?.deadline_at ?? 0
      const offset = rr.server_offset_ms || 0
      if ((dl && (!r.deadline_at || Math.abs(dl - r.deadline_at) > 60_000)) || (offset && offset !== r.server_offset)) {
        const next: AttemptRecord = { ...r, deadline_at: dl || r.deadline_at, server_offset: offset || r.server_offset }
        await saveAttempt(next)
        setRec(next)
      }
      const queuedQids = await getQueuedQuestionIds(id)
      const srvAns = (rr.answers ?? {}) as Record<string, unknown>
      setAnswers(prev => {
        const out = { ...prev }
        for (const qid of Object.keys(srvAns)) {
          const curDirty = dirtyRef.current[qid] || queuedQids.has(qid)
          if (!curDirty) out[qid] = srvAns[qid] as AnswerValue
        }
        return out
      })
      setFlagged(prev => {
        const out = { ...prev }
        for (const [qid, v] of Object.entries(rr.flags ?? {})) {
          if (queuedQids.has(qid)) continue
          out[qid] = Boolean(v)
        }
        return out
      })
      if (rr.rules) setRules(rr.rules as Rules)
      if (['submitted', 'graded', 'expired'].includes(rr.attempt?.status ?? '')) {
        setLocked(true)
      }
    } catch {
      /* offline — lanjut data lokal (AC-1) */
    }
  }

  // AUTO-SUBMIT saat waktu habis (FR-6.5)
  useEffect(() => {
    if (!rec || locked) return
    const dl = rec.deadline_at ? rec.deadline_at - (rec.server_offset || 0) : 0
    if (dl && Date.now() > dl) void finish(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, rec, locked])

  // Proteksi tata tertib ala ANBK/TKA: teks ujian tidak dapat disalin atau
  // klik-kanan selama pengerjaan (kolom jawaban tetap dapat diketik normal).
  useEffect(() => {
    const noCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('input, textarea, [contenteditable]')) return
      e.preventDefault()
    }
    const noCopy = (e: ClipboardEvent) => { e.preventDefault() }
    document.addEventListener('contextmenu', noCtx)
    document.addEventListener('copy', noCopy)
    return () => {
      document.removeEventListener('contextmenu', noCtx)
      document.removeEventListener('copy', noCopy)
    }
  }, [])

  async function finish(auto = false) {
    if (!rec) return
    if (rec && rec.status === 'in_progress') {
      await enqueueSubmit(id)
      await saveAttempt({ ...rec, status: 'submitted' })
    }
    kick()
    nav(`/s/attempt/${id}/review`, { replace: auto })
  }

  /* ============================ ANTI-CHEAT (FR-5.8A) ============================ */
  const dirtyRef = useRef<Record<string, boolean>>({})
  dirtyRef.current = dirty
  const awayRef = useRef<{ startedAt: number; type: 'tab_hidden' | 'blur' | 'fullscreen_exit' } | null>(null)
  const lastViolationAt = useRef(0)
  const violationN = useRef(0)

  useEffect(() => {
    const tol = (rules.tolerance_seconds ?? 3) * 1000
    function startAway(type: 'tab_hidden' | 'blur' | 'fullscreen_exit') {
      if (awayRef.current) return
      awayRef.current = { startedAt: Date.now(), type }
    }
    async function backOnline() {
      const away = awayRef.current
      awayRef.current = null
      if (!away || locked) return
      const dur = Date.now() - away.startedAt
      if (dur < tol) return
      if (Date.now() - lastViolationAt.current < 1500) return
      lastViolationAt.current = Date.now()
      const evId = uuid()
      const res = await reportViolation(id, {
        type: away.type,
        started_at: new Date(away.startedAt).toISOString(),
        duration_ms: dur,
        client_event_id: evId,
      })
      if (res === undefined) {
        await enqueue({ client_event_id: evId, attempt_id: id, type: 'violation',
          payload: { violation_type: away.type, started_at: new Date(away.startedAt).toISOString(), duration_ms: dur },
          client_ts: Date.now(), seq: 0 })
        violationN.current += 1
        setViolate({ n: violationN.current, left: Math.max(0, (rules.flag_threshold ?? 3) - violationN.current) })
        kick()
        return
      }
      violationN.current = res.violations ?? violationN.current + 1
      setViolate({ n: violationN.current, left: res.warn_left ?? 0 })
      if (res.should_auto_submit) {
        toast('Karena pelanggaran berulang, ujianmu otomatis dikirim.', 'warn')
        await finish(true)
      }
    }
    function onVis() { document.hidden ? startAway('tab_hidden') : void backOnline() }
    function onBlur() { startAway('blur') }
    function onFocus() { void backOnline() }
    function onFs() {
      if ((document as any).fullscreenElement) void backOnline()
      else startAway('fullscreen_exit')
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('fullscreenchange', onFs)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rules, locked, rec])

  /* ============================ KEYBOARD ============================ */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (sheet) {
        if (e.key === 'Escape') setSheet(false)
        return
      }
      if (typing || locked) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIdx(i => Math.max(0, i - 1))
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIdx(i => Math.min(qs.length - 1, i + 1))
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        if (q) void toggleFlag(q.id)
        return
      }
      const letterMatch = /^[a-eA-E]$/.test(e.key)
      const numMatch = /^[1-5]$/.test(e.key)
      if (!q || (!letterMatch && !numMatch)) return
      if (q.type !== 'mcq' && q.type !== 'mcq_complex') return
      const i = letterMatch ? e.key.toLowerCase().charCodeAt(0) - 97 : Number(e.key) - 1
      const opt = q.options?.[i]
      if (!opt) return
      if (q.type === 'mcq') {
        void saveAnswer(q.id, opt.id)
      } else {
        const arr: string[] = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : []
        void saveAnswer(q.id, arr.includes(opt.id) ? arr.filter(x => x !== opt.id) : [...arr, opt.id])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, locked, qs.length, q, id, answers, saveAnswer, toggleFlag])

  const fsVal = FS_STEPS[Math.min(Math.max(0, fsStep), FS_STEPS.length - 1)]
  useEffect(() => {
    try { localStorage.setItem(FS_KEY, String(fsStep)) } catch { /* ignore */ }
  }, [fsStep])

  if (!rec) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-text">
        <div className="text-center">
          <LogoMark size={30} />
          <p className="mt-3 animate-pulse text-sm text-muted">Menyiapkan soal…</p>
        </div>
      </div>
    )
  }

  const goNext = () => setIdx(i => (qs.length ? Math.min(qs.length - 1, i + 1) : 0))
  const goPrev = () => setIdx(i => Math.max(0, i - 1))
  const isLast = qs.length > 0 && idx >= qs.length - 1
  const hasDeadline = deadlineEff > 0
  const urgent = hasDeadline && remainingMs <= 5 * 60_000
  const answeredCount = Object.values(answers).filter(v =>
    Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '',
  ).length
  const flagCount = Object.values(flagged).filter(Boolean).length
  const total = qs.length

  const filled = (qid: string) => {
    const v = answers[qid]
    return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ''
  }

  const qnavCls = (qi: number, qid: string) =>
    `q-nav ${filled(qid) ? 'q-nav-answered' : flagged[qid] ? 'q-nav-flag' : 'q-nav-clear'}${qi === idx ? ' q-nav-active' : ''}`

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      toast('Peramban tidak mengizinkan mode layar penuh.', 'warn')
    }
  }

  return (
    <div className="exam-shell">
      {/* ===================== KEPALA INSTITUSIONAL ===================== */}
      <header className="appbar sticky top-0 z-40 shrink-0">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-2.5 px-3 sm:px-4">
          <LogoMark size={20} />
          <div className="hidden shrink-0 border-l border-ink-line pl-2.5 sm:block">
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Ujian Berbasis Komputer</div>
            <div className="max-w-[260px] truncate text-[13px] font-semibold leading-tight">{rec.exam_name}</div>
          </div>
          <span aria-hidden className="hidden h-7 w-px bg-ink-line sm:block" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {rec.exam_code && (
                <span className="mono shrink-0 rounded border border-ink-line bg-white/5 px-1.5 py-0.5 text-[10px] font-bold tracking-wider">
                  {rec.exam_code}
                </span>
              )}
              <span className="truncate text-[11px] text-ink-muted sm:hidden">{rec.exam_name}</span>
              {rec.subject_name && (
                <span className="hidden truncate text-[11px] text-ink-muted sm:block">{rec.subject_name}</span>
              )}
            </div>
          </div>

          {hasDeadline && (
            <div
              className="hidden shrink-0 items-center gap-2 rounded-md border border-ink-line bg-white/5 px-2.5 py-1 md:flex"
              role="timer"
              aria-live="off"
              aria-label={`Sisa waktu ${fmtClock(remainingMs)}`}
            >
              <IconClock size={15} className="text-ink-muted" />
              <div>
                <div className="text-[8.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Sisa waktu</div>
                <div className={`timer text-[17px] leading-none ${urgent ? 'text-onink-danger' : 'text-white'}`}>
                  {fmtClock(remainingMs)}
                </div>
                <div className="text-[8.5px] font-medium text-ink-muted/70">menit&nbsp;:&nbsp;detik</div>
              </div>
            </div>
          )}

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={toggleFullscreen}
              title={isFs ? 'Keluar layar penuh' : 'Layar penuh'}
              aria-label={isFs ? 'Keluar layar penuh' : 'Masuk layar penuh'}
              className="hidden h-9 w-9 items-center justify-center rounded text-ink-muted hover:bg-white/10 hover:text-white md:flex"
            >
              {isFs ? <IconShrink size={17} /> : <IconExpand size={17} />}
            </button>
            <span className="hidden md:block"><ThemeToggle tone="inverse" /></span>
          </div>
        </div>
      </header>

      {/* ===================== STRIP PESERTA & STATUS ===================== */}
      <div className="sticky top-14 z-30 shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex h-11 w-full max-w-[1440px] items-center gap-2 px-3 sm:px-4">
          <span aria-hidden className="mono flex h-6 w-6 shrink-0 items-center justify-center rounded bg-ink text-[10px] font-bold text-ink-fg">
            {profile.name.trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || 'S'}
          </span>
          <span className="max-w-[9rem] truncate text-[12px] font-semibold sm:max-w-[16rem]">{profile.name}</span>
          <span className="hidden text-[11px] text-muted sm:inline">
            {profile.isGuest ? 'Peserta tamu' : profile.sid ? `NIS ${profile.sid}` : 'Peserta'}
          </span>
          <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
          <span className="hidden text-[11px] text-muted lg:inline">{rec.exam_name}</span>

          <div className="ml-auto flex items-center gap-2">
            <ConnStatus />
            {hasDeadline && (
              <span
                role="timer"
                aria-live="off"
                className={`timer text-[15px] md:hidden ${urgent ? 'text-danger' : ''}`}
              >
                {fmtClock(remainingMs)}
              </span>
            )}
            <div className="hidden items-center rounded border border-border bg-surface sm:flex" role="group" aria-label="Ukuran teks soal">
              <button
                type="button"
                aria-label="Perkecil teks"
                disabled={fsStep <= 0}
                onClick={() => setFsStep(s => Math.max(0, s - 1))}
                className="mono h-8 w-8 rounded-l text-xs font-bold text-muted hover:bg-canvas disabled:opacity-40"
              >A−</button>
              <button
                type="button"
                aria-label="Kembalikan ukuran standar"
                onClick={() => setFsStep(1)}
                className="mono h-8 w-10 border-x border-border text-[11px] text-muted hover:bg-canvas"
              >{Math.round((FS_STEPS[fsStep] / 16) * 100)}%</button>
              <button
                type="button"
                aria-label="Perbesar teks"
                disabled={fsStep >= FS_STEPS.length - 1}
                onClick={() => setFsStep(s => Math.min(FS_STEPS.length - 1, s + 1))}
                className="mono h-8 w-8 rounded-r text-sm font-bold text-muted hover:bg-canvas disabled:opacity-40"
              >A+</button>
            </div>
            <button
              type="button"
              onClick={() => setSheet(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-border px-2 text-xs font-semibold text-text hover:bg-canvas lg:hidden"
              aria-label="Buka peta soal"
            >
              <IconGrid size={14} />
              <span className="mono">{answeredCount}/{total || '—'}</span>
            </button>
          </div>
        </div>
      </div>

      {urgent && !expired && (
        <div className="shrink-0 border-b border-warn-line bg-warn-soft px-3 py-1.5 text-center text-xs font-medium text-warn" role="status">
          Sisa waktu kurang dari 5 menit — periksa jawabanmu dan segera akhiri ujian.
        </div>
      )}
      {expired && (
        <div className="shrink-0 border-b border-danger-line bg-danger-soft px-3 py-1.5 text-center text-xs font-medium text-danger" role="status">
          Waktu pengerjaan habis — jawaban dikirim otomatis.
        </div>
      )}

      {/* ===================== BADAN: SOAL + DAFTAR SOAL ===================== */}
      <main className="exam-main">
        <div className="exam-grid mx-auto w-full max-w-[1440px]">
          {/* --- kolom soal --- */}
          <section className="min-w-0" aria-label={`Soal ${idx + 1} dari ${total}`}>
            <div className="exam-content">
              <div className="mx-auto max-w-[780px]" style={{ fontSize: fsVal, lineHeight: 1.65 }}>
                {/* kepala soal */}
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-2.5">
                  <span className="mono inline-flex items-baseline gap-1 rounded border border-border-strong bg-surface px-2 py-0.5 text-[13px] font-bold">
                    Soal {total ? idx + 1 : 0}
                    <span className="text-[11px] font-medium text-muted">/ {total || '—'}</span>
                  </span>
                  <span className="chip">{TYPE_LABEL[q?.type ?? ''] ?? 'Soal'}</span>
                  {q?.points !== undefined && <span className="chip">{q.points} poin</span>}
                  {q && flagged[q.id] && (
                    <span className="inline-flex items-center gap-1 rounded border border-warn-line bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">
                      <IconFlag size={11} /> Ragu-ragu
                    </span>
                  )}
                  <span className="ml-auto hidden text-[11px] text-muted md:block">
                    Jawaban tersimpan otomatis
                  </span>
                </div>

                {q ? (
                  <>
                    <StimulusCard text={stimContent(q)} title={stimTitle(q)} />
                    <div
                      className="question-body rich-text break-words [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:bg-canvas [&_th]:p-1.5"
                      dangerouslySetInnerHTML={{ __html: renderRich(String(q.body ?? '')) }}
                    />
                    <div className="mt-5">
                      <div className="section-label mb-2">Pilih jawaban</div>
                      {locked && (
                        <p className="mb-3 rounded border border-border bg-canvas p-2 text-xs">
                          Ujian sudah dikirim — jawaban tidak dapat diubah.
                        </p>
                      )}
                      <QuestionView
                        q={q}
                        value={answers[q.id] ?? null}
                        onChange={v => void saveAnswer(q.id, v)}
                        disabled={locked || expired}
                      />
                    </div>

                    <p className="mt-6 hidden items-center gap-3 border-t border-border pt-3 text-[11px] text-muted lg:flex">
                      <span className="mono rounded border border-border bg-canvas px-1.5 py-0.5 font-semibold">←</span> sebelumnya
                      <span className="mono rounded border border-border bg-canvas px-1.5 py-0.5 font-semibold">→</span> berikutnya
                      <span className="mono rounded border border-border bg-canvas px-1.5 py-0.5 font-semibold">A–E</span> pilih
                      <span className="mono rounded border border-border bg-canvas px-1.5 py-0.5 font-semibold">R</span> ragu-ragu
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted">Soal tidak tersedia.</p>
                )}
              </div>
            </div>
          </section>

          {/* --- panel Daftar Soal (desktop) --- */}
          <aside className="hidden border-l border-border bg-surface lg:block" aria-label="Daftar soal">
            <div className="sticky top-[100px] flex max-h-[calc(100dvh-100px)] flex-col">
              {/* identitas + sisa waktu ala ANBK */}
              <div className="border-b border-border bg-surface px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden className="mono flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-canvas text-xs font-bold">
                    {profile.name.trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || 'S'}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold leading-tight">{profile.name}</div>
                    <div className="truncate text-[11px] text-muted">
                      {profile.isGuest ? 'Peserta tamu' : profile.sid ? `NIS ${profile.sid}` : 'Peserta'}
                    </div>
                  </div>
                </div>
                {hasDeadline && (
                  <div className="mt-2.5 rounded-md border border-border bg-canvas px-3 py-2 text-center" role="timer" aria-live="off" aria-label={`Sisa waktu ${fmtClock(remainingMs)}`}>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted">Sisa waktu</div>
                    <div className={`timer text-[28px] font-bold leading-tight tabular-nums ${urgent ? 'text-danger' : 'text-primary'}`}>
                      {fmtClock(remainingMs)}
                    </div>
                    <div className="text-[9.5px] text-muted">menit&nbsp;:&nbsp;detik</div>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div>
                  <div className="section-label">Navigasi</div>
                  <h2 className="text-[13px] font-bold">Daftar Soal</h2>
                </div>
                <span className="mono rounded border border-border bg-canvas px-1.5 py-0.5 text-xs font-semibold">
                  {total ? idx + 1 : 0}/{total || '—'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
                  <span>Terjawab</span>
                  <span className="mono font-semibold text-text">{answeredCount}/{total}</span>
                </div>
                <div className="progress mb-3" aria-hidden>
                  <span style={{ width: `${total ? (answeredCount / total) * 100 : 0}%` }} />
                </div>

                <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Nomor soal">
                  {qs.map((qq, i) => (
                    <button
                      key={qq.id}
                      type="button"
                      className={qnavCls(i, qq.id)}
                      onClick={() => setIdx(i)}
                      aria-label={`Soal ${i + 1} — ${filled(qq.id) ? 'terjawab' : flagged[qq.id] ? 'ragu-ragu' : 'belum dijawab'}${i === idx ? ', sedang dibuka' : ''}`}
                      aria-current={i === idx ? 'true' : undefined}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-border pt-3 text-[11px] text-muted">
                  <LegendBar tone="answered" label="Terjawab" count={answeredCount} />
                  <LegendBar tone="flag" label="Ragu-ragu" count={flagCount} />
                  <LegendBar tone="clear" label="Kosong" count={Math.max(0, total - answeredCount)} />
                  <LegendBar tone="active" label="Dibuka" />
                </div>
              </div>

              <div className="border-t border-border p-3">
                <button type="button" className="btn btn-dark btn-block" onClick={() => setConfirmOpen(true)} disabled={locked}>
                  <IconCheck size={16} />
                  Selesai Ujian
                </button>
                <p className="mt-1.5 text-center text-[10.5px] leading-snug text-muted">
                  Periksa kembali jawaban sebelum menyerahkan.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* ===================== BAR AKSI BAWAH ===================== */}
      <div className="safe-bottom sticky bottom-0 z-40 shrink-0 border-t border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            className="btn-ghost h-12 shrink-0 justify-center px-3 sm:w-auto"
            disabled={idx <= 0}
            onClick={goPrev}
            aria-label="Soal sebelumnya"
          >
            <IconLeft size={16} />
            <span className="sm:hidden">Kembali</span>
            <span className="hidden sm:inline">Sebelumnya</span>
          </button>

          <button
            type="button"
            onClick={() => q && void toggleFlag(q.id)}
            disabled={locked}
            aria-pressed={Boolean(q && flagged[q.id])}
            className={`inline-flex h-12 min-w-12 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold transition-colors active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 sm:px-3 sm:text-sm ${
              q && flagged[q.id]
                ? 'border-warn-line bg-warn-soft text-warn'
                : 'border-border-strong bg-surface text-muted hover:bg-canvas hover:text-text'
            }`}
          >
            <IconFlag size={15} />
            <span className="sm:hidden">Ragu</span>
            <span className="hidden sm:inline">Ragu-ragu</span>
          </button>

          <div className="flex flex-1 items-center justify-center gap-2">
            <span className="mono hidden text-xs text-muted sm:block">Soal</span>
            <span className="mono rounded border border-border bg-canvas px-2 py-0.5 text-xs font-bold">{total ? idx + 1 : 0}/{total || '—'}</span>
            <span className="hidden text-xs text-muted md:block">· {answeredCount} terjawab</span>
          </div>

          {isLast ? (
            <button type="button" className="btn btn-primary h-12 shrink-0 px-3" onClick={() => setConfirmOpen(true)} disabled={locked}>
              <IconCheck size={16} />
              <span className="hidden sm:inline">Selesaikan Ujian</span>
              <span className="sm:hidden">Selesai</span>
            </button>
          ) : (
            <button type="button" className="btn btn-primary h-12 shrink-0 px-3" disabled={locked} onClick={goNext} aria-label="Soal berikutnya">
              <span className="sm:hidden">Lanjut</span>
              <span className="hidden sm:inline">Selanjutnya</span>
              <IconRight size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ===================== PETA SOAL (sheet mobile) ===================== */}
      <Modal open={sheet} onClose={() => setSheet(false)} title="Daftar Soal">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Terjawab <b className="mono text-text">{answeredCount}</b> dari <b className="mono text-text">{total}</b></span>
          <span>Ragu <b className="mono text-warn">{flagCount}</b></span>
        </div>
        <div className="progress">
          <span style={{ width: `${total ? (answeredCount / total) * 100 : 0}%` }} />
        </div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8" role="group" aria-label="Daftar nomor soal">
          {qs.map((qq, i) => (
            <button
              key={qq.id}
              type="button"
              className={qnavCls(i, qq.id)}
              onClick={() => { setIdx(i); setSheet(false) }}
              aria-label={`Soal ${i + 1} — ${filled(qq.id) ? 'terjawab' : flagged[qq.id] ? 'ragu-ragu' : 'belum dijawab'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted">
          <LegendBar tone="answered" label="Terjawab" count={answeredCount} />
          <LegendBar tone="flag" label="Ragu-ragu" count={flagCount} />
          <LegendBar tone="clear" label="Kosong" count={Math.max(0, total - answeredCount)} />
          <LegendBar tone="active" label="Sedang dibuka" />
        </div>
        <button type="button" className="btn btn-dark btn-block" disabled={locked} onClick={() => { setSheet(false); setConfirmOpen(true) }}>
          <IconCheck size={16} /> Selesai &amp; kirim jawaban
        </button>
        <button type="button" className="btn-ghost btn-block" onClick={() => setSheet(false)}>Kembali ke soal</button>
      </Modal>

      {/* ===================== KONFIRMASI AKHIR UJIAN (ala ANBK/TKA) ===================== */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Akhiri Ujian">
        <p className="text-sm text-muted">
          Periksa kembali jawaban Anda — setelah dikirim, jawaban tidak dapat diubah.
        </p>
        <div className="my-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-md border border-border bg-canvas p-2 text-center">
            <div className="mono text-lg font-bold text-primary">{answeredCount}</div>
            <div className="text-[10.5px] text-muted">Terjawab</div>
          </div>
          <div className="rounded-md border border-border bg-canvas p-2 text-center">
            <div className="mono text-lg font-bold text-warn">{flagCount}</div>
            <div className="text-[10.5px] text-muted">Ragu-ragu</div>
          </div>
          <div className="rounded-md border border-border bg-canvas p-2 text-center">
            <div className="mono text-lg font-bold text-danger">{Math.max(0, total - answeredCount)}</div>
            <div className="text-[10.5px] text-muted">Belum dijawab</div>
          </div>
          <div className="rounded-md border border-border bg-canvas p-2 text-center">
            <div className="mono text-lg font-bold">{total}</div>
            <div className="text-[10.5px] text-muted">Total soal</div>
          </div>
        </div>
        {total - answeredCount > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-warn-line bg-warn-soft p-2 text-[12.5px] text-warn" role="status">
            <IconAlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>Masih ada <b>{total - answeredCount} soal belum dijawab</b>. Soal kosong dinilai salah.</span>
          </p>
        )}
        <div className="space-y-2">
          <button
            type="button"
            className="btn btn-dark btn-block btn-lg"
            onClick={() => { setConfirmOpen(false); void finish() }}
          >
            <IconCheck size={16} /> Ya, kirim jawaban
          </button>
          <button type="button" className="btn-ghost btn-block" onClick={() => setConfirmOpen(false)}>
            Kembali mengerjakan
          </button>
        </div>
      </Modal>

      {/* peringatan pelanggaran (AC-8+ FR-5.8) */}
      {violate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 text-center shadow-sm" role="alertdialog" aria-modal="true" aria-label="Peringatan pelanggaran tata tertib">
            <span aria-hidden className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-lg border border-danger-line bg-danger-soft text-danger">
              <IconAlertCircle size={22} />
            </span>
            <h2 className="text-base font-bold">Pelanggaran ke-{violate.n}</h2>
            <p className="mt-1 text-sm text-muted">
              Kamu keluar dari halaman ujian lebih dari {rules.tolerance_seconds ?? 3} detik.
              {violate.left > 0
                ? ` Sisa kesempatan sebelum ujian dilaporkan: ${violate.left}.`
                : ' Kamu sudah dilaporkan ke pengawas.'}
            </p>
            <button type="button" className="btn btn-primary btn-block mt-4" onClick={() => setViolate(null)}>
              Saya mengerti — lanjutkan
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- fragmen kecil ------------------------------- */

function stimContent(q: FetchedQuestion): string | null {
  if (typeof q.stimulus === 'string') return q.stimulus || null
  if (q.stimulus && typeof q.stimulus === 'object') return q.stimulus.content ?? null
  return null
}

function stimTitle(q: FetchedQuestion): string | undefined {
  if (q.stimulus && typeof q.stimulus === 'object' && q.stimulus.title) return q.stimulus.title
  return undefined
}

function LegendBar({ tone, label, count }: { tone: 'answered' | 'flag' | 'clear' | 'active'; label: string; count?: number }) {
  const style =
    tone === 'answered'
      ? { background: 'var(--c-success-bg)', borderColor: 'var(--c-success-bg)' }
      : tone === 'flag'
        ? { background: 'var(--c-warn-bg)', borderColor: 'var(--c-warn-bg)' }
        : { background: 'var(--c-surface)', borderColor: 'var(--c-border-strong)' }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="legend-dot"
        style={tone === 'active' ? { ...style, boxShadow: '0 0 0 2px var(--c-surface), 0 0 0 3.5px var(--c-primary)' } : style}
      />
      <span className="truncate">{label}</span>
      {typeof count === 'number' && <span className="mono ml-auto font-semibold text-text">{count}</span>}
    </span>
  )
}
