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
