-- ============ KARTU UJIAN (gaya kartu peserta TKA) ============
-- Profil sekolah dipakai kepala kartu & blok tanda tangan.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS principal_name TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS principal_nip TEXT NOT NULL DEFAULT '';
-- Kode wilayah & kode sekolah untuk nomor peserta (mis. 03-10 dan 0028).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region_code TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_code TEXT NOT NULL DEFAULT '';

-- Data pribadi peserta yang tercetak di kartu.
ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_place TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

-- Nomor peserta stabil per ujian: dibuat sekali, dipakai ulang saat cetak/QR.
CREATE TABLE IF NOT EXISTS exam_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id),
  UNIQUE (exam_id, number)
);
CREATE INDEX IF NOT EXISTS idx_exam_cards_exam ON exam_cards(exam_id, number);

ALTER TABLE exam_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_exam_cards ON exam_cards;
CREATE POLICY tenant_isolation_exam_cards ON exam_cards
  USING (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON exam_cards TO flowcbt_app;
