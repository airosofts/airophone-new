-- Each workspace gets its own Telnyx SIP credential connection
-- This prevents cross-workspace incoming call leakage (all sessions shared one SIP user before)

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS telnyx_connection_id TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_sip_username TEXT,
  ADD COLUMN IF NOT EXISTS telnyx_sip_password TEXT;
