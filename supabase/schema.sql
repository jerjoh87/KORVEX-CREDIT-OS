-- ─────────────────────────────────────────────────────────────────
--  CREDITOS — Full database schema, RLS policies, and indexes
--  Run once in the Supabase SQL editor (idempotent).
--
--  Tables:
--    profiles            — plan, credits, Stripe linkage (1 row per user)
--    letters             — generated letter history
--    clients             — agency CRM clients
--    recipient_address_book — reusable mailing recipients
--    disputes            — tracked disputes (package-style timeline)
--    onboarding_profiles — wizard answers + computed scores
--    user_state          — cross-device progress, vault, badges, and preferences
--    launch_verification_events — launch proof log for auth / Stripe / mail
--    credit_report_uploads  — private per-user report history and analysis
--    leads               — landing-page quiz leads (service-role only)
--
--  Security model: anon key + RLS. Every user-facing table has
--  owner-only policies on user_id. The backend uses the service
--  role key and bypasses RLS for webhooks/credits.
-- ─────────────────────────────────────────────────────────────────

-- ── profiles ─────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              text,
  plan               text not null default 'free',
  credits            int  not null default 3,
  payment_failed     boolean not null default false,
  is_admin           boolean not null default false,
  stripe_customer_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Upgrade compatibility for earlier CREDITOS schemas.
alter table public.profiles add column if not exists payment_failed boolean not null default false;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists subscription_status text;
alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;
alter table public.profiles add column if not exists next_bill_at timestamptz;
alter table public.profiles add column if not exists canceled_at timestamptz;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users own profile" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

-- No insert/update/delete policies for users: plan & credits are only
-- mutated by the backend (service role) and the signup trigger below.

create index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id);
create index if not exists profiles_email_idx           on public.profiles (email);
create index if not exists profiles_stripe_subscription_idx on public.profiles (stripe_subscription_id);

-- Auto-create a profile (with 3 free trial credits) on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, plan, credits, is_admin)
  values (new.id, new.email, 'free', 3, false)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── letters ──────────────────────────────────────────────────────
create table if not exists public.letters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text,
  creditor   text,
  content    text,
  created_at timestamptz not null default now()
);

alter table public.letters add column if not exists type text;
alter table public.letters add column if not exists content text;

alter table public.letters enable row level security;

drop policy if exists "Users own letters" on public.letters;

drop policy if exists "letters_select_own" on public.letters;
create policy "letters_select_own" on public.letters for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "letters_insert_own" on public.letters;
create policy "letters_insert_own" on public.letters for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "letters_delete_own" on public.letters;
create policy "letters_delete_own" on public.letters for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists letters_user_created_idx on public.letters (user_id, created_at desc);

-- ── clients (agency CRM) ─────────────────────────────────────────
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  email        text,
  credit_score int,
  notes        text,
  created_at   timestamptz not null default now()
);

alter table public.clients add column if not exists credit_score int;

alter table public.clients enable row level security;

drop policy if exists "Users own clients" on public.clients;

drop policy if exists "clients_select_own" on public.clients;
create policy "clients_select_own" on public.clients for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "clients_insert_own" on public.clients;
create policy "clients_insert_own" on public.clients for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "clients_update_own" on public.clients;
create policy "clients_update_own" on public.clients for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_delete_own" on public.clients for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists clients_user_created_idx on public.clients (user_id, created_at desc);

-- ── recipient_address_book ─────────────────────────────────────
create table if not exists public.recipient_address_book (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid references auth.users(id) on delete cascade,
  user_id             uuid references auth.users(id) on delete cascade,
  recipient_type      text not null,
  recipient_name      text not null,
  department          text,
  address_line_1      text not null,
  address_line_2      text,
  city                text not null,
  state               text not null,
  postal_code         text not null,
  country             text not null default 'United States',
  is_default          boolean not null default false,
  is_active           boolean not null default true,
  is_system_recipient boolean not null default false,
  last_verified_at    timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.recipient_address_book add column if not exists organization_id uuid references auth.users(id) on delete cascade;
alter table public.recipient_address_book add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.recipient_address_book add column if not exists recipient_type text;
alter table public.recipient_address_book add column if not exists recipient_name text;
alter table public.recipient_address_book add column if not exists department text;
alter table public.recipient_address_book add column if not exists address_line_1 text;
alter table public.recipient_address_book add column if not exists address_line_2 text;
alter table public.recipient_address_book add column if not exists city text;
alter table public.recipient_address_book add column if not exists state text;
alter table public.recipient_address_book add column if not exists postal_code text;
alter table public.recipient_address_book add column if not exists country text not null default 'United States';
alter table public.recipient_address_book add column if not exists is_default boolean not null default false;
alter table public.recipient_address_book add column if not exists is_active boolean not null default true;
alter table public.recipient_address_book add column if not exists is_system_recipient boolean not null default false;
alter table public.recipient_address_book add column if not exists last_verified_at timestamptz;
alter table public.recipient_address_book add column if not exists notes text;
alter table public.recipient_address_book add column if not exists updated_at timestamptz not null default now();

alter table public.recipient_address_book enable row level security;

drop policy if exists "recipient_book_select_system" on public.recipient_address_book;
create policy "recipient_book_select_system" on public.recipient_address_book
  for select to authenticated using (is_system_recipient and is_active);
drop policy if exists "recipient_book_select_own" on public.recipient_address_book;
create policy "recipient_book_select_own" on public.recipient_address_book
  for select to authenticated using ((select auth.uid()) = user_id or (select auth.uid()) = organization_id);
drop policy if exists "recipient_book_insert_own" on public.recipient_address_book;
create policy "recipient_book_insert_own" on public.recipient_address_book
  for insert to authenticated with check ((select auth.uid()) = user_id and (select auth.uid()) = organization_id and not is_system_recipient);
drop policy if exists "recipient_book_update_own" on public.recipient_address_book;
create policy "recipient_book_update_own" on public.recipient_address_book
  for update to authenticated
  using ((select auth.uid()) = user_id or (select auth.uid()) = organization_id)
  with check ((select auth.uid()) = user_id or (select auth.uid()) = organization_id);
drop policy if exists "recipient_book_delete_own" on public.recipient_address_book;
create policy "recipient_book_delete_own" on public.recipient_address_book
  for delete to authenticated using ((select auth.uid()) = user_id or (select auth.uid()) = organization_id);

create index if not exists recipient_book_system_type_idx on public.recipient_address_book (recipient_type, is_system_recipient);
create index if not exists recipient_book_org_idx on public.recipient_address_book (organization_id, is_active);
create index if not exists recipient_book_user_idx on public.recipient_address_book (user_id, is_active);

-- ── disputes ─────────────────────────────────────────────────────
create table if not exists public.disputes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  creditor    text,
  bureau      text,
  item_type   text,
  status      text not null default 'draft'
              check (status in ('draft','mailed','investigating','resolved','deleted','verified','escalated')),
  round       int  not null default 1,
  mailed_at   timestamptz,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.disputes add column if not exists item_type text;
alter table public.disputes add column if not exists round int not null default 1;
alter table public.disputes add column if not exists mailed_at timestamptz;
alter table public.disputes add column if not exists resolved_at timestamptz;

alter table public.disputes enable row level security;

drop policy if exists "Users own disputes" on public.disputes;

drop policy if exists "disputes_select_own" on public.disputes;
create policy "disputes_select_own" on public.disputes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "disputes_insert_own" on public.disputes;
create policy "disputes_insert_own" on public.disputes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "disputes_update_own" on public.disputes;
create policy "disputes_update_own" on public.disputes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "disputes_delete_own" on public.disputes;
create policy "disputes_delete_own" on public.disputes for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists disputes_user_created_idx on public.disputes (user_id, created_at desc);
create index if not exists disputes_user_status_idx  on public.disputes (user_id, status);

-- ── Premium trial + bureau response operating system ──────────
create table if not exists public.premium_trials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'trialing',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  next_bill_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dispute_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dispute_id uuid references public.disputes(id) on delete set null,
  bureau text not null check (bureau in ('Experian','Equifax','TransUnion','Unknown')),
  round_number int not null default 1 check (round_number > 0),
  previous_round_id uuid references public.dispute_rounds(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','sent','delivered','investigating','response_received','next_round_ready','overdue','closed')),
  sent_at timestamptz,
  delivered_at timestamptz,
  standard_due_at timestamptz,
  max_due_at timestamptz,
  response_uploaded_at timestamptz,
  next_round_ready_at timestamptz,
  next_action text,
  next_letter_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bureau_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dispute_round_id uuid references public.dispute_rounds(id) on delete set null,
  bureau text not null check (bureau in ('Experian','Equifax','TransUnion','Unknown')),
  uploaded_file_url text not null,
  original_filename text,
  mime_type text,
  response_date date,
  client_name text,
  detected_accounts_json jsonb not null default '[]'::jsonb,
  ai_summary text,
  confidence_score int check (confidence_score between 0 and 100),
  overall_category text not null default 'unclear' check (overall_category in ('deleted','updated','verified','unchanged','frivolous_or_irrelevant','needs_more_information','no_investigation','mixed_result','unclear')),
  recommended_next_action text,
  recommended_letter_type text,
  missing_documents_json jsonb not null default '[]'::jsonb,
  next_letter_id uuid references public.letters(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.deadline_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dispute_round_id uuid references public.dispute_rounds(id) on delete cascade,
  case_id uuid references public.dispute_cases(id) on delete cascade,
  alert_type text not null,
  alert_date timestamptz not null,
  title text not null default 'Deadline alert',
  body text,
  sent_at timestamptz,
  read_at timestamptz,
  status text not null default 'pending' check (status in ('pending','due','sent','read','dismissed')),
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing','completed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.launch_verification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  provider text not null,
  status text not null default 'pass' check (status in ('pass','fail','blocked')),
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.credit_report_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text,
  file_type text,
  storage_path text,
  extraction_method text not null default 'text',
  characters_received int not null default 0,
  extracted_text text,
  analysis_json jsonb not null default '{}'::jsonb,
  analysis_summary jsonb not null default '{}'::jsonb,
  bureau_scores_json jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new','reviewing','disputed','waiting_response','resolved','escalated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.premium_trials enable row level security;
alter table public.dispute_rounds enable row level security;
alter table public.bureau_responses enable row level security;
alter table public.deadline_alerts enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.launch_verification_events enable row level security;
alter table public.credit_report_uploads enable row level security;

drop policy if exists "premium_trials_select_own" on public.premium_trials;
create policy "premium_trials_select_own" on public.premium_trials for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "dispute_rounds_select_own" on public.dispute_rounds;
create policy "dispute_rounds_select_own" on public.dispute_rounds for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "bureau_responses_select_own" on public.bureau_responses;
create policy "bureau_responses_select_own" on public.bureau_responses for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "deadline_alerts_select_own" on public.deadline_alerts;
create policy "deadline_alerts_select_own" on public.deadline_alerts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_select_own" on public.credit_report_uploads;
create policy "credit_report_uploads_select_own" on public.credit_report_uploads for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_insert_own" on public.credit_report_uploads;
create policy "credit_report_uploads_insert_own" on public.credit_report_uploads for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_update_own" on public.credit_report_uploads;
create policy "credit_report_uploads_update_own" on public.credit_report_uploads for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_delete_own" on public.credit_report_uploads;
create policy "credit_report_uploads_delete_own" on public.credit_report_uploads for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists premium_trials_subscription_idx on public.premium_trials (stripe_subscription_id);
create index if not exists bureau_responses_user_created_idx on public.bureau_responses (user_id, created_at desc);
create index if not exists bureau_responses_round_idx on public.bureau_responses (dispute_round_id);
create index if not exists dispute_rounds_user_created_idx on public.dispute_rounds (user_id, created_at desc);
create index if not exists dispute_rounds_dispute_idx on public.dispute_rounds (dispute_id, round_number desc);
create index if not exists deadline_alerts_user_date_idx on public.deadline_alerts (user_id, alert_date);
create index if not exists launch_verification_events_type_idx on public.launch_verification_events (event_type, created_at desc);
create index if not exists launch_verification_events_user_idx on public.launch_verification_events (user_id, created_at desc);
create index if not exists credit_report_uploads_user_created_idx on public.credit_report_uploads (user_id, created_at desc);
create index if not exists credit_report_uploads_status_idx on public.credit_report_uploads (user_id, status, updated_at desc);

-- ── mail_jobs (certified mailing workflow) ──────────────────────
create table if not exists public.mail_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  dispute_id          uuid references public.disputes(id) on delete set null,
  letter_id           uuid references public.letters(id) on delete set null,
  status              text not null default 'draft'
                      check (status in ('draft','payment_pending','queued','submitted','mailed','failed','blocked')),
  mail_batch_id       uuid,
  mail_batch_index    int,
  recipient_address_book_id uuid references public.recipient_address_book(id) on delete set null,
  recipient_address   jsonb not null default '{}'::jsonb,
  recipient_snapshot_json jsonb not null default '{}'::jsonb,
  return_address      jsonb not null default '{}'::jsonb,
  supporting_docs     jsonb not null default '[]'::jsonb,
  letter_text         text not null default '',
  service_fee_cents   int not null default 1999,
  mailing_cost_cents  int not null default 550,
  stripe_session_id    text,
  click2mail_document_id text,
  click2mail_address_list_id text,
  click2mail_job_id   text,
  packet_path         text,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.mail_jobs enable row level security;

alter table public.mail_jobs add column if not exists mail_batch_id uuid;
alter table public.mail_jobs add column if not exists mail_batch_index int;
alter table public.mail_jobs add column if not exists recipient_address_book_id uuid references public.recipient_address_book(id) on delete set null;
alter table public.mail_jobs add column if not exists recipient_snapshot_json jsonb not null default '{}'::jsonb;

drop policy if exists "mail_jobs_select_own" on public.mail_jobs;
create policy "mail_jobs_select_own" on public.mail_jobs for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "mail_jobs_insert_own" on public.mail_jobs;
create policy "mail_jobs_insert_own" on public.mail_jobs for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "mail_jobs_update_own" on public.mail_jobs;
create policy "mail_jobs_update_own" on public.mail_jobs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists mail_jobs_user_created_idx on public.mail_jobs (user_id, created_at desc);
create index if not exists mail_jobs_user_status_idx on public.mail_jobs (user_id, status);
create index if not exists mail_jobs_batch_idx on public.mail_jobs (mail_batch_id, mail_batch_index);

-- ── onboarding_profiles ──────────────────────────────────────────
create table if not exists public.onboarding_profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  answers         jsonb,
  health_score    int,
  readiness_score int,
  updated_at      timestamptz not null default now()
);

alter table public.onboarding_profiles enable row level security;

drop policy if exists "onboarding_select_own" on public.onboarding_profiles;
create policy "onboarding_select_own" on public.onboarding_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "onboarding_insert_own" on public.onboarding_profiles;
create policy "onboarding_insert_own" on public.onboarding_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "onboarding_update_own" on public.onboarding_profiles;
create policy "onboarding_update_own" on public.onboarding_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ── user_state (cross-device app progress) ──────────────────────
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

drop policy if exists "user_state_select_own" on public.user_state;
create policy "user_state_select_own" on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "user_state_insert_own" on public.user_state;
create policy "user_state_insert_own" on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "user_state_update_own" on public.user_state;
create policy "user_state_update_own" on public.user_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "user_state_delete_own" on public.user_state;
create policy "user_state_delete_own" on public.user_state for delete to authenticated using ((select auth.uid()) = user_id);

-- ── business_credit_profiles (business command center) ─────────
create table if not exists public.business_credit_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  profile    jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.business_credit_profiles enable row level security;

drop policy if exists "business_credit_profiles_select_own" on public.business_credit_profiles;
create policy "business_credit_profiles_select_own" on public.business_credit_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "business_credit_profiles_insert_own" on public.business_credit_profiles;
create policy "business_credit_profiles_insert_own" on public.business_credit_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "business_credit_profiles_update_own" on public.business_credit_profiles;
create policy "business_credit_profiles_update_own" on public.business_credit_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "business_credit_profiles_delete_own" on public.business_credit_profiles;
create policy "business_credit_profiles_delete_own" on public.business_credit_profiles for delete to authenticated using ((select auth.uid()) = user_id);

-- ── business_tradelines (vendor / tradeline tracker) ───────────
create table if not exists public.business_tradelines (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  vendor_name  text not null,
  note         text,
  stage        int not null default 0 check (stage between 0 and 3),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, vendor_name)
);

alter table public.business_tradelines enable row level security;

drop policy if exists "business_tradelines_select_own" on public.business_tradelines;
create policy "business_tradelines_select_own" on public.business_tradelines for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "business_tradelines_insert_own" on public.business_tradelines;
create policy "business_tradelines_insert_own" on public.business_tradelines for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "business_tradelines_update_own" on public.business_tradelines;
create policy "business_tradelines_update_own" on public.business_tradelines for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "business_tradelines_delete_own" on public.business_tradelines;
create policy "business_tradelines_delete_own" on public.business_tradelines for delete to authenticated using ((select auth.uid()) = user_id);

-- ── business_credit_checklist_items (setup progress tracker) ───
create table if not exists public.business_credit_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_key     text not null,
  label        text not null,
  status       text not null default 'not_started' check (status in ('not_started','in_progress','completed','blocked')),
  notes        text,
  due_date     date,
  document_url text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, item_key)
);

alter table public.business_credit_checklist_items enable row level security;

drop policy if exists "business_credit_checklist_select_own" on public.business_credit_checklist_items;
create policy "business_credit_checklist_select_own" on public.business_credit_checklist_items for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "business_credit_checklist_insert_own" on public.business_credit_checklist_items;
create policy "business_credit_checklist_insert_own" on public.business_credit_checklist_items for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "business_credit_checklist_update_own" on public.business_credit_checklist_items;
create policy "business_credit_checklist_update_own" on public.business_credit_checklist_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "business_credit_checklist_delete_own" on public.business_credit_checklist_items;
create policy "business_credit_checklist_delete_own" on public.business_credit_checklist_items for delete to authenticated using ((select auth.uid()) = user_id);

-- ── leads (service-role only — no user policies on purpose) ──────
create table if not exists public.leads (
  email      text primary key,
  name       text,
  answers    jsonb,
  source     text,
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;
-- No policies: only the backend (service role) reads/writes leads.

-- ── deduct_credits (atomic, race-safe) ───────────────────────────
-- Returns TRUE if credits were deducted (or plan is unlimited),
-- FALSE if the balance is insufficient. FOR UPDATE prevents two
-- concurrent requests from both passing the balance check.
create or replace function public.deduct_credits(p_user_id uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan    text;
  v_credits int;
begin
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  select plan, credits into v_plan, v_credits
    from public.profiles where id = p_user_id for update;

  if not found then
    return false;
  end if;

  -- Unlimited plans (incl. legacy names) never lose credits
  if v_plan in ('pro', 'premium', 'business', 'agency', 'enterprise') then
    return true;
  end if;

  if v_credits < p_amount then
    return false;
  end if;

  update public.profiles set credits = credits - p_amount, updated_at = now()
   where id = p_user_id;

  return true;
end;
$$;

-- SECURITY DEFINER functions must never be callable with a user-selected ID.
revoke all on function public.deduct_credits(uuid, int) from public, anon, authenticated;
grant execute on function public.deduct_credits(uuid, int) to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ── dispute_cases / templates / automation ─────────────────────
create table if not exists public.dispute_cases (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  dispute_id       uuid references public.disputes(id) on delete set null,
  client_name      text,
  creditor         text,
  bureau           text,
  category         text,
  strategy         text,
  status           text not null default 'open'
                   check (status in ('open','mailed','investigating','waiting_response','escalated','resolved','closed')),
  outcome          text
                   check (outcome in ('deleted','corrected','verified','no_response','escalated','unknown')),
  outcome_at       timestamptz,
  opened_at        timestamptz not null default now(),
  mailed_at        timestamptz,
  delivered_at     timestamptz,
  response_due_at  timestamptz,
  closed_at        timestamptz,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.dispute_case_events (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.dispute_cases(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  event_type   text not null,
  case_status  text,
  note         text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists public.dispute_followup_rules (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  trigger_stage text not null,
  delay_days    int not null default 7,
  template_key  text not null,
  is_enabled    boolean not null default true,
  scope         text not null default 'global'
                check (scope in ('global','user')),
  created_by    uuid references auth.users(id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.dispute_templates (
  id                uuid primary key default gen_random_uuid(),
  template_key      text not null unique,
  label             text not null,
  category          text not null,
  recipient         text not null,
  strategy          text not null,
  legal_basis       text[] not null default '{}'::text[],
  body_template     text not null,
  suggested_documents text[] not null default '{}'::text[],
  is_system         boolean not null default false,
  is_active         boolean not null default true,
  created_by        uuid references auth.users(id) on delete set null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.dispute_cases enable row level security;
alter table public.dispute_case_events enable row level security;
alter table public.dispute_followup_rules enable row level security;
alter table public.dispute_templates enable row level security;

create unique index if not exists dispute_cases_user_dispute_uidx on public.dispute_cases (user_id, dispute_id);
create index if not exists dispute_cases_user_status_idx on public.dispute_cases (user_id, status, updated_at desc);
create index if not exists dispute_cases_user_due_idx on public.dispute_cases (user_id, response_due_at);
create index if not exists dispute_case_events_case_idx on public.dispute_case_events (case_id, created_at desc);
create index if not exists dispute_case_events_user_idx on public.dispute_case_events (user_id, created_at desc);
create index if not exists dispute_followup_rules_scope_idx on public.dispute_followup_rules (scope, is_enabled);
create index if not exists dispute_templates_active_idx on public.dispute_templates (is_active, category);

drop policy if exists "dispute_cases_select_own" on public.dispute_cases;
create policy "dispute_cases_select_own" on public.dispute_cases for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "dispute_cases_insert_own" on public.dispute_cases;
create policy "dispute_cases_insert_own" on public.dispute_cases for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "dispute_cases_update_own" on public.dispute_cases;
create policy "dispute_cases_update_own" on public.dispute_cases for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "dispute_cases_delete_own" on public.dispute_cases;
create policy "dispute_cases_delete_own" on public.dispute_cases for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "case_events_select_own" on public.dispute_case_events;
create policy "case_events_select_own" on public.dispute_case_events for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "case_events_insert_own" on public.dispute_case_events;
create policy "case_events_insert_own" on public.dispute_case_events for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "case_events_update_own" on public.dispute_case_events;
create policy "case_events_update_own" on public.dispute_case_events for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "followup_rules_select_active" on public.dispute_followup_rules;
create policy "followup_rules_select_active" on public.dispute_followup_rules for select to authenticated using (is_enabled);
drop policy if exists "templates_select_active" on public.dispute_templates;
create policy "templates_select_active" on public.dispute_templates for select to authenticated using (is_active);

create or replace view public.dispute_case_metrics as
select
  user_id,
  count(*) filter (where status not in ('resolved','closed')) as active_cases,
  count(*) filter (where status in ('resolved','closed')) as closed_cases,
  count(*) filter (where outcome in ('deleted','corrected')) as successful_cases,
  count(*) filter (where outcome = 'no_response') as no_response_cases,
  round(
    case
      when count(*) filter (where status in ('resolved','closed')) = 0 then 0
      else (count(*) filter (where outcome in ('deleted','corrected'))::numeric / greatest(count(*) filter (where status in ('resolved','closed')),1)::numeric) * 100
    end,
    1
  ) as success_rate,
  max(updated_at) as last_updated_at
from public.dispute_cases
group by user_id;

insert into public.dispute_followup_rules (name, trigger_stage, delay_days, template_key, is_enabled, scope, metadata)
select * from (values
  ('First follow-up', 'mailed', 21, 'mov', true, 'global', '{}'::jsonb),
  ('Final reminder', 'delivered', 30, 'no_response', true, 'global', '{}'::jsonb),
  ('Escalation prompt', 'investigating', 38, 'cfpb', true, 'global', '{}'::jsonb)
) as seed(name, trigger_stage, delay_days, template_key, is_enabled, scope, metadata)
where not exists (
  select 1 from public.dispute_followup_rules r
  where r.template_key = seed.template_key and r.scope = seed.scope and r.trigger_stage = seed.trigger_stage and r.delay_days = seed.delay_days
);
