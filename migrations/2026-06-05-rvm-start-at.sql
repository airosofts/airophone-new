-- One-time scheduled start for RVM campaigns. Distinct from calling windows:
--   starts_at      = "don't begin until this exact moment" (one-time)
--   send_windows   = "only ever dispatch during these daily hours" (recurring)
-- They compose: a campaign can start at 9 AM Friday AND only send 10–12 daily.
--
-- starts_at NULL → send now (subject to windows/throttle).

alter table voicemail_campaigns
  add column if not exists starts_at timestamptz;
