-- Per-scenario AI model choice (BYOM): 'gpt-4o-mini' (default when null),
-- 'gpt-4o', 'claude-haiku-4-5-20251001', 'claude-sonnet-5', 'gemini-2.5-flash'.
-- Routed by src/lib/ai-models.js; models whose provider API key is missing
-- fall back to the OpenAI default at reply time.
ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS ai_model varchar(60);
