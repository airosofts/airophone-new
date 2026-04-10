-- Onboarding profiles table
create table if not exists public.onboarding_profiles (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid not null,
  usage_type varchar(20) null, -- 'business' or 'personal'
  business_name varchar(255) null,
  business_size varchar(50) null,
  business_website varchar(500) null,
  industry varchar(100) null,
  heard_from varchar(100) null,
  personal_reason varchar(100) null,
  phone_verified boolean not null default false,
  verified_phone varchar(30) null,
  otp_code varchar(10) null,
  otp_expires_at timestamp with time zone null,
  selected_plan varchar(50) null, -- 'starter', 'growth', 'enterprise'
  plan_credits integer null,
  auto_recharge boolean not null default true,
  card_added boolean not null default false,
  onboarding_completed boolean not null default false,
  completed_at timestamp with time zone null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint onboarding_profiles_pkey primary key (id),
  constraint onboarding_profiles_user_id_key unique (user_id),
  constraint onboarding_profiles_user_id_fkey foreign key (user_id) references users (id) on delete cascade,
  constraint onboarding_profiles_workspace_id_fkey foreign key (workspace_id) references workspaces (id) on delete cascade
);

create index if not exists idx_onboarding_user on public.onboarding_profiles using btree (user_id);
create index if not exists idx_onboarding_completed on public.onboarding_profiles using btree (onboarding_completed);
