-- Fail deployment closed unless every active semantic route has the exact
-- operator-approved, enabled capacity configuration. This exposes only
-- revisioned fingerprints; allocation values and operator metadata stay private.

begin;

create or replace function public.attest_openai_capacity_configuration(
  p_environment text,
  p_semantic_routes text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_environment text := pg_catalog.lower(pg_catalog.btrim(p_environment));
  v_route_count integer;
  v_distinct_route_count integer;
  v_invalid_route text;
  v_routes jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'CAPACITY_ATTESTATION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_environment is null
    or p_environment <> v_environment
    or v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'CAPACITY_ATTESTATION_ENVIRONMENT_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct requested.semantic_route)::integer,
         pg_catalog.min(requested.semantic_route) filter (
           where requested.semantic_route is null
             or requested.semantic_route not in ('fast', 'deep', 'research', 'review')
         )
  into v_route_count, v_distinct_route_count, v_invalid_route
  from pg_catalog.unnest(p_semantic_routes) requested(semantic_route);

  if v_route_count is null
    or v_route_count < 1
    or v_route_count > 4
    or v_distinct_route_count <> v_route_count
    or v_invalid_route is not null then
    raise exception 'CAPACITY_ATTESTATION_ROUTES_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'semantic_route', requested.semantic_route,
      'configured', route_config.semantic_route is not null,
      'enabled', route_config.enabled,
      'config_revision', route_config.config_revision,
      'fingerprint', case
        when route_config.semantic_route is null then null
        else pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(
              pg_catalog.jsonb_build_object(
                'environment', route_config.environment,
                'semantic_route', route_config.semantic_route,
                'config_revision', route_config.config_revision,
                'enabled', route_config.enabled,
                'global_active_limit', route_config.global_active_limit,
                'per_user_active_limit', route_config.per_user_active_limit,
                'global_request_limit_per_minute',
                  route_config.global_request_limit_per_minute,
                'global_token_limit_per_minute',
                  route_config.global_token_limit_per_minute,
                'lease_seconds', route_config.lease_seconds,
                'retry_after_seconds', route_config.retry_after_seconds
              )::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        )
      end
    ) order by requested.semantic_route
  )
  into v_routes
  from pg_catalog.unnest(p_semantic_routes) requested(semantic_route)
  left join private.openai_capacity_route_configs route_config
    on route_config.environment = v_environment
   and route_config.semantic_route = requested.semantic_route;

  return pg_catalog.jsonb_build_object(
    'contract_version', 'openai-capacity-attestation.1',
    'environment', v_environment,
    'routes', v_routes
  );
end;
$function$;

revoke all on function public.attest_openai_capacity_configuration(text, text[])
  from public, anon, authenticated;
grant execute on function public.attest_openai_capacity_configuration(text, text[])
  to service_role;

commit;
