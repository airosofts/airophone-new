-- Per follow-up stage → Monday status.
--
-- When a follow-up stage fires, optionally set a status on the source Monday
-- item (e.g. "1st follow-up sent", "2nd follow-up sent") so the human agent sees
-- the cadence progress on the board. The user picks a real STATUS column and one
-- of ITS labels (no free text / hardcoding) — exactly like the automation's
-- two-way sync editor. Reply still flips status back via the automation on_reply.
--
-- Both null = this stage does not touch Monday.

ALTER TABLE public.scenario_followup_stages
  ADD COLUMN IF NOT EXISTS monday_status_column_id text,
  ADD COLUMN IF NOT EXISTS monday_status_label text;
