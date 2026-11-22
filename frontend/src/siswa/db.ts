// IndexedDB "flowcbt" — penyimpanan lokal Area Siswa (FR-7.3/7.6/7.8).
// Stores:
//  - attempts: {attempt_id, package, meta}                  (pra-muat & pemulihan)
//  - answers : riwayat jawaban terkini per (attempt,soal)
//  - queue   : antrean event sinkron (answer/flag/violation/submit)
//  - photos  : snapshot kamera menunggu dikirim (base64)
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AttemptRecord, AnswerRecord } from './types'

interface FlowDB extends DBSchema {
  attempts: { key: string; value: AttemptRecord }
  answers: {
    key: [string, string]
    value: AnswerRecord
    indexes: { by_attempt: string }
  }
  queue: { key: string; value: QueueRow; indexes: { by_attempt: string } }
  photos: { key: string; value: { id: string; attempt_id: string; data_url: string; taken_at: number } }
  meta: { key: string; value: unknown }
}

const DB_NAME = 'flowcbt'
let dbp: Promise<IDBPDatabase<FlowDB>> | null = null

export function openDb(): Promise<IDBPDatabase<FlowDB>> {
  if (!dbp) {
    // v2: index queue.by_attempt — di v1 index ini terlewat dibuat sehingga
    // getQueueFor() gagal ("index not found") dan sync jawaban tak pernah jalan.
    dbp = openDB<FlowDB>(DB_NAME, 2, {
      upgrade(db, _oldV, _newV, tx) {
        if (!db.objectStoreNames.contains('attempts')) db.createObjectStore('attempts', { keyPath: 'attempt_id' })
        if (!db.objectStoreNames.contains('answers')) {
          const s = db.createObjectStore('answers', { keyPath: ['attempt_id', 'question_id'] })
          s.createIndex('by_attempt', 'attempt_id')
        }
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'client_event_id' })
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        // migrasi v1 → v2 (idempoten bila sudah ada)
        const q = tx.objectStore('queue') as unknown as IDBObjectStore
        try {
          q.createIndex('by_attempt', 'attempt_id')
        } catch {
          /* index sudah ada (DB baru) — abaikan */
        }
      },
    }).catch(err => {
      dbp = null
      throw err
    })
  }
  return dbp
}

/* ---------- attempts (pra-muat & pemulihan FR-7.8) ---------- */

export async function saveAttempt(rec: AttemptRecord): Promise<void> {
  ;(await openDb()).put('attempts', rec)
}

export async function getAttempt(id: string): Promise<AttemptRecord | undefined> {
  return (await openDb()).get('attempts', id)
}

/* ---------- answers (jawaban terkini, overlay dirty) ---------- */

export async function putAnswer(rec: AnswerRecord): Promise<void> {
  ;(await openDb()).put('answers', rec)
}

export async function getAnswers(attemptId: string): Promise<AnswerRecord[]> {
  const db = await openDb()
  return db.getAllFromIndex('answers', 'by_attempt', attemptId)
}

export async function clearAnswers(attemptId: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('answers', 'readwrite')
  let cur = await tx.store.index('by_attempt').openCursor(attemptId)
  while (cur) {
    await cur.delete()
    cur = await cur.continue()
  }
}

/* ---------- queue event sinkron ---------- */

export interface QueueRow {
  client_event_id: string
  attempt_id: string
  type: 'answer' | 'flag' | 'violation' | 'submit' | 'nav'
  question_id?: string
  payload: Record<string, unknown>
  client_ts: number
  seq: number
  dirty?: boolean
}

export async function enqueue(q: QueueRow): Promise<void> {
  ;(await openDb()).put('queue', q)
}

export async function dequeue(clientEventId: string): Promise<void> {
  ;(await openDb()).delete('queue', clientEventId)
}

export async function getQueueFor(attemptId: string): Promise<QueueRow[]> {
  const db = await openDb()
  try {
    return await db.getAllFromIndex('queue', 'by_attempt', attemptId)
  } catch {
    // jaring pengaman: DB lama tanpa index → filter manual
    const all = await db.getAll('queue')
    return all.filter(r => r.attempt_id === attemptId)
  }
}

/* ---------- photos (snapshot proktor offline→online) ---------- */

/** Batas foto menunggu-kirim per attempt — yang tertua dibuang (hemat kuota). */
export const MAX_PENDING_PHOTOS = 30

export async function savePhoto(row: { id: string; attempt_id: string; data_url: string; taken_at: number }): Promise<void> {
  const db = await openDb()
  await db.put('photos', row)
  // Jaga jumlah foto pending per attempt ≤ MAX_PENDING_PHOTOS: buang tertua.
  const all = (await db.getAll('photos')).filter(p => p.attempt_id === row.attempt_id)
  if (all.length > MAX_PENDING_PHOTOS) {
    all.sort((a, b) => a.taken_at - b.taken_at)
    const excess = all.slice(0, all.length - MAX_PENDING_PHOTOS)
    const tx = db.transaction('photos', 'readwrite')
    for (const p of excess) tx.store.delete(p.id)
    await tx.done
    console.warn(`[proktor] Antrean foto melebihi ${MAX_PENDING_PHOTOS} — foto tertua dihapus.`)
  }
}

export async function getPendingPhotos(attemptId: string): Promise<Array<{ id: string; attempt_id: string; data_url: string; taken_at: number }>> {
  const db = await openDb()
  const all = await db.getAll('photos')
  return all.filter(p => p.attempt_id === attemptId)
}

export async function deletePhoto(id: string): Promise<void> {
  ;(await openDb()).delete('photos', id)
}

/* ---------- meta KV (profil, offset server, seq counter) ---------- */

export async function getMeta<T>(key: string, def: T): Promise<T> {
  try {
    const v = (await openDb()).get('meta', key)
    return ((await v) ?? def) as T
  } catch {
    return def
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  ;(await openDb()).put('meta', value, key)
}

/** Seq berikutnya (monoton per attempt — FR-7.3: konflik last-write-wins via seq).
 * ATOMIK: baca+ tulis dalam SATU transaksi IDB agar dua event bersamaan
 * tidak mendapat nomor seq kembar. */
export async function bumpSeq(attemptId: string): Promise<number> {
  const db = await openDb()
  const tx = db.transaction('meta', 'readwrite')
  const key = `seq:${attemptId}`
  const cur = (await tx.store.get(key)) as number | undefined
  const next = (typeof cur === 'number' ? cur : 0) + 1
  tx.store.put(next, key)
  await tx.done
  return next
}

/* ---------- pembatasan antrean (payload & foto, FR-7.3) ---------- */

/** Batas event per attempt (AC-3): di atas ini event nav/flag terlama dibuang,
 * jawaban/violation/submit dipertahankan. */
export const MAX_QUEUE_EVENTS = 800

/** Jaga ukuran antrean per attempt ≤ max: buang event nav/flag TERLAMA dulu
 * (jawaban tetap — data nilai tidak boleh hilang). */
export async function trimQueue(attemptId: string, max: number = MAX_QUEUE_EVENTS): Promise<void> {
  const db = await openDb()
  const rows = (await db.getAllFromIndex('queue', 'by_attempt', attemptId)) as QueueRow[]
  let excess = rows.length - max
  if (excess <= 0) return
  const droppable = rows
    .filter(r => r.type === 'nav' || r.type === 'flag')
    .sort((a, b) => a.seq - b.seq) // terlama dulu
  if (!droppable.length) return
  const tx = db.transaction('queue', 'readwrite')
  for (const r of droppable) {
    if (excess <= 0) break
    tx.store.delete(r.client_event_id)
    excess--
  }
  await tx.done
}

/** Kumpulan question_id yang masih punya event BELUM ter-ACK di antrean.
 * Dipakai merge recovery: jawaban lokal dgn event antrean dianggap lebih baru
 * daripada salinan server (FR-7.8). */
export async function getQueuedQuestionIds(attemptId: string): Promise<Set<string>> {
  const rows = await getQueueFor(attemptId)
  const set = new Set<string>()
  for (const r of rows) {
    if (r.question_id) set.add(r.question_id)
  }
  return set
}
