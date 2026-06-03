-- Per-campaign send throttle for RVM (ringless voicemail) campaigns.
--
--   throttle_count = NULL  → no throttle (max speed; inline drain sends fast)
--   throttle_count = N     → send at most N every throttle_window_seconds
--
-- Window is stored in seconds so the UI can express any rate, e.g.
--   "100 every 15 minutes"  → count=100, window=900
--   "1000 every 1 hour"     → count=1000, window=3600
--   "5 every 1 minute"      → count=5,   window=60
--
-- Enforced by the queue sweeper: it counts sends in the trailing
-- throttle_window_seconds and only releases up to the remaining allowance each
-- cron tick. Throttled campaigns skip the immediate inline drain so the cron
-- meters them out over time.

alter table voicemail_campaigns
  add column if not exists throttle_count          int,
  add column if not exists throttle_window_seconds int not null default 3600;

-- The sweeper counts recent sends per campaign within the window; this index
-- keeps that count fast.
create index if not exists voicemail_campaign_sends_sentat_idx
  on voicemail_campaign_sends(campaign_id, status, sent_at);
