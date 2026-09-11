-- Extend the existing legacy admission and usage authorities; no new counter store.
-- Copies below retain the reviewed public signatures and prior validation/replay
-- bodies. The only body changes are the operation-wide advisory key and the
-- checkpoint-only handling of the exact cumulative-budget denial SQLSTATE.
begin;

create or replace function private.enforce_legacy_generation_failure_budget()
returns trigger language plpgsql security definer set search_path = ''
as $budget$
declare
  v_period timestamptz;
  v_failures integer;
begin
  if tg_op = 'UPDATE' and (old.dispatched_at is not null or new.dispatched_at is null) then
    return new;
  end if;
  if new.origin_reservation_id is not null then
    select billing_period_start into v_period from private.document_allowance_reservations
    where id = new.origin_reservation_id and user_id = new.user_id;
    if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;
    perform private.document_allowance_lock(new.user_id, v_period);
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.user_id::text || '|' || new.checkpoint_scope || '|' || new.logical_request_id, 0));
  end if;

  select count(*) into v_failures
  from public.usage_ledger u
  join private.legacy_model_attempt_admissions a
    on a.user_id = u.user_id and a.checkpoint_scope = u.checkpoint_scope
    and a.logical_request_id = u.logical_request_id and a.logical_stage_key = u.logical_stage_key
    and a.request_sha256 = u.provider_request_sha256 and a.attempt_number = u.provider_attempt_number
  where a.user_id = new.user_id and a.checkpoint_scope = new.checkpoint_scope
    and a.logical_request_id = new.logical_request_id
    and a.origin_reservation_id is not distinct from new.origin_reservation_id
    and a.dispatched_at is not null and u.event_type = 'model_call'
    and u.model_call_key is not null and u.model_call_status = 'failed'
    -- Capacity/configuration denials never crossed the provider boundary.
    -- A completed but unusable result belongs to the separate repair budget.
    and u.provider_status not in ('rejected_before_provider', 'completed_rejected', 'completed');
  if v_failures >= 2 then
    raise exception using errcode = 'PGB01', message = 'GENERATION_ATTEMPT_LIMIT_REACHED';
  end if;
  return new;
end;
$budget$;
revoke all on function private.enforce_legacy_generation_failure_budget()
  from public, anon, authenticated, service_role;
create trigger legacy_generation_failure_budget_guard
before insert or update of dispatched_at on private.legacy_model_attempt_admissions
for each row execute function private.enforce_legacy_generation_failure_budget();

-- Prior body: 20260901060000_legacy_model_accounting_and_replay.sql; existing grants remain unchanged.
create or replace function public.read_legacy_model_call_checkpoint(
  p_user_id uuid,
  p_checkpoint_scope text,
  p_origin_reservation_id uuid,
  p_logical_request_id text,
  p_logical_stage_key text,
  p_request_sha256 text,
  p_max_attempts integer,
  p_execution_claim_token uuid,
  p_allocate_attempt boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_result private.legacy_model_call_results%rowtype;
  v_usage public.usage_ledger%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_admission private.legacy_model_attempt_admissions%rowtype;
  v_existing_hash text;
  v_attempt integer;
  v_claim_token uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null
    or p_checkpoint_scope is null
    or p_checkpoint_scope !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or p_logical_request_id is null
    or p_logical_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or p_logical_stage_key is null
    or p_logical_stage_key !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_max_attempts is null
    or p_max_attempts not between 1 and 2
    or (
      p_checkpoint_scope in ('generate-document', 'generate-checklist')
      and (p_origin_reservation_id is null or p_execution_claim_token is null)
    )
    or (
      p_checkpoint_scope not in ('generate-document', 'generate-checklist')
      and p_origin_reservation_id is not null
    )
    or p_allocate_attempt is null then
    raise exception 'LEGACY_MODEL_CHECKPOINT_INPUT_INVALID';
  end if;

  if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
    select reservation_record.billing_period_start into v_period_start
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = p_origin_reservation_id
      and reservation_record.user_id = p_user_id;
    if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;

    perform private.document_allowance_lock(p_user_id, v_period_start);
    select * into v_reservation
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = p_origin_reservation_id
      and reservation_record.user_id = p_user_id
    for update;
    if not found
      or v_reservation.request_id <> p_logical_request_id
      or v_reservation.route_key <> p_checkpoint_scope then
      raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID';
    end if;
    if v_reservation.reconciliation_required_at is not null then
      return pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'provider_permitted', false,
        'reconciliation_code', v_reservation.reconciliation_code
      );
    end if;
    if v_reservation.status <> 'reserved' then
      raise exception 'LEGACY_MODEL_RESULT_RESERVATION_NOT_ACTIVE:%', v_reservation.status;
    end if;

    select * into v_claim
    from private.legacy_generation_execution_claims claim_record
    where claim_record.reservation_id = p_origin_reservation_id
      and claim_record.user_id = p_user_id
    for update;
    if not found
      or v_claim.checkpoint_scope <> p_checkpoint_scope
      or v_claim.logical_request_id <> p_logical_request_id
      or v_claim.claim_token <> p_execution_claim_token
      or v_claim.lease_expires_at <= v_now then
      raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
    end if;
    update private.legacy_generation_execution_claims
    set heartbeat_at = v_now,
        lease_expires_at = v_now + interval '120 seconds'
    where reservation_id = v_claim.reservation_id;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_user_id::text || '|' || p_checkpoint_scope || '|' ||
        p_logical_request_id,
        0
      )
    );
  end if;

  select * into v_result
  from private.legacy_model_call_results result_record
  where result_record.user_id = p_user_id
    and result_record.checkpoint_scope = p_checkpoint_scope
    and result_record.logical_request_id = p_logical_request_id
    and result_record.logical_stage_key = p_logical_stage_key;
  if found then
    if v_result.request_sha256 <> p_request_sha256 then
      raise exception 'LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT';
    end if;
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.id = v_result.usage_ledger_id
      and usage_record.user_id = p_user_id;
    if not found
      or v_usage.event_type <> 'model_call'
      or v_usage.checkpoint_scope is distinct from p_checkpoint_scope
      or v_usage.logical_request_id <> p_logical_request_id
      or v_usage.logical_stage_key <> p_logical_stage_key
      or v_usage.provider_request_sha256 <> p_request_sha256
      or v_usage.provider <> 'openai'
      or v_usage.provider_status <> 'completed'
      or v_usage.model_call_status not in ('succeeded', 'failed') then
      raise exception 'LEGACY_MODEL_CHECKPOINT_MALFORMED';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'replay',
      'provider_permitted', false,
      'attempt_number', v_usage.provider_attempt_number,
      'result_version', v_result.result_version,
      'response_sha256', v_result.response_sha256,
      'response_envelope', v_result.response_envelope,
      'usage', pg_catalog.jsonb_build_object(
        'usage_ledger_id', v_usage.id,
        'provider_attempt_id', v_usage.provider_attempt_id,
        'provider_response_id', coalesce(v_usage.provider_response_id, ''),
        'provider_status', v_usage.provider_status,
        'attempt_status', v_usage.model_call_status,
        'error_code', v_usage.provider_error_code,
        'input_tokens', v_usage.input_tokens,
        'output_tokens', v_usage.output_tokens,
        'started_at', v_usage.provider_started_at,
        'completed_at', v_usage.provider_completed_at,
        'model', v_usage.model,
        'routing_version', v_usage.routing_version,
        'semantic_route', v_usage.semantic_route,
        'reasoning_effort', v_usage.reasoning_effort
      )
    );
  end if;

  select * into v_usage
  from public.usage_ledger usage_record
  where usage_record.user_id = p_user_id
    and usage_record.checkpoint_scope = p_checkpoint_scope
    and usage_record.logical_request_id = p_logical_request_id
    and usage_record.logical_stage_key = p_logical_stage_key
    and usage_record.provider_request_sha256 = p_request_sha256
    and usage_record.model_call_key is not null
  order by usage_record.provider_attempt_number desc
  limit 1;
  if found then
    if v_usage.model_call_status = 'unknown' then
      return pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'provider_permitted', false,
        'reconciliation_code', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
      );
    elsif v_usage.model_call_status = 'succeeded'
      or v_usage.provider_status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'state', 'completed_result_unavailable',
        'provider_permitted', false,
        'usage_ledger_id', v_usage.id
      );
    elsif v_usage.model_call_status = 'cancelled' then
      return pg_catalog.jsonb_build_object(
        'state', 'terminal_cancelled',
        'provider_permitted', false,
        'attempt_number', v_usage.provider_attempt_number,
        'usage', pg_catalog.jsonb_build_object(
          'provider_status', v_usage.provider_status,
          'attempt_status', v_usage.model_call_status,
          'error_code', v_usage.provider_error_code
        )
      );
    elsif not (
      v_usage.provider_attempt_number < p_max_attempts
      and v_usage.provider_status ~ '^http_(408|429|5[0-9][0-9])$'
      and v_usage.provider_error_code = 'OPENAI_UPSTREAM_ERROR'
    ) then
      return pg_catalog.jsonb_build_object(
        'state', 'terminal_error',
        'provider_permitted', false,
        'attempt_number', v_usage.provider_attempt_number,
        'usage', pg_catalog.jsonb_build_object(
          'provider_status', v_usage.provider_status,
          'attempt_status', v_usage.model_call_status,
          'error_code', v_usage.provider_error_code
        )
      );
    end if;
  end if;

  select admission_record.request_sha256 into v_existing_hash
  from private.legacy_model_attempt_admissions admission_record
  where admission_record.user_id = p_user_id
    and admission_record.checkpoint_scope = p_checkpoint_scope
    and admission_record.logical_request_id = p_logical_request_id
    and admission_record.logical_stage_key = p_logical_stage_key
  order by admission_record.attempt_number asc
  limit 1;
  if found and v_existing_hash <> p_request_sha256 then
    raise exception 'LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT';
  end if;

  if p_checkpoint_scope not in ('generate-document', 'generate-checklist') then
    select * into v_admission
    from private.legacy_model_attempt_admissions admission_record
    where admission_record.user_id = p_user_id
      and admission_record.checkpoint_scope = p_checkpoint_scope
      and admission_record.logical_request_id = p_logical_request_id
      and admission_record.logical_stage_key = p_logical_stage_key
      and admission_record.request_sha256 = p_request_sha256
      and admission_record.reconciliation_required_at is not null
    order by admission_record.attempt_number desc
    limit 1
    for update;
    if found then
      return pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'provider_permitted', false,
        'reconciliation_code', v_admission.reconciliation_code
      );
    end if;
  end if;

  select * into v_admission
    from private.legacy_model_attempt_admissions admission_record
    where admission_record.user_id = p_user_id
      and admission_record.checkpoint_scope = p_checkpoint_scope
      and admission_record.logical_request_id = p_logical_request_id
      and admission_record.logical_stage_key = p_logical_stage_key
      and admission_record.request_sha256 = p_request_sha256
      and not exists (
        select 1
        from public.usage_ledger usage_record
        where usage_record.user_id = admission_record.user_id
          and usage_record.checkpoint_scope = admission_record.checkpoint_scope
          and usage_record.logical_request_id = admission_record.logical_request_id
          and usage_record.logical_stage_key = admission_record.logical_stage_key
          and usage_record.provider_request_sha256 = admission_record.request_sha256
          and usage_record.provider_attempt_number = admission_record.attempt_number
          and usage_record.model_call_key is not null
      )
    order by admission_record.attempt_number desc
    limit 1
  for update;
  if found then
    if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
      if v_admission.dispatched_at is not null then
        return pg_catalog.jsonb_build_object(
          'state', 'attempt_unresolved',
          'provider_permitted', false,
          'attempt_number', v_admission.attempt_number,
          'attempt_admission_id', v_admission.id
        );
      end if;
      if v_admission.claim_token <> p_execution_claim_token then
        raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
      end if;
      update private.legacy_model_attempt_admissions
      set heartbeat_at = v_now,
          lease_expires_at = v_now + interval '120 seconds'
      where id = v_admission.id;
    elsif v_admission.dispatched_at is not null then
      if v_admission.lease_expires_at <= v_now then
        update private.legacy_model_attempt_admissions
        set reconciliation_required_at = v_now,
            reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
        where id = v_admission.id;
        return pg_catalog.jsonb_build_object(
          'state', 'awaiting_reconciliation',
          'provider_permitted', false,
          'reconciliation_code', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
        );
      end if;
      return pg_catalog.jsonb_build_object(
        'state', 'in_progress',
        'provider_permitted', false,
        'attempt_number', v_admission.attempt_number,
        'attempt_admission_id', v_admission.id
      );
    elsif v_admission.lease_expires_at > v_now
      and v_admission.claim_token is distinct from p_execution_claim_token then
      return pg_catalog.jsonb_build_object(
        'state', 'in_progress',
        'provider_permitted', false,
        'attempt_number', v_admission.attempt_number,
        'attempt_admission_id', v_admission.id
      );
    elsif not p_allocate_attempt then
      return pg_catalog.jsonb_build_object(
        'state', 'not_found',
        'provider_permitted', false,
        'attempt_number', v_admission.attempt_number
      );
    else
      v_claim_token := case
        when v_admission.lease_expires_at <= v_now
          then extensions.gen_random_uuid()
        else v_admission.claim_token
      end;
      update private.legacy_model_attempt_admissions
      set claim_token = v_claim_token,
          heartbeat_at = v_now,
          lease_expires_at = v_now + interval '120 seconds'
      where id = v_admission.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'prepared',
      'provider_permitted', true,
      'attempt_number', v_admission.attempt_number,
      'attempt_admission_id', v_admission.id,
      'execution_claim_token', coalesce(v_claim_token, p_execution_claim_token),
      'resumed_undispatched', true
    );
  end if;

  select coalesce(max(admission_record.attempt_number), 0) + 1
  into v_attempt
  from private.legacy_model_attempt_admissions admission_record
  where admission_record.user_id = p_user_id
    and admission_record.checkpoint_scope = p_checkpoint_scope
    and admission_record.logical_request_id = p_logical_request_id
    and admission_record.logical_stage_key = p_logical_stage_key
    and admission_record.request_sha256 = p_request_sha256;
  if v_attempt > 1 then
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.checkpoint_scope = p_checkpoint_scope
      and usage_record.logical_request_id = p_logical_request_id
      and usage_record.logical_stage_key = p_logical_stage_key
      and usage_record.provider_request_sha256 = p_request_sha256
      and usage_record.provider_attempt_number = v_attempt - 1
      and usage_record.model_call_key is not null
    limit 1;
    if not found
      or v_usage.model_call_status <> 'failed'
      or v_usage.provider_status !~ '^http_(408|429|5[0-9][0-9])$'
      or v_usage.provider_error_code <> 'OPENAI_UPSTREAM_ERROR' then
      return pg_catalog.jsonb_build_object(
        'state', 'attempt_limit',
        'provider_permitted', false,
        'attempt_number', v_attempt,
        'reason', 'prior_attempt_not_retryable'
      );
    end if;
  end if;
  if v_attempt > p_max_attempts then
    return pg_catalog.jsonb_build_object(
      'state', 'attempt_limit',
      'provider_permitted', false,
      'attempt_number', v_attempt
    );
  end if;
  if not p_allocate_attempt then
    return pg_catalog.jsonb_build_object(
      'state', 'not_found',
      'provider_permitted', false,
      'next_attempt_number', v_attempt
    );
  end if;

  v_claim_token := coalesce(p_execution_claim_token, extensions.gen_random_uuid());

  insert into private.legacy_model_attempt_admissions(
    user_id, checkpoint_scope, logical_request_id, logical_stage_key,
    request_sha256, attempt_number, claim_token, heartbeat_at,
    lease_expires_at, origin_reservation_id
  ) values (
    p_user_id, p_checkpoint_scope, p_logical_request_id, p_logical_stage_key,
    p_request_sha256, v_attempt, v_claim_token, v_now,
    v_now + interval '120 seconds', p_origin_reservation_id
  ) returning * into v_admission;
  return pg_catalog.jsonb_build_object(
    'state', 'prepared',
    'provider_permitted', true,
    'attempt_number', v_attempt,
    'attempt_admission_id', v_admission.id,
    'execution_claim_token', v_claim_token
  );
exception when sqlstate 'PGB01' then
  return pg_catalog.jsonb_build_object(
    'state', 'attempt_limit', 'provider_permitted', false,
    'reason', 'operation_failure_budget_exhausted',
    'error_code', 'GENERATION_ATTEMPT_LIMIT_REACHED');
end;
$function$;

-- Prior body: 20260907053000_ollama_credit_fallback.sql; existing grants remain unchanged.
create or replace function public.read_legacy_model_call_checkpoint_with_fallback(
  p_user_id uuid,
  p_checkpoint_scope text,
  p_origin_reservation_id uuid,
  p_logical_request_id text,
  p_logical_stage_key text,
  p_request_sha256 text,
  p_max_attempts integer,
  p_execution_claim_token uuid,
  p_allocate_attempt boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_result private.legacy_model_call_results%rowtype;
  v_usage public.usage_ledger%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_admission private.legacy_model_attempt_admissions%rowtype;
  v_existing_hash text;
  v_attempt integer;
  v_claim_token uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null
    or p_checkpoint_scope is null
    or p_checkpoint_scope !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or p_logical_request_id is null
    or p_logical_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or p_logical_stage_key is null
    or p_logical_stage_key !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_max_attempts is null
    or p_max_attempts not between 1 and 2
    or (
      p_checkpoint_scope in ('generate-document', 'generate-checklist')
      and (p_origin_reservation_id is null or p_execution_claim_token is null)
    )
    or (
      p_checkpoint_scope not in ('generate-document', 'generate-checklist')
      and p_origin_reservation_id is not null
    )
    or p_allocate_attempt is null then
    raise exception 'LEGACY_MODEL_CHECKPOINT_INPUT_INVALID';
  end if;

  if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
    select reservation_record.billing_period_start into v_period_start
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = p_origin_reservation_id
      and reservation_record.user_id = p_user_id;
    if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;

    perform private.document_allowance_lock(p_user_id, v_period_start);
    select * into v_reservation
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = p_origin_reservation_id
      and reservation_record.user_id = p_user_id
    for update;
    if not found
      or v_reservation.request_id <> p_logical_request_id
      or v_reservation.route_key <> p_checkpoint_scope then
      raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID';
    end if;
    if v_reservation.reconciliation_required_at is not null then
      return pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'provider_permitted', false,
        'reconciliation_code', v_reservation.reconciliation_code
      );
    end if;
    if v_reservation.status <> 'reserved' then
      raise exception 'LEGACY_MODEL_RESULT_RESERVATION_NOT_ACTIVE:%', v_reservation.status;
    end if;

    select * into v_claim
    from private.legacy_generation_execution_claims claim_record
    where claim_record.reservation_id = p_origin_reservation_id
      and claim_record.user_id = p_user_id
    for update;
    if not found
      or v_claim.checkpoint_scope <> p_checkpoint_scope
      or v_claim.logical_request_id <> p_logical_request_id
      or v_claim.claim_token <> p_execution_claim_token
      or v_claim.lease_expires_at <= v_now then
      raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
    end if;
    update private.legacy_generation_execution_claims
    set heartbeat_at = v_now,
        lease_expires_at = v_now + interval '120 seconds'
    where reservation_id = v_claim.reservation_id;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_user_id::text || '|' || p_checkpoint_scope || '|' ||
        p_logical_request_id,
        0
      )
    );
  end if;

  select * into v_result
  from private.legacy_model_call_results result_record
  where result_record.user_id = p_user_id
    and result_record.checkpoint_scope = p_checkpoint_scope
    and result_record.logical_request_id = p_logical_request_id
    and result_record.logical_stage_key = p_logical_stage_key;
  if found then
    if v_result.request_sha256 <> p_request_sha256 then
      raise exception 'LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT';
    end if;
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.id = v_result.usage_ledger_id
      and usage_record.user_id = p_user_id;
    if not found
      or v_usage.event_type <> 'model_call'
      or v_usage.checkpoint_scope is distinct from p_checkpoint_scope
      or v_usage.logical_request_id <> p_logical_request_id
      or v_usage.logical_stage_key <> p_logical_stage_key
      or v_usage.provider_request_sha256 <> p_request_sha256
      or v_usage.provider not in ('openai','ollama')
      or v_usage.provider_status <> 'completed'
      or v_usage.model_call_status not in ('succeeded', 'failed') then
      raise exception 'LEGACY_MODEL_CHECKPOINT_MALFORMED';
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'replay',
      'provider_permitted', false,
      'attempt_number', v_usage.provider_attempt_number,
      'result_version', v_result.result_version,
      'response_sha256', v_result.response_sha256,
      'response_envelope', v_result.response_envelope,
      'usage', pg_catalog.jsonb_build_object(
        'usage_ledger_id', v_usage.id,
        'provider_attempt_id', v_usage.provider_attempt_id,
        'provider_response_id', coalesce(v_usage.provider_response_id, ''),
        'provider_status', v_usage.provider_status,
        'attempt_status', v_usage.model_call_status,
        'error_code', v_usage.provider_error_code,
        'input_tokens', v_usage.input_tokens,
        'output_tokens', v_usage.output_tokens,
        'started_at', v_usage.provider_started_at,
        'completed_at', v_usage.provider_completed_at,
        'provider', v_usage.provider,
        'model', v_usage.model,
        'routing_version', v_usage.routing_version,
        'semantic_route', v_usage.semantic_route,
        'reasoning_effort', v_usage.reasoning_effort
      )
    );
  end if;

  select * into v_usage
  from public.usage_ledger usage_record
  where usage_record.user_id = p_user_id
    and usage_record.checkpoint_scope = p_checkpoint_scope
    and usage_record.logical_request_id = p_logical_request_id
    and usage_record.logical_stage_key = p_logical_stage_key
    and usage_record.provider_request_sha256 = p_request_sha256
    and usage_record.model_call_key is not null
  order by usage_record.provider_attempt_number desc
  limit 1;
  if found then
    if v_usage.model_call_status = 'unknown' then
      return pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'provider_permitted', false,
        'reconciliation_code', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
      );
    elsif v_usage.model_call_status = 'succeeded'
      or v_usage.provider_status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'state', 'completed_result_unavailable',
        'provider_permitted', false,
        'usage_ledger_id', v_usage.id
      );
    elsif v_usage.model_call_status = 'cancelled' then
      return pg_catalog.jsonb_build_object(
        'state', 'terminal_cancelled',
        'provider_permitted', false,
        'attempt_number', v_usage.provider_attempt_number,
        'usage', pg_catalog.jsonb_build_object(
          'provider_status', v_usage.provider_status,
          'attempt_status', v_usage.model_call_status,
          'error_code', v_usage.provider_error_code
        )
      );
    elsif not (
      v_usage.provider_attempt_number < p_max_attempts
      and ((v_usage.provider_error_code = 'OPENAI_UPSTREAM_ERROR'
        and v_usage.provider_status ~ '^http_(408|429|5[0-9][0-9])$')
      or (v_usage.provider_error_code = 'OPENAI_CREDIT_EXHAUSTED'
        and v_usage.provider_status in ('http_402','http_429')
        and v_usage.provider = 'openai' and v_usage.provider_attempt_number = 1
        and v_usage.input_tokens = 0 and v_usage.output_tokens = 0))
    ) then
      return pg_catalog.jsonb_build_object(
        'state', 'terminal_error',
        'provider_permitted', false,
        'attempt_number', v_usage.provider_attempt_number,
        'usage', pg_catalog.jsonb_build_object(
          'provider_status', v_usage.provider_status,
          'attempt_status', v_usage.model_call_status,
          'error_code', v_usage.provider_error_code
        )
      );
    end if;
  end if;

  select admission_record.request_sha256 into v_existing_hash
  from private.legacy_model_attempt_admissions admission_record
  where admission_record.user_id = p_user_id
    and admission_record.checkpoint_scope = p_checkpoint_scope
    and admission_record.logical_request_id = p_logical_request_id
    and admission_record.logical_stage_key = p_logical_stage_key
  order by admission_record.attempt_number asc
  limit 1;
  if found and v_existing_hash <> p_request_sha256 then
    raise exception 'LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT';
  end if;

  if p_checkpoint_scope not in ('generate-document', 'generate-checklist') then
    select * into v_admission
    from private.legacy_model_attempt_admissions admission_record
    where admission_record.user_id = p_user_id
      and admission_record.checkpoint_scope = p_checkpoint_scope
      and admission_record.logical_request_id = p_logical_request_id
      and admission_record.logical_stage_key = p_logical_stage_key
      and admission_record.request_sha256 = p_request_sha256
      and admission_record.reconciliation_required_at is not null
    order by admission_record.attempt_number desc
    limit 1
    for update;
    if found then
      return pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'provider_permitted', false,
        'reconciliation_code', v_admission.reconciliation_code
      );
    end if;
  end if;

  select * into v_admission
    from private.legacy_model_attempt_admissions admission_record
    where admission_record.user_id = p_user_id
      and admission_record.checkpoint_scope = p_checkpoint_scope
      and admission_record.logical_request_id = p_logical_request_id
      and admission_record.logical_stage_key = p_logical_stage_key
      and admission_record.request_sha256 = p_request_sha256
      and not exists (
        select 1
        from public.usage_ledger usage_record
        where usage_record.user_id = admission_record.user_id
          and usage_record.checkpoint_scope = admission_record.checkpoint_scope
          and usage_record.logical_request_id = admission_record.logical_request_id
          and usage_record.logical_stage_key = admission_record.logical_stage_key
          and usage_record.provider_request_sha256 = admission_record.request_sha256
          and usage_record.provider_attempt_number = admission_record.attempt_number
          and usage_record.model_call_key is not null
      )
    order by admission_record.attempt_number desc
    limit 1
  for update;
  if found then
    if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
      if v_admission.dispatched_at is not null then
        return pg_catalog.jsonb_build_object(
          'state', 'attempt_unresolved',
          'provider_permitted', false,
          'attempt_number', v_admission.attempt_number,
          'attempt_admission_id', v_admission.id
        );
      end if;
      if v_admission.claim_token <> p_execution_claim_token then
        raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
      end if;
      update private.legacy_model_attempt_admissions
      set heartbeat_at = v_now,
          lease_expires_at = v_now + interval '120 seconds'
      where id = v_admission.id;
    elsif v_admission.dispatched_at is not null then
      if v_admission.lease_expires_at <= v_now then
        update private.legacy_model_attempt_admissions
        set reconciliation_required_at = v_now,
            reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
        where id = v_admission.id;
        return pg_catalog.jsonb_build_object(
          'state', 'awaiting_reconciliation',
          'provider_permitted', false,
          'reconciliation_code', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
        );
      end if;
      return pg_catalog.jsonb_build_object(
        'state', 'in_progress',
        'provider_permitted', false,
        'attempt_number', v_admission.attempt_number,
        'attempt_admission_id', v_admission.id
      );
    elsif v_admission.lease_expires_at > v_now
      and v_admission.claim_token is distinct from p_execution_claim_token then
      return pg_catalog.jsonb_build_object(
        'state', 'in_progress',
        'provider_permitted', false,
        'attempt_number', v_admission.attempt_number,
        'attempt_admission_id', v_admission.id
      );
    elsif not p_allocate_attempt then
      return pg_catalog.jsonb_build_object(
        'state', 'not_found',
      'fallback_required', coalesce(v_usage.provider = 'openai' and v_usage.provider_error_code = 'OPENAI_CREDIT_EXHAUSTED' and v_usage.provider_attempt_number = 1 and v_usage.input_tokens = 0 and v_usage.output_tokens = 0, false),

        'provider_permitted', false,
        'attempt_number', v_admission.attempt_number
      );
    else
      v_claim_token := case
        when v_admission.lease_expires_at <= v_now
          then extensions.gen_random_uuid()
        else v_admission.claim_token
      end;
      update private.legacy_model_attempt_admissions
      set claim_token = v_claim_token,
          heartbeat_at = v_now,
          lease_expires_at = v_now + interval '120 seconds'
      where id = v_admission.id;
    end if;
    return pg_catalog.jsonb_build_object(
      'state', 'prepared',
      'fallback_required', coalesce(v_usage.provider = 'openai' and v_usage.provider_error_code = 'OPENAI_CREDIT_EXHAUSTED' and v_usage.provider_attempt_number = 1 and v_usage.input_tokens = 0 and v_usage.output_tokens = 0, false),
      'provider_permitted', true,
      'attempt_number', v_admission.attempt_number,
      'attempt_admission_id', v_admission.id,
      'execution_claim_token', coalesce(v_claim_token, p_execution_claim_token),
      'resumed_undispatched', true
    );
  end if;

  select coalesce(max(admission_record.attempt_number), 0) + 1
  into v_attempt
  from private.legacy_model_attempt_admissions admission_record
  where admission_record.user_id = p_user_id
    and admission_record.checkpoint_scope = p_checkpoint_scope
    and admission_record.logical_request_id = p_logical_request_id
    and admission_record.logical_stage_key = p_logical_stage_key
    and admission_record.request_sha256 = p_request_sha256;
  if v_attempt > 1 then
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.checkpoint_scope = p_checkpoint_scope
      and usage_record.logical_request_id = p_logical_request_id
      and usage_record.logical_stage_key = p_logical_stage_key
      and usage_record.provider_request_sha256 = p_request_sha256
      and usage_record.provider_attempt_number = v_attempt - 1
      and usage_record.model_call_key is not null
    limit 1;
    if not found
      or v_usage.model_call_status <> 'failed'
      or not ((v_usage.provider_error_code = 'OPENAI_UPSTREAM_ERROR'
        and v_usage.provider_status ~ '^http_(408|429|5[0-9][0-9])$')
      or (v_usage.provider_error_code = 'OPENAI_CREDIT_EXHAUSTED'
        and v_usage.provider_status in ('http_402','http_429')
        and v_usage.provider = 'openai' and v_usage.provider_attempt_number = 1
        and v_usage.input_tokens = 0 and v_usage.output_tokens = 0)) then
      return pg_catalog.jsonb_build_object(
        'state', 'attempt_limit',
        'provider_permitted', false,
        'attempt_number', v_attempt,
        'reason', 'prior_attempt_not_retryable'
      );
    end if;
  end if;
  if v_attempt > p_max_attempts then
    return pg_catalog.jsonb_build_object(
      'state', 'attempt_limit',
      'provider_permitted', false,
      'attempt_number', v_attempt
    );
  end if;
  if not p_allocate_attempt then
    return pg_catalog.jsonb_build_object(
      'state', 'not_found',
      'fallback_required', coalesce(v_usage.provider = 'openai' and v_usage.provider_error_code = 'OPENAI_CREDIT_EXHAUSTED' and v_usage.provider_attempt_number = 1 and v_usage.input_tokens = 0 and v_usage.output_tokens = 0, false),

      'provider_permitted', false,
      'next_attempt_number', v_attempt
    );
  end if;

  v_claim_token := coalesce(p_execution_claim_token, extensions.gen_random_uuid());

  insert into private.legacy_model_attempt_admissions(
    user_id, checkpoint_scope, logical_request_id, logical_stage_key,
    request_sha256, attempt_number, claim_token, heartbeat_at,
    lease_expires_at, origin_reservation_id
  ) values (
    p_user_id, p_checkpoint_scope, p_logical_request_id, p_logical_stage_key,
    p_request_sha256, v_attempt, v_claim_token, v_now,
    v_now + interval '120 seconds', p_origin_reservation_id
  ) returning * into v_admission;
  return pg_catalog.jsonb_build_object(
    'state', 'prepared',
    'fallback_required', coalesce(v_usage.provider = 'openai' and v_usage.provider_error_code = 'OPENAI_CREDIT_EXHAUSTED' and v_usage.provider_attempt_number = 1 and v_usage.input_tokens = 0 and v_usage.output_tokens = 0, false),
      'provider_permitted', true,
    'attempt_number', v_attempt,
    'attempt_admission_id', v_admission.id,
    'execution_claim_token', v_claim_token
  );
exception when sqlstate 'PGB01' then
  return pg_catalog.jsonb_build_object(
    'state', 'attempt_limit', 'provider_permitted', false,
    'reason', 'operation_failure_budget_exhausted',
    'error_code', 'GENERATION_ATTEMPT_LIMIT_REACHED');
end;
$function$;

-- Prior body: 20260901060000_legacy_model_accounting_and_replay.sql; existing grants remain unchanged.
create or replace function public.record_legacy_model_call_attempt(
  p_user_id uuid,
  p_logical_request_id text,
  p_logical_stage_key text,
  p_request_sha256 text,
  p_provider_attempt_id text,
  p_attempt_number integer,
  p_attempt_status text,
  p_provider_response_id text,
  p_provider_status text,
  p_error_code text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_model text,
  p_routing_version text,
  p_semantic_route text,
  p_reasoning_effort text,
  p_checkpoint_scope text default null,
  p_origin_reservation_id uuid default null,
  p_result_envelope jsonb default null,
  p_execution_claim_token uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_model_call_key text;
  v_usage public.usage_ledger%rowtype;
  v_reservation private.document_allowance_reservations%rowtype;
  v_result private.legacy_model_call_results%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_admission private.legacy_model_attempt_admissions%rowtype;
  v_period_start timestamptz;
  v_response_sha256 text;
  v_source jsonb;
  v_inserted boolean := false;
  v_result_inserted boolean := false;
begin
  if p_user_id is null
    or p_logical_stage_key is null
    or p_logical_stage_key !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_provider_attempt_id is null
    or char_length(p_provider_attempt_id) not between 1 and 512
    or p_attempt_number is null or p_attempt_number < 1
    or p_attempt_status is null
    or p_attempt_status not in ('succeeded', 'failed', 'cancelled', 'unknown')
    or p_provider_status is null or char_length(p_provider_status) not between 1 and 80
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0
    or p_started_at is null or p_completed_at is null
    or p_completed_at < p_started_at
    or p_model is null or char_length(p_model) not between 1 and 160
    or p_routing_version is null or char_length(p_routing_version) not between 1 and 160
    or p_semantic_route is null
    or p_semantic_route not in ('fast', 'deep', 'research', 'review')
    or p_reasoning_effort is null
    or p_reasoning_effort not in ('low', 'medium', 'high')
    or (p_attempt_status = 'succeeded' and p_error_code is not null)
    or (p_attempt_status <> 'succeeded' and p_error_code is null)
    or (
      p_attempt_status = 'unknown'
      and (
        p_provider_status <> 'ambiguous'
        or p_error_code <> 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
      )
    )
    or (
      p_checkpoint_scope is null
      and (
        p_origin_reservation_id is not null
        or p_result_envelope is not null
        or p_execution_claim_token is not null
      )
    )
    or (
      p_checkpoint_scope is not null
      and (
        p_checkpoint_scope !~ '^[a-z0-9][a-z0-9-]{0,79}$'
        or p_execution_claim_token is null
        or p_logical_request_id is null
        or p_logical_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        or (
          p_checkpoint_scope in ('generate-document', 'generate-checklist')
          and p_origin_reservation_id is null
        )
        or (
          p_checkpoint_scope not in ('generate-document', 'generate-checklist')
          and p_origin_reservation_id is not null
        )
      )
    )
    or (
      p_provider_status = 'completed'
      and p_checkpoint_scope is not null
      and p_result_envelope is null
    )
    or (p_provider_status <> 'completed' and p_result_envelope is not null)
    or (
      p_result_envelope is not null
      and (
        pg_catalog.jsonb_typeof(p_result_envelope) is distinct from 'object'
        or pg_catalog.octet_length(p_result_envelope::text) > 1048576
        or p_result_envelope->>'version' is distinct from 'legacy-provider-result.1'
        or pg_catalog.jsonb_typeof(p_result_envelope->'text') is distinct from 'string'
        or not (p_result_envelope ?& array[
          'version', 'text', 'structured', 'sources', 'route_snapshot'
        ])
        or pg_catalog.jsonb_typeof(p_result_envelope->'structured') is null
        or pg_catalog.jsonb_typeof(p_result_envelope->'structured') not in ('object', 'null')
        or pg_catalog.jsonb_typeof(p_result_envelope->'sources') is distinct from 'array'
        or pg_catalog.jsonb_typeof(p_result_envelope->'route_snapshot') is distinct from 'object'
        or p_result_envelope - array[
          'version', 'text', 'structured', 'sources', 'route_snapshot'
        ] <> '{}'::jsonb
        or (p_result_envelope->'route_snapshot')->>'provider' is distinct from 'openai'
        or (p_result_envelope->'route_snapshot')->>'model' is distinct from p_model
        or (p_result_envelope->'route_snapshot')->>'routingVersion' is distinct from p_routing_version
        or (p_result_envelope->'route_snapshot')->>'semanticRoute' is distinct from p_semantic_route
        or (p_result_envelope->'route_snapshot')->>'reasoningEffort' is distinct from p_reasoning_effort
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'allowedTools') is distinct from 'array'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'background') is distinct from 'boolean'
        or (p_result_envelope->'route_snapshot')->>'store' is distinct from 'false'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'timeoutMs') is distinct from 'number'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'maxAttempts') is distinct from 'number'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'structuredOutputSchemaVersion') is distinct from 'string'
        or not ((p_result_envelope->'route_snapshot') ?& array[
          'provider', 'semanticRoute', 'model', 'reasoningEffort',
          'routingVersion', 'structuredOutputSchemaVersion', 'allowedTools',
          'timeoutMs', 'maxAttempts', 'background', 'store', 'fallback'
        ])
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'fallback') is null
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'fallback') not in ('object', 'null')
        or (p_result_envelope->'route_snapshot') - array[
          'provider', 'semanticRoute', 'model', 'reasoningEffort',
          'routingVersion', 'structuredOutputSchemaVersion', 'allowedTools',
          'timeoutMs', 'maxAttempts', 'background', 'store', 'fallback'
        ] <> '{}'::jsonb
      )
    ) then
    raise exception 'LEGACY_MODEL_ATTEMPT_INPUT_INVALID';
  end if;

  if p_result_envelope is not null then
    for v_source in
      select source_record.value
      from pg_catalog.jsonb_array_elements(p_result_envelope->'sources') source_record(value)
    loop
      if pg_catalog.jsonb_typeof(v_source) is distinct from 'object'
        or v_source - array['id', 'title', 'url', 'type'] <> '{}'::jsonb
        or v_source->>'type' is distinct from 'web'
        or v_source->>'id' is null or char_length(v_source->>'id') not between 1 and 200
        or v_source->>'title' is null or char_length(v_source->>'title') not between 1 and 500
        or v_source->>'url' is null or char_length(v_source->>'url') not between 1 and 2048
        or v_source->>'url' !~ '^https://' then
        raise exception 'LEGACY_MODEL_RESULT_SOURCE_INVALID';
      end if;
    end loop;
  end if;

  if p_checkpoint_scope is not null then
    if p_attempt_number > 2 then raise exception 'LEGACY_MODEL_ATTEMPT_NOT_ADMITTED'; end if;
    if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
      select reservation_record.billing_period_start into v_period_start
      from private.document_allowance_reservations reservation_record
      where reservation_record.id = p_origin_reservation_id
        and reservation_record.user_id = p_user_id;
      if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;

      perform private.document_allowance_lock(p_user_id, v_period_start);
      select * into v_reservation
      from private.document_allowance_reservations reservation_record
      where reservation_record.id = p_origin_reservation_id
        and reservation_record.user_id = p_user_id
      for update;
      if not found
        or v_reservation.request_id <> p_logical_request_id
        or v_reservation.route_key <> p_checkpoint_scope then
        raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID';
      end if;
      if v_reservation.status <> 'reserved' then
        raise exception 'LEGACY_MODEL_RESULT_RESERVATION_NOT_ACTIVE:%', v_reservation.status;
      end if;

      select * into v_claim
      from private.legacy_generation_execution_claims claim_record
      where claim_record.reservation_id = p_origin_reservation_id
        and claim_record.user_id = p_user_id
      for update;
      if not found
        or v_claim.checkpoint_scope <> p_checkpoint_scope
        or v_claim.logical_request_id <> p_logical_request_id
        or v_claim.claim_token <> p_execution_claim_token then
        raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
      end if;
      update private.legacy_generation_execution_claims
      set heartbeat_at = pg_catalog.clock_timestamp(),
          lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds'
      where reservation_id = v_claim.reservation_id;
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          p_user_id::text || '|' || p_checkpoint_scope || '|' ||
          p_logical_request_id,
          0
        )
      );
    end if;

    select * into v_admission
    from private.legacy_model_attempt_admissions admission_record
    where admission_record.user_id = p_user_id
      and admission_record.checkpoint_scope = p_checkpoint_scope
      and admission_record.logical_request_id = p_logical_request_id
      and admission_record.logical_stage_key = p_logical_stage_key
      and admission_record.request_sha256 = p_request_sha256
      and admission_record.attempt_number = p_attempt_number
      and admission_record.origin_reservation_id is not distinct from p_origin_reservation_id
    for update;
    if not found
      or v_admission.id::text <> p_provider_attempt_id
      or v_admission.claim_token <> p_execution_claim_token
      or (
        v_admission.dispatched_at is null
        and p_provider_status not in ('cancelled', 'rejected_before_provider')
      )
      or (
        v_admission.dispatched_at is not null
        and p_provider_status in ('cancelled', 'rejected_before_provider')
      ) then
      raise exception 'LEGACY_MODEL_ATTEMPT_NOT_ADMITTED';
    end if;

    if p_attempt_status = 'unknown' then
      if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
        update private.document_allowance_reservations
        set expires_at = 'infinity'::timestamptz,
            reconciliation_required_at = coalesce(
              reconciliation_required_at,
              pg_catalog.clock_timestamp()
            ),
            reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
            release_code = null,
            released_at = null,
            updated_at = pg_catalog.clock_timestamp()
        where id = v_reservation.id;
      else
        update private.legacy_model_attempt_admissions
        set reconciliation_required_at = coalesce(
              reconciliation_required_at,
              pg_catalog.clock_timestamp()
            ),
            reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
        where id = v_admission.id;
      end if;
    elsif p_checkpoint_scope in ('generate-document', 'generate-checklist') then
      -- A lease observer may have conservatively held this exact dispatched
      -- attempt while its provider response was still returning. The admitted
      -- claimant remains authoritative and may atomically replace that
      -- observation-only hold with its exact terminal result.
      update private.document_allowance_reservations
      set reconciliation_required_at = null,
          reconciliation_code = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = v_reservation.id;
    else
      update private.legacy_model_attempt_admissions
      set reconciliation_required_at = null,
          reconciliation_code = null
      where id = v_admission.id;
    end if;
  end if;

  v_model_call_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        p_logical_stage_key || '|' || p_request_sha256 || '|' || p_provider_attempt_id,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.usage_ledger(
    user_id,
    event_type,
    generation_request_id,
    task,
    provider,
    input_tokens,
    output_tokens,
    created_at,
    model_call_key,
    logical_request_id,
    checkpoint_scope,
    logical_stage_key,
    provider_request_sha256,
    provider_attempt_id,
    provider_response_id,
    provider_status,
    provider_error_code,
    model_call_status,
    provider_attempt_number,
    provider_started_at,
    provider_completed_at,
    model,
    routing_version,
    semantic_route,
    reasoning_effort
  ) values (
    p_user_id,
    'model_call',
    'legacy-model-call:' || v_model_call_key,
    p_logical_stage_key,
    'openai',
    p_input_tokens,
    p_output_tokens,
    p_completed_at,
    v_model_call_key,
    nullif(p_logical_request_id, ''),
    p_checkpoint_scope,
    p_logical_stage_key,
    p_request_sha256,
    p_provider_attempt_id,
    nullif(p_provider_response_id, ''),
    p_provider_status,
    p_error_code,
    p_attempt_status,
    p_attempt_number,
    p_started_at,
    p_completed_at,
    p_model,
    p_routing_version,
    p_semantic_route,
    p_reasoning_effort
  )
  on conflict on constraint usage_ledger_user_model_call_key_unique do nothing
  returning * into v_usage;

  if found then
    v_inserted := true;
  else
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.model_call_key = v_model_call_key;
    if not found then
      raise exception 'LEGACY_MODEL_ATTEMPT_PERSISTENCE_FAILED';
    end if;
    if v_usage.logical_request_id is distinct from nullif(p_logical_request_id, '')
      or v_usage.checkpoint_scope is distinct from p_checkpoint_scope
      or v_usage.logical_stage_key <> p_logical_stage_key
      or v_usage.provider_request_sha256 <> p_request_sha256
      or v_usage.provider_attempt_id <> p_provider_attempt_id
      or v_usage.provider_response_id is distinct from nullif(p_provider_response_id, '')
      or v_usage.provider_status <> p_provider_status
      or v_usage.provider_error_code is distinct from p_error_code
      or v_usage.model_call_status <> p_attempt_status
      or v_usage.provider_attempt_number <> p_attempt_number
      or v_usage.provider_started_at <> p_started_at
      or v_usage.provider_completed_at <> p_completed_at
      or v_usage.input_tokens <> p_input_tokens
      or v_usage.output_tokens <> p_output_tokens
      or v_usage.model <> p_model
      or v_usage.routing_version <> p_routing_version
      or v_usage.semantic_route <> p_semantic_route
      or v_usage.reasoning_effort <> p_reasoning_effort then
      raise exception 'LEGACY_MODEL_ATTEMPT_REPLAY_CONFLICT';
    end if;
  end if;

  if p_result_envelope is not null then
    v_response_sha256 := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(p_result_envelope::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    insert into private.legacy_model_call_results(
      user_id,
      checkpoint_scope,
      logical_request_id,
      logical_stage_key,
      request_sha256,
      usage_ledger_id,
      origin_reservation_id,
      result_version,
      response_sha256,
      response_envelope
    ) values (
      p_user_id,
      p_checkpoint_scope,
      p_logical_request_id,
      p_logical_stage_key,
      p_request_sha256,
      v_usage.id,
      p_origin_reservation_id,
      'legacy-provider-result.1',
      v_response_sha256,
      p_result_envelope
    )
    on conflict (user_id, checkpoint_scope, logical_request_id, logical_stage_key)
    do nothing
    returning * into v_result;

    if found then
      v_result_inserted := true;
    else
      select * into v_result
      from private.legacy_model_call_results result_record
      where result_record.user_id = p_user_id
        and result_record.checkpoint_scope = p_checkpoint_scope
        and result_record.logical_request_id = p_logical_request_id
        and result_record.logical_stage_key = p_logical_stage_key;
      if not found then raise exception 'LEGACY_MODEL_RESULT_PERSISTENCE_FAILED'; end if;
      if v_result.request_sha256 <> p_request_sha256
        or v_result.usage_ledger_id <> v_usage.id
        or v_result.origin_reservation_id is distinct from p_origin_reservation_id
        or v_result.result_version <> 'legacy-provider-result.1'
        or v_result.response_sha256 <> v_response_sha256
        or v_result.response_envelope <> p_result_envelope then
        raise exception 'LEGACY_MODEL_RESULT_REPLAY_CONFLICT';
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'usage_ledger_id', v_usage.id,
    'model_call_key', v_model_call_key,
    'idempotent_replay', not v_inserted,
    'result_id', v_result.id,
    'result_response_sha256', v_result.response_sha256,
    'result_idempotent_replay',
      case when p_result_envelope is null then null else not v_result_inserted end
  );
end;
$function$;

-- Prior body: 20260907053000_ollama_credit_fallback.sql; existing grants remain unchanged.
create or replace function public.record_legacy_model_call_attempt_with_provider(
  p_user_id uuid,
  p_logical_request_id text,
  p_logical_stage_key text,
  p_request_sha256 text,
  p_provider_attempt_id text,
  p_attempt_number integer,
  p_attempt_status text,
  p_provider_response_id text,
  p_provider_status text,
  p_error_code text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_model text,
  p_routing_version text,
  p_semantic_route text,
  p_reasoning_effort text,
  p_checkpoint_scope text default null,
  p_origin_reservation_id uuid default null,
  p_result_envelope jsonb default null,
  p_execution_claim_token uuid default null,
  p_provider text default 'openai'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_model_call_key text;
  v_primary public.usage_ledger%rowtype;
  v_usage public.usage_ledger%rowtype;
  v_reservation private.document_allowance_reservations%rowtype;
  v_result private.legacy_model_call_results%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_admission private.legacy_model_attempt_admissions%rowtype;
  v_period_start timestamptz;
  v_response_sha256 text;
  v_source jsonb;
  v_inserted boolean := false;
  v_result_inserted boolean := false;
begin
  if p_provider is null or p_provider not in ('openai','ollama') then
    raise exception 'LEGACY_MODEL_PROVIDER_INVALID';
  end if;
  if p_provider = 'ollama' then
    if p_checkpoint_scope is null or p_attempt_number <> 2 then
      raise exception 'OLLAMA_DURABLE_CREDIT_REJECTION_REQUIRED';
    end if;
    select * into v_primary from public.usage_ledger
    where user_id = p_user_id and checkpoint_scope = p_checkpoint_scope
      and logical_request_id = p_logical_request_id and logical_stage_key = p_logical_stage_key
      and provider_request_sha256 = p_request_sha256 and provider_attempt_number = 1
      and provider = 'openai' and model_call_status = 'failed'
      and provider_status in ('http_402','http_429')
      and provider_error_code = 'OPENAI_CREDIT_EXHAUSTED'
      and input_tokens = 0 and output_tokens = 0;
    if not found then raise exception 'OLLAMA_DURABLE_CREDIT_REJECTION_REQUIRED'; end if;
  end if;
  if p_user_id is null
    or p_logical_stage_key is null
    or p_logical_stage_key !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_provider_attempt_id is null
    or char_length(p_provider_attempt_id) not between 1 and 512
    or p_attempt_number is null or p_attempt_number < 1
    or p_attempt_status is null
    or p_attempt_status not in ('succeeded', 'failed', 'cancelled', 'unknown')
    or p_provider_status is null or char_length(p_provider_status) not between 1 and 80
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0
    or p_started_at is null or p_completed_at is null
    or p_completed_at < p_started_at
    or p_model is null or char_length(p_model) not between 1 and 160
    or p_routing_version is null or char_length(p_routing_version) not between 1 and 160
    or p_semantic_route is null
    or p_semantic_route not in ('fast', 'deep', 'research', 'review')
    or p_reasoning_effort is null
    or p_reasoning_effort not in ('low', 'medium', 'high')
    or (p_attempt_status = 'succeeded' and p_error_code is not null)
    or (p_attempt_status <> 'succeeded' and p_error_code is null)
    or (
      p_attempt_status = 'unknown'
      and (
        p_provider_status <> 'ambiguous'
        or p_error_code not in ('OPENAI_PROVIDER_RECONCILIATION_REQUIRED', 'OLLAMA_PROVIDER_RECONCILIATION_REQUIRED')
      )
    )
    or (
      p_checkpoint_scope is null
      and (
        p_origin_reservation_id is not null
        or p_result_envelope is not null
        or p_execution_claim_token is not null
      )
    )
    or (
      p_checkpoint_scope is not null
      and (
        p_checkpoint_scope !~ '^[a-z0-9][a-z0-9-]{0,79}$'
        or p_execution_claim_token is null
        or p_logical_request_id is null
        or p_logical_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        or (
          p_checkpoint_scope in ('generate-document', 'generate-checklist')
          and p_origin_reservation_id is null
        )
        or (
          p_checkpoint_scope not in ('generate-document', 'generate-checklist')
          and p_origin_reservation_id is not null
        )
      )
    )
    or (
      p_provider_status = 'completed'
      and p_checkpoint_scope is not null
      and p_result_envelope is null
    )
    or (p_provider_status <> 'completed' and p_result_envelope is not null)
    or (
      p_result_envelope is not null
      and (
        pg_catalog.jsonb_typeof(p_result_envelope) is distinct from 'object'
        or pg_catalog.octet_length(p_result_envelope::text) > 1048576
        or p_result_envelope->>'version' is distinct from 'legacy-provider-result.1'
        or pg_catalog.jsonb_typeof(p_result_envelope->'text') is distinct from 'string'
        or not (p_result_envelope ?& array[
          'version', 'text', 'structured', 'sources', 'route_snapshot'
        ])
        or pg_catalog.jsonb_typeof(p_result_envelope->'structured') is null
        or pg_catalog.jsonb_typeof(p_result_envelope->'structured') not in ('object', 'null')
        or pg_catalog.jsonb_typeof(p_result_envelope->'sources') is distinct from 'array'
        or pg_catalog.jsonb_typeof(p_result_envelope->'route_snapshot') is distinct from 'object'
        or p_result_envelope - array[
          'version', 'text', 'structured', 'sources', 'route_snapshot'
        ] <> '{}'::jsonb
        or (p_result_envelope->'route_snapshot')->>'provider' is distinct from 'openai'
        or (p_provider = 'openai' and (p_result_envelope->'route_snapshot')->>'model' is distinct from p_model)
        or (p_provider = 'ollama' and (
          not private.valid_ollama_credit_policy(p_result_envelope #> '{route_snapshot,creditFallback}')
          or p_result_envelope #>> '{route_snapshot,creditFallback,model}' is distinct from p_model
          or p_result_envelope #>> '{route_snapshot,model}' is distinct from v_primary.model
          or p_result_envelope #> '{route_snapshot,allowedTools}' is distinct from '[]'::jsonb
          or p_result_envelope #>> '{route_snapshot,maxAttempts}' is distinct from '2'
        ))
        or (p_result_envelope->'route_snapshot')->>'routingVersion' is distinct from p_routing_version
        or (p_result_envelope->'route_snapshot')->>'semanticRoute' is distinct from p_semantic_route
        or (p_result_envelope->'route_snapshot')->>'reasoningEffort' is distinct from p_reasoning_effort
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'allowedTools') is distinct from 'array'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'background') is distinct from 'boolean'
        or (p_result_envelope->'route_snapshot')->>'store' is distinct from 'false'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'timeoutMs') is distinct from 'number'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'maxAttempts') is distinct from 'number'
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'structuredOutputSchemaVersion') is distinct from 'string'
        or not ((p_result_envelope->'route_snapshot') ?& array[
          'provider', 'semanticRoute', 'model', 'reasoningEffort',
          'routingVersion', 'structuredOutputSchemaVersion', 'allowedTools',
          'timeoutMs', 'maxAttempts', 'background', 'store', 'fallback'
        ])
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'fallback') is null
        or pg_catalog.jsonb_typeof((p_result_envelope->'route_snapshot')->'fallback') not in ('object', 'null')
        or (p_result_envelope->'route_snapshot') - array[
          'provider', 'semanticRoute', 'model', 'reasoningEffort',
          'routingVersion', 'structuredOutputSchemaVersion', 'allowedTools',
          'timeoutMs', 'maxAttempts', 'background', 'store', 'fallback', 'creditFallback'
        ] <> '{}'::jsonb
      )
    ) then
    raise exception 'LEGACY_MODEL_ATTEMPT_INPUT_INVALID';
  end if;

  if p_result_envelope is not null then
    for v_source in
      select source_record.value
      from pg_catalog.jsonb_array_elements(p_result_envelope->'sources') source_record(value)
    loop
      if pg_catalog.jsonb_typeof(v_source) is distinct from 'object'
        or v_source - array['id', 'title', 'url', 'type'] <> '{}'::jsonb
        or v_source->>'type' is distinct from 'web'
        or v_source->>'id' is null or char_length(v_source->>'id') not between 1 and 200
        or v_source->>'title' is null or char_length(v_source->>'title') not between 1 and 500
        or v_source->>'url' is null or char_length(v_source->>'url') not between 1 and 2048
        or v_source->>'url' !~ '^https://' then
        raise exception 'LEGACY_MODEL_RESULT_SOURCE_INVALID';
      end if;
    end loop;
  end if;

  if p_checkpoint_scope is not null then
    if p_attempt_number > 2 then raise exception 'LEGACY_MODEL_ATTEMPT_NOT_ADMITTED'; end if;
    if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
      select reservation_record.billing_period_start into v_period_start
      from private.document_allowance_reservations reservation_record
      where reservation_record.id = p_origin_reservation_id
        and reservation_record.user_id = p_user_id;
      if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;

      perform private.document_allowance_lock(p_user_id, v_period_start);
      select * into v_reservation
      from private.document_allowance_reservations reservation_record
      where reservation_record.id = p_origin_reservation_id
        and reservation_record.user_id = p_user_id
      for update;
      if not found
        or v_reservation.request_id <> p_logical_request_id
        or v_reservation.route_key <> p_checkpoint_scope then
        raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID';
      end if;
      if v_reservation.status <> 'reserved' then
        raise exception 'LEGACY_MODEL_RESULT_RESERVATION_NOT_ACTIVE:%', v_reservation.status;
      end if;

      select * into v_claim
      from private.legacy_generation_execution_claims claim_record
      where claim_record.reservation_id = p_origin_reservation_id
        and claim_record.user_id = p_user_id
      for update;
      if not found
        or v_claim.checkpoint_scope <> p_checkpoint_scope
        or v_claim.logical_request_id <> p_logical_request_id
        or v_claim.claim_token <> p_execution_claim_token then
        raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
      end if;
      update private.legacy_generation_execution_claims
      set heartbeat_at = pg_catalog.clock_timestamp(),
          lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds'
      where reservation_id = v_claim.reservation_id;
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          p_user_id::text || '|' || p_checkpoint_scope || '|' ||
          p_logical_request_id,
          0
        )
      );
    end if;

    select * into v_admission
    from private.legacy_model_attempt_admissions admission_record
    where admission_record.user_id = p_user_id
      and admission_record.checkpoint_scope = p_checkpoint_scope
      and admission_record.logical_request_id = p_logical_request_id
      and admission_record.logical_stage_key = p_logical_stage_key
      and admission_record.request_sha256 = p_request_sha256
      and admission_record.attempt_number = p_attempt_number
      and admission_record.origin_reservation_id is not distinct from p_origin_reservation_id
    for update;
    if not found
      or v_admission.id::text <> p_provider_attempt_id
      or v_admission.claim_token <> p_execution_claim_token
      or (
        v_admission.dispatched_at is null
        and p_provider_status not in ('cancelled', 'rejected_before_provider')
      )
      or (
        v_admission.dispatched_at is not null
        and p_provider_status in ('cancelled', 'rejected_before_provider')
      ) then
      raise exception 'LEGACY_MODEL_ATTEMPT_NOT_ADMITTED';
    end if;

    if p_attempt_status = 'unknown' then
      if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
        update private.document_allowance_reservations
        set expires_at = 'infinity'::timestamptz,
            reconciliation_required_at = coalesce(
              reconciliation_required_at,
              pg_catalog.clock_timestamp()
            ),
            reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
            release_code = null,
            released_at = null,
            updated_at = pg_catalog.clock_timestamp()
        where id = v_reservation.id;
      else
        update private.legacy_model_attempt_admissions
        set reconciliation_required_at = coalesce(
              reconciliation_required_at,
              pg_catalog.clock_timestamp()
            ),
            reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
        where id = v_admission.id;
      end if;
    elsif p_checkpoint_scope in ('generate-document', 'generate-checklist') then
      -- A lease observer may have conservatively held this exact dispatched
      -- attempt while its provider response was still returning. The admitted
      -- claimant remains authoritative and may atomically replace that
      -- observation-only hold with its exact terminal result.
      update private.document_allowance_reservations
      set reconciliation_required_at = null,
          reconciliation_code = null,
          updated_at = pg_catalog.clock_timestamp()
      where id = v_reservation.id;
    else
      update private.legacy_model_attempt_admissions
      set reconciliation_required_at = null,
          reconciliation_code = null
      where id = v_admission.id;
    end if;
  end if;

  v_model_call_key := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        p_logical_stage_key || '|' || p_request_sha256 || '|' || p_provider_attempt_id,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.usage_ledger(
    user_id,
    event_type,
    generation_request_id,
    task,
    provider,
    input_tokens,
    output_tokens,
    created_at,
    model_call_key,
    logical_request_id,
    checkpoint_scope,
    logical_stage_key,
    provider_request_sha256,
    provider_attempt_id,
    provider_response_id,
    provider_status,
    provider_error_code,
    model_call_status,
    provider_attempt_number,
    provider_started_at,
    provider_completed_at,
    model,
    routing_version,
    semantic_route,
    reasoning_effort
  ) values (
    p_user_id,
    'model_call',
    'legacy-model-call:' || v_model_call_key,
    p_logical_stage_key,
    p_provider,
    p_input_tokens,
    p_output_tokens,
    p_completed_at,
    v_model_call_key,
    nullif(p_logical_request_id, ''),
    p_checkpoint_scope,
    p_logical_stage_key,
    p_request_sha256,
    p_provider_attempt_id,
    nullif(p_provider_response_id, ''),
    p_provider_status,
    p_error_code,
    p_attempt_status,
    p_attempt_number,
    p_started_at,
    p_completed_at,
    p_model,
    p_routing_version,
    p_semantic_route,
    p_reasoning_effort
  )
  on conflict on constraint usage_ledger_user_model_call_key_unique do nothing
  returning * into v_usage;

  if found then
    v_inserted := true;
  else
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.model_call_key = v_model_call_key;
    if not found then
      raise exception 'LEGACY_MODEL_ATTEMPT_PERSISTENCE_FAILED';
    end if;
    if v_usage.logical_request_id is distinct from nullif(p_logical_request_id, '')
      or v_usage.checkpoint_scope is distinct from p_checkpoint_scope
      or v_usage.logical_stage_key <> p_logical_stage_key
      or v_usage.provider <> p_provider
      or v_usage.provider_request_sha256 <> p_request_sha256
      or v_usage.provider_attempt_id <> p_provider_attempt_id
      or v_usage.provider_response_id is distinct from nullif(p_provider_response_id, '')
      or v_usage.provider_status <> p_provider_status
      or v_usage.provider_error_code is distinct from p_error_code
      or v_usage.model_call_status <> p_attempt_status
      or v_usage.provider_attempt_number <> p_attempt_number
      or v_usage.provider_started_at <> p_started_at
      or v_usage.provider_completed_at <> p_completed_at
      or v_usage.input_tokens <> p_input_tokens
      or v_usage.output_tokens <> p_output_tokens
      or v_usage.model <> p_model
      or v_usage.routing_version <> p_routing_version
      or v_usage.semantic_route <> p_semantic_route
      or v_usage.reasoning_effort <> p_reasoning_effort then
      raise exception 'LEGACY_MODEL_ATTEMPT_REPLAY_CONFLICT';
    end if;
  end if;

  if p_result_envelope is not null then
    v_response_sha256 := pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(p_result_envelope::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    insert into private.legacy_model_call_results(
      user_id,
      checkpoint_scope,
      logical_request_id,
      logical_stage_key,
      request_sha256,
      usage_ledger_id,
      origin_reservation_id,
      result_version,
      response_sha256,
      response_envelope
    ) values (
      p_user_id,
      p_checkpoint_scope,
      p_logical_request_id,
      p_logical_stage_key,
      p_request_sha256,
      v_usage.id,
      p_origin_reservation_id,
      'legacy-provider-result.1',
      v_response_sha256,
      p_result_envelope
    )
    on conflict (user_id, checkpoint_scope, logical_request_id, logical_stage_key)
    do nothing
    returning * into v_result;

    if found then
      v_result_inserted := true;
    else
      select * into v_result
      from private.legacy_model_call_results result_record
      where result_record.user_id = p_user_id
        and result_record.checkpoint_scope = p_checkpoint_scope
        and result_record.logical_request_id = p_logical_request_id
        and result_record.logical_stage_key = p_logical_stage_key;
      if not found then raise exception 'LEGACY_MODEL_RESULT_PERSISTENCE_FAILED'; end if;
      if v_result.request_sha256 <> p_request_sha256
        or v_result.usage_ledger_id <> v_usage.id
        or v_result.origin_reservation_id is distinct from p_origin_reservation_id
        or v_result.result_version <> 'legacy-provider-result.1'
        or v_result.response_sha256 <> v_response_sha256
        or v_result.response_envelope <> p_result_envelope then
        raise exception 'LEGACY_MODEL_RESULT_REPLAY_CONFLICT';
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'usage_ledger_id', v_usage.id,
    'model_call_key', v_model_call_key,
    'idempotent_replay', not v_inserted,
    'result_id', v_result.id,
    'result_response_sha256', v_result.response_sha256,
    'result_idempotent_replay',
      case when p_result_envelope is null then null else not v_result_inserted end
  );
end;
$function$;

-- Prior body: 20260901060000_legacy_model_accounting_and_replay.sql; existing grants remain unchanged.
create or replace function public.mark_legacy_model_attempt_dispatched(
  p_user_id uuid,
  p_checkpoint_scope text,
  p_origin_reservation_id uuid,
  p_logical_request_id text,
  p_logical_stage_key text,
  p_request_sha256 text,
  p_attempt_number integer,
  p_attempt_admission_id uuid,
  p_execution_claim_token uuid,
  p_dispatch_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_admission private.legacy_model_attempt_admissions%rowtype;
  v_idempotent boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_user_id is null
    or p_checkpoint_scope is null
    or p_checkpoint_scope !~ '^[a-z0-9][a-z0-9-]{0,79}$'
    or (
      p_checkpoint_scope in ('generate-document', 'generate-checklist')
      and p_origin_reservation_id is null
    )
    or (
      p_checkpoint_scope not in ('generate-document', 'generate-checklist')
      and p_origin_reservation_id is not null
    )
    or p_logical_request_id is null
    or p_logical_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or p_logical_stage_key is null
    or p_logical_stage_key !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_attempt_number is null
    or p_attempt_number not between 1 and 2
    or p_attempt_admission_id is null
    or p_execution_claim_token is null
    or p_dispatch_token is null then
    raise exception 'LEGACY_MODEL_DISPATCH_INPUT_INVALID';
  end if;

  if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
    select reservation_record.billing_period_start into v_period_start
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = p_origin_reservation_id
      and reservation_record.user_id = p_user_id;
    if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;

    perform private.document_allowance_lock(p_user_id, v_period_start);
    select * into v_reservation
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = p_origin_reservation_id
      and reservation_record.user_id = p_user_id
    for update;
    if not found
      or v_reservation.status <> 'reserved'
      or v_reservation.request_id <> p_logical_request_id
      or v_reservation.route_key <> p_checkpoint_scope
      or v_reservation.reconciliation_required_at is not null then
      raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID';
    end if;

    select * into v_claim
    from private.legacy_generation_execution_claims claim_record
    where claim_record.reservation_id = p_origin_reservation_id
      and claim_record.user_id = p_user_id
    for update;
    if not found
      or v_claim.checkpoint_scope <> p_checkpoint_scope
      or v_claim.logical_request_id <> p_logical_request_id
      or v_claim.claim_token <> p_execution_claim_token
      or v_claim.lease_expires_at <= v_now then
      raise exception 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID';
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_user_id::text || '|' || p_checkpoint_scope || '|' ||
        p_logical_request_id,
        0
      )
    );
  end if;

  select * into v_admission
  from private.legacy_model_attempt_admissions admission_record
  where admission_record.id = p_attempt_admission_id
    and admission_record.user_id = p_user_id
    and admission_record.checkpoint_scope = p_checkpoint_scope
    and admission_record.logical_request_id = p_logical_request_id
    and admission_record.logical_stage_key = p_logical_stage_key
    and admission_record.request_sha256 = p_request_sha256
    and admission_record.attempt_number = p_attempt_number
    and admission_record.origin_reservation_id is not distinct from p_origin_reservation_id
    and admission_record.claim_token = p_execution_claim_token
  for update;
  if not found then raise exception 'LEGACY_MODEL_ATTEMPT_NOT_ADMITTED'; end if;
  if v_admission.lease_expires_at <= v_now and v_admission.dispatched_at is null then
    raise exception 'LEGACY_MODEL_ATTEMPT_LEASE_EXPIRED';
  end if;
  if v_admission.dispatch_token is not null then
    if v_admission.dispatch_token <> p_dispatch_token then
      raise exception 'LEGACY_MODEL_ATTEMPT_ALREADY_DISPATCHED';
    end if;
    v_idempotent := true;
  else
    update private.legacy_model_attempt_admissions
    set dispatch_token = p_dispatch_token,
        dispatched_at = v_now,
        heartbeat_at = v_now,
        lease_expires_at = v_now + interval '120 seconds'
    where id = v_admission.id;
  end if;
  if p_checkpoint_scope in ('generate-document', 'generate-checklist') then
    update private.legacy_generation_execution_claims
    set heartbeat_at = v_now,
        lease_expires_at = v_now + interval '120 seconds'
    where reservation_id = v_claim.reservation_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'state', 'dispatched',
    'attempt_admission_id', v_admission.id,
    'provider_attempt_id', v_admission.id,
    'idempotent_replay', v_idempotent
  );
end;
$function$;

commit;
