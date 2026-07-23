-- The 5 tables the browser reads/subscribes to. Enable RLS and add a policy
-- that scopes `authenticated` (Path A token) to its own workspace. `anon` has
-- no policy here -> denied. `service_role` bypasses RLS -> server unaffected.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages','conversations','calls','phone_numbers','user_presence']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL TO authenticated
        USING (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid)
        WITH CHECK (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);
    $f$, t);
  END LOOP;
END $$;
