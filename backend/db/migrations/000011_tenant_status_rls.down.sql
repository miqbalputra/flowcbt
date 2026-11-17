-- Rollback 000011: kembalikan policy RLS seperti semula (000009) dan hapus guard status.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND NOT c.relispartition
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_active_tenant_write ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());

DROP FUNCTION IF EXISTS enforce_active_tenant_write();
DROP FUNCTION IF EXISTS tenant_is_active(uuid);
