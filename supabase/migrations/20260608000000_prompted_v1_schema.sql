-- =====================================================
-- PrompTED V1 Full Schema Migration
-- Phase 6 / Layer 1
-- Extends the base migration (20260527111048)
-- =====================================================

create extension if not exists "uuid-ossp";

-- -----------------------------------------------
-- PROFILES (extend existing)
-- -----------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists acknowledged_advice_boundaries jsonb not null default '[]'::jsonb,
  add column if not exists business_id uuid; -- FK added after businesses table created

-- -----------------------------------------------
-- BUSINESSES
-- -----------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default uuid_generate_v4(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  trading_name text not null,
  legal_name text,
  abn text,
  address text,
  phone text,
  email text,
  website text,
  industry text,
  voice_descriptor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_businesses_owner on public.businesses(owner_user_id);

alter table public.businesses enable row level security;

create policy "businesses_owner" on public.businesses
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

-- Add FK from profiles.business_id → businesses now that businesses exists
-- (ALTER TABLE ADD CONSTRAINT has no IF NOT EXISTS; use DO block for idempotency)
do $$ begin
  alter table public.profiles
    add constraint profiles_business_id_fk
    foreign key (business_id) references public.businesses(id) on delete set null;
exception
  when duplicate_object then null;
end; $$;

-- -----------------------------------------------
-- MEMBERSHIPS
-- -----------------------------------------------
create table if not exists public.memberships (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique(business_id, user_id)
);

alter table public.memberships enable row level security;

create policy "memberships_own" on public.memberships
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- CLARI PREFERENCES
-- -----------------------------------------------
create table if not exists public.clari_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  reading_level text not null default 'moderate' check (reading_level in ('simple', 'moderate', 'detailed')),
  tone text not null default 'professional' check (tone in ('casual', 'professional')),
  detail_level text not null default 'medium' check (detail_level in ('low', 'medium', 'high')),
  updated_at timestamptz not null default now()
);

alter table public.clari_preferences enable row level security;

create policy "clari_own" on public.clari_preferences
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- TEMPLATES (global authored content — no RLS)
-- -----------------------------------------------
create table if not exists public.templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  domain text not null check (domain in ('employment', 'education', 'business', 'personal', 'finance')),
  category text not null,
  plain_description text not null,
  structure_type text not null check (structure_type in ('compose', 'structured_form', 'checklist')),
  sections jsonb not null default '[]'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  missing_detail_rules jsonb not null default '[]'::jsonb,
  fill_from_profile jsonb not null default '{}'::jsonb,
  recommendation_reason text,
  related_document_ids jsonb not null default '[]'::jsonb,
  advice_boundary text not null default 'none' check (advice_boundary in ('none', 'light', 'high-stakes')),
  brandable boolean not null default false,
  flags jsonb not null default '{}'::jsonb,
  is_published boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
-- No RLS — templates are global read; writes via service role only

-- -----------------------------------------------
-- BUNDLES (global authored content — no RLS)
-- -----------------------------------------------
create table if not exists public.bundles (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  domain text not null,
  template_ids jsonb not null default '[]'::jsonb,
  checklist_template_id uuid references public.templates(id) on delete set null,
  display_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
-- No RLS — global read

-- -----------------------------------------------
-- OUTCOMES
-- -----------------------------------------------
create table if not exists public.outcomes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  bundle_id uuid references public.bundles(id) on delete set null,
  situation_text text not null,
  recommendation_payload jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed')),
  is_saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outcomes_user_updated on public.outcomes(user_id, updated_at desc);
create index if not exists idx_outcomes_business on public.outcomes(business_id);

alter table public.outcomes enable row level security;

create policy "outcomes_own" on public.outcomes
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- DOCUMENTS (extend existing table)
-- -----------------------------------------------
alter table public.documents
  add column if not exists outcome_id uuid references public.outcomes(id) on delete cascade,
  add column if not exists template_id uuid references public.templates(id) on delete set null,
  add column if not exists is_template boolean not null default false;

-- Update status check to V1 values
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('draft', 'edited', 'approved', 'exported', 'archived'));

create index if not exists idx_documents_outcome on public.documents(outcome_id);

-- -----------------------------------------------
-- SECTIONS
-- -----------------------------------------------
create table if not exists public.sections (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  order_index integer not null default 0,
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'edited', 'approved', 'locked')),
  version_history jsonb not null default '[]'::jsonb,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sections_document on public.sections(document_id, order_index);

alter table public.sections enable row level security;

create policy "sections_own" on public.sections
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- UPLOADS
-- -----------------------------------------------
create table if not exists public.uploads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id uuid references public.outcomes(id) on delete set null,
  storage_path text not null,
  file_type text not null,
  file_name text not null,
  file_size_bytes integer,
  extracted_text text,
  extracted_payload jsonb,
  created_at timestamptz not null default now()
);

alter table public.uploads enable row level security;

create policy "uploads_own" on public.uploads
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- CHECKLIST ITEMS
-- -----------------------------------------------
create table if not exists public.checklist_items (
  id uuid primary key default uuid_generate_v4(),
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  due_date date,
  reason text,
  done boolean not null default false,
  reminder_offset_days integer,
  reminder_sent boolean not null default false,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_checklist_outcome on public.checklist_items(outcome_id, order_index);
create index if not exists idx_checklist_due on public.checklist_items(user_id, due_date) where due_date is not null;

alter table public.checklist_items enable row level security;

create policy "checklist_own" on public.checklist_items
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- BRAND KITS
-- -----------------------------------------------
create table if not exists public.brand_kits (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  logo_url text,
  primary_colour text not null default '#DC5430',
  secondary_colour text,
  footer_text text,
  updated_at timestamptz not null default now()
);

alter table public.brand_kits enable row level security;

create policy "brand_kits_owner" on public.brand_kits
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id
        and b.owner_user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------
-- COMPANY PROFILE
-- -----------------------------------------------
create table if not exists public.company_profile (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  voice_tone text,
  reusable_clauses jsonb not null default '[]'::jsonb,
  extra_fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.company_profile enable row level security;

create policy "company_profile_owner" on public.company_profile
  using (
    exists (
      select 1 from public.businesses b
      where b.id = business_id
        and b.owner_user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------
-- SUBSCRIPTIONS
-- -----------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium', 'business')),
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled', 'trialing')),
  revenuecat_customer_id text,
  entitlements jsonb not null default '{}'::jsonb,
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_subscriptions_user on public.subscriptions(user_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions_own" on public.subscriptions
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- USAGE LEDGER (append-only)
-- -----------------------------------------------
create table if not exists public.usage_ledger (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  event_type text not null check (event_type in ('document_created', 'ai_edit')),
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_user_created on public.usage_ledger(user_id, created_at desc);
create index if not exists idx_usage_business on public.usage_ledger(business_id, created_at desc) where business_id is not null;

alter table public.usage_ledger enable row level security;

create policy "usage_own_read" on public.usage_ledger
  for select using ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- AUDIT LOGS (service-role write only — no client RLS)
-- -----------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- No RLS — written by service role only; never exposed to client

-- -----------------------------------------------
-- TRIGGERS: set_updated_at on new tables
-- (set_updated_at function already exists from base migration)
-- -----------------------------------------------
drop trigger if exists businesses_updated_at on public.businesses;
create trigger businesses_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

drop trigger if exists outcomes_updated_at on public.outcomes;
create trigger outcomes_updated_at
  before update on public.outcomes
  for each row execute function public.set_updated_at();

drop trigger if exists sections_updated_at on public.sections;
create trigger sections_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

drop trigger if exists checklist_updated_at on public.checklist_items;
create trigger checklist_updated_at
  before update on public.checklist_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------
-- STORAGE BUCKETS (idempotent — run via service role after migration)
-- Reminder: run in Supabase dashboard or via management API:
--   insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false)
--   insert into storage.buckets (id, name, public) values ('brand-assets', 'brand-assets', false)
-- Then add storage RLS policies for each bucket.
-- -----------------------------------------------
