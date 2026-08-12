-- Keep all-time "kept" stats when contacts are deleted:
-- preserve contact_decisions rows (contact_id becomes null) instead of cascade-deleting them.

alter table public.contact_decisions
  alter column contact_id drop not null;

alter table public.contact_decisions
  drop constraint if exists contact_decisions_contact_id_fkey;

alter table public.contact_decisions
  add constraint contact_decisions_contact_id_fkey
  foreign key (contact_id)
  references public.contacts (id)
  on delete set null;
