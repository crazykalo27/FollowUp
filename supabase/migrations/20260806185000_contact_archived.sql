-- Archived contacts + archive audit on decisions

alter table public.contacts
  drop constraint if exists contacts_review_status_check;

alter table public.contacts
  add constraint contacts_review_status_check
  check (review_status in ('pending', 'kept', 'discarded', 'archived'));

alter table public.contact_decisions
  drop constraint if exists contact_decisions_decision_check;

alter table public.contact_decisions
  add constraint contact_decisions_decision_check
  check (decision in ('keep', 'discard', 'archive'));
