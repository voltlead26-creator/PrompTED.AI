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

create or replace function pg_temp.checklist_items(
  p_first_text text default 'Keep this completed action',
  p_second_text text default 'Complete the next action',
  p_first_id text default 'd1000000-0000-4000-8000-000000000001',
  p_second_id text default 'd1000000-0000-4000-8000-000000000002'
) returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'id', p_first_id,
      'text', p_first_text,
      'due_date', '2026-09-15',
      'reason', 'First synthetic reason',
      'order_index', 0
    ),
    pg_catalog.jsonb_build_object(
      'id', p_second_id,
      'text', p_second_text,
      'due_date', null,
      'reason', 'Second synthetic reason',
      'order_index', 1
    )
  )
$function$;

select has_table(
  'private', 'checklist_replacement_receipts',
  'private hash-only checklist replacement receipts exist'
);
select has_function(
  'public', 'replace_own_checklist',
  array['uuid', 'text', 'timestamp with time zone', 'jsonb'],
  'the atomic owner-scoped checklist replacement RPC exists'
);
select ok(
  (
    select table_record.relrowsecurity
    from pg_catalog.pg_class table_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'private'
      and table_record.relname = 'checklist_replacement_receipts'
  ),
  'the private receipt table has RLS enabled'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.checklist_replacement_receipts', 'SELECT'
  ) and not pg_catalog.has_table_privilege(
    'service_role', 'private.checklist_replacement_receipts', 'SELECT'
  ),
  'browser and service roles have no direct receipt access'
);
select ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.checklist_items', 'SELECT'
  ) and not pg_catalog.has_table_privilege(
    'authenticated', 'public.checklist_items', 'INSERT'
  ) and not pg_catalog.has_table_privilege(
    'authenticated', 'public.checklist_items', 'UPDATE'
  ) and not pg_catalog.has_table_privilege(
    'authenticated', 'public.checklist_items', 'DELETE'
  ),
  'browser checklist writes are RPC-only after the authoritative cohort cutover'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.replace_own_checklist(uuid,text,timestamp with time zone,jsonb)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon',
    'public.replace_own_checklist(uuid,text,timestamp with time zone,jsonb)',
    'EXECUTE'
  ),
  'only authenticated browser callers can execute the replacement command'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname = 'replace_own_checklist'
      and function_record.prosecdef
      and pg_catalog.array_to_string(function_record.proconfig, ',') in (
        'search_path=', 'search_path=""'
      )
  ),
  1,
  'the replacement RPC is SECURITY DEFINER with an empty search path'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class table_record
      on table_record.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'private'
      and table_record.relname = 'checklist_replacement_receipts'
      and trigger_record.tgname = 'checklist_replacement_receipt_immutable'
      and not trigger_record.tgisinternal
  ),
  1,
  'completed receipt rows reject later updates'
);
select ok(
  not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'private'
      and column_record.table_name = 'checklist_replacement_receipts'
      and column_record.column_name in ('items', 'text', 'reason', 'due_date')
  ),
  'receipts never duplicate checklist wording'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('d2000000-0000-4000-8000-000000000001', 'checklist-owner@example.invalid', false, false, now(), now()),
  ('d2000000-0000-4000-8000-000000000002', 'checklist-other@example.invalid', false, false, now(), now()),
  ('d2000000-0000-4000-8000-000000000003', 'checklist-delete@example.invalid', false, false, now(), now());

insert into public.outcomes(
  id, user_id, situation_text, status, updated_at
) values
  (
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'Synthetic checklist outcome',
    'in_progress',
    '2026-09-01T00:00:00Z'
  ),
  (
    'd3000000-0000-4000-8000-000000000002',
    'd2000000-0000-4000-8000-000000000002',
    'Another owner outcome',
    'in_progress',
    '2026-09-01T00:00:00Z'
  ),
  (
    'd3000000-0000-4000-8000-000000000003',
    'd2000000-0000-4000-8000-000000000003',
    'Deletion cascade outcome',
    'in_progress',
    '2026-09-01T00:00:00Z'
  );

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.replace_own_checklist(
    'd3000000-0000-4000-8000-000000000001',
    'checklist-request-1',
    (
      select updated_at
      from public.outcomes
      where id = 'd3000000-0000-4000-8000-000000000001'
    ),
    pg_temp.checklist_items()
  )->>'status',
  'committed',
  'a valid replacement commits as one authenticated operation'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.checklist_items
    where outcome_id = 'd3000000-0000-4000-8000-000000000001'
      and user_id = auth.uid()
  ),
  2,
  'the complete generated set is persisted exactly once'
);

select is(
  public.replace_own_checklist(
    'd3000000-0000-4000-8000-000000000001',
    'checklist-request-1',
    (
      select updated_at
      from public.outcomes
      where id = 'd3000000-0000-4000-8000-000000000001'
    ),
    pg_temp.checklist_items()
  )->>'idempotent_replay',
  'true',
  'a post-commit acknowledgement retry replays despite reading the advanced revision'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.checklist_items
    where outcome_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  2,
  'exact replay never duplicates rows'
);
select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.replace_own_checklist(%L::uuid,%L,%L::timestamptz,%L::jsonb)',
      'd3000000-0000-4000-8000-000000000001',
      'checklist-request-1',
      '2026-09-01T00:00:00Z',
      pg_temp.checklist_items('Changed replay text')
    ),
    '%CHECKLIST_REPLAY_CONFLICT%'
  ),
  'one request identity cannot be reused for different checklist content'
);

reset role;
update public.checklist_items
set done = true,
    reminder_offset_days = 2,
    reminder_sent = true
where outcome_id = 'd3000000-0000-4000-8000-000000000001'
  and text = 'Keep this completed action';

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select is(
  public.replace_own_checklist(
    'd3000000-0000-4000-8000-000000000001',
    'checklist-request-2',
    (
      select updated_at
      from public.outcomes
      where id = 'd3000000-0000-4000-8000-000000000001'
    ),
    pg_catalog.jsonb_set(
      pg_temp.checklist_items(
        'Keep this completed action',
        'A newly revised second action'
      ),
      '{0,due_date}',
      '"2026-09-16"'::jsonb
    )
  )->>'status',
  'committed',
  'a new generation request atomically replaces the prior set'
);
select ok(
  (
    select done and not reminder_sent and reminder_offset_days = 2
    from public.checklist_items
    where outcome_id = 'd3000000-0000-4000-8000-000000000001'
      and text = 'Keep this completed action'
  ),
  'matching completion survives while a changed due date resets sent-reminder state'
);
select ok(
  (
    select not reminder_sent
    from public.checklist_items
    where outcome_id = 'd3000000-0000-4000-8000-000000000001'
      and text = 'A newly revised second action'
  ),
  'a changed action never inherits an obsolete sent-reminder state'
);
select is(
  (
    select pg_catalog.string_agg(text, '|' order by order_index)
    from public.checklist_items
    where outcome_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  'Keep this completed action|A newly revised second action',
  'the new complete set replaces obsolete wording once'
);
select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.replace_own_checklist(%L::uuid,%L,%L::timestamptz,%L::jsonb)',
      'd3000000-0000-4000-8000-000000000001',
      'checklist-stale-request',
      '2026-09-01T00:00:00Z',
      pg_temp.checklist_items()
    ),
    '%CHECKLIST_REVISION_CONFLICT%'
  ),
  'a delayed generation cannot overwrite a newer outcome revision'
);
select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.replace_own_checklist(%L::uuid,%L,%L::timestamptz,%L::jsonb)',
      'd3000000-0000-4000-8000-000000000002',
      'checklist-foreign-request',
      '2026-09-01T00:00:00Z',
      pg_temp.checklist_items()
    ),
    '%CHECKLIST_OUTCOME_NOT_FOUND%'
  ),
  'an authenticated user cannot replace another owner checklist'
);

reset role;
create or replace function pg_temp.reject_forced_checklist_insert()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.text = 'FORCE_INSERT_FAILURE' then
    raise exception 'SYNTHETIC_CHECKLIST_INSERT_FAILURE';
  end if;
  return new;
end;
$function$;
create trigger synthetic_checklist_insert_failure
  before insert on public.checklist_items
  for each row execute function pg_temp.reject_forced_checklist_insert();

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.replace_own_checklist(%L::uuid,%L,%L::timestamptz,%L::jsonb)',
      'd3000000-0000-4000-8000-000000000001',
      'checklist-forced-failure',
      (
        select updated_at::text
        from public.outcomes
        where id = 'd3000000-0000-4000-8000-000000000001'
      ),
      pg_temp.checklist_items(
        'Keep this completed action',
        'FORCE_INSERT_FAILURE'
      )
    ),
    '%SYNTHETIC_CHECKLIST_INSERT_FAILURE%'
  ),
  'a failure after the internal delete aborts the whole replacement'
);
reset role;
drop trigger synthetic_checklist_insert_failure on public.checklist_items;
select is(
  (
    select pg_catalog.string_agg(text, '|' order by order_index)
    from public.checklist_items
    where outcome_id = 'd3000000-0000-4000-8000-000000000001'
  ),
  'Keep this completed action|A newly revised second action',
  'rollback preserves the complete prior checklist after insert failure'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from private.checklist_replacement_receipts
    where request_id = 'checklist-forced-failure'
  ),
  0,
  'a failed replacement leaves no false success receipt'
);

-- Create one receipt for the deletion-cascade owner as the owner role, then
-- delete that auth identity and prove the private receipt is removed.
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'd2000000-0000-4000-8000-000000000003', true
);
set local role authenticated;
select is(
  public.replace_own_checklist(
    'd3000000-0000-4000-8000-000000000003',
    'checklist-delete-request',
    '2026-09-01T00:00:00Z',
    pg_temp.checklist_items(
      'Deletion owner first action',
      'Deletion owner second action',
      'd1000000-0000-4000-8000-000000000003',
      'd1000000-0000-4000-8000-000000000004'
    )
  )->>'status',
  'committed',
  'the deletion fixture has one completed replacement receipt'
);
reset role;
delete from auth.users where id = 'd2000000-0000-4000-8000-000000000003';
select is(
  (
    select pg_catalog.count(*)::integer
    from private.checklist_replacement_receipts
    where user_id = 'd2000000-0000-4000-8000-000000000003'
  ),
  0,
  'account deletion cascades private checklist replacement receipts'
);

select * from finish();
rollback;
