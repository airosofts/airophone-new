-- Prevent duplicate campaign sends to the same contact.
--
-- Even with the atomic campaign-status claim, two instances of the app (or a
-- single instance retrying) could each insert a `campaign_messages` row and
-- separately call Telnyx, producing duplicate SMS on the recipient's phone.
-- Adding a UNIQUE(campaign_id, contact_id) makes the per-contact insert itself
-- the claim — the second instance gets 23505 and skips that contact.

-- Drop any duplicate rows first (keep the earliest)
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY campaign_id, contact_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM campaign_messages
  WHERE contact_id IS NOT NULL
)
DELETE FROM campaign_messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Add unique constraint
ALTER TABLE campaign_messages
  DROP CONSTRAINT IF EXISTS campaign_messages_campaign_contact_unique;

ALTER TABLE campaign_messages
  ADD CONSTRAINT campaign_messages_campaign_contact_unique
  UNIQUE (campaign_id, contact_id);
