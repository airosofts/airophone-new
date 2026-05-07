-- Add workspace_id to conversations table
-- Needed so inbox queries can filter conversations per workspace

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_workspace_id_idx ON conversations (workspace_id);

-- Backfill existing conversations from the phone_numbers table
-- (match from_number to the phone number owned by a workspace)
UPDATE conversations c
SET workspace_id = pn.workspace_id
FROM phone_numbers pn
WHERE c.workspace_id IS NULL
  AND (
    pn.phone_number = c.from_number
    OR pn.phone_number = '+1' || regexp_replace(c.from_number, '\D', '', 'g')
    OR '+1' || regexp_replace(pn.phone_number, '\D', '', 'g') = c.from_number
  );
