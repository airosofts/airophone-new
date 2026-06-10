-- Atomic credit deduction keyed by WORKSPACE that is allowed to go NEGATIVE.
-- Used by RVM sends (and could back the landline scrub) so a big campaign never
-- stops on a low balance — it runs the wallet negative and the user tops up.
-- Single UPDATE = safe under concurrent inline-drain + cron sweeps.
CREATE OR REPLACE FUNCTION deduct_wallet_credits(p_workspace_id uuid, p_amount numeric)
RETURNS numeric AS $$
DECLARE
  v_new numeric;
BEGIN
  UPDATE wallets
    SET credits = COALESCE(credits, 0) - p_amount,
        updated_at = NOW()
    WHERE workspace_id = p_workspace_id
    RETURNING credits INTO v_new;
  RETURN v_new;
END;
$$ LANGUAGE plpgsql;
