-- Private user details and explicit, per-outcome consent for document generation.
-- Profile fields remain nullable so existing accounts can be migrated safely;
-- profile_completed_at is only set by the app after all required fields validate.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists middle_names text,
  add column if not exists last_name text,
  add column if not exists preferred_name text,
  add column if not exists contact_email text,
  add column if not exists date_of_birth date,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists suburb text,
  add column if not exists state text,
  add column if not exists postcode text,
  add column if not exists country text not null default 'Australia',
  add column if not exists profile_completed_at timestamptz;

create table if not exists public.profile_data_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  approved_fields text[] not null default '{}'::text[],
  purpose text not null default 'document_generation'
    check (purpose = 'document_generation'),
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint profile_data_consents_user_outcome_key unique (user_id, outcome_id),
  constraint profile_data_consents_allowed_fields_check check (
    approved_fields <@ array[
      'first_name', 'middle_names', 'last_name', 'preferred_name',
      'contact_email', 'phone', 'date_of_birth', 'address_line_1',
      'address_line_2', 'suburb', 'state', 'postcode', 'country'
    ]::text[]
  )
);

create index if not exists idx_profile_data_consents_outcome
  on public.profile_data_consents (outcome_id);

alter table public.profile_data_consents enable row level security;

drop policy if exists profile_data_consents_select_own on public.profile_data_consents;
create policy profile_data_consents_select_own
  on public.profile_data_consents for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists profile_data_consents_insert_own on public.profile_data_consents;
create policy profile_data_consents_insert_own
  on public.profile_data_consents for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.outcomes
      where outcomes.id = outcome_id
        and outcomes.user_id = (select auth.uid())
    )
  );

drop policy if exists profile_data_consents_update_own on public.profile_data_consents;
create policy profile_data_consents_update_own
  on public.profile_data_consents for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.outcomes
      where outcomes.id = outcome_id
        and outcomes.user_id = (select auth.uid())
    )
  );

drop policy if exists profile_data_consents_delete_own on public.profile_data_consents;
create policy profile_data_consents_delete_own
  on public.profile_data_consents for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all privileges on public.profile_data_consents from anon, authenticated;
grant select, insert, update, delete on public.profile_data_consents to authenticated;

-- Sensitive details can only be selected by their owner (via the existing
-- profiles_select_own RLS policy) and updated through this explicit column list.
grant update (
  first_name, middle_names, last_name, preferred_name, contact_email, phone,
  date_of_birth, address_line_1, address_line_2, suburb, state, postcode,
  country, profile_completed_at, display_name
) on public.profiles to authenticated;

;
