-- Let users cancel stuck in-flight search runs from the app
alter table public.search_runs
  drop constraint if exists search_runs_status_check;

alter table public.search_runs
  add constraint search_runs_status_check
  check (status in ('running', 'done', 'failed', 'cancelled'));

create policy "Users cancel own search_runs"
  on public.search_runs for update
  using (auth.uid() = user_id and status = 'running')
  with check (status = 'cancelled');
