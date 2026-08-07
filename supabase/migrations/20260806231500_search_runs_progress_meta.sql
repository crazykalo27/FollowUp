alter table public.search_runs
  add column if not exists progress_meta jsonb not null default '{"companies":[],"log":[]}'::jsonb;

comment on column public.search_runs.progress_meta is
  'UI: per-company steps and activity log for live search progress';
