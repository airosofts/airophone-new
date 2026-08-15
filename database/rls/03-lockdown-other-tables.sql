-- Enable RLS on every other public table with NO policy: `anon` and
-- `authenticated` are both denied, closing the read hole on users, wallets,
-- super_admins, api_keys, etc. The server (service_role) bypasses RLS, so all
-- API routes keep working. Excludes the 5 browser tables handled in file 02.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> ALL (ARRAY['messages','conversations','calls','phone_numbers','user_presence'])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
