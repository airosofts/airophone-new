-- Scheduled / send-later SMS. A row is created when a user schedules a message;
-- followup-cron sweeps due rows once a minute and sends them.
--   condition = 'always'        → always send at scheduled_at
--   condition = 'unless_first'  → cancel (save as draft) if the recipient replies first
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  conversation_id uuid,
  from_number     text NOT NULL,
  to_number       text NOT NULL,
  body            text,
  media_urls      jsonb,
  scheduled_at    timestamptz NOT NULL,
  timezone        text,
  condition       text NOT NULL DEFAULT 'always',
  status          text NOT NULL DEFAULT 'scheduled',   -- scheduled | sent | canceled | failed
  cancel_reason   text,
  sent_message_id uuid,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due  ON scheduled_messages (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_conv ON scheduled_messages (conversation_id);
