begin;

-- outcomes.updated_at is the existing public aggregate token. The generic
-- trigger used transaction-stable now(), so multiple accepted mutations in
-- one transaction could reuse or even lower it. Give outcomes a dedicated,
-- strictly monotonic trigger without changing other tables' timestamp rules.
create or replace function private.set_outcome_updated_at_monotonic_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := greatest(
    pg_catalog.clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$function$;

revoke all on function private.set_outcome_updated_at_monotonic_v1()
  from public, anon, authenticated, service_role;
drop trigger if exists outcomes_updated_at on public.outcomes;
create trigger outcomes_updated_at
  before update on public.outcomes
  for each row execute function private.set_outcome_updated_at_monotonic_v1();

-- Every authoritative checklist projection mutation advances the same parent
-- aggregate. Transition-table triggers update once per affected outcome per
-- statement and never copy child wording into aggregate metadata.
create or replace function private.advance_checklist_outcomes_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_parent record;
  v_rows integer;
begin
  if tg_op = 'INSERT' then
    for v_parent in
      select distinct transition_record.outcome_id, transition_record.user_id
      from new_checklist_rows transition_record
      order by transition_record.outcome_id, transition_record.user_id
    loop
      update public.outcomes outcome_record
      set updated_at = outcome_record.updated_at
      where outcome_record.id = v_parent.outcome_id
        and outcome_record.user_id = v_parent.user_id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception using errcode = '55000', message = 'CHECKLIST_OUTCOME_OWNER_MISMATCH';
      end if;
    end loop;
  elsif tg_op = 'UPDATE' then
    for v_parent in
      select distinct transition_record.outcome_id, transition_record.user_id
      from (
        select old_record.outcome_id, old_record.user_id
        from old_checklist_rows old_record
        union
        select new_record.outcome_id, new_record.user_id
        from new_checklist_rows new_record
      ) transition_record
      order by transition_record.outcome_id, transition_record.user_id
    loop
      update public.outcomes outcome_record
      set updated_at = outcome_record.updated_at
      where outcome_record.id = v_parent.outcome_id
        and outcome_record.user_id = v_parent.user_id;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then
        raise exception using errcode = '55000', message = 'CHECKLIST_OUTCOME_OWNER_MISMATCH';
      end if;
    end loop;
  elsif tg_op = 'DELETE' then
    for v_parent in
      select distinct transition_record.outcome_id, transition_record.user_id
      from old_checklist_rows transition_record
      order by transition_record.outcome_id, transition_record.user_id
    loop
      -- A missing parent is allowed only for a parent/account deletion cascade.
      update public.outcomes outcome_record
      set updated_at = outcome_record.updated_at
      where outcome_record.id = v_parent.outcome_id
        and outcome_record.user_id = v_parent.user_id;
    end loop;
  end if;
  return null;
end;
$function$;

revoke all on function private.advance_checklist_outcomes_v1()
  from public, anon, authenticated, service_role;
drop trigger if exists checklist_items_aggregate_insert on public.checklist_items;
drop trigger if exists checklist_items_aggregate_update on public.checklist_items;
drop trigger if exists checklist_items_aggregate_delete on public.checklist_items;
create trigger checklist_items_aggregate_insert
  after insert on public.checklist_items
  referencing new table as new_checklist_rows
  for each statement execute function private.advance_checklist_outcomes_v1();
create trigger checklist_items_aggregate_update
  after update on public.checklist_items
  referencing old table as old_checklist_rows new table as new_checklist_rows
  for each statement execute function private.advance_checklist_outcomes_v1();
create trigger checklist_items_aggregate_delete
  after delete on public.checklist_items
  referencing old table as old_checklist_rows
  for each statement execute function private.advance_checklist_outcomes_v1();

-- Preserve the reviewed implementation as a private implementation detail.
-- The stable public signature now locks and reconciles current aggregate truth
-- before the old implementation can return an immutable receipt.
alter function public.replace_own_checklist(uuid, text, timestamptz, jsonb)
  rename to replace_own_checklist_unwrapped_v1;
alter function public.replace_own_checklist_unwrapped_v1(uuid, text, timestamptz, jsonb)
  set schema private;
revoke all on function private.replace_own_checklist_unwrapped_v1(
  uuid, text, timestamptz, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.replace_own_checklist(
  p_outcome_id uuid,
  p_request_id text,
  p_expected_outcome_updated_at timestamptz,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_outcome_updated_at timestamptz;
  v_request_sha256 text;
  v_receipt private.checklist_replacement_receipts%rowtype;
  v_receipt_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'CHECKLIST_AUTHENTICATION_REQUIRED';
  end if;
  if p_outcome_id is null or p_expected_outcome_updated_at is null
    or p_request_id is null
    or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'CHECKLIST_COMMAND_INVALID';
  end if;

  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'contract_version', 'checklist-replacement.1',
          'outcome_id', p_outcome_id,
          'items', p_items
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select outcome_record.updated_at into v_outcome_updated_at
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CHECKLIST_OUTCOME_NOT_FOUND';
  end if;

  select receipt_record.* into v_receipt
  from private.checklist_replacement_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.outcome_id = p_outcome_id
    and receipt_record.request_id = p_request_id;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'CHECKLIST_REPLAY_CONFLICT';
    end if;
    begin
      if pg_catalog.jsonb_typeof(v_receipt.result) is distinct from 'object'
        or nullif(v_receipt.result->>'outcome_updated_at', '') is null then
        raise exception using errcode = '55000', message = 'CHECKLIST_RECEIPT_INVALID';
      end if;
      v_receipt_updated_at := (v_receipt.result->>'outcome_updated_at')::timestamptz;
    exception when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '55000', message = 'CHECKLIST_RECEIPT_INVALID';
    end;
    if v_receipt_updated_at > v_outcome_updated_at then
      raise exception using errcode = '55000', message = 'CHECKLIST_RECEIPT_AHEAD';
    end if;
    if v_receipt_updated_at < v_outcome_updated_at then
      raise exception using errcode = '40001', message = 'CHECKLIST_REPLAY_SUPERSEDED';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt.result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  if v_outcome_updated_at is distinct from p_expected_outcome_updated_at then
    raise exception using errcode = '40001', message = 'CHECKLIST_REVISION_CONFLICT';
  end if;
  return private.replace_own_checklist_unwrapped_v1(
    p_outcome_id,
    p_request_id,
    p_expected_outcome_updated_at,
    p_items
  );
end;
$function$;

revoke all on function public.replace_own_checklist(uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_own_checklist(uuid, text, timestamptz, jsonb)
  to authenticated;

-- The full artifact save is also a checklist writer. Lock its owner outcome
-- before the preserved implementation can lock artifact or child rows.
alter function public.save_ted_artifact(jsonb, jsonb)
  rename to save_ted_artifact_unwrapped_v1;
alter function public.save_ted_artifact_unwrapped_v1(jsonb, jsonb)
  set schema private;
revoke all on function private.save_ted_artifact_unwrapped_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.save_ted_artifact(
  p_artifact jsonb,
  p_blocks jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_outcome_id uuid;
  v_artifact_id uuid;
  v_request_id text;
  v_existing public.ted_artifacts%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if pg_catalog.jsonb_typeof(p_artifact) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'artifact must be an object';
  end if;
  if pg_catalog.jsonb_typeof(p_blocks) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'blocks must be an array';
  end if;
  begin
    v_outcome_id := nullif(p_artifact->>'outcome_id', '')::uuid;
    v_artifact_id := nullif(p_artifact->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'ARTIFACT_IDENTITY_INVALID';
  end;
  if v_outcome_id is null then
    raise exception using errcode = '22023', message = 'ARTIFACT_OUTCOME_REQUIRED';
  end if;
  v_request_id := nullif(p_artifact->>'request_id', '');

  perform 1
  from public.outcomes outcome_record
  where outcome_record.id = v_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_OUTCOME_NOT_FOUND';
  end if;

  if v_request_id is not null then
    select artifact_record.* into v_existing
    from public.ted_artifacts artifact_record
    where artifact_record.user_id = v_user_id
      and artifact_record.request_id = v_request_id
    for update;
    if found and v_existing.outcome_id is distinct from v_outcome_id then
      raise exception using errcode = '23505', message = 'ARTIFACT_REQUEST_OUTCOME_CONFLICT';
    end if;
  end if;
  if v_artifact_id is not null then
    select artifact_record.* into v_existing
    from public.ted_artifacts artifact_record
    where artifact_record.id = v_artifact_id
    for update;
    if found and (
      v_existing.user_id is distinct from v_user_id
      or v_existing.outcome_id is distinct from v_outcome_id
    ) then
      raise exception using errcode = '42501', message = 'artifact not found';
    end if;
  end if;

  return private.save_ted_artifact_unwrapped_v1(p_artifact, p_blocks);
end;
$function$;

revoke all on function public.save_ted_artifact(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_ted_artifact(jsonb, jsonb)
  to authenticated;

-- Exact block approval now shares outcome -> artifact -> block lock order and
-- cannot approve a parent that has no required blocks.
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
  v_outcome_id uuid;
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_required_count integer;
  v_exact_approved_count integer;
  v_all_required_approved boolean;
  v_previous_context text := private.ledger_write_context();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'ARTIFACT_AUTHENTICATION_REQUIRED';
  end if;
  if p_block_id is null or p_expected_artifact_revision is null
    or p_expected_artifact_revision < 1 or p_expected_block_revision is null
    or p_expected_block_revision < 1 then
    raise exception using errcode = '22023', message = 'ARTIFACT_APPROVAL_REVISION_REQUIRED';
  end if;

  select artifact_record.outcome_id into v_outcome_id
  from public.ted_artifacts artifact_record
  join public.ted_artifact_blocks block_record
    on block_record.artifact_id = artifact_record.id
  where block_record.id = p_block_id
    and block_record.user_id = v_user_id
    and artifact_record.user_id = v_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_NOT_FOUND';
  end if;

  perform 1
  from public.outcomes outcome_record
  where outcome_record.id = v_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_NOT_FOUND';
  end if;

  select artifact_record.* into v_artifact
  from public.ted_artifacts artifact_record
  join public.ted_artifact_blocks block_record
    on block_record.artifact_id = artifact_record.id
  where block_record.id = p_block_id
    and artifact_record.user_id = v_user_id
  for update of artifact_record;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_NOT_FOUND';
  end if;

  select block_record.* into v_block
  from public.ted_artifact_blocks block_record
  where block_record.id = p_block_id
    and block_record.artifact_id = v_artifact.id
    and block_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'ARTIFACT_BLOCK_NOT_FOUND';
  end if;

  if v_artifact.ledger_binding_status <> 'captured'
    or v_block.ledger_binding_status <> 'captured' then
    raise exception using errcode = '55000', message = 'LEDGER_BINDING_REQUIRED';
  end if;
  if v_artifact.current_revision <> p_expected_artifact_revision
    or v_block.revision <> p_expected_block_revision then
    raise exception using errcode = '40001', message = 'STALE_APPROVAL_CONFLICT';
  end if;
  if v_block.section_state <> 'final' then
    raise exception using errcode = '22023', message = 'SECTION_NOT_FINAL';
  end if;
  if v_block.kind = 'section'
    and pg_catalog.length(pg_catalog.btrim(
      coalesce(v_block.payload->>'content', '')
    )) = 0 then
    raise exception using errcode = '22023', message = 'BLANK_SECTION_CANNOT_BE_APPROVED';
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'approve_block', true);

  update public.ted_artifact_blocks block_record
  set approval_status = 'approved',
      revision = block_record.revision + 1,
      approved_revision = block_record.revision + 1,
      updated_at = pg_catalog.clock_timestamp()
  where block_record.id = p_block_id
    and block_record.artifact_id = v_artifact.id
    and block_record.user_id = v_user_id
    and block_record.revision = p_expected_block_revision
  returning block_record.* into v_block;
  if not found then
    raise exception using errcode = '40001', message = 'STALE_APPROVAL_CONFLICT';
  end if;

  select
    pg_catalog.count(*) filter (
      where required_block.is_required is distinct from false
    )::integer,
    pg_catalog.count(*) filter (
      where required_block.is_required is distinct from false
        and required_block.section_state = 'final'
        and required_block.approval_status in ('approved', 'locked')
        and required_block.approved_revision is not distinct from required_block.revision
    )::integer
  into v_required_count, v_exact_approved_count
  from public.ted_artifact_blocks required_block
  where required_block.artifact_id = v_artifact.id
    and required_block.user_id = v_user_id;
  v_all_required_approved := v_required_count > 0
    and v_exact_approved_count = v_required_count;

  update public.ted_artifacts artifact_record
  set current_revision = artifact_record.current_revision + 1,
      status = case when v_all_required_approved then 'approved' else 'needs_review' end,
      approved_revision = case
        when v_all_required_approved then artifact_record.current_revision + 1
        else null
      end,
      updated_at = pg_catalog.clock_timestamp()
  where artifact_record.id = v_artifact.id
    and artifact_record.user_id = v_user_id
    and artifact_record.current_revision = p_expected_artifact_revision
  returning artifact_record.* into v_artifact;
  if not found then
    raise exception using errcode = '40001', message = 'STALE_APPROVAL_CONFLICT';
  end if;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config('prompted.ledger_write_context', v_previous_context, true);

  return pg_catalog.jsonb_build_object(
    'contract_version', 'ted-artifact-approval.1',
    'status', 'committed',
    'artifact_id', v_artifact.id,
    'accepted_artifact_revision', p_expected_artifact_revision,
    'artifact_revision', v_artifact.current_revision,
    'artifact_status', v_artifact.status,
    'artifact_approved_revision', v_artifact.approved_revision,
    'block_id', v_block.id,
    'accepted_block_revision', p_expected_block_revision,
    'block_revision', v_block.revision,
    'approved_revision', v_block.approved_revision,
    'approval_status', v_block.approval_status,
    'required_block_count', v_required_count,
    'exact_approved_required_block_count', v_exact_approved_count,
    'all_required_blocks_approved', v_all_required_approved,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.approve_ted_artifact_block_revision(uuid, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_ted_artifact_block_revision(uuid, integer, integer)
  to authenticated;

revoke insert, update, delete on public.checklist_items from authenticated;
grant select on public.checklist_items to authenticated;

commit;
