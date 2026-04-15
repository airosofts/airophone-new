-- Add auto-recharge settings to workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS auto_recharge_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_recharge_threshold integer DEFAULT 50,
  ADD COLUMN IF NOT EXISTS auto_recharge_amount integer DEFAULT 200;

-- Add credits column to transactions table if missing
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS credits integer DEFAULT 0;
