-- One-shot rollback. Disables RLS on every public table and restores anon
-- write grants. Use if anything regresses during rollout.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon;

-- Restore SELECT on views revoked by 03b-lockdown-views.sql.
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated;', v);
  END LOOP;
END $$;
