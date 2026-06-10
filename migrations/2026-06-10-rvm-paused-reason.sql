-- Why an RVM campaign is paused, so the UI can show "out of credits → top up to
-- resume" vs a manual pause. NULL = manually paused / not paused.
ALTER TABLE voicemail_campaigns
  ADD COLUMN IF NOT EXISTS paused_reason text;
