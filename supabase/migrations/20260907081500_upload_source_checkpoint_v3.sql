-- Additive private RTF checkpoints. Existing uploads remain the sole authority.
-- Readers must be deployed before new claims explicitly request .3. The default
-- stays .1; historical accepted versions, text and terminal receipts are not rewritten.
begin;

create function private.normalize_upload_rtf_source_manifest(
  p_manifest jsonb, p_content_sha256 text, p_byte_length integer, p_extracted_text text
) returns jsonb language plpgsql immutable set search_path = '' as $function$
declare v_character text; v_point integer; v_text_sha256 text;
begin
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_byte_length is null or p_byte_length not between 1 and 1048576
    or p_extracted_text is null or char_length(p_extracted_text) > 20000
    or p_manifest is null or pg_catalog.octet_length(p_manifest::text) > 2048
    or not private.jsonb_has_exact_keys(p_manifest, array['version','assessment',
      'originalSha256','originalByteLength','extractedTextSha256','blockers'])
    or p_manifest->'version' is distinct from '"rtf-source-manifest.1"'::jsonb
    or p_manifest->'assessment' is distinct from '"source_only"'::jsonb
    or p_manifest->'originalSha256' is distinct from pg_catalog.to_jsonb(p_content_sha256)
    or p_manifest->'originalByteLength' is distinct from pg_catalog.to_jsonb(p_byte_length)
    or p_manifest->'blockers' is distinct from '["rtf-format-preserving-editing-unverified"]'::jsonb then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  -- Match the RTF normalizer's permitted Unicode scalars, not the broader XML
  -- rules. PostgreSQL UTF8 text already rejects NUL and unpaired surrogates.
  for v_character in select pg_catalog.regexp_split_to_table(p_extracted_text, '') loop
    if v_character = '' then continue; end if;
    v_point := pg_catalog.ascii(v_character);
    if (v_point < 32 and v_point not in (9,10)) or v_point between 127 and 159
      or v_point between 55296 and 57343 or v_point in (65534,65535) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
  end loop;
  if pg_catalog.cardinality(private.upload_source_utf16_units(p_extracted_text, false)) > 20000 then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  v_text_sha256 := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_extracted_text,'UTF8'),'sha256'),'hex');
  if p_manifest->'extractedTextSha256' is distinct from pg_catalog.to_jsonb(v_text_sha256) then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  -- Normalize integral JSON spelling before the existing database-owned digest.
  return pg_catalog.jsonb_build_object('version','rtf-source-manifest.1',
    'assessment','source_only','originalSha256',p_content_sha256,
    'originalByteLength',p_byte_length,'extractedTextSha256',v_text_sha256,
    'blockers',pg_catalog.jsonb_build_array('rtf-format-preserving-editing-unverified'));
end;
$function$;
revoke all on function private.normalize_upload_rtf_source_manifest(jsonb,text,integer,text)
  from public, anon, authenticated, service_role;

-- Match NFKC + ECMAScript trim for metadata; only ASCII case is significant in
-- the supported extension/MIME vocabulary. Source wording is never normalized.
create function private.upload_source_metadata_v3(p_value text)
returns text language sql immutable strict set search_path = '' as $function$
  select pg_catalog.translate(pg_catalog.btrim(normalize(p_value,NFKC),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
$function$;
revoke all on function private.upload_source_metadata_v3(text)
  from public, anon, authenticated, service_role;



create or replace function private.upload_public_result_is_source_free(p_value jsonb, p_depth integer)
returns boolean language plpgsql immutable set search_path = '' as $function$
begin
  if p_value is null or p_depth is null or p_depth < 0 or p_depth > 24
    or pg_catalog.octet_length(p_value::text) > 2097152 then return false; end if;
  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    if p_value ?| array['source_manifest', 'sourceManifest', 'ingest_source_manifest',
      'source_manifest_sha256', 'ingest_source_manifest_sha256', 'source_digest_version',
      'ingest_source_digest_version', 'archiveSha256', 'partRosterSha256',
      'originalSha256', 'originalByteLength', 'extractedTextSha256'] then return false; end if;
    return not exists (select 1 from pg_catalog.jsonb_each(p_value) item
      where not private.upload_public_result_is_source_free(item.value, p_depth + 1));
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    return not exists (select 1 from pg_catalog.jsonb_array_elements(p_value) item(value)
      where not private.upload_public_result_is_source_free(item.value, p_depth + 1));
  end if;
  return true;
end;
$function$;

-- Retain the literal historical predicates under the non-v3 branch.
alter table public.uploads
  drop constraint uploads_extraction_contract_version_check,
  drop constraint uploads_ingest_extraction_state_check,
  drop constraint uploads_source_checkpoint_v2_check;
alter table public.uploads
  add constraint uploads_extraction_contract_version_check check (
    ingest_extraction_contract_version is null or ingest_extraction_contract_version
      in ('upload-extraction.1','upload-extraction.2','upload-extraction.3')),
  add constraint uploads_ingest_extraction_state_check check (
    case when ingest_extraction_contract_version = 'upload-extraction.3' then (
      (ingest_extraction_text is null and ingest_extraction_text_sha256 is null
        and ingest_extraction_format is null and ingest_extraction_truncated is null
        and ingest_extraction_policy_version is null and ingest_extraction_recorded_at is null)
      or
      (char_length(ingest_extraction_text) between 1 and 20000
        and ingest_extraction_text_sha256 ~ '^[0-9a-f]{64}$'
        and ingest_extraction_format in ('pdf','docx','xlsx','text','rtf')
        and ingest_extraction_truncated is not null
        and ingest_extraction_policy_version = 'upload-resource-policy.2'
        and ingest_extraction_recorded_at is not null)
    ) is true
    else (
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
    )) end),
  add constraint uploads_source_checkpoint_v2_check check (
    case when ingest_extraction_contract_version = 'upload-extraction.3' then (
      (ingest_extraction_text is null and ingest_extraction_text_sha256 is null
        and ingest_extraction_format is null and ingest_extraction_truncated is null
        and ingest_extraction_policy_version is null and ingest_extraction_recorded_at is null
        and ingest_source_manifest is null and ingest_source_manifest_sha256 is null
        and ingest_source_digest_version is null)
      or
      (ingest_extraction_text is not null and pg_catalog.btrim(ingest_extraction_text) <> ''
        and ingest_extraction_text_sha256 is not null
        and ingest_extraction_text_sha256 = pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(ingest_extraction_text,'UTF8'),'sha256'),'hex')
        and ingest_extraction_format is not null
        and ingest_extraction_format in ('pdf','docx','xlsx','text','rtf')
        and ingest_extraction_truncated is not null
        and ingest_extraction_policy_version = 'upload-resource-policy.2'
        and ingest_extraction_recorded_at is not null
        and case when ingest_extraction_format in ('docx','rtf') then
          ingest_source_manifest is not null
          and pg_catalog.jsonb_typeof(ingest_source_manifest) = 'object'
          and ingest_source_manifest->'assessment' = '"source_only"'::jsonb
          and ingest_source_manifest_sha256 is not null
          and ingest_source_manifest_sha256 = private.upload_source_manifest_digest(ingest_source_manifest)
          and ingest_source_digest_version = 'upload-source-manifest-jsonb.1'
          and case when ingest_extraction_format = 'rtf' then
            ingest_source_manifest = private.normalize_upload_rtf_source_manifest(
              ingest_source_manifest,ingest_content_sha256,file_size_bytes,ingest_extraction_text)
          else
            ingest_source_manifest->'archiveSha256' = pg_catalog.to_jsonb(ingest_content_sha256)
            and ingest_source_manifest->'archiveByteLength' = pg_catalog.to_jsonb(file_size_bytes)
          end
        else ingest_source_manifest is null and ingest_source_manifest_sha256 is null
          and ingest_source_digest_version is null
        end
      )
    ) is true
    else (
    case when ingest_extraction_contract_version = 'upload-extraction.2' then
      (
        (ingest_extraction_text is null and ingest_extraction_text_sha256 is null
          and ingest_extraction_format is null and ingest_extraction_truncated is null
          and ingest_extraction_policy_version is null and ingest_extraction_recorded_at is null
          and ingest_source_manifest is null and ingest_source_manifest_sha256 is null
          and ingest_source_digest_version is null)
        or
        (ingest_extraction_text is not null and pg_catalog.btrim(ingest_extraction_text) <> ''
          and ingest_extraction_text_sha256 is not null
          and ingest_extraction_text_sha256 = pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(ingest_extraction_text, 'UTF8'), 'sha256'), 'hex')
          and ingest_extraction_format is not null
          and ingest_extraction_format in ('pdf', 'docx', 'xlsx', 'text')
          and ingest_extraction_truncated is not null
          and ingest_extraction_policy_version = 'upload-resource-policy.1'
          and ingest_extraction_recorded_at is not null
          and (
            (ingest_extraction_format = 'docx' and ingest_source_manifest is not null
              and pg_catalog.jsonb_typeof(ingest_source_manifest) = 'object'
              and ingest_source_manifest->'archiveSha256' = pg_catalog.to_jsonb(ingest_content_sha256)
              and ingest_source_manifest->'archiveByteLength' = pg_catalog.to_jsonb(file_size_bytes)
              and ingest_source_manifest->'assessment' = '"source_only"'::jsonb
              and ingest_source_manifest_sha256 is not null
              and ingest_source_manifest_sha256 = private.upload_source_manifest_digest(ingest_source_manifest)
              and ingest_source_digest_version = 'upload-source-manifest-jsonb.1')
            or
            (ingest_extraction_format <> 'docx' and ingest_source_manifest is null
              and ingest_source_manifest_sha256 is null and ingest_source_digest_version is null)
          )
        )
      ) is true
    else ingest_source_manifest is null and ingest_source_manifest_sha256 is null
      and ingest_source_digest_version is null
    end) end);


create or replace function private.protect_upload_source_checkpoint()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.ingest_extraction_contract_version is distinct from old.ingest_extraction_contract_version then
    raise exception 'UPLOAD_EXTRACTION_CONTRACT_IMMUTABLE';
  end if;
  if old.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
    and old.ingest_extraction_text is not null and (
      new.ingest_extraction_text is distinct from old.ingest_extraction_text
      or new.ingest_extraction_text_sha256 is distinct from old.ingest_extraction_text_sha256
      or new.ingest_extraction_format is distinct from old.ingest_extraction_format
      or new.ingest_extraction_truncated is distinct from old.ingest_extraction_truncated
      or new.ingest_extraction_policy_version is distinct from old.ingest_extraction_policy_version
      or new.ingest_extraction_recorded_at is distinct from old.ingest_extraction_recorded_at
      or new.ingest_source_manifest is distinct from old.ingest_source_manifest
      or new.ingest_source_manifest_sha256 is distinct from old.ingest_source_manifest_sha256
      or new.ingest_source_digest_version is distinct from old.ingest_source_digest_version
      or new.ingest_content_sha256 is distinct from old.ingest_content_sha256
      or new.file_size_bytes is distinct from old.file_size_bytes
    ) then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
  end if;
  return new;
end;
$function$;

create or replace function public.claim_upload_ingest(
  p_upload_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_file_type text,
  p_file_name text,
  p_file_size_bytes integer,
  p_request_sha256 text,
  p_content_sha256 text,
  p_extraction_contract_version text default 'upload-extraction.1'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_insert_now timestamptz := v_now;
  v_claim_token uuid := extensions.gen_random_uuid();
begin
  if p_extraction_contract_version is null
    or p_extraction_contract_version not in ('upload-extraction.1', 'upload-extraction.2', 'upload-extraction.3')
    or p_upload_id is null
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

  if p_extraction_contract_version = 'upload-extraction.3' then
    v_insert_now := pg_catalog.clock_timestamp();
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
    ingest_lease_expires_at,
    ingest_extraction_contract_version
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
    v_insert_now,
    v_insert_now + interval '120 seconds',
    p_extraction_contract_version
  )
  on conflict do nothing
  returning * into v_upload;

  if found then
    return jsonb_build_object(
      'outcome', 'accepted',
      'stage', 'prepared',
      'claim_token', v_claim_token
    ) || case when v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
      then pg_catalog.jsonb_build_object('extraction_contract_version', v_upload.ingest_extraction_contract_version)
      else '{}'::jsonb end;
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

  if v_upload.ingest_extraction_contract_version = 'upload-extraction.3' then
    v_now := pg_catalog.clock_timestamp();
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
      ) || case when v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
      then pg_catalog.jsonb_build_object('extraction_contract_version', v_upload.ingest_extraction_contract_version)
      else '{}'::jsonb end;
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
      ) || case when v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
      then pg_catalog.jsonb_build_object('extraction_contract_version', v_upload.ingest_extraction_contract_version)
      else '{}'::jsonb end;
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

create or replace function public.load_upload_extraction_snapshot(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_claim_token uuid
) returns jsonb
language plpgsql
stable
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
    or p_claim_token is null then
    return null;
  end if;

  select upload_record.*
  into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = p_user_id
    and upload_record.status = 'processing'
    and upload_record.ingest_status = 'processing'
    and upload_record.ingest_stage in (
      'storage_completed', 'provider_dispatched'
    )
    and upload_record.ingest_request_sha256 = p_request_sha256
    and upload_record.ingest_claim_token = p_claim_token
    and upload_record.ingest_lease_expires_at > pg_catalog.statement_timestamp();

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'upload_id', v_upload.id,
    'user_id', v_upload.user_id,
    'request_sha256', v_upload.ingest_request_sha256,
    'claim_token', v_upload.ingest_claim_token,
    'storage_path', v_upload.storage_path,
    'filename', v_upload.file_name,
    'file_type', v_upload.file_type,
    'byte_length', v_upload.file_size_bytes,
    'content_sha256', v_upload.ingest_content_sha256,
    'stage', v_upload.ingest_stage
  ) || case when v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
      then pg_catalog.jsonb_build_object('extraction_contract_version', v_upload.ingest_extraction_contract_version)
      else '{}'::jsonb end;
end;
$function$;

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

  if found and v_upload.ingest_extraction_contract_version = 'upload-extraction.3' then
    v_now := pg_catalog.clock_timestamp();
  end if;
  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token
    or v_upload.status is distinct from 'processing'
    or v_upload.ingest_status is distinct from 'processing'
    or v_upload.ingest_stage is distinct from 'storage_completed'
    or v_upload.ingest_lease_expires_at <= v_now
    or (v_upload.ingest_extraction_contract_version = 'upload-extraction.3'
      and v_upload.ingest_lease_expires_at is null) then
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
      if ((v_filename like '%.rtf' or pg_catalog.split_part(v_mime,';',1) in ('application/rtf','text/rtf'))
        and p_format is distinct from 'rtf')
        or ((v_filename like '%.docx' or pg_catalog.split_part(v_mime,';',1) =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          and p_format is distinct from 'docx')
        or (p_format = 'rtf' and (v_filename not like '%.rtf' or v_mime not in
          ('','application/rtf','text/rtf','application/octet-stream','binary/octet-stream'))) then
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
    ) || case when upload_record.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
      then pg_catalog.jsonb_build_object(
        'extraction_contract_version', upload_record.ingest_extraction_contract_version,
        'content_byte_length', upload_record.file_size_bytes,
        'source_manifest', upload_record.ingest_source_manifest,
        'source_manifest_sha256', upload_record.ingest_source_manifest_sha256,
        'source_digest_version', upload_record.ingest_source_digest_version)
      else '{}'::jsonb end
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
  -- V2/v3 lease validity and renewal use the time after both locks are held.
  -- Historical v1 transition/replay timing remains unchanged.
  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3') then
    v_now := pg_catalog.clock_timestamp();
  end if;
  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
    and p_next_stage = 'provider_dispatched'
    and (v_upload.ingest_extraction_text is null
      or v_upload.ingest_extraction_recorded_at is null
      or v_upload.ingest_lease_expires_at is null
      or v_upload.ingest_lease_expires_at <= v_now) then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED';
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

  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3') and (
    not private.upload_public_result_is_source_free(p_response, 0)
    or not private.upload_public_result_is_source_free(p_extracted_payload, 0)
    or (p_ingest_status = 'completed' and (
      not private.jsonb_has_exact_keys(p_response, array['upload_id', 'extracted_text',
        'original_retained', 'storage_path', 'classification_status', 'extraction_format',
        'resource_policy_version', 'confirm_payload'])
      or not private.jsonb_has_exact_keys(p_extracted_payload, array['truncated',
        'original_retained', 'classification_status', 'extraction_format', 'resource_policy_version'])
      or not private.jsonb_has_exact_keys(p_response->'confirm_payload', array['summary',
        'document_type', 'structure', 'filename', 'char_count', 'truncated'])
      or exists (select 1 from pg_catalog.jsonb_array_elements(case
        when pg_catalog.jsonb_typeof(p_response#>'{confirm_payload,structure}') = 'array'
        then p_response#>'{confirm_payload,structure}' else '[]'::jsonb end) item(value)
        where not private.jsonb_has_exact_keys(item.value, array['title', 'items']))
    ))
  ) then
    raise exception 'UPLOAD_INGEST_SOURCE_PRIVACY_INVALID';
  end if;
  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
    and p_ingest_status = 'completed' and (
      v_upload.ingest_extraction_text is null
      or p_extracted_text is distinct from v_upload.ingest_extraction_text
      or p_response->'storage_path' is distinct from pg_catalog.to_jsonb(v_upload.storage_path)
      or p_response#>'{confirm_payload,filename}' is distinct from pg_catalog.to_jsonb(v_upload.file_name)
      or p_response#>'{confirm_payload,char_count}' is distinct from pg_catalog.to_jsonb(
        pg_catalog.cardinality(private.upload_source_utf16_units(v_upload.ingest_extraction_text, false)))
      or p_response->'extracted_text' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_text)
      or p_response->'extraction_format' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_format)
      or p_extracted_payload->'extraction_format' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_format)
      or p_response->'resource_policy_version' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_policy_version)
      or p_extracted_payload->'resource_policy_version' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_policy_version)
      or p_response#>'{confirm_payload,truncated}' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_truncated)
      or p_extracted_payload->'truncated' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_truncated)
    ) then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
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

revoke all on function public.claim_upload_ingest(uuid, uuid, text, text, text, integer, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.claim_upload_ingest(uuid, uuid, text, text, text, integer, text, text, text) to service_role;

revoke all on function public.record_upload_extraction_snapshot(uuid, uuid, text, uuid, text, text, text, text, boolean, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_upload_extraction_snapshot(uuid, uuid, text, uuid, text, text, text, text, boolean, text, text, jsonb) to service_role;

revoke all on function public.load_upload_extraction_snapshot(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.load_upload_extraction_snapshot(uuid, uuid, text, uuid) to service_role;

revoke all on function public.get_upload_extraction_checkpoint(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_upload_extraction_checkpoint(uuid, uuid, text, uuid) to service_role;

revoke all on function public.advance_upload_ingest(uuid, uuid, text, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.advance_upload_ingest(uuid, uuid, text, uuid, text, text) to service_role;

revoke all on function public.settle_upload_ingest(uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.settle_upload_ingest(uuid, uuid, text, text, integer, jsonb, text, jsonb, text, uuid) to service_role;

revoke all on function public.begin_upload_extraction_attempt(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_upload_extraction_attempt(uuid,uuid,text,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
