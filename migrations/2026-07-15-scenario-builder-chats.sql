-- Persistent scenario-builder chats (ChatGPT-style history).
-- A chat is one builder conversation; its `draft` holds the working state
-- (name, instructions, answered setup fields) and `scenario_id` links the
-- scenario it created/updates. Messages store the text transcript.

CREATE TABLE IF NOT EXISTS public.scenario_builder_chats (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL,
  scenario_id   uuid REFERENCES public.scenarios(id) ON DELETE SET NULL,
  draft         jsonb,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_builder_chats_workspace
  ON public.scenario_builder_chats(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.scenario_builder_messages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id     uuid NOT NULL REFERENCES public.scenario_builder_chats(id) ON DELETE CASCADE,
  role        varchar(12) NOT NULL,   -- 'user' | 'assistant'
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_builder_messages_chat
  ON public.scenario_builder_messages(chat_id, created_at);
