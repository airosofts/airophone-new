-- Make RVM campaign completion reflect actual DELIVERY, not just dispatch.
--
-- Lifecycle per recipient (voicemail_campaign_sends.status):
--   queued → sending → sent      (VoiceDrop accepted; awaiting delivery webhook)
--                       sent → delivered   (webhook: delivered)
--                       sent → failed      (webhook: not-delivered / skipped, or
--                                            a hard dispatch failure)
--
-- A campaign is 'completed' only when every recipient is delivered/failed —
-- OR a 'sent' row has aged past the delivery timeout (webhook never arrived),
-- so a missed webhook can't hang the campaign forever.

alter table voicemail_campaign_sends
  drop constraint if exists voicemail_campaign_sends_status_check;
alter table voicemail_campaign_sends
  add constraint voicemail_campaign_sends_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'skipped'));

alter table voicemail_campaign_sends
  add column if not exists delivered_at timestamptz;

-- delivered_count already exists on voicemail_campaigns; add an undelivered
-- count so the UI can show delivered vs not-delivered explicitly.
alter table voicemail_campaigns
  add column if not exists undelivered_count int not null default 0;
