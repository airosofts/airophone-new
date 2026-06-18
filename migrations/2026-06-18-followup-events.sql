-- Follow-up activity log (Phase 2) — one row per follow-up lifecycle event.
-- Powers the Follow-Up Logs page and the per-lead timeline.
--
-- type ∈ template_sent | scheduled | sent | delivered | rescheduled |
--        cancelled | skipped | responded_before
--   'delivered' is logged by the Telnyx delivery webhook, correlated to the
--   'sent' event via meta->>telnyx_message_id.
--   scheduled_for → the planned send time (for scheduled/rescheduled)
--   occurred_at   → when the event actually happened (for sent/cancelled/etc.)

CREATE TABLE IF NOT EXISTS public.followup_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    uuid,
  conversation_id uuid,
  scenario_id     uuid,
  stage_number    int,
  type            text NOT NULL,
  scheduled_for   timestamptz,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  meta            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_events_conversation
  ON public.followup_events(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_followup_events_workspace
  ON public.followup_events(workspace_id, created_at DESC);
