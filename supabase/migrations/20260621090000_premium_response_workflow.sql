-- CREDITOS Premium trial, bureau-response analysis, dispute rounds, and alerts.

alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists subscription_status text;
alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;
alter table public.profiles add column if not exists next_bill_at timestamptz;
alter table public.profiles add column if not exists canceled_at timestamptz;

create index if not exists profiles_stripe_subscription_idx on public.profiles (stripe_subscription_id);

create table if not exists public.premium_trials (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text not null default 'trialing',
  trial_started_at       timestamptz,
  trial_ends_at          timestamptz,
  next_bill_at           timestamptz,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.dispute_rounds (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  dispute_id           uuid references public.disputes(id) on delete set null,
  bureau               text not null check (bureau in ('Experian','Equifax','TransUnion','Unknown')),
  round_number         int not null default 1 check (round_number > 0),
  previous_round_id    uuid references public.dispute_rounds(id) on delete set null,
  status               text not null default 'draft'
                       check (status in ('draft','sent','delivered','investigating','response_received','next_round_ready','overdue','closed')),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  standard_due_at      timestamptz,
  max_due_at           timestamptz,
  response_uploaded_at timestamptz,
  next_round_ready_at  timestamptz,
  next_action          text,
  next_letter_url      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.bureau_responses (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references auth.users(id) on delete cascade,
  dispute_round_id           uuid references public.dispute_rounds(id) on delete set null,
  bureau                     text not null check (bureau in ('Experian','Equifax','TransUnion','Unknown')),
  uploaded_file_url          text not null,
  original_filename          text,
  mime_type                  text,
  response_date              date,
  client_name                text,
  detected_accounts_json     jsonb not null default '[]'::jsonb,
  ai_summary                 text,
  confidence_score           int check (confidence_score between 0 and 100),
  overall_category           text not null default 'unclear'
                             check (overall_category in ('deleted','updated','verified','unchanged','frivolous_or_irrelevant','needs_more_information','no_investigation','mixed_result','unclear')),
  recommended_next_action    text,
  recommended_letter_type    text,
  missing_documents_json     jsonb not null default '[]'::jsonb,
  next_letter_id             uuid references public.letters(id) on delete set null,
  created_at                 timestamptz not null default now()
);

create table if not exists public.deadline_alerts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  dispute_round_id uuid references public.dispute_rounds(id) on delete cascade,
  alert_type       text not null,
  alert_date       timestamptz not null,
  sent_at          timestamptz,
  read_at          timestamptz,
  status           text not null default 'pending'
                   check (status in ('pending','due','sent','read','dismissed')),
  metadata         jsonb not null default '{}'::jsonb,
  dedupe_key       text not null unique,
  created_at       timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  id           text primary key,
  event_type   text not null,
  status       text not null default 'processing' check (status in ('processing','completed')),
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.premium_trials enable row level security;
alter table public.dispute_rounds enable row level security;
alter table public.bureau_responses enable row level security;
alter table public.deadline_alerts enable row level security;
alter table public.stripe_webhook_events enable row level security;

drop policy if exists "premium_trials_select_own" on public.premium_trials;
create policy "premium_trials_select_own" on public.premium_trials
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "dispute_rounds_select_own" on public.dispute_rounds;
create policy "dispute_rounds_select_own" on public.dispute_rounds
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "bureau_responses_select_own" on public.bureau_responses;
create policy "bureau_responses_select_own" on public.bureau_responses
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "deadline_alerts_select_own" on public.deadline_alerts;
create policy "deadline_alerts_select_own" on public.deadline_alerts
  for select to authenticated using ((select auth.uid()) = user_id);

-- Mutations are intentionally service-role only. Premium entitlement is enforced
-- by the authenticated backend before documents, analyses, rounds, or alerts change.

create index if not exists premium_trials_subscription_idx on public.premium_trials (stripe_subscription_id);
create index if not exists bureau_responses_user_created_idx on public.bureau_responses (user_id, created_at desc);
create index if not exists bureau_responses_round_idx on public.bureau_responses (dispute_round_id);
create index if not exists dispute_rounds_user_created_idx on public.dispute_rounds (user_id, created_at desc);
create index if not exists dispute_rounds_dispute_idx on public.dispute_rounds (dispute_id, round_number desc);
create index if not exists deadline_alerts_user_date_idx on public.deadline_alerts (user_id, alert_date);
create index if not exists deadline_alerts_round_idx on public.deadline_alerts (dispute_round_id, alert_date);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bureau-responses',
  'bureau-responses',
  false,
  10485760,
  array['application/pdf','image/png','image/jpeg','text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
