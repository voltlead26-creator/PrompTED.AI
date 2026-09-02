begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

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

select ok(
  has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
    and not has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.subscriptions', 'DELETE'),
  'subscriptions are read-only through the authenticated Data API'
);
select ok(
  has_table_privilege('authenticated', 'public.memberships', 'SELECT')
    and not has_table_privilege('authenticated', 'public.memberships', 'INSERT')
    and not has_table_privilege('authenticated', 'public.memberships', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.memberships', 'DELETE'),
  'memberships are read-only through the authenticated Data API'
);
select ok(
  not has_table_privilege('anon', 'public.subscriptions', 'SELECT')
    and not has_table_privilege('anon', 'public.memberships', 'SELECT'),
  'anonymous callers cannot read subscription or membership rows'
);
select ok(
  has_table_privilege('service_role', 'public.subscriptions', 'SELECT')
    and not has_table_privilege('service_role', 'public.subscriptions', 'INSERT')
    and not has_table_privilege('service_role', 'public.subscriptions', 'UPDATE')
    and not has_table_privilege('service_role', 'public.subscriptions', 'DELETE'),
  'protected compute reads subscriptions while the atomic billing RPC owns writes'
);
select ok(
  has_table_privilege('service_role', 'public.audit_logs', 'INSERT')
    and not has_table_privilege('service_role', 'public.audit_logs', 'SELECT')
    and not has_table_privilege('service_role', 'public.audit_logs', 'UPDATE')
    and not has_table_privilege('service_role', 'public.audit_logs', 'DELETE'),
  'the webhook service has append-only audit-log authority'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.saved_roles'::regclass
      and constraint_record.conname = 'saved_roles_id_user_id_key'
      and constraint_record.contype = 'u'
      and constraint_record.convalidated
  ),
  'saved roles expose a validated tenant-qualified candidate key'
);
select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.role_documents'::regclass
      and constraint_record.conname = 'role_documents_saved_role_owner_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
  ),
  'role documents enforce the saved-role owner composite foreign key'
);
select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.role_action_items'::regclass
      and constraint_record.conname = 'role_action_items_saved_role_owner_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
  ),
  'role action items enforce the saved-role owner composite foreign key'
);
select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.role_outcomes'::regclass
      and constraint_record.conname = 'role_outcomes_saved_role_owner_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
  ),
  'role outcomes enforce the saved-role owner composite foreign key'
);
select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname in ('public', 'private')
      and procedure_record.prosecdef
      and coalesce(array_to_string(procedure_record.proconfig, ','), '') not in (
        'search_path=', 'search_path=""'
      )
  ),
  0,
  'all application SECURITY DEFINER functions use an empty search path'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.sync_saved_role_latest_stage()',
    'EXECUTE'
  ),
  'the trigger-only saved-role synchronizer is not directly executable'
);
select ok(
  has_table_privilege('authenticated', 'public.outcomes', 'SELECT')
    and has_table_privilege('authenticated', 'public.outcomes', 'INSERT')
    and has_table_privilege('authenticated', 'public.outcomes', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.outcomes', 'DELETE'),
  'the expand cohort retains RLS-protected legacy outcome writes but not delete'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in ('upsert_own_outcome', 'update_own_outcome')
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
      and pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
    group by schema_record.nspname
    having count(*) = 2
  ),
  'both outcome commands are authenticated-only fixed-path SECURITY DEFINER RPCs'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.assert_user_business_attribution(uuid,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'service_role',
    'private.enforce_user_business_attribution()',
    'EXECUTE'
  ),
  'business-attribution trigger helpers are not exposed as callable APIs'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('85000000-0000-4000-8000-000000000001', 'tenant-owner@example.invalid', false, false, now(), now()),
  ('85000000-0000-4000-8000-000000000002', 'tenant-attacker@example.invalid', false, false, now(), now());

insert into public.businesses(id, owner_user_id, trading_name)
values
  ('86000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'Owner business'),
  ('86000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', 'Second owner business');

insert into public.memberships(business_id, user_id, role)
values (
  '86000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000002',
  'member'
);

insert into public.saved_roles(id, user_id, role_title, company_name)
values
  ('87000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', 'Owner role', 'Owner company'),
  ('87000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000002', 'Attacker role', 'Attacker company');

insert into public.outcomes(id, user_id, situation_text)
values (
  '89000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  'Foreign owner outcome'
);

insert into public.subscriptions(user_id, plan, status)
values ('85000000-0000-4000-8000-000000000002', 'free', 'active');

select set_config('request.jwt.claim.sub', '85000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
    $$update public.subscriptions set plan = 'business' where user_id = auth.uid()$$,
    '%permission denied%'
  ),
  'a caller cannot self-upgrade a subscription plan'
);
select ok(
  pg_temp.raises_matching(
    $$insert into public.memberships(business_id, user_id, role)
      values ('86000000-0000-4000-8000-000000000002', auth.uid(), 'admin')$$,
    '%permission denied%'
  ),
  'a caller cannot self-enrol into another tenant'
);
select lives_ok(
  $$insert into public.outcomes(id, user_id, situation_text)
    values ('88000000-0000-4000-8000-000000000001', auth.uid(), 'Legacy direct insert')$$,
  'the expand cohort keeps the currently published owner-scoped insert working'
);
select lives_ok(
  $$update public.outcomes set is_saved = true where user_id = auth.uid()$$,
  'the expand cohort keeps the currently published owner-scoped update working'
);
select lives_ok(
  $$select public.upsert_own_outcome(
    '88000000-0000-4000-8000-000000000001',
    'Create an owner-derived outcome',
    '{"source":"test"}'::jsonb,
    'in_progress'
  )$$,
  'the outcome upsert RPC creates an authenticated caller-owned outcome'
);
select lives_ok(
  $$select public.update_own_outcome(
    '88000000-0000-4000-8000-000000000001',
    '{"is_saved":true,"status":"completed"}'::jsonb
  )$$,
  'the outcome patch RPC updates allowlisted browser fields'
);
select ok(
  pg_temp.raises_matching(
    $$select public.update_own_outcome(
      '88000000-0000-4000-8000-000000000001',
      '{"business_id":"86000000-0000-4000-8000-000000000002"}'::jsonb
    )$$,
    '%OUTCOME_PATCH_INVALID%'
  ),
  'the outcome patch RPC rejects business attribution keys'
);
select ok(
  pg_temp.raises_matching(
    $$select public.update_own_outcome(
      '89000000-0000-4000-8000-000000000001',
      '{"is_saved":true}'::jsonb
    )$$,
    '%OUTCOME_ID_CONFLICT%'
  ),
  'the outcome patch RPC rejects a foreign outcome ID'
);
select ok(
  pg_temp.raises_matching(
    $$insert into public.role_action_items(user_id, saved_role_id, label)
      values (auth.uid(), '87000000-0000-4000-8000-000000000001', 'Cross tenant')$$,
    '%foreign key constraint%'
  ),
  'a caller cannot attach an action item to another tenant saved role'
);
select ok(
  pg_temp.raises_matching(
    $$insert into public.role_outcomes(user_id, saved_role_id, stage)
      values (auth.uid(), '87000000-0000-4000-8000-000000000001', 'offer')$$,
    '%foreign key constraint%'
  ),
  'a caller cannot attach an outcome to another tenant saved role'
);
select lives_ok(
  $$insert into public.role_outcomes(user_id, saved_role_id, stage)
    values (auth.uid(), '87000000-0000-4000-8000-000000000002', 'interview_1')$$,
  'a caller can record an outcome for their own saved role'
);
select is(
  (
    select latest_stage
    from public.saved_roles
    where id = '87000000-0000-4000-8000-000000000002'
  ),
  'interview_1',
  'the latest-stage trigger updates the matching owner role'
);

reset role;

select is(
  (
    select (is_saved::text || ':' || status)
    from public.outcomes
    where id = '88000000-0000-4000-8000-000000000001'
  ),
  'true:completed',
  'the outcome RPC persists only the requested allowlisted patch'
);

select lives_ok(
  $$insert into public.outcomes(id, user_id, business_id, situation_text)
    values (
      '88000000-0000-4000-8000-000000000002',
      '85000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000001',
      'Business owner attribution'
    )$$,
  'a business owner may own a business-attributed outcome'
);
select lives_ok(
  $$insert into public.outcomes(id, user_id, business_id, situation_text)
    values (
      '88000000-0000-4000-8000-000000000003',
      '85000000-0000-4000-8000-000000000002',
      '86000000-0000-4000-8000-000000000001',
      'Business member attribution'
    )$$,
  'a business member may own a business-attributed outcome'
);
select ok(
  pg_temp.raises_matching(
    $$insert into public.outcomes(id, user_id, business_id, situation_text)
      values (
        '88000000-0000-4000-8000-000000000004',
        '85000000-0000-4000-8000-000000000002',
        '86000000-0000-4000-8000-000000000002',
        'Cross-tenant attribution'
      )$$,
    '%BUSINESS_ATTRIBUTION_FORBIDDEN%'
  ),
  'even privileged outcome writes reject cross-tenant business attribution'
);
select lives_ok(
  $$insert into public.usage_ledger(user_id, business_id, event_type)
    values (
      '85000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000001',
      'document_created'
    )$$,
  'new owner usage may carry its legitimate business attribution'
);
select lives_ok(
  $$insert into public.usage_ledger(user_id, business_id, event_type)
    values (
      '85000000-0000-4000-8000-000000000002',
      '86000000-0000-4000-8000-000000000001',
      'document_created'
    )$$,
  'new member usage may carry its legitimate business attribution'
);
select ok(
  pg_temp.raises_matching(
    $$insert into public.usage_ledger(user_id, business_id, event_type)
      values (
        '85000000-0000-4000-8000-000000000002',
        '86000000-0000-4000-8000-000000000002',
        'document_created'
      )$$,
    '%BUSINESS_ATTRIBUTION_FORBIDDEN%'
  ),
  'new privileged usage rejects cross-tenant business attribution'
);

select is(
  (
    select latest_stage
    from public.saved_roles
    where id = '87000000-0000-4000-8000-000000000001'
  ),
  null::text,
  'a rejected cross-tenant outcome cannot mutate the owner role'
);

select * from finish();
rollback;
