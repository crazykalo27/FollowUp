-- Multiple named email templates (active mirrored to email_*_template columns)
alter table public.profiles
  add column if not exists email_templates jsonb;

comment on column public.profiles.email_templates is
  'Named outreach templates: { active_id, items: [{ id, name, subject, body }] }';

-- Optional structured application context on contacts (also in source_details)
alter table public.contacts
  add column if not exists application_context jsonb;

comment on column public.contacts.application_context is
  'Job application details when found via Application search mode';
