-- Extend voicemail (RVM) campaigns to support:
--   1. Multiple phone columns per contact (primary + any extras detected in
--      contacts.custom_fields). One drop per phone per contact.
--   2. Chunked sends — split a list into N-sized chunks and launch them one
--      at a time. Each campaign row represents one chunk launch, so the
--      existing single-campaign-per-row model holds.
--
-- The "already sent chunks" indicator is computed at preview time by querying
-- existing campaigns with matching (workspace, contact_list_ids, chunk_size),
-- so no separate tracking table is needed.

alter table voicemail_campaigns
  add column if not exists phone_columns jsonb not null default '["phone_number"]'::jsonb,
  add column if not exists chunk_size    int    not null default 0,    -- 0 = whole list, no chunking
  add column if not exists chunk_index   int    not null default 0;    -- 1-based; 0 means full list

-- The preview endpoint asks "which chunks of this (lists × chunkSize) have
-- already been launched?" so an index on the matching columns keeps it fast.
create index if not exists voicemail_campaigns_chunk_lookup_idx
  on voicemail_campaigns(workspace_id, chunk_size, chunk_index);
