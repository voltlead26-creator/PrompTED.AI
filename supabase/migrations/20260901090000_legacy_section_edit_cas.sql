-- Revision-safe TED suggestions for legacy document sections.
--
-- The provider is allowed to suggest wording only against one exact persisted
-- section revision. Applying that suggestion is a separate authenticated CAS
-- mutation, so a delayed response can never overwrite a newer browser/tab edit.

begin;

create table private.legacy_section_edit_operations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  accepted_section_revision integer not null check (accepted_section_revision > 0),
  accepted_content_sha256 text not null
    check (accepted_content_sha256 ~ '^[0-9a-f]{64}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  request_metadata jsonb not null
    check (
      pg_catalog.jsonb_typeof(request_metadata) = 'object'
      and pg_catalog.octet_length(request_metadata::text) <= 8192
    ),
  status text not null default 'accepted'
    check (status in (
      'accepted', 'provider_dispatched', 'ready', 'applied', 'discarded',
      'cancelled', 'terminal_failure', 'reconciliation_required'
    )),
  suggested_content text,
  result_sha256 text check (result_sha256 ~ '^[0-9a-f]{64}$'),
  applied_candidate_content text,
  applied_candidate_sha256 text
    check (applied_candidate_sha256 ~ '^[0-9a-f]{64}$'),
  changes jsonb,
  result_metadata jsonb check (
    pg_catalog.jsonb_typeof(result_metadata) = 'object'
    and pg_catalog.octet_length(result_metadata::text) <= 32768
  ),
  applied_content_sha256 text
    check (applied_content_sha256 ~ '^[0-9a-f]{64}$'),
  applied_section_revision integer check (applied_section_revision > 0),
  terminal_code text check (terminal_code ~ '^[A-Z][A-Z0-9_]{3,127}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  applied_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id, id),
  check (
    (status = 'accepted'
      and suggested_content is null
      and result_sha256 is null
      and applied_candidate_content is null
      and applied_candidate_sha256 is null
      and changes is null
      and result_metadata is null
      and dispatched_at is null
      and completed_at is null
      and applied_content_sha256 is null
      and applied_section_revision is null
      and applied_at is null
      and terminal_code is null
      and terminal_at is null)
    or
    (status = 'provider_dispatched'
      and suggested_content is null
      and result_sha256 is null
      and applied_candidate_content is null
      and applied_candidate_sha256 is null
      and changes is null
      and result_metadata is null
      and dispatched_at is not null
      and completed_at is null
      and applied_content_sha256 is null
      and applied_section_revision is null
      and applied_at is null
      and terminal_code is null
      and terminal_at is null)
    or
    (status in ('ready', 'discarded')
      and suggested_content is not null
      and result_sha256 is not null
      and applied_candidate_content is not null
      and applied_candidate_sha256 is not null
      and pg_catalog.jsonb_typeof(changes) = 'array'
      and result_metadata is not null
      and dispatched_at is not null
      and completed_at is not null
      and applied_content_sha256 is null
      and applied_section_revision is null
      and applied_at is null
      and terminal_code is null
      and terminal_at is null)
    or
    (status in ('cancelled', 'terminal_failure', 'reconciliation_required')
      and suggested_content is null
      and result_sha256 is null
      and applied_candidate_content is null
      and applied_candidate_sha256 is null
      and changes is null
      and result_metadata is null
      and completed_at is null
      and applied_content_sha256 is null
      and applied_section_revision is null
      and applied_at is null
      and terminal_code is not null
      and terminal_at is not null
      and (status <> 'reconciliation_required' or dispatched_at is not null))
    or
    (status = 'applied'
      and suggested_content is not null
      and result_sha256 is not null
      and applied_candidate_content is not null
      and applied_candidate_sha256 is not null
      and pg_catalog.jsonb_typeof(changes) = 'array'
      and result_metadata is not null
      and dispatched_at is not null
      and completed_at is not null
      and applied_content_sha256 is not null
      and applied_section_revision is not null
      and applied_at is not null
      and terminal_code is null
      and terminal_at is null)
  ),
  check (suggested_content is null or pg_catalog.octet_length(suggested_content) <= 262144),
  check (
    applied_candidate_content is null
    or pg_catalog.octet_length(applied_candidate_content) <= 1048576
  ),
  check (changes is null or pg_catalog.octet_length(changes::text) <= 65536)
);

create index legacy_section_edit_operations_owner_created_idx
  on private.legacy_section_edit_operations(user_id, created_at desc);
create index legacy_section_edit_operations_section_idx
  on private.legacy_section_edit_operations(section_id, created_at desc);

alter table private.legacy_section_edit_operations enable row level security;
revoke all on table private.legacy_section_edit_operations
  from public, anon, authenticated, service_role;

create or replace function private.hash_legacy_section_content(p_content text)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_content, 'UTF8'), 'sha256'),
    'hex'
  )
$function$;

revoke all on function private.hash_legacy_section_content(text)
  from public, anon, authenticated, service_role;

create or replace function private.guard_legacy_section_edit_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_catalog.pg_trigger_depth() > 1 then return old; end if;
    raise exception 'LEGACY_SECTION_EDIT_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'INSERT' then return new; end if;

  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.document_id is distinct from old.document_id
    or new.section_id is distinct from old.section_id
    or new.accepted_section_revision is distinct from old.accepted_section_revision
    or new.accepted_content_sha256 is distinct from old.accepted_content_sha256
    or new.request_sha256 is distinct from old.request_sha256
    or new.request_metadata is distinct from old.request_metadata
    or new.created_at is distinct from old.created_at then
    raise exception 'LEGACY_SECTION_EDIT_IDENTITY_IMMUTABLE';
  end if;

  if old.status <> 'provider_dispatched' and (
    new.suggested_content is distinct from old.suggested_content
    or new.result_sha256 is distinct from old.result_sha256
    or new.applied_candidate_content is distinct from old.applied_candidate_content
    or new.applied_candidate_sha256 is distinct from old.applied_candidate_sha256
    or new.changes is distinct from old.changes
    or new.result_metadata is distinct from old.result_metadata
    or new.completed_at is distinct from old.completed_at
  ) then
    raise exception 'LEGACY_SECTION_EDIT_SUGGESTION_IMMUTABLE';
  end if;

  if old.status <> 'accepted'
    and new.dispatched_at is distinct from old.dispatched_at then
    raise exception 'LEGACY_SECTION_EDIT_DISPATCH_IMMUTABLE';
  end if;

  if old.status not in ('accepted', 'provider_dispatched') and (
    new.terminal_code is distinct from old.terminal_code
    or new.terminal_at is distinct from old.terminal_at
  ) then
    raise exception 'LEGACY_SECTION_EDIT_TERMINAL_IMMUTABLE';
  end if;

  if not (
    (old.status = 'accepted' and new.status in (
      'provider_dispatched', 'cancelled', 'terminal_failure'
    ))
    or (old.status = 'provider_dispatched' and new.status in (
      'ready', 'cancelled', 'terminal_failure', 'reconciliation_required'
    ))
    or (old.status = 'ready' and new.status in (
      'applied', 'discarded'
    ))
  ) then
    raise exception 'LEGACY_SECTION_EDIT_TRANSITION_INVALID:%:%',
      old.status, new.status;
  end if;
  return new;
end;
$function$;

create trigger legacy_section_edit_operation_guard
  before update or delete on private.legacy_section_edit_operations
  for each row execute function private.guard_legacy_section_edit_operation();

revoke all on function private.guard_legacy_section_edit_operation()
  from public, anon, authenticated, service_role;

-- Legacy browser writes remain available during the expand/contract cohort,
-- but the database owns their monotonic revision and history. Captured rows
-- retain their stricter capability-guarded trigger and RPC authority.
create or replace function private.advance_legacy_section_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed boolean;
begin
  if old.ledger_binding_status <> 'legacy_unversioned' then
    return new;
  end if;

  -- Browser callers cannot forge either the revision counter or the audit
  -- history. A substantive content/status write advances exactly once.
  new.revision := old.revision;
  new.version_history := old.version_history;
  new.approved_revision := old.approved_revision;
  v_changed := new.content is distinct from old.content
    or new.status is distinct from old.status;

  if not v_changed then
    return new;
  end if;

  new.revision := old.revision + 1;
  if new.content is distinct from old.content then
    new.version_history := old.version_history || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'content', old.content,
        'saved_at', pg_catalog.clock_timestamp(),
        'label', 'Before saved change',
        'origin', 'system'
      )
    );
    new.approved_revision := null;
    if new.status = 'approved' then new.status := 'edited'; end if;
  elsif new.status = 'approved' then
    new.approved_revision := old.revision + 1;
  elsif old.status = 'approved' then
    new.approved_revision := null;
  end if;

  -- Approval belongs to exact wording and section state. Reset the legacy
  -- parent and advance its aggregate revision in this same transaction for
  -- every direct browser save as well as TED apply. Captured parents remain
  -- under their separate write capability.
  update public.documents document_record
  set current_revision = document_record.current_revision + 1,
      status = case
        when document_record.status in ('approved', 'exported') then 'edited'
        else document_record.status
      end,
      approved_revision = null,
      updated_at = pg_catalog.clock_timestamp()
  where document_record.id = old.document_id
    and document_record.user_id = old.user_id
    and document_record.ledger_binding_status = 'legacy_unversioned';
  return new;
end;
$function$;

drop trigger if exists legacy_sections_revision_owner on public.sections;
create trigger legacy_sections_revision_owner
  before update on public.sections
  for each row execute function private.advance_legacy_section_revision();

revoke all on function private.advance_legacy_section_revision()
  from public, anon, authenticated, service_role;

create or replace function public.prepare_legacy_section_edit(
  p_user_id uuid,
  p_operation_id uuid,
  p_document_id uuid,
  p_section_id uuid,
  p_expected_section_revision integer,
  p_accepted_content_sha256 text,
  p_request_sha256 text,
  p_request_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.legacy_section_edit_operations%rowtype;
  v_section public.sections%rowtype;
  v_hash text;
begin
  if p_user_id is null
    or p_operation_id is null
    or p_document_id is null
    or p_section_id is null
    or p_expected_section_revision is null
    or p_expected_section_revision < 1
    or p_accepted_content_sha256 is null
    or p_accepted_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_request_metadata) is distinct from 'object'
    or pg_catalog.octet_length(p_request_metadata::text) > 8192 then
    raise exception 'LEGACY_SECTION_EDIT_INPUT_INVALID';
  end if;

  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id
  for update;
  if found then
    if v_operation.user_id <> p_user_id
      or v_operation.document_id <> p_document_id
      or v_operation.section_id <> p_section_id
      or v_operation.accepted_section_revision <> p_expected_section_revision
      or v_operation.accepted_content_sha256 <> p_accepted_content_sha256
      or v_operation.request_sha256 <> p_request_sha256
      or v_operation.request_metadata <> p_request_metadata then
      raise exception 'LEGACY_SECTION_EDIT_REPLAY_CONFLICT';
    end if;
    -- A worker that disappeared after durable dispatch must never be silently
    -- re-dispatched. Once the bounded in-flight window expires, make the
    -- ambiguous outcome explicit and require a fresh operation identity.
    if v_operation.status = 'provider_dispatched'
      and v_operation.updated_at
        < pg_catalog.clock_timestamp() - interval '5 minutes' then
      update private.legacy_section_edit_operations
      set status = 'reconciliation_required',
          terminal_code = 'LEGACY_SECTION_EDIT_DISPATCH_OUTCOME_AMBIGUOUS',
          terminal_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      where id = v_operation.id
      returning * into v_operation;
    end if;
    if v_operation.status in ('accepted', 'ready') then
      select * into v_section
      from public.sections section_record
      where section_record.id = v_operation.section_id
        and section_record.document_id = v_operation.document_id
        and section_record.user_id = v_operation.user_id
      for update;
      if found then
        v_hash := private.hash_legacy_section_content(v_section.content);
      else
        v_hash := null;
      end if;
      if not found
        or v_section.ledger_binding_status <> 'legacy_unversioned'
        or v_section.revision <> v_operation.accepted_section_revision
        or v_hash <> v_operation.accepted_content_sha256 then
        if v_operation.status = 'ready' then
          return pg_catalog.jsonb_strip_nulls(
            pg_catalog.jsonb_build_object(
              'state', 'stale',
              'code', 'LEGACY_SECTION_EDIT_STALE',
              'operation_id', v_operation.id,
              'accepted_section_revision',
                v_operation.accepted_section_revision,
              'accepted_content_sha256',
                v_operation.accepted_content_sha256,
              'current_section_revision', v_section.revision,
              'current_content_sha256', v_hash,
              'idempotent_replay', true
            )
          );
        end if;
        raise exception 'LEGACY_SECTION_EDIT_STALE';
      end if;
    end if;
    return pg_catalog.jsonb_build_object(
      'state', v_operation.status,
      'operation_id', v_operation.id,
      'accepted_section_revision', v_operation.accepted_section_revision,
      'accepted_content_sha256', v_operation.accepted_content_sha256,
      'suggested_content', v_operation.suggested_content,
      'result_sha256', v_operation.result_sha256,
      'applied_candidate_content', v_operation.applied_candidate_content,
      'applied_candidate_sha256', v_operation.applied_candidate_sha256,
      'changes', v_operation.changes,
      'result_metadata', v_operation.result_metadata,
      'applied_section_revision', v_operation.applied_section_revision,
      'terminal_code', v_operation.terminal_code,
      'authoritative_content', case
        when v_operation.status = 'accepted' then v_section.content
        else null
      end,
      'idempotent_replay', true
    );
  end if;

  if exists (
    select 1
    from private.legacy_section_edit_operations operation_record
    where operation_record.id = p_operation_id
  ) then
    raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND';
  end if;

  select * into v_section
  from public.sections section_record
  where section_record.id = p_section_id
    and section_record.document_id = p_document_id
    and section_record.user_id = p_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;

  if v_section.ledger_binding_status <> 'legacy_unversioned' then
    raise exception 'CAPTURED_SECTION_EDIT_RPC_REQUIRED';
  end if;

  v_hash := private.hash_legacy_section_content(v_section.content);
  if v_section.revision <> p_expected_section_revision
    or v_hash <> p_accepted_content_sha256 then
    raise exception 'LEGACY_SECTION_EDIT_STALE';
  end if;

  insert into private.legacy_section_edit_operations(
    id, user_id, document_id, section_id, accepted_section_revision,
    accepted_content_sha256, request_sha256, request_metadata
  ) values (
    p_operation_id, p_user_id, p_document_id, p_section_id,
    p_expected_section_revision, p_accepted_content_sha256, p_request_sha256,
    p_request_metadata
  ) returning * into v_operation;

  return pg_catalog.jsonb_build_object(
    'state', 'accepted',
    'operation_id', v_operation.id,
    'accepted_section_revision', v_section.revision,
    'accepted_content_sha256', v_hash,
    'authoritative_content', v_section.content,
    'ledger_binding_status', v_section.ledger_binding_status,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.prepare_legacy_section_edit(
  uuid, uuid, uuid, uuid, integer, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.prepare_legacy_section_edit(
  uuid, uuid, uuid, uuid, integer, text, text, jsonb
) to service_role;

-- The first caller that advances accepted -> provider_dispatched owns the
-- single provider dispatch for this logical operation. A replay can observe
-- the state but cannot acquire a second dispatch.
create or replace function public.mark_legacy_section_edit_dispatched(
  p_user_id uuid,
  p_operation_id uuid,
  p_request_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.legacy_section_edit_operations%rowtype;
begin
  if p_user_id is null
    or p_operation_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'LEGACY_SECTION_EDIT_DISPATCH_INPUT_INVALID';
  end if;

  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;
  if v_operation.request_sha256 <> p_request_sha256 then
    raise exception 'LEGACY_SECTION_EDIT_REPLAY_CONFLICT';
  end if;
  if v_operation.status = 'provider_dispatched' then
    return pg_catalog.jsonb_build_object(
      'state', v_operation.status,
      'operation_id', v_operation.id,
      'idempotent_replay', true
    );
  end if;
  if v_operation.status <> 'accepted' then
    raise exception 'LEGACY_SECTION_EDIT_STATE_INVALID:%', v_operation.status;
  end if;

  update private.legacy_section_edit_operations
  set status = 'provider_dispatched',
      dispatched_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  return pg_catalog.jsonb_build_object(
    'state', v_operation.status,
    'operation_id', v_operation.id,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.mark_legacy_section_edit_dispatched(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mark_legacy_section_edit_dispatched(uuid, uuid, text)
  to service_role;

-- Exact service-only terminal settlement. No terminal row can be reopened;
-- the browser must create a new operation UUID for an explicit new attempt.
create or replace function public.settle_legacy_section_edit(
  p_user_id uuid,
  p_operation_id uuid,
  p_request_sha256 text,
  p_terminal_state text,
  p_terminal_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.legacy_section_edit_operations%rowtype;
begin
  if p_user_id is null
    or p_operation_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_terminal_state not in (
      'cancelled', 'terminal_failure', 'reconciliation_required'
    )
    or p_terminal_code is null
    or p_terminal_code !~ '^[A-Z][A-Z0-9_]{3,127}$' then
    raise exception 'LEGACY_SECTION_EDIT_SETTLEMENT_INPUT_INVALID';
  end if;

  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;
  if v_operation.request_sha256 <> p_request_sha256 then
    raise exception 'LEGACY_SECTION_EDIT_REPLAY_CONFLICT';
  end if;

  if v_operation.status in (
    'cancelled', 'terminal_failure', 'reconciliation_required'
  ) then
    if v_operation.status <> p_terminal_state
      or v_operation.terminal_code <> p_terminal_code then
      raise exception 'LEGACY_SECTION_EDIT_SETTLEMENT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', v_operation.status,
      'operation_id', v_operation.id,
      'terminal_code', v_operation.terminal_code,
      'idempotent_replay', true
    );
  end if;

  if not (
    (v_operation.status = 'accepted'
      and p_terminal_state in ('cancelled', 'terminal_failure'))
    or
    (v_operation.status = 'provider_dispatched'
      and p_terminal_state in (
        'cancelled', 'terminal_failure', 'reconciliation_required'
      ))
  ) then
    raise exception 'LEGACY_SECTION_EDIT_STATE_INVALID:%', v_operation.status;
  end if;

  update private.legacy_section_edit_operations
  set status = p_terminal_state,
      terminal_code = p_terminal_code,
      terminal_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  return pg_catalog.jsonb_build_object(
    'state', v_operation.status,
    'operation_id', v_operation.id,
    'terminal_code', v_operation.terminal_code,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.settle_legacy_section_edit(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.settle_legacy_section_edit(
  uuid, uuid, text, text, text
) to service_role;

create or replace function public.complete_legacy_section_edit(
  p_user_id uuid,
  p_operation_id uuid,
  p_request_sha256 text,
  p_suggested_content text,
  p_applied_candidate_content text,
  p_changes jsonb,
  p_result_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.legacy_section_edit_operations%rowtype;
  v_result_sha256 text;
  v_candidate_sha256 text;
begin
  if p_user_id is null
    or p_operation_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(pg_catalog.btrim(p_suggested_content), '') is null
    or pg_catalog.octet_length(p_suggested_content) > 262144
    or nullif(pg_catalog.btrim(p_applied_candidate_content), '') is null
    or pg_catalog.octet_length(p_applied_candidate_content) > 1048576
    or pg_catalog.jsonb_typeof(p_changes) is distinct from 'array'
    or pg_catalog.octet_length(p_changes::text) > 65536
    or pg_catalog.jsonb_typeof(p_result_metadata) is distinct from 'object'
    or pg_catalog.octet_length(p_result_metadata::text) > 32768 then
    raise exception 'LEGACY_SECTION_EDIT_RESULT_INVALID';
  end if;
  v_result_sha256 := private.hash_legacy_section_content(p_suggested_content);
  v_candidate_sha256 := private.hash_legacy_section_content(
    p_applied_candidate_content
  );

  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;
  if v_operation.request_sha256 <> p_request_sha256 then
    raise exception 'LEGACY_SECTION_EDIT_REPLAY_CONFLICT';
  end if;
  if v_operation.status = 'ready' then
    if v_operation.suggested_content <> p_suggested_content
      or v_operation.result_sha256 <> v_result_sha256
      or v_operation.applied_candidate_content <> p_applied_candidate_content
      or v_operation.applied_candidate_sha256 <> v_candidate_sha256
      or v_operation.changes <> p_changes
      or v_operation.result_metadata <> p_result_metadata then
      raise exception 'LEGACY_SECTION_EDIT_RESULT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'ready',
      'operation_id', v_operation.id,
      'result_sha256', v_operation.result_sha256,
      'idempotent_replay', true
    );
  end if;
  if v_operation.status <> 'provider_dispatched' then
    raise exception 'LEGACY_SECTION_EDIT_STATE_INVALID:%', v_operation.status;
  end if;

  update private.legacy_section_edit_operations
  set status = 'ready',
      suggested_content = p_suggested_content,
      result_sha256 = v_result_sha256,
      applied_candidate_content = p_applied_candidate_content,
      applied_candidate_sha256 = v_candidate_sha256,
      changes = p_changes,
      result_metadata = p_result_metadata,
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  return pg_catalog.jsonb_build_object(
    'state', 'ready',
    'operation_id', v_operation.id,
    'result_sha256', v_operation.result_sha256,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.complete_legacy_section_edit(
  uuid, uuid, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_legacy_section_edit(
  uuid, uuid, text, text, text, jsonb, jsonb
) to service_role;

-- Every browser save of an already-persisted legacy section is an
-- authenticated compare-and-swap. The expected body hash catches cross-tab
-- drift even if a future compatibility client mishandles its revision field.
create or replace function public.save_legacy_section(
  p_section_id uuid,
  p_expected_section_revision integer,
  p_expected_content_sha256 text,
  p_content text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_section public.sections%rowtype;
  v_document public.documents%rowtype;
  v_current_hash text;
  v_changed boolean;
  v_exact_replay boolean := false;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_section_id is null
    or p_expected_section_revision is null
    or p_expected_section_revision < 1
    or p_expected_content_sha256 is null
    or p_expected_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_content is null
    or pg_catalog.octet_length(p_content) > 1048576
    or p_status is null
    or p_status not in ('draft', 'edited', 'approved', 'locked') then
    raise exception 'LEGACY_SECTION_SAVE_INPUT_INVALID';
  end if;

  select * into v_section
  from public.sections section_record
  where section_record.id = p_section_id
    and section_record.user_id = v_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_SAVE_NOT_FOUND'; end if;
  if v_section.ledger_binding_status <> 'legacy_unversioned' then
    raise exception 'CAPTURED_SECTION_EDIT_RPC_REQUIRED';
  end if;

  v_current_hash := private.hash_legacy_section_content(v_section.content);
  if v_section.revision <> p_expected_section_revision
    or v_current_hash <> p_expected_content_sha256 then
    if v_section.content is not distinct from p_content
      and v_section.status is not distinct from p_status then
      v_exact_replay := true;
    else
      raise exception 'LEGACY_SECTION_SAVE_STALE';
    end if;
  end if;
  v_changed := not v_exact_replay and (
    v_section.content is distinct from p_content
    or v_section.status is distinct from p_status
  );

  if v_changed then
    update public.sections
    set content = p_content,
        status = p_status,
        updated_at = pg_catalog.clock_timestamp()
    where id = v_section.id
    returning * into v_section;
  end if;

  select * into v_document
  from public.documents document_record
  where document_record.id = v_section.document_id
    and document_record.user_id = v_user_id;
  if not found then raise exception 'LEGACY_SECTION_SAVE_NOT_FOUND'; end if;

  return pg_catalog.jsonb_build_object(
    'state', 'saved',
    'section_id', v_section.id,
    'document_id', v_section.document_id,
    'section_content', v_section.content,
    'section_content_sha256',
      private.hash_legacy_section_content(v_section.content),
    'section_status', v_section.status,
    'section_revision', v_section.revision,
    'section_approved_revision', v_section.approved_revision,
    'section_updated_at', v_section.updated_at,
    'document_status', v_document.status,
    'document_revision', v_document.current_revision,
    'document_approved_revision', v_document.approved_revision,
    'document_updated_at', v_document.updated_at,
    'idempotent_replay', v_exact_replay or not v_changed
  );
end;
$function$;

revoke all on function public.save_legacy_section(
  uuid, integer, text, text, text
) from public, anon;
grant execute on function public.save_legacy_section(
  uuid, integer, text, text, text
) to authenticated;

create or replace function public.apply_legacy_section_edit(
  p_operation_id uuid,
  p_expected_section_revision integer,
  p_result_sha256 text,
  p_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_operation private.legacy_section_edit_operations%rowtype;
  v_section public.sections%rowtype;
  v_document public.documents%rowtype;
  v_current_hash text;
  v_applied_hash text;
  v_superseded boolean := false;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_operation_id is null
    or p_expected_section_revision is null
    or p_expected_section_revision < 1
    or p_result_sha256 is null
    or p_result_sha256 !~ '^[0-9a-f]{64}$'
    or p_content is null
    or pg_catalog.octet_length(p_content) > 1048576 then
    raise exception 'LEGACY_SECTION_EDIT_APPLY_INPUT_INVALID';
  end if;
  v_applied_hash := private.hash_legacy_section_content(p_content);

  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = v_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;

  if v_operation.result_sha256 is distinct from p_result_sha256
    or v_operation.accepted_section_revision <> p_expected_section_revision then
    raise exception 'LEGACY_SECTION_EDIT_NOT_READY';
  end if;
  -- The caller may confirm only the exact full-section candidate persisted by
  -- protected compute. This closes the former arbitrary-content Apply seam for
  -- both whole-section suggestions and deterministic selection patches.
  if v_operation.applied_candidate_content is distinct from p_content
    or v_operation.applied_candidate_sha256 is distinct from v_applied_hash then
    raise exception 'LEGACY_SECTION_EDIT_APPLY_CONTENT_MISMATCH';
  end if;

  select * into v_section
  from public.sections section_record
  where section_record.id = v_operation.section_id
    and section_record.document_id = v_operation.document_id
    and section_record.user_id = v_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;
  if v_section.ledger_binding_status <> 'legacy_unversioned' then
    raise exception 'CAPTURED_SECTION_EDIT_RPC_REQUIRED';
  end if;

  if v_operation.status = 'applied' then
    v_superseded := v_section.revision <> v_operation.applied_section_revision
      or private.hash_legacy_section_content(v_section.content)
        <> v_operation.applied_content_sha256;
    select * into v_document
    from public.documents document_record
    where document_record.id = v_operation.document_id
      and document_record.user_id = v_user_id;
    if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;
    return pg_catalog.jsonb_build_object(
      'state', case when v_superseded
        then 'applied_then_superseded' else 'applied' end,
      'code', case when v_superseded
        then 'APPLIED_THEN_SUPERSEDED' else 'APPLIED' end,
      'operation_id', v_operation.id,
      'section_id', v_section.id,
      'document_id', v_section.document_id,
      'section_content', v_section.content,
      'section_content_sha256',
        private.hash_legacy_section_content(v_section.content),
      'section_status', v_section.status,
      'section_revision', v_section.revision,
      'section_approved_revision', v_section.approved_revision,
      'section_updated_at', v_section.updated_at,
      'document_status', v_document.status,
      'document_revision', v_document.current_revision,
      'document_approved_revision', v_document.approved_revision,
      'document_updated_at', v_document.updated_at,
      'applied_section_revision', v_operation.applied_section_revision,
      'idempotent_replay', true
    );
  end if;
  if v_operation.status <> 'ready' then
    raise exception 'LEGACY_SECTION_EDIT_NOT_READY';
  end if;

  v_current_hash := private.hash_legacy_section_content(v_section.content);
  if v_section.revision <> v_operation.accepted_section_revision
    or v_current_hash <> v_operation.accepted_content_sha256 then
    raise exception 'LEGACY_SECTION_EDIT_STALE';
  end if;

  update public.sections
  set content = v_operation.applied_candidate_content,
      status = 'edited',
      updated_at = pg_catalog.clock_timestamp()
  where id = v_section.id
  returning * into v_section;

  insert into public.revision_history(
    user_id, document_id, event_type, title, badge
  ) values (
    v_user_id, v_operation.document_id, 'ai_edit_applied',
    'TED edit applied to ' || v_section.name,
    'revision ' || v_section.revision::text
  );

  update private.legacy_section_edit_operations
  set status = 'applied',
      applied_content_sha256 = v_applied_hash,
      applied_section_revision = v_section.revision,
      applied_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  select * into v_document
  from public.documents document_record
  where document_record.id = v_operation.document_id
    and document_record.user_id = v_user_id;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;

  return pg_catalog.jsonb_build_object(
    'state', 'applied',
    'code', 'APPLIED',
    'operation_id', v_operation.id,
    'section_id', v_section.id,
    'document_id', v_section.document_id,
    'section_content', v_section.content,
    'section_content_sha256',
      private.hash_legacy_section_content(v_section.content),
    'section_status', v_section.status,
    'section_revision', v_section.revision,
    'section_approved_revision', v_section.approved_revision,
    'section_updated_at', v_section.updated_at,
    'document_status', v_document.status,
    'document_revision', v_document.current_revision,
    'document_approved_revision', v_document.approved_revision,
    'document_updated_at', v_document.updated_at,
    'applied_section_revision', v_operation.applied_section_revision,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.apply_legacy_section_edit(uuid, integer, text, text)
  from public, anon;
grant execute on function public.apply_legacy_section_edit(uuid, integer, text, text)
  to authenticated;

create or replace function public.discard_legacy_section_edit(
  p_operation_id uuid,
  p_result_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_operation private.legacy_section_edit_operations%rowtype;
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = v_user_id
  for update;
  if not found then raise exception 'LEGACY_SECTION_EDIT_NOT_FOUND'; end if;
  if v_operation.result_sha256 is distinct from p_result_sha256 then
    raise exception 'LEGACY_SECTION_EDIT_RESULT_CONFLICT';
  end if;
  if v_operation.status = 'discarded' then
    return pg_catalog.jsonb_build_object(
      'operation_id', v_operation.id,
      'state', 'discarded',
      'idempotent_replay', true
    );
  end if;
  if v_operation.status <> 'ready' then
    raise exception 'LEGACY_SECTION_EDIT_STATE_INVALID:%', v_operation.status;
  end if;
  update private.legacy_section_edit_operations
  set status = 'discarded', updated_at = pg_catalog.clock_timestamp()
  where id = v_operation.id;
  return pg_catalog.jsonb_build_object(
    'operation_id', v_operation.id,
    'state', 'discarded',
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.discard_legacy_section_edit(uuid, text)
  from public, anon;
grant execute on function public.discard_legacy_section_edit(uuid, text)
  to authenticated;

create or replace function public.get_latest_legacy_section_edit(
  p_section_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_operation private.legacy_section_edit_operations%rowtype;
  v_section public.sections%rowtype;
  v_stale boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED'; end if;
  if p_section_id is null then
    raise exception 'LEGACY_SECTION_EDIT_INPUT_INVALID';
  end if;

  -- Match every operation-aware writer's lock order: operation, then section.
  -- Owner + requested section scope is enough to select the private row without
  -- exposing it; the exact document/section relationship is revalidated under
  -- the section lock before any status, hash, or suggestion is classified.
  select * into v_operation
  from private.legacy_section_edit_operations operation_record
  where operation_record.section_id = p_section_id
    and operation_record.user_id = v_user_id
  order by operation_record.created_at desc, operation_record.id desc
  limit 1
  for update;
  if not found then return null; end if;

  select * into v_section
  from public.sections section_record
  where section_record.id = v_operation.section_id
    and section_record.document_id = v_operation.document_id
    and section_record.user_id = v_operation.user_id
  for update;
  if not found or v_section.ledger_binding_status <> 'legacy_unversioned' then
    return null;
  end if;

  -- Recovery is the liveness authority after a worker disappears. An edit
  -- admitted but never dispatched has no possible provider result; a dispatched
  -- edit has an ambiguous provider outcome and must never be re-dispatched.
  if v_operation.status = 'accepted'
    and v_operation.updated_at < v_now - interval '5 minutes' then
    update private.legacy_section_edit_operations
    set status = 'terminal_failure',
        terminal_code = 'LEGACY_SECTION_EDIT_ACCEPTANCE_EXPIRED',
        terminal_at = v_now,
        updated_at = v_now
    where id = v_operation.id
    returning * into v_operation;
  elsif v_operation.status = 'provider_dispatched'
    and v_operation.updated_at < v_now - interval '5 minutes' then
    update private.legacy_section_edit_operations
    set status = 'reconciliation_required',
        terminal_code = 'LEGACY_SECTION_EDIT_DISPATCH_OUTCOME_AMBIGUOUS',
        terminal_at = v_now,
        updated_at = v_now
    where id = v_operation.id
    returning * into v_operation;
  end if;

  if v_operation.status <> 'ready' then
    return pg_catalog.jsonb_build_object(
      'state', case
        when v_operation.status = 'applied'
          and (
            v_section.revision <> v_operation.applied_section_revision
            or private.hash_legacy_section_content(v_section.content)
              <> v_operation.applied_content_sha256
          ) then 'applied_then_superseded'
        else v_operation.status
      end,
      'operation_id', v_operation.id,
      'terminal_code', v_operation.terminal_code,
      'current_section_revision', v_section.revision,
      'current_content_sha256',
        private.hash_legacy_section_content(v_section.content),
      'applied_section_revision', v_operation.applied_section_revision,
      'code', case
        when v_operation.status = 'applied'
          and (
            v_section.revision <> v_operation.applied_section_revision
            or private.hash_legacy_section_content(v_section.content)
              <> v_operation.applied_content_sha256
          ) then 'APPLIED_THEN_SUPERSEDED'
        when v_operation.status = 'applied' then 'APPLIED'
        else null
      end,
      'recoverable', false
    );
  end if;

  v_stale := v_section.revision <> v_operation.accepted_section_revision
    or private.hash_legacy_section_content(v_section.content)
      <> v_operation.accepted_content_sha256;
  if v_stale then
    return pg_catalog.jsonb_build_object(
      'state', 'stale',
      'code', 'LEGACY_SECTION_EDIT_STALE',
      'operation_id', v_operation.id,
      'document_id', v_operation.document_id,
      'section_id', v_operation.section_id,
      'accepted_section_revision', v_operation.accepted_section_revision,
      'current_section_revision', v_section.revision,
      'stale', true,
      'recoverable', false
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'state', 'ready',
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'section_id', v_operation.section_id,
    'accepted_section_revision', v_operation.accepted_section_revision,
    'current_section_revision', v_section.revision,
    'result_sha256', v_operation.result_sha256,
    'suggested_content', v_operation.suggested_content,
    'applied_candidate_content', v_operation.applied_candidate_content,
    'applied_candidate_sha256', v_operation.applied_candidate_sha256,
    'changes', v_operation.changes,
    'action', v_operation.request_metadata->>'action',
    'scope', v_operation.request_metadata->>'scope',
    'stale', false,
    'recoverable', true
  );
end;
$function$;

revoke all on function public.get_latest_legacy_section_edit(uuid)
  from public, anon, service_role;
grant execute on function public.get_latest_legacy_section_edit(uuid)
  to authenticated;

comment on table private.legacy_section_edit_operations is
  'Immutable accepted revision, single-dispatch lifecycle, exact apply candidate, terminal replay, and exactly-once legacy apply state.';
comment on function public.save_legacy_section(uuid, integer, text, text, text) is
  'Saves one owner legacy section only when its expected revision and content hash still match.';
comment on function public.apply_legacy_section_edit(uuid, integer, text, text) is
  'Applies only the exact persisted full-section TED candidate and returns current authoritative section and document truth on replay.';
comment on function public.get_latest_legacy_section_edit(uuid) is
  'Returns only the owner latest legacy edit state and exposes suggestion wording only while it remains ready for review.';

commit;
