// Wrapper API khusus Area Siswa — semua pemanggilan lewat api() (Bearer otomatis
// + refresh), di-satukan di sini agar halaman tidak fetch manual.
import { api, API_BASE, setTokens, clearTokens, getAccessToken } from '@/lib/api'
import type { FetchedQuestion, McqOption, StudentExam } from '../types'

/**
 * Normalisasi soal 'matching': backend mengirim `options` mentah berupa
 * {left: ["Indonesia",...], right: ["Jakarta",...]} (array teks), sedangkan
 * komponen siswa membaca `q.left`/`q.right` berupa [{id, text}].
 * id = teks asli sehingga jawaban pasangan yang tersimpan ({teksKiri: teksKanan})
 * langsung sesuai format penilaian server (grading membaca map/pairs teks).
 */
export function normalizeQuestions(qs: FetchedQuestion[] | undefined | null): FetchedQuestion[] {
  if (!Array.isArray(qs)) return []
  return qs.map(q => {
    if (q.type !== 'matching') return q
    if (Array.isArray(q.left) && Array.isArray(q.right)) return q
    const o = q.options as unknown as { left?: unknown[]; right?: unknown[] } | undefined
    const toItems = (arr: unknown[] | undefined, prefix: string): McqOption[] =>
      (arr ?? []).map((v, i) => {
        if (typeof v === 'string') return { id: v, text: v }
        const d = (v ?? {}) as Record<string, unknown>
        return { id: String(d.id ?? `${prefix}${i + 1}`), text: String(d.text ?? '') }
      })
    return { ...q, left: toItems(o?.left, 'L'), right: toItems(o?.right, 'R') }
  })
}

export interface LoginResponse {
  access_token: string
  refresh_token?: string
  expires_at?: string
  student?: { id: string; name?: string; username?: string; class_id?: string; class_name?: string; nis?: string }
  [k: string]: unknown
}

export interface MeExams {
  upcoming: StudentExam[]
  open: StudentExam[]
  done: StudentExam[]
}

/** Simpan sesi siswa (access + refresh) — WAJIB dipanggil setelah login sukses,
 * agar api() membawa Bearer token (sebelumnya token tak pernah disimpan). */
export function persistSession(r: Pick<LoginResponse, 'access_token' | 'refresh_token'>): void {
  if (!r || !r.access_token) return
  clearTokens() // buang sisa sesi lama agar tidak tercampur
  setTokens(r.access_token, r.refresh_token ?? '')
}

/** Login siswa dengan akun: username / NIS / kode siswa + password. */
export async function studentLogin(username: string, password: string): Promise<LoginResponse> {
  const r = await api<LoginResponse>('/student/auth/login', { method: 'POST', body: { username, password } })
  persistSession(r)
  return r
}

/** Login tanpa akun (peserta tamu): data diri + kode ujian + token.
 * Bila `card_number` (nomor peserta pada kartu ujian) diisi, identitas diambil
 * otomatis dari kartu — nama/JK/kelas/NIS tak perlu diisi manual. */
export async function guestLogin(input: {
  exam_code: string
  token: string
  card_number?: string
  name?: string
  gender?: string
  class_name?: string
  nis?: string
}): Promise<LoginResponse> {
  const r = await api<LoginResponse>('/student/auth/guest', { method: 'POST', body: input })
  persistSession(r)
  return r
}

export interface CardLookup {
  matched: boolean
  card_number: string
  name: string
  nis: string
  gender: string
  class_name: string
  student_code: string
}

/** Lookup nomor kartu ujian: POST /student/auth/card-lookup — untuk mengisi
 * form login otomatis (identitas terdeteksi dari nomor peserta). */
export async function cardLookup(examCode: string, token: string, cardNumber: string): Promise<CardLookup> {
  const r = await api<{ data: CardLookup }>('/student/auth/card-lookup', {
    method: 'POST',
    body: { exam_code: examCode, token, card_number: cardNumber },
  })
  return (r as { data: CardLookup }).data
}

/** Daftar ujian siswa: GET /student/me/exams. */
export async function myExams(): Promise<MeExams> {
  const r = await api<{ upcoming?: StudentExam[]; open?: StudentExam[]; done?: StudentExam[] }>(
    '/student/me/exams',
  )
  const d = (r && typeof r === 'object' && 'data' in r ? (r as { data?: MeExams }).data : r) ?? {}
  return {
    upcoming: d.upcoming ?? [],
    open: d.open ?? [],
    done: d.done ?? [],
  }
}

/** Detail satu ujian (aturan/summary) untuk halaman start.
 * Bisa melempar (jaringan/HTTP) — pemanggil yang menampilkan pesan. */
export async function examDetail(examId: string): Promise<Record<string, unknown> | null> {
  const r = await api<{ data?: Record<string, unknown> }>(`/student/exams/${examId}`)
  return (r as { data?: Record<string, unknown> })?.data ?? (r as unknown as Record<string, unknown>) ?? null
}

/* ---------------------- normalisasi waktu server ---------------------- */

/** Ubah waktu server (RFC3339 string | epoch detik/ms) → epoch milidetik.
 * Mengembalikan 0 bila tidak bisa diparse (pemanggil memakai fallback). */
export function toEpochMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v) // detik → ms
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Date.parse(v)
    if (Number.isFinite(parsed)) return parsed
    const n = Number(v)
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
  }
  return 0
}

/** Hasil start/resume ujian — waktu SUDAH dinormalisasi ke epoch ms. */
export interface StartExamResult {
  attempt_id: string
  /** deadline epoch ms (0 bila server tidak mengirim) */
  deadline_at: number
  /** waktu mulai epoch ms (fallback: now klien) */
  started_at: number
  /** server_time - now klien saat respons diterima (ms; + = server di depan) */
  server_offset_ms: number
  package: Record<string, unknown>
}

/** POST /student/exams/{id}/start {token}.
 * deadline_at/started_at dari server berupa string RFC3339 — dinormalisasi
 * di sini ke epoch ms agar timer klien tidak pernah NaN (FR-7.5). */
export async function startExam(examId: string, token: string): Promise<StartExamResult> {
  const r = await api<{
    attempt_id: string
    deadline_at?: number | string
    started_at?: number | string | null
    server_time?: number | string
    package?: Record<string, unknown>
  }>(`/student/exams/${examId}/start`, { method: 'POST', body: { token } })

  const serverNow = toEpochMs(r.server_time)
  return {
    attempt_id: r.attempt_id,
    deadline_at: toEpochMs(r.deadline_at),
    started_at: toEpochMs(r.started_at) || Date.now(),
    server_offset_ms: serverNow ? serverNow - Date.now() : 0,
    package: (r.package ?? (r as unknown as Record<string, unknown>)) || {},
  }
}

/** POST /attempts/{id}/submit {client_event_id} — idempoten via event id. */
export async function submitAttempt(attemptId: string, client_event_id: string): Promise<void> {  await api(`/attempts/${attemptId}/submit`, { method: 'POST', body: { client_event_id } })
}

/** POST /attempts/{id}/violations — pelanggaran anti-cheat. */
export async function reportViolation(
  attemptId: string,
  payload: { type: string; started_at: string; duration_ms: number; client_event_id: string },
): Promise<{ violations?: number; warn_left?: number; should_auto_submit?: boolean; cheating_status?: string } | undefined> {
  try {
    return await api<NonNullable<unknown>>(`/attempts/${attemptId}/violations`, {
      method: 'POST',
      body: payload,
    }) as { violations?: number; warn_left?: number }
  } catch (e) {
    // Pelanggaran tetap tersimpan di antrean — akan disinkron saat online (FR-7.4)
    if ((e as { status?: number })?.status === 401) throw e
    return undefined
  }
}

/** POST /attempts/{id}/snapshots — multipart via fetch manual.
 * api() melakukan JSON.stringify pada body, sehingga FormData TIDAK boleh
 * lewat sana; di sini biarkan browser men set Content-Type + boundary. */
export async function postSnapshotForm(attemptId: string, fd: FormData, timeoutMs = 30_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const token = getAccessToken()
  try {
    return await fetch(`${API_BASE}/attempts/${attemptId}/snapshots`, {
      method: 'POST',
      // TIDAK meng set Content-Type — browser yang men set multipart boundary.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/** POST /attempts/{id}/snapshots (FormData photo) — bila online. */
export async function uploadSnapshot(attemptId: string, formData: FormData): Promise<void> {
  const res = await postSnapshotForm(attemptId, formData)
  if (!res.ok) throw { status: res.status, code: 'UPLOAD_FAILED', message: `Gagal unggah snapshot (${res.status})` }
}

/** GET hasil pengerjaan (nilai + rincian bila diizinkan guru). */
export async function getMyResult(
  attemptId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const r = await api<{ data?: Record<string, unknown> }>(`/attempts/${attemptId}/result`)
    return (r as { data?: Record<string, unknown> })?.data ?? (r as unknown as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

/** Bentuk respons GET /attempts/{id} — waktu SUDAH epoch ms (FR-7.8). */
export interface ServerAttemptView {
  attempt?: {
    id?: string
    status?: string
    started_at?: number
    deadline_at?: number
    [k: string]: unknown
  }
  answers?: Record<string, unknown>
  flags?: Record<string, unknown>
  rules?: Record<string, unknown>
  package?: { questions?: unknown[]; explain_visible?: boolean }
  /** server_time - now klien saat respons diterima (ms) */
  server_offset_ms: number
  [k: string]: unknown
}

/** GET /attempts/{id} — pemulihan paket + jawaban ter-ACK dari server (FR-7.8).
 * deadline_at/started_at dinormalisasi ke epoch ms + server_offset_ms. */
export async function getServerAttempt(attemptId: string): Promise<ServerAttemptView> {
  const r = await api<{ data?: Record<string, unknown> }>(`/attempts/${attemptId}`)
  const v = (((r as { data?: Record<string, unknown> })?.data ?? r) ?? {}) as Record<string, unknown>

  const rawAttempt = (v.attempt ?? {}) as Record<string, unknown>
  const attempt: ServerAttemptView['attempt'] = {
    ...rawAttempt,
    status: typeof rawAttempt.status === 'string' ? rawAttempt.status : undefined,
    started_at: toEpochMs(rawAttempt.started_at) || undefined,
    deadline_at: toEpochMs(rawAttempt.deadline_at) || undefined,
  }
  const serverNow = toEpochMs(v.server_time)
  return {
    ...v,
    attempt,
    answers: (v.answers ?? {}) as Record<string, unknown>,
    flags: (v.flags ?? {}) as Record<string, unknown>,
    server_offset_ms: serverNow ? serverNow - Date.now() : 0,
  }
}

/** POST /attempts/{id}/submit offline-safe: return true bila terkirim. */
export async function submitSafe(attemptId: string): Promise<boolean> {
  try {
    await submitAttempt(attemptId, uuidLocal())
    return true
  } catch (e) {
    const st = (e as { status?: number })?.status
    if (st && st !== 401 && st !== 409 && st !== 410) return false
    if (!navigator.onLine) return false
    // ATTEMPT_NOT_ACTIVE dsb → cek hasil, mungkin sudah tersubmit (idempoten)
    if (st === 409 || st === 410) return true
    return false
  }
}

function uuidLocal(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'ev-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}
