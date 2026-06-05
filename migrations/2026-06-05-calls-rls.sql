-- The calls table was created via SQL migration so it never received the
-- automatic anon/authenticated grants that Supabase applies to tables created
-- via the Dashboard. Without these grants the browser's anon Supabase client
-- gets nothing back from SELECT queries, which is why calls never appear in
-- the chat window or call history tab.
--
-- RLS stays disabled. Write operations only happen server-side via the
-- service-role key.

GRANT SELECT ON public.calls TO anon;
GRANT SELECT ON public.calls TO authenticated;
