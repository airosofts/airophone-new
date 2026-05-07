-- Migration: Phone number recycling system
-- Numbers flow: pending → quarantine (30-day hold) → available → assigned

CREATE TABLE IF NOT EXISTS recycled_numbers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number              TEXT NOT NULL,
  original_workspace_id     UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  original_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  telnyx_messaging_profile_id TEXT,
  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','quarantine','available','assigned')),
  quarantine_until          TIMESTAMPTZ,
  failed_payment_at         TIMESTAMPTZ,
  entered_cycle_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_to_workspace_id  UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  assigned_at               TIMESTAMPTZ,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS recycled_numbers_phone_active_idx
  ON recycled_numbers (phone_number)
  WHERE status NOT IN ('assigned');

CREATE INDEX IF NOT EXISTS recycled_numbers_status_idx ON recycled_numbers (status);
CREATE INDEX IF NOT EXISTS recycled_numbers_original_workspace_idx ON recycled_numbers (original_workspace_id);
