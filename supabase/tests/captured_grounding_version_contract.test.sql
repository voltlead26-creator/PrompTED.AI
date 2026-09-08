begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Minimal synthetic contracts exercise SQL version admission, not the real
-- catalogue's wording quality. No activation survives this transaction.
create temp table grounding_version_fixture (
  owner_id uuid not null,
  outcome_id uuid not null,
  contract_v1 jsonb not null,
  contract_v2 jsonb not null,
  route_v1 jsonb not null,
  route_v2 jsonb not null
);
insert into grounding_version_fixture
select
  '99060000-0000-4000-8000-000000000001'::uuid,
  '99060000-0000-4000-8000-000000000002'::uuid,
  contract,
  jsonb_set(
    jsonb_set(contract, '{ledgerVersion}', '"ledger.2026-09-first-cohort.2"'),
    '{templates,resume,validationPolicy}',
    '{"groundingReview":"exact_wording_v2"}'
  ),
  routes,
  jsonb_set(
    jsonb_set(routes, '{routes,deep,structuredOutputSchemaVersion}',
      '"resume.captured-output.2"'),
    '{routes,review,structuredOutputSchemaVersion}',
    '"resume.captured-grounding.2"'
  )
from (
  select
    '{
      "schemaVersion":"1.0.0",
      "ledgerVersion":"grounding-compat-ledger.1",
      "templates":{"resume":{
        "templateId":"resume","displayName":"Synthetic version fixture",
        "lifecycleStatus":"active","supportedLocales":["en-AU"],
        "requiredInputs":[{"key":"confirmed_name","label":"Name"}],
        "optionalInputs":[],
        "sections":[{
          "sectionKey":"summary","name":"Summary","required":true,
          "dependsOnInputs":["confirmed_name"],
          "missingInformationBehaviour":"askClarifyingQuestion"
        }],
        "qualityBenchmark":{"benchmarkVersion":"synthetic-version-benchmark.1"}
      }}
    }'::jsonb as contract,
    '{
      "provider":"openai","routingVersion":"synthetic-grounding-routes.1",
      "routes":{
        "deep":{
          "provider":"openai","semanticRoute":"deep","model":"synthetic-deep",
          "reasoningEffort":"medium","routingVersion":"synthetic-grounding-routes.1",
          "structuredOutputSchemaVersion":"resume.captured-output.1",
          "allowedTools":[],"timeoutMs":90000,"maxAttempts":2,
          "background":false,"store":false,"fallback":null
        },
        "review":{
          "provider":"openai","semanticRoute":"review","model":"synthetic-review",
          "reasoningEffort":"high","routingVersion":"synthetic-grounding-routes.1",
          "structuredOutputSchemaVersion":"resume.captured-output.1",
          "allowedTools":[],"timeoutMs":90000,"maxAttempts":2,
          "background":false,"store":false,"fallback":null
        }
      }
    }'::jsonb as routes
) synthetic;

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
select owner_id, 'grounding-version@example.invalid', false, false, now(), now()
from grounding_version_fixture;
insert into public.outcomes(id, user_id, situation_text)
select outcome_id, owner_id, 'Synthetic version admission test'
from grounding_version_fixture;
select is((select count(*)::integer from public.outcomes o
  join grounding_version_fixture f on o.id = f.outcome_id and o.user_id = f.owner_id),
  1, 'the owned outcome fixture exists before admission assertions');

create function pg_temp.configure_version(p_ledger text, p_routes jsonb, p_revision integer)
returns jsonb language sql as $function$
  select public.configure_captured_document_activation(
    'local', 'grounding-version-test', 'master-workspace', 'resume', p_ledger,
    'synthetic-grounding-routes.1', p_routes, true, p_revision,
    'pgtap-synthetic', 'version contract regression only'
  );
$function$;

create function pg_temp.accept_version(
  p_pipeline text,
  p_id text,
  p_ttl integer default 86400,
  p_benchmark text default 'synthetic-version-benchmark.1'
)
returns jsonb language sql as $function$
  select public.accept_captured_document_operation(
    owner_id, outcome_id, ('99060000-0000-4000-8000-' || p_id)::uuid,
    'Synthetic version test', 'local', 'grounding-version-test',
    'master-workspace', 'resume', p_benchmark, p_pipeline,
    7, 'grounding-version-' || p_id,
    '{"confirmed_name":"Synthetic Person"}',
    '{"sources":[{"id":"input:confirmed_name","input_key":"confirmed_name","source_type":"confirmed_request_input","value":"Synthetic Person"}]}',
    '{"permitted_source_ids":["input:confirmed_name"],"material_claims_require_source_reference":true}',
    'en-AU', 'AU', array['summary']::text[], '{}'::text[], '{}'::text[],
    '{"confirmed_name":{"confirmed":true,"source_id":"input:confirmed_name"}}',
    p_ttl
  ) from grounding_version_fixture;
$function$;

-- Roll back the attempted command even when a defect accepts it. An unexpected
-- acceptance is a failing assertion and cannot poison later fixture identities.
create function pg_temp.admission_error(
  p_pipeline text,
  p_id text,
  p_ttl integer default 86400,
  p_benchmark text default 'synthetic-version-benchmark.1'
)
returns text language plpgsql as $function$
begin
  perform pg_temp.accept_version(p_pipeline, p_id, p_ttl, p_benchmark);
  raise exception 'UNEXPECTED_ADMISSION_ACCEPTED';
exception when others then
  return sqlerrm;
end;
$function$;

-- Each malformed benchmark trial registers and activates its own ledger inside
-- an exception subtransaction, then rolls back all fixture writes. The main
-- positive fixture therefore registers its immutable version only once below.
create function pg_temp.benchmark_type_error(p_benchmark jsonb)
returns text language plpgsql as $function$
declare
  v_contract jsonb;
  v_routes jsonb;
begin
  select jsonb_set(contract_v2, '{templates,resume,qualityBenchmark,benchmarkVersion}',
    p_benchmark), route_v2 into v_contract, v_routes
  from grounding_version_fixture;
  perform public.register_document_ledger_version(
    '1.0.0', v_contract->>'ledgerVersion', v_contract,
    encode(extensions.digest(convert_to(v_contract::text, 'UTF8'), 'sha256'), 'hex'),
    'pgtap-synthetic'
  );
  perform pg_temp.configure_version(v_contract->>'ledgerVersion', v_routes, 0);
  perform pg_temp.accept_version('captured-operation-pipeline.2', '000000000008',
    86400, p_benchmark #>> '{}');
  raise exception 'UNEXPECTED_ADMISSION_ACCEPTED';
exception when others then
  return sqlerrm;
end;
$function$;
select is(pg_temp.benchmark_type_error(value),
  'CAPTURED_GROUNDING_EXECUTION_CONTRACT_MISMATCH',
  'a typed benchmark cannot be converted from ' || value::text || ' to an accepted string')
from (values ('7'::jsonb), ('true'::jsonb)) malformed(value);
select is((select count(*)::integer from private.document_generation_snapshots
  where user_id = '99060000-0000-4000-8000-000000000001'), 0,
  'malformed benchmark admissions leave no accepted source snapshot');

select lives_ok(format(
  'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
  contract->>'schemaVersion', contract->>'ledgerVersion', contract::text,
  encode(extensions.digest(convert_to(contract::text, 'UTF8'), 'sha256'), 'hex'),
  'pgtap-synthetic'
), 'register immutable synthetic contract ' || (contract->>'ledgerVersion'))
from grounding_version_fixture,
lateral (values (contract_v1), (contract_v2)) versions(contract);

select lives_ok(format('select pg_temp.configure_version(%L,%L::jsonb,0)',
  contract_v1->>'ledgerVersion', route_v1::text),
  'v1 activation remains supported through the public command')
from grounding_version_fixture;

select is(pg_temp.admission_error('captured-operation-pipeline.2', '000000000003'),
  'CAPTURED_GROUNDING_VERSION_MISMATCH',
  'new v2 pipeline cannot be admitted with an accepted v1 ledger and routes');
select is((select count(*)::integer from private.captured_document_operations
  where user_id = '99060000-0000-4000-8000-000000000001'), 0,
  'the failed admission leaves no operation');
select is((select count(*)::integer from public.documents
  where user_id = '99060000-0000-4000-8000-000000000001'), 0,
  'the failed admission leaves no document');
select is((select count(*)::integer from private.document_allowance_reservations
  where user_id = '99060000-0000-4000-8000-000000000001'), 0,
  'the failed admission leaves no allowance reservation');

select lives_ok(
  $$select pg_temp.accept_version('captured-operation-pipeline.1', '000000000004')$$,
  'v1 admission still creates an accepted operation through the public command');
select is((select count(*)::integer from private.captured_document_operations
  where user_id = '99060000-0000-4000-8000-000000000001'
    and status = 'accepted' and ledger_version = 'grounding-compat-ledger.1'), 1,
  'v1 positive fixture is durably accepted before replay testing');

select throws_ok(format('select pg_temp.configure_version(%L,%L::jsonb,1)',
  contract_v2->>'ledgerVersion', route_v1::text),
  'P0001', 'INVALID_OPENAI_ROUTE_SNAPSHOT',
  'v2 activation rejects the replacement-writer review schema')
from grounding_version_fixture;
select lives_ok(format('select pg_temp.configure_version(%L,%L::jsonb,1)',
  contract_v2->>'ledgerVersion', route_v2::text),
  'v2 activation accepts separate exact writer and grounding reviewer schemas')
from grounding_version_fixture;

select is((pg_temp.accept_version('captured-operation-pipeline.1', '000000000004')
  ->'idempotent_replay'), 'true'::jsonb,
  'an accepted v1 request replays under its original version after a pointer change');
select is((select ledger_version from private.captured_document_operations
  where document_id = '99060000-0000-4000-8000-000000000004'),
  'grounding-compat-ledger.1', 'replay never relabels the accepted ledger');

select is(pg_temp.admission_error('captured-operation-pipeline.1', '000000000006'),
  'CAPTURED_GROUNDING_VERSION_MISMATCH',
  'new v1 pipeline cannot downgrade a v2 ledger activation');
select is(pg_temp.admission_error('captured-operation-pipeline.2', '000000000006', 3600),
  'CAPTURED_GROUNDING_EXECUTION_CONTRACT_MISMATCH',
  'v2 admission rejects a TTL that cannot be replayed by the retained adapter');
select is(pg_temp.admission_error('captured-operation-pipeline.2', '000000000006',
  86400, 'invented-benchmark.2'),
  'CAPTURED_GROUNDING_EXECUTION_CONTRACT_MISMATCH',
  'v2 admission binds the immutable template benchmark instead of guessing a new version');

select lives_ok(
  $$select pg_temp.accept_version('captured-operation-pipeline.2', '000000000005')$$,
  'v2 admission succeeds with the exact registered version contract');
select is((select count(*)::integer from private.captured_document_operations
  where document_id = '99060000-0000-4000-8000-000000000005'
    and user_id = '99060000-0000-4000-8000-000000000001'
    and status = 'accepted'
    and ledger_version = 'ledger.2026-09-first-cohort.2'
    and pipeline_version = 'captured-operation-pipeline.2'
    and contract_version = 'captured-document-operation.v1'), 1,
  'v2 has one owned accepted operation without changing the product contract version');
select is((select count(*)::integer from private.document_allowance_reservations
  where captured_operation_id = (select id from private.captured_document_operations
    where document_id = '99060000-0000-4000-8000-000000000005')
    and status = 'reserved'), 1,
  'v2 admission has one durable allowance reservation before any provider execution');

-- The current pointer may change again; resume/replay use the accepted snapshot.
select lives_ok(format('select pg_temp.configure_version(%L,%L::jsonb,2)',
  contract_v1->>'ledgerVersion', route_v1::text),
  'the pointer can return to v1 for later new admissions')
from grounding_version_fixture;
select is((pg_temp.accept_version('captured-operation-pipeline.2', '000000000005')
  ->'idempotent_replay'), 'true'::jsonb,
  'accepted v2 replays unchanged after the current pointer returns to v1');

create temp table grounding_resume_payload as
select public.get_captured_document_resume_payload(user_id, id) as payload
from private.captured_document_operations
where document_id = '99060000-0000-4000-8000-000000000005';
select is((select count(*)::integer from grounding_resume_payload), 1,
  'the v2 resume assertion reads a real accepted operation');
select is((select payload->'operation_ttl_seconds' from grounding_resume_payload),
  '86400'::jsonb, 'v2 resume supplies the original fixed numeric TTL');
select is((select payload->>'ledger_version' from grounding_resume_payload),
  'ledger.2026-09-first-cohort.2', 'resume retains the accepted ledger');
select is((select payload->>'pipeline_version' from grounding_resume_payload),
  'captured-operation-pipeline.2', 'resume retains the accepted pipeline');
select is((select payload->>'benchmark_version' from grounding_resume_payload),
  'synthetic-version-benchmark.1', 'resume retains the accepted benchmark');
select is((select payload->'input_revision' from grounding_resume_payload),
  '7'::jsonb, 'resume retains the numeric accepted input revision');
select is((select payload #> '{route_snapshot,routes}' from grounding_resume_payload),
  (select route_v2->'routes' from grounding_version_fixture),
  'resume retains both exact v2 route schemas after the pointer changed');
select is((select payload->>'generation_snapshot_sha256' from grounding_resume_payload),
  (select s.snapshot_sha256 from private.document_generation_snapshots s
    join private.captured_document_operations o on o.generation_snapshot_id = s.id
    where o.document_id = '99060000-0000-4000-8000-000000000005'),
  'resume identity uses the independently read immutable generation snapshot hash');

select throws_ok(format(
  'select public.get_captured_document_resume_payload(%L::uuid,%L::uuid)',
  '99060000-0000-4000-8000-000000000099', payload->>'operation_id'),
  'P0001', 'CAPTURED_OPERATION_NOT_FOUND',
  'a different owner cannot reconstruct accepted inputs')
from grounding_resume_payload;
select ok(not has_function_privilege('authenticated',
  'private.captured_uses_exact_grounding(text,text)', 'EXECUTE')
  and not has_function_privilege('anon',
    'private.captured_uses_exact_grounding(text,text)', 'EXECUTE')
  and not has_function_privilege('service_role',
    'private.captured_uses_exact_grounding(text,text)', 'EXECUTE'),
  'the version resolver cannot be directly invoked by API roles');

-- Explicit JSON null and unknown policy values must not be collapsed into a
-- missing v1 property. Each has its own immutable synthetic ledger identity.
create temp table grounding_invalid_policies as
select jsonb_set(jsonb_set(contract_v1, '{ledgerVersion}', to_jsonb('invalid-policy-' || label)),
  '{templates,resume,validationPolicy}', jsonb_build_object('groundingReview', policy)) as contract
from grounding_version_fixture,
  (values ('null', 'null'::jsonb), ('unknown', '"future-unreviewed"'::jsonb),
    ('boolean', 'true'::jsonb)) policies(label, policy);
select lives_ok(format(
  'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
  '1.0.0', contract->>'ledgerVersion', contract::text,
  encode(extensions.digest(convert_to(contract::text, 'UTF8'), 'sha256'), 'hex'),
  'pgtap-synthetic'), 'register immutable malformed-policy fixture ' || (contract->>'ledgerVersion'))
from grounding_invalid_policies;
select throws_ok(format('select pg_temp.configure_version(%L,%L::jsonb,3)',
  contract->>'ledgerVersion', route_v1::text),
  'P0001', 'CAPTURED_GROUNDING_VERSION_MISMATCH',
  'activation rejects an explicit unrecognised policy: ' || (contract->>'ledgerVersion'))
from grounding_invalid_policies, grounding_version_fixture;

select * from finish();
rollback;
