-- Two-way Monday sync: when something happens in apportal (a lead replies,
-- a conversation is marked done), update a column on the originating Monday
-- item. One config per board — applies to every conversation that came from
-- an automation on that board.
--
-- The conversation → Monday item link already lives in monday_automation_sends
-- (conversation_id + monday_item_id), so the writeback hook just joins through.

CREATE TABLE IF NOT EXISTS public.monday_writeback_configs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  board_id        text NOT NULL,
  board_name      text,

  -- When an inbound message arrives on a conversation tied to this board.
  on_reply_column_id    text,
  on_reply_column_type  text,    -- 'status' | 'date' | 'text' (drives how value is encoded)
  on_reply_value        jsonb,   -- e.g. {"label": "Engaged"} for status; ignored for date (always today)

  -- When the conversation is marked closed/done from the chat.
  on_done_column_id    text,
  on_done_column_type  text,
  on_done_value        jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT monday_writeback_configs_unique UNIQUE (workspace_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_monday_writeback_configs_workspace
  ON public.monday_writeback_configs(workspace_id);
