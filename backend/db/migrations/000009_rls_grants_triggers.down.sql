DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
           WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS tenant_self ON tenants;
ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tg.tgname, cl.relname FROM pg_trigger tg JOIN pg_class cl ON cl.oid = tg.tgrelid
           WHERE tg.tgname LIKE 'trg_%_updated' AND NOT tg.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t.tgname, t.relname);
  END LOOP;
END $$;
DROP ROLE IF EXISTS flowcbt_system;
DROP ROLE IF EXISTS flowcbt_app;
