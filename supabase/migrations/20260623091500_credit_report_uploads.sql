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
  status text not null default 'new'
    check (status in ('new','reviewing','disputed','waiting_response','resolved','escalated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.credit_report_uploads add column if not exists original_filename text;
alter table public.credit_report_uploads add column if not exists file_type text;
alter table public.credit_report_uploads add column if not exists storage_path text;
alter table public.credit_report_uploads add column if not exists extraction_method text not null default 'text';
alter table public.credit_report_uploads add column if not exists characters_received int not null default 0;
alter table public.credit_report_uploads add column if not exists extracted_text text;
alter table public.credit_report_uploads add column if not exists analysis_json jsonb not null default '{}'::jsonb;
alter table public.credit_report_uploads add column if not exists analysis_summary jsonb not null default '{}'::jsonb;
alter table public.credit_report_uploads add column if not exists bureau_scores_json jsonb not null default '{}'::jsonb;
alter table public.credit_report_uploads add column if not exists status text not null default 'new';
alter table public.credit_report_uploads add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.credit_report_uploads add column if not exists created_at timestamptz not null default now();
alter table public.credit_report_uploads add column if not exists updated_at timestamptz not null default now();

alter table public.credit_report_uploads enable row level security;

drop policy if exists "credit_report_uploads_select_own" on public.credit_report_uploads;
create policy "credit_report_uploads_select_own" on public.credit_report_uploads
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_insert_own" on public.credit_report_uploads;
create policy "credit_report_uploads_insert_own" on public.credit_report_uploads
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_update_own" on public.credit_report_uploads;
create policy "credit_report_uploads_update_own" on public.credit_report_uploads
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "credit_report_uploads_delete_own" on public.credit_report_uploads;
create policy "credit_report_uploads_delete_own" on public.credit_report_uploads
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists credit_report_uploads_user_created_idx on public.credit_report_uploads (user_id, created_at desc);
create index if not exists credit_report_uploads_status_idx on public.credit_report_uploads (user_id, status, updated_at desc);
