-- TenderSentry prelude for Supabase Postgres (docs/DECISIONS.md ADR-001, ADR-003).
-- Runs as the owner role (postgres) over DIRECT_URL. Idempotent.
-- Works on plain Postgres too (CI without Supabase): Supabase-only roles are guarded.

-- Extensions live in the `extensions` schema (Supabase convention).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;

-- Private schema for helpers: never exposed through the Data API.
CREATE SCHEMA IF NOT EXISTS ts_private;
REVOKE ALL ON SCHEMA ts_private FROM PUBLIC;

-- Runtime role for API + worker. No password here: set it per environment with
-- scripts/set-app-role-password.sql (never commit passwords). Not superuser, no BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ts_app') THEN
    CREATE ROLE ts_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE ts_app SET search_path = public, extensions;
GRANT USAGE ON SCHEMA public TO ts_app;
GRANT USAGE ON SCHEMA extensions TO ts_app;
GRANT USAGE ON SCHEMA ts_private TO ts_app;

-- Close the Data API for anything created in public from now on.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated';
  END IF;
END $$;

-- Lock down every table in public: RLS on, a single policy for ts_app, nothing for anon/authenticated.
-- Every later migration that creates tables must end with: SELECT ts_private.lock_down_all();
CREATE OR REPLACE FUNCTION ts_private.lock_down_all() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS ts_app_all ON public.%I', r.tablename);
    EXECUTE format('CREATE POLICY ts_app_all ON public.%I FOR ALL TO ts_app USING (true) WITH CHECK (true)', r.tablename);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.tablename); END IF;
    IF has_auth THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', r.tablename); END IF;
    IF r.tablename = '_prisma_migrations' THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM ts_app', r.tablename);
      EXECUTE format('GRANT SELECT ON public.%I TO ts_app', r.tablename);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO ts_app', r.tablename);
    END IF;
  END LOOP;

  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    IF has_anon THEN EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', r.sequencename); END IF;
    IF has_auth THEN EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM authenticated', r.sequencename); END IF;
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO ts_app', r.sequencename);
  END LOOP;

  -- Append-only tables (spec §2 rules 5, 12, 13; §16): INSERT + SELECT only for the runtime role.
  FOR r IN SELECT unnest(ARRAY['audit_events','tender_versions','bid_versions','overrides']) AS t LOOP
    IF to_regclass('public.' || r.t) IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM ts_app', r.t);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM service_role', r.t);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Test helper: lists public tables that are NOT locked down (should always return zero rows).
CREATE OR REPLACE FUNCTION ts_private.unlocked_tables() RETURNS TABLE(table_name text, problem text)
LANGUAGE sql STABLE AS $$
  SELECT c.relname::text, 'rls_disabled'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  UNION ALL
  SELECT t.table_name::text, 'granted_to_' || t.grantee
    FROM information_schema.role_table_grants t
   WHERE t.table_schema = 'public' AND t.grantee IN ('anon', 'authenticated')
$$;
