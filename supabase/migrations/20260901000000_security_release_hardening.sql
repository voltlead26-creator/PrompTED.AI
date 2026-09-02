-- Close the remaining browser privilege and tenant-key gaps before release.
--
-- This migration is intentionally fail-closed for historical cross-tenant role
-- children: validation aborts without changing data if a mismatched row exists.

begin;

-- Subscription authority belongs to the billing webhook/service boundary.
-- Membership changes require a separately reviewed owner/invitation command;
-- an authenticated browser may only read its own current rows.
revoke all on table public.subscriptions, public.memberships
  from anon, authenticated;
grant select on table public.subscriptions, public.memberships
  to authenticated;

-- The RevenueCat Edge Function uses the service role. BYPASSRLS does not
-- confer table privileges, so grant only its subscription upsert and
-- append-only audit requirements explicitly.
revoke all on table public.subscriptions, public.audit_logs
  from service_role;
grant select, insert, update on table public.subscriptions
  to service_role;
grant insert on table public.audit_logs
  to service_role;

drop policy if exists "subscriptions_own" on public.subscriptions;
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "memberships_own" on public.memberships;
drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own"
  on public.memberships
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- A child row and its saved role must belong to the same tenant. The existing
-- single-column foreign keys cannot express that invariant.
alter table public.saved_roles
  add constraint saved_roles_id_user_id_key unique (id, user_id);

alter table public.role_documents
  add constraint role_documents_saved_role_owner_fkey
  foreign key (saved_role_id, user_id)
  references public.saved_roles(id, user_id)
  on delete cascade
  not valid;
alter table public.role_documents
  validate constraint role_documents_saved_role_owner_fkey;

alter table public.role_action_items
  add constraint role_action_items_saved_role_owner_fkey
  foreign key (saved_role_id, user_id)
  references public.saved_roles(id, user_id)
  on delete cascade
  not valid;
alter table public.role_action_items
  validate constraint role_action_items_saved_role_owner_fkey;

alter table public.role_outcomes
  add constraint role_outcomes_saved_role_owner_fkey
  foreign key (saved_role_id, user_id)
  references public.saved_roles(id, user_id)
  on delete cascade
  not valid;
alter table public.role_outcomes
  validate constraint role_outcomes_saved_role_owner_fkey;

alter table public.role_documents
  drop constraint role_documents_saved_role_id_fkey;
alter table public.role_action_items
  drop constraint role_action_items_saved_role_id_fkey;
alter table public.role_outcomes
  drop constraint role_outcomes_saved_role_id_fkey;

-- The trigger is privileged only so it can maintain the denormalised parent.
-- The owner predicate is repeated at the sink even though the composite FK now
-- protects the input boundary.
create or replace function public.sync_saved_role_latest_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.saved_roles
  set latest_stage = new.stage,
      updated_at = pg_catalog.clock_timestamp()
  where id = new.saved_role_id
    and user_id = new.user_id;

  if not found then
    raise exception 'SAVED_ROLE_OWNER_MISMATCH:%', new.saved_role_id;
  end if;
  return new;
end;
$function$;

revoke all on function public.sync_saved_role_latest_stage()
  from public, anon, authenticated, service_role;

-- These functions were promoted to SECURITY DEFINER by a later migration.
-- Their relations are already schema-qualified and pg_catalog remains
-- implicitly available, so an empty path removes name-shadowing risk without
-- changing their signatures or callers.
alter function public.promote_profile_resume(uuid, text)
  set search_path = '';
alter function public.restore_previous_profile_resume()
  set search_path = '';

-- These immutable-ledger guards already name their only application helper
-- explicitly. An empty path is therefore both safe and behavior-preserving.
alter function private.protect_ted_artifact_ledger_binding()
  set search_path = '';
alter function private.protect_ted_artifact_block_ledger_binding()
  set search_path = '';

-- A business attribution is valid only when the row owner owns the business
-- or has a current membership in it. Keep this as one private, fixed-path
-- invariant so privileged writers cannot bypass the same tenant check that
-- applies to browser-owned commands.
create or replace function private.assert_user_business_attribution(
  p_user_id uuid,
  p_business_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_business_id is null then
    return;
  end if;

  if p_user_id is null or not exists (
    select 1
    from public.businesses business_record
    where business_record.id = p_business_id
      and business_record.owner_user_id = p_user_id
    union all
    select 1
    from public.memberships membership_record
    where membership_record.business_id = p_business_id
      and membership_record.user_id = p_user_id
  ) then
    raise exception 'BUSINESS_ATTRIBUTION_FORBIDDEN:%', p_business_id
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function private.enforce_user_business_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.assert_user_business_attribution(new.user_id, new.business_id);
  return new;
end;
$function$;

revoke all on function private.assert_user_business_attribution(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_user_business_attribution()
  from public, anon, authenticated, service_role;

-- Existing mutable outcomes must already satisfy the invariant. Historical
-- usage rows are deliberately not reinterpreted; only new or changed usage
-- attribution is guarded below.
do $validation$
begin
  if exists (
    select 1
    from public.outcomes outcome_record
    where outcome_record.business_id is not null
      and not exists (
        select 1
        from public.businesses business_record
        where business_record.id = outcome_record.business_id
          and business_record.owner_user_id = outcome_record.user_id
        union all
        select 1
        from public.memberships membership_record
        where membership_record.business_id = outcome_record.business_id
          and membership_record.user_id = outcome_record.user_id
      )
  ) then
    raise exception 'INVALID_EXISTING_OUTCOME_BUSINESS_ATTRIBUTION';
  end if;
end;
$validation$;

drop trigger if exists outcomes_business_attribution_guard on public.outcomes;
create trigger outcomes_business_attribution_guard
  before insert or update of user_id, business_id on public.outcomes
  for each row execute function private.enforce_user_business_attribution();

drop trigger if exists usage_ledger_business_attribution_guard
  on public.usage_ledger;
create trigger usage_ledger_business_attribution_guard
  before insert or update of user_id, business_id on public.usage_ledger
  for each row execute function private.enforce_user_business_attribution();

-- Expand cohort: add the command boundary before removing the current
-- RLS-protected browser writes. The already-published web client still uses
-- direct owner-scoped INSERT/UPDATE, so revoking those privileges before a
-- compatible Netlify artifact is proven live would make a failed deployment
-- strand production. A later, separately gated contract migration may revoke
-- these two legacy verbs after client/cohort telemetry proves the RPC-only web
-- is active. Anonymous mutation and authenticated DELETE remain unavailable.
revoke insert, update, delete on table public.outcomes from anon;
revoke delete on table public.outcomes from authenticated;
grant insert, update on table public.outcomes to authenticated;

create or replace function public.upsert_own_outcome(
  p_id uuid,
  p_situation_text text,
  p_recommendation_payload jsonb default null,
  p_status text default 'in_progress'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing_owner uuid;
  v_persisted_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_id is null or p_situation_text is null then
    raise exception 'OUTCOME_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('draft', 'in_progress', 'completed') then
    raise exception 'OUTCOME_STATUS_INVALID' using errcode = '22023';
  end if;

  select outcome_record.user_id into v_existing_owner
  from public.outcomes outcome_record
  where outcome_record.id = p_id
  for update;

  if found and v_existing_owner <> v_user_id then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_id using errcode = '42501';
  end if;

  insert into public.outcomes(
    id,
    user_id,
    situation_text,
    recommendation_payload,
    status,
    updated_at
  ) values (
    p_id,
    v_user_id,
    p_situation_text,
    p_recommendation_payload,
    p_status,
    pg_catalog.clock_timestamp()
  )
  on conflict (id) do update set
    situation_text = excluded.situation_text,
    recommendation_payload = excluded.recommendation_payload,
    status = excluded.status,
    updated_at = pg_catalog.clock_timestamp()
  where public.outcomes.user_id = v_user_id
  returning id into v_persisted_id;

  if v_persisted_id is null then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_id using errcode = '42501';
  end if;
  return v_persisted_id;
end;
$function$;

create or replace function public.update_own_outcome(
  p_outcome_id uuid,
  p_patch jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_outcome public.outcomes%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_outcome_id is null
    or pg_catalog.jsonb_typeof(p_patch) is distinct from 'object'
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_patch) patch_key
      where patch_key not in ('status', 'is_saved', 'recommendation_payload')
    ) then
    raise exception 'OUTCOME_PATCH_INVALID' using errcode = '22023';
  end if;
  if p_patch ? 'status' and (
    pg_catalog.jsonb_typeof(p_patch->'status') is distinct from 'string'
    or p_patch->>'status' not in ('draft', 'in_progress', 'completed')
  ) then
    raise exception 'OUTCOME_STATUS_INVALID' using errcode = '22023';
  end if;
  if p_patch ? 'is_saved'
    and pg_catalog.jsonb_typeof(p_patch->'is_saved') is distinct from 'boolean' then
    raise exception 'OUTCOME_SAVED_STATE_INVALID' using errcode = '22023';
  end if;

  select * into v_outcome
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
  for update;

  if not found then
    raise exception 'OUTCOME_NOT_FOUND:%', p_outcome_id;
  end if;
  if v_outcome.user_id <> v_user_id then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_outcome_id using errcode = '42501';
  end if;

  update public.outcomes
  set status = case
        when p_patch ? 'status' then p_patch->>'status'
        else v_outcome.status
      end,
      is_saved = case
        when p_patch ? 'is_saved' then (p_patch->>'is_saved')::boolean
        else v_outcome.is_saved
      end,
      recommendation_payload = case
        when p_patch ? 'recommendation_payload'
          then nullif(p_patch->'recommendation_payload', 'null'::jsonb)
        else v_outcome.recommendation_payload
      end,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_outcome_id
    and user_id = v_user_id;

  return p_outcome_id;
end;
$function$;

revoke all on function public.upsert_own_outcome(uuid, text, jsonb, text)
  from public, anon, service_role;
revoke all on function public.update_own_outcome(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.upsert_own_outcome(uuid, text, jsonb, text)
  to authenticated;
grant execute on function public.update_own_outcome(uuid, jsonb)
  to authenticated;

-- Replace the legacy invoker import with one authenticated, atomic owner
-- command. The upload is the owner-scoped idempotency record. All collision
-- checks happen before child replacement and every identifier is fully
-- qualified because this function deliberately has an empty search path.
create or replace function public.commit_document_import(
  p_upload_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_situation_text text,
  p_recommendation_payload jsonb,
  p_sections jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_upload public.uploads%rowtype;
  v_existing_owner uuid;
  v_persisted_id uuid;
  v_section jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_upload_id is null or p_outcome_id is null or p_document_id is null then
    raise exception 'IMPORT_ID_INVALID' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_sections) is distinct from 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_sections) section_record
      where pg_catalog.jsonb_typeof(section_record) is distinct from 'object'
    ) then
    raise exception 'IMPORT_SECTIONS_INVALID' using errcode = '22023';
  end if;

  select * into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = v_user_id
  for update;

  if not found then
    raise exception 'UPLOAD_NOT_FOUND:%', p_upload_id;
  end if;

  if v_upload.status = 'committed' then
    return pg_catalog.jsonb_build_object(
      'status', 'committed',
      'outcome_id', v_upload.outcome_id,
      'document_id', v_upload.document_id,
      'idempotent_replay', true
    );
  end if;

  select outcome_record.user_id into v_existing_owner
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
  for update;
  if found and v_existing_owner <> v_user_id then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_outcome_id using errcode = '42501';
  end if;

  v_existing_owner := null;
  select document_record.user_id into v_existing_owner
  from public.documents document_record
  where document_record.id = p_document_id
  for update;
  if found and v_existing_owner <> v_user_id then
    raise exception 'DOCUMENT_ID_CONFLICT:%', p_document_id using errcode = '42501';
  end if;

  insert into public.outcomes(
    id, user_id, situation_text, recommendation_payload, status
  ) values (
    p_outcome_id, v_user_id, p_situation_text, p_recommendation_payload, 'in_progress'
  )
  on conflict (id) do update set
    situation_text = excluded.situation_text,
    recommendation_payload = excluded.recommendation_payload,
    status = excluded.status,
    updated_at = pg_catalog.clock_timestamp()
  where public.outcomes.user_id = v_user_id
  returning id into v_persisted_id;
  if v_persisted_id is null then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_outcome_id using errcode = '42501';
  end if;

  v_persisted_id := null;
  insert into public.documents(
    id, user_id, outcome_id, title, status
  ) values (
    p_document_id, v_user_id, p_outcome_id, p_title, 'draft'
  )
  on conflict (id) do update set
    outcome_id = excluded.outcome_id,
    title = excluded.title,
    status = excluded.status,
    updated_at = pg_catalog.clock_timestamp()
  where public.documents.user_id = v_user_id
  returning id into v_persisted_id;
  if v_persisted_id is null then
    raise exception 'DOCUMENT_ID_CONFLICT:%', p_document_id using errcode = '42501';
  end if;

  delete from public.sections section_record
  where section_record.document_id = p_document_id
    and section_record.user_id = v_user_id;

  for v_section in
    select section_record
    from pg_catalog.jsonb_array_elements(p_sections) section_record
  loop
    if nullif(v_section->>'id', '') is null then
      raise exception 'IMPORT_SECTION_ID_INVALID' using errcode = '22023';
    end if;
    insert into public.sections(
      id, document_id, user_id, name, order_index, content, status,
      version_history, is_required, created_at, updated_at
    ) values (
      (v_section->>'id')::uuid,
      p_document_id,
      v_user_id,
      coalesce(v_section->>'name', 'Untitled section'),
      coalesce((v_section->>'order_index')::integer, 0),
      coalesce(v_section->>'content', ''),
      coalesce(v_section->>'status', 'draft'),
      coalesce(v_section->'version_history', '[]'::jsonb),
      coalesce((v_section->>'is_required')::boolean, true),
      coalesce(
        (v_section->>'created_at')::timestamptz,
        pg_catalog.clock_timestamp()
      ),
      pg_catalog.clock_timestamp()
    );
  end loop;

  update public.uploads
  set outcome_id = p_outcome_id,
      document_id = p_document_id,
      status = 'committed',
      completed_at = pg_catalog.clock_timestamp(),
      error_code = null
  where id = p_upload_id
    and user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'status', 'committed',
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.commit_document_import(
  uuid, uuid, uuid, text, text, jsonb, jsonb
) from public, anon, service_role;
grant execute on function public.commit_document_import(
  uuid, uuid, uuid, text, text, jsonb, jsonb
) to authenticated;

commit;
