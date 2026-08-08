-- Bounce detection + Gmail thread tracking for sent outreach

alter table public.outreach_drafts
  drop constraint if exists outreach_drafts_status_check;

alter table public.outreach_drafts
  add constraint outreach_drafts_status_check
  check (status in ('draft', 'approved', 'sent', 'failed', 'bounced'));

alter table public.outreach_drafts
  add column if not exists gmail_message_id text,
  add column if not exists gmail_thread_id text,
  add column if not exists bounce_detected_at timestamptz,
  add column if not exists bounce_summary text;

create index if not exists outreach_drafts_gmail_thread_idx
  on public.outreach_drafts (user_id, gmail_thread_id)
  where gmail_thread_id is not null and status = 'sent';
