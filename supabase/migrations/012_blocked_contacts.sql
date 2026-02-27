-- Blocked contacts: store phone numbers blocked per workspace
CREATE TABLE IF NOT EXISTS blocked_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  phone_number text NOT NULL,
  blocked_by uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_blocked_contacts_workspace ON blocked_contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_blocked_contacts_lookup ON blocked_contacts(workspace_id, phone_number);
