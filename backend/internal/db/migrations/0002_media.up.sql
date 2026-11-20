-- FlowCBT 0002: metadata media unggahan (bank soal, PRD M4/FR-4.4).
-- File fisik disimpan di disk (UPLOAD_DIR/<tenant_id>/UUID.ext);
-- tabel ini hanya metadata + dasar hitung ulang kuota bila perlu.
CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL DEFAULT '',        -- nama asli berkas unggahan
  path TEXT NOT NULL DEFAULT '',            -- path relatif thd UPLOAD_DIR (<tenant>/<file>)
  size BIGINT NOT NULL DEFAULT 0,           -- byte
  content_type TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_tenant ON media (tenant_id, created_at DESC);

-- RLS: pola mengikuti gaya 0001_init (tenant_isolation_<tabel>).
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_media ON media
  USING (tenant_id::text = current_setting('app.tenant_id', true));
