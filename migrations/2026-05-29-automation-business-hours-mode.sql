-- Replaces the boolean "respect business hours" with a three-way mode so an
-- automation can send: any time, only within business hours, or only OUTSIDE
-- business hours (e.g. after-hours auto-texts).
--
-- The legacy boolean column is kept for backward compatibility; new code reads
-- business_hours_mode and falls back to the boolean when the mode is null.

alter table monday_automations
  add column if not exists business_hours_mode text not null default 'anytime'
    check (business_hours_mode in ('anytime', 'within', 'outside'));

-- Backfill: existing automations that opted into business hours map to 'within'.
update monday_automations
  set business_hours_mode = 'within'
  where respect_business_hours = true
    and business_hours_mode = 'anytime';
         

         