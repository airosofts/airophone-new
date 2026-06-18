-- Two-way Monday sync — third event: "on sent".
--
-- Roland's ask: when the AI/template message is FIRST sent to a lead, flip a
-- Monday status (e.g. Status → "AI Engaged" / "Template Sent") so the human
-- agent can see on the board that the first touch went out. The existing
-- on_reply event then changes it again when the lead replies.
--
-- Fires from the automation sweeper (process-pending) right after a successful
-- send, using the same conversation → Monday-item link as on_reply / on_done.

ALTER TABLE public.monday_writeback_configs
  ADD COLUMN IF NOT EXISTS on_sent_column_id    text,
  ADD COLUMN IF NOT EXISTS on_sent_column_type  text,   -- 'status' | 'date' | 'text'
  ADD COLUMN IF NOT EXISTS on_sent_value        jsonb;  -- e.g. {"label": "AI Engaged"}
