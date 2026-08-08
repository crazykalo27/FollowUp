-- Person location (from LinkedIn / enrichment when available)
alter table public.contacts
  add column if not exists location text;

comment on column public.contacts.location is
  'Geographic location for the contact when known (e.g. from LinkedIn search or Proxycurl).';
