-- FlowCBT skema awal (PRD §8) — PostgreSQL 16
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ TENANT & PLATFORM ============
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  school_level TEXT NOT NULL DEFAULT 'Lainnya',
  timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','read_only','suspended')),
  trial_ends_at TIMESTAMPTZ,
  rights_ends_at TIMESTAMPTZ,          -- batas hak akses (dihitung job retensi)
  retention_started_at TIMESTAMPTZ,    -- mulai mode baca-saja 7 hari
  retention_delete_at TIMESTAMPTZ,     -- hapus permanen setelah titik ini
  media_bytes_used BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_tenants_name_lower ON tenants (lower(name));

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','owner','teacher')),
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification','active','suspended')),
  email_verified_at TIMESTAMPTZ,
  email_verify_token TEXT,
  pending_new_email TEXT,
  reset_token TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  failed_attempts INT NOT NULL DEFAULT 0,
  failed_locked_until TIMESTAMPTZ,
  class_restriction JSONB NOT NULL DEFAULT '[]',  -- id kelas yang boleh diakses guru (kosong = semua)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));
CREATE UNIQUE INDEX idx_users_verify_token ON users (email_verify_token) WHERE email_verify_token IS NOT NULL;

CREATE TABLE refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  typ TEXT NOT NULL DEFAULT 'staff' CHECK (typ IN ('staff','student')),
  sid TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_refresh_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id, revoked);

-- ============ PLANS, SUBSCRIPTION, KUOTA ============
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trial','per_exam','monthly')),
  price_idr INT NOT NULL DEFAULT 0,
  min_students INT NOT NULL,
  max_students INT NOT NULL,
  exam_quota INT,                       -- NULL = tanpa batas (bulanan)
  duration_days INT,                    -- 14 trial; 30 bulanan; NULL per-exam
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  kind TEXT NOT NULL CHECK (kind IN ('trial','monthly','per_exam')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled','pending_payment')),
  payment_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subs_tenant ON subscriptions (tenant_id, status);

CREATE TABLE exam_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payment_id UUID,
  quantity INT NOT NULL,
  used INT NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credits_tenant ON exam_credits (tenant_id);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('midtrans','mayar','manual')),
  provider_ref TEXT,
  order_id TEXT NOT NULL UNIQUE,
  plan_id UUID REFERENCES plans(id),
  kind TEXT NOT NULL CHECK (kind IN ('trial','monthly','per_exam')),
  amount_idr INT NOT NULL,
  discount_idr INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','expired','refunded','challenge')),
  paid_at TIMESTAMPTZ,
  snapshot_at TIMESTAMPTZ,
  invoice_number TEXT,
  invoice_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_tenant ON payments (tenant_id, created_at DESC);

-- ============ KELAS & SISWA ============
CREATE TABLE classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  academic_year TEXT NOT NULL DEFAULT '',
  homeroom_teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_classes_tenant_name ON classes (tenant_id, lower(name), academic_year);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_code TEXT NOT NULL,
  nis TEXT,
  name TEXT NOT NULL,
  gender CHAR(1) NOT NULL CHECK (gender IN ('L','P')),
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  username TEXT,
  password_hash TEXT,
  email TEXT,
  parent_phone TEXT,
  photo_url TEXT,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  merged_into_id UUID REFERENCES students(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_students_tenant_code ON students (tenant_id, student_code);
CREATE UNIQUE INDEX idx_students_code_global ON students (student_code);
CREATE UNIQUE INDEX idx_students_username ON students (username) WHERE username IS NOT NULL;
CREATE INDEX idx_students_tenant_class ON students (tenant_id, class_id);
-- pencarian siswa terdaftar utk guest login (nama + kelas ternormalisasi)
CREATE INDEX idx_students_tenant_name ON students (tenant_id, lower(name));

CREATE TABLE student_class_history (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  from_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_date TIMESTAMPTZ
);

-- ============ SOAL (AKM) ============
CREATE TABLE question_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  exam_code TEXT NOT NULL,
  level_tag TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  current_version INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_qsets_tenant_code ON question_sets (tenant_id, exam_code);
CREATE INDEX idx_qsets_tenant ON question_sets (tenant_id, status, updated_at DESC);

CREATE TABLE question_set_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  version INT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (question_set_id, version)
);

CREATE TABLE stimuli (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',        -- HTML tersanitasi
  media JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  set_version_id UUID REFERENCES question_set_versions(id) ON DELETE CASCADE, -- NULL pada draft (baris kerja)
  order_no INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mcq','mcq_complex','matching','short_answer','essay')),
  stimulus_id UUID REFERENCES stimuli(id) ON DELETE SET NULL,
  body TEXT NOT NULL,                       -- soal (HTML tersanitasi)
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_key JSONB NOT NULL DEFAULT '{}'::jsonb,
  points NUMERIC(6,2) NOT NULL DEFAULT 1,
  scoring_mode TEXT NOT NULL DEFAULT 'all_or_nothing' CHECK (scoring_mode IN ('all_or_nothing','partial')),
  explanation TEXT NOT NULL DEFAULT '',
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_questions_set ON questions (question_set_id, order_no);
CREATE INDEX idx_questions_version ON questions (set_version_id, order_no);

-- ============ UJIAN ============
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question_set_id UUID NOT NULL REFERENCES question_sets(id) ON DELETE RESTRICT,
  question_set_version_id UUID REFERENCES question_set_versions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  subject_name TEXT NOT NULL DEFAULT '',
  exam_code TEXT NOT NULL,
  token TEXT NOT NULL,
  token_active BOOLEAN NOT NULL DEFAULT true,
  open_at TIMESTAMPTZ NOT NULL,
  close_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  time_style TEXT NOT NULL DEFAULT 'grace' CHECK (time_style IN ('grace','hard_close')),
  max_attempts INT NOT NULL DEFAULT 1,
  score_policy TEXT NOT NULL DEFAULT 'highest' CHECK (score_policy IN ('highest','last','avg')),
  show_score_immediately BOOLEAN NOT NULL DEFAULT true,
  show_explanation BOOLEAN NOT NULL DEFAULT false,
  shuffle_questions BOOLEAN NOT NULL DEFAULT false,
  shuffle_options BOOLEAN NOT NULL DEFAULT false,
  free_navigation BOOLEAN NOT NULL DEFAULT true,
  require_all_answered BOOLEAN NOT NULL DEFAULT false,
  login_mode TEXT NOT NULL DEFAULT 'both' CHECK (login_mode IN ('account','guest','both')),
  guest_nis_required BOOLEAN NOT NULL DEFAULT false,
  passing_score NUMERIC(5,2),
  anti_cheat JSONB NOT NULL DEFAULT '{}'::jsonb,
  credits_exam_id UUID,                    -- kredit ujian yang terpotong
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  paused BOOLEAN NOT NULL DEFAULT false,   -- jeda darurat pengawas
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_exams_tenant_code ON exams (tenant_id, exam_code);
CREATE INDEX idx_exams_tenant_status ON exams (tenant_id, status, open_at);

CREATE TABLE exam_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('class','student')),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE
);
CREATE INDEX idx_assign_exam ON exam_assignments (exam_id);

CREATE TABLE exam_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  extra_time_seconds INT NOT NULL DEFAULT 0,
  attempts_override INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- ============ PENGERJAAN ============
CREATE TABLE attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NULL REFERENCES students(id) ON DELETE SET NULL,
  attempt_no INT NOT NULL DEFAULT 1,
  class_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  name_snapshot TEXT NOT NULL DEFAULT '',
  penalty_points NUMERIC(6,2) NOT NULL DEFAULT 0,
  cheating_status TEXT NOT NULL DEFAULT 'none'
    CHECK (cheating_status IN ('none','warned','flagged','disqualified')),
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','pending_sync','submitted','graded','expired','disqualified')),
  device_token TEXT,
  device_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  deadline_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  score NUMERIC(6,2),
  max_score NUMERIC(6,2),
  penalty_note TEXT,
  final_score NUMERIC(6,2),                -- setelah penalti
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_attempts_no ON attempts (exam_id, student_id, attempt_no);
CREATE INDEX idx_attempts_exam_status ON attempts (exam_id, status);
CREATE INDEX idx_attempts_student ON attempts (student_id, started_at DESC);
CREATE UNIQUE INDEX idx_attempts_device ON attempts (device_token) WHERE status='pending_sync';

CREATE TABLE attempt_answers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL,
  answer JSONB NOT NULL DEFAULT '{}'::jsonb,
  flag_ragu BOOLEAN NOT NULL DEFAULT false,
  is_correct BOOLEAN,
  score NUMERIC(6,2) NOT NULL DEFAULT 0,
  graded_by TEXT NOT NULL DEFAULT 'auto',
  seq BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);
CREATE INDEX idx_answers_attempt ON attempt_answers (attempt_id);

-- Event jawaban append-only (partisi per bulan di produksi, PRD §8)
CREATE TABLE attempt_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  client_event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('answer','flag','nav','submit','focus_lost','online','offline','sync','start','auto_submit')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_ts TIMESTAMPTZ,
  server_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_events_client_id ON attempt_events (client_event_id);
CREATE INDEX idx_events_attempt_seq ON attempt_events (attempt_id, seq);

CREATE TABLE attempt_violations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('tab_hidden','blur','fullscreen_exit','camera_off','no_face','multi_face')),
  started_at TIMESTAMPTZ,
  duration_ms INT NOT NULL DEFAULT 0,
  penalty_applied NUMERIC(6,2) NOT NULL DEFAULT 0,
  cancelled BOOLEAN NOT NULL DEFAULT false,
  cancel_reason TEXT,
  client_event_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_viol_attempt ON attempt_violations (attempt_id);

CREATE TABLE proctor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ
);

-- ============ AUDIT, JOB, NOTIF ============
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_logs (tenant_id, created_at DESC);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_pending ON jobs (status, run_at);

CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID,
  user_id UUID,
  audience TEXT NOT NULL DEFAULT 'staff' CHECK (audience IN ('staff','student')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ RLS: isolasi tenant (PRD FR-1.4, AC-9) ============
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','refresh_tokens','classes','students','student_class_history',
    'question_sets','question_set_versions','stimuli','questions','exams','exam_assignments','exam_participants',
    'attempts','attempt_answers','attempt_events','attempt_violations','proctor_snapshots','audit_logs',
    'subscriptions','exam_credits','payments','notifications','jobs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF t IN ('tenants') THEN
      EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I USING (id = current_setting(''app.tenant_id'', true)::uuid)', t, t);
    ELSIF t IN ('users') THEN
      -- pengguna boleh lihat dirinya sendiri + sesama tenant saat memiliki tenant
      EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I USING (id::text = current_setting(''app.user_id'', true) OR (tenant_id::text = current_setting(''app.tenant_id'', true) AND current_setting(''app.tenant_id'', true) IS NOT NULL))', t, t);
    ELSIF t IN ('refresh_tokens','jobs','notifications') THEN
      EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true) OR tenant_id IS NULL AND current_setting(''app.tenant_id'', true) IS NULL)', t, t);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I USING (tenant_id::text = current_setting(''app.tenant_id'', true))', t, t);
    END IF;
  END LOOP;
END $$;

-- ============ ROLE APLIKASI (RLS-enforced) ============
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='flowcbt_app') THEN
    CREATE ROLE flowcbt_app LOGIN PASSWORD 'app_user_dev';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO flowcbt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flowcbt_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flowcbt_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flowcbt_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO flowcbt_app;
