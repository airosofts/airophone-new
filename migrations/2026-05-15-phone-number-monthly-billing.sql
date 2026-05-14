-- Phone numbers are now billed in credits (100 per month per number) instead
-- of dollars. Each number tracks its own next-billing timestamp so the cron
-- can charge independently per number.
--
-- next_billing_at is set to NOW() + 30 days on purchase; the cron advances
-- it by 30 days every time it successfully deducts the 100 credits.

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS next_billing_at timestamptz;

-- Backfill existing active numbers — give a 30-day grace from today so we
-- don't suddenly charge everyone the moment the cron starts running.
UPDATE phone_numbers
SET next_billing_at = NOW() + INTERVAL '30 days'
WHERE next_billing_at IS NULL
  AND is_active = true;

-- Index so the cron's "what's due now" query stays fast as the table grows.
CREATE INDEX IF NOT EXISTS idx_phone_numbers_next_billing
  ON phone_numbers (next_billing_at)
  WHERE is_active = true AND next_billing_at IS NOT NULL;
