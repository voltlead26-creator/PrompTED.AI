begin;

alter table public.uploads
  add column if not exists ingest_extraction_text text,
  add column if not exists ingest_extraction_text_sha256 text,
  add column if not exists ingest_extraction_format text,
  add column if not exists ingest_extraction_truncated boolean,
  add column if not exists ingest_extraction_policy_version text,
  add column if not exists ingest_extraction_recorded_at timestamptz,
  add column if not exists ingest_extraction_attempt_count integer not null default 0,
  add column if not exists ingest_extraction_attempt_claim_token uuid,
  add column if not exists ingest_extraction_attempts_for_claim smallint not null default 0;

alter table public.uploads
  drop constraint if exists uploads_ingest_extraction_state_check,
  drop constraint if exists uploads_ingest_extraction_attempt_check;

alter table public.uploads
  add constraint uploads_ingest_extraction_state_check check (
    (
      ingest_extraction_text is null
      and ingest_extraction_text_sha256 is null
      and ingest_extraction_format is null
      and ingest_extraction_truncated is null
      and ingest_extraction_policy_version is null
      and ingest_extraction_recorded_at is null
    )
    or (
      char_length(ingest_extraction_text) between 1 and 20000
      and ingest_extraction_text_sha256 ~ '^[0-9a-f]{64}$'
      and ingest_extraction_format in ('pdf', 'docx', 'xlsx', 'text')
      and ingest_extraction_truncated is not null
      and ingest_extraction_policy_version = 'upload-resource-policy.1'
      and ingest_extraction_recorded_at is not null
    )
  ),
  add constraint uploads_ingest_extraction_attempt_check check (
    ingest_extraction_attempt_count >= 0
    and ingest_extraction_attempts_for_claim between 0 and 2
    and (
      (ingest_extraction_attempt_claim_token is null
        and ingest_extraction_attempts_for_claim = 0)
      or ingest_extraction_attempt_claim_token is not null
    )
  );

create or replace function public.begin_upload_extraction_attempt(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_attempt_for_claim smallint;
begin
  if p_upload_id is null or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null then
    raise exception 'UPLOAD_EXTRACTION_ATTEMPT_INVALID';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;

  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token
    or v_upload.status is distinct from 'processing'
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_stage is distinct from 'storage_completed'
    or v_upload.ingest_lease_expires_at <= v_now then
    raise exception 'UPLOAD_EXTRACTION_ATTEMPT_CONFLICT';
  end if;

  if v_upload.ingest_extraction_text is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'checkpoint_exists',
      'attempt_for_claim', v_upload.ingest_extraction_attempts_for_claim,
      'total_attempts', v_upload.ingest_extraction_attempt_count
    );
  end if;

  v_attempt_for_claim := case
    when v_upload.ingest_extraction_attempt_claim_token = p_claim_token
      then v_upload.ingest_extraction_attempts_for_claim + 1
    else 1
  end;
  if v_attempt_for_claim > 2 then
    raise exception 'UPLOAD_EXTRACTION_ATTEMPT_LIMIT';
  end if;

  update public.uploads
  set ingest_extraction_attempt_count = ingest_extraction_attempt_count + 1,
      ingest_extraction_attempt_claim_token = p_claim_token,
      ingest_extraction_attempts_for_claim = v_attempt_for_claim,
      ingest_heartbeat_at = v_now,
      ingest_lease_expires_at = v_now + interval '120 seconds'
  where id = p_upload_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'accepted',
    'attempt_for_claim', v_attempt_for_claim,
    'total_attempts', v_upload.ingest_extraction_attempt_count + 1,
    'retry_after_seconds', 120
  );
end;
$function$;

create or replace function public.record_upload_extraction_snapshot(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_claim_token uuid,
  p_content_sha256 text,
  p_extracted_text_sha256 text,
  p_extracted_text text,
  p_format text,
  p_truncated boolean,
  p_policy_version text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actual_text_sha256 text;
begin
  v_actual_text_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(coalesce(p_extracted_text, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  if p_upload_id is null or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_extracted_text_sha256 is null
    or p_extracted_text_sha256 !~ '^[0-9a-f]{64}$'
    or p_extracted_text_sha256 is distinct from v_actual_text_sha256
    or nullif(pg_catalog.btrim(p_extracted_text), '') is null
    or char_length(p_extracted_text) > 20000
    or p_format not in ('pdf', 'docx', 'xlsx', 'text')
    or p_truncated is null
    or p_policy_version is distinct from 'upload-resource-policy.1' then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;

  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_content_sha256 is distinct from p_content_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token
    or v_upload.status is distinct from 'processing'
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_stage is distinct from 'storage_completed'
    or v_upload.ingest_lease_expires_at <= v_now then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
  end if;

  if v_upload.ingest_extraction_text is not null then
    if v_upload.ingest_extraction_text is distinct from p_extracted_text
      or v_upload.ingest_extraction_text_sha256 is distinct from p_extracted_text_sha256
      or v_upload.ingest_extraction_format is distinct from p_format
      or v_upload.ingest_extraction_truncated is distinct from p_truncated
      or v_upload.ingest_extraction_policy_version is distinct from p_policy_version then
      raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'idempotent_replay');
  end if;

  update public.uploads
  set ingest_extraction_text = p_extracted_text,
      ingest_extraction_text_sha256 = p_extracted_text_sha256,
      ingest_extraction_format = p_format,
      ingest_extraction_truncated = p_truncated,
      ingest_extraction_policy_version = p_policy_version,
      ingest_extraction_recorded_at = v_now,
      ingest_heartbeat_at = v_now,
      ingest_lease_expires_at = v_now + interval '120 seconds'
  where id = p_upload_id;

  return pg_catalog.jsonb_build_object('outcome', 'recorded');
end;
$function$;

create or replace function public.get_upload_extraction_checkpoint(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_claim_token uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when upload_record.ingest_extraction_text is null then null
    else pg_catalog.jsonb_build_object(
      'content_sha256', upload_record.ingest_content_sha256,
      'text_sha256', upload_record.ingest_extraction_text_sha256,
      'text', upload_record.ingest_extraction_text,
      'format', upload_record.ingest_extraction_format,
      'truncated', upload_record.ingest_extraction_truncated,
      'resource_policy_version', upload_record.ingest_extraction_policy_version
    )
  end
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = p_user_id
    and upload_record.ingest_request_sha256 = p_request_sha256
    and upload_record.ingest_claim_token = p_claim_token
    and upload_record.status = 'processing'
    and upload_record.ingest_status = 'processing'
    and upload_record.ingest_stage in ('storage_completed', 'provider_dispatched')
    and upload_record.ingest_lease_expires_at > pg_catalog.statement_timestamp()
$function$;

revoke all on function public.begin_upload_extraction_attempt(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.record_upload_extraction_snapshot(
  uuid, uuid, text, uuid, text, text, text, text, boolean, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_upload_extraction_checkpoint(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.begin_upload_extraction_attempt(
  uuid, uuid, text, uuid
) to service_role;
grant execute on function public.record_upload_extraction_snapshot(
  uuid, uuid, text, uuid, text, text, text, text, boolean, text
) to service_role;
grant execute on function public.get_upload_extraction_checkpoint(
  uuid, uuid, text, uuid
) to service_role;

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
    or pg_catalog.jsonb_typeof(p_response) <> 'object'
    or p_response->>'upload_id' is distinct from p_upload_id::text
    or p_extracted_payload is null
    or pg_catalog.jsonb_typeof(p_extracted_payload) <> 'object'
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

  select upload_record.* into v_upload
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
    return pg_catalog.jsonb_build_object('outcome', 'idempotent_replay');
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
      and v_upload.ingest_stage not in (
        'storage_dispatched', 'storage_completed', 'provider_dispatched'
      )
    ) then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
  end if;

  update public.uploads
  set extracted_text = p_extracted_text,
      extracted_payload = p_extracted_payload,
      status = case when p_ingest_status = 'completed' then 'ready' else 'failed' end,
      completed_at = pg_catalog.clock_timestamp(),
      error_code = p_error_code,
      ingest_status = p_ingest_status,
      ingest_stage = 'terminal',
      ingest_http_status = p_http_status,
      ingest_response = p_response
  where id = p_upload_id;

  return pg_catalog.jsonb_build_object('outcome', 'settled');
end;
$function$;

revoke all on function public.settle_upload_ingest(
  uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.settle_upload_ingest(
  uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid
) to service_role;

comment on function public.record_upload_extraction_snapshot(
  uuid, uuid, text, uuid, text, text, text, text, boolean, text
) is 'Records one immutable parser result before provider dispatch.';

commit;
