-- Per-line AI auto-reply switch.
-- When false, NO scenario auto-replies on this phone number (a human handles it),
-- regardless of any matched scenario. Defaults to true (AI on) so existing
-- behavior is unchanged.
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
