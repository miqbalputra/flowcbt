// Attempt runner (/s/attempt/:id) — ENGIN UJIAN SISWA, layout split-panel
// gaya ujian nasional (directive §2). REFACTOR LAYOUT+INTERAKSI: mesin
// offline-first TIDAK berubah —
// - Jawaban ditulis SEGERA ke IndexedDB (queue event, seq monoton) — FR-7.3.
// - Engine sync (lib/sync.ts) mengirim batch saat online; status sinkron di
//   header memakai getEngineState/subscribeSync (FR-7.4, AC-2/AC-3).
// - Timer memakai deadline_at server + server_offset (epoch ms) — FR-7.5.
// - Merge recovery dgn getQueuedQuestionIds — FR-7.8.
// - Anti-cheat listeners (visibility/blur/fullscreen) — FR-5.8A (AC-1..AC-12).
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
import { IconAlertCircle, IconCheck, IconFlag, IconGrid, IconLeft, IconRight } from '@/components/icons'
import { toast } from '@/components/toast'
import { renderSimpleHtml } from '@/lib/sanitize'
import { LogoMark } from '@/components/icons'
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

/** Skala font 3 langkah (directive §A): 14 / 16 / 18 px. */
const FS_STEPS = [14, 16, 18] as const
const FS_KEY = 'flowcbt.fsz'

const TYPE_LABEL: Record<string, string> = {
  mcq: 'Pilihan Ganda',
  mcq_complex: 'PG Kompleks',
  matching: 'Menjodohkan',
  short_answer: 'Isian',
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
  const [violate, setViolate] = useState<{ n: number; left: number } | null>(null)
  const [locked, setLocked] = useState(false)
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
    getAttempt(id).then(r0 => {
      if (!alive) return
      if (!r0) {
        toast('Data ujian tidak ditemukan di perangkat ini.', 'error')
        nav('/s/exams', { replace: true })
        return
      }
      // Normalisasi data lama: deadline_at/started_at dari build sebelumnya bisa
      // masih berupa string RFC3339 — pastikan epoch ms agar timer tak NaN (FR-7.5).
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
      // merge data server saat online: server = sumber kebenaran yang sudah ACK (FR-7.8)
      void mergeFromServer(r)
    })
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

  const qs: FetchedQuestion[] = rec?.questions ?? []
  const q = qs[Math.min(idx, Math.max(0, qs.length - 1))]
  const profile: StudentProfile = rec?.profile ?? getProfile()

  // Waktu server = acuan (FR-7.5): deadline server dikoreksi offset jam klien
  const deadlineEff = rec?.deadline_at ? rec.deadline_at - (rec.server_offset || 0) : 0
  const remainingMs = deadlineEff ? deadlineEff - now : 0
  const expired = (deadlineEff > 0 && remainingMs <= 0) || rec?.status === 'expired'

  const saveAnswer = useCallback(
    async (qid: string, val: AnswerValue) => {
      if (locked || expired) return // AC-x: jawaban tak bisa berubah setelah final
      setAnswers(p => ({ ...p, [qid]: val }))
      setDirty(p => ({ ...p, [qid]: true }))
      // tulis event antrean — engine sync mengirim saat online (FR-7.3)
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

  // FLAG ragu-ragu — terkirim sebagai event 'flag' agar tetap disimpan (FR-6.3)
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

  // RECOVERY + merge server bila online (FR-7.8) — dipertahankan apa adanya.
  async function mergeFromServer(r: AttemptRecord) {
    if (!navigator.onLine) return
    try {
      const v = await getServerAttempt(id)
      if (!v) return
      const rr = v as ServerAttemptView
      // deadline & offset kekal ke yang terbaru dari server (sudah epoch ms)
      const dl = rr.attempt?.deadline_at ?? 0
      const offset = rr.server_offset_ms || 0
      if ((dl && (!r.deadline_at || Math.abs(dl - r.deadline_at) > 60_000)) || (offset && offset !== r.server_offset)) {
        const next: AttemptRecord = { ...r, deadline_at: dl || r.deadline_at, server_offset: offset || r.server_offset }
        await saveAttempt(next)
        setRec(next)
      }
      // Cek antrean: soal yang masih punya event belum-ACK berarti versi LOKAL
      // lebih baru daripada snapshot server → JANGAN ditimpa (FR-7.8). Hanya
      // jawaban tanpa event antrean yang boleh disamakan dengan server.
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
          if (queuedQids.has(qid)) continue // ada event lokal belum ACK → pertahankan
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

  // AUTO-SUBMIT saat waktu habis (FR-6.5) — deadline efektif = server − offset
  useEffect(() => {
    if (!rec || locked) return
    const dl = rec.deadline_at ? rec.deadline_at - (rec.server_offset || 0) : 0
    if (dl && Date.now() > dl) void finish(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, rec, locked])

  // Selesai → halaman konfirmasi/review (FR-6.5). OFFLINE tetap boleh (FR-7.6).
  async function finish(auto = false) {
    if (!rec) return
    if (rec && rec.status === 'in_progress') {
      // AC-4: antrekan event SUBMIT lebih dulu — bila offline, flush berikutnya
      // yang mengirimkannya sehingga attempt tetap final di server (FR-7.6).
      await enqueueSubmit(id)
      await saveAttempt({ ...rec, status: 'submitted' })
    }
    kick() // dorong sync terakhir
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
      if (awayRef.current) return // sudah terhitung keluar
      awayRef.current = { startedAt: Date.now(), type }
    }
    async function backOnline() {
      const away = awayRef.current
      awayRef.current = null
      if (!away || locked) return
      const dur = Date.now() - away.startedAt
      if (dur < tol) return // dalam toleransi — tidak dihitung (PRD 5.8)
      if (Date.now() - lastViolationAt.current < 1500) return // dedupe
      lastViolationAt.current = Date.now()
      const evId = uuid()
      const res = await reportViolation(id, {
        type: away.type,
        started_at: new Date(away.startedAt).toISOString(),
        duration_ms: dur,
        client_event_id: evId,
      })
      if (res === undefined) {
        // offline → antrean event violation, tersinkron nanti (FR-7.4/5.8)
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
    // Keluar fullscreen = mulai dihitung "keluar"; masuk kembali fullscreen =
    // selesai (durasi keluar dihitung, bukan null-op).
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

  /* ============================ KEYBOARD (directive §2B) ============================ */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (sheet) {
        if (e.key === 'Escape') setSheet(false)
        return // selagi sheet terbuka, tombol pintas soal dilumpuhkan
      }
      if (typing || locked) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return // biarkan shortcut browser (mis. Ctrl+R)
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
        // PG kompleks: tekan tambah/hapus pilihan (toggle, FR-6.3)
        const arr: string[] = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : []
        void saveAnswer(q.id, arr.includes(opt.id) ? arr.filter(x => x !== opt.id) : [...arr, opt.id])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, locked, qs.length, q, id, answers, saveAnswer, toggleFlag])

  const fsVal = FS_STEPS[Math.min(Math.max(0, fsStep), FS_STEPS.length - 1)]

  if (!rec) {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg text-text">
        <p className="animate-pulse text-sm text-muted">Menyiapkan soal…</p>
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

  // Warna huruf di kartu peta soal — pakai kelas .q-nav* dari styles.css (§2C)
  const qnavCls = (qi: number, qid: string) => {
    const f = flagged[qid]
    const filled = (() => {
      const v = answers[qid]
      return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== ''
    })()
    return `q-nav ${filled ? 'q-nav-answered' : f ? 'q-nav-flag' : 'q-nav-clear'}${qi === idx ? ' q-nav-active' : ''}`
  }

  return (
    <div className="flex min-h-full flex-col overflow-x-hidden bg-bg text-text">
      {/* ================= HEADER UTILITAS 56px (sticky) — directive §A ================= */}
      <header className="sticky top-0 z-40 shrink-0 border-b border-border bg-surface">
        <div className="relative mx-auto flex h-14 w-full items-center gap-2 px-3">
          {/* kiri: logo (desktop) + peta soal (mobile) */}
          <span className="hidden shrink-0 md:block" aria-hidden><LogoMark size={20} /></span>
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-label="Buka peta soal"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface text-text active:scale-[0.99] lg:hidden"
          >
            <IconGrid size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-bold leading-tight sm:text-base">{rec.exam_name}</h1>
              {rec.exam_code && (
                <span className="hidden shrink-0 rounded border border-border bg-canvas px-1 font-mono text-[10px] font-semibold tracking-wider text-muted sm:inline">
                  {rec.exam_code}
                </span>
              )}
              <span className="hidden md:block"><ConnStatus /></span>
            </div>
            <div className="truncate text-[11px] text-muted">
              Soal {qs.length ? idx + 1 : 0}/{qs.length || '—'}
              {rules.anti_cheat_enabled ? ' · Tata tertib aktif' : ''}
            </div>
          </div>

          {/* tengah (desktop): countdown — font-mono text-xl, <=5 menit warn merah */}
          {hasDeadline && (
            <div
              role="timer"
              aria-live="off"
              aria-label={`Sisa waktu ${fmtClock(remainingMs)}`}
              className="absolute left-1/2 hidden -translate-x-1/2 font-mono text-xl font-bold tabular-nums lg:block"
              style={{ color: urgent ? 'var(--c-danger)' : 'var(--c-text)' }}
            >
              {fmtClock(remainingMs)}
            </div>
          )}

          {/* kanan: timer (mobile) + kontrol teks + tema + profil */}
          <div className="flex shrink-0 items-center gap-1.5">
            {hasDeadline && (
              <span
                role="timer"
                aria-live="off"
                className={`font-mono text-lg font-bold tabular-nums lg:hidden ${urgent ? 'text-danger' : 'text-text'}`}
              >
                {fmtClock(remainingMs)}
              </span>
            )}
            {/* kontrol ukuran teks [A-][100%][A+] — tombol 32px (desktop betulan; mobile baris utilitas) */}
            <div className="hidden items-center rounded-md border border-border bg-canvas lg:flex" role="group" aria-label="Ukuran teks soal">
              <button
                type="button"
                aria-label="Perkecil teks"
                disabled={fsStep <= 0}
                onClick={() => setFsStep(s => Math.max(0, s - 1))}
                className="h-8 w-8 rounded-l-md font-mono text-xs font-bold hover:bg-surface disabled:opacity-40"
              >A−</button>
              <button
                type="button"
                aria-label="Kembalikan ukuran standar"
                onClick={() => setFsStep(1)}
                className="h-8 w-12 font-mono text-[11px] text-muted hover:bg-surface"
              >{Math.round((FS_STEPS[fsStep] / 16) * 100)}%</button>
              <button
                type="button"
                aria-label="Perbesar teks"
                disabled={fsStep >= FS_STEPS.length - 1}
                onClick={() => setFsStep(s => Math.min(FS_STEPS.length - 1, s + 1))}
                className="h-8 w-8 rounded-r-md font-mono text-sm font-bold hover:bg-surface disabled:opacity-40"
              >A+</button>
            </div>
            <div className="hidden lg:block"><ThemeToggle /></div>
            <ProfilePill profile={profile} />
          </div>
        </div>
      </header>

      {/* baris utilitas mobile: status sinkron + kontrol teks + tema */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5 lg:hidden">
        <ConnStatus short />
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border bg-canvas" role="group" aria-label="Ukuran teks soal">
            <button type="button" aria-label="Perkecil teks" disabled={fsStep <= 0}
              onClick={() => setFsStep(s => Math.max(0, s - 1))}
              className="h-8 w-8 rounded-l-md font-mono text-xs font-bold active:scale-[0.98] disabled:opacity-40">A−</button>
            <button type="button" aria-label="Kembalikan ukuran standar" onClick={() => setFsStep(1)}
              className="h-8 w-11 font-mono text-[11px] text-muted active:scale-[0.98]">{Math.round((FS_STEPS[fsStep] / 16) * 100)}%</button>
            <button type="button" aria-label="Perbesar teks" disabled={fsStep >= FS_STEPS.length - 1}
              onClick={() => setFsStep(s => Math.min(FS_STEPS.length - 1, s + 1))}
              className="h-8 w-8 rounded-r-md font-mono text-sm font-bold active:scale-[0.98] disabled:opacity-40">A+</button>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {expired && (
        <p role="status" className="mx-3 mt-3 rounded-lg border text-sm" style={{ borderColor: 'var(--c-danger)', background: 'var(--c-danger-soft)', color: 'var(--c-danger)' }}>
          Waktu pengerjaan habis — jawaban dikirim otomatis.
        </p>
      )}

      {/* ================= BODY SPLIT — kolom konten | panel opsi (directive §A) ================= */}
      <main className="grid w-full flex-1 grid-cols-1 items-start lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* kolom kiri: AREA KONTEN — stimulus pelipat + body soal */}
        <section className="min-w-0 px-4 pb-6 pt-4 lg:border-r lg:border-border">
          <div className="mx-auto max-w-prose" style={{ fontSize: fsVal, lineHeight: 1.6 }}>
            {q && <StimulusCard text={stimContent(q)} />}
            {q ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center justify-center rounded-md border border-border-strong bg-canvas px-2 font-mono text-xs font-bold"
                    title={`Nomor soal ${idx + 1}`}
                  >
                    No. {idx + 1}
                  </span>
                  <span className="badge badge-soft">{TYPE_LABEL[q.type] ?? 'Soal'}</span>
                  {flagged[q.id] && (
                    <span className="badge" style={{ background: 'var(--c-warn-soft)', color: 'var(--c-warn)', borderColor: 'var(--c-warn)' }}>
                      <IconFlag size={12} />
                      Ditandai ragu
                    </span>
                  )}
                </div>
                <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(q.body ?? '')) }} />
              </>
            ) : (
              <p className="text-sm text-muted">Soal tidak tersedia.</p>
            )}
            {/* petunjuk keyboard — desktop saja (directive §2B) */}
            <p className="hidden pt-4 font-mono text-xs text-muted lg:block">
              Navigasi: ← → · Pilih: A–E · Ragu: R
            </p>
          </div>
        </section>

        {/* kolom kanan (lg+): panel opsi + navigasi; mobile turun ke bawah konten */}
        <aside className="border-t border-border bg-surface lg:sticky lg:top-14 lg:self-start lg:border-t-0">
          <div className="p-4" style={{ fontSize: fsVal, lineHeight: 1.6 }}>
            {locked && (
              <p className="mb-3 rounded-lg border border-border bg-canvas p-2 text-xs">
                Ujian sudah dikirim — jawaban tidak dapat diubah.
              </p>
            )}
            {q ? (
              <QuestionView
                q={q}
                value={answers[q.id] ?? null}
                onChange={v => void saveAnswer(q.id, v)}
                disabled={locked || expired}
              />
            ) : (
              <p className="text-sm text-muted">Soal tidak tersedia.</p>
            )}

            {/* navigasi cepat di panel opsi (desktop saja, action bar tetap ada) */}
            <div className="mt-4 hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 border-t border-border pt-3 lg:grid">
              <button type="button" className="btn-ghost" disabled={idx <= 0} onClick={goPrev} aria-label="Soal sebelumnya">
                <IconLeft size={16} />
              </button>
              <button type="button" className="btn-ghost" onClick={() => setSheet(true)} aria-label="Buka peta soal" title="Peta soal">
                <IconGrid size={15} />
                <span className="font-mono">{idx + 1}/{qs.length || '—'}</span>
              </button>
              <button type="button" className="btn-ghost" disabled={idx >= qs.length - 1} onClick={goNext} aria-label="Soal berikutnya">
                <IconRight size={16} />
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* ================= ACTION BAR sticky bawah 64px — directive §A ================= */}
      <div className="safe-bottom sticky bottom-0 z-40 shrink-0 border-t border-border bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-3">
          <button
            type="button"
            className="btn-ghost shrink-0"
            disabled={idx <= 0}
            onClick={goPrev}
            aria-label="Soal sebelumnya"
          >
            <IconLeft size={16} />
            <span className="hidden min-[400px]:inline">Sebelumnya</span>
          </button>

          {/* toggle RAGU — state amber (ikone catalan flag; border/teks warn saat aktif) */}
          <button
            type="button"
            onClick={() => q && void toggleFlag(q.id)}
            disabled={locked}
            aria-pressed={Boolean(q && flagged[q.id])}
            className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45
              ${q && flagged[q.id]
                ? 'border-warn bg-warn-soft text-warn'
                : 'border-border-strong bg-surface hover:bg-canvas'}`}
          >
            <IconFlag size={15} />
            <span className="hidden min-[400px]:inline">Ragu</span>
          </button>

          <span className="flex-1" />

          {isLast ? (
            <button type="button" className="btn-primary shrink-0" onClick={() => void finish()}>
              <IconCheck size={16} />
              <span className="hidden min-[400px]:inline">Selesaikan</span>
            </button>
          ) : (
            <button type="button" className="btn-primary shrink-0" disabled={locked} onClick={goNext} aria-label="Soal berikutnya">
              <span className="hidden min-[400px]:inline">Selanjutnya</span>
              <IconRight size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ================= PETA SOAL — bottom sheet (role=dialog, aria-modal, Escape) ================= */}
      <Modal open={sheet} onClose={() => setSheet(false)} title="Peta soal">
        <p className="text-sm text-muted">
          Terjawab <b className="font-mono text-text">{answeredCount}</b> dari <b className="font-mono text-text">{qs.length}</b> soal
          {' · '}ragu <b className="font-mono text-warn">{Object.values(flagged).filter(Boolean).length}</b>
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Daftar nomor soal">
          {qs.map((qq, i) => (
            <button
              key={qq.id}
              type="button"
              className={qnavCls(i, qq.id)}
              onClick={() => { setIdx(i); setSheet(false) }}
              aria-label={`Soal ${i + 1} — ${flagged[qq.id] ? 'ditandai ragu' : answers[qq.id] ? 'terjawab' : 'belum dijawab'}${i === idx ? ', sedang dibuka' : ''}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        {/* LEGENDA */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <LegendSwatch cls="q-nav q-nav-answered" label="Terjawab" />
          <LegendSwatch cls="q-nav q-nav-flag" label="Ragu-ragu" />
          <LegendSwatch cls="q-nav q-nav-clear" label="Kosong" />
          <LegendSwatch cls="q-nav q-nav-clear q-nav-active" label="Sedang dibuka" />
        </div>
        <button type="button" className="btn-primary w-full" disabled={locked} onClick={() => void finish()}>
          Selesai &amp; kirim jawaban
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => setSheet(false)}>Tutup</button>
      </Modal>

      {/* peringatan pelanggaran (AC-8+ FR-5.8) */}
      {violate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className="card w-full max-w-sm space-y-2 text-center"
            role="alertdialog"
            aria-modal="true"
            aria-label="Peringatan pelanggaran tata tertib"
          >
            <span
              aria-hidden
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border"
              style={{ borderColor: 'var(--c-danger)', background: 'var(--c-danger-soft)', color: 'var(--c-danger)' }}
            >
              <IconAlertCircle size={22} />
            </span>
            <b>Pelanggaran ke-{violate.n}</b>
            <p className="text-sm text-muted">
              Kamu keluar dari halaman ujian lebih dari {rules.tolerance_seconds ?? 3} detik.
              {violate.left > 0
                ? ` Sisa kesempatan sebelum ujian dilaporkan: ${violate.left}.`
                : ' Kamu sudah dilaporkan ke pengawas.'}
            </p>
            <button type="button" className="btn-primary w-full" onClick={() => setViolate(null)}>
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

function LegendSwatch({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={`${cls} !h-4 !w-4 !cursor-default !text-[8px]`} />
      {label}
    </span>
  )
}

function ProfilePill({ profile }: { profile: StudentProfile }) {
  const name = profile?.name || 'Siswa'
  const initials =
    name.trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || 'S'
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-border bg-canvas py-0.5 pl-0.5 pr-2.5 md:flex"
      title={profile?.isGuest ? `${name} (tamu)` : `${name}${profile?.sid ? ` · NIS ${profile.sid}` : ''}`}
    >
      <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-bg font-mono text-[10px] font-bold text-primary-fg">
        {initials}
      </span>
      <span className="max-w-[8rem] truncate text-xs font-medium">{name}</span>
    </span>
  )
}
