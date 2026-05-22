-- Monday board automations: when a board event fires (new item, column change,
-- moved to group), Monday calls our webhook and we text the lead from a chosen
-- AiroPhone number. That number already has an AI scenario assigned, so replies
-- are handled automatically — the automation only needs to send the first message.

CREATE TABLE IF NOT EXISTS public.monday_automations (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                    text NOT NULL,

  board_id                text NOT NULL,
  board_name              text,
  -- 'create_item' | 'change_column_value' | 'move_item_to_group'
  trigger_event           varchar(40) NOT NULL DEFAULT 'create_item',
  -- The id Monday returns from create_webhook — needed to delete it later.
  monday_webhook_id       text,

  -- Which board column holds the lead's phone number.
  phone_column_id         text NOT NULL,

  -- 'template' → message_template with {{column}} placeholders
  -- 'ai'       → ai_instructions, message generated per-lead via OpenAI
  message_mode            varchar(20) NOT NULL DEFAULT 'template',
  message_template        text,
  ai_instructions         text,

  -- The AiroPhone number to send from. It already has an AI scenario assigned,
  -- which is how replies get auto-handled after the first message.
  sender_phone_number_id  varchar(255) REFERENCES public.phone_numbers(id) ON DELETE SET NULL,

  is_active               boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monday_automations_board     ON public.monday_automations(board_id);
CREATE INDEX IF NOT EXISTS idx_monday_automations_workspace ON public.monday_automations(workspace_id);

-- Dedup ledger: one row per (automation, Monday item) — a lead is texted at most
-- once per automation no matter how many times Monday fires the webhook.
CREATE TABLE IF NOT EXISTS public.monday_automation_sends (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   uuid NOT NULL REFERENCES public.monday_automations(id) ON DELETE CASCADE,
  monday_item_id  text NOT NULL,
  conversation_id uuid,
  message_id      uuid,
  status          varchar(20) NOT NULL DEFAULT 'sent',  -- 'sent' | 'skipped' | 'failed'
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT monday_automation_sends_unique UNIQUE (automation_id, monday_item_id)
);
