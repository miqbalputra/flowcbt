-- 0004 — jenis event tambahan 'violation' (pelanggaran offline → sinkron, FR-5.8/FR-7.4)
ALTER TABLE attempt_events DROP CONSTRAINT IF EXISTS attempt_events_type_check;
ALTER TABLE attempt_events ADD CONSTRAINT attempt_events_type_check
  CHECK (type IN ('answer','flag','nav','submit','focus_lost','online','offline','sync','start','auto_submit','violation'));
