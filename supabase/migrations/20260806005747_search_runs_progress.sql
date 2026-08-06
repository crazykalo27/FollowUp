-- Live progress for long people-search runs
create table public.search_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'done', 'failed')),
  stage text not null default 'starting',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  message text,
  detail text,
  current_company text,
  companies_total integer default 0,
  companies_done integer default 0,
  summary jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index search_runs_user_created_idx
  on public.search_runs (user_id, created_at desc);

alter table public.search_runs enable row level security;

create policy "Users read own search_runs"
  on public.search_runs for select
  using (auth.uid() = user_id);

create policy "Users insert own search_runs"
  on public.search_runs for insert
  with check (auth.uid() = user_id);

-- Updates come from Edge Functions (service role); users don't update directly.
create trigger search_runs_updated_at
  before update on public.search_runs
  for each row execute function public.set_updated_at();
