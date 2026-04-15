-- Track 10DLC campaign assignment status per number
-- Values: null (not assigned), 'pending', 'approved', 'rejected'
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS campaign_status TEXT DEFAULT NULL;
