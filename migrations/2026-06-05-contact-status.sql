-- Call-outcome / disposition tracking.
--
-- contacts.status — the contact's current outcome label (lead, appointment,
--   callback, not_interested, wrong_number, do_not_call, disconnected). Set from
--   the inbox contact panel after a call. NULL = no status yet.
--
-- voicemail_campaigns.exclude_statuses — the statuses a campaign skips, chosen on
--   the Audience step (e.g. {do_not_call,wrong_number,disconnected}). NULL/empty
--   = send to everyone.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS status text;

ALTER TABLE voicemail_campaigns
  ADD COLUMN IF NOT EXISTS exclude_statuses text[];
