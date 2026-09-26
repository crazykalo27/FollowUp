-- Structured master-resume vault. Kept separate from uploaded search files in `resumes`.

create table if not exists public.resume_vault (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.resume_vault enable row level security;

create policy "Users read own resume vault"
  on public.resume_vault for select
  using (auth.uid() = user_id);

create policy "Users insert own resume vault"
  on public.resume_vault for insert
  with check (auth.uid() = user_id);

create policy "Users update own resume vault"
  on public.resume_vault for update
  using (auth.uid() = user_id);

create policy "Users delete own resume vault"
  on public.resume_vault for delete
  using (auth.uid() = user_id);
