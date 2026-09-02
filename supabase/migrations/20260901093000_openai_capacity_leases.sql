-- Durable shared capacity admission for the sole active OpenAI adapter.
-- No hosted capacity is guessed or enabled here. Operators must configure an
-- exact environment/semantic-route budget from funded RPM/TPM and measured
-- token demand before provider dispatch can be admitted.

begin;

create table private.openai_capacity_route_configs (
  environment text not null
    check (environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  semantic_route text not null
    check (semantic_route in ('fast', 'deep', 'research', 'review')),
  config_revision integer not null check (config_revision > 0),
  enabled boolean not null,
  global_active_limit integer not null check (global_active_limit between 1 and 10000),
  per_user_active_limit integer not null check (per_user_active_limit between 1 and 1000),
  global_request_limit_per_minute integer not null
    check (global_request_limit_per_minute between 1 and 1000000),
  global_token_limit_per_minute integer not null
    check (global_token_limit_per_minute between 1 and 100000000),
  lease_seconds integer not null check (lease_seconds between 120 and 1800),
  retry_after_seconds integer not null check (retry_after_seconds between 1 and 300),
  changed_by text not null check (nullif(btrim(changed_by), '') is not null),
  change_reason text not null check (nullif(btrim(change_reason), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, semantic_route),
  check (per_user_active_limit <= global_active_limit)
);

comment on table private.openai_capacity_route_configs is
  'Operator-supplied exclusive route allocations. Routes sharing one OpenAI project/model quota, including deep and review, must partition rather than duplicate the measured upstream RPM/TPM budget.';

create table private.openai_capacity_route_config_revisions (
  environment text not null,
  semantic_route text not null,
  config_revision integer not null check (config_revision > 0),
  enabled boolean not null,
  global_active_limit integer not null,
  per_user_active_limit integer not null,
  global_request_limit_per_minute integer not null,
  global_token_limit_per_minute integer not null,
  lease_seconds integer not null,
  retry_after_seconds integer not null,
  changed_by text not null check (nullif(btrim(changed_by), '') is not null),
  change_reason text not null check (nullif(btrim(change_reason), '') is not null),
  changed_at timestamptz not null default now(),
  primary key (environment, semantic_route, config_revision),
  foreign key (environment, semantic_route)
    references private.openai_capacity_route_configs(environment, semantic_route)
    on delete restrict,
  check (semantic_route in ('fast', 'deep', 'research', 'review')),
  check (global_active_limit between 1 and 10000),
  check (per_user_active_limit between 1 and 1000),
  check (per_user_active_limit <= global_active_limit),
  check (global_request_limit_per_minute between 1 and 1000000),
  check (global_token_limit_per_minute between 1 and 100000000),
  check (lease_seconds between 120 and 1800),
  check (retry_after_seconds between 1 and 300)
);

create table private.openai_capacity_leases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null
    check (environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  semantic_route text not null
    check (semantic_route in ('fast', 'deep', 'research', 'review')),
  resource_sha256 text not null check (resource_sha256 ~ '^[0-9a-f]{64}$'),
  estimated_tokens integer not null check (estimated_tokens between 1 and 2000000),
  config_revision integer not null check (config_revision > 0),
  lease_token uuid not null,
  acquired_at timestamptz not null,
  dispatched_at timestamptz,
  expires_at timestamptz not null,
  released_at timestamptz,
  terminal_outcome text check (
    terminal_outcome is null or terminal_outcome in (
      'completed', 'reconciliation_required', 'cancelled'
    )
  ),
  unique (lease_token),
  check (expires_at > acquired_at),
  check (dispatched_at is null or dispatched_at >= acquired_at),
  check (
    (released_at is null and terminal_outcome is null)
    or
    (released_at is null and terminal_outcome = 'reconciliation_required')
    or
    (released_at is not null and terminal_outcome in ('completed', 'cancelled'))
  )
);

create index openai_capacity_leases_global_active_idx
  on private.openai_capacity_leases(environment, semantic_route, expires_at)
  include (estimated_tokens)
  where released_at is null;
create index openai_capacity_leases_user_active_idx
  on private.openai_capacity_leases(
    user_id, environment, semantic_route, expires_at
  ) where released_at is null;
create index openai_capacity_leases_resource_active_idx
  on private.openai_capacity_leases(
    user_id, environment, semantic_route, resource_sha256, expires_at
  ) where released_at is null;
create index openai_capacity_leases_rate_window_idx
  on private.openai_capacity_leases(
    environment, semantic_route, dispatched_at
  ) include (estimated_tokens) where dispatched_at is not null;
create index openai_capacity_leases_terminal_idx
  on private.openai_capacity_leases(released_at, acquired_at)
  where released_at is not null;

alter table private.openai_capacity_route_configs enable row level security;
alter table private.openai_capacity_route_configs force row level security;
alter table private.openai_capacity_route_config_revisions enable row level security;
alter table private.openai_capacity_route_config_revisions force row level security;
alter table private.openai_capacity_leases enable row level security;
alter table private.openai_capacity_leases force row level security;

revoke all on private.openai_capacity_route_configs
  from public, anon, authenticated, service_role;
revoke all on private.openai_capacity_route_config_revisions
  from public, anon, authenticated, service_role;
revoke all on private.openai_capacity_leases
  from public, anon, authenticated, service_role;

create trigger openai_capacity_route_config_revisions_immutable
  before update or delete on private.openai_capacity_route_config_revisions
  for each row execute function private.reject_captured_audit_update();

create or replace function private.require_captured_openai_capacity_routes(
  p_environment text
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_missing_route text;
begin
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE:environment';
  end if;
  select required_route.semantic_route into v_missing_route
  from (values ('deep'), ('review')) required_route(semantic_route)
  where not exists (
    select 1
    from private.openai_capacity_route_configs route_config
    where route_config.environment = v_environment
      and route_config.semantic_route = required_route.semantic_route
      and route_config.enabled
  )
  order by required_route.semantic_route
  limit 1;
  if found then
    raise exception 'CAPTURED_OPENAI_CAPACITY_CONFIGURATION_UNAVAILABLE:%',
      v_missing_route;
  end if;
end;
$function$;

revoke all on function private.require_captured_openai_capacity_routes(text)
  from public, anon, authenticated, service_role;

create or replace function private.gate_captured_rollout_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.enabled then
    perform private.require_captured_openai_capacity_routes(new.environment);
  end if;
  return new;
end;
$function$;

create trigger captured_rollout_assignment_capacity_gate
  before insert or update of enabled, environment
  on private.captured_document_rollout_assignments
  for each row execute function private.gate_captured_rollout_capacity();

create or replace function private.gate_captured_operation_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Raw historical replay remains available through the bounded compatibility
  -- adapter. New application acceptance always carries an explicit rollout
  -- assignment and therefore must have measured deep/review capacity first.
  if new.rollout_assignment_id is not null then
    perform private.require_captured_openai_capacity_routes(new.environment);
  end if;
  return new;
end;
$function$;

create trigger zz_captured_document_operation_capacity_gate
  before insert on private.captured_document_operations
  for each row execute function private.gate_captured_operation_capacity();

create or replace function public.configure_openai_capacity_route(
  p_environment text,
  p_semantic_route text,
  p_enabled boolean,
  p_global_active_limit integer,
  p_per_user_active_limit integer,
  p_global_request_limit_per_minute integer,
  p_global_token_limit_per_minute integer,
  p_lease_seconds integer,
  p_retry_after_seconds integer,
  p_expected_revision integer,
  p_changed_by text,
  p_change_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_route text := lower(btrim(p_semantic_route));
  v_existing private.openai_capacity_route_configs%rowtype;
  v_revision integer;
begin
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_route not in ('fast', 'deep', 'research', 'review')
    or p_enabled is null
    or p_global_active_limit is null
    or p_global_active_limit not between 1 and 10000
    or p_per_user_active_limit is null
    or p_per_user_active_limit not between 1 and p_global_active_limit
    or p_global_request_limit_per_minute is null
    or p_global_request_limit_per_minute not between 1 and 1000000
    or p_global_token_limit_per_minute is null
    or p_global_token_limit_per_minute not between 1 and 100000000
    or p_lease_seconds is null
    or p_lease_seconds not between 120 and 1800
    or p_retry_after_seconds is null
    or p_retry_after_seconds not between 1 and 300
    or p_expected_revision is null or p_expected_revision < 0
    or nullif(btrim(p_changed_by), '') is null
    or nullif(btrim(p_change_reason), '') is null then
    raise exception 'OPENAI_CAPACITY_CONFIG_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openai-capacity-config:' || v_environment || ':' || v_route,
      0
    )
  );
  select * into v_existing
  from private.openai_capacity_route_configs
  where environment = v_environment and semantic_route = v_route
  for update;

  if found then
    if p_expected_revision <> v_existing.config_revision then
      raise exception 'OPENAI_CAPACITY_CONFIG_REVISION_CONFLICT:%',
        v_existing.config_revision;
    end if;
    v_revision := v_existing.config_revision + 1;
    update private.openai_capacity_route_configs
    set config_revision = v_revision,
        enabled = p_enabled,
        global_active_limit = p_global_active_limit,
        per_user_active_limit = p_per_user_active_limit,
        global_request_limit_per_minute = p_global_request_limit_per_minute,
        global_token_limit_per_minute = p_global_token_limit_per_minute,
        lease_seconds = p_lease_seconds,
        retry_after_seconds = p_retry_after_seconds,
        changed_by = btrim(p_changed_by),
        change_reason = btrim(p_change_reason),
        updated_at = clock_timestamp()
    where environment = v_environment and semantic_route = v_route;
  else
    if p_expected_revision <> 0 then
      raise exception 'OPENAI_CAPACITY_CONFIG_REVISION_CONFLICT:0';
    end if;
    v_revision := 1;
    insert into private.openai_capacity_route_configs(
      environment, semantic_route, config_revision, enabled,
      global_active_limit, per_user_active_limit,
      global_request_limit_per_minute, global_token_limit_per_minute,
      lease_seconds, retry_after_seconds,
      changed_by, change_reason
    ) values (
      v_environment, v_route, v_revision, p_enabled,
      p_global_active_limit, p_per_user_active_limit,
      p_global_request_limit_per_minute, p_global_token_limit_per_minute,
      p_lease_seconds, p_retry_after_seconds,
      btrim(p_changed_by), btrim(p_change_reason)
    );
  end if;

  insert into private.openai_capacity_route_config_revisions(
    environment, semantic_route, config_revision, enabled,
    global_active_limit, per_user_active_limit,
    global_request_limit_per_minute, global_token_limit_per_minute,
    lease_seconds, retry_after_seconds,
    changed_by, change_reason
  ) values (
    v_environment, v_route, v_revision, p_enabled,
    p_global_active_limit, p_per_user_active_limit,
    p_global_request_limit_per_minute, p_global_token_limit_per_minute,
    p_lease_seconds, p_retry_after_seconds,
    btrim(p_changed_by), btrim(p_change_reason)
  );

  return jsonb_build_object(
    'contract_version', 'openai-capacity-config.v1',
    'environment', v_environment,
    'semantic_route', v_route,
    'config_revision', v_revision,
    'enabled', p_enabled,
    'global_active_limit', p_global_active_limit,
    'per_user_active_limit', p_per_user_active_limit,
    'global_request_limit_per_minute', p_global_request_limit_per_minute,
    'global_token_limit_per_minute', p_global_token_limit_per_minute,
    'lease_seconds', p_lease_seconds,
    'retry_after_seconds', p_retry_after_seconds
  );
end;
$function$;

revoke all on function public.configure_openai_capacity_route(
  text, text, boolean, integer, integer, integer, integer, integer, integer,
  integer, text, text
) from public, anon, authenticated;
grant execute on function public.configure_openai_capacity_route(
  text, text, boolean, integer, integer, integer, integer, integer, integer,
  integer, text, text
) to service_role;

create or replace function public.claim_openai_capacity_lease(
  p_user_id uuid,
  p_environment text,
  p_semantic_route text,
  p_resource_sha256 text,
  p_estimated_tokens integer,
  p_lease_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_route text := lower(btrim(p_semantic_route));
  v_config private.openai_capacity_route_configs%rowtype;
  v_existing private.openai_capacity_leases%rowtype;
  v_resource_lease private.openai_capacity_leases%rowtype;
  v_lease private.openai_capacity_leases%rowtype;
  v_now timestamptz;
  v_global_active integer;
  v_user_active integer;
  v_rate_window_requests integer;
  v_rate_window_tokens bigint;
  v_global_active_retry_at timestamptz;
  v_user_active_retry_at timestamptz;
  v_request_retry_at timestamptz;
  v_token_retry_at timestamptz;
  v_retry_at timestamptz;
  v_retry_seconds integer;
  v_denial text;
begin
  if p_user_id is null
    or not exists (select 1 from auth.users where id = p_user_id)
    or v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_route not in ('fast', 'deep', 'research', 'review')
    or p_resource_sha256 is null
    or p_resource_sha256 !~ '^[0-9a-f]{64}$'
    or p_estimated_tokens is null
    or p_estimated_tokens not between 1 and 2000000
    or p_lease_token is null then
    raise exception 'OPENAI_CAPACITY_CLAIM_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openai-capacity-route:' || v_environment || ':' || v_route,
      0
    )
  );
  select * into v_config
  from private.openai_capacity_route_configs
  where environment = v_environment and semantic_route = v_route
  for update;
  if not found then
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'capacity_admitted', false,
      'outcome', 'configuration_unavailable',
      'denial_reason', 'configuration_unavailable',
      'retryable', false,
      'environment', v_environment,
      'semantic_route', v_route
    );
  end if;
  if not v_config.enabled then
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'capacity_admitted', false,
      'outcome', 'route_disabled',
      'denial_reason', 'route_disabled',
      'retryable', false,
      'environment', v_environment,
      'semantic_route', v_route,
      'config_revision', v_config.config_revision
    );
  end if;
  if p_estimated_tokens > v_config.global_token_limit_per_minute then
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'capacity_admitted', false,
      'outcome', 'capacity_request_too_large',
      'denial_reason', 'estimated_tokens_exceed_route_limit',
      'retryable', false,
      'environment', v_environment,
      'semantic_route', v_route,
      'estimated_tokens', p_estimated_tokens,
      'route_token_limit_per_minute',
        v_config.global_token_limit_per_minute,
      'config_revision', v_config.config_revision
    );
  end if;

  -- Refresh the wall clock only after every contended lock. A caller queued
  -- behind another admission must never receive a lease that was already
  -- expired by the time its transaction entered the critical section.
  v_now := clock_timestamp();

  select * into v_existing
  from private.openai_capacity_leases
  where lease_token = p_lease_token
  for update;
  if found then
    if v_existing.user_id <> p_user_id
      or v_existing.environment <> v_environment
      or v_existing.semantic_route <> v_route
      or v_existing.resource_sha256 <> p_resource_sha256
      or v_existing.estimated_tokens <> p_estimated_tokens then
      raise exception 'OPENAI_CAPACITY_LEASE_TOKEN_REUSED';
    end if;
    if v_existing.released_at is null
      and v_existing.terminal_outcome is null
      and v_existing.expires_at > v_now then
      return jsonb_build_object(
        'contract_version', 'openai-capacity-lease.v1',
        'capacity_admitted', true,
        'outcome', 'idempotent_replay',
        'capacity_lease_id', v_existing.id,
        'lease_token', v_existing.lease_token,
        'environment', v_existing.environment,
        'semantic_route', v_existing.semantic_route,
        'estimated_tokens', v_existing.estimated_tokens,
        'config_revision', v_existing.config_revision,
        'expires_at', v_existing.expires_at,
        'retry_after_seconds', v_config.retry_after_seconds
      );
    end if;
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'capacity_admitted', false,
      'outcome', 'reconciliation_required',
      'denial_reason', case
        when v_existing.terminal_outcome is not null
          then 'lease_already_terminal'
        else 'lease_expired'
      end,
      'retryable', false,
      'environment', v_environment,
      'semantic_route', v_route
    );
  end if;

  select * into v_resource_lease
  from private.openai_capacity_leases
  where user_id = p_user_id
    and environment = v_environment
    and semantic_route = v_route
    and resource_sha256 = p_resource_sha256
    and released_at is null
    and expires_at > v_now
  order by acquired_at desc, id desc
  limit 1
  for update;
  if found then
    v_retry_seconds := least(
      1800,
      greatest(
        1,
        ceil(extract(epoch from (v_resource_lease.expires_at - v_now)))::integer
      )
    );
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'capacity_admitted', false,
      'outcome', 'awaiting_capacity',
      'denial_reason', 'logical_attempt_already_leased',
      'retryable', true,
      'retry_after_seconds', v_retry_seconds,
      'environment', v_environment,
      'semantic_route', v_route,
      'config_revision', v_config.config_revision
    );
  end if;

  select count(*)::integer, min(expires_at)
  into v_global_active, v_global_active_retry_at
  from private.openai_capacity_leases
  where environment = v_environment
    and semantic_route = v_route
    and released_at is null
    and expires_at > v_now;
  select count(*)::integer, min(expires_at)
  into v_user_active, v_user_active_retry_at
  from private.openai_capacity_leases
  where user_id = p_user_id
    and environment = v_environment
    and semantic_route = v_route
    and released_at is null
    and expires_at > v_now;

  -- A claimed-but-not-yet-dispatched lease reserves one request and its
  -- conservative token estimate. Once dispatch is durably acknowledged, the
  -- reservation remains in the rolling provider minute even after its
  -- concurrency slot is released.
  select count(*)::integer, coalesce(sum(estimated_tokens), 0),
    min(case
      when dispatched_at is not null then dispatched_at + interval '60 seconds'
      else expires_at
    end)
  into v_rate_window_requests, v_rate_window_tokens, v_request_retry_at
  from private.openai_capacity_leases
  where environment = v_environment
    and semantic_route = v_route
    and (
      dispatched_at > v_now - interval '60 seconds'
      or (
        dispatched_at is null
        and released_at is null
        and expires_at > v_now
      )
    );

  select min(rate_releases_at) into v_token_retry_at
  from (
    select rate_releases_at,
      sum(estimated_tokens) over (
        order by rate_releases_at, id
        rows between unbounded preceding and current row
      ) as released_tokens
    from (
      select id, estimated_tokens,
        case
          when dispatched_at is not null
            then dispatched_at + interval '60 seconds'
          else expires_at
        end as rate_releases_at
      from private.openai_capacity_leases
      where environment = v_environment
        and semantic_route = v_route
        and (
          dispatched_at > v_now - interval '60 seconds'
          or (
            dispatched_at is null
            and released_at is null
            and expires_at > v_now
          )
        )
    ) reservations
  ) release_schedule
  where v_rate_window_tokens - released_tokens + p_estimated_tokens <=
    v_config.global_token_limit_per_minute;

  v_denial := case
    when v_user_active >= v_config.per_user_active_limit
      then 'per_user_active_limit'
    when v_global_active >= v_config.global_active_limit
      then 'global_active_limit'
    when v_rate_window_requests >= v_config.global_request_limit_per_minute
      then 'global_request_limit_per_minute'
    when v_rate_window_tokens + p_estimated_tokens >
      v_config.global_token_limit_per_minute
      then 'global_token_limit_per_minute'
    else null
  end;
  if v_denial is not null then
    v_retry_at := case v_denial
      when 'per_user_active_limit' then v_user_active_retry_at
      when 'global_active_limit' then v_global_active_retry_at
      when 'global_request_limit_per_minute' then v_request_retry_at
      when 'global_token_limit_per_minute' then v_token_retry_at
      else null
    end;
    v_retry_seconds := least(
      1800,
      greatest(
        1,
        coalesce(
          ceil(extract(epoch from (v_retry_at - v_now)))::integer,
          v_config.retry_after_seconds
        )
      )
    );
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'capacity_admitted', false,
      'outcome', 'awaiting_capacity',
      'denial_reason', v_denial,
      'retryable', true,
      'retry_after_seconds', v_retry_seconds,
      'environment', v_environment,
      'semantic_route', v_route,
      'global_active', v_global_active,
      'per_user_active', v_user_active,
      'requests_in_rate_window', v_rate_window_requests,
      'reserved_tokens_in_rate_window', v_rate_window_tokens,
      'config_revision', v_config.config_revision
    );
  end if;

  insert into private.openai_capacity_leases(
    user_id, environment, semantic_route, resource_sha256,
    estimated_tokens, config_revision, lease_token,
    acquired_at, expires_at
  ) values (
    p_user_id, v_environment, v_route, p_resource_sha256,
    p_estimated_tokens, v_config.config_revision, p_lease_token,
    v_now,
    v_now + pg_catalog.make_interval(secs => v_config.lease_seconds)
  ) returning * into v_lease;

  return jsonb_build_object(
    'contract_version', 'openai-capacity-lease.v1',
    'capacity_admitted', true,
    'outcome', 'admitted',
    'capacity_lease_id', v_lease.id,
    'lease_token', v_lease.lease_token,
    'environment', v_lease.environment,
    'semantic_route', v_lease.semantic_route,
    'estimated_tokens', v_lease.estimated_tokens,
    'config_revision', v_lease.config_revision,
    'expires_at', v_lease.expires_at,
    'retry_after_seconds', v_config.retry_after_seconds
  );
end;
$function$;

revoke all on function public.claim_openai_capacity_lease(
  uuid, text, text, text, integer, uuid
) from public, anon, authenticated;
grant execute on function public.claim_openai_capacity_lease(
  uuid, text, text, text, integer, uuid
) to service_role;

create or replace function public.mark_openai_capacity_lease_dispatched(
  p_user_id uuid,
  p_capacity_lease_id uuid,
  p_lease_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lease private.openai_capacity_leases%rowtype;
  v_now timestamptz;
begin
  if p_user_id is null or p_capacity_lease_id is null or p_lease_token is null
  then
    raise exception 'OPENAI_CAPACITY_DISPATCH_INVALID';
  end if;
  select * into v_lease
  from private.openai_capacity_leases
  where id = p_capacity_lease_id and user_id = p_user_id
  for update;
  if not found then raise exception 'OPENAI_CAPACITY_LEASE_NOT_FOUND'; end if;
  v_now := clock_timestamp();
  if v_lease.lease_token <> p_lease_token then
    raise exception 'OPENAI_CAPACITY_LEASE_TOKEN_MISMATCH';
  end if;
  if v_lease.terminal_outcome is not null or v_lease.released_at is not null then
    raise exception 'OPENAI_CAPACITY_LEASE_ALREADY_TERMINAL';
  end if;
  if v_lease.expires_at <= v_now then
    raise exception 'OPENAI_CAPACITY_LEASE_EXPIRED';
  end if;
  if v_lease.dispatched_at is not null then
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'outcome', 'idempotent_replay',
      'capacity_lease_id', v_lease.id,
      'dispatched_at', v_lease.dispatched_at,
      'expires_at', v_lease.expires_at
    );
  end if;

  update private.openai_capacity_leases
  set dispatched_at = v_now
  where id = v_lease.id
  returning * into v_lease;
  return jsonb_build_object(
    'contract_version', 'openai-capacity-lease.v1',
    'outcome', 'dispatched',
    'capacity_lease_id', v_lease.id,
    'dispatched_at', v_lease.dispatched_at,
    'expires_at', v_lease.expires_at
  );
end;
$function$;

revoke all on function public.mark_openai_capacity_lease_dispatched(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.mark_openai_capacity_lease_dispatched(
  uuid, uuid, uuid
) to service_role;

create or replace function public.release_openai_capacity_lease(
  p_user_id uuid,
  p_capacity_lease_id uuid,
  p_lease_token uuid,
  p_terminal_outcome text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_outcome text := lower(btrim(p_terminal_outcome));
  v_lease private.openai_capacity_leases%rowtype;
  v_now timestamptz;
begin
  if p_user_id is null or p_capacity_lease_id is null or p_lease_token is null
    or v_outcome not in ('completed', 'reconciliation_required', 'cancelled') then
    raise exception 'OPENAI_CAPACITY_RELEASE_INVALID';
  end if;
  select * into v_lease
  from private.openai_capacity_leases
  where id = p_capacity_lease_id and user_id = p_user_id
  for update;
  if not found then raise exception 'OPENAI_CAPACITY_LEASE_NOT_FOUND'; end if;
  v_now := clock_timestamp();
  if v_lease.lease_token <> p_lease_token then
    raise exception 'OPENAI_CAPACITY_LEASE_TOKEN_MISMATCH';
  end if;
  if v_lease.terminal_outcome is not null then
    if v_lease.terminal_outcome <> v_outcome then
      raise exception 'OPENAI_CAPACITY_RELEASE_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'contract_version', 'openai-capacity-lease.v1',
      'outcome', 'idempotent_replay',
      'capacity_lease_id', v_lease.id,
      'released_at', v_lease.released_at,
      'terminal_outcome', v_lease.terminal_outcome,
      'capacity_released', v_lease.released_at is not null,
      'active_until', case
        when v_lease.released_at is null then v_lease.expires_at
        else null
      end
    );
  end if;

  update private.openai_capacity_leases
  set released_at = case
        when v_outcome = 'reconciliation_required' then null
        else v_now
      end,
      terminal_outcome = v_outcome
  where id = v_lease.id
  returning * into v_lease;
  return jsonb_build_object(
    'contract_version', 'openai-capacity-lease.v1',
    'outcome', 'released',
    'capacity_lease_id', v_lease.id,
    'released_at', v_lease.released_at,
    'terminal_outcome', v_lease.terminal_outcome,
    'capacity_released', v_lease.released_at is not null,
    'active_until', case
      when v_lease.released_at is null then v_lease.expires_at
      else null
    end
  );
end;
$function$;

revoke all on function public.release_openai_capacity_lease(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.release_openai_capacity_lease(
  uuid, uuid, uuid, text
) to service_role;

alter table private.captured_document_operations
  add column capacity_wait_started_at timestamptz,
  add column capacity_retry_after_at timestamptz,
  add column capacity_semantic_route text;

-- The dormant predecessor exposed awaiting_capacity before it had durable
-- timing metadata. Preserve any such accepted operation as resumable failure
-- instead of inventing a route or retry deadline during migration.
do $migration$
declare
  v_operation private.captured_document_operations%rowtype;
begin
  for v_operation in
    update private.captured_document_operations
    set status = 'retryable_failure',
        operation_revision = operation_revision + 1,
        retryable = true,
        error_code = 'CAPACITY_STATE_UPGRADE_REQUIRED',
        public_error_message =
          'TED needs to resume this operation under the durable capacity contract.',
        safe_next_action =
          'Resume this same operation; do not start a duplicate document.',
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where status = 'awaiting_capacity'
    returning *
  loop
    perform private.append_captured_document_event(
      v_operation.id,
      v_operation.user_id,
      v_operation.operation_revision,
      v_operation.status,
      'capacity_state_upgraded',
      jsonb_build_object('error_code', v_operation.error_code)
    );
  end loop;
end;
$migration$;

alter table private.captured_document_operations
  add constraint captured_document_operation_capacity_state_check
  check (
    (status <> 'awaiting_capacity'
      and capacity_wait_started_at is null
      and capacity_retry_after_at is null
      and capacity_semantic_route is null)
    or
    (status = 'awaiting_capacity'
      and capacity_wait_started_at is not null
      and capacity_retry_after_at is not null
      and capacity_retry_after_at >= capacity_wait_started_at
      and capacity_semantic_route in ('deep', 'review')
      and lease_token is null
      and lease_owner is null
      and lease_expires_at is null)
  );

create or replace function private.clear_terminal_capacity_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'awaiting_capacity'
    and new.status in ('terminal_failure', 'cancelled') then
    new.capacity_wait_started_at := null;
    new.capacity_retry_after_at := null;
    new.capacity_semantic_route := null;
  end if;
  return new;
end;
$function$;

create trigger captured_operation_terminal_capacity_cleanup
  before update on private.captured_document_operations
  for each row execute function private.clear_terminal_capacity_metadata();

create or replace function private.captured_operation_transition_allowed(
  p_from text,
  p_to text
) returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case p_from
    when 'accepted' then p_to in (
      'awaiting_clarification', 'generating',
      'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'awaiting_clarification' then p_to in (
      'accepted', 'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'awaiting_capacity' then false
    when 'generating' then p_to in (
      'validating', 'retryable_failure',
      'terminal_failure', 'cancelled'
    )
    when 'validating' then p_to in (
      'persisting', 'retryable_failure',
      'terminal_failure', 'cancelled'
    )
    when 'persisting' then p_to in (
      'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'retryable_failure' then p_to in (
      'accepted', 'generating',
      'terminal_failure', 'cancelled'
    )
    else false
  end
$function$;

create or replace function public.defer_captured_document_operation_for_capacity(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_operation_lease_token uuid,
  p_semantic_route text,
  p_retry_after_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_route text := lower(btrim(p_semantic_route));
  v_operation private.captured_document_operations%rowtype;
  v_now timestamptz;
begin
  if p_operation_id is null or p_expected_operation_revision is null
    or v_route not in ('deep', 'review')
    or p_retry_after_seconds is null
    or p_retry_after_seconds not between 1 and 1800 then
    raise exception 'CAPTURED_CAPACITY_WAIT_INVALID';
  end if;
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  v_now := clock_timestamp();
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if p_operation_lease_token is null
    or v_operation.lease_token is distinct from p_operation_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= v_now then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;
  if (v_route = 'deep' and v_operation.status <> 'generating')
    or (v_route = 'review' and v_operation.status <> 'validating') then
    raise exception 'CAPTURED_CAPACITY_WAIT_STATUS_INVALID:%:%',
      v_operation.status, v_route;
  end if;
  if v_operation.cancel_requested_at is not null then
    raise exception 'CAPTURED_CANCELLATION_REQUESTED';
  end if;
  if v_operation.expires_at <= v_now then
    raise exception 'CAPTURED_OPERATION_EXPIRED';
  end if;

  update private.captured_document_operations
  set status = 'awaiting_capacity',
      operation_revision = operation_revision + 1,
      retryable = true,
      error_code = null,
      public_error_message = 'TED is waiting for safe generation capacity.',
      safe_next_action = 'Resume this same operation after the retry time; do not start a duplicate document.',
      capacity_wait_started_at = case
        when capacity_semantic_route = v_route
          then coalesce(capacity_wait_started_at, v_now)
        else v_now
      end,
      capacity_retry_after_at = v_now +
        pg_catalog.make_interval(secs => p_retry_after_seconds),
      capacity_semantic_route = v_route,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = v_now
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id,
    v_operation.user_id,
    v_operation.operation_revision,
    v_operation.status,
    'capacity_wait_started',
    jsonb_build_object(
      'semantic_route', v_route,
      'retry_after_seconds', p_retry_after_seconds,
      'retry_after_at', v_operation.capacity_retry_after_at
    )
  );
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'retryable', true,
    'correlation_id', v_operation.correlation_id,
    'capacity_semantic_route', v_operation.capacity_semantic_route,
    'capacity_wait_started_at', v_operation.capacity_wait_started_at,
    'capacity_retry_after_at', v_operation.capacity_retry_after_at,
    'retry_after_seconds', p_retry_after_seconds,
    'message', v_operation.public_error_message,
    'safe_next_action', v_operation.safe_next_action
  );
end;
$function$;

revoke all on function public.defer_captured_document_operation_for_capacity(
  uuid, integer, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.defer_captured_document_operation_for_capacity(
  uuid, integer, uuid, text, integer
) to service_role;

create or replace function public.resume_captured_document_operation_from_capacity(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_owner text,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_now timestamptz;
  v_token uuid;
  v_next_status text;
  v_retry_seconds integer;
begin
  if p_operation_id is null
    or p_expected_operation_revision is null
    or nullif(btrim(p_lease_owner), '') is null
    or char_length(p_lease_owner) > 160
    or p_lease_seconds not between 15 and 1800 then
    raise exception 'CAPTURED_CAPACITY_RESUME_INVALID';
  end if;
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  v_now := clock_timestamp();
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'awaiting_capacity'
    or v_operation.capacity_semantic_route not in ('deep', 'review')
    or v_operation.capacity_wait_started_at is null
    or v_operation.capacity_retry_after_at is null then
    raise exception 'CAPTURED_CAPACITY_RESUME_STATE_INVALID';
  end if;
  if v_operation.cancel_requested_at is not null then
    raise exception 'CAPTURED_CANCELLATION_REQUESTED';
  end if;
  if v_operation.expires_at <= v_now then
    raise exception 'CAPTURED_OPERATION_EXPIRED';
  end if;
  if v_operation.capacity_retry_after_at > v_now then
    v_retry_seconds := least(
      1800,
      greatest(
        1,
        ceil(extract(epoch from (
          v_operation.capacity_retry_after_at - v_now
        )))::integer
      )
    );
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'document_id', v_operation.document_id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'lease_token', null,
      'capacity_resume_deferred', true,
      'capacity_semantic_route', v_operation.capacity_semantic_route,
      'capacity_wait_started_at', v_operation.capacity_wait_started_at,
      'capacity_retry_after_at', v_operation.capacity_retry_after_at,
      'retry_after_seconds', v_retry_seconds,
      'resume_available', false,
      'retryable', true,
      'correlation_id', v_operation.correlation_id,
      'message', v_operation.public_error_message,
      'safe_next_action', v_operation.safe_next_action
    );
  end if;

  v_next_status := case v_operation.capacity_semantic_route
    when 'deep' then 'generating'
    when 'review' then 'validating'
  end;
  v_token := gen_random_uuid();
  update private.captured_document_operations
  set status = v_next_status,
      operation_revision = operation_revision + 1,
      retryable = false,
      error_code = null,
      public_error_message = null,
      safe_next_action = null,
      capacity_wait_started_at = null,
      capacity_retry_after_at = null,
      capacity_semantic_route = null,
      lease_token = v_token,
      lease_owner = btrim(p_lease_owner),
      lease_expires_at = v_now +
        pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = v_now
  where id = v_operation.id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id,
    v_operation.user_id,
    v_operation.operation_revision,
    v_operation.status,
    'capacity_wait_resumed',
    jsonb_build_object(
      'semantic_route', case
        when v_next_status = 'generating' then 'deep'
        else 'review'
      end,
      'lease_owner', v_operation.lease_owner,
      'lease_expires_at', v_operation.lease_expires_at
    )
  );
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'lease_token', v_operation.lease_token,
    'lease_expires_at', v_operation.lease_expires_at,
    'capacity_resume_deferred', false,
    'resumed_from_capacity_wait', true,
    'retryable', false,
    'correlation_id', v_operation.correlation_id,
    'renewed', false,
    'expired', false
  );
end;
$function$;

revoke all on function public.resume_captured_document_operation_from_capacity(
  uuid, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.resume_captured_document_operation_from_capacity(
  uuid, integer, text, integer
) to service_role;

create or replace function private.captured_document_operation_public_payload(
  p_operation private.captured_document_operations,
  p_document_revision integer
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'contract_version', p_operation.contract_version,
    'operation_id', p_operation.id,
    'document_id', p_operation.document_id,
    'document_revision', p_document_revision,
    'operation_revision', p_operation.operation_revision,
    'accepted_document_revision', p_operation.accepted_document_revision,
    'status', p_operation.status,
    'safe_section_keys', to_jsonb(p_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(p_operation.blocked_section_keys),
    'retryable', p_operation.retryable,
    'cancellation_requested', p_operation.cancel_requested_at is not null,
    'cancellation_code', p_operation.cancellation_code,
    'error_code', p_operation.error_code,
    'message', p_operation.public_error_message,
    'safe_next_action', p_operation.safe_next_action,
    'correlation_id', p_operation.correlation_id,
    'capacity_semantic_route', case
      when p_operation.status = 'awaiting_capacity'
        then p_operation.capacity_semantic_route
      else null
    end,
    'capacity_wait_started_at', case
      when p_operation.status = 'awaiting_capacity'
        then p_operation.capacity_wait_started_at
      else null
    end,
    'capacity_retry_after_at', case
      when p_operation.status = 'awaiting_capacity'
        then p_operation.capacity_retry_after_at
      else null
    end,
    'retry_after_seconds', case
      when p_operation.status = 'awaiting_capacity'
        and p_operation.capacity_retry_after_at is not null
      then greatest(
        0,
        ceil(extract(epoch from (
          p_operation.capacity_retry_after_at - clock_timestamp()
        )))::integer
      )
      else null
    end,
    'expires_at', p_operation.expires_at,
    'lease_expires_at', p_operation.lease_expires_at,
    'resume_available', case
      when p_operation.status = 'awaiting_capacity' then
        p_operation.capacity_retry_after_at is not null
          and p_operation.capacity_retry_after_at <= clock_timestamp()
      when p_operation.status in (
        'accepted', 'generating', 'validating', 'persisting',
        'retryable_failure'
      ) then
        p_operation.lease_token is null
          or p_operation.lease_expires_at is null
          or p_operation.lease_expires_at <= clock_timestamp()
      else false
    end,
    'updated_at', p_operation.updated_at
  )
$function$;

revoke all on function private.captured_document_operation_public_payload(
  private.captured_document_operations, integer
) from public, anon, authenticated, service_role;

create or replace function public.get_captured_document_operation(
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document_revision integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id and user_id = v_user_id;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  select current_revision into v_document_revision
  from public.documents
  where id = v_operation.document_id and user_id = v_user_id;
  return private.captured_document_operation_public_payload(
    v_operation, v_document_revision
  );
end;
$function$;

revoke all on function public.get_captured_document_operation(uuid)
  from public, anon;
grant execute on function public.get_captured_document_operation(uuid)
  to authenticated;

create or replace function public.get_latest_captured_document_operation(
  p_document_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document_revision integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_document_id is null then return null; end if;
  select operation_record.* into v_operation
  from private.captured_document_operations operation_record
  where operation_record.document_id = p_document_id
    and operation_record.user_id = v_user_id
  order by
    (operation_record.status not in (
      'ready_for_review', 'terminal_failure', 'cancelled'
    )) desc,
    operation_record.updated_at desc,
    operation_record.id desc
  limit 1;
  if not found then return null; end if;
  select current_revision into v_document_revision
  from public.documents
  where id = v_operation.document_id and user_id = v_user_id;
  return private.captured_document_operation_public_payload(
    v_operation, v_document_revision
  );
end;
$function$;

revoke all on function public.get_latest_captured_document_operation(uuid)
  from public, anon;
grant execute on function public.get_latest_captured_document_operation(uuid)
  to authenticated;

comment on table private.openai_capacity_route_configs is
  'Measured OpenAI capacity budgets. The migration intentionally creates no active environment configuration.';
comment on table private.openai_capacity_leases is
  'Crash-expiring shared capacity admission acquired before provider-attempt preparation and released after terminal attempt persistence.';
comment on function public.defer_captured_document_operation_for_capacity(
  uuid, integer, uuid, text, integer
) is
  'Persists reconnectable awaiting_capacity state and retry timing without preparing or dispatching provider work.';

commit;
