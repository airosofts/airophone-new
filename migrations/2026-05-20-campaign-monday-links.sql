-- Phase 2 of the Monday.com integration: a campaign can be linked to a Monday
-- board (optionally narrowed to specific groups). When linked, the send loop
-- ignores contact_list_ids and pulls items directly from Monday at send time.
-- Column titles become `{{placeholder}}` substitutions in the message template.
--
-- The link is 1:1 with the campaign — UNIQUE(campaign_id). Reconnecting a
-- different board for the same campaign overwrites the row.

CREATE TABLE IF NOT EXISTS public.campaign_monday_links (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id       uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,

  board_id          text NOT NULL,
  board_name        text,

  -- null = include all groups on the board; otherwise include only these.
  group_ids         text[],

  -- Which Monday column holds the destination phone number. Required, because
  -- without it we don't know who to text.
  phone_column_id   text NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_monday_links_unique UNIQUE (campaign_id)
);

-- Track which Monday items have already been sent in a campaign so reruns /
-- pagination races don't double-send. Mirrors the existing
-- UNIQUE(campaign_id, contact_id) protection for the contacts path.
ALTER TABLE public.campaign_messages
  ADD COLUMN IF NOT EXISTS monday_item_id text;

-- contact_id was NOT NULL in the original schema; Monday-sourced messages
-- have no contact row, so allow it to be null. The (campaign_id, contact_id)
-- unique constraint still works — Postgres treats NULL != NULL, so multiple
-- Monday-sourced rows can coexist; the partial unique index below is what
-- actually dedupes them.
ALTER TABLE public.campaign_messages
  ALTER COLUMN contact_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_messages_monday_unique
  ON public.campaign_messages(campaign_id, monday_item_id)
  WHERE monday_item_id IS NOT NULL;
