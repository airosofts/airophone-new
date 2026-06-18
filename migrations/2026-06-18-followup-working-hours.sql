-- Per-scenario follow-up working window (Phase 1).
--
-- Defines WHEN follow-up nudges may send for a given AI Scenario. This is
-- SEPARATE from the workspace business hours (Settings) — those still govern
-- when the AI may offer appointment slots (booking). The follow-up window can be
-- wider (e.g. Mon–Sun 8AM–10PM) than office hours.
--
-- Gating uses the existing `enable_business_hours` toggle as the on/off:
--   enable_business_hours = false → follow-ups send 24/7 (window ignored)
--   enable_business_hours = true  → follow-ups only send inside this window;
--                                   anything calculated outside snaps to the
--                                   next window open (scheduling.nextSendTime).
--
-- Nulls fall back in code to Mon–Sun, 08:00–22:00, workspace timezone.

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS followup_days        int[],   -- ISO weekdays 1=Mon..7=Sun
  ADD COLUMN IF NOT EXISTS followup_start_time  text,    -- 'HH:MM' 24h
  ADD COLUMN IF NOT EXISTS followup_end_time    text,    -- 'HH:MM' 24h
  ADD COLUMN IF NOT EXISTS followup_timezone    text;    -- IANA, e.g. America/New_York
