begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
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

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values (
  'e6000000-0000-4000-8000-000000000001',
  'legacy-accounting@example.test',
  false,
  false,
  now(),
  now()
);

select has_table(
  'private',
  'document_allowance_results',
  'durable allowance results have a private immutable checkpoint table'
);
select has_table(
  'private',
  'legacy_model_call_results',
  'provider-completed legacy stages have an immutable private result table'
);
select has_table(
  'private',
  'legacy_model_attempt_admissions',
  'legacy stage retry admission is durable across HTTP invocations'
);
select has_table(
  'private',
  'legacy_generation_execution_claims',
  'legacy document execution has a durable renewable lease'
);
select has_function(
  'public',
  'record_legacy_model_call_attempt',
  array[
    'uuid', 'text', 'text', 'text', 'text', 'integer', 'text', 'text',
    'text', 'text', 'integer', 'integer', 'timestamp with time zone',
    'timestamp with time zone', 'text', 'text', 'text', 'text',
    'text', 'uuid', 'jsonb', 'uuid'
  ],
  'service-only terminal model-attempt command exists'
);
select has_function(
  'public',
  'read_legacy_model_call_checkpoint',
  array[
    'uuid', 'text', 'uuid', 'text', 'text', 'text', 'integer', 'uuid', 'boolean'
  ],
  'service-only checkpoint read and durable attempt allocation command exists'
);
select has_function(
  'public',
  'mark_legacy_model_attempt_dispatched',
  array[
    'uuid', 'text', 'uuid', 'text', 'text', 'text', 'integer', 'uuid',
    'uuid', 'uuid'
  ],
  'service-only durable provider-dispatch transition exists'
);
select has_function(
  'public',
  'reserve_document_allowance_with_result',
  array['uuid', 'text', 'text', 'text', 'text', 'integer', 'integer'],
  'allowance reservation can retrieve a committed replay result'
);
select has_function(
  'public',
  'settle_document_allowance_with_result',
  array['uuid', 'uuid', 'text', 'text', 'text', 'integer', 'integer', 'jsonb'],
  'allowance settlement atomically checkpoints the response'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_legacy_model_call_attempt(uuid,text,text,text,text,integer,text,text,text,text,integer,integer,timestamptz,timestamptz,text,text,text,text,text,uuid,jsonb,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.read_legacy_model_call_checkpoint(uuid,text,uuid,text,text,text,integer,uuid,boolean)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.mark_legacy_model_attempt_dispatched(uuid,text,uuid,text,text,text,integer,uuid,uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.reserve_document_allowance_with_result(uuid,text,text,text,text,integer,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.settle_document_allowance_with_result(uuid,uuid,text,text,text,integer,integer,jsonb)',
    'EXECUTE'
  ),
  'protected compute can invoke the new accounting and replay commands'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_legacy_model_call_attempt(uuid,text,text,text,text,integer,text,text,text,text,integer,integer,timestamptz,timestamptz,text,text,text,text,text,uuid,jsonb,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.read_legacy_model_call_checkpoint(uuid,text,uuid,text,text,text,integer,uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.mark_legacy_model_attempt_dispatched(uuid,text,uuid,text,text,text,integer,uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.reserve_document_allowance_with_result(uuid,text,text,text,text,integer,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.settle_document_allowance_with_result(uuid,uuid,text,text,text,integer,integer,jsonb)',
    'EXECUTE'
  ),
  'browser roles cannot invoke model accounting or allowance replay authority'
);
select ok(
  not has_table_privilege('service_role', 'private.document_allowance_results', 'SELECT')
  and not has_table_privilege('service_role', 'private.legacy_model_call_results', 'SELECT')
  and not has_table_privilege('service_role', 'private.legacy_model_attempt_admissions', 'SELECT')
  and not has_table_privilege('service_role', 'private.legacy_generation_execution_claims', 'SELECT')
  and not has_table_privilege('authenticated', 'private.document_allowance_results', 'SELECT')
  and not has_table_privilege('anon', 'private.document_allowance_results', 'SELECT'),
  'the response checkpoint is not exposed through direct table grants'
);
select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'record_legacy_model_call_attempt',
        'read_legacy_model_call_checkpoint',
        'reserve_document_allowance_with_result',
        'settle_document_allowance_with_result'
      )
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  ),
  4,
  'all four RPCs are SECURITY DEFINER with an empty search path'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.reject_document_allowance_result_mutation()',
    'EXECUTE'
  ),
  'the immutable checkpoint trigger helper is not externally executable'
);

select is(
  public.record_legacy_model_call_attempt(
    'e6000000-0000-4000-8000-000000000001',
    'logical-request-one',
    'generate-document.section:summary',
    repeat('a', 64),
    'response:resp-success',
    1,
    'succeeded',
    'resp-success',
    'completed',
    null,
    101,
    29,
    '2026-09-01T00:00:00Z'::timestamptz,
    '2026-09-01T00:00:02Z'::timestamptz,
    'gpt-test-deep',
    'routing.test.1',
    'deep',
    'medium'
  )->>'idempotent_replay',
  'false',
  'a known successful provider attempt is durably recorded'
);
select is(
  public.record_legacy_model_call_attempt(
    'e6000000-0000-4000-8000-000000000001',
    'logical-request-one',
    'generate-document.section:summary',
    repeat('a', 64),
    'response:resp-success',
    1,
    'succeeded',
    'resp-success',
    'completed',
    null,
    101,
    29,
    '2026-09-01T00:00:00Z'::timestamptz,
    '2026-09-01T00:00:02Z'::timestamptz,
    'gpt-test-deep',
    'routing.test.1',
    'deep',
    'medium'
  )->>'idempotent_replay',
  'true',
  'exact terminal-attempt replay is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where user_id = 'e6000000-0000-4000-8000-000000000001'
      and model_call_key is not null
  ),
  1,
  'exact attempt replay inserts one accounting row'
);
select ok(
  exists (
    select 1
    from public.usage_ledger
    where user_id = 'e6000000-0000-4000-8000-000000000001'
      and provider_response_id = 'resp-success'
      and model_call_status = 'succeeded'
      and provider_status = 'completed'
      and provider_error_code is null
      and input_tokens = 101
      and output_tokens = 29
      and provider_started_at = '2026-09-01T00:00:00Z'::timestamptz
      and provider_completed_at = '2026-09-01T00:00:02Z'::timestamptz
  ),
  'actual response identity, status, tokens and timing are retained'
);

select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000001',
  'logical-request-two',
  'generate-checklist.primary',
  repeat('b', 64),
  'client:retry-one',
  1,
  'failed',
  '',
  'http_429',
  'OPENAI_UPSTREAM_ERROR',
  0,
  0,
  '2026-09-01T00:01:00Z'::timestamptz,
  '2026-09-01T00:01:01Z'::timestamptz,
  'gpt-test-fast',
  'routing.test.1',
  'fast',
  'low'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000001',
  'logical-request-two',
  'generate-checklist.primary',
  repeat('b', 64),
  'response:retry-success',
  2,
  'succeeded',
  'retry-success',
  'completed',
  null,
  12,
  4,
  '2026-09-01T00:01:02Z'::timestamptz,
  '2026-09-01T00:01:03Z'::timestamptz,
  'gpt-test-fast',
  'routing.test.1',
  'fast',
  'low'
);
select is(
  (
    select array_agg(model_call_status order by provider_attempt_number)
    from public.usage_ledger
    where logical_request_id = 'logical-request-two'
  ),
  array['failed', 'succeeded']::text[],
  'retry failure and later success remain distinct terminal attempts'
);

select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000001',
  'logical-request-three',
  'generate-report.section:summary',
  repeat('c', 64),
  'client:cancelled',
  1,
  'cancelled',
  '',
  'cancelled',
  'OPENAI_CANCELLED',
  0,
  0,
  '2026-09-01T00:02:00Z'::timestamptz,
  '2026-09-01T00:02:01Z'::timestamptz,
  'gpt-test-deep',
  'routing.test.1',
  'deep',
  'medium'
);
select is(
  (
    select model_call_status
    from public.usage_ledger
    where provider_attempt_id = 'client:cancelled'
  ),
  'cancelled',
  'known cancellation is explicitly retained'
);
select is(
  public.record_legacy_model_call_attempt(
    'e6000000-0000-4000-8000-000000000001',
    'logical-request-ambiguous',
    'provider-router.ambiguous',
    repeat('d', 64),
    'client:ambiguous-stable-id',
    1,
    'unknown',
    '',
    'ambiguous',
    'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
    0,
    0,
    '2026-09-01T00:03:00Z'::timestamptz,
    '2026-09-01T00:03:01Z'::timestamptz,
    'gpt-test-deep',
    'routing.test.1',
    'deep',
    'medium'
  )->>'idempotent_replay',
  'false',
  'an ambiguous provider outcome is retained explicitly as unknown'
);
select is(
  public.record_legacy_model_call_attempt(
    'e6000000-0000-4000-8000-000000000001',
    'logical-request-ambiguous',
    'provider-router.ambiguous',
    repeat('d', 64),
    'client:ambiguous-stable-id',
    1,
    'unknown',
    '',
    'ambiguous',
    'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
    0,
    0,
    '2026-09-01T00:03:00Z'::timestamptz,
    '2026-09-01T00:03:01Z'::timestamptz,
    'gpt-test-deep',
    'routing.test.1',
    'deep',
    'medium'
  )->>'idempotent_replay',
  'true',
  'exact ambiguous-attempt replay is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where logical_request_id = 'logical-request-ambiguous'
      and model_call_status = 'unknown'
      and provider_error_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
      and provider_response_id is null
      and input_tokens = 0
      and output_tokens = 0
  ),
  1,
  'ambiguous replay leaves exactly one content-free unknown ledger row'
);
select ok(
  pg_temp.raises_matching(
    $$select public.record_legacy_model_call_attempt(
      'e6000000-0000-4000-8000-000000000001',
      'logical-request-ambiguous', 'provider-router.ambiguous', repeat('d', 64),
      'client:ambiguous-stable-id', 1, 'unknown', '', 'ambiguous',
      'OPENAI_PROVIDER_RECONCILIATION_REQUIRED', 1, 0,
      '2026-09-01T00:03:00Z'::timestamptz,
      '2026-09-01T00:03:01Z'::timestamptz, 'gpt-test-deep',
      'routing.test.1', 'deep', 'medium')$$,
    '%LEGACY_MODEL_ATTEMPT_REPLAY_CONFLICT%'
  ),
  'ambiguous-attempt replay fails closed if later facts are invented or changed'
);
select ok(
  pg_temp.raises_matching(
    $$select public.record_legacy_model_call_attempt(
      'e6000000-0000-4000-8000-000000000001', 'null-status-request',
      'provider-router.null-status', repeat('e', 64), 'client:null-status', 1,
      null, '', 'ambiguous', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED', 0, 0,
      now(), now(), 'gpt-test-deep', 'routing.test.1', 'deep', 'medium')$$,
    '%LEGACY_MODEL_ATTEMPT_INPUT_INVALID%'
  ),
  'NULL attempt status is rejected rather than admitted through SQL UNKNOWN'
);
select ok(
  pg_temp.raises_matching(
    $$select public.record_legacy_model_call_attempt(
      'e6000000-0000-4000-8000-000000000001', 'null-route-request',
      'provider-router.null-route', repeat('f', 64), 'client:null-route', 1,
      'failed', '', 'http_422', 'OPENAI_UPSTREAM_ERROR', 0, 0,
      now(), now(), 'gpt-test-deep', 'routing.test.1', null, 'medium')$$,
    '%LEGACY_MODEL_ATTEMPT_INPUT_INVALID%'
  ),
  'NULL semantic route is rejected rather than admitted through SQL UNKNOWN'
);
select ok(
  pg_temp.raises_matching(
    $$select public.record_legacy_model_call_attempt(
      'e6000000-0000-4000-8000-000000000001', 'null-reasoning-request',
      'provider-router.null-reasoning', repeat('0', 64), 'client:null-reasoning', 1,
      'failed', '', 'http_422', 'OPENAI_UPSTREAM_ERROR', 0, 0,
      now(), now(), 'gpt-test-deep', 'routing.test.1', 'deep', null)$$,
    '%LEGACY_MODEL_ATTEMPT_INPUT_INVALID%'
  ),
  'NULL reasoning effort is rejected rather than admitted through SQL UNKNOWN'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where logical_request_id in (
      'null-status-request', 'null-route-request', 'null-reasoning-request'
    )
  ),
  0,
  'NULL model-attempt discriminators create no ledger rows'
);
select ok(
  pg_temp.raises_matching(
    $$select public.record_legacy_model_call_attempt(
      'e6000000-0000-4000-8000-000000000001', 'logical-request-one',
      'generate-document.section:summary', repeat('a', 64),
      'response:resp-success', 1, 'succeeded', 'resp-success', 'completed',
      null, 102, 29, '2026-09-01T00:00:00Z'::timestamptz,
      '2026-09-01T00:00:02Z'::timestamptz, 'gpt-test-deep',
      'routing.test.1', 'deep', 'medium')$$,
    '%LEGACY_MODEL_ATTEMPT_REPLAY_CONFLICT%'
  ),
  'one provider attempt identity cannot be replayed with changed token facts'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where user_id = 'e6000000-0000-4000-8000-000000000001'
      and event_type = 'document_created'
  ),
  0,
  'model-attempt accounting never consumes a document allowance'
);

create temp table invalid_settlement_state(reservation_id uuid not null);
with reservation as (
  select public.reserve_document_allowance(
    'e6000000-0000-4000-8000-000000000001',
    'invalid-settlement',
    'generate-document',
    repeat('3', 64),
    'pro',
    20,
    1800
  ) value
)
insert into invalid_settlement_state
select (value->>'reservation_id')::uuid from reservation;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance(%L::uuid,%L::uuid,%L,%L,null,%s,%s)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from invalid_settlement_state),
      'invalid-settlement',
      'document',
      0,
      0
    ),
    '%ALLOWANCE_SETTLEMENT_INPUT_INVALID%'
  ),
  'NULL allowance provider is rejected before settlement mutation'
);
select ok(
  pg_temp.raises_matching(
    $$select public.reserve_document_allowance(
      'e6000000-0000-4000-8000-000000000001', 'null-plan-reserve',
      'generate-document', repeat('4', 64), null, 20, 1800)$$,
    '%ALLOWANCE_SNAPSHOT_INVALID%'
  ),
  'NULL plan is rejected at the reserve boundary'
);
select ok(
  pg_temp.raises_matching(
    $$select public.reserve_document_allowance(
      'e6000000-0000-4000-8000-000000000001', 'null-ttl-reserve',
      'generate-document', repeat('5', 64), 'pro', 20, null)$$,
    '%ALLOWANCE_SNAPSHOT_INVALID%'
  ),
  'NULL reservation TTL is rejected at the reserve boundary'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance_with_result(%L::uuid,%L::uuid,%L,%L,%L,%s,%s,%L::jsonb)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from invalid_settlement_state),
      'invalid-settlement', 'document', 'openai', 0, 0,
      '{"route_key":"generate-document","transport":"sse","payload":{"events":[]}}'
    ),
    '%ALLOWANCE_RESULT_INVALID%'
  ),
  'missing result contract version is rejected fail closed'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance_with_result(%L::uuid,%L::uuid,%L,%L,%L,%s,%s,%L::jsonb)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from invalid_settlement_state),
      'invalid-settlement', 'document', 'openai', 0, 0,
      '{"contract_version":null,"route_key":"generate-document","transport":"sse","payload":{"events":[]}}'
    ),
    '%ALLOWANCE_RESULT_INVALID%'
  ),
  'explicit NULL result contract version is rejected fail closed'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance_with_result(%L::uuid,%L::uuid,%L,%L,%L,%s,%s,%L::jsonb)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from invalid_settlement_state),
      'invalid-settlement', 'document', 'openai', 0, 0,
      '{"contract_version":"allowance-result.1","transport":"sse","payload":{"events":[]}}'
    ),
    '%ALLOWANCE_RESULT_ROUTE_CONFLICT%'
  ),
  'missing result route key is rejected fail closed'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance_with_result(%L::uuid,%L::uuid,%L,%L,%L,%s,%s,%L::jsonb)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from invalid_settlement_state),
      'invalid-settlement', 'document', 'openai', 0, 0,
      '{"contract_version":"allowance-result.1","route_key":null,"transport":"sse","payload":{"events":[]}}'
    ),
    '%ALLOWANCE_RESULT_ROUTE_CONFLICT%'
  ),
  'explicit NULL result route key is rejected fail closed'
);
select ok(
  exists (
    select 1
    from private.document_allowance_reservations
    where id = (select reservation_id from invalid_settlement_state)
      and status = 'reserved'
      and usage_ledger_id is null
  )
  and not exists (
    select 1 from private.document_allowance_results
    where reservation_id = (select reservation_id from invalid_settlement_state)
  )
  and not exists (
    select 1 from public.usage_ledger
    where generation_request_id in (
      'invalid-settlement', 'null-plan-reserve', 'null-ttl-reserve'
    )
  )
  and not exists (
    select 1 from private.document_allowance_reservations
    where request_id in ('null-plan-reserve', 'null-ttl-reserve')
  ),
  'invalid NULL and JSON boundaries mutate no reservation, result, or usage state'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values (
  'e6000000-0000-4000-8000-000000000002',
  'ambiguous-allowance@example.test',
  false,
  false,
  now(),
  now()
);

create temp table ambiguous_allowance_state(reservation_id uuid not null);
with reservation as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000002',
    'ambiguous-generation',
    'generate-document',
    repeat('1', 64),
    'free',
    1,
    1800
  ) value
)
insert into ambiguous_allowance_state
select (value->>'reservation_id')::uuid from reservation;

select is(
  public.release_document_allowance(
    'e6000000-0000-4000-8000-000000000002',
    (select reservation_id from ambiguous_allowance_state),
    'ambiguous-generation',
    'provider_reconciliation_required'
  )->>'state',
  'reserved',
  'ambiguous provider work is held rather than released'
);
select ok(
  exists (
    select 1
    from private.document_allowance_reservations
    where id = (select reservation_id from ambiguous_allowance_state)
      and status = 'reserved'
      and release_code is null
      and expires_at = 'infinity'::timestamptz
      and reconciliation_required_at is not null
      and reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
  ),
  'the held reservation retains explicit durable reconciliation state beyond its original TTL'
);
select ok(
  (
    public.reserve_document_allowance_with_result(
      'e6000000-0000-4000-8000-000000000002',
      'ambiguous-generation',
      'generate-document',
      repeat('1', 64),
      'free',
      1,
      1800
    )->>'provider_permitted'
  )::boolean is false,
  'exact ambiguous replay cannot regain provider permission'
);
select is(
  public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000002',
    'ambiguous-generation',
    'generate-document',
    repeat('1', 64),
    'free',
    1,
    1800
  )->>'state',
  'awaiting_reconciliation',
  'exact ambiguous replay exposes a durable nonterminal reconciliation state'
);
select ok(
  pg_temp.raises_matching(
    $$select public.reserve_document_allowance_with_result(
      'e6000000-0000-4000-8000-000000000002', 'different-generation',
      'generate-checklist', repeat('2', 64), 'free', 1, 1800)$$,
    '%ALLOWANCE_CAP_REACHED%'
  ),
  'an ambiguous reservation remains cap-counting until explicit reconciliation'
);

select ok(
  strpos(
    pg_get_functiondef(
      'public.settle_document_allowance_with_result(uuid,uuid,text,text,text,integer,integer,jsonb)'::regprocedure
    ),
    'document_allowance_lock'
  ) < strpos(
    pg_get_functiondef(
      'public.settle_document_allowance_with_result(uuid,uuid,text,text,text,integer,integer,jsonb)'::regprocedure
    ),
    'for update'
  ),
  'result settlement acquires the period advisory lock before its reservation row lock'
);

create temp table replay_shape_state(
  route_key text primary key,
  request_id text not null,
  reservation_id uuid not null,
  response_payload jsonb not null
);

do $function$
declare
  v_route text;
  v_request text;
  v_payload jsonb;
  v_reservation jsonb;
begin
  for v_route, v_request, v_payload in
    select * from (values
      (
        'generate-checklist',
        'checkpoint-checklist',
        '{"contract_version":"allowance-result.1","route_key":"generate-checklist","transport":"json","payload":{"body":{"items":[{"text":"Do it"}]}}}'::jsonb
      ),
      (
        'generate-report',
        'checkpoint-report',
        '{"contract_version":"allowance-result.1","route_key":"generate-report","transport":"sse","payload":{"events":[{"type":"section","key":"summary","content":"Result"}]}}'::jsonb
      ),
      (
        'generate-document',
        'checkpoint-document',
        '{"contract_version":"allowance-result.1","route_key":"generate-document","transport":"sse","payload":{"events":[{"type":"section","key":"summary","content":"Result"}]}}'::jsonb
      ),
      (
        'generate-artifact',
        'checkpoint-artifact',
        '{"contract_version":"allowance-result.1","route_key":"generate-artifact","transport":"sse","payload":{"events":[{"type":"complete","artifact":{"id":"artifact-one"}}]}}'::jsonb
      )
    ) shapes(route_key, request_id, response_payload)
  loop
    v_reservation := public.reserve_document_allowance_with_result(
      'e6000000-0000-4000-8000-000000000001',
      v_request,
      v_route,
      encode(extensions.digest(convert_to(v_route, 'UTF8'), 'sha256'), 'hex'),
      'pro',
      20,
      1800
    );
    perform public.settle_document_allowance_with_result(
      'e6000000-0000-4000-8000-000000000001',
      (v_reservation->>'reservation_id')::uuid,
      v_request,
      split_part(v_route, '-', 2),
      'openai',
      10,
      5,
      v_payload
    );
    insert into replay_shape_state
      values (v_route, v_request, (v_reservation->>'reservation_id')::uuid, v_payload);
  end loop;
end;
$function$;

select is(
  (
    select count(*)::integer
    from private.document_allowance_results
    where user_id = 'e6000000-0000-4000-8000-000000000001'
  ),
  4,
  'all four legacy route response shapes are checkpointed exactly once'
);
select ok(
  not exists (
    select 1
    from replay_shape_state state_record
    cross join lateral (
      select public.reserve_document_allowance_with_result(
        'e6000000-0000-4000-8000-000000000001',
        state_record.request_id,
        state_record.route_key,
        encode(extensions.digest(convert_to(state_record.route_key, 'UTF8'), 'sha256'), 'hex'),
        'pro',
        20,
        1800
      ) replay
    ) replay_record
    where replay_record.replay->>'state' is distinct from 'settled'
  ),
  'every response shape replays only from settled state'
);
select ok(
  not exists (
    select 1
    from replay_shape_state state_record
    cross join lateral (
      select public.reserve_document_allowance_with_result(
        'e6000000-0000-4000-8000-000000000001',
        state_record.request_id,
        state_record.route_key,
        encode(extensions.digest(convert_to(state_record.route_key, 'UTF8'), 'sha256'), 'hex'),
        'pro',
        20,
        1800
      ) replay
    ) replay_record
    where replay_record.replay->'replay_result'
      is distinct from state_record.response_payload
  ),
  'commit-then-response-loss replay returns the exact immutable response for every shape'
);
select ok(
  not exists (
    select 1
    from replay_shape_state state_record
    cross join lateral (
      select public.reserve_document_allowance_with_result(
        'e6000000-0000-4000-8000-000000000001',
        state_record.request_id,
        state_record.route_key,
        encode(extensions.digest(convert_to(state_record.route_key, 'UTF8'), 'sha256'), 'hex'),
        'pro',
        20,
        1800
      ) replay
    ) replay_record
    where (replay_record.replay->>'provider_permitted')::boolean
      is distinct from false
  ),
  'settled replay never receives provider permission'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where user_id = 'e6000000-0000-4000-8000-000000000001'
      and event_type = 'document_created'
      and generation_request_id like 'checkpoint-%'
  ),
  4,
  'each committed route response consumes one allowance exactly once'
);
select is(
  public.settle_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000001',
    (select reservation_id from replay_shape_state where route_key = 'generate-document'),
    'checkpoint-document',
    'document',
    'openai',
    10,
    5,
    (select response_payload from replay_shape_state where route_key = 'generate-document')
  )->>'idempotent_replay',
  'true',
  'exact settlement replay is idempotent after response loss'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance_with_result(%L::uuid,%L::uuid,%L,%L,%L,%s,%s,%L::jsonb)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from replay_shape_state where route_key = 'generate-document'),
      'checkpoint-document',
      'document',
      'openai',
      10,
      5,
      '{"contract_version":"allowance-result.1","route_key":"generate-document","transport":"sse","payload":{"events":[{"type":"section","content":"changed"}]}}'
    ),
    '%ALLOWANCE_RESULT_REPLAY_CONFLICT%'
  ),
  'a committed allowance result rejects conflicting output replay'
);
select ok(
  pg_temp.raises_matching(
    $$update private.document_allowance_results
      set response_payload = jsonb_build_object('changed', true)
      where request_id = 'checkpoint-document'$$,
    '%IMMUTABLE_DOCUMENT_ALLOWANCE_RESULT%'
  ),
  'committed replay checkpoints are immutable'
);

select ok(
  pg_temp.raises_matching(
    format(
      'select public.settle_document_allowance_with_result(%L::uuid,%L::uuid,%L,%L,%L,%s,%s,%L::jsonb)',
      'e6000000-0000-4000-8000-000000000001',
      (select reservation_id from replay_shape_state where route_key = 'generate-document'),
      'checkpoint-document', 'document', 'openai', 11, 5,
      (select response_payload::text from replay_shape_state where route_key = 'generate-document')
    ),
    '%ALLOWANCE_SETTLEMENT_REPLAY_CONFLICT%'
  ),
  'settlement replay rejects contradictory task/provider/token facts'
);

insert into public.usage_ledger(
  user_id, event_type, generation_request_id, task, provider,
  input_tokens, output_tokens
) values (
  'e6000000-0000-4000-8000-000000000001', 'document_created',
  'historical-result-unavailable', 'document', 'openai', 1, 1
);
select is(
  public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000001',
    'historical-result-unavailable', 'generate-document', repeat('7', 64),
    'pro', 20, 1800
  )->>'completion_state',
  'completed_result_unavailable',
  'pre-migration settlement is terminal and explicitly reports unavailable output'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values (
  'e6000000-0000-4000-8000-000000000003',
  'provider-checkpoint@example.test', false, false, now(), now()
);
create temp table provider_checkpoint_state(
  reservation_id uuid not null,
  execution_claim_token uuid not null,
  original_execution_claim_token uuid not null,
  request_id text not null,
  request_sha256 text not null
);
with reservation as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'checkpoint-provider-result', 'generate-document', repeat('8', 64),
    'pro', 20, 1800
  ) value
)
insert into provider_checkpoint_state
select (value->>'reservation_id')::uuid,
  (value->>'execution_claim_token')::uuid,
  (value->>'execution_claim_token')::uuid,
  'checkpoint-provider-result', repeat('8', 64)
from reservation;

select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:summary:draft',
    repeat('8', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'attempt_number',
  '1',
  'the first scoped provider attempt receives durable monotonic admission'
);

select is(
  public.mark_legacy_model_attempt_dispatched(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:summary:draft',
    repeat('8', 64), 1,
    (select id from private.legacy_model_attempt_admissions
      where logical_request_id = 'checkpoint-provider-result'
        and logical_stage_key = 'generate-document.section:summary:draft'),
    (select execution_claim_token from provider_checkpoint_state),
    '81000000-0000-4000-8000-000000000001'
  )->>'state',
  'dispatched',
  'provider dispatch is durably acknowledged before fetch'
);

select is(
  public.record_legacy_model_call_attempt(
    'e6000000-0000-4000-8000-000000000003',
    'checkpoint-provider-result', 'generate-document.section:summary:draft',
    repeat('8', 64),
    (select id::text from private.legacy_model_attempt_admissions
      where logical_request_id = 'checkpoint-provider-result'
        and logical_stage_key = 'generate-document.section:summary:draft'),
    1, 'failed',
    'resp-invalid-json', 'completed', 'OPENAI_INVALID_STRUCTURED_OUTPUT',
    9, 2, '2026-09-01T01:00:00Z'::timestamptz,
    '2026-09-01T01:00:01Z'::timestamptz, 'gpt-5.6-sol',
    'routing.test.1', 'deep', 'medium', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    '{"version":"legacy-provider-result.1","text":"not-json","structured":null,"sources":[],"route_snapshot":{"provider":"openai","semanticRoute":"deep","model":"gpt-5.6-sol","reasoningEffort":"medium","routingVersion":"routing.test.1","structuredOutputSchemaVersion":"prompted_test_result","allowedTools":[],"timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null}}'::jsonb,
    (select execution_claim_token from provider_checkpoint_state)
  )->>'idempotent_replay',
  'false',
  'provider-completed locally invalid output atomically records usage and bounded output'
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:summary:draft',
    repeat('8', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'state',
  'replay',
  'exact retry receives the locally invalid completed output without provider permission'
);
select is(
  (
    select count(*)::integer
    from private.legacy_model_call_results
    where user_id = 'e6000000-0000-4000-8000-000000000003'
  ),
  1,
  'provider-completed checkpoint has exactly one immutable result row'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.read_legacy_model_call_checkpoint(%L::uuid,%L,%L::uuid,%L,%L,%L,%s,%L::uuid,%L::boolean)',
      'e6000000-0000-4000-8000-000000000003', 'generate-document',
      (select reservation_id from provider_checkpoint_state),
      'checkpoint-provider-result', 'generate-document.section:summary:draft',
      repeat('9', 64), 2,
      (select execution_claim_token from provider_checkpoint_state), true
    ),
    '%LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT%'
  ),
  'checkpoint request-hash drift fails closed before provider dispatch'
);

select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:retry-budget',
    repeat('a', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'attempt_number', '1',
  'retry budget allocates attempt one'
);
select public.mark_legacy_model_attempt_dispatched(
  'e6000000-0000-4000-8000-000000000003', 'generate-document',
  (select reservation_id from provider_checkpoint_state),
  'checkpoint-provider-result', 'generate-document.section:retry-budget',
  repeat('a', 64), 1,
  (select id from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:retry-budget'
      and attempt_number = 1),
  (select execution_claim_token from provider_checkpoint_state),
  '81000000-0000-4000-8000-000000000002'
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:retry-budget',
    repeat('a', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'state', 'attempt_unresolved',
  'attempt two cannot be allocated while attempt one lacks a terminal accounting row'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'checkpoint-provider-result',
  'generate-document.section:retry-budget', repeat('a', 64),
  (select id::text from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:retry-budget'
      and attempt_number = 1),
  1, 'failed', '', 'http_429',
  'OPENAI_UPSTREAM_ERROR', 0, 0, now(), now(), 'gpt-5.6-sol',
  'routing.test.1', 'deep', 'medium', 'generate-document',
  (select reservation_id from provider_checkpoint_state), null,
  (select execution_claim_token from provider_checkpoint_state)
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:retry-budget',
    repeat('a', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'attempt_number', '2',
  'attempt two is allocated only after attempt one is durably terminal'
);
select public.mark_legacy_model_attempt_dispatched(
  'e6000000-0000-4000-8000-000000000003', 'generate-document',
  (select reservation_id from provider_checkpoint_state),
  'checkpoint-provider-result', 'generate-document.section:retry-budget',
  repeat('a', 64), 2,
  (select id from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:retry-budget'
      and attempt_number = 2),
  (select execution_claim_token from provider_checkpoint_state),
  '81000000-0000-4000-8000-000000000003'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'checkpoint-provider-result',
  'generate-document.section:retry-budget', repeat('a', 64),
  (select id::text from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:retry-budget'
      and attempt_number = 2),
  2, 'failed', '', 'http_429',
  'OPENAI_UPSTREAM_ERROR', 0, 0, now(), now(), 'gpt-5.6-sol',
  'routing.test.1', 'deep', 'medium', 'generate-document',
  (select reservation_id from provider_checkpoint_state), null,
  (select execution_claim_token from provider_checkpoint_state)
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:retry-budget',
    repeat('a', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'state', 'terminal_error',
  'an exhausted retryable attempt replays its durable terminal error'
);
select public.read_legacy_model_call_checkpoint(
  'e6000000-0000-4000-8000-000000000003', 'generate-document',
  (select reservation_id from provider_checkpoint_state),
  'checkpoint-provider-result', 'generate-document.section:nonretryable',
  repeat('e', 64), 2,
  (select execution_claim_token from provider_checkpoint_state), true
);
select public.mark_legacy_model_attempt_dispatched(
  'e6000000-0000-4000-8000-000000000003', 'generate-document',
  (select reservation_id from provider_checkpoint_state),
  'checkpoint-provider-result', 'generate-document.section:nonretryable',
  repeat('e', 64), 1,
  (select id from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:nonretryable'),
  (select execution_claim_token from provider_checkpoint_state),
  '81000000-0000-4000-8000-000000000006'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'checkpoint-provider-result',
  'generate-document.section:nonretryable', repeat('e', 64),
  (select id::text from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:nonretryable'),
  1, 'failed', '', 'http_400', 'OPENAI_UPSTREAM_ERROR', 0, 0,
  now(), now(), 'gpt-5.6-sol', 'routing.test.1', 'deep', 'medium',
  'generate-document', (select reservation_id from provider_checkpoint_state),
  null, (select execution_claim_token from provider_checkpoint_state)
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:nonretryable',
    repeat('e', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'state',
  'terminal_error',
  'a nonretryable provider rejection replays without allocating attempt two'
);
select public.read_legacy_model_call_checkpoint(
  'e6000000-0000-4000-8000-000000000003', 'generate-document',
  (select reservation_id from provider_checkpoint_state),
  'checkpoint-provider-result', 'generate-document.section:cancelled',
  repeat('f', 64), 2,
  (select execution_claim_token from provider_checkpoint_state), true
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'checkpoint-provider-result',
  'generate-document.section:cancelled', repeat('f', 64),
  (select id::text from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key = 'generate-document.section:cancelled'),
  1, 'cancelled', '', 'cancelled', 'OPENAI_CANCELLED', 0, 0,
  now(), now(), 'gpt-5.6-sol', 'routing.test.1', 'deep', 'medium',
  'generate-document', (select reservation_id from provider_checkpoint_state),
  null, (select execution_claim_token from provider_checkpoint_state)
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from provider_checkpoint_state),
    'checkpoint-provider-result', 'generate-document.section:cancelled',
    repeat('f', 64), 2,
    (select execution_claim_token from provider_checkpoint_state), true
  )->>'state',
  'terminal_cancelled',
  'a pre-dispatch cancellation replays without allocating attempt two'
);
select is(
  (
    select count(*)::integer from private.legacy_model_attempt_admissions
    where logical_request_id = 'checkpoint-provider-result'
      and logical_stage_key in (
        'generate-document.section:summary:draft',
        'generate-document.section:nonretryable',
        'generate-document.section:cancelled'
      )
  ),
  3,
  'completed-invalid, nonretryable, and cancelled stages remain single-attempt'
);
select ok(
  (
    public.reserve_document_allowance_with_result(
      'e6000000-0000-4000-8000-000000000003',
      'checkpoint-provider-result', 'generate-document', repeat('8', 64),
      'pro', 20, 1800
    )->>'provider_permitted'
  )::boolean is false,
  'an active execution lease blocks a concurrent exact worker'
);
update private.legacy_generation_execution_claims
set heartbeat_at = pg_catalog.clock_timestamp() - interval '121 seconds',
    lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where reservation_id = (select reservation_id from provider_checkpoint_state);
with reclaimed as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'checkpoint-provider-result', 'generate-document', repeat('8', 64),
    'pro', 20, 1800
  ) value
), updated as (
  update provider_checkpoint_state
  set execution_claim_token = (select (value->>'execution_claim_token')::uuid from reclaimed)
  returning execution_claim_token
)
select ok(
  (select (value->>'provider_permitted')::boolean from reclaimed)
    and (select value->>'execution_reclaimed' from reclaimed) = 'true'
    and (select count(*) from updated) = 1,
  'an expired safe execution lease is reclaimed promptly on the same reservation'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.read_legacy_model_call_checkpoint(%L::uuid,%L,%L::uuid,%L,%L,%L,%s,%L::uuid,%L::boolean)',
      'e6000000-0000-4000-8000-000000000003', 'generate-document',
      (select reservation_id from provider_checkpoint_state),
      'checkpoint-provider-result', 'generate-document.section:summary:draft',
      repeat('8', 64), 2,
      (select original_execution_claim_token from provider_checkpoint_state), false
    ),
    '%LEGACY_GENERATION_EXECUTION_CLAIM_INVALID%'
  ),
  'a reclaimed lease fences the crashed worker token from all checkpoint access'
);
select is(
  (
    select count(*)::integer
    from private.legacy_model_attempt_admissions
    where user_id = 'e6000000-0000-4000-8000-000000000003'
      and logical_stage_key = 'generate-document.section:retry-budget'
  ),
  2,
  'serialized concurrent admission cannot create duplicate or excess attempts'
);
select ok(
  strpos(
    pg_get_functiondef(
      'public.read_legacy_model_call_checkpoint(uuid,text,uuid,text,text,text,integer,uuid,boolean)'::regprocedure
    ),
    'document_allowance_lock'
  ) < strpos(
    pg_get_functiondef(
      'public.read_legacy_model_call_checkpoint(uuid,text,uuid,text,text,text,integer,uuid,boolean)'::regprocedure
    ),
    'insert into private.legacy_model_attempt_admissions'
  ),
  'attempt allocation serializes on the allowance advisory lock before insertion'
);

create temp table atomic_unknown_state(
  reservation_id uuid not null,
  execution_claim_token uuid not null
);
with reservation as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'atomic-unknown-result', 'generate-checklist', repeat('b', 64),
    'pro', 20, 1800
  ) value
)
insert into atomic_unknown_state
select (value->>'reservation_id')::uuid,
  (value->>'execution_claim_token')::uuid from reservation;
select public.read_legacy_model_call_checkpoint(
  'e6000000-0000-4000-8000-000000000003', 'generate-checklist',
  (select reservation_id from atomic_unknown_state),
  'atomic-unknown-result', 'generate-checklist.primary', repeat('b', 64), 2,
  (select execution_claim_token from atomic_unknown_state), true
);
select public.mark_legacy_model_attempt_dispatched(
  'e6000000-0000-4000-8000-000000000003', 'generate-checklist',
  (select reservation_id from atomic_unknown_state),
  'atomic-unknown-result', 'generate-checklist.primary', repeat('b', 64), 1,
  (select id from private.legacy_model_attempt_admissions
    where logical_request_id = 'atomic-unknown-result'
      and logical_stage_key = 'generate-checklist.primary'),
  (select execution_claim_token from atomic_unknown_state),
  '81000000-0000-4000-8000-000000000004'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'atomic-unknown-result',
  'generate-checklist.primary', repeat('b', 64),
  (select id::text from private.legacy_model_attempt_admissions
    where logical_request_id = 'atomic-unknown-result'
      and logical_stage_key = 'generate-checklist.primary'),
  1,
  'unknown', '', 'ambiguous', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
  0, 0, '2026-09-01T01:01:00Z'::timestamptz,
  '2026-09-01T01:01:01Z'::timestamptz, 'gpt-5.6-sol',
  'routing.test.1', 'deep', 'medium', 'generate-checklist',
  (select reservation_id from atomic_unknown_state), null,
  (select execution_claim_token from atomic_unknown_state)
);
select ok(
  exists (
    select 1 from private.document_allowance_reservations
    where id = (select reservation_id from atomic_unknown_state)
      and status = 'reserved'
      and expires_at = 'infinity'::timestamptz
      and reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
  ),
  'unknown accounting and infinite reconciliation hold commit atomically'
);
select is(
  public.release_document_allowance(
    'e6000000-0000-4000-8000-000000000003',
    (select reservation_id from atomic_unknown_state),
    'atomic-unknown-result', 'provider_reconciliation_required'
  )->>'state',
  'reserved',
  'reconciliation hold is idempotent for the route boundary'
);
select ok(
  pg_temp.raises_matching(
    format(
      'update private.document_allowance_reservations set status=%L, release_code=%L, released_at=now() where id=%L::uuid',
      'released', 'manual-bypass', (select reservation_id from atomic_unknown_state)
    ),
    '%ALLOWANCE_RECONCILIATION_REQUIRED%'
  ),
  'held reservation cannot bypass reconciliation through privileged mutation'
);

create temp table undispatched_crash_state(
  reservation_id uuid not null,
  execution_claim_token uuid not null
);
with reservation as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'unresolved-crash-result', 'generate-document', repeat('c', 64),
    'pro', 20, 1800
  ) value
)
insert into undispatched_crash_state
select (value->>'reservation_id')::uuid,
  (value->>'execution_claim_token')::uuid from reservation;
select public.read_legacy_model_call_checkpoint(
  'e6000000-0000-4000-8000-000000000003', 'generate-document',
  (select reservation_id from undispatched_crash_state),
  'unresolved-crash-result', 'generate-document.intent', repeat('c', 64), 2,
  (select execution_claim_token from undispatched_crash_state), true
);
update private.legacy_generation_execution_claims
set heartbeat_at = pg_catalog.clock_timestamp() - interval '121 seconds',
    lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where reservation_id = (select reservation_id from undispatched_crash_state);
update private.document_allowance_reservations
set reserved_at = pg_catalog.clock_timestamp() - interval '1801 seconds',
    expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = (select reservation_id from undispatched_crash_state);
with reclaimed as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'unresolved-crash-result', 'generate-document', repeat('c', 64),
    'pro', 20, 1800
  ) value
), updated as (
  update undispatched_crash_state
  set execution_claim_token = (select (value->>'execution_claim_token')::uuid from reclaimed)
  returning execution_claim_token
)
select ok(
  (select (value->>'provider_permitted')::boolean from reclaimed)
    and (select value->>'execution_reclaimed' from reclaimed) = 'true'
    and (select count(*) from updated) = 1,
  'a prepared-but-undispatched attempt is safely reclaimed after its original TTL'
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'generate-document',
    (select reservation_id from undispatched_crash_state),
    'unresolved-crash-result', 'generate-document.intent', repeat('c', 64), 2,
    (select execution_claim_token from undispatched_crash_state), true
  )->>'attempt_number',
  '1',
  'safe reclaim resumes the same durable admission without consuming attempt two'
);
select is(
  (
    select count(*)::integer from private.legacy_model_attempt_admissions
    where logical_request_id = 'unresolved-crash-result'
  ),
  1,
  'safe reclaim cannot duplicate the undispatched provider admission'
);

create temp table dispatched_crash_state(
  reservation_id uuid not null,
  execution_claim_token uuid not null
);
with reservation as (
  select public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'dispatched-crash-result', 'generate-checklist', repeat('d', 64),
    'pro', 20, 1800
  ) value
)
insert into dispatched_crash_state
select (value->>'reservation_id')::uuid,
  (value->>'execution_claim_token')::uuid from reservation;
select public.read_legacy_model_call_checkpoint(
  'e6000000-0000-4000-8000-000000000003', 'generate-checklist',
  (select reservation_id from dispatched_crash_state),
  'dispatched-crash-result', 'generate-checklist.primary', repeat('d', 64), 2,
  (select execution_claim_token from dispatched_crash_state), true
);
select public.mark_legacy_model_attempt_dispatched(
  'e6000000-0000-4000-8000-000000000003', 'generate-checklist',
  (select reservation_id from dispatched_crash_state),
  'dispatched-crash-result', 'generate-checklist.primary', repeat('d', 64), 1,
  (select id from private.legacy_model_attempt_admissions
    where logical_request_id = 'dispatched-crash-result'),
  (select execution_claim_token from dispatched_crash_state),
  '81000000-0000-4000-8000-000000000005'
);
update private.legacy_generation_execution_claims
set heartbeat_at = pg_catalog.clock_timestamp() - interval '121 seconds',
    lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where reservation_id = (select reservation_id from dispatched_crash_state);
update private.document_allowance_reservations
set reserved_at = pg_catalog.clock_timestamp() - interval '1801 seconds',
    expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = (select reservation_id from dispatched_crash_state);
select is(
  public.reserve_document_allowance_with_result(
    'e6000000-0000-4000-8000-000000000003',
    'dispatched-crash-result', 'generate-checklist', repeat('d', 64),
    'pro', 20, 1800
  )->>'state',
  'awaiting_reconciliation',
  'a dispatched attempt cannot redispatch even after the original allowance TTL'
);
select ok(
  exists (
    select 1 from private.document_allowance_reservations
    where id = (select reservation_id from dispatched_crash_state)
      and expires_at = 'infinity'::timestamptz
      and reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
  ),
  'a dispatched crash becomes an infinite cap-counting reconciliation hold'
);

-- Every guarded non-allowance route uses the same admission/checkpoint
-- authority with a server-minted claim and no allowance origin.
create temp table generic_checkpoint_state as
select result->>'attempt_admission_id' admission_id,
  (result->>'execution_claim_token')::uuid claim_token
from (
  select public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-request-one', 'clarify.primary', repeat('1', 64), 2, null, true
  ) result
) prepared;
select ok(
  (select admission_id is not null and claim_token is not null
    from generic_checkpoint_state),
  'generic admission mints a durable claim without an allowance origin'
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-request-one', 'clarify.primary', repeat('1', 64), 2, null, true
  )->>'state',
  'in_progress',
  'a live prepared generic claim reports in progress rather than reconciliation'
);
select is(
  public.mark_legacy_model_attempt_dispatched(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-request-one', 'clarify.primary', repeat('1', 64), 1,
    (select admission_id::uuid from generic_checkpoint_state),
    (select claim_token from generic_checkpoint_state),
    '83000000-0000-4000-8000-000000000001'
  )->>'provider_attempt_id',
  (select admission_id from generic_checkpoint_state),
  'generic dispatch uses the durable admission UUID as provider attempt identity'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'generic-request-one',
  'clarify.primary', repeat('1', 64),
  (select admission_id from generic_checkpoint_state),
  1, 'succeeded', 'resp-generic-one', 'completed', null, 4, 3,
  now(), now(), 'gpt-5.6-luna', 'routing.test.1', 'fast', 'low',
  'clarify', null,
  '{"version":"legacy-provider-result.1","text":"clarified","structured":null,"sources":[],"route_snapshot":{"provider":"openai","semanticRoute":"fast","model":"gpt-5.6-luna","reasoningEffort":"low","routingVersion":"routing.test.1","structuredOutputSchemaVersion":"prompted_test_result","allowedTools":[],"timeoutMs":30000,"maxAttempts":2,"background":false,"store":false,"fallback":null}}'::jsonb,
  (select claim_token from generic_checkpoint_state)
);
select ok(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-request-one', 'clarify.primary', repeat('1', 64), 2, null, true
  )->>'state' = 'replay'
  and exists (
    select 1 from public.usage_ledger
    where logical_request_id = 'generic-request-one'
      and checkpoint_scope = 'clarify'
  ),
  'generic success atomically persists route-scoped usage and replay output'
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'recommend', null,
    'generic-request-one', 'clarify.primary', repeat('1', 64), 2, null, true
  )->>'state',
  'prepared',
  'a different route scope cannot cross-replay another route result'
);
select ok(
  pg_temp.raises_matching(
    $$select public.read_legacy_model_call_checkpoint(
      'e6000000-0000-4000-8000-000000000003', 'clarify', null,
      'generic-request-one', 'clarify.primary', repeat('2', 64), 2, null, true
    )$$,
    '%LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT%'
  ),
  'generic request-hash drift fails closed'
);
select ok(
  pg_temp.raises_matching(
    $$select public.read_legacy_model_call_checkpoint(
      'e6000000-0000-4000-8000-000000000003', 'clarify',
      '83000000-0000-4000-8000-000000000099'::uuid,
      'invalid-origin', 'clarify.primary', repeat('3', 64), 2, null, true
    )$$,
    '%LEGACY_MODEL_CHECKPOINT_INPUT_INVALID%'
  ),
  'generic routes reject allowance-origin spoofing'
);

create temp table generic_late_state as
select (result->>'attempt_admission_id')::uuid admission_id,
  (result->>'execution_claim_token')::uuid claim_token
from (
  select public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-late-result', 'clarify.primary', repeat('4', 64), 2, null, true
  ) result
) prepared;
select public.mark_legacy_model_attempt_dispatched(
  'e6000000-0000-4000-8000-000000000003', 'clarify', null,
  'generic-late-result', 'clarify.primary', repeat('4', 64), 1,
  (select admission_id from generic_late_state),
  (select claim_token from generic_late_state),
  '83000000-0000-4000-8000-000000000002'
);
update private.legacy_model_attempt_admissions
set heartbeat_at = pg_catalog.clock_timestamp() - interval '121 seconds',
    lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = (select admission_id from generic_late_state);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-late-result', 'clarify.primary', repeat('4', 64), 2, null, true
  )->>'state',
  'awaiting_reconciliation',
  'an observer blocks an expired dispatched generic attempt without redispatch'
);
select public.record_legacy_model_call_attempt(
  'e6000000-0000-4000-8000-000000000003', 'generic-late-result',
  'clarify.primary', repeat('4', 64),
  (select admission_id::text from generic_late_state), 1, 'succeeded',
  'resp-generic-late', 'completed', null, 5, 4, now(), now(),
  'gpt-5.6-luna', 'routing.test.1', 'fast', 'low', 'clarify', null,
  '{"version":"legacy-provider-result.1","text":"late but exact","structured":null,"sources":[],"route_snapshot":{"provider":"openai","semanticRoute":"fast","model":"gpt-5.6-luna","reasoningEffort":"low","routingVersion":"routing.test.1","structuredOutputSchemaVersion":"prompted_test_result","allowedTools":[],"timeoutMs":30000,"maxAttempts":2,"background":false,"store":false,"fallback":null}}'::jsonb,
  (select claim_token from generic_late_state)
);
select is(
  public.read_legacy_model_call_checkpoint(
    'e6000000-0000-4000-8000-000000000003', 'clarify', null,
    'generic-late-result', 'clarify.primary', repeat('4', 64), 2, null, true
  )->>'state',
  'replay',
  'the original admitted claimant can atomically resolve an observer hold'
);

-- Real two-session proof: one transaction allocates the durable attempt while
-- the other waits on the same allowance lock. Both observe attempt one, then
-- distinct dispatch nonces compete and exactly one transition is accepted.
select extensions.dblink_connect(
  'legacy_attempt_concurrent_one',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'legacy_attempt_concurrent_two',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'legacy_attempt_concurrent_one',
  $sql$
    insert into auth.users(
      id, email, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      'e6000000-0000-4000-8000-000000000099',
      'legacy-attempt-concurrent@example.test', false, false, now(), now()
    )
  $sql$
);
select is(
  (
    select result->>'state'
    from extensions.dblink(
      'legacy_attempt_concurrent_one',
      $sql$
        select public.read_legacy_model_call_checkpoint(
          'e6000000-0000-4000-8000-000000000099', 'clarify', null,
          'generic-request-one', 'clarify.primary', repeat('1', 64),
          2, null, true
        )
      $sql$
    ) as remote_result(result jsonb)
  ),
  'prepared',
  'another user cannot observe or replay the first user generic result'
);
create temp table concurrent_attempt_state as
select (result->>'reservation_id')::uuid reservation_id,
  (result->>'execution_claim_token')::uuid execution_claim_token
from extensions.dblink(
  'legacy_attempt_concurrent_one',
  $sql$
    select public.reserve_document_allowance_with_result(
      'e6000000-0000-4000-8000-000000000099',
      'concurrent-attempt-result', 'generate-checklist', repeat('9', 64),
      'pro', 20, 1800
    )
  $sql$
) as remote_result(result jsonb);
select extensions.dblink_exec('legacy_attempt_concurrent_one', 'begin');
create temp table concurrent_first_admission as
select result
from extensions.dblink(
  'legacy_attempt_concurrent_one',
  format(
    'select public.read_legacy_model_call_checkpoint(%L::uuid,%L,%L::uuid,%L,%L,%L,%s,%L::uuid,true)',
    'e6000000-0000-4000-8000-000000000099', 'generate-checklist',
    (select reservation_id from concurrent_attempt_state),
    'concurrent-attempt-result', 'generate-checklist.primary', repeat('9', 64),
    2, (select execution_claim_token from concurrent_attempt_state)
  )
) as remote_result(result jsonb);
select is(
  extensions.dblink_send_query(
    'legacy_attempt_concurrent_two',
    format(
      'select public.read_legacy_model_call_checkpoint(%L::uuid,%L,%L::uuid,%L,%L,%L,%s,%L::uuid,true)',
      'e6000000-0000-4000-8000-000000000099', 'generate-checklist',
      (select reservation_id from concurrent_attempt_state),
      'concurrent-attempt-result', 'generate-checklist.primary', repeat('9', 64),
      2, (select execution_claim_token from concurrent_attempt_state)
    )
  ),
  1,
  'the second provider-attempt admission starts while attempt one is uncommitted'
);
select extensions.dblink_exec('legacy_attempt_concurrent_one', 'commit');
create temp table concurrent_second_admission as
select result
from extensions.dblink_get_result('legacy_attempt_concurrent_two', false)
  as remote_result(result jsonb);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('legacy_attempt_concurrent_two', false)
      as drained_result(result jsonb)
  ),
  0,
  'the first asynchronous admission result is fully drained'
);
select is(
  extensions.dblink_is_busy('legacy_attempt_concurrent_two'),
  0,
  'the competing connection is idle before the dispatch race'
);
select ok(
  (select result->>'attempt_number' from concurrent_first_admission) = '1'
    and (select result->>'attempt_number' from concurrent_second_admission) = '1'
    and (select result->>'attempt_admission_id' from concurrent_first_admission)
      = (select result->>'attempt_admission_id' from concurrent_second_admission),
  'concurrent allocation returns one shared durable attempt and never attempt two'
);
select extensions.dblink_exec('legacy_attempt_concurrent_one', 'begin');
select is(
  (
    select result->>'state'
    from extensions.dblink(
      'legacy_attempt_concurrent_one',
      format(
        'select public.mark_legacy_model_attempt_dispatched(%L::uuid,%L,%L::uuid,%L,%L,%L,%s,%L::uuid,%L::uuid,%L::uuid)',
        'e6000000-0000-4000-8000-000000000099', 'generate-checklist',
        (select reservation_id from concurrent_attempt_state),
        'concurrent-attempt-result', 'generate-checklist.primary', repeat('9', 64),
        1,
        (select (result->>'attempt_admission_id')::uuid from concurrent_first_admission),
        (select execution_claim_token from concurrent_attempt_state),
        '82000000-0000-4000-8000-000000000001'
      )
    ) as remote_result(result jsonb)
  ),
  'dispatched',
  'the first concurrent worker owns the durable dispatch transition'
);
select is(
  extensions.dblink_send_query(
    'legacy_attempt_concurrent_two',
    format(
      'select public.mark_legacy_model_attempt_dispatched(%L::uuid,%L,%L::uuid,%L,%L,%L,%s,%L::uuid,%L::uuid,%L::uuid)',
      'e6000000-0000-4000-8000-000000000099', 'generate-checklist',
      (select reservation_id from concurrent_attempt_state),
      'concurrent-attempt-result', 'generate-checklist.primary', repeat('9', 64),
      1,
      (select (result->>'attempt_admission_id')::uuid from concurrent_first_admission),
      (select execution_claim_token from concurrent_attempt_state),
      '82000000-0000-4000-8000-000000000002'
    )
  ),
  1,
  'the competing dispatch starts while the first transition is uncommitted'
);
select is(
  extensions.dblink_is_busy('legacy_attempt_concurrent_two'),
  1,
  'the competing dispatch waits on the uncommitted durable transition'
);
select extensions.dblink_exec('legacy_attempt_concurrent_one', 'commit');
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('legacy_attempt_concurrent_two', false)
      as remote_result(result jsonb)
  ),
  0,
  'the competing dispatch cannot return provider permission'
);
select ok(
  extensions.dblink_error_message('legacy_attempt_concurrent_two')
    like '%LEGACY_MODEL_ATTEMPT_ALREADY_DISPATCHED%',
  'a distinct concurrent dispatch token is rejected after lock release'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('legacy_attempt_concurrent_two', false)
      as drained_result(result jsonb)
  ),
  0,
  'the rejected dispatch result is fully drained'
);
select is(
  extensions.dblink_is_busy('legacy_attempt_concurrent_two'),
  0,
  'the competing connection is idle before the generic admission race'
);
select extensions.dblink_exec('legacy_attempt_concurrent_one', 'begin');
create temp table generic_concurrent_first as
select result
from extensions.dblink(
  'legacy_attempt_concurrent_one',
  $sql$
    select public.read_legacy_model_call_checkpoint(
      'e6000000-0000-4000-8000-000000000099', 'clarify', null,
      'generic-concurrent-request', 'clarify.primary', repeat('5', 64),
      2, null, true
    )
  $sql$
) as remote_result(result jsonb);
select is(
  extensions.dblink_send_query(
    'legacy_attempt_concurrent_two',
    $sql$
      select public.read_legacy_model_call_checkpoint(
        'e6000000-0000-4000-8000-000000000099', 'clarify', null,
        'generic-concurrent-request', 'clarify.primary', repeat('5', 64),
        2, null, true
      )
    $sql$
  ),
  1,
  'a second generic caller overlaps while the first durable admission is uncommitted'
);
select extensions.dblink_exec('legacy_attempt_concurrent_one', 'commit');
create temp table generic_concurrent_second as
select result
from extensions.dblink_get_result('legacy_attempt_concurrent_two', false)
  as remote_result(result jsonb);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('legacy_attempt_concurrent_two', false)
      as drained_result(result jsonb)
  ),
  0,
  'the generic asynchronous admission result is fully drained'
);
select ok(
  (select result->>'state' from generic_concurrent_first) = 'prepared'
    and (select result->>'state' from generic_concurrent_second) = 'in_progress'
    and (
      select count(*) from private.legacy_model_attempt_admissions
      where user_id = 'e6000000-0000-4000-8000-000000000099'
        and checkpoint_scope = 'clarify'
        and logical_request_id = 'generic-concurrent-request'
    ) = 1,
  'concurrent generic callers share one admission and only the owner may fetch'
);
select extensions.dblink_exec(
  'legacy_attempt_concurrent_one',
  $sql$
    delete from auth.users
    where id = 'e6000000-0000-4000-8000-000000000099'
  $sql$
);
select extensions.dblink_disconnect('legacy_attempt_concurrent_one');
select extensions.dblink_disconnect('legacy_attempt_concurrent_two');

delete from auth.users where id = 'e6000000-0000-4000-8000-000000000003';
select is(
  (
    select count(*)::integer
    from private.legacy_model_call_results
    where user_id = 'e6000000-0000-4000-8000-000000000003'
  ) + (
    select count(*)::integer
    from private.legacy_model_attempt_admissions
    where user_id = 'e6000000-0000-4000-8000-000000000003'
  ) + (
    select count(*)::integer
    from private.legacy_generation_execution_claims
    where user_id = 'e6000000-0000-4000-8000-000000000003'
  ),
  0,
  'owner deletion cascades private checkpoint and attempt-admission rows'
);

select * from finish();
rollback;
