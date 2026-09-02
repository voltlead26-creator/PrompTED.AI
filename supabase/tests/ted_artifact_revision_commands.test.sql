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

select has_table(
  'private', 'ted_artifact_mutation_receipts',
  'artifact changes have a metadata-only durable receipt authority'
);
select ok(
  (
    select relation_record.relrowsecurity
    from pg_catalog.pg_class relation_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = relation_record.relnamespace
    where schema_record.nspname = 'private'
      and relation_record.relname = 'ted_artifact_mutation_receipts'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'private.ted_artifact_mutation_receipts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'private.ted_artifact_mutation_receipts', 'SELECT'
  ),
  'receipt rows are RLS-protected and unavailable to browser and service roles'
);
select ok(
  not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'private'
      and column_record.table_name = 'ted_artifact_mutation_receipts'
      and column_record.column_name in (
        'payload', 'content', 'references', 'prompt', 'document_body'
      )
  ),
  'receipts contain no wording, source, prompt or document-body column'
);
select has_trigger(
  'private', 'ted_artifact_mutation_receipts',
  'ted_artifact_mutation_receipt_immutable',
  'receipt metadata cannot be updated after commit'
);
select has_function(
  'public', 'save_ted_artifact_block_revision',
  array['uuid', 'integer', 'integer', 'jsonb', 'text'],
  'block payload saves retain the exact stable RPC signature'
);
select has_function(
  'public', 'set_ted_block_completed',
  array['uuid', 'boolean', 'integer'],
  'completion retains the exact stable RPC signature'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc procedure_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'save_ted_artifact_block_revision', 'set_ted_block_completed'
      )
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  ),
  2,
  'both artifact mutation commands are fixed-path security definers'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_ted_artifact_block_revision(uuid,integer,integer,jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_ted_artifact_block_revision(uuid,integer,integer,jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_ted_artifact_block_revision(uuid,integer,integer,jsonb,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_ted_block_completed(uuid,boolean,integer)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.set_ted_block_completed(uuid,boolean,integer)',
    'EXECUTE'
  ),
  'only authenticated owners can invoke artifact mutation commands'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('b1000000-0000-4000-8000-000000000001', 'artifact-command-owner@example.invalid', false, false, now(), now()),
  ('b1000000-0000-4000-8000-000000000002', 'artifact-command-other@example.invalid', false, false, now(), now());

insert into public.outcomes(id, user_id, situation_text, status)
values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Owner action plan', 'in_progress'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'Other action plan', 'in_progress');

insert into public.ted_artifacts(
  id, outcome_id, user_id, kind, title, status, quality_status,
  current_revision, request_id, approved_revision
) values
  (
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'action_plan', 'Owner plan', 'approved', 'passed', 1,
    'artifact-command-owner', 1
  ),
  (
    'b3000000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'action_plan', 'Other plan', 'approved', 'passed', 1,
    'artifact-command-other', 1
  );

insert into public.ted_artifact_blocks(
  id, artifact_id, user_id, kind, stable_key, heading, order_index,
  payload, approval_status, approved_revision, revision
) values
  (
    'b4000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'action', 'owner_action', 'Owner section', 0,
    '{"title":"Original action","objective":"Original objective"}',
    'approved', 1, 1
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    'b3000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'action', 'other_action', 'Other section', 0,
    '{"title":"Other action","objective":"Other objective"}',
    'approved', 1, 1
  );

insert into public.checklist_items(
  id, outcome_id, user_id, text, reason, done, order_index
) values
  (
    'b4000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'Owner section␟Original action', 'Original objective', false, 0
  ),
  (
    'b4000000-0000-4000-8000-000000000002',
    'b2000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000002',
    'Other section␟Other action', 'Other objective', false, 0
  );

insert into public.ted_artifact_versions(artifact_id, user_id, revision, snapshot)
select artifact_record.id, artifact_record.user_id, 1,
  pg_catalog.to_jsonb(artifact_record) || pg_catalog.jsonb_build_object(
    'blocks', pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(block_record))
  )
from public.ted_artifacts artifact_record
join public.ted_artifact_blocks block_record
  on block_record.artifact_id = artifact_record.id
where artifact_record.id in (
  'b3000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002'
);

create temporary table artifact_command_results(
  name text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on artifact_command_results to authenticated;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

insert into artifact_command_results(name, result)
values (
  'legacy-save',
  public.save_ted_artifact_block_revision(
    'b4000000-0000-4000-8000-000000000001', 1, 1,
    '{"title":"Revised action","objective":"Durably revised objective"}'::jsonb,
    null
  )
);
reset role;

select ok(
  (
    select result->>'status' = 'committed'
      and result->>'contract_version' = 'ted-artifact-mutation.1'
      and result->>'idempotent_replay' = 'false'
      and result->>'artifact_revision' = '2'
      and result->>'block_revision' = '2'
    from artifact_command_results where name = 'legacy-save'
  ),
  'legacy block save returns one explicit committed revision receipt'
);
select ok(
  (
    select payload = '{"title":"Revised action","objective":"Durably revised objective"}'::jsonb
      and revision = 2
      and approval_status = 'draft'
      and approved_revision is null
      and ledger_binding_status = 'legacy_unversioned'
      and section_state is null
    from public.ted_artifact_blocks
    where id = 'b4000000-0000-4000-8000-000000000001'
  ),
  'legacy wording persists while ledger identity remains explicitly unversioned'
);
select ok(
  (
    select current_revision = 2 and status = 'needs_review'
      and approved_revision is null
    from public.ted_artifacts
    where id = 'b3000000-0000-4000-8000-000000000001'
  )
  and (
    select text = 'Owner section␟Revised action'
      and reason = 'Durably revised objective'
    from public.checklist_items
    where id = 'b4000000-0000-4000-8000-000000000001'
  ),
  'the parent revision, approval and checklist projection commit atomically'
);
select ok(
  (
    select snapshot->>'current_revision' = '2'
      and snapshot->'blocks'->0->>'revision' = '2'
      and snapshot->'blocks'->0->'payload'->>'objective'
        = 'Durably revised objective'
    from public.ted_artifact_versions
    where artifact_id = 'b3000000-0000-4000-8000-000000000001'
      and revision = 2
  ),
  'the immutable version reloads exact authoritative edited rows'
);

set local role authenticated;
insert into artifact_command_results(name, result)
values (
  'legacy-save-replay',
  public.save_ted_artifact_block_revision(
    'b4000000-0000-4000-8000-000000000001', 1, 1,
    '{"title":"Revised action","objective":"Durably revised objective"}'::jsonb,
    null
  )
);
reset role;
select ok(
  (
    select result->>'idempotent_replay' = 'true'
      and result->>'operation_id' = (
        select result->>'operation_id'
        from artifact_command_results where name = 'legacy-save'
      )
    from artifact_command_results where name = 'legacy-save-replay'
  )
  and (
    select current_revision = 2
    from public.ted_artifacts
    where id = 'b3000000-0000-4000-8000-000000000001'
  )
  and (
    select pg_catalog.count(*) = 2
    from public.ted_artifact_versions
    where artifact_id = 'b3000000-0000-4000-8000-000000000001'
  ),
  'an acknowledgement retry replays one receipt without another write'
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.save_ted_artifact_block_revision(
      'b4000000-0000-4000-8000-000000000001', 1, 1,
      '{"title":"Different reuse","objective":"Must fail"}'::jsonb,
      null
    )$$,
    '%ARTIFACT_BLOCK_REPLAY_CONFLICT%'
  ),
  'the same accepted revision identity cannot be reused for different wording'
);
select ok(
  pg_temp.raises_matching(
    $$select public.save_ted_artifact_block_revision(
      'b4000000-0000-4000-8000-000000000001', 2, 2,
      '{"title":"Invalid state","objective":"Must fail"}'::jsonb,
      'final'
    )$$,
    '%LEGACY_ARTIFACT_SECTION_STATE_FORBIDDEN%'
  ),
  'legacy rows cannot manufacture a captured section state'
);

insert into artifact_command_results(name, result)
select 'legacy-completion', pg_catalog.to_jsonb(completed_block)
from public.set_ted_block_completed(
  'b4000000-0000-4000-8000-000000000001', true, 2
) completed_block;
reset role;

select ok(
  (
    select result->>'revision' = '3'
      and result->>'approval_status' = 'draft'
      and result->>'approved_revision' is null
      and result->>'completed_at' is not null
    from artifact_command_results where name = 'legacy-completion'
  )
  and (
    select done from public.checklist_items
    where id = 'b4000000-0000-4000-8000-000000000001'
  ),
  'completion persists the child revision and compatibility projection'
);
select ok(
  (
    select current_revision = 3 and status = 'needs_review'
      and approved_revision is null
    from public.ted_artifacts
    where id = 'b3000000-0000-4000-8000-000000000001'
  )
  and (
    select snapshot->>'current_revision' = '3'
      and snapshot->'blocks'->0->>'revision' = '3'
      and snapshot->'blocks'->0->>'completed_at' is not null
    from public.ted_artifact_versions
    where artifact_id = 'b3000000-0000-4000-8000-000000000001'
      and revision = 3
  ),
  'completion advances the parent and captures the exact completed state'
);

set local role authenticated;
insert into artifact_command_results(name, result)
select 'legacy-completion-replay', pg_catalog.to_jsonb(completed_block)
from public.set_ted_block_completed(
  'b4000000-0000-4000-8000-000000000001', true, 2
) completed_block;
reset role;
select ok(
  (
    select result->>'revision' = '3'
    from artifact_command_results where name = 'legacy-completion-replay'
  )
  and (
    select current_revision = 3
    from public.ted_artifacts
    where id = 'b3000000-0000-4000-8000-000000000001'
  )
  and (
    select pg_catalog.count(*) = 3
    from public.ted_artifact_versions
    where artifact_id = 'b3000000-0000-4000-8000-000000000001'
  ),
  'completion acknowledgement replay cannot toggle or advance state twice'
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.set_ted_block_completed(
      'b4000000-0000-4000-8000-000000000001', false, 2
    )$$,
    '%ARTIFACT_BLOCK_REVISION_CONFLICT%'
  ),
  'an opposite stale completion cannot reuse the accepted block revision'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.save_ted_artifact_block_revision(
      'b4000000-0000-4000-8000-000000000001', 3, 3,
      '{"title":"Foreign overwrite","objective":"Forbidden"}'::jsonb,
      null
    )$$,
    '%ARTIFACT_BLOCK_UNAVAILABLE%'
  )
  and pg_temp.raises_matching(
    $$select public.set_ted_block_completed(
      'b4000000-0000-4000-8000-000000000001', false, 3
    )$$,
    '%ARTIFACT_BLOCK_UNAVAILABLE%'
  ),
  'foreign callers cannot observe or mutate another owner artifact graph'
);
reset role;

select ok(
  pg_temp.raises_matching(
    $$update private.ted_artifact_mutation_receipts
      set request_sha256 = repeat('0', 64)
      where mutation_kind = 'block_payload'$$,
    '%TED_ARTIFACT_MUTATION_RECEIPT_IMMUTABLE%'
  )
  and not exists (
    select 1
    from private.ted_artifact_mutation_receipts
    where result::text like '%Durably revised objective%'
  ),
  'receipts are immutable and contain no edited wording'
);

-- Captured action completion must use the same revision command without
-- weakening immutable ledger identity.
insert into private.document_ledger_versions(
  ledger_version, schema_version, contract_sha256, contract_json,
  template_count, registered_by
) values (
  'artifact-command-ledger.1', '1.0.0',
  pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        '{"schemaVersion":"1.0.0","ledgerVersion":"artifact-command-ledger.1","templates":{"action-plan":{"sections":[{"sectionKey":"first_action","required":true}]}}}'::jsonb::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  '{"schemaVersion":"1.0.0","ledgerVersion":"artifact-command-ledger.1","templates":{"action-plan":{"sections":[{"sectionKey":"first_action","required":true}]}}}'::jsonb,
  1, 'pgtap'
);
insert into private.document_generation_snapshots(
  id, user_id, generation_request_id, template_id, ledger_version,
  benchmark_version, pipeline_version, input_values, source_snapshot,
  evidence_snapshot, unresolved_input_keys, confirmations, snapshot_sha256
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'artifact-command-captured', 'action-plan', 'artifact-command-ledger.1',
  'artifact-command-benchmark.1', 'ted-v2', '{}', '{}', '{}', '{}', '{}',
  repeat('1', 64)
);
insert into public.ted_artifacts(
  id, outcome_id, user_id, kind, title, status, quality_status,
  current_revision, request_id
) values (
  'b3000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'action_plan', 'Captured owner plan', 'ready', 'passed', 1,
  'artifact-command-captured'
);
insert into public.ted_artifact_blocks(
  id, artifact_id, user_id, kind, stable_key, heading, order_index,
  payload, approval_status, revision
) values (
  'b4000000-0000-4000-8000-000000000003',
  'b3000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000001',
  'action', 'first_action', 'Captured section', 0,
  '{"title":"Captured action","objective":"Captured objective"}',
  'draft', 1
);
insert into public.checklist_items(
  id, outcome_id, user_id, text, reason, done, order_index
) values (
  'b4000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Captured section␟Captured action', 'Captured objective', false, 1
);

set local role service_role;
select public.bind_ted_artifact_ledger(
  'b3000000-0000-4000-8000-000000000003', 1,
  'artifact-command-ledger.1', 'action-plan',
  'artifact-command-benchmark.1', 'b5000000-0000-4000-8000-000000000001'
);
select public.bind_ted_artifact_block_ledger(
  'b4000000-0000-4000-8000-000000000003', 2, 1,
  'first_action', true, 'final'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into artifact_command_results(name, result)
select 'captured-completion', pg_catalog.to_jsonb(completed_block)
from public.set_ted_block_completed(
  'b4000000-0000-4000-8000-000000000003', true, 2
) completed_block;
reset role;

select ok(
  (
    select ledger_binding_status = 'captured'
      and ledger_section_key = 'first_action'
      and ledger_version = 'artifact-command-ledger.1'
      and revision = 3
      and completed_at is not null
    from public.ted_artifact_blocks
    where id = 'b4000000-0000-4000-8000-000000000003'
  )
  and (
    select current_revision = 4 and ledger_binding_status = 'captured'
      and ledger_version = 'artifact-command-ledger.1'
    from public.ted_artifacts
    where id = 'b3000000-0000-4000-8000-000000000003'
  ),
  'captured completion advances revisions without weakening ledger identity'
);
select ok(
  (
    select snapshot->>'ledger_binding_status' = 'captured'
      and snapshot->'blocks'->0->>'ledger_section_key' = 'first_action'
      and snapshot->'blocks'->0->>'completed_at' is not null
    from public.ted_artifact_versions
    where artifact_id = 'b3000000-0000-4000-8000-000000000003'
      and revision = 4
  ),
  'captured completion history contains the exact completed ledger-bound block'
);

set local role authenticated;
select public.approve_ted_artifact_block_revision(
  'b4000000-0000-4000-8000-000000000003', 4, 3
);
reset role;
select ok(
  (
    select status = 'approved'
      and current_revision = 5
      and approved_revision = 5
    from public.ted_artifacts
    where id = 'b3000000-0000-4000-8000-000000000003'
  )
  and (
    select approval_status = 'approved'
      and revision = 4
      and approved_revision = 4
    from public.ted_artifact_blocks
    where id = 'b4000000-0000-4000-8000-000000000003'
  ),
  'the last required exact block approval finalises the exact parent revision'
);

select * from finish();
rollback;
