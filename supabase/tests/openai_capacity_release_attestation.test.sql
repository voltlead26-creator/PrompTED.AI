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

select has_function(
  'public',
  'attest_openai_capacity_configuration',
  array['text', 'text[]'],
  'capacity release attestation has one exact RPC signature'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.attest_openai_capacity_configuration(text,text[])',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.attest_openai_capacity_configuration(text,text[])',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon',
    'public.attest_openai_capacity_configuration(text,text[])',
    'EXECUTE'
  ),
  'only protected release compute can attest capacity configuration'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_proc function_record
    where function_record.oid =
      'public.attest_openai_capacity_configuration(text,text[])'::regprocedure
      and function_record.prosecdef
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  'capacity attestation is a fixed-path security definer'
);

set local role service_role;
select is(
  public.attest_openai_capacity_configuration(
    'production', array['fast', 'deep', 'research', 'review']
  )#>>'{routes,0,configured}',
  'false',
  'an absent route is reported without leaking allocation details'
);
reset role;

select public.configure_openai_capacity_route(
  'production', route.semantic_route, route.enabled,
  route.global_active_limit, route.per_user_active_limit,
  route.rpm, route.tpm, 180, 5, 0,
  'pgtap', 'synthetic release-attestation fixture'
)
from (values
  ('fast', true, 8, 2, 120, 120000),
  ('deep', true, 4, 1, 40, 80000),
  ('research', true, 2, 1, 20, 50000),
  ('review', false, 1, 1, 10, 30000)
) route(
  semantic_route, enabled, global_active_limit, per_user_active_limit, rpm, tpm
);

set local role service_role;
create temporary table capacity_attestation_snapshot(payload jsonb not null) on commit drop;
grant select, insert on capacity_attestation_snapshot to service_role;
insert into capacity_attestation_snapshot(payload)
select public.attest_openai_capacity_configuration(
  'production', array['review', 'research', 'deep', 'fast']
);

select is(
  (select payload->>'contract_version' from capacity_attestation_snapshot),
  'openai-capacity-attestation.1',
  'the release receipt has one versioned contract'
);
select is(
  (select payload->>'environment' from capacity_attestation_snapshot),
  'production',
  'the receipt binds one exact deployment environment'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from capacity_attestation_snapshot snapshot,
      pg_catalog.jsonb_array_elements(snapshot.payload->'routes') route_fact
    where route_fact->>'configured' = 'true'
      and route_fact->>'fingerprint' ~ '^[0-9a-f]{64}$'
      and (route_fact->>'config_revision')::integer = 1
  ),
  4,
  'all four configured routes expose only revisioned SHA-256 fingerprints'
);
select is(
  (
    select route_fact->>'enabled'
    from capacity_attestation_snapshot snapshot,
      pg_catalog.jsonb_array_elements(snapshot.payload->'routes') route_fact
    where route_fact->>'semantic_route' = 'review'
  ),
  'false',
  'a configured but disabled route remains visibly non-deployable'
);
select ok(
  (select payload::text from capacity_attestation_snapshot) not like '%changed_by%'
    and (select payload::text from capacity_attestation_snapshot) not like '%change_reason%'
    and (select payload::text from capacity_attestation_snapshot)
      not like '%global_token_limit_per_minute%',
  'the attestation returns no operator metadata or raw allocation values'
);

select ok(
  pg_temp.raises_matching(
    $$select public.attest_openai_capacity_configuration(
      'Production', array['fast']
    )$$,
    '%CAPACITY_ATTESTATION_ENVIRONMENT_INVALID%'
  ) and pg_temp.raises_matching(
    $$select public.attest_openai_capacity_configuration(
      'production', array['fast', 'fast']
    )$$,
    '%CAPACITY_ATTESTATION_ROUTES_INVALID%'
  ) and pg_temp.raises_matching(
    $$select public.attest_openai_capacity_configuration(
      'production', array['fast', 'unknown']
    )$$,
    '%CAPACITY_ATTESTATION_ROUTES_INVALID%'
  ),
  'ambiguous environment, duplicate routes, and unknown routes fail closed'
);

reset role;
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.attest_openai_capacity_configuration(
      'production', array['fast']
    )$$,
    '%permission denied%'
  ),
  'browser callers cannot invoke release capacity attestation'
);

select * from finish();
rollback;
