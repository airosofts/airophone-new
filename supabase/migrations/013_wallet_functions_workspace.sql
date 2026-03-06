-- Migration: update wallet RPC functions to use workspace_id instead of user_id
-- Run this in Supabase SQL editor

-- 1. Update can_afford_message_cost_v2 to accept workspace_id
CREATE OR REPLACE FUNCTION can_afford_message_cost_v2(
  p_workspace_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_message_count INTEGER DEFAULT 1,
  p_cost_per_message DECIMAL DEFAULT 0.03
)
RETURNS TABLE (
  can_afford BOOLEAN,
  current_balance DECIMAL,
  required_amount DECIMAL,
  shortage DECIMAL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_credits DECIMAL := 0;
  v_required DECIMAL;
BEGIN
  v_required := p_message_count * p_cost_per_message;

  -- Prefer workspace_id lookup (shared wallet), fall back to user_id
  IF p_workspace_id IS NOT NULL THEN
    SELECT credits INTO v_credits
    FROM wallets
    WHERE workspace_id = p_workspace_id;
  ELSIF p_user_id IS NOT NULL THEN
    SELECT credits INTO v_credits
    FROM wallets
    WHERE user_id = p_user_id;
  END IF;

  v_credits := COALESCE(v_credits, 0);

  RETURN QUERY SELECT
    v_credits >= v_required,
    v_credits,
    v_required,
    GREATEST(0, v_required - v_credits);
END;
$$;

-- 2. Update deduct_message_cost to deduct from workspace wallet
DROP FUNCTION IF EXISTS deduct_message_cost(uuid,uuid,integer,numeric,text,uuid,uuid,text);
CREATE OR REPLACE FUNCTION deduct_message_cost(
  p_user_id UUID,
  p_workspace_id UUID DEFAULT NULL,
  p_message_count INTEGER DEFAULT 1,
  p_cost_per_message DECIMAL DEFAULT 0.03,
  p_description TEXT DEFAULT 'SMS message',
  p_campaign_id UUID DEFAULT NULL,
  p_message_id UUID DEFAULT NULL,
  p_recipient_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  new_balance DECIMAL,
  error_message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_cost DECIMAL;
  v_credits DECIMAL := 0;
  v_wallet_id UUID;
BEGIN
  v_total_cost := p_message_count * p_cost_per_message;

  -- Find workspace wallet first, fall back to user wallet
  IF p_workspace_id IS NOT NULL THEN
    SELECT id, credits INTO v_wallet_id, v_credits
    FROM wallets
    WHERE workspace_id = p_workspace_id
    FOR UPDATE;
  END IF;

  IF v_wallet_id IS NULL THEN
    SELECT id, credits INTO v_wallet_id, v_credits
    FROM wallets
    WHERE user_id = p_user_id
    FOR UPDATE;
  END IF;

  IF v_wallet_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::DECIMAL, 'Wallet not found'::TEXT;
    RETURN;
  END IF;

  IF v_credits < v_total_cost THEN
    RETURN QUERY SELECT FALSE, v_credits, 'Insufficient credits'::TEXT;
    RETURN;
  END IF;

  -- Deduct credits
  UPDATE wallets
  SET credits = credits - v_total_cost,
      updated_at = NOW()
  WHERE id = v_wallet_id;

  -- Record transaction
  INSERT INTO wallet_transactions (
    user_id,
    workspace_id,
    amount,
    type,
    status,
    description
  ) VALUES (
    p_user_id,
    p_workspace_id,
    -v_total_cost,
    'deduction',
    'completed',
    p_description
  );

  RETURN QUERY SELECT TRUE, (v_credits - v_total_cost), NULL::TEXT;
END;
$$;
