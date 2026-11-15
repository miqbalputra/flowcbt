DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS stimuli;
ALTER TABLE IF EXISTS question_sets DROP CONSTRAINT IF EXISTS qs_published_fk;
ALTER TABLE IF EXISTS question_sets DROP CONSTRAINT IF EXISTS qs_draft_fk;
DROP TABLE IF EXISTS question_set_versions;
DROP TABLE IF EXISTS question_set_shares;
DROP TABLE IF EXISTS question_sets;
DROP TABLE IF EXISTS media_assets;
