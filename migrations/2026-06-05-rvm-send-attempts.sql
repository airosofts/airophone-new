-- RVM: per-recipient send attempt counter.
-- A network-level failure (couldn't even reach the voicemail provider) is
-- transient — the row is re-queued and retried rather than permanently failed,
-- up to a bounded number of attempts. This tracks how many times we've tried so
-- a real, persistent outage still eventually settles to 'failed'.
ALTER TABLE voicemail_campaign_sends
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
