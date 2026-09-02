-- Bind hosted OpenAI activation to one reviewed, expiring route/evaluation
-- configuration. Capacity and model suitability intentionally remain separate
-- revisioned authorities because they have different evidence lifecycles.

begin;

create table private.openai_routing_release_configs (
  environment text not null
    check (environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  semantic_route text not null
    check (semantic_route in ('fast', 'deep', 'research', 'review')),
  config_revision integer not null check (config_revision > 0),
  enabled boolean not null,
  model text not null check (model ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  reasoning_effort text not null
    check (reasoning_effort in ('low', 'medium', 'high')),
  routing_version text not null
    check (routing_version ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  evaluation_suite_version text not null
    check (evaluation_suite_version ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  evaluated_configuration_sha256 text not null
    check (evaluated_configuration_sha256 ~ '^[0-9a-f]{64}$'),
  evaluated_at timestamptz not null,
  expires_at timestamptz not null,
  changed_by text not null
    check (nullif(pg_catalog.btrim(changed_by), '') is not null),
  change_reason text not null
    check (nullif(pg_catalog.btrim(change_reason), '') is not null),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (environment, semantic_route),
  check (expires_at > evaluated_at),
  check (expires_at <= evaluated_at + interval '180 days')
);

create table private.openai_routing_release_config_revisions (
  environment text not null,
  semantic_route text not null,
  config_revision integer not null check (config_revision > 0),
  enabled boolean not null,
  model text not null,
  reasoning_effort text not null,
  routing_version text not null,
  evaluation_suite_version text not null,
  evaluated_configuration_sha256 text not null,
  evaluated_at timestamptz not null,
  expires_at timestamptz not null,
  changed_by text not null,
  change_reason text not null,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (environment, semantic_route, config_revision),
  foreign key (environment, semantic_route)
    references private.openai_routing_release_configs(environment, semantic_route)
    on delete restrict,
  check (semantic_route in ('fast', 'deep', 'research', 'review')),
  check (model ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  check (reasoning_effort in ('low', 'medium', 'high')),
  check (routing_version ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  check (evaluation_suite_version ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  check (evaluated_configuration_sha256 ~ '^[0-9a-f]{64}$'),
  check (expires_at > evaluated_at),
  check (expires_at <= evaluated_at + interval '180 days')
);

alter table private.openai_routing_release_configs enable row level security;
alter table private.openai_routing_release_configs force row level security;
alter table private.openai_routing_release_config_revisions enable row level security;
alter table private.openai_routing_release_config_revisions force row level security;
revoke all on private.openai_routing_release_configs
  from public, anon, authenticated, service_role;
revoke all on private.openai_routing_release_config_revisions
  from public, anon, authenticated, service_role;

create trigger openai_routing_release_revisions_immutable
  before update or delete on private.openai_routing_release_config_revisions
  for each row execute function private.reject_captured_audit_update();

create or replace function public.configure_openai_routing_release(
  p_environment text,
  p_semantic_route text,
  p_enabled boolean,
  p_model text,
  p_reasoning_effort text,
  p_routing_version text,
  p_evaluation_suite_version text,
  p_evaluated_configuration_sha256 text,
  p_evaluated_at timestamptz,
  p_expires_at timestamptz,
  p_expected_revision integer,
  p_changed_by text,
  p_change_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := pg_catalog.lower(pg_catalog.btrim(p_environment));
  v_route text := pg_catalog.lower(pg_catalog.btrim(p_semantic_route));
  v_model text := pg_catalog.lower(pg_catalog.btrim(p_model));
  v_reasoning text := pg_catalog.lower(pg_catalog.btrim(p_reasoning_effort));
  v_routing_version text := pg_catalog.lower(pg_catalog.btrim(p_routing_version));
  v_suite text := pg_catalog.lower(pg_catalog.btrim(p_evaluation_suite_version));
  v_existing private.openai_routing_release_configs%rowtype;
  v_revision integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'OPENAI_ROUTING_CONFIG_FORBIDDEN' using errcode = '42501';
  end if;
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_route not in ('fast', 'deep', 'research', 'review')
    or p_enabled is null
    or v_model !~ '^[a-z0-9][a-z0-9._-]{1,99}$'
    or v_reasoning not in ('low', 'medium', 'high')
    or v_routing_version !~ '^[a-z0-9][a-z0-9._-]{1,99}$'
    or v_suite !~ '^[a-z0-9][a-z0-9._-]{1,99}$'
    or p_evaluated_configuration_sha256 !~ '^[0-9a-f]{64}$'
    or p_evaluated_at is null
    or p_evaluated_at > pg_catalog.clock_timestamp() + interval '5 minutes'
    or p_expires_at is null
    or p_expires_at <= pg_catalog.clock_timestamp()
    or p_expires_at > p_evaluated_at + interval '180 days'
    or p_expected_revision is null or p_expected_revision < 0
    or nullif(pg_catalog.btrim(p_changed_by), '') is null
    or nullif(pg_catalog.btrim(p_change_reason), '') is null then
    raise exception 'OPENAI_ROUTING_CONFIG_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openai-routing-config:' || v_environment || ':' || v_route,
      0
    )
  );
  select * into v_existing
  from private.openai_routing_release_configs route_config
  where route_config.environment = v_environment
    and route_config.semantic_route = v_route
  for update;

  if found then
    if p_expected_revision <> v_existing.config_revision then
      raise exception 'OPENAI_ROUTING_CONFIG_REVISION_CONFLICT:%',
        v_existing.config_revision using errcode = '40001';
    end if;
    v_revision := v_existing.config_revision + 1;
    update private.openai_routing_release_configs
    set config_revision = v_revision,
        enabled = p_enabled,
        model = v_model,
        reasoning_effort = v_reasoning,
        routing_version = v_routing_version,
        evaluation_suite_version = v_suite,
        evaluated_configuration_sha256 = p_evaluated_configuration_sha256,
        evaluated_at = p_evaluated_at,
        expires_at = p_expires_at,
        changed_by = pg_catalog.btrim(p_changed_by),
        change_reason = pg_catalog.btrim(p_change_reason),
        updated_at = pg_catalog.clock_timestamp()
    where environment = v_environment and semantic_route = v_route;
  else
    if p_expected_revision <> 0 then
      raise exception 'OPENAI_ROUTING_CONFIG_REVISION_CONFLICT:0'
        using errcode = '40001';
    end if;
    v_revision := 1;
    insert into private.openai_routing_release_configs(
      environment, semantic_route, config_revision, enabled, model,
      reasoning_effort, routing_version, evaluation_suite_version,
      evaluated_configuration_sha256, evaluated_at, expires_at,
      changed_by, change_reason
    ) values (
      v_environment, v_route, v_revision, p_enabled, v_model,
      v_reasoning, v_routing_version, v_suite,
      p_evaluated_configuration_sha256, p_evaluated_at, p_expires_at,
      pg_catalog.btrim(p_changed_by), pg_catalog.btrim(p_change_reason)
    );
  end if;

  insert into private.openai_routing_release_config_revisions(
    environment, semantic_route, config_revision, enabled, model,
    reasoning_effort, routing_version, evaluation_suite_version,
    evaluated_configuration_sha256, evaluated_at, expires_at,
    changed_by, change_reason
  ) values (
    v_environment, v_route, v_revision, p_enabled, v_model,
    v_reasoning, v_routing_version, v_suite,
    p_evaluated_configuration_sha256, p_evaluated_at, p_expires_at,
    pg_catalog.btrim(p_changed_by), pg_catalog.btrim(p_change_reason)
  );

  return pg_catalog.jsonb_build_object(
    'contract_version', 'openai-routing-config.1',
    'environment', v_environment,
    'semantic_route', v_route,
    'config_revision', v_revision,
    'enabled', p_enabled,
    'model', v_model,
    'reasoning_effort', v_reasoning,
    'routing_version', v_routing_version,
    'evaluation_suite_version', v_suite,
    'evaluated_configuration_sha256', p_evaluated_configuration_sha256,
    'evaluated_at', p_evaluated_at,
    'expires_at', p_expires_at
  );
end;
$function$;

revoke all on function public.configure_openai_routing_release(
  text, text, boolean, text, text, text, text, text,
  timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;
grant execute on function public.configure_openai_routing_release(
  text, text, boolean, text, text, text, text, text,
  timestamptz, timestamptz, integer, text, text
) to service_role;

create or replace function public.attest_openai_routing_configuration(
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
  v_count integer;
  v_distinct integer;
  v_invalid text;
  v_routes jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'OPENAI_ROUTING_ATTESTATION_FORBIDDEN' using errcode = '42501';
  end if;
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'OPENAI_ROUTING_ATTESTATION_ENVIRONMENT_INVALID' using errcode = '22023';
  end if;
  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct requested.semantic_route)::integer,
         pg_catalog.min(requested.semantic_route) filter (
           where requested.semantic_route is null
             or requested.semantic_route not in ('fast', 'deep', 'research', 'review')
         )
  into v_count, v_distinct, v_invalid
  from pg_catalog.unnest(p_semantic_routes) requested(semantic_route);
  if v_count < 1 or v_count > 4 or v_distinct <> v_count or v_invalid is not null then
    raise exception 'OPENAI_ROUTING_ATTESTATION_ROUTES_INVALID' using errcode = '22023';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'semantic_route', requested.semantic_route,
      'configured', route_config.semantic_route is not null,
      'config_revision', route_config.config_revision,
      'enabled', route_config.enabled,
      'model', route_config.model,
      'reasoning_effort', route_config.reasoning_effort,
      'routing_version', route_config.routing_version,
      'evaluation_suite_version', route_config.evaluation_suite_version,
      'evaluated_configuration_sha256', route_config.evaluated_configuration_sha256,
      'evaluated_at', route_config.evaluated_at,
      'expires_at', route_config.expires_at
    ) order by requested.semantic_route
  ) into v_routes
  from pg_catalog.unnest(p_semantic_routes) requested(semantic_route)
  left join private.openai_routing_release_configs route_config
    on route_config.environment = v_environment
   and route_config.semantic_route = requested.semantic_route;

  return pg_catalog.jsonb_build_object(
    'contract_version', 'openai-routing-attestation.1',
    'environment', v_environment,
    'routes', v_routes
  );
end;
$function$;

revoke all on function public.attest_openai_routing_configuration(text, text[])
  from public, anon, authenticated;
grant execute on function public.attest_openai_routing_configuration(text, text[])
  to service_role;

commit;
