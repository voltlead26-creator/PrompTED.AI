-- PrompTED database hardening
--
-- Separates read-only server-managed data from user-editable data, prevents
-- child rows being attached to another user's parent records, and adds the
-- indexes used by the application's current filters and joins.

-- ---------------------------------------------------------------------------
-- Security-definer auth trigger
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- This trigger only denormalises a stage on a row the caller can already
-- update. It does not need elevated privileges.
create or replace function public.sync_saved_role_latest_stage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.saved_roles
  set latest_stage = new.stage,
      updated_at = now()
  where id = new.saved_role_id;
  return new;
end;
$$;

revoke execute on function public.sync_saved_role_latest_stage() from public, anon, authenticated;

alter function public.commit_document_import(uuid, uuid, uuid, text, text, jsonb, jsonb)
  set search_path = '';

-- ---------------------------------------------------------------------------
-- Explicit Data API privileges
-- ---------------------------------------------------------------------------

-- Remove the broad default public-schema privileges before adding back only
-- those used by the app. RLS remains the row-level boundary; grants reduce the
-- available operations before a policy is even evaluated.
revoke all privileges on
  public.profiles,
  public.businesses,
  public.memberships,
  public.clari_preferences,
  public.templates,
  public.bundles,
  public.outcomes,
  public.documents,
  public.sections,
  public.uploads,
  public.checklist_items,
  public.brand_kits,
  public.company_profile,
  public.subscriptions,
  public.usage_ledger,
  public.audit_logs,
  public.job_market_roles,
  public.revision_history,
  public.export_history
from anon, authenticated;

-- Profile plan, usage and persisted AI memory are server-managed. A user may
-- edit only the fields surfaced by the account and business settings screens.
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, phone, acknowledged_advice_boundaries, business_id)
  on public.profiles to authenticated;

-- Billing, metering, audit and market-reference rows are written only by
-- trusted Edge Functions using the service role.
grant select on public.subscriptions, public.usage_ledger to authenticated;

-- Public catalogue reads and authenticated application persistence. These
-- grants are explicit because new Supabase projects no longer automatically
-- expose newly-created public tables to the Data API.
grant select on public.templates, public.bundles to anon, authenticated;
grant select, insert, update, delete on
  public.businesses,
  public.clari_preferences,
  public.outcomes,
  public.documents,
  public.sections,
  public.uploads,
  public.checklist_items,
  public.brand_kits,
  public.company_profile
to authenticated;
grant select on public.memberships to authenticated;
grant select, insert on public.revision_history, public.export_history to authenticated;

-- These tables were introduced by later production migrations. Keeping this
-- conditional makes the hardening migration safe for branches where those
-- feature migrations have not yet been pulled into the local history.
do $$
begin
  if to_regclass('public.generation_logs') is not null then
    execute 'revoke all privileges on public.generation_logs from anon, authenticated';
    execute 'grant select on public.generation_logs to authenticated';
  end if;

  if to_regclass('public.saved_roles') is not null then
    execute 'revoke all privileges on public.saved_roles from anon, authenticated';
    execute 'grant select, insert, update, delete on public.saved_roles to authenticated';
  end if;

  if to_regclass('public.role_documents') is not null then
    execute 'revoke all privileges on public.role_documents from anon, authenticated';
    execute 'grant select, insert, update, delete on public.role_documents to authenticated';
  end if;

  if to_regclass('public.role_action_items') is not null then
    execute 'revoke all privileges on public.role_action_items from anon, authenticated';
    execute 'grant select, insert, update, delete on public.role_action_items to authenticated';
  end if;

  if to_regclass('public.role_outcomes') is not null then
    execute 'revoke all privileges on public.role_outcomes from anon, authenticated';
    execute 'grant select, insert, update, delete on public.role_outcomes to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue and server-managed table policies
-- ---------------------------------------------------------------------------

drop policy if exists templates_select_published on public.templates;
create policy templates_select_published
  on public.templates
  for select
  to anon, authenticated
  using (is_published = true);

drop policy if exists bundles_select_published on public.bundles;
create policy bundles_select_published
  on public.bundles
  for select
  to anon, authenticated
  using (is_published = true);

-- The job-match function reads with the service role. There is no reason to
-- make its curated market dataset directly readable through the public API.
drop policy if exists job_market_roles_select_public on public.job_market_roles;

do $$
begin
  if to_regclass('public.generation_logs') is not null then
    execute 'drop policy if exists generation_logs_select_own on public.generation_logs';
    execute $policy$
      create policy generation_logs_select_own
        on public.generation_logs
        for select
        to authenticated
        using (user_id = (select auth.uid()))
    $policy$;
  end if;

  if to_regclass('public.saved_roles') is not null then
    execute 'drop policy if exists saved_roles_own on public.saved_roles';
    execute $policy$
      create policy saved_roles_own
        on public.saved_roles
        for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (user_id = (select auth.uid()))
    $policy$;
  end if;

  if to_regclass('public.role_documents') is not null then
    execute 'drop policy if exists role_documents_own on public.role_documents';
    execute $policy$
      create policy role_documents_own
        on public.role_documents
        for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (
          user_id = (select auth.uid())
          and exists (
            select 1 from public.saved_roles r
            where r.id = role_documents.saved_role_id
              and r.user_id = (select auth.uid())
          )
        )
    $policy$;
  end if;

  if to_regclass('public.role_action_items') is not null then
    execute 'drop policy if exists role_action_items_own on public.role_action_items';
    execute $policy$
      create policy role_action_items_own
        on public.role_action_items
        for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (
          user_id = (select auth.uid())
          and exists (
            select 1 from public.saved_roles r
            where r.id = role_action_items.saved_role_id
              and r.user_id = (select auth.uid())
          )
        )
    $policy$;
  end if;

  if to_regclass('public.role_outcomes') is not null then
    execute 'drop policy if exists role_outcomes_own on public.role_outcomes';
    execute $policy$
      create policy role_outcomes_own
        on public.role_outcomes
        for all
        to authenticated
        using (user_id = (select auth.uid()))
        with check (
          user_id = (select auth.uid())
          and exists (
            select 1 from public.saved_roles r
            where r.id = role_outcomes.saved_role_id
              and r.user_id = (select auth.uid())
          )
        )
    $policy$;
  end if;
end $$;

drop policy if exists memberships_own on public.memberships;
create policy memberships_read_relevant
  on public.memberships
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.businesses b
      where b.id = memberships.business_id
        and b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_read_own
  on public.subscriptions
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists usage_own_read on public.usage_ledger;
create policy usage_read_own
  on public.usage_ledger
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- User-owned tables and parent/child integrity
-- ---------------------------------------------------------------------------

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (
      business_id is null
      or exists (
        select 1
        from public.businesses b
        where b.id = profiles.business_id
          and b.owner_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists businesses_owner on public.businesses;
create policy businesses_owner
  on public.businesses
  for all
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists clari_own on public.clari_preferences;
create policy clari_own
  on public.clari_preferences
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists outcomes_own on public.outcomes;
create policy outcomes_own
  on public.outcomes
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      business_id is null
      or exists (
        select 1
        from public.businesses b
        where b.id = outcomes.business_id
          and b.owner_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists documents_insert_own on public.documents;
drop policy if exists documents_update_own on public.documents;
create policy documents_insert_own
  on public.documents
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      outcome_id is null
      or exists (
        select 1
        from public.outcomes o
        where o.id = documents.outcome_id
          and o.user_id = (select auth.uid())
      )
    )
  );
create policy documents_update_own
  on public.documents
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      outcome_id is null
      or exists (
        select 1
        from public.outcomes o
        where o.id = documents.outcome_id
          and o.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists sections_own on public.sections;
create policy sections_own
  on public.sections
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.documents d
      where d.id = sections.document_id
        and d.user_id = (select auth.uid())
    )
  );

drop policy if exists uploads_own on public.uploads;
create policy uploads_own
  on public.uploads
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      outcome_id is null
      or exists (
        select 1
        from public.outcomes o
        where o.id = uploads.outcome_id
          and o.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists checklist_own on public.checklist_items;
create policy checklist_own
  on public.checklist_items
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.outcomes o
      where o.id = checklist_items.outcome_id
        and o.user_id = (select auth.uid())
    )
  );

drop policy if exists brand_kits_owner on public.brand_kits;
create policy brand_kits_owner
  on public.brand_kits
  for all
  to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = brand_kits.business_id
        and b.owner_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = brand_kits.business_id
        and b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists company_profile_owner on public.company_profile;
create policy company_profile_owner
  on public.company_profile
  for all
  to authenticated
  using (
    exists (
      select 1 from public.businesses b
      where b.id = company_profile.business_id
        and b.owner_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = company_profile.business_id
        and b.owner_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Query and foreign-key indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_profiles_business_id
  on public.profiles (business_id)
  where business_id is not null;
create index if not exists idx_memberships_user_id
  on public.memberships (user_id);
create index if not exists idx_bundles_checklist_template_id
  on public.bundles (checklist_template_id)
  where checklist_template_id is not null;
create index if not exists idx_outcomes_bundle_id
  on public.outcomes (bundle_id)
  where bundle_id is not null;
create index if not exists idx_subscriptions_business_id
  on public.subscriptions (business_id)
  where business_id is not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'uploads'
      and column_name = 'document_id'
  ) then
    execute 'create index if not exists idx_uploads_document_id on public.uploads (document_id) where document_id is not null';
  end if;
end $$;

-- Matches the Library's saved-items filter and descending recency order.
create index if not exists idx_outcomes_user_saved_updated
  on public.outcomes (user_id, updated_at desc, id desc)
  where is_saved = true;

-- Stable cursor pagination for the main Recents view.
create index if not exists idx_outcomes_user_updated_id
  on public.outcomes (user_id, updated_at desc, id desc);

-- Matches the What's Due query and avoids indexing completed checklist rows.
drop index if exists public.idx_checklist_due;
create index idx_checklist_due
  on public.checklist_items (user_id, due_date)
  where due_date is not null and done = false;

-- ---------------------------------------------------------------------------
-- Brand logo storage
-- ---------------------------------------------------------------------------

-- Brand logos are deliberately public because they are embedded in exported
-- documents. Writes remain restricted to the owning business account.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists brand_assets_select_own on storage.objects;
create policy brand_assets_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = 'brand-kits'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(name))[2]
        and b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists brand_assets_insert_own on storage.objects;
create policy brand_assets_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = 'brand-kits'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(name))[2]
        and b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists brand_assets_update_own on storage.objects;
create policy brand_assets_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = 'brand-kits'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(name))[2]
        and b.owner_user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = 'brand-kits'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(name))[2]
        and b.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists brand_assets_delete_own on storage.objects;
create policy brand_assets_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = 'brand-kits'
    and exists (
      select 1 from public.businesses b
      where b.id::text = (storage.foldername(name))[2]
        and b.owner_user_id = (select auth.uid())
    )
  );
;
