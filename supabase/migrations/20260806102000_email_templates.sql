-- Saved outreach email templates (placeholders filled per contact at draft time)
alter table public.profiles
  add column if not exists email_subject_template text,
  add column if not exists email_body_template text;
