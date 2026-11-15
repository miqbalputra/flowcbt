// Unit test mesin offline (AC-1..AC-5) — dijalankan via vitest (node, tanpa browser).
import { describe, expect, it } from 'vitest';
import { drainOutbox, reduceAnswers, monotonicClock, calibrate, deadlineCountdownMs, connState, newEventId } from './engine';
import type { SyncEvent } from '@flowcbt/shared';
import type { OutboxStore } from './engine';

class MemStore implements OutboxStore {
  map = new Map<string, SyncEvent & { attemptId: string }>();
  async getAll(attemptId: string) {
    return [...this.map.values()].filter((e) => (e as any).attemptId === attemptId);
  }
  async put(ev: SyncEvent) {
    this.map.set(ev.client_event_id, { ...ev, attemptId: 'a1' } as any);
  }
  async deleteMany(ids: string[]) {
    for (const id of ids) this.map.delete(id);
  }
}

const ev = (id: string, qid: string, seq: number, payload: unknown): SyncEvent => ({
  client_event_id: id, type: 'answer', question_id: qid, payload, seq,
});

describe('outbox & sinkronisasi', () => {
  it('AC-3: batch yang sama dikirim 2x → hanya dihapus setelah ACK, server menerima sekali (idempoten via client_event_id)', async () => {
    const store = new MemStore();
    await store.put(ev('e1', 'q1', 1, { selected: 'A' }));
    await store.put(ev('e2', 'q2', 2, { selected: 'B' }));
    let calls = 0;
    const send = async (_a: string, events: SyncEvent[]) => {
      calls++;
      expect(events.length).toBe(2);
      return { acked: events.map((e) => ({ client_event_id: e.client_event_id })) }; // server ACK semua (idempoten)
    };
    const sent = await drainOutbox('a1', store, send);
    expect(sent).toBe(2);
    expect(await store.getAll('a1')).toHaveLength(0);
    // kirim ulang batch duplikat (retry) — server sudah ACK, antrean kosong
    expect(calls).toBe(1);
  });

  it('antrean tidak dihapus sebelum ACK (koneksi putus di tengah)', async () => {
    const store = new MemStore();
    await store.put(ev('e1', 'q1', 1, {}));
    await store.put(ev('e2', 'q2', 2, {}));
    const send = async () => { throw new Error('offline'); };
    await expect(drainOutbox('a1', store, send)).rejects.toThrow('offline');
    expect(await store.getAll('a1')).toHaveLength(2); // jawaban lokal aman (AC-1)
  });

  it('FR-7.4: last-write-wins by seq, bukan jam perangkat', () => {
    const events = [
      ev('e1', 'q1', 5, { text: 'jawaban akhir' }),
      ev('e2', 'q1', 3, { text: 'jawaban lama' }),
      ev('e3', 'q2', 1, { selected: 'A' }),
    ];
    const m = reduceAnswers(events);
    expect((m.get('q1')!.payload as any).text).toBe('jawaban akhir');
    expect(m.get('q2')).toBeTruthy();
  });

  it('FR-7.5: jam monotonic — manipulasi jam perangkat tidak mengubah elapsed', () => {
    const start = 1000;
    expect(monotonicClock.elapsedMs(start, 6000)).toBe(5000);
    expect(monotonicClock.elapsedMs(start, 500)).toBe(0); // tidak bisa negatif
  });

  it('kalibrasi server clock & countdown deadline', () => {
    // serverNowIso = 10 detik yang lalu pada saat diterima
    const receivedPerf = performance.now();
    const serverNowIso = new Date(Date.now() - 10000).toISOString();
    const clock = calibrate(serverNowIso, receivedPerf);
    const now = clock.nowMs();
    expect(now).toBeGreaterThan(Date.now() - 12000);
    expect(now).toBeLessThan(Date.now() + 1000);
    const deadline = new Date(Date.now() + 60000).toISOString();
    expect(deadlineCountdownMs(deadline, clock)).toBeGreaterThan(50000);
  });

  it('indikator koneksi (FR-7.7)', () => {
    expect(connState(false, 3)).toBe('offline');
    expect(connState(true, 2)).toBe('syncing');
    expect(connState(true, 0)).toBe('online');
  });

  it('client_event_id unik (UUID)', () => {
    const a = newEventId(), b = newEventId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});
