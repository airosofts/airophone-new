-- Call forwarding rules table
CREATE TABLE IF NOT EXISTS public.call_forwarding_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  phone_number_id character varying(255) NOT NULL,
  forward_to character varying(20) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT call_forwarding_rules_pkey PRIMARY KEY (id),
  CONSTRAINT call_forwarding_rules_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT call_forwarding_rules_phone_fkey FOREIGN KEY (phone_number_id) REFERENCES phone_numbers(id) ON DELETE CASCADE,
  CONSTRAINT call_forwarding_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_call_fwd_workspace ON public.call_forwarding_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_call_fwd_phone_active ON public.call_forwarding_rules(phone_number_id) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_fwd_unique_active ON public.call_forwarding_rules(phone_number_id) WHERE is_active = true;

-- Add forwarding columns to calls table (if not already present)
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS forwarded_to character varying(20);
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS forwarding_rule_id uuid;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS workspace_id uuid;

-- Add status values: update constraint to allow 'forwarded' status
-- Drop old status constraint if it exists and re-create with forwarded
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_status_check CHECK (
  status::text = ANY (ARRAY['initiated', 'answered', 'completed', 'forwarded', 'ringing', 'missed']::text[])
);

CREATE INDEX IF NOT EXISTS idx_calls_forwarded ON public.calls(forwarded_to) WHERE forwarded_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_forwarding_rule ON public.calls(forwarding_rule_id) WHERE forwarding_rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_workspace_id ON public.calls(workspace_id) WHERE workspace_id IS NOT NULL;
