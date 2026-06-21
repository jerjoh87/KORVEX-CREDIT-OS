create table if not exists public.launch_verification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  provider text not null,
  status text not null default 'pass' check (status in ('pass', 'fail', 'blocked')),
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.launch_verification_events add column if not exists provider text not null default 'system';
alter table public.launch_verification_events add column if not exists status text not null default 'pass';
alter table public.launch_verification_events add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.launch_verification_events add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.launch_verification_events add column if not exists created_at timestamptz not null default now();

alter table public.launch_verification_events enable row level security;

create index if not exists launch_verification_events_type_idx on public.launch_verification_events (event_type, created_at desc);
create index if not exists launch_verification_events_user_idx on public.launch_verification_events (user_id, created_at desc);
