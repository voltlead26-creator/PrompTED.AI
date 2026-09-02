-- Bind captured PDF bytes to their immutable document and brand evidence before
-- acknowledging Storage, and preserve logo objects referenced by durable export
-- requests. This migration is additive and leaves historical v0 exports readable.

begin;

create table private.captured_export_storage_recoveries (
  export_id uuid primary key
    references private.captured_document_exports(id) on delete cascade,
  operation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_operation_revision integer not null
    check (expected_operation_revision > 0),
  document_id uuid not null,
  document_revision integer not null check (document_revision > 0),
  format text not null check (format = 'pdf'),
  storage_bucket text not null check (storage_bucket = 'captured-exports'),
  storage_path text not null unique check (
    char_length(storage_path) between 1 and 1024
    and storage_path not like '/%'
    and storage_path not like '%\%'
    and position('://' in storage_path) = 0
    and storage_path !~ '(^|/)\.{1,2}(/|$)'
  ),
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_byte_length integer not null
    check (artifact_byte_length between 100 and 26214400),
  renderer_version text not null check (renderer_version = 'render-export.pdf.4'),
  artifact_validation_result jsonb not null check (
    pg_catalog.jsonb_typeof(artifact_validation_result) = 'object'
    and octet_length(artifact_validation_result::text) <= 131072
  ),
  artifact_validation_sha256 text not null
    check (artifact_validation_sha256 ~ '^[0-9a-f]{64}$'),
  brand_snapshot_version text not null check (brand_snapshot_version in (
    'prompted.export-brand-snapshot.legacy-unbound.v0',
    'prompted.export-brand-snapshot.v1'
  )),
  brand_snapshot jsonb not null
    check (pg_catalog.jsonb_typeof(brand_snapshot) = 'object'),
  brand_snapshot_sha256 text check (brand_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  brand_evidence_sha256 text check (brand_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  storage_dispatch_id uuid not null
    references private.user_storage_dispatches(id) on delete cascade,
  storage_dispatch_token uuid not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade,
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade,
  check (
    (
      brand_snapshot_version = 'prompted.export-brand-snapshot.legacy-unbound.v0'
      and brand_snapshot = '{"brand_kit":null}'::jsonb
      and brand_snapshot_sha256 is null
      and brand_evidence_sha256 is null
    )
    or (
      brand_snapshot_version = 'prompted.export-brand-snapshot.v1'
      and brand_snapshot_sha256 is not null
      and brand_evidence_sha256 is not null
    )
  )
);

alter table private.captured_export_storage_recoveries enable row level security;
alter table private.captured_export_storage_recoveries force row level security;
revoke all on table private.captured_export_storage_recoveries
  from public, anon, authenticated, service_role;

create or replace function private.reject_captured_export_storage_recovery_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'CAPTURED_EXPORT_STORAGE_RECOVERY_IMMUTABLE';
end;
$function$;

revoke all on function private.reject_captured_export_storage_recovery_update()
  from public, anon, authenticated, service_role;

create trigger captured_export_storage_recovery_immutable
before update on private.captured_export_storage_recoveries
for each row execute function private.reject_captured_export_storage_recovery_update();

create index captured_document_exports_brand_logo_path_idx
  on private.captured_document_exports (
    (brand_snapshot #>> '{brand_kit,logo_storage_path}')
  )
  where brand_snapshot #>> '{brand_kit,logo_storage_path}' is not null;

create or replace function private.captured_export_artifact_evidence_matches(
  p_brand_snapshot_version text,
  p_brand_snapshot jsonb,
  p_brand_snapshot_sha256 text,
  p_format text,
  p_artifact_sha256 text,
  p_artifact_byte_length integer,
  p_renderer_version text,
  p_artifact_validation_result jsonb,
  p_require_pdf_inspection boolean
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_brand jsonb := p_brand_snapshot->'brand_kit';
  v_brand_present boolean := v_brand is distinct from 'null'::jsonb;
  v_logo_path text;
  v_logo_sha256 text;
  v_logo_media_type text;
  v_logo_byte_length integer;
  v_footer_sha256 text;
  v_primary_colour text;
  v_secondary_colour text;
  v_brand_evidence_sha256 text;
  v_expected_brand jsonb;
  v_common_checks jsonb := pg_catalog.jsonb_build_object(
    'transport_envelope', true,
    'inspection_version', true,
    'renderer_status', true,
    'renderer_structural', true,
    'content_matches', true,
    'section_order_matches', true,
    'artifact_hash_matches', true
  );
begin
  if pg_catalog.jsonb_typeof(p_artifact_validation_result) is distinct from 'object'
    or p_artifact_validation_result->'passed' is distinct from 'true'::jsonb
    or p_artifact_validation_result->'artifact_inspected' is distinct from 'true'::jsonb
    or p_artifact_validation_result->>'brand_snapshot_version'
      is distinct from p_brand_snapshot_version then
    return false;
  end if;

  if p_brand_snapshot_version = 'prompted.export-brand-snapshot.legacy-unbound.v0' then
    if p_brand_snapshot is distinct from '{"brand_kit":null}'::jsonb
      or p_brand_snapshot_sha256 is not null
      or p_artifact_validation_result->'brand_snapshot_sha256'
        is distinct from 'null'::jsonb then
      return false;
    end if;
    if not p_require_pdf_inspection then return true; end if;
    return p_format = 'pdf'
      and p_renderer_version = 'render-export.pdf.4'
      and p_artifact_validation_result->>'inspection_contract'
        = 'prompted.rendered-pdf.v1'
      and p_artifact_validation_result->>'content_type' = 'application/pdf'
      and p_artifact_validation_result->>'artifact_sha256' = p_artifact_sha256
      and (p_artifact_validation_result->>'byte_length')::integer
        = p_artifact_byte_length
      and p_artifact_validation_result->'checks' @> v_common_checks;
  end if;

  if p_brand_snapshot_version <> 'prompted.export-brand-snapshot.v1'
    or p_brand_snapshot_sha256 is null
    or p_brand_snapshot_sha256 <> pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(p_brand_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
    or p_artifact_validation_result->>'brand_snapshot_sha256'
      is distinct from p_brand_snapshot_sha256 then
    return false;
  end if;

  if not p_require_pdf_inspection then return true; end if;
  if not v_brand_present then v_brand := '{}'::jsonb; end if;
  v_logo_path := v_brand->>'logo_storage_path';
  v_logo_sha256 := v_brand->>'logo_content_sha256';
  v_logo_media_type := v_brand->>'logo_media_type';
  v_logo_byte_length := case when v_brand ? 'logo_byte_length'
    and v_brand->'logo_byte_length' <> 'null'::jsonb
    then (v_brand->>'logo_byte_length')::integer else null end;
  v_footer_sha256 := case when nullif(v_brand->>'footer_text', '') is null
    then null
    else pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_brand->>'footer_text', 'UTF8'),
        'sha256'
      ),
      'hex'
    ) end;
  v_primary_colour := pg_catalog.lower(v_brand->>'primary_colour');
  v_secondary_colour := pg_catalog.lower(v_brand->>'secondary_colour');
  v_brand_evidence_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'prompted.export-brand-evidence.v1' || '|' ||
        p_brand_snapshot_version || '|' || p_brand_snapshot_sha256 || '|' ||
        case when v_brand_present then '1' else '0' end || '|' ||
        coalesce(v_logo_path, '~') || '|' ||
        coalesce(v_logo_sha256, '~') || '|' ||
        coalesce(v_logo_media_type, '~') || '|' ||
        coalesce(v_logo_byte_length::text, '~') || '|' ||
        coalesce(v_footer_sha256, '~') || '|' ||
        coalesce(v_primary_colour, '~') || '|' ||
        coalesce(v_secondary_colour, '~'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_expected_brand := pg_catalog.jsonb_build_object(
    'brand_snapshot_version', p_brand_snapshot_version,
    'brand_snapshot_sha256', p_brand_snapshot_sha256,
    'brand_present', v_brand_present,
    'brand_logo_storage_path', v_logo_path,
    'brand_logo_sha256', v_logo_sha256,
    'brand_logo_media_type', v_logo_media_type,
    'brand_logo_byte_length', v_logo_byte_length,
    'brand_footer_sha256', v_footer_sha256,
    'brand_primary_colour', v_primary_colour,
    'brand_secondary_colour', v_secondary_colour,
    'brand_evidence_sha256', v_brand_evidence_sha256
  );
  return p_format = 'pdf'
    and p_renderer_version = 'render-export.pdf.4'
    and p_artifact_validation_result->>'inspection_contract'
      = 'prompted.rendered-pdf.v2'
    and p_artifact_validation_result->>'content_type' = 'application/pdf'
    and p_artifact_validation_result->>'artifact_sha256' = p_artifact_sha256
    and (p_artifact_validation_result->>'byte_length')::integer
      = p_artifact_byte_length
    and p_artifact_validation_result @> v_expected_brand
    and p_artifact_validation_result->'checks' @> (
      v_common_checks || pg_catalog.jsonb_build_object(
        'brand_snapshot_matches', true,
        'brand_logo_matches', true,
        'brand_footer_matches', true,
        'brand_colours_match', true
      )
    );
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$function$;

revoke all on function private.captured_export_artifact_evidence_matches(
  text,jsonb,text,text,text,integer,text,jsonb,boolean
) from public, anon, authenticated, service_role;

create or replace function public.record_captured_export_storage_recovery(
  p_user_id uuid,
  p_export_id uuid,
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_storage_path text,
  p_artifact_sha256 text,
  p_artifact_byte_length integer,
  p_renderer_version text,
  p_artifact_validation_result jsonb,
  p_storage_dispatch_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_storage_path text := pg_catalog.btrim(p_storage_path);
  v_artifact_sha256 text := pg_catalog.lower(pg_catalog.btrim(p_artifact_sha256));
  v_export private.captured_document_exports%rowtype;
  v_operation private.captured_document_operations%rowtype;
  v_dispatch private.user_storage_dispatches%rowtype;
  v_existing private.captured_export_storage_recoveries%rowtype;
  v_storage_path_sha256 text;
  v_validation_sha256 text;
  v_brand_evidence_sha256 text;
begin
  if p_user_id is null or p_export_id is null or p_operation_id is null
    or p_expected_operation_revision is null or p_expected_operation_revision < 1
    or v_storage_path is null or char_length(v_storage_path) not between 1 and 1024
    or v_storage_path like '/%' or v_storage_path like '%\%'
    or position('://' in v_storage_path) > 0
    or v_storage_path ~ '(^|/)\.{1,2}(/|$)'
    or v_artifact_sha256 is null or v_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_byte_length is null
      or p_artifact_byte_length not between 100 and 26214400
    or p_renderer_version is distinct from 'render-export.pdf.4'
    or p_storage_dispatch_token is null
    or pg_catalog.jsonb_typeof(p_artifact_validation_result) is distinct from 'object'
    or octet_length(p_artifact_validation_result::text) > 131072 then
    raise exception 'CAPTURED_EXPORT_STORAGE_RECOVERY_INVALID';
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

  select * into v_export
  from private.captured_document_exports export_record
  where export_record.id = p_export_id
    and export_record.operation_id = p_operation_id
    and export_record.user_id = p_user_id
  for update;
  if not found then raise exception 'CAPTURED_EXPORT_RECEIPT_NOT_FOUND'; end if;
  if v_export.status is distinct from 'requested' or v_export.format is distinct from 'pdf'
    or v_storage_path not like p_user_id::text || '/' || p_export_id::text || '/%'
    or position('/' in substring(
      v_storage_path from char_length(p_user_id::text || '/' || p_export_id::text || '/') + 1
    )) > 0 then
    raise exception 'CAPTURED_EXPORT_STORAGE_RECOVERY_CONFLICT';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id
  for update;
  if not found or v_operation.operation_revision <> p_expected_operation_revision
    or v_operation.status <> 'ready_for_review'
    or v_operation.document_id <> v_export.document_id
    or v_operation.latest_document_revision <> v_export.document_revision then
    raise exception 'CAPTURED_EXPORT_REQUEST_NO_LONGER_CURRENT';
  end if;

  if not private.captured_export_artifact_evidence_matches(
    v_export.brand_snapshot_version,
    v_export.brand_snapshot,
    v_export.brand_snapshot_sha256,
    v_export.format,
    v_artifact_sha256,
    p_artifact_byte_length,
    p_renderer_version,
    p_artifact_validation_result,
    true
  ) then
    raise exception 'CAPTURED_EXPORT_ARTIFACT_EVIDENCE_MISMATCH';
  end if;

  v_storage_path_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_storage_path, 'UTF8'), 'sha256'),
    'hex'
  );
  select * into v_dispatch
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
    and dispatch_record.operation_id = p_export_id
    and dispatch_record.dispatch_kind = 'captured-export'
  for update;
  if not found
    or v_dispatch.storage_path_sha256 <> v_storage_path_sha256
    or v_dispatch.artifact_sha256 <> v_artifact_sha256
    or v_dispatch.dispatch_token <> p_storage_dispatch_token
    or v_dispatch.state not in ('dispatched', 'completed')
    or not exists (
      select 1 from storage.objects object_record
      where object_record.bucket_id = 'captured-exports'
        and object_record.name = v_storage_path
    ) then
    raise exception 'CAPTURED_EXPORT_STORAGE_RECOVERY_CONFLICT';
  end if;

  v_validation_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_artifact_validation_result::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_brand_evidence_sha256 := case
    when v_export.brand_snapshot_version = 'prompted.export-brand-snapshot.v1'
      then p_artifact_validation_result->>'brand_evidence_sha256'
    else null
  end;

  select * into v_existing
  from private.captured_export_storage_recoveries recovery_record
  where recovery_record.export_id = p_export_id
  for update;
  if found then
    if v_existing.operation_id <> p_operation_id
      or v_existing.user_id <> p_user_id
      or v_existing.expected_operation_revision <> p_expected_operation_revision
      or v_existing.document_id <> v_export.document_id
      or v_existing.document_revision <> v_export.document_revision
      or v_existing.storage_path <> v_storage_path
      or v_existing.storage_path_sha256 <> v_storage_path_sha256
      or v_existing.artifact_sha256 <> v_artifact_sha256
      or v_existing.artifact_byte_length <> p_artifact_byte_length
      or v_existing.renderer_version <> p_renderer_version
      or v_existing.artifact_validation_result <> p_artifact_validation_result
      or v_existing.artifact_validation_sha256 <> v_validation_sha256
      or v_existing.brand_snapshot_version <> v_export.brand_snapshot_version
      or v_existing.brand_snapshot <> v_export.brand_snapshot
      or v_existing.brand_snapshot_sha256 is distinct from v_export.brand_snapshot_sha256
      or v_existing.brand_evidence_sha256 is distinct from v_brand_evidence_sha256
      or v_existing.storage_dispatch_id <> v_dispatch.id
      or v_existing.storage_dispatch_token <> v_dispatch.dispatch_token then
      raise exception 'CAPTURED_EXPORT_STORAGE_RECOVERY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'idempotent_replay',
      'export_id', v_existing.export_id,
      'operation_id', v_existing.operation_id,
      'artifact_sha256', v_existing.artifact_sha256
    );
  end if;

  insert into private.captured_export_storage_recoveries(
    export_id, operation_id, user_id, expected_operation_revision,
    document_id, document_revision, format, storage_bucket, storage_path,
    storage_path_sha256, artifact_sha256, artifact_byte_length,
    renderer_version, artifact_validation_result, artifact_validation_sha256,
    brand_snapshot_version, brand_snapshot, brand_snapshot_sha256,
    brand_evidence_sha256, storage_dispatch_id, storage_dispatch_token
  ) values (
    v_export.id, v_export.operation_id, v_export.user_id,
    p_expected_operation_revision, v_export.document_id,
    v_export.document_revision, v_export.format, 'captured-exports',
    v_storage_path, v_storage_path_sha256, v_artifact_sha256,
    p_artifact_byte_length, p_renderer_version, p_artifact_validation_result,
    v_validation_sha256, v_export.brand_snapshot_version,
    v_export.brand_snapshot, v_export.brand_snapshot_sha256,
    v_brand_evidence_sha256, v_dispatch.id, v_dispatch.dispatch_token
  );
  return pg_catalog.jsonb_build_object(
    'outcome', 'recorded',
    'export_id', v_export.id,
    'operation_id', v_export.operation_id,
    'artifact_sha256', v_artifact_sha256
  );
end;
$function$;

revoke all on function public.record_captured_export_storage_recovery(
  uuid,uuid,uuid,integer,text,text,integer,text,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.record_captured_export_storage_recovery(
  uuid,uuid,uuid,integer,text,text,integer,text,jsonb,uuid
) to service_role;

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
  if v_business_id is not null then
    -- Brand mutations take an UPDATE lock on this same row first. The SHARE
    -- lock makes operation admission and export snapshot capture serializable.
    perform 1
    from public.businesses business_record
    where business_record.id = v_business_id
    for share;
    if not found then raise exception 'BRAND_KIT_NOT_FOUND'; end if;
    if exists (
      select 1 from private.brand_logo_operations operation_record
      where operation_record.business_id = v_business_id
        and operation_record.state not in ('completed', 'failed', 'cancelled')
    ) then
      raise exception 'BRAND_LOGO_OPERATION_IN_PROGRESS';
    end if;
    perform 1
    from public.brand_kits brand_record
    where brand_record.business_id = v_business_id
    for share;
    v_brand_kit := private.brand_kit_result(v_business_id);
    if v_brand_kit->>'logo_status' = 'reconciliation_required' then
      raise exception 'BRAND_KIT_RECONCILIATION_REQUIRED';
    end if;
    if v_brand_kit->>'logo_status' = 'legacy_unverified' then
      raise exception 'BRAND_KIT_LEGACY_LOGO_UNVERIFIED';
    end if;
  else
    v_brand_kit := null;
  end if;
  new.brand_snapshot_version := 'prompted.export-brand-snapshot.v1';
  new.brand_snapshot := pg_catalog.jsonb_build_object('brand_kit', v_brand_kit);
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

create or replace function private.require_captured_export_brand_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_artifact_byte_length integer;
begin
  if old.status = 'requested' and new.status = 'created' then
    begin
      v_artifact_byte_length := (new.artifact_validation_result->>'byte_length')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_artifact_byte_length := null;
    end;
    if not private.captured_export_artifact_evidence_matches(
      old.brand_snapshot_version,
      old.brand_snapshot,
      old.brand_snapshot_sha256,
      old.format,
      new.artifact_sha256,
      v_artifact_byte_length,
      new.renderer_version,
      new.artifact_validation_result,
      old.format = 'pdf'
        and old.brand_snapshot_version = 'prompted.export-brand-snapshot.v1'
    ) then
      raise exception 'CAPTURED_EXPORT_BRAND_EVIDENCE_MISMATCH';
    end if;
    if old.format = 'pdf'
      and old.brand_snapshot_version = 'prompted.export-brand-snapshot.v1'
      and not exists (
        select 1
        from private.captured_export_storage_recoveries recovery_record
        where recovery_record.export_id = old.id
          and recovery_record.operation_id = old.operation_id
          and recovery_record.user_id = old.user_id
          and recovery_record.document_id = old.document_id
          and recovery_record.document_revision = old.document_revision
          and recovery_record.storage_path = new.storage_path
          and recovery_record.artifact_sha256 = new.artifact_sha256
          and recovery_record.artifact_byte_length = v_artifact_byte_length
          and recovery_record.renderer_version = new.renderer_version
          and recovery_record.artifact_validation_result = new.artifact_validation_result
          and recovery_record.brand_snapshot_version = old.brand_snapshot_version
          and recovery_record.brand_snapshot = old.brand_snapshot
          and recovery_record.brand_snapshot_sha256 = old.brand_snapshot_sha256
      ) then
      raise exception 'CAPTURED_EXPORT_STORAGE_RECOVERY_REQUIRED';
    end if;
  end if;
  return new;
end;
$function$;

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
  v_operation private.captured_document_operations%rowtype;
  v_recovery private.captured_export_storage_recoveries%rowtype;
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

  select * into v_recovery
  from private.captured_export_storage_recoveries recovery_record
  where recovery_record.export_id = v_export.id;
  select * into v_storage
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.operation_id = p_export_id
    and dispatch_record.dispatch_kind = 'captured-export';
  if v_recovery.export_id is not null then
    select * into v_operation
    from private.captured_document_operations operation_record
    where operation_record.id = v_export.operation_id
      and operation_record.user_id = v_export.user_id;
    if v_operation.id is null
      or v_operation.operation_revision <> v_recovery.expected_operation_revision
      or v_operation.status <> 'ready_for_review'
      or v_operation.document_id <> v_export.document_id
      or v_operation.latest_document_revision <> v_export.document_revision
      or v_storage.id is null
      or v_storage.id <> v_recovery.storage_dispatch_id
      or v_storage.dispatch_token <> v_recovery.storage_dispatch_token
      or v_storage.storage_path_sha256 <> v_recovery.storage_path_sha256
      or v_storage.artifact_sha256 <> v_recovery.artifact_sha256
      or not private.captured_export_artifact_evidence_matches(
        v_recovery.brand_snapshot_version,
        v_recovery.brand_snapshot,
        v_recovery.brand_snapshot_sha256,
        v_recovery.format,
        v_recovery.artifact_sha256,
        v_recovery.artifact_byte_length,
        v_recovery.renderer_version,
        v_recovery.artifact_validation_result,
        true
      ) then
      return pg_catalog.jsonb_build_object(
        'outcome', 'reconciliation_required',
        'export_id', v_export.id,
        'operation_id', v_export.operation_id,
        'brand_snapshot', v_brand_snapshot
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'storage_recovery',
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'expected_operation_revision', v_recovery.expected_operation_revision,
      'storage_path', v_recovery.storage_path,
      'artifact_sha256', v_recovery.artifact_sha256,
      'artifact_byte_length', v_recovery.artifact_byte_length,
      'renderer_version', v_recovery.renderer_version,
      'artifact_validation_result', v_recovery.artifact_validation_result,
      'storage_state', v_storage.state,
      'storage_dispatch_token', case when v_storage.state = 'dispatched'
        then v_storage.dispatch_token else null end,
      'brand_snapshot', v_brand_snapshot
    );
  end if;
  if v_storage.id is not null then
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

-- A retained object with the wrong bytes is a durable operation state, not an
-- exception that can strand the one-active-operation slot forever.
drop index private.brand_logo_one_active_operation;
alter table private.brand_logo_operations
  drop constraint brand_logo_operations_state_check,
  drop constraint brand_logo_operations_check1,
  add column reconciliation_code text,
  add column observed_content_sha256 text,
  add column observed_byte_length integer,
  add column reconciliation_evidence_sha256 text,
  add constraint brand_logo_operations_state_check check (state in (
    'accepted', 'storage_verified', 'activated', 'reconciliation_required',
    'completed', 'failed', 'cancelled'
  )),
  add constraint brand_logo_operations_reconciliation_code_check check (
    reconciliation_code is null or reconciliation_code = 'storage_bytes_mismatch'
  ),
  add constraint brand_logo_operations_observed_sha256_check check (
    observed_content_sha256 is null
    or observed_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint brand_logo_operations_observed_byte_length_check check (
    observed_byte_length is null
    or observed_byte_length between 1 and 5242880
  ),
  add constraint brand_logo_operations_reconciliation_evidence_check check (
    reconciliation_evidence_sha256 is null
    or reconciliation_evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint brand_logo_operations_terminal_state_check check (
    (
      state = 'completed'
      and terminal_http_status = 200
      and terminal_response is not null
      and completed_at is not null
      and cleanup_evidence_sha256 is not null
      and reconciliation_code is null
      and observed_content_sha256 is null
      and observed_byte_length is null
      and reconciliation_evidence_sha256 is null
    )
    or (
      state in ('failed', 'cancelled')
      and terminal_http_status between 400 and 599
      and terminal_response is not null
      and completed_at is not null
      and cleanup_evidence_sha256 is not null
      and reconciliation_code is not null
      and reconciliation_evidence_sha256 is not null
      and (
        (observed_content_sha256 is null and observed_byte_length is null)
        or (observed_content_sha256 is not null and observed_byte_length is not null)
      )
    )
    or (
      state = 'reconciliation_required'
      and terminal_http_status is null
      and terminal_response is null
      and completed_at is null
      and cleanup_evidence_sha256 is null
      and reconciliation_code is not null
      and reconciliation_evidence_sha256 is not null
      and (
        (observed_content_sha256 is null and observed_byte_length is null)
        or (observed_content_sha256 is not null and observed_byte_length is not null)
      )
    )
    or (
      state in ('accepted', 'storage_verified', 'activated')
      and terminal_http_status is null
      and terminal_response is null
      and completed_at is null
      and cleanup_evidence_sha256 is null
      and reconciliation_code is null
      and observed_content_sha256 is null
      and observed_byte_length is null
      and reconciliation_evidence_sha256 is null
    )
  );

create unique index brand_logo_one_active_operation
  on private.brand_logo_operations(business_id)
  where state not in ('completed', 'failed', 'cancelled');

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
  if old.state in ('completed', 'failed', 'cancelled') and new is distinct from old then
    raise exception 'BRAND_LOGO_OPERATION_IMMUTABLE';
  end if;
  if old.state = 'reconciliation_required' and (
    old.reconciliation_code is distinct from new.reconciliation_code
    or old.observed_content_sha256 is distinct from new.observed_content_sha256
    or old.observed_byte_length is distinct from new.observed_byte_length
    or old.reconciliation_evidence_sha256
      is distinct from new.reconciliation_evidence_sha256
  ) then
    raise exception 'BRAND_LOGO_RECONCILIATION_EVIDENCE_IMMUTABLE';
  end if;
  if old.state is distinct from new.state and not (
    (old.state = 'accepted' and new.state in (
      'storage_verified', 'completed', 'reconciliation_required'
    ))
    or (old.state = 'storage_verified' and new.state in (
      'activated', 'reconciliation_required'
    ))
    or (old.state = 'activated' and new.state in (
      'completed', 'reconciliation_required'
    ))
    or (old.state = 'reconciliation_required' and new.state in ('failed', 'cancelled'))
  ) then
    raise exception 'BRAND_LOGO_STATE_TRANSITION_INVALID';
  end if;
  return new;
end;
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
    'outcome', case
      when operation_record.state in ('completed', 'failed', 'cancelled')
        then operation_record.state
      else p_outcome
    end,
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
    'reconciliation_code', operation_record.reconciliation_code,
    'observed_content_sha256', operation_record.observed_content_sha256,
    'observed_byte_length', operation_record.observed_byte_length,
    'reconciliation_evidence_sha256', operation_record.reconciliation_evidence_sha256,
    'terminal_http_status', operation_record.terminal_http_status,
    'terminal_response', operation_record.terminal_response,
    'brand_kit', private.brand_kit_result(operation_record.business_id)
  )
  from private.brand_logo_operations operation_record
  where operation_record.operation_id = p_operation_id
$function$;

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
      p_content_sha256 is not null or p_byte_length is not null
      or p_media_type is not null
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

  -- Export snapshot capture takes a SHARE lock on the same row. Brand operation
  -- admission therefore cannot race a snapshot of the previous/new logo.
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
  if v_brand.logo_status = 'reconciliation_required' or exists (
    select 1 from private.brand_logo_operations operation_record
    where operation_record.business_id = p_business_id
      and operation_record.state not in ('completed', 'failed', 'cancelled')
  ) then
    raise exception 'BRAND_LOGO_OPERATION_IN_PROGRESS';
  end if;

  select
    coalesce(
      pg_catalog.array_agg(object_record.name order by object_record.name)
        filter (where not exists (
          select 1
          from private.captured_document_exports export_record
          where export_record.status in ('requested', 'created')
            and export_record.brand_snapshot #>> '{brand_kit,logo_storage_path}'
              = object_record.name
        )),
      '{}'::text[]
    ),
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
    p_action, p_expected_revision, p_primary_colour, p_secondary_colour,
    p_footer_text, v_new_path, p_content_sha256, p_byte_length, p_media_type,
    v_old_paths, 'accepted'
  );
  return private.brand_logo_claim_result(p_operation_id, 'accepted');
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
  if v_operation.state in ('completed', 'failed', 'cancelled') then
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
    from pg_catalog.unnest(v_operation.old_storage_paths) old_path(path)
    where exists (
      select 1 from storage.objects object_record
      where object_record.bucket_id = 'assets'
        and object_record.name = old_path.path
    );
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
    from pg_catalog.unnest(v_operation.old_storage_paths) old_path(path)
    where exists (
      select 1 from storage.objects object_record
      where object_record.bucket_id = 'assets'
        and object_record.name = old_path.path
    );
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

create or replace function public.mark_brand_logo_reconciliation(
  p_user_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_observed_content_sha256 text,
  p_observed_byte_length integer,
  p_reconciliation_evidence_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.brand_logo_operations%rowtype;
  v_publish private.user_storage_dispatches%rowtype;
  v_publish_path_sha256 text;
  v_expected_evidence text;
begin
  if p_user_id is null or p_operation_id is null or p_claim_token is null
    or (
      (p_observed_content_sha256 is null and p_observed_byte_length is not null)
      or (p_observed_content_sha256 is not null and p_observed_byte_length is null)
    )
    or (p_observed_content_sha256 is not null and (
      p_observed_content_sha256 !~ '^[0-9a-f]{64}$'
      or p_observed_byte_length not between 1 and 5242880
    ))
    or p_reconciliation_evidence_sha256 is null
    or p_reconciliation_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'BRAND_LOGO_RECONCILIATION_INVALID';
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
    or v_operation.claim_token is distinct from p_claim_token
    or v_operation.action is distinct from 'replace' then
    raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
  end if;
  v_expected_evidence := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'prompted.brand-logo-reconciliation.v1' || '|' ||
        v_operation.business_id::text || '|' || v_operation.operation_id::text || '|' ||
        v_operation.new_content_sha256 || '|' || v_operation.new_byte_length::text || '|' ||
        coalesce(p_observed_content_sha256, '~') || '|' ||
        coalesce(p_observed_byte_length::text, '~'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if v_expected_evidence <> p_reconciliation_evidence_sha256 then
    raise exception 'BRAND_LOGO_RECONCILIATION_EVIDENCE_MISMATCH';
  end if;
  if v_operation.state in ('failed', 'cancelled') then
    return private.brand_logo_claim_result(p_operation_id, 'resumed');
  end if;
  if v_operation.state = 'reconciliation_required' then
    if v_operation.observed_content_sha256 is distinct from p_observed_content_sha256
      or v_operation.observed_byte_length is distinct from p_observed_byte_length
      or v_operation.reconciliation_evidence_sha256
        is distinct from p_reconciliation_evidence_sha256 then
      raise exception 'BRAND_LOGO_RECONCILIATION_CONFLICT';
    end if;
    return private.brand_logo_claim_result(p_operation_id, 'resumed');
  end if;
  if v_operation.state is distinct from 'accepted'
    or (
      p_observed_content_sha256 = v_operation.new_content_sha256
      and p_observed_byte_length = v_operation.new_byte_length
    ) then
    raise exception 'BRAND_LOGO_RECONCILIATION_CONFLICT';
  end if;
  v_publish_path_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_operation.new_storage_path, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select * into v_publish
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_operation.user_key
    and dispatch_record.operation_id = v_operation.operation_id
    and dispatch_record.dispatch_kind = 'brand-logo-publish'
  for update;
  if not found
    or v_publish.storage_path_sha256 <> v_publish_path_sha256
    or v_publish.artifact_sha256 <> v_operation.new_content_sha256
    or v_publish.dispatch_token <> v_operation.publish_dispatch_token
    or v_publish.state not in ('dispatched', 'completed') then
    raise exception 'BRAND_LOGO_RECONCILIATION_CONFLICT';
  end if;
  update private.brand_logo_operations
  set state = 'reconciliation_required',
      reconciliation_code = 'storage_bytes_mismatch',
      observed_content_sha256 = p_observed_content_sha256,
      observed_byte_length = p_observed_byte_length,
      reconciliation_evidence_sha256 = p_reconciliation_evidence_sha256,
      updated_at = pg_catalog.clock_timestamp()
  where operation_id = p_operation_id;
  return private.brand_logo_claim_result(p_operation_id, 'resumed');
end;
$function$;

create or replace function public.resolve_brand_logo_reconciliation(
  p_user_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_resolution text,
  p_cleanup_evidence_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.brand_logo_operations%rowtype;
  v_publish private.user_storage_dispatches%rowtype;
  v_dispatch private.user_storage_dispatches%rowtype;
  v_publish_path_sha256 text;
  v_storage_path_sha256 text;
  v_expected_cleanup_evidence text;
  v_response jsonb;
begin
  if p_user_id is null or p_operation_id is null or p_claim_token is null
    or p_resolution not in ('failed', 'cancelled')
    or p_cleanup_evidence_sha256 is null
    or p_cleanup_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'BRAND_LOGO_RECONCILIATION_RESOLUTION_INVALID';
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
    or v_operation.claim_token is distinct from p_claim_token
    or v_operation.action is distinct from 'replace' then
    raise exception 'BRAND_LOGO_OPERATION_CONFLICT';
  end if;
  if v_operation.state in ('failed', 'cancelled') then
    if v_operation.state <> p_resolution
      or v_operation.cleanup_evidence_sha256 <> p_cleanup_evidence_sha256 then
      raise exception 'BRAND_LOGO_RECONCILIATION_CONFLICT';
    end if;
    return v_operation.terminal_response;
  end if;
  if v_operation.state is distinct from 'reconciliation_required' then
    raise exception 'BRAND_LOGO_RECONCILIATION_CONFLICT';
  end if;
  v_storage_path_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(v_operation.new_storage_path)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_expected_cleanup_evidence := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'prompted.brand-logo-mismatch-cleanup.v1' || '|' ||
        v_operation.business_id::text || '|' || v_operation.operation_id::text || '|' ||
        v_operation.new_storage_path || '|absent',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  if p_cleanup_evidence_sha256 <> v_expected_cleanup_evidence
    or exists (
      select 1 from storage.objects object_record
      where object_record.bucket_id = 'assets'
        and object_record.name = v_operation.new_storage_path
    ) then
    raise exception 'BRAND_LOGO_RECONCILIATION_CLEANUP_INCOMPLETE';
  end if;
  v_publish_path_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_operation.new_storage_path, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select * into v_publish
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_operation.user_key
    and dispatch_record.operation_id = v_operation.operation_id
    and dispatch_record.dispatch_kind = 'brand-logo-publish'
  for update;
  if not found
    or v_publish.storage_path_sha256 <> v_publish_path_sha256
    or v_publish.artifact_sha256 <> v_operation.new_content_sha256
    or v_publish.dispatch_token <> v_operation.publish_dispatch_token
    or v_publish.state not in ('dispatched', 'completed')
    or (
      v_publish.reconciliation_resolution is not null
      and (
        v_publish.reconciliation_resolution <> 'verified_removed'
        or v_publish.reconciliation_evidence_sha256
          <> v_operation.reconciliation_evidence_sha256
      )
    ) then
    raise exception 'BRAND_LOGO_RECONCILIATION_CLEANUP_INCOMPLETE';
  end if;
  select * into v_dispatch
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_operation.user_key
    and dispatch_record.operation_id = v_operation.operation_id
    and dispatch_record.dispatch_kind = 'brand-logo-delete'
  for update;
  if not found or v_dispatch.state <> 'completed'
    or v_dispatch.dispatch_token <> v_operation.delete_dispatch_token
    or v_dispatch.storage_path_sha256 <> v_storage_path_sha256
    or v_dispatch.artifact_sha256 <> v_operation.binding_sha256 then
    raise exception 'BRAND_LOGO_RECONCILIATION_CLEANUP_INCOMPLETE';
  end if;

  update private.user_storage_dispatches
  set state = 'completed',
      completed_at = coalesce(completed_at, pg_catalog.clock_timestamp()),
      reconciliation_resolution = 'verified_removed',
      reconciliation_evidence_sha256 = v_operation.reconciliation_evidence_sha256,
      reconciled_at = coalesce(reconciled_at, pg_catalog.clock_timestamp())
  where id = v_publish.id;

  v_response := pg_catalog.jsonb_build_object(
    'error', pg_catalog.jsonb_build_object(
      'code', 'BRAND_LOGO_STORAGE_CONFLICT',
      'message', 'This logo operation conflicts with retained Storage bytes.',
      'retryable', false
    )
  );
  update private.brand_logo_operations
  set state = p_resolution,
      cleanup_evidence_sha256 = p_cleanup_evidence_sha256,
      terminal_http_status = 409,
      terminal_response = v_response,
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where operation_id = p_operation_id;
  return v_response;
end;
$function$;

revoke all on function public.mark_brand_logo_reconciliation(
  uuid,uuid,uuid,text,integer,text
) from public, anon, authenticated;
revoke all on function public.resolve_brand_logo_reconciliation(
  uuid,uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.mark_brand_logo_reconciliation(
  uuid,uuid,uuid,text,integer,text
) to service_role;
grant execute on function public.resolve_brand_logo_reconciliation(
  uuid,uuid,uuid,text,text
) to service_role;

comment on table private.captured_export_storage_recoveries is
  'Immutable exact-byte recovery authority written before captured PDF Storage acknowledgement.';
comment on function public.record_captured_export_storage_recovery(
  uuid,uuid,uuid,integer,text,text,integer,text,jsonb,uuid
) is 'Records one exact owner/export/revision/artifact/brand/storage identity for replay-only finalisation.';
comment on function public.mark_brand_logo_reconciliation(
  uuid,uuid,uuid,text,integer,text
) is 'Fail-closed transition for a retained brand-logo object whose bytes do not match its immutable operation.';
comment on function public.resolve_brand_logo_reconciliation(
  uuid,uuid,uuid,text,text
) is 'Terminates an exact brand-logo mismatch only after the unactivated object deletion is durably acknowledged.';

commit;
