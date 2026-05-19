-- PostgREST error PGRST203 — two overloads of purchase_phone_number exist
-- (one with TEXT params, one with VARCHAR), and Supabase RPC can't choose
-- between them. Symptom: number gets bought from Telnyx but the DB write
-- fails, leaving an orphan (paid for on Telnyx, missing from phone_numbers).
--
-- Migration 022 only dropped the TEXT signature before recreating, so when
-- it ran against a DB that already had the VARCHAR version, both stuck around.
-- This migration drops both signatures explicitly, then recreates only TEXT.
--
-- Safe to run repeatedly — DROP IF EXISTS is idempotent and the recreate
-- step is the same definition as migration 022.

DROP FUNCTION IF EXISTS public.purchase_phone_number(
  UUID, TEXT, TEXT, UUID, DECIMAL, DECIMAL, TEXT, TEXT
);
DROP FUNCTION IF EXISTS public.purchase_phone_number(
  UUID, VARCHAR, VARCHAR, UUID, DECIMAL, DECIMAL, VARCHAR, VARCHAR
);

CREATE OR REPLACE FUNCTION public.purchase_phone_number(
  p_user_id              UUID,
  p_phone_number_id      TEXT,
  p_phone_number         TEXT,
  p_workspace_id         UUID,
  p_purchase_price       DECIMAL,
  p_monthly_price        DECIMAL,
  p_messaging_profile_id TEXT DEFAULT NULL,
  p_billing_group_id     TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_wallet_id       UUID;
  v_current_credits NUMERIC;
  v_new_credits     NUMERIC;
  v_transaction_id  UUID;
  v_phone_uuid      UUID;
  v_result          JSON;
BEGIN
  BEGIN
    v_phone_uuid := p_phone_number_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    v_phone_uuid := gen_random_uuid();
  END;

  SELECT id, credits INTO v_wallet_id, v_current_credits
  FROM   wallets
  WHERE  workspace_id = p_workspace_id
  LIMIT  1;

  IF v_wallet_id IS NULL THEN
    SELECT id, credits INTO v_wallet_id, v_current_credits
    FROM   wallets
    WHERE  user_id = p_user_id
    LIMIT  1;
  END IF;

  IF v_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found for workspace % / user %', p_workspace_id, p_user_id;
  END IF;

  IF p_purchase_price > 0 AND v_current_credits < p_purchase_price THEN
    RAISE EXCEPTION 'Insufficient credits. Required: %, Available: %',
      p_purchase_price, v_current_credits;
  END IF;

  v_new_credits := v_current_credits - p_purchase_price;

  UPDATE wallets
  SET    credits    = v_new_credits,
         updated_at = NOW()
  WHERE  id = v_wallet_id;

  INSERT INTO phone_numbers (
    id, phone_number, workspace_id, messaging_profile_id, billing_group_id,
    purchase_price, monthly_price, purchased_by, status, is_active,
    created_at, updated_at
  ) VALUES (
    v_phone_uuid, p_phone_number, p_workspace_id, p_messaging_profile_id, p_billing_group_id,
    p_purchase_price, p_monthly_price, p_user_id, 'active', true,
    NOW(), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    workspace_id         = EXCLUDED.workspace_id,
    messaging_profile_id = EXCLUDED.messaging_profile_id,
    billing_group_id     = EXCLUDED.billing_group_id,
    purchase_price       = EXCLUDED.purchase_price,
    monthly_price        = EXCLUDED.monthly_price,
    purchased_by         = EXCLUDED.purchased_by,
    status               = 'active',
    is_active            = true,
    updated_at           = NOW();

  IF p_purchase_price > 0 THEN
    INSERT INTO transactions (
      user_id, wallet_id, type, amount, balance_before, balance_after,
      description, status, phone_number_id, metadata, created_at, updated_at
    ) VALUES (
      p_user_id, v_wallet_id, 'deduction', p_purchase_price, v_current_credits, v_new_credits,
      'Phone number purchase: ' || p_phone_number, 'completed', v_phone_uuid::TEXT,
      jsonb_build_object(
        'phone_number',  p_phone_number,
        'workspace_id',  p_workspace_id,
        'purchase_type', 'phone_number'
      ),
      NOW(), NOW()
    )
    RETURNING id INTO v_transaction_id;
  END IF;

  v_result := json_build_object(
    'success',          true,
    'wallet_id',        v_wallet_id,
    'transaction_id',   v_transaction_id,
    'previous_credits', v_current_credits,
    'new_credits',      v_new_credits,
    'amount_deducted',  p_purchase_price,
    'phone_number',     p_phone_number,
    'phone_number_id',  v_phone_uuid
  );

  RETURN v_result;
END;
$$;

-- Verify only one overload exists now. Run interactively:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM   pg_proc WHERE proname = 'purchase_phone_number';
-- Should return exactly one row.
