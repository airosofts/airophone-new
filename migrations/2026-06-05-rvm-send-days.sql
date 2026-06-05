-- RVM: optional day-of-week restriction for calling windows.
-- An array of ISO weekday numbers (1=Mon … 7=Sun) the campaign is allowed to
-- send on. NULL → any day. Used by the "Business hours" option so it mirrors the
-- workspace's configured business days (e.g. Mon–Fri) from Settings.
ALTER TABLE voicemail_campaigns
  ADD COLUMN IF NOT EXISTS send_days integer[];
