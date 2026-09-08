-- Private upload extraction .2: compatible source retention, not edit approval.
-- Existing uploads/checkpoints/originals remain the only persistence authority.
begin;

alter table public.uploads
  add column ingest_extraction_contract_version text,
  add column ingest_source_manifest jsonb,
  add column ingest_source_manifest_sha256 text,
  add column ingest_source_digest_version text;

-- JSON numbers are normalized before storage/digest. JSONB equality ignores
-- trailing numeric zeroes, whereas JSONB::text retains them.
create function private.upload_source_integer(p_value jsonb, p_max bigint)
returns bigint language plpgsql immutable set search_path = '' as $function$
declare v_number numeric;
begin
  if p_max is null or p_max < 0
    or pg_catalog.jsonb_typeof(p_value) is distinct from 'number' then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  v_number := p_value::text::numeric;
  if v_number < 0 or v_number > p_max or v_number <> pg_catalog.trunc(v_number) then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  return v_number::bigint;
end;
$function$;

-- Match JavaScript UTF-16 lengths/order, including supplementary characters.
-- Only paths (512 bytes) and already byte-bounded node text use this helper.
create function private.upload_source_utf16_units(p_text text, p_xml boolean)
returns integer[] language plpgsql immutable set search_path = '' as $function$
declare v_units integer[] := array[]::integer[]; v_character text; v_point integer;
begin
  if p_xml is null or p_text is null or pg_catalog.octet_length(p_text) > 1048576 then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  for v_character in select pg_catalog.regexp_split_to_table(p_text, '') loop
    if v_character = '' then continue; end if;
    v_point := pg_catalog.ascii(v_character);
    if p_xml and ((v_point < 32 and v_point not in (9, 10, 13))
      or v_point in (65534, 65535)) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    if v_point > 65535 then
      v_units := pg_catalog.array_append(v_units, 55296 + (v_point - 65536) / 1024);
      v_units := pg_catalog.array_append(v_units, 56320 + (v_point - 65536) % 1024);
    else
      v_units := pg_catalog.array_append(v_units, v_point);
    end if;
  end loop;
  return v_units;
end;
$function$;

-- Whitespace-free serialization for the existing manifest byte budget only.
-- This is deliberately separate from the database-owned digest encoding.
create function private.upload_source_compact_json(p_value jsonb, p_depth integer)
returns text language plpgsql immutable set search_path = '' as $function$
declare v_result text;
begin
  if p_depth is null or p_depth < 0 or p_depth > 8 or p_value is null then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(pg_catalog.string_agg(
        pg_catalog.to_jsonb(item.key)::text || ':' ||
        private.upload_source_compact_json(item.value, p_depth + 1),
        ',' order by item.key collate "C"), '') || '}' into v_result
      from pg_catalog.jsonb_each(p_value) item;
    when 'array' then
      select '[' || coalesce(pg_catalog.string_agg(
        private.upload_source_compact_json(item.value, p_depth + 1),
        ',' order by item.ordinality), '') || ']' into v_result
      from pg_catalog.jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    else v_result := p_value::text;
  end case;
  return v_result;
end;
$function$;

create function private.normalize_upload_source_manifest(
  p_manifest jsonb, p_content_sha256 text, p_byte_length integer
) returns jsonb language plpgsql immutable set search_path = '' as $function$
declare
  v_part jsonb; v_parts jsonb[] := array[]::jsonb[];
  v_main jsonb; v_source jsonb; v_node jsonb; v_nodes jsonb[] := array[]::jsonb[];
  v_path text; v_paths text[] := array[]::text[]; v_path_key integer[];
  v_previous_path integer[]; v_method bigint; v_compressed bigint; v_inflated bigint;
  v_crc bigint; v_total_compressed bigint := 0; v_total_inflated bigint := 0;
  v_roster text := '["office-part-roster-json.1",['; v_roster_sha text;
  v_blocker text; v_previous_blocker text; v_expected_blockers text[];
  v_word_blockers text[] := array[]::text[];
  v_allowed_word_blockers constant text[] := array[
    'unreviewed_attribute_semantics', 'foreign_element_semantics',
    'dynamic_or_revision_content', 'unreviewed_structure',
    'unmapped_character_content', 'processing_instruction'];
  v_ordinal integer; v_seen boolean[]; v_start bigint; v_end bigint;
  v_previous_end bigint := 0; v_text_length integer; v_total_text integer := 0;
  v_result jsonb;
begin
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_byte_length is null or p_byte_length not between 1 and 8388608
    or p_manifest is null or pg_catalog.octet_length(p_manifest::text) > 2097152
    or not private.jsonb_has_exact_keys(p_manifest, array[
      'version', 'assessment', 'archiveSha256', 'archiveByteLength',
      'rosterEncodingVersion', 'partRosterSha256', 'parts', 'mainPart', 'blockers'])
    or p_manifest->'version' is distinct from '"docx-source-manifest.1"'::jsonb
    or p_manifest->'assessment' is distinct from '"source_only"'::jsonb
    or p_manifest->'archiveSha256' is distinct from pg_catalog.to_jsonb(p_content_sha256)
    or p_manifest->'archiveByteLength' is distinct from pg_catalog.to_jsonb(p_byte_length)
    or p_manifest->'rosterEncodingVersion' is distinct from '"office-part-roster-json.1"'::jsonb
    or pg_catalog.jsonb_typeof(p_manifest->'partRosterSha256') is distinct from 'string'
    or (p_manifest->>'partRosterSha256') !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_manifest->'parts') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_manifest->'blockers') is distinct from 'array' then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(p_manifest->'parts') not between 3 and 512 then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  for v_part in select value from pg_catalog.jsonb_array_elements(p_manifest->'parts') loop
    if not private.jsonb_has_exact_keys(v_part, array[
      'path', 'compressionMethod', 'compressedByteLength', 'uncompressedByteLength',
      'crc32', 'contentSha256'])
      or pg_catalog.jsonb_typeof(v_part->'path') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_part->'contentSha256') is distinct from 'string'
      or (v_part->>'contentSha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_path := v_part->>'path';
    if pg_catalog.octet_length(v_path) not between 1 and 512
      or v_path like '/%' or pg_catalog.strpos(v_path, E'\\') > 0
      or exists (select 1 from pg_catalog.unnest(pg_catalog.string_to_array(
        case when pg_catalog.right(v_path, 1) = '/' then pg_catalog.left(v_path, -1) else v_path end, '/'
      )) segment where segment in ('', '.', '..')) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_path_key := private.upload_source_utf16_units(v_path, false);
    if v_previous_path is not null and v_previous_path >= v_path_key then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_previous_path := v_path_key;
    -- Exact paths and ASCII case collisions are defended here. Full Unicode
    -- NFC/en-US collision semantics remain in the existing source normalizer
    -- both before recording and after reading, not a database-locale guess.
    if pg_catalog.translate(v_path, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') = any(v_paths) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_paths := pg_catalog.array_append(v_paths,
      pg_catalog.translate(v_path, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'));
    v_method := private.upload_source_integer(v_part->'compressionMethod', 8);
    v_compressed := private.upload_source_integer(v_part->'compressedByteLength', p_byte_length);
    v_inflated := private.upload_source_integer(v_part->'uncompressedByteLength', 8388608);
    v_crc := private.upload_source_integer(v_part->'crc32', 4294967295);
    if v_method not in (0, 8) or (v_method = 0 and v_compressed <> v_inflated)
      or (v_compressed = 0 and v_inflated > 0)
      or (v_inflated > 1048576 and v_inflated > v_compressed * 100)
      or (v_inflated = 0 and (v_crc <> 0 or v_part->>'contentSha256' <>
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_total_compressed := v_total_compressed + v_compressed;
    v_total_inflated := v_total_inflated + v_inflated;
    if v_total_compressed > p_byte_length or v_total_inflated > 16777216 then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_part := pg_catalog.jsonb_build_object('path', v_path,
      'compressionMethod', v_method, 'compressedByteLength', v_compressed,
      'uncompressedByteLength', v_inflated, 'crc32', v_crc,
      'contentSha256', v_part->>'contentSha256');
    if pg_catalog.cardinality(v_parts) > 0 then v_roster := v_roster || ','; end if;
    v_roster := v_roster || '[' || pg_catalog.to_jsonb(v_path)::text || ',' ||
      v_method::text || ',' || v_compressed::text || ',' || v_inflated::text || ',' ||
      v_crc::text || ',' || (v_part->'contentSha256')::text || ']';
    v_parts := pg_catalog.array_append(v_parts, v_part);
    if v_path = 'word/document.xml' then v_main := v_part; end if;
  end loop;
  v_roster := v_roster || ']]';
  v_roster_sha := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_roster, 'UTF8'), 'sha256'), 'hex');
  if v_roster_sha is distinct from p_manifest->>'partRosterSha256'
    or v_main is null or (v_main->>'uncompressedByteLength')::bigint = 0
    or not exists (select 1 from pg_catalog.unnest(v_parts) part where part->>'path' = '[Content_Types].xml')
    or not exists (select 1 from pg_catalog.unnest(v_parts) part where part->>'path' = '_rels/.rels')
    or not private.jsonb_has_exact_keys(p_manifest->'mainPart', array['path', 'source'])
    or p_manifest#>'{mainPart,path}' is distinct from '"word/document.xml"'::jsonb then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  v_source := p_manifest#>'{mainPart,source}';
  if not private.jsonb_has_exact_keys(v_source, array['version', 'originalSha256', 'assessment', 'blockers', 'nodes'])
    or v_source->'version' is distinct from '"word-xml-source.1"'::jsonb
    or v_source->'assessment' is distinct from '"source_only"'::jsonb
    or v_source->'originalSha256' is distinct from v_main->'contentSha256'
    or pg_catalog.jsonb_typeof(v_source->'blockers') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_source->'nodes') is distinct from 'array' then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(v_source->'blockers') > 6
    or pg_catalog.jsonb_array_length(v_source->'nodes') > 20000 then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  for v_node in select value from pg_catalog.jsonb_array_elements(v_source->'blockers') loop
    v_blocker := v_node #>> '{}';
    if pg_catalog.jsonb_typeof(v_node) is distinct from 'string'
      or not (v_blocker = any(v_allowed_word_blockers))
      or (v_previous_blocker is not null and v_previous_blocker collate "C" >= v_blocker collate "C") then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_word_blockers := pg_catalog.array_append(v_word_blockers, v_blocker);
    v_previous_blocker := v_blocker;
  end loop;
  v_seen := pg_catalog.array_fill(false, array[pg_catalog.jsonb_array_length(v_source->'nodes')]);
  for v_node in select value from pg_catalog.jsonb_array_elements(v_source->'nodes') loop
    if not private.jsonb_has_exact_keys(v_node, array['id', 'text', 'start', 'end', 'xmlSpace', 'lexicallyPatchable'])
      or pg_catalog.jsonb_typeof(v_node->'id') is distinct from 'string'
      or (v_node->>'id') !~ '^t:[1-9][0-9]{0,4}$'
      or pg_catalog.jsonb_typeof(v_node->'text') is distinct from 'string'
      or pg_catalog.jsonb_typeof(v_node->'lexicallyPatchable') is distinct from 'boolean'
      or v_node->'xmlSpace' not in ('"default"'::jsonb, '"preserve"'::jsonb) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_ordinal := pg_catalog.substr(v_node->>'id', 3)::integer;
    if v_ordinal > pg_catalog.jsonb_array_length(v_source->'nodes') or v_seen[v_ordinal] then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    v_seen[v_ordinal] := true;
    v_text_length := pg_catalog.cardinality(private.upload_source_utf16_units(v_node->>'text', true));
    v_total_text := v_total_text + v_text_length;
    if v_total_text > 1048576 then raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID'; end if;
    v_start := case when v_node->'start' = 'null'::jsonb then null else
      private.upload_source_integer(v_node->'start', (v_main->>'uncompressedByteLength')::bigint) end;
    v_end := case when v_node->'end' = 'null'::jsonb then null else
      private.upload_source_integer(v_node->'end', (v_main->>'uncompressedByteLength')::bigint) end;
    if (v_start is null) <> (v_end is null)
      or ((v_node->>'lexicallyPatchable')::boolean and v_start is null)
      or (v_start is not null and (v_end <= v_start or v_start < v_previous_end
        or v_text_length = 0 or v_text_length > v_end - v_start)) then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    if v_end is not null then v_previous_end := v_end; end if;
    v_nodes := pg_catalog.array_append(v_nodes, v_node || pg_catalog.jsonb_build_object('start', v_start, 'end', v_end));
  end loop;
  v_expected_blockers := v_word_blockers || array[
    'package_semantics_unassessed', 'styles_and_visibility_unassessed', 'layout_unassessed'];
  if exists (select 1 from pg_catalog.unnest(v_parts) part
    where part->>'path' ~ '^word/(header[0-9]+|footer[0-9]+|footnotes|endnotes)[.]xml$') then
    v_expected_blockers := pg_catalog.array_append(v_expected_blockers, 'non_main_wording_unmapped');
  end if;
  if exists (select 1 from pg_catalog.unnest(v_parts) part
    where part->>'path' ~* '^_xmlsignatures/') then
    v_expected_blockers := pg_catalog.array_append(v_expected_blockers, 'digital_signature_parts_present');
  end if;
  select pg_catalog.array_agg(blocker order by blocker collate "C") into v_expected_blockers
    from pg_catalog.unnest(v_expected_blockers) blocker;
  if p_manifest->'blockers' is distinct from pg_catalog.to_jsonb(v_expected_blockers) then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  v_result := p_manifest || pg_catalog.jsonb_build_object(
    'archiveByteLength', p_byte_length, 'parts', pg_catalog.to_jsonb(v_parts),
    'mainPart', pg_catalog.jsonb_build_object('path', 'word/document.xml',
      'source', v_source || pg_catalog.jsonb_build_object('nodes', pg_catalog.to_jsonb(v_nodes))));
  if pg_catalog.octet_length(private.upload_source_compact_json(v_result, 0)) > 1048576 then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
  end if;
  return v_result;
end;
$function$;

create function private.upload_source_manifest_digest(p_manifest jsonb)
returns text language sql immutable strict set search_path = '' as $function$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'upload-source-manifest-jsonb.1' || E'\n' || p_manifest::text, 'UTF8'), 'sha256'), 'hex')
$function$;

revoke all on function private.upload_source_integer(jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function private.upload_source_utf16_units(text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.upload_source_compact_json(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function private.normalize_upload_source_manifest(jsonb, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.upload_source_manifest_digest(jsonb) from public, anon, authenticated, service_role;

-- Extensible failure envelopes must not acquire private source/checkpoint
-- fields. Complete success envelopes additionally use exact public key sets.
create function private.upload_public_result_is_source_free(p_value jsonb, p_depth integer)
returns boolean language plpgsql immutable set search_path = '' as $function$
begin
  if p_value is null or p_depth is null or p_depth < 0 or p_depth > 24
    or pg_catalog.octet_length(p_value::text) > 2097152 then return false; end if;
  if pg_catalog.jsonb_typeof(p_value) = 'object' then
    if p_value ?| array['source_manifest', 'sourceManifest', 'ingest_source_manifest',
      'source_manifest_sha256', 'ingest_source_manifest_sha256', 'source_digest_version',
      'ingest_source_digest_version', 'archiveSha256', 'partRosterSha256'] then return false; end if;
    return not exists (select 1 from pg_catalog.jsonb_each(p_value) item
      where not private.upload_public_result_is_source_free(item.value, p_depth + 1));
  elsif pg_catalog.jsonb_typeof(p_value) = 'array' then
    return not exists (select 1 from pg_catalog.jsonb_array_elements(p_value) item(value)
      where not private.upload_public_result_is_source_free(item.value, p_depth + 1));
  end if;
  return true;
end;
$function$;
revoke all on function private.upload_public_result_is_source_free(jsonb, integer)
  from public, anon, authenticated, service_role;


alter table public.uploads
  add constraint uploads_extraction_contract_version_check check (
    ingest_extraction_contract_version is null
    or ingest_extraction_contract_version in ('upload-extraction.1', 'upload-extraction.2')
  ),
  add constraint uploads_source_checkpoint_v2_check check (
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
    end
  );

create function private.protect_upload_source_checkpoint()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if new.ingest_extraction_contract_version is distinct from old.ingest_extraction_contract_version then
    raise exception 'UPLOAD_EXTRACTION_CONTRACT_IMMUTABLE';
  end if;
  if old.ingest_extraction_contract_version = 'upload-extraction.2'
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
revoke all on function private.protect_upload_source_checkpoint() from public, anon, authenticated, service_role;
create trigger protect_upload_source_checkpoint
  before update on public.uploads for each row
  execute function private.protect_upload_source_checkpoint();

comment on column public.uploads.ingest_extraction_contract_version is
  'Accepted once on claim; historical null is upload-extraction.1 and is never backfilled on retry.';
comment on column public.uploads.ingest_source_manifest is
  'Private source_only mapping for the immutable retained original; not editor content or layout approval.';
comment on column public.uploads.ingest_source_manifest_sha256 is
  'Server-owned normalized JSONB digest; distinct from archive and compact part-roster hashes.';


-- Replace only the two exact old signatures. RESTRICT catches dependencies;
-- keep one overload, with trailing defaults for positional/named old callers.
drop function public.claim_upload_ingest(uuid, uuid, text, text, text, integer, text, text) restrict;
drop function public.record_upload_extraction_snapshot(uuid, uuid, text, uuid, text, text, text, text, boolean, text) restrict;

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
  v_claim_token uuid := extensions.gen_random_uuid();
begin
  if p_extraction_contract_version is null
    or p_extraction_contract_version not in ('upload-extraction.1', 'upload-extraction.2')
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
    v_now,
    v_now + interval '120 seconds',
    p_extraction_contract_version
  )
  on conflict do nothing
  returning * into v_upload;

  if found then
    return jsonb_build_object(
      'outcome', 'accepted',
      'stage', 'prepared',
      'claim_token', v_claim_token
    ) || case when v_upload.ingest_extraction_contract_version = 'upload-extraction.2'
      then pg_catalog.jsonb_build_object('extraction_contract_version', 'upload-extraction.2')
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
      ) || case when v_upload.ingest_extraction_contract_version = 'upload-extraction.2'
      then pg_catalog.jsonb_build_object('extraction_contract_version', 'upload-extraction.2')
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
      ) || case when v_upload.ingest_extraction_contract_version = 'upload-extraction.2'
      then pg_catalog.jsonb_build_object('extraction_contract_version', 'upload-extraction.2')
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
  ) || case when v_upload.ingest_extraction_contract_version = 'upload-extraction.2'
      then pg_catalog.jsonb_build_object('extraction_contract_version', 'upload-extraction.2')
      else '{}'::jsonb end;
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
  v_is_v2 boolean;
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

  v_is_v2 := v_upload.ingest_extraction_contract_version = 'upload-extraction.2';
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
    or p_format not in ('pdf', 'docx', 'xlsx', 'text')
    or p_truncated is null
    or p_policy_version is distinct from 'upload-resource-policy.1' then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID';
  end if;

  if v_is_v2 then
    if p_format is null or p_source_manifest = 'null'::jsonb then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
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
    elsif p_source_manifest is not null then
      raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
    end if;
    if pg_catalog.cardinality(private.upload_source_utf16_units(p_extracted_text, false)) > 20000 then
      raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_INVALID';
    end if;
  elsif p_source_manifest is not null then
    raise exception 'UPLOAD_SOURCE_MANIFEST_INVALID';
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
    ) || case when upload_record.ingest_extraction_contract_version = 'upload-extraction.2'
      then pg_catalog.jsonb_build_object(
        'extraction_contract_version', 'upload-extraction.2',
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
  -- V2 lease validity and renewal use the time after both locks are held.
  -- Historical v1 transition/replay timing remains unchanged.
  if v_upload.ingest_extraction_contract_version = 'upload-extraction.2' then
    v_now := pg_catalog.clock_timestamp();
  end if;
  if v_upload.ingest_extraction_contract_version = 'upload-extraction.2'
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

  if v_upload.ingest_extraction_contract_version = 'upload-extraction.2' and (
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
  if v_upload.ingest_extraction_contract_version = 'upload-extraction.2'
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

comment on function public.claim_upload_ingest(uuid, uuid, text, text, text, integer, text, text, text) is
  'Accepts one immutable upload identity and extraction contract; old calls default to upload-extraction.1.';
comment on function public.record_upload_extraction_snapshot(uuid, uuid, text, uuid, text, text, text, text, boolean, text, text, jsonb) is
  'Atomically records one private text/source checkpoint before provider dispatch; source_only is not edit approval.';
notify pgrst, 'reload schema';
commit;
