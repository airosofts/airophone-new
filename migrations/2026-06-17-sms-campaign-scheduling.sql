-- SMS campaign scheduling — bring SMS to RVM parity: throttle (N per window),
-- send windows + days + timezone (business hours), daily cap, scheduled start,
-- and recurring (re-runs from scratch when the queue drains).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS throttle_count          int;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS throttle_window_seconds int;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_windows            jsonb;   -- [{ start:'HH:MM', end:'HH:MM' }]
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_timezone           text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_days               int[];   -- ISO 1=Mon … 7=Sun
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS daily_cap               int;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurring               boolean NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cycle                   int NOT NULL DEFAULT 1;
