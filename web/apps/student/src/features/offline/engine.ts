// Mesin offline murni (tanpa DOM/DB) agar bisa di-unit-test (PRD 14.1):
// - outbox: antrean event dengan client_event_id (idempoten, AC-3)
// - reducer last-write-wins by seq (FR-7.4)
// - jam monotonic terkalibrasi server (FR-7.5)
// - submit offline → pending_sync (AC-4)
import type { SyncEvent } from '@flowcbt/shared';

export interface OutboxStore {
  getAll(attemptId: string): Promise<SyncEvent[]>;
  put(ev: SyncEvent): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
}

export interface Clock {
  // elapsed monotonic ms sejak mulai (tidak terpengaruh jam perangkat dimanipulasi)
  elapsedMs(startPerf: number, nowPerf: number): number;
}

export const monotonicClock: Clock = {
  elapsedMs(startPerf, nowPerf) {
    return Math.max(0, nowPerf - startPerf);
  },
};

// Kalibrasi: serverNow + deadlineAt dari server; waktu berjalan = serverNow + (performance.now - recvPerf).
export interface ServerClock {
  nowMs(): number; // ms epoch terkoreksi terhadap server saat start
}

export function calibrate(serverNowIso: string, receivedPerf: number): ServerClock {
  const serverNow = Date.parse(serverNowIso);
  const basePerf = receivedPerf;
  return { nowMs: () => serverNow + (performance.now() - basePerf) };
}

export function deadlineCountdownMs(deadlineIso: string, clock: ServerClock): number {
  return Math.max(0, Date.parse(deadlineIso) - clock.nowMs());
}

// Reducer LWW: kembalikan map question_id -> event terakhir (seq tertinggi) (FR-7.4).
export function reduceAnswers(events: SyncEvent[]): Map<string, SyncEvent> {
  const m = new Map<string, SyncEvent>();
  for (const ev of events) {
    if (ev.type !== 'answer' || !ev.question_id) continue;
    const cur = m.get(ev.question_id);
    if (!cur || ev.seq > cur.seq) m.set(ev.question_id, ev);
  }
  return m;
}

// Kirim batch ke server; hanya hapus dari antrean setelah ACK (FR-7.4, AC-2/AC-3).
export async function drainOutbox(
  attemptId: string,
  store: OutboxStore,
  sendBatch: (attemptId: string, events: SyncEvent[]) => Promise<{ acked: { client_event_id: string }[] }>,
  onProgress?: (pending: number) => void,
): Promise<number> {
  const events = (await store.getAll(attemptId)).sort((a, b) => a.seq - b.seq);
  if (events.length === 0) return 0;
  const res = await sendBatch(attemptId, events);
  const ackedIds = new Set((res.acked || []).map((a) => a.client_event_id));
  const toDelete = events.filter((e) => ackedIds.has(e.client_event_id)).map((e) => e.client_event_id);
  if (toDelete.length) await store.deleteMany(toDelete);
  const left = events.length - toDelete.length;
  onProgress?.(left);
  return toDelete.length;
}

// Status koneksi untuk indikator (FR-7.7).
export type ConnState = 'online' | 'syncing' | 'offline';
export function connState(online: boolean, pending: number): ConnState {
  if (!online) return 'offline';
  if (pending > 0) return 'syncing';
  return 'online';
}

export function newEventId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? 'ev-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}
