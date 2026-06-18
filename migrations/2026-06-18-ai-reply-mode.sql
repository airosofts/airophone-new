-- AI reply hours (per scenario) — user preference, not hardcoded.
--
--   ai_reply_mode = 'anytime'        → the AI replies immediately at any hour
--                                      (still only BOOKS inside business hours).
--   ai_reply_mode = 'business_hours' → the AI only replies during business hours
--                                      (workspace Settings → Business Hours). A
--                                      message that arrives outside them is NOT
--                                      dropped: the reply is DEFERRED and auto-
--                                      sent at the next business-day opening.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS ai_reply_mode text NOT NULL DEFAULT 'anytime';

-- One pending deferred reply per conversation. The cron sweeps run_at <= now,
-- runs the scenario (which reads the full thread and replies once), deletes row.
CREATE TABLE IF NOT EXISTS public.deferred_ai_replies (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    uuid,
  conversation_id uuid NOT NULL,
  scenario_id     uuid NOT NULL,
  run_at          timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deferred_ai_replies_conv_unique UNIQUE (conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_deferred_ai_replies_run ON public.deferred_ai_replies(run_at);
