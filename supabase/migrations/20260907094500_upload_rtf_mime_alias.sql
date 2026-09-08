-- Forward compatibility for existing empty-MIME JSON claims whose file_type is rtf.
-- Preserve the accepted v3 migration and every stored identity/checkpoint.
-- Only the two v3 RTF metadata lists change; signature, grants, replay and leases remain.

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
  p_policy_version text,
  p_extraction_contract_version text default 'upload-extraction.1',
  p_source_manifest jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_actual_text_sha256 text;
  v_manifest jsonb;
  v_manifest_sha256 text;
  v_source_contract boolean;
  v_is_v3 boolean;
  v_filename text;
  v_mime text;
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

  if found and v_upload.ingest_extraction_contract_version = 'upload-extraction.3' then
    v_now := pg_catalog.clock_timestamp();
  end if;
  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_content_sha256 is distinct from p_content_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token
    or v_upload.status is distinct from 'processing'
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_stage is distinct from 'storage_completed'
    or v_upload.ingest_lease_expires_at <= v_now
    or (v_upload.ingest_extraction_contract_version = 'upload-extraction.3'
      and v_upload.ingest_lease_expires_at is null) then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
  end if;

  v_source_contract := coalesce(v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3'),false);
  v_is_v3 := coalesce(v_upload.ingest_extraction_contract_version = 'upload-extraction.3',false);
  if p_extraction_contract_version is distinct from
      coalesce(v_upload.ingest_extraction_contract_version, 'upload-extraction.1') then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
  end if;
  if v_upload.ingest_extraction_text is not null then
    if v_upload.ingest_extraction_text is distinct from p_extracted_text
      or v_upload.ingest_extraction_text_sha256 is distinct from p_extracted_text_sha256
      or v_upload.ingest_extraction_format is distinct from p_format
      or v_upload.ingest_extraction_truncated is distinct from p_truncated
      or v_upload.ingest_extraction_policy_version is distinct from p_policy_version
      or v_upload.ingest_source_manifest is distinct from p_source_manifest then
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
    or (v_is_v3 and (p_format is null or p_format not in ('pdf','docx','xlsx','text','rtf')))
    or (not v_is_v3 and p_format not in ('pdf', 'docx', 'xlsx', 'text'))
    or p_truncated is null
    or p_policy_version is distinct from
      (case when v_is_v3 then 'upload-resource-policy.2' else 'upload-resource-policy.1' end) then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID';
  end if;

  if v_source_contract then
    if p_format is null or p_source_manifest = 'null'::jsonb then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    if v_is_v3 then
      v_filename := private.upload_source_metadata_v3(v_upload.file_name);
      v_mime := private.upload_source_metadata_v3(v_upload.file_type);
      if v_mime = 'unknown' then v_mime := 'application/octet-stream'; end if;
      if ((v_filename like '%.rtf' or pg_catalog.split_part(v_mime,';',1) in ('application/rtf','text/rtf','rtf'))
        and p_format is distinct from 'rtf')
        or ((v_filename like '%.docx' or pg_catalog.split_part(v_mime,';',1) =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          and p_format is distinct from 'docx')
        or (p_format = 'rtf' and (v_filename not like '%.rtf' or v_mime not in
          ('','application/rtf','text/rtf','rtf','application/octet-stream','binary/octet-stream'))) then
        raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
      end if;
    end if;
    -- Accepted metadata cannot be downgraded to a source-absent format.
    if (pg_catalog.lower(v_upload.file_name) like '%.docx'
      or pg_catalog.lower(pg_catalog.split_part(v_upload.file_type, ';', 1)) =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      and p_format is distinct from 'docx' then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    if p_format = 'docx' then
      v_manifest := private.normalize_upload_source_manifest(
        p_source_manifest, v_upload.ingest_content_sha256, v_upload.file_size_bytes);
      v_manifest_sha256 := private.upload_source_manifest_digest(v_manifest);
    elsif v_is_v3 and p_format = 'rtf' then
      v_manifest := private.normalize_upload_rtf_source_manifest(
        p_source_manifest,v_upload.ingest_content_sha256,v_upload.file_size_bytes,p_extracted_text);
      v_manifest_sha256 := private.upload_source_manifest_digest(v_manifest);
    elsif p_source_manifest is not null then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    if pg_catalog.cardinality(private.upload_source_utf16_units(p_extracted_text, false)) > 20000 then
      raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID';
    end if;
  elsif p_source_manifest is not null then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;

  if v_is_v3 then
    v_now := pg_catalog.clock_timestamp();
    if v_upload.ingest_lease_expires_at is null or v_upload.ingest_lease_expires_at <= v_now then
      raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
    end if;
  end if;

  update public.uploads
  set ingest_extraction_text = p_extracted_text,
      ingest_extraction_text_sha256 = p_extracted_text_sha256,
      ingest_extraction_format = p_format,
      ingest_extraction_truncated = p_truncated,
      ingest_extraction_policy_version = p_policy_version,
      ingest_extraction_recorded_at = v_now,
      ingest_source_manifest = v_manifest,
      ingest_source_manifest_sha256 = v_manifest_sha256,
      ingest_source_digest_version = case when v_manifest is not null then 'upload-source-manifest-jsonb.1' end,
      ingest_heartbeat_at = v_now,
      ingest_lease_expires_at = v_now + interval '120 seconds'
  where id = p_upload_id;

  return pg_catalog.jsonb_build_object('outcome', 'recorded');
end;
$function$;
