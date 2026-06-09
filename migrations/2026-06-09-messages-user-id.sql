-- Add user_id to messages for per-agent analytics.
-- Populated on outbound messages sent from the inbox.
-- Inbound messages and webhook-created messages stay NULL.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id) WHERE user_id IS NOT NULL;
