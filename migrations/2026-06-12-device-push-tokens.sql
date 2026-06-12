-- Expo push tokens for the mobile app. One row per device; a token uniquely
-- identifies a device install. Used to send remote push (new message, incoming
-- call) to mobile users via Expo's push service.
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES public.users(id) ON DELETE CASCADE,
  token         text NOT NULL,
  platform      text,                      -- 'ios' | 'android'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_push_tokens_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_workspace ON public.device_push_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user ON public.device_push_tokens(user_id);
