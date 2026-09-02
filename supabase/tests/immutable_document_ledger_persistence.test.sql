begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(62);

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$$;

create temp table l02_test_state (
  user_id uuid not null,
  outcome_id uuid not null,
  artifact_id uuid not null,
  block_id uuid not null,
  second_block_id uuid not null,
  contract_json jsonb not null,
  contract_hash text not null,
  snapshot_id uuid
);

insert into l02_test_state values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  '{
    "schemaVersion": "1.0.0",
    "ledgerVersion": "l02-test.1",
    "templates": {
      "cover-letter": {
        "sections": [
          {"sectionKey": "opening", "required": true},
          {"sectionKey": "optional_note", "required": false}
        ]
      }
    }
  }'::jsonb,
  '',
  null
);

grant select on l02_test_state to authenticated;

update l02_test_state
set contract_hash = encode(
  extensions.digest(convert_to(contract_json::text, 'UTF8'), 'sha256'),
  'hex'
);

select has_schema('private', 'private schema exists');
select has_table('private', 'document_ledger_versions', 'immutable ledger table exists');
select has_table('private', 'document_ledger_activation_pointers', 'dormant activation table exists');
select has_table('private', 'document_generation_snapshots', 'immutable snapshot table exists');
select has_column('public', 'documents', 'ledger_binding_status', 'legacy documents expose binding status');
select has_column('public', 'sections', 'section_key', 'legacy sections expose versioned key seam');
select has_column('public', 'ted_artifacts', 'ledger_version', 'artifacts expose ledger version');
select has_column('public', 'ted_artifact_blocks', 'ledger_section_key', 'artifact blocks expose section identity');
select has_column('public', 'export_history', 'approved_revision', 'exports can record approved revision');
select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    join pg_class table_record on table_record.oid = constraint_record.conrelid
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'public'
      and table_record.relname = 'ted_artifact_blocks'
      and constraint_record.conname = 'ted_artifact_blocks_parent_scope_fkey'
      and constraint_record.contype = 'f'
  ),
  'artifact block parents are constrained to the same artifact and owner'
);

select has_function(
  'public', 'register_document_ledger_version',
  array['text', 'text', 'jsonb', 'text', 'text'],
  'service ledger registration RPC exists'
);
select has_function(
  'public', 'prepare_document_generation_snapshot',
  array['uuid', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'jsonb', 'jsonb', 'text[]', 'jsonb'],
  'service snapshot RPC exists'
);
select has_function(
  'public', 'bind_ted_artifact_ledger',
  array['uuid', 'integer', 'text', 'text', 'text', 'uuid'],
  'service artifact binding RPC exists'
);
select has_function(
  'public', 'bind_ted_artifact_block_ledger',
  array['uuid', 'integer', 'integer', 'text', 'boolean', 'text', 'uuid', 'text', 'text'],
  'service block binding RPC exists'
);
select has_function(
  'public', 'save_ted_artifact_block_revision',
  array['uuid', 'integer', 'integer', 'jsonb', 'text'],
  'authenticated revision save RPC exists'
);
select has_function(
  'public', 'approve_ted_artifact_block_revision',
  array['uuid', 'integer', 'integer'],
  'authenticated approval RPC exists'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated users have no usage on the private ledger schema'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anonymous users have no usage on the private ledger schema'
);
select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'register_document_ledger_version',
        'prepare_document_generation_snapshot',
        'bind_ted_artifact_ledger',
        'bind_ted_artifact_block_ledger',
        'save_ted_artifact_block_revision',
        'approve_ted_artifact_block_revision'
      )
      and p.prosecdef
  ),
  6,
  'all six ledger persistence RPCs are security definer boundaries'
);
select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'register_document_ledger_version',
        'prepare_document_generation_snapshot',
        'bind_ted_artifact_ledger',
        'bind_ted_artifact_block_ledger',
        'save_ted_artifact_block_revision',
        'approve_ted_artifact_block_revision'
      )
      and array_to_string(p.proconfig, ',') like 'search_path=%'
      and array_to_string(p.proconfig, ',') not like '%public%'
  ),
  6,
  'all six security definer RPCs exclude public from their configured search path'
);

select ok(
  not has_table_privilege('authenticated', 'private.document_ledger_versions', 'SELECT'),
  'authenticated users cannot read private ledger contracts'
);
select ok(
  not has_table_privilege('anon', 'private.document_generation_snapshots', 'SELECT'),
  'anonymous users cannot read private generation snapshots'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.register_document_ledger_version(text,text,jsonb,text,text)',
    'EXECUTE'
  ),
  'authenticated users cannot register immutable ledgers'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.prepare_document_generation_snapshot(uuid,text,text,text,text,text,jsonb,jsonb,jsonb,text[],jsonb)',
    'EXECUTE'
  ),
  'authenticated users cannot manufacture generation snapshots'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.save_ted_artifact_block_revision(uuid,integer,integer,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated users can invoke the revision-checked save boundary'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.approve_ted_artifact_block_revision(uuid,integer,integer)',
    'EXECUTE'
  ),
  'authenticated users can invoke the revision-checked approval boundary'
);
select is(
  (select count(*)::integer from private.document_ledger_activation_pointers where enabled),
  0,
  'L0.2 activates no ledger version'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%activate%ledger%'
  ),
  'L0.2 exposes no ledger activation RPC'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
select user_id, 'l02@example.invalid', false, false, now(), now()
from l02_test_state;
insert into public.outcomes(id, user_id, situation_text)
select outcome_id, user_id, 'Synthetic L0.2 persistence test'
from l02_test_state;
insert into public.documents(user_id, title)
select user_id, 'Historical document'
from l02_test_state;
insert into public.ted_artifacts(
  id, outcome_id, user_id, kind, title, template_id, request_id
)
select artifact_id, outcome_id, user_id, 'document', 'Captured test artifact',
  'cover-letter', 'l02-artifact-request'
from l02_test_state;
insert into public.ted_artifact_blocks(
  id, artifact_id, user_id, kind, stable_key, heading, payload
)
select block_id, artifact_id, user_id, 'section', 'opening', 'Opening',
  '{"content":"Initial supported content"}'::jsonb
from l02_test_state;
insert into public.ted_artifact_blocks(
  id, artifact_id, user_id, kind, stable_key, heading, payload, order_index
)
select second_block_id, artifact_id, user_id, 'section', 'optional_note', 'Optional note',
  '{"content":"Optional supported content"}'::jsonb, 1
from l02_test_state;

select set_config('request.jwt.claim.sub', (select user_id::text from l02_test_state), true);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'insert into public.ted_artifact_blocks(artifact_id,user_id,kind,stable_key,heading,payload,parent_block_id,order_index) values (%L::uuid,%L::uuid,%L,%L,%L,%L::jsonb,%L::uuid,%s)',
      artifact_id, user_id, 'section', 'nested_test', 'Nested test',
      '{"content":"Nested legacy content"}', block_id, 2
    ),
    '%permission denied for table ted_artifact_blocks%'
  ),
  'authenticated callers cannot bypass artifact commands with direct nested-block INSERT'
)
from l02_test_state;
reset role;

select is(
  (select ledger_binding_status from public.documents where title = 'Historical document'),
  'legacy_unversioned',
  'existing document writes remain explicitly legacy unversioned'
);
select is(
  (select ledger_binding_status from public.ted_artifacts where request_id = 'l02-artifact-request'),
  'legacy_unversioned',
  'existing artifact writes remain explicitly legacy unversioned'
);

select lives_ok(
  format(
    'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
    '1.0.0', 'l02-test.1', contract_json::text, contract_hash, 'pgtap'
  ),
  'a reviewed ledger version can be registered once'
)
from l02_test_state;
select is(
  (select count(*)::integer from private.document_ledger_versions where ledger_version = 'l02-test.1'),
  1,
  'exactly one immutable ledger row was stored'
);
select is(
  (select contract_sha256 from private.document_ledger_versions where ledger_version = 'l02-test.1'),
  (select contract_hash from l02_test_state),
  'stored ledger digest matches canonical JSON'
);
select lives_ok(
  format(
    'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
    '1.0.0', 'l02-test.1', contract_json::text, contract_hash, 'pgtap'
  ),
  'exact ledger registration replay is idempotent'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.register_document_ledger_version(%L,%L,%L::jsonb,%L,%L)',
      '1.0.0', 'l02-test.1',
      jsonb_set(contract_json, '{templates,cover-letter,changed}', 'true')::text,
      encode(extensions.digest(convert_to(jsonb_set(contract_json, '{templates,cover-letter,changed}', 'true')::text, 'UTF8'), 'sha256'), 'hex'),
      'pgtap'
    ),
    'LEDGER_VERSION_CONFLICT:%'
  ),
  'a ledger version cannot be rebound to different content'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    $$update private.document_ledger_versions set schema_version = '2.0.0' where ledger_version = 'l02-test.1'$$,
    'IMMUTABLE_LEDGER_RECORD:%'
  ),
  'registered ledger rows are immutable'
);

select lives_ok(
  format(
    'select public.prepare_document_generation_snapshot(%L::uuid,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb,%L::jsonb,%L::text[],%L::jsonb)',
    user_id, 'l02-generation-request', 'l02-test.1', 'cover-letter',
    'cover-letter-benchmark.1', 'pipeline-test.1',
    '{"recipient":"Confirmed recipient"}',
    '{"sourceRefs":["synthetic:user-answer"]}',
    '{"facts":["recipient"]}', '{}', '{"recipient":true}'
  ),
  'a complete immutable generation snapshot can be prepared'
)
from l02_test_state;
update l02_test_state set snapshot_id = (
  select id from private.document_generation_snapshots
  where generation_request_id = 'l02-generation-request'
);
select is(
  (select count(*)::integer from private.document_generation_snapshots where generation_request_id = 'l02-generation-request'),
  1,
  'generation request identity stores exactly one snapshot'
);
select lives_ok(
  format(
    'select public.prepare_document_generation_snapshot(%L::uuid,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb,%L::jsonb,%L::text[],%L::jsonb)',
    user_id, 'l02-generation-request', 'l02-test.1', 'cover-letter',
    'cover-letter-benchmark.1', 'pipeline-test.1',
    '{"recipient":"Confirmed recipient"}',
    '{"sourceRefs":["synthetic:user-answer"]}',
    '{"facts":["recipient"]}', '{}', '{"recipient":true}'
  ),
  'exact generation request replay returns the same logical snapshot'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.prepare_document_generation_snapshot(%L::uuid,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb,%L::jsonb)',
      user_id, 'l02-generation-request', 'l02-test.1', 'cover-letter',
      'cover-letter-benchmark.1', 'pipeline-test.1',
      '{"recipient":"Different recipient"}', '{}', '{}'
    ),
    'GENERATION_REPLAY_CONFLICT:%'
  ),
  'same request identity with different inputs fails closed'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.prepare_document_generation_snapshot(%L::uuid,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb,%L::jsonb)',
      user_id, 'unknown-template-request', 'l02-test.1', 'missing-template',
      'benchmark.1', 'pipeline-test.1', '{}', '{}', '{}'
    ),
    'UNKNOWN_LEDGER_TEMPLATE:%'
  ),
  'unknown template IDs fail closed at snapshot preparation'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    $$update private.document_generation_snapshots set pipeline_version = 'changed' where generation_request_id = 'l02-generation-request'$$,
    'IMMUTABLE_LEDGER_RECORD:%'
  ),
  'generation snapshots are immutable'
);

select lives_ok(
  format(
    'select public.bind_ted_artifact_ledger(%L::uuid,%s,%L,%L,%L,%L::uuid)',
    artifact_id, 1, 'l02-test.1', 'cover-letter',
    'cover-letter-benchmark.1', snapshot_id
  ),
  'service boundary binds an artifact to its exact generation snapshot'
)
from l02_test_state;
select is(
  (select ledger_binding_status from public.ted_artifacts where id = artifact_id),
  'captured',
  'artifact now carries captured immutable identity'
)
from l02_test_state;
select lives_ok(
  format(
    'select public.bind_ted_artifact_block_ledger(%L::uuid,%s,%s,%L,%L,%L)',
    block_id, 2, 1, 'opening', true, 'final'
  ),
  'service boundary binds a required block to its ledger section'
)
from l02_test_state;
select is(
  (select ledger_binding_status || ':' || ledger_section_key from public.ted_artifact_blocks where id = block_id),
  'captured:opening',
  'block now carries the captured section identity'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.bind_ted_artifact_block_ledger(%L::uuid,%s,%s,%L,%L,%L)',
      second_block_id, 3, 1, 'optional_note', true, 'final'
    ),
    'LEDGER_SECTION_REQUIREDNESS_MISMATCH:%'
  ),
  'caller cannot redefine ledger section requiredness'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.bind_ted_artifact_block_ledger(%L::uuid,%s,%s,%L,%L,%L)',
      second_block_id, 3, 1, 'unknown_section', false, 'final'
    ),
    'UNKNOWN_LEDGER_SECTION:%'
  ),
  'unknown section keys fail closed at binding'
)
from l02_test_state;

select set_config('request.jwt.claim.sub', (select user_id::text from l02_test_state), true);
set local role authenticated;
select lives_ok(
  format(
    'select public.save_ted_artifact_block_revision(%L::uuid,%s,%s,%L::jsonb,%L)',
    block_id, 3, 2, '{"content":"User-edited supported content"}', 'final'
  ),
  'owner can save through the revision-checked RPC'
)
from l02_test_state;
reset role;
select is(
  (select revision::text || ':' || approval_status || ':' || coalesce(approved_revision::text, 'null')
   from public.ted_artifact_blocks where id = block_id),
  '3:draft:null',
  'editing increments revision and clears prior approval'
)
from l02_test_state;

set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.save_ted_artifact_block_revision(%L::uuid,%s,%s,%L::jsonb,%L)',
      block_id, 3, 2, '{"content":"Stale overwrite"}', 'final'
    ),
    'ARTIFACT_BLOCK_REPLAY_CONFLICT'
  ),
  'stale save cannot overwrite a newer revision'
)
from l02_test_state;
select lives_ok(
  format(
    'select public.approve_ted_artifact_block_revision(%L::uuid,%s,%s)',
    block_id, 4, 3
  ),
  'owner can approve the exact current final revision'
)
from l02_test_state;
reset role;
select is(
  (select revision::text || ':' || approved_revision::text || ':' || approval_status
   from public.ted_artifact_blocks where id = block_id),
  '4:4:approved',
  'approval records the exact approved block revision'
)
from l02_test_state;
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'update public.ted_artifact_blocks set payload = %L::jsonb where id = %L::uuid',
      '{"content":"Bypass attempt"}', block_id
    ),
    '%permission denied for table ted_artifact_blocks%'
  ),
  'authenticated block UPDATE is denied before the captured revision trigger'
)
from l02_test_state;
reset role;
select ok(
  pg_temp.raises_matching(
    format(
      'update public.ted_artifacts set title = %L where id = %L::uuid',
      'Whole-artifact overwrite attempt', artifact_id
    ),
    'REVISION_RPC_REQUIRED:%'
  ),
  'even privileged whole-artifact mutation must use the captured revision RPC boundary'
)
from l02_test_state;

select is(
  (select count(*)::integer from public.ted_artifact_versions v where v.artifact_id = s.artifact_id),
  4,
  'binding, block binding, edit, and approval each append a durable artifact revision'
)
from l02_test_state s;
select ok(
  pg_temp.raises_matching(
    format(
      'update public.ted_artifact_versions set snapshot = %L::jsonb where artifact_id = %L::uuid and revision = 5',
      '{}', artifact_id
    ),
    'IMMUTABLE_CAPTURED_ARTIFACT_VERSION:%'
  ),
  'captured artifact revisions are immutable'
)
from l02_test_state;
select ok(
  pg_temp.raises_matching(
    format('delete from public.ted_artifacts where id = %L::uuid', artifact_id),
    'IMMUTABLE_CAPTURED_ARTIFACT:%'
  ),
  'captured artifacts cannot be silently deleted'
)
from l02_test_state;
select is(
  (select current_revision from public.ted_artifacts a where a.id = s.artifact_id),
  5,
  'artifact revision monotonically tracks all captured mutations'
)
from l02_test_state s;
select is(
  (select v.snapshot->>'ledger_version' from public.ted_artifact_versions v
   where v.artifact_id = s.artifact_id and v.revision = 5),
  'l02-test.1',
  'durable revision snapshot retains the exact ledger version'
)
from l02_test_state s;
select is(
  (select v.snapshot->'blocks'->0->>'ledger_section_key' from public.ted_artifact_versions v
   where v.artifact_id = s.artifact_id and v.revision = 5),
  'opening',
  'durable revision snapshot retains the version-scoped section key'
)
from l02_test_state s;

select * from finish();
rollback;
