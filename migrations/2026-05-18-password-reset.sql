-- Adds the columns needed for the email-based forgot-password flow.
-- A 6-digit code is stored on the user row, expires after 15 minutes,
-- and is cleared on successful reset (or on next send).
--
-- We also track sent_at so the API can rate-limit "resend" clicks
-- (one code per 60s) and attempts so we can lock out brute-force guessing.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS password_reset_code         varchar(6),
  ADD COLUMN IF NOT EXISTS password_reset_expires_at   timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_attempts     int not null default 0;

-- Lookup by email already has an index (idx_users_email); the reset endpoint
-- always queries by email first, so no additional index is needed.
