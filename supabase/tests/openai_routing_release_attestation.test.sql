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
  'configure_openai_routing_release',
  array[
    'text', 'text', 'boolean', 'text', 'text', 'text', 'text', 'text',
    'timestamp with time zone', 'timestamp with time zone', 'integer', 'text', 'text'
  ],
  'routing configuration has one revision-checked service RPC'
);
select has_function(
  'public',
  'attest_openai_routing_configuration',
  array['text', 'text[]'],
  'routing release attestation has one exact RPC signature'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.attest_openai_routing_configuration(text,text[])',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.attest_openai_routing_configuration(text,text[])',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon',
    'public.attest_openai_routing_configuration(text,text[])',
    'EXECUTE'
  ),
  'only protected release compute can attest routing configuration'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_proc function_record
    where function_record.oid =
      'public.attest_openai_routing_configuration(text,text[])'::regprocedure
      and function_record.prosecdef
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  'routing attestation is a fixed-path security definer'
);

set local role service_role;
select public.configure_openai_routing_release(
  'production', route.semantic_route, true, route.model,
  route.reasoning_effort, 'routing.2026-09-release.1',
  'prompted-openai-evals.1', repeat(route.fingerprint_character, 64),
  pg_catalog.clock_timestamp() - interval '1 day',
  pg_catalog.clock_timestamp() + interval '30 days',
  0, 'pgtap', 'synthetic evaluated route fixture'
)
from (values
  ('fast', 'gpt-5.6-luna', 'low', 'a'),
  ('deep', 'gpt-5.6-sol', 'medium', 'b'),
  ('research', 'gpt-5.6-terra', 'medium', 'c'),
  ('review', 'gpt-5.6-sol', 'high', 'd')
) route(semantic_route, model, reasoning_effort, fingerprint_character);

create temporary table routing_attestation_snapshot(payload jsonb not null) on commit drop;
grant select, insert on routing_attestation_snapshot to service_role;
insert into routing_attestation_snapshot(payload)
select public.attest_openai_routing_configuration(
  'production', array['review', 'research', 'deep', 'fast']
);

select is(
  (select payload->>'contract_version' from routing_attestation_snapshot),
  'openai-routing-attestation.1',
  'routing attestation exposes one versioned contract'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from routing_attestation_snapshot snapshot,
      pg_catalog.jsonb_array_elements(snapshot.payload->'routes') route_fact
    where route_fact->>'configured' = 'true'
      and route_fact->>'enabled' = 'true'
      and route_fact->>'evaluated_configuration_sha256' ~ '^[0-9a-f]{64}$'
      and (route_fact->>'config_revision')::integer = 1
  ),
  4,
  'all four semantic routes carry exact enabled evaluation evidence'
);
select is(
  (
    select route_fact->>'model'
    from routing_attestation_snapshot snapshot,
      pg_catalog.jsonb_array_elements(snapshot.payload->'routes') route_fact
    where route_fact->>'semantic_route' = 'fast'
  ),
  'gpt-5.6-luna',
  'the fast route binds its exact evaluated model'
);
select ok(
  pg_temp.raises_matching(
    $$select public.configure_openai_routing_release(
      'production', 'fast', true, 'gpt-5.6-luna', 'low',
      'routing.2026-09-release.1', 'prompted-openai-evals.1', repeat('a', 64),
      pg_catalog.clock_timestamp() - interval '1 day',
      pg_catalog.clock_timestamp() + interval '30 days',
      0, 'pgtap', 'stale revision'
    )$$,
    '%OPENAI_ROUTING_CONFIG_REVISION_CONFLICT%'
  ),
  'stale configuration writers cannot replace evaluated routing evidence'
);

reset role;
select ok(
  pg_temp.raises_matching(
    $$update private.openai_routing_release_config_revisions
      set enabled = false where semantic_route = 'fast'$$,
    '%IMMUTABLE_CAPTURED_RECORD%'
  ),
  'routing revision history is immutable'
);

set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.attest_openai_routing_configuration(
      'production', array['fast']
    )$$,
    '%permission denied%'
  ),
  'browser callers cannot invoke routing release attestation'
);

select * from finish();
rollback;
