-- RLS does not protect views: a normal (non-security_invoker) view runs with its
-- owner's privileges and bypasses the underlying tables' RLS. Production has views
-- (e.g. conversation_summaries, message_cost_summary, wallet_summary) with grants
-- to anon, so without this they remain an anon-readable path to locked-down data.
-- The browser queries NO views, so revoking anon/authenticated access is safe.
-- (On a structure-only test replica with no views this is a no-op.)
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', v);
  END LOOP;
END $$;
