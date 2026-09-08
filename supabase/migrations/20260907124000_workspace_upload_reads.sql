-- Owner-only browsing of retained sources. Reads never dispatch ingestion,
-- manufacture a document, or grant editing/format-preservation authority.
begin;

create function private.workspace_upload_summary(p_upload public.uploads)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_original jsonb := null;
  v_document jsonb := null;
  v_metadata jsonb;
begin
  -- Legacy paths are owner-prefixed but need not contain an upload UUID.
  -- Modern accepted identities have the stronger path convention.
  if p_upload.storage_path like p_upload.user_id::text || '/_%'
    and pg_catalog.char_length(p_upload.storage_path) <= 800
    and p_upload.storage_path !~ '(^|/)[.]{1,2}(/|$)'
    and (p_upload.ingest_request_sha256 is null
      or p_upload.storage_path like p_upload.user_id::text || '/' || p_upload.id::text || '/_%') then
    select o.metadata into v_metadata from storage.objects o
      where o.bucket_id = 'original-documents' and o.name = p_upload.storage_path;
    if found and (
      not coalesce(v_metadata ? 'size', false)
      or case when v_metadata->>'size' ~ '^[0-9]{1,10}$' then
        (v_metadata->>'size')::bigint between 1 and 8388608
        and (p_upload.file_size_bytes is null
          or (v_metadata->>'size')::bigint = p_upload.file_size_bytes)
      else false end
    ) then
      v_original := pg_catalog.jsonb_build_object(
        'storage_path', p_upload.storage_path, 'sha256', p_upload.ingest_content_sha256);
    end if;
  end if;
  select pg_catalog.jsonb_build_object('document_id', d.id, 'outcome_id', d.outcome_id)
    into v_document from public.documents d join public.outcomes o on o.id = d.outcome_id
    where p_upload.status = 'committed' and d.id = p_upload.document_id and d.user_id = p_upload.user_id
      and o.user_id = p_upload.user_id and d.outcome_id = p_upload.outcome_id;
  return pg_catalog.jsonb_build_object(
    'upload_id', p_upload.id, 'file_name', p_upload.file_name,
    'mime_type', p_upload.file_type, 'byte_length', p_upload.file_size_bytes,
    'created_at', p_upload.created_at,
    'status', p_upload.status, 'ingest_status', coalesce(p_upload.ingest_status, 'legacy'),
    'format', case when p_upload.ingest_extraction_text is not null
      and p_upload.ingest_extraction_text_sha256 = pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(p_upload.ingest_extraction_text, 'UTF8'), 'sha256'), 'hex')
      and p_upload.ingest_extraction_truncated is not null and p_upload.ingest_extraction_recorded_at is not null
      and p_upload.ingest_extraction_policy_version = case when p_upload.ingest_extraction_contract_version = 'upload-extraction.3'
        then 'upload-resource-policy.2' else 'upload-resource-policy.1' end
      then p_upload.ingest_extraction_format else null end,
    'original', v_original, 'imported_document', v_document);
end;
$$;
revoke all on function private.workspace_upload_summary(public.uploads)
  from public, anon, authenticated, service_role;

create function public.get_own_workspace_upload_v1(p_upload_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_upload public.uploads%rowtype;
  v_source jsonb := null;
  v_text text;
  v_truncated boolean;
begin
  if v_owner is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if p_upload_id is null then raise exception 'UPLOAD_ID_REQUIRED' using errcode = '22023'; end if;
  select * into v_upload from public.uploads where id = p_upload_id and user_id = v_owner;
  if found then
    v_text := coalesce(v_upload.ingest_extraction_text, v_upload.extracted_text);
    v_truncated := case when v_upload.ingest_extraction_text is not null
      then v_upload.ingest_extraction_truncated
      when pg_catalog.jsonb_typeof(v_upload.extracted_payload->'truncated') = 'boolean'
        then (v_upload.extracted_payload->>'truncated')::boolean else null end;
    -- The wire bound is Unicode code points, preserving whole astral characters.
    if pg_catalog.char_length(v_text) > 20000 then v_truncated := true; end if;
    v_source := private.workspace_upload_summary(v_upload) || pg_catalog.jsonb_build_object(
      'preview', case when v_text is null or v_text = '' then null else
        pg_catalog.jsonb_build_object('text', pg_catalog.left(v_text, 20000), 'truncated', v_truncated) end);
  end if;
  return pg_catalog.jsonb_build_object('version', 'workspace-upload.1',
    'owner_user_id', v_owner, 'source', v_source);
end;
$$;

create function public.list_own_workspace_uploads_v1(
  p_before_created_at timestamptz default null, p_before_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
  v_cursor jsonb := null;
  v_row public.uploads%rowtype;
  v_count integer := 0;
begin
  if v_owner is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not pg_catalog.isfinite(p_before_created_at)) then
    raise exception 'UPLOAD_CURSOR_INVALID' using errcode = '22023';
  end if;
  for v_row in select u.* from public.uploads u where u.user_id = v_owner
    and (p_before_created_at is null or (u.created_at, u.id) < (p_before_created_at, p_before_id))
    order by u.created_at desc, u.id desc limit 21 loop
    v_count := v_count + 1;
    if v_count = 21 then
      v_cursor := pg_catalog.jsonb_build_object('created_at', v_items->19->'created_at',
        'upload_id', v_items->19->'upload_id');
    else v_items := v_items || pg_catalog.jsonb_build_array(private.workspace_upload_summary(v_row));
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('version', 'workspace-upload.1',
    'owner_user_id', v_owner, 'items', v_items, 'next_cursor', v_cursor);
end;
$$;
revoke all on function public.get_own_workspace_upload_v1(uuid) from public, anon, service_role;
revoke all on function public.list_own_workspace_uploads_v1(timestamptz, uuid) from public, anon, service_role;
grant execute on function public.get_own_workspace_upload_v1(uuid) to authenticated;
grant execute on function public.list_own_workspace_uploads_v1(timestamptz, uuid) to authenticated;
commit;
