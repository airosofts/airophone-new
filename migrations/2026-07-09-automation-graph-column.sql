-- Adds the React-Flow visual graph to board/sheet automations.
-- Additive + nullable: the execution engine never reads it; existing rows are unaffected.
alter table public.monday_automations add column if not exists graph jsonb;
alter table public.sheets_automations  add column if not exists graph jsonb;
