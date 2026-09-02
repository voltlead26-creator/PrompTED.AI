-- Bounded, transactionally consistent workspace hydration.
--
-- The initial route receives all critical workflow truth and exactly one
-- section body from a single stable database statement. Deferred section
-- bodies remain explicit summaries and are loaded through a revision-bound
-- owner command only after deliberate activation.

begin;

create or replace function public.get_workspace_snapshot_v1(
  p_outcome_id uuid,
  p_active_section_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_outcome public.outcomes%rowtype;
  v_document public.documents%rowtype;
  v_operation private.captured_document_operations%rowtype;
  v_approval private.captured_document_approvals%rowtype;
  v_document_count integer;
  v_section_count integer;
  v_required_count integer;
  v_active_section_id uuid;
  v_active_content_length integer;
  v_blocking_reasons text[] := '{}'::text[];
  v_sections jsonb;
  v_operation_json jsonb;
  v_approval_json jsonb;
  v_upload_id_text text;
  v_upload_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_outcome_id is null then
    raise exception 'WORKSPACE_SNAPSHOT_INPUT_INVALID';
  end if;

  select outcome_record.* into v_outcome
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id;
  if not found then return null; end if;
  v_upload_id_text := nullif(
    pg_catalog.btrim(v_outcome.recommendation_payload->>'upload_id'), ''
  );
  if v_upload_id_text is not null then
    if v_upload_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'WORKSPACE_UPLOAD_PROVENANCE_INVALID' using errcode = '22023';
    end if;
    v_upload_id := v_upload_id_text::uuid;
    perform 1
    from public.uploads upload_record
    where upload_record.id = v_upload_id
      and upload_record.user_id = v_user_id;
    if not found then
      raise exception 'WORKSPACE_UPLOAD_PROVENANCE_INVALID' using errcode = '22023';
    end if;
  end if;
  if pg_catalog.octet_length(v_outcome.situation_text) > 262144
    or pg_catalog.octet_length(coalesce(
      v_outcome.recommendation_payload->>'conversation_context', ''
    )) > 262144
    or pg_catalog.octet_length(coalesce(
      v_outcome.recommendation_payload->>'upload_context', ''
    )) > 262144 then
    raise exception 'WORKSPACE_SNAPSHOT_PAYLOAD_LIMIT_EXCEEDED';
  end if;

  select pg_catalog.count(*)::integer into v_document_count
  from public.documents document_record
  where document_record.outcome_id = p_outcome_id
    and document_record.user_id = v_user_id;
  if v_document_count > 1 then
    raise exception 'WORKSPACE_SNAPSHOT_AMBIGUOUS_DOCUMENT';
  end if;
  if v_document_count = 0 then
    return pg_catalog.jsonb_build_object(
      'contract_version', 'workspace-snapshot.v1',
      'owner_user_id', v_user_id,
      'outcome', pg_catalog.jsonb_build_object(
        'id', v_outcome.id,
        'situation', v_outcome.situation_text,
        'template_id', v_outcome.recommendation_payload#>>'{primary,template_id}',
        'template_name', coalesce(
          v_outcome.recommendation_payload#>>'{primary,reason}',
          v_outcome.recommendation_payload#>>'{primary,template_id}',
          'Untitled document'
        ),
        'conversation_context', coalesce(
          v_outcome.recommendation_payload->>'conversation_context', ''
        ),
        'upload_context', coalesce(
          v_outcome.recommendation_payload->>'upload_context', ''
        ),
        'upload_id', v_upload_id
      ),
      'document', null,
      'operation', null,
      'approval', null,
      'export_eligibility', pg_catalog.jsonb_build_object(
        'eligible', false,
        'blocking_reasons', pg_catalog.jsonb_build_array('document_not_found')
      ),
      'active_section_id', null,
      'sections', '[]'::jsonb
    );
  end if;

  select document_record.* into v_document
  from public.documents document_record
  where document_record.outcome_id = p_outcome_id
    and document_record.user_id = v_user_id;

  if pg_catalog.octet_length(v_document.title) > 500
    or pg_catalog.octet_length(v_document.unresolved_placeholders::text) > 262144 then
    raise exception 'WORKSPACE_SNAPSHOT_PAYLOAD_LIMIT_EXCEEDED';
  end if;

  select pg_catalog.count(*)::integer into v_section_count
  from public.sections section_record
  where section_record.document_id = v_document.id
    and section_record.user_id = v_user_id;
  if v_section_count > 512 then
    raise exception 'WORKSPACE_SNAPSHOT_SECTION_LIMIT_EXCEEDED';
  end if;
  if exists (
    select 1 from public.sections section_record
    where section_record.document_id = v_document.id
      and section_record.user_id = v_user_id
      and (
        pg_catalog.octet_length(section_record.name) > 1024
        or pg_catalog.octet_length(coalesce(section_record.section_key, '')) > 256
      )
  ) then
    raise exception 'WORKSPACE_SNAPSHOT_PAYLOAD_LIMIT_EXCEEDED';
  end if;

  if p_active_section_id is not null then
    select section_record.id into v_active_section_id
    from public.sections section_record
    where section_record.id = p_active_section_id
      and section_record.document_id = v_document.id
      and section_record.user_id = v_user_id;
    if not found then
      raise exception 'WORKSPACE_ACTIVE_SECTION_NOT_FOUND';
    end if;
  else
    select section_record.id into v_active_section_id
    from public.sections section_record
    where section_record.document_id = v_document.id
      and section_record.user_id = v_user_id
    order by section_record.order_index, section_record.id
    limit 1;
  end if;

  if v_active_section_id is not null then
    select pg_catalog.octet_length(section_record.content)
    into v_active_content_length
    from public.sections section_record
    where section_record.id = v_active_section_id
      and section_record.user_id = v_user_id;
    if v_active_content_length > 1048576 then
      raise exception 'WORKSPACE_SECTION_BODY_LIMIT_EXCEEDED';
    end if;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', section_record.id,
        'document_id', section_record.document_id,
        'user_id', section_record.user_id,
        'key', section_record.section_key,
        'section_key', section_record.section_key,
        'name', section_record.name,
        'order_index', section_record.order_index,
        'content', case
          when section_record.id = v_active_section_id then section_record.content
          else null
        end,
        'content_loaded', section_record.id = v_active_section_id,
        'content_sha256', pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(section_record.content, 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'content_length', pg_catalog.octet_length(section_record.content),
        'status', section_record.status,
        'is_required', section_record.is_required,
        'created_at', section_record.created_at,
        'updated_at', section_record.updated_at,
        'revision', section_record.revision,
        'approved_revision', section_record.approved_revision,
        'ledger_binding_status', section_record.ledger_binding_status,
        'section_state', section_record.section_state
      ) order by section_record.order_index, section_record.id
    ),
    '[]'::jsonb
  ) into v_sections
  from public.sections section_record
  where section_record.document_id = v_document.id
    and section_record.user_id = v_user_id;

  if v_document.ledger_binding_status = 'captured' then
    select operation_record.* into v_operation
    from private.captured_document_operations operation_record
    where operation_record.document_id = v_document.id
      and operation_record.user_id = v_user_id
    order by
      (operation_record.status not in (
        'ready_for_review', 'terminal_failure', 'cancelled'
      )) desc,
      operation_record.updated_at desc,
      operation_record.id desc
    limit 1;
    if found then
      v_operation_json := pg_catalog.jsonb_build_object(
        'operation_id', v_operation.id,
        'operation_revision', v_operation.operation_revision,
        'status', v_operation.status,
        'message', v_operation.public_error_message,
        'safe_next_action', v_operation.safe_next_action,
        'retryable', v_operation.retryable,
        'safe_section_keys', pg_catalog.to_jsonb(v_operation.safe_section_keys),
        'blocked_section_keys', pg_catalog.to_jsonb(v_operation.blocked_section_keys),
        'latest_document_revision', v_operation.latest_document_revision,
        'updated_at', v_operation.updated_at
      );
      if pg_catalog.octet_length(v_operation_json::text) > 262144 then
        raise exception 'WORKSPACE_SNAPSHOT_PAYLOAD_LIMIT_EXCEEDED';
      end if;
    else
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'operation_not_found'
      );
    end if;

    if v_operation.id is not null and v_operation.status <> 'ready_for_review' then
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'operation_not_ready'
      );
    end if;
    if v_operation.id is not null
      and v_operation.latest_document_revision is distinct from v_document.current_revision then
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'operation_document_revision_mismatch'
      );
    end if;
    if v_document.approved_revision is distinct from v_document.current_revision then
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'document_not_approved'
      );
    end if;

    select approval_record.* into v_approval
    from private.captured_document_approvals approval_record
    where approval_record.document_id = v_document.id
      and approval_record.user_id = v_user_id
      and approval_record.document_revision = v_document.current_revision
    order by approval_record.approved_at desc, approval_record.id desc
    limit 1;
    if found then
      v_approval_json := pg_catalog.jsonb_build_object(
        'approval_id', v_approval.id,
        'document_revision', v_approval.document_revision,
        'validation_passed', v_approval.validation_result @> '{"passed":true}'::jsonb,
        'approved_at', v_approval.approved_at
      );
      if not (v_approval.validation_result @> '{"passed":true}'::jsonb) then
        v_blocking_reasons := pg_catalog.array_append(
          v_blocking_reasons, 'approval_not_validated'
        );
      end if;
    else
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'approval_not_found'
      );
    end if;

    if exists (
      select 1
      from public.sections section_record
      where section_record.document_id = v_document.id
        and section_record.user_id = v_user_id
        and (
          section_record.section_state in (
            'needs_clarification', 'interactive_placeholder', 'failed_validation'
          )
          or (
            section_record.is_required
            and section_record.section_state = 'omitted_optional'
          )
        )
    ) then
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'section_validation_blocker'
      );
    end if;
  else
    select pg_catalog.count(*) filter (
      where section_record.is_required
    )::integer into v_required_count
    from public.sections section_record
    where section_record.document_id = v_document.id
      and section_record.user_id = v_user_id;
    if v_section_count = 0 then
      v_blocking_reasons := pg_catalog.array_append(v_blocking_reasons, 'no_sections');
    elsif v_required_count > 0 and exists (
      select 1 from public.sections section_record
      where section_record.document_id = v_document.id
        and section_record.user_id = v_user_id
        and section_record.is_required
        and section_record.status <> 'approved'
    ) then
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'required_sections_not_approved'
      );
    elsif v_required_count = 0 and exists (
      select 1 from public.sections section_record
      where section_record.document_id = v_document.id
        and section_record.user_id = v_user_id
        and section_record.status <> 'approved'
    ) then
      v_blocking_reasons := pg_catalog.array_append(
        v_blocking_reasons, 'sections_not_approved'
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'contract_version', 'workspace-snapshot.v1',
    'owner_user_id', v_user_id,
    'outcome', pg_catalog.jsonb_build_object(
      'id', v_outcome.id,
      'situation', v_outcome.situation_text,
      'template_id', v_outcome.recommendation_payload#>>'{primary,template_id}',
      'template_name', coalesce(
        v_outcome.recommendation_payload#>>'{primary,reason}',
        v_outcome.recommendation_payload#>>'{primary,template_id}',
        'Untitled document'
      ),
      'conversation_context', coalesce(
        v_outcome.recommendation_payload->>'conversation_context', ''
      ),
      'upload_context', coalesce(
        v_outcome.recommendation_payload->>'upload_context', ''
      ),
      'upload_id', v_upload_id
    ),
    'document', pg_catalog.jsonb_build_object(
      'id', v_document.id,
      'title', v_document.title,
      'status', v_document.status,
      'template_id', coalesce(
        v_document.ledger_template_id,
        v_document.template_id::text
      ),
      'unresolved_placeholders', v_document.unresolved_placeholders,
      'ledger_binding_status', v_document.ledger_binding_status,
      'ledger_version', v_document.ledger_version,
      'current_revision', v_document.current_revision,
      'approved_revision', v_document.approved_revision,
      'updated_at', v_document.updated_at,
      'has_generated_content', exists (
        select 1 from public.sections section_record
        where section_record.document_id = v_document.id
          and section_record.user_id = v_user_id
          and pg_catalog.length(pg_catalog.btrim(section_record.content)) > 0
          and section_record.section_state is distinct from 'omitted_optional'
      )
    ),
    'operation', v_operation_json,
    'approval', v_approval_json,
    'export_eligibility', pg_catalog.jsonb_build_object(
      'eligible', pg_catalog.cardinality(v_blocking_reasons) = 0,
      'blocking_reasons', pg_catalog.to_jsonb(v_blocking_reasons)
    ),
    'active_section_id', v_active_section_id,
    'sections', v_sections
  );
end;
$function$;

create or replace function public.get_workspace_section_body_v1(
  p_outcome_id uuid,
  p_section_id uuid,
  p_expected_document_revision integer,
  p_expected_section_revision integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_section public.sections%rowtype;
  v_document_revision integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_outcome_id is null
    or p_section_id is null
    or p_expected_document_revision is null
    or p_expected_document_revision <= 0
    or p_expected_section_revision is null
    or p_expected_section_revision <= 0 then
    raise exception 'WORKSPACE_SECTION_BODY_INPUT_INVALID';
  end if;

  select section_record.* into v_section
  from public.sections section_record
  join public.documents document_record
    on document_record.id = section_record.document_id
    and document_record.user_id = section_record.user_id
  join public.outcomes outcome_record
    on outcome_record.id = document_record.outcome_id
    and outcome_record.user_id = document_record.user_id
  where outcome_record.id = p_outcome_id
    and section_record.id = p_section_id
    and section_record.user_id = v_user_id;
  if not found then
    raise exception 'WORKSPACE_SECTION_BODY_NOT_FOUND';
  end if;
  select document_record.current_revision into v_document_revision
  from public.documents document_record
  where document_record.id = v_section.document_id
    and document_record.user_id = v_user_id;
  if v_document_revision <> p_expected_document_revision
    or v_section.revision <> p_expected_section_revision then
    raise exception 'WORKSPACE_SECTION_BODY_STALE';
  end if;
  if pg_catalog.octet_length(v_section.content) > 1048576 then
    raise exception 'WORKSPACE_SECTION_BODY_LIMIT_EXCEEDED';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract_version', 'workspace-section-body.v1',
    'outcome_id', p_outcome_id,
    'document_id', v_section.document_id,
    'document_revision', v_document_revision,
    'section_id', v_section.id,
    'section_revision', v_section.revision,
    'content', v_section.content,
    'content_sha256', pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(v_section.content, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'content_length', pg_catalog.octet_length(v_section.content),
    'status', v_section.status,
    'approved_revision', v_section.approved_revision,
    'ledger_binding_status', v_section.ledger_binding_status,
    'section_key', v_section.section_key,
    'section_state', v_section.section_state,
    'updated_at', v_section.updated_at
  );
end;
$function$;

revoke all on function public.get_workspace_snapshot_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_workspace_snapshot_v1(uuid, uuid)
  to authenticated;
revoke all on function public.get_workspace_section_body_v1(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_workspace_section_body_v1(uuid, uuid, integer, integer)
  to authenticated;

comment on function public.get_workspace_snapshot_v1(uuid, uuid) is
  'Owner-authenticated versioned workspace truth with one bounded active body and explicit deferred summaries.';
comment on function public.get_workspace_section_body_v1(uuid, uuid, integer, integer) is
  'Owner-authenticated deliberate section activation bound to the exact snapshot document and section revisions.';

commit;
