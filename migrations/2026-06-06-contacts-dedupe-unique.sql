-- Prevent duplicate contacts going forward: at most ONE row per
-- (workspace, list, phone). NULL contact_list_id rows are unaffected (Postgres
-- treats NULLs as distinct), which is fine — list-less rows aren't list members.
--
-- IMPORTANT: run this only AFTER de-duplicating existing rows
-- (scripts/dedupe-contacts.js --execute), or the index creation will fail on
-- the existing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_ws_list_phone_uniq
  ON public.contacts (workspace_id, contact_list_id, phone_number);
