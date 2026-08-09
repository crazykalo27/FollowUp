-- Neutral contact-filter defaults (no engineering-specific titles)

alter table public.search_filters
  alter column filters set default '{
    "include_titles": ["Hiring Manager", "Team Lead", "Director", "Manager"],
    "exclude_titles": ["Recruiter", "Talent Acquisition", "People Ops", "HR", "Sourcer", "Staffing"],
    "locations": [],
    "company_size_min": null,
    "company_size_max": null,
    "seniority": [],
    "max_companies_per_run": 10,
    "max_contacts_per_company": 3,
    "require_verified_email": false,
    "accept_accept_all": true,
    "enable_hunter": false
  }'::jsonb;
