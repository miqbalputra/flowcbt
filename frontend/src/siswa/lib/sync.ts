/**
 * Sync engine Area Siswa (FR-7.4, AC-2, AC-3).
 *
 * Antrean event (store "queue" IndexedDB) dikirim batch ≤50 ke
 * POST /attempts/{id}/answers:sync {events, client_elapsed_ms}.
 * Baris dihapus dari antrean HANYA setelah respons 2xx — idempoten via
 * client_event_id sehingga kirim ulang setelah gagal aman (AC-3).
 * Pemicu: aksi siswa (kick), window 'online', dan interval 5 dtk selama
 * runner terpasang (registerAttempt). Foto proktor dikirim SETELAH
 * jawaban bersih (prioritas jawaban, FR-5.8B).
 */
import { api } from '@/lib/api'
import type { QueueRow } from '../db'
import { enqueue as putQueue, getQueueFor, getPendingPhotos, deletePhoto, bumpSeq, trimQueue } from '../db'
import { postSnapshotForm } from './student-api'
import { removeAcked } from './queue'

export interface EngineState {
  online: boolean
  syncing: boolean
  /** jumlah event belum ter-ACK di antrean attempt aktif */
  pending: number
  lastError?: string
  lastAckedAt?: number
}

let state: EngineState = { online: navigatorOnLine(), syncing: false, pending: 0 }

/** UUID v4 — identitas unik per event (idempotensi, AC-3). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random()
    .toString(16)
    .slice(2, 10)}-${Math.random().toString(16).slice(2, 8)}`
}

/** navigator.onLine yang aman untuk dipanggil di mana pun. */
function navigatorOnLine(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}
let currentAttempt = ''
let attemptStartEpoch = 0
let flushTimer: ReturnType<typeof setInterval> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let photoTimer: ReturnType<typeof setInterval> | undefined
let fails = 0

const listeners = new Set<(s: EngineState) => void>()

function setState(p: Partial<EngineState>) {
  state = { ...state, ...p }
  listeners.forEach(cb => cb(getEngineState()))
}

export function getEngineState(): EngineState {
  return { ...state, online: navigatorOnLine() }
}

export function subscribeSync(cb: (s: EngineState) => void): () => void {
  listeners.add(cb)
  cb(getEngineState())
  return () => {
    listeners.delete(cb)
  }
}

/** Sambungkan attempt yang sedang dikerjakan + timer periodik 5 dtk. */
export function registerAttempt(attemptId: string): void {
  currentAttempt = attemptId
  if (!flushTimer) flushTimer = setInterval(() => void flush(), 5000)
  if (!photoTimer) photoTimer = setInterval(() => void drainPhotos(currentAttempt), 30000)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
}

/** Lepas attempt aktif + hentikan semua timer (dipanggil saat unmount). */
export function unregisterAttempt(): void {
  currentAttempt = ''
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = undefined
  }
  if (photoTimer) {
    clearInterval(photoTimer)
    photoTimer = undefined
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
}

/** Simpan waktu mulai attempt (basis client_elapsed_ms FR-7.5). */
export function setAttemptStart(t: number): void {
  attemptStartEpoch = t
}

/** Tambah event ke antrean lalu coba kirim segera (dipanggil tiap aksi siswa).
 * seq di-auto-assign (monoton per attempt, FR-7.3) dan client_ts default now. */
export async function enqueue(evt: QueueRow): Promise<void> {
  if (!evt.seq || evt.seq <= 0) evt.seq = await bumpSeq(evt.attempt_id)
  if (!evt.client_ts) evt.client_ts = Date.now()
  // pertahankan jawaban event di store "answers" (ini juga yang dirender ulang)
  await putQueue(evt)
  await trimQueue(evt.attempt_id) // jaga antrean ≤ batas (buang nav/flag terlama)
  setState({ pending: state.pending + 1 })
  void flush()
}

/** Antrekan event SUBMIT (AC-4, FR-7.6) — dipanggil SEBELUM submitSafe agar
 * submit final tetap sampai server walau offline (dikirim flush berikutnya).
 * Idempoten: tidak menambah bila sudah ada event submit di antrean. */
export async function enqueueSubmit(attemptId: string): Promise<void> {
  const rows = await getQueueFor(attemptId)
  if (rows.some(r => r.type === 'submit')) return
  await enqueue({
    client_event_id: uuid(),
    attempt_id: attemptId,
    type: 'submit',
    payload: { client_elapsed_ms: elapsedMs() },
    client_ts: Date.now(),
    seq: 0,
  })
}

/** Pemicu manual — halaman bisa memanggil setelah aksi penting. */
export function kick(): void {
  void flush()
}

/**
 * Kirim batch ≤50 event. Idempoten: server mengenal client_event_id, jadi
 * dikirim ulang setelah gagal tidak menimbulkan efek ganda (AC-3).
 * Return: true bila antrean jadi bersih.
 */
export async function flush(attemptId = currentAttempt): Promise<boolean> {
  if (!attemptId || state.syncing || !navigatorOnLine()) return false
  setState({ syncing: true })
  try {
    let remaining = (await getQueueFor(attemptId)).length
    if (remaining === 0) {
      // antrean jawaban bersih → foto boleh dikirim sekarang (prioritas jawaban ✓)
      await drainPhotos(attemptId)
      setState({ pending: 0, syncing: false, lastError: undefined })
      return true
    }
    while (remaining > 0) {
      // urut seq naik agar jawaban diproses server sebelum event submit
      const rows = ((await getQueueFor(attemptId)) as QueueRow[])
        .sort((a, b) => a.seq - b.seq)
        .slice(0, 50)
      if (!rows.length) break
      await api<{ acked?: string[] }>(`/attempts/${attemptId}/answers:sync`, {
        method: 'POST',
        body: { events: rows, client_elapsed_ms: elapsedMs() },
      })
      await removeAcked(rows.map(r => r.client_event_id))
      remaining = Math.max(0, remaining - rows.length)
    }
    fails = 0
    setState({ pending: remaining, lastError: undefined, lastAckedAt: Date.now() })
    await drainPhotos(attemptId)
    return remaining === 0
  } catch (e) {
    // Sesi berakhir (401 / SESSION_EXPIRED): redirect ke /s/login sudah diurus
    // lib/api.ts (logoutBersih) — di sini cukup HENTIKAN timer agar tidak ada
    // loop flush/error terus-menerus (FR-7.4).
    const err = e as { status?: number; code?: string }
    if (err?.status === 401 || err?.code === 'SESSION_EXPIRED') {
      stopTimers()
      setState({ lastError: errMessage(e) })
      return false
    }
    fails += 1
    setState({ lastError: errMessage(e) })
    scheduleRetry(attemptId)
    return false
  } finally {
    setState({ syncing: false })
  }
}

/** Hentikan SEMUA timer engine (flush periodik, retry, foto). */
function stopTimers(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = undefined
  }
  if (photoTimer) {
    clearInterval(photoTimer)
    photoTimer = undefined
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
}

/** Kirim foto proktor yang masih menunggu (prioritas setelah jawaban, FR-5.8B).
 * Upload multipart lewat fetch MANUAL (bukan api() yang JSON-stringify body).
 * - Gagal jaringan/timeout/5xx → break, dicoba lagi pada giliran berikutnya.
 * - Gagal 4xx (permanen: attempt final, form tak valid, sesi invalid) → foto
 *   lokal dihapus supaya tidak loop selamanya. */
export async function drainPhotos(attemptId: string): Promise<void> {
  const pending = await getPendingPhotos(attemptId)
  for (const p of pending) {
    const blob = dataUrlToBlob(p.data_url)
    if (!blob) {
      await deletePhoto(p.id)
      continue
    }
    const fd = new FormData()
    fd.append('photo', blob, `${p.id}.jpg`)
    try {
      const res = await postSnapshotForm(attemptId, fd, 30_000)
      if (res.ok) {
        await deletePhoto(p.id)
        continue
      }
      if (res.status >= 400 && res.status < 500) {
        // gagal permanen — buang foto lokal agar antrean tidak macet
        await deletePhoto(p.id)
        continue
      }
      break // 5xx → server bermasalah, coba lagi nanti
    } catch {
      break // offline / timeout — dicoba lagi pada giliran berikutnya
    }
  }
}

/** Pesan ramah (bahasa siswa) dari exception api()/fetch. */
export function errMessage(e: unknown): string {
  const err = e as { message?: string }
  if (err?.message?.includes('Failed to fetch')) return 'Tidak ada koneksi internet — jawaban tersimpan di perangkat.'
  return err?.message || 'Terjadi kesalahan. Coba lagi.'
}

/* ------------------------------ internal ------------------------------ */

function onOnline() {
  setState({ online: true })
  void flush()
}

function onOffline() {
  setState({ online: false })
}

function elapsedMs(): number {
  return attemptStartEpoch > 0 ? Date.now() - attemptStartEpoch : 0
}

function scheduleRetry(attemptId: string) {
  if (retryTimer) clearTimeout(retryTimer)
  const delay = Math.min(15000, 1000 * 2 ** Math.min(fails, 4)) // 1s→2s→4s…max 15s
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    void flush(attemptId)
  }, delay)
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const [head, b64] = dataUrl.split(',')
    const mime = head.match(/:(.*?);/)?.[1] || 'image/jpeg'
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return new Blob([arr], { type: mime })
  } catch {
    return null
  }
}
