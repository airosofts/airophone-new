-- Add inbox_tour_seen column to track whether each user has completed the inbox product tour.
-- Defaults to FALSE so all existing users will see the tour once.
ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS inbox_tour_seen BOOLEAN NOT NULL DEFAULT FALSE;
