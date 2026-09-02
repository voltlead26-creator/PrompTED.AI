-- Exact, owner-bound ingest replay.
--
-- The upload UUID is the browser-owned request identity.  A SECURITY DEFINER
-- claim creates the processing row before Storage or model work, and a second
-- command seals the exact terminal HTTP response.  Ambiguous Storage/provider
-- attempts remain non-retryable until explicitly reconciled; response-loss
-- replay never creates a second object or model classification.

begin;

create table private.account_deletion_fences (
  user_key text primary key check (user_key ~ '^[0-9a-f]{64}$'),
  fenced_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table private.user_storage_dispatches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_key text not null check (user_key ~ '^[0-9a-f]{64}$'),
  operation_id uuid not null,
  dispatch_kind text not null
    check (dispatch_kind in ('captured-export', 'legacy-export')),
  storage_path_sha256 text not null check (storage_path_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  dispatch_token uuid not null unique,
  state text not null check (state in ('dispatched', 'completed')),
  dispatched_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz not null
    default (pg_catalog.clock_timestamp() + interval '120 seconds'),
  completed_at timestamptz,
  reconciliation_resolution text
    check (reconciliation_resolution in ('verified_absent', 'verified_removed')),
  reconciliation_evidence_sha256 text
    check (reconciliation_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  reconciled_at timestamptz,
  unique (user_key, operation_id, dispatch_kind),
  check (
    (state = 'dispatched' and completed_at is null
      and reconciliation_resolution is null
      and reconciliation_evidence_sha256 is null and reconciled_at is null)
    or (state = 'completed' and completed_at is not null
      and (
        (reconciliation_resolution is null
          and reconciliation_evidence_sha256 is null and reconciled_at is null)
        or (reconciliation_resolution is not null
          and reconciliation_evidence_sha256 is not null and reconciled_at is not null)
      ))
  ),
  check (lease_expires_at > dispatched_at)
);

-- External egress is fenced separately from the domain-specific operation
-- records. This small common boundary is invoked immediately before OpenAI,
-- renderer, and approved data-source requests, so an account-deletion fence
-- and every user-derived outbound side effect are ordered by one advisory
-- lock. Only hashes of canonical request identities are retained.
create table private.user_external_egress_dispatches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_key text not null check (user_key ~ '^[0-9a-f]{64}$'),
  egress_kind text not null check (egress_kind ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  egress_route text not null check (egress_route ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  resource_sha256 text not null check (resource_sha256 ~ '^[0-9a-f]{64}$'),
  dispatch_token uuid not null unique,
  state text not null
    check (state in ('dispatched', 'completed', 'reconciliation_required')),
  dispatched_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz not null
    default (pg_catalog.clock_timestamp() + interval '120 seconds'),
  completed_at timestamptz,
  reconciliation_resolution text check (
    reconciliation_resolution in ('verified_not_dispatched', 'provider_terminal_reconciled')
  ),
  reconciliation_evidence_sha256 text
    check (reconciliation_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  reconciled_at timestamptz,
  unique (user_key, egress_kind, egress_route, resource_sha256),
  check (
    (state = 'dispatched' and completed_at is null
      and reconciliation_resolution is null
      and reconciliation_evidence_sha256 is null and reconciled_at is null)
    or (state = 'reconciliation_required' and completed_at is not null
      and reconciliation_resolution is null
      and reconciliation_evidence_sha256 is null and reconciled_at is null)
    or (state = 'completed' and completed_at is not null
      and (
        (reconciliation_resolution is null
          and reconciliation_evidence_sha256 is null and reconciled_at is null)
        or (reconciliation_resolution is not null
          and reconciliation_evidence_sha256 is not null and reconciled_at is not null)
      ))
  ),
  check (lease_expires_at > dispatched_at)
);

-- Current clients bind one explicit UUID to a legacy PDF request and reuse it
-- only for the single uncertain transport retry. This private receipt binds
-- that owner/request pair to hashes of the authoritative input and renderer
-- policy. It contains no document wording, HTML, renderer body, or secret.
create table private.legacy_pdf_export_receipts (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  binding_version text not null
    check (binding_version = 'prompted.legacy-pdf-export.v2'),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  target_kind text not null check (target_kind in ('document','artifact','inline')),
  target_id uuid,
  target_revision integer check (target_revision is null or target_revision > 0),
  approved_revision integer check (approved_revision is null or approved_revision > 0),
  target_identity_sha256 text not null
    check (target_identity_sha256 ~ '^[0-9a-f]{64}$'),
  export_format text not null check (export_format = 'pdf'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  html_sha256 text not null check (html_sha256 ~ '^[0-9a-f]{64}$'),
  renderer_policy_sha256 text not null
    check (renderer_policy_sha256 ~ '^[0-9a-f]{64}$'),
  renderer_resource_sha256 text not null
    check (renderer_resource_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null check (char_length(storage_path) between 1 and 800),
  storage_path_sha256 text not null
    check (storage_path_sha256 ~ '^[0-9a-f]{64}$'),
  filename text not null check (filename ~ '^[a-z0-9][a-z0-9._-]{0,159}$'),
  state text not null default 'accepted'
    check (state in ('accepted','rendered','completed','reconciliation_required')),
  artifact_sha256 text check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_byte_length integer
    check (artifact_byte_length between 100 and 26214400),
  renderer_version text check (
    renderer_version is null or renderer_version = 'render-export.pdf.3'
  ),
  artifact_validation_result jsonb check (
    artifact_validation_result is null
    or pg_catalog.jsonb_typeof(artifact_validation_result) = 'object'
  ),
  history_id uuid references public.export_history(id) on delete cascade,
  reconciliation_code text check (
    reconciliation_code is null or reconciliation_code in (
      'renderer_outcome_unrecoverable',
      'renderer_ambiguous',
      'storage_object_unavailable',
      'stored_artifact_mismatch',
      'storage_ack_unresolved',
      'finalization_unresolved'
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  reconciliation_required_at timestamptz,
  primary key (owner_user_id, request_id),
  unique (history_id),
  check (
    (target_kind = 'inline' and target_id is null
      and target_revision is null and approved_revision is null)
    or (target_kind in ('document','artifact') and target_id is not null
      and target_revision is not null
      and (approved_revision is null or approved_revision <= target_revision))
  ),
  check (
    (state = 'accepted' and artifact_sha256 is null
      and artifact_byte_length is null and renderer_version is null
      and artifact_validation_result is null and history_id is null
      and completed_at is null and reconciliation_code is null
      and reconciliation_required_at is null)
    or (state = 'rendered' and artifact_sha256 is not null
      and artifact_byte_length is not null and renderer_version is not null
      and artifact_validation_result is not null and history_id is null
      and completed_at is null and reconciliation_code is null
      and reconciliation_required_at is null)
    or (state = 'completed' and artifact_sha256 is not null
      and artifact_byte_length is not null and renderer_version is not null
      and artifact_validation_result is not null and history_id is not null
      and completed_at is not null and reconciliation_code is null
      and reconciliation_required_at is null)
    or (state = 'reconciliation_required'
      and ((history_id is null and completed_at is null)
        or (history_id is not null and completed_at is not null))
      and reconciliation_code is not null
      and reconciliation_required_at is not null)
  )
);

alter table private.account_deletion_fences enable row level security;
alter table private.user_storage_dispatches enable row level security;
alter table private.user_external_egress_dispatches enable row level security;
alter table private.legacy_pdf_export_receipts enable row level security;
revoke all on table private.account_deletion_fences
  from public, anon, authenticated, service_role;
revoke all on table private.user_storage_dispatches
  from public, anon, authenticated, service_role;
revoke all on table private.user_external_egress_dispatches
  from public, anon, authenticated, service_role;
revoke all on table private.legacy_pdf_export_receipts
  from public, anon, authenticated, service_role;

create or replace function private.account_deletion_user_key(p_user_id uuid)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_user_id::text, 'UTF8'), 'sha256'),
    'hex'
  )
$function$;

revoke all on function private.account_deletion_user_key(uuid)
  from public, anon, authenticated, service_role;

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
  end if;
  if tg_op = 'UPDATE'
    and old.bucket_id in ('original-documents', 'captured-exports') then
    v_prefix := pg_catalog.split_part(old.name, '/', 1);
    if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'USER_STORAGE_PREFIX_INVALID';
    end if;
    v_old_user_id := v_prefix::uuid;
  end if;
  if v_new_user_id is null and v_old_user_id is null then return new; end if;

  -- Lock both affected prefixes in canonical order. This is the same lock
  -- acquired by begin_account_deletion_fence, so an admitted write cannot
  -- cross the tombstone commit boundary.
  if v_new_user_id is not null and v_old_user_id is not null
    and v_new_user_id is distinct from v_old_user_id then
    if v_new_user_id::text < v_old_user_id::text then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_new_user_id::text, 91000)
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_old_user_id::text, 91000)
      );
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_old_user_id::text, 91000)
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_new_user_id::text, 91000)
      );
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        coalesce(v_new_user_id, v_old_user_id)::text,
        91000
      )
    );
  end if;

  if (v_new_user_id is not null and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key =
        private.account_deletion_user_key(v_new_user_id)
    ))
    or (v_old_user_id is not null and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key =
        private.account_deletion_user_key(v_old_user_id)
    )) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_user_storage_deletion_fence()
  from public, anon, authenticated, service_role;

drop trigger if exists user_storage_deletion_fence on storage.objects;
create trigger user_storage_deletion_fence
before insert or update on storage.objects
for each row execute function private.enforce_user_storage_deletion_fence();

alter table public.uploads
  add column if not exists ingest_request_sha256 text,
  add column if not exists ingest_content_sha256 text,
  add column if not exists ingest_status text,
  add column if not exists ingest_stage text,
  add column if not exists ingest_claim_token uuid,
  add column if not exists ingest_heartbeat_at timestamptz,
  add column if not exists ingest_lease_expires_at timestamptz,
  add column if not exists ingest_http_status integer,
  add column if not exists ingest_response jsonb;

create or replace function private.completed_upload_ingest_is_valid(
  p_upload_id uuid,
  p_response jsonb,
  p_extracted_text text,
  p_extracted_payload jsonb
) returns boolean
language sql
immutable
security definer
set search_path = ''
as $function$
  select coalesce((
    p_upload_id is not null
    and pg_catalog.jsonb_typeof(p_response) = 'object'
    and p_response->>'upload_id' = p_upload_id::text
    and p_response->'original_retained' = 'true'::jsonb
    and p_response->>'classification_status' = 'completed'
    and nullif(pg_catalog.btrim(p_extracted_text), '') is not null
    and pg_catalog.jsonb_typeof(p_extracted_payload) = 'object'
    and p_extracted_payload->'original_retained' = 'true'::jsonb
    and p_extracted_payload->>'classification_status' = 'completed'
    and pg_catalog.jsonb_typeof(p_response->'confirm_payload') = 'object'
    and nullif(pg_catalog.btrim(p_response#>>'{confirm_payload,summary}'), '') is not null
    and nullif(pg_catalog.btrim(p_response#>>'{confirm_payload,document_type}'), '') is not null
    and nullif(pg_catalog.btrim(p_response#>>'{confirm_payload,filename}'), '') is not null
    and pg_catalog.jsonb_typeof(p_response#>'{confirm_payload,char_count}') = 'number'
    and (p_response#>>'{confirm_payload,char_count}') ~ '^[1-9][0-9]*$'
    and pg_catalog.jsonb_typeof(p_response#>'{confirm_payload,truncated}') = 'boolean'
    and case
      when pg_catalog.jsonb_typeof(p_response#>'{confirm_payload,structure}') = 'array'
      then
        pg_catalog.jsonb_array_length(p_response#>'{confirm_payload,structure}') > 0
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            p_response#>'{confirm_payload,structure}'
          ) as section_record(value)
          where pg_catalog.jsonb_typeof(section_record.value) is distinct from 'object'
            or nullif(pg_catalog.btrim(section_record.value->>'title'), '') is null
            or case
              when pg_catalog.jsonb_typeof(section_record.value->'items') = 'array'
              then exists (
                select 1
                from pg_catalog.jsonb_array_elements(section_record.value->'items')
                  as item_record(value)
                where pg_catalog.jsonb_typeof(item_record.value) is distinct from 'string'
                  or nullif(pg_catalog.btrim(item_record.value#>>'{}'), '') is null
              )
              else true
            end
        )
      else false
    end
  ), false)
$function$;

revoke all on function private.completed_upload_ingest_is_valid(
  uuid, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

alter table public.uploads
  drop constraint if exists uploads_ingest_request_sha256_check,
  drop constraint if exists uploads_ingest_content_sha256_check,
  drop constraint if exists uploads_ingest_status_check,
  drop constraint if exists uploads_ingest_stage_check,
  drop constraint if exists uploads_ingest_lease_check,
  drop constraint if exists uploads_ingest_http_status_check,
  drop constraint if exists uploads_ingest_response_check,
  drop constraint if exists uploads_ingest_state_check;

alter table public.uploads
  add constraint uploads_ingest_request_sha256_check check (
    ingest_request_sha256 is null
    or ingest_request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint uploads_ingest_content_sha256_check check (
    ingest_content_sha256 is null
    or ingest_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint uploads_ingest_status_check check (
    ingest_status is null
    or ingest_status in (
      'processing', 'completed', 'failed', 'reconciliation_required'
    )
  ),
  add constraint uploads_ingest_stage_check check (
    ingest_stage is null
    or ingest_stage in (
      'prepared', 'storage_dispatched', 'storage_completed',
      'provider_dispatched', 'terminal'
    )
  ),
  add constraint uploads_ingest_lease_check check (
    (ingest_claim_token is null and ingest_heartbeat_at is null
      and ingest_lease_expires_at is null)
    or (
      ingest_claim_token is not null
      and ingest_heartbeat_at is not null
      and ingest_lease_expires_at is not null
      and ingest_lease_expires_at > ingest_heartbeat_at
    )
  ),
  add constraint uploads_ingest_http_status_check check (
    ingest_http_status is null
    or ingest_http_status between 200 and 599
  ),
  add constraint uploads_ingest_response_check check (
    ingest_response is null
    or jsonb_typeof(ingest_response) = 'object'
  ),
  add constraint uploads_ingest_state_check check (
    ingest_status is null
    or (
      ingest_request_sha256 is not null
      and ingest_content_sha256 is not null
      and (
        (
          ingest_status = 'processing'
          and ingest_stage in (
            'prepared', 'storage_dispatched', 'storage_completed',
            'provider_dispatched'
          )
          and ingest_claim_token is not null
          and ingest_heartbeat_at is not null
          and ingest_lease_expires_at is not null
          and ingest_http_status is null
          and ingest_response is null
        )
        or (
          ingest_status <> 'processing'
          and ingest_stage = 'terminal'
          and ingest_http_status is not null
          and ingest_response is not null
        )
      )
    )
  );

create or replace function public.claim_upload_ingest(
  p_upload_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_file_type text,
  p_file_name text,
  p_file_size_bytes integer,
  p_request_sha256 text,
  p_content_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_claim_token uuid := extensions.gen_random_uuid();
begin
  if p_upload_id is null
    or p_user_id is null
    or p_storage_path is null
    or p_storage_path not like p_user_id::text || '/' || p_upload_id::text || '/%'
    or char_length(p_storage_path) > 800
    or nullif(btrim(p_file_type), '') is null
    or char_length(p_file_type) > 200
    or nullif(btrim(p_file_name), '') is null
    or char_length(p_file_name) > 300
    or p_file_size_bytes is null
    or p_file_size_bytes < 0
    or p_file_size_bytes > 8388608
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'UPLOAD_INGEST_CLAIM_INVALID';
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

  insert into public.uploads (
    id,
    user_id,
    storage_path,
    file_type,
    file_name,
    file_size_bytes,
    status,
    idempotency_key,
    ingest_request_sha256,
    ingest_content_sha256,
    ingest_status,
    ingest_stage,
    ingest_claim_token,
    ingest_heartbeat_at,
    ingest_lease_expires_at
  ) values (
    p_upload_id,
    p_user_id,
    p_storage_path,
    btrim(p_file_type),
    p_file_name,
    p_file_size_bytes,
    'processing',
    p_upload_id::text,
    p_request_sha256,
    p_content_sha256,
    'processing',
    'prepared',
    v_claim_token,
    v_now,
    v_now + interval '120 seconds'
  )
  on conflict do nothing
  returning * into v_upload;

  if found then
    return jsonb_build_object(
      'outcome', 'accepted',
      'stage', 'prepared',
      'claim_token', v_claim_token
    );
  end if;

  select * into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;

  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.storage_path is distinct from p_storage_path
    or v_upload.file_type is distinct from btrim(p_file_type)
    or v_upload.file_name is distinct from p_file_name
    or v_upload.file_size_bytes is distinct from p_file_size_bytes
    or v_upload.idempotency_key is distinct from p_upload_id::text
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_content_sha256 is distinct from p_content_sha256 then
    return jsonb_build_object('outcome', 'conflict');
  end if;

  if v_upload.ingest_status = 'processing' then
    if v_upload.ingest_lease_expires_at > v_now then
      return jsonb_build_object(
        'outcome', 'processing',
        'stage', v_upload.ingest_stage
      );
    end if;
    if v_upload.ingest_stage = 'storage_dispatched' then
      -- The Storage request may still commit after its local caller dies. Age
      -- alone is not proof that no object was retained, so never terminalize
      -- or reclaim this stage automatically. The original claim token may
      -- still advance an acknowledged retain; every other caller must poll or
      -- enter an explicit reconciliation workflow without redispatching.
      update public.uploads
      set ingest_claim_token = v_claim_token,
          ingest_heartbeat_at = v_now,
          ingest_lease_expires_at = v_now + interval '120 seconds'
      where id = p_upload_id;
      return pg_catalog.jsonb_build_object(
        'outcome', 'resumed', 'stage', 'storage_dispatched',
        'claim_token', v_claim_token, 'storage_permitted', false
      );
    end if;
    if v_upload.ingest_stage in (
      'prepared', 'storage_completed', 'provider_dispatched'
    ) then
      update public.uploads
      set ingest_claim_token = v_claim_token,
          ingest_heartbeat_at = v_now,
          ingest_lease_expires_at = v_now + interval '120 seconds'
      where id = p_upload_id;
      return pg_catalog.jsonb_build_object(
        'outcome', 'resumed',
        'stage', v_upload.ingest_stage,
        'claim_token', v_claim_token
      );
    end if;
    return jsonb_build_object('outcome', 'conflict');
  end if;
  if v_upload.ingest_status in (
    'completed', 'failed', 'reconciliation_required'
  ) then
    return jsonb_build_object(
      'outcome', v_upload.ingest_status,
      'http_status', v_upload.ingest_http_status,
      'response', v_upload.ingest_response
    );
  end if;

  return jsonb_build_object('outcome', 'conflict');
end;
$function$;

create or replace function public.reconcile_upload_ingest_storage(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_resolution text,
  p_evidence_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_upload_id is null or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_resolution is null
    or p_resolution not in ('verified_absent', 'verified_removed')
    or p_evidence_sha256 is null
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'UPLOAD_STORAGE_RECONCILIATION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if not exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'UPLOAD_STORAGE_RECONCILIATION_REQUIRES_DELETION_FENCE';
  end if;
  select * into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id and upload_record.user_id = p_user_id
  for update;
  if not found
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_stage is distinct from 'storage_dispatched'
    or v_upload.ingest_lease_expires_at > v_now then
    raise exception 'UPLOAD_STORAGE_RECONCILIATION_CONFLICT';
  end if;
  update public.uploads
  set status = 'failed', completed_at = v_now,
      error_code = 'ACCOUNT_DELETION_STORAGE_RECONCILED',
      extracted_payload = pg_catalog.jsonb_build_object(
        'original_retained', false,
        'storage_status', p_resolution,
        'evidence_sha256', p_evidence_sha256,
        'classification_status', 'not_started'
      ),
      ingest_status = 'failed', ingest_stage = 'terminal',
      ingest_http_status = 409,
      ingest_response = pg_catalog.jsonb_build_object(
        'error', pg_catalog.jsonb_build_object(
          'code', 'ACCOUNT_DELETION_STORAGE_RECONCILED',
          'message', 'The interrupted upload was reconciled for account deletion.'
        ),
        'upload_id', p_upload_id,
        'storage_resolution', p_resolution,
        'evidence_sha256', p_evidence_sha256
      )
  where id = p_upload_id;
  return pg_catalog.jsonb_build_object('outcome', 'reconciled');
end;
$function$;

create or replace function public.advance_upload_ingest(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_claim_token uuid,
  p_expected_stage text,
  p_next_stage text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_upload_id is null
    or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
    or not (
      (p_expected_stage = 'prepared' and p_next_stage = 'storage_dispatched')
      or (p_expected_stage = 'storage_dispatched' and p_next_stage = 'storage_completed')
      or (p_expected_stage = 'storage_completed' and p_next_stage = 'provider_dispatched')
    ) then
    raise exception 'UPLOAD_INGEST_ADVANCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if p_next_stage in ('storage_dispatched', 'provider_dispatched')
    and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key = private.account_deletion_user_key(p_user_id)
    ) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;

  select * into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;
  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_claim_token is distinct from p_claim_token then
    raise exception 'UPLOAD_INGEST_ADVANCE_CONFLICT';
  end if;
  if v_upload.ingest_stage = p_next_stage then
    return pg_catalog.jsonb_build_object(
      'outcome', 'idempotent_replay',
      'stage', p_next_stage
    );
  end if;
  if v_upload.ingest_stage is distinct from p_expected_stage
    or v_upload.ingest_lease_expires_at <= v_now then
    raise exception 'UPLOAD_INGEST_ADVANCE_CONFLICT';
  end if;
  update public.uploads
  set ingest_stage = p_next_stage,
      ingest_heartbeat_at = v_now,
      ingest_lease_expires_at = v_now + interval '120 seconds'
  where id = p_upload_id;
  return pg_catalog.jsonb_build_object('outcome', 'advanced', 'stage', p_next_stage);
end;
$function$;

create or replace function public.settle_upload_ingest(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_ingest_status text,
  p_http_status integer,
  p_response jsonb,
  p_extracted_text text,
  p_extracted_payload jsonb,
  p_error_code text,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
begin
  if p_upload_id is null
    or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
    or p_ingest_status is null
    or p_ingest_status not in (
      'completed', 'failed', 'reconciliation_required'
    )
    or p_http_status is null
    or p_http_status not between 200 and 599
    or p_response is null
    or jsonb_typeof(p_response) <> 'object'
    or p_response->>'upload_id' is distinct from p_upload_id::text
    or p_extracted_payload is null
    or jsonb_typeof(p_extracted_payload) <> 'object'
    or char_length(coalesce(p_extracted_text, '')) > 20000
    or char_length(coalesce(p_error_code, '')) > 128
    or (p_ingest_status = 'completed' and (
      p_http_status <> 200 or p_error_code is not null
      or not private.completed_upload_ingest_is_valid(
        p_upload_id, p_response, p_extracted_text, p_extracted_payload
      )
    ))
    or (p_ingest_status = 'failed' and (
      p_http_status < 400 or nullif(p_error_code, '') is null
    ))
    or (p_ingest_status = 'reconciliation_required' and (
      p_http_status <> 409 or nullif(p_error_code, '') is null
    )) then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_INVALID';
  end if;

  select * into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;

  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
  end if;

  if v_upload.ingest_status in (
    'completed', 'failed', 'reconciliation_required'
  ) then
    if v_upload.ingest_status is distinct from p_ingest_status
      or v_upload.ingest_http_status is distinct from p_http_status
      or v_upload.ingest_response is distinct from p_response
      or v_upload.extracted_text is distinct from p_extracted_text
      or v_upload.extracted_payload is distinct from p_extracted_payload
      or v_upload.error_code is distinct from p_error_code then
      raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
    end if;
    return jsonb_build_object('outcome', 'idempotent_replay');
  end if;

  if v_upload.ingest_status is distinct from 'processing'
    or v_upload.status is distinct from 'processing'
    or (
      p_ingest_status = 'completed'
      and v_upload.ingest_stage is distinct from 'provider_dispatched'
    )
    or (
      p_ingest_status = 'failed'
      and v_upload.ingest_stage not in ('storage_completed', 'provider_dispatched')
    )
    or (
      p_ingest_status = 'reconciliation_required'
      and v_upload.ingest_stage not in ('storage_dispatched', 'provider_dispatched')
    ) then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
  end if;

  update public.uploads
  set
    extracted_text = p_extracted_text,
    extracted_payload = p_extracted_payload,
    status = case when p_ingest_status = 'completed' then 'ready' else 'failed' end,
    completed_at = clock_timestamp(),
    error_code = p_error_code,
    ingest_status = p_ingest_status,
    ingest_stage = 'terminal',
    ingest_http_status = p_http_status,
    ingest_response = p_response
  where id = p_upload_id;

  return jsonb_build_object('outcome', 'settled');
end;
$function$;

create or replace function private.require_terminal_upload_before_import_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'committed' and old.status is distinct from 'committed' then
    if not (
      (
        old.status = 'ready'
        and old.ingest_status = 'completed'
        and old.ingest_stage = 'terminal'
        and old.ingest_http_status = 200
        and private.completed_upload_ingest_is_valid(
          old.id, old.ingest_response, old.extracted_text, old.extracted_payload
        )
      )
      or (
        old.status = 'ready'
        and old.ingest_status is null
        and old.ingest_request_sha256 is null
        and old.ingest_response is null
      )
    ) then
      raise exception 'UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST';
    end if;
  end if;
  return new;
end;
$function$;

create trigger uploads_require_terminal_ingest_before_commit
before update of status on public.uploads
for each row execute function private.require_terminal_upload_before_import_commit();

revoke all on function private.require_terminal_upload_before_import_commit()
  from public, anon, authenticated, service_role;

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
    or p_dispatch_kind not in ('captured-export', 'legacy-export')
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
    or p_dispatch_kind not in ('captured-export', 'legacy-export')
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
    or p_dispatch_kind not in ('captured-export', 'legacy-export')
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

create or replace function public.claim_user_external_egress(
  p_user_id uuid, p_egress_kind text, p_egress_route text,
  p_resource_sha256 text, p_dispatch_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_key text;
  v_dispatch private.user_external_egress_dispatches%rowtype;
begin
  if p_user_id is null
    or p_egress_kind is null or p_egress_kind !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    or p_egress_route is null or p_egress_route !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or p_resource_sha256 is null or p_resource_sha256 !~ '^[0-9a-f]{64}$'
    or p_dispatch_token is null then
    raise exception 'USER_EXTERNAL_EGRESS_INVALID';
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
  insert into private.user_external_egress_dispatches(
    user_key, egress_kind, egress_route, resource_sha256, dispatch_token, state
  ) values (
    v_user_key, p_egress_kind, p_egress_route, p_resource_sha256,
    p_dispatch_token, 'dispatched'
  )
  on conflict (user_key, egress_kind, egress_route, resource_sha256) do nothing
  returning * into v_dispatch;
  if found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'accepted', 'egress_permitted', true,
      'dispatch_token', p_dispatch_token,
      'lease_expires_at', v_dispatch.lease_expires_at
    );
  end if;
  select * into v_dispatch
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.egress_kind = p_egress_kind
    and dispatch_record.egress_route = p_egress_route
    and dispatch_record.resource_sha256 = p_resource_sha256
  for update;
  if v_dispatch.state = 'completed' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'completed', 'egress_permitted', false,
      'dispatch_token', p_dispatch_token
    );
  end if;
  if v_dispatch.dispatch_token is distinct from p_dispatch_token then
    return pg_catalog.jsonb_build_object(
      'outcome', case when v_dispatch.state = 'reconciliation_required'
        then 'reconciliation_required' else 'processing' end,
      'egress_permitted', false, 'dispatch_token', p_dispatch_token,
      'retry_after_seconds', 2
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'outcome', case v_dispatch.state
      when 'dispatched' then 'idempotent_replay'
      else v_dispatch.state end,
    'egress_permitted', v_dispatch.state = 'dispatched',
    'dispatch_token', p_dispatch_token,
    'lease_expires_at', case when v_dispatch.state = 'dispatched'
      then v_dispatch.lease_expires_at else null end
  );
end;
$function$;

create or replace function public.complete_user_external_egress(
  p_user_id uuid, p_egress_kind text, p_egress_route text,
  p_resource_sha256 text, p_dispatch_token uuid, p_terminal_state text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispatch private.user_external_egress_dispatches%rowtype;
begin
  if p_user_id is null
    or p_egress_kind is null or p_egress_kind !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    or p_egress_route is null or p_egress_route !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or p_resource_sha256 is null or p_resource_sha256 !~ '^[0-9a-f]{64}$'
    or p_dispatch_token is null
    or p_terminal_state is null
    or p_terminal_state not in ('completed', 'reconciliation_required') then
    raise exception 'USER_EXTERNAL_EGRESS_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  select * into v_dispatch
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
    and dispatch_record.egress_kind = p_egress_kind
    and dispatch_record.egress_route = p_egress_route
    and dispatch_record.resource_sha256 = p_resource_sha256
  for update;
  if not found or v_dispatch.dispatch_token is distinct from p_dispatch_token then
    raise exception 'USER_EXTERNAL_EGRESS_CONFLICT';
  end if;
  if v_dispatch.state is distinct from 'dispatched' then
    if v_dispatch.state is distinct from p_terminal_state then
      raise exception 'USER_EXTERNAL_EGRESS_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'idempotent_replay',
      'terminal_state', p_terminal_state
    );
  end if;
  update private.user_external_egress_dispatches
  set state = p_terminal_state,
      completed_at = pg_catalog.clock_timestamp()
  where id = v_dispatch.id;
  return pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'terminal_state', p_terminal_state
  );
end;
$function$;

create or replace function public.reconcile_user_external_egress(
  p_user_id uuid, p_egress_kind text, p_egress_route text,
  p_resource_sha256 text, p_resolution text, p_evidence_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_dispatch private.user_external_egress_dispatches%rowtype;
begin
  if p_user_id is null
    or p_egress_kind is null or p_egress_kind !~ '^[a-z0-9][a-z0-9-]{0,63}$'
    or p_egress_route is null or p_egress_route !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or p_resource_sha256 is null or p_resource_sha256 !~ '^[0-9a-f]{64}$'
    or p_resolution is null
    or p_resolution not in ('verified_not_dispatched', 'provider_terminal_reconciled')
    or p_evidence_sha256 is null
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'USER_EXTERNAL_EGRESS_RECONCILIATION_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if not exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'USER_EXTERNAL_EGRESS_RECONCILIATION_REQUIRES_DELETION_FENCE';
  end if;
  select * into v_dispatch
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
    and dispatch_record.egress_kind = p_egress_kind
    and dispatch_record.egress_route = p_egress_route
    and dispatch_record.resource_sha256 = p_resource_sha256
  for update;
  if not found
    or v_dispatch.state not in ('dispatched', 'reconciliation_required', 'completed')
    or v_dispatch.lease_expires_at > pg_catalog.clock_timestamp() then
    raise exception 'USER_EXTERNAL_EGRESS_RECONCILIATION_CONFLICT';
  end if;
  if v_dispatch.state = 'completed' then
    if v_dispatch.reconciliation_resolution is not distinct from p_resolution
      and v_dispatch.reconciliation_evidence_sha256 is not distinct from p_evidence_sha256 then
      return pg_catalog.jsonb_build_object('outcome', 'idempotent_replay');
    end if;
    raise exception 'USER_EXTERNAL_EGRESS_RECONCILIATION_CONFLICT';
  end if;
  update private.user_external_egress_dispatches
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

-- One SQL statement owns the MVCC snapshot for legacy export metadata and
-- child wording. A concurrent parent/child mutation is therefore observed
-- wholly before or wholly after its commit; revision N can never attest
-- wording from revision N+1.
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
      ), '[]'::jsonb)
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
            'order_index', block_record.order_index,
            'kind', block_record.kind
          ) order by block_record.order_index, block_record.id
        )
        from public.ted_artifact_blocks block_record
        where block_record.artifact_id = artifact_record.id
          and block_record.user_id = p_user_id
      ), '[]'::jsonb)
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

create or replace function public.get_legacy_pdf_export_binding(
  p_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt private.legacy_pdf_export_receipts%rowtype;
begin
  if p_user_id is null or p_request_id is null then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_INVALID';
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
  select * into v_receipt
  from private.legacy_pdf_export_receipts receipt_record
  where receipt_record.owner_user_id=p_user_id
    and receipt_record.request_id=p_request_id;
  if not found then
    return pg_catalog.jsonb_build_object(
      'outcome','not_found','request_id',p_request_id
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'outcome','found','request_id',p_request_id,
    'binding',pg_catalog.jsonb_build_object(
      'binding_version',v_receipt.binding_version,
      'binding_sha256',v_receipt.binding_sha256,
      'target_kind',v_receipt.target_kind,
      'target_id',v_receipt.target_id,
      'target_revision',v_receipt.target_revision,
      'approved_revision',v_receipt.approved_revision,
      'target_identity_sha256',v_receipt.target_identity_sha256,
      'format',v_receipt.export_format,
      'input_sha256',v_receipt.input_sha256,
      'html_sha256',v_receipt.html_sha256,
      'renderer_policy_sha256',v_receipt.renderer_policy_sha256,
      'renderer_resource_sha256',v_receipt.renderer_resource_sha256,
      'storage_path',v_receipt.storage_path,
      'storage_path_sha256',v_receipt.storage_path_sha256,
      'filename',v_receipt.filename
    )
  );
end;
$function$;

create or replace function public.claim_legacy_pdf_export(
  p_user_id uuid,
  p_request_id uuid,
  p_binding jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt private.legacy_pdf_export_receipts%rowtype;
  v_storage private.user_storage_dispatches%rowtype;
  v_egress private.user_external_egress_dispatches%rowtype;
  v_target_id uuid;
  v_target_revision integer;
  v_approved_revision integer;
  v_expected_path text;
  v_expected_path_sha256 text;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_allowed_keys text[] := array[
    'binding_version','binding_sha256','target_kind','target_id',
    'target_revision','approved_revision','target_identity_sha256','format',
    'input_sha256','html_sha256','renderer_policy_sha256',
    'renderer_resource_sha256','storage_path','storage_path_sha256','filename'
  ];
begin
  if p_user_id is null or p_request_id is null or p_binding is null
    or pg_catalog.jsonb_typeof(p_binding) is distinct from 'object'
    or not (p_binding ?& v_allowed_keys)
    or (p_binding - v_allowed_keys) <> '{}'::jsonb
    or p_binding->>'binding_version' is distinct from 'prompted.legacy-pdf-export.v2'
    or p_binding->>'binding_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'target_kind' not in ('document','artifact','inline')
    or p_binding->>'target_identity_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'format' is distinct from 'pdf'
    or p_binding->>'input_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'html_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'renderer_policy_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'renderer_resource_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'storage_path_sha256' !~ '^[0-9a-f]{64}$'
    or p_binding->>'filename' !~ '^[a-z0-9][a-z0-9._-]{0,159}$'
    or pg_catalog.char_length(p_binding->>'storage_path') > 800
    or (
      p_binding->'target_revision' <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_binding->'target_revision') <> 'number'
    )
    or (
      p_binding->'approved_revision' <> 'null'::jsonb
      and pg_catalog.jsonb_typeof(p_binding->'approved_revision') <> 'number'
    ) then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_INVALID';
  end if;

  begin
    v_target_id := (p_binding->>'target_id')::uuid;
    v_target_revision := (p_binding->>'target_revision')::integer;
    v_approved_revision := (p_binding->>'approved_revision')::integer;
  exception when others then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_INVALID';
  end;
  if (
      p_binding->>'target_kind' = 'inline'
      and (v_target_id is not null or v_target_revision is not null
        or v_approved_revision is not null)
    ) or (
      p_binding->>'target_kind' in ('document','artifact')
      and (v_target_id is null or v_target_revision is null
        or v_target_revision < 1 or v_approved_revision < 1
        or v_approved_revision > v_target_revision)
    ) then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_INVALID';
  end if;
  v_expected_path := p_user_id::text || '/' || p_request_id::text || '/legacy.pdf';
  v_expected_path_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_expected_path, 'UTF8'), 'sha256'),
    'hex'
  );
  if p_binding->>'storage_path' is distinct from v_expected_path
    or p_binding->>'storage_path_sha256' is distinct from v_expected_path_sha256 then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_INVALID';
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

  insert into private.legacy_pdf_export_receipts(
    owner_user_id, request_id, binding_version, binding_sha256,
    target_kind, target_id, target_revision, approved_revision,
    target_identity_sha256, export_format, input_sha256, html_sha256,
    renderer_policy_sha256, renderer_resource_sha256,
    storage_path, storage_path_sha256, filename
  ) values (
    p_user_id, p_request_id, p_binding->>'binding_version',
    p_binding->>'binding_sha256', p_binding->>'target_kind', v_target_id,
    v_target_revision, v_approved_revision,
    p_binding->>'target_identity_sha256', p_binding->>'format',
    p_binding->>'input_sha256', p_binding->>'html_sha256',
    p_binding->>'renderer_policy_sha256',
    p_binding->>'renderer_resource_sha256', p_binding->>'storage_path',
    p_binding->>'storage_path_sha256', p_binding->>'filename'
  )
  on conflict (owner_user_id, request_id) do nothing
  returning * into v_receipt;
  if found then
    return pg_catalog.jsonb_build_object(
      'outcome','requested','request_id',p_request_id,
      'binding_sha256',p_binding->>'binding_sha256'
    );
  end if;

  select * into v_receipt
  from private.legacy_pdf_export_receipts receipt_record
  where receipt_record.owner_user_id = p_user_id
    and receipt_record.request_id = p_request_id
  for update;
  if not found
    or v_receipt.binding_version is distinct from p_binding->>'binding_version'
    or v_receipt.binding_sha256 is distinct from p_binding->>'binding_sha256'
    or v_receipt.target_kind is distinct from p_binding->>'target_kind'
    or v_receipt.target_id is distinct from v_target_id
    or v_receipt.target_revision is distinct from v_target_revision
    or v_receipt.approved_revision is distinct from v_approved_revision
    or v_receipt.target_identity_sha256 is distinct from p_binding->>'target_identity_sha256'
    or v_receipt.export_format is distinct from p_binding->>'format'
    or v_receipt.input_sha256 is distinct from p_binding->>'input_sha256'
    or v_receipt.html_sha256 is distinct from p_binding->>'html_sha256'
    or v_receipt.renderer_policy_sha256 is distinct from p_binding->>'renderer_policy_sha256'
    or v_receipt.renderer_resource_sha256 is distinct from p_binding->>'renderer_resource_sha256'
    or v_receipt.storage_path is distinct from p_binding->>'storage_path'
    or v_receipt.storage_path_sha256 is distinct from p_binding->>'storage_path_sha256'
    or v_receipt.filename is distinct from p_binding->>'filename' then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_CONFLICT';
  end if;

  if v_receipt.state = 'completed' then
    return pg_catalog.jsonb_build_object(
      'outcome','completed','request_id',v_receipt.request_id,
      'binding_sha256',v_receipt.binding_sha256,
      'storage_path',v_receipt.storage_path,
      'artifact_sha256',v_receipt.artifact_sha256,
      'artifact_byte_length',v_receipt.artifact_byte_length,
      'renderer_version',v_receipt.renderer_version,
      'artifact_validation_result',v_receipt.artifact_validation_result,
      'history_id',v_receipt.history_id
    );
  end if;
  if v_receipt.state = 'reconciliation_required' then
    return pg_catalog.jsonb_build_object(
      'outcome','reconciliation_required','request_id',v_receipt.request_id,
      'binding_sha256',v_receipt.binding_sha256
    );
  end if;

  if v_receipt.state = 'rendered' then
    select * into v_storage
    from private.user_storage_dispatches dispatch_record
    where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
      and dispatch_record.operation_id = p_request_id
      and dispatch_record.dispatch_kind = 'legacy-export';
    if not found then
      if v_receipt.updated_at + interval '120 seconds' > v_now then
        return pg_catalog.jsonb_build_object(
          'outcome','processing','request_id',v_receipt.request_id,
          'binding_sha256',v_receipt.binding_sha256,'retry_after_seconds',2
        );
      end if;
      update private.legacy_pdf_export_receipts
      set state='reconciliation_required',
          reconciliation_code='storage_ack_unresolved',
          reconciliation_required_at=v_now, updated_at=v_now
      where owner_user_id=p_user_id and request_id=p_request_id;
      return pg_catalog.jsonb_build_object(
        'outcome','reconciliation_required','request_id',v_receipt.request_id,
        'binding_sha256',v_receipt.binding_sha256
      );
    end if;
    if v_storage.storage_path_sha256 is distinct from v_receipt.storage_path_sha256
      or v_storage.artifact_sha256 is distinct from v_receipt.artifact_sha256 then
      raise exception 'LEGACY_PDF_EXPORT_STORAGE_CONFLICT';
    end if;
    if v_storage.state = 'dispatched' and v_storage.lease_expires_at > v_now then
      return pg_catalog.jsonb_build_object(
        'outcome','processing','request_id',v_receipt.request_id,
        'binding_sha256',v_receipt.binding_sha256,'retry_after_seconds',2
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome','storage_recovery','request_id',v_receipt.request_id,
      'binding_sha256',v_receipt.binding_sha256,
      'storage_path',v_receipt.storage_path,
      'artifact_sha256',v_receipt.artifact_sha256,
      'artifact_byte_length',v_receipt.artifact_byte_length,
      'renderer_version',v_receipt.renderer_version,
      'artifact_validation_result',v_receipt.artifact_validation_result,
      'storage_state',v_storage.state,
      'storage_dispatch_token',case when v_storage.state='dispatched'
        then v_storage.dispatch_token else null end
    );
  end if;

  select * into v_egress
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key = private.account_deletion_user_key(p_user_id)
    and dispatch_record.egress_kind = 'render-service'
    and dispatch_record.egress_route = 'pdf'
    and dispatch_record.resource_sha256 = v_receipt.renderer_resource_sha256;
  if not found then
    return pg_catalog.jsonb_build_object(
      'outcome','requested','request_id',v_receipt.request_id,
      'binding_sha256',v_receipt.binding_sha256
    );
  end if;
  if (v_egress.state = 'dispatched' and v_egress.lease_expires_at > v_now)
    or (v_egress.state = 'completed'
      and v_egress.completed_at + interval '120 seconds' > v_now) then
    return pg_catalog.jsonb_build_object(
      'outcome','processing','request_id',v_receipt.request_id,
      'binding_sha256',v_receipt.binding_sha256,'retry_after_seconds',2
    );
  end if;
  update private.legacy_pdf_export_receipts
  set state='reconciliation_required',
      reconciliation_code=case when v_egress.state='reconciliation_required'
        then 'renderer_ambiguous' else 'renderer_outcome_unrecoverable' end,
      reconciliation_required_at=v_now, updated_at=v_now
  where owner_user_id=p_user_id and request_id=p_request_id;
  return pg_catalog.jsonb_build_object(
    'outcome','reconciliation_required','request_id',v_receipt.request_id,
    'binding_sha256',v_receipt.binding_sha256
  );
end;
$function$;

create or replace function public.record_legacy_pdf_export_artifact(
  p_user_id uuid,
  p_request_id uuid,
  p_binding_sha256 text,
  p_artifact_sha256 text,
  p_artifact_byte_length integer,
  p_renderer_version text,
  p_artifact_validation_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt private.legacy_pdf_export_receipts%rowtype;
  v_egress private.user_external_egress_dispatches%rowtype;
begin
  if p_user_id is null or p_request_id is null
    or p_binding_sha256 is null
    or p_binding_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_sha256 is null
    or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_byte_length is null
    or p_artifact_byte_length not between 100 and 26214400
    or p_renderer_version is distinct from 'render-export.pdf.3'
    or p_artifact_validation_result is null
    or pg_catalog.jsonb_typeof(p_artifact_validation_result) is distinct from 'object'
    or pg_catalog.pg_column_size(p_artifact_validation_result) > 32768
    or p_artifact_validation_result->>'passed' is distinct from 'true'
    or p_artifact_validation_result->>'artifact_inspected' is distinct from 'true'
    or p_artifact_validation_result->>'inspection_contract'
      is distinct from 'prompted.rendered-pdf.v1'
    or (p_artifact_validation_result->>'byte_length')::integer
      is distinct from p_artifact_byte_length
    or p_artifact_validation_result->>'content_sha256' !~ '^[0-9a-f]{64}$'
    or p_artifact_validation_result->>'section_order_sha256' !~ '^[0-9a-f]{64}$'
    or p_artifact_validation_result->>'content_type'
      is distinct from 'application/pdf'
    or p_artifact_validation_result#>>'{checks,transport_envelope}' is distinct from 'true'
    or p_artifact_validation_result#>>'{checks,inspection_version}' is distinct from 'true'
    or p_artifact_validation_result#>>'{checks,renderer_status}' is distinct from 'true'
    or p_artifact_validation_result#>>'{checks,renderer_structural}' is distinct from 'true'
    or p_artifact_validation_result#>>'{checks,content_matches}' is distinct from 'true'
    or p_artifact_validation_result#>>'{checks,section_order_matches}' is distinct from 'true'
    or p_artifact_validation_result#>>'{checks,artifact_hash_matches}' is distinct from 'true'
    then
    raise exception 'LEGACY_PDF_EXPORT_ARTIFACT_INVALID';
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
  select * into v_receipt
  from private.legacy_pdf_export_receipts receipt_record
  where receipt_record.owner_user_id=p_user_id
    and receipt_record.request_id=p_request_id
  for update;
  if not found or v_receipt.binding_sha256 is distinct from p_binding_sha256 then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_CONFLICT';
  end if;
  if v_receipt.state in ('rendered','completed') then
    if v_receipt.artifact_sha256 is not distinct from p_artifact_sha256
      and v_receipt.artifact_byte_length is not distinct from p_artifact_byte_length
      and v_receipt.renderer_version is not distinct from p_renderer_version
      and v_receipt.artifact_validation_result is not distinct from
        p_artifact_validation_result then
      return pg_catalog.jsonb_build_object(
        'outcome','idempotent_replay','request_id',p_request_id,
        'binding_sha256',p_binding_sha256
      );
    end if;
    raise exception 'LEGACY_PDF_EXPORT_ARTIFACT_CONFLICT';
  end if;
  if v_receipt.state is distinct from 'accepted' then
    raise exception 'LEGACY_PDF_EXPORT_ARTIFACT_CONFLICT';
  end if;
  select * into v_egress
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key=private.account_deletion_user_key(p_user_id)
    and dispatch_record.egress_kind='render-service'
    and dispatch_record.egress_route='pdf'
    and dispatch_record.resource_sha256=v_receipt.renderer_resource_sha256;
  if not found or v_egress.state is distinct from 'completed'
    or v_egress.reconciliation_resolution is not null then
    raise exception 'LEGACY_PDF_EXPORT_RENDER_NOT_COMPLETED';
  end if;
  update private.legacy_pdf_export_receipts
  set state='rendered', artifact_sha256=p_artifact_sha256,
      artifact_byte_length=p_artifact_byte_length,
      renderer_version=p_renderer_version,
      artifact_validation_result=p_artifact_validation_result,
      updated_at=pg_catalog.clock_timestamp()
  where owner_user_id=p_user_id and request_id=p_request_id;
  return pg_catalog.jsonb_build_object(
    'outcome','recorded','request_id',p_request_id,
    'binding_sha256',p_binding_sha256
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'LEGACY_PDF_EXPORT_ARTIFACT_INVALID';
end;
$function$;

create or replace function public.mark_legacy_pdf_export_reconciliation(
  p_user_id uuid,
  p_request_id uuid,
  p_binding_sha256 text,
  p_reconciliation_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt private.legacy_pdf_export_receipts%rowtype;
begin
  if p_user_id is null or p_request_id is null
    or p_binding_sha256 is null or p_binding_sha256 !~ '^[0-9a-f]{64}$'
    or p_reconciliation_code is null or p_reconciliation_code not in (
      'renderer_outcome_unrecoverable','renderer_ambiguous',
      'storage_object_unavailable','stored_artifact_mismatch',
      'storage_ack_unresolved','finalization_unresolved'
    ) then
    raise exception 'LEGACY_PDF_EXPORT_RECONCILIATION_INVALID';
  end if;
  select * into v_receipt
  from private.legacy_pdf_export_receipts receipt_record
  where receipt_record.owner_user_id=p_user_id
    and receipt_record.request_id=p_request_id
  for update;
  if not found or v_receipt.binding_sha256 is distinct from p_binding_sha256 then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_CONFLICT';
  end if;
  if v_receipt.state='reconciliation_required' then
    if v_receipt.reconciliation_code is not distinct from p_reconciliation_code then
      return pg_catalog.jsonb_build_object(
        'outcome','idempotent_replay','request_id',p_request_id,
        'binding_sha256',p_binding_sha256
      );
    end if;
    raise exception 'LEGACY_PDF_EXPORT_RECONCILIATION_CONFLICT';
  end if;
  update private.legacy_pdf_export_receipts
  set state='reconciliation_required',
      reconciliation_code=p_reconciliation_code,
      reconciliation_required_at=pg_catalog.clock_timestamp(),
      updated_at=pg_catalog.clock_timestamp()
  where owner_user_id=p_user_id and request_id=p_request_id;
  return pg_catalog.jsonb_build_object(
    'outcome','reconciliation_required','request_id',p_request_id,
    'binding_sha256',p_binding_sha256
  );
end;
$function$;

create or replace function public.complete_legacy_pdf_export(
  p_user_id uuid,
  p_request_id uuid,
  p_binding_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt private.legacy_pdf_export_receipts%rowtype;
  v_storage private.user_storage_dispatches%rowtype;
  v_history_id uuid;
begin
  if p_user_id is null or p_request_id is null
    or p_binding_sha256 is null or p_binding_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'LEGACY_PDF_EXPORT_COMPLETION_INVALID';
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
  select * into v_receipt
  from private.legacy_pdf_export_receipts receipt_record
  where receipt_record.owner_user_id=p_user_id
    and receipt_record.request_id=p_request_id
  for update;
  if not found or v_receipt.binding_sha256 is distinct from p_binding_sha256 then
    raise exception 'LEGACY_PDF_EXPORT_BINDING_CONFLICT';
  end if;
  if v_receipt.state='completed' then
    return pg_catalog.jsonb_build_object(
      'outcome','completed','request_id',v_receipt.request_id,
      'binding_sha256',v_receipt.binding_sha256,
      'storage_path',v_receipt.storage_path,
      'artifact_sha256',v_receipt.artifact_sha256,
      'artifact_byte_length',v_receipt.artifact_byte_length,
      'renderer_version',v_receipt.renderer_version,
      'artifact_validation_result',v_receipt.artifact_validation_result,
      'history_id',v_receipt.history_id
    );
  end if;
  if v_receipt.state is distinct from 'rendered' then
    raise exception 'LEGACY_PDF_EXPORT_COMPLETION_CONFLICT';
  end if;
  select * into v_storage
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key=private.account_deletion_user_key(p_user_id)
    and dispatch_record.operation_id=p_request_id
    and dispatch_record.dispatch_kind='legacy-export';
  if not found or v_storage.state is distinct from 'completed'
    or v_storage.storage_path_sha256 is distinct from v_receipt.storage_path_sha256
    or v_storage.artifact_sha256 is distinct from v_receipt.artifact_sha256
    or v_storage.reconciliation_resolution is not null then
    raise exception 'LEGACY_PDF_EXPORT_STORAGE_NOT_COMPLETED';
  end if;
  v_history_id := extensions.gen_random_uuid();
  insert into public.export_history(
    id,user_id,document_id,artifact_id,format,filename,
    document_revision,artifact_revision,approved_revision,
    validation_passed,validation_result
  ) values (
    v_history_id,p_user_id,
    case when v_receipt.target_kind='document' then v_receipt.target_id else null end,
    case when v_receipt.target_kind='artifact' then v_receipt.target_id else null end,
    'pdf',v_receipt.filename,
    case when v_receipt.target_kind='document' then v_receipt.target_revision else null end,
    case when v_receipt.target_kind='artifact' then v_receipt.target_revision else null end,
    v_receipt.approved_revision,true,v_receipt.artifact_validation_result
  );
  update private.legacy_pdf_export_receipts
  set state='completed', history_id=v_history_id,
      completed_at=pg_catalog.clock_timestamp(),
      updated_at=pg_catalog.clock_timestamp()
  where owner_user_id=p_user_id and request_id=p_request_id
  returning * into v_receipt;
  return pg_catalog.jsonb_build_object(
    'outcome','completed','request_id',v_receipt.request_id,
    'binding_sha256',v_receipt.binding_sha256,
    'storage_path',v_receipt.storage_path,
    'artifact_sha256',v_receipt.artifact_sha256,
    'artifact_byte_length',v_receipt.artifact_byte_length,
    'renderer_version',v_receipt.renderer_version,
    'artifact_validation_result',v_receipt.artifact_validation_result,
    'history_id',v_receipt.history_id
  );
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
  v_storage private.user_storage_dispatches%rowtype;
  v_egress private.user_external_egress_dispatches%rowtype;
  v_user_key text;
  v_resource_sha256 text;
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

  if v_export.status = 'created' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'completed',
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'status', v_export.status,
      'storage_path', v_export.storage_path,
      'artifact_sha256', v_export.artifact_sha256,
      'renderer_version', v_export.renderer_version,
      'artifact_validation_result', v_export.artifact_validation_result
    );
  end if;
  if v_export.status is distinct from 'requested' or exists (
    select 1 from private.account_deletion_fences fence_record
    where fence_record.user_key = v_user_key
  ) then
    return pg_catalog.jsonb_build_object(
      'outcome', 'reconciliation_required',
      'export_id', v_export.id,
      'operation_id', v_export.operation_id
    );
  end if;

  -- Render-export stores one dispatch receipt per export UUID. A completed
  -- storage receipt without a created export means finalisation needs
  -- reconciliation; it is never authority to rerender or overwrite.
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
      'retry_after_seconds', 2
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
      'retry_after_seconds', 2
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'requested',
    'export_id', v_export.id,
    'operation_id', v_export.operation_id
  );
end;
$function$;

create or replace function public.begin_account_deletion_fence(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_key text;
  v_active_uploads integer;
  v_active_storage integer;
  v_active_egress integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null then raise exception 'ACCOUNT_DELETION_FENCE_INVALID'; end if;
  v_user_key := private.account_deletion_user_key(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  insert into private.account_deletion_fences(user_key)
  values (v_user_key)
  on conflict (user_key) do nothing;

  -- These stages cannot create another Storage object after the fence wins.
  update public.uploads
  set status = 'failed',
      completed_at = v_now,
      error_code = 'ACCOUNT_DELETION_FENCED',
      extracted_payload = coalesce(extracted_payload, '{}'::jsonb),
      ingest_status = 'failed',
      ingest_stage = 'terminal',
      ingest_http_status = 409,
      ingest_response = pg_catalog.jsonb_build_object(
        'error', pg_catalog.jsonb_build_object(
          'code', 'ACCOUNT_DELETION_FENCED',
          'message', 'Account deletion has started; this upload cannot continue.'
        ),
        'upload_id', id
      )
  where user_id = p_user_id
    and ingest_status = 'processing'
    and (
      ingest_stage in ('prepared', 'storage_completed')
      or (
        ingest_stage in ('storage_dispatched', 'provider_dispatched')
        and ingest_lease_expires_at <= v_now
      )
    );

  select count(*)::integer into v_active_uploads
  from public.uploads upload_record
  where upload_record.user_id = p_user_id
    and upload_record.ingest_status = 'processing';
  select count(*)::integer into v_active_storage
  from private.user_storage_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.state = 'dispatched'
    and dispatch_record.lease_expires_at > v_now;
  select count(*)::integer into v_active_egress
  from private.user_external_egress_dispatches dispatch_record
  where dispatch_record.user_key = v_user_key
    and dispatch_record.state in ('dispatched', 'reconciliation_required')
    and dispatch_record.lease_expires_at > v_now;
  return pg_catalog.jsonb_build_object(
    'outcome', case when v_active_uploads + v_active_storage + v_active_egress = 0
      then 'ready' else 'blocked' end,
    'active_uploads', v_active_uploads,
    'active_storage_dispatches', v_active_storage,
    'active_external_egress', v_active_egress,
    'retry_after_seconds', 2
  );
end;
$function$;

revoke all on function public.claim_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.complete_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.reconcile_user_storage_dispatch(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.begin_account_deletion_fence(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_user_external_egress(uuid,text,text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.complete_user_external_egress(uuid,text,text,text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.reconcile_user_external_egress(uuid,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.get_captured_document_export_receipt(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.load_legacy_export_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.claim_legacy_pdf_export(uuid,uuid,jsonb)
  from public, anon, authenticated;
revoke all on function public.get_legacy_pdf_export_binding(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.record_legacy_pdf_export_artifact(
  uuid,uuid,text,text,integer,text,jsonb
) from public, anon, authenticated;
revoke all on function public.complete_legacy_pdf_export(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.mark_legacy_pdf_export_reconciliation(
  uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.claim_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  to service_role;
grant execute on function public.complete_user_storage_dispatch(uuid,uuid,text,text,text,uuid)
  to service_role;
grant execute on function public.reconcile_user_storage_dispatch(uuid,uuid,text,text,text,text)
  to service_role;
grant execute on function public.begin_account_deletion_fence(uuid)
  to service_role;
grant execute on function public.claim_user_external_egress(uuid,text,text,text,uuid)
  to service_role;
grant execute on function public.complete_user_external_egress(uuid,text,text,text,uuid,text)
  to service_role;
grant execute on function public.reconcile_user_external_egress(uuid,text,text,text,text,text)
  to service_role;
grant execute on function public.get_captured_document_export_receipt(uuid,uuid,uuid)
  to service_role;
grant execute on function public.load_legacy_export_snapshot(uuid,uuid,uuid)
  to service_role;
grant execute on function public.claim_legacy_pdf_export(uuid,uuid,jsonb)
  to service_role;
grant execute on function public.get_legacy_pdf_export_binding(uuid,uuid)
  to service_role;
grant execute on function public.record_legacy_pdf_export_artifact(
  uuid,uuid,text,text,integer,text,jsonb
) to service_role;
grant execute on function public.complete_legacy_pdf_export(uuid,uuid,text)
  to service_role;
grant execute on function public.mark_legacy_pdf_export_reconciliation(
  uuid,uuid,text,text
) to service_role;

revoke all on function public.claim_upload_ingest(
  uuid, uuid, text, text, text, integer, text, text
) from public, anon, authenticated;
revoke all on function public.advance_upload_ingest(
  uuid, uuid, text, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.reconcile_upload_ingest_storage(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.settle_upload_ingest(
  uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid
) from public, anon, authenticated;
grant execute on function public.claim_upload_ingest(
  uuid, uuid, text, text, text, integer, text, text
) to service_role;
grant execute on function public.advance_upload_ingest(
  uuid, uuid, text, uuid, text, text
) to service_role;
grant execute on function public.reconcile_upload_ingest_storage(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.settle_upload_ingest(
  uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid
) to service_role;

-- The Edge endpoint now mutates upload rows only through fixed-path commands.
-- Keep the shared upload-context SELECT and remove stale direct DML.
revoke insert, update on table public.uploads from service_role;
grant select on table public.uploads to service_role;

comment on function public.claim_upload_ingest(
  uuid, uuid, text, text, text, integer, text, text
) is 'Service-only, owner-bound exactly-once upload ingest claim.';
comment on function public.advance_upload_ingest(
  uuid, uuid, text, uuid, text, text
) is 'Service-only leased upload ingest side-effect stage transition.';
comment on function public.settle_upload_ingest(
  uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid
) is 'Service-only immutable upload ingest result and replay settlement.';
comment on function public.get_captured_document_export_receipt(
  uuid, uuid, uuid
) is 'Service-only exact captured-export replay and reconciliation receipt.';
comment on function public.load_legacy_export_snapshot(uuid,uuid,uuid) is
  'Service-only owner-bound single-statement legacy export revision snapshot.';
comment on function public.claim_legacy_pdf_export(uuid,uuid,jsonb) is
  'Service-only owner/request binding and exact legacy PDF replay receipt.';
comment on function public.get_legacy_pdf_export_binding(uuid,uuid) is
  'Service-only lookup of hash-only legacy PDF binding evidence.';
comment on function public.record_legacy_pdf_export_artifact(
  uuid,uuid,text,text,integer,text,jsonb
) is 'Service-only immutable pre-upload legacy PDF inspection evidence.';
comment on function public.complete_legacy_pdf_export(uuid,uuid,text) is
  'Service-only atomic legacy PDF receipt and export-history completion.';
comment on function public.mark_legacy_pdf_export_reconciliation(
  uuid,uuid,text,text
) is 'Service-only fail-closed legacy PDF ambiguity marker.';

-- Extend the existing bounded release attestation without changing its input
-- or schema-version contract. A name plus overload_count=1 cannot distinguish
-- a partially applied migration whose sole overload has the wrong argument
-- list, so every requested RPC now carries PostgreSQL's canonical type list.
alter function public.attest_prompted_release_schema(text[], text[])
  rename to attest_prompted_release_schema_v2_base;
alter function public.attest_prompted_release_schema_v2_base(text[], text[])
  set schema private;
revoke all on function private.attest_prompted_release_schema_v2_base(text[], text[])
  from public, anon, authenticated, service_role;

create function public.attest_prompted_release_schema(
  p_tables text[] default '{}'::text[],
  p_rpcs text[] default '{}'::text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_base jsonb;
  v_rpcs jsonb;
begin
  v_base := private.attest_prompted_release_schema_v2_base(p_tables, p_rpcs);
  select coalesce(
    pg_catalog.jsonb_agg(
      rpc_fact || pg_catalog.jsonb_build_object(
        'argument_types', case
          when (rpc_fact->>'overload_count')::integer = 1
            then procedure_record.argument_types
          else null
        end
      ) order by rpc_record.ordinality
    ),
    '[]'::jsonb
  ) into v_rpcs
  from pg_catalog.jsonb_array_elements(v_base->'rpcs')
    with ordinality rpc_record(rpc_fact, ordinality)
  left join lateral (
    select pg_catalog.min(
      pg_catalog.oidvectortypes(procedure_candidate.proargtypes)
    ) as argument_types
    from pg_catalog.pg_proc procedure_candidate
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_candidate.pronamespace
    where schema_record.nspname = 'public'
      and procedure_candidate.proname = rpc_fact->>'name'
  ) procedure_record on true;
  return pg_catalog.jsonb_set(v_base, '{rpcs}', v_rpcs, false);
end;
$function$;

revoke all on function public.attest_prompted_release_schema(text[], text[])
  from public, anon, authenticated;
grant execute on function public.attest_prompted_release_schema(text[], text[])
  to service_role;
comment on function public.attest_prompted_release_schema(text[], text[]) is
  'Service-only bounded release attestation with exact canonical RPC argument types.';

commit;
