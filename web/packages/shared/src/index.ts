// Tipe bersama frontend (selaras skema backend / PRD Bagian 8-9).
export type QuestionType = 'mcq' | 'mcq_complex' | 'matching' | 'short_answer' | 'essay';

export interface Option { id: string; html: string }
export interface MatchingOptions { left: Option[]; right: Option[] }

export interface Question {
  id: string;
  order_no: number;
  type: QuestionType;
  stimulus_id?: string | null;
  body_html: string;
  options_json: Option[] | MatchingOptions | unknown;
  answer_key_json?: unknown;   // hanya untuk guru; tidak pernah ada di klien siswa
  rubric_json?: unknown;
  points: number;
  scoring_mode: 'all_or_nothing' | 'partial';
  partial_wrong_penalty: boolean;
  shuffle_options: boolean;
  explanation_html?: string | null;
  media_ids: string[];
}

export interface Exam {
  id: string;
  question_set_id: string;
  question_set_title?: string;
  name: string;
  status: 'draft' | 'published' | 'paused' | 'closed' | 'cancelled';
  open_at?: string | null;
  close_at?: string | null;
  duration_minutes?: number | null;
  login_mode: 'account' | 'guest' | 'both';
  max_attempts?: number | null;
  score_policy: 'highest' | 'last' | 'avg';
  passing_score?: number | null;
  show_score_immediately: boolean;
  show_review: boolean;
  show_explanations: boolean;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  anticheat_enabled: boolean;
  leave_tolerance_seconds: number;
  penalty_mode: 'none' | 'points' | 'percent';
  penalty_value: number;
  penalty_max: number;
  flag_threshold?: number | null;
  auto_submit_threshold?: number | null;
  camera_enabled: boolean;
  token?: string;
}

export interface ExamPacket {
  attempt_id: string;
  resumed: boolean;
  exam: {
    id: string; name: string; exam_code: string; duration_minutes: number;
    show_score_immediately: boolean; show_review: boolean; show_explanations: boolean;
    max_attempts?: number | null; require_all_answered: boolean;
    anticheat: { enabled: boolean; leave_tolerance_seconds: number; penalty_mode: string; penalty_value: number; penalty_max: number; flag_threshold?: number | null; auto_submit_threshold?: number | null };
    camera_enabled: boolean;
  };
  started_at: string;
  deadline_at: string;
  server_now: string;
  stimuli: { id: string; order_no: number; title?: string | null; content_html: string; media_ids: string[] }[];
  questions: Question[];
}

export interface SyncEvent {
  client_event_id: string;
  type: 'answer' | 'flag' | 'nav' | 'submit' | 'violation';
  question_id?: string;
  payload?: unknown;
  client_ts?: string;
  elapsed_ms?: number;
  seq: number;
}

export function fmtDateTime(s?: string | null): string {
  if (!s) return '-';
  const d = new Date(s);
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: 'Pilihan Ganda',
  mcq_complex: 'Pilihan Ganda Kompleks',
  matching: 'Menjodohkan',
  short_answer: 'Isian Singkat',
  essay: 'Uraian',
};
