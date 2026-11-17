-- 000013: B-11 — constraint integritas sebagai jaring pengaman terakhir.
-- NOT VALID dipakai agar migrasi tidak gagal pada data lama yang sudah menyimpang;
-- constraint tetap mengawasi INSERT/UPDATE baru. Jalankan VALIDATE CONSTRAINT setelah audit data.

ALTER TABLE exams ADD CONSTRAINT exams_quota_pair_ck
  CHECK ((quota_source IS NULL) = (quota_ref_id IS NULL)) NOT VALID;

ALTER TABLE attempt_answers ADD CONSTRAINT aa_score_nonneg_ck
  CHECK (score IS NULL OR score >= 0) NOT VALID;

ALTER TABLE attempts ADD CONSTRAINT attempts_scores_nonneg_ck
  CHECK (raw_score IS NULL OR raw_score >= 0) NOT VALID;

ALTER TABLE question_set_versions ADD CONSTRAINT qsv_published_at_ck
  CHECK (status <> 'published' OR published_at IS NOT NULL) NOT VALID;

ALTER TABLE attempt_events ADD CONSTRAINT ae_reason_ck
  CHECK (accepted OR reject_reason IS NOT NULL) NOT VALID;

ALTER TABLE questions ADD CONSTRAINT questions_points_pos_ck
  CHECK (points > 0) NOT VALID;

ALTER TABLE plans ADD CONSTRAINT plans_limits_pos_ck
  CHECK (student_min > 0 AND student_max >= student_min AND (exam_quota IS NULL OR exam_quota >= 0)) NOT VALID;

-- Catatan: FK tenant_id pada attempt_events tidak bisa ditambahkan dengan NOT VALID
-- karena tabel tersebut terpartisi (PostgreSQL 16). Isolasi sudah dijamin oleh
-- attempt_id FK + RLS; ini sengaja tidak dipaksakan.

-- Index untuk cleanup/PurgeDue yang saat ini melakukan full scan.
CREATE INDEX IF NOT EXISTS proctor_snapshots_expiry_idx ON proctor_snapshots (expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS file_jobs_expiry_idx ON file_jobs (status, expires_at)
  WHERE expires_at IS NOT NULL;
