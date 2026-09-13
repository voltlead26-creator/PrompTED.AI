begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.manual_raises(p_sql text, p_message text)
returns boolean language plpgsql as $function$
begin
  execute p_sql;
  raise notice 'Expected %, but the statement succeeded', p_message;
  return false;
exception when others then
  if sqlerrm <> p_message then
    raise notice 'Expected %, received % (%)', p_message, sqlerrm, sqlstate;
  end if;
  return sqlerrm = p_message;
end;
$function$;

create function pg_temp.manual_command(p_operation integer, p_plan text default 'local-plan:one',
  p_items jsonb default '[{"id":"fallback-item:1","section":"  Draft ␟\n","text":" Same wording  ","notes":"\nKeep — exact\n","due_date":"2028-02-29","done":false},{"id":"fallback-item:2","section":"  Draft ␟\n","text":" Same wording  ","notes":"\nKeep — exact\n","due_date":"0001-01-01","done":false},{"id":"blank-3","section":"","text":"","notes":"","due_date":null,"done":false}]',
  p_title text default E'  Manual plan\n')
returns jsonb language sql as $function$
  select jsonb_build_object('contract_version', 'manual-plan-save.1',
    'operation_id', 'fd030000-0000-4000-8000-' || lpad(p_operation::text, 12, '0'),
    'plan_id', p_plan, 'expected', null, 'title', p_title, 'items', p_items);
$function$;

create function pg_temp.manual_edit(p_operation integer, p_snapshot jsonb,
  p_items jsonb default null, p_title text default null)
returns jsonb language sql as $function$
  select pg_temp.manual_command(p_operation, p_snapshot->>'plan_id',
    coalesce(p_items, p_snapshot->'items'), coalesce(p_title, p_snapshot->>'title'))
    || jsonb_build_object('expected', jsonb_build_object(
      'outcome_id', p_snapshot->>'outcome_id', 'artifact_id', p_snapshot->>'artifact_id',
      'revision', p_snapshot->'revision', 'updated_at', p_snapshot->>'updated_at'));
$function$;

create temporary table manual_results(name text primary key, command jsonb, result jsonb) on commit drop;
grant select, insert, update on manual_results to authenticated;

select has_function('public', 'save_own_manual_plan_v1', array['jsonb'], 'one manual save command');
select has_function('public', 'get_own_manual_plan_v1', array['text','uuid'], 'stable owner read signature');
select has_function('public', 'list_own_manual_plans_v1', array['integer','integer'], 'stable owner list signature');
select ok((select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('save_own_manual_plan_v1','get_own_manual_plan_v1','list_own_manual_plans_v1')
    and p.prosecdef and p.proconfig @> array['search_path=""']), 'manual RPCs fix their empty search path');
select ok(has_function_privilege('authenticated', 'public.save_own_manual_plan_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.save_own_manual_plan_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.save_own_manual_plan_v1(jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_own_manual_plan_v1(text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.list_own_manual_plans_v1(integer,integer)', 'EXECUTE'),
  'manual commands are authenticated-owner only, including reads');
select ok(not has_table_privilege('authenticated','private.manual_plan_save_receipts','SELECT')
  and not has_table_privilege('service_role','private.manual_plan_save_receipts','SELECT')
  and (select relrowsecurity from pg_class where oid = 'private.manual_plan_save_receipts'::regclass),
  'receipt metadata is private and RLS protected');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private'
  and table_name = 'manual_plan_save_receipts' and data_type = 'jsonb'), 'receipts contain no second content snapshot');
select ok(not has_function_privilege('authenticated','private.manual_plan_snapshot_v1(uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','private.assert_manual_plan_owner_v1(uuid)','EXECUTE'),
  'private read and owner helpers cannot become a bypass');
select ok(not has_function_privilege('authenticated','private.assert_manual_plan_namespace_available_v1()','EXECUTE')
  and not has_function_privilege('anon','private.assert_manual_plan_namespace_available_v1()','EXECUTE')
  and not has_function_privilege('service_role','private.assert_manual_plan_namespace_available_v1()','EXECUTE')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid='private.assert_manual_plan_namespace_available_v1()'::regprocedure),
  'the migration preflight is private and fixes its empty search path');
select lives_ok($$select private.assert_manual_plan_namespace_available_v1()$$,
  'the unused manual namespace passes the migration preflight');

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at) values
  ('fd010000-0000-4000-8000-000000000001','manual-owner@example.invalid',false,false,now(),now()),
  ('fd010000-0000-4000-8000-000000000002','manual-other@example.invalid',false,false,now(),now()),
  ('fd010000-0000-4000-8000-000000000003','manual-deleting@example.invalid',false,false,now(),now());

-- Model historical request identity independently of the current artifact.
-- This ordinary legacy snapshot needs no disabled trigger or rewritten row.
insert into public.outcomes(id,user_id,situation_text) values
  ('fd020000-0000-4000-8000-000000000099','fd010000-0000-4000-8000-000000000001','Namespace preservation fixture');
insert into public.ted_artifacts(id,outcome_id,user_id,kind,title,request_id) values
  ('fd030000-0000-4000-8000-000000000099','fd020000-0000-4000-8000-000000000099',
    'fd010000-0000-4000-8000-000000000001','action_plan','Unchanged legacy title','ordinary-legacy-request');
insert into public.ted_artifact_versions(artifact_id,user_id,revision,snapshot) values
  ('fd030000-0000-4000-8000-000000000099','fd010000-0000-4000-8000-000000000001',1,
    '{"pipeline_version":"ted-v2","request_id":"manual-plan.1:historical-only","title":"Unchanged historical wording","blocks":[]}');
select ok(pg_temp.manual_raises($$select private.assert_manual_plan_namespace_available_v1()$$,
  'MANUAL_PLAN_NAMESPACE_CONFLICT'),'historical reserved request identity blocks namespace publication');
select is((select snapshot from public.ted_artifact_versions
  where artifact_id='fd030000-0000-4000-8000-000000000099'),
  '{"pipeline_version":"ted-v2","request_id":"manual-plan.1:historical-only","title":"Unchanged historical wording","blocks":[]}'::jsonb,
  'preflight refusal preserves exact historical content');
select is((select title from public.ted_artifacts where id='fd030000-0000-4000-8000-000000000099'),
  'Unchanged legacy title','preflight refusal leaves the current artifact unchanged');
delete from public.outcomes where id='fd020000-0000-4000-8000-000000000099';
select lives_ok($$select private.assert_manual_plan_namespace_available_v1()$$,
  'the isolated historical collision fixture leaves the namespace empty after cleanup');

select set_config('request.jwt.claim.sub','fd010000-0000-4000-8000-000000000001',true);
set local role authenticated;

select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1('{}')$$, 'MANUAL_PLAN_INPUT_INVALID'),
  'missing command fields fail before persistence');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_command(1) || '{"extra":1}')$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'unknown command fields are rejected');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{items}','[]'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'an empty item roster is rejected');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{items,1,id}','"fallback-item:1"'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'duplicate item identity is rejected independently of duplicate wording');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{items,0,due_date}','"2027-02-29"'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'nonexistent Gregorian civil date is rejected');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{items,0,due_date}','"0000-01-01"'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'year zero is rejected');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{items,0,done}','"false"'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'boolean coercion is forbidden');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{items,0,text}',to_jsonb(repeat('x',20001))))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'oversized item content is rejected without truncation');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_command(1,'oversized',
  (select jsonb_agg(jsonb_build_object('id','item-'||i,'section','','text',repeat('x',20000),'notes',repeat('x',10000),'due_date',null,'done',false))
   from generate_series(1,40) i)))$$,'MANUAL_PLAN_INPUT_INVALID'), 'server bounds the whole JSON command at one MiB');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_command(1,'too-many',
  (select jsonb_agg(jsonb_build_object('id','item-'||i,'section','','text','','notes','','due_date',null,'done',false))
   from generate_series(1,201) i)))$$,'MANUAL_PLAN_INPUT_INVALID'), 'item count is bounded independently of content length');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_command(1),'{operation_id}','"FD030000-0000-4000-8000-000000000001"'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'UUIDs use canonical lowercase identity');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_command(1,'bad plan id'))$$,
  'MANUAL_PLAN_INPUT_INVALID'), 'source IDs retain the agreed portable fallback syntax');

insert into manual_results(name,command) values ('created',pg_temp.manual_command(1));
update manual_results set result = public.save_own_manual_plan_v1(command) where name = 'created';
select is((select result->>'status' from manual_results where name='created'),'saved','initial save commits');
select is((select result->'snapshot'->'items' from manual_results where name='created'),
  (select command->'items' from manual_results where name='created'), 'blank, duplicate, separator and newline content round trips verbatim');
select is((select result->'snapshot'->>'title' from manual_results where name='created'), E'  Manual plan\n', 'title is not trimmed');
select is((select result->'snapshot'->>'revision' from manual_results where name='created'),'1','initial artifact revision is one');
select ok((select result->'committed'->>'updated_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
  and result->>'request_sha256' ~ '^[0-9a-f]{64}$' from manual_results where name='created'),
  'receipt returns a six-digit UTC aggregate token and a server digest');
insert into manual_results(name,result) select 'replayed',public.save_own_manual_plan_v1(command) from manual_results where name='created';
select is((select result->>'status' from manual_results where name='replayed'),'replayed','lost-response retry replays the same operation');
select is((select result - 'status' from manual_results where name='replayed'),
  (select result - 'status' from manual_results where name='created'),'replay keeps exact committed identity, hash and snapshot');
select is(public.get_own_manual_plan_v1('local-plan:one',null)->'plan',
  (select result->'snapshot' from manual_results where name='created'),'reopen by original local ID reads the accepted graph');
select is(public.get_own_manual_plan_v1(null,(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created'))->'plan',
  (select result->'snapshot' from manual_results where name='created'),'reopen by outcome uses the same authority');
select ok(pg_temp.manual_raises($$select public.get_own_manual_plan_v1(null,null)$$,'MANUAL_PLAN_INPUT_INVALID'),
  'read requires exactly one identity');
select ok(pg_temp.manual_raises($$select public.get_own_manual_plan_v1('local-plan:one',
  (select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created'))$$,'MANUAL_PLAN_INPUT_INVALID'),
  'read does not guess between two supplied identities');
select ok(pg_temp.manual_raises($$select public.get_own_manual_plan_v1('bad plan id',null)$$,'MANUAL_PLAN_INPUT_INVALID'),
  'read validates the original source ID');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1((select command || '{"title":"different"}' from manual_results where name='created'))$$,
  'MANUAL_PLAN_OPERATION_CONFLICT'),'same operation with changed content is a conflict');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_command(2))$$,
  'MANUAL_PLAN_SOURCE_CONFLICT'),'new operation cannot duplicate an already imported local plan');

reset role;
select ok(pg_temp.manual_raises($$select private.assert_manual_plan_namespace_available_v1()$$,
  'MANUAL_PLAN_NAMESPACE_CONFLICT'),'already published manual identities cannot be silently reclassified by another migration');
select is(public.get_own_manual_plan_v1('local-plan:one',null)->'plan',
  (select result->'snapshot' from manual_results where name='created'),
  'refusing an occupied namespace does not change the live manual graph');
select is((select count(*)::integer from public.ted_artifacts where user_id='fd010000-0000-4000-8000-000000000001'),1,
  'save and retry create one artifact');
select is((select count(*)::integer from public.ted_artifact_versions where user_id='fd010000-0000-4000-8000-000000000001'),1,
  'save and retry capture one immutable version');
select is((select count(*)::integer from private.manual_plan_save_receipts where user_id='fd010000-0000-4000-8000-000000000001'),1,
  'save and retry create one receipt');
select ok((select kind='action_plan' and pipeline_version='manual-plan.1' and status='draft' and quality_status='pending'
  and ledger_binding_status='legacy_unversioned' and template_id is null and ledger_version is null
  and generation_snapshot_id is null and approved_revision is null
  from public.ted_artifacts where user_id='fd010000-0000-4000-8000-000000000001'),
  'manual rows do not fabricate template, quality, approval or provider provenance');
select is((select recommendation_payload from public.outcomes where user_id='fd010000-0000-4000-8000-000000000001'),
  '{"manual_plan":{"contract_version":"manual-plan.1","plan_id":"local-plan:one"}}'::jsonb,
  'outcome stores routing metadata without a second title or item body');
select ok(not exists (select 1 from public.ted_artifact_blocks b join public.checklist_items c on c.id=b.id
  where b.user_id='fd010000-0000-4000-8000-000000000001' and
    (c.text is distinct from b.heading || chr(9247) || (b.payload->>'text')
      or c.reason is distinct from b.payload->>'notes' or c.due_date is distinct from b.due_date
      or c.done is distinct from (b.completed_at is not null))), 'checklist projection preserves exact words and civil dates');

set local role authenticated;
select public.update_own_outcome((select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created'),
  '{"is_saved":false,"status":"in_progress"}');
insert into manual_results(name,result) select 'metadata-replay',public.save_own_manual_plan_v1(command) from manual_results where name='created';
select is((select result->>'status' from manual_results where name='metadata-replay'),'superseded',
  'bookmark and status metadata conservatively supersede the aggregate token');
select is((select result->'committed' from manual_results where name='metadata-replay'),
  (select result->'committed' from manual_results where name='created'),'superseded receipt preserves the original commit token');
select is((select (result->'snapshot') - 'updated_at' from manual_results where name='metadata-replay'),
  (select (result->'snapshot') - 'updated_at' from manual_results where name='created'),
  'metadata-only supersession preserves revision and every plan item');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_edit(3,(select result->'snapshot' from manual_results where name='created')))$$,
  'MANUAL_PLAN_VERSION_CONFLICT'),'stale aggregate timestamp fails even when artifact revision is unchanged');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_edit(3,(select result->'snapshot' from manual_results where name='metadata-replay')),'{expected,revision}','1.5'))$$,
  'MANUAL_PLAN_INPUT_INVALID'),'fractional revision is rejected');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_edit(3,(select result->'snapshot' from manual_results where name='metadata-replay')),'{expected,updated_at}','"2026-09-13T00:00:00.000000+00:00"'))$$,
  'MANUAL_PLAN_INPUT_INVALID'),'timestamp tokens cannot be reconstructed into another spelling');

insert into manual_results(name,command) select 'title',pg_temp.manual_edit(4,result->'snapshot',null,E'\nRenamed exactly  ')
  from manual_results where name='metadata-replay';
update manual_results set result=public.save_own_manual_plan_v1(command) where name='title';
select is((select result->'snapshot'->>'revision' from manual_results where name='title'),'2','title edit advances artifact revision once');
select ok((select (result->'snapshot'->>'updated_at')::timestamptz from manual_results where name='title') >
  (select (result->'snapshot'->>'updated_at')::timestamptz from manual_results where name='metadata-replay'),
  'title-only save advances aggregate time within this same SQL transaction');
reset role;
select ok((select bool_and(revision=1) from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001'),
  'title-only edit leaves every block revision unchanged');
set local role authenticated;

insert into manual_results(name,command) select 'completed',pg_temp.manual_edit(5,result->'snapshot',
  jsonb_set(jsonb_set(result->'snapshot'->'items','{0,done}','true'),'{0,notes}',to_jsonb(E'changed\nnotes  '::text)))
  from manual_results where name='title';
update manual_results set result=public.save_own_manual_plan_v1(command) where name='completed';
insert into manual_results(name,command) select 'same-content',pg_temp.manual_edit(6,result->'snapshot') from manual_results where name='completed';
update manual_results set result=public.save_own_manual_plan_v1(command) where name='same-content';
reset role;
select is((select revision from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001' and stable_key='fallback-item:1'),2,
  'unchanged accepted content does not churn an item revision');
select ok((select b.completed_at = (historical.item->>'completed_at')::timestamptz
  from public.ted_artifact_blocks b join public.ted_artifact_versions v on v.artifact_id=b.artifact_id and v.revision=3
  cross join lateral jsonb_array_elements(v.snapshot->'blocks') historical(item)
  where b.user_id='fd010000-0000-4000-8000-000000000001' and b.stable_key='fallback-item:1'
    and historical.item->>'id'=b.id::text), 'already completed items retain their original completion time');
set local role authenticated;

insert into manual_results(name,command) select 'removed',pg_temp.manual_edit(7,result->'snapshot',(result->'snapshot'->'items') - 1)
  from manual_results where name='same-content';
update manual_results set result=public.save_own_manual_plan_v1(command) where name='removed';
insert into manual_results(name,command) select 'undo',pg_temp.manual_edit(8,result->'snapshot',
  (select result->'snapshot'->'items' from manual_results where name='same-content')) from manual_results where name='removed';
update manual_results set result=public.save_own_manual_plan_v1(command) where name='undo';
select is((select result->'snapshot'->'items' from manual_results where name='undo'),
  (select result->'snapshot'->'items' from manual_results where name='same-content'),'delete and undo restore exact item order and wording');
insert into manual_results(name,result) select 'old-retry',public.save_own_manual_plan_v1(command) from manual_results where name='created';
select is((select result->>'status' from manual_results where name='old-retry'),'superseded','old retry never overwrites a newer revision');
select is((select result->'snapshot' from manual_results where name='old-retry'),
  (select result->'snapshot' from manual_results where name='undo'),'superseded retry returns current authoritative content');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(jsonb_set(pg_temp.manual_edit(9,
  (select result->'snapshot' from manual_results where name='undo')),'{expected,revision}','5'))$$,
  'MANUAL_PLAN_VERSION_CONFLICT'),'current timestamp with a stale artifact revision cannot overwrite newer work');
reset role;
select is((select revision from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001' and stable_key='fallback-item:2'),2,
  'undo uses the next historical item revision rather than resetting to one');
select ok((select b.id=extensions.uuid_generate_v5(b.artifact_id,b.stable_key) from public.ted_artifact_blocks b
  where b.user_id='fd010000-0000-4000-8000-000000000001' and b.stable_key='fallback-item:2'),
  'undo keeps deterministic artifact-bound item identity');
select is((select count(*)::integer from public.ted_artifact_versions where user_id='fd010000-0000-4000-8000-000000000001'),6,
  'six accepted commands produce six versions; all retries and conflicts add none');

-- A live history row or receipt cannot be rewritten or individually erased.
select ok(pg_temp.manual_raises($$update public.ted_artifact_versions set snapshot='{}'
  where artifact_id=(select (result->'snapshot'->>'artifact_id')::uuid from manual_results where name='created')$$,
  'MANUAL_PLAN_HISTORY_IMMUTABLE'),'manual version content is immutable');
select ok(pg_temp.manual_raises($$delete from public.ted_artifact_versions
  where artifact_id=(select (result->'snapshot'->>'artifact_id')::uuid from manual_results where name='created')$$,
  'MANUAL_PLAN_HISTORY_IMMUTABLE'),'live manual versions cannot be deleted');
select ok(pg_temp.manual_raises($$update private.manual_plan_save_receipts set request_sha256=repeat('0',64)
  where user_id='fd010000-0000-4000-8000-000000000001'$$,'MANUAL_PLAN_HISTORY_IMMUTABLE'), 'receipt identities are immutable');
select ok(pg_temp.manual_raises($$delete from private.manual_plan_save_receipts
  where user_id='fd010000-0000-4000-8000-000000000001'$$,'MANUAL_PLAN_HISTORY_IMMUTABLE'), 'live receipts cannot be erased');

-- Direct sink checks also cover privileged ledger writers, not just a UI RPC.
select ok(pg_temp.manual_raises($$update public.ted_artifacts set pipeline_version='ted-v2'
  where user_id='fd010000-0000-4000-8000-000000000001'$$,'MANUAL_PLAN_COMMAND_REQUIRED'), 'manual artifacts cannot be reclassified');
select ok(pg_temp.manual_raises($$update public.ted_artifact_blocks set approval_status='approved'
  where user_id='fd010000-0000-4000-8000-000000000001'$$,'MANUAL_PLAN_COMMAND_REQUIRED'), 'generic approval cannot alter a manual block');
select ok(pg_temp.manual_raises($$delete from public.checklist_items
  where user_id='fd010000-0000-4000-8000-000000000001'$$,'MANUAL_PLAN_COMMAND_REQUIRED'), 'direct projection replacement is fenced');
select ok(pg_temp.manual_raises($$insert into public.documents(user_id,outcome_id,title)
  select 'fd010000-0000-4000-8000-000000000001',(result->'snapshot'->>'outcome_id')::uuid,'Takeover'
  from manual_results where name='created'$$,'MANUAL_PLAN_COMMAND_REQUIRED'), 'document creation cannot take over a manual outcome');
insert into public.outcomes(id,user_id,situation_text) values
  ('fd020000-0000-4000-8000-000000000010','fd010000-0000-4000-8000-000000000001','Generated compatibility');
insert into public.documents(id,user_id,outcome_id,title) values
  ('fd050000-0000-4000-8000-000000000010','fd010000-0000-4000-8000-000000000001','fd020000-0000-4000-8000-000000000010','Existing document');
select ok(pg_temp.manual_raises($$update public.documents set outcome_id=(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created')
  where id='fd050000-0000-4000-8000-000000000010'$$,'MANUAL_PLAN_COMMAND_REQUIRED'), 'workspace or import relinking cannot take over a manual outcome');

set local role authenticated;
select ok(pg_temp.manual_raises($$select public.update_own_outcome((select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created'),
  '{"recommendation_payload":null}')$$,'MANUAL_PLAN_COMMAND_REQUIRED'),'generic metadata command cannot remove routing identity');
select ok(pg_temp.manual_raises($$insert into public.outcomes(user_id,situation_text,recommendation_payload)
  values('fd010000-0000-4000-8000-000000000001','spoof','{"manual_plan":{"contract_version":"manual-plan.1","plan_id":"spoof"}}')$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'direct outcome insert cannot spoof manual routing metadata');
select ok(pg_temp.manual_raises($$select public.save_ted_artifact(jsonb_build_object('outcome_id',
  (select result->'snapshot'->>'outcome_id' from manual_results where name='created'),
  'kind','action_plan','title','Overwrite','request_id','generic-takeover'), '[]')$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'generic artifact creation cannot replace the owning projection');
select ok(pg_temp.manual_raises($$select public.save_ted_artifact(jsonb_build_object('outcome_id',
  (select result->'snapshot'->>'outcome_id' from manual_results where name='created'),
  'kind','action_plan','title','Overwrite','request_id','manual-plan.1:local-plan:one'), '[]')$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'generic create-or-replay cannot falsely acknowledge a manual request ID');
select ok(pg_temp.manual_raises($$select public.update_own_checklist_item(id,outcome_id,mutation_token,true,null)
  from public.checklist_items where user_id='fd010000-0000-4000-8000-000000000001' limit 1$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'generic item mutation cannot diverge projection from manual content');
select ok(pg_temp.manual_raises($$select public.set_ted_block_completed(id,true,revision)
  from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001' and stable_key='fallback-item:2'$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'generic completion cannot diverge the manual graph');
select ok(pg_temp.manual_raises($$select public.save_ted_artifact_block_revision(b.id,a.current_revision,b.revision,'{"text":"overwrite"}',null)
  from public.ted_artifact_blocks b join public.ted_artifacts a on a.id=b.artifact_id
  where b.user_id='fd010000-0000-4000-8000-000000000001' and b.stable_key='fallback-item:2'$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'generic payload revision cannot rewrite manual content');
insert into manual_results(name,result)
select 'before-checklist-takeover',jsonb_build_object(
  'plan',public.get_own_manual_plan_v1(null,o.id)->'plan',
  'projection',(select jsonb_agg(to_jsonb(c) order by c.id) from public.checklist_items c where c.outcome_id=o.id))
from public.outcomes o where o.id=(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created');
select ok(pg_temp.manual_raises($$select public.replace_own_checklist(o.id,'invalid-manual-takeover',o.updated_at,
  '[{"id":"fd040000-0000-4000-8000-000000000090","text":"Overwrite","reason":"Replace","due_date":null,"done":false,"order_index":0}]')
  from public.outcomes o where o.id=(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created')$$,
  'CHECKLIST_ITEM_INVALID'),'checklist replacement does not accept completion fields outside its existing contract');
select ok(pg_temp.manual_raises($$select public.replace_own_checklist(o.id,'manual-takeover',o.updated_at,
  '[{"id":"fd040000-0000-4000-8000-000000000090","text":"Overwrite","reason":"Replace","due_date":null,"order_index":0}]')
  from public.outcomes o where o.id=(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created')$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'generic checklist replacement cannot remove the manual projection');
select is((select jsonb_build_object(
  'plan',public.get_own_manual_plan_v1(null,o.id)->'plan',
  'projection',(select jsonb_agg(to_jsonb(c) order by c.id) from public.checklist_items c where c.outcome_id=o.id))
  from public.outcomes o where o.id=(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created')),
  (select result from manual_results where name='before-checklist-takeover'),
  'rejected checklist commands preserve the exact manual snapshot and every projection field');

-- Generated/legacy callers retain their original create, replay and completion.
insert into manual_results(name,result) values ('generated', jsonb_build_object('id',public.save_ted_artifact(
  '{"id":"fd030000-0000-4000-8000-000000000090","outcome_id":"fd020000-0000-4000-8000-000000000010","kind":"action_plan","title":"Generated plan","request_id":"generated-compatibility"}',
  '[{"id":"fd040000-0000-4000-8000-000000000090","stable_key":"generated-action","kind":"action","heading":"Generated section","order_index":0,"payload":{"title":"Generated action","objective":"Generated reason"}}]')));
select is(public.save_ted_artifact(
  '{"outcome_id":"fd020000-0000-4000-8000-000000000010","kind":"action_plan","title":"Replay","request_id":"generated-compatibility"}', '[]'),
  'fd030000-0000-4000-8000-000000000090'::uuid,'generated create-or-replay keeps its stable identity');
select lives_ok($$select public.set_ted_block_completed('fd040000-0000-4000-8000-000000000090',true,1)$$,
  'generated completion still uses its established revision command');

reset role;
select ok(pg_temp.manual_raises($$insert into public.ted_artifact_blocks
  (id,artifact_id,user_id,kind,stable_key,parent_block_id)
  select 'fd040000-0000-4000-8000-000000000091','fd030000-0000-4000-8000-000000000090',
    'fd010000-0000-4000-8000-000000000001','action','forbidden-manual-child',id
  from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001' and stable_key='fallback-item:2'$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'a privileged generated writer cannot attach a cascading child to a manual item');
select ok(not exists (select 1 from public.ted_artifact_blocks where id='fd040000-0000-4000-8000-000000000091'),
  'refused cross-artifact parenting does not leave a partial child');
select ok(pg_temp.manual_raises($$update public.ted_artifact_blocks set parent_block_id=(
  select id from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001' and stable_key='fallback-item:2')
  where id='fd040000-0000-4000-8000-000000000090'$$,'MANUAL_PLAN_COMMAND_REQUIRED'),
  'an existing generated block cannot be moved under a manual item');
select ok((select parent_block_id is null and revision=2 from public.ted_artifact_blocks
  where id='fd040000-0000-4000-8000-000000000090'),
  'refused parenting preserves the generated block and its revision');
select is(public.get_own_manual_plan_v1('local-plan:one',null)->'plan',
  (select result->'snapshot' from manual_results where name='undo'),
  'refused parenting leaves manual content and its aggregate token unchanged');
set local role authenticated;

-- Owner B cannot look up A, even with A's exact IDs. Operation UUIDs may be
-- reused by a different owner without mixing request hashes or content.
select set_config('request.jwt.claim.sub','fd010000-0000-4000-8000-000000000002',true);
select is(public.get_own_manual_plan_v1('local-plan:one',null)->'plan','null'::jsonb,'other owner sees safe absence by original plan ID');
select is(public.get_own_manual_plan_v1(null,(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='created'))->'plan',
  'null'::jsonb,'other owner sees safe absence by exact outcome UUID');
select is(public.list_own_manual_plans_v1()->'items','[]'::jsonb,'list cannot reveal another owner');
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_edit(20,(select result->'snapshot' from manual_results where name='undo')))$$,
  'MANUAL_PLAN_NOT_FOUND'),'other owner cannot target A with a forged expected version');
insert into manual_results(name,command) values ('other-owner',pg_temp.manual_command(1));
update manual_results set result=public.save_own_manual_plan_v1(command) where name='other-owner';
select ok((select result->>'request_sha256' from manual_results where name='other-owner') <>
  (select result->>'request_sha256' from manual_results where name='created'),'receipt hash binds the owner as well as the full command');
select set_config('request.jwt.claim.sub','fd010000-0000-4000-8000-000000000001',true);
select is(public.save_own_manual_plan_v1((select command from manual_results where name='created'))->'snapshot',
  (select result->'snapshot' from manual_results where name='undo'),'A to B to A reconciliation cannot adopt B content');

insert into manual_results(name,command) values ('blank-plan',pg_temp.manual_command(30,'blank-plan',
  '[{"id":"blank","section":"","text":"","notes":"","due_date":"9999-12-31","done":true}]',''));
update manual_results set result=public.save_own_manual_plan_v1(command) where name='blank-plan';
select is((public.list_own_manual_plans_v1(1,0)->'items'->0->>'plan_id'),'blank-plan','list returns most recently changed plan first');
select is(public.list_own_manual_plans_v1(1,0)->'has_more','true'::jsonb,'limit plus one reports an additional owner row');
select is(public.list_own_manual_plans_v1(1,1)->'has_more','false'::jsonb,'last page reports no continuation');
select is(public.list_own_manual_plans_v1(1,0)->'items'->0->'next_due_date','null'::jsonb,'completed items have no next pending due date');
select is(public.list_own_manual_plans_v1(1,1)->'items'->0->>'next_due_date','0001-01-01','pending date is the exact earliest civil date');
select is(public.list_own_manual_plans_v1(1,99)->'items','[]'::jsonb,'an exhausted page is a safe empty list');
select ok(pg_temp.manual_raises($$select public.list_own_manual_plans_v1(51,0)$$,'MANUAL_PLAN_INPUT_INVALID'), 'unbounded list limits are rejected');
select ok(pg_temp.manual_raises($$select public.list_own_manual_plans_v1(1,-1)$$,'MANUAL_PLAN_INPUT_INVALID'), 'negative offsets are rejected');

-- Failure after some writes must roll back every authority and preserve a safe
-- retry of the exact same command. These triggers inject real SQL failures.
reset role;
create function pg_temp.fail_manual_projection() returns trigger language plpgsql as $function$
begin
  if new.reason = 'force-projection-failure' then raise exception 'MANUAL_TEST_PROJECTION_FAILURE'; end if;
  return new;
end;
$function$;
create trigger test_manual_projection_failure before insert or update on public.checklist_items
  for each row execute function pg_temp.fail_manual_projection();
create temporary table manual_counts as select
  (select count(*) from public.outcomes) outcomes,
  (select count(*) from public.ted_artifacts) artifacts,
  (select count(*) from public.ted_artifact_blocks) blocks,
  (select count(*) from public.checklist_items) checklist,
  (select count(*) from public.ted_artifact_versions) versions,
  (select count(*) from private.manual_plan_save_receipts) receipts;
set local role authenticated;
insert into manual_results(name,command) values ('failed-create',jsonb_set(pg_temp.manual_command(80,'failed-create'),
  '{items,1,notes}','"force-projection-failure"'));
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1((select command from manual_results where name='failed-create'))$$,
  'MANUAL_TEST_PROJECTION_FAILURE'),'partial initial projection failure surfaces without a fabricated receipt');
reset role;
select ok((select (outcomes,artifacts,blocks,checklist,versions,receipts) = (
  (select count(*) from public.outcomes),(select count(*) from public.ted_artifacts),
  (select count(*) from public.ted_artifact_blocks),(select count(*) from public.checklist_items),
  (select count(*) from public.ted_artifact_versions),(select count(*) from private.manual_plan_save_receipts))
  from manual_counts),'failed creation rolls back outcome, artifact, blocks, projection, history and receipt');
drop trigger test_manual_projection_failure on public.checklist_items;
set local role authenticated;
update manual_results set result=public.save_own_manual_plan_v1(command) where name='failed-create';
select is((select result->>'status' from manual_results where name='failed-create'),'saved','same command can commit after a rolled-back attempt');
insert into manual_results(name,command) select 'notes-only',pg_temp.manual_edit(83,result->'snapshot',
  jsonb_set(result->'snapshot'->'items','{0,notes}',to_jsonb(E'Only notes change\n  '::text))) from manual_results where name='failed-create';
update manual_results set result=public.save_own_manual_plan_v1(command) where name='notes-only';
select ok((select (result->'snapshot'->>'updated_at')::timestamptz from manual_results where name='notes-only') >
  (select (result->'snapshot'->>'updated_at')::timestamptz from manual_results where name='failed-create'),
  'notes-only save advances aggregate time within this same SQL transaction');
reset role;
create function pg_temp.fail_manual_history() returns trigger language plpgsql as $function$
begin
  if new.snapshot->>'title'='force-history-failure' then raise exception 'MANUAL_TEST_HISTORY_FAILURE'; end if;
  return new;
end;
$function$;
create trigger test_manual_history_failure before insert on public.ted_artifact_versions
  for each row execute function pg_temp.fail_manual_history();
set local role authenticated;
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_edit(81,
  (select result->'snapshot' from manual_results where name='undo'),null,'force-history-failure'))$$,
  'MANUAL_TEST_HISTORY_FAILURE'),'failed version capture rejects a partially written update');
select is(public.get_own_manual_plan_v1('local-plan:one',null)->'plan',
  (select result->'snapshot' from manual_results where name='undo'),'history failure restores title, items, revisions and aggregate token');
reset role;
drop trigger test_manual_history_failure on public.ted_artifact_versions;

-- Establish a real captured source relationship through the existing ledger
-- APIs. Manual saves cannot delete that source or relabel it as generated.
select public.register_document_ledger_version('1.0.0','manual-plan-test-ledger.1', contract,
  encode(extensions.digest(convert_to(contract::text,'UTF8'),'sha256'),'hex'),'pgtap')
  from (select '{"schemaVersion":"1.0.0","ledgerVersion":"manual-plan-test-ledger.1","templates":{"action-plan":{"sections":[{"sectionKey":"action","required":true}]}}}'::jsonb contract) fixture;
insert into manual_results(name,result) values ('generation-snapshot',public.prepare_document_generation_snapshot(
  'fd010000-0000-4000-8000-000000000001','manual-plan-test-generation','manual-plan-test-ledger.1',
  'action-plan','manual-plan-test-benchmark.1','generated-test.1','{}','{}','{}'));
select public.bind_ted_artifact_ledger('fd030000-0000-4000-8000-000000000090',2,
  'manual-plan-test-ledger.1','action-plan','manual-plan-test-benchmark.1',
  (select id from private.document_generation_snapshots where generation_request_id='manual-plan-test-generation'));
select public.bind_ted_artifact_block_ledger('fd040000-0000-4000-8000-000000000090',3,2,'action',true,'final',
  (select id from public.ted_artifact_blocks where user_id='fd010000-0000-4000-8000-000000000001' and stable_key='fallback-item:2'
    and artifact_id=(select (result->'snapshot'->>'artifact_id')::uuid from manual_results where name='undo')),
  'fallback-item:2','manual-plan-test-transformation.1');
select ok(pg_temp.manual_raises($$select public.bind_ted_artifact_ledger(
  (select (result->'snapshot'->>'artifact_id')::uuid from manual_results where name='undo'),6,
  'manual-plan-test-ledger.1','action-plan','manual-plan-test-benchmark.1',
  (select id from private.document_generation_snapshots where generation_request_id='manual-plan-test-generation'))$$,
  'MANUAL_PLAN_COMMAND_REQUIRED'),'privileged ledger binding cannot reclassify a manual artifact');
set local role authenticated;
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_edit(82,
  (select result->'snapshot' from manual_results where name='undo'),
  (select result->'snapshot'->'items' from manual_results where name='undo') - 1))$$,
  'MANUAL_PLAN_ITEM_REMOVAL_BLOCKED'),'an actual captured source reference prevents item removal with a stable actionable error');
select is(public.get_own_manual_plan_v1('local-plan:one',null)->'plan',
  (select result->'snapshot' from manual_results where name='undo'),'blocked removal rolls back the complete graph');
reset role;

-- The account fence wins even against an exact accepted replay. Real parent
-- deletion still removes the manual history and receipts through existing FKs.
select set_config('request.jwt.claim.sub','fd010000-0000-4000-8000-000000000003',true);
set local role authenticated;
insert into manual_results(name,command) values ('deleting',pg_temp.manual_command(90,'deleting-plan'));
update manual_results set result=public.save_own_manual_plan_v1(command) where name='deleting';
reset role;
select public.begin_account_deletion_fence('fd010000-0000-4000-8000-000000000003');
set local role authenticated;
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1((select command from manual_results where name='deleting'))$$,
  'ACCOUNT_DELETION_FENCED'),'deletion fence precedes receipt replay');
select ok(pg_temp.manual_raises($$select public.get_own_manual_plan_v1('deleting-plan',null)$$,
  'ACCOUNT_DELETION_FENCED'),'deletion fence prevents reopening');
select ok(pg_temp.manual_raises($$select public.list_own_manual_plans_v1()$$,
  'ACCOUNT_DELETION_FENCED'),'deletion fence prevents owner listings');
reset role;
select lives_ok($$delete from auth.users where id='fd010000-0000-4000-8000-000000000003'$$,
  'real account deletion can cascade through manual graph and immutable history');
select ok(not exists(select 1 from private.manual_plan_save_receipts where user_id='fd010000-0000-4000-8000-000000000003')
  and not exists(select 1 from public.ted_artifact_versions where user_id='fd010000-0000-4000-8000-000000000003'),
  'account deletion removes private receipts and existing artifact snapshots');
select lives_ok($$delete from public.outcomes where id=(select (result->'snapshot'->>'outcome_id')::uuid from manual_results where name='blank-plan')$$,
  'real outcome deletion also permits the existing child cascades');
select ok(not exists(select 1 from private.manual_plan_save_receipts where artifact_id=
  (select (result->'snapshot'->>'artifact_id')::uuid from manual_results where name='blank-plan')),
  'outcome deletion removes receipt metadata rather than leaving a replayable tombstone');

select set_config('request.jwt.claim.sub','',true);
select ok(pg_temp.manual_raises($$select public.save_own_manual_plan_v1(pg_temp.manual_command(99))$$,
  'MANUAL_PLAN_AUTHENTICATION_REQUIRED'),'absence of owner identity fails independently of SQL privileges');
select * from finish();
rollback;
