-- Durable owner/revision commands for post-creation TED artifact changes.
--
-- save_ted_artifact remains the create-or-replay compatibility boundary. It
-- must never be used to acknowledge an edit. These commands preserve both
-- legacy_unversioned rows and captured ledger identity while advancing the
-- parent revision, immutable history and checklist compatibility projection
-- in one transaction.

begin;

create table private.ted_artifact_mutation_receipts (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artifact_id uuid not null references public.ted_artifacts(id) on delete cascade,
  block_id uuid not null,
  mutation_kind text not null check (
    mutation_kind in ('block_payload', 'block_completion')
  ),
  operation_key text not null check (
    operation_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
  ),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_artifact_revision integer not null check (accepted_artifact_revision > 0),
  accepted_block_revision integer not null check (accepted_block_revision > 0),
  result jsonb not null check (
    pg_catalog.jsonb_typeof(result) = 'object'
    and pg_catalog.octet_length(result::text) <= 8192
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id, mutation_kind, operation_key),
  foreign key (block_id, artifact_id, user_id)
    references public.ted_artifact_blocks(id, artifact_id, user_id)
    on delete cascade
);

comment on table private.ted_artifact_mutation_receipts is
  'Immutable metadata-only receipts for owner-scoped artifact mutations. Wording, references, prompts and document bodies remain solely in authoritative artifact rows and versions.';

alter table private.ted_artifact_mutation_receipts enable row level security;
revoke all on table private.ted_artifact_mutation_receipts
  from public, anon, authenticated, service_role;

create or replace function private.reject_ted_artifact_receipt_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'TED_ARTIFACT_MUTATION_RECEIPT_IMMUTABLE';
end;
$function$;

revoke all on function private.reject_ted_artifact_receipt_update()
  from public, anon, authenticated, service_role;

create trigger ted_artifact_mutation_receipt_immutable
  before update on private.ted_artifact_mutation_receipts
  for each row execute function private.reject_ted_artifact_receipt_update();

create or replace function public.save_ted_artifact_block_revision(
  p_block_id uuid,
  p_expected_artifact_revision integer,
  p_expected_block_revision integer,
  p_payload jsonb,
  p_section_state text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_previous_context text := private.ledger_write_context();
  v_operation_key text;
  v_request_sha256 text;
  v_receipt private.ted_artifact_mutation_receipts%rowtype;
  v_receipt_id uuid := extensions.uuid_generate_v4();
  v_result jsonb;
  v_projection_rows integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'ARTIFACT_AUTHENTICATION_REQUIRED';
  end if;
  if p_block_id is null
    or p_expected_artifact_revision is null
    or p_expected_artifact_revision < 1
    or p_expected_block_revision is null
    or p_expected_block_revision < 1 then
    raise exception using errcode = '22023', message = 'ARTIFACT_BLOCK_REVISION_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.octet_length(p_payload::text) > 1048576 then
    raise exception using errcode = '22023', message = 'ARTIFACT_BLOCK_PAYLOAD_INVALID';
  end if;
  if p_section_state is not null and p_section_state not in (
    'final', 'needs_clarification', 'interactive_placeholder',
    'neutral_fallback', 'omitted_optional', 'failed_validation'
  ) then
    raise exception using errcode = '22023', message = 'ARTIFACT_SECTION_STATE_INVALID';
  end if;

  v_operation_key := p_block_id::text
    || ':artifact:' || p_expected_artifact_revision::text
    || ':block:' || p_expected_block_revision::text;
  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'contract_version', 'ted-artifact-mutation.1',
          'mutation_kind', 'block_payload',
          'block_id', p_block_id,
          'expected_artifact_revision', p_expected_artifact_revision,
          'expected_block_revision', p_expected_block_revision,
          'payload', p_payload,
          'section_state', p_section_state
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select receipt_record.* into v_receipt
  from private.ted_artifact_mutation_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.mutation_kind = 'block_payload'
    and receipt_record.operation_key = v_operation_key;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'ARTIFACT_BLOCK_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt.result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  -- Checklist replacement and action edits share the outcome projection.
  -- Serialize on outcome first, then artifact, then block everywhere this
  -- command can touch those rows.
  perform 1
  from public.outcomes outcome_record
  where outcome_record.id = (
    select artifact_record.outcome_id
    from public.ted_artifacts artifact_record
    join public.ted_artifact_blocks block_record
      on block_record.artifact_id = artifact_record.id
    where block_record.id = p_block_id
      and block_record.user_id = v_user_id
      and artifact_record.user_id = v_user_id
  )
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_UNAVAILABLE';
  end if;

  select artifact_record.* into v_artifact
  from public.ted_artifacts artifact_record
  where artifact_record.id = (
    select block_record.artifact_id
    from public.ted_artifact_blocks block_record
    where block_record.id = p_block_id
      and block_record.user_id = v_user_id
  )
    and artifact_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_UNAVAILABLE';
  end if;

  select block_record.* into v_block
  from public.ted_artifact_blocks block_record
  where block_record.id = p_block_id
    and block_record.artifact_id = v_artifact.id
    and block_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_UNAVAILABLE';
  end if;

  -- A concurrent exact request may have committed while this call waited.
  select receipt_record.* into v_receipt
  from private.ted_artifact_mutation_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.mutation_kind = 'block_payload'
    and receipt_record.operation_key = v_operation_key;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'ARTIFACT_BLOCK_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt.result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  if v_artifact.current_revision <> p_expected_artifact_revision
    or v_block.revision <> p_expected_block_revision then
    raise exception using errcode = '40001', message = 'ARTIFACT_BLOCK_REVISION_CONFLICT';
  end if;
  if v_artifact.ledger_binding_status is distinct from v_block.ledger_binding_status then
    raise exception using errcode = '55000', message = 'ARTIFACT_LEDGER_BINDING_MISMATCH';
  end if;
  if v_artifact.ledger_binding_status = 'legacy_unversioned' then
    if p_section_state is not null then
      raise exception using
        errcode = '22023',
        message = 'LEGACY_ARTIFACT_SECTION_STATE_FORBIDDEN';
    end if;
  elsif v_artifact.ledger_binding_status = 'captured' then
    if p_section_state is null then
      raise exception using errcode = '22023', message = 'ARTIFACT_SECTION_STATE_REQUIRED';
    end if;
    if v_block.is_required and p_section_state = 'omitted_optional' then
      raise exception using
        errcode = '22023',
        message = 'REQUIRED_SECTION_CANNOT_BE_OMITTED';
    end if;
    if p_section_state = 'final'
      and v_block.kind = 'section'
      and pg_catalog.length(pg_catalog.btrim(coalesce(p_payload->>'content', ''))) = 0 then
      raise exception using errcode = '22023', message = 'BLANK_FINAL_SECTION';
    end if;
  else
    raise exception using errcode = '55000', message = 'ARTIFACT_LEDGER_BINDING_INVALID';
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'save_block', true);

  update public.ted_artifact_blocks block_record
  set payload = p_payload,
      section_state = p_section_state,
      approval_status = 'draft',
      approved_revision = null,
      revision = block_record.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where block_record.id = p_block_id
    and block_record.artifact_id = v_artifact.id
    and block_record.user_id = v_user_id
    and block_record.revision = p_expected_block_revision
  returning block_record.* into v_block;
  if not found then
    raise exception using errcode = '40001', message = 'ARTIFACT_BLOCK_REVISION_CONFLICT';
  end if;

  update public.ted_artifacts artifact_record
  set current_revision = artifact_record.current_revision + 1,
      status = 'needs_review',
      approved_revision = null,
      updated_at = pg_catalog.clock_timestamp()
  where artifact_record.id = v_artifact.id
    and artifact_record.user_id = v_user_id
    and artifact_record.current_revision = p_expected_artifact_revision
  returning artifact_record.* into v_artifact;
  if not found then
    raise exception using errcode = '40001', message = 'ARTIFACT_BLOCK_REVISION_CONFLICT';
  end if;

  if v_artifact.kind in ('action_plan', 'checklist') and v_block.kind = 'action' then
    update public.checklist_items checklist_record
    set text = coalesce(v_block.heading, 'General')
          || pg_catalog.chr(9247)
          || coalesce(v_block.payload->>'title', 'Action'),
        reason = v_block.payload->>'objective',
        due_date = v_block.due_date,
        done = v_block.completed_at is not null,
        updated_at = pg_catalog.clock_timestamp()
    where checklist_record.id = v_block.id
      and checklist_record.outcome_id = v_artifact.outcome_id
      and checklist_record.user_id = v_user_id;
    get diagnostics v_projection_rows = row_count;
    if v_projection_rows <> 1 then
      raise exception using
        errcode = '55000',
        message = 'ARTIFACT_CHECKLIST_PROJECTION_UNAVAILABLE';
    end if;
  end if;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  v_result := pg_catalog.jsonb_build_object(
    'contract_version', 'ted-artifact-mutation.1',
    'status', 'committed',
    'operation_id', v_receipt_id,
    'mutation_kind', 'block_payload',
    'artifact_id', v_artifact.id,
    'accepted_artifact_revision', p_expected_artifact_revision,
    'artifact_revision', v_artifact.current_revision,
    'artifact_status', v_artifact.status,
    'artifact_approved_revision', v_artifact.approved_revision,
    'block_id', v_block.id,
    'accepted_block_revision', p_expected_block_revision,
    'block_revision', v_block.revision,
    'ledger_binding_status', v_block.ledger_binding_status,
    'section_state', v_block.section_state,
    'approval_status', v_block.approval_status,
    'approved_revision', v_block.approved_revision,
    'idempotent_replay', false
  );

  insert into private.ted_artifact_mutation_receipts(
    id, user_id, artifact_id, block_id, mutation_kind, operation_key,
    request_sha256, accepted_artifact_revision, accepted_block_revision, result
  ) values (
    v_receipt_id, v_user_id, v_artifact.id, v_block.id, 'block_payload',
    v_operation_key, v_request_sha256, p_expected_artifact_revision,
    p_expected_block_revision, v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.save_ted_artifact_block_revision(
  uuid, integer, integer, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_ted_artifact_block_revision(
  uuid, integer, integer, jsonb, text
) to authenticated;

create or replace function public.set_ted_block_completed(
  p_block_id uuid,
  p_completed boolean,
  p_expected_revision integer
) returns public.ted_artifact_blocks
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_previous_context text := private.ledger_write_context();
  v_operation_key text;
  v_request_sha256 text;
  v_receipt private.ted_artifact_mutation_receipts%rowtype;
  v_receipt_id uuid := extensions.uuid_generate_v4();
  v_result jsonb;
  v_projection_rows integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'ARTIFACT_AUTHENTICATION_REQUIRED';
  end if;
  if p_block_id is null or p_completed is null
    or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'ARTIFACT_COMPLETION_REVISION_REQUIRED';
  end if;

  v_operation_key := p_block_id::text
    || ':block:' || p_expected_revision::text
    || ':completed:' || case when p_completed then 'true' else 'false' end;
  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'contract_version', 'ted-artifact-mutation.1',
          'mutation_kind', 'block_completion',
          'block_id', p_block_id,
          'expected_block_revision', p_expected_revision,
          'completed', p_completed
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select receipt_record.* into v_receipt
  from private.ted_artifact_mutation_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.mutation_kind = 'block_completion'
    and receipt_record.operation_key = v_operation_key;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'ARTIFACT_COMPLETION_REPLAY_CONFLICT';
    end if;
    select block_record.* into v_block
    from public.ted_artifact_blocks block_record
    where block_record.id = p_block_id
      and block_record.user_id = v_user_id
      and block_record.revision = (v_receipt.result->>'block_revision')::integer
      and (block_record.completed_at is not null) = p_completed
      and exists (
        select 1
        from public.checklist_items checklist_record
        where checklist_record.id = block_record.id
          and checklist_record.user_id = v_user_id
          and checklist_record.done = p_completed
      );
    if not found then
      raise exception using
        errcode = '40001',
        message = 'ARTIFACT_COMPLETION_REPLAY_SUPERSEDED';
    end if;
    return v_block;
  end if;

  perform 1
  from public.outcomes outcome_record
  where outcome_record.id = (
    select artifact_record.outcome_id
    from public.ted_artifacts artifact_record
    join public.ted_artifact_blocks block_record
      on block_record.artifact_id = artifact_record.id
    where block_record.id = p_block_id
      and block_record.user_id = v_user_id
      and artifact_record.user_id = v_user_id
  )
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_UNAVAILABLE';
  end if;

  select artifact_record.* into v_artifact
  from public.ted_artifacts artifact_record
  where artifact_record.id = (
    select block_record.artifact_id
    from public.ted_artifact_blocks block_record
    where block_record.id = p_block_id
      and block_record.user_id = v_user_id
  )
    and artifact_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_UNAVAILABLE';
  end if;

  select block_record.* into v_block
  from public.ted_artifact_blocks block_record
  where block_record.id = p_block_id
    and block_record.artifact_id = v_artifact.id
    and block_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_UNAVAILABLE';
  end if;

  select receipt_record.* into v_receipt
  from private.ted_artifact_mutation_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.mutation_kind = 'block_completion'
    and receipt_record.operation_key = v_operation_key;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'ARTIFACT_COMPLETION_REPLAY_CONFLICT';
    end if;
    if v_block.revision <> (v_receipt.result->>'block_revision')::integer
      or (v_block.completed_at is not null) <> p_completed then
      raise exception using
        errcode = '40001',
        message = 'ARTIFACT_COMPLETION_REPLAY_SUPERSEDED';
    end if;
    return v_block;
  end if;

  if v_block.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'ARTIFACT_BLOCK_REVISION_CONFLICT';
  end if;
  if v_artifact.ledger_binding_status is distinct from v_block.ledger_binding_status then
    raise exception using errcode = '55000', message = 'ARTIFACT_LEDGER_BINDING_MISMATCH';
  end if;
  if v_block.kind <> 'action'
    or v_artifact.kind not in ('action_plan', 'checklist') then
    raise exception using errcode = '22023', message = 'ARTIFACT_COMPLETION_UNSUPPORTED';
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'save_block', true);

  update public.ted_artifact_blocks block_record
  set completed_at = case
        when p_completed then pg_catalog.clock_timestamp()
        else null
      end,
      approval_status = 'draft',
      approved_revision = null,
      revision = block_record.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where block_record.id = p_block_id
    and block_record.artifact_id = v_artifact.id
    and block_record.user_id = v_user_id
    and block_record.revision = p_expected_revision
  returning block_record.* into v_block;
  if not found then
    raise exception using errcode = '40001', message = 'ARTIFACT_BLOCK_REVISION_CONFLICT';
  end if;

  update public.ted_artifacts artifact_record
  set current_revision = artifact_record.current_revision + 1,
      status = 'needs_review',
      approved_revision = null,
      updated_at = pg_catalog.clock_timestamp()
  where artifact_record.id = v_artifact.id
    and artifact_record.user_id = v_user_id
  returning artifact_record.* into v_artifact;

  update public.checklist_items checklist_record
  set done = p_completed,
      updated_at = pg_catalog.clock_timestamp()
  where checklist_record.id = p_block_id
    and checklist_record.outcome_id = v_artifact.outcome_id
    and checklist_record.user_id = v_user_id;
  get diagnostics v_projection_rows = row_count;
  if v_projection_rows <> 1 then
    raise exception using
      errcode = '55000',
      message = 'ARTIFACT_CHECKLIST_PROJECTION_UNAVAILABLE';
  end if;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  v_result := pg_catalog.jsonb_build_object(
    'contract_version', 'ted-artifact-mutation.1',
    'status', 'committed',
    'operation_id', v_receipt_id,
    'mutation_kind', 'block_completion',
    'artifact_id', v_artifact.id,
    'accepted_artifact_revision', v_artifact.current_revision - 1,
    'artifact_revision', v_artifact.current_revision,
    'block_id', v_block.id,
    'accepted_block_revision', p_expected_revision,
    'block_revision', v_block.revision,
    'completed', p_completed,
    'idempotent_replay', false
  );
  insert into private.ted_artifact_mutation_receipts(
    id, user_id, artifact_id, block_id, mutation_kind, operation_key,
    request_sha256, accepted_artifact_revision, accepted_block_revision, result
  ) values (
    v_receipt_id, v_user_id, v_artifact.id, v_block.id, 'block_completion',
    v_operation_key, v_request_sha256, v_artifact.current_revision - 1,
    p_expected_revision, v_result
  );
  return v_block;
end;
$function$;

revoke all on function public.set_ted_block_completed(uuid, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_ted_block_completed(uuid, boolean, integer)
  to authenticated;

commit;
