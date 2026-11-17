-- 000012: B-10 — outbox email dengan retry/backoff.
-- Email tidak lagi dikirim sinkron di request path; kegagalan SMTP tidak menghilangkan notifikasi.
CREATE TABLE email_outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  to_email         text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  kind             text NOT NULL DEFAULT 'transactional',
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

CREATE INDEX email_outbox_due_idx ON email_outbox (status, next_attempt_at)
  WHERE status IN ('queued', 'failed');

-- Ikut skema keamanan 000011 (RLS + guard status tenant).
ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_outbox
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id() AND tenant_is_active(tenant_id));
CREATE TRIGGER trg_active_tenant_write BEFORE INSERT OR UPDATE OR DELETE ON email_outbox
  FOR EACH ROW EXECUTE FUNCTION enforce_active_tenant_write();
