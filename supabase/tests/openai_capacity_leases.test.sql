begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
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

create or replace function pg_temp.wait_for_advisory_lock(
  p_backend_pid integer,
  p_timeout interval default interval '2 seconds'
) returns boolean
language plpgsql
as $function$
declare
  v_deadline timestamptz := clock_timestamp() + p_timeout;
  v_waiting boolean;
begin
  loop
    select exists(
      select 1
      from pg_catalog.pg_stat_activity
      where pid = p_backend_pid
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) into v_waiting;
    if v_waiting then return true; end if;
    if clock_timestamp() >= v_deadline then return false; end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;

create temp table capacity_test_state (
  first_user_id uuid not null,
  second_user_id uuid not null,
  third_user_id uuid not null,
  first_lease_id uuid,
  second_lease_id uuid,
  first_token uuid not null,
  second_token uuid not null,
  third_token uuid not null,
  fast_first_token uuid not null,
  fast_second_token uuid not null,
  research_first_token uuid not null,
  research_second_token uuid not null
);

insert into capacity_test_state values (
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000003',
  null,
  null,
  'b2000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000005',
  'b2000000-0000-4000-8000-000000000006',
  'b2000000-0000-4000-8000-000000000007'
);

select has_table(
  'private',
  'openai_capacity_route_configs',
  'private route-capacity configuration exists'
);
select has_table(
  'private',
  'openai_capacity_route_config_revisions',
  'capacity configuration history is append-only'
);
select has_table(
  'private',
  'openai_capacity_leases',
  'durable provider-capacity leases exist'
);
select has_function(
  'public',
  'configure_openai_capacity_route',
  array[
    'text','text','boolean','integer','integer','integer','integer','integer',
    'integer','integer','text','text'
  ],
  'service-only capacity configuration command exists'
);
select has_function(
  'public',
  'claim_openai_capacity_lease',
  array['uuid','text','text','text','integer','uuid'],
  'service-only capacity admission command exists'
);
select has_function(
  'public',
  'mark_openai_capacity_lease_dispatched',
  array['uuid','uuid','uuid'],
  'provider dispatch converts one reservation into rolling-window evidence'
);
select has_function(
  'public',
  'release_openai_capacity_lease',
  array['uuid','uuid','uuid','text'],
  'service-only exact capacity release exists'
);
select has_function(
  'public',
  'resume_captured_document_operation_from_capacity',
  array['uuid','integer','text','integer'],
  'capacity wait has one exact server-enforced resume command'
);
select has_function(
  'public',
  'defer_captured_document_operation_for_capacity',
  array['uuid','integer','uuid','text','integer'],
  'captured operations can persist durable capacity wait state'
);

select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_table_privilege(
    'authenticated', 'private.openai_capacity_leases', 'SELECT'
  )
  and not has_table_privilege(
    'service_role', 'private.openai_capacity_leases', 'SELECT'
  ),
  'capacity configuration and leases have no direct Data API access'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.claim_openai_capacity_lease(uuid,text,text,text,integer,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_openai_capacity_lease(uuid,text,text,text,integer,uuid)',
    'EXECUTE'
  ),
  'only protected compute can claim shared provider capacity'
);
select is(
  (select count(*)::integer from private.openai_capacity_route_configs),
  0,
  'the migration guesses no hosted OpenAI capacity values'
);
select ok(
  not private.captured_operation_transition_allowed(
    'awaiting_capacity', 'generating'
  )
  and not private.captured_operation_transition_allowed(
    'awaiting_capacity', 'validating'
  )
  and not private.captured_operation_transition_allowed(
    'generating', 'awaiting_capacity'
  ),
  'generic transitions cannot enter or leave the dedicated capacity state'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.defer_captured_document_operation_for_capacity(uuid,integer,uuid,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.defer_captured_document_operation_for_capacity(uuid,integer,uuid,text,integer)',
    'EXECUTE'
  ),
  'only protected compute can persist a captured capacity wait'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.mark_openai_capacity_lease_dispatched(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.mark_openai_capacity_lease_dispatched(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.resume_captured_document_operation_from_capacity(uuid,integer,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.resume_captured_document_operation_from_capacity(uuid,integer,text,integer)',
    'EXECUTE'
  ),
  'dispatch acknowledgement and exact capacity resume remain protected-compute only'
);
select is(
  (
    select provolatile::text
    from pg_proc
    where oid =
      'private.captured_document_operation_public_payload(private.captured_document_operations,integer)'::regprocedure
  ),
  'v',
  'time-sensitive operation payloads are volatile rather than cached as stable'
);
select ok(
  pg_get_functiondef(
    'private.captured_document_operation_public_payload(private.captured_document_operations,integer)'::regprocedure
  ) like '%capacity_retry_after_at%'
  and pg_get_functiondef(
    'private.captured_document_operation_public_payload(private.captured_document_operations,integer)'::regprocedure
  ) like '%resume_available%'
  and pg_get_functiondef(
    'private.captured_document_operation_public_payload(private.captured_document_operations,integer)'::regprocedure
  ) like '%cancel_requested_at%',
  'owner status preserves retry timing, recovery, and cancellation truth'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
select first_user_id, 'capacity-first@example.invalid', false, false, now(), now()
from capacity_test_state
union all
select second_user_id, 'capacity-second@example.invalid', false, false, now(), now()
from capacity_test_state
union all
select third_user_id, 'capacity-third@example.invalid', false, false, now(), now()
from capacity_test_state;

select is(
  (
    public.claim_openai_capacity_lease(
      first_user_id,
      'local',
      'deep',
      repeat('a', 64),
      600,
      first_token
    )->>'capacity_admitted'
  )::boolean,
  false,
  'missing measured configuration fails closed without creating a lease'
)
from capacity_test_state;
select is(
  (select count(*)::integer from private.openai_capacity_leases),
  0,
  'configuration denial creates no provider-dispatch authority'
);

select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'deep', true,
    2, 1, 10, 1000, 180, 5,
    0, 'pgtap', 'synthetic measured capacity fixture'
  )$$,
  'a measured route budget is configured through compare-and-swap'
);
select is(
  (
    select config_revision::text || ':' || global_active_limit::text || ':' ||
      per_user_active_limit::text || ':' ||
      global_request_limit_per_minute::text || ':' ||
      global_token_limit_per_minute::text
    from private.openai_capacity_route_configs
    where environment = 'local' and semantic_route = 'deep'
  ),
  '1:2:1:10:1000',
  'route limits are exact durable configuration, not process-local state'
);

select is(
  public.claim_openai_capacity_lease(
    first_user_id,
    'local',
    'deep',
    repeat('9', 64),
    1001,
    'b2000000-0000-4000-8000-000000000009'
  )->>'outcome',
  'capacity_request_too_large',
  'one request larger than the measured route ceiling is not queued forever'
)
from capacity_test_state;
select is(
  public.claim_openai_capacity_lease(
    first_user_id,
    'local',
    'deep',
    repeat('9', 64),
    1001,
    'b2000000-0000-4000-8000-000000000009'
  )->>'retryable',
  'false',
  'an impossible route-sized request requires operator/configuration action'
)
from capacity_test_state;
select is(
  (select count(*)::integer from private.openai_capacity_leases),
  0,
  'an impossible route-sized request creates no provider-dispatch authority'
);

select ok(
  (
    public.claim_openai_capacity_lease(
      first_user_id,
      'local',
      'deep',
      repeat('a', 64),
      600,
      first_token
    )->>'capacity_admitted'
  )::boolean,
  'the first owner receives one exact deep-route lease'
)
from capacity_test_state;

update capacity_test_state state_record
set first_lease_id = lease_record.id
from private.openai_capacity_leases lease_record
where lease_record.user_id = state_record.first_user_id
  and lease_record.resource_sha256 = repeat('a', 64);

select is(
  public.mark_openai_capacity_lease_dispatched(
    first_user_id, first_lease_id, first_token
  )->>'outcome',
  'dispatched',
  'the first exact lease is durably counted only at provider dispatch'
)
from capacity_test_state;
select is(
  public.mark_openai_capacity_lease_dispatched(
    first_user_id, first_lease_id, first_token
  )->>'outcome',
  'idempotent_replay',
  'lost dispatch acknowledgement replays without shifting the rolling window'
)
from capacity_test_state;

select is(
  public.claim_openai_capacity_lease(
    first_user_id,
    'local',
    'deep',
    repeat('a', 64),
    600,
    first_token
  )->>'outcome',
  'idempotent_replay',
  'lost claim acknowledgement replays the same lease and token'
)
from capacity_test_state;

select is(
  public.claim_openai_capacity_lease(
    first_user_id,
    'local',
    'deep',
    repeat('b', 64),
    100,
    third_token
  )->>'denial_reason',
  'per_user_active_limit',
  'one owner cannot consume another concurrent deep slot'
)
from capacity_test_state;

select is(
  public.claim_openai_capacity_lease(
    second_user_id,
    'local',
    'deep',
    repeat('c', 64),
    500,
    second_token
  )->>'denial_reason',
  'global_token_limit_per_minute',
  'rolling estimated-token admission fails before provider work'
)
from capacity_test_state;

select ok(
  (
    public.claim_openai_capacity_lease(
      second_user_id,
      'local',
      'deep',
      repeat('c', 64),
      400,
      second_token
    )->>'capacity_admitted'
  )::boolean,
  'a second owner can use the remaining measured token budget'
)
from capacity_test_state;

update capacity_test_state state_record
set second_lease_id = lease_record.id
from private.openai_capacity_leases lease_record
where lease_record.user_id = state_record.second_user_id
  and lease_record.resource_sha256 = repeat('c', 64);

select is(
  public.mark_openai_capacity_lease_dispatched(
    second_user_id, second_lease_id, second_token
  )->>'outcome',
  'dispatched',
  'the second exact lease joins the same rolling token window'
)
from capacity_test_state;

select is(
  public.claim_openai_capacity_lease(
    third_user_id,
    'local',
    'deep',
    repeat('d', 64),
    1,
    third_token
  )->>'denial_reason',
  'global_active_limit',
  'global active-request admission is shared across workers'
)
from capacity_test_state;

select ok(
  pg_temp.raises_matching(
    format(
      'select public.release_openai_capacity_lease(%L::uuid,%L::uuid,%L::uuid,%L)',
      first_user_id,
      first_lease_id,
      third_token,
      'completed'
    ),
    '%OPENAI_CAPACITY_LEASE_TOKEN_MISMATCH%'
  ),
  'a different worker cannot release another capacity lease'
)
from capacity_test_state;

select is(
  public.release_openai_capacity_lease(
    first_user_id,
    first_lease_id,
    first_token,
    'completed'
  )->>'outcome',
  'released',
  'the exact holder releases capacity after terminal attempt persistence'
)
from capacity_test_state;
select is(
  public.release_openai_capacity_lease(
    first_user_id,
    first_lease_id,
    first_token,
    'completed'
  )->>'outcome',
  'idempotent_replay',
  'lost release acknowledgement replays without double release'
)
from capacity_test_state;

select is(
  public.claim_openai_capacity_lease(
    third_user_id,
    'local',
    'deep',
    repeat('d', 64),
    100,
    third_token
  )->>'denial_reason',
  'global_token_limit_per_minute',
  'releasing concurrency does not refund the rolling provider token minute'
)
from capacity_test_state;

update private.openai_capacity_leases
set acquired_at = clock_timestamp() - interval '62 seconds',
    dispatched_at = clock_timestamp() - interval '61 seconds'
where id in (
  select first_lease_id from capacity_test_state
  union all
  select second_lease_id from capacity_test_state
);

select ok(
  (
    public.claim_openai_capacity_lease(
      third_user_id,
      'local',
      'deep',
      repeat('d', 64),
      100,
      third_token
    )->>'capacity_admitted'
  )::boolean,
  'capacity reopens only after the counted provider minute expires'
)
from capacity_test_state;

select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'fast', true,
    2, 2, 1, 100000, 180, 5,
    0, 'pgtap', 'synthetic rolling request fixture'
  )$$,
  'a fast route receives an explicit rolling request budget'
);
select ok(
  (
    public.claim_openai_capacity_lease(
      first_user_id, 'local', 'fast', repeat('e', 64), 100,
      fast_first_token
    )->>'capacity_admitted'
  )::boolean,
  'the first fast request reserves its exact capacity'
)
from capacity_test_state;
update capacity_test_state state_record
set first_lease_id = lease_record.id
from private.openai_capacity_leases lease_record
where lease_record.lease_token = state_record.fast_first_token;
select lives_ok(
  format(
    'select public.mark_openai_capacity_lease_dispatched(%L::uuid,%L::uuid,%L::uuid)',
    first_user_id, first_lease_id, fast_first_token
  ),
  'the fast reservation is durably marked dispatched'
)
from capacity_test_state;
select lives_ok(
  format(
    'select public.release_openai_capacity_lease(%L::uuid,%L::uuid,%L::uuid,%L)',
    first_user_id, first_lease_id, fast_first_token, 'completed'
  ),
  'completed fast work releases only its active concurrency slot'
)
from capacity_test_state;
select is(
  public.claim_openai_capacity_lease(
    second_user_id, 'local', 'fast', repeat('f', 64), 100,
    fast_second_token
  )->>'denial_reason',
  'global_request_limit_per_minute',
  'a released request still consumes the measured rolling RPM window'
)
from capacity_test_state;

update private.openai_capacity_leases
set acquired_at = clock_timestamp() - interval '62 seconds',
    dispatched_at = clock_timestamp() - interval '61 seconds'
where lease_token = (
  select fast_first_token from capacity_test_state
);
select ok(
  (
    public.claim_openai_capacity_lease(
      second_user_id, 'local', 'fast', repeat('f', 64), 100,
      fast_second_token
    )->>'capacity_admitted'
  )::boolean,
  'rolling request capacity reopens only after the measured provider minute'
)
from capacity_test_state;

select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'research', true,
    1, 1, 10, 100000, 180, 5,
    0, 'pgtap', 'synthetic ambiguous-dispatch fixture'
  )$$,
  'a research route receives an explicit ambiguity-safe budget'
);
select ok(
  (
    public.claim_openai_capacity_lease(
      first_user_id, 'local', 'research', repeat('1', 64), 100,
      research_first_token
    )->>'capacity_admitted'
  )::boolean,
  'research work receives its exact active lease'
)
from capacity_test_state;
update capacity_test_state state_record
set first_lease_id = lease_record.id
from private.openai_capacity_leases lease_record
where lease_record.lease_token = state_record.research_first_token;
select lives_ok(
  format(
    'select public.mark_openai_capacity_lease_dispatched(%L::uuid,%L::uuid,%L::uuid)',
    first_user_id, first_lease_id, research_first_token
  ),
  'the potentially ambiguous research request crosses the dispatch boundary'
)
from capacity_test_state;
select is(
  (
    public.release_openai_capacity_lease(
      first_user_id, first_lease_id, research_first_token,
      'reconciliation_required'
    )->>'capacity_released'
  )::boolean,
  false,
  'an ambiguous post-dispatch outcome remains active until conservative expiry'
)
from capacity_test_state;
select is(
  public.claim_openai_capacity_lease(
    second_user_id, 'local', 'research', repeat('2', 64), 100,
    research_second_token
  )->>'denial_reason',
  'global_active_limit',
  'potentially running ambiguous work cannot be overbooked'
)
from capacity_test_state;

update private.openai_capacity_leases
set acquired_at = clock_timestamp() - interval '182 seconds',
    dispatched_at = clock_timestamp() - interval '181 seconds',
    expires_at = clock_timestamp() - interval '2 seconds'
where lease_token = (
  select research_first_token from capacity_test_state
);
select ok(
  (
    public.claim_openai_capacity_lease(
      second_user_id, 'local', 'research', repeat('2', 64), 100,
      research_second_token
    )->>'capacity_admitted'
  )::boolean,
  'ambiguous work reopens capacity only after its conservative lease expires'
)
from capacity_test_state;

select lives_ok(
  $$select public.configure_openai_capacity_route(
    'local', 'deep', false,
    2, 1, 10, 1000, 180, 5,
    1, 'pgtap', 'synthetic route-disable rollback fixture'
  )$$,
  'the measured deep route can be disabled through compare-and-swap'
);
select is(
  public.claim_openai_capacity_lease(
    second_user_id, 'local', 'deep', repeat('3', 64), 1,
    fast_second_token
  )->>'outcome',
  'route_disabled',
  'a disabled route is a stable activation state rather than endless capacity wait'
)
from capacity_test_state;

-- Two independent database sessions prove that route admission is actually
-- serialized, and that a caller queued on the advisory lock receives a fresh
-- lease measured from entry to the critical section rather than from dispatch.
select extensions.dblink_connect(
  'capacity_session_a',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'capacity_session_b',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'capacity_session_a',
  $$insert into auth.users(
      id, email, is_sso_user, is_anonymous, created_at, updated_at
    ) values
      ('b1000000-0000-4000-8000-000000000098',
        'capacity-concurrency-a@example.invalid', false, false, now(), now()),
      ('b1000000-0000-4000-8000-000000000099',
        'capacity-concurrency-b@example.invalid', false, false, now(), now())$$
);
select is(
  (
    select result->>'config_revision'
    from extensions.dblink(
      'capacity_session_a',
      $remote$select public.configure_openai_capacity_route(
        'capacity-concurrency', 'deep', true,
        1, 1, 100, 100000, 120, 5,
        0, 'pgtap', 'two-session admission fixture'
      )$remote$
    ) as remote_result(result jsonb)
  ),
  '1',
  'two-session admission uses one independently committed route budget'
);

create temp table capacity_concurrency_state (
  session_b_pid integer not null,
  sent_at timestamptz,
  first_lease_id uuid
) on commit drop;
insert into capacity_concurrency_state(session_b_pid)
select pid
from extensions.dblink(
  'capacity_session_b', 'select pg_catalog.pg_backend_pid()'
) as remote_backend(pid integer);

select extensions.dblink_exec('capacity_session_a', 'begin');
select is(
  (
    select result->>'outcome'
    from extensions.dblink(
      'capacity_session_a',
      $remote$select public.claim_openai_capacity_lease(
        'b1000000-0000-4000-8000-000000000098',
        'capacity-concurrency', 'deep', repeat('7', 64), 100,
        'b2000000-0000-4000-8000-000000000008'
      )$remote$
    ) as remote_result(result jsonb)
  ),
  'admitted',
  'session A claims the only measured active slot while retaining its transaction lock'
);
update capacity_concurrency_state
set first_lease_id = remote_lease.id
from extensions.dblink(
  'capacity_session_a',
  $$select id from private.openai_capacity_leases
    where lease_token = 'b2000000-0000-4000-8000-000000000008'$$
) as remote_lease(id uuid);
select is(
  extensions.dblink_send_query(
    'capacity_session_b',
    $remote$select public.claim_openai_capacity_lease(
      'b1000000-0000-4000-8000-000000000099',
      'capacity-concurrency', 'deep', repeat('8', 64), 100,
      'b2000000-0000-4000-8000-000000000009'
    )$remote$
  ),
  1,
  'session B sends a competing admission through a distinct database session'
);
select ok(
  extensions.dblink_is_busy('capacity_session_b') = 1
    and pg_temp.wait_for_advisory_lock(
      (select session_b_pid from capacity_concurrency_state)
    ),
  'session B waits on the exact route advisory lock instead of overbooking'
);
select extensions.dblink_exec('capacity_session_a', 'commit');
select results_eq(
  $$select result->>'outcome', result->>'denial_reason'
    from extensions.dblink_get_result(
      'capacity_session_b', false
    ) as remote_result(result jsonb)$$,
  $$values ('awaiting_capacity'::text, 'global_active_limit'::text)$$,
  'after the winning commit, the concurrent loser observes the one live lease'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result(
      'capacity_session_b', false
    ) as drained_result(result jsonb)
  ),
  0,
  'the asynchronous capacity-denial result is fully drained'
);
select is(
  (
    select live_count
    from extensions.dblink(
      'capacity_session_a',
      $$select count(*)::integer
        from private.openai_capacity_leases
        where environment = 'capacity-concurrency'
          and semantic_route = 'deep'
          and released_at is null
          and expires_at > pg_catalog.clock_timestamp()$$
    ) as remote_count(live_count integer)
  ),
  1,
  'simultaneous admission leaves exactly one active lease'
);
select is(
  (
    select result->>'outcome'
    from capacity_concurrency_state state_record,
      extensions.dblink(
        'capacity_session_a',
        format(
          'select public.release_openai_capacity_lease(%L::uuid,%L::uuid,%L::uuid,%L)',
          'b1000000-0000-4000-8000-000000000098',
          state_record.first_lease_id,
          'b2000000-0000-4000-8000-000000000008',
          'completed'
        )
      ) as remote_result(result jsonb)
  ),
  'released',
  'the first session releases its exact concurrency slot before the timing proof'
);

select extensions.dblink_exec('capacity_session_a', 'begin');
select extensions.dblink_exec(
  'capacity_session_a',
  $remote$do $lock$
  begin
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'openai-capacity-route:capacity-concurrency:deep', 0
      )
    );
  end;
  $lock$$remote$
);
update capacity_concurrency_state set sent_at = clock_timestamp();
select is(
  extensions.dblink_send_query(
    'capacity_session_b',
    $remote$select public.claim_openai_capacity_lease(
      'b1000000-0000-4000-8000-000000000099',
      'capacity-concurrency', 'deep', repeat('8', 64), 100,
      'b2000000-0000-4000-8000-000000000009'
    )$remote$
  ),
  1,
  'the queued timing fixture sends one fresh capacity claim'
);
select ok(
  pg_temp.wait_for_advisory_lock(
    (select session_b_pid from capacity_concurrency_state)
  ),
  'the timing fixture confirms the second session is queued on the route lock'
);
select lives_ok(
  $$select pg_catalog.pg_sleep(2)$$,
  'the route lock remains held long enough to distinguish a stale pre-lock clock'
);
select extensions.dblink_exec('capacity_session_a', 'commit');
select is(
  (
    select result->>'outcome'
    from extensions.dblink_get_result(
      'capacity_session_b', false
    ) as remote_result(result jsonb)
  ),
  'admitted',
  'the queued request is admitted after the lock holder exits'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result(
      'capacity_session_b', false
    ) as drained_result(result jsonb)
  ),
  0,
  'the asynchronous admitted result is fully drained'
);
select ok(
  (
    select remote_lease.acquired_at >= state_record.sent_at + interval '1.5 seconds'
      and remote_lease.expires_at - remote_lease.acquired_at = interval '120 seconds'
    from capacity_concurrency_state state_record,
      extensions.dblink(
        'capacity_session_a',
        $$select acquired_at, expires_at
          from private.openai_capacity_leases
          where lease_token = 'b2000000-0000-4000-8000-000000000009'$$
      ) as remote_lease(acquired_at timestamptz, expires_at timestamptz)
  ),
  'a queued winner receives its complete configured lease after entering the critical section'
);

select extensions.dblink_exec(
  'capacity_session_a', 'set session_replication_role = replica'
);
select extensions.dblink_exec(
  'capacity_session_a',
  $$delete from private.openai_capacity_leases
    where environment = 'capacity-concurrency'$$
);
select extensions.dblink_exec(
  'capacity_session_a',
  $$delete from private.openai_capacity_route_config_revisions
    where environment = 'capacity-concurrency'$$
);
select extensions.dblink_exec(
  'capacity_session_a',
  $$delete from private.openai_capacity_route_configs
    where environment = 'capacity-concurrency'$$
);
select extensions.dblink_exec(
  'capacity_session_a',
  $$delete from auth.users where id in (
    'b1000000-0000-4000-8000-000000000098',
    'b1000000-0000-4000-8000-000000000099'
  )$$
);
select extensions.dblink_exec(
  'capacity_session_a', 'set session_replication_role = origin'
);
select extensions.dblink_disconnect('capacity_session_a');
select extensions.dblink_disconnect('capacity_session_b');

select ok(
  pg_temp.raises_matching(
    $$update private.openai_capacity_route_config_revisions
      set change_reason = 'rewrite measured history'
      where environment = 'local' and semantic_route = 'deep' and config_revision = 1$$,
    '%IMMUTABLE_CAPTURED_RECORD%'
  ),
  'capacity configuration history cannot be rewritten'
);

select * from finish();
rollback;
