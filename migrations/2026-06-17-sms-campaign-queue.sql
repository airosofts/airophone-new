-- Move SMS campaigns to the queue + cron model (same as RVM): pausable,
-- schedulable, and resumable. Recipients are pre-enqueued as campaign_messages
-- rows (status='queued') and a cron sweeps them — no fragile in-process loop.
ALTER TABLE campaigns         ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS to_number text;   -- recipient phone (so the cron sends without re-resolving)
ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS body text;        -- pre-personalized message
ALTER TABLE campaign_messages ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_campaign_messages_queue ON campaign_messages (status, campaign_id);
