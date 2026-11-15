// Penyimpanan lokal IndexedDB via Dexie (FR-7.2/7.3): paket soal ter-cache + outbox event.
import Dexie, { Table } from 'dexie';
import type { SyncEvent, ExamPacket, Question } from '@flowcbt/shared';

export interface LocalAttempt {
  attemptId: string;
  examId: string;
  packet: ExamPacket;
  startedPerf: number;      // performance.now saat mulai (untuk jam monotonic)
  serverNowIso: string;
  deadlineIso: string;
  submittedLocal: boolean;  // AC-4: selesai offline → menunggu sinkron
  status: 'in_progress' | 'pending_sync';
}

export interface LocalQuestion { attemptId: string; question: Question; stimulus?: unknown }

export class FlowDB extends Dexie {
  attempts!: Table<LocalAttempt, string>;
  outbox!: Table<SyncEvent & { attemptId: string }, string>;
  questions!: Table<LocalQuestion, string>;
  constructor() {
    super('flowcbt-student');
    this.version(1).stores({
      attempts: 'attemptId, examId, status',
      outbox: 'client_event_id, attemptId, seq',
      questions: 'attemptId, [attemptId+question.id]',
    });
  }
}

export const db = new FlowDB();
