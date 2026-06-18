-- Per-scenario "Appointment booking" flag.
--
-- The AI prompt always gets CURRENT DATE & TIME (useful for any scenario). The
-- "only confirm a callback INSIDE business hours / never book outside" rule is
-- only relevant for scenarios that actually BOOK calls — an info/support scenario
-- shouldn't be told to talk about callbacks. This flag gates that rule.
--
-- Default true preserves today's behavior (the rule was previously hardcoded into
-- every prompt). Turn OFF for non-booking scenarios.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS books_appointments boolean NOT NULL DEFAULT true;
