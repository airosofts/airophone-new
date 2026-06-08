-- Add user_id to calls so per-agent analytics work.
-- Populated by /api/calls/log (client-side WebRTC logging).
-- Telnyx webhook rows have no user context so they stay NULL.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calls_user_id ON public.calls(user_id) WHERE user_id IS NOT NULL;
