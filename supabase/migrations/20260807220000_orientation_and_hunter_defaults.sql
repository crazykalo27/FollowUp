-- Orientation progress + default Hunter / verified-email off

alter table public.profiles
  add column if not exists orientation_step text not null default 'welcome',
  add column if not exists orientation_complete boolean not null default false;

-- Users who already created a draft have finished orientation
update public.profiles p
set
  orientation_complete = true,
  orientation_step = 'complete',
  updated_at = now()
where exists (
  select 1 from public.outreach_drafts d where d.user_id = p.id
)
and p.orientation_complete = false;

-- New signups get Hunter and require_verified_email off
alter table public.search_filters
  alter column filters set default '{
    "include_titles": ["Engineering Manager", "Hiring Manager", "Director", "Head of", "VP", "Team Lead"],
    "exclude_titles": ["Recruiter", "Talent Acquisition", "People Ops", "HR", "Sourcer", "Staffing"],
    "locations": [],
    "company_size_min": null,
    "company_size_max": null,
    "seniority": ["senior", "executive"],
    "max_companies_per_run": 10,
    "max_contacts_per_company": 3,
    "require_verified_email": false,
    "accept_accept_all": true,
    "enable_hunter": false
  }'::jsonb;

-- Backfill missing keys to false for existing rows that never set them
update public.search_filters
set filters = filters
  || jsonb_build_object(
    'enable_hunter', coalesce((filters->>'enable_hunter')::boolean, false),
    'require_verified_email', coalesce((filters->>'require_verified_email')::boolean, false)
  ),
  updated_at = now()
where
  filters->>'enable_hunter' is null
  or filters->>'require_verified_email' is null;
