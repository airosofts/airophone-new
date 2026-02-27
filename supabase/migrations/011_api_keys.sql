

-- Migration: External API Keys
-- Allows external tools (like smsablemantool) to authenticate with Airophone
-- and send SMS using workspace credits.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  workspace_id    UUID         NOT NULL,
  user_id         UUID         NOT NULL,
  name            TEXT         NOT NULL,
  key_prefix      VARCHAR(24)  NOT NULL,  -- displayed in UI e.g. "airo_live_a1b2c3d4e5"
  key_hash        TEXT         NOT NULL,  -- SHA-256 of the full key, used for lookup
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  last_used_at    TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT api_keys_pkey PRIMARY KEY (id),
  CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash),
  CONSTRAINT api_keys_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces (id) ON DELETE CASCADE,
  CONSTRAINT api_keys_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE
) TABLESPACE pg_default;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id  ON public.api_keys (workspace_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id       ON public.api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash      ON public.api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active        ON public.api_keys (is_active) WHERE is_active = true;

-- Auto-update updated_at
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
