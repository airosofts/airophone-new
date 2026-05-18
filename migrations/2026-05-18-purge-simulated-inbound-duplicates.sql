-- The telnyx webhook used to "simulate" an inbound message when an outbound
-- delivered to another same-account workspace number (it inserted a row with
-- telnyx_message_id prefixed `sim_`). Telnyx actually does fire the real
-- message.received webhook for these, so the simulator was producing a duplicate
-- inbound row for every cross-workspace message. The simulator block has been
-- removed from src/app/api/webhooks/telnyx/route.js; this migration cleans up
-- the historical duplicates it created.
--
-- Safety: we only delete rows whose telnyx_message_id starts with `sim_`. The
-- real inbound counterpart (with the genuine Telnyx UUID) is kept untouched.

DELETE FROM public.messages
WHERE  telnyx_message_id LIKE 'sim\_%' ESCAPE '\';

-- Conversation last_message_at may now point at a different message; refresh it
-- from the surviving rows so the inbox preview is accurate.
UPDATE public.conversations c
SET    last_message_at = sub.last_at
FROM (
  SELECT conversation_id, max(created_at) AS last_at
  FROM   public.messages
  GROUP  BY conversation_id
) sub
WHERE  sub.conversation_id = c.id
  AND  (c.last_message_at IS DISTINCT FROM sub.last_at);
