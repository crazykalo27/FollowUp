-- Orientation calibration: preference gradient state + refine explanation steps
alter table public.preference_documents
  add column if not exists gradient_state jsonb not null default '{}'::jsonb;

alter table public.preference_documents
  add column if not exists last_refine_steps text[] not null default '{}'::text[];

alter table public.preference_documents
  add column if not exists last_refined_at timestamptz;

comment on column public.preference_documents.gradient_state is
  'Weighted industry/role/title scores for calibration gradient descent';
comment on column public.preference_documents.last_refine_steps is
  'User-facing explanation of the latest preference gradient update';
