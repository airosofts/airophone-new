-- Row-level recipient selection for Monday-sourced campaigns.
--
-- group_ids already narrows a board to specific groups; item_ids narrows
-- further to specific rows. NULL means "all items in the selected groups" —
-- same all-vs-subset convention as group_ids. Storing NULL (rather than the
-- full list) means rows added to the board after campaign creation are still
-- picked up at send time, which is the behavior users expect from "all".

ALTER TABLE public.campaign_monday_links
  ADD COLUMN IF NOT EXISTS item_ids text[];
