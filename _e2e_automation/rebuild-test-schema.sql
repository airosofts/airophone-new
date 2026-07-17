create extension if not exists pgcrypto;

create table if not exists public.monday_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, name text, board_id text, board_name text,
  trigger_event text, monday_webhook_id text, phone_column_id text,
  message_mode text, message_template text, ai_instructions text,
  sender_phone_number_id text, is_active boolean default true,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  send_delay_seconds int default 0, respect_business_hours boolean default false,
  business_hours_mode text default 'anytime',
  graph jsonb
);

create table if not exists public.sheets_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, name text, spreadsheet_id text, spreadsheet_name text,
  sheet_id bigint, sheet_name text, trigger_event text default 'new_row',
  phone_column text, message_mode text, message_template text, ai_instructions text,
  sender_phone_number_id text, send_delay_seconds int default 0,
  business_hours_mode text default 'anytime', is_active boolean default true,
  last_polled_at timestamptz, created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  graph jsonb
);

create table if not exists public.monday_writeback_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, board_id text, board_name text,
  on_sent_column_id text, on_sent_column_type text, on_sent_value jsonb,
  on_reply_column_id text, on_reply_column_type text, on_reply_value jsonb,
  on_done_column_id text, on_done_column_type text, on_done_value jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.sheets_writeback_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, spreadsheet_id text, sheet_id bigint, sheet_name text,
  on_sent_column text, on_sent_value text,
  on_reply_column text, on_reply_value text,
  on_done_column text, on_done_value text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.monday_automation_sends (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid, monday_item_id text, conversation_id uuid, message_id uuid,
  status text, detail text, created_at timestamptz default now(), scheduled_at timestamptz
);
