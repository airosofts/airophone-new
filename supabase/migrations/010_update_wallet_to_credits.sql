-- Migration: Update wallet system to use credits instead of balance
-- This migration updates all database functions to work with the credits column

-- Create wallet_transactions table if it doesn't exist
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup', 'deduction', 'refund')),
  description TEXT,
  campaign_id UUID,
  message_id UUID,
  payment_method_id UUID,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for wallet_transactions
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_type ON wallet_transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON wallet_transactions(created_at DESC);

-- Drop existing functions if they exist
DROP FUNCTION IF EXISTS can_afford_message_cost_v2(uuid, integer, numeric);
DROP FUNCTION IF EXISTS deduct_message_cost(uuid, uuid, integer, numeric, text, uuid, uuid, text);
DROP FUNCTION IF EXISTS update_wallet_credits(uuid, numeric, text, text, uuid, text, text);

-- Function to check if user can afford message cost (using credits)
CREATE OR REPLACE FUNCTION can_afford_message_cost_v2(
  p_user_id UUID,
  p_message_count INTEGER,
  p_cost_per_message NUMERIC
) RETURNS JSONB AS $$
DECLARE
  v_current_credits NUMERIC;
  v_required_credits NUMERIC;
  v_shortage NUMERIC;
BEGIN
  -- Get current credits from wallet
  SELECT COALESCE(credits, 0) INTO v_current_credits
  FROM wallets
  WHERE user_id = p_user_id;

  -- Calculate required credits (each message costs 1 credit)
  v_required_credits := p_message_count;

  -- Check if user has enough credits
  IF v_current_credits >= v_required_credits THEN
    RETURN jsonb_build_object(
      'can_afford', true,
      'current_balance', v_current_credits,
      'required_amount', v_required_credits,
      'shortage', 0
    );
  ELSE
    v_shortage := v_required_credits - v_current_credits;
    RETURN jsonb_build_object(
      'can_afford', false,
      'current_balance', v_current_credits,
      'required_amount', v_required_credits,
      'shortage', v_shortage
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to deduct message cost from wallet (using credits)
-- Simple version - just deducts credits, no transaction logging
CREATE OR REPLACE FUNCTION deduct_message_cost(
  p_user_id UUID,
  p_workspace_id UUID,
  p_message_count INTEGER,
  p_cost_per_message NUMERIC,
  p_description TEXT,
  p_campaign_id UUID DEFAULT NULL,
  p_message_id UUID DEFAULT NULL,
  p_recipient_phone TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_current_credits NUMERIC;
  v_deduction_amount NUMERIC;
  v_new_credits NUMERIC;
BEGIN
  -- Get current credits
  SELECT COALESCE(credits, 0) INTO v_current_credits
  FROM wallets
  WHERE user_id = p_user_id;

  -- Calculate deduction (1 credit per message)
  v_deduction_amount := p_message_count;

  -- Check if user has enough credits
  IF v_current_credits < v_deduction_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Insufficient credits',
      'current_credits', v_current_credits,
      'required_credits', v_deduction_amount
    );
  END IF;

  -- Deduct credits from wallet (no transaction record)
  UPDATE wallets
  SET
    credits = credits - v_deduction_amount,
    updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING credits INTO v_new_credits;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Credits deducted successfully',
    'credits_deducted', v_deduction_amount,
    'new_balance', v_new_credits
  );
END;
$$ LANGUAGE plpgsql;

-- Function to update wallet credits (for topups)
CREATE OR REPLACE FUNCTION update_wallet_credits(
  p_user_id UUID,
  p_credits NUMERIC,
  p_type TEXT,
  p_description TEXT,
  p_payment_method_id UUID DEFAULT NULL,
  p_stripe_payment_intent_id TEXT DEFAULT NULL,
  p_stripe_charge_id TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_transaction_id UUID;
BEGIN
  -- Update or insert wallet
  INSERT INTO wallets (user_id, credits, balance, currency, updated_at)
  VALUES (p_user_id, p_credits, 0, 'USD', NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    credits = wallets.credits + p_credits,
    updated_at = NOW();

  -- Create transaction record
  INSERT INTO wallet_transactions (
    user_id,
    amount,
    type,
    description,
    payment_method_id,
    stripe_payment_intent_id,
    stripe_charge_id
  ) VALUES (
    p_user_id,
    p_credits,
    p_type,
    p_description,
    p_payment_method_id,
    p_stripe_payment_intent_id,
    p_stripe_charge_id
  ) RETURNING id INTO v_transaction_id;

  RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

