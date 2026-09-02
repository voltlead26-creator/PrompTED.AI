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

select has_column(
  'public', 'role_action_items', 'action_key',
  'role actions have a stable idempotent seed key'
);
select col_not_null(
  'public', 'role_action_items', 'action_key',
  'every role action has a stable action key'
);
select col_has_default(
  'public', 'role_action_items', 'action_key',
  'compatibility inserts receive a collision-safe legacy key'
);
select has_column(
  'public', 'role_action_items', 'mutation_token',
  'role actions have opaque concurrency identity'
);
select col_not_null(
  'public', 'role_action_items', 'mutation_token',
  'every role action has a mutation token'
);
select has_function(
  'public', 'save_own_role_with_default_actions',
  array['text','text','text','integer','text','text','text','text'],
  'role save and default action creation share one RPC'
);
select has_function(
  'public', 'update_own_role_action_item',
  array['uuid','uuid','text'],
  'role action updates use one CAS RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_own_role_with_default_actions(text,text,text,integer,text,text,text,text)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_own_role_with_default_actions(text,text,text,integer,text,text,text,text)',
    'EXECUTE'
  ) and pg_catalog.has_function_privilege(
    'authenticated', 'public.update_own_role_action_item(uuid,uuid,text)', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon', 'public.update_own_role_action_item(uuid,uuid,text)', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_own_role_with_default_actions(text,text,text,integer,text,text,text,text)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'service_role', 'public.update_own_role_action_item(uuid,uuid,text)', 'EXECUTE'
  ),
  'only authenticated callers execute the two owner commands'
);
select has_index(
  'public', 'saved_roles', 'saved_roles_owner_title_null_company_uidx',
  'roles without a company have one owner/title identity'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'private.rotate_role_action_item_mutation_token()', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'service_role', 'private.rotate_role_action_item_mutation_token()', 'EXECUTE'
  ),
  'the opaque token trigger is not directly callable'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname in (
        'save_own_role_with_default_actions',
        'update_own_role_action_item'
      )
      and function_record.prosecdef
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  2,
  'both commands are fixed-path security definers'
);
select ok(
  (
    select pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.pg_get_functiondef(function_record.oid)),
      'pg_advisory_xact_lock'
    ) > 0
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname = 'save_own_role_with_default_actions'
  ),
  'role identity creation serialises concurrent equal saves'
);

create temporary table role_results(name text primary key, role_id uuid not null) on commit drop;
create temporary table role_tokens(
  name text primary key,
  item_id uuid not null,
  token uuid not null
) on commit drop;
grant select, insert, update on role_results, role_tokens to authenticated;

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('f1000000-0000-4000-8000-000000000001', 'role-owner@example.invalid', false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'role-other@example.invalid', false, false, now(), now());

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

insert into role_results(name, role_id)
values (
  'first',
  public.save_own_role_with_default_actions(
    'Building Manager', null, 'Melbourne', 88, null, 'Synthetic', null, 'needs_confirmation'
  )
);
insert into role_results(name, role_id)
values (
  'replay',
  public.save_own_role_with_default_actions(
    'Building Manager', null, 'Melbourne', 88, null, 'Synthetic', null, 'needs_confirmation'
  )
);

select is(
  (select role_id from role_results where name = 'replay'),
  (select role_id from role_results where name = 'first'),
  'a same-identity retry resolves the same null-company saved role'
);
insert into role_results(name, role_id)
values (
  'update',
  public.save_own_role_with_default_actions(
    'Building Manager', null, 'Melbourne', 91, null, 'Synthetic', null, 'needs_confirmation'
  )
);
select is(
  (select role_id from role_results where name = 'update'),
  (select role_id from role_results where name = 'first'),
  'a later same-identity update retains the saved-role identity'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.saved_roles
    where user_id = 'f1000000-0000-4000-8000-000000000001'
      and role_title = 'Building Manager'
      and company_name is null
  ),
  1,
  'replay creates exactly one role shell'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from public.role_action_items
    where saved_role_id = (select role_id from role_results where name = 'first')
  ),
  6,
  'the atomic save creates exactly six default actions once'
);
select is(
  (
    select pg_catalog.count(distinct action_key)::integer
    from public.role_action_items
    where saved_role_id = (select role_id from role_results where name = 'first')
  ),
  6,
  'every default action has a unique stable key'
);
select ok(
  (
    select label = 'Open source-linked apply page'
      and description = 'Verify the listing on the source site, then apply yourself'
      and label not ilike '%official%'
      and description not ilike '%official%'
    from public.role_action_items
    where saved_role_id = (select role_id from role_results where name = 'first')
      and action_key = 'default:3'
  ),
  'the generated action truthfully describes an unverified source-linked page'
);
select is(
  (
    select match_percentage
    from public.saved_roles
    where id = (select role_id from role_results where name = 'first')
  ),
  91,
  'the authoritative same-identity update persists changed metadata'
);

insert into role_tokens(name, item_id, token)
select 'initial', id, mutation_token
from public.role_action_items
where saved_role_id = (select role_id from role_results where name = 'first')
  and action_key = 'default:0';

select is(
  public.update_own_role_action_item(
    (
      select id from public.role_action_items
      where saved_role_id = (select role_id from role_results where name = 'first')
        and action_key = 'default:0'
    ),
    (select token from role_tokens where name = 'initial'),
    'done'
  )->>'status',
  'committed',
  'the current token commits an action status'
);
insert into role_tokens(name, item_id, token)
select 'current', id, mutation_token
from public.role_action_items
where saved_role_id = (select role_id from role_results where name = 'first')
  and action_key = 'default:0';
select is(
  public.update_own_role_action_item(
    (
      select id from public.role_action_items
      where saved_role_id = (select role_id from role_results where name = 'first')
        and action_key = 'default:0'
    ),
    (select token from role_tokens where name = 'initial'),
    'pending'
  )->>'status',
  'revision_conflict',
  'a stale token returns authoritative conflict truth'
);
select is(
  (
    select status
    from public.role_action_items
    where saved_role_id = (select role_id from role_results where name = 'first')
      and action_key = 'default:0'
  ),
  'done',
  'the stale replay does not overwrite the committed status'
);

select ok(
  pg_temp.raises_matching(
    $$select public.save_own_role_with_default_actions('',null,null,null,null,null,null,null)$$,
    '%SAVED_ROLE_TITLE_INVALID%'
  ),
  'blank role titles fail before persistence'
);
select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.update_own_role_action_item(%L::uuid,%L::uuid,null)',
      (select item_id from role_tokens where name = 'current'),
      (select token from role_tokens where name = 'current')
    ),
    '%ROLE_ACTION_CHANGE_INVALID%'
  ),
  'a null action status fails at the command boundary'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true
);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
    pg_catalog.format(
      'select public.update_own_role_action_item(%L::uuid,%L::uuid,%L)',
      (select item_id from role_tokens where name = 'current'),
      (select token from role_tokens where name = 'current'),
      'pending'
    ),
    '%ROLE_ACTION_ITEM_UNAVAILABLE%'
  ),
  'another owner cannot observe or mutate the action row'
);

select * from finish();
rollback;
