-- Sender identity for outreach (full name required; links optional)

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists linkedin_url text,
  add column if not exists github_url text,
  add column if not exists portfolio_url text,
  add column if not exists website_url text,
  add column if not exists profile_setup_complete boolean not null default false;

update public.profiles
set full_name = display_name,
    profile_setup_complete = true
where full_name is null
  and display_name is not null
  and length(trim(display_name)) >= 2;
