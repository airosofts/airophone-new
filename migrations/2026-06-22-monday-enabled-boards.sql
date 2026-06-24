-- App-level board allowlist for the Monday integration.
--
-- Monday's OAuth grants account-wide board access (you can't scope per board at
-- the token level). This lets a workspace choose WHICH boards are actually usable
-- in AiroPhone (Automations, Campaigns, follow-up status pickers).
--
--   enabled_boards = NULL  → all boards allowed (default; nothing changes)
--   enabled_boards = []    → none selected yet
--   enabled_boards = ["123","456"] → only these board ids are exposed in pickers
ALTER TABLE public.workspace_integrations
  ADD COLUMN IF NOT EXISTS enabled_boards jsonb;
