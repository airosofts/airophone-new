-- The onboarding "WhatsApp" verification step has always been plain SMS via
-- Telnyx Verify (the column names were misleading). Rename to match reality.
--
-- Safe to run multiple times: each rename is wrapped in DO blocks that check
-- if the source column exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_profiles' AND column_name = 'whatsapp_phone'
  ) THEN
    ALTER TABLE onboarding_profiles RENAME COLUMN whatsapp_phone TO phone;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'onboarding_profiles' AND column_name = 'whatsapp_verified'
  ) THEN
    ALTER TABLE onboarding_profiles RENAME COLUMN whatsapp_verified TO phone_verified;
  END IF;
END $$;
