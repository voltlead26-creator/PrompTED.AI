-- Replace browser-owned mutable public logos with one durable, replay-safe,
-- service-owned brand-kit operation. Existing rows and objects remain in
-- place; the first successful replace/remove inventories their exact prefix.

begin;

alter table public.brand_kits
  add column revision bigint not null default 0,
  add column logo_operation_id uuid,
  add column logo_storage_path text,
  add column logo_content_sha256 text,
  add column logo_media_type text,
  add column logo_byte_length integer,
  add column logo_status text not null default 'ready';

update public.brand_kits
set logo_status = 'legacy_unverified'
where logo_url is not null;

alter table public.brand_kits
  add constraint brand_kits_revision_nonnegative
    check (revision >= 0),
  add constraint brand_kits_logo_status_valid
    check (logo_status in ('ready', 'legacy_unverified', 'reconciliation_required')),
  add constraint brand_kits_logo_identity_valid
    check (
      (
        logo_status = 'legacy_unverified'
        and logo_url is not null
        and logo_storage_path is null
        and logo_content_sha256 is null
        and logo_media_type is null
        and logo_byte_length is null
        and logo_operation_id is null
      )
      or (
        logo_status = 'ready'
        and logo_url is null
        and logo_storage_path is null
        and logo_content_sha256 is null
        and logo_media_type is null
        and logo_byte_length is null
        and logo_operation_id is null
      )
      or (
        logo_status in ('ready', 'reconciliation_required')
        and logo_url is not null
        and logo_operation_id is not null
        and logo_storage_path ~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp)$'
        and logo_content_sha256 ~ '^[0-9a-f]{64}$'
        and logo_media_type in ('image/png', 'image/jpeg', 'image/webp')
        and logo_byte_length between 1 and 5242880
      )
    );

create table private.brand_logo_operations (
  operation_id uuid primary key,
  user_key text not null check (user_key ~ '^[0-9a-f]{64}$'),
  business_id uuid not null references public.businesses(id) on delete cascade,
  binding_version text not null
    check (binding_version = 'prompted.brand-kit-operation.v1'),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('keep', 'replace', 'remove')),
  expected_revision bigint not null check (expected_revision >= 0),
  primary_colour text not null check (primary_colour ~ '^#[0-9a-f]{6}$'),
  secondary_colour text check (secondary_colour ~ '^#[0-9a-f]{6}$'),
  footer_text text check (
    footer_text is null
    or (char_length(footer_text) between 1 and 200 and footer_text = pg_catalog.btrim(footer_text))
  ),
  new_storage_path text,
  new_content_sha256 text check (new_content_sha256 ~ '^[0-9a-f]{64}$'),
  new_byte_length integer check (new_byte_length between 1 and 5242880),
  new_media_type text check (new_media_type in ('image/png', 'image/jpeg', 'image/webp')),
  old_storage_paths text[] not null default '{}'::text[],
  claim_token uuid not null unique default extensions.gen_random_uuid(),
  publish_dispatch_token uuid not null unique default extensions.gen_random_uuid(),
  delete_dispatch_token uuid not null unique default extensions.gen_random_uuid(),
  state text not null check (state in ('accepted', 'storage_verified', 'activated', 'completed')),
  cleanup_evidence_sha256 text check (cleanup_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  terminal_http_status integer check (terminal_http_status between 200 and 599),
  terminal_response jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  check (
    (
      action = 'replace'
      and new_storage_path ~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp)$'
      and new_content_sha256 is not null
      and new_byte_length is not null
      and new_media_type is not null
    )
    or (
      action in ('keep', 'remove')
      and new_storage_path is null
      and new_content_sha256 is null
      and new_byte_length is null
      and new_media_type is null
    )
  ),
  check (
    (state = 'completed' and terminal_http_status is not null
      and terminal_response is not null and completed_at is not null
      and cleanup_evidence_sha256 is not null)
    or (state <> 'completed' and terminal_http_status is null
      and terminal_response is null and completed_at is null
      and cleanup_evidence_sha256 is null)
  )
);

create unique index brand_logo_one_active_operation
  on private.brand_logo_operations(business_id)
  where state <> 'completed';

alter table private.brand_logo_operations enable row level security;
revoke all on table private.brand_logo_operations
  from public, anon, authenticated, service_role;

create or replace function private.enforce_brand_logo_operation_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.operation_id is distinct from new.operation_id
    or old.user_key is distinct from new.user_key
    or old.business_id is distinct from new.business_id
    or old.binding_version is distinct from new.binding_version
    or old.binding_sha256 is distinct from new.binding_sha256
    or old.action is distinct from new.action
    or old.expected_revision is distinct from new.expected_revision
    or old.primary_colour is distinct from new.primary_colour
    or old.secondary_colour is distinct from new.secondary_colour
    or old.footer_text is distinct from new.footer_text
    or old.new_storage_path is distinct from new.new_storage_path
    or old.new_content_sha256 is distinct from new.new_content_sha256
    or old.new_byte_length is distinct from new.new_byte_length
    or old.new_media_type is distinct from new.new_media_type
    or old.old_storage_paths is distinct from new.old_storage_paths
    or old.claim_token is distinct from new.claim_token
    or old.publish_dispatch_token is distinct from new.publish_dispatch_token
    or old.delete_dispatch_token is distinct from new.delete_dispatch_token
    or old.created_at is distinct from new.created_at then
    raise exception 'BRAND_LOGO_OPERATION_IMMUTABLE';
  end if;

  if old.state is distinct from new.state and not (
    (old.state = 'accepted' and new.state in ('storage_verified', 'completed'))
    or (old.state = 'storage_verified' and new.state = 'activated')
    or (old.state = 'activated' and new.state = 'completed')
  ) then
    raise exception 'BRAND_LOGO_STATE_TRANSITION_INVALID';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_brand_logo_operation_transition()
  from public, anon, authenticated, service_role;

create trigger brand_logo_operation_transition
before update on private.brand_logo_operations
for each row execute function private.enforce_brand_logo_operation_transition();

-- Supersede the historical browser-mutation policy. Public delivery remains
-- compatible, but only protected service code may mutate objects.
drop policy if exists assets_authenticated_owner_boundary on storage.objects;
drop policy if exists assets_authenticated_access on storage.objects;
drop policy if exists assets_no_direct_client_delete on storage.objects;
drop policy if exists assets_authenticated_owner_select on storage.objects;

create policy assets_authenticated_owner_select
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'assets'
    and name ~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo[.](png|jpg|webp)|logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp))$'
    and exists (
      select 1
      from public.businesses business_record
      where business_record.id::text = pg_catalog.split_part(name, '/', 2)
        and business_record.owner_user_id = (select auth.uid())
    )
  );

revoke insert, update, delete on table public.brand_kits
  from authenticated, service_role;

create or replace function private.enforce_user_storage_deletion_fence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new_user_id uuid;
  v_old_user_id uuid;
  v_prefix text;
begin
  if new.bucket_id in ('original-documents', 'captured-exports') then
    v_prefix := pg_catalog.split_part(new.name, '/', 1);
    if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'USER_STORAGE_PREFIX_INVALID';
    end if;
    v_new_user_id := v_prefix::uuid;
  elsif new.bucket_id = 'assets' then
    if new.name !~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo[.](png|jpg|webp)|logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp))$' then
      raise exception 'BRAND_ASSET_PATH_INVALID';
    end if;
    v_prefix := pg_catalog.split_part(new.name, '/', 2);
    select business_record.owner_user_id into v_new_user_id
    from public.businesses business_record
    where business_record.id = v_prefix::uuid;
    if not found then raise exception 'BRAND_ASSET_BUSINESS_UNAVAILABLE'; end if;
  end if;

  if tg_op = 'UPDATE' and old.bucket_id in ('original-documents', 'captured-exports') then
    v_prefix := pg_catalog.split_part(old.name, '/', 1);
    if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'USER_STORAGE_PREFIX_INVALID';
    end if;
    v_old_user_id := v_prefix::uuid;
  elsif tg_op = 'UPDATE' and old.bucket_id = 'assets' then
    if old.name !~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo[.](png|jpg|webp)|logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp))$' then
      raise exception 'BRAND_ASSET_PATH_INVALID';
    end if;
    v_prefix := pg_catalog.split_part(old.name, '/', 2);
    select business_record.owner_user_id into v_old_user_id
    from public.businesses business_record
    where business_record.id = v_prefix::uuid;
    if not found then raise exception 'BRAND_ASSET_BUSINESS_UNAVAILABLE'; end if;
  end if;

  if v_new_user_id is null and v_old_user_id is null then return new; end if;
  if v_new_user_id is not null and v_old_user_id is not null
    and v_new_user_id is distinct from v_old_user_id then
    if v_new_user_id::text < v_old_user_id::text then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_new_user_id::text, 91000));
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_old_user_id::text, 91000));
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_old_user_id::text, 91000));
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_new_user_id::text, 91000));
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(coalesce(v_new_user_id, v_old_user_id)::text, 91000)
    );
  end if;

  if (v_new_user_id is not null and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key = private.account_deletion_user_key(v_new_user_id)
    )) or (v_old_user_id is not null and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key = private.account_deletion_user_key(v_old_user_id)
    )) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_user_storage_deletion_fence()
  from public, anon, authenticated, service_role;

-- Extend the existing common dispatch authority instead of introducing a
-- second account-deletion race boundary for brand assets.
alter table private.user_storage_dispatches
  drop constraint user_storage_dispatches_dispatch_kind_check;
alter table private.user_storage_dispatches
  add constraint user_storage_dispatches_dispatch_kind_check
  check (dispatch_kind in (
    'captured-export', 'legacy-export', 'brand-logo-publish', 'brand-logo-delete'
  ));

create or replace function public.claim_user_storage_dispatch(
  p_user_id uuid,
  p_operation_id uuid,
  p_dispatch_kind text,
  p_storage_path_sha256 text,
  p_artifact_sha256 text,
  p_dispatch_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_key text;
  v_dispatch private.user_storage_dispatches%rowtype;
begin
  if p_user_id is null or p_operation_id is null
    or p_dispatch_kind is null
    or p_dispatch_kind not in (
      'captured-export', 'legacy-export', 'brand-logo-publish', 'brand-logo-delete'
    )
    or p_storage_path_sha256 is null
    or p_storage_path_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_sha256 is null
    or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_dispatch_token is null then
    raise exception 'USER_STORAGE_DISPATCH_INVALID';
  end if;
  v_user_key := private.account_deletion_user_key(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = v_user_key
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  insert into private.user_storage_dispatches(
    user_key, operation_id, dispatch_kind, storage_path_sha256,
    artifact_sha256, dispatch_token, state
  ) values (
    v_user_key, p_operation_id, p_dispatch_kind, p_storage_path_sha256,
    p_artifact_sha256, p_dispatch_token, 'dispatched'
  )
  on conflict (user_key, operation_id, dispatch_kind) do nothing
  returning * into v_dispatch;
  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'accepted', 'storage_permitted', true,
      'dispatch_token', p_dispatch_token
    );
  end if;
  select * into v_dispatch
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.operation_id = p_operation_id
    and dispatch_record.dispatch_kind = p_dispatch_kind
  for update;
  if v_dispatch.storage_path_sha256 is distinct from p_storage_path_sha256
    or v_dispatch.artifact_sha256 is distinct from p_artifact_sha256 then
    raise exception 'USER_STORAGE_DISPATCH_CONFLICT';
  end if;
  if v_dispatch.state = 'completed' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'completed', 'storage_permitted', false,
      'dispatch_token', p_dispatch_token
    );
  end if;
  if v_dispatch.dispatch_token is distinct from p_dispatch_token then
    return pg_catalog.jsonb_build_object(
      'outcome', 'processing', 'storage_permitted', false,
      'dispatch_token', p_dispatch_token, 'retry_after_seconds', 2
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'outcome', 'idempotent_replay', 'storage_permitted', true,
    'dispatch_token', p_dispatch_token
  );
end;
$function$;

create or replace function public.complete_user_storage_dispatch(
  p_user_id uuid,
  p_operation_id uuid,
  p_dispatch_kind text,
  p_storage_path_sha256 text,
  p_artifact_sha256 text,
  p_dispatch_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispatch private.user_storage_dispatches%rowtype;
begin
  if p_user_id is null or p_operation_id is null
    or p_dispatch_kind is null
    or p_dispatch_kind not in (
      'captured-export', 'legacy-export', 'brand-logo-publish', 'brand-logo-delete'
    )
    or p_storage_path_sha256 is null
    or p_storage_path_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_sha256 is null
    or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_dispatch_token is null then
    raise exception 'USER_STORAGE_DISPATCH_INVALID';
  end if;
  select * into v_dispatch
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
    and dispatch_record.operation_id = p_operation_id
    and dispatch_record.dispatch_kind = p_dispatch_kind
  for update;
  if not found
    or v_dispatch.storage_path_sha256 is distinct from p_storage_path_sha256
    or v_dispatch.artifact_sha256 is distinct from p_artifact_sha256
    or v_dispatch.dispatch_token is distinct from p_dispatch_token then
    raise exception 'USER_STORAGE_DISPATCH_CONFLICT';
  end if;
  if v_dispatch.state = 'completed' then
    return pg_catalog.jsonb_build_object('outcome', 'idempotent_replay');
  end if;
  update private.user_storage_dispatches
  set state = 'completed', completed_at = pg_catalog.clock_timestamp()
  where id = v_dispatch.id;
  return pg_catalog.jsonb_build_object('outcome', 'completed');
end;
$function$;

create or replace function public.reconcile_user_storage_dispatch(
  p_user_id uuid,
  p_operation_id uuid,
  p_dispatch_kind text,
  p_storage_path_sha256 text,
  p_resolution text,
  p_evidence_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispatch private.user_storage_dispatches%rowtype;
begin
  if p_user_id is null or p_operation_id is null
    or p_dispatch_kind is null
    or p_dispatch_kind not in (
      'captured-export', 'legacy-export', 'brand-logo-publish', 'brand-logo-delete'
    )
    or p_storage_path_sha256 is null
    or p_storage_path_sha256 !~ '^[0-9a-f]{64}$'
    or p_resolution is null
    or p_resolution not in ('verified_absent', 'verified_removed')
    or p_evidence_sha256 is null
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'USER_STORAGE_RECONCILIATION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if not exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'USER_STORAGE_RECONCILIATION_REQUIRES_DELETION_FENCE';
  end if;
  select * into v_dispatch
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
    and dispatch_record.operation_id = p_operation_id
    and dispatch_record.dispatch_kind = p_dispatch_kind
  for update;
  if not found
    or v_dispatch.storage_path_sha256 is distinct from p_storage_path_sha256 then
    raise exception 'USER_STORAGE_RECONCILIATION_CONFLICT';
  end if;
  if v_dispatch.state = 'completed' then
    if v_dispatch.reconciliation_resolution is not distinct from p_resolution
      and v_dispatch.reconciliation_evidence_sha256 is not distinct from p_evidence_sha256 then
      return pg_catalog.jsonb_build_object('outcome', 'idempotent_replay');
    end if;
    raise exception 'USER_STORAGE_RECONCILIATION_CONFLICT';
  end if;
  if v_dispatch.state is distinct from 'dispatched'
    or v_dispatch.lease_expires_at > pg_catalog.clock_timestamp() then
    raise exception 'USER_STORAGE_RECONCILIATION_CONFLICT';
  end if;
  update private.user_storage_dispatches
  set state = 'completed', completed_at = pg_catalog.clock_timestamp(),
      reconciliation_resolution = p_resolution,
      reconciliation_evidence_sha256 = p_evidence_sha256,
      reconciled_at = pg_catalog.clock_timestamp()
  where id = v_dispatch.id;
  return pg_catalog.jsonb_build_object(
    'outcome', 'reconciled', 'resolution', p_resolution,
    'evidence_sha256', p_evidence_sha256
  );
end;
$function$;

create or replace function private.brand_kit_result(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', brand_record.id,
    'business_id', brand_record.business_id,
    'logo_url', brand_record.logo_url,
    'primary_colour', brand_record.primary_colour,
    'secondary_colour', brand_record.secondary_colour,
    'footer_text', brand_record.footer_text,
    'revision', brand_record.revision,
    'logo_operation_id', brand_record.logo_operation_id,
    'logo_storage_path', brand_record.logo_storage_path,
    'logo_content_sha256', brand_record.logo_content_sha256,
    'logo_media_type', brand_record.logo_media_type,
    'logo_byte_length', brand_record.logo_byte_length,
    'logo_status', brand_record.logo_status,
    'updated_at', brand_record.updated_at
  )
  from public.brand_kits brand_record
  where brand_record.business_id = p_business_id
$function$;

create or replace function private.brand_logo_claim_result(
  p_operation_id uuid,
  p_outcome text
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'outcome', case when operation_record.state = 'completed'
      then 'completed' else p_outcome end,
    'operation_id', operation_record.operation_id,
    'state', operation_record.state,
    'claim_token', operation_record.claim_token,
    'publish_dispatch_token', operation_record.publish_dispatch_token,
    'delete_dispatch_token', operation_record.delete_dispatch_token,
    'business_id', operation_record.business_id,
    'action', operation_record.action,
    'expected_revision', operation_record.expected_revision,
    'new_storage_path', operation_record.new_storage_path,
    'new_content_sha256', operation_record.new_content_sha256,
    'new_byte_length', operation_record.new_byte_length,
    'new_media_type', operation_record.new_media_type,
    'old_storage_paths', pg_catalog.to_jsonb(operation_record.old_storage_paths),
    'terminal_http_status', operation_record.terminal_http_status,
    'terminal_response', operation_record.terminal_response,
    'brand_kit', private.brand_kit_result(operation_record.business_id)
  )
  from private.brand_logo_operations operation_record
  where operation_record.operation_id = p_operation_id
$function$;

revoke all on function private.brand_kit_result(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.brand_logo_claim_result(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.claim_brand_logo_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_business_id uuid,
  p_expected_revision bigint,
  p_binding_sha256 text,
  p_action text,
  p_primary_colour text,
  p_secondary_colour text,
  p_footer_text text,
  p_content_sha256 text,
  p_byte_length integer,
  p_media_type text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_key text;
  v_owner_user_id uuid;
  v_brand public.brand_kits%rowtype;
  v_existing private.brand_logo_operations%rowtype;
  v_old_paths text[];
  v_bad_path_count integer;
  v_new_path text;
  v_extension text;
begin
  if p_user_id is null or p_operation_id is null
    or p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_business_id is null
    or p_expected_revision is null or p_expected_revision < 0
    or p_binding_sha256 is null or p_binding_sha256 !~ '^[0-9a-f]{64}$'
    or p_action is null or p_action not in ('keep', 'replace', 'remove')
    or p_primary_colour is null or p_primary_colour !~ '^#[0-9a-f]{6}$'
    or (p_secondary_colour is not null and p_secondary_colour !~ '^#[0-9a-f]{6}$')
    or (p_footer_text is not null and (
      char_length(p_footer_text) not between 1 and 200
      or p_footer_text is distinct from pg_catalog.btrim(p_footer_text)
    )) then
    raise exception 'BRAND_LOGO_OPERATION_INVALID';
  end if;
  if (
    p_action = 'replace' and (
      p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
      or p_byte_length is null or p_byte_length not between 1 and 5242880
      or p_media_type not in ('image/png', 'image/jpeg', 'image/webp')
    )
  ) or (
    p_action in ('keep', 'remove') and (
      p_content_sha256 is not null or p_byte_length is not null or p_media_type is not null
    )
  ) then
    raise exception 'BRAND_LOGO_OPERATION_INVALID';
  end if;

  v_user_key := private.account_deletion_user_key(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = v_user_key
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;

  select business_record.owner_user_id into v_owner_user_id
  from public.businesses business_record
  where business_record.id = p_business_id
  for update;
  if not found then raise exception 'BRAND_KIT_NOT_FOUND'; end if;
  if v_owner_user_id is distinct from p_user_id then
    raise exception 'BRAND_LOGO_FORBIDDEN';
  end if;

  select * into v_existing
  from private.brand_logo_operations operation_record
  where operation_record.operation_id = p_operation_id
  for update;
  if found then
    if v_existing.user_key is distinct from v_user_key
      or v_existing.business_id is distinct from p_business_id
      or v_existing.binding_version is distinct from 'prompted.brand-kit-operation.v1'
      or v_existing.binding_sha256 is distinct from p_binding_sha256
      or v_existing.action is distinct from p_action
      or v_existing.expected_revision is distinct from p_expected_revision
      or v_existing.primary_colour is distinct from p_primary_colour
      or v_existing.secondary_colour is distinct from p_secondary_colour
      or v_existing.footer_text is distinct from p_footer_text
      or v_existing.new_content_sha256 is distinct from p_content_sha256
      or v_existing.new_byte_length is distinct from p_byte_length
      or v_existing.new_media_type is distinct from p_media_type then
      raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
    end if;
    return private.brand_logo_claim_result(p_operation_id, 'resumed');
  end if;

  insert into public.brand_kits(business_id)
  values (p_business_id)
  on conflict (business_id) do nothing;
  select * into v_brand
  from public.brand_kits brand_record
  where brand_record.business_id = p_business_id
  for update;
  if v_brand.revision is distinct from p_expected_revision then
    raise exception 'BRAND_KIT_REVISION_CONFLICT';
  end if;
  if exists (
    select 1 from private.brand_logo_operations operation_record
    where operation_record.business_id = p_business_id
      and operation_record.state <> 'completed'
  ) then
    raise exception 'BRAND_LOGO_OPERATION_IN_PROGRESS';
  end if;

  select
    coalesce(pg_catalog.array_agg(object_record.name order by object_record.name), '{}'::text[]),
    pg_catalog.count(*) filter (
      where object_record.name !~ (
        '^brand-kits/' || p_business_id::text ||
        '/(logo[.](png|jpg|webp)|logos/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](png|jpg|webp))$'
      )
    )::integer
  into v_old_paths, v_bad_path_count
  from storage.objects object_record
  where object_record.bucket_id = 'assets'
    and object_record.name like 'brand-kits/' || p_business_id::text || '/%';
  if v_bad_path_count > 0 or pg_catalog.cardinality(v_old_paths) > 20 then
    raise exception 'BRAND_LOGO_STORAGE_INVENTORY_REQUIRED';
  end if;

  if p_action = 'replace' then
    v_extension := case p_media_type
      when 'image/png' then 'png'
      when 'image/jpeg' then 'jpg'
      when 'image/webp' then 'webp'
    end;
    v_new_path := 'brand-kits/' || p_business_id::text || '/logos/' ||
      p_operation_id::text || '.' || v_extension;
    if v_new_path = any(v_old_paths) then
      raise exception 'BRAND_LOGO_OPERATION_PATH_CONFLICT';
    end if;
  end if;

  insert into private.brand_logo_operations(
    operation_id, user_key, business_id, binding_version, binding_sha256,
    action, expected_revision, primary_colour, secondary_colour, footer_text,
    new_storage_path, new_content_sha256, new_byte_length, new_media_type,
    old_storage_paths, state
  ) values (
    p_operation_id, v_user_key, p_business_id,
    'prompted.brand-kit-operation.v1', p_binding_sha256,
    p_action, p_expected_revision, p_primary_colour, p_secondary_colour, p_footer_text,
    v_new_path, p_content_sha256, p_byte_length, p_media_type,
    v_old_paths, 'accepted'
  );
  return private.brand_logo_claim_result(p_operation_id, 'accepted');
end;
$function$;

create or replace function public.record_brand_logo_storage_verified(
  p_user_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_storage_path text,
  p_content_sha256 text,
  p_byte_length integer,
  p_media_type text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.brand_logo_operations%rowtype;
begin
  if p_user_id is null or p_operation_id is null or p_claim_token is null
    or p_storage_path is null or char_length(p_storage_path) > 800
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_byte_length is null or p_byte_length not between 1 and 5242880
    or p_media_type not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'BRAND_LOGO_STORAGE_EVIDENCE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  select * into v_operation
  from private.brand_logo_operations operation_record
  where operation_record.operation_id = p_operation_id
  for update;
  if not found
    or v_operation.user_key is distinct from private.account_deletion_user_key(p_user_id)
    or v_operation.claim_token is distinct from p_claim_token
    or v_operation.action is distinct from 'replace'
    or v_operation.new_storage_path is distinct from p_storage_path
    or v_operation.new_content_sha256 is distinct from p_content_sha256
    or v_operation.new_byte_length is distinct from p_byte_length
    or v_operation.new_media_type is distinct from p_media_type then
    raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
  end if;
  if v_operation.state in ('storage_verified', 'activated', 'completed') then
    return private.brand_logo_claim_result(p_operation_id, 'resumed');
  end if;
  if v_operation.state is distinct from 'accepted' or not exists (
    select 1 from storage.objects object_record
    where object_record.bucket_id = 'assets'
      and object_record.name = p_storage_path
  ) then
    raise exception 'BRAND_LOGO_STORAGE_NOT_VERIFIED';
  end if;
  update private.brand_logo_operations
  set state = 'storage_verified', updated_at = pg_catalog.clock_timestamp()
  where operation_id = p_operation_id;
  return private.brand_logo_claim_result(p_operation_id, 'resumed');
end;
$function$;

create or replace function public.activate_brand_logo_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_logo_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.brand_logo_operations%rowtype;
  v_brand public.brand_kits%rowtype;
  v_required_suffix text;
begin
  if p_user_id is null or p_operation_id is null or p_claim_token is null
    or p_logo_url is null or char_length(p_logo_url) > 2000
    or p_logo_url ~ '[?#]'
    or p_logo_url !~ '^https://[^/?#]+/storage/v1/object/public/assets/' then
    raise exception 'BRAND_LOGO_URL_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  select * into v_operation
  from private.brand_logo_operations operation_record
  where operation_record.operation_id = p_operation_id
  for update;
  if not found
    or v_operation.user_key is distinct from private.account_deletion_user_key(p_user_id)
    or v_operation.claim_token is distinct from p_claim_token
    or v_operation.action is distinct from 'replace' then
    raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
  end if;
  v_required_suffix := '/storage/v1/object/public/assets/' || v_operation.new_storage_path;
  if pg_catalog.right(p_logo_url, char_length(v_required_suffix)) is distinct from v_required_suffix then
    raise exception 'BRAND_LOGO_URL_INVALID';
  end if;
  if v_operation.state in ('activated', 'completed') then
    return private.brand_logo_claim_result(p_operation_id, 'resumed');
  end if;
  if v_operation.state is distinct from 'storage_verified' or not exists (
    select 1 from storage.objects object_record
    where object_record.bucket_id = 'assets'
      and object_record.name = v_operation.new_storage_path
  ) then
    raise exception 'BRAND_LOGO_STORAGE_NOT_VERIFIED';
  end if;
  select * into v_brand
  from public.brand_kits brand_record
  where brand_record.business_id = v_operation.business_id
  for update;
  if not found or v_brand.revision is distinct from v_operation.expected_revision then
    raise exception 'BRAND_KIT_REVISION_CONFLICT';
  end if;

  update public.brand_kits
  set logo_url = p_logo_url,
      primary_colour = v_operation.primary_colour,
      secondary_colour = v_operation.secondary_colour,
      footer_text = v_operation.footer_text,
      revision = revision + 1,
      logo_operation_id = v_operation.operation_id,
      logo_storage_path = v_operation.new_storage_path,
      logo_content_sha256 = v_operation.new_content_sha256,
      logo_media_type = v_operation.new_media_type,
      logo_byte_length = v_operation.new_byte_length,
      logo_status = 'reconciliation_required',
      updated_at = pg_catalog.clock_timestamp()
  where business_id = v_operation.business_id;
  update private.brand_logo_operations
  set state = 'activated', updated_at = pg_catalog.clock_timestamp()
  where operation_id = p_operation_id;
  return private.brand_logo_claim_result(p_operation_id, 'resumed');
end;
$function$;

create or replace function public.complete_brand_logo_operation(
  p_user_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_cleanup_evidence_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.brand_logo_operations%rowtype;
  v_brand public.brand_kits%rowtype;
  v_response jsonb;
  v_remaining integer;
begin
  if p_user_id is null or p_operation_id is null or p_claim_token is null
    or p_cleanup_evidence_sha256 is null
    or p_cleanup_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'BRAND_LOGO_COMPLETION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  select * into v_operation
  from private.brand_logo_operations operation_record
  where operation_record.operation_id = p_operation_id
  for update;
  if not found
    or v_operation.user_key is distinct from private.account_deletion_user_key(p_user_id)
    or v_operation.claim_token is distinct from p_claim_token then
    raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
  end if;
  if v_operation.state = 'completed' then
    if v_operation.cleanup_evidence_sha256 is distinct from p_cleanup_evidence_sha256 then
      raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
    end if;
    return v_operation.terminal_response;
  end if;
  if exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;

  select * into v_brand
  from public.brand_kits brand_record
  where brand_record.business_id = v_operation.business_id
  for update;
  if not found then raise exception 'BRAND_KIT_NOT_FOUND'; end if;

  if v_operation.action = 'replace' then
    if v_operation.state is distinct from 'activated'
      or v_brand.revision is distinct from v_operation.expected_revision + 1
      or v_brand.logo_operation_id is distinct from v_operation.operation_id
      or v_brand.logo_storage_path is distinct from v_operation.new_storage_path then
      raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
    end if;
    select pg_catalog.count(*)::integer into v_remaining
    from storage.objects object_record
    where object_record.bucket_id = 'assets'
      and object_record.name like 'brand-kits/' || v_operation.business_id::text || '/%'
      and object_record.name is distinct from v_operation.new_storage_path;
    if v_remaining > 0 or not exists (
      select 1 from storage.objects object_record
      where object_record.bucket_id = 'assets'
        and object_record.name = v_operation.new_storage_path
    ) then
      raise exception 'BRAND_LOGO_CLEANUP_INCOMPLETE';
    end if;
    update public.brand_kits
    set logo_status = 'ready', updated_at = pg_catalog.clock_timestamp()
    where business_id = v_operation.business_id;
  elsif v_operation.action = 'remove' then
    if v_operation.state is distinct from 'accepted'
      or v_brand.revision is distinct from v_operation.expected_revision then
      raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
    end if;
    select pg_catalog.count(*)::integer into v_remaining
    from storage.objects object_record
    where object_record.bucket_id = 'assets'
      and object_record.name like 'brand-kits/' || v_operation.business_id::text || '/%';
    if v_remaining > 0 then raise exception 'BRAND_LOGO_REMOVE_INCOMPLETE'; end if;
    update public.brand_kits
    set logo_url = null,
        primary_colour = v_operation.primary_colour,
        secondary_colour = v_operation.secondary_colour,
        footer_text = v_operation.footer_text,
        revision = revision + 1,
        logo_operation_id = null,
        logo_storage_path = null,
        logo_content_sha256 = null,
        logo_media_type = null,
        logo_byte_length = null,
        logo_status = 'ready',
        updated_at = pg_catalog.clock_timestamp()
    where business_id = v_operation.business_id;
  elsif v_operation.action = 'keep' then
    if v_operation.state is distinct from 'accepted'
      or v_brand.revision is distinct from v_operation.expected_revision then
      raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
    end if;
    update public.brand_kits
    set primary_colour = v_operation.primary_colour,
        secondary_colour = v_operation.secondary_colour,
        footer_text = v_operation.footer_text,
        revision = revision + 1,
        updated_at = pg_catalog.clock_timestamp()
    where business_id = v_operation.business_id;
  else
    raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'operation_id', p_operation_id,
    'brand_kit', private.brand_kit_result(v_operation.business_id)
  );
  update private.brand_logo_operations
  set state = 'completed',
      cleanup_evidence_sha256 = p_cleanup_evidence_sha256,
      terminal_http_status = 200,
      terminal_response = v_response,
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where operation_id = p_operation_id;
  return v_response;
end;
$function$;

-- Export branding is server-selected from the target business. Captured
-- exports freeze that selection in the durable export request so a later
-- brand edit cannot change the bytes produced by a reconnect or retry.
create or replace function private.resolve_export_business_id(
  p_user_id uuid,
  p_document_id uuid,
  p_artifact_id uuid
) returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select candidate.business_id
  from (
    select coalesce(outcome_record.business_id, profile_record.business_id) as business_id
    from public.documents document_record
    left join public.outcomes outcome_record
      on outcome_record.id = document_record.outcome_id
      and outcome_record.user_id = p_user_id
    left join public.profiles profile_record on profile_record.id = p_user_id
    where p_document_id is not null
      and p_artifact_id is null
      and document_record.id = p_document_id
      and document_record.user_id = p_user_id

    union all

    select coalesce(outcome_record.business_id, profile_record.business_id) as business_id
    from public.ted_artifacts artifact_record
    left join public.outcomes outcome_record
      on outcome_record.id = artifact_record.outcome_id
      and outcome_record.user_id = p_user_id
    left join public.profiles profile_record on profile_record.id = p_user_id
    where p_document_id is null
      and p_artifact_id is not null
      and artifact_record.id = p_artifact_id
      and artifact_record.user_id = p_user_id
  ) candidate
  where candidate.business_id is not null
    and (
      exists (
        select 1
        from public.businesses business_record
        where business_record.id = candidate.business_id
          and business_record.owner_user_id = p_user_id
      )
      or exists (
        select 1
        from public.memberships membership_record
        where membership_record.business_id = candidate.business_id
          and membership_record.user_id = p_user_id
      )
    )
  limit 1
$function$;

alter table private.captured_document_exports
  add column brand_snapshot_version text not null
    default 'prompted.export-brand-snapshot.legacy-unbound.v0',
  add column brand_snapshot jsonb not null
    default '{"brand_kit":null}'::jsonb,
  add column brand_snapshot_sha256 text;

alter table private.captured_document_exports
  add constraint captured_document_exports_brand_snapshot_version_check
    check (brand_snapshot_version in (
      'prompted.export-brand-snapshot.legacy-unbound.v0',
      'prompted.export-brand-snapshot.v1'
    )),
  add constraint captured_document_exports_brand_snapshot_shape_check
    check (
      pg_catalog.jsonb_typeof(brand_snapshot) = 'object'
      and brand_snapshot ? 'brand_kit'
      and brand_snapshot - 'brand_kit' = '{}'::jsonb
      and (
        brand_snapshot->'brand_kit' = 'null'::jsonb
        or pg_catalog.jsonb_typeof(brand_snapshot->'brand_kit') = 'object'
      )
    ),
  add constraint captured_document_exports_brand_snapshot_sha256_check
    check (
      (
        brand_snapshot_version = 'prompted.export-brand-snapshot.legacy-unbound.v0'
        and brand_snapshot = '{"brand_kit":null}'::jsonb
        and brand_snapshot_sha256 is null
      )
      or (
        brand_snapshot_version = 'prompted.export-brand-snapshot.v1'
        and brand_snapshot_sha256 ~ '^[0-9a-f]{64}$'
        and brand_snapshot_sha256 = pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(brand_snapshot::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      )
    );

create or replace function private.capture_captured_export_brand_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_business_id uuid;
  v_brand_kit jsonb;
begin
  v_business_id := private.resolve_export_business_id(
    new.user_id,
    new.document_id,
    null
  );
  v_brand_kit := private.brand_kit_result(v_business_id);
  if v_brand_kit->>'logo_status' = 'reconciliation_required' then
    raise exception 'BRAND_KIT_RECONCILIATION_REQUIRED';
  end if;
  new.brand_snapshot_version := 'prompted.export-brand-snapshot.v1';
  new.brand_snapshot := pg_catalog.jsonb_build_object(
    'brand_kit', v_brand_kit
  );
  new.brand_snapshot_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(new.brand_snapshot::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$function$;

create trigger capture_captured_export_brand_snapshot_before_insert
  before insert on private.captured_document_exports
  for each row execute function private.capture_captured_export_brand_snapshot();

create or replace function private.reject_captured_export_brand_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.brand_snapshot_version is distinct from old.brand_snapshot_version
    or new.brand_snapshot is distinct from old.brand_snapshot
    or new.brand_snapshot_sha256 is distinct from old.brand_snapshot_sha256 then
    raise exception 'CAPTURED_EXPORT_BRAND_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$function$;

-- PostgreSQL fires same-kind triggers alphabetically. Keep this name before
-- captured_document_export_completion_guard so a brand rewrite reports the
-- dedicated immutable-snapshot contract instead of a generic transition error.
create trigger captured_document_export_brand_snapshot_immutable
  before update of brand_snapshot_version, brand_snapshot, brand_snapshot_sha256
  on private.captured_document_exports
  for each row execute function private.reject_captured_export_brand_snapshot_mutation();

create or replace function private.require_captured_export_brand_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'requested' and new.status = 'created' then
    if pg_catalog.jsonb_typeof(new.artifact_validation_result) is distinct from 'object'
      or new.artifact_validation_result->>'brand_snapshot_version'
        is distinct from old.brand_snapshot_version
      or (
        old.brand_snapshot_sha256 is null
        and new.artifact_validation_result->'brand_snapshot_sha256'
          is distinct from 'null'::jsonb
      )
      or (
        old.brand_snapshot_sha256 is not null
        and new.artifact_validation_result->>'brand_snapshot_sha256'
          is distinct from old.brand_snapshot_sha256
      ) then
      raise exception 'CAPTURED_EXPORT_BRAND_EVIDENCE_MISMATCH';
    end if;
  end if;
  return new;
end;
$function$;

create trigger require_captured_export_brand_completion_evidence
  before update of status, artifact_validation_result
  on private.captured_document_exports
  for each row execute function private.require_captured_export_brand_completion_evidence();

create or replace function private.export_brand_snapshot_result(
  p_snapshot_version text,
  p_snapshot jsonb,
  p_snapshot_sha256 text
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'snapshot_version', p_snapshot_version,
    'snapshot_sha256', p_snapshot_sha256,
    'brand_kit', p_snapshot->'brand_kit'
  )
$function$;

create or replace function private.current_export_brand_snapshot(
  p_user_id uuid,
  p_document_id uuid,
  p_artifact_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with snapshot_record as (
    select pg_catalog.jsonb_build_object(
      'brand_kit',
      private.brand_kit_result(
        private.resolve_export_business_id(
          p_user_id,
          p_document_id,
          p_artifact_id
        )
      )
    ) as snapshot
  )
  select private.export_brand_snapshot_result(
    'prompted.export-brand-snapshot.v1',
    snapshot_record.snapshot,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(snapshot_record.snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  )
  from snapshot_record
$function$;

-- Extend the existing stable snapshot in place. Caller-supplied presentation
-- fields remain ignored; the same MVCC statement selects wording and brand.
create or replace function public.load_legacy_export_snapshot(
  p_user_id uuid,
  p_document_id uuid,
  p_artifact_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select snapshot_record.snapshot
  from (
    select pg_catalog.jsonb_build_object(
      'target_kind', 'document',
      'target', pg_catalog.jsonb_build_object(
        'id', document_record.id,
        'title', document_record.title,
        'status', document_record.status,
        'ledger_binding_status', document_record.ledger_binding_status,
        'current_revision', document_record.current_revision,
        'approved_revision', document_record.approved_revision,
        'unresolved_placeholders', document_record.unresolved_placeholders
      ),
      'sections', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', section_record.name,
            'content', section_record.content,
            'status', section_record.status,
            'is_required', section_record.is_required,
            'order_index', section_record.order_index
          ) order by section_record.order_index, section_record.id
        )
        from public.sections section_record
        where section_record.document_id = document_record.id
          and section_record.user_id = p_user_id
      ), '[]'::jsonb),
      'brand_snapshot', private.current_export_brand_snapshot(
        p_user_id,
        document_record.id,
        null
      )
    ) as snapshot
    from public.documents document_record
    where p_user_id is not null
      and p_document_id is not null
      and p_artifact_id is null
      and document_record.id = p_document_id
      and document_record.user_id = p_user_id

    union all

    select pg_catalog.jsonb_build_object(
      'target_kind', 'artifact',
      'target', pg_catalog.jsonb_build_object(
        'id', artifact_record.id,
        'title', artifact_record.title,
        'status', artifact_record.status,
        'quality_status', artifact_record.quality_status,
        'current_revision', artifact_record.current_revision,
        'approved_revision', artifact_record.approved_revision
      ),
      'blocks', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'heading', block_record.heading,
            'payload', block_record.payload,
            'approval_status', block_record.approval_status,
            'approved_revision', block_record.approved_revision,
            'revision', block_record.revision,
            'is_required', block_record.is_required,
            'section_state', block_record.section_state,
            'order_index', block_record.order_index,
            'kind', block_record.kind
          ) order by block_record.order_index, block_record.id
        )
        from public.ted_artifact_blocks block_record
        where block_record.artifact_id = artifact_record.id
          and block_record.user_id = p_user_id
      ), '[]'::jsonb),
      'brand_snapshot', private.current_export_brand_snapshot(
        p_user_id,
        null,
        artifact_record.id
      )
    ) as snapshot
    from public.ted_artifacts artifact_record
    where p_user_id is not null
      and p_document_id is null
      and p_artifact_id is not null
      and artifact_record.id = p_artifact_id
      and artifact_record.user_id = p_user_id
  ) snapshot_record
  limit 1
$function$;

-- Preserve the existing replay-state machine while extending every receipt
-- state with the immutable brand snapshot captured by the export request.
create or replace function public.get_captured_document_export_receipt(
  p_user_id uuid,
  p_export_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_export private.captured_document_exports%rowtype;
  v_storage private.user_storage_dispatches%rowtype;
  v_egress private.user_external_egress_dispatches%rowtype;
  v_user_key text;
  v_resource_sha256 text;
  v_brand_snapshot jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null or p_export_id is null or p_operation_id is null then
    raise exception 'CAPTURED_EXPORT_RECEIPT_INVALID';
  end if;
  v_user_key := private.account_deletion_user_key(p_user_id);
  select * into v_export
  from private.captured_document_exports export_record
  where export_record.id = p_export_id
    and export_record.operation_id = p_operation_id
    and export_record.user_id = p_user_id;
  if not found then raise exception 'CAPTURED_EXPORT_RECEIPT_NOT_FOUND'; end if;

  v_brand_snapshot := private.export_brand_snapshot_result(
    v_export.brand_snapshot_version,
    v_export.brand_snapshot,
    v_export.brand_snapshot_sha256
  );

  if v_export.status = 'created' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'status', v_export.status,
      'storage_path', v_export.storage_path,
      'artifact_sha256', v_export.artifact_sha256,
      'renderer_version', v_export.renderer_version,
      'artifact_validation_result', v_export.artifact_validation_result,
      'brand_snapshot', v_brand_snapshot
    );
  end if;
  if v_export.status is distinct from 'requested' or exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = v_user_key
  ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'reconciliation_required',
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'brand_snapshot', v_brand_snapshot
    );
  end if;

  select * into v_storage
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.operation_id = p_export_id
    and dispatch_record.dispatch_kind = 'captured-export';
  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', case
        when v_storage.state = 'dispatched'
          and v_storage.lease_expires_at > v_now then 'processing'
        else 'reconciliation_required'
      end,
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'retry_after_seconds', 2,
      'brand_snapshot', v_brand_snapshot
    );
  end if;

  v_resource_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'captured-render:' || p_operation_id::text || ':' || p_export_id::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  select * into v_egress
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.egress_kind = 'render-service'
    and dispatch_record.egress_route = 'pdf'
    and dispatch_record.resource_sha256 = v_resource_sha256;
  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', case
        when v_egress.state = 'dispatched'
          and v_egress.lease_expires_at > v_now then 'processing'
        else 'reconciliation_required'
      end,
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'retry_after_seconds', 2,
      'brand_snapshot', v_brand_snapshot
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'requested',
    'export_id', v_export.id,
    'operation_id', v_export.operation_id,
    'brand_snapshot', v_brand_snapshot
  );
end;
$function$;

revoke all on function private.resolve_export_business_id(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.capture_captured_export_brand_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_captured_export_brand_snapshot_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.require_captured_export_brand_completion_evidence()
  from public, anon, authenticated, service_role;
revoke all on function private.export_brand_snapshot_result(text,jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function private.current_export_brand_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.load_legacy_export_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.load_legacy_export_snapshot(uuid,uuid,uuid)
  to service_role;
revoke all on function public.get_captured_document_export_receipt(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_captured_document_export_receipt(uuid,uuid,uuid)
  to service_role;

revoke all on function public.claim_brand_logo_operation(
  uuid,uuid,uuid,bigint,text,text,text,text,text,text,integer,text
) from public, anon, authenticated;
revoke all on function public.record_brand_logo_storage_verified(
  uuid,uuid,uuid,text,text,integer,text
) from public, anon, authenticated;
revoke all on function public.activate_brand_logo_operation(uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.complete_brand_logo_operation(uuid,uuid,uuid,text)
  from public, anon, authenticated;

grant execute on function public.claim_brand_logo_operation(
  uuid,uuid,uuid,bigint,text,text,text,text,text,text,integer,text
) to service_role;
grant execute on function public.record_brand_logo_storage_verified(
  uuid,uuid,uuid,text,text,integer,text
) to service_role;
grant execute on function public.activate_brand_logo_operation(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.complete_brand_logo_operation(uuid,uuid,uuid,text)
  to service_role;

-- Re-assert the common dispatch grants after replacing their bodies.
revoke all on function public.claim_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.complete_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.reconcile_user_storage_dispatch(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  to service_role;
grant execute on function public.complete_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  to service_role;
grant execute on function public.reconcile_user_storage_dispatch(uuid,uuid,text,text,text,text)
  to service_role;

commit;
