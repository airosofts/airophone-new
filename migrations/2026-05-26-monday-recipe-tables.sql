-- Tables backing the Monday Integration Recipe endpoints.
--
-- monday_recipe_subscriptions
--   One row per recipe-instance a user has on a board. Created by /subscribe,
--   deleted by /unsubscribe. The `integration_id` is monday's own identifier
--   and is the natural unique key.
--
-- monday_recipe_runs
--   Dedup + audit log of action executions. Unique on (integration_id,
--   monday_item_id) so monday retrying the same trigger never double-sends.
--   `status` mirrors monday_automation_sends: pending | scheduled | sent |
--   failed.

create table if not exists monday_recipe_subscriptions (
  integration_id   text primary key,
  recipe_id        text,
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  monday_board_id  text,
  input_fields     jsonb default '{}'::jsonb,
  webhook_url      text,
  created_at       timestamptz not null default now()
);

create index if not exists monday_recipe_subscriptions_workspace_idx
  on monday_recipe_subscriptions(workspace_id);

create table if not exists monday_recipe_runs (
  id               uuid primary key default gen_random_uuid(),
  integration_id   text not null,
  monday_item_id   text not null,
  monday_board_id  text,
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  status           text not null check (status in ('pending', 'scheduled', 'sent', 'failed')),
  detail           text,
  conversation_id  uuid,
  message_id       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (integration_id, monday_item_id)
);

create index if not exists monday_recipe_runs_status_idx
  on monday_recipe_runs(status, created_at);
create index if not exists monday_recipe_runs_workspace_idx
  on monday_recipe_runs(workspace_id);
