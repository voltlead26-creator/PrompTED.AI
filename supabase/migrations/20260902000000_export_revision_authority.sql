-- Close the active export path over one persisted, exactly approved revision.
-- Historical inline receipts remain readable/replayable through the legacy RPC,
-- but the active renderer uses claim_persisted_pdf_export and cannot create one.

begin;

create or replace function public.load_legacy_export_snapshot(
  p_user_id uuid,
  p_document_id uuid,
  p_artifact_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select snapshot_record.snapshot
  from (
    select pg_catalog.jsonb_build_object(
      'target_kind', 'document',
      'target', pg_catalog.jsonb_build_object(
        'id', document_record.id,
        'title', document_record.title,
        'status', document_record.status,
        'ledger_binding_status', document_record.ledger_binding_status,
        'current_revision', document_record.current_revision,
        'approved_revision', document_record.approved_revision,
        'unresolved_placeholders', document_record.unresolved_placeholders
      ),
      'sections', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', section_record.name,
            'content', section_record.content,
            'status', section_record.status,
            'is_required', section_record.is_required,
            'order_index', section_record.order_index
          ) order by section_record.order_index, section_record.id
        )
        from public.sections section_record
        where section_record.document_id = document_record.id
          and section_record.user_id = p_user_id
      ), '[]'::jsonb)
    ) as snapshot
    from public.documents document_record
    where p_user_id is not null
      and p_document_id is not null
      and p_artifact_id is null
      and document_record.id = p_document_id
      and document_record.user_id = p_user_id

    union all

    select pg_catalog.jsonb_build_object(
      'target_kind', 'artifact',
      'target', pg_catalog.jsonb_build_object(
        'id', artifact_record.id,
        'title', artifact_record.title,
        'status', artifact_record.status,
        'quality_status', artifact_record.quality_status,
        'current_revision', artifact_record.current_revision,
        'approved_revision', artifact_record.approved_revision
      ),
      'blocks', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'heading', block_record.heading,
            'payload', block_record.payload,
            'approval_status', block_record.approval_status,
            'approved_revision', block_record.approved_revision,
            'revision', block_record.revision,
            'is_required', block_record.is_required,
            'section_state', block_record.section_state,
            'order_index', block_record.order_index,
            'kind', block_record.kind
          ) order by block_record.order_index, block_record.id
        )
        from public.ted_artifact_blocks block_record
        where block_record.artifact_id = artifact_record.id
          and block_record.user_id = p_user_id
      ), '[]'::jsonb)
    ) as snapshot
    from public.ted_artifacts artifact_record
    where p_user_id is not null
      and p_document_id is null
      and p_artifact_id is not null
      and artifact_record.id = p_artifact_id
      and artifact_record.user_id = p_user_id
  ) snapshot_record
  limit 1
$function$;

create or replace function public.claim_persisted_pdf_export(
  p_user_id uuid,
  p_request_id uuid,
  p_binding jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_binding is null
    or pg_catalog.jsonb_typeof(p_binding) is distinct from 'object'
    or p_binding->>'target_kind' not in ('document', 'artifact') then
    raise exception 'PERSISTED_PDF_EXPORT_TARGET_REQUIRED';
  end if;

  return public.claim_legacy_pdf_export(p_user_id, p_request_id, p_binding);
end;
$function$;

create or replace function public.approve_ted_artifact_block_revision(
  p_block_id uuid,
  p_expected_artifact_revision integer,
  p_expected_block_revision integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_all_required_approved boolean;
  v_previous_context text := private.ledger_write_context();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  select artifact_record.* into v_artifact
  from public.ted_artifacts artifact_record
  join public.ted_artifact_blocks block_record
    on block_record.artifact_id = artifact_record.id
  where block_record.id = p_block_id
    and artifact_record.user_id = v_user_id
  for update of artifact_record;
  if not found then raise exception 'ARTIFACT_BLOCK_NOT_FOUND'; end if;

  select * into v_block
  from public.ted_artifact_blocks
  where id = p_block_id and user_id = v_user_id
  for update;

  if v_artifact.ledger_binding_status <> 'captured'
    or v_block.ledger_binding_status <> 'captured' then
    raise exception 'LEDGER_BINDING_REQUIRED';
  end if;
  if v_artifact.current_revision <> p_expected_artifact_revision
    or v_block.revision <> p_expected_block_revision then
    raise exception 'STALE_APPROVAL_CONFLICT';
  end if;
  if v_block.section_state <> 'final' then
    raise exception 'SECTION_NOT_FINAL';
  end if;
  if v_block.kind = 'section'
    and pg_catalog.length(pg_catalog.btrim(
      coalesce(v_block.payload->>'content', '')
    )) = 0 then
    raise exception 'BLANK_SECTION_CANNOT_BE_APPROVED';
  end if;

  perform pg_catalog.set_config(
    'prompted.ledger_write_context', 'approve_block', true
  );

  update public.ted_artifact_blocks
  set approval_status = 'approved',
      revision = revision + 1,
      approved_revision = revision + 1,
      updated_at = pg_catalog.now()
  where id = p_block_id
  returning * into v_block;

  select not exists (
    select 1
    from public.ted_artifact_blocks required_block
    where required_block.artifact_id = v_artifact.id
      and coalesce(required_block.is_required, true)
      and (
        required_block.section_state is distinct from 'final'
        or required_block.approval_status not in ('approved', 'locked')
        or required_block.approved_revision is distinct from required_block.revision
      )
  ) into v_all_required_approved;

  update public.ted_artifacts
  set current_revision = current_revision + 1,
      status = case
        when v_all_required_approved then 'approved'
        else 'needs_review'
      end,
      approved_revision = case
        when v_all_required_approved then current_revision + 1
        else null
      end,
      updated_at = pg_catalog.now()
  where id = v_artifact.id
  returning * into v_artifact;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  return pg_catalog.jsonb_build_object(
    'artifact_id', v_artifact.id,
    'artifact_revision', v_artifact.current_revision,
    'artifact_status', v_artifact.status,
    'artifact_approved_revision', v_artifact.approved_revision,
    'block_id', v_block.id,
    'block_revision', v_block.revision,
    'approved_revision', v_block.approved_revision,
    'approval_status', v_block.approval_status
  );
end;
$function$;

revoke all on function public.load_legacy_export_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.load_legacy_export_snapshot(uuid,uuid,uuid)
  to service_role;

revoke all on function public.claim_persisted_pdf_export(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.claim_persisted_pdf_export(uuid,uuid,jsonb)
  to service_role;

revoke all on function public.approve_ted_artifact_block_revision(uuid,integer,integer)
  from public, anon;
grant execute on function public.approve_ted_artifact_block_revision(uuid,integer,integer)
  to authenticated;

comment on function public.load_legacy_export_snapshot(uuid,uuid,uuid) is
  'Service-only owner-bound export snapshot with exact parent and child approval revisions.';
comment on function public.claim_persisted_pdf_export(uuid,uuid,jsonb) is
  'Active owner/request PDF claim restricted to one persisted document or artifact target.';
comment on function public.approve_ted_artifact_block_revision(uuid,integer,integer) is
  'Owner-only exact block approval that finalises the parent only when every required block is exact-approved.';

commit;
