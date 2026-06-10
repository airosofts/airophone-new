-- RVM "monitor" / canary numbers.
-- A small set of your own numbers (E.164) that receive the campaign voicemail
-- ONCE PER DAY while the campaign is running — separate from the contact list —
-- so you can confirm each day's drip actually fired.
--   monitor_numbers      — e.g. {+12223334444,+13334445555}; NULL/empty = none
--   monitor_last_sent_at — last heartbeat send (used to fire once per local day)
ALTER TABLE voicemail_campaigns
  ADD COLUMN IF NOT EXISTS monitor_numbers text[];

ALTER TABLE voicemail_campaigns
  ADD COLUMN IF NOT EXISTS monitor_last_sent_at timestamptz;
