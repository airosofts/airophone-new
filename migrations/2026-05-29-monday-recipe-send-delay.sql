-- Adds an optional send delay to Monday Integration Recipe runs.
--
-- When a recipe's "wait N minutes" field is set, the execute endpoint inserts
-- the run with status='scheduled' and scheduled_at = now + N minutes. The
-- /api/automations/process-pending sweeper then sends it once scheduled_at
-- has passed (and the phone column is present).
--
-- status already permits 'scheduled' (see 2026-05-26-monday-recipe-tables.sql),
-- so only the timestamp column is new.

alter table monday_recipe_runs
  add column if not exists scheduled_at timestamptz;

-- The sweeper scans for due 'scheduled' rows alongside 'pending' rows.
create index if not exists monday_recipe_runs_scheduled_idx
  on monday_recipe_runs(status, scheduled_at);
