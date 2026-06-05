-- RVM: optional per-day send limit.
-- Sends at the throttle's hourly rate, but once `daily_cap` voicemails have gone
-- out for the campaign (counted in the campaign's send_timezone local day), the
-- rest hold until the next local day. NULL / 0 → no daily limit.
ALTER TABLE voicemail_campaigns
  ADD COLUMN IF NOT EXISTS daily_cap integer;
