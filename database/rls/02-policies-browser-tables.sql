-- The 5 tables the browser reads/subscribes to. Enable RLS and add a policy
-- that scopes `authenticated` (Path A token) to its own workspace. `anon` has
-- no policy here -> denied. `service_role` bypasses RLS -> server unaffected.
--
-- IMPORTANT: we first DROP every pre-existing policy on these tables. The legacy
-- schema ships a permissive policy on `conversations`
-- ("Enable all operations for authenticated users", USING auth.role()='authenticated').
-- Postgres OR-combines permissive policies, so leaving it in place would let ANY
-- authenticated user read EVERY workspace's rows — defeating tenant isolation.
-- Dropping all existing policies guarantees `tenant_isolation` is the only one.
DO $$
DECLARE t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages','conversations','calls','phone_numbers','user_presence']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    -- drop ALL existing policies on this table (legacy permissive ones included)
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', p, t);
    END LOOP;
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL TO authenticated
        USING (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid)
        WITH CHECK (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);
    $f$, t);
  END LOOP;
END $$;
