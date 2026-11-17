-- Rollback 000013.
ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_limits_pos_ck;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_points_pos_ck;
ALTER TABLE attempt_events DROP CONSTRAINT IF EXISTS ae_reason_ck;
ALTER TABLE question_set_versions DROP CONSTRAINT IF EXISTS qsv_published_at_ck;
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_scores_nonneg_ck;
ALTER TABLE attempt_answers DROP CONSTRAINT IF EXISTS aa_score_nonneg_ck;
ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_quota_pair_ck;
ALTER TABLE attempt_events DROP CONSTRAINT IF EXISTS ae_tenant_fk;
DROP INDEX IF EXISTS proctor_snapshots_expiry_idx;
DROP INDEX IF EXISTS file_jobs_expiry_idx;
