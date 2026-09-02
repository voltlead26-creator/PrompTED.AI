-- Durable background execution support for captured document operations.
--
-- The immutable accepted request remains the only resume authority. Browser
-- callers receive operation status through authenticated RPCs, while this
-- minimum-necessary reconstruction command is executable only by the protected
-- service boundary.

create or replace function public.get_captured_document_resume_payload(
  p_user_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_generation private.document_generation_snapshots%rowtype;
  v_accepted_revision private.captured_document_revisions%rowtype;
  v_ledger private.document_ledger_versions%rowtype;
  v_ledger_template jsonb;
  v_title text;
begin
  if p_user_id is null or p_operation_id is null then
    raise exception 'CAPTURED_OPERATION_IDENTITY_REQUIRED';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  select * into v_generation
  from private.document_generation_snapshots snapshot_record
  where snapshot_record.id = v_operation.generation_snapshot_id
    and snapshot_record.user_id = v_operation.user_id;
  if not found then raise exception 'CAPTURED_OPERATION_SNAPSHOT_NOT_FOUND'; end if;

  select * into v_accepted_revision
  from private.captured_document_revisions revision_record
  where revision_record.operation_id = v_operation.id
    and revision_record.document_id = v_operation.document_id
    and revision_record.user_id = v_operation.user_id
    and revision_record.document_revision = v_operation.accepted_document_revision;
  if not found then raise exception 'CAPTURED_ACCEPTED_REVISION_NOT_FOUND'; end if;

  select * into v_ledger
  from private.document_ledger_versions ledger_record
  where ledger_record.ledger_version = v_operation.ledger_version;
  if not found then raise exception 'CAPTURED_ACCEPTED_LEDGER_NOT_FOUND'; end if;

  v_ledger_template := v_ledger.contract_json->'templates'->v_operation.template_id;
  if jsonb_typeof(v_ledger_template) is distinct from 'object'
    or v_ledger.schema_version is distinct from
      v_ledger.contract_json->>'schemaVersion'
    or v_ledger.ledger_version is distinct from
      v_ledger.contract_json->>'ledgerVersion'
    or v_generation.user_id is distinct from v_operation.user_id
    or v_generation.template_id is distinct from v_operation.template_id
    or v_generation.ledger_version is distinct from v_operation.ledger_version
    or v_generation.benchmark_version is distinct from v_operation.benchmark_version
    or v_generation.pipeline_version is distinct from v_operation.pipeline_version
    or v_accepted_revision.ledger_version is distinct from v_operation.ledger_version
    or v_accepted_revision.snapshot->'document'->>'id' is distinct from
      v_operation.document_id::text
    or v_accepted_revision.snapshot->'document'->>'ledger_template_id' is distinct from
      v_operation.template_id
    or v_accepted_revision.snapshot->'document'->>'ledger_version' is distinct from
      v_operation.ledger_version
    or (
      v_ledger_template->'qualityBenchmark' ? 'benchmarkVersion'
      and v_ledger_template->'qualityBenchmark'->>'benchmarkVersion' is distinct from
        v_operation.benchmark_version
    ) then
    raise exception 'CAPTURED_ACCEPTED_SNAPSHOT_IDENTITY_MISMATCH';
  end if;

  v_title := nullif(
    btrim(v_accepted_revision.snapshot->'document'->>'title'),
    ''
  );
  if v_title is null then raise exception 'CAPTURED_DOCUMENT_TITLE_INVALID'; end if;

  return jsonb_build_object(
    'action', 'resume',
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'accepted_user_id', v_operation.user_id,
    'accepted_environment', v_operation.environment,
    'accepted_user_cohort', v_operation.user_cohort,
    'workflow', v_operation.workflow,
    'outcome_id', v_operation.outcome_id,
    'document_id', v_operation.document_id,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'title', v_title,
    'template_id', v_operation.template_id,
    'generation_request_id', v_operation.idempotency_key,
    'generation_snapshot_id', v_generation.id,
    'generation_snapshot_request_id', v_generation.generation_request_id,
    'generation_snapshot_sha256', v_generation.snapshot_sha256,
    'request_sha256', v_operation.request_sha256,
    'input_revision', v_operation.input_revision,
    'input_values', v_generation.input_values,
    'source_snapshot', v_generation.source_snapshot,
    'evidence_snapshot', v_generation.evidence_snapshot,
    'unresolved_input_keys', to_jsonb(v_generation.unresolved_input_keys),
    'confirmations', v_generation.confirmations,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'locale', v_operation.locale,
    'jurisdiction', v_operation.jurisdiction,
    'activation_scope_key', v_operation.activation_scope_key,
    'activation_revision', v_operation.activation_revision,
    'ledger_schema_version', v_ledger.schema_version,
    'ledger_version', v_operation.ledger_version,
    'ledger_contract_sha256', v_ledger.contract_sha256,
    'ledger_template', v_ledger_template,
    'benchmark_version', v_operation.benchmark_version,
    'pipeline_version', v_operation.pipeline_version,
    'routing_version', v_operation.routing_version,
    'route_snapshot', v_operation.route_snapshot,
    'operation_ttl_seconds', case
      when v_operation.pipeline_version = 'captured-operation-pipeline.1'
        then 86400
      else null
    end
  );
end;
$function$;

revoke all on function public.get_captured_document_resume_payload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_captured_document_resume_payload(uuid, uuid)
  to service_role;

comment on function public.get_captured_document_resume_payload(uuid, uuid) is
  'Service-only reconstruction of the immutable accepted request for idempotent background resume. Never exposed to browser roles.';

-- Reconnect is the browser's durable source of truth. Pending owner
-- cancellation must survive reload even though the active worker correctly
-- retains its lease and current processing status until attempt accounting is
-- reconciled.
create or replace function public.get_captured_document_operation(
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document_revision integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = v_user_id;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  select document_record.current_revision into v_document_revision
  from public.documents document_record
  where document_record.id = v_operation.document_id
    and document_record.user_id = v_user_id;

  return jsonb_build_object(
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'document_revision', v_document_revision,
    'operation_revision', v_operation.operation_revision,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'status', v_operation.status,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'retryable', v_operation.retryable,
    'cancellation_requested', v_operation.cancel_requested_at is not null,
    'cancellation_code', v_operation.cancellation_code,
    'error_code', v_operation.error_code,
    'message', v_operation.public_error_message,
    'safe_next_action', v_operation.safe_next_action,
    'correlation_id', v_operation.correlation_id,
    'expires_at', v_operation.expires_at,
    'lease_expires_at', v_operation.lease_expires_at,
    'resume_available', (
      v_operation.status in (
        'accepted', 'generating', 'validating', 'persisting', 'retryable_failure'
      )
      and (
        v_operation.lease_token is null
        or v_operation.lease_expires_at is null
        or v_operation.lease_expires_at <= clock_timestamp()
      )
    ),
    'updated_at', v_operation.updated_at
  );
end;
$function$;

revoke all on function public.get_captured_document_operation(uuid)
  from public, anon;
grant execute on function public.get_captured_document_operation(uuid)
  to authenticated;

comment on function public.get_captured_document_operation(uuid) is
  'Authenticated owner reconnect status, including durable pending-cancellation intent while a worker retains its lease.';

-- Possession of the live random lease token is the renewal capability. This
-- lets a worker observe an owner cancellation request that advanced the
-- operation revision without losing or replacing its active lease.
create or replace function public.renew_captured_document_operation_lease(
  p_operation_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
begin
  if p_operation_id is null or p_lease_token is null
    or p_lease_seconds not between 15 and 1800 then
    raise exception 'CAPTURED_OPERATION_LEASE_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.status in ('ready_for_review', 'terminal_failure', 'cancelled') then
    raise exception 'CAPTURED_OPERATION_NOT_CLAIMABLE:%', v_operation.status;
  end if;
  if v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;

  update private.captured_document_operations
  set lease_expires_at = clock_timestamp() +
        pg_catalog.make_interval(secs => p_lease_seconds),
      operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id,
    v_operation.user_id,
    v_operation.operation_revision,
    v_operation.status,
    'operation_lease_renewed',
    jsonb_build_object(
      'lease_owner', v_operation.lease_owner,
      'lease_expires_at', v_operation.lease_expires_at,
      'cancellation_requested', v_operation.cancel_requested_at is not null
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'retryable', v_operation.retryable,
    'lease_token', v_operation.lease_token,
    'lease_expires_at', v_operation.lease_expires_at,
    'cancellation_requested', v_operation.cancel_requested_at is not null,
    'cancellation_code', v_operation.cancellation_code
  );
end;
$function$;

revoke all on function public.renew_captured_document_operation_lease(
  uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function public.renew_captured_document_operation_lease(
  uuid, uuid, integer
) to service_role;

-- Provider completion is fenced by the live lease token, not by the worker's
-- last observed operation revision. The operation row is locked before the
-- current revision is passed to the existing exact-attempt command, so an
-- owner cancellation that committed after lease renewal cannot make known
-- provider status or token usage irreconcilably stale. Attempt completion,
-- usage-ledger reconciliation and returned cancellation intent share one
-- transaction.
create or replace function public.complete_captured_document_provider_attempt(
  p_operation_id uuid,
  p_lease_token uuid,
  p_logical_stage_key text,
  p_attempt_number integer,
  p_semantic_route text,
  p_model text,
  p_reasoning_effort text,
  p_provider_response_id text,
  p_retention_mode text,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_retry_reason text,
  p_error_code text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_request_sha256 text,
  p_structured_output jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_result jsonb;
begin
  if p_operation_id is null or p_lease_token is null
    or p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'CAPTURED_PROVIDER_COMPLETION_INPUT_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;

  v_result := public.record_captured_document_provider_attempt(
    p_operation_id,
    v_operation.operation_revision,
    p_lease_token,
    p_logical_stage_key,
    p_attempt_number,
    p_semantic_route,
    p_model,
    p_reasoning_effort,
    p_provider_response_id,
    p_retention_mode,
    p_status,
    p_input_tokens,
    p_output_tokens,
    p_retry_reason,
    p_error_code,
    p_started_at,
    p_completed_at,
    p_request_sha256,
    p_structured_output
  );

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id;

  return v_result || jsonb_build_object(
    'document_id', v_operation.document_id,
    'status', v_operation.status,
    'retryable', v_operation.retryable,
    'lease_token', v_operation.lease_token,
    'cancellation_requested', v_operation.cancel_requested_at is not null,
    'cancellation_code', v_operation.cancellation_code
  );
end;
$function$;

revoke all on function public.complete_captured_document_provider_attempt(
  uuid, uuid, text, integer, text, text, text, text, text, text,
  integer, integer, text, text, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_captured_document_provider_attempt(
  uuid, uuid, text, integer, text, text, text, text, text, text,
  integer, integer, text, text, timestamptz, timestamptz, text, jsonb
) to service_role;

comment on function public.complete_captured_document_provider_attempt(
  uuid, uuid, text, integer, text, text, text, text, text, text,
  integer, integer, text, text, timestamptz, timestamptz, text, jsonb
) is 'Service-only lease-token-fenced exact provider completion. Locks current operation revision so late owner cancellation cannot discard known outcome or token usage.';

-- An ambiguous or abandoned provider dispatch leaves one prepared attempt.
-- Reconcile it while the lease is still held so provider-cost accounting and
-- cancellation always observe a terminal attempt before releasing the
-- document reservation.
create or replace function public.reconcile_captured_document_provider_attempt(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_token uuid,
  p_error_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_attempt private.captured_document_provider_attempts%rowtype;
  v_prepared_count integer;
  v_code text := btrim(p_error_code);
begin
  if p_operation_id is null or p_expected_operation_revision is null
    or p_expected_operation_revision < 1 or p_lease_token is null
    or nullif(v_code, '') is null or char_length(v_code) > 120 then
    raise exception 'CAPTURED_PROVIDER_RECONCILIATION_INPUT_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  -- The live random lease token is the fencing authority. The expected
  -- revision remains a validated diagnostic input, but owner cancellation is
  -- allowed to advance it between renewal and this locked reconciliation.
  if v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;

  select count(*)::integer into v_prepared_count
  from private.captured_document_provider_attempts attempt_record
  where attempt_record.operation_id = p_operation_id
    and attempt_record.status = 'prepared';
  if v_prepared_count > 1 then
    raise exception 'CAPTURED_PROVIDER_PREPARED_ATTEMPT_AMBIGUOUS';
  end if;
  if v_prepared_count = 0 then
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'document_id', v_operation.document_id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'retryable', v_operation.retryable,
      'lease_token', v_operation.lease_token,
      'cancellation_requested', v_operation.cancel_requested_at is not null,
      'cancellation_code', v_operation.cancellation_code,
      'prepared_attempt_reconciled', false
    );
  end if;

  select * into v_attempt
  from private.captured_document_provider_attempts attempt_record
  where attempt_record.operation_id = p_operation_id
    and attempt_record.status = 'prepared'
  for update;

  update private.captured_document_provider_attempts
  set status = 'failed',
      input_tokens = 0,
      output_tokens = 0,
      error_code = v_code,
      completed_at = clock_timestamp(),
      structured_output = null
  where id = v_attempt.id
  returning * into v_attempt;

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id,
    v_operation.user_id,
    v_operation.operation_revision,
    v_operation.status,
    'provider_attempt_reconciled',
    jsonb_build_object(
      'logical_stage_key', v_attempt.logical_stage_key,
      'attempt_number', v_attempt.attempt_number,
      'error_code', v_attempt.error_code,
      'attempt_sha256', v_attempt.attempt_sha256
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'retryable', v_operation.retryable,
    'lease_token', v_operation.lease_token,
    'cancellation_requested', v_operation.cancel_requested_at is not null,
    'cancellation_code', v_operation.cancellation_code,
    'prepared_attempt_reconciled', true,
    'provider_attempt_number', v_attempt.attempt_number
  );
end;
$function$;

revoke all on function public.reconcile_captured_document_provider_attempt(
  uuid, integer, uuid, text
) from public, anon, authenticated;
grant execute on function public.reconcile_captured_document_provider_attempt(
  uuid, integer, uuid, text
) to service_role;

-- Owner cancellation is an intent while a provider attempt or worker lease is
-- live. Clearing the lease here would make the already-dispatched attempt
-- impossible to account for and could permit late wording to race finalization.
create or replace function public.request_captured_document_cancellation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_cancellation_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_code text := btrim(p_cancellation_code);
  v_worker_active boolean;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if nullif(v_code, '') is null or char_length(v_code) > 120 then
    raise exception 'CAPTURED_CANCELLATION_CODE_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = v_user_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.status = 'cancelled'
    and v_operation.cancellation_code = v_code then
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'document_id', v_operation.document_id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'cancellation_requested', true,
      'idempotent_replay', true
    );
  end if;
  if v_operation.cancel_requested_at is not null then
    if v_operation.cancellation_code is distinct from v_code then
      raise exception 'CAPTURED_CANCELLATION_REQUEST_CONFLICT';
    end if;
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'document_id', v_operation.document_id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'cancellation_requested', true,
      'idempotent_replay', true
    );
  end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status in ('ready_for_review', 'terminal_failure', 'cancelled') then
    raise exception 'CAPTURED_OPERATION_NOT_CANCELLABLE:%', v_operation.status;
  end if;

  v_worker_active := (
    v_operation.lease_token is not null
    and v_operation.lease_expires_at > clock_timestamp()
  ) or exists (
    select 1
    from private.captured_document_provider_attempts attempt_record
    where attempt_record.operation_id = v_operation.id
      and attempt_record.status = 'prepared'
  );

  if v_worker_active then
    update private.captured_document_operations
    set cancellation_code = v_code,
        cancel_requested_at = clock_timestamp(),
        retryable = false,
        operation_revision = operation_revision + 1,
        updated_at = clock_timestamp()
    where id = v_operation.id
    returning * into v_operation;
    perform private.append_captured_document_event(
      v_operation.id,
      v_operation.user_id,
      v_operation.operation_revision,
      v_operation.status,
      'operation_cancellation_requested',
      jsonb_build_object('cancellation_code', v_code, 'actor', 'owner')
    );
  else
    update private.captured_document_operations
    set status = 'cancelled',
        retryable = false,
        cancellation_code = v_code,
        cancel_requested_at = clock_timestamp(),
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        terminal_at = clock_timestamp(),
        operation_revision = operation_revision + 1,
        updated_at = clock_timestamp()
    where id = v_operation.id
    returning * into v_operation;
    perform private.append_captured_document_event(
      v_operation.id,
      v_operation.user_id,
      v_operation.operation_revision,
      v_operation.status,
      'operation_cancelled',
      jsonb_build_object('cancellation_code', v_code, 'actor', 'owner')
    );
  end if;

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'retryable', false,
    'cancellation_requested', true,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.request_captured_document_cancellation(
  uuid, integer, text
) from public, anon;
grant execute on function public.request_captured_document_cancellation(
  uuid, integer, text
) to authenticated;

create or replace function private.guard_captured_terminal_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('cancelled', 'terminal_failure', 'ready_for_review')
    and exists (
      select 1
      from private.captured_document_provider_attempts attempt_record
      where attempt_record.operation_id = old.id
        and attempt_record.status = 'prepared'
    ) then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED';
  end if;
  if new.status = 'ready_for_review' and old.cancel_requested_at is not null then
    raise exception 'CAPTURED_CANCELLATION_RECONCILIATION_REQUIRED';
  end if;
  return new;
end;
$function$;

drop trigger if exists captured_terminal_reconciliation_guard
  on private.captured_document_operations;
create trigger captured_terminal_reconciliation_guard
  before update on private.captured_document_operations
  for each row execute function private.guard_captured_terminal_reconciliation();

revoke all on function private.guard_captured_terminal_reconciliation()
  from public, anon, authenticated, service_role;

comment on function public.renew_captured_document_operation_lease(
  uuid, uuid, integer
) is 'Service-only token-bound lease renewal that observes owner cancellation intent without accepting a stale browser revision.';
comment on function public.reconcile_captured_document_provider_attempt(
  uuid, integer, uuid, text
) is 'Service-only terminal reconciliation for a prepared provider attempt before cancellation or failure release.';
