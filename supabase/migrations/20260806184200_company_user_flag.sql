-- User favorite / avoid flags on companies (from contact review)

alter table public.companies
  add column if not exists user_flag text
    check (user_flag is null or user_flag in ('favorite', 'avoid'));

create index if not exists companies_user_flag_idx
  on public.companies (user_id, user_flag)
  where user_flag is not null;
