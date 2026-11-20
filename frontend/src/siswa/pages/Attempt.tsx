// Attempt runner (/s/attempt/:id) — inti CBT client offline-first.
// - Jawaban ditulis SEGERA ke IndexedDB (queue event, seq monoton) — FR-7.3.
// - Engine sync (lib/sync.ts) mengirim antrean saat online — FR-7.4.
// - Timer countdown memakai deadline_at server — otoritas waktu server FR-7.5.
// - Anti-cheat listeners (FR-5.8): visibility/blur/fullscreen + toleransi.
// - Flag ragu-ragu tersimpan; pemulihan gabungan lokal+server — FR-7.8.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { QuestionView, type AnswerValue } from '../components/QuestionView'
import { ConnStatus } from '../components/ConnStatus'
import { getAttempt, putAnswer, saveAttempt, getQueuedQuestionIds } from '../db'
import { enqueue, registerAttempt, unregisterAttempt, getEngineState, subscribeSync, uuid, setAttemptStart, kick, enqueueSubmit } from '../lib/sync'
import { reportViolation, getServerAttempt, toEpochMs, type ServerAttemptView } from '../lib/student-api'
import { fmtClock } from '../lib/util'
import { renderSimpleHtml } from '@/lib/sanitize'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SiswaLayout } from '../components/SiswaLayout'
import { toast } from '@/components/toast'
import type { AttemptRecord, FetchedQuestion } from '../types'

type Rules = {
  anti_cheat_enabled?: boolean
  tolerance_seconds?: number
  penalty_points?: number
  max_penalty?: number
  flag_threshold?: number
  auto_submit?: boolean
  camera_enabled?: boolean
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
      registerAttemptDetailed(r)
      // merge data server saat online: server = sumber kebenaran yang sudah ACK (FR-7.8)
      void mergeFromServer(r)
    })
    return () => {
      alive = false
      unregisterAttempt()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function registerAttemptDetailed(r: AttemptRecord) {
    registerAttempt(id)
    // merge jawaban tersimpan lokal
    const a: Record<string, AnswerValue> = {}
    const f: Record<string, boolean> = {}
    for (const q of r.questions ?? []) {
      a[q.id] = (r.answers?.[q.id] ?? null) as AnswerValue
      f[q.id] = Boolean(r.flags?.[q.id])
    }
    setAnswers(a)
    setFlagged(f)
    setLocked(r.status !== 'in_progress')
  }

  // RECOVERY + merge server bila online (FR-7.8)
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
          const qRow = srvAns[qid]
          const curDirty = dirtyRef.current[qid] || queuedQids.has(qid)
          const empty = out[qid] === null || out[qid] === undefined
          if (!curDirty || empty) out[qid] = qRow as AnswerValue
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

  // detak detik
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // bottom sheet daftar soal: Escape menutup (aksesibilitas, FR-11.3)
  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheet(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  // AUTO-SUBMIT saat waktu habis (FR-6.5) — deadline efektif = server − offset
  useEffect(() => {
    if (!rec || locked) return
    const deadlineEff = rec.deadline_at ? rec.deadline_at - (rec.server_offset || 0) : 0
    if (deadlineEff && now > deadlineEff) void finish(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, rec, locked])

  // === ANTI-CHEAT (FR-5.8A) ===
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
      setViolate({ n: res.violations ?? 0, left: res.warn_left ?? 0 })
      if (res.should_auto_submit) {
        toast('Karena pelanggaran berulang, ujianmu otomatis dikirim.', 'warn')
        await finish(true)
      }
    }
    function onVis() { document.hidden ? startAway('tab_hidden') : void backOnline() }
    function onBlur() { void 0; startAway('blur') }
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

  function stimContent(q: FetchedQuestion): string | null {
    if (!q.stimulus) return null
    if (typeof q.stimulus === 'string') return q.stimulus
    return q.stimulus.content ?? null
  }

  const saveAnswer = useCallback(
    async (qid: string, val: AnswerValue) => {
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
    [id],
  )

  // FLAG ragu-ragu — terkirim sebagai event 'flag' agar tetap disimpan (FR-6.3)
  const toggleFlag = useCallback(
    async (qid: string) => {
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
    [id, flagged, answers],
  )

  if (!rec) {
    return (
      <SiswaLayout title="Memuat…">
        <p className="text-center text-muted">Menyiapkan soal…</p>
      </SiswaLayout>
    )
  }

  const qs: FetchedQuestion[] = rec.questions ?? []
  const q = qs[Math.min(idx, Math.max(0, qs.length - 1))]
  // Waktu server = acuan (FR-7.5): deadline server dikoreksi offset jam klien
  // agar countdown benar meski jam perangkat melenceng.
  const deadlineEff = rec.deadline_at ? rec.deadline_at - (rec.server_offset || 0) : 0
  const remainingMs = deadlineEff ? deadlineEff - now : 0
  // tanpa deadline (deadlineEff=0) → tidak dianggap habis waktu
  const expired = (deadlineEff > 0 && remainingMs <= 0) || rec.status === 'expired'

  // Selesai → halaman konfirmasi/review (FR-6.5). OFFLINE tetap boleh (FR-7.6).
  async function finish(auto = false) {
    if (!rec) return
    // AC-4: antrekan event SUBMIT lebih dulu — bila offline, flush berikutnya
    // yang mengirimkannya sehingga attempt tetap final di server (FR-7.6).
    await enqueueSubmit(id)
    await saveAttempt({ ...rec, status: 'submitted' })
    kick() // dorong sync terakhir
    nav(`/s/attempt/${id}/review`, { replace: auto })
  }

  const answeredCount = Object.values(answers).filter(v =>
    Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '',
  ).length

  return (
    <SiswaLayout
      title={rec.exam_name}
      subtitle={`Soal ${(idx % Math.max(1, qs.length)) + 1} dari ${qs.length || '-'} · ${fmtClock(remainingMs)}`}
      headerRight={<ConnStatus />}
    >
      {expired && (
        <p className="mb-3 rounded-lg border border-[var(--c-danger)] p-2 text-sm text-[var(--c-danger)]">
          Waktu pengerjaan sudah habis — mengirim jawaban…
        </p>
      )}
      {rules.anti_cheat_enabled && (
        <p className="mb-2 text-xs text-muted">
          🛡️ Tata tertib aktif: jangan pindah aplikasi/tab; sedang keluar lebih dari {rules.tolerance_seconds ?? 3} detik dicatat.
        </p>
      )}
      {q ? (
        <div className="card mb-4 text-sm leading-relaxed text-muted">
          {stimContent(q) && (
            <details className="mb-2 rounded-lg bg-bg p-2" open>
              <summary className="cursor-pointer font-medium text-text">📖 Wacana</summary>
              <div className="mt-1 whitespace-pre-wrap text-text" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(stimContent(q) || '') }} />
            </details>
          )}
          <div className="whitespace-pre-wrap text-text" dangerouslySetInnerHTML={{ __html: renderSimpleHtml(String(q.body ?? '')) }} />
          <QuestionView
            q={q}
            value={answers[q.id] ?? null}
            onChange={v => void saveAnswer(q.id, v)}
            disabled={locked || expired}
          />
        </div>
      ) : (
        <p className="text-center text-muted">Soal tidak tersedia.</p>
      )}

      {/* navigasi */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <button className="btn-ghost" disabled={idx <= 0} onClick={() => setIdx(i => i - 1)}>
          ←
        </button>
        <button
          className={`btn-ghost ${flagged[q?.id ?? ''] ? 'text-warn' : ''}`}
          onClick={() => q && void toggleFlag(q.id)}
          aria-pressed={Boolean(flagged[q?.id ?? ''])}
          title="Tandai ragu-ragu"
        >
          {flagged[q?.id ?? ''] ? '★ Ragu' : '☆ Ragu'}
        </button>
        <button className="btn-primary" disabled={locked} onClick={() => { setSheet(true) }}>
          Selesai
        </button>
        <button className="btn-ghost" disabled={idx >= qs.length - 1} onClick={() => setIdx(i => i + 1)}>
          →
        </button>
      </div>

      {/* daftar soal (bottom sheet, FR-6.4) */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" onClick={() => setSheet(false)}>
          <div
            className="card w-full rounded-t-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Daftar soal"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <b>Daftar soal</b>
              <span className="text-xs text-muted">✔ terjawab · ? ragu · ○ kosong</span>
            </div>
            <div className="mb-2 text-sm text-muted">
              Terjawab {answeredCount} dari {qs.length}
            </div>
            <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
              {qs.map((qq, i) => {
                const ans = answers[qq.id]
                const filled = Array.isArray(ans) ? ans.length > 0 : ans !== null && ans !== undefined && ans !== ''
                const f = flagged[qq.id]
                const cur = i === idx
                return (
                  <button
                    key={qq.id}
                    aria-label={`Soal ${i + 1}${filled ? ', terjawab' : ', belum dijawab'}${f ? ', diragukan' : ''}`}
                    onClick={() => { setIdx(i); setSheet(false) }}
                    className={`touch-target h-11 rounded-lg border text-sm font-semibold
                      ${cur ? 'border-primary ring-2 ring-primary text-primary' :
                        f ? 'border-warn bg-warn/15 text-warn' :
                          filled ? 'border-success bg-success/15 text-success' :
                            'border-border bg-bg text-muted'}`}
                  >
                    {filled ? '✔' : f ? '?' : '○'}{i + 1}
                  </button>
                )
              })}
            </div>
            <button className="btn-primary w-full" disabled={locked} onClick={() => void finish()}>
              ✅ Selesai &amp; kirim jawaban
            </button>
            <button className="btn-ghost mt-2 w-full" onClick={() => setSheet(false)}>Tutup</button>
          </div>
        </div>
      )}

      {/* peringatan pelanggaran (AC-8) */}
      {violate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card max-w-sm space-y-2 text-center">
            <div className="text-3xl">⚠️</div>
            <b>Pelanggaran ke-{violate.n}</b>
            <p className="text-sm text-muted">
              Kamu keluar dari halaman ujian lebih dari {rules.tolerance_seconds ?? 3} detik.
              {violate.left > 0 ? ` Sisa kesempatan sebelum dilaporkan: ${violate.left}.` : ' Kamu sudah dilaporkan. Hubungi pengawas.'}
            </p>
            <button className="btn-primary w-full" onClick={() => setViolate(null)}>Mengerti — lanjutkan</button>
          </div>
        </div>
      )}
    </SiswaLayout>
  )
}

