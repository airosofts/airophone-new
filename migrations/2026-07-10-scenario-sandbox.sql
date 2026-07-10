-- Sandbox test chats for AI scenarios ("Test your AI").
-- A session is one simulated conversation where the user plays the lead and
-- the AI replies using the scenario's saved instructions — no SMS is sent,
-- no credits are deducted, no follow-ups are armed. Sessions persist so a
-- user can keep multiple test chats per scenario and re-run them after
-- editing the prompt.

CREATE TABLE IF NOT EXISTS public.scenario_sandbox_sessions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  scenario_id   uuid NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_sessions_scenario
  ON public.scenario_sandbox_sessions(scenario_id);

CREATE TABLE IF NOT EXISTS public.scenario_sandbox_messages (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          uuid NOT NULL REFERENCES public.scenario_sandbox_sessions(id) ON DELETE CASCADE,
  direction           varchar(10) NOT NULL,   -- 'inbound' (tester as the lead) | 'outbound' (AI)
  body                text NOT NULL,
  tokens_used         integer,
  processing_time_ms  integer,
  -- Outcome flags & diagnostics: { stopped, human_needed, unresolved_tokens: [] }
  meta                jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sandbox_messages_session
  ON public.scenario_sandbox_messages(session_id, created_at);
