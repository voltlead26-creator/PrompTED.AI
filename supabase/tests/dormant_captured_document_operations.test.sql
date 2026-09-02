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

create temp table captured_operation_test_state (
  owner_id uuid not null,
  other_id uuid not null,
  deletion_id uuid not null,
  owner_outcome_id uuid not null,
  deletion_outcome_id uuid not null,
  document_id uuid not null,
  cancel_document_id uuid not null,
  disabled_document_id uuid not null,
  deletion_document_id uuid not null,
  operation_id uuid,
  cancel_operation_id uuid,
  deletion_operation_id uuid,
  lease_token uuid,
  contract_json jsonb not null,
  contract_hash text,
  route_snapshot jsonb not null
);

insert into captured_operation_test_state values (
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000003',
  '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002',
  '93000000-0000-4000-8000-000000000003',
  '93000000-0000-4000-8000-000000000004',
  null, null, null, null,
  '{
    "schemaVersion": "1.0.0",
    "ledgerVersion": "captured-test.1",
    "templates": {
      "resume": {
        "sections": [
          {"sectionKey":"summary","name":"Summary","required":true,"missingInformationBehaviour":"askClarifyingQuestion"},
          {"sectionKey":"experience","name":"Experience","required":true,"missingInformationBehaviour":"askClarifyingQuestion"},
          {"sectionKey":"optional_note","name":"Optional note","required":false,"missingInformationBehaviour":"omitIfOptional"}
        ]
      }
    }
  }'::jsonb,
  null,
  '{
    "provider":"openai",
    "routingVersion":"routing.test.1",
    "routes": {
      "deep":{
        "provider":"openai","semanticRoute":"deep","model":"gpt-test-deep",
        "reasoningEffort":"medium","routingVersion":"routing.test.1",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      },
      "review":{
        "provider":"openai","semanticRoute":"review","model":"gpt-test-review",
        "reasoningEffort":"high","routingVersion":"routing.test.1",
        "structuredOutputSchemaVersion":"resume.captured-output.1","allowedTools":[],
        "timeoutMs":90000,"maxAttempts":2,"background":false,"store":false,"fallback":null
      }
    }
  }'::jsonb
);

update captured_operation_test_state
set contract_hash = encode(
  extensions.digest(convert_to(contract_json::text, 'UTF8'), 'sha256'),
  'hex'
);

grant select on captured_operation_test_state to authenticated, service_role;

create or replace function pg_temp.accept_sql(
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_idempotency_key text
) returns text
language sql
as $function$
  select format(
    'select public.accept_captured_document_operation(%L::uuid,%L::uuid,%L::uuid,%L,%L,%L,%L,%L,%L,%L,%s,%L,%L::jsonb,%L::jsonb,%L::jsonb,%L,%L,%L::text[],%L::text[],%L::text[],%L::jsonb,%s)',
    p_user_id, p_outcome_id, p_document_id, p_title,
    'local', 'internal', 'generate_document', 'resume',
    'resume-benchmark.1', 'pipeline-test.1', 1, p_idempotency_key,
    '{"confirmed_name":"Synthetic Person"}',
    '{"sourceRefs":["synthetic:user-answer"]}',
    '{"facts":["confirmed_name"]}',
    'en-AU', 'AU',
    '{experience,optional_note,summary}', '{}', '{}', '{}', 86400
  )
$function$;

create or replace function pg_temp.provider_attempt_sql(
  p_operation_id uuid,
  p_operation_revision integer,
  p_lease_token uuid,
  p_stage text,
  p_attempt_number integer,
  p_route text,
  p_model text,
  p_reasoning text,
  p_response_id text,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_retry_reason text,
  p_error_code text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_request_sha256 text,
  p_structured_output jsonb
) returns text
language sql
as $function$
  select format(
    'select public.record_captured_document_provider_attempt(%L::uuid,%s,%L::uuid,%L,%s,%L,%L,%L,%L,%L,%L,%s,%s,%L,%L,%L::timestamptz,%L::timestamptz,%L,%L::jsonb)',
    p_operation_id, p_operation_revision, p_lease_token, p_stage,
    p_attempt_number, p_route, p_model, p_reasoning, p_response_id,
    'store_false', p_status, p_input_tokens, p_output_tokens,
    p_retry_reason, p_error_code, p_started_at, p_completed_at,
    p_request_sha256, p_structured_output
  )
$function$;

create or replace function pg_temp.accept_result(
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_idempotency_key text
) returns jsonb
language plpgsql
as $function$
declare
  v_result jsonb;
begin
  execute pg_temp.accept_sql(
    p_user_id, p_outcome_id, p_document_id, p_title, p_idempotency_key
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function pg_temp.captured_pdf_validation(
  p_export_id uuid,
  p_artifact_sha256 text,
  p_byte_length integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_export private.captured_document_exports%rowtype;
  v_brand jsonb;
  v_footer_sha256 text;
  v_evidence_sha256 text;
begin
  select * into strict v_export
  from private.captured_document_exports
  where id = p_export_id;
  v_brand := v_export.brand_snapshot->'brand_kit';
  v_footer_sha256 := case when nullif(v_brand->>'footer_text', '') is null
    then null
    else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      v_brand->>'footer_text', 'UTF8'
    ), 'sha256'), 'hex') end;
  v_evidence_sha256 := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'prompted.export-brand-evidence.v1|' || v_export.brand_snapshot_version || '|' ||
      v_export.brand_snapshot_sha256 || '|1|' ||
      coalesce(v_brand->>'logo_storage_path', '~') || '|' ||
      coalesce(v_brand->>'logo_content_sha256', '~') || '|' ||
      coalesce(v_brand->>'logo_media_type', '~') || '|' ||
      coalesce(v_brand->>'logo_byte_length', '~') || '|' ||
      coalesce(v_footer_sha256, '~') || '|' ||
      coalesce(pg_catalog.lower(v_brand->>'primary_colour'), '~') || '|' ||
      coalesce(pg_catalog.lower(v_brand->>'secondary_colour'), '~'),
    'UTF8'
  ), 'sha256'), 'hex');
  return pg_catalog.jsonb_build_object(
    'passed', true,
    'artifact_inspected', true,
    'inspection_contract', 'prompted.rendered-pdf.v2',
    'artifact_sha256', p_artifact_sha256,
    'byte_length', p_byte_length,
    'content_sha256', repeat('1', 64),
    'section_order_sha256', repeat('2', 64),
    'content_type', 'application/pdf',
    'brand_snapshot_version', v_export.brand_snapshot_version,
    'brand_snapshot_sha256', v_export.brand_snapshot_sha256,
    'brand_present', true,
    'brand_logo_storage_path', v_brand->>'logo_storage_path',
    'brand_logo_sha256', v_brand->>'logo_content_sha256',
    'brand_logo_media_type', v_brand->>'logo_media_type',
    'brand_logo_byte_length', case
      when v_brand->'logo_byte_length' = 'null'::jsonb then null
      else (v_brand->>'logo_byte_length')::integer end,
    'brand_footer_sha256', v_footer_sha256,
    'brand_primary_colour', pg_catalog.lower(v_brand->>'primary_colour'),
    'brand_secondary_colour', pg_catalog.lower(v_brand->>'secondary_colour'),
    'brand_evidence_sha256', v_evidence_sha256,
    'checks', pg_catalog.jsonb_build_object(
      'transport_envelope', true,
      'inspection_version', true,
      'renderer_status', true,
      'renderer_structural', true,
      'content_matches', true,
      'section_order_matches', true,
      'artifact_hash_matches', true,
      'brand_snapshot_matches', true,
      'brand_logo_matches', true,
      'brand_footer_matches', true,
      'brand_colours_match', true
    )
  );
end;
$function$;

select has_table('private', 'captured_document_operations', 'private operation records exist');
select has_table('private', 'captured_document_operation_events', 'private operation event records exist');
select has_table('private', 'captured_document_provider_attempts', 'private provider-attempt records exist');
select has_table('private', 'captured_document_revisions', 'private revision records exist');
select has_table('private', 'captured_document_approvals', 'private approval records exist');
select has_table('private', 'captured_document_exports', 'private export records exist');
select has_table(
  'private', 'captured_export_storage_recoveries',
  'immutable captured export recovery records exist'
);
select has_table('private', 'captured_document_allowances', 'private allowance records exist');
select has_table('private', 'captured_document_activation_revisions', 'activation history exists');
select has_column(
  'private', 'document_ledger_activation_pointers', 'environment',
  'activation pointers select by exact environment'
);
select has_column(
  'private', 'document_ledger_activation_pointers', 'user_cohort',
  'activation pointers select by exact cohort'
);
select has_column(
  'private', 'document_ledger_activation_pointers', 'routing_version',
  'activation pointers capture routing version'
);
select has_column('public', 'sections', 'section_state', 'captured sections expose explicit state');
select has_column(
  'public', 'sections', 'source_references',
  'captured sections expose source-reference projection'
);

select has_function(
  'public', 'configure_captured_document_activation',
  array['text','text','text','text','text','text','jsonb','boolean','integer','text','text'],
  'service activation command exists'
);
select has_function(
  'public', 'accept_captured_document_operation',
  array[
    'uuid','uuid','uuid','text','text','text','text','text','text','text','integer',
    'text','jsonb','jsonb','jsonb','text','text','text[]','text[]','text[]','jsonb','integer'
  ],
  'service acceptance command exists'
);
select has_function(
  'public', 'get_captured_document_resume_payload',
  array['uuid','uuid'],
  'service-only immutable resume reconstruction exists'
);
select has_function(
  'public', 'claim_captured_document_operation',
  array['uuid','integer','text','integer'],
  'service lease command exists'
);
select has_function(
  'public', 'record_captured_document_provider_attempt',
  array[
    'uuid','integer','uuid','text','integer','text','text','text','text','text',
    'text','integer','integer','text','text','timestamp with time zone',
    'timestamp with time zone','text','jsonb'
  ],
  'service provider dispatch reservation and completion command exists'
);
select has_function(
  'public', 'get_latest_captured_document_operation',
  array['uuid'],
  'authenticated document-scoped operation read exists'
);
select has_function(
  'public', 'finalize_captured_document_operation',
  array['uuid','integer','uuid','jsonb','jsonb'],
  'atomic finalisation command exists'
);
select has_function(
  'public', 'edit_captured_document_section',
  array['uuid','integer','uuid','integer','text','integer','text','text'],
  'owner section-edit command exists'
);
select has_function(
  'public', 'approve_captured_document_revision',
  array['uuid','integer','uuid','integer'],
  'owner exact-revision approval command exists'
);
select has_function(
  'public', 'request_captured_document_export',
  array['uuid','integer','uuid','integer','text','text'],
  'owner exact-revision export request exists'
);
select has_function(
  'public', 'complete_captured_document_export',
  array['uuid','uuid','integer','text','text','text','jsonb'],
  'service inspected-artifact completion command exists'
);
select has_function(
  'public', 'record_captured_export_storage_recovery',
  array[
    'uuid','uuid','uuid','integer','text','text','integer','text','jsonb','uuid'
  ],
  'service exact-byte captured export recovery command exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_captured_export_storage_recovery(uuid,uuid,uuid,integer,text,text,integer,text,jsonb,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_captured_export_storage_recovery(uuid,uuid,uuid,integer,text,text,integer,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'only the protected service boundary may record immutable export recovery'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated users cannot resolve private operation records'
);
select ok(
  not has_table_privilege('authenticated', 'private.captured_document_operations', 'SELECT'),
  'authenticated users have no direct operation-table read'
);
select ok(
  not has_table_privilege('service_role', 'private.captured_document_operations', 'UPDATE'),
  'service role advances operations only through commands'
);
select ok(
  not has_table_privilege('service_role', 'private.document_ledger_activation_pointers', 'UPDATE'),
  'service role changes activation only through the pointer command'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.accept_captured_document_operation(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,text,text[],text[],text[],jsonb,integer)',
    'EXECUTE'
  ),
  'service role can accept a captured operation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.accept_captured_document_operation(uuid,uuid,uuid,text,text,text,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,text,text[],text[],text[],jsonb,integer)',
    'EXECUTE'
  ),
  'authenticated callers cannot manufacture operation acceptance'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_captured_document_resume_payload(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_captured_document_resume_payload(uuid,uuid)',
    'EXECUTE'
  ),
  'only the protected service boundary can reconstruct immutable resume inputs'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.edit_captured_document_section(uuid,integer,uuid,integer,text,integer,text,text)',
    'EXECUTE'
  ),
  'authenticated callers can invoke the guarded edit command'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.request_captured_document_export(uuid,integer,uuid,integer,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot request captured export'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.get_latest_captured_document_operation(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.get_latest_captured_document_operation(uuid)',
    'EXECUTE'
  ),
  'document-scoped operation truth is authenticated-only'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_captured_document_export(uuid,uuid,integer,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_captured_document_export(uuid,uuid,integer,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'only the service boundary can complete a captured export'
);
select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'configure_captured_document_activation',
        'accept_captured_document_operation',
        'get_captured_document_resume_payload',
        'get_captured_document_operation',
        'get_latest_captured_document_operation',
        'claim_captured_document_operation',
        'advance_captured_document_operation',
        'record_captured_document_provider_attempt',
        'cancel_captured_document_operation',
        'request_captured_document_cancellation',
        'finalize_captured_document_operation',
        'edit_captured_document_section',
        'approve_captured_document_revision',
        'request_captured_document_export',
        'complete_captured_document_export'
      )
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  ),
  15,
  'all public captured commands are SECURITY DEFINER with an empty search path'
);
select is(
  (select count(*)::integer from private.document_ledger_activation_pointers where enabled),
  0,
  'the additive migration enables no captured cohort'
);
select is(
  (
    select bucket_record.public::text || ':' || bucket_record.file_size_limit::text
    from storage.buckets bucket_record
    where bucket_record.id = 'captured-exports'
      and bucket_record.name = 'captured-exports'
  ),
  'false:26214400',
  'captured artifacts use an exact private 25 MiB Storage bucket'
);
select ok(
  (
    select cardinality(bucket_record.allowed_mime_types) = 4
      and bucket_record.allowed_mime_types @> array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/html'
      ]::text[]
    from storage.buckets bucket_record
    where bucket_record.id = 'captured-exports'
  ),
  'captured artifact MIME types are bounded to reviewed export formats'
);
select is(
  (
    select pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          policy_record.permissive || '|' || policy_record.cmd || '|' ||
          pg_catalog.array_to_string(policy_record.roles, ',') || '|' ||
          pg_catalog.regexp_replace(
            coalesce(policy_record.qual, ''), E'\\s+', ' ', 'g'
          ) || '|' ||
          pg_catalog.regexp_replace(
            coalesce(policy_record.with_check, ''), E'\\s+', ' ', 'g'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'storage'
      and policy_record.tablename = 'objects'
      and policy_record.policyname = 'captured_exports_no_direct_client_access'
  ),
  'ddaa0ccefbc1a111808332a1ee6aea088c702a653432a8d4a378414d013523c3',
  'captured artifacts retain the exact restrictive browser read/write denial policy'
);
select is(
  (
    select count(*)::integer
    from pg_policy policy_record
    where policy_record.polrelid = 'storage.objects'::regclass
      and policy_record.polpermissive
      and (
        coalesce(pg_get_expr(policy_record.polqual, policy_record.polrelid), '')
        || coalesce(pg_get_expr(policy_record.polwithcheck, policy_record.polrelid), '')
      ) like '%captured-exports%'
  ),
  0,
  'no permissive direct client policy is created for captured artifacts'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
select owner_id, 'captured-owner@example.invalid', false, false, now(), now()
from captured_operation_test_state
union all
select other_id, 'captured-other@example.invalid', false, false, now(), now()
from captured_operation_test_state
union all
select deletion_id, 'captured-delete@example.invalid', false, false, now(), now()
from captured_operation_test_state;

insert into public.businesses(id, owner_user_id, trading_name)
select
  '91500000-0000-4000-8000-000000000001'::uuid,
  owner_id,
  'Captured Export Brand'
from captured_operation_test_state;

insert into public.outcomes(id, user_id, business_id, situation_text)
select
  owner_outcome_id,
  owner_id,
  '91500000-0000-4000-8000-000000000001'::uuid,
  'Synthetic captured operation test'
from captured_operation_test_state
union all
select
  deletion_outcome_id,
  deletion_id,
  null,
  'Synthetic account-deletion cascade test'
from captured_operation_test_state;

insert into public.brand_kits(
  business_id,
  primary_colour,
  secondary_colour,
  footer_text
) values (
  '91500000-0000-4000-8000-000000000001',
  '#123456',
  '#abcdef',
  'Captured export footer'
);

insert into public.documents(user_id, outcome_id, title)
select owner_id, owner_outcome_id, 'Legacy compatibility document'
from captured_operation_test_state;

select lives_ok(
  format(
    'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
    '1.0.0', 'captured-test.1', contract_json::text, contract_hash, 'pgtap'
  ),
  'the test ledger registers through the existing immutable boundary'
)
from captured_operation_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
      'local', 'internal', 'generate_document', 'cover-letter',
      'captured-test.1', 'routing.test.1', route_snapshot::text,
      true, 0, 'pgtap', 'outside cohort'
    ),
    '%TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%'
  ),
  'activation rejects templates outside the exact five-template cohort'
)
from captured_operation_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
      'local', 'internal', 'generate_document', 'resume',
      'captured-test.1', 'routing.test.1', (route_snapshot - 'provider')::text,
      true, 0, 'pgtap', 'reject missing provider identity'
    ),
    '%INVALID_OPENAI_ROUTE_SNAPSHOT%'
  ),
  'activation fails closed when OpenAI provider identity is absent'
)
from captured_operation_test_state;

select lives_ok(
  format(
    'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
    'local', 'internal', 'generate_document', 'resume',
    'captured-test.1', 'routing.test.1', route_snapshot::text,
    true, 0, 'pgtap', 'enable internal test cohort'
  ),
  'service command enables one exact captured pointer'
)
from captured_operation_test_state;
select is(
  (
    select revision::text || ':' || enabled::text
    from private.document_ledger_activation_pointers
    where scope_key = 'local:internal:generate_document:resume'
  ),
  '1:true',
  'the exact pointer starts at revision one and enabled'
);
select is(
  (select count(*)::integer from private.captured_document_activation_revisions),
  1,
  'activation change is retained immutably'
);

select lives_ok(
  pg_temp.accept_sql(owner_id, owner_outcome_id, document_id, 'Captured resume', 'capture-main'),
  'operation acceptance persists before provider work'
)
from captured_operation_test_state;

update captured_operation_test_state state_record
set operation_id = operation_record.id
from private.captured_document_operations operation_record
where operation_record.user_id = state_record.owner_id
  and operation_record.idempotency_key = 'capture-main';

select is(
  (
    select count(*)::integer
    from private.document_allowance_reservations reservation_record
    join captured_operation_test_state state_record
      on state_record.operation_id = reservation_record.captured_operation_id
     and state_record.owner_id = reservation_record.user_id
    where reservation_record.status = 'reserved'
      and reservation_record.request_id = 'capture-main'
  ),
  1,
  'captured acceptance atomically inserts its pre-provider reservation despite parent/child trigger timing'
);

select is(
  (
    select public.get_captured_document_resume_payload(
      owner_id,
      operation_id
    )->>'generation_request_id'
    from captured_operation_test_state
  ),
  'capture-main',
  'background resume reconstructs the exact immutable idempotency key'
);
select is(
  (
    select public.get_captured_document_resume_payload(
      owner_id,
      operation_id
    )->'input_values'->>'confirmed_name'
    from captured_operation_test_state
  ),
  'Synthetic Person',
  'background resume reconstructs the immutable accepted input values'
);
select is(
  (
    select public.get_captured_document_resume_payload(
      owner_id,
      operation_id
    )->>'accepted_user_cohort'
    from captured_operation_test_state
  ),
  'internal',
  'background resume preserves the accepted cohort after an admission rollback'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.get_captured_document_resume_payload(%L::uuid,%L::uuid)',
      other_id,
      operation_id
    ),
    '%CAPTURED_OPERATION_NOT_FOUND%'
  ),
  'resume reconstruction rejects a different user for the same operation'
)
from captured_operation_test_state;

select is(
  (
    select status || ':' || operation_revision::text
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'accepted:1',
  'accepted operation is durable at operation revision one'
);
select is(
  (
    select ledger_binding_status || ':' || current_revision::text
    from public.documents document_record
    join captured_operation_test_state state_record
      on state_record.document_id = document_record.id
  ),
  'captured:1',
  'acceptance creates the captured document identity at revision one'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_revisions revision_record
    join captured_operation_test_state state_record
      on state_record.operation_id = revision_record.operation_id
  ),
  1,
  'acceptance creates one immutable initial document revision'
);
select lives_ok(
  pg_temp.accept_sql(owner_id, owner_outcome_id, document_id, 'Captured resume', 'capture-main'),
  'exact acceptance replay resumes the same logical operation'
)
from captured_operation_test_state;
select is(
  (
    select pg_temp.accept_result(
      owner_id, owner_outcome_id, document_id, 'Captured resume', 'capture-main'
    )->'route_snapshot'->'routes'->'deep'->>'model'
    from captured_operation_test_state
  ),
  'gpt-test-deep',
  'acceptance returns the immutable effective route snapshot for execution'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  1,
  'acceptance replay creates no duplicate operation'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.accept_sql(owner_id, owner_outcome_id, document_id, 'Different title', 'capture-main'),
    '%CAPTURED_OPERATION_REPLAY_CONFLICT:%'
  ),
  'an idempotency key cannot be rebound to different acceptance input'
)
from captured_operation_test_state;

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select set_config(
  'prompted.captured_document_write_token',
  '94000000-0000-4000-8000-000000000001',
  true
);
select ok(
  pg_temp.raises_matching(
    format(
      'update public.documents set title = %L where id = %L::uuid',
      'Forged context bypass', document_id
    ),
    '%CAPTURED_DOCUMENT_RPC_REQUIRED:%'
  ),
  'a forged custom setting cannot bypass the private transaction capability'
)
from captured_operation_test_state;
select is(
  (
    select public.get_latest_captured_document_operation(document_id)->>'operation_id'
    from captured_operation_test_state
  ),
  (select operation_id::text from captured_operation_test_state),
  'the owner can hydrate durable operation truth by captured document identity'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  (select other_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.get_captured_document_operation(%L::uuid)', operation_id
    ),
    '%CAPTURED_OPERATION_NOT_FOUND%'
  ),
  'another tenant cannot read captured operation status'
)
from captured_operation_test_state;
select is(
  (
    select public.get_latest_captured_document_operation(document_id)
    from captured_operation_test_state
  ),
  null::jsonb,
  'document-scoped status lookup reveals no other-tenant operation'
);
reset role;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.advance_captured_document_operation(%L::uuid,%s,null::uuid,%L,%L::jsonb)',
      operation_id, 1, 'generating', '{}'
    ),
    '%CAPTURED_OPERATION_LEASE_LOST%'
  ),
  'an unclaimed operation cannot be advanced with a null lease'
)
from captured_operation_test_state;

select lives_ok(
  format(
    'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
    operation_id, 1, 'pgtap-worker', 900
  ),
  'service worker claims the accepted operation with an expiring lease'
)
from captured_operation_test_state;
update captured_operation_test_state state_record
set lease_token = operation_record.lease_token
from private.captured_document_operations operation_record
where operation_record.id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
      operation_id, 1, 'stale-worker', 900
    ),
    '%STALE_OPERATION_REVISION:%'
  ),
  'a stale worker cannot claim over the newer operation revision'
)
from captured_operation_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb)',
      operation_id, 2, lease_token, 'generating',
      '{"debug":{"prompt":"must not enter durable event metadata"}}'
    ),
    '%CAPTURED_EVENT_METADATA_SENSITIVE_FIELD%'
  ),
  'nested sensitive provider material is rejected from durable event metadata'
)
from captured_operation_test_state;

select lives_ok(
  format(
    'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb)',
    operation_id, 2, lease_token, 'generating', '{}'
  ),
  'the lease owner advances accepted work to generating'
)
from captured_operation_test_state;
select ok(
  pg_temp.raises_matching(
    pg_temp.provider_attempt_sql(
      operation_id, 3, lease_token, 'generation', 0, 'deep',
      'gpt-unaccepted-deep', 'medium', null, 'prepared', 0, 0,
      null, null, '2026-08-31T00:59:00Z', null,
      repeat('a', 64), null
    ),
    '%CAPTURED_PROVIDER_ROUTE_MISMATCH:deep%'
  ),
  'provider attempts cannot invent a route absent from the accepted snapshot'
)
from captured_operation_test_state;
select lives_ok(
  pg_temp.provider_attempt_sql(
    operation_id, 3, lease_token, 'generation', 0, 'deep',
    'gpt-test-deep', 'medium', null, 'prepared', 0, 0,
    null, null, '2026-08-31T01:00:00Z', null,
    repeat('b', 64), null
  ),
  'the provider dispatch is reserved durably before the call'
)
from captured_operation_test_state;
select lives_ok(
  pg_temp.provider_attempt_sql(
    operation_id, 3, lease_token, 'generation', 0, 'deep',
    'gpt-test-deep', 'medium', null, 'prepared', 0, 0,
    null, null, '2026-08-31T01:00:00Z', null,
    repeat('b', 64), null
  ),
  'an exact pre-call reservation replay is idempotent with the prior revision'
)
from captured_operation_test_state;
select ok(
  pg_temp.raises_matching(
    pg_temp.provider_attempt_sql(
      operation_id, 4, lease_token, 'generation', 0, 'deep',
      'gpt-test-deep', 'medium', null, 'prepared', 0, 0,
      null, null, '2026-08-31T01:00:01Z', null,
      repeat('c', 64), null
    ),
    '%CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED%'
  ),
  'an unresolved dispatch cannot be replaced by a second provider call'
)
from captured_operation_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb,%L)',
      operation_id, 4, lease_token, 'terminal_failure', '{}',
      'CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED'
    ),
    '%CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED%'
  ),
  'terminal failure cannot release allowance while a provider attempt remains prepared'
)
from captured_operation_test_state;

select lives_ok(
  pg_temp.provider_attempt_sql(
    operation_id, 4, lease_token, 'generation', 1, 'deep',
    'gpt-test-deep', 'medium', null, 'failed', 0, 0,
    null, 'OPENAI_TIMEOUT', '2026-08-31T01:00:00Z',
    '2026-08-31T01:00:02Z', repeat('b', 64), null
  ),
  'a prepared dispatch is completed once with its exact request identity'
)
from captured_operation_test_state;

select lives_ok(
  pg_temp.provider_attempt_sql(
    operation_id, 5, lease_token, 'generation', 0, 'deep',
    'gpt-test-deep', 'medium', null, 'prepared', 0, 0,
    null, null, '2026-08-31T01:00:03Z', null,
    repeat('b', 64), null
  ),
  'the bounded retry receives a new durable reservation'
)
from captured_operation_test_state;
select is(
  (
    select max(attempt_number)
    from private.captured_document_provider_attempts attempt_record
    join captured_operation_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  2,
  'attempt numbering advances globally instead of colliding on resume'
);

select lives_ok(
  pg_temp.provider_attempt_sql(
    operation_id, 6, lease_token, 'generation', 2, 'deep',
    'gpt-test-deep', 'medium', 'response-test-2', 'succeeded', 120, 240,
    'bounded_transient_retry', null, '2026-08-31T01:00:03Z',
    '2026-08-31T01:00:05Z', repeat('b', 64), '{"sections":[]}'::jsonb
  ),
  'successful structured output is captured as the durable resume checkpoint'
)
from captured_operation_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'insert into private.captured_document_provider_attempts(operation_id,user_id,logical_stage_key,attempt_number,provider,semantic_route,model,reasoning_effort,retention_mode,status,input_tokens,output_tokens,started_at,request_sha256,attempt_sha256) values (%L::uuid,%L::uuid,%L,%s,%L,%L,%L,%L,%L,%L,%s,%s,%L::timestamptz,%L,%L)',
      operation_id,
      owner_id,
      'generation',
      3,
      'openai',
      'deep',
      'gpt-test-deep',
      'medium',
      'store_false',
      'prepared',
      0,
      0,
      '2026-08-31T01:00:06Z',
      repeat('d', 64),
      repeat('e', 64)
    ),
    '%CAPTURED_PROVIDER_ATTEMPT_LIMIT_EXCEEDED:deep:3:2%'
  ),
  'a worker restart cannot allocate cumulative provider attempt three after the accepted budget of two'
)
from captured_operation_test_state;
select is(
  (
    select jsonb_typeof(
      pg_temp.accept_result(
        owner_id, owner_outcome_id, document_id, 'Captured resume', 'capture-main'
      )->'generation_checkpoint'
    )
    from captured_operation_test_state
  ),
  'object',
  'operation replay returns the successful private checkpoint without redispatch'
);
select lives_ok(
  pg_temp.provider_attempt_sql(
    operation_id, 6, lease_token, 'generation', 2, 'deep',
    'gpt-test-deep', 'medium', 'response-test-2', 'succeeded', 120, 240,
    'bounded_transient_retry', null, '2026-08-31T01:00:03Z',
    '2026-08-31T01:00:05Z', repeat('b', 64), '{"sections":[]}'::jsonb
  ),
  'exact terminal attempt replay is idempotent with the prior revision'
)
from captured_operation_test_state;
select is(
  (
    select count(*)::integer
    from private.captured_document_provider_attempts attempt_record
    join captured_operation_test_state state_record
      on state_record.operation_id = attempt_record.operation_id
  ),
  2,
  'attempt replay creates no duplicate provider record'
);

select lives_ok(
  format(
    'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb)',
    operation_id, 7, lease_token, 'validating', '{}'
  ),
  'generation advances to deterministic validation'
)
from captured_operation_test_state;
select lives_ok(
  format(
    'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb)',
    operation_id, 8, lease_token, 'persisting', '{}'
  ),
  'validated work advances to the atomic persistence boundary'
)
from captured_operation_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.finalize_captured_document_operation(%L::uuid,%s,%L::uuid,null::jsonb,%L::jsonb)',
      operation_id, 9, lease_token, '{"passed":true}'
    ),
    '%CAPTURED_SECTIONS_MUST_BE_ARRAY%'
  ),
  'null structured output cannot bypass the final section array contract'
)
from captured_operation_test_state;

select lives_ok(
  format(
    'select public.finalize_captured_document_operation(%L::uuid,%s,%L::uuid,%L::jsonb,%L::jsonb)',
    operation_id, 9, lease_token,
    '[{"section_key":"summary","content":"Supported summary","state":"final","is_required":true,"source_references":[{"source_id":"synthetic:answer"}]},{"section_key":"experience","content":"Evidence &#1609; remains visible","state":"final","is_required":true,"source_references":[]}]',
    '{"passed":true,"grounding":"synthetic"}'
  ),
  'atomic finalisation commits usable sections and durable ready state'
)
from captured_operation_test_state;
select is(
  (
    select status || ':' || operation_revision::text || ':' || latest_document_revision::text
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.operation_id = operation_record.id
  ),
  'ready_for_review:10:2',
  'ready for review appears only after document revision two commits'
);
select is(
  (
    select count(*)::integer
    from public.sections section_record
    join captured_operation_test_state state_record
      on state_record.document_id = section_record.document_id
  ),
  3,
  'ledger-order finalisation represents every section exactly once'
);
select is(
  (
    select section_state
    from public.sections section_record
    join captured_operation_test_state state_record
      on state_record.document_id = section_record.document_id
    where section_record.section_key = 'optional_note'
  ),
  'omitted_optional',
  'missing optional content becomes an explicit omitted state'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_allowances allowance_record
    join captured_operation_test_state state_record
      on state_record.operation_id = allowance_record.operation_id
  ),
  1,
  'first usable ready revision consumes one private allowance'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger usage_record
    join captured_operation_test_state state_record
      on usage_record.user_id = state_record.owner_id
    where usage_record.generation_request_id =
      'captured-operation:' || state_record.operation_id::text
      and usage_record.event_type = 'document_created'
  ),
  1,
  'first usable ready revision writes one legacy-compatible usage row'
);

select lives_ok(
  format(
    'select public.finalize_captured_document_operation(%L::uuid,%s,%L::uuid,%L::jsonb,%L::jsonb)',
    operation_id, 9, lease_token,
    '[{"section_key":"summary","content":"Supported summary","state":"final","is_required":true,"source_references":[{"source_id":"synthetic:answer"}]},{"section_key":"experience","content":"Evidence &#1609; remains visible","state":"final","is_required":true,"source_references":[]}]',
    '{"passed":true,"grounding":"synthetic"}'
  ),
  'exact finalisation replay returns the already persisted revision'
)
from captured_operation_test_state;
select is(
  (
    select count(*)::integer
    from private.captured_document_allowances allowance_record
    join captured_operation_test_state state_record
      on state_record.operation_id = allowance_record.operation_id
  ),
  1,
  'finalisation replay never consumes a second allowance'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.finalize_captured_document_operation(%L::uuid,%s,%L::uuid,%L::jsonb,%L::jsonb)',
      operation_id, 10, lease_token,
      '[{"section_key":"summary","content":"<p>&nbsp;</p>","state":"final","is_required":true,"source_references":[]},{"section_key":"experience","content":"Evidence","state":"final","is_required":true,"source_references":[]}]',
      '{"passed":true}'
    ),
    '%CAPTURED_VISIBLE_SECTION_CONTENT_REQUIRED:summary%'
  ),
  'HTML and whitespace entities cannot satisfy a required final section'
)
from captured_operation_test_state;

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.edit_captured_document_section(%L::uuid,%s,%L::uuid,%s,%L,%s,%L,%L)',
      operation_id, 10, document_id, 2, 'summary', 1,
      'Unresolved owner placeholder', 'interactive_placeholder'
    ),
    '%CAPTURED_INTERACTIVE_PLACEHOLDER_NOT_ALLOWED:summary%'
  ),
  'owner edits cannot assign a section state forbidden by the immutable ledger'
)
from captured_operation_test_state;
select lives_ok(
  format(
    'select public.edit_captured_document_section(%L::uuid,%s,%L::uuid,%s,%L,%s,%L,%L)',
    operation_id, 10, document_id, 2, 'summary', 1,
    'Owner-edited supported summary', 'final'
  ),
  'owner edit persists through operation, document and section revisions'
)
from captured_operation_test_state;
select is(
  (
    select section_record.source_references::text
    from public.sections section_record
    join captured_operation_test_state state_record
      on state_record.document_id = section_record.document_id
    where section_record.section_key = 'summary'
  ),
  '["user:owner-edit"]',
  'owner edits replace stale provider provenance with explicit owner provenance'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.edit_captured_document_section(%L::uuid,%s,%L::uuid,%s,%L,%s,%L,%L)',
      operation_id, 10, document_id, 2, 'summary', 1,
      'Stale overwrite', 'final'
    ),
    '%STALE_OPERATION_REVISION:%'
  ),
  'two-client stale edit cannot overwrite the newer revision'
)
from captured_operation_test_state;
select lives_ok(
  format(
    'select public.approve_captured_document_revision(%L::uuid,%s,%L::uuid,%s)',
    operation_id, 11, document_id, 3
  ),
  'owner approval binds to exact persisted document and section revisions'
)
from captured_operation_test_state;
reset role;

select is(
  (
    select (revision_record.validation_result->>'validation_scope')
      || ':' || (revision_record.validation_result->>'material_claim_grounding_checked')
      || ':' || (revision_record.validation_result->>'owner_asserted_provenance')
    from private.captured_document_revisions revision_record
    join captured_operation_test_state state_record
      on state_record.operation_id = revision_record.operation_id
    where revision_record.document_revision = 3
  ),
  'ledger_state_and_visible_content:false:true',
  'the edited revision reports its bounded validation and grounding truth honestly'
);

select is(
  (
    select approved_revision::text || ':' || current_revision::text
    from public.documents document_record
    join captured_operation_test_state state_record
      on state_record.document_id = document_record.id
  ),
  '3:3',
  'public approval identity names the exact current document revision'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_approvals approval_record
    join captured_operation_test_state state_record
      on state_record.operation_id = approval_record.operation_id
  ),
  1,
  'approval is retained as one immutable private record'
);

set local role service_role;
select is(
  public.load_legacy_export_snapshot(
    state_record.owner_id,
    state_record.document_id,
    null
  ) #>> '{brand_snapshot,brand_kit,footer_text}',
  'Captured export footer',
  'the authoritative target snapshot selects its linked business brand'
)
from captured_operation_test_state state_record;
reset role;

set local role authenticated;
select lives_ok(
  format(
    'select public.request_captured_document_export(%L::uuid,%s,%L::uuid,%s,%L,%L)',
    operation_id, 12, document_id, 3, 'docx', 'export-main'
  ),
  'owner requests export of the exact current approved revision'
)
from captured_operation_test_state;
select lives_ok(
  format(
    'select public.request_captured_document_export(%L::uuid,%s,%L::uuid,%s,%L,%L)',
    operation_id, 12, document_id, 3, 'docx', 'export-main'
  ),
  'exact export replay returns the same request despite its prior expected operation revision'
)
from captured_operation_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.request_captured_document_export(%L::uuid,%s,%L::uuid,%s,%L,%L)',
      operation_id, 13, document_id, 2, 'docx', 'export-stale'
    ),
    '%CAPTURED_EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL%'
  ),
  'export rejects a stale formerly persisted revision'
)
from captured_operation_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.request_captured_document_export(%L::uuid,%s,%L::uuid,%s,%L,%L)',
      operation_id, 13, document_id, 3, 'xlsx', 'export-xlsx'
    ),
    '%CAPTURED_TEMPLATE_HAS_NO_SPREADSHEET_SEMANTICS%'
  ),
  'spreadsheet export requires explicit ledger semantics'
)
from captured_operation_test_state;
reset role;
alter table captured_operation_test_state add column export_id uuid;
update captured_operation_test_state state_record
set export_id = export_record.id
from private.captured_document_exports export_record
where export_record.operation_id = state_record.operation_id;

select is(
  (
    select count(*)::integer
    from private.captured_document_exports export_record
    join captured_operation_test_state state_record
      on state_record.operation_id = export_record.operation_id
  ),
  1,
  'export replay creates one exact-revision export request'
);

select is(
  (
    select export_record.brand_snapshot #>> '{brand_kit,footer_text}'
    from private.captured_document_exports export_record
    join captured_operation_test_state state_record
      on state_record.operation_id = export_record.operation_id
  ),
  'Captured export footer',
  'captured export admission freezes the target business brand snapshot'
);
select ok(
  (
    select export_record.brand_snapshot_version =
        'prompted.export-brand-snapshot.v1'
      and export_record.brand_snapshot_sha256 ~ '^[0-9a-f]{64}$'
    from private.captured_document_exports export_record
    join captured_operation_test_state state_record
      on state_record.operation_id = export_record.operation_id
  ),
  'captured export persists an exact versioned brand snapshot identity'
);
select ok(
  pg_temp.raises_matching(
    format(
      'update private.captured_document_exports set brand_snapshot_sha256=%L where id=%L::uuid',
      repeat('0', 64),
      state_record.export_id
    ),
    '%CAPTURED_EXPORT_BRAND_SNAPSHOT_IMMUTABLE%'
  ),
  'a captured export brand snapshot cannot be replaced after admission'
)
from captured_operation_test_state state_record;

update public.brand_kits
set footer_text = 'Later brand footer', revision = revision + 1
where business_id = '91500000-0000-4000-8000-000000000001';

set local role authenticated;
select is(
  public.request_captured_document_export(
    state_record.operation_id,
    12,
    state_record.document_id,
    3,
    'docx',
    'export-main'
  )->>'export_id',
  state_record.export_id::text,
  'the same export intent replays its exact admitted artifact after a later brand edit'
)
from captured_operation_test_state state_record;
reset role;

set local role service_role;
select is(
  public.get_captured_document_export_receipt(
    state_record.owner_id,
    state_record.export_id,
    state_record.operation_id
  ) #>> '{brand_snapshot,brand_kit,footer_text}',
  'Captured export footer',
  'captured export replay keeps the admitted brand after a later brand edit'
)
from captured_operation_test_state state_record;
reset role;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id,
      '95000000-0000-4000-8000-000000000099',
      13,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      '{"passed":true,"artifact_inspected":true}'
    ),
    '%CAPTURED_EXPORT_OPERATION_MISMATCH%'
  ),
  'an export completion cannot be rebound to a foreign operation'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id, state_record.operation_id, 12,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      '{"passed":true,"artifact_inspected":true}'
    ),
    '%STALE_OPERATION_REVISION:%'
  ),
  'a stale renderer cannot complete the current export request'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id, state_record.operation_id, 13,
      'captured-exports/91000000-0000-4000-8000-000000000002/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      '{"passed":true,"artifact_inspected":true}'
    ),
    '%CAPTURED_EXPORT_STORAGE_PATH_MISMATCH%'
  ),
  'artifact storage identity must contain the request owner and export identity'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id, state_record.operation_id, 13,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      '{"passed":true,"artifact_inspected":false}'
    ),
    '%CAPTURED_EXPORT_COMPLETION_INVALID%'
  ),
  'an uninspected artifact cannot complete an export request'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id, state_record.operation_id, 13,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      '{"passed":true,"artifact_inspected":true}'
    ),
    '%CAPTURED_EXPORT_BRAND_EVIDENCE_MISMATCH%'
  ),
  'captured completion cannot omit the admitted brand snapshot identity'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id, state_record.operation_id, 13,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      pg_catalog.jsonb_build_object(
        'passed', true,
        'artifact_inspected', true,
        'brand_snapshot_version', export_record.brand_snapshot_version,
        'brand_snapshot_sha256', repeat('f', 64)
      )::text
    ),
    '%CAPTURED_EXPORT_BRAND_EVIDENCE_MISMATCH%'
  ),
  'captured completion rejects a well-formed but incorrect brand snapshot hash'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select lives_ok(
  format(
    'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
    export_record.id, state_record.operation_id, 13,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      pg_catalog.jsonb_build_object(
        'passed', true,
        'artifact_inspected', true,
        'checks', pg_catalog.jsonb_build_array('opened', 'readable'),
        'brand_snapshot_version', export_record.brand_snapshot_version,
        'brand_snapshot_sha256', export_record.brand_snapshot_sha256
      )::text
    ),
  'service completion binds the inspected artifact to the immutable request'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select lives_ok(
  format(
    'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
    export_record.id, state_record.operation_id, 13,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('a', 64), 'renderer.test.1',
      pg_catalog.jsonb_build_object(
        'passed', true,
        'artifact_inspected', true,
        'checks', pg_catalog.jsonb_build_array('opened', 'readable'),
        'brand_snapshot_version', export_record.brand_snapshot_version,
        'brand_snapshot_sha256', export_record.brand_snapshot_sha256
      )::text
    ),
  'exact export completion replay returns the one durable artifact result'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      export_record.id, state_record.operation_id, 14,
      'captured-exports/' || state_record.owner_id::text || '/' || export_record.id::text || '/resume.docx',
      repeat('b', 64), 'renderer.test.1',
      pg_catalog.jsonb_build_object(
        'passed', true,
        'artifact_inspected', true,
        'checks', pg_catalog.jsonb_build_array('opened', 'readable'),
        'brand_snapshot_version', export_record.brand_snapshot_version,
        'brand_snapshot_sha256', export_record.brand_snapshot_sha256
      )::text
    ),
    '%CAPTURED_EXPORT_COMPLETION_REPLAY_CONFLICT%'
  ),
  'a completed export cannot be rebound to different artifact bytes'
)
from captured_operation_test_state state_record
join private.captured_document_exports export_record
  on export_record.operation_id = state_record.operation_id;
select is(
  (
    select export_record.status || ':' || (export_record.completed_at is not null)::text
    from private.captured_document_exports export_record
    join captured_operation_test_state state_record
      on state_record.operation_id = export_record.operation_id
  ),
  'created:true',
  'the inspected artifact is durably completed exactly once'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_operation_events event_record
    join captured_operation_test_state state_record
      on state_record.operation_id = event_record.operation_id
    where event_record.event_type = 'export_completed'
  ),
  1,
  'exact completion replay appends no duplicate export event'
);

-- A captured PDF snapshots one verified logo identity and retains that exact
-- object even when the current brand kit later removes its active pointer.
insert into storage.objects(bucket_id, name, metadata)
values (
  'assets',
  'brand-kits/91500000-0000-4000-8000-000000000001/logos/98500000-0000-8000-8000-000000000001.png',
  '{"mimetype":"image/png"}'::jsonb
);
update public.brand_kits
set logo_url = 'https://project.test/storage/v1/object/public/assets/brand-kits/91500000-0000-4000-8000-000000000001/logos/98500000-0000-8000-8000-000000000001.png',
    revision = revision + 1,
    logo_operation_id = '98500000-0000-8000-8000-000000000001',
    logo_storage_path = 'brand-kits/91500000-0000-4000-8000-000000000001/logos/98500000-0000-8000-8000-000000000001.png',
    logo_content_sha256 = repeat('5', 64),
    logo_media_type = 'image/png',
    logo_byte_length = 4,
    logo_status = 'ready',
    updated_at = pg_catalog.clock_timestamp()
where business_id = '91500000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select is(
  public.request_captured_document_export(
    state_record.operation_id,
    (public.get_latest_captured_document_operation(state_record.document_id)
      ->>'operation_revision')::integer,
    state_record.document_id,
    3,
    'pdf',
    'export-pdf-recovery'
  )->>'status',
  'requested',
  'owner requests a captured PDF against the exact current approved revision'
)
from captured_operation_test_state state_record;
reset role;

create temp table captured_pdf_recovery as
select
  export_record.id as export_id,
  export_record.operation_id,
  export_record.user_id,
  operation_record.operation_revision as expected_operation_revision,
  export_record.user_id::text || '/' || export_record.id::text || '/resume.pdf'
    as storage_path,
  repeat('6', 64)::text as artifact_sha256,
  512::integer as artifact_byte_length,
  '98000000-0000-4000-8000-000000000001'::uuid as dispatch_token
from private.captured_document_exports export_record
join private.captured_document_operations operation_record
  on operation_record.id = export_record.operation_id
where export_record.idempotency_key = 'export-pdf-recovery';
grant select on captured_pdf_recovery to service_role;

set local role service_role;
select is(
  public.claim_user_storage_dispatch(
    recovery.user_id,
    recovery.export_id,
    'captured-export',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      recovery.storage_path, 'UTF8'
    ), 'sha256'), 'hex'),
    recovery.artifact_sha256,
    recovery.dispatch_token
  )->>'outcome',
  'accepted',
  'captured PDF Storage is admitted once under the export identity'
)
from captured_pdf_recovery recovery;
reset role;

insert into storage.objects(bucket_id, name, metadata)
select 'captured-exports', storage_path, '{"mimetype":"application/pdf"}'::jsonb
from captured_pdf_recovery;

set local role service_role;
select is(
  public.record_captured_export_storage_recovery(
    recovery.user_id,
    recovery.export_id,
    recovery.operation_id,
    recovery.expected_operation_revision,
    recovery.storage_path,
    recovery.artifact_sha256,
    recovery.artifact_byte_length,
    'render-export.pdf.4',
    pg_temp.captured_pdf_validation(
      recovery.export_id,
      recovery.artifact_sha256,
      recovery.artifact_byte_length
    ),
    recovery.dispatch_token
  )->>'outcome',
  'recorded',
  'exact stored PDF and brand evidence are durably recorded before acknowledgement'
)
from captured_pdf_recovery recovery;

select is(
  public.record_captured_export_storage_recovery(
    recovery.user_id,
    recovery.export_id,
    recovery.operation_id,
    recovery.expected_operation_revision,
    recovery.storage_path,
    recovery.artifact_sha256,
    recovery.artifact_byte_length,
    'render-export.pdf.4',
    pg_temp.captured_pdf_validation(
      recovery.export_id,
      recovery.artifact_sha256,
      recovery.artifact_byte_length
    ),
    recovery.dispatch_token
  )->>'outcome',
  'idempotent_replay',
  'lost recovery acknowledgement replays one immutable recovery record'
)
from captured_pdf_recovery recovery;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.record_captured_export_storage_recovery(%L::uuid,%L::uuid,%L::uuid,%s,%L,%L,%s,%L,%L::jsonb,%L::uuid)',
      recovery.user_id,
      recovery.export_id,
      recovery.operation_id,
      recovery.expected_operation_revision,
      recovery.storage_path,
      recovery.artifact_sha256,
      recovery.artifact_byte_length + 1,
      'render-export.pdf.4',
      pg_temp.captured_pdf_validation(
        recovery.export_id,
        recovery.artifact_sha256,
        recovery.artifact_byte_length + 1
      )::text,
      recovery.dispatch_token
    ),
    '%CAPTURED_EXPORT_STORAGE_RECOVERY_CONFLICT%'
  ),
  'one recovery identity cannot be rebound to a different artifact length'
)
from captured_pdf_recovery recovery;

select is(
  public.get_captured_document_export_receipt(
    recovery.user_id,
    recovery.export_id,
    recovery.operation_id
  )->>'outcome',
  'storage_recovery',
  'a retained exact artifact resumes finalisation instead of rendering again'
)
from captured_pdf_recovery recovery;
select is(
  public.get_captured_document_export_receipt(
    recovery.user_id,
    recovery.export_id,
    recovery.operation_id
  )->>'storage_dispatch_token',
  recovery.dispatch_token::text,
  'an unresolved Storage acknowledgement returns only its original exact token'
)
from captured_pdf_recovery recovery;

select is(
  public.complete_user_storage_dispatch(
    recovery.user_id,
    recovery.export_id,
    'captured-export',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      recovery.storage_path, 'UTF8'
    ), 'sha256'), 'hex'),
    recovery.artifact_sha256,
    recovery.dispatch_token
  )->>'outcome',
  'completed',
  'captured PDF Storage acknowledgement closes after recovery is durable'
)
from captured_pdf_recovery recovery;
select ok(
  (
    select public.get_captured_document_export_receipt(
      recovery.user_id,
      recovery.export_id,
      recovery.operation_id
    )->>'storage_state' = 'completed'
    and public.get_captured_document_export_receipt(
      recovery.user_id,
      recovery.export_id,
      recovery.operation_id
    )->'storage_dispatch_token' = 'null'::jsonb
  ),
  'completed Storage recovery never exposes a reusable dispatch token'
)
from captured_pdf_recovery recovery;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
      recovery.export_id,
      recovery.operation_id,
      recovery.expected_operation_revision,
      recovery.storage_path,
      recovery.artifact_sha256,
      'render-export.pdf.4',
      pg_catalog.jsonb_build_object(
        'passed', true,
        'artifact_inspected', true,
        'brand_snapshot_version', 'prompted.export-brand-snapshot.v1'
      )::text
    ),
    '%CAPTURED_EXPORT_BRAND_EVIDENCE_MISMATCH%'
  ),
  'new captured PDF completion rejects legacy marker-only inspection evidence'
)
from captured_pdf_recovery recovery;

select lives_ok(
  format(
    'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
    recovery.export_id,
    recovery.operation_id,
    recovery.expected_operation_revision,
    recovery.storage_path,
    recovery.artifact_sha256,
    'render-export.pdf.4',
    pg_temp.captured_pdf_validation(
      recovery.export_id,
      recovery.artifact_sha256,
      recovery.artifact_byte_length
    )::text
  ),
  'strict v2 document, order, artifact, and frozen-brand evidence completes once'
)
from captured_pdf_recovery recovery;

create temp table referenced_logo_remove_claim as
select public.claim_brand_logo_operation(
  recovery.user_id,
  '98500000-0000-8000-8000-000000000002',
  '91500000-0000-4000-8000-000000000001',
  2,
  repeat('7', 64),
  'remove',
  '#123456',
  '#abcdef',
  'Later brand footer',
  null,
  null,
  null
) as receipt
from captured_pdf_recovery recovery;
select is(
  receipt->'old_storage_paths',
  '[]'::jsonb,
  'a logo frozen by a requested or completed export is excluded from deletion'
)
from referenced_logo_remove_claim;
reset role;
select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.request_captured_document_export(%L::uuid,%s,%L::uuid,%s,%L,%L)',
      state_record.operation_id,
      (public.get_latest_captured_document_operation(state_record.document_id)
        ->>'operation_revision')::integer,
      state_record.document_id,
      3,
      'pdf',
      'export-during-brand-mutation'
    ),
    '%BRAND_LOGO_OPERATION_IN_PROGRESS%'
  ),
  'captured export admission cannot race an active brand mutation'
)
from captured_operation_test_state state_record;
reset role;
set local role service_role;
select lives_ok(
  $$select public.complete_brand_logo_operation(
    '91000000-0000-4000-8000-000000000001',
    '98500000-0000-8000-8000-000000000002',
    ((select receipt->>'claim_token' from referenced_logo_remove_claim))::uuid,
    repeat('8', 64)
  )$$,
  'current brand pointer removal may complete without deleting frozen export evidence'
);
reset role;
select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where bucket_id = 'assets'
      and name = 'brand-kits/91500000-0000-4000-8000-000000000001/logos/98500000-0000-8000-8000-000000000001.png'
  ),
  1,
  'historical captured export logo bytes remain available after current removal'
);

select lives_ok(
  pg_temp.accept_sql(
    owner_id, owner_outcome_id, cancel_document_id,
    'Cancellation test resume', 'capture-cancel'
  ),
  'a second operation can be accepted independently'
)
from captured_operation_test_state;
update captured_operation_test_state state_record
set cancel_operation_id = operation_record.id
from private.captured_document_operations operation_record
where operation_record.user_id = state_record.owner_id
  and operation_record.idempotency_key = 'capture-cancel';

select lives_ok(
  format(
    'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
    cancel_operation_id, 1, 'pgtap-renewing-worker', 300
  ),
  'a worker claims the cancellation-test operation'
)
from captured_operation_test_state;
update captured_operation_test_state state_record
set lease_token = operation_record.lease_token
from private.captured_document_operations operation_record
where operation_record.id = state_record.cancel_operation_id;
select lives_ok(
  format(
    'select public.claim_captured_document_operation(%L::uuid,%s,%L,%s)',
    cancel_operation_id, 2, 'pgtap-renewing-worker', 900
  ),
  'the exact lease owner renews the same durable lease between stages'
)
from captured_operation_test_state;
select is(
  (
    select operation_record.operation_revision::text || ':' ||
      (operation_record.lease_token = state_record.lease_token)::text
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.cancel_operation_id = operation_record.id
  ),
  '3:true',
  'lease renewal advances durable revision without changing the fencing token'
);

select lives_ok(
  format(
    'select public.advance_captured_document_operation(%L::uuid,%s,%L::uuid,%L,%L::jsonb)',
    cancel_operation_id, 3, lease_token, 'generating', '{}'
  ),
  'the cancellation-test lease holder enters the provider stage'
)
from captured_operation_test_state;
select lives_ok(
  pg_temp.provider_attempt_sql(
    cancel_operation_id, 4, lease_token, 'generation', 0, 'deep',
    'gpt-test-deep', 'medium', null, 'prepared', 0, 0,
    null, null, '2026-08-31T02:00:00Z', null,
    repeat('d', 64), null
  ),
  'the in-flight provider dispatch is durably prepared before owner cancellation'
)
from captured_operation_test_state;

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select lives_ok(
  format(
    'select public.request_captured_document_cancellation(%L::uuid,%s,%L)',
    cancel_operation_id, 5, 'owner_cancelled'
  ),
  'owner cancellation records durable intent while a provider attempt is live'
)
from captured_operation_test_state;
select lives_ok(
  format(
    'select public.request_captured_document_cancellation(%L::uuid,%s,%L)',
    cancel_operation_id, 5, 'owner_cancelled'
  ),
  'exact pending owner cancellation replay is idempotent'
)
from captured_operation_test_state;
reset role;
select is(
  (
    select status || ':' || operation_revision::text || ':' ||
      (cancel_requested_at is not null)::text
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.cancel_operation_id = operation_record.id
  ),
  'generating:6:true',
  'active work retains its lease and exposes durable cancellation intent'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.cancel_captured_document_operation(%L::uuid,%s,%L::uuid,%L)',
      cancel_operation_id, 6, lease_token, 'owner_cancelled'
    ),
    '%CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED%'
  ),
  'the lease holder cannot release cancellation while a provider attempt is unresolved'
)
from captured_operation_test_state;
select lives_ok(
  pg_temp.provider_attempt_sql(
    cancel_operation_id, 6, lease_token, 'generation', 1, 'deep',
    'gpt-test-deep', 'medium', 'response-cancelled-late', 'succeeded', 21, 34,
    null, null, '2026-08-31T02:00:00Z', '2026-08-31T02:00:02Z',
    repeat('d', 64), '{"sections":[]}'::jsonb
  ),
  'the lease holder reconciles the completed provider attempt with actual usage'
)
from captured_operation_test_state;
select is(
  (
    select usage_record.input_tokens::text || ':' ||
      usage_record.output_tokens::text
    from public.usage_ledger usage_record
    join private.captured_document_provider_attempts attempt_record
      on usage_record.generation_request_id =
        'captured-attempt:' || attempt_record.id::text
    join captured_operation_test_state state_record
      on state_record.cancel_operation_id = attempt_record.operation_id
  ),
  '21:34',
  'late provider usage is settled exactly once before the document reservation is released'
);
select lives_ok(
  format(
    'select public.cancel_captured_document_operation(%L::uuid,%s,%L::uuid,%L)',
    cancel_operation_id, 7, lease_token, 'owner_cancelled'
  ),
  'the lease holder terminalizes cancellation after provider reconciliation'
)
from captured_operation_test_state;
select is(
  (
    select status
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.cancel_operation_id = operation_record.id
  ),
  'cancelled',
  'cancelled state is durable after the in-flight attempt is reconciled'
);
select is(
  (
    select count(*)::integer
    from private.captured_document_allowances allowance_record
    join captured_operation_test_state state_record
      on state_record.cancel_operation_id = allowance_record.operation_id
  ),
  0,
  'cancelled work consumes no completed-document allowance'
);
select is(
  (
    select reservation_record.status
    from private.document_allowance_reservations reservation_record
    join captured_operation_test_state state_record
      on state_record.cancel_operation_id = reservation_record.captured_operation_id
    order by reservation_record.attempt_number desc
    limit 1
  ),
  'released',
  'terminal cancellation releases only the residual document allowance reservation'
);

select lives_ok(
  format(
    'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
    'local', 'internal', 'generate_document', 'resume',
    'captured-test.1', 'routing.test.1', route_snapshot::text,
    false, 1, 'pgtap', 'rollback new admissions'
  ),
  'rollback disables new captured admissions through the pointer only'
)
from captured_operation_test_state;
select ok(
  pg_temp.raises_matching(
    pg_temp.accept_sql(
      owner_id, owner_outcome_id, disabled_document_id,
      'Disabled admission', 'capture-disabled'
    ),
    '%CAPTURED_ACTIVATION_DISABLED:%'
  ),
  'disabled pointer routes new work away from captured acceptance'
)
from captured_operation_test_state;
select lives_ok(
  pg_temp.accept_sql(
    owner_id, owner_outcome_id, cancel_document_id,
    'Cancellation test resume', 'capture-cancel'
  ),
  'pointer rollback does not orphan replay of an existing captured operation'
)
from captured_operation_test_state;

select lives_ok(
  format(
    'select public.configure_captured_document_activation(%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%s,%L,%L)',
    'local', 'internal', 'generate_document', 'resume',
    'captured-test.1', 'routing.test.1', route_snapshot::text,
    true, 2, 'pgtap', 'restore reviewed pointer revision'
  ),
  'a reviewed prior ledger/routing selection can be restored forward'
)
from captured_operation_test_state;
select is(
  (
    select revision::text || ':' || enabled::text
    from private.document_ledger_activation_pointers
    where scope_key = 'local:internal:generate_document:resume'
  ),
  '3:true',
  'pointer restoration advances rather than rewrites activation history'
);
select is(
  (select count(*)::integer from private.captured_document_activation_revisions),
  3,
  'enable, disable and restore decisions all remain immutable'
);

select lives_ok(
  pg_temp.accept_sql(
    deletion_id, deletion_outcome_id, deletion_document_id,
    'Deletion cascade resume', 'capture-delete'
  ),
  'captured state can be prepared for account-deletion cascade acceptance'
)
from captured_operation_test_state;
update captured_operation_test_state state_record
set deletion_operation_id = operation_record.id
from private.captured_document_operations operation_record
where operation_record.user_id = state_record.deletion_id
  and operation_record.idempotency_key = 'capture-delete';
select lives_ok(
  format('delete from auth.users where id = %L::uuid', deletion_id),
  'auth-user deletion cascades captured documents and private user records'
)
from captured_operation_test_state;
select is(
  (
    select count(*)::integer
    from private.captured_document_operations operation_record
    join captured_operation_test_state state_record
      on state_record.deletion_operation_id = operation_record.id
  ),
  0,
  'account deletion leaves no captured operation row for the deleted owner'
);
select is(
  (
    select count(*)::integer
    from public.documents document_record
    join captured_operation_test_state state_record
      on state_record.deletion_document_id = document_record.id
  ),
  0,
  'account deletion leaves no captured document row for the deleted owner'
);

select set_config(
  'request.jwt.claim.sub',
  (select owner_id::text from captured_operation_test_state),
  true
);
set local role authenticated;
select lives_ok(
  $$update public.documents
    set title = 'Legacy direct-DML compatibility retained'
    where title = 'Legacy compatibility document'$$,
  'legacy direct DML remains compatible while captured rows are RPC-only'
);
select is(
  (
    select public.get_latest_captured_document_operation(document_record.id)
    from public.documents document_record
    where document_record.title = 'Legacy direct-DML compatibility retained'
  ),
  null::jsonb,
  'legacy documents expose no invented captured-operation status'
);
reset role;
select is(
  (
    select ledger_binding_status
    from public.documents
    where title = 'Legacy direct-DML compatibility retained'
  ),
  'legacy_unversioned',
  'legacy compatibility never relabels historical document provenance'
);

-- Simulate rows that existed before the additive brand-snapshot migration.
-- Disable only the new INSERT capture trigger for these fixtures; the v0 table
-- constraints and public receipt/completion contracts remain live.
alter table private.captured_document_exports
  disable trigger capture_captured_export_brand_snapshot_before_insert;
insert into private.captured_document_exports(
  id, operation_id, approval_id, document_id, user_id, document_revision,
  ledger_version, format, idempotency_key, request_sha256, status,
  storage_path, artifact_sha256, renderer_version,
  artifact_validation_result, completion_sha256, completed_at,
  validation_result, brand_snapshot_version, brand_snapshot,
  brand_snapshot_sha256
)
select
  '97000000-0000-4000-8000-000000000001',
  operation_record.id,
  approval_record.id,
  operation_record.document_id,
  operation_record.user_id,
  operation_record.latest_document_revision,
  operation_record.ledger_version,
  'pdf',
  'historical-v0-completed',
  repeat('c', 64),
  'created',
  'captured-exports/' || operation_record.user_id::text ||
    '/97000000-0000-4000-8000-000000000001/document.pdf',
  repeat('d', 64),
  'renderer.historical.1',
  '{"passed":true,"artifact_inspected":true}'::jsonb,
  repeat('e', 64),
  pg_catalog.clock_timestamp(),
  approval_record.validation_result,
  'prompted.export-brand-snapshot.legacy-unbound.v0',
  '{"brand_kit":null}'::jsonb,
  null
from captured_operation_test_state state_record
join private.captured_document_operations operation_record
  on operation_record.id = state_record.operation_id
join private.captured_document_approvals approval_record
  on approval_record.operation_id = operation_record.id;

insert into private.captured_document_exports(
  id, operation_id, approval_id, document_id, user_id, document_revision,
  ledger_version, format, idempotency_key, request_sha256, status,
  validation_result, brand_snapshot_version, brand_snapshot,
  brand_snapshot_sha256
)
select
  '97000000-0000-4000-8000-000000000002',
  operation_record.id,
  approval_record.id,
  operation_record.document_id,
  operation_record.user_id,
  operation_record.latest_document_revision,
  operation_record.ledger_version,
  'pdf',
  'historical-v0-pending',
  repeat('f', 64),
  'requested',
  approval_record.validation_result,
  'prompted.export-brand-snapshot.legacy-unbound.v0',
  '{"brand_kit":null}'::jsonb,
  null
from captured_operation_test_state state_record
join private.captured_document_operations operation_record
  on operation_record.id = state_record.operation_id
join private.captured_document_approvals approval_record
  on approval_record.operation_id = operation_record.id;
alter table private.captured_document_exports
  enable trigger capture_captured_export_brand_snapshot_before_insert;

set local role service_role;
select is(
  public.get_captured_document_export_receipt(
    state_record.owner_id,
    '97000000-0000-4000-8000-000000000001',
    state_record.operation_id
  ) #>> '{brand_snapshot,snapshot_version}',
  'prompted.export-brand-snapshot.legacy-unbound.v0',
  'a completed historical v0 export remains explicitly unbound and replayable'
)
from captured_operation_test_state state_record;
reset role;

select lives_ok(
  format(
    'select public.complete_captured_document_export(%L::uuid,%L::uuid,%s,%L,%L,%L,%L::jsonb)',
    '97000000-0000-4000-8000-000000000002',
    operation_record.id,
    operation_record.operation_revision,
    'captured-exports/' || operation_record.user_id::text ||
      '/97000000-0000-4000-8000-000000000002/document.pdf',
    repeat('1', 64),
    'renderer.historical.1',
    pg_catalog.jsonb_build_object(
      'passed', true,
      'artifact_inspected', true,
      'brand_snapshot_version',
        'prompted.export-brand-snapshot.legacy-unbound.v0',
      'brand_snapshot_sha256', null
    )::text
  ),
  'an admitted historical v0 request completes only with explicit unbound evidence'
)
from captured_operation_test_state state_record
join private.captured_document_operations operation_record
  on operation_record.id = state_record.operation_id;

delete from public.brand_kits
where business_id = '91500000-0000-4000-8000-000000000001';
insert into private.captured_document_exports(
  id, operation_id, approval_id, document_id, user_id, document_revision,
  ledger_version, format, idempotency_key, request_sha256, status,
  validation_result
)
select
  '97000000-0000-4000-8000-000000000003',
  operation_record.id,
  approval_record.id,
  operation_record.document_id,
  operation_record.user_id,
  operation_record.latest_document_revision,
  operation_record.ledger_version,
  'pdf',
  'new-v1-without-brand-row',
  repeat('2', 64),
  'requested',
  approval_record.validation_result
from captured_operation_test_state state_record
join private.captured_document_operations operation_record
  on operation_record.id = state_record.operation_id
join private.captured_document_approvals approval_record
  on approval_record.operation_id = operation_record.id;
select ok(
  (
    select export_record.brand_snapshot_version =
        'prompted.export-brand-snapshot.v1'
      and export_record.brand_snapshot = '{"brand_kit":null}'::jsonb
      and export_record.brand_snapshot_sha256 ~ '^[0-9a-f]{64}$'
    from private.captured_document_exports export_record
    where export_record.id = '97000000-0000-4000-8000-000000000003'
  ),
  'a new export without a brand row records a hashed v1 null snapshot rather than historical v0'
);

select * from finish();
rollback;
