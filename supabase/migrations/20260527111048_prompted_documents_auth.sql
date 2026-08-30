create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'team', 'enterprise')),
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  content text not null default '',
  doc_type text,
  status text not null default 'draft' check (status in ('draft', 'canonical', 'archived')),
  workspace_sections jsonb not null default '[]'::jsonb,
  format text not null default 'Word',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  event_type text not null,
  title text not null,
  badge text,
  created_at timestamptz not null default now()
);

create table if not exists public.export_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  format text not null,
  filename text not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists docs_updated_at on public.documents;
create trigger docs_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.revision_history enable row level security;
alter table public.export_history enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "documents_select_own" on public.documents;
create policy "documents_select_own"
  on public.documents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own"
  on public.documents
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "documents_update_own" on public.documents;
create policy "documents_update_own"
  on public.documents
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "documents_delete_own" on public.documents;
create policy "documents_delete_own"
  on public.documents
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "revision_history_select_own" on public.revision_history;
create policy "revision_history_select_own"
  on public.revision_history
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "revision_history_insert_own" on public.revision_history;
create policy "revision_history_insert_own"
  on public.revision_history
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "export_history_select_own" on public.export_history;
create policy "export_history_select_own"
  on public.export_history
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "export_history_insert_own" on public.export_history;
create policy "export_history_insert_own"
  on public.export_history
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create index if not exists idx_documents_user_updated on public.documents(user_id, updated_at desc);
create index if not exists idx_revisions_user_created on public.revision_history(user_id, created_at desc);
create index if not exists idx_revisions_document on public.revision_history(document_id);
create index if not exists idx_exports_user_created on public.export_history(user_id, created_at desc);
