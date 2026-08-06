-- Contact review status + preference learning docs

alter table public.contacts
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending', 'kept', 'discarded'));

create index if not exists contacts_user_review_idx
  on public.contacts (user_id, review_status, created_at desc);

create table public.contact_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  decision text not null check (decision in ('keep', 'discard')),
  reasons text[] not null default '{}',
  note text,
  created_at timestamptz not null default now()
);

create index contact_decisions_user_idx
  on public.contact_decisions (user_id, created_at desc);

alter table public.contact_decisions enable row level security;

create policy "Users manage own contact_decisions"
  on public.contact_decisions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Living documents of what the user likes / dislikes in outreach targets
create table public.preference_documents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  likes_doc text not null default '',
  dislikes_doc text not null default '',
  likes jsonb not null default '{"titles":[],"companies":[],"signals":[],"notes":[]}'::jsonb,
  dislikes jsonb not null default '{"titles":[],"companies":[],"reasons":{},"notes":[]}'::jsonb,
  discard_reason_counts jsonb not null default '{}'::jsonb,
  ai_summary text,
  updated_at timestamptz not null default now()
);

alter table public.preference_documents enable row level security;

create policy "Users manage own preference_documents"
  on public.preference_documents for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create trigger preference_documents_updated_at
  before update on public.preference_documents
  for each row execute function public.set_updated_at();

-- Seed preference doc when a user is created (extend handle_new_user)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
  );
  insert into public.search_filters (user_id)
  values (new.id);
  insert into public.preference_documents (user_id)
  values (new.id);
  return new;
end;
$$;

-- Backfill preference docs for existing users
insert into public.preference_documents (user_id)
select id from auth.users
on conflict (user_id) do nothing;
