-- Multiple named search profiles per user (each can have its own resume + filters).

alter table public.search_profiles
  add column if not exists name text not null default 'Search profile',
  add column if not exists resume_id uuid references public.resumes (id) on delete set null,
  add column if not exists is_active boolean not null default false;

alter table public.search_filters
  add column if not exists search_profile_id uuid references public.search_profiles (id) on delete cascade;

alter table public.preference_documents
  add column if not exists search_profile_id uuid references public.search_profiles (id) on delete cascade;

alter table public.profile_chat_messages
  add column if not exists search_profile_id uuid references public.search_profiles (id) on delete cascade;

alter table public.contacts
  add column if not exists search_profile_id uuid references public.search_profiles (id) on delete set null,
  add column if not exists search_profile_name text;

alter table public.search_runs
  add column if not exists search_profile_id uuid references public.search_profiles (id) on delete set null,
  add column if not exists search_profile_name text;

-- Existing 1:1 profile becomes the active one; attach latest resume.
update public.search_profiles sp
set
  name = case
    when coalesce(sp.name, '') in ('', 'Search profile') then 'Search profile'
    else sp.name
  end,
  is_active = true,
  resume_id = coalesce(
    sp.resume_id,
    (
      select r.id
      from public.resumes r
      where r.user_id = sp.user_id
      order by r.uploaded_at desc
      limit 1
    )
  )
where true;

-- Users who have filters/resumes but no search_profiles row
insert into public.search_profiles (user_id, name, is_active, resume_id)
select
  u.id,
  'Search profile',
  true,
  (
    select r.id
    from public.resumes r
    where r.user_id = u.id
    order by r.uploaded_at desc
    limit 1
  )
from auth.users u
where not exists (
  select 1 from public.search_profiles sp where sp.user_id = u.id
);

-- Allow multiple profiles per user before inserting extras
alter table public.search_profiles
  drop constraint if exists search_profiles_user_id_key;

-- Extra resumes become extra (inactive) search profiles
insert into public.search_profiles (user_id, name, is_active, resume_id)
select
  r.user_id,
  coalesce(nullif(trim(r.file_name), ''), 'Search profile'),
  false,
  r.id
from public.resumes r
where not exists (
  select 1 from public.search_profiles sp where sp.resume_id = r.id
);

-- Point the original filters/prefs/chat at the active profile
update public.search_filters sf
set search_profile_id = (
  select sp.id
  from public.search_profiles sp
  where sp.user_id = sf.user_id
  order by sp.is_active desc, sp.updated_at desc
  limit 1
)
where sf.search_profile_id is null;

update public.preference_documents pd
set search_profile_id = (
  select sp.id
  from public.search_profiles sp
  where sp.user_id = pd.user_id
  order by sp.is_active desc, sp.updated_at desc
  limit 1
)
where pd.search_profile_id is null;

update public.profile_chat_messages m
set search_profile_id = (
  select sp.id
  from public.search_profiles sp
  where sp.user_id = m.user_id
  order by sp.is_active desc, sp.updated_at desc
  limit 1
)
where m.search_profile_id is null;

-- Allow many preference docs per user (one per search profile)
alter table public.preference_documents
  drop constraint if exists preference_documents_pkey;

alter table public.preference_documents
  add column if not exists id uuid;

update public.preference_documents
set id = gen_random_uuid()
where id is null;

alter table public.preference_documents
  alter column id set default gen_random_uuid(),
  alter column id set not null;

alter table public.preference_documents
  add primary key (id);

-- Allow multiple filter rows per user (one per search profile)
alter table public.search_filters
  drop constraint if exists search_filters_user_id_key;

-- Filters + prefs for extra profiles
insert into public.search_filters (user_id, search_profile_id, filters)
select
  sp.user_id,
  sp.id,
  coalesce(
    (
      select sf.filters
      from public.search_filters sf
      where sf.user_id = sp.user_id
        and sf.search_profile_id is not null
        and sf.search_profile_id <> sp.id
      order by sf.updated_at desc
      limit 1
    ),
    '{
      "include_titles": ["Hiring Manager", "Team Lead", "Director", "Manager"],
      "exclude_titles": ["Recruiter", "Talent Acquisition", "People Ops", "HR", "Sourcer", "Staffing"],
      "locations": [],
      "company_size_min": null,
      "company_size_max": null,
      "seniority": [],
      "require_verified_email": false,
      "accept_accept_all": true,
      "enable_hunter": false,
      "enable_apollo": false,
      "enable_tomba": false,
      "enable_smtp_verify": false
    }'::jsonb
  )
from public.search_profiles sp
where not exists (
  select 1 from public.search_filters sf where sf.search_profile_id = sp.id
);

insert into public.preference_documents (user_id, search_profile_id)
select sp.user_id, sp.id
from public.search_profiles sp
where not exists (
  select 1
  from public.preference_documents pd
  where pd.search_profile_id = sp.id
);

-- Tag existing contacts/runs with the then-active profile
update public.contacts c
set
  search_profile_id = sp.id,
  search_profile_name = sp.name
from public.search_profiles sp
where sp.user_id = c.user_id
  and sp.is_active
  and c.search_profile_id is null;

update public.search_runs sr
set
  search_profile_id = sp.id,
  search_profile_name = sp.name
from public.search_profiles sp
where sp.user_id = sr.user_id
  and sp.is_active
  and sr.search_profile_id is null;

-- Uniqueness: one active profile per user, one filters/prefs row per profile
create unique index if not exists search_profiles_one_active_per_user
  on public.search_profiles (user_id)
  where is_active;

create unique index if not exists search_profiles_resume_id_key
  on public.search_profiles (resume_id)
  where resume_id is not null;

create unique index if not exists search_filters_search_profile_id_key
  on public.search_filters (search_profile_id)
  where search_profile_id is not null;

create unique index if not exists preference_documents_search_profile_id_key
  on public.preference_documents (search_profile_id)
  where search_profile_id is not null;

create index if not exists contacts_search_profile_idx
  on public.contacts (search_profile_id);

create index if not exists profile_chat_search_profile_idx
  on public.profile_chat_messages (search_profile_id, created_at);

-- Signup: create a blank active search profile + filters + prefs
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sp_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  );

  insert into public.search_profiles (user_id, name, is_active)
  values (new.id, 'Search profile', true)
  returning id into sp_id;

  insert into public.search_filters (user_id, search_profile_id)
  values (new.id, sp_id);

  insert into public.preference_documents (user_id, search_profile_id)
  values (new.id, sp_id);

  return new;
end;
$$;

notify pgrst, 'reload schema';
