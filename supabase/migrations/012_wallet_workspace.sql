-- Migration: make wallets & wallet_transactions workspace-scoped
-- Run this in Supabase SQL editor

-- 1. Add workspace_id column to wallets
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

-- 2. Populate workspace_id from users.default_workspace_id
UPDATE wallets w
SET workspace_id = u.default_workspace_id
FROM users u
WHERE w.user_id = u.id
  AND u.default_workspace_id IS NOT NULL
  AND w.workspace_id IS NULL;

-- 3. Fallback: populate from first active workspace membership
UPDATE wallets w
SET workspace_id = (
  SELECT workspace_id FROM workspace_members
  WHERE user_id = w.user_id AND is_active = true
  ORDER BY created_at ASC LIMIT 1
)
WHERE w.workspace_id IS NULL;

-- 4. Add workspace_id column to wallet_transactions
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

-- 5. Populate wallet_transactions.workspace_id from wallets
UPDATE wallet_transactions wt
SET workspace_id = w.workspace_id
FROM wallets w
WHERE wt.user_id = w.user_id
  AND w.workspace_id IS NOT NULL
  AND wt.workspace_id IS NULL;
