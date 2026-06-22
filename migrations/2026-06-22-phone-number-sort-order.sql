-- Custom display order for phone numbers in the sidebar (drag to reorder).
--
-- Stored per phone number so the order PERSISTS across devices/browsers and is
-- shared across everyone in the workspace (not just one browser's localStorage).
-- Lower sort_order shows first; NULL (not yet ordered) sorts last, then falls
-- back to created_at so new numbers append to the bottom.
ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS sort_order int;
