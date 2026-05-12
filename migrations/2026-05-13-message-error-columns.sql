-- Promote error_code and error_message from messages.error_details JSON to
-- dedicated columns. Makes them queryable, indexable, and visible in the
-- Supabase table editor without parsing JSON.
--
-- error_details (JSON) is kept for the full webhook payload (timestamps,
-- carrier hints, reconciled_at, etc.) — these new columns are the canonical
-- "what happened" surfaces used by the UI.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_code    text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_message text;

-- Index so we can query failures by code quickly (analytics, support queries)
CREATE INDEX IF NOT EXISTS idx_messages_error_code
  ON messages(error_code)
  WHERE error_code IS NOT NULL;

-- Backfill existing failed messages from the JSON column
UPDATE messages
SET
  error_code    = (error_details::jsonb) ->> 'error_code',
  error_message = (error_details::jsonb) ->> 'error_message'
WHERE error_details IS NOT NULL
  AND error_code IS NULL;
