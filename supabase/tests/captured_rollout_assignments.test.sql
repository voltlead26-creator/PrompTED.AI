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

create temp table rollout_test_state (
  owner_id uuid not null,
  other_id uuid not null,
  owner_outcome_id uuid not null,
  other_outcome_id uuid not null,
  first_document_id uuid not null,
  second_document_id uuid not null,
  denied_document_id uuid not null,
  operation_id uuid,
  operation_lease_token uuid,
  assignment_id uuid,
  early_resume_receipt jsonb,
  due_resume_receipt jsonb,
  contract_json jsonb not null,
  contract_hash text,
  route_snapshot jsonb not null
);

insert into rollout_test_state values (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000003',
  null,
  null,
  null,
  null,
  null,
  '{
    "schemaVersion":"1.0.0",
    "ledgerVersion":"rollout-test.1",
    "templates":{
      "resume":{
        "sections":[
          {"sectionKey":"summary","name":"Summary","required":true,"missingInformationBehaviour":"askClarifyingQuestion"}
        ]
      }
    }
  }'::jsonb,
  null,
  '{
    "provider":"openai",
    "routingVersion":"routing.rollout-test.1",
    "routes":{
      "deep":{
        "provider":"openai","semanticRoute":"deep","model":"gpt-test-deep",
        "reasoningEffort":"medium","routingVersion":"routing.rollout-test.1",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      },
      "review":{
        "provider":"openai","semanticRoute":"review","model":"gpt-test-review",
        "reasoningEffort":"high","routingVersion":"routing.rollout-test.1",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      }
    }
  }'::jsonb
);

update rollout_test_state
set contract_hash = encode(
  extensions.digest(convert_to(contract_json::text, 'UTF8'), 'sha256'),
  'hex'
);

create or replace function pg_temp.assigned_accept_sql(
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_idempotency_key text
) returns text
language sql
as $function$
  select format(
    'select public.accept_assigned_captured_document_operation(%L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L,%L,%L,%s,%L,%L::jsonb,%L::jsonb,%L::jsonb,%L,%L,%L::text[],%L::text[],%L::text[],%L::jsonb,%s)',
    p_user_id,
    p_outcome_id,
    p_document_id,
    'Synthetic assigned resume',
    'local',
    'generate_document',
    'resume',
    'resume-benchmark.1',
    'pipeline-test.1',
    1,
    p_idempotency_key,
    '{"confirmed_name":"Synthetic Person"}',
    '{"sourceRefs":["synthetic:user-answer"]}',
    '{"facts":["confirmed_name"]}',
    'en-AU',
    'AU',
    '{summary}',
    '{}',
    '{}',
    '{}',
    86400
  )
$function$;

select has_table(
  'private',
  'captured_document_rollout_assignments',
  'private current rollout assignments exist'
);
select has_table(
  'private',
  'captured_document_rollout_assignment_revisions',
  'immutable rollout assignment history exists'
);
select has_column(
  'private',
  'captured_document_operations',
  'rollout_assignment_id',
  'accepted operations bind the exact rollout assignment'
);
select has_column(
  'private',
  'captured_document_operations',
  'rollout_assignment_revision',
  'accepted operations bind the exact assignment revision'
);
select has_function(
  'public',
  'configure_captured_document_rollout_assignment',
  array['uuid','text','text','text','text','boolean','integer','text','text'],
  'service-only explicit assignment command exists'
);
select has_function(
  'public',
  'accept_assigned_captured_document_operation',
  array[
    'uuid','uuid','uuid','text','text','text','text','text','text','integer',
    'text','jsonb','jsonb','jsonb','text','text','text[]','text[]','text[]','jsonb','integer'
  ],
  'service-only server-resolved acceptance command exists'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_table_privilege(
    'authenticated',
    'private.captured_document_rollout_assignments',
    'SELECT'
  )
  and not has_table_privilege(
    'service_role',
    'private.captured_document_rollout_assignments',
    'SELECT'
  ),
  'rollout assignments are unavailable through direct Data API table access'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.configure_captured_document_rollout_assignment(uuid,text,text,text,text,boolean,integer,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.configure_captured_document_rollout_assignment(uuid,text,text,text,text,boolean,integer,text,text)',
    'EXECUTE'
  ),
  'only the protected service boundary can change assignments'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.accept_assigned_captured_document_operation(uuid,uuid,uuid,text,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,text,text[],text[],text[],jsonb,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.accept_assigned_captured_document_operation(uuid,uuid,uuid,text,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,text,text[],text[],text[],jsonb,integer)',
    'EXECUTE'
  ),
  'only protected server code can submit assigned acceptance'
);
select is(
  (select count(*)::integer from private.captured_document_rollout_assignments),
  0,
  'the additive migration assigns no user by default'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
select owner_id, 'rollout-owner@example.invalid', false, false, now(), now()
from rollout_test_state
union all
select other_id, 'rollout-other@example.invalid', false, false, now(), now()
from rollout_test_state;

insert into public.outcomes(id, user_id, situation_text)
select owner_outcome_id, owner_id, 'Synthetic owner rollout outcome'
from rollout_test_state
union all
select other_outcome_id, other_id, 'Synthetic other rollout outcome'
from rollout_test_state;

select lives_ok(
  format(
    'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
    '1.0.0', 'rollout-test.1', contract_json::text, contract_hash, 'pgtap'
  ),
  'the synthetic ledger registers through the immutable ledger boundary'
)
from rollout_test_state;

select lives_ok(
  format(
    'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
    'local', 'internal', 'generate_document', 'resume',
    'rollout-test.1', 'routing.rollout-test.1', route_snapshot::text,
    true, 0, 'pgtap', 'enable exact rollout test activation'
  ),
  'one exact activation can be enabled without assigning every user'
)
from rollout_test_state;

select ok(
  pg_temp.raises_matching(
    pg_temp.assigned_accept_sql(
      owner_id,
      owner_outcome_id,
      first_document_id,
      'rollout-denied-before-assignment'
    ),
    '%CAPTURED_ROLLOUT_NOT_ASSIGNED%'
  ),
  'an enabled cohort still denies an unassigned owner before persistence'
)
from rollout_test_state;
select is(
  (
    select count(*)::integer
    from private.captured_document_operations
    where user_id = (select owner_id from rollout_test_state)
  ),
  0,
  'denied rollout admission creates no durable operation or provider authority'
);

select ok(
  pg_temp.raises_matching(
    format(
      'select public.configure_captured_document_rollout_assignment(%L::uuid,%L,%L,%L,%L,%L,%s,%L,%L)',
      owner_id,
      'local',
      'internal',
      'generate_document',
      'resume',
      true,
      0,
      'pgtap',
      'must fail before measured capacity exists'
    ),
    '%CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE:deep%'
  ),
  'an assignment cannot activate before every required route has measured capacity'
)
from rollout_test_state;
select is(
  (select count(*)::integer from private.captured_document_rollout_assignments),
  0,
  'failed capacity activation creates no partial rollout assignment'
);

select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'deep', true,
    2, 1, 10, 600, 180, 5,
    0, 'pgtap', 'synthetic exclusive Sol deep allocation'
  )$$,
  'the deep route receives an explicit measured allocation'
);
select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'review', true,
    1, 1, 10, 400, 180, 5,
    0, 'pgtap', 'synthetic exclusive Sol review allocation'
  )$$,
  'the review route receives a separate explicit allocation'
);

select lives_ok(
  format(
    'select public.configure_captured_document_rollout_assignment(%L::uuid,%L,%L,%L,%L,%L,%s,%L,%L)',
    owner_id,
    'local',
    'internal',
    'generate_document',
    'resume',
    true,
    0,
    'pgtap',
    'explicit internal owner allowlist'
  ),
  'the service boundary assigns one explicit internal owner'
)
from rollout_test_state;

update rollout_test_state state_record
set assignment_id = assignment_record.id
from private.captured_document_rollout_assignments assignment_record
where assignment_record.user_id = state_record.owner_id
  and assignment_record.environment = 'local'
  and assignment_record.workflow = 'generate_document'
  and assignment_record.template_id = 'resume';

select is(
  (
    select assignment_revision::text || ':' || enabled::text || ':' || user_cohort
    from private.captured_document_rollout_assignments
    where id = (select assignment_id from rollout_test_state)
  ),
  '1:true:internal',
  'the explicit assignment begins at immutable revision one'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_rollout_assignment_revisions
    where assignment_id = (select assignment_id from rollout_test_state)
      and assignment_revision = 1
      and enabled
  ),
  1,
  'the assignment decision is retained in append-only history'
);

select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'deep', false,
    2, 1, 10, 600, 180, 5,
    1, 'pgtap', 'synthetic capacity rollback before operation acceptance'
  )$$,
  'the deep route can be disabled without rewriting the assignment'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.assigned_accept_sql(
      owner_id,
      owner_outcome_id,
      first_document_id,
      'rollout-capacity-disabled'
    ),
    '%CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE:deep%'
  ),
  'new operation acceptance independently fails closed after route disablement'
)
from rollout_test_state;
select is(
  (
    select count(*)::integer
    from private.captured_document_operations
    where idempotency_key = 'rollout-capacity-disabled'
  ),
  0,
  'a capacity-gate rejection creates no operation or provider authority'
);
select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'deep', true,
    2, 1, 10, 600, 180, 5,
    2, 'pgtap', 'restore synthetic capacity before acceptance'
  )$$,
  'capacity restoration is an explicit compare-and-swap revision'
);

select lives_ok(
  pg_temp.assigned_accept_sql(
    owner_id,
    owner_outcome_id,
    first_document_id,
    'rollout-accepted'
  ),
  'the assigned owner is admitted through the server-resolved boundary'
)
from rollout_test_state;

update rollout_test_state state_record
set operation_id = operation_record.id
from private.captured_document_operations operation_record
where operation_record.user_id = state_record.owner_id
  and operation_record.idempotency_key = 'rollout-accepted';

select is(
  (
    select rollout_assignment_id::text || ':' || rollout_assignment_revision::text
    from private.captured_document_operations
    where id = (select operation_id from rollout_test_state)
  ),
  (
    select assignment_id::text || ':1'
    from rollout_test_state
  ),
  'operation acceptance atomically freezes the exact assignment revision'
);

select ok(
  pg_temp.raises_matching(
    pg_temp.assigned_accept_sql(
      other_id,
      other_outcome_id,
      denied_document_id,
      'rollout-other-denied'
    ),
    '%CAPTURED_ROLLOUT_NOT_ASSIGNED%'
  ),
  'another authenticated owner cannot inherit the allowlisted assignment'
)
from rollout_test_state;

select lives_ok(
  format(
    'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
    operation_id, 1, 'pgtap-capacity-worker', 300
  ),
  'the accepted operation is claimed before durable generation begins'
)
from rollout_test_state;

update rollout_test_state state_record
set operation_lease_token = operation_record.lease_token
from private.captured_document_operations operation_record
where operation_record.id = state_record.operation_id;

select ok(
  operation_lease_token is not null,
  'the operation claim persists an opaque lease token'
)
from rollout_test_state;

select lives_ok(
  format(
    'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb)',
    operation_id,
    2,
    operation_lease_token,
    'generating',
    '{"test":"capacity-wait"}'
  ),
  'the claimed operation advances to durable generation state'
)
from rollout_test_state;

select lives_ok(
  format(
    'select public.defer_captured_document_operation_for_capacity(%L::uuid,%s,%L::uuid,%L,%s)',
    operation_id,
    3,
    operation_lease_token,
    'deep',
    5
  ),
  'capacity pressure durably defers the same logical operation'
)
from rollout_test_state;

update rollout_test_state
set early_resume_receipt = public.resume_captured_document_operation_from_capacity(
  operation_id,
  4,
  'pgtap-capacity-resume',
  300
);

select ok(
  early_resume_receipt @> '{
    "status":"awaiting_capacity",
    "operation_revision":4,
    "capacity_resume_deferred":true,
    "resume_available":false,
    "lease_token":null
  }'::jsonb,
  'an early resume returns the durable retry receipt without claiming work'
)
from rollout_test_state;

select is(
  (
    select status || ':' || operation_revision::text || ':' ||
      (lease_token is null)::text || ':' ||
      (capacity_wait_started_at is not null)::text || ':' ||
      (capacity_retry_after_at is not null)::text || ':' ||
      capacity_semantic_route
    from private.captured_document_operations
    where id = (select operation_id from rollout_test_state)
  ),
  'awaiting_capacity:4:true:true:true:deep',
  'an early resume leaves persisted operation and capacity timing unchanged'
);

select is(
  (
    select count(*)::integer
    from private.captured_document_operation_events
    where operation_id = (select operation_id from rollout_test_state)
      and event_type = 'capacity_wait_started'
  ),
  1,
  'capacity defer appends exactly one durable wait-start event'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_operation_events
    where operation_id = (select operation_id from rollout_test_state)
      and event_type = 'capacity_wait_resumed'
  ),
  0,
  'an early resume appends no false completion event'
);

update private.captured_document_operations
set capacity_retry_after_at = capacity_wait_started_at
where id = (select operation_id from rollout_test_state);

update rollout_test_state
set due_resume_receipt = public.resume_captured_document_operation_from_capacity(
  operation_id,
  4,
  'pgtap-capacity-resume',
  300
);

select ok(
  due_resume_receipt @> '{
    "status":"generating",
    "operation_revision":5,
    "capacity_resume_deferred":false,
    "resumed_from_capacity_wait":true,
    "retryable":false
  }'::jsonb
  and due_resume_receipt ->> 'lease_token' is not null,
  'a due resume returns one new worker lease on the same operation'
)
from rollout_test_state;

select is(
  (
    select status || ':' || operation_revision::text || ':' ||
      (lease_token is not null)::text || ':' || lease_owner || ':' ||
      (lease_expires_at > clock_timestamp())::text || ':' ||
      (capacity_wait_started_at is null)::text || ':' ||
      (capacity_retry_after_at is null)::text || ':' ||
      (capacity_semantic_route is null)::text
    from private.captured_document_operations
    where id = (select operation_id from rollout_test_state)
  ),
  'generating:5:true:pgtap-capacity-resume:true:true:true:true',
  'a due resume clears wait metadata and persists one current worker lease'
);

select is(
  (
    select count(*)::integer
    from private.captured_document_operation_events
    where operation_id = (select operation_id from rollout_test_state)
      and event_type = 'capacity_wait_resumed'
      and operation_revision = 5
      and metadata ->> 'semantic_route' = 'deep'
      and metadata ->> 'lease_owner' = 'pgtap-capacity-resume'
  ),
  1,
  'a due resume appends exactly one attributed capacity-resumed event'
);

select ok(
  pg_temp.raises_matching(
    format(
      'select public.configure_captured_document_rollout_assignment(%L::uuid,%L,%L,%L,%L,%L,%s,%L,%L)',
      owner_id, 'local', 'internal', 'generate_document', 'resume',
      false, 0, 'pgtap', 'stale disable'
    ),
    '%CAPTURED_ROLLOUT_ASSIGNMENT_REVISION_CONFLICT%'
  ),
  'assignment changes require compare-and-swap revision authority'
)
from rollout_test_state;

select lives_ok(
  format(
    'select public.configure_captured_document_rollout_assignment(%L::uuid,%L,%L,%L,%L,%L,%s,%L,%L)',
    owner_id, 'local', 'internal', 'generate_document', 'resume',
    false, 1, 'pgtap', 'disable new captured admissions'
  ),
  'the exact assignment can be disabled for new operations'
)
from rollout_test_state;

select lives_ok(
  pg_temp.assigned_accept_sql(
    owner_id,
    owner_outcome_id,
    first_document_id,
    'rollout-accepted'
  ),
  'an exact accepted-operation replay survives later assignment disablement'
)
from rollout_test_state;
select is(
  (
    select count(*)::integer
    from private.captured_document_operations
    where user_id = (select owner_id from rollout_test_state)
      and idempotency_key = 'rollout-accepted'
  ),
  1,
  'assignment rollback cannot duplicate or replace the accepted operation'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.assigned_accept_sql(
      owner_id,
      owner_outcome_id,
      second_document_id,
      'rollout-disabled-new-operation'
    ),
    '%CAPTURED_ROLLOUT_NOT_ASSIGNED%'
  ),
  'disabling the assignment denies only new captured operations'
)
from rollout_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'update private.captured_document_rollout_assignment_revisions set change_reason = %L where assignment_id = %L::uuid and assignment_revision = 1',
      'rewrite history',
      assignment_id
    ),
    '%IMMUTABLE_CAPTURED_ROLLOUT_ASSIGNMENT%'
  ),
  'assignment history cannot be rewritten'
)
from rollout_test_state;

select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'configure_captured_document_rollout_assignment',
        'accept_assigned_captured_document_operation'
      )
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  ),
  2,
  'rollout commands are SECURITY DEFINER with an empty search path'
);

select * from finish();
rollback;
