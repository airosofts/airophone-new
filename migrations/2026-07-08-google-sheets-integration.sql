-- Google Sheets integration — mirrors the Monday.com integration shape.
-- Credentials live in workspace_integrations (provider = 'google_sheets');
-- these tables cover the three surfaces: campaigns, automations, writeback.
--
-- Row identity: a sheet row has no stable id, so we key on the NORMALIZED
-- PHONE NUMBER in the automation's phone column (row_key). Row numbers shift
-- when rows are inserted/deleted above, phones don't. Campaign links store
-- row numbers only as a send-time filter (picked rows), not as identity.

-- ── Campaigns: link a campaign to one sheet tab ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_sheets_links (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,

  spreadsheet_id    text NOT NULL,
  spreadsheet_name  text,
  sheet_id          bigint,          -- the tab's gid (stable when tab is renamed)
  sheet_name        text NOT NULL,   -- tab title, used in A1 range references

  -- Which column letter (A, B, …) holds the destination phone number.
  phone_column      text NOT NULL,

  -- null = all rows; otherwise only these row numbers (as text, mirrors
  -- campaign_monday_links.item_ids semantics: empty selection == all).
  row_ids           text[],

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_sheets_links_unique UNIQUE (campaign_id)
);

-- Dedupe campaign sends per sheet row, mirroring monday_item_id.
ALTER TABLE public.campaign_messages
  ADD COLUMN IF NOT EXISTS sheet_row_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_messages_sheet_unique
  ON public.campaign_messages(campaign_id, sheet_row_id)
  WHERE sheet_row_id IS NOT NULL;

-- ── Automations: "new row in sheet → send SMS" (cron-polled, no webhooks) ──
CREATE TABLE IF NOT EXISTS public.sheets_automations (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                    text NOT NULL,

  spreadsheet_id          text NOT NULL,
  spreadsheet_name        text,
  sheet_id                bigint,
  sheet_name              text NOT NULL,

  trigger_event           varchar(40) NOT NULL DEFAULT 'new_row',
  phone_column            text NOT NULL,          -- column letter holding the phone

  message_mode            varchar(20) NOT NULL,   -- 'template' | 'ai'
  message_template        text,
  ai_instructions         text,
  sender_phone_number_id  varchar(255) NOT NULL,

  send_delay_seconds      integer NOT NULL DEFAULT 0,
  business_hours_mode     varchar(20) NOT NULL DEFAULT 'anytime',  -- 'anytime' | 'within' | 'outside'
  is_active               boolean NOT NULL DEFAULT true,

  last_polled_at          timestamptz,
  created_by              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sheets_automations_workspace
  ON public.sheets_automations(workspace_id);

-- Send ledger — one row per (automation, lead). row_key is the normalized
-- phone from the sheet's phone column: the stable identity of a sheet row.
-- Rows existing when the automation is created are inserted as 'baseline'
-- so only rows added afterwards ever trigger a text.
CREATE TABLE IF NOT EXISTS public.sheets_automation_sends (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id    uuid NOT NULL REFERENCES public.sheets_automations(id) ON DELETE CASCADE,
  row_key          text NOT NULL,       -- normalized phone number
  row_number       integer,             -- sheet row at discovery time (display hint only)
  conversation_id  uuid,
  message_id       uuid,
  status           varchar(20) NOT NULL,  -- 'baseline' | 'pending' | 'scheduled' | 'sent' | 'failed'
  detail           text,
  scheduled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sheets_automation_sends_unique UNIQUE (automation_id, row_key)
);

CREATE INDEX IF NOT EXISTS idx_sheets_automation_sends_status
  ON public.sheets_automation_sends(status)
  WHERE status IN ('pending', 'scheduled');

CREATE INDEX IF NOT EXISTS idx_sheets_automation_sends_conversation
  ON public.sheets_automation_sends(conversation_id)
  WHERE conversation_id IS NOT NULL;

-- ── Two-way sync: write a value back into the row on sent / reply / done ──
-- Columns are letters; values are plain text ('{{date}}' expands to today).
CREATE TABLE IF NOT EXISTS public.sheets_writeback_configs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  spreadsheet_id   text NOT NULL,
  sheet_id         bigint,
  sheet_name       text NOT NULL,

  on_sent_column   text,
  on_sent_value    text,
  on_reply_column  text,
  on_reply_value   text,
  on_done_column   text,
  on_done_value    text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sheets_writeback_configs_unique UNIQUE (workspace_id, spreadsheet_id, sheet_name)
);
