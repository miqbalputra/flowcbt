// Antrean event lokal Area Siswa (FR-7.3) — pembungkus tipis di atas store
// "queue" IndexedDB. Engine sync (sync.ts) yang mengirimkannya ke server.
import { openDb, bumpSeq } from '../db'
import type { QueueEvent } from '../types'

// Satu-satunya implementasi bumpSeq (atomik, di db.ts) — re-export agar
// pemanggil lama dari lib/queue tetap jalan.
export { bumpSeq }

export async function getSeqCurrent(attemptId: string): Promise<number> {
  const db = await openDb()
  const v = await db.get('meta', `seq:${attemptId}`)
  return typeof v === 'number' ? v : 0
}

/** Tulis event ke antrean (client_event_id = kunci idempotensi server). */
export async function appendEvent(evt: QueueEvent): Promise<void> {
  const db = await openDb()
  await db.put('queue', evt)
}

/** Semua event antrean milik satu attempt, urut seq naik. */
export async function eventsForAttempt(attemptId: string): Promise<QueueEvent[]> {
  const db = await openDb()
  const rows = await db.getAllFromIndex('queue', 'by_attempt', attemptId)
  return (rows as QueueEvent[]).sort((a, b) => a.seq - b.seq)
}

/** Hapus baris antrean yang sudah di-ACK server. */
export async function removeAcked(clientEventIds: string[]): Promise<void> {
  if (!clientEventIds.length) return
  const db = await openDb()
  const tx = db.transaction('queue', 'readwrite')
  await Promise.all(clientEventIds.map(id => tx.store.delete(id)))
  await tx.done
}
