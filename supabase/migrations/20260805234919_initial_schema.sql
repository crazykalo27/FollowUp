-- FollowUp initial schema: profiles, resumes, search, contacts, drafts, gmail tokens

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Search filters (deterministic) — created early so signup trigger can seed defaults
create table public.search_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  filters jsonb not null default '{
    "include_titles": ["Engineering Manager", "Hiring Manager", "Director", "Head of", "VP", "Team Lead"],
    "exclude_titles": ["Recruiter", "Talent Acquisition", "People Ops", "HR", "Sourcer", "Staffing"],
    "locations": [],
    "company_size_min": null,
    "company_size_max": null,
    "seniority": ["senior", "executive"],
    "max_companies_per_run": 10,
    "max_contacts_per_company": 3,
    "require_verified_email": true,
    "accept_accept_all": true
  }'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.search_filters enable row level security;

create policy "Users manage own search_filters"
  on public.search_filters for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-create profile + default filters on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  );
  insert into public.search_filters (user_id)
  values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Resumes
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  extracted_text text,
  uploaded_at timestamptz not null default now()
);

create index resumes_user_id_idx on public.resumes (user_id);

alter table public.resumes enable row level security;

create policy "Users manage own resumes"
  on public.resumes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Search profiles (AI-built)
create table public.search_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  profile jsonb not null default '{
    "roles": [],
    "skills": [],
    "industries": [],
    "locations": [],
    "seniority": "",
    "must_haves": [],
    "tone": "professional and concise"
  }'::jsonb,
  chat_summary text,
  updated_at timestamptz not null default now()
);

alter table public.search_profiles enable row level security;

create policy "Users manage own search_profiles"
  on public.search_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Profile chat messages
create table public.profile_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create index profile_chat_messages_user_idx
  on public.profile_chat_messages (user_id, created_at);

alter table public.profile_chat_messages enable row level security;

create policy "Users manage own chat messages"
  on public.profile_chat_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Companies found during search
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  domain text,
  hiring_signal_source text,
  hiring_signal_url text,
  hiring_signal_title text,
  created_at timestamptz not null default now()
);

create index companies_user_id_idx on public.companies (user_id);
create unique index companies_user_domain_idx
  on public.companies (user_id, lower(domain))
  where domain is not null;

alter table public.companies enable row level security;

create policy "Users manage own companies"
  on public.companies for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Contacts (hiring managers)
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  first_name text,
  last_name text,
  full_name text,
  title text,
  email text,
  verification_status text,
  filter_match_reason text,
  created_at timestamptz not null default now()
);

create index contacts_user_id_idx on public.contacts (user_id);
create index contacts_company_id_idx on public.contacts (company_id);

alter table public.contacts enable row level security;

create policy "Users manage own contacts"
  on public.contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Outreach drafts
create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  subject text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outreach_drafts_user_id_idx on public.outreach_drafts (user_id);

alter table public.outreach_drafts enable row level security;

create policy "Users manage own outreach_drafts"
  on public.outreach_drafts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Gmail OAuth tokens — clients cannot read token values
create table public.gmail_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  email text,
  updated_at timestamptz not null default now()
);

alter table public.gmail_tokens enable row level security;

-- Users may only check connection status (email column), not tokens.
-- Token columns are revoked from authenticated; edge functions use service role.
revoke all on public.gmail_tokens from anon, authenticated;

grant select (user_id, email, updated_at) on public.gmail_tokens to authenticated;
grant delete on public.gmail_tokens to authenticated;

create policy "Users can see own gmail connection status"
  on public.gmail_tokens for select
  using (auth.uid() = user_id);

create policy "Users can delete own gmail connection"
  on public.gmail_tokens for delete
  using (auth.uid() = user_id);

-- View for safe client reads of gmail connection
create or replace view public.gmail_connection
with (security_invoker = true)
as
select user_id, email, updated_at
from public.gmail_tokens;

grant select on public.gmail_connection to authenticated;

-- Storage bucket for resumes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do nothing;

create policy "Users upload own resumes"
  on storage.objects for insert
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users read own resumes"
  on storage.objects for select
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users update own resumes"
  on storage.objects for update
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own resumes"
  on storage.objects for delete
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger search_profiles_updated_at
  before update on public.search_profiles
  for each row execute function public.set_updated_at();

create trigger search_filters_updated_at
  before update on public.search_filters
  for each row execute function public.set_updated_at();

create trigger outreach_drafts_updated_at
  before update on public.outreach_drafts
  for each row execute function public.set_updated_at();

create trigger gmail_tokens_updated_at
  before update on public.gmail_tokens
  for each row execute function public.set_updated_at();
