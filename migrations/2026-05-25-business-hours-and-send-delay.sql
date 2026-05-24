-- Business hours (workspace-level) + send delay (per-automation).
--
-- Why workspace-level for business hours: every workspace has one schedule;
-- automations/campaigns/scheduled sends all respect the same window. A user
-- shouldn't have to re-configure "9-6 ET Mon-Fri" on every new automation.
--
-- Per-automation gets a `respect_business_hours` toggle so an individual
-- automation can opt out (e.g. an internal-team alert that should fire 24/7).

-- ── 1. Workspace business hours ──────────────────────────────────────────────
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS business_hours_enabled  boolean NOT NULL DEFAULT false,
  -- 24h clock, local to business_hours_tz.
  ADD COLUMN IF NOT EXISTS business_hours_start    time    NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS business_hours_end      time    NOT NULL DEFAULT '18:00',
  -- IANA timezone. We convert now() into this zone before comparing.
  ADD COLUMN IF NOT EXISTS business_hours_tz       text    NOT NULL DEFAULT 'America/New_York',
  -- ISO 8601 day-of-week: 1=Mon … 7=Sun. Default weekdays only.
  ADD COLUMN IF NOT EXISTS business_days           int[]   NOT NULL DEFAULT '{1,2,3,4,5}';

-- ── 2. Per-automation send delay + opt-in to business hours ──────────────────
ALTER TABLE public.monday_automations
  ADD COLUMN IF NOT EXISTS send_delay_seconds      int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS respect_business_hours  boolean NOT NULL DEFAULT false;

-- ── 3. Scheduled sends — defer until scheduled_at, sweeper picks them up ─────
ALTER TABLE public.monday_automation_sends
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Sweeper polls by (status, scheduled_at) — partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS idx_monday_automation_sends_scheduled
  ON public.monday_automation_sends(status, scheduled_at)
  WHERE status IN ('pending', 'scheduled');
