-- Visual builder graph for a scenario's follow-up sequence.
-- Additive + nullable: the follow-up engine never reads it (it still runs the
-- ordered scenario_followup_stages); existing scenarios are unaffected.
alter table public.scenarios add column if not exists followup_graph jsonb;
