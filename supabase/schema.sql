-- ─────────────────────────────────────────────────────────────────
--  CREDITOS — Full database schema, RLS policies, and indexes
--  Run once in the Supabase SQL editor (idempotent).
--
--  Tables:
--    profiles            — plan, credits, Stripe linkage (1 row per user)
--    letters             — generated letter history
--    clients             — agency CRM clients
--    disputes            — tracked disputes (package-style timeline)
--    onboarding_profiles — wizard answers + computed scores
--    user_state          — cross-device progress, vault, badges, and preferences
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
  stripe_customer_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Upgrade compatibility for earlier CREDITOS schemas.
alter table public.profiles add column if not exists payment_failed boolean not null default false;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

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

-- Auto-create a profile (with 3 free trial credits) on signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, plan, credits)
  values (new.id, new.email, 'free', 3)
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

-- ── mail_jobs (certified mailing workflow) ──────────────────────
create table if not exists public.mail_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  dispute_id          uuid references public.disputes(id) on delete set null,
  letter_id           uuid references public.letters(id) on delete set null,
  status              text not null default 'draft'
                      check (status in ('draft','payment_pending','queued','submitted','mailed','failed','blocked')),
  recipient_address   jsonb not null default '{}'::jsonb,
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
