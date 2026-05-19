
-- Generic per-workspace integration table. Shaped so future providers
-- (Slack, HubSpot, Salesforce, …) reuse it — only `provider` and the contents
-- of `credentials` change. UNIQUE(workspace_id, provider) means one connection
-- per provider per workspace; reconnecting overwrites the row.
--
-- `credentials` is jsonb because each provider has different token shapes:
--   Monday: { access_token, token_type, scope }
--   (no refresh_token — Monday OAuth tokens don't currently expire)

CREATE TABLE IF NOT EXISTS public.workspace_integrations (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider        varchar(40) NOT NULL,        -- 'monday' (first), 'slack', 'hubspot', …
  credentials     jsonb NOT NULL,              -- provider-specific token shape
  account_id      varchar(255),                -- provider's account id (e.g. Monday account.id)
  account_name    varchar(255),                -- denormalized for UI display
  account_slug    varchar(255),                -- e.g. Monday workspace slug
  connected_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_integrations_unique UNIQUE (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace
  ON public.workspace_integrations(workspace_id);
