-- 021_referrals.sql

-- Referral code on workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- Admin-configurable commission settings (single row)
CREATE TABLE IF NOT EXISTS referral_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_type TEXT        NOT NULL DEFAULT 'flat',   -- 'flat' | 'percent'
  commission_value NUMERIC(10,2) NOT NULL DEFAULT 10.00,
  cookie_days     INT         NOT NULL DEFAULT 30,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO referral_settings (commission_type, commission_value, cookie_days, enabled)
VALUES ('flat', 10.00, 30, true)
ON CONFLICT DO NOTHING;

-- Referral tracking (one row per referred workspace)
CREATE TABLE IF NOT EXISTS referrals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  referred_workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  referred_email         TEXT        NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'pending',  -- pending | qualified | paid
  commission_amount      NUMERIC(10,2),
  stripe_subscription_id TEXT,
  qualified_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referred_workspace_id)
);

-- Earnings balance per workspace
CREATE TABLE IF NOT EXISTS referral_balances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  balance             NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  lifetime_earned     NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  lifetime_withdrawn  NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Withdrawal requests
CREATE TABLE IF NOT EXISTS referral_withdrawals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  amount         NUMERIC(10,2) NOT NULL,
  method         TEXT        NOT NULL,   -- 'paypal' | 'bank'
  payout_details JSONB       NOT NULL,   -- { email } or { bank_name, account_number, routing_number }
  status         TEXT        NOT NULL DEFAULT 'pending',  -- pending | processing | completed | rejected
  admin_note     TEXT,
  processed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer  ON referrals(referrer_workspace_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status    ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_ws      ON referral_withdrawals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status  ON referral_withdrawals(status);
