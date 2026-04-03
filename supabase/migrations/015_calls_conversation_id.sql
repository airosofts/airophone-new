-- Add conversation_id to calls table so calls appear in chat timeline
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_calls_conversation ON public.calls(conversation_id, created_at DESC);
