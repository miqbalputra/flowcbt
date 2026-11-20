// Kontrak data Area Siswa — FlowCBT client offline-first (PWA).

export type QuestionType = 'mcq' | 'mcq_complex' | 'matching' | 'short_answer' | 'essay'

export interface McqOption {
  id: string
  text: string
}

/** Soal dari server. Kunci jawaban TIDAK pernah dikirim ke klien (prinsip aman). */
export interface FetchedQuestion {
  id: string
  type: QuestionType
  body: string
  stimulus?: { id?: string; title?: string; content?: string } | string
  points?: number
  options?: McqOption[]
  left?: McqOption[]
  right?: McqOption[]
}

export interface AntiCheatCfg {
  enabled?: boolean
  tolerance_seconds?: number
  warn_threshold?: number
  auto_submit_at?: number
}

/** Paket soal (respons POST start) — bentuk fleksibel, wave-2 backend. */
export interface AttemptPackage {
  attempt_id?: string
  deadline_at?: number
  questions?: FetchedQuestion[]
  exam?: {
    name?: string
    subject_name?: string
    camera_enabled?: boolean
    anti_cheat?: AntiCheatCfg
    require_all_answered?: boolean
    [k: string]: unknown
  }
  name?: string
  subject_name?: string
  [k: string]: unknown
}

/** Satu attempt (persis struktur store "attempts" di IndexedDB). */
export interface AttemptRecord {
  attempt_id: string
  exam_name: string
  subject_name?: string
  questions: FetchedQuestion[]
  deadline_at: number
  server_offset: number
  started_at: number
  status: 'in_progress' | 'submitted' | 'expired'
  profile?: StudentProfile
  flags?: Record<string, boolean>
  answers?: Record<string, unknown>
}

/** Satu baris store "answers" (jawaban terkini per soal). */
export interface AnswerRecord {
  attempt_id: string
  question_id: string
  answer: unknown
  flag: boolean
  seq: number
  dirty: boolean
  updated_at: number
}

/** Baris antrean event sinkron (store "queue"). */
export interface QueueEvent {
  client_event_id: string
  attempt_id: string
  type: 'answer' | 'flag' | 'violation' | 'submit' | 'nav'
  question_id?: string
  payload: Record<string, unknown>
  client_ts: number
  seq: number
}

/** Baris antrean event sinkron (store "queue") = QueueEvent. */
export type QueueRow = QueueEvent

/** Profil siswa yang sedang login (versi ringan untuk UI). */
export interface StudentProfile {
  id?: string
  sid?: string
  name: string
  isGuest?: boolean
}

/** Daftar ujian siswa — GET /student/me/exams. */
export interface StudentExam {
  id: string
  name: string
  subject_name?: string
  exam_code?: string
  open_at?: string
  close_at?: string
  duration_minutes?: number
  attempts_used?: number
  max_attempts?: number
  best_score?: number | null
  active_attempt_id?: string
  scheduled_at?: string
  [k: string]: unknown
}

/** Bentuk fleksibel; getter membaca via util.pick agar tahan perubahan backend. */
export type Loose = Record<string, unknown>

export function pick<T>(obj: Loose | null | undefined, key: string, def: T): T {
  const v = (obj as Loose | undefined)?.[key]
  return (v === undefined || v === null ? def : v) as T
}

export function num(obj: Loose | null | undefined, key: string, def: number): number {
  const v = pick<unknown>(obj, key, def)
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : def
}

export function str(obj: Loose | null | undefined, key: string, def: string): string {
  const v = pick<unknown>(obj, key, def)
  return typeof v === 'string' ? v : def
}

export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const hh = Math.floor(total / 3600)
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return hh > 0 ? `${String(hh).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}
