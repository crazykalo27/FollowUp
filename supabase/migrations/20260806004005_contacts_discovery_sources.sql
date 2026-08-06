-- Add discovery source metadata for multi-provider people search
alter table public.contacts
  add column if not exists discovery_source text,
  add column if not exists linkedin_url text,
  add column if not exists sources text[] default '{}',
  add column if not exists source_details jsonb default '{}'::jsonb;

create index if not exists contacts_discovery_source_idx
  on public.contacts (user_id, discovery_source);

comment on column public.contacts.discovery_source is
  'Primary source that first found this person: hunter | apollo | proxycurl';
comment on column public.contacts.sources is
  'All providers that returned this person (deduped)';
comment on column public.contacts.source_details is
  'Per-source metadata (match reasons, raw ids, etc.)';
