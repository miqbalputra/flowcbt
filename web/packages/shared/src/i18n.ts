// A-16: string & pemetaan status terpusat.
// Belum i18n penuh — satu bahasa (id) dengan satu sumber kebenaran untuk
// label status & tone Badge yang sebelumnya diulang di 8+ halaman.

export type BadgeTone = 'ok' | 'brand' | 'warn' | 'danger' | 'muted';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  published: 'Terbit',
  archived: 'Arsip',
  cancelled: 'Dibatalkan',
  in_progress: 'Berlangsung',
  pending_sync: 'Menunggu sinkron',
  not_started: 'Belum mulai',
  submitted: 'Terkirim',
  awaiting_manual_grading: 'Menunggu penilaian',
  graded: 'Dinilai',
  read_only: 'Baca-saja',
  active: 'Aktif',
  expired: 'Kedaluwarsa',
  purged: 'Dihapus',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  published: 'ok',
  active: 'ok',
  graded: 'ok',
  submitted: 'ok',
  draft: 'muted',
  not_started: 'muted',
  cancelled: 'muted',
  expired: 'muted',
  archived: 'muted',
  in_progress: 'brand',
  pending_sync: 'warn',
  awaiting_manual_grading: 'warn',
  read_only: 'warn',
  purged: 'danger',
};

export const statusLabel = (status?: string | null): string =>
  (status && STATUS_LABEL[status]) || status || '—';

export const statusTone = (status?: string | null): BadgeTone =>
  (status && STATUS_TONE[status]) || 'muted';

/** Terjemahkan kunci UI umum; fallback ke kunci bila belum terdaftar. */
export function t(key: string): string {
  return UI[key] ?? key;
}

const UI: Record<string, string> = {
  'status.published': 'Terbit',
  'status.draft': 'Draft',
  'action.publish': 'Publish',
  'action.unpublish': 'Unpublish',
  'action.duplicate': 'Duplikat',
  'action.archive': 'Arsipkan',
  'action.delete': 'Hapus',
  'action.cancel': 'Batal',
  'action.save': 'Simpan',
  'empty.no_data': 'Belum ada data',
  'loading': 'Memuat…',
};
