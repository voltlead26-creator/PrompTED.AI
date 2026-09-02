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

create temp table allowance_test_state (
  owner_id uuid not null,
  first_reservation_id uuid,
  second_reservation_id uuid
);

insert into allowance_test_state(owner_id)
values ('d1000000-0000-4000-8000-000000000001');

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values (
  'd1000000-0000-4000-8000-000000000001',
  'allowance-owner@example.test',
  false,
  false,
  now(),
  now()
);

select has_table(
  'private',
  'document_allowance_reservations',
  'private atomic allowance reservations exist'
);
select has_function(
  'public',
  'reserve_document_allowance',
  array['uuid', 'text', 'text', 'text', 'text', 'integer', 'integer'],
  'service reservation RPC exists'
);
select has_function(
  'public',
  'settle_document_allowance',
  array['uuid', 'uuid', 'text', 'text', 'text', 'integer', 'integer'],
  'service settlement RPC exists'
);
select has_function(
  'public',
  'release_document_allowance',
  array['uuid', 'uuid', 'text', 'text'],
  'service release RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reserve_document_allowance(uuid,text,text,text,text,integer,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.settle_document_allowance(uuid,uuid,text,text,text,integer,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.release_document_allowance(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'protected compute can reserve, settle and release only through RPCs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reserve_document_allowance(uuid,text,text,text,text,integer,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.settle_document_allowance(uuid,uuid,text,text,text,integer,integer)',
    'EXECUTE'
  ),
  'browser roles cannot invoke allowance authority'
);
select ok(
  not has_table_privilege(
    'service_role',
    'private.document_allowance_reservations',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'private.document_allowance_reservations',
    'SELECT'
  ),
  'reservation rows are RPC-only and not exposed through the Data API'
);
select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'reserve_document_allowance',
        'settle_document_allowance',
        'release_document_allowance'
      )
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  ),
  3,
  'allowance RPCs are SECURITY DEFINER with an empty search path'
);

with result as (
  select public.reserve_document_allowance(
    'd1000000-0000-4000-8000-000000000001',
    'request-one',
    'generate-document',
    repeat('a', 64),
    'free',
    1,
    1800
  ) value
)
update allowance_test_state
set first_reservation_id = (select (value->>'reservation_id')::uuid from result);

select is(
  (
    public.reserve_document_allowance(
      'd1000000-0000-4000-8000-000000000001',
      'request-one',
      'generate-document',
      repeat('a', 64),
      'free',
      1,
      1800
    )->>'provider_permitted'
  )::boolean,
  false,
  'an active exact replay never receives provider permission'
);
select is(
  (
    public.reserve_document_allowance(
      'd1000000-0000-4000-8000-000000000001',
      'request-one',
      'generate-document',
      repeat('a', 64),
      'free',
      1,
      1800
    )->>'idempotent_replay'
  )::boolean,
  true,
  'the exact active replay is explicitly identified'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.reserve_document_allowance(%L::uuid,%L,%L,%L,%L,%s,%s)',
      'd1000000-0000-4000-8000-000000000001',
      'request-one',
      'generate-document',
      repeat('b', 64),
      'free',
      1,
      1800
    ),
    '%ALLOWANCE_REQUEST_REPLAY_CONFLICT%'
  ),
  'one request ID cannot be rebound to different input'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.reserve_document_allowance(%L::uuid,%L,%L,%L,%L,%s,%s)',
      'd1000000-0000-4000-8000-000000000001',
      'request-two',
      'generate-checklist',
      repeat('c', 64),
      'free',
      1,
      1800
    ),
    '%ALLOWANCE_CAP_REACHED%'
  ),
  'a live reservation consumes capacity before provider work'
);

select is(
  public.release_document_allowance(
    'd1000000-0000-4000-8000-000000000001',
    (select first_reservation_id from allowance_test_state),
    'request-one',
    'provider_failed'
  )->>'idempotent_replay',
  'false',
  'the first failed-work release is not reported as a replay'
);
select is(
  public.release_document_allowance(
    'd1000000-0000-4000-8000-000000000001',
    (select first_reservation_id from allowance_test_state),
    'request-one',
    'provider_failed'
  )->>'idempotent_replay',
  'true',
  'a repeated release is explicitly idempotent'
);
select is(
  (
    select status
    from private.document_allowance_reservations
    where id = (select first_reservation_id from allowance_test_state)
  ),
  'released',
  'failed provider work leaves the reservation released'
);

with result as (
  select public.reserve_document_allowance(
    'd1000000-0000-4000-8000-000000000001',
    'request-one',
    'generate-document',
    repeat('a', 64),
    'free',
    1,
    1800
  ) value
)
update allowance_test_state
set second_reservation_id = (select (value->>'reservation_id')::uuid from result);

select is(
  (
    select attempt_number
    from private.document_allowance_reservations
    where id = (select second_reservation_id from allowance_test_state)
  ),
  2,
  'a released exact request can retry as a distinct reservation attempt'
);

select is(
  public.settle_document_allowance(
    'd1000000-0000-4000-8000-000000000001',
    (select second_reservation_id from allowance_test_state),
    'request-one',
    'document',
    'openai',
    12,
    34
  )->>'state',
  'settled',
  'settlement appends usage and changes reservation atomically'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where user_id = 'd1000000-0000-4000-8000-000000000001'
      and event_type = 'document_created'
      and generation_request_id = 'request-one'
  ),
  1,
  'one settlement creates exactly one allowance usage row'
);
select is(
  public.settle_document_allowance(
    'd1000000-0000-4000-8000-000000000001',
    (select second_reservation_id from allowance_test_state),
    'request-one',
    'document',
    'openai',
    12,
    34
  )->>'idempotent_replay',
  'true',
  'settlement replay is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.usage_ledger
    where user_id = 'd1000000-0000-4000-8000-000000000001'
      and event_type = 'document_created'
      and generation_request_id = 'request-one'
  ),
  1,
  'settlement replay cannot append a duplicate usage row'
);
select is(
  (
    public.reserve_document_allowance(
      'd1000000-0000-4000-8000-000000000001',
      'request-one',
      'generate-document',
      repeat('a', 64),
      'free',
      1,
      1800
    )->>'state'
  ),
  'settled',
  'a completed request replay cannot rerun provider work'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.reserve_document_allowance(%L::uuid,%L,%L,%L,%L,%s,%s)',
      'd1000000-0000-4000-8000-000000000001',
      'request-three',
      'generate-report',
      repeat('d', 64),
      'free',
      1,
      1800
    ),
    '%ALLOWANCE_CAP_REACHED%'
  ),
  'settled reservations remain assigned to their frozen billing period'
);

-- A reservation created immediately before a month boundary can expire after
-- the calendar changes.  Its exact retry must not remain blocked forever, and
-- the new attempt must be admitted against the current frozen period.
insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values (
  'd1000000-0000-4000-8000-000000000002',
  'allowance-month-boundary@example.test',
  false,
  false,
  now(),
  now()
);
select is(
  (
    public.reserve_document_allowance(
      'd1000000-0000-4000-8000-000000000002',
      'month-boundary-request',
      'generate-report',
      repeat('9', 64),
      'free',
      1,
      1800
    )->>'provider_permitted'
  )::boolean,
  true,
  'the month-boundary fixture receives its initial admission'
);
update private.document_allowance_reservations
set billing_period_start = private.document_allowance_period_start(now()) - interval '1 month',
    billing_period_end = private.document_allowance_period_start(now()),
    reserved_at = now() - interval '3 hours',
    expires_at = now() - interval '2 hours',
    updated_at = now() - interval '2 hours'
where user_id = 'd1000000-0000-4000-8000-000000000002'
  and request_id = 'month-boundary-request';
select is(
  (
    public.reserve_document_allowance(
      'd1000000-0000-4000-8000-000000000002',
      'month-boundary-request',
      'generate-report',
      repeat('9', 64),
      'free',
      1,
      1800
    )->>'provider_permitted'
  )::boolean,
  true,
  'an expired prior-period exact request can reserve a current-period retry'
);
select is(
  (
    select max(attempt_number)
    from private.document_allowance_reservations
    where user_id = 'd1000000-0000-4000-8000-000000000002'
      and request_id = 'month-boundary-request'
  ),
  2,
  'the cross-period retry uses a collision-free next attempt number'
);

select ok(
  exists (
    select 1
    from pg_trigger trigger_record
    join pg_class relation_record on relation_record.oid = trigger_record.tgrelid
    join pg_namespace schema_record on schema_record.oid = relation_record.relnamespace
    where schema_record.nspname = 'private'
      and relation_record.relname = 'captured_document_operations'
      and trigger_record.tgname = 'captured_document_allowance_operation_guard'
      and not trigger_record.tgisinternal
  ),
  'captured acceptance and state transitions are allowance-guarded'
);
select ok(
  exists (
    select 1
    from pg_trigger trigger_record
    join pg_class relation_record on relation_record.oid = trigger_record.tgrelid
    join pg_namespace schema_record on schema_record.oid = relation_record.relnamespace
    where schema_record.nspname = 'public'
      and relation_record.relname = 'usage_ledger'
      and trigger_record.tgname = 'captured_document_allowance_usage_settlement'
      and not trigger_record.tgisinternal
  ),
  'captured finalizer usage settles the reservation in the same transaction'
);
select ok(
  exists (
    select 1
    from pg_trigger trigger_record
    join pg_class relation_record on relation_record.oid = trigger_record.tgrelid
    join pg_namespace schema_record on schema_record.oid = relation_record.relnamespace
    where schema_record.nspname = 'private'
      and relation_record.relname = 'captured_document_provider_attempts'
      and trigger_record.tgname = 'captured_provider_attempt_usage_reconciliation'
      and not trigger_record.tgisinternal
  ),
  'terminal provider attempts reconcile exact token usage before cancellation release'
);
select ok(
  pg_get_functiondef('private.enforce_captured_document_allowance()'::regprocedure)
    like '%retryable_failure%'
  and pg_get_functiondef('private.enforce_captured_document_allowance()'::regprocedure)
    like '%awaiting_clarification%'
  and pg_get_functiondef('private.enforce_captured_document_allowance()'::regprocedure)
    like '%awaiting_capacity%'
  and pg_get_functiondef('private.enforce_captured_document_allowance()'::regprocedure)
    like '%CAPTURED_ALLOWANCE_SETTLEMENT_REQUIRED%'
  and pg_get_functiondef('private.enforce_captured_document_allowance()'::regprocedure)
    like '%captured_%',
  'captured awaiting/retryable states renew while ready settles and terminal states release'
);

-- Concurrent admission proof.  The first external transaction keeps its
-- transaction advisory lock after reserving.  The second request starts while
-- the first row is still uncommitted.  It can reject at cap only if it waits for
-- that lock; an unlocked count-then-insert implementation would admit both.
select extensions.dblink_connect(
  'allowance_concurrent_one',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'allowance_concurrent_two',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'allowance_concurrent_one',
  $sql$
    insert into auth.users(
      id, email, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      'd1000000-0000-4000-8000-000000000099',
      'allowance-concurrent@example.test',
      false,
      false,
      now(),
      now()
    )
  $sql$
);
select extensions.dblink_exec('allowance_concurrent_one', 'begin');
select is(
  (
    select result->>'provider_permitted'
    from extensions.dblink(
      'allowance_concurrent_one',
      $sql$
        select public.reserve_document_allowance(
          'd1000000-0000-4000-8000-000000000099',
          'concurrent-one',
          'generate-document',
          repeat('e', 64),
          'free',
          1,
          1800
        )
      $sql$
    ) as remote_result(result jsonb)
  ),
  'true',
  'the first concurrent transaction reserves the only credit'
);
select is(
  extensions.dblink_send_query(
    'allowance_concurrent_two',
    $sql$
      select public.reserve_document_allowance(
        'd1000000-0000-4000-8000-000000000099',
        'concurrent-two',
        'generate-checklist',
        repeat('f', 64),
        'free',
        1,
        1800
      )
    $sql$
  ),
  1,
  'the competing reservation starts while the first transaction is open'
);
select extensions.dblink_exec('allowance_concurrent_one', 'commit');
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('allowance_concurrent_two', false)
      as remote_result(result jsonb)
  ),
  0,
  'the competing reservation is rejected instead of returning provider permission'
);
select ok(
  extensions.dblink_error_message('allowance_concurrent_two')
    like '%ALLOWANCE_CAP_REACHED%',
  'the concurrent loser observes the committed reservation under the lock'
);
select is(
  (
    select count(*)::integer
    from private.document_allowance_reservations
    where user_id = 'd1000000-0000-4000-8000-000000000099'
      and status = 'reserved'
  ),
  1,
  'concurrent cap admission leaves exactly one live reservation'
);
select extensions.dblink_exec(
  'allowance_concurrent_one',
  $sql$
    delete from auth.users
    where id = 'd1000000-0000-4000-8000-000000000099'
  $sql$
);
select extensions.dblink_disconnect('allowance_concurrent_one');
select extensions.dblink_disconnect('allowance_concurrent_two');

select * from finish();
rollback;
