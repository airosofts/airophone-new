-- Realtime team presence.
--
-- Replaces the old poll-based presence (heartbeat → users.last_seen, then a 30s
-- poll of /api/workspace/members). A client heartbeat now upserts THIS table
-- every ~30s; "online" = last_seen within the presence window (src/lib/presence.js).
-- The table is added to the supabase_realtime publication so the sidebar/inbox
-- receive live online/offline updates via Postgres Changes — no polling.
--
-- Note: RLS is intentionally left disabled (matching conversations/phone_numbers,
-- which the app already subscribes to with the anon client). Rows hold only
-- user_id + workspace_id + last_seen — no sensitive data.

create table if not exists public.user_presence (
  user_id      uuid primary key references public.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  last_seen    timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_user_presence_workspace on public.user_presence (workspace_id);

-- Enable Supabase Realtime (Postgres Changes) on the table. Idempotent — skips
-- if it's already a member of the publication. (Same thing the dashboard's
-- Realtime toggle does.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_presence'
  ) then
    alter publication supabase_realtime add table public.user_presence;
  end if;
end $$;
