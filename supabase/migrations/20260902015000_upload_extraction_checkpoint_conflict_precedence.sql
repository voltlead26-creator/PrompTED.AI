begin;

-- Once an extraction checkpoint exists, every non-identical replay is an
-- immutable-state conflict. Check that boundary before validating candidate
-- replacement data so malformed replacement payloads cannot obscure the
-- authoritative checkpoint conflict.
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
  if p_upload_id is null or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$' then
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

  v_actual_text_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(coalesce(p_extracted_text, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  if p_extracted_text_sha256 is null
    or p_extracted_text_sha256 !~ '^[0-9a-f]{64}$'
    or p_extracted_text_sha256 is distinct from v_actual_text_sha256
    or nullif(pg_catalog.btrim(p_extracted_text), '') is null
    or char_length(p_extracted_text) > 20000
    or p_format not in ('pdf', 'docx', 'xlsx', 'text')
    or p_truncated is null
    or p_policy_version is distinct from 'upload-resource-policy.1' then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID';
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

revoke all on function public.record_upload_extraction_snapshot(
  uuid, uuid, text, uuid, text, text, text, text, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_upload_extraction_snapshot(
  uuid, uuid, text, uuid, text, text, text, text, boolean, text
) to service_role;

commit;
