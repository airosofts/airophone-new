-- Inbound duplicates were caused by Telnyx webhook retries — same telnyx_message_id
-- being inserted twice when our webhook took >15s to respond. The fix is a unique
-- constraint that turns the second insert into 23505, which the webhook handler
-- now catches and treats as "already processed."
--
-- This also prevents the AI scenario from firing twice on the same inbound.

-- 1. Drop historical duplicate rows that share the same telnyx_message_id
--    (keep the earliest — its outbound replies, deduction, etc. already happened)
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY telnyx_message_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM messages
  WHERE telnyx_message_id IS NOT NULL
)
DELETE FROM messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2. Add a unique index on telnyx_message_id (partial — only when not null, so
--    optimistic-UI rows that lack a Telnyx id don't conflict with each other)
DROP INDEX IF EXISTS idx_messages_telnyx_message_id_unique;

CREATE UNIQUE INDEX idx_messages_telnyx_message_id_unique
  ON messages(telnyx_message_id)
  WHERE telnyx_message_id IS NOT NULL;
