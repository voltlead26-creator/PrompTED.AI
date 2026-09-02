begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

create temp table durable_background_test_state (
  owner_id uuid not null,
  outcome_id uuid not null,
  document_id uuid not null,
  operation_id uuid,
  operation_revision integer,
  lease_token uuid,
  provider_started_at timestamptz not null,
  contract_v1 jsonb not null,
  contract_v2 jsonb,
  contract_hash_v1 text,
  contract_hash_v2 text,
  route_v1 jsonb not null,
  route_v2 jsonb not null
);

create temp table durable_completion_race_state (
  owner_id uuid not null,
  outcome_id uuid not null,
  document_id uuid not null,
  operation_id uuid,
  operation_revision integer,
  lease_token uuid,
  provider_started_at timestamptz not null
);

insert into durable_background_test_state values (
  '98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000003',
  null,
  null,
  null,
  clock_timestamp() - interval '1 second',
  '{
    "schemaVersion":"durable-schema.1",
    "ledgerVersion":"durable-ledger.1",
    "templates":{
      "resume":{
        "templateId":"resume",
        "displayName":"Accepted durable resume contract",
        "lifecycleStatus":"active",
        "supportedLocales":["en-AU"],
        "requiredInputs":[{"key":"confirmed_name","label":"Confirmed name"}],
        "optionalInputs":[],
        "sections":[{
          "sectionKey":"summary",
          "name":"Summary",
          "required":true,
          "dependsOnInputs":["confirmed_name"],
          "missingInformationBehaviour":"askClarifyingQuestion"
        }],
        "qualityBenchmark":{"benchmarkVersion":"resume-benchmark.1"}
      }
    }
  }'::jsonb,
  null,
  null,
  null,
  '{
    "provider":"openai",
    "routingVersion":"routing.accepted.1",
    "routes":{
      "deep":{
        "provider":"openai","semanticRoute":"deep","model":"gpt-accepted-deep",
        "reasoningEffort":"medium","routingVersion":"routing.accepted.1",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      },
      "review":{
        "provider":"openai","semanticRoute":"review","model":"gpt-accepted-review",
        "reasoningEffort":"high","routingVersion":"routing.accepted.1",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      }
    }
  }'::jsonb,
  '{
    "provider":"openai",
    "routingVersion":"routing.current.2",
    "routes":{
      "deep":{
        "provider":"openai","semanticRoute":"deep","model":"gpt-current-deep",
        "reasoningEffort":"medium","routingVersion":"routing.current.2",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      },
      "review":{
        "provider":"openai","semanticRoute":"review","model":"gpt-current-review",
        "reasoningEffort":"high","routingVersion":"routing.current.2",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      }
    }
  }'::jsonb
);

insert into durable_completion_race_state values (
  '98000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000004',
  null,
  null,
  null,
  clock_timestamp() - interval '1 second'
);

update durable_background_test_state
set contract_v2 = jsonb_set(
      jsonb_set(
        contract_v1,
        '{ledgerVersion}',
        '"durable-ledger.2"'::jsonb
      ),
      '{templates,resume,displayName}',
      '"Current replacement resume contract"'::jsonb
    ),
    contract_hash_v1 = encode(
      extensions.digest(convert_to(contract_v1::text, 'UTF8'), 'sha256'),
      'hex'
    );
update durable_background_test_state
set contract_hash_v2 = encode(
  extensions.digest(convert_to(contract_v2::text, 'UTF8'), 'sha256'),
  'hex'
);

grant select, update on durable_background_test_state
  to authenticated, service_role;
grant select, update on durable_completion_race_state
  to authenticated, service_role;

create or replace function pg_temp.accept_durable_operation()
returns jsonb
language plpgsql
as $function$
declare
  v_state durable_background_test_state%rowtype;
begin
  select * into v_state from durable_background_test_state;
  return public.accept_captured_document_operation(
    v_state.owner_id,
    v_state.outcome_id,
    v_state.document_id,
    'Accepted synthetic resume',
    'local',
    'pilot',
    'master-workspace',
    'resume',
    'resume-benchmark.1',
    'captured-operation-pipeline.1',
    7,
    'durable-replay-main',
    '{"confirmed_name":"Synthetic Person"}'::jsonb,
    '{"sources":[{"id":"input:confirmed_name","input_key":"confirmed_name","source_type":"confirmed_request_input","value":"Synthetic Person"}]}'::jsonb,
    '{"permitted_source_ids":["input:confirmed_name"],"material_claims_require_source_reference":true}'::jsonb,
    'en-AU',
    'AU',
    array['summary']::text[],
    '{}'::text[],
    '{}'::text[],
    '{"confirmed_name":{"confirmed":true,"source_id":"input:confirmed_name"}}'::jsonb,
    86400
  );
end;
$function$;

select has_function(
  'public',
  'get_captured_document_resume_payload',
  array['uuid', 'uuid'],
  'the protected immutable resume-payload command exists'
);
select has_function(
  'public',
  'renew_captured_document_operation_lease',
  array['uuid', 'uuid', 'integer'],
  'the token-bound cancellation-aware lease renewal command exists'
);
select has_function(
  'public',
  'reconcile_captured_document_provider_attempt',
  array['uuid', 'integer', 'uuid', 'text'],
  'the prepared provider-attempt reconciliation command exists'
);
select has_function(
  'public',
  'complete_captured_document_provider_attempt',
  array[
    'uuid', 'uuid', 'text', 'integer', 'text', 'text', 'text', 'text',
    'text', 'text', 'integer', 'integer', 'text', 'text',
    'timestamp with time zone', 'timestamp with time zone', 'text', 'jsonb'
  ],
  'the token-bound exact provider-attempt completion command exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_captured_document_resume_payload(uuid,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.get_captured_document_resume_payload(uuid,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.get_captured_document_resume_payload(uuid,uuid)',
    'EXECUTE'
  ),
  'only the protected service boundary can reconstruct immutable resume inputs'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.renew_captured_document_operation_lease(uuid,uuid,integer)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.renew_captured_document_operation_lease(uuid,uuid,integer)',
    'EXECUTE'
  ),
  'only the service worker can renew a live lease after owner cancellation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reconcile_captured_document_provider_attempt(uuid,integer,uuid,text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.reconcile_captured_document_provider_attempt(uuid,integer,uuid,text)',
    'EXECUTE'
  ),
  'only the service worker can reconcile an ambiguous prepared attempt'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_captured_document_provider_attempt(uuid,uuid,text,integer,text,text,text,text,text,text,integer,integer,text,text,timestamp with time zone,timestamp with time zone,text,jsonb)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.complete_captured_document_provider_attempt(uuid,uuid,text,integer,text,text,text,text,text,text,integer,integer,text,text,timestamp with time zone,timestamp with time zone,text,jsonb)',
    'EXECUTE'
  ),
  'only the service worker can atomically complete a known provider attempt'
);
select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'get_captured_document_resume_payload',
        'get_captured_document_operation',
        'renew_captured_document_operation_lease',
        'reconcile_captured_document_provider_attempt',
        'complete_captured_document_provider_attempt'
      )
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  ),
  5,
  'durable replay and reconnect commands are SECURITY DEFINER with an empty search path'
);

insert into auth.users(
  id, email, is_sso_user, is_anonymous, created_at, updated_at
)
select
  owner_id,
  'durable-replay-owner@example.invalid',
  false,
  false,
  now(),
  now()
from durable_background_test_state;
insert into public.outcomes(id, user_id, situation_text)
select outcome_id, owner_id, 'Synthetic immutable replay and cancellation test'
from durable_background_test_state;

select lives_ok(
  format(
    'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
    'durable-schema.1', 'durable-ledger.1', contract_v1::text,
    contract_hash_v1, 'pgtap'
  ),
  'the accepted ledger registers through the immutable boundary'
)
from durable_background_test_state;
select lives_ok(
  format(
    'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
    'durable-schema.1', 'durable-ledger.2', contract_v2::text,
    contract_hash_v2, 'pgtap'
  ),
  'a later ledger registers independently'
)
from durable_background_test_state;
select lives_ok(
  format(
    'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
    'local', 'pilot', 'master-workspace', 'resume',
    'durable-ledger.1', 'routing.accepted.1', route_v1::text,
    true, 0, 'pgtap', 'accept version one'
  ),
  'the retained pipeline is activated for the exact cohort'
)
from durable_background_test_state;

do $function$
declare
  v_result jsonb;
begin
  v_result := pg_temp.accept_durable_operation();
  update durable_background_test_state
  set operation_id = (v_result->>'operation_id')::uuid,
      operation_revision = (v_result->>'operation_revision')::integer;
end;
$function$;

select ok(
  (
    select reservation_record.expires_at = operation_record.expires_at
    from private.document_allowance_reservations reservation_record
    join private.captured_document_operations operation_record
      on operation_record.id = reservation_record.captured_operation_id
    join durable_background_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'captured allowance remains admitted through the immutable operation expiry'
);

-- A shorter or stale reservation lease must not make a still-resumable
-- operation disappear from the monthly cap. This recreates the prior bypass
-- without waiting for wall-clock expiry, then restores the fixture.
update private.document_allowance_reservations reservation_record
set reserved_at = clock_timestamp() - interval '3 hours',
    expires_at = clock_timestamp() - interval '1 hour',
    updated_at = clock_timestamp()
from durable_background_test_state state_record
where reservation_record.captured_operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.reserve_document_allowance(%L::uuid,%L,%L,%L,%L,%s,%s)',
      owner_id,
      'expired-captured-cap-bypass',
      'generate-document',
      repeat('8', 64),
      'free',
      1,
      1800
    ),
    '%ALLOWANCE_CAP_REACHED%'
  ),
  'an expired reservation cannot bypass the cap while its captured operation remains resumable'
)
from durable_background_test_state;
update private.document_allowance_reservations reservation_record
set expires_at = operation_record.expires_at,
    updated_at = clock_timestamp()
from private.captured_document_operations operation_record,
     durable_background_test_state state_record
where reservation_record.captured_operation_id = operation_record.id
  and operation_record.id = state_record.operation_id;

select is(
  (
    select operation_record.status || ':' || operation_record.operation_revision::text
    from private.captured_document_operations operation_record
    join durable_background_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'accepted:1',
  'the operation is durably accepted before provider work'
);
select is(
  (
    select (payload->>'pipeline_version') || ':'
      || (payload->>'benchmark_version') || ':'
      || (payload->>'input_revision') || ':'
      || (payload->>'locale') || ':' || (payload->>'jurisdiction')
    from durable_background_test_state state_record
    cross join lateral public.get_captured_document_resume_payload(
      state_record.owner_id,
      state_record.operation_id
    ) payload
  ),
  'captured-operation-pipeline.1:resume-benchmark.1:7:en-AU:AU',
  'resume returns the exact accepted pipeline, benchmark, revision, locale and jurisdiction'
);
select ok(
  (
    select payload->'input_values' =
        '{"confirmed_name":"Synthetic Person"}'::jsonb
      and payload->'source_snapshot' =
        '{"sources":[{"id":"input:confirmed_name","input_key":"confirmed_name","source_type":"confirmed_request_input","value":"Synthetic Person"}]}'::jsonb
      and payload->'evidence_snapshot' =
        '{"permitted_source_ids":["input:confirmed_name"],"material_claims_require_source_reference":true}'::jsonb
      and payload->'confirmations' =
        '{"confirmed_name":{"confirmed":true,"source_id":"input:confirmed_name"}}'::jsonb
      and payload->'safe_section_keys' = '["summary"]'::jsonb
      and payload->'blocked_section_keys' = '[]'::jsonb
      and payload->'unresolved_input_keys' = '[]'::jsonb
    from durable_background_test_state state_record
    cross join lateral public.get_captured_document_resume_payload(
      state_record.owner_id,
      state_record.operation_id
    ) payload
  ),
  'resume returns exact immutable inputs, sources, evidence, confirmations and section partition'
);

select lives_ok(
  format(
    'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
    'local', 'pilot', 'master-workspace', 'resume',
    'durable-ledger.2', 'routing.current.2', route_v2::text,
    true, 1, 'pgtap', 'activate replacement version'
  ),
  'a later release changes the current ledger and route activation'
)
from durable_background_test_state;
select is(
  (
    select (payload->>'ledger_version') || ':'
      || (payload->'ledger_template'->>'displayName') || ':'
      || (payload->'route_snapshot'->'routes'->'deep'->>'model') || ':'
      || (payload->>'activation_revision')
    from durable_background_test_state state_record
    cross join lateral public.get_captured_document_resume_payload(
      state_record.owner_id,
      state_record.operation_id
    ) payload
  ),
  'durable-ledger.1:Accepted durable resume contract:gpt-accepted-deep:1',
  'resume remains bound to the accepted ledger template and route after activation changes'
);
select lives_ok(
  'select pg_temp.accept_durable_operation()',
  'exact replay still resumes the original operation after activation changes'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_operations operation_record
    join durable_background_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  1,
  'activation changes and exact replay create no second operation or document'
);

do $function$
declare
  v_state durable_background_test_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_background_test_state;
  v_result := public.claim_captured_document_operation(
    v_state.operation_id,
    v_state.operation_revision,
    'durable-replay-worker',
    300
  );
  update durable_background_test_state
  set operation_revision = (v_result->>'operation_revision')::integer,
      lease_token = (v_result->>'lease_token')::uuid;
end;
$function$;
do $function$
declare
  v_state durable_background_test_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_background_test_state;
  v_result := public.advance_captured_document_operation(
    v_state.operation_id,
    v_state.operation_revision,
    v_state.lease_token,
    'generating',
    '{"reason":"dispatch generation"}'::jsonb,
    null,
    null,
    null
  );
  update durable_background_test_state
  set operation_revision = (v_result->>'operation_revision')::integer;
end;
$function$;
do $function$
declare
  v_state durable_background_test_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_background_test_state;
  v_result := public.record_captured_document_provider_attempt(
    v_state.operation_id,
    v_state.operation_revision,
    v_state.lease_token,
    'generation',
    0,
    'deep',
    'gpt-accepted-deep',
    'medium',
    null,
    'store_false',
    'prepared',
    0,
    0,
    null,
    null,
    v_state.provider_started_at,
    null,
    repeat('a', 64),
    null
  );
  update durable_background_test_state
  set operation_revision = (v_result->>'operation_revision')::integer;
end;
$function$;

select is(
  (
    select count(*)::integer
    from private.captured_document_provider_attempts attempt_record
    join durable_background_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
    where attempt_record.status = 'prepared'
  ),
  1,
  'one provider attempt is durably prepared before external dispatch'
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from durable_background_test_state),
  true
);
set local role authenticated;
select is(
  (
    select public.request_captured_document_cancellation(
      operation_id,
      operation_revision,
      'owner_cancelled'
    )->>'status'
    from durable_background_test_state
  ),
  'generating',
  'owner cancellation records intent without clearing the active worker lease'
);
select is(
  (
    select public.request_captured_document_cancellation(
      operation_id,
      operation_revision,
      'owner_cancelled'
    )->>'idempotent_replay'
    from durable_background_test_state
  ),
  'true',
  'exact owner cancellation-intent replay is idempotent despite revision advance'
);
select is(
  (
    select (
      public.get_captured_document_operation(operation_id)
        ->>'cancellation_requested'
    ) || ':' || (
      public.get_captured_document_operation(operation_id)
        ->>'cancellation_code'
    )
    from durable_background_test_state
  ),
  'true:owner_cancelled',
  'authenticated reconnect exposes durable pending-cancellation truth after reload'
);
reset role;

update durable_background_test_state state_record
set operation_revision = operation_record.operation_revision
from private.captured_document_operations operation_record
where operation_record.id = state_record.operation_id;
select is(
  (
    select operation_record.status || ':'
      || (operation_record.cancel_requested_at is not null)::text || ':'
      || (operation_record.lease_token = state_record.lease_token)::text
    from private.captured_document_operations operation_record
    join durable_background_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'generating:true:true',
  'cancellation intent is durable while the original fencing token remains live'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.cancel_captured_document_operation(%L::uuid,%s,%L::uuid,%L)',
      operation_id, operation_revision, lease_token, 'owner_cancelled'
    ),
    '%CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED%'
  ),
  'terminal cancellation fails closed while the provider attempt remains prepared'
)
from durable_background_test_state;

do $function$
declare
  v_state durable_background_test_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_background_test_state;
  v_result := public.renew_captured_document_operation_lease(
    v_state.operation_id,
    v_state.lease_token,
    300
  );
  if coalesce((v_result->>'cancellation_requested')::boolean, false) is not true then
    raise exception 'CANCELLATION_INTENT_NOT_VISIBLE_TO_WORKER';
  end if;
  update durable_background_test_state
  set operation_revision = (v_result->>'operation_revision')::integer;
end;
$function$;
select pass(
  'the token-bound worker renewal observes cancellation despite the owner revision change'
);

do $function$
declare
  v_state durable_background_test_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_background_test_state;
  v_result := public.reconcile_captured_document_provider_attempt(
    v_state.operation_id,
    v_state.operation_revision,
    v_state.lease_token,
    'OPENAI_PROVIDER_OUTCOME_UNKNOWN'
  );
  if coalesce((v_result->>'prepared_attempt_reconciled')::boolean, false) is not true then
    raise exception 'PREPARED_ATTEMPT_NOT_RECONCILED';
  end if;
  update durable_background_test_state
  set operation_revision = (v_result->>'operation_revision')::integer;
end;
$function$;

select is(
  (
    select attempt_record.status || ':' || attempt_record.error_code
    from private.captured_document_provider_attempts attempt_record
    join durable_background_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  'failed:OPENAI_PROVIDER_OUTCOME_UNKNOWN',
  'the prepared attempt is terminally reconciled while the lease is retained'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id =
        'captured-attempt:' || attempt_record.id::text
    join durable_background_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
    where usage_record.event_type = 'model_call'
  ),
  1,
  'provider-attempt usage is persisted exactly once before terminal cancellation'
);
select is(
  (
    select reservation_record.status
    from private.document_allowance_reservations reservation_record
    join durable_background_test_state state_record
      on state_record.operation_id = reservation_record.captured_operation_id
  ),
  'reserved',
  'the residual document allowance stays reserved until provider usage is reconciled'
);

select is(
  (
    select public.cancel_captured_document_operation(
      operation_id,
      operation_revision,
      lease_token,
      'owner_cancelled'
    )->>'status'
    from durable_background_test_state
  ),
  'cancelled',
  'the worker terminalizes cancellation only after attempt reconciliation'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id =
        'captured-attempt:' || attempt_record.id::text
    join durable_background_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
    where usage_record.event_type = 'model_call'
  ),
  1,
  'terminal cancellation does not duplicate or discard reconciled provider usage'
);
select is(
  (
    select reservation_record.status || ':' || reservation_record.release_code
    from private.document_allowance_reservations reservation_record
    join durable_background_test_state state_record
      on state_record.operation_id = reservation_record.captured_operation_id
  ),
  'released:captured_cancelled',
  'terminal cancellation releases only the residual document allowance reservation'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_provider_attempts attempt_record
    join durable_background_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
    where attempt_record.status = 'prepared'
  ),
  0,
  'no prepared provider attempt survives terminal cancellation'
);

-- A separate operation exercises the precise cancellation race: the worker
-- renews successfully, owner cancellation then advances the operation
-- revision, and known provider completion must still record exact outcome and
-- tokens through the live fencing token before cancellation terminalizes.
do $function$
declare
  v_state durable_completion_race_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_completion_race_state;
  v_result := public.accept_captured_document_operation(
    v_state.owner_id,
    v_state.outcome_id,
    v_state.document_id,
    'Atomic provider completion race',
    'local',
    'pilot',
    'master-workspace',
    'resume',
    'resume-benchmark.1',
    'captured-operation-pipeline.1',
    8,
    'durable-completion-race',
    '{"confirmed_name":"Synthetic Person"}'::jsonb,
    '{"sources":[{"id":"input:confirmed_name","input_key":"confirmed_name","source_type":"confirmed_request_input","value":"Synthetic Person"}]}'::jsonb,
    '{"permitted_source_ids":["input:confirmed_name"],"material_claims_require_source_reference":true}'::jsonb,
    'en-AU',
    'AU',
    array['summary']::text[],
    '{}'::text[],
    '{}'::text[],
    '{"confirmed_name":{"confirmed":true,"source_id":"input:confirmed_name"}}'::jsonb,
    86400
  );
  v_state.operation_id := (v_result->>'operation_id')::uuid;
  v_state.operation_revision := (v_result->>'operation_revision')::integer;

  v_result := public.claim_captured_document_operation(
    v_state.operation_id,
    v_state.operation_revision,
    'atomic-completion-worker',
    300
  );
  v_state.operation_revision := (v_result->>'operation_revision')::integer;
  v_state.lease_token := (v_result->>'lease_token')::uuid;

  v_result := public.advance_captured_document_operation(
    v_state.operation_id,
    v_state.operation_revision,
    v_state.lease_token,
    'generating',
    '{"reason":"dispatch known completion race"}'::jsonb,
    null,
    null,
    null
  );
  v_state.operation_revision := (v_result->>'operation_revision')::integer;

  v_result := public.record_captured_document_provider_attempt(
    v_state.operation_id,
    v_state.operation_revision,
    v_state.lease_token,
    'generation',
    0,
    'deep',
    'gpt-current-deep',
    'medium',
    null,
    'store_false',
    'prepared',
    0,
    0,
    null,
    null,
    v_state.provider_started_at,
    null,
    repeat('b', 64),
    null
  );
  v_state.operation_revision := (v_result->>'operation_revision')::integer;

  v_result := public.renew_captured_document_operation_lease(
    v_state.operation_id,
    v_state.lease_token,
    300
  );
  update durable_completion_race_state
  set operation_id = v_state.operation_id,
      operation_revision = (v_result->>'operation_revision')::integer,
      lease_token = v_state.lease_token;
end;
$function$;

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from durable_completion_race_state),
  true
);
set local role authenticated;
select is(
  (
    select public.request_captured_document_cancellation(
      operation_id,
      operation_revision,
      'owner_cancelled_after_renewal'
    )->>'status'
    from durable_completion_race_state
  ),
  'generating',
  'owner cancellation advances durable state after the worker renewal'
);
reset role;

select is(
  (
    select operation_record.operation_revision
    from private.captured_document_operations operation_record
    join durable_completion_race_state state_record
      on state_record.operation_id = operation_record.id
  ),
  (select operation_revision + 1 from durable_completion_race_state),
  'the worker revision is stale by one when known provider completion begins'
);

do $function$
declare
  v_state durable_completion_race_state%rowtype;
  v_result jsonb;
begin
  select * into v_state from durable_completion_race_state;
  v_result := public.complete_captured_document_provider_attempt(
    v_state.operation_id,
    v_state.lease_token,
    'generation',
    1,
    'deep',
    'gpt-current-deep',
    'medium',
    'resp_atomic_completion_race',
    'store_false',
    'succeeded',
    37,
    53,
    null,
    null,
    v_state.provider_started_at,
    clock_timestamp(),
    repeat('b', 64),
    '{"sections":[]}'::jsonb
  );
  if coalesce((v_result->>'cancellation_requested')::boolean, false) is not true then
    raise exception 'ATOMIC_COMPLETION_DID_NOT_RETURN_CANCELLATION_INTENT';
  end if;
  update durable_completion_race_state
  set operation_revision = (v_result->>'operation_revision')::integer;
end;
$function$;
select pass(
  'token-bound completion succeeds atomically despite the stale worker revision'
);

select is(
  (
    select attempt_record.status || ':'
      || attempt_record.input_tokens::text || ':'
      || attempt_record.output_tokens::text || ':'
      || attempt_record.provider_response_id
    from private.captured_document_provider_attempts attempt_record
    join durable_completion_race_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  'succeeded:37:53:resp_atomic_completion_race',
  'known provider outcome, response identity and actual tokens are retained exactly'
);
select is(
  (
    select usage_record.event_type || ':'
      || usage_record.input_tokens::text || ':'
      || usage_record.output_tokens::text
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id =
        'captured-attempt:' || attempt_record.id::text
    join durable_completion_race_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  'model_call:37:53',
  'actual provider usage is persisted in the same completion transaction before cancellation'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id =
        'captured-attempt:' || attempt_record.id::text
    join durable_completion_race_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  1,
  'known provider completion creates exactly one usage row'
);
select is(
  (
    select reservation_record.status
    from private.document_allowance_reservations reservation_record
    join durable_completion_race_state state_record
      on state_record.operation_id = reservation_record.captured_operation_id
  ),
  'reserved',
  'the document reservation remains live after provider usage settlement and before cancellation'
);

select is(
  (
    select public.cancel_captured_document_operation(
      operation_id,
      operation_revision,
      lease_token,
      'owner_cancelled_after_renewal'
    )->>'status'
    from durable_completion_race_state
  ),
  'cancelled',
  'terminal cancellation follows exact known provider completion'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id =
        'captured-attempt:' || attempt_record.id::text
    join durable_completion_race_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  1,
  'terminal cancellation preserves exactly-once actual provider usage'
);
select is(
  (
    select reservation_record.status || ':' || reservation_record.release_code
    from private.document_allowance_reservations reservation_record
    join durable_completion_race_state state_record
      on state_record.operation_id = reservation_record.captured_operation_id
  ),
  'released:captured_cancelled',
  'terminal cancellation releases only the residual document reservation after exact usage settlement'
);

-- Operation TTL only governs unfinished work. A later service-side claim may
-- not rewrite a ready result or an owner cancellation after its TTL.
set local session_replication_role = replica;
update private.captured_document_operations operation_record
set created_at = clock_timestamp() - interval '2 minutes',
    expires_at = clock_timestamp() - interval '1 second',
    status = case
      when operation_record.id = (select operation_id from durable_background_test_state)
        then 'ready_for_review'
      else operation_record.status
    end,
    provider_finalized_revision = case
      when operation_record.id = (select operation_id from durable_background_test_state)
        then coalesce(operation_record.provider_finalized_revision, 1)
      else operation_record.provider_finalized_revision
    end,
    latest_document_revision = case
      when operation_record.id = (select operation_id from durable_background_test_state)
        then coalesce(operation_record.latest_document_revision, 1)
      else operation_record.latest_document_revision
    end,
    finalization_sha256 = case
      when operation_record.id = (select operation_id from durable_background_test_state)
        then coalesce(operation_record.finalization_sha256, repeat('f', 64))
      else operation_record.finalization_sha256
    end
where operation_record.id in (
  (select operation_id from durable_background_test_state),
  (select operation_id from durable_completion_race_state)
);
set local session_replication_role = origin;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
      operation_record.id,
      operation_record.operation_revision,
      'late-ready-worker',
      300
    ),
    '%CAPTURED_OPERATION_NOT_CLAIMABLE:ready_for_review%'
  ),
  'an expired ready operation remains immutable and cannot be reclaimed'
)
from private.captured_document_operations operation_record
join durable_background_test_state state_record
  on state_record.operation_id = operation_record.id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
      operation_record.id,
      operation_record.operation_revision,
      'late-cancelled-worker',
      300
    ),
    '%CAPTURED_OPERATION_NOT_CLAIMABLE:cancelled%'
  ),
  'an expired cancelled operation remains immutable and cannot be reclaimed'
)
from private.captured_document_operations operation_record
join durable_completion_race_state state_record
  on state_record.operation_id = operation_record.id;
select is(
  (
    select operation_record.status
    from private.captured_document_operations operation_record
    join durable_background_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'ready_for_review',
  'late claim rejection preserves ready-for-review truth'
);
select is(
  (
    select operation_record.status
    from private.captured_document_operations operation_record
    join durable_completion_race_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'cancelled',
  'late claim rejection preserves cancelled truth'
);

-- A worker can disappear after preparing a provider request and never return
-- before the immutable operation TTL. Expiry must reconcile that durable
-- attempt and its usage before terminal failure releases the allowance.
create temp table durable_expired_prepared_state (
  operation_id uuid not null,
  operation_revision integer not null,
  lease_token uuid not null
);
do $function$
declare
  v_result jsonb;
  v_operation_id uuid;
  v_revision integer;
  v_lease_token uuid;
begin
  v_result := public.accept_captured_document_operation(
    '98000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000002',
    '98000000-0000-4000-8000-000000000005',
    'Expired prepared-attempt recovery',
    'local', 'pilot', 'master-workspace', 'resume',
    'resume-benchmark.1', 'captured-operation-pipeline.1', 9,
    'durable-expired-prepared',
    '{"confirmed_name":"Synthetic Person"}'::jsonb,
    '{"sources":[{"id":"input:confirmed_name","input_key":"confirmed_name","source_type":"confirmed_request_input","value":"Synthetic Person"}]}'::jsonb,
    '{"permitted_source_ids":["input:confirmed_name"],"material_claims_require_source_reference":true}'::jsonb,
    'en-AU', 'AU', array['summary']::text[], '{}'::text[], '{}'::text[],
    '{"confirmed_name":{"confirmed":true,"source_id":"input:confirmed_name"}}'::jsonb,
    86400
  );
  v_operation_id := (v_result->>'operation_id')::uuid;
  v_revision := (v_result->>'operation_revision')::integer;

  v_result := public.claim_captured_document_operation(
    v_operation_id, v_revision, 'expired-prepared-worker', 300
  );
  v_revision := (v_result->>'operation_revision')::integer;
  v_lease_token := (v_result->>'lease_token')::uuid;

  v_result := public.advance_captured_document_operation(
    v_operation_id, v_revision, v_lease_token, 'generating',
    '{"reason":"prepare before synthetic expiry"}'::jsonb
  );
  v_revision := (v_result->>'operation_revision')::integer;

  v_result := public.record_captured_document_provider_attempt(
    v_operation_id, v_revision, v_lease_token, 'generation', 0, 'deep',
    'gpt-current-deep', 'medium', null, 'store_false', 'prepared',
    0, 0, null, null, clock_timestamp() - interval '1 minute', null,
    repeat('c', 64), null
  );
  v_revision := (v_result->>'operation_revision')::integer;
  insert into durable_expired_prepared_state
  values (v_operation_id, v_revision, v_lease_token);
end;
$function$;

grant select on durable_expired_prepared_state to authenticated;

select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select is(
  (
    select public.request_captured_document_cancellation(
      operation_id, operation_revision, 'owner_cancelled_before_expiry'
    )->>'status'
    from durable_expired_prepared_state
  ),
  'generating',
  'owner cancellation intent remains durable while the crashed provider attempt is unresolved'
);
reset role;
update durable_expired_prepared_state state_record
set operation_revision = operation_record.operation_revision
from private.captured_document_operations operation_record
where operation_record.id = state_record.operation_id;

set local session_replication_role = replica;
update private.captured_document_operations operation_record
set created_at = clock_timestamp() - interval '2 minutes',
    expires_at = clock_timestamp() - interval '1 second',
    lease_expires_at = clock_timestamp() - interval '1 second'
from durable_expired_prepared_state state_record
where operation_record.id = state_record.operation_id;
set local session_replication_role = origin;

select is(
  (
    select public.claim_captured_document_operation(
      operation_id, operation_revision, 'expiry-reconciler', 300
    )->>'status'
    from durable_expired_prepared_state
  ),
  'cancelled',
  'expired captured work reconciles and honours owner cancellation when its worker died after preparation'
);
select is(
  (
    select attempt_record.status || ':' || attempt_record.error_code
    from private.captured_document_provider_attempts attempt_record
    join durable_expired_prepared_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  'failed:CAPTURED_OPERATION_EXPIRED_OUTCOME_UNKNOWN',
  'expiry retains an explicit ambiguous provider-outcome record instead of a prepared orphan'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id = 'captured-attempt:' || attempt_record.id::text
    join durable_expired_prepared_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  1,
  'expired prepared-attempt reconciliation persists exactly one model-call usage row'
);
select is(
  (
    select reservation_record.status || ':' || reservation_record.release_code
    from private.document_allowance_reservations reservation_record
    join durable_expired_prepared_state state_record
      on state_record.operation_id = reservation_record.captured_operation_id
  ),
  'released:captured_cancelled',
  'expiry releases the document allowance as cancelled only after ambiguous provider usage is recorded'
);

select * from finish();
rollback;
