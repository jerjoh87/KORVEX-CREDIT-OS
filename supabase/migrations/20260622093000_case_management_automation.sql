-- CREDITOS case management, CFPB packaging, and follow-up automation

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

alter table public.dispute_cases add column if not exists dispute_id uuid references public.disputes(id) on delete set null;
alter table public.dispute_cases add column if not exists client_name text;
alter table public.dispute_cases add column if not exists creditor text;
alter table public.dispute_cases add column if not exists bureau text;
alter table public.dispute_cases add column if not exists category text;
alter table public.dispute_cases add column if not exists strategy text;
alter table public.dispute_cases add column if not exists outcome text;
alter table public.dispute_cases add column if not exists outcome_at timestamptz;
alter table public.dispute_cases add column if not exists opened_at timestamptz not null default now();
alter table public.dispute_cases add column if not exists mailed_at timestamptz;
alter table public.dispute_cases add column if not exists delivered_at timestamptz;
alter table public.dispute_cases add column if not exists response_due_at timestamptz;
alter table public.dispute_cases add column if not exists closed_at timestamptz;
alter table public.dispute_cases add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.dispute_cases add column if not exists updated_at timestamptz not null default now();

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

alter table public.dispute_case_events add column if not exists case_status text;
alter table public.dispute_case_events add column if not exists note text;
alter table public.dispute_case_events add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.dispute_case_events add column if not exists created_at timestamptz not null default now();

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

alter table public.dispute_followup_rules add column if not exists trigger_stage text not null default 'mailed';
alter table public.dispute_followup_rules add column if not exists delay_days int not null default 7;
alter table public.dispute_followup_rules add column if not exists template_key text not null default 'mov';
alter table public.dispute_followup_rules add column if not exists is_enabled boolean not null default true;
alter table public.dispute_followup_rules add column if not exists scope text not null default 'global';
alter table public.dispute_followup_rules add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.dispute_followup_rules add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.dispute_followup_rules add column if not exists updated_at timestamptz not null default now();

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

alter table public.dispute_templates add column if not exists label text not null default '';
alter table public.dispute_templates add column if not exists category text not null default 'general';
alter table public.dispute_templates add column if not exists recipient text not null default 'bureau';
alter table public.dispute_templates add column if not exists strategy text not null default 'FCRA Validation';
alter table public.dispute_templates add column if not exists legal_basis text[] not null default '{}'::text[];
alter table public.dispute_templates add column if not exists body_template text not null default '';
alter table public.dispute_templates add column if not exists suggested_documents text[] not null default '{}'::text[];
alter table public.dispute_templates add column if not exists is_system boolean not null default false;
alter table public.dispute_templates add column if not exists is_active boolean not null default true;
alter table public.dispute_templates add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.dispute_templates add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.dispute_templates add column if not exists updated_at timestamptz not null default now();

alter table public.dispute_cases enable row level security;
alter table public.dispute_case_events enable row level security;
alter table public.dispute_followup_rules enable row level security;
alter table public.dispute_templates enable row level security;

drop policy if exists "dispute_cases_select_own" on public.dispute_cases;
create policy "dispute_cases_select_own" on public.dispute_cases
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "dispute_cases_insert_own" on public.dispute_cases;
create policy "dispute_cases_insert_own" on public.dispute_cases
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "dispute_cases_update_own" on public.dispute_cases;
create policy "dispute_cases_update_own" on public.dispute_cases
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "dispute_cases_delete_own" on public.dispute_cases;
create policy "dispute_cases_delete_own" on public.dispute_cases
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "case_events_select_own" on public.dispute_case_events;
create policy "case_events_select_own" on public.dispute_case_events
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "case_events_insert_own" on public.dispute_case_events;
create policy "case_events_insert_own" on public.dispute_case_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "case_events_update_own" on public.dispute_case_events;
create policy "case_events_update_own" on public.dispute_case_events
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "followup_rules_select_active" on public.dispute_followup_rules;
create policy "followup_rules_select_active" on public.dispute_followup_rules
  for select to authenticated using (is_enabled);

drop policy if exists "templates_select_active" on public.dispute_templates;
create policy "templates_select_active" on public.dispute_templates
  for select to authenticated using (is_active);

create index if not exists dispute_cases_user_status_idx on public.dispute_cases (user_id, status, updated_at desc);
create index if not exists dispute_cases_user_due_idx on public.dispute_cases (user_id, response_due_at);
create unique index if not exists dispute_cases_user_dispute_uidx on public.dispute_cases (user_id, dispute_id);
create index if not exists dispute_case_events_case_idx on public.dispute_case_events (case_id, created_at desc);
create index if not exists dispute_case_events_user_idx on public.dispute_case_events (user_id, created_at desc);
create index if not exists dispute_followup_rules_scope_idx on public.dispute_followup_rules (scope, is_enabled);
create index if not exists dispute_templates_active_idx on public.dispute_templates (is_active, category);

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
  select 1
  from public.dispute_followup_rules r
  where r.template_key = seed.template_key
    and r.scope = seed.scope
    and r.trigger_stage = seed.trigger_stage
    and r.delay_days = seed.delay_days
);
