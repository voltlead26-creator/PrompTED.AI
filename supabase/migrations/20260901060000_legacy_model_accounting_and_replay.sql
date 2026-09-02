-- Durable accounting for non-captured OpenAI attempts and replayable results
-- for the legacy allowance routes. Captured operations retain their existing
-- provider-attempt and allowance authorities.

begin;

alter table public.usage_ledger
  add column if not exists model_call_key text,
  add column if not exists logical_request_id text,
  add column if not exists checkpoint_scope text,
  add column if not exists logical_stage_key text,
  add column if not exists provider_request_sha256 text,
  add column if not exists provider_attempt_id text,
  add column if not exists provider_response_id text,
  add column if not exists provider_status text,
  add column if not exists provider_error_code text,
  add column if not exists model_call_status text,
  add column if not exists provider_attempt_number integer,
  add column if not exists provider_started_at timestamptz,
  add column if not exists provider_completed_at timestamptz,
  add column if not exists model text,
  add column if not exists routing_version text,
  add column if not exists semantic_route text,
  add column if not exists reasoning_effort text;

alter table public.usage_ledger
  add constraint usage_ledger_user_model_call_key_unique
  unique (user_id, model_call_key);

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
      and provider = 'openai'
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
          and provider_error_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
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

alter table private.document_allowance_reservations
  add constraint document_allowance_reservations_id_user_unique
  unique (id, user_id);

create table private.legacy_model_call_results (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkpoint_scope text not null
    check (checkpoint_scope ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  logical_request_id text not null
    check (logical_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  logical_stage_key text not null
    check (logical_stage_key ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  usage_ledger_id uuid not null unique,
  origin_reservation_id uuid,
  result_version text not null check (result_version = 'legacy-provider-result.1'),
  response_sha256 text not null check (response_sha256 ~ '^[0-9a-f]{64}$'),
  response_envelope jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id, checkpoint_scope, logical_request_id, logical_stage_key),
  foreign key (usage_ledger_id, user_id)
    references public.usage_ledger(id, user_id) on delete cascade,
  foreign key (origin_reservation_id, user_id)
    references private.document_allowance_reservations(id, user_id)
    on delete cascade,
  check (
    (checkpoint_scope in ('generate-document', 'generate-checklist')
      and origin_reservation_id is not null)
    or
    (checkpoint_scope not in ('generate-document', 'generate-checklist')
      and origin_reservation_id is null)
  ),
  check (pg_catalog.jsonb_typeof(response_envelope) = 'object'),
  check (pg_catalog.octet_length(response_envelope::text) <= 1048576),
  check (response_envelope->>'version' = 'legacy-provider-result.1'),
  check (pg_catalog.jsonb_typeof(response_envelope->'text') = 'string'),
  check (
    pg_catalog.jsonb_typeof(response_envelope->'structured') in ('object', 'null')
  ),
  check (pg_catalog.jsonb_typeof(response_envelope->'sources') = 'array'),
  check (pg_catalog.jsonb_typeof(response_envelope->'route_snapshot') = 'object'),
  check (
    response_envelope ?& array[
      'version', 'text', 'structured', 'sources', 'route_snapshot'
    ]
  ),
  check (
    response_envelope - array[
      'version', 'text', 'structured', 'sources', 'route_snapshot'
    ] = '{}'::jsonb
  )
);

create table private.legacy_model_attempt_admissions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkpoint_scope text not null
    check (checkpoint_scope ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  logical_request_id text not null
    check (logical_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  logical_stage_key text not null
    check (logical_stage_key ~ '^[a-z0-9][a-z0-9._:-]{0,159}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  attempt_number integer not null check (attempt_number between 1 and 2),
  claim_token uuid not null,
  dispatch_token uuid,
  dispatched_at timestamptz,
  heartbeat_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz not null,
  reconciliation_required_at timestamptz,
  reconciliation_code text,
  origin_reservation_id uuid,
  prepared_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (
    user_id, checkpoint_scope, logical_request_id, logical_stage_key,
    request_sha256, attempt_number
  ),
  foreign key (origin_reservation_id, user_id)
    references private.document_allowance_reservations(id, user_id)
    on delete cascade,
  check (
    (checkpoint_scope in ('generate-document', 'generate-checklist')
      and origin_reservation_id is not null)
    or
    (checkpoint_scope not in ('generate-document', 'generate-checklist')
      and origin_reservation_id is null)
  ),
  check (lease_expires_at > heartbeat_at),
  check (
    (dispatch_token is null and dispatched_at is null)
    or (dispatch_token is not null and dispatched_at is not null)
  ),
  check (
    (reconciliation_required_at is null and reconciliation_code is null)
    or (
      reconciliation_required_at is not null
      and reconciliation_code is not null
      and reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
    )
  )
);

create table private.legacy_generation_execution_claims (
  reservation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  checkpoint_scope text not null
    check (checkpoint_scope in ('generate-document', 'generate-checklist')),
  logical_request_id text not null
    check (logical_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  claim_token uuid not null unique,
  claim_version integer not null default 1 check (claim_version > 0),
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  heartbeat_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz not null,
  foreign key (reservation_id, user_id)
    references private.document_allowance_reservations(id, user_id)
    on delete cascade,
  check (lease_expires_at > heartbeat_at)
);

create index legacy_model_call_results_origin_idx
  on private.legacy_model_call_results(origin_reservation_id, user_id);
create index legacy_model_attempt_admissions_origin_idx
  on private.legacy_model_attempt_admissions(origin_reservation_id, user_id);
create index legacy_generation_execution_claims_user_idx
  on private.legacy_generation_execution_claims(user_id);

alter table private.legacy_model_call_results enable row level security;
alter table private.legacy_model_attempt_admissions enable row level security;
alter table private.legacy_generation_execution_claims enable row level security;
revoke all on table private.legacy_model_call_results
  from public, anon, authenticated, service_role;
revoke all on table private.legacy_model_attempt_admissions
  from public, anon, authenticated, service_role;
revoke all on table private.legacy_generation_execution_claims
  from public, anon, authenticated, service_role;

create or replace function private.reject_legacy_model_call_result_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'IMMUTABLE_LEGACY_MODEL_CALL_RESULT:%', old.id;
end;
$function$;

create trigger legacy_model_call_results_immutable
  before update or delete on private.legacy_model_call_results
  for each row execute function private.reject_legacy_model_call_result_mutation();

revoke all on function private.reject_legacy_model_call_result_mutation()
  from public, anon, authenticated, service_role;

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

revoke all on function public.record_legacy_model_call_attempt(
  uuid, text, text, text, text, integer, text, text, text, text,
  integer, integer, timestamptz, timestamptz, text, text, text, text,
  text, uuid, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.record_legacy_model_call_attempt(
  uuid, text, text, text, text, integer, text, text, text, text,
  integer, integer, timestamptz, timestamptz, text, text, text, text,
  text, uuid, jsonb, uuid
) to service_role;

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
end;
$function$;

revoke all on function public.read_legacy_model_call_checkpoint(
  uuid, text, uuid, text, text, text, integer, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.read_legacy_model_call_checkpoint(
  uuid, text, uuid, text, text, text, integer, uuid, boolean
) to service_role;

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
        p_logical_request_id || '|' || p_logical_stage_key,
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

revoke all on function public.mark_legacy_model_attempt_dispatched(
  uuid, text, uuid, text, text, text, integer, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.mark_legacy_model_attempt_dispatched(
  uuid, text, uuid, text, text, text, integer, uuid, uuid, uuid
) to service_role;

alter table private.document_allowance_reservations
  add column reconciliation_required_at timestamptz,
  add column reconciliation_code text,
  add constraint document_allowance_reconciliation_shape_check check (
    (reconciliation_required_at is null and reconciliation_code is null)
    or (
      reconciliation_required_at is not null
      and reconciliation_code is not null
      and reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
    )
  );

create or replace function private.hold_document_allowance_for_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'reserved'
    and new.status is distinct from 'reserved'
    and exists (
      select 1
      from private.legacy_model_attempt_admissions admission_record
      where admission_record.origin_reservation_id = old.id
        and admission_record.user_id = old.user_id
        and admission_record.dispatched_at is not null
        and not exists (
          select 1
          from public.usage_ledger usage_record
          where usage_record.user_id = admission_record.user_id
            and usage_record.logical_request_id = admission_record.logical_request_id
            and usage_record.logical_stage_key = admission_record.logical_stage_key
            and usage_record.provider_request_sha256 = admission_record.request_sha256
            and usage_record.provider_attempt_number = admission_record.attempt_number
            and usage_record.model_call_key is not null
        )
    ) then
    new.status := 'reserved';
    new.expires_at := 'infinity'::timestamptz;
    new.reconciliation_required_at := pg_catalog.clock_timestamp();
    new.reconciliation_code := 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED';
    new.release_code := null;
    new.released_at := null;
    return new;
  end if;
  if old.status = 'reserved'
    and new.status is distinct from 'reserved'
    and exists (
      select 1
      from private.legacy_model_attempt_admissions admission_record
      where admission_record.origin_reservation_id = old.id
        and admission_record.user_id = old.user_id
        and admission_record.dispatched_at is null
        and not exists (
          select 1
          from public.usage_ledger usage_record
          where usage_record.user_id = admission_record.user_id
            and usage_record.logical_request_id = admission_record.logical_request_id
            and usage_record.logical_stage_key = admission_record.logical_stage_key
            and usage_record.provider_request_sha256 = admission_record.request_sha256
            and usage_record.provider_attempt_number = admission_record.attempt_number
            and usage_record.model_call_key is not null
        )
    ) then
    -- A prepared admission proves that the original request still owns its
    -- durable attempt, but no provider dispatch occurred. Keep the reservation
    -- alive so the result wrapper can rotate the expired execution lease and
    -- resume that same attempt safely.
    new.status := 'reserved';
    new.expires_at := 'infinity'::timestamptz;
    new.release_code := null;
    new.released_at := null;
    return new;
  end if;
  if old.reconciliation_required_at is not null then
    if new.status = 'released'
      and new.release_code = 'provider_reconciliation_required' then
      new.status := old.status;
      new.expires_at := old.expires_at;
      new.reconciliation_required_at := old.reconciliation_required_at;
      new.reconciliation_code := old.reconciliation_code;
      new.release_code := old.release_code;
      new.released_at := old.released_at;
      return new;
    end if;
    if old.status is distinct from new.status
      or old.expires_at is distinct from new.expires_at
      or old.reconciliation_required_at is distinct from new.reconciliation_required_at
      or old.reconciliation_code is distinct from new.reconciliation_code
      or old.release_code is distinct from new.release_code
      or old.released_at is distinct from new.released_at then
      raise exception 'ALLOWANCE_RECONCILIATION_REQUIRED';
    end if;
    return new;
  end if;
  if old.status = 'reserved'
    and new.status = 'released'
    and new.release_code = 'provider_reconciliation_required' then
    new.status := 'reserved';
    new.release_code := null;
    new.released_at := null;
    -- A timeout age is not evidence that OpenAI did not complete the request.
    -- Reconciliation holds therefore never enter the generic legacy-expiry
    -- path. Only a future explicit reconciliation policy may release them.
    new.expires_at := 'infinity'::timestamptz;
    new.reconciliation_required_at := pg_catalog.clock_timestamp();
    new.reconciliation_code := 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED';
  end if;
  return new;
end;
$function$;

create trigger document_allowance_reconciliation_hold
  before update on private.document_allowance_reservations
  for each row execute function private.hold_document_allowance_for_reconciliation();

revoke all on function private.hold_document_allowance_for_reconciliation()
  from public, anon, authenticated, service_role;

create table private.document_allowance_results (
  reservation_id uuid primary key,
  user_id uuid not null,
  request_id text not null,
  route_key text not null,
  response_sha256 text not null check (response_sha256 ~ '^[0-9a-f]{64}$'),
  response_payload jsonb not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key (reservation_id, user_id)
    references private.document_allowance_reservations(id, user_id)
    on delete cascade,
  unique (user_id, request_id),
  check (route_key ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  check (pg_catalog.jsonb_typeof(response_payload) = 'object'),
  check (pg_catalog.octet_length(response_payload::text) <= 8388608),
  check (
    response_payload ?& array['contract_version', 'route_key', 'transport', 'payload']
  ),
  check (response_payload->>'contract_version' = 'allowance-result.1'),
  check (response_payload->>'route_key' = route_key),
  check (
    response_payload->>'transport' is not null
    and response_payload->>'transport' in ('json', 'sse')
  ),
  check (pg_catalog.jsonb_typeof(response_payload->'payload') = 'object'),
  check (pg_catalog.octet_length((response_payload->'payload')::text) <= 8380000),
  check (
    response_payload - array['contract_version', 'route_key', 'transport', 'payload']
      = '{}'::jsonb
  )
);

alter table private.document_allowance_results enable row level security;
revoke all on table private.document_allowance_results
  from public, anon, authenticated, service_role;

create or replace function private.reject_document_allowance_result_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'IMMUTABLE_DOCUMENT_ALLOWANCE_RESULT:%', old.reservation_id;
end;
$function$;

create trigger document_allowance_results_immutable
  before update or delete on private.document_allowance_results
  for each row execute function private.reject_document_allowance_result_mutation();

revoke all on function private.reject_document_allowance_result_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.reserve_document_allowance_with_result(
  p_user_id uuid,
  p_request_id text,
  p_route_key text,
  p_request_sha256 text,
  p_plan text,
  p_monthly_cap integer,
  p_ttl_seconds integer default 1800
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_checkpoint private.document_allowance_results%rowtype;
  v_reservation private.document_allowance_reservations%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_claim_token uuid;
  v_unresolved boolean;
begin
  v_result := public.reserve_document_allowance(
    p_user_id, p_request_id, p_route_key, p_request_sha256,
    p_plan, p_monthly_cap, p_ttl_seconds
  );
  if v_result->>'state' = 'settled' then
    select * into v_checkpoint
    from private.document_allowance_results result_record
    where result_record.user_id = p_user_id
      and result_record.request_id = p_request_id
      and result_record.route_key = p_route_key;
    if not found then
      return v_result || pg_catalog.jsonb_build_object(
        'completion_state', 'completed_result_unavailable',
        'result_unavailable', true,
        'provider_permitted', false
      );
    end if;
    v_result := v_result || pg_catalog.jsonb_build_object(
      'replay_result', v_checkpoint.response_payload,
      'response_sha256', v_checkpoint.response_sha256
    );
  elsif p_route_key in ('generate-document', 'generate-checklist')
    and (v_result->>'provider_permitted')::boolean is true then
    v_claim_token := extensions.gen_random_uuid();
    insert into private.legacy_generation_execution_claims(
      reservation_id, user_id, checkpoint_scope, logical_request_id,
      claim_token, claimed_at, heartbeat_at, lease_expires_at
    ) values (
      (v_result->>'reservation_id')::uuid, p_user_id, p_route_key, p_request_id,
      v_claim_token, v_now, v_now, v_now + interval '120 seconds'
    );
    v_result := v_result || pg_catalog.jsonb_build_object(
      'execution_claim_token', v_claim_token,
      'execution_lease_expires_at', v_now + interval '120 seconds'
    );
  elsif (v_result->>'provider_permitted')::boolean is false then
    select * into v_reservation
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = (v_result->>'reservation_id')::uuid
      and reservation_record.user_id = p_user_id;
    if found and v_reservation.reconciliation_required_at is not null then
      v_result := v_result || pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'reconciliation_required', true,
        'reconciliation_code', v_reservation.reconciliation_code
      );
    elsif found and p_route_key in ('generate-document', 'generate-checklist') then
      select * into v_claim
      from private.legacy_generation_execution_claims claim_record
      where claim_record.reservation_id = v_reservation.id
        and claim_record.user_id = p_user_id
      for update;
      if found and v_claim.lease_expires_at <= v_now then
        select exists (
          select 1
          from private.legacy_model_attempt_admissions admission_record
          where admission_record.user_id = p_user_id
            and admission_record.checkpoint_scope = p_route_key
            and admission_record.logical_request_id = p_request_id
            and admission_record.dispatched_at is not null
            and not exists (
              select 1
              from public.usage_ledger usage_record
              where usage_record.user_id = admission_record.user_id
                and usage_record.logical_request_id = admission_record.logical_request_id
                and usage_record.logical_stage_key = admission_record.logical_stage_key
                and usage_record.provider_request_sha256 = admission_record.request_sha256
                and usage_record.provider_attempt_number = admission_record.attempt_number
                and usage_record.model_call_key is not null
            )
        ) into v_unresolved;
        if v_unresolved then
          update private.document_allowance_reservations
          set expires_at = 'infinity'::timestamptz,
              reconciliation_required_at = v_now,
              reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
              updated_at = v_now
          where id = v_reservation.id;
          v_result := v_result || pg_catalog.jsonb_build_object(
            'state', 'awaiting_reconciliation',
            'reconciliation_required', true,
            'reconciliation_code', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
          );
        else
          v_claim_token := extensions.gen_random_uuid();
          update private.document_allowance_reservations
          set expires_at = v_now + pg_catalog.make_interval(secs => p_ttl_seconds),
              updated_at = v_now
          where id = v_reservation.id;
          update private.legacy_generation_execution_claims
          set claim_token = v_claim_token,
              claim_version = claim_version + 1,
              claimed_at = v_now,
              heartbeat_at = v_now,
              lease_expires_at = v_now + interval '120 seconds'
          where reservation_id = v_reservation.id;
          update private.legacy_model_attempt_admissions admission_record
          set claim_token = v_claim_token
          where admission_record.user_id = p_user_id
            and admission_record.checkpoint_scope = p_route_key
            and admission_record.logical_request_id = p_request_id
            and admission_record.origin_reservation_id = v_reservation.id
            and admission_record.dispatched_at is null
            and not exists (
              select 1
              from public.usage_ledger usage_record
              where usage_record.user_id = admission_record.user_id
                and usage_record.logical_request_id = admission_record.logical_request_id
                and usage_record.logical_stage_key = admission_record.logical_stage_key
                and usage_record.provider_request_sha256 = admission_record.request_sha256
                and usage_record.provider_attempt_number = admission_record.attempt_number
                and usage_record.model_call_key is not null
            );
          v_result := v_result || pg_catalog.jsonb_build_object(
            'state', 'reserved',
            'provider_permitted', true,
            'execution_reclaimed', true,
            'execution_claim_token', v_claim_token,
            'execution_lease_expires_at', v_now + interval '120 seconds'
          );
        end if;
      end if;
    end if;
  end if;
  return v_result;
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
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_existing private.document_allowance_results%rowtype;
  v_response_sha256 text;
  v_settlement jsonb;
  v_usage public.usage_ledger%rowtype;
begin
  if p_user_id is null or p_reservation_id is null or p_request_id is null
    or p_task is null or p_task !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    or p_provider is null or p_provider <> 'openai'
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
      or v_usage.provider is distinct from p_provider
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
    or v_usage.provider is distinct from p_provider
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

revoke all on function public.reserve_document_allowance_with_result(
  uuid, text, text, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.settle_document_allowance_with_result(
  uuid, uuid, text, text, text, integer, integer, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_document_allowance_with_result(
  uuid, text, text, text, text, integer, integer
) to service_role;
grant execute on function public.settle_document_allowance_with_result(
  uuid, uuid, text, text, text, integer, integer, jsonb
) to service_role;

commit;
