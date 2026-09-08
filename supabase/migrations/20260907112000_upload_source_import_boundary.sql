-- Preserve originals and immutable ingest receipts while keeping the current
-- HTML document importer out of source-only or incomplete v3 representations.
-- No existing rows, acceptance pointers or v1/v2 import behavior are rewritten.
begin;

create function private.assert_upload_document_import_source(p_upload public.uploads)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if p_upload.ingest_extraction_contract_version = 'upload-extraction.3' then
    if (p_upload.status in ('ready','committed')
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
    -- v3 PDF/DOCX/RTF/XLSX have no accepted format-preserving editor. A missing
    -- format is not permission. Complete text remains owner-reviewed wording,
    -- not an attestation that preview extraction preserved its original bytes.
    if p_upload.ingest_extraction_format is distinct from 'text' then
      raise exception 'UPLOAD_SOURCE_IMPORT_UNAVAILABLE';
    end if;
  end if;
end;
$function$;
revoke all on function private.assert_upload_document_import_source(public.uploads)
  from public, anon, authenticated, service_role;

create or replace function public.commit_document_import(
  p_upload_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_situation_text text,
  p_recommendation_payload jsonb,
  p_sections jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_upload public.uploads%rowtype;
  v_existing_owner uuid;
  v_persisted_id uuid;
  v_section jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_upload_id is null or p_outcome_id is null or p_document_id is null then
    raise exception 'IMPORT_ID_INVALID' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_sections) is distinct from 'array'
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_sections) section_record
      where pg_catalog.jsonb_typeof(section_record) is distinct from 'object'
    ) then
    raise exception 'IMPORT_SECTIONS_INVALID' using errcode = '22023';
  end if;

  select * into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = v_user_id
  for update;

  if not found then
    raise exception 'UPLOAD_NOT_FOUND:%', p_upload_id;
  end if;

  if v_upload.status = 'committed' then
    return pg_catalog.jsonb_build_object(
      'status', 'committed',
      'outcome_id', v_upload.outcome_id,
      'document_id', v_upload.document_id,
      'idempotent_replay', true
    );
  end if;

  -- Existing committed replay above remains immutable. Check a new source
  -- import before any outcome/document/section mutation.
  perform private.assert_upload_document_import_source(v_upload);

  select outcome_record.user_id into v_existing_owner
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
  for update;
  if found and v_existing_owner <> v_user_id then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_outcome_id using errcode = '42501';
  end if;

  v_existing_owner := null;
  select document_record.user_id into v_existing_owner
  from public.documents document_record
  where document_record.id = p_document_id
  for update;
  if found and v_existing_owner <> v_user_id then
    raise exception 'DOCUMENT_ID_CONFLICT:%', p_document_id using errcode = '42501';
  end if;

  insert into public.outcomes(
    id, user_id, situation_text, recommendation_payload, status
  ) values (
    p_outcome_id, v_user_id, p_situation_text, p_recommendation_payload, 'in_progress'
  )
  on conflict (id) do update set
    situation_text = excluded.situation_text,
    recommendation_payload = excluded.recommendation_payload,
    status = excluded.status,
    updated_at = pg_catalog.clock_timestamp()
  where public.outcomes.user_id = v_user_id
  returning id into v_persisted_id;
  if v_persisted_id is null then
    raise exception 'OUTCOME_ID_CONFLICT:%', p_outcome_id using errcode = '42501';
  end if;

  v_persisted_id := null;
  insert into public.documents(
    id, user_id, outcome_id, title, status
  ) values (
    p_document_id, v_user_id, p_outcome_id, p_title, 'draft'
  )
  on conflict (id) do update set
    outcome_id = excluded.outcome_id,
    title = excluded.title,
    status = excluded.status,
    updated_at = pg_catalog.clock_timestamp()
  where public.documents.user_id = v_user_id
  returning id into v_persisted_id;
  if v_persisted_id is null then
    raise exception 'DOCUMENT_ID_CONFLICT:%', p_document_id using errcode = '42501';
  end if;

  delete from public.sections section_record
  where section_record.document_id = p_document_id
    and section_record.user_id = v_user_id;

  for v_section in
    select section_record
    from pg_catalog.jsonb_array_elements(p_sections) section_record
  loop
    if nullif(v_section->>'id', '') is null then
      raise exception 'IMPORT_SECTION_ID_INVALID' using errcode = '22023';
    end if;
    insert into public.sections(
      id, document_id, user_id, name, order_index, content, status,
      version_history, is_required, created_at, updated_at
    ) values (
      (v_section->>'id')::uuid,
      p_document_id,
      v_user_id,
      coalesce(v_section->>'name', 'Untitled section'),
      coalesce((v_section->>'order_index')::integer, 0),
      coalesce(v_section->>'content', ''),
      coalesce(v_section->>'status', 'draft'),
      coalesce(v_section->'version_history', '[]'::jsonb),
      coalesce((v_section->>'is_required')::boolean, true),
      coalesce(
        (v_section->>'created_at')::timestamptz,
        pg_catalog.clock_timestamp()
      ),
      pg_catalog.clock_timestamp()
    );
  end loop;

  update public.uploads
  set outcome_id = p_outcome_id,
      document_id = p_document_id,
      status = 'committed',
      completed_at = pg_catalog.clock_timestamp(),
      error_code = null
  where id = p_upload_id
    and user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'status', 'committed',
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'idempotent_replay', false
  );
end;
$function$;

create or replace function private.require_terminal_upload_before_import_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (new.document_id is not null and new.document_id is distinct from old.document_id)
    or (new.status = 'committed' and old.status is distinct from 'committed') then
    -- OLD owns the accepted checkpoint. A simultaneous NEW metadata change
    -- cannot turn an unassessed source into an editable document.
    perform private.assert_upload_document_import_source(old);
  end if;
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

-- Retain the existing trigger authority and add the document-link boundary.
-- Unchanged historical links, outcome-only context and FK cleanup to NULL do
-- not enter the new transition rule.
drop trigger uploads_require_terminal_ingest_before_commit on public.uploads;
create trigger uploads_require_terminal_ingest_before_commit
before update of status, document_id on public.uploads
for each row execute function private.require_terminal_upload_before_import_commit();

commit;
