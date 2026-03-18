-- Call forwarding rules table
CREATE TABLE public.call_forwarding_rules (
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

CREATE INDEX idx_call_fwd_workspace ON public.call_forwarding_rules(workspace_id);
CREATE INDEX idx_call_fwd_phone_active ON public.call_forwarding_rules(phone_number_id) WHERE is_active = true;
CREATE UNIQUE INDEX idx_call_fwd_unique_active ON public.call_forwarding_rules(phone_number_id) WHERE is_active = true;

CREATE TRIGGER update_call_forwarding_rules_updated_at BEFORE UPDATE ON call_forwarding_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add forwarding columns to calls table
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS forwarded_to character varying(20);
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS forwarding_rule_id uuid REFERENCES call_forwarding_rules(id);

CREATE INDEX idx_calls_forwarded ON public.calls(forwarded_to) WHERE forwarded_to IS NOT NULL;
CREATE INDEX idx_calls_forwarding_rule ON public.calls(forwarding_rule_id) WHERE forwarding_rule_id IS NOT NULL;
