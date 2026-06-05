-- Calling windows for RVM campaigns. Sends only fire when the current time (in
-- the campaign's timezone) falls inside one of the configured windows. The
-- throttle still meters the rate WITHIN each window.
--
--   send_windows = NULL or []  → send anytime (no window restriction)
--   send_windows = [{start,end}, ...]  → only send during these local windows
--
-- Stored as an array of "HH:MM" pairs, e.g. the classic best-call windows:
--   [{"start":"10:00","end":"12:00"},{"start":"14:00","end":"16:00"}]
--
-- send_timezone is an IANA zone (e.g. "America/New_York"). v1 uses the
-- workspace/campaign timezone for all recipients; per-recipient timezone
-- (area-code based) is a future enhancement for nationwide TCPA compliance.

alter table voicemail_campaigns
  add column if not exists send_windows  jsonb,
  add column if not exists send_timezone text not null default 'America/New_York';
