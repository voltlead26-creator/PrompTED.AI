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

create or replace function pg_temp.rejects_without_commit(
  p_sql text,
  p_pattern text
) returns boolean
language plpgsql
as $function$
begin
  begin
    execute p_sql;
    raise exception using errcode = 'P0001', message = 'EXPECTED_REJECTION_MISSING';
  exception when others then
    if sqlerrm = 'EXPECTED_REJECTION_MISSING' then return false; end if;
    return sqlerrm like p_pattern;
  end;
end;
$function$;

select has_column(
  'public', 'checklist_items', 'mutation_token',
  'persisted checklist items have an opaque mutation token'
);
select col_type_is(
  'public', 'checklist_items', 'mutation_token', 'uuid',
  'the checklist token is a UUID rather than a timestamp'
);
select col_not_null(
  'public', 'checklist_items', 'mutation_token',
  'every persisted item has concurrency identity'
);
select has_function(
  'public', 'update_own_checklist_item',
  array['uuid', 'uuid', 'uuid', 'boolean', 'text'],
  'owner checklist edits use the one UUID-token RPC'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname = 'update_own_checklist_item'
  ),
  1,
  'the obsolete timestamp overload is absent'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_own_checklist_item(uuid,uuid,uuid,boolean,text)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon', 'public.update_own_checklist_item(uuid,uuid,uuid,boolean,text)', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'service_role', 'public.update_own_checklist_item(uuid,uuid,uuid,boolean,text)', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated', 'private.rotate_checklist_item_mutation_token()', 'EXECUTE'
  ),
  'only authenticated owners may call the public command and no browser role can rotate tokens'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname = 'update_own_checklist_item'
      and function_record.prosecdef
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  1,
  'the checklist command is SECURITY DEFINER with an empty search path'
);
select ok(
  (
    select pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(function_record.oid)),
      'from public.outcomes'
    ) > 0
    and pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(function_record.oid)),
      'from public.outcomes'
    ) < pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(function_record.oid)),
      'from public.checklist_items'
    )
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname = 'update_own_checklist_item'
  ),
  'item edits lock the owner outcome before the child row, matching whole-list replacement'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('e1000000-0000-4000-8000-000000000001', 'checklist-owner@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'checklist-other@example.invalid', false, false, now(), now());

insert into public.outcomes(id, user_id, situation_text, status, updated_at)
values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Owner checklist', 'in_progress', '2026-09-01T00:00:00Z'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'Other checklist', 'in_progress', '2026-09-01T00:00:00Z');

insert into public.checklist_items(
  id, outcome_id, user_id, text, done, order_index, created_at, updated_at
) values
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Owner task', false, 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000002', 'Other task', false, 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

create temporary table checklist_token_snapshots(
  name text primary key,
  token uuid not null
) on commit drop;
grant select, insert on checklist_token_snapshots to authenticated;
create temporary table checklist_aggregate_snapshots(
  name text primary key,
  value timestamptz not null
) on commit drop;
grant select, insert on checklist_aggregate_snapshots to authenticated;
insert into checklist_token_snapshots(name, token)
select 'initial', mutation_token
from public.checklist_items
where id = 'e3000000-0000-4000-8000-000000000001';
insert into checklist_aggregate_snapshots(name, value)
select 'before_item_edit', updated_at
from public.outcomes
where id = 'e2000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.update_own_checklist_item(
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    (select token from checklist_token_snapshots where name = 'initial'),
    true,
    null
  )->>'status',
  'committed',
  'the owner receives an explicit committed envelope'
);
select is(
  (
    select mutation_token <> (select token from checklist_token_snapshots where name = 'initial')
    from public.checklist_items
    where id = 'e3000000-0000-4000-8000-000000000001'
  ),
  true,
  'a successful edit rotates the opaque token'
);
insert into checklist_token_snapshots(name, token)
select 'after_toggle', mutation_token
from public.checklist_items
where id = 'e3000000-0000-4000-8000-000000000001';

select is(
  public.update_own_checklist_item(
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    (select token from checklist_token_snapshots where name = 'initial'),
    false,
    null
  )->>'status',
  'revision_conflict',
  'a stale token returns authoritative conflict truth rather than throwing away the row'
);
select is(
  public.update_own_checklist_item(
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    (select token from checklist_token_snapshots where name = 'initial'),
    false,
    null
  )->>'affected_rows',
  '0',
  'the conflict envelope proves that no row was changed'
);
select is(
  public.update_own_checklist_item(
    'e3000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    (select token from checklist_token_snapshots where name = 'after_toggle'),
    null,
    '  Revised owner task  '
  )->'item'->>'text',
  'Revised owner task',
  'a second accepted edit in the same transaction returns trimmed authoritative wording'
);
select is(
  (
    select mutation_token <> (select token from checklist_token_snapshots where name = 'after_toggle')
    from public.checklist_items
    where id = 'e3000000-0000-4000-8000-000000000001'
  ),
  true,
  'the second edit rotates again even though the outer transaction timestamp is unchanged'
);

select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.update_own_checklist_item(%L::uuid,%L::uuid,%L::uuid,null,%L)',
      'e3000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',
      (select mutation_token from public.checklist_items where id = 'e3000000-0000-4000-8000-000000000001'),
      '   '
    ),
    '%CHECKLIST_ITEM_TEXT_INVALID%'
  ),
  'blank wording is rejected before the token can rotate'
);
select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.update_own_checklist_item(%L::uuid,%L::uuid,%L::uuid,true,null)',
      'e3000000-0000-4000-8000-000000000002',
      'e2000000-0000-4000-8000-000000000002',
      'e4000000-0000-4000-8000-000000000002'
    ),
    '%CHECKLIST_ITEM_UNAVAILABLE%'
  ),
  'an owner cannot observe or mutate another account checklist row'
);
select ok(
  (
    select updated_at > (
      select value from checklist_aggregate_snapshots where name = 'before_item_edit'
    )
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000001'
  ),
  'an accepted item edit advances the parent aggregate revision'
);
select ok(
  pg_temp.rejects_without_commit(
    pg_catalog.format(
      'select public.replace_own_checklist(%L::uuid,%L,%L::timestamptz,%L::jsonb)',
      'e2000000-0000-4000-8000-000000000001',
      'delayed-generation-after-item-edit',
      (select value from checklist_aggregate_snapshots where name = 'before_item_edit'),
      '[{"id":"e3000000-0000-4000-8000-000000000001","text":"Stale generated task","due_date":null,"reason":null,"order_index":0}]'
    ),
    '%CHECKLIST_REVISION_CONFLICT%'
  )
  and (
    select text = 'Revised owner task' and done
    from public.checklist_items
    where id = 'e3000000-0000-4000-8000-000000000001'
  ),
  'a delayed whole-list generation cannot overwrite the newer item edit'
);

reset role;
insert into checklist_token_snapshots(name, token)
select 'before_direct', mutation_token
from public.checklist_items
where id = 'e3000000-0000-4000-8000-000000000001';
update public.checklist_items
set reason = 'Compatibility update'
where id = 'e3000000-0000-4000-8000-000000000001';
select is(
  (
    select mutation_token <> (select token from checklist_token_snapshots where name = 'before_direct')
    from public.checklist_items
    where id = 'e3000000-0000-4000-8000-000000000001'
  ),
  true,
  'a retained direct compatibility update invalidates every stale RPC token'
);

select * from finish();
rollback;
