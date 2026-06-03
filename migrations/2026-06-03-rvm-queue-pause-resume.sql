-- Makes RVM campaigns resilient + pausable + truly progressive.
--
-- Architecture change: the current /start route iterates contacts in-process
-- (an async promise). If the API restarts mid-loop, the loop dies and the
-- remaining sends are lost. We replace this with a queue model — each
-- recipient becomes a row in voicemail_campaign_sends, and a cron sweeper
-- picks them up. Pause/resume just toggles the campaign status.
--
-- Resilience properties this gives us:
--   • Tab close — irrelevant, work runs in the cron, not the browser
--   • API restart — sweeper picks up where it left off
--   • Pause — sweeper checks campaign status each tick; respects 'paused'
--   • Resume — flip status back to 'running' and the sweeper sees it
--
-- The unique (campaign_id, phone) constraint makes the enqueue idempotent:
-- re-running /start on the same campaign just no-ops.

create table if not exists voicemail_campaign_sends (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references voicemail_campaigns(id) on delete cascade,
  workspace_id    uuid not null,
  contact_id      uuid,
  phone           text not null,
  source_column   text,
  status          text not null default 'queued'
                    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  error           text,
  sent_at         timestamptz,
  message_id      uuid,
  conversation_id uuid,
  created_at      timestamptz not null default now(),
  unique (campaign_id, phone)
);

-- The sweeper queries by (campaign + status), so a composite index keeps
-- batch claims O(log n) even with millions of queued rows.
create index if not exists voicemail_campaign_sends_status_idx
  on voicemail_campaign_sends(campaign_id, status);
create index if not exists voicemail_campaign_sends_workspace_idx
  on voicemail_campaign_sends(workspace_id, status);

-- Live counters cached on the campaign row so the UI can render progress
-- in one query (no per-row aggregation). Sweeper bumps these as it works.
alter table voicemail_campaigns
  add column if not exists total_recipients int not null default 0,
  add column if not exists sent_count       int not null default 0,
  add column if not exists failed_count     int not null default 0,
  add column if not exists paused_at        timestamptz,
  add column if not exists completed_at     timestamptz;

-- Allow 'paused' as a valid status. We don't have a strict check on
-- voicemail_campaigns.status (it's plain text), but we document the values
-- here for future maintainers:
--   draft → running → completed
--                ↘ paused ↗   (toggleable while running)
--                ↘ failed     (terminal — every send failed)
