-- 000011: X-04 — RLS/policy dan trigger menegakkan status tenant (AC-11).
-- Masalah: policy 000009 hanya membandingkan tenant_id, sehingga tenant `read_only`
-- (akses berakhir) masih bisa INSERT/UPDATE/DELETE. Lapisan DB sekarang menolak mutasi,
-- sementara SELECT tetap diizinkan agar tenant bisa melihat data & melakukan ekspor.
--
-- CATATAN PERAN:
--   * flowcbt_app    -> ditegakkan (API)
--   * flowcbt_system -> dilewati (worker purge, webhook, admin, login lintas tenant)
--   * postgres/owner -> dilewati (migrasi)

-- Fungsi pembantu SECURITY DEFINER: membaca tenants tanpa terkena RLS tenants itu sendiri.
CREATE OR REPLACE FUNCTION tenant_is_active(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant AND t.status = 'active');
$$;
REVOKE EXECUTE ON FUNCTION tenant_is_active(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION tenant_is_active(uuid) TO flowcbt_app, flowcbt_system;

-- Trigger menangani INSERT/UPDATE/DELETE (DELETE memakai USING pada RLS, jadi policy saja tidak cukup).
CREATE OR REPLACE FUNCTION enforce_active_tenant_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tid uuid;
BEGIN
  IF current_user IS DISTINCT FROM 'flowcbt_app' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  tid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  IF tid IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF NOT tenant_is_active(tid) THEN
    RAISE EXCEPTION 'TENANT_READ_ONLY: tenant tidak aktif' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Terapkan ke semua tabel tenant (termasuk partisi induk; trigger turunan mengikuti otomatis).
-- Filter relispartition = false mencegah trigger ganda pada partisi.
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
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_tenant_id())
        WITH CHECK (
          tenant_id = current_tenant_id()
          AND tenant_is_active(tenant_id)
        )
    $policy$, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_active_tenant_write ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_active_tenant_write BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_active_tenant_write()', t);
  END LOOP;
END $$;

-- tenants: hanya boleh diubah oleh role sistem; WITH CHECK memperketat penulisan aplikasi.
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id() AND status = 'active');
