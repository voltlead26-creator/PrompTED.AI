create table if not exists public.saved_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role_title text not null,
  company_name text,
  location text,
  match_percentage integer,
  job_url text,
  source_label text,
  contact_email text,
  contact_source_status text check (contact_source_status in ('official','public_listing','needs_confirmation')),
  status text not null default 'saved',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role_title, company_name)
);

create table if not exists public.role_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  saved_role_id uuid not null references public.saved_roles(id) on delete cascade,
  document_type text not null check (document_type in ('role_summary','tailored_resume','cover_letter','action_plan','contact_notes','follow_up_notes')),
  document_id uuid,
  version_id uuid,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  saved_role_id uuid not null references public.saved_roles(id) on delete cascade,
  label text not null,
  description text,
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.saved_roles enable row level security;
alter table public.role_documents enable row level security;
alter table public.role_action_items enable row level security;

create policy "saved_roles_own" on public.saved_roles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "role_documents_own" on public.role_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "role_action_items_own" on public.role_action_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists saved_roles_user_idx on public.saved_roles (user_id, updated_at desc);
create index if not exists role_documents_role_idx on public.role_documents (saved_role_id);
create index if not exists role_action_items_role_idx on public.role_action_items (saved_role_id, sort_order);
