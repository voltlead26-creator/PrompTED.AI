begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function('public', 'library_manual_plan_routing_v1', array['outcomes'],
  'library routing is one computed field over the authoritative outcome row');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='library_manual_plan_routing_v1'), 1::bigint,
  'computed field has no ambiguous overload');
select ok((select not prosecdef and provolatile='i' and proisstrict
  and proargnames is null and proconfig @> array['search_path=""']
  from pg_proc where oid='public.library_manual_plan_routing_v1(public.outcomes)'::regprocedure),
  'computed field is pure, strict, invoker-only, fixed-path and has an unnamed argument');
select ok(has_function_privilege('authenticated','public.library_manual_plan_routing_v1(public.outcomes)','EXECUTE')
  and not has_function_privilege('anon','public.library_manual_plan_routing_v1(public.outcomes)','EXECUTE')
  and not has_function_privilege('service_role','public.library_manual_plan_routing_v1(public.outcomes)','EXECUTE'),
  'only the authenticated browser consumer receives execution');

create function pg_temp.library_routing(payload jsonb) returns jsonb language sql as $function$
  select public.library_manual_plan_routing_v1(jsonb_populate_record(null::public.outcomes,
    jsonb_build_object('recommendation_payload',payload)));
$function$;
select is(public.library_manual_plan_routing_v1(null::public.outcomes),null::jsonb,
  'null source row has no marker');
select is(pg_temp.library_routing(payload),null::jsonb,'non-marker is omitted: ' || label)
from (values ('SQL null',null::jsonb),('JSON null','null'::jsonb),('empty object','{}'::jsonb),
  ('scalar','"manual_plan"'::jsonb),('array','["manual_plan"]'::jsonb),
  ('number','7'::jsonb),('boolean','true'::jsonb)) fixtures(label,payload);
select is(pg_temp.library_routing(jsonb_build_object('body',repeat('文',10000))),null::jsonb,
  'large generated text is never included in the library response');

select is(pg_temp.library_routing(payload),payload,'valid marker is preserved exactly: ' || label)
from (values
  ('ordinary','{"manual_plan":{"contract_version":"manual-plan.1","plan_id":"local-plan:one"}}'::jsonb),
  ('maximum ASCII id',jsonb_build_object('manual_plan',jsonb_build_object(
    'contract_version','manual-plan.1','plan_id','A' || repeat('x',127))))) fixtures(label,payload);
select is(pg_temp.library_routing(payload),payload,'present malformed marker remains visible: ' || label)
from (values ('null','{"manual_plan":null}'::jsonb),('scalar','{"manual_plan":"bad"}'::jsonb),
  ('array','{"manual_plan":[]}'::jsonb),
  ('extra inner key','{"manual_plan":{"contract_version":"manual-plan.1","plan_id":"p","extra":true}}'::jsonb),
  ('extra outer key','{"manual_plan":{"contract_version":"manual-plan.1","plan_id":"p"},"title":"unexpected"}'::jsonb))
  fixtures(label,payload);

create function pg_temp.library_marker_bytes(bytes integer, multibyte boolean default false)
returns jsonb language sql as $function$
  select jsonb_build_object('manual_plan',null,'extra',
    case when multibyte then '文' else '' end ||
    repeat('x',bytes-octet_length(jsonb_build_object('manual_plan',null,'extra',
      case when multibyte then '文' else '' end)::text)));
$function$;
select is(octet_length(pg_temp.library_marker_bytes(bytes,multibyte)::text),bytes,
  'boundary fixture is exactly ' || bytes || ' UTF8 bytes; multibyte=' || multibyte)
from (values (1024,false),(1025,false),(1024,true),(1025,true)) fixtures(bytes,multibyte);
select is(pg_temp.library_routing(pg_temp.library_marker_bytes(1024,multibyte)),
  pg_temp.library_marker_bytes(1024,multibyte),
  'whole marker at 1024 bytes preserves all invalid keys; multibyte=' || multibyte)
from (values (false),(true)) fixtures(multibyte);
select is(pg_temp.library_routing(pg_temp.library_marker_bytes(1025,multibyte)),
  '{"manual_plan":null}'::jsonb,
  'whole marker above 1024 bytes becomes a bounded invalid marker; multibyte=' || multibyte)
from (values (false),(true)) fixtures(multibyte);
select is(pg_temp.library_routing(jsonb_build_object('manual_plan',jsonb_build_object(
  'contract_version','manual-plan.1','plan_id','p'),'body',repeat('x',10000))),
  '{"manual_plan":null}'::jsonb,'small nested marker cannot carry a large outer body');

set local role service_role;
select is(public.attest_prompted_release_schema('{}'::text[],array['library_manual_plan_routing_v1'])
  #>>'{rpcs,0,argument_types}','public.outcomes','release attestation reports the exact composite signature');
select is(public.attest_prompted_release_schema('{}'::text[],array['library_manual_plan_routing_v1'])
  #>>'{rpcs,0,authenticated_execute}','true','release attestation sees the authenticated grant');
select is(public.attest_prompted_release_schema('{}'::text[],array['library_manual_plan_routing_v1'])
  #>>'{rpcs,0,service_role_execute}','false','release attestation does not need computed-field execution');
reset role;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  ('94145000-0000-4000-8000-000000000001','library-routing-a@example.invalid',false,false,now(),now()),
  ('94145000-0000-4000-8000-000000000002','library-routing-b@example.invalid',false,false,now(),now());
insert into public.outcomes(id,user_id,situation_text,recommendation_payload) values
  ('94145000-0000-4000-8000-000000000011','94145000-0000-4000-8000-000000000001','Owner A',jsonb_build_object('body',repeat('A',10000))),
  ('94145000-0000-4000-8000-000000000012','94145000-0000-4000-8000-000000000002','Owner B',jsonb_build_object('body',repeat('B',10000)));
create temporary table library_source_before as select to_jsonb(o) source from public.outcomes o
  where id in ('94145000-0000-4000-8000-000000000011','94145000-0000-4000-8000-000000000012');
select set_config('request.jwt.claim.sub','94145000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from (select public.library_manual_plan_routing_v1(o) from public.outcomes o) visible),
  1::bigint,'computed selection without an owner filter still sees only owner A');
select is((select public.library_manual_plan_routing_v1(o) from public.outcomes o
  where id='94145000-0000-4000-8000-000000000011'),null::jsonb,'owner A reads a bounded generated projection');
select is((select count(*) from public.outcomes o where id='94145000-0000-4000-8000-000000000012'),
  0::bigint,'owner A cannot select the foreign source row');
reset role;
select set_config('request.jwt.claim.sub','94145000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from (select public.library_manual_plan_routing_v1(o) from public.outcomes o) visible),
  1::bigint,'computed selection after owner change still sees only owner B');
select is((select public.library_manual_plan_routing_v1(o) from public.outcomes o
  where id='94145000-0000-4000-8000-000000000012'),null::jsonb,'owner B reads a bounded generated projection');
reset role;
select is((select jsonb_agg(source order by source->>'id') from library_source_before),
  (select jsonb_agg(to_jsonb(o) order by o.id) from public.outcomes o
    where id in ('94145000-0000-4000-8000-000000000011','94145000-0000-4000-8000-000000000012')),
  'computed reads preserve every stored source column');
set local role anon;
select throws_ok($$select public.library_manual_plan_routing_v1(jsonb_populate_record(null::public.outcomes,
  '{"recommendation_payload":{"manual_plan":null}}'::jsonb))$$,
  '42501','permission denied for function library_manual_plan_routing_v1','anonymous direct invocation is denied');
reset role;
select * from finish();
rollback;
