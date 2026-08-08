-- Sent outreach starts as pending (delivery check) before confirmed sent

alter table public.outreach_drafts
  drop constraint if exists outreach_drafts_status_check;

alter table public.outreach_drafts
  add constraint outreach_drafts_status_check
  check (status in ('draft', 'approved', 'pending', 'sent', 'failed', 'bounced'));

drop index if exists public.outreach_drafts_one_sent_per_contact;

create unique index if not exists outreach_drafts_one_active_outreach_per_contact
  on public.outreach_drafts (user_id, contact_id)
  where status in ('sent', 'pending');

drop index if exists public.outreach_drafts_gmail_thread_idx;

create index if not exists outreach_drafts_gmail_thread_idx
  on public.outreach_drafts (user_id, gmail_thread_id)
  where gmail_thread_id is not null and status = 'pending';
