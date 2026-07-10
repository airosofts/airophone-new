-- Engagement-based recipient filters for SMS campaigns.
-- Stored on the campaign and applied at enqueue time (start + each recurring
-- cycle), evaluated against the SENDER LINE's conversation history:
-- {
--   engagement: 'all' | 'not_replied' | 'not_replied_recent' | 'replied' | 'never_messaged',
--   window_hours: 24,            -- window for not_replied_recent
--   skip_contacted_hours: 0,     -- >0 = skip anyone texted within N hours
--   exclude_statuses: ['do_not_call']
-- }
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS recipient_filters jsonb;
