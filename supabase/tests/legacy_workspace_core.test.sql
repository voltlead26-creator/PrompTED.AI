begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- This is an extraction-contract regression, not proof that F2 attachment or
-- allowance settlement exists. Missing private-core calls return diagnostics;
-- they never fall back to the public writer. All setup uses real owned rows.
create temp table lwc_requests(name text primary key, request jsonb not null);
create temp table lwc_results(name text primary key, result jsonb not null);
create temp table lwc_snapshots(name text primary key, value jsonb not null);
grant select on lwc_requests to authenticated, anon, service_role;
grant select, insert on lwc_results to authenticated, anon, service_role;

create function pg_temp.lwc_document(p_title text, p_status text default 'draft',
  p_placeholders jsonb default '[]'::jsonb)
returns jsonb language sql as $f$
  select jsonb_build_object('title',p_title,'status',p_status,
    'template_id','a8160000-0000-4000-8000-000000000001',
    'unresolved_placeholders',p_placeholders)
$f$;
create function pg_temp.lwc_new_section(p_id uuid,p_name text,p_order integer,p_content text)
returns jsonb language sql as $f$
  select jsonb_build_object('id',p_id,'expected',null,'desired',jsonb_build_object(
    'name',p_name,'order_index',p_order,'status','draft','is_required',p_order=0),
    'content',p_content)
$f$;
create function pg_temp.lwc_patches(p_document uuid) returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('id',s.id,'expected',jsonb_build_object(
      'revision',s.revision,'content_sha256',encode(extensions.digest(convert_to(s.content,'UTF8'),'sha256'),'hex'),
      'name',s.name,'order_index',s.order_index,'status',s.status,'is_required',s.is_required),
    'desired',jsonb_build_object('name',s.name,'order_index',s.order_index,
      'status',s.status,'is_required',s.is_required)) order by s.order_index,s.id)
  from public.sections s where s.document_id=p_document
$f$;
create function pg_temp.lwc_call(p_request jsonb,p_private boolean default false)
returns jsonb language plpgsql as $f$
declare v_result jsonb;
begin
  if p_private then
    if to_regprocedure('private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)') is null then
      return jsonb_build_object('error','LWC_CORE_CONTRACT_UNAVAILABLE','sqlstate','42883');
    end if;
    execute 'select private.save_legacy_workspace_core_v1($1,$2,$3,$4,$5,$6,$7,$8)'
      into v_result using (p_request->>'actor')::uuid,p_request->>'key',
        (p_request->>'outcome')::uuid,(p_request->>'document_id')::uuid,
        (p_request->>'revision')::integer,nullif(p_request->'expected','null'::jsonb),
        p_request->'document',p_request->'sections';
  else
    v_result:=public.save_own_legacy_workspace_v1(p_request->>'key',
      (p_request->>'outcome')::uuid,(p_request->>'document_id')::uuid,
      (p_request->>'revision')::integer,nullif(p_request->'expected','null'::jsonb),
      p_request->'document',p_request->'sections');
  end if;
  return v_result;
exception when others then
  return jsonb_build_object('error',sqlerrm,'sqlstate',sqlstate);
end;
$f$;
create function pg_temp.lwc_rows() returns jsonb language sql as $f$
  select jsonb_build_object(
    'outcomes',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.outcomes r
      where user_id in ('a8160001-0000-4000-8000-000000000001','a8160001-0000-4000-8000-000000000002')),
    'documents',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.documents r
      where user_id in ('a8160001-0000-4000-8000-000000000001','a8160001-0000-4000-8000-000000000002')),
    'sections',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.sections r
      where user_id in ('a8160001-0000-4000-8000-000000000001','a8160001-0000-4000-8000-000000000002')),
    'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from private.legacy_workspace_save_receipts r
      where user_id in ('a8160001-0000-4000-8000-000000000001','a8160001-0000-4000-8000-000000000002')))
$f$;
create function pg_temp.lwc_public_properties() returns jsonb language sql as $f$
  select jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,
    'arguments',p.proargtypes::text,'names',p.proargnames,'defaults',p.pronargdefaults,
    'language',p.prolang,'security_definer',p.prosecdef,'config',p.proconfig,
    'volatility',p.provolatile,'parallel',p.proparallel,'result_type',p.prorettype,
    'strict',p.proisstrict,'returns_set',p.proretset,'kind',p.prokind,'argument_count',p.pronargs,
    'all_argument_types',p.proallargtypes,'argument_modes',p.proargmodes,
    'cost',p.procost,'leakproof',p.proleakproof)
  from pg_proc p where p.oid=to_regprocedure(
    'public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)')
$f$;

insert into lwc_snapshots values ('public-properties',pg_temp.lwc_public_properties());
select has_function('public','save_own_legacy_workspace_v1',
  array['text','uuid','uuid','integer','jsonb','jsonb','jsonb'],
  'the existing public seven-argument save remains available');
select ok((select p.prosecdef and p.pronargdefaults=0 and p.proconfig @> array['search_path=""']::text[]
  and p.proargnames=array['p_idempotency_key','p_outcome_id','p_document_id',
    'p_expected_document_revision','p_expected_document','p_document','p_sections']::text[]
  from pg_proc p where p.oid=to_regprocedure('public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)')),
  'the public argument names, no-default contract, security and fixed search path remain literal');
select ok(has_function_privilege('authenticated','public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)','EXECUTE'),
  'the public save keeps its authenticated-only grant');
select has_function('private','save_legacy_workspace_core_v1',
  array['uuid','text','uuid','uuid','integer','jsonb','jsonb','jsonb'],
  'one private core accepts the explicit actor before the unchanged seven save arguments');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='save_legacy_workspace_core_v1' and not p.prosecdef
    and p.pronargdefaults=0 and p.proconfig @> array['search_path=""']::text[]
    and p.prorettype='jsonb'::regtype),1,
  'the core is an invoker function with a fixed path, no defaults and the existing JSONB result');
select ok((select c.proowner=p.proowner and has_function_privilege(c.proowner,c.oid,'EXECUTE')
  from pg_proc c cross join pg_proc p
  where c.oid=to_regprocedure('private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)')
    and p.oid=to_regprocedure('public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)')),
  'the invoker core has the existing public wrapper owner and that owner can execute it');
select ok((select not exists(select 1 from aclexplode(coalesce(c.proacl,acldefault('f',c.proowner))) a
    where a.privilege_type='EXECUTE' and a.grantee<>c.proowner)
  from pg_proc c where c.oid=to_regprocedure(
    'private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)')),
  'the core ACL grants execution only to its owner, including no custom default grant');
select is((select encode(extensions.digest(convert_to(c.prosrc,'UTF8'),'sha256'),'hex')
  from pg_proc c where c.oid=to_regprocedure(
    'private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)')),
  'cbebe21e2b42c68b96ee588075889c1c2f83e90ca7d644e59d5de1164057a756',
  'supplementary body digest proves the reviewed save body changed only its actor initializer');
select ok(coalesce(not has_function_privilege('authenticated',to_regprocedure(
  'private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)'),'EXECUTE'),false)
  and coalesce(not has_function_privilege('anon',to_regprocedure(
  'private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)'),'EXECUTE'),false)
  and coalesce(not has_function_privilege('service_role',to_regprocedure(
  'private.save_legacy_workspace_core_v1(uuid,text,uuid,uuid,integer,jsonb,jsonb,jsonb)'),'EXECUTE'),false),
  'the private core grants no execution to browser or service roles');
select ok(not has_table_privilege('authenticated','private.legacy_workspace_save_receipts','SELECT')
  and not has_table_privilege('service_role','private.legacy_workspace_save_receipts','SELECT'),
  'the existing immutable receipt authority stays private');

insert into public.templates(id,name,domain,category,plain_description,structure_type) values
 ('a8160000-0000-4000-8000-000000000001','Actor core fixture','business','test','Synthetic rollback fixture.','compose');
insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
 ('a8160001-0000-4000-8000-000000000001','workspace-core-owner@example.invalid',false,false,now(),now()),
 ('a8160001-0000-4000-8000-000000000002','workspace-core-other@example.invalid',false,false,now(),now());
insert into public.outcomes(id,user_id,situation_text,recommendation_payload,status,is_saved)
select ('a8160002-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
  case when i in (1,3) then 'a8160001-0000-4000-8000-000000000001'::uuid
    else 'a8160001-0000-4000-8000-000000000002'::uuid end,
  'Synthetic actor workspace '||i,'{"primary":{"template_id":"proposal","reason":"Synthetic"},"alternatives":[]}'::jsonb,
  'in_progress',true from generate_series(1,5) i;
select is((select count(*)::integer from auth.users where id in (
 'a8160001-0000-4000-8000-000000000001','a8160001-0000-4000-8000-000000000002')),2,
 'both independent owners positively exist');
select is((select count(*)::integer from public.outcomes where user_id in (
 'a8160001-0000-4000-8000-000000000001','a8160001-0000-4000-8000-000000000002')),5,
 'five real owned outcomes exist before save and denial cases');

insert into lwc_requests select 'create-'||kind,jsonb_build_object(
  'actor',actor,'key','lwc-create-'||kind,'outcome',outcome,'document_id',document_id,
  'revision',0,'expected',null,'document',pg_temp.lwc_document('Created '||kind),
  'sections',jsonb_build_array(pg_temp.lwc_new_section(section_id,'Summary',0,'Literal '||kind||E' wording.\n'),
    pg_temp.lwc_new_section(second_id,'Details',1,'Second '||kind||' wording.')))
from (values
 ('public','a8160001-0000-4000-8000-000000000001'::uuid,'a8160002-0000-4000-8000-000000000001'::uuid,
  'a8160003-0000-4000-8000-000000000001'::uuid,'a8160004-0000-4000-8000-000000000001'::uuid,'a8160004-0000-4000-8000-000000000002'::uuid),
 ('core','a8160001-0000-4000-8000-000000000002'::uuid,'a8160002-0000-4000-8000-000000000002'::uuid,
  'a8160003-0000-4000-8000-000000000002'::uuid,'a8160004-0000-4000-8000-000000000003'::uuid,'a8160004-0000-4000-8000-000000000004'::uuid)
) f(kind,actor,outcome,document_id,section_id,second_id);

select set_config('request.jwt.claim.sub','a8160001-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into lwc_results select 'public-created',pg_temp.lwc_call(request) from lwc_requests where name='create-public';
reset role;
select is((select result->>'state' from lwc_results where name='public-created'),'created',
 'the actual authenticated public save positively creates its owned workspace');
select is((select count(*)::integer from public.sections where document_id='a8160003-0000-4000-8000-000000000001'
 and user_id='a8160001-0000-4000-8000-000000000001' and revision=1),2,
 'both public-created sections independently persist at revision one');
select is((select result from private.legacy_workspace_save_receipts where user_id='a8160001-0000-4000-8000-000000000001'
 and idempotency_key='lwc-create-public'),(select result from lwc_results where name='public-created'),
 'the returned public result equals its independently persisted receipt');
insert into lwc_snapshots values ('before-public-replay',pg_temp.lwc_rows());
set local role authenticated;
insert into lwc_results select 'public-replay',pg_temp.lwc_call(request) from lwc_requests where name='create-public';
reset role;
select is((select result from lwc_results where name='public-replay'),
 (select result||'{"idempotent_replay":true}'::jsonb from lwc_results where name='public-created'),
 'the public acknowledgement retry returns its exact historical result');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-public-replay'),
 'public replay preserves every owned row, revision, history and receipt');

-- The only ambient identity writes are explicit test setup. The invoker core
-- must neither derive its actor from these values nor mutate them.
select set_config('request.jwt.claim.sub','a8160001-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a8160001-0000-4000-8000-000000000001","role":"authenticated","test":"preserve"}',true);
insert into lwc_snapshots values ('ambient',jsonb_build_object(
 'sub',current_setting('request.jwt.claim.sub',true),'claims',current_setting('request.jwt.claims',true)));
insert into lwc_results select 'core-created',pg_temp.lwc_call(request,true) from lwc_requests where name='create-core';
select is((select result->>'state' from lwc_results where name='core-created'),'created',
 'explicit owner B creates its workspace while the ambient authenticated identity is owner A');
select is((select count(*)::integer from public.documents where id='a8160003-0000-4000-8000-000000000002'
 and user_id='a8160001-0000-4000-8000-000000000002' and current_revision=1),1,
 'the core-created document belongs only to its explicit actor');
select is((select count(*)::integer from public.sections where document_id='a8160003-0000-4000-8000-000000000002'
 and user_id='a8160001-0000-4000-8000-000000000002' and revision=1),2,
 'the complete core-created roster persists under the explicit owner');
select is((select content from public.sections where id='a8160004-0000-4000-8000-000000000003'),E'Literal core wording.\n',
 'core creation preserves literal wording including the trailing newline');
select is((select result from private.legacy_workspace_save_receipts where user_id='a8160001-0000-4000-8000-000000000002'
 and idempotency_key='lwc-create-core'),(select result from lwc_results where name='core-created'),
  'core creation returns the existing independently persisted receipt shape');
select ok((select private.jsonb_has_exact_keys(result,array['contract_version','state','outcome_id','document_id',
  'idempotency_key','accepted_document_revision','document_revision','document_status','document_approved_revision',
  'document_updated_at','sections','committed_at','idempotent_replay'])
  and jsonb_array_length(result->'sections')=2 and not exists(
    select 1 from jsonb_array_elements(result->'sections') s(value)
    where not private.jsonb_has_exact_keys(s.value,array['section_id','status','revision','approved_revision','content_sha256','updated_at']))
  from lwc_results where name='core-created'),
  'the core returns the existing closed thirteen-field and six-field receipt contracts');
select is(jsonb_build_object('sub',current_setting('request.jwt.claim.sub',true),
 'claims',current_setting('request.jwt.claims',true)),(select value from lwc_snapshots where name='ambient'),
 'the explicit-actor core never substitutes or rewrites ambient JWT settings');

insert into lwc_snapshots values ('before-core-public-replay',pg_temp.lwc_rows());
select set_config('request.jwt.claim.sub','a8160001-0000-4000-8000-000000000002',true);
insert into lwc_results select 'core-public-replay',pg_temp.lwc_call(request,true) from lwc_requests where name='create-public';
select is((select result from lwc_results where name='core-public-replay'),
 (select result||'{"idempotent_replay":true}'::jsonb from lwc_results where name='public-created'),
 'the core replays an existing public receipt under its explicit actor despite different ambient identity');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-core-public-replay'),
 'cross-entry historical replay preserves the original request hash and all persisted rows');
insert into lwc_snapshots values ('before-public-core-replay',pg_temp.lwc_rows());
set local role authenticated;
insert into lwc_results select 'public-core-replay',case when (
  select result->>'contract_version'='legacy-workspace-save.v1' and result->>'state'='created'
    and result->>'document_id'=request->>'document_id'
  from lwc_results where name='core-created')
 then pg_temp.lwc_call(request)
 else jsonb_build_object('error','LWC_CORE_CREATION_UNAVAILABLE','sqlstate','P9904') end
 from lwc_requests where name='create-core';
reset role;
select is((select result->>'idempotent_replay' from lwc_results where name='public-core-replay'),'true',
 'the unchanged public wrapper replays a core-created receipt');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-public-core-replay'),
 'public replay of a core save cannot duplicate its document, sections or receipt');

insert into lwc_snapshots values ('before-denials',pg_temp.lwc_rows());
set local role authenticated;
insert into lwc_results select 'authenticated-denied',pg_temp.lwc_call(request,true) from lwc_requests where name='create-core';
reset role;
set local role anon;
insert into lwc_results select 'anon-denied',pg_temp.lwc_call(request,true) from lwc_requests where name='create-core';
reset role;
set local role service_role;
insert into lwc_results select 'service-denied',pg_temp.lwc_call(request,true) from lwc_requests where name='create-core';
reset role;
select is(result->>'sqlstate','42501','direct private execution is denied to '||name)
 from lwc_results where name in ('authenticated-denied','anon-denied','service-denied') order by name;
select is((select pg_temp.lwc_call(jsonb_set(request,'{actor}','null'::jsonb),true)->>'error'
 from lwc_requests where name='create-core'),'LEGACY_WORKSPACE_AUTHENTICATION_REQUIRED',
 'a null explicit actor is rejected before any workspace operation');
select is((select pg_temp.lwc_call(request||'{"actor":"a8160001-0000-4000-8000-000000000001","key":"lwc-foreign"}'::jsonb,true)->>'error'
 from lwc_requests where name='create-core'),'LEGACY_WORKSPACE_UNAVAILABLE',
 'an explicit actor cannot acquire another owner workspace');
select is((select pg_temp.lwc_call(jsonb_set(request,'{document,title}','"Different replay"'::jsonb),true)->>'error'
 from lwc_requests where name='create-public'),'LEGACY_WORKSPACE_REPLAY_CONFLICT',
 'the core preserves owner-scoped request-hash conflict handling');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-denials'),
 'all role, actor and replay denials preserve complete rows and immutable receipts');

-- Reuse the actual legacy revision-trigger scenario: two changed existing
-- sections plus document metadata advance the parent 5 -> 8, never just +1.
insert into public.documents(id,user_id,outcome_id,template_id,title,status,
 unresolved_placeholders,ledger_binding_status,current_revision,approved_revision)
select ('a8160003-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case when i=3 then 'a8160001-0000-4000-8000-000000000001'::uuid else 'a8160001-0000-4000-8000-000000000002'::uuid end,
 ('a8160002-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 'a8160000-0000-4000-8000-000000000001','Existing proposal','approved','[]','legacy_unversioned',5,5
 from generate_series(3,5) i;
insert into public.sections(id,document_id,user_id,name,order_index,content,status,is_required,
 ledger_binding_status,revision,approved_revision)
select ('a8160004-0000-4000-8000-'||lpad((i*10+j)::text,12,'0'))::uuid,
 ('a8160003-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 case when i=3 then 'a8160001-0000-4000-8000-000000000001'::uuid else 'a8160001-0000-4000-8000-000000000002'::uuid end,
 case when j=1 then 'Summary' else 'Details' end,j-1,
 case when j=1 then E'Preserve unloaded wording.\n' else 'Original loaded wording.' end,
 'approved',j=1,'legacy_unversioned',j+2,j+2
 from generate_series(3,5) i cross join generate_series(1,2) j;
select is((select count(*)::integer from public.documents where id in (
 'a8160003-0000-4000-8000-000000000003','a8160003-0000-4000-8000-000000000004','a8160003-0000-4000-8000-000000000005')
 and current_revision=5 and approved_revision=5),3,'all approved revision-five controls positively exist');
select is((select count(*)::integer from public.sections where document_id in (
 'a8160003-0000-4000-8000-000000000003','a8160003-0000-4000-8000-000000000004','a8160003-0000-4000-8000-000000000005')
 and revision in (3,4) and approved_revision=revision),6,'all six approved section revisions positively exist');
insert into lwc_requests select case i when 3 then 'update-public' when 4 then 'update-core' else 'atomic' end,
 jsonb_build_object('actor',d.user_id,'key',case i when 3 then 'lwc-update-public' when 4 then 'lwc-update-core' else 'lwc-atomic' end,
 'outcome',d.outcome_id,'document_id',d.id,'revision',5,
 'expected',pg_temp.lwc_document('Existing proposal','approved'),
 'document',pg_temp.lwc_document('Updated proposal','approved','[{"id":"missing-fact","requiredForExport":true}]'::jsonb),
 'sections',jsonb_build_array(
   jsonb_set(jsonb_set(pg_temp.lwc_patches(d.id)->1,'{desired,order_index}','0'::jsonb),'{desired,status}','"edited"'::jsonb)
     ||jsonb_build_object('content','Revised loaded wording.'),
   jsonb_set(pg_temp.lwc_patches(d.id)->0,'{desired,order_index}','1'::jsonb)))
 from generate_series(3,5) i join public.documents d
 on d.id=('a8160003-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
select set_config('request.jwt.claim.sub','a8160001-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into lwc_results select 'updated-public',pg_temp.lwc_call(request) from lwc_requests where name='update-public';
reset role;
insert into lwc_results select 'updated-core',pg_temp.lwc_call(request,true) from lwc_requests where name='update-core';
select is(result->>'document_revision','8',name||' returns actual parent revision eight')
 from lwc_results where name in ('updated-public','updated-core') order by name;
select is((select current_revision from public.documents where id=
 ('a8160003-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid),8,
 'independent parent read proves revision 5 to 8 for fixture '||i) from generate_series(3,4) i;
select ok((select status='edited' and approved_revision is null and title='Updated proposal'
 and unresolved_placeholders='[{"id":"missing-fact","requiredForExport":true}]'::jsonb
 from public.documents where id=('a8160003-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid),
 'metadata edit invalidates the exact parent approval for fixture '||i) from generate_series(3,4) i;
select ok((select content=E'Preserve unloaded wording.\n' and order_index=1 and revision=4
 and status='edited' and approved_revision is null and version_history='[]'::jsonb
 from public.sections where id=('a8160004-0000-4000-8000-'||lpad((i*10+1)::text,12,'0'))::uuid),
 'reordered unloaded sibling retains literal body without invented history for fixture '||i) from generate_series(3,4) i;
select ok((select content='Revised loaded wording.' and order_index=0 and revision=5
 and approved_revision is null and jsonb_array_length(version_history)=1
 and version_history#>>'{0,content}'='Original loaded wording.'
 from public.sections where id=('a8160004-0000-4000-8000-'||lpad((i*10+2)::text,12,'0'))::uuid),
 'changed wording retains its exact prior version for fixture '||i) from generate_series(3,4) i;
select is(r.result,s.result,'returned update receipt equals independent immutable receipt for '||s.name)
 from lwc_results s left join private.legacy_workspace_save_receipts r on r.idempotency_key=
 case s.name when 'updated-public' then 'lwc-update-public' else 'lwc-update-core' end
 where s.name in ('updated-public','updated-core') order by s.name;

insert into lwc_snapshots values ('before-update-replay',pg_temp.lwc_rows());
select is((select pg_temp.lwc_call(request,true) from lwc_requests where name='update-core'),
 (select result||'{"idempotent_replay":true}'::jsonb from lwc_results where name='updated-core'),
 'core update replay returns its accepted revision despite the now-advanced baseline');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-update-replay'),
 'update replay appends no duplicate wording history or section revision');

-- The complete stale roster has a valid first change and invalid later hash.
insert into lwc_requests select 'stale',jsonb_set(request||'{"key":"lwc-stale"}'::jsonb,
 '{sections,0,expected,content_sha256}',to_jsonb(repeat('0',64))) from lwc_requests where name='atomic';
insert into lwc_snapshots values ('before-stale',pg_temp.lwc_rows());
select set_config('request.jwt.claim.sub','a8160001-0000-4000-8000-000000000002',true);
set local role authenticated;
insert into lwc_results select 'public-stale',pg_temp.lwc_call(request) from lwc_requests where name='stale';
reset role;
insert into lwc_results select 'core-stale',pg_temp.lwc_call(request,true) from lwc_requests where name='stale';
select is(result->>'error','LEGACY_WORKSPACE_SECTION_CONFLICT',name||' rejects a stale later section')
 from lwc_results where name in ('public-stale','core-stale') order by name;
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-stale'),
 'stale full-roster rejection preserves both owners, every timestamp and all prior history');
select is((select pg_temp.lwc_call(jsonb_set(request||'{"key":"lwc-roster"}'::jsonb,
 '{sections}',jsonb_build_array(request#>'{sections,0}')),true)->>'error'
 from lwc_requests where name='atomic'),'LEGACY_WORKSPACE_SECTION_ROSTER_CONFLICT',
 'the core cannot omit an existing sibling from the accepted roster');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-stale'),
 'missing-roster rejection creates neither partial updates nor receipts');

-- A test-only receipt trigger checks that both pending document and section
-- writes happened before raising. The writer must roll all of them back.
create function pg_temp.lwc_fail_receipt() returns trigger language plpgsql as $f$
begin
  if new.idempotency_key='lwc-receipt-failure' then
    if not exists(select 1 from public.documents where id=new.document_id and title='Updated proposal' and current_revision=8)
      or not exists(select 1 from public.sections where document_id=new.document_id
        and content='Revised loaded wording.' and revision=5 and jsonb_array_length(version_history)=1) then
      raise exception using errcode='P9903',message='LWC_TEST_RECEIPT_PRECONDITION_FAILED';
    end if;
    raise exception using errcode='P9902',message='LWC_TEST_RECEIPT_WRITE_FAILED_AFTER_WORKSPACE';
  end if;
  return new;
end;
$f$;
create trigger lwc_test_receipt_failure before insert on private.legacy_workspace_save_receipts
 for each row execute function pg_temp.lwc_fail_receipt();
insert into lwc_requests select 'receipt-failure',request||'{"key":"lwc-receipt-failure"}'::jsonb
 from lwc_requests where name='atomic';
insert into lwc_snapshots values ('before-receipt-failure',pg_temp.lwc_rows());
set local role authenticated;
insert into lwc_results select 'public-receipt-failure',pg_temp.lwc_call(request) from lwc_requests where name='receipt-failure';
reset role;
select is((select result->>'error' from lwc_results where name='public-receipt-failure'),
 'LWC_TEST_RECEIPT_WRITE_FAILED_AFTER_WORKSPACE','the public control positively reaches the injected failure after real workspace writes');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-receipt-failure'),
 'public receipt failure rolls back wording, history, metadata, approval and revisions');
insert into lwc_results select 'core-receipt-failure',pg_temp.lwc_call(request,true) from lwc_requests where name='receipt-failure';
select is((select result->>'error' from lwc_results where name='core-receipt-failure'),
 'LWC_TEST_RECEIPT_WRITE_FAILED_AFTER_WORKSPACE','the core reaches the same injected receipt failure after real workspace writes');
select is(pg_temp.lwc_rows(),(select value from lwc_snapshots where name='before-receipt-failure'),
 'core receipt failure rolls back the complete workspace and receipt transaction');
select is((select count(*)::integer from private.legacy_workspace_save_receipts
 where idempotency_key in ('lwc-receipt-failure','lwc-stale','lwc-roster','lwc-foreign')),0,
 'none of the rejected operations leaves a misleading durable receipt');
drop trigger lwc_test_receipt_failure on private.legacy_workspace_save_receipts;

select is(pg_temp.lwc_public_properties(),(select value from lwc_snapshots where name='public-properties'),
 'calls leave the public OID, owner, argument contract and privileges unchanged');
-- A separate exact predecessor-to-forward upgrade must compare these public
-- properties across migration and replay receipts created before extraction.
select * from finish();
rollback;
