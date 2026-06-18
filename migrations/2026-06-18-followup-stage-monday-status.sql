-- Per follow-up stage → Monday status label.
--
-- When a follow-up stage fires, optionally flip the source Monday item's status
-- (e.g. "1st follow-up sent", "2nd follow-up sent") so the human agent sees the
-- cadence progress on the board. The label is written to the board's pipeline
-- STATUS column — the same status column already chosen in the automation's
-- two-way sync (on sent / on reply). Reply still flips it back via on_reply.
--
-- Empty/null = this stage does not touch Monday.

ALTER TABLE public.scenario_followup_stages
  ADD COLUMN IF NOT EXISTS monday_status_label text;
