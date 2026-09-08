-- Explicit OpenAI-credit fallback to a pinned local Ollama execution.
-- Existing OpenAI RPC signatures and historical records remain unchanged.
-- No route, capacity, model, or hosted fallback is enabled by this migration.
begin;

create or replace function private.valid_ollama_credit_policy(p_policy jsonb)
returns boolean language sql immutable set search_path = ''
as $function$
  select coalesce(
    jsonb_typeof(p_policy) = 'object'
    and p_policy ?& array['provider','model','modelDigest','configurationVersion']
    and p_policy - array['provider','model','modelDigest','configurationVersion'] = '{}'::jsonb
    and jsonb_typeof(p_policy->'provider') = 'string'
    and jsonb_typeof(p_policy->'model') = 'string'
    and jsonb_typeof(p_policy->'modelDigest') = 'string'
    and jsonb_typeof(p_policy->'configurationVersion') = 'string'
    and p_policy->>'provider' = 'ollama'
    and p_policy->>'model' ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$'
    and lower(p_policy->>'model') not like '%cloud%'
    and p_policy->>'modelDigest' ~ '^[0-9a-f]{64}$'
    and p_policy->>'configurationVersion' ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$', false);
$function$;
revoke all on function private.valid_ollama_credit_policy(jsonb) from public, anon, authenticated, service_role;

alter table private.captured_document_provider_attempts
  drop constraint captured_document_provider_attempts_provider_check,
  add constraint captured_document_provider_attempts_provider_check
    check (provider in ('openai', 'ollama'));


alter table public.usage_ledger drop constraint usage_ledger_legacy_model_attempt_shape_check;

alter table public.usage_ledger
  add constraint usage_ledger_legacy_model_attempt_shape_check check (
    model_call_key is null or (
      event_type = 'model_call'
      and model_call_key ~ '^[0-9a-f]{64}$'
      and logical_stage_key is not null
      and logical_stage_key ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
      and provider_request_sha256 is not null
      and provider_request_sha256 ~ '^[0-9a-f]{64}$'
      and provider_attempt_id is not null
      and char_length(provider_attempt_id) between 1 and 512
      and provider in ('openai', 'ollama')
      and (
        checkpoint_scope is null
        or (
          checkpoint_scope ~ '^[a-z0-9][a-z0-9-]{0,79}$'
          and logical_request_id is not null
          and logical_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
        )
      )
      and provider_attempt_number is not null
      and provider_attempt_number > 0
      and model_call_status is not null
      and model_call_status in ('succeeded', 'failed', 'cancelled', 'unknown')
      and provider_completed_at is not null
      and (
        (model_call_status = 'succeeded' and provider_error_code is null)
        or
        (model_call_status <> 'succeeded' and provider_error_code is not null)
      )
      and (
        model_call_status <> 'unknown'
        or (
          provider_status = 'ambiguous'
          and provider_error_code in ('OPENAI_PROVIDER_RECONCILIATION_REQUIRED', 'OLLAMA_PROVIDER_RECONCILIATION_REQUIRED')
        )
      )
      and provider_started_at is not null
      and provider_completed_at >= provider_started_at
      and provider_status is not null
      and model is not null
      and routing_version is not null
      and input_tokens is not null and input_tokens >= 0
      and output_tokens is not null and output_tokens >= 0
      and semantic_route is not null
      and semantic_route in ('fast', 'deep', 'research', 'review')
      and reasoning_effort is not null
      and reasoning_effort in ('low', 'medium', 'high')
    )
  ) not valid;

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
          p_logical_request_id || '|' || p_logical_stage_key,
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

revoke all on function public.record_legacy_model_call_attempt_with_provider(uuid, text, text, text, text, integer, text, text, text, text, integer, integer, timestamptz, timestamptz, text, text, text, text, text, uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.record_legacy_model_call_attempt_with_provider(uuid, text, text, text, text, integer, text, text, text, text, integer, integer, timestamptz, timestamptz, text, text, text, text, text, uuid, jsonb, uuid, text) to service_role;

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
        p_logical_request_id || '|' || p_logical_stage_key,
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
end;
$function$;

revoke all on function public.read_legacy_model_call_checkpoint_with_fallback(uuid, text, uuid, text, text, text, integer, uuid, boolean) from public, anon, authenticated;
grant execute on function public.read_legacy_model_call_checkpoint_with_fallback(uuid, text, uuid, text, text, text, integer, uuid, boolean) to service_role;

create or replace function public.record_captured_document_provider_attempt(
  p_operation_id uuid,
  p_expected_operation_revision integer,
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
  v_existing private.captured_document_provider_attempts%rowtype;
  v_attempt private.captured_document_provider_attempts%rowtype;
  v_route jsonb;
  v_payload jsonb;
  v_hash text;
  v_stage text := btrim(p_logical_stage_key);
  v_attempt_number integer;
  v_execution_provider text := 'openai';
  v_execution_model text := p_model;
begin
  if p_logical_stage_key is null
    or nullif(v_stage, '') is null
    or char_length(p_logical_stage_key) > 120
    or p_attempt_number is null or p_attempt_number < 0
    or p_semantic_route is null
    or p_semantic_route not in ('fast', 'deep', 'research', 'review')
    or nullif(btrim(p_model), '') is null
    or p_reasoning_effort is null
    or p_reasoning_effort not in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    or p_retention_mode is null
    or p_retention_mode not in (
      'store_false', 'background_store_false', 'provider_default_unverified'
    )
    or p_status is null
    or p_status not in ('prepared', 'succeeded', 'failed', 'cancelled')
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0
    or p_started_at is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or (v_stage = 'generation' and p_semantic_route <> 'deep')
    or (v_stage = 'review' and p_semantic_route <> 'review')
    or v_stage not in ('generation', 'review') then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_INVALID';
  end if;
  if p_status = 'prepared' and (
    p_attempt_number <> 0
    or nullif(btrim(p_provider_response_id), '') is not null
    or p_input_tokens <> 0 or p_output_tokens <> 0
    or nullif(btrim(p_retry_reason), '') is not null
    or nullif(btrim(p_error_code), '') is not null
    or p_completed_at is not null
    or p_structured_output is not null
  ) then
    raise exception 'CAPTURED_PROVIDER_PREPARATION_INVALID';
  end if;
  if p_status <> 'prepared' and (
    p_attempt_number < 1
    or p_completed_at is null
    or p_completed_at < p_started_at
    or (
      p_status = 'succeeded'
      and (
        nullif(btrim(p_provider_response_id), '') is null
        or jsonb_typeof(p_structured_output) is distinct from 'object'
        or octet_length(p_structured_output::text) > 10485760
        or nullif(btrim(p_error_code), '') is not null
      )
    )
    or (
      p_status in ('failed', 'cancelled')
      and (
        p_structured_output is not null
        or nullif(btrim(p_error_code), '') is null
      )
    )
  ) then
    raise exception 'CAPTURED_PROVIDER_COMPLETION_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  v_route := v_operation.route_snapshot->'routes'->p_semantic_route;
  if jsonb_typeof(v_route) is distinct from 'object'
    or v_route->>'provider' is distinct from 'openai'
    or v_route->>'semanticRoute' is distinct from p_semantic_route
    or v_route->>'model' is distinct from p_model
    or v_route->>'reasoningEffort' is distinct from p_reasoning_effort
    or v_route->>'routingVersion' is distinct from v_operation.routing_version then
    raise exception 'CAPTURED_PROVIDER_ROUTE_MISMATCH:%', p_semantic_route;
  end if;

  if v_route ? 'creditFallback' and (p_status = 'prepared' or p_attempt_number = 2) then
    if not private.valid_ollama_credit_policy(v_route->'creditFallback')
      or v_route->'allowedTools' is distinct from '[]'::jsonb
      or v_route->>'maxAttempts' is distinct from '2' then
      raise exception 'OLLAMA_ACCEPTED_POLICY_INVALID';
    end if;
    if exists (
      select 1 from private.captured_document_provider_attempts primary_attempt
      where primary_attempt.operation_id = p_operation_id
        and primary_attempt.user_id = v_operation.user_id
        and primary_attempt.logical_stage_key = v_stage
        and primary_attempt.request_sha256 = p_request_sha256
        and primary_attempt.attempt_number = 1
        and primary_attempt.provider = 'openai'
        and primary_attempt.model = p_model
        and primary_attempt.status = 'failed'
        and primary_attempt.error_code = 'OPENAI_CREDIT_EXHAUSTED'
        and primary_attempt.input_tokens = 0 and primary_attempt.output_tokens = 0
    ) then
      v_execution_provider := 'ollama';
      v_execution_model := v_route #>> '{creditFallback,model}';
    end if;
  end if;

  if p_status = 'prepared' then
    select * into v_existing
    from private.captured_document_provider_attempts
    where operation_id = p_operation_id
      and logical_stage_key = v_stage
      and status = 'prepared';
    if found then
      if v_existing.request_sha256 <> p_request_sha256
        or v_existing.started_at <> p_started_at
        or v_existing.semantic_route <> p_semantic_route
        or v_existing.model <> v_execution_model
        or v_existing.provider <> v_execution_provider
        or v_existing.reasoning_effort <> p_reasoning_effort
        or v_existing.retention_mode <> p_retention_mode then
        raise exception 'CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED';
      end if;
      return jsonb_build_object(
        'attempt_id', v_existing.id,
        'provider_attempt_number', v_existing.attempt_number,
        'provider_client_request_id', v_existing.id::text,
        'provider_execution', case when v_existing.provider = 'ollama' then v_route->'creditFallback' else null end,
        'operation_id', v_existing.operation_id,
        'operation_revision', v_operation.operation_revision,
        'idempotent_replay', true
      );
    end if;

    if exists (
      select 1
      from private.captured_document_provider_attempts attempt_record
      where attempt_record.operation_id = p_operation_id
        and attempt_record.logical_stage_key = v_stage
        and attempt_record.status = 'succeeded'
    ) then
      raise exception 'CAPTURED_PROVIDER_SUCCESS_RECONCILIATION_REQUIRED';
    end if;

    if v_operation.operation_revision <> p_expected_operation_revision then
      raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
        p_expected_operation_revision, v_operation.operation_revision;
    end if;
    if p_lease_token is null
      or v_operation.lease_token is distinct from p_lease_token
      or v_operation.lease_expires_at is null
      or v_operation.lease_expires_at <= clock_timestamp() then
      raise exception 'CAPTURED_OPERATION_LEASE_LOST';
    end if;
    if (v_stage = 'generation' and v_operation.status <> 'generating')
      or (v_stage = 'review' and v_operation.status <> 'validating') then
      raise exception 'CAPTURED_PROVIDER_ATTEMPT_STATUS_INVALID:%', v_operation.status;
    end if;

    select coalesce(max(attempt_record.attempt_number), 0) + 1
    into v_attempt_number
    from private.captured_document_provider_attempts attempt_record
    where attempt_record.operation_id = p_operation_id
      and attempt_record.logical_stage_key = v_stage;

    v_payload := jsonb_build_object(
      'operationId', p_operation_id,
      'logicalStageKey', v_stage,
      'attemptNumber', v_attempt_number,
      'provider', v_execution_provider,
      'semanticRoute', p_semantic_route,
      'model', v_execution_model,
      'reasoningEffort', p_reasoning_effort,
      'retentionMode', p_retention_mode,
      'requestSha256', p_request_sha256,
      'startedAt', p_started_at
    );
    v_hash := encode(
      extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );

    insert into private.captured_document_provider_attempts(
      operation_id, user_id, logical_stage_key, attempt_number, provider,
      semantic_route, model, reasoning_effort, provider_response_id,
      retention_mode, status, input_tokens, output_tokens, retry_reason,
      error_code, started_at, completed_at, request_sha256,
      structured_output, attempt_sha256
    ) values (
      v_operation.id, v_operation.user_id, v_stage, v_attempt_number,
      v_execution_provider, p_semantic_route, v_execution_model, p_reasoning_effort, null,
      p_retention_mode, 'prepared', 0, 0, null, null, p_started_at, null,
      p_request_sha256, null, v_hash
    ) returning * into v_attempt;

    update private.captured_document_operations
    set operation_revision = operation_revision + 1,
        updated_at = clock_timestamp()
    where id = p_operation_id
    returning * into v_operation;

    perform private.append_captured_document_event(
      v_operation.id, v_operation.user_id, v_operation.operation_revision,
      v_operation.status, 'provider_attempt_prepared',
      jsonb_build_object(
        'logical_stage_key', v_attempt.logical_stage_key,
        'attempt_number', v_attempt.attempt_number,
        'semantic_route', v_attempt.semantic_route,
        'model', v_attempt.model,
        'attempt_sha256', v_attempt.attempt_sha256
      )
    );

    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'provider_attempt_number', v_attempt.attempt_number,
      'provider_client_request_id', v_attempt.id::text,
      'provider_execution', case when v_attempt.provider = 'ollama' then v_route->'creditFallback' else null end,
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'idempotent_replay', false
    );
  end if;

  select * into v_existing
  from private.captured_document_provider_attempts
  where operation_id = p_operation_id
    and logical_stage_key = v_stage
    and attempt_number = p_attempt_number;
  if not found then
    raise exception 'CAPTURED_PROVIDER_PREPARATION_NOT_FOUND';
  end if;
  if v_existing.status <> 'prepared' then
    if v_existing.request_sha256 <> p_request_sha256
      or v_existing.started_at <> p_started_at
      or v_existing.semantic_route <> p_semantic_route
      or v_existing.model <> v_execution_model
        or v_existing.provider <> v_execution_provider
      or v_existing.reasoning_effort <> p_reasoning_effort
      or v_existing.provider_response_id is distinct from nullif(btrim(p_provider_response_id), '')
      or v_existing.status <> p_status
      or v_existing.input_tokens <> p_input_tokens
      or v_existing.output_tokens <> p_output_tokens
      or v_existing.retry_reason is distinct from nullif(btrim(p_retry_reason), '')
      or v_existing.error_code is distinct from nullif(btrim(p_error_code), '')
      or v_existing.completed_at <> p_completed_at
      or v_existing.structured_output is distinct from p_structured_output then
      raise exception 'CAPTURED_PROVIDER_ATTEMPT_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'attempt_id', v_existing.id,
      'provider_attempt_number', v_existing.attempt_number,
      'provider_client_request_id', v_existing.id::text,
        'provider_execution', case when v_existing.provider = 'ollama' then v_route->'creditFallback' else null end,
      'operation_id', v_existing.operation_id,
      'operation_revision', v_operation.operation_revision,
      'idempotent_replay', true
    );
  end if;

  if v_existing.request_sha256 <> p_request_sha256
    or v_existing.started_at <> p_started_at
    or v_existing.semantic_route <> p_semantic_route
    or v_existing.model <> v_execution_model
        or v_existing.provider <> v_execution_provider
    or v_existing.reasoning_effort <> p_reasoning_effort
    or v_existing.retention_mode <> p_retention_mode then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_REPLAY_CONFLICT';
  end if;

  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if p_lease_token is null
    or v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;
  if (v_stage = 'generation' and v_operation.status <> 'generating')
    or (v_stage = 'review' and v_operation.status <> 'validating') then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_STATUS_INVALID:%', v_operation.status;
  end if;

  update private.captured_document_provider_attempts
  set provider_response_id = nullif(btrim(p_provider_response_id), ''),
      status = p_status,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      retry_reason = nullif(btrim(p_retry_reason), ''),
      error_code = nullif(btrim(p_error_code), ''),
      completed_at = p_completed_at,
      structured_output = p_structured_output
  where id = v_existing.id
  returning * into v_attempt;

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'provider_attempt_completed',
    jsonb_build_object(
      'logical_stage_key', v_attempt.logical_stage_key,
      'attempt_number', v_attempt.attempt_number,
      'semantic_route', v_attempt.semantic_route,
      'model', v_attempt.model,
      'status', v_attempt.status,
      'input_tokens', v_attempt.input_tokens,
      'output_tokens', v_attempt.output_tokens,
      'attempt_sha256', v_attempt.attempt_sha256
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'provider_attempt_number', v_attempt.attempt_number,
    'provider_client_request_id', v_attempt.id::text,
      'provider_execution', case when v_attempt.provider = 'ollama' then v_route->'creditFallback' else null end,
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'idempotent_replay', false
  );
end;
$function$;

create or replace function private.captured_execution_matches_route(
  p_attempt private.captured_document_provider_attempts, p_route jsonb
) returns boolean language sql stable set search_path = ''
as $function$
  select coalesce(
    (p_attempt.provider = 'openai' and p_attempt.model = p_route->>'model')
    or (p_attempt.provider = 'ollama' and p_attempt.attempt_number = 2
      and private.valid_ollama_credit_policy(p_route->'creditFallback')
      and p_attempt.model = p_route #>> '{creditFallback,model}'
      and p_route->'allowedTools' = '[]'::jsonb
      and exists (select 1 from private.captured_document_provider_attempts primary_attempt
        where primary_attempt.operation_id = p_attempt.operation_id
          and primary_attempt.user_id = p_attempt.user_id
          and primary_attempt.logical_stage_key = p_attempt.logical_stage_key
          and primary_attempt.request_sha256 = p_attempt.request_sha256
          and primary_attempt.attempt_number = 1 and primary_attempt.provider = 'openai'
          and primary_attempt.model = p_route->>'model' and primary_attempt.status = 'failed'
          and primary_attempt.error_code = 'OPENAI_CREDIT_EXHAUSTED'
          and primary_attempt.input_tokens = 0 and primary_attempt.output_tokens = 0)), false);
$function$;
revoke all on function private.captured_execution_matches_route(private.captured_document_provider_attempts, jsonb) from public, anon, authenticated, service_role;


create or replace function private.enforce_captured_exact_wording_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_generation private.document_generation_snapshots%rowtype;
  v_existing private.captured_document_revisions%rowtype;
  v_template jsonb;
  v_validation jsonb := new.validation_result;
  v_sections jsonb := new.snapshot->'sections';
  v_section jsonb;
  v_contract_section jsonb;
  v_result jsonb;
  v_assessment jsonb;
  v_reference jsonb;
  v_evidence jsonb;
  v_source jsonb;
  v_key text;
  v_hash text;
  v_index integer;
  v_count integer;
  v_final_sections jsonb := '[]'::jsonb;
  v_review_sections jsonb := '[]'::jsonb;
  v_workspace_sections jsonb := '[]'::jsonb;
  v_document_content text;
  v_attempt private.captured_document_provider_attempts%rowtype;
  v_stage text;
  v_route text;
  v_exact boolean;
begin
  select * into v_operation from private.captured_document_operations
  where id = new.operation_id and user_id = new.user_id;
  if not found then raise exception 'CAPTURED_OPERATION_DOCUMENT_MISMATCH'; end if;
  select contract_json->'templates'->v_operation.template_id into v_template
  from private.document_ledger_versions where ledger_version = v_operation.ledger_version;
  -- Preserve legacy revision writes under their original semantics. Only an
  -- explicit v2 identity/policy marker invokes the new strict resolver.
  if v_operation.pipeline_version <> 'captured-operation-pipeline.2'
    and v_operation.ledger_version <> 'ledger.2026-09-first-cohort.2'
    and new.ledger_version <> 'ledger.2026-09-first-cohort.2'
    and v_template #> '{validationPolicy,groundingReview}' is distinct from '"exact_wording_v2"'::jsonb then
    return new;
  end if;
  v_exact := private.captured_uses_exact_grounding(v_operation.ledger_version, v_operation.template_id);
  if not v_exact or v_operation.pipeline_version <> 'captured-operation-pipeline.2'
    or new.ledger_version is distinct from v_operation.ledger_version
    or new.document_id is distinct from v_operation.document_id then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;

  -- ON CONFLICT must never disguise a different assessment or revision reason.
  -- An exact existing snapshot remains replayable after operation advancement.
  select * into v_existing from private.captured_document_revisions
  where document_id = new.document_id and document_revision = new.document_revision;
  if found then
    if v_existing.operation_id is distinct from new.operation_id
      or v_existing.user_id is distinct from new.user_id
      or v_existing.ledger_version is distinct from new.ledger_version
      or v_existing.reason is distinct from new.reason
      or v_existing.actor_user_id is distinct from new.actor_user_id
      or v_existing.snapshot is distinct from new.snapshot
      or v_existing.snapshot_sha256 is distinct from new.snapshot_sha256
      or v_existing.validation_result is distinct from new.validation_result then
      raise exception 'CAPTURED_DOCUMENT_REVISION_CONFLICT:%:%', new.document_id, new.document_revision;
    end if;
    return new;
  end if;
  if new.reason <> 'generated' then return new; end if;

  select * into v_generation from private.document_generation_snapshots
  where id = v_operation.generation_snapshot_id and user_id = v_operation.user_id;
  if not found
    or v_generation.template_id is distinct from v_operation.template_id
    or v_generation.ledger_version is distinct from v_operation.ledger_version
    or v_generation.benchmark_version is distinct from v_operation.benchmark_version
    or v_generation.pipeline_version is distinct from v_operation.pipeline_version
    or v_operation.status is distinct from 'persisting'
    or new.document_revision is distinct from v_operation.accepted_document_revision + 1
    or new.actor_user_id is not null
    or new.snapshot_sha256 is distinct from encode(extensions.digest(
      convert_to(new.snapshot::text, 'UTF8'), 'sha256'), 'hex')
    or new.snapshot #> '{document,id}' is distinct from to_jsonb(v_operation.document_id)
    or new.snapshot #> '{document,outcome_id}' is distinct from to_jsonb(v_operation.outcome_id)
    or new.snapshot #> '{document,generation_snapshot_id}' is distinct from to_jsonb(v_generation.id)
    or new.snapshot #> '{document,current_revision}' is distinct from to_jsonb(new.document_revision)
    or new.snapshot #> '{document,approved_revision}' is distinct from 'null'::jsonb
    or new.snapshot #> '{document,ledger_version}' is distinct from to_jsonb(v_operation.ledger_version)
    or new.snapshot #> '{document,ledger_template_id}' is distinct from to_jsonb(v_operation.template_id)
    or jsonb_typeof(v_sections) is distinct from 'array'
    or jsonb_typeof(v_validation) is distinct from 'object' then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;
  if jsonb_typeof(v_template->'sections') is distinct from 'array'
    or jsonb_typeof(v_validation->'sections') is distinct from 'array'
    or v_validation - array['passed','validator_version','mandatory_checks_complete',
      'material_claim_grounding_checked','grounding_scope','identity','target_sha256','issues','sections']
      is distinct from '{}'::jsonb
    or v_validation->'passed' is distinct from 'true'::jsonb
    or v_validation->'mandatory_checks_complete' is distinct from 'true'::jsonb
    or v_validation->'material_claim_grounding_checked' is distinct from 'true'::jsonb
    or v_validation->'validator_version' is distinct from '"captured-output-validator.2"'::jsonb
    or v_validation->'grounding_scope' is distinct from '"exact_wording_review"'::jsonb
    or jsonb_typeof(v_validation->'target_sha256') is distinct from 'string'
    or (v_validation->>'target_sha256') !~ '^[0-9a-f]{64}$'
    or v_validation->'issues' is distinct from '[]'::jsonb
    or v_validation->'identity' is distinct from jsonb_build_object(
      'operation_id', v_operation.id, 'document_id', v_operation.document_id,
      'accepted_document_revision', v_operation.accepted_document_revision,
      'input_revision', v_operation.input_revision,
      'generation_snapshot_sha256', v_generation.snapshot_sha256,
      'ledger_version', v_operation.ledger_version, 'pipeline_version', v_operation.pipeline_version
    )
    or jsonb_typeof(v_generation.source_snapshot->'sources') is distinct from 'array'
    or jsonb_typeof(v_generation.evidence_snapshot->'permitted_source_ids') is distinct from 'array'
    or v_generation.evidence_snapshot->'material_claims_require_source_reference' is distinct from 'true'::jsonb then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;
  if jsonb_array_length(v_sections) <> jsonb_array_length(v_template->'sections')
    or jsonb_array_length(v_sections) <> jsonb_array_length(v_validation->'sections')
    or jsonb_array_length(v_sections) = 0
    or jsonb_array_length(v_sections) <> (select count(distinct section->'section_key') from jsonb_array_elements(v_sections) section)
    or jsonb_array_length(v_sections) <> (select count(distinct section->'id') from jsonb_array_elements(v_sections) section) then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;

  for v_contract_section, v_index in
    select section, (ordinal - 1)::integer
    from jsonb_array_elements(v_template->'sections') with ordinality a(section, ordinal)
  loop
    v_section := v_sections->v_index;
    v_result := v_validation->'sections'->v_index;
    v_assessment := v_result->'assessment';
    v_key := v_contract_section->>'sectionKey';
    v_hash := encode(extensions.digest(convert_to(v_section->>'content', 'UTF8'), 'sha256'), 'hex');
    if jsonb_typeof(v_section) is distinct from 'object'
      or jsonb_typeof(v_section->'content') is distinct from 'string'
      or length(v_section->>'content') > 40000
      or v_section->'section_key' is distinct from to_jsonb(v_key)
      or v_section->'name' is distinct from to_jsonb(coalesce(
        nullif(btrim(v_contract_section->>'name'), ''),
        nullif(btrim(v_contract_section->>'title'), ''), v_key))
      or v_section->'order_index' is distinct from to_jsonb(v_index)
      or v_section->'revision' is distinct from '1'::jsonb
      or v_section->'approved_revision' is distinct from 'null'::jsonb
      or v_section->'is_required' is distinct from v_contract_section->'required'
      or jsonb_typeof(v_section->'source_references') is distinct from 'array'
      or jsonb_typeof(v_result) is distinct from 'object'
      or v_result - array['section_key','content_sha256','state','source_references','assessment'] is distinct from '{}'::jsonb
      or v_result->'section_key' is distinct from v_section->'section_key'
      or v_result->'state' is distinct from v_section->'section_state'
      or v_result->'content_sha256' is distinct from to_jsonb(v_hash)
      or v_result->'source_references' is distinct from v_section->'source_references'
      or jsonb_typeof(v_assessment) is distinct from 'object'
      or v_assessment - array['section_key','content_sha256','checks','evidence','issues'] is distinct from '{}'::jsonb
      or v_assessment->'section_key' is distinct from v_section->'section_key'
      or v_assessment->'content_sha256' is distinct from to_jsonb(v_hash)
      or v_assessment->'checks' is distinct from '{"material_claim_support":"pass", "semantic_requirements":"pass",
        "critical_details":"pass", "source_conflicts":"pass", "no_padding_or_repetition":"pass", "no_benchmark_copying":"pass"}'::jsonb
      or v_assessment->'issues' is distinct from '[]'::jsonb
      or jsonb_typeof(v_assessment->'evidence') is distinct from 'array'
      or v_key = any(v_operation.blocked_section_keys) then
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;
    if jsonb_array_length(v_section->'source_references') > 32
      or jsonb_array_length(v_assessment->'evidence') > 64
      or (select count(*) from jsonb_array_elements(v_section->'source_references')) <>
        (select count(distinct ref) from jsonb_array_elements(v_section->'source_references') ref) then
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;

    if v_section->>'section_state' = 'final' then
      if not private.captured_content_is_visible(v_section->>'content')
        or jsonb_array_length(v_section->'source_references') = 0 then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
      for v_reference in select value from jsonb_array_elements(v_section->'source_references') loop
        if jsonb_typeof(v_reference) is distinct from 'string'
          or length(v_reference #>> '{}') not between 7 and 160
          or left(v_reference #>> '{}', 6) <> 'input:'
          or not coalesce(v_contract_section->'dependsOnInputs' @>
            jsonb_build_array(substring(v_reference #>> '{}' from 7)), false)
          or not coalesce(v_generation.evidence_snapshot->'permitted_source_ids' @> jsonb_build_array(v_reference), false)
          or v_generation.confirmations->substring(v_reference #>> '{}' from 7)->'confirmed' is distinct from 'true'::jsonb
          or v_generation.confirmations->substring(v_reference #>> '{}' from 7)->'source_id' is distinct from v_reference
          or substring(v_reference #>> '{}' from 7) = any(v_generation.unresolved_input_keys) then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
        select count(*) into v_count from jsonb_array_elements(v_generation.source_snapshot->'sources') source
        where source->'id' = v_reference;
        if v_count <> 1 then raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED'; end if;
        select source into v_source from jsonb_array_elements(v_generation.source_snapshot->'sources') source
        where source->'id' = v_reference;
        if v_source->'input_key' is distinct from to_jsonb(substring(v_reference #>> '{}' from 7))
          or v_source->'source_type' is distinct from '"confirmed_request_input"'::jsonb
          or v_source->'value' is distinct from v_generation.input_values->substring(v_reference #>> '{}' from 7)
          or not private.captured_grounding_has_value(v_source->'value')
          or not exists (select 1 from jsonb_array_elements(v_assessment->'evidence') item
            where item->'source_id' = v_reference) then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
      end loop;
      for v_evidence in select value from jsonb_array_elements(v_assessment->'evidence') loop
        if jsonb_typeof(v_evidence) is distinct from 'object'
          or v_evidence - array['source_id','quote'] is distinct from '{}'::jsonb
          or jsonb_typeof(v_evidence->'source_id') is distinct from 'string'
          or jsonb_typeof(v_evidence->'quote') is distinct from 'string'
          or not coalesce(v_section->'source_references' @> jsonb_build_array(v_evidence->'source_id'), false) then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
        select source into v_source from jsonb_array_elements(v_generation.source_snapshot->'sources') source
        where source->'id' = v_evidence->'source_id';
        if not private.captured_grounding_quote_matches(v_source->'value', v_evidence->>'quote') then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
      end loop;
    elsif v_section->>'section_state' = 'omitted_optional' then
      if v_contract_section->'required' is distinct from 'false'::jsonb
        or v_contract_section->>'missingInformationBehaviour' is distinct from 'omitIfOptional'
        or v_section->'content' is distinct from '""'::jsonb
        or v_section->'source_references' is distinct from '[]'::jsonb
        or v_assessment->'evidence' is distinct from '[]'::jsonb then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
    elsif v_section->>'section_state' = 'neutral_fallback' then
      if v_contract_section->>'missingInformationBehaviour' is distinct from 'useNeutralFallback'
        or v_contract_section #>> '{neutralFallback,comparison}' is distinct from 'exact_utf8'
        or v_section->'content' is distinct from v_contract_section #> '{neutralFallback,content}'
        or v_section->'source_references' is distinct from '["system:neutral-fallback"]'::jsonb
        or v_assessment->'evidence' is distinct from '[]'::jsonb
        or jsonb_typeof(v_contract_section #> '{neutralFallback,whenInputsAbsent}') is distinct from 'array' then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
      if exists (select 1 from jsonb_array_elements_text(v_contract_section #> '{neutralFallback,whenInputsAbsent}') key
        where private.captured_grounding_has_value(v_generation.input_values->key)) then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
    else
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;
    v_final_sections := v_final_sections || jsonb_build_array(jsonb_build_object(
      'section_key', v_section->'section_key', 'content', v_section->'content',
      'state', v_section->'section_state', 'source_references', v_section->'source_references'));
    v_workspace_sections := v_workspace_sections || jsonb_build_array(jsonb_build_object(
      'section_key', v_section->'section_key', 'name', v_section->'name', 'order_index', v_section->'order_index',
      'content', v_section->'content', 'state', v_section->'section_state',
      'is_required', v_section->'is_required', 'source_references', v_section->'source_references'));
    v_review_sections := v_review_sections || jsonb_build_array(v_assessment);
  end loop;
  select coalesce(string_agg(section->>'content', E'\n\n' order by ordinal), '') into v_document_content
  from jsonb_array_elements(v_final_sections) with ordinality a(section, ordinal)
  where section->>'state' <> 'omitted_optional';
  if new.snapshot #> '{document,content}' is distinct from to_jsonb(v_document_content)
    or new.snapshot #> '{document,workspace_sections}' is distinct from v_workspace_sections
    or new.snapshot #> '{document,unresolved_placeholders}' is distinct from '[]'::jsonb then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;

  foreach v_stage in array array['generation', 'review'] loop
    v_route := case v_stage when 'generation' then 'deep' else 'review' end;
    select count(*) into v_count from private.captured_document_provider_attempts
    where operation_id = v_operation.id and user_id = v_operation.user_id
      and logical_stage_key = v_stage and status = 'succeeded';
    if v_count <> 1 then raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED'; end if;
    select * into v_attempt from private.captured_document_provider_attempts
    where operation_id = v_operation.id and user_id = v_operation.user_id
      and logical_stage_key = v_stage and status = 'succeeded';
    if not private.captured_execution_matches_route(v_attempt, v_operation.route_snapshot #> array['routes',v_route])
      or v_attempt.semantic_route is distinct from v_route
      or v_attempt.retention_mode is distinct from 'store_false'
      or v_attempt.completed_at is null or nullif(btrim(v_attempt.provider_response_id), '') is null
      or v_attempt.reasoning_effort is distinct from v_operation.route_snapshot #>> array['routes',v_route,'reasoningEffort']
      or v_operation.route_snapshot #>> array['routes',v_route,'structuredOutputSchemaVersion'] is distinct from
        v_operation.template_id || (case v_stage when 'generation' then '.captured-output.2' else '.captured-grounding.2' end)
      or v_attempt.structured_output is distinct from (case v_stage
        when 'generation' then jsonb_build_object('sections', v_final_sections)
        else jsonb_build_object('target_sha256', v_validation->'target_sha256', 'sections', v_review_sections)
      end) then
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;
  end loop;
  return new;
end;
$function$;

create or replace function public.finalize_captured_document_operation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_token uuid,
  p_sections jsonb,
  p_validation_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_contract jsonb;
  v_ledger_section jsonb;
  v_input_section jsonb;
  v_normalized_sections jsonb := '[]'::jsonb;
  v_section_key text;
  v_section_name text;
  v_section_content text;
  v_section_state text;
  v_source_references jsonb;
  v_is_required boolean;
  v_order_index integer;
  v_document_content text;
  v_unresolved jsonb;
  v_finalization_payload jsonb;
  v_finalization_hash text;
  v_write_token uuid;
  v_revision private.captured_document_revisions%rowtype;
  v_usage_ledger_id uuid;
  v_business_id uuid;
  v_allowance private.captured_document_allowances%rowtype;
begin
  if jsonb_typeof(p_sections) is distinct from 'array' then
    raise exception 'CAPTURED_SECTIONS_MUST_BE_ARRAY';
  end if;
  if jsonb_typeof(p_validation_result) <> 'object'
    or coalesce((p_validation_result->>'passed')::boolean, false) is not true then
    raise exception 'CAPTURED_FINALIZATION_VALIDATION_REQUIRED';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = v_operation.ledger_version;
  if not found
    or jsonb_typeof(
      v_contract->'templates'->v_operation.template_id->'sections'
    ) <> 'array' then
    raise exception 'CAPTURED_OPERATION_LEDGER_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sections) input_section
    where jsonb_typeof(input_section) <> 'object'
      or nullif(btrim(input_section->>'section_key'), '') is null
  ) then
    raise exception 'CAPTURED_SECTION_OUTPUT_INVALID';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(p_sections)
  ) <> (
    select count(distinct btrim(input_section->>'section_key'))
    from jsonb_array_elements(p_sections) input_section
  ) then
    raise exception 'CAPTURED_SECTION_KEY_DUPLICATE';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sections) input_section
    where not exists (
      select 1
      from jsonb_array_elements(
        v_contract->'templates'->v_operation.template_id->'sections'
      ) ledger_section
      where coalesce(
        ledger_section->>'sectionKey', ledger_section->>'key'
      ) = btrim(input_section->>'section_key')
    )
  ) then
    raise exception 'CAPTURED_SECTION_KEY_UNKNOWN';
  end if;

  for v_ledger_section, v_order_index in
    select ledger_section, (section_ordinal - 1)::integer
    from jsonb_array_elements(
      v_contract->'templates'->v_operation.template_id->'sections'
    ) with ordinality ordered_section(ledger_section, section_ordinal)
  loop
    v_section_key := coalesce(
      v_ledger_section->>'sectionKey', v_ledger_section->>'key'
    );
    if nullif(btrim(v_section_key), '') is null then
      raise exception 'CAPTURED_LEDGER_SECTION_KEY_INVALID';
    end if;
    begin
      v_is_required := coalesce(
        (v_ledger_section->>'required')::boolean,
        (v_ledger_section->>'is_required')::boolean,
        true
      );
    exception when invalid_text_representation then
      raise exception 'CAPTURED_LEDGER_REQUIREDNESS_INVALID:%', v_section_key;
    end;
    v_section_name := coalesce(
      nullif(btrim(v_ledger_section->>'name'), ''),
      nullif(btrim(v_ledger_section->>'title'), ''),
      v_section_key
    );

    v_input_section := null;
    select input_section into v_input_section
    from jsonb_array_elements(p_sections) input_section
    where btrim(input_section->>'section_key') = v_section_key;

    if v_input_section is null then
      if v_is_required then
        raise exception 'CAPTURED_REQUIRED_SECTION_MISSING:%', v_section_key;
      end if;
      v_section_content := '';
      v_section_state := 'omitted_optional';
      v_source_references := '[]'::jsonb;
    else
      v_section_content := coalesce(v_input_section->>'content', '');
      v_section_state := v_input_section->>'state';
      v_source_references := coalesce(
        v_input_section->'source_references', '[]'::jsonb
      );
      if v_input_section ? 'is_required'
        and (v_input_section->>'is_required')::boolean is distinct from v_is_required then
        raise exception 'CAPTURED_SECTION_REQUIREDNESS_MISMATCH:%', v_section_key;
      end if;
      if v_section_state not in (
        'final', 'interactive_placeholder', 'neutral_fallback', 'omitted_optional'
      ) then
        raise exception 'CAPTURED_SECTION_NOT_READY_FOR_REVIEW:%:%',
          v_section_key, coalesce(v_section_state, 'null');
      end if;
      if v_is_required and v_section_state = 'omitted_optional' then
        raise exception 'CAPTURED_REQUIRED_SECTION_CANNOT_BE_OMITTED:%', v_section_key;
      end if;
      if v_section_state = 'omitted_optional' then
        v_section_content := '';
        v_source_references := '[]'::jsonb;
      elsif not private.captured_content_is_visible(v_section_content) then
        raise exception 'CAPTURED_VISIBLE_SECTION_CONTENT_REQUIRED:%', v_section_key;
      end if;
      if jsonb_typeof(v_source_references) <> 'array'
        or octet_length(v_source_references::text) > 131072 then
        raise exception 'CAPTURED_SECTION_SOURCE_REFERENCES_INVALID:%', v_section_key;
      end if;
    end if;

    v_normalized_sections := v_normalized_sections || jsonb_build_array(
      jsonb_build_object(
        'section_key', v_section_key,
        'name', v_section_name,
        'order_index', v_order_index,
        'content', v_section_content,
        'state', v_section_state,
        'is_required', v_is_required,
        'source_references', v_source_references
      )
    );
  end loop;

  select coalesce(
    pg_catalog.string_agg(
      nullif(input_section->>'content', ''),
      E'\n\n' order by (input_section->>'order_index')::integer
    ),
    ''
  ) into v_document_content
  from jsonb_array_elements(v_normalized_sections) input_section
  where input_section->>'state' <> 'omitted_optional';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'section_key', input_section->>'section_key',
        'state', input_section->>'state'
      ) order by (input_section->>'order_index')::integer
    ),
    '[]'::jsonb
  ) into v_unresolved
  from jsonb_array_elements(v_normalized_sections) input_section
  where input_section->>'state' = 'interactive_placeholder';

  v_finalization_payload := jsonb_build_object(
    'operationId', v_operation.id,
    'acceptedDocumentRevision', v_operation.accepted_document_revision,
    'ledgerVersion', v_operation.ledger_version,
    'templateId', v_operation.template_id,
    'sections', v_normalized_sections,
    'validationResult', p_validation_result
  );
  v_finalization_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(v_finalization_payload::text, 'UTF8'), 'sha256'
    ),
    'hex'
  );

  if v_operation.status = 'ready_for_review' then
    if v_operation.finalization_sha256 <> v_finalization_hash then
      raise exception 'CAPTURED_FINALIZATION_REPLAY_CONFLICT';
    end if;
    select * into v_allowance
    from private.captured_document_allowances
    where operation_id = v_operation.id;
    if not found then
      raise exception 'CAPTURED_FINALIZATION_ALLOWANCE_MISSING';
    end if;
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'document_id', v_operation.document_id,
      'provider_finalized_revision', v_operation.provider_finalized_revision,
      'latest_document_revision', v_operation.latest_document_revision,
      'status', v_operation.status,
      'allowance_id', v_allowance.id,
      'idempotent_replay', true
    );
  end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'persisting' then
    raise exception 'CAPTURED_FINALIZATION_STATUS_INVALID:%', v_operation.status;
  end if;
  if p_lease_token is null
    or v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;
  if not exists (
    select 1
    from private.captured_document_provider_attempts provider_attempt
    where provider_attempt.operation_id = v_operation.id
      and provider_attempt.user_id = v_operation.user_id
      and private.captured_execution_matches_route(provider_attempt, v_operation.route_snapshot->'routes'->provider_attempt.semantic_route)
      and provider_attempt.status = 'succeeded'
  ) then
    raise exception 'CAPTURED_PROVIDER_SUCCESS_REQUIRED';
  end if;

  select * into v_document
  from public.documents
  where id = v_operation.document_id and user_id = v_operation.user_id
  for update;
  if not found or v_document.ledger_binding_status <> 'captured' then
    raise exception 'CAPTURED_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.current_revision <> v_operation.accepted_document_revision
    or v_document.approved_revision is not null
    or exists (
      select 1 from public.sections
      where document_id = v_document.id and user_id = v_document.user_id
    ) then
    raise exception 'STALE_CAPTURED_DOCUMENT_FINALIZATION';
  end if;

  v_write_token := private.begin_captured_document_write(
    'finalize_document', v_document.id, v_operation.id
  );
  insert into public.sections(
    document_id, user_id, name, order_index, content, status,
    version_history, is_required, ledger_binding_status, section_key,
    ledger_version, revision, approved_revision, section_state,
    source_references
  )
  select
    v_document.id,
    v_document.user_id,
    input_section->>'name',
    (input_section->>'order_index')::integer,
    input_section->>'content',
    'draft',
    '[]'::jsonb,
    (input_section->>'is_required')::boolean,
    'captured',
    input_section->>'section_key',
    v_operation.ledger_version,
    1,
    null,
    input_section->>'state',
    input_section->'source_references'
  from jsonb_array_elements(v_normalized_sections) input_section;

  update public.documents
  set content = v_document_content,
      workspace_sections = v_normalized_sections,
      unresolved_placeholders = v_unresolved,
      status = 'edited',
      approved_revision = null,
      current_revision = current_revision + 1,
      updated_at = clock_timestamp()
  where id = v_document.id
  returning * into v_document;
  perform private.end_captured_document_write(v_write_token);

  v_revision := private.capture_captured_document_revision(
    v_operation.id,
    v_document.id,
    'generated',
    p_validation_result,
    null
  );

  select outcome_record.business_id into v_business_id
  from public.outcomes outcome_record
  where outcome_record.id = v_operation.outcome_id
    and outcome_record.user_id = v_operation.user_id;

  insert into public.usage_ledger(
    user_id, business_id, event_type, generation_request_id, task, provider
  ) values (
    v_operation.user_id,
    v_business_id,
    'document_created',
    'captured-operation:' || v_operation.id::text,
    'captured_document_generation',
    null
  )
  on conflict on constraint usage_ledger_model_call_dedupe do nothing
  returning id into v_usage_ledger_id;

  if v_usage_ledger_id is null then
    select id into v_usage_ledger_id
    from public.usage_ledger
    where user_id = v_operation.user_id
      and generation_request_id = 'captured-operation:' || v_operation.id::text
      and event_type = 'document_created';
  end if;
  if v_usage_ledger_id is null then
    raise exception 'CAPTURED_ALLOWANCE_USAGE_WRITE_FAILED';
  end if;

  insert into private.captured_document_allowances(
    operation_id, document_id, user_id, document_revision, usage_ledger_id
  ) values (
    v_operation.id, v_document.id, v_document.user_id,
    v_document.current_revision, v_usage_ledger_id
  )
  on conflict (operation_id) do nothing
  returning * into v_allowance;
  if v_allowance.id is null then
    select * into v_allowance
    from private.captured_document_allowances
    where operation_id = v_operation.id;
    if v_allowance.document_revision <> v_document.current_revision
      or v_allowance.usage_ledger_id <> v_usage_ledger_id then
      raise exception 'CAPTURED_ALLOWANCE_CONFLICT';
    end if;
  end if;

  update private.captured_document_operations
  set status = 'ready_for_review',
      operation_revision = operation_revision + 1,
      retryable = false,
      error_code = null,
      public_error_message = null,
      safe_next_action = null,
      provider_finalized_revision = v_document.current_revision,
      latest_document_revision = v_document.current_revision,
      finalization_sha256 = v_finalization_hash,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'operation_finalized',
    jsonb_build_object(
      'document_id', v_document.id,
      'document_revision', v_document.current_revision,
      'revision_sha256', v_revision.snapshot_sha256,
      'allowance_id', v_allowance.id,
      'validation_passed', true
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'document_id', v_operation.document_id,
    'provider_finalized_revision', v_operation.provider_finalized_revision,
    'latest_document_revision', v_operation.latest_document_revision,
    'status', v_operation.status,
    'allowance_id', v_allowance.id,
    'idempotent_replay', false
  );
end;
$function$;

create or replace function public.configure_captured_document_activation(
  p_environment text,
  p_user_cohort text,
  p_workflow text,
  p_template_id text,
  p_ledger_version text,
  p_routing_version text,
  p_route_snapshot jsonb,
  p_enabled boolean,
  p_expected_revision integer,
  p_changed_by text,
  p_change_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_user_cohort text := lower(btrim(p_user_cohort));
  v_workflow text := lower(btrim(p_workflow));
  v_template_id text := lower(btrim(p_template_id));
  v_routing_version text := btrim(p_routing_version);
  v_scope_key text;
  v_contract jsonb;
  v_exact_grounding boolean;
  v_existing private.document_ledger_activation_pointers%rowtype;
  v_revision integer;
begin
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_user_cohort !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_ACTIVATION_SCOPE';
  end if;
  if v_template_id not in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  ) then
    raise exception 'TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%', v_template_id;
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'INVALID_ACTIVATION_EXPECTED_REVISION';
  end if;
  if nullif(v_routing_version, '') is null
    or nullif(btrim(p_changed_by), '') is null
    or nullif(btrim(p_change_reason), '') is null then
    raise exception 'CAPTURED_ACTIVATION_VERSION_AND_ACTOR_REQUIRED';
  end if;
  if jsonb_typeof(p_route_snapshot) is distinct from 'object'
    or p_route_snapshot->>'provider' is distinct from 'openai'
    or p_route_snapshot->>'routingVersion' is distinct from v_routing_version
    or jsonb_typeof(p_route_snapshot->'routes') is distinct from 'object'
    or not coalesce(p_route_snapshot->'routes' ? 'deep', false)
    or not coalesce(p_route_snapshot->'routes' ? 'review', false) then
    raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
  end if;
  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = p_ledger_version;
  if not found then raise exception 'UNKNOWN_LEDGER_VERSION:%', p_ledger_version; end if;
  if not (v_contract->'templates' ? v_template_id) then
    raise exception 'UNKNOWN_LEDGER_TEMPLATE:%:%', p_ledger_version, v_template_id;
  end if;

  v_exact_grounding := private.captured_uses_exact_grounding(p_ledger_version, v_template_id);

  if exists (
    select 1
    from jsonb_each(p_route_snapshot->'routes') route_entry
    where jsonb_typeof(route_entry.value) is distinct from 'object'
      or route_entry.value->>'provider' is distinct from 'openai'
      or route_entry.key not in ('fast', 'deep', 'research', 'review')
      or (route_entry.value ? 'creditFallback' and (
        v_environment not in ('local','test')
        or not private.valid_ollama_credit_policy(route_entry.value->'creditFallback')
        or route_entry.value->'allowedTools' is distinct from '[]'::jsonb
        or route_entry.value->>'maxAttempts' is distinct from '2'
      ))
      or route_entry.value->>'semanticRoute' is distinct from route_entry.key
      or nullif(btrim(route_entry.value->>'model'), '') is null
      or route_entry.value->>'reasoningEffort' is distinct from case route_entry.key
        when 'fast' then 'low'
        when 'review' then 'high'
        else 'medium'
      end
      or route_entry.value->>'routingVersion' is distinct from v_routing_version
      or route_entry.value->>'structuredOutputSchemaVersion'
        is distinct from case
          when v_exact_grounding and route_entry.key = 'review'
            then v_template_id || '.captured-grounding.2'
          when v_exact_grounding then v_template_id || '.captured-output.2'
          else v_template_id || '.captured-output.1'
        end
      or jsonb_typeof(route_entry.value->'allowedTools') is distinct from 'array'
      or (
        route_entry.key in ('deep', 'review')
        and route_entry.value->'allowedTools' is distinct from '[]'::jsonb
      )
      or case
        when coalesce(route_entry.value->>'timeoutMs', '') ~ '^[0-9]+$'
          then (route_entry.value->>'timeoutMs')::integer not between 1000 and 600000
        else true
      end
      or route_entry.value->>'maxAttempts' not in ('1', '2')
      or route_entry.value->'background' is distinct from 'false'::jsonb
      or route_entry.value->'store' is distinct from 'false'::jsonb
      or (
        route_entry.key <> 'fast'
        and route_entry.value->'fallback' is distinct from 'null'::jsonb
      )
  ) then
    raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
  end if;

  v_scope_key := v_environment || ':' || v_user_cohort || ':' || v_workflow || ':' || v_template_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('captured-activation:' || v_scope_key, 0)
  );

  select * into v_existing
  from private.document_ledger_activation_pointers
  where scope_key = v_scope_key
  for update;

  if found then
    if v_existing.environment = v_environment
      and v_existing.user_cohort = v_user_cohort
      and v_existing.workflow = v_workflow
      and v_existing.template_id = v_template_id
      and v_existing.ledger_version = p_ledger_version
      and v_existing.routing_version = v_routing_version
      and v_existing.route_snapshot = p_route_snapshot
      and v_existing.enabled = p_enabled then
      return jsonb_build_object(
        'scope_key', v_scope_key,
        'revision', v_existing.revision,
        'enabled', v_existing.enabled,
        'idempotent_replay', true
      );
    end if;
    if v_existing.revision <> p_expected_revision then
      raise exception 'STALE_ACTIVATION_POINTER:expected:%:actual:%',
        p_expected_revision, v_existing.revision;
    end if;
    v_revision := v_existing.revision + 1;
    update private.document_ledger_activation_pointers
    set environment = v_environment,
        user_cohort = v_user_cohort,
        workflow = v_workflow,
        template_id = v_template_id,
        ledger_version = p_ledger_version,
        routing_version = v_routing_version,
        route_snapshot = p_route_snapshot,
        enabled = p_enabled,
        revision = v_revision,
        activated_at = case when p_enabled then now() else null end,
        activated_by = case when p_enabled then btrim(p_changed_by) else null end,
        disabled_at = case when p_enabled then null else now() end,
        disabled_by = case when p_enabled then null else btrim(p_changed_by) end,
        updated_at = now()
    where scope_key = v_scope_key;
  else
    if p_expected_revision <> 0 then
      raise exception 'STALE_ACTIVATION_POINTER:expected:%:actual:0', p_expected_revision;
    end if;
    v_revision := 1;
    insert into private.document_ledger_activation_pointers(
      scope_key, ledger_version, enabled, revision, activated_at, activated_by,
      updated_at, environment, user_cohort, workflow, template_id,
      routing_version, route_snapshot, disabled_at, disabled_by
    ) values (
      v_scope_key, p_ledger_version, p_enabled, v_revision,
      case when p_enabled then now() else null end,
      case when p_enabled then btrim(p_changed_by) else null end,
      now(), v_environment, v_user_cohort, v_workflow, v_template_id,
      v_routing_version, p_route_snapshot,
      case when p_enabled then null else now() end,
      case when p_enabled then null else btrim(p_changed_by) end
    );
  end if;

  insert into private.captured_document_activation_revisions(
    scope_key, revision, environment, user_cohort, workflow, template_id,
    ledger_version, routing_version, route_snapshot, enabled,
    changed_by, change_reason
  ) values (
    v_scope_key, v_revision, v_environment, v_user_cohort, v_workflow,
    v_template_id, p_ledger_version, v_routing_version, p_route_snapshot,
    p_enabled, btrim(p_changed_by), btrim(p_change_reason)
  );

  return jsonb_build_object(
    'scope_key', v_scope_key,
    'revision', v_revision,
    'enabled', p_enabled,
    'idempotent_replay', false
  );
end;
$function$;

-- Document allowance events summarise executed providers from the existing
-- per-attempt ledger. Zero-token primary credit rejection is not OpenAI work.
create or replace function private.legacy_allowance_execution_provider(
  p_user_id uuid, p_scope text, p_request_id text, p_default text
) returns text language sql stable set search_path = '' as $function$
  select case when bool_or(provider = 'ollama') then
    case when bool_or(provider = 'openai') then 'openai+ollama' else 'ollama' end
    else p_default end
  from public.usage_ledger
  where user_id = p_user_id and checkpoint_scope = p_scope
    and logical_request_id = p_request_id and event_type = 'model_call'
    and model_call_key is not null
    and (model_call_status = 'succeeded' or input_tokens > 0 or output_tokens > 0);
$function$;
revoke all on function private.legacy_allowance_execution_provider(uuid,text,text,text)
  from public, anon, authenticated, service_role;


create or replace function public.settle_document_allowance(
  p_user_id uuid,
  p_reservation_id uuid,
  p_request_id text,
  p_task text,
  p_provider text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_accounting_provider text;
  v_now timestamptz := clock_timestamp();
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_usage_id uuid;
begin
  if p_user_id is null or p_reservation_id is null
    or p_request_id is null
    or p_task is null or p_task !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    or p_provider is null or p_provider not in ('openai','ollama')
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0 then
    raise exception 'ALLOWANCE_SETTLEMENT_INPUT_INVALID';
  end if;

  select reservation_record.billing_period_start into v_period_start
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;

  perform private.document_allowance_lock(p_user_id, v_period_start);
  select * into v_reservation
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id
  for update;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;
  v_accounting_provider := private.legacy_allowance_execution_provider(
    p_user_id, v_reservation.route_key, p_request_id, p_provider);

  if v_reservation.status = 'settled' then
    return jsonb_build_object(
      'reservation_id', v_reservation.id,
      'state', 'settled',
      'usage_ledger_id', v_reservation.usage_ledger_id,
      'idempotent_replay', true
    );
  end if;
  if v_reservation.status <> 'reserved' then
    raise exception 'ALLOWANCE_RESERVATION_NOT_SETTLEABLE:%', v_reservation.status;
  end if;
  if v_reservation.expires_at <= v_now then
    raise exception 'ALLOWANCE_RESERVATION_EXPIRED';
  end if;

  insert into public.usage_ledger(
    user_id, event_type, generation_request_id, task, provider,
    input_tokens, output_tokens, created_at
  ) values (
    p_user_id, 'document_created', p_request_id, p_task, v_accounting_provider,
    p_input_tokens, p_output_tokens, v_now
  )
  on conflict on constraint usage_ledger_model_call_dedupe do nothing
  returning id into v_usage_id;

  if v_usage_id is null then
    select usage_record.id into v_usage_id
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.generation_request_id = p_request_id
      and usage_record.event_type = 'document_created';
  end if;
  if v_usage_id is null then raise exception 'ALLOWANCE_USAGE_WRITE_FAILED'; end if;

  update private.document_allowance_reservations
  set status = 'settled',
      usage_ledger_id = v_usage_id,
      settled_at = v_now,
      updated_at = v_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'state', 'settled',
    'usage_ledger_id', v_reservation.usage_ledger_id,
    'idempotent_replay', false
  );
end;
$function$;

create or replace function public.settle_document_allowance_with_result(
  p_user_id uuid,
  p_reservation_id uuid,
  p_request_id text,
  p_task text,
  p_provider text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_response_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_accounting_provider text;
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_existing private.document_allowance_results%rowtype;
  v_response_sha256 text;
  v_settlement jsonb;
  v_usage public.usage_ledger%rowtype;
begin
  if p_user_id is null or p_reservation_id is null or p_request_id is null
    or p_task is null or p_task !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    or p_provider is null or p_provider not in ('openai','ollama')
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0
    or pg_catalog.jsonb_typeof(p_response_payload) is distinct from 'object'
    or p_response_payload->>'contract_version' is distinct from 'allowance-result.1'
    or p_response_payload->>'transport' is null
    or p_response_payload->>'transport' not in ('json', 'sse')
    or pg_catalog.jsonb_typeof(p_response_payload->'payload') is distinct from 'object'
    or p_response_payload - array[
      'contract_version', 'route_key', 'transport', 'payload'
    ] <> '{}'::jsonb
    or pg_catalog.octet_length(p_response_payload::text) > 8388608
    or pg_catalog.octet_length((p_response_payload->'payload')::text) > 8380000 then
    raise exception 'ALLOWANCE_RESULT_INVALID';
  end if;

  select reservation_record.billing_period_start into v_period_start
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;

  perform private.document_allowance_lock(p_user_id, v_period_start);
  select * into v_reservation
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id
  for update;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;
  v_accounting_provider := private.legacy_allowance_execution_provider(
    p_user_id, v_reservation.route_key, p_request_id, p_provider);
  if p_response_payload->>'route_key' is distinct from v_reservation.route_key then
    raise exception 'ALLOWANCE_RESULT_ROUTE_CONFLICT';
  end if;

  v_response_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_response_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select * into v_existing
  from private.document_allowance_results result_record
  where result_record.reservation_id = p_reservation_id;
  if found then
    if v_existing.response_sha256 <> v_response_sha256
      or v_existing.response_payload <> p_response_payload then
      raise exception 'ALLOWANCE_RESULT_REPLAY_CONFLICT';
    end if;
    if v_reservation.status <> 'settled' then
      raise exception 'ALLOWANCE_RESULT_WITHOUT_SETTLEMENT';
    end if;
    select * into v_usage
    from public.usage_ledger usage_record
    where usage_record.id = v_reservation.usage_ledger_id
      and usage_record.user_id = p_user_id;
    if not found
      or v_usage.task is distinct from p_task
      or v_usage.provider is distinct from v_accounting_provider
      or v_usage.input_tokens is distinct from p_input_tokens
      or v_usage.output_tokens is distinct from p_output_tokens then
      raise exception 'ALLOWANCE_SETTLEMENT_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservation_id', v_reservation.id,
      'state', 'settled',
      'usage_ledger_id', v_reservation.usage_ledger_id,
      'idempotent_replay', true,
      'replay_result', v_existing.response_payload,
      'response_sha256', v_existing.response_sha256
    );
  end if;
  if v_reservation.status = 'settled' then
    raise exception 'ALLOWANCE_RESULT_MISSING_FOR_SETTLED';
  end if;

  v_settlement := public.settle_document_allowance(
    p_user_id,
    p_reservation_id,
    p_request_id,
    p_task,
    p_provider,
    p_input_tokens,
    p_output_tokens
  );

  select * into v_usage
  from public.usage_ledger usage_record
  where usage_record.id = (v_settlement->>'usage_ledger_id')::uuid
    and usage_record.user_id = p_user_id;
  if not found
    or v_usage.task is distinct from p_task
    or v_usage.provider is distinct from v_accounting_provider
    or v_usage.input_tokens is distinct from p_input_tokens
    or v_usage.output_tokens is distinct from p_output_tokens then
    raise exception 'ALLOWANCE_SETTLEMENT_REPLAY_CONFLICT';
  end if;

  insert into private.document_allowance_results(
    reservation_id,
    user_id,
    request_id,
    route_key,
    response_sha256,
    response_payload
  ) values (
    p_reservation_id,
    p_user_id,
    p_request_id,
    v_reservation.route_key,
    v_response_sha256,
    p_response_payload
  );

  return v_settlement || pg_catalog.jsonb_build_object(
    'replay_result', p_response_payload,
    'response_sha256', v_response_sha256
  );
end;
$function$;

commit;
