begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- This is a dormant contract regression, not a reproduction of F2. Before the
-- forward migration, missing new commands produce explicit diagnostics; the
-- existing admission/dispatch/accounting commands still create real fixtures.
create temp table audit_fixture (
  name text primary key, owner_id uuid not null, reservation jsonb not null
);
create temp table audit_state (name text primary key, value jsonb not null);

create function pg_temp.audit_sources() returns jsonb language sql as $f$
  select '["I was charged $10 twice.","","","",""]'::jsonb
$f$;
create function pg_temp.audit_binding(
  p_kind text default 'quality', p_round integer default 0,
  p_source_sha text default 'd21b160c94ff9d6bb1cccb2f6cf93d6d10771fccc6be2e723a5aed46aeb50cc6'
) returns jsonb language sql as $f$
  select jsonb_build_object(
    'version','legacy-document-audit-binding.1',
    'digest_version','legacy-document-audit-digests.1',
    'validator_version','legacy-wording-assessment.1',
    'unit_policy_version','legacy-factual-units.2',
    'review_kind',p_kind,'round',p_round,
    'output_schema_name','prompted_document_'||p_kind||'_audit',
    'output_schema_version','document-'||p_kind||'-audit.1',
    'evidence_mode','verbatim','source_sha256',p_source_sha,
    'execution_policy_version','legacy-template-policy.1',
    'execution_policy_sha256',repeat('b',64),
    'target_sha256','2a766372d7a82a4b574bd6b02fe4a9c9d2abd7cafa245c6380b217681a925eea',
    'sections',jsonb_build_array(
      jsonb_build_object('key','issue','label','Issue','content_sha256',
        encode(extensions.digest(convert_to('I was charged $10 twice.','UTF8'),'sha256'),'hex')),
      jsonb_build_object('key','request','label','Request','content_sha256',
        encode(extensions.digest(convert_to('Please review the duplicate charge.','UTF8'),'sha256'),'hex'))),
    'units',jsonb_build_array(jsonb_build_object('id','issue#1','section_key','issue',
      'content_sha256',encode(extensions.digest(convert_to('I was charged $10 twice.','UTF8'),'sha256'),'hex')))
  )
$f$;

create function pg_temp.audit_old_read(
  p_name text, p_allocate boolean default true, p_kind text default 'quality',
  p_round integer default 0, p_fallback boolean default false
) returns jsonb language plpgsql as $f$
declare v audit_fixture%rowtype;
begin
  select * into strict v from audit_fixture where name=p_name;
  if p_fallback then
    return public.read_legacy_model_call_checkpoint_with_fallback(
      v.owner_id,'generate-document',(v.reservation->>'reservation_id')::uuid,
      'audit-'||p_name,'generate-document.'||p_kind||':round-'||p_round,repeat('c',64),2,
      (v.reservation->>'execution_claim_token')::uuid,p_allocate);
  end if;
  return public.read_legacy_model_call_checkpoint(
    v.owner_id,'generate-document',(v.reservation->>'reservation_id')::uuid,
    'audit-'||p_name,'generate-document.'||p_kind||':round-'||p_round,repeat('c',64),2,
    (v.reservation->>'execution_claim_token')::uuid,p_allocate);
end;
$f$;

create function pg_temp.audit_call(
  p_name text, p_binding jsonb default pg_temp.audit_binding(),
  p_sources jsonb default pg_temp.audit_sources(), p_allocate boolean default true,
  p_fallback boolean default false, p_stage text default 'generate-document.quality:round-0',
  p_owner uuid default null, p_claim uuid default null, p_hash text default repeat('c',64)
) returns jsonb language plpgsql as $f$
declare v audit_fixture%rowtype; v_result jsonb;
begin
  select * into strict v from audit_fixture where name=p_name;
  if to_regprocedure('public.read_legacy_document_audit_checkpoint_v1(uuid,text,uuid,text,text,text,integer,uuid,boolean,jsonb,boolean,jsonb)') is null then
    return jsonb_build_object('error','AUDIT_CONTRACT_UNAVAILABLE');
  end if;
  execute 'select public.read_legacy_document_audit_checkpoint_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)'
    into v_result using coalesce(p_owner,v.owner_id),'generate-document',
      (v.reservation->>'reservation_id')::uuid,'audit-'||p_name,p_stage,p_hash,2,
      coalesce(p_claim,(v.reservation->>'execution_claim_token')::uuid),p_allocate,
      p_binding,p_fallback,p_sources;
  return v_result;
exception when others then
  -- Preserve the exact diagnostic; never use an old reader as error fallback.
  return jsonb_build_object('error',sqlerrm,'sqlstate',sqlstate);
end;
$f$;

create function pg_temp.audit_rows() returns jsonb language sql as $f$
  select jsonb_build_object(
    'reservations',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from private.document_allowance_reservations r where user_id in ('a8150000-0000-4000-8000-000000000001','a8150000-0000-4000-8000-000000000002')),
    'claims',(select coalesce(jsonb_agg(to_jsonb(r) order by reservation_id),'[]') from private.legacy_generation_execution_claims r where user_id in ('a8150000-0000-4000-8000-000000000001','a8150000-0000-4000-8000-000000000002')),
    'admissions',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from private.legacy_model_attempt_admissions r where user_id in ('a8150000-0000-4000-8000-000000000001','a8150000-0000-4000-8000-000000000002')),
    'results',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from private.legacy_model_call_results r where user_id in ('a8150000-0000-4000-8000-000000000001','a8150000-0000-4000-8000-000000000002')),
    'usage',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.usage_ledger r where user_id in ('a8150000-0000-4000-8000-000000000001','a8150000-0000-4000-8000-000000000002')))
$f$;
create function pg_temp.audit_sql_error(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  -- A predecessor may wrongly allow the tested mutation. Roll that write back
  -- too, so a failed assertion cannot corrupt the following positive fixture.
  raise exception using errcode='P9901',message='AUDIT_TEST_UNEXPECTED_SUCCESS';
exception when sqlstate 'P9901' then return 'NO_ERROR';
when others then return sqlerrm;
end;
$f$;
create function pg_temp.audit_dispatch(p_name text,p_attempt integer default 1)
returns jsonb language plpgsql as $f$
declare v audit_fixture%rowtype; a uuid;
begin
  select * into strict v from audit_fixture where name=p_name;
  select id into strict a from private.legacy_model_attempt_admissions
    where user_id=v.owner_id and logical_request_id='audit-'||p_name
      and logical_stage_key='generate-document.quality:round-0' and attempt_number=p_attempt;
  return public.mark_legacy_model_attempt_dispatched(v.owner_id,'generate-document',
    (v.reservation->>'reservation_id')::uuid,'audit-'||p_name,
    'generate-document.quality:round-0',repeat('c',64),p_attempt,a,
    (v.reservation->>'execution_claim_token')::uuid,extensions.gen_random_uuid());
end;
$f$;
create function pg_temp.audit_record(
  p_name text,p_attempt integer default 1,p_status text default 'succeeded',
  p_provider_status text default 'completed',p_error text default null
) returns jsonb language plpgsql as $f$
declare v audit_fixture%rowtype; a uuid; envelope jsonb;
begin
  select * into strict v from audit_fixture where name=p_name;
  select id into strict a from private.legacy_model_attempt_admissions
    where user_id=v.owner_id and logical_request_id='audit-'||p_name
      and logical_stage_key='generate-document.quality:round-0' and attempt_number=p_attempt;
  if p_provider_status='completed' then
    envelope:=jsonb_build_object('version','legacy-provider-result.1',
      'text',case when p_status='succeeded' then '{"issues":[]}' else 'malformed review' end,
      'structured',case when p_status='succeeded' then '{"issues":[]}'::jsonb else 'null'::jsonb end,
      'sources','[]'::jsonb,'route_snapshot',jsonb_build_object(
        'provider','openai','semanticRoute','review','model','synthetic-audit-model',
        'reasoningEffort','high','routingVersion','audit-routing.test.1',
        'structuredOutputSchemaVersion','document-quality-audit.1','allowedTools','[]'::jsonb,
        'timeoutMs',90000,'maxAttempts',2,'background',false,'store',false,'fallback',null));
  end if;
  return public.record_legacy_model_call_attempt(v.owner_id,'audit-'||p_name,
    'generate-document.quality:round-0',repeat('c',64),a::text,p_attempt,p_status,
    case when p_provider_status='completed' then 'response-audit-'||p_name else null end,
    p_provider_status,p_error,case when p_provider_status='completed' then 17 else 0 end,
    case when p_provider_status='completed' then 9 else 0 end,
    '2026-09-08T01:00:00Z'::timestamptz,'2026-09-08T01:00:01Z'::timestamptz,
    'synthetic-audit-model','audit-routing.test.1','review','high','generate-document',
    (v.reservation->>'reservation_id')::uuid,envelope,(v.reservation->>'execution_claim_token')::uuid);
end;
$f$;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
 ('a8150000-0000-4000-8000-000000000001','audit-binding-owner@example.invalid',false,false,now(),now()),
 ('a8150000-0000-4000-8000-000000000002','audit-binding-other@example.invalid',false,false,now(),now());
-- These audit cases request Business admission below. Supply its actual
-- subscription now that reservation admission verifies server-owned access.
insert into public.subscriptions(user_id,plan,status)
values ('a8150000-0000-4000-8000-000000000001','business','active');
select is((select count(*)::integer from auth.users where id in (
 'a8150000-0000-4000-8000-000000000001','a8150000-0000-4000-8000-000000000002')),2,
 'both synthetic owners positively exist');
insert into audit_fixture select name,'a8150000-0000-4000-8000-000000000001'::uuid,
  public.reserve_document_allowance_with_policy(
    'a8150000-0000-4000-8000-000000000001','audit-'||name,'generate-document',repeat('a',64),
    'business',1000,1800,'legacy-template-policy.1',repeat('b',64),null)
 from unnest(array['main','observe','invalid','legacy-done','legacy-dispatched','retry','late','cancel',
   'successor','unicode','delimiters','empty','left','right','cascade']) f(name);
select is((select count(*)::integer from audit_fixture where reservation->'provider_permitted'='true'
  and reservation->>'execution_claim_token' is not null),15,'fifteen real policy reservations positively own execution');
select is((select count(*)::integer from private.document_allowance_reservations r
 join private.legacy_generation_execution_claims c on c.reservation_id=r.id and c.user_id=r.user_id
 where r.user_id='a8150000-0000-4000-8000-000000000001'),15,'all reservation and claim identities are independently persisted');

select has_function('public','read_legacy_document_audit_checkpoint_v1',
 array['uuid','text','uuid','text','text','text','integer','uuid','boolean','jsonb','boolean','jsonb'],
 'the dormant audited reader has exactly twelve arguments');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='read_legacy_document_audit_checkpoint_v1'
   and p.prosecdef and p.proconfig @> array['search_path=""']::text[] and p.pronargdefaults=0),1,
 'the new command has one security-definer signature, fixed search path, and no guessed defaults');
select ok(coalesce(has_function_privilege('service_role',to_regprocedure(
 'public.read_legacy_document_audit_checkpoint_v1(uuid,text,uuid,text,text,text,integer,uuid,boolean,jsonb,boolean,jsonb)'),'EXECUTE'),false),
 'service role receives the new command');
select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure(
 'public.read_legacy_document_audit_checkpoint_v1(uuid,text,uuid,text,text,text,integer,uuid,boolean,jsonb,boolean,jsonb)'),'EXECUTE'),true)
 and not coalesce(has_function_privilege('anon',to_regprocedure(
 'public.read_legacy_document_audit_checkpoint_v1(uuid,text,uuid,text,text,text,integer,uuid,boolean,jsonb,boolean,jsonb)'),'EXECUTE'),true),
 'browser and anonymous roles cannot create or read private audit bindings');
select ok(not has_table_privilege('service_role','private.legacy_model_attempt_admissions','SELECT')
 and not has_table_privilege('authenticated','private.document_allowance_reservations','SELECT'),
 'existing private tables remain inaccessible through direct role grants');

insert into audit_state values ('observe',pg_temp.audit_call('observe',p_allocate=>false));
select is((select value from audit_state where name='observe'),jsonb_build_object(
 'contract_version','legacy-document-audit-checkpoint.1','checkpoint',pg_temp.audit_old_read('observe',false),
 'audit_binding',null,'audit_binding_sha256',null),'nonallocating absence wraps the unchanged checkpoint and no invented metadata');
select is((select count(*)::integer from private.legacy_model_attempt_admissions where logical_request_id='audit-observe'),0,
 'nonallocating absence creates no attempt');
select is((select to_jsonb(r)->'audit_source_snapshot' from private.document_allowance_reservations r
 where user_id='a8150000-0000-4000-8000-000000000001' and request_id='audit-observe'),'null'::jsonb,
 'nonallocating absence does not accept a raw source snapshot');

-- Positively create an existing, undispatched, currently owned attempt. The new
-- wrapper may bind this one before dispatch, but never a completed old result.
insert into audit_state values ('main-old',pg_temp.audit_old_read('main'));
select is((select value->>'state' from audit_state where name='main-old'),'prepared','real original reader prepares the main fixture');
insert into audit_state values ('main-probe',pg_temp.audit_call('main',p_allocate=>false));
select is((select value from audit_state where name='main-probe'),jsonb_build_object(
 'contract_version','legacy-document-audit-checkpoint.1','checkpoint',pg_temp.audit_old_read('main',false),
 'audit_binding',null,'audit_binding_sha256',null),'nonallocating old prepared probe preserves the literal checkpoint without claiming proof');
select is((select to_jsonb(a)->'audit_binding' from private.legacy_model_attempt_admissions a
 where logical_request_id='audit-main'),'null'::jsonb,'nonallocating prepared probe leaves historical metadata null');
select is((select to_jsonb(r)->'audit_source_snapshot' from private.document_allowance_reservations r
 where request_id='audit-main'),'null'::jsonb,'nonallocating prepared probe does not accept proposed source strings');
select is((select count(*)::integer from private.legacy_model_attempt_admissions where logical_request_id='audit-main'),1,
 'nonallocating prepared probe preserves the same single admission');
insert into audit_state values ('main',pg_temp.audit_call('main'));
select is((select value->>'contract_version' from audit_state where name='main'),'legacy-document-audit-checkpoint.1',
 'audited prepare returns its explicit envelope version');
select is((select value->'audit_binding' from audit_state where name='main'),pg_temp.audit_binding(),
 'prepare returns the exact accepted fifteen-field metadata');
select is((select value - array['contract_version','checkpoint','audit_binding','audit_binding_sha256'] from audit_state where name='main'),
 '{}'::jsonb,'the new wrapper exposes only its four declared keys');
select is((select value#>>'{checkpoint,attempt_admission_id}' from audit_state where name='main'),
 (select value->>'attempt_admission_id' from audit_state where name='main-old'),'audit binding uses the same owned provider admission');
select is((select to_jsonb(a)->'audit_binding' from private.legacy_model_attempt_admissions a
 where logical_request_id='audit-main'),pg_temp.audit_binding(),'private admission independently retains the binding');
select is((select value->>'audit_binding_sha256' from audit_state where name='main'),
 encode(extensions.digest(convert_to(pg_temp.audit_binding()::text,'UTF8'),'sha256'),'hex'),
 'binding digest is computed from PostgreSQL JSONB bytes, not a caller hash');
select is((select to_jsonb(a)->>'audit_binding_sha256' from private.legacy_model_attempt_admissions a
 where logical_request_id='audit-main'),(select value->>'audit_binding_sha256' from audit_state where name='main'),
 'independent stored metadata digest equals the returned opaque digest');
select is((select to_jsonb(r)->'audit_source_snapshot' from private.document_allowance_reservations r where request_id='audit-main'),
 pg_temp.audit_sources(),'the existing reservation retains the exact five raw source strings');
select is((select to_jsonb(r)->>'audit_source_sha256' from private.document_allowance_reservations r where request_id='audit-main'),
 'd21b160c94ff9d6bb1cccb2f6cf93d6d10771fccc6be2e723a5aed46aeb50cc6','SQL computes the independently supplied UTF-8 framing vector');
select is((select to_jsonb(r)->>'audit_source_digest_version' from private.document_allowance_reservations r where request_id='audit-main'),
 'legacy-document-audit-digests.1','source commitment records its digest contract');

-- Every rejected boundary is run against a real unused reservation. The helper
-- catches only to report its exact error; each rejection must roll back all rows.
create temp table audit_invalid(name text primary key,binding jsonb,sources jsonb,stage text,expected text);
insert into audit_invalid values
 ('extra key',pg_temp.audit_binding()||'{"passed":true}',pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('missing key',pg_temp.audit_binding()-'units',pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('null metadata','null',pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('unknown version',jsonb_set(pg_temp.audit_binding(),'{version}','"future.1"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('wrong schema',jsonb_set(pg_temp.audit_binding(),'{output_schema_version}','"document-grounding-audit.1"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('string round',jsonb_set(pg_temp.audit_binding(),'{round}','"0"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('fractional round',jsonb_set(pg_temp.audit_binding(),'{round}','0.5'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('excess round',jsonb_set(pg_temp.audit_binding(),'{round}','4'),pg_temp.audit_sources(),'generate-document.quality:round-4','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('stage mismatch',pg_temp.audit_binding(),pg_temp.audit_sources(),'generate-document.quality:round-1','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('policy mismatch',jsonb_set(pg_temp.audit_binding(),'{execution_policy_sha256}',to_jsonb(repeat('d',64))),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT'),
 ('wrong source digest',jsonb_set(pg_temp.audit_binding(),'{source_sha256}',to_jsonb(repeat('d',64))),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID'),
 ('source object',pg_temp.audit_binding(),'{"situation":"I was charged $10 twice."}','generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID'),
 ('source missing field',pg_temp.audit_binding(),'["I was charged $10 twice.","","",""]','generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID'),
 ('source null field',pg_temp.audit_binding(),'["I was charged $10 twice.","","","",null]','generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID'),
 ('oversized source',pg_temp.audit_binding(),jsonb_build_array(repeat('x',1048577),'','','',''),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID'),
 ('empty sections',jsonb_set(pg_temp.audit_binding(),'{sections}','[]'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('empty grounding units',jsonb_set(pg_temp.audit_binding('grounding'),'{units}','[]'),pg_temp.audit_sources(),'generate-document.grounding:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('duplicate section',jsonb_set(pg_temp.audit_binding(),'{sections}',jsonb_build_array(pg_temp.audit_binding()#>'{sections,0}',pg_temp.audit_binding()#>'{sections,0}')),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('unknown unit section',jsonb_set(pg_temp.audit_binding(),'{units,0,section_key}','"unknown"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('nonsequential unit',jsonb_set(pg_temp.audit_binding(),'{units,0,id}','"issue#2"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('duplicate unit',jsonb_set(pg_temp.audit_binding(),'{units}',jsonb_build_array(pg_temp.audit_binding()#>'{units,0}',pg_temp.audit_binding()#>'{units,0}')),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('unsafe extra unit field',jsonb_set(pg_temp.audit_binding(),'{units,0,quote}','"trusted"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('nonverbatim mode',jsonb_set(pg_temp.audit_binding(),'{evidence_mode}','"typographic"'),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('UTF16 label limit',jsonb_set(pg_temp.audit_binding(),'{sections,0,label}',to_jsonb(repeat('😀',501))),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('whitespace identifiers',jsonb_set(jsonb_set(jsonb_set(pg_temp.audit_binding(),
   '{sections,0,key}','" issue"'),'{units,0,section_key}','" issue"'),'{units,0,id}','" issue#1"'),
   pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('too many sections',jsonb_set(pg_temp.audit_binding(),'{sections}',(select jsonb_agg(jsonb_build_object(
   'key','section-'||n,'label','Section '||n,'content_sha256',repeat('e',64)) order by n) from generate_series(1,129) n)),
   pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('too many units',jsonb_set(pg_temp.audit_binding(),'{units}',(select jsonb_agg(jsonb_build_object(
   'id','issue#'||n,'section_key','issue','content_sha256',repeat('e',64)) order by n) from generate_series(1,513) n)),
   pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'),
 ('reversed unit order',jsonb_set(pg_temp.audit_binding(),'{units}',jsonb_build_array(
   jsonb_build_object('id','request#1','section_key','request','content_sha256',repeat('e',64)),
   pg_temp.audit_binding()#>'{units,0}')),pg_temp.audit_sources(),'generate-document.quality:round-0','LEGACY_DOCUMENT_AUDIT_BINDING_INVALID');
insert into audit_state values ('before-invalid',pg_temp.audit_rows());
select is(pg_temp.audit_call('invalid',binding,sources,true,false,stage)->>'error',expected,
 'invalid boundary rejects '||name) from audit_invalid order by name;
select is(pg_temp.audit_rows(),(select value from audit_state where name='before-invalid'),
 'all malformed metadata/source/policy attempts leave leases, rows, results and accounting unchanged');

-- Both review kinds share the same target and exact unit roster at each round.
insert into audit_state values ('before-first-pair-conflict',pg_temp.audit_rows());
select is(pg_temp.audit_call('main',jsonb_set(pg_temp.audit_binding('grounding'),'{target_sha256}',to_jsonb(repeat('d',64))),
 p_stage=>'generate-document.grounding:round-0')->>'error','LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT',
 'first grounding preparation must match the already accepted quality target');
select is(pg_temp.audit_rows(),(select value from audit_state where name='before-first-pair-conflict'),
 'a disagreement between review kinds creates no second admission or claim change');
insert into audit_state values ('pair',pg_temp.audit_call('main',pg_temp.audit_binding('grounding'),
 p_stage=>'generate-document.grounding:round-0'));
select is((select value#>>'{checkpoint,state}' from audit_state where name='pair'),'prepared','grounding admits the same round and source snapshot');
select is((select value->'audit_binding' from audit_state where name='pair'),pg_temp.audit_binding('grounding'),'paired grounding preserves its exact known schema and ordered units');
insert into audit_state values ('before-pair-conflict',pg_temp.audit_rows());
select is(pg_temp.audit_call('main',jsonb_set(pg_temp.audit_binding('grounding'),'{target_sha256}',to_jsonb(repeat('d',64))),
 p_stage=>'generate-document.grounding:round-0')->>'error','LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT',
 'paired review cannot replace the committed target');
select is(pg_temp.audit_call('main',jsonb_set(pg_temp.audit_binding('grounding'),'{units,0,content_sha256}',to_jsonb(repeat('d',64))),
 p_stage=>'generate-document.grounding:round-0')->>'error','LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT',
 'paired review cannot silently replace a factual unit commitment');
select is(pg_temp.audit_call('main',p_owner=>'a8150000-0000-4000-8000-000000000002')->>'error',
 'LEGACY_MODEL_RESULT_RESERVATION_INVALID','another real owner cannot attach audit proof to this reservation');
select is(pg_temp.audit_call('main',p_claim=>'a8150000-0000-4000-8000-000000000099')->>'error',
 'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID','wrong live execution identity is rejected');
select is(pg_temp.audit_call('main',p_hash=>repeat('e',64))->>'error','LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT',
 'an accepted audit stage cannot change its provider request digest');
select is(pg_temp.audit_rows(),(select value from audit_state where name='before-pair-conflict'),
 'paired and ownership rejection rolls back every attempted mutation');
select is(pg_temp.audit_call('main',pg_temp.audit_binding('quality',1,
 '1009ad9c92a61b6dce4ebf20c46d32951d671abfd35187a264ec2b52ddf1dd25'),
 '["","","","",""]',p_stage=>'generate-document.quality:round-1')->>'error',
 'LEGACY_DOCUMENT_AUDIT_SOURCE_CONFLICT','a later round cannot silently replace the accepted raw source snapshot');

select is(pg_temp.audit_sql_error($sql$update private.legacy_model_attempt_admissions
 set audit_binding=jsonb_set(audit_binding,'{target_sha256}',to_jsonb(repeat('e',64)))
 where logical_request_id='audit-main'$sql$),'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_BINDING','privileged mutation cannot replace pre-dispatch binding');
select is(pg_temp.audit_sql_error($sql$update private.legacy_model_attempt_admissions
 set audit_binding=null,audit_binding_sha256=null where logical_request_id='audit-main'$sql$),
 'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_BINDING','accepted audit metadata cannot be erased');
select is(pg_temp.audit_sql_error($sql$update private.legacy_model_attempt_admissions
 set request_sha256=repeat('f',64) where logical_request_id='audit-main'$sql$),
 'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_BINDING','bound provider request identity cannot be rewritten');
select is(pg_temp.audit_sql_error($sql$update private.document_allowance_reservations
 set audit_source_snapshot='["changed","","","",""]' where request_id='audit-main'$sql$),
 'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_SOURCE','accepted original source array is immutable');
select is(pg_temp.audit_sql_error($sql$update private.document_allowance_reservations
 set audit_source_snapshot=null,audit_source_sha256=null,audit_source_digest_version=null where request_id='audit-main'$sql$),
 'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_SOURCE','accepted source identity cannot be erased');

-- Independent Python UTF-8 vectors: literal array boundaries, whitespace,
-- combining marks, non-BMP Unicode, signs, quotes, and backslashes survive SQL.
create temp table audit_vectors(name text primary key,sources jsonb,sha text);
insert into audit_vectors values
 ('empty','["","","","",""]','1009ad9c92a61b6dce4ebf20c46d32951d671abfd35187a264ec2b52ddf1dd25'),
 ('left','["ab","c","","",""]','4c5bea7a98c7c99f647d166b966e8c9c610faa94e3b24ea64152a6ea56985508'),
 ('right','["a","bc","","",""]','286fe95da533ae5e7404c8761f5a05469de7ed87b8cb9b1767fa3a0fd3fde448'),
 ('delimiters','["a:b","ab","c","","line\r\nnext\n\"quoted\"\\file"]','7cfdcfea551a76f8ef8c169e638cefe352793d4c54cdbe3b02bfd11e1b216c7f'),
 ('unicode','["Café","Café","私は医師です。","😀","−10 != 10"]','94f842e87be44ec59357d6a4aa7455c670de4bf51205d780eac077176266af17');
select is(pg_temp.audit_old_read(name)->>'state','prepared','vector '||name||' positively prepares an existing attempt') from audit_vectors order by name;
select is(pg_temp.audit_call(name,pg_temp.audit_binding(p_source_sha=>sha),sources)->>'audit_binding_sha256',
 encode(extensions.digest(convert_to(pg_temp.audit_binding(p_source_sha=>sha)::text,'UTF8'),'sha256'),'hex'),
 'vector '||name||' binds its exact independently computed source digest') from audit_vectors order by name;
select is((select to_jsonb(r)->'audit_source_snapshot' from private.document_allowance_reservations r where request_id='audit-'||v.name),
 v.sources,'stored source vector '||v.name||' preserves exact strings') from audit_vectors v order by name;

-- The original terminal writer and six-key ACK remain unchanged. Its immutable
-- result/usage join is evidence of this attempt, never a generic passing audit.
select is(pg_temp.audit_dispatch('main')->>'state','dispatched','existing dispatcher accepts the bound owned attempt');
select is(pg_temp.audit_call('main')#>>'{checkpoint,state}','attempt_unresolved','an in-flight bound attempt remains unresolved without redispatch');
insert into audit_state values ('main-ack',pg_temp.audit_record('main'));
select is((select value - array['usage_ledger_id','model_call_key','idempotent_replay','result_id','result_response_sha256','result_idempotent_replay'] from audit_state where name='main-ack'),
 '{}'::jsonb,'the original terminal writer keeps its exact six-key ACK');
select is((select value->>'idempotent_replay' from audit_state where name='main-ack'),'false','the real completed audit is recorded once');
insert into audit_state values ('main-replay',pg_temp.audit_call('main',p_allocate=>false));
select is((select value->'checkpoint' from audit_state where name='main-replay'),pg_temp.audit_old_read('main',false),
 'audited replay contains the byte-equivalent original JSONB checkpoint');
select is((select value->'audit_binding' from audit_state where name='main-replay'),pg_temp.audit_binding(),'replay reads the actual saved attempt binding');
select is((select value#>>'{checkpoint,usage,provider_attempt_id}' from audit_state where name='main-replay'),
 (select value#>>'{checkpoint,attempt_admission_id}' from audit_state where name='main'),
 'result replay proves the same prepared provider attempt through owned usage');
select is((select value#>>'{checkpoint,response_sha256}' from audit_state where name='main-replay'),
 (select value->>'result_response_sha256' from audit_state where name='main-ack'),'replay retains the DB-computed terminal response digest');
select is(pg_temp.audit_record('main')->>'idempotent_replay','true','duplicate terminal ACK remains idempotent');
select is((select count(*)::integer from public.usage_ledger where user_id='a8150000-0000-4000-8000-000000000001'
 and logical_request_id='audit-main' and event_type='model_call'),1,'main review and replay record exactly one real provider usage row');
select is((select count(*)::integer from public.usage_ledger where user_id='a8150000-0000-4000-8000-000000000001'
 and event_type='document_created'),0,'review checkpoints do not settle any completed-document credit');

select is(pg_temp.audit_old_read('legacy-done')->>'state','prepared','historical completed fixture is positively admitted');
select is(pg_temp.audit_dispatch('legacy-done')->>'state','dispatched','historical fixture is positively dispatched');
select is(pg_temp.audit_record('legacy-done')->>'idempotent_replay','false','historical fixture has a real immutable saved response');
insert into audit_state values ('legacy-done',pg_temp.audit_old_read('legacy-done',false));
insert into audit_state values ('before-legacy-proof',pg_temp.audit_rows());
select is(pg_temp.audit_call('legacy-done')->>'error','LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED',
 'an old completed null-binding result cannot be relabelled as a bound audit');
select is(pg_temp.audit_rows(),(select value from audit_state where name='before-legacy-proof'),
 'rejected historical proof leaves exact result, usage, reservation and claim rows untouched');
select is(pg_temp.audit_old_read('legacy-done',false),(select value from audit_state where name='legacy-done'),
 'old reader still replays its literal historical response');
select is(pg_temp.audit_old_read('legacy-dispatched')->>'state','prepared','historical pending fixture is positively admitted');
select is(pg_temp.audit_dispatch('legacy-dispatched')->>'state','dispatched','historical pending fixture is positively dispatched');
select is(pg_temp.audit_call('legacy-dispatched')->>'error','LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED',
 'an already dispatched old attempt cannot retroactively acquire audit metadata');
select is(pg_temp.audit_call('legacy-dispatched',p_allocate=>false)->>'error','LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED',
 'nonallocating probe never presents a dispatched historical attempt as safe unbound preparation');

-- Retry keeps immutable metadata across the existing two real provider attempts.
select is(pg_temp.audit_old_read('retry')->>'state','prepared','retry fixture positively prepares first attempt');
select is(pg_temp.audit_call('retry')#>>'{checkpoint,attempt_number}','1','audited retry fixture accepts its first attempt');
select is(pg_temp.audit_dispatch('retry')->>'state','dispatched','retry first attempt is actually dispatched');
select is(pg_temp.audit_record('retry',1,'failed','http_503','OPENAI_UPSTREAM_ERROR')->>'idempotent_replay','false',
 'retryable first failure records its actual zero-token provider outcome');
insert into audit_state values ('before-retry-conflict',pg_temp.audit_rows());
select is(pg_temp.audit_call('retry',jsonb_set(pg_temp.audit_binding(),'{target_sha256}',to_jsonb(repeat('d',64))))->>'error',
 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT','second provider attempt cannot change the reviewed target');
select is(pg_temp.audit_rows(),(select value from audit_state where name='before-retry-conflict'),
 'conflicting retry allocates no second attempt or new lease');
-- Existing reader permits the same retry on the predecessor too, keeping later
-- positive dispatch/record fixture checks independent of the new command.
select is(pg_temp.audit_old_read('retry')->>'attempt_number','2','existing provider retry really prepares attempt two');
select is(pg_temp.audit_call('retry',p_fallback=>true)#>>'{checkpoint,attempt_number}','2',
 'fallback-capable audited reader preserves the existing second-attempt decision');
select is((select count(*)::integer from private.legacy_model_attempt_admissions a where logical_request_id='audit-retry'
 and to_jsonb(a)->'audit_binding'=pg_temp.audit_binding()),2,'both actual retry attempts retain equal immutable audit metadata');

-- A later reservation is a new execution authority for the same logical
-- request, not a new accepted source. Preserve original provider provenance.
select is(pg_temp.audit_old_read('successor')->>'state','prepared','successor fixture positively prepares its original stage');
select is(pg_temp.audit_call('successor')#>>'{checkpoint,state}','prepared','original reservation receives its exact source binding');
select is(pg_temp.audit_dispatch('successor')->>'state','dispatched','original successor fixture actually dispatches');
select is(pg_temp.audit_record('successor',1,'failed','http_503','OPENAI_UPSTREAM_ERROR')->>'idempotent_replay','false',
 'original successor fixture has a real retryable provider failure');
select is(public.release_document_allowance('a8150000-0000-4000-8000-000000000001',
 (select (reservation->>'reservation_id')::uuid from audit_fixture where name='successor'),
 'audit-successor','synthetic_retry')->>'state','released','original execution is released through its existing command');
insert into audit_state select 'successor-original',to_jsonb(r) from private.document_allowance_reservations r
 where id=(select (reservation->>'reservation_id')::uuid from audit_fixture where name='successor');
update audit_fixture set reservation=public.reserve_document_allowance_with_policy(
 'a8150000-0000-4000-8000-000000000001','audit-successor','generate-document',repeat('a',64),
 'business',1000,1800,'legacy-template-policy.1',repeat('b',64),null) where name='successor';
select isnt((select reservation->>'reservation_id' from audit_fixture where name='successor'),
 (select value->>'id' from audit_state where name='successor-original'),'actual successor owns a distinct reservation and execution claim');
insert into audit_state values ('before-successor-conflict',pg_temp.audit_rows());
select is(pg_temp.audit_call('successor',pg_temp.audit_binding(p_source_sha=>
 '1009ad9c92a61b6dce4ebf20c46d32951d671abfd35187a264ec2b52ddf1dd25'),'["","","","",""]')->>'error',
 'LEGACY_DOCUMENT_AUDIT_SOURCE_CONFLICT','new reservation must inherit the original logical-request source');
select is(pg_temp.audit_rows(),(select value from audit_state where name='before-successor-conflict'),
 'source mismatch leaves both historical and new reservation attempts unchanged');
select is(pg_temp.audit_old_read('successor')->>'attempt_number','2','existing reader positively prepares the admitted retry under the successor');
select is(pg_temp.audit_call('successor')#>>'{checkpoint,attempt_number}','2','audited successor reuses exact source and review commitments');
select is((select to_jsonb(r)->'audit_source_snapshot' from private.document_allowance_reservations r
 where id=(select (reservation->>'reservation_id')::uuid from audit_fixture where name='successor')),
 pg_temp.audit_sources(),'new reservation stores a literal copy of the existing source snapshot');
select is((select to_jsonb(r) from private.document_allowance_reservations r
 where id=(select (value->>'id')::uuid from audit_state where name='successor-original')),
 (select value from audit_state where name='successor-original'),'source inheritance does not rewrite the original reservation');

select is(pg_temp.audit_call('cascade',jsonb_set(pg_temp.audit_binding('quality',3),
 '{sections,0,label}',to_jsonb(repeat('😀',500))),p_stage=>'generate-document.quality:round-3')#>>'{checkpoint,state}',
 'prepared','the supported round-three and exact 1000 UTF-16-unit label boundary are accepted');
insert into audit_state values ('literal-label',pg_temp.audit_call('cascade',
 jsonb_set(pg_temp.audit_binding('quality',2),'{sections,0,label}',to_jsonb(U&'\0009 Issue \00A0'::text)),
 p_stage=>'generate-document.quality:round-2'));
select is((select value#>>'{checkpoint,state}' from audit_state where name='literal-label'),'prepared',
 'literal label whitespace remains accepted by the real audited preparation');
select is((select value#>>'{audit_binding,sections,0,label}' from audit_state where name='literal-label'),U&'\0009 Issue \00A0',
 'returned label preserves its tab, spaces, and nonbreaking space');
select is((select to_jsonb(a)#>>'{audit_binding,sections,0,label}' from private.legacy_model_attempt_admissions a
 where user_id='a8150000-0000-4000-8000-000000000001' and logical_request_id='audit-cascade'
   and logical_stage_key='generate-document.quality:round-2'),U&'\0009 Issue \00A0',
 'independent admission read proves label whitespace was stored literally');

-- Expired leases still permit the original admitted claimant to record terminal
-- cost and malformed completed output. Neither has become a passing audit.
select is(pg_temp.audit_old_read('late')->>'state','prepared','late-result fixture positively prepares');
select is(pg_temp.audit_call('late')#>>'{checkpoint,state}','prepared','late-result fixture receives audit binding before dispatch');
select is(pg_temp.audit_dispatch('late')->>'state','dispatched','late-result fixture really dispatches');
update private.legacy_generation_execution_claims set heartbeat_at=clock_timestamp()-interval '121 seconds',
 lease_expires_at=clock_timestamp()-interval '1 second' where reservation_id=(select (reservation->>'reservation_id')::uuid from audit_fixture where name='late');
update private.legacy_model_attempt_admissions set heartbeat_at=clock_timestamp()-interval '121 seconds',
 lease_expires_at=clock_timestamp()-interval '1 second' where logical_request_id='audit-late';
select is(pg_temp.audit_record('late',1,'failed','completed','OPENAI_INVALID_STRUCTURED_OUTPUT')->>'idempotent_replay','false',
 'late malformed completed review retains actual result and provider cost after lease expiry');
select is(pg_temp.audit_call('late',p_allocate=>false)#>>'{checkpoint,usage,attempt_status}','failed',
 'audited replay truthfully retains failure rather than inventing a successful review');
select is((select input_tokens+output_tokens from public.usage_ledger where logical_request_id='audit-late' and event_type='model_call'),26,
 'failed completed review keeps the true 17 input and 9 output tokens');

select is(pg_temp.audit_old_read('cancel')->>'state','prepared','cancel fixture positively prepares');
select is(pg_temp.audit_call('cancel')#>>'{checkpoint,state}','prepared','cancel fixture binds before cancellation');
select is(pg_temp.audit_record('cancel',1,'cancelled','cancelled','REQUEST_CANCELLED')->>'idempotent_replay','false',
 'existing cancellation records a never-dispatched attempt without changing its metadata');
select is(pg_temp.audit_call('cancel',p_allocate=>false)#>>'{checkpoint,state}','terminal_cancelled',
 'cancelled audit remains terminal and grants no new provider attempt');

-- Deleting the exact synthetic owner remains compatible with existing FK
-- cascades; immutability protects updates, not an authorised lifecycle deletion.
insert into audit_fixture values ('cascade-other','a8150000-0000-4000-8000-000000000002',
 public.reserve_document_allowance_with_policy('a8150000-0000-4000-8000-000000000002',
 'audit-cascade-other','generate-document',repeat('a',64),'business',1000,1800,
 'legacy-template-policy.1',repeat('b',64),null));
select is(pg_temp.audit_old_read('cascade-other')->>'state','prepared','other owner has a positive owned attempt before deletion');
select is(pg_temp.audit_call('cascade-other')#>>'{checkpoint,state}','prepared','other owner receives its own source binding');
insert into audit_state select 'surviving-owner-admissions',coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')
 from private.legacy_model_attempt_admissions a where user_id='a8150000-0000-4000-8000-000000000001';
delete from auth.users where id='a8150000-0000-4000-8000-000000000002';
select is((select count(*)::integer from private.legacy_model_attempt_admissions where user_id='a8150000-0000-4000-8000-000000000002'),0,
 'owned cascade deletion removes the bound synthetic attempt');
select is((select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from private.legacy_model_attempt_admissions a
 where user_id='a8150000-0000-4000-8000-000000000001'),(select value from audit_state where name='surviving-owner-admissions'),
 'one owner deletion preserves every other owner admission field');

select * from finish();
rollback;
