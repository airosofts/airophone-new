-- Path A load-bearing change: messages gets a direct workspace_id so the RLS
-- policy is a single-column check Realtime evaluates cheaply. Additive and
-- backward-compatible (works with RLS off).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE public.messages m
SET workspace_id = c.workspace_id
FROM public.conversations c
WHERE c.id = m.conversation_id AND m.workspace_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_message_workspace_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT c.workspace_id INTO NEW.workspace_id
    FROM public.conversations c
    WHERE c.id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_message_workspace_id ON public.messages;
CREATE TRIGGER trg_set_message_workspace_id
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.set_message_workspace_id();

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_workspace_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON public.messages(workspace_id);
