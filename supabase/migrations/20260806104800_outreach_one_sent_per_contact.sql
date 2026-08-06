-- One successful outreach send per contact (per user)
create unique index if not exists outreach_drafts_one_sent_per_contact
  on public.outreach_drafts (user_id, contact_id)
  where status = 'sent';
