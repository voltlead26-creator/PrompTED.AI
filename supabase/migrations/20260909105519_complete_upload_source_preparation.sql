-- Complete retained, bounded source extraction without a provider classification.
-- The handler admits the separately versioned request/identity preimage. This
-- command owns only completion of its exact stored identity and current claim.
-- Existing classification receipts, Home eligibility and source formats remain
-- unchanged. A source receipt does not grant format-preserving editing.
begin;

create function private.completed_upload_source_preparation_is_valid(p_upload public.uploads)
returns boolean language sql immutable set search_path = '' as $function$
  select coalesce(
    p_upload.status in ('ready', 'committed')
    and p_upload.ingest_status = 'completed'
    and p_upload.ingest_stage = 'terminal'
    and p_upload.ingest_http_status = 200
    and p_upload.error_code is null
    and p_upload.ingest_extraction_contract_version = 'upload-extraction.3'
    and p_upload.ingest_extraction_policy_version = 'upload-resource-policy.2'
    and p_upload.ingest_extraction_recorded_at is not null
    and p_upload.ingest_extraction_format in ('pdf','docx','xlsx','text','rtf')
    and p_upload.ingest_extraction_truncated is not null
    and pg_catalog.char_length(p_upload.ingest_extraction_text) between 1 and 20000
    and pg_catalog.btrim(p_upload.ingest_extraction_text) <> ''
    and p_upload.ingest_extraction_text_sha256 = pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_upload.ingest_extraction_text, 'UTF8'), 'sha256'), 'hex')
    and p_upload.extracted_text = p_upload.ingest_extraction_text
    and p_upload.ingest_response = pg_catalog.jsonb_build_object(
      'contract_version', 'upload-source-preparation.1',
      'upload_id', p_upload.id, 'storage_path', p_upload.storage_path,
      'original_retained', true, 'classification_status', 'not_requested',
      'extracted_text', p_upload.ingest_extraction_text,
      'extraction_format', p_upload.ingest_extraction_format,
      'resource_policy_version', p_upload.ingest_extraction_policy_version,
      'extraction_text_sha256', p_upload.ingest_extraction_text_sha256,
      'truncated', p_upload.ingest_extraction_truncated)
    and p_upload.extracted_payload = pg_catalog.jsonb_build_object(
      'contract_version', 'upload-source-preparation.1',
      'original_retained', true, 'classification_status', 'not_requested',
      'extraction_format', p_upload.ingest_extraction_format,
      'resource_policy_version', p_upload.ingest_extraction_policy_version,
      'extraction_text_sha256', p_upload.ingest_extraction_text_sha256,
      'truncated', p_upload.ingest_extraction_truncated), false)
$function$;
revoke all on function private.completed_upload_source_preparation_is_valid(public.uploads)
  from public, anon, authenticated, service_role;

create function public.complete_upload_source_preparation_v1(
  p_upload_id uuid, p_user_id uuid, p_request_sha256 text, p_claim_token uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz;
  v_metadata jsonb;
  v_response jsonb;
  v_payload jsonb;
begin
  if p_upload_id is null or p_user_id is null or p_claim_token is null
    or p_request_sha256 is null or p_request_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'UPLOAD_SOURCE_PREPARATION_INPUT_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000));
  select * into v_upload from public.uploads where id = p_upload_id for update;
  if not found or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token then
    raise exception 'UPLOAD_SOURCE_PREPARATION_CONFLICT';
  end if;

  -- Replay is an immutable historical acknowledgement, even after lease expiry
  -- or import. Old classification/failure receipts cannot be relabelled.
  if v_upload.ingest_status in ('completed','failed','reconciliation_required') then
    if not private.completed_upload_source_preparation_is_valid(v_upload) then
      raise exception 'UPLOAD_SOURCE_PREPARATION_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('outcome','idempotent_replay',
      'http_status',200,'response',v_upload.ingest_response);
  end if;
  if exists (select 1 from private.account_deletion_fences f
    where f.user_key = private.account_deletion_user_key(p_user_id)) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_upload.status is distinct from 'processing'
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_stage is distinct from 'storage_completed'
    or v_upload.ingest_lease_expires_at is null
    or v_upload.ingest_lease_expires_at <= v_now then
    raise exception 'UPLOAD_SOURCE_PREPARATION_CONFLICT';
  end if;
  if v_upload.ingest_extraction_contract_version is distinct from 'upload-extraction.3'
    or v_upload.ingest_extraction_policy_version is distinct from 'upload-resource-policy.2'
    or v_upload.ingest_extraction_recorded_at is null
    or v_upload.ingest_extraction_format is null
    or v_upload.ingest_extraction_format not in ('pdf','docx','xlsx','text','rtf')
    or v_upload.ingest_extraction_truncated is null
    or v_upload.ingest_extraction_text is null
    or pg_catalog.char_length(v_upload.ingest_extraction_text) not between 1 and 20000
    or pg_catalog.btrim(v_upload.ingest_extraction_text) = ''
    or v_upload.ingest_extraction_text_sha256 is distinct from pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_upload.ingest_extraction_text, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED';
  end if;

  if exists (select 1 from private.legacy_model_attempt_admissions a
      where a.user_id=p_user_id and a.checkpoint_scope='ingest-upload'
        and a.logical_request_id=p_upload_id::text)
    or exists (select 1 from private.legacy_model_call_results r
      where r.user_id=p_user_id and r.checkpoint_scope='ingest-upload'
        and r.logical_request_id=p_upload_id::text)
    or exists (select 1 from public.usage_ledger u
      where u.user_id=p_user_id and u.event_type='model_call'
        and u.logical_request_id=p_upload_id::text
        and (u.checkpoint_scope='ingest-upload'
          or u.logical_stage_key like 'ingest-upload.%')) then
    raise exception 'UPLOAD_SOURCE_PREPARATION_PROVIDER_WORK_EXISTS';
  end if;

  if v_upload.storage_path not like p_user_id::text || '/' || p_upload_id::text || '/_%'
    or pg_catalog.char_length(v_upload.storage_path)>800
    or v_upload.storage_path ~ '(^|/)[.]{1,2}(/|$)'
    or v_upload.file_size_bytes is null or v_upload.file_size_bytes not between 1 and 8388608
    or v_upload.ingest_content_sha256 is null
    or v_upload.ingest_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'UPLOAD_SOURCE_PREPARATION_ORIGINAL_UNAVAILABLE';
  end if;
  select o.metadata into v_metadata from storage.objects o
    where o.bucket_id='original-documents' and o.name=v_upload.storage_path;
  if not found or (coalesce(v_metadata ? 'size',false) and not case
    when v_metadata->>'size' ~ '^[0-9]{1,10}$'
      then (v_metadata->>'size')::bigint=v_upload.file_size_bytes
    else false end) then
    raise exception 'UPLOAD_SOURCE_PREPARATION_ORIGINAL_UNAVAILABLE';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'contract_version','upload-source-preparation.1',
    'upload_id',v_upload.id,'storage_path',v_upload.storage_path,
    'original_retained',true,'classification_status','not_requested',
    'extracted_text',v_upload.ingest_extraction_text,
    'extraction_format',v_upload.ingest_extraction_format,
    'resource_policy_version',v_upload.ingest_extraction_policy_version,
    'extraction_text_sha256',v_upload.ingest_extraction_text_sha256,
    'truncated',v_upload.ingest_extraction_truncated);
  v_payload := v_response - array['upload_id','storage_path','extracted_text'];
  update public.uploads set extracted_text=v_upload.ingest_extraction_text,
    extracted_payload=v_payload,status='ready',completed_at=v_now,error_code=null,
    ingest_status='completed',ingest_stage='terminal',ingest_http_status=200,
    ingest_response=v_response where id=p_upload_id returning * into v_upload;
  if not private.completed_upload_source_preparation_is_valid(v_upload) then
    raise exception 'UPLOAD_SOURCE_PREPARATION_RESPONSE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object('outcome','settled','http_status',200,'response',v_response);
end;
$function$;
revoke all on function public.complete_upload_source_preparation_v1(uuid,uuid,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_upload_source_preparation_v1(uuid,uuid,text,uuid)
  to service_role;

create or replace function private.assert_upload_document_import_source(p_upload public.uploads)
returns void language plpgsql set search_path = '' as $function$
begin
  if p_upload.ingest_extraction_contract_version = 'upload-extraction.3' then
    if not private.completed_upload_source_preparation_is_valid(p_upload)
      and (p_upload.status in ('ready','committed')
        and p_upload.ingest_status = 'completed'
        and p_upload.ingest_stage = 'terminal'
        and p_upload.ingest_http_status = 200
        and private.completed_upload_ingest_is_valid(
          p_upload.id, p_upload.ingest_response, p_upload.extracted_text, p_upload.extracted_payload
        )) is distinct from true then
      raise exception 'UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST';
    end if;
    if p_upload.ingest_extraction_truncated is distinct from false then
      raise exception 'UPLOAD_IMPORT_PREVIEW_INCOMPLETE';
    end if;
    if p_upload.ingest_extraction_format is distinct from 'text' then
      raise exception 'UPLOAD_SOURCE_IMPORT_UNAVAILABLE';
    end if;
  end if;
end;
$function$;

create or replace function private.require_terminal_upload_before_import_commit()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if (new.document_id is not null and new.document_id is distinct from old.document_id)
    or (new.status = 'committed' and old.status is distinct from 'committed') then
    perform private.assert_upload_document_import_source(old);
  end if;
  if new.status = 'committed' and old.status is distinct from 'committed' then
    if not (
      private.completed_upload_source_preparation_is_valid(old)
      or (
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

commit;
