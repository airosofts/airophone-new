-- Add plan fields to workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan_name text DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS plan_status text DEFAULT 'trialing';

-- Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  stripe_subscription_id text UNIQUE NOT NULL,
  stripe_customer_id text NOT NULL,
  plan_name text NOT NULL CHECK (plan_name IN ('starter', 'growth', 'enterprise')),
  price_id text NOT NULL,
  status text NOT NULL DEFAULT 'trialing',
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON subscriptions(stripe_subscription_id);
