-- Adds two automation behaviours users have been asking for:
--   1. Send delay — wait N seconds after the trigger fires before texting.
--      Useful when the Monday form fills columns a beat after item creation,
--      or when an immediate text feels too robotic.
--   2. Business hours — only send Mon-Fri 09:00-18:00 (configurable). Triggers
--      outside the window queue and fire at the next window open.
--
-- The sweeper at /api/automations/process-pending picks up rows whose
-- scheduled_at has arrived AND is within business hours.

ALTER TABLE public.monday_automations
  ADD COLUMN IF NOT EXISTS send_delay_seconds       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS respect_business_hours   boolean NOT NULL DEFAULT false,
  -- 24h clock, e.g. '09:00:00'. Local to business_hours_tz.
  ADD COLUMN IF NOT EXISTS business_hours_start     time NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS business_hours_end       time NOT NULL DEFAULT '18:00',
  -- IANA timezone (e.g. 'America/New_York'). The sweeper converts now() into
  -- this zone before comparing against the start/end times.
  ADD COLUMN IF NOT EXISTS business_hours_tz        text NOT NULL DEFAULT 'America/New_York',
  -- ISO 8601 day-of-week numbers: 1=Mon … 7=Sun. Default is weekdays only.
  ADD COLUMN IF NOT EXISTS business_days            int[] NOT NULL DEFAULT '{1,2,3,4,5}';

-- Sends table: when set, the sweeper waits until scheduled_at AND the window
-- is open before processing. When null, behaviour is unchanged ("send asap").
ALTER TABLE public.monday_automation_sends
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- The sweeper polls by (status, scheduled_at) — index it.
CREATE INDEX IF NOT EXISTS idx_monday_automation_sends_scheduled
  ON public.monday_automation_sends(status, scheduled_at)
  WHERE status IN ('pending', 'scheduled');
