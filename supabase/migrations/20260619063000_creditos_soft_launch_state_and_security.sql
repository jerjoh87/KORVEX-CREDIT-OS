-- CREDITOS soft-launch persistence and security upgrade.
-- Preserves the legacy agency columns while adding the fields used by the app.

alter table public.profiles add column if not exists payment_failed boolean not null default false;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.letters add column if not exists type text;
alter table public.letters add column if not exists content text;

alter table public.clients add column if not exists credit_score int;

alter table public.disputes add column if not exists item_type text;
alter table public.disputes add column if not exists round int not null default 1;
alter table public.disputes add column if not exists mailed_at timestamptz;
alter table public.disputes add column if not exists resolved_at timestamptz;

create table if not exists public.onboarding_profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  answers         jsonb,
  health_score    int,
  readiness_score int,
  updated_at      timestamptz not null default now()
);

create table if not exists public.user_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.leads (
  email      text primary key,
  name       text,
  answers    jsonb,
  source     text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.letters enable row level security;
alter table public.clients enable row level security;
alter table public.disputes enable row level security;
alter table public.onboarding_profiles enable row level security;
alter table public.user_state enable row level security;
alter table public.leads enable row level security;

-- Remove earlier broad policies, including the profile ALL policy that let
-- users edit server-owned plan and credit fields.
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users own profile" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Users own letters" on public.letters;
drop policy if exists "letters_select_own" on public.letters;
drop policy if exists "letters_insert_own" on public.letters;
drop policy if exists "letters_delete_own" on public.letters;
create policy "letters_select_own" on public.letters
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "letters_insert_own" on public.letters
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "letters_delete_own" on public.letters
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users own clients" on public.clients;
drop policy if exists "clients_select_own" on public.clients;
drop policy if exists "clients_insert_own" on public.clients;
drop policy if exists "clients_update_own" on public.clients;
drop policy if exists "clients_delete_own" on public.clients;
create policy "clients_select_own" on public.clients
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "clients_insert_own" on public.clients
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "clients_update_own" on public.clients
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "clients_delete_own" on public.clients
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users own disputes" on public.disputes;
drop policy if exists "disputes_select_own" on public.disputes;
drop policy if exists "disputes_insert_own" on public.disputes;
drop policy if exists "disputes_update_own" on public.disputes;
drop policy if exists "disputes_delete_own" on public.disputes;
create policy "disputes_select_own" on public.disputes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "disputes_insert_own" on public.disputes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "disputes_update_own" on public.disputes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "disputes_delete_own" on public.disputes
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "onboarding_select_own" on public.onboarding_profiles;
drop policy if exists "onboarding_insert_own" on public.onboarding_profiles;
drop policy if exists "onboarding_update_own" on public.onboarding_profiles;
create policy "onboarding_select_own" on public.onboarding_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "onboarding_insert_own" on public.onboarding_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "onboarding_update_own" on public.onboarding_profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "user_state_select_own" on public.user_state;
drop policy if exists "user_state_insert_own" on public.user_state;
drop policy if exists "user_state_update_own" on public.user_state;
drop policy if exists "user_state_delete_own" on public.user_state;
create policy "user_state_select_own" on public.user_state
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_state_insert_own" on public.user_state
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_state_update_own" on public.user_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_state_delete_own" on public.user_state
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id);
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists letters_user_created_idx on public.letters (user_id, created_at desc);
create index if not exists clients_user_created_idx on public.clients (user_id, created_at desc);
create index if not exists disputes_user_created_idx on public.disputes (user_id, created_at desc);
create index if not exists disputes_user_status_idx on public.disputes (user_id, status);

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
  stripe_session_id   text,
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
create policy "mail_jobs_select_own" on public.mail_jobs
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "mail_jobs_insert_own" on public.mail_jobs;
create policy "mail_jobs_insert_own" on public.mail_jobs
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "mail_jobs_update_own" on public.mail_jobs;
create policy "mail_jobs_update_own" on public.mail_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists mail_jobs_user_created_idx on public.mail_jobs (user_id, created_at desc);
create index if not exists mail_jobs_user_status_idx on public.mail_jobs (user_id, status);
create index if not exists mail_jobs_batch_idx on public.mail_jobs (mail_batch_id, mail_batch_index);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, plan, credits, is_admin)
  values (new.id, new.email, 'free', 3, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.deduct_credits(p_user_id uuid, p_amount int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_credits int;
begin
  if p_amount is null or p_amount <= 0 then
    return false;
  end if;

  select plan, credits into v_plan, v_credits
    from public.profiles
   where id = p_user_id
   for update;

  if not found then
    return false;
  end if;

  if v_plan in ('pro', 'premium', 'business', 'agency', 'enterprise') then
    return true;
  end if;

  if v_credits < p_amount then
    return false;
  end if;

  update public.profiles
     set credits = credits - p_amount,
         updated_at = now()
   where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.deduct_credits(uuid, int) from public, anon, authenticated;
grant execute on function public.deduct_credits(uuid, int) to service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated;
