-- Address schema-lint findings without rewriting previously published migrations.
-- The resolver deliberately takes a fresh snapshot after admission locks. Its
-- SQL/read wrappers must advertise that same volatility to PostgreSQL.
begin;
alter function public.get_effective_product_access_v1(uuid) volatile;
alter function private.document_plan_snapshot(uuid) volatile;

-- Preserve the original DOCX body exactly except for the paragraph ordinal's
-- local name. Integer FOR loops own their implicit v_index variables.
create or replace function public.prepare_docx_source_document_v1(
  p_user_id uuid, p_upload_id uuid, p_source_manifest_sha256 text, p_units jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_upload public.uploads%rowtype;
  v_binding private.docx_source_bindings%rowtype;
  v_manifest jsonb;
  v_source jsonb;
  v_unit jsonb;
  v_node jsonb;
  v_paragraph jsonb;
  v_ids jsonb;
  v_expected_ids jsonb;
  v_count integer;
  v_paragraph_index integer;
  v_digest text;
  v_document_id uuid;
  v_outcome_id uuid;
  v_section_id uuid;
  v_bindings jsonb := '[]'::jsonb;
  v_replay boolean := false;
begin
  if p_user_id is null or p_upload_id is null
    or p_source_manifest_sha256 is null
    or p_source_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_units) is distinct from 'object'
    or octet_length(p_units::text) > 4194304 then
    raise exception 'DOCX_SOURCE_BINDING_INPUT_INVALID' using errcode = '22023';
  end if;
  -- Share the account-deletion/admission fence and then lock the immutable
  -- upload. Concurrent requests for the same upload serialize before allocation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 91000));
  if exists (select 1 from private.account_deletion_fences f
    where f.user_key = private.account_deletion_user_key(p_user_id)) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  select * into v_upload from public.uploads where id = p_upload_id for update;
  if not found or v_upload.user_id is distinct from p_user_id
    or v_upload.status is distinct from 'ready'
    or v_upload.ingest_extraction_format is distinct from 'docx'
    or v_upload.ingest_extraction_truncated is distinct from false
    or not private.completed_upload_source_preparation_is_valid(v_upload)
    or v_upload.ingest_source_manifest_sha256 is distinct from p_source_manifest_sha256 then
    raise exception 'DOCX_SOURCE_BINDING_CONFLICT' using errcode = '22023';
  end if;
  v_manifest := private.normalize_upload_source_manifest(
    v_upload.ingest_source_manifest, v_upload.ingest_content_sha256, v_upload.file_size_bytes);
  if v_manifest is distinct from v_upload.ingest_source_manifest
    or private.upload_source_manifest_digest(v_manifest) is distinct from p_source_manifest_sha256
    or not exists (select 1 from storage.objects o where o.bucket_id = 'original-documents'
      and o.name = v_upload.storage_path
      and o.metadata->>'size' = v_upload.file_size_bytes::text) then
    raise exception 'DOCX_SOURCE_BINDING_CONFLICT' using errcode = '22023';
  end if;
  v_source := v_manifest #> '{mainPart,source}';
  if p_units - array['version','contentEncoding','assessment','source','blockers','paragraphs','units'] <> '{}'::jsonb
    or p_units->>'version' is distinct from 'word-xml-units.1'
    or p_units->>'contentEncoding' is distinct from 'literal-text.1'
    or p_units->>'assessment' is distinct from 'source_only'
    or p_units->'source' is distinct from v_source
    or jsonb_typeof(p_units->'blockers') is distinct from 'array'
    or jsonb_typeof(p_units->'units') is distinct from 'array'
    or jsonb_typeof(p_units->'paragraphs') is distinct from 'array' then
    raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_units->'units');
  if v_count not between 1 and 512
    or v_count <> jsonb_array_length(v_source->'nodes')
    or jsonb_array_length(p_units->'paragraphs') > 512 then
    raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
  end if;
  for v_index in 0..v_count - 1 loop
    v_unit := p_units->'units'->v_index;
    v_node := v_source->'nodes'->v_index;
    if jsonb_typeof(v_unit) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_unit)) <> 4
      or not (v_unit ?& array['nodeId','paragraphId','content','lexicallyPatchable'])
      or v_unit->'nodeId' is distinct from v_node->'id'
      or v_unit->'content' is distinct from v_node->'text'
      or v_unit->'lexicallyPatchable' is distinct from v_node->'lexicallyPatchable'
      or cardinality(private.upload_source_utf16_units(v_unit->>'content', false)) > 20000
      or not (v_unit->'paragraphId' = 'null'::jsonb
        or (jsonb_typeof(v_unit->'paragraphId') = 'string'
          and v_unit->>'paragraphId' ~ '^p:[1-9][0-9]*$')) then
      raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
    end if;
  end loop;
  if (select sum(cardinality(private.upload_source_utf16_units(u->>'content', false)))
    from jsonb_array_elements(p_units->'units') u) > 1048576 then
    raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
  end if;
  -- Validate the producer's partition, but do not use it as paragraph/layout
  -- authority: the durable manifest attests source nodes, not Word paragraphs.
  for v_paragraph, v_paragraph_index in select value, ordinality::integer
    from jsonb_array_elements(p_units->'paragraphs') with ordinality loop
    if jsonb_typeof(v_paragraph) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_paragraph)) <> 2
      or v_paragraph->>'id' is distinct from 'p:' || v_paragraph_index::text
      or jsonb_typeof(v_paragraph->'unitIds') is distinct from 'array' then
      raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(u->'nodeId' order by ordinality), '[]'::jsonb) into v_expected_ids
      from jsonb_array_elements(p_units->'units') with ordinality as x(u, ordinality)
      where u->>'paragraphId' = v_paragraph->>'id';
    if v_paragraph->'unitIds' is distinct from v_expected_ids then
      raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
    end if;
  end loop;
  select coalesce(jsonb_agg(p->'id'), '[]'::jsonb) into v_ids
    from jsonb_array_elements(p_units->'paragraphs') p;
  if exists (select 1 from jsonb_array_elements(p_units->'units') u
    where u->'paragraphId' <> 'null'::jsonb and not (v_ids ? (u->>'paragraphId'))) then
    raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
  end if;
  -- mapWordXmlSourceUnits describes the main part, whereas the upload manifest
  -- also describes other package parts. Keep both assessments; do not require
  -- package-only blockers to appear in the main-part projection.
  select jsonb_agg(to_jsonb(blocker) order by blocker collate "C") into v_expected_ids
  from (select distinct blocker from (
    select jsonb_array_elements_text(v_source->'blockers') as blocker
    union all select unnest(array['layout_unassessed','package_semantics_unassessed',
      'styles_and_visibility_unassessed'])
    union all select 'wording_controls_unmapped'
      where p_units->'blockers' ? 'wording_controls_unmapped'
    union all select 'source_unit_context_unmapped'
      where exists(select 1 from jsonb_array_elements(p_units->'units') u
        where u->'paragraphId' = 'null'::jsonb)
  ) observed) canonical;
  if p_units->'blockers' is distinct from v_expected_ids then
    raise exception 'DOCX_SOURCE_UNITS_INVALID' using errcode = '22023';
  end if;
  v_digest := encode(extensions.digest(convert_to(p_units::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_binding from private.docx_source_bindings where upload_id = p_upload_id;
  if found then
    if v_binding.user_id <> p_user_id or v_binding.manifest_sha256 <> p_source_manifest_sha256
      or v_binding.units_sha256 <> v_digest then
      raise exception 'DOCX_SOURCE_BINDING_CONFLICT' using errcode = '22023';
    end if;
    v_document_id := v_binding.document_id;
    v_outcome_id := v_binding.outcome_id;
    v_replay := true;
  else
    v_document_id := gen_random_uuid();
    v_outcome_id := gen_random_uuid();
    insert into public.outcomes(id,user_id,situation_text,status)
      values(v_outcome_id,p_user_id,'Retained Word source','draft');
    insert into public.documents(id,user_id,outcome_id,title,status)
      values(v_document_id,p_user_id,v_outcome_id,v_upload.file_name,'draft');
    for v_index in 0..v_count - 1 loop
      v_node := v_source->'nodes'->v_index;
      v_section_id := gen_random_uuid();
      insert into public.sections(id,document_id,user_id,name,order_index,content,status,is_required)
        values(v_section_id,v_document_id,p_user_id,'Source text ' || (v_index+1)::text,
          v_index,v_node->>'text','draft',true);
      v_bindings := v_bindings || jsonb_build_array(jsonb_build_object(
        'section_id',v_section_id,'source_node_id',v_node->>'id'));
    end loop;
    insert into private.docx_source_bindings(document_id,outcome_id,user_id,upload_id,
      manifest_sha256,units_sha256,section_bindings)
      values(v_document_id,v_outcome_id,p_user_id,p_upload_id,p_source_manifest_sha256,v_digest,v_bindings);
  end if;
  return jsonb_build_object('status','source_bound','binding_version','docx-source-binding.1',
    'content_encoding','literal-text.1','assessment','source_only',
    'document_id',v_document_id,'outcome_id',v_outcome_id,
    'source_manifest_sha256',p_source_manifest_sha256,'idempotent_replay',v_replay);
end;
$function$;

commit;
