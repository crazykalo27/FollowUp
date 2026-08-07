-- Resume long searches across multiple Edge invocations (one company per chunk).
alter table public.search_runs
  add column if not exists pipeline_state jsonb;

comment on column public.search_runs.pipeline_state is
  'Queued search progress: selected companies, index, partial stats between chunks';
