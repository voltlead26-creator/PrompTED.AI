-- Bind one current, exactly completed upload to an outcome in the same owner
-- transaction that persists the upload identity. Historical JSON provenance
-- remains readable; these commands govern new browser writes only.

begin;

create or replace function public.upsert_own_outcome_with_upload(
  p_id uuid,
  p_situation_text text,
  p_recommendation_payload jsonb,
  p_status text,
  p_upload_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_upload public.uploads%rowtype;
  v_payload jsonb;
  v_persisted_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_upload_id is null
    or pg_catalog.jsonb_typeof(p_recommendation_payload) is distinct from 'object'
    or p_recommendation_payload->>'upload_id' is distinct from p_upload_id::text then
    raise exception 'OUTCOME_UPLOAD_BINDING_INVALID' using errcode = '22023';
  end if;

  -- The existing owner command locks or creates the outcome first. Any later
  -- upload failure rolls this nested write back with the enclosing statement.
  v_persisted_id := public.upsert_own_outcome(
    p_id,
    p_situation_text,
    p_recommendation_payload,
    p_status
  );

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = v_user_id
  for update;
  if not found
    or v_upload.outcome_id is not null and v_upload.outcome_id <> p_id
    or v_upload.status is distinct from 'ready'
    or v_upload.ingest_status is distinct from 'completed'
    or not private.completed_upload_ingest_is_valid(
      v_upload.id,
      v_upload.ingest_response,
      v_upload.extracted_text,
      v_upload.extracted_payload
    ) then
    raise exception 'OUTCOME_UPLOAD_BINDING_INVALID' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_set(
    p_recommendation_payload,
    '{upload_context}',
    pg_catalog.to_jsonb(pg_catalog.left(v_upload.extracted_text, 20000)),
    true
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload,
    '{upload_id}',
    pg_catalog.to_jsonb(p_upload_id::text),
    true
  );

  update public.outcomes outcome_record
  set recommendation_payload = v_payload,
      updated_at = pg_catalog.clock_timestamp()
  where outcome_record.id = p_id
    and outcome_record.user_id = v_user_id;

  update public.uploads upload_record
  set outcome_id = p_id
  where upload_record.id = p_upload_id
    and upload_record.user_id = v_user_id;

  return v_persisted_id;
end;
$function$;

create or replace function public.attach_own_upload_to_outcome(
  p_outcome_id uuid,
  p_upload_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_outcome public.outcomes%rowtype;
  v_upload public.uploads%rowtype;
  v_payload jsonb;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_outcome_id is null or p_upload_id is null then
    raise exception 'OUTCOME_UPLOAD_BINDING_INVALID' using errcode = '22023';
  end if;

  select outcome_record.* into v_outcome
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found
    or v_outcome.recommendation_payload is null
    or pg_catalog.jsonb_typeof(v_outcome.recommendation_payload) is distinct from 'object' then
    raise exception 'OUTCOME_UPLOAD_BINDING_INVALID' using errcode = '22023';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = v_user_id
  for update;
  if not found
    or v_upload.outcome_id is not null and v_upload.outcome_id <> p_outcome_id
    or v_upload.status is distinct from 'ready'
    or v_upload.ingest_status is distinct from 'completed'
    or not private.completed_upload_ingest_is_valid(
      v_upload.id,
      v_upload.ingest_response,
      v_upload.extracted_text,
      v_upload.extracted_payload
    ) then
    raise exception 'OUTCOME_UPLOAD_BINDING_INVALID' using errcode = '22023';
  end if;

  v_payload := pg_catalog.jsonb_set(
    v_outcome.recommendation_payload,
    '{upload_context}',
    pg_catalog.to_jsonb(pg_catalog.left(v_upload.extracted_text, 20000)),
    true
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload,
    '{upload_id}',
    pg_catalog.to_jsonb(p_upload_id::text),
    true
  );

  update public.outcomes outcome_record
  set recommendation_payload = v_payload,
      updated_at = pg_catalog.clock_timestamp()
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  returning outcome_record.updated_at into v_updated_at;

  -- This compatibility cohort intentionally supports one active upload per
  -- outcome. Preserve import-bound rows, which carry a document_id, while
  -- detaching a prior pre-generation source if the owner replaces it.
  update public.uploads upload_record
  set outcome_id = null
  where upload_record.user_id = v_user_id
    and upload_record.outcome_id = p_outcome_id
    and upload_record.id <> p_upload_id
    and upload_record.document_id is null;

  update public.uploads upload_record
  set outcome_id = p_outcome_id
  where upload_record.id = p_upload_id
    and upload_record.user_id = v_user_id;

  return pg_catalog.jsonb_build_object(
    'outcome_id', p_outcome_id,
    'situation', v_outcome.situation_text,
    'template_id', v_payload#>>'{primary,template_id}',
    'template_name', coalesce(
      v_payload#>>'{primary,reason}',
      v_payload#>>'{primary,template_id}',
      'Untitled document'
    ),
    'conversation_context', coalesce(v_payload->>'conversation_context', ''),
    'upload_context', coalesce(v_payload->>'upload_context', ''),
    'upload_id', p_upload_id,
    'updated_at', v_updated_at
  );
end;
$function$;

revoke all on function public.upsert_own_outcome_with_upload(
  uuid, text, jsonb, text, uuid
) from public, anon, service_role;
revoke all on function public.attach_own_upload_to_outcome(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.upsert_own_outcome_with_upload(
  uuid, text, jsonb, text, uuid
) to authenticated;
grant execute on function public.attach_own_upload_to_outcome(uuid, uuid)
  to authenticated;

commit;
