begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

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
  'update_own_profile_details',
  array['text', 'text', 'text', 'text', 'date', 'text', 'text', 'text', 'text', 'text', 'text'],
  'narrow personal-details RPC exists'
);
select has_function(
  'public',
  'link_own_business',
  array['uuid'],
  'owner-checked business-link RPC exists'
);
select has_function(
  'public',
  'create_and_link_own_business',
  array['text', 'text', 'text', 'text', 'text', 'text'],
  'atomic business creation and linking RPC exists'
);
select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated users have no direct profile UPDATE privilege'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_own_profile_details(text,text,text,text,date,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users can call the personal-details RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.link_own_business(uuid)',
    'EXECUTE'
  ),
  'authenticated users can call the business-link RPC'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_and_link_own_business(text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated users can call the atomic business creation RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.link_own_business(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot call the business-link RPC'
);
select is(
  (
    select count(*)::integer
    from pg_proc procedure_record
    join pg_namespace schema_record on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname in (
        'update_own_profile_details',
        'link_own_business',
        'create_and_link_own_business'
      )
      and procedure_record.prosecdef
      and array_to_string(procedure_record.proconfig, ',') in (
        'search_path=', 'search_path=""'
      )
  ),
  3,
  'all profile and business commands are SECURITY DEFINER with an empty search path'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('81000000-0000-4000-8000-000000000001', 'profile-owner@example.invalid', false, false, now(), now()),
  ('81000000-0000-4000-8000-000000000002', 'profile-other@example.invalid', false, false, now(), now());

insert into public.businesses(id, owner_user_id, trading_name)
values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Owner business'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Other business');

-- The imported membership model is not yet safe across business, brand, and
-- deletion policies. Membership alone must therefore not satisfy the initial
-- owner-only profile link contract.
insert into public.memberships(business_id, user_id, role)
values (
  '82000000-0000-4000-8000-000000000002',
  '81000000-0000-4000-8000-000000000001',
  'member'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.update_own_profile_details(
    'Owner', 'Owner Person', 'Owner', '+61 400 000 000', '1990-01-01'::date,
    '1 Test Street', null, 'Melbourne', 'Victoria', '3000', 'Australia'
  )$$,
  'the signed-in user can update allowed personal fields'
);
select is(
  (select full_name from public.profiles where id = auth.uid()),
  'Owner Person',
  'the personal-details RPC updates the caller profile'
);
select is(
  (select plan from public.profiles where id = auth.uid()),
  'free',
  'the personal-details RPC cannot change plan authority'
);
select is(
  (select usage_count from public.profiles where id = auth.uid()),
  0,
  'the personal-details RPC cannot change usage accounting'
);
select ok(
  pg_temp.raises_matching(
    $$update public.profiles set plan = 'enterprise' where id = auth.uid()$$,
    '%permission denied%'
  ),
  'a caller cannot self-escalate by direct profile UPDATE'
);
select ok(
  pg_temp.raises_matching(
    $$select public.link_own_business('82000000-0000-4000-8000-000000000002'::uuid)$$,
    '%BUSINESS_NOT_OWNED%'
  ),
  'membership alone cannot link another owner business in the first cohort'
);
select lives_ok(
  $$select public.link_own_business('82000000-0000-4000-8000-000000000001'::uuid)$$,
  'a caller can link a business they own'
);
select is(
  (select business_id from public.profiles where id = auth.uid()),
  '82000000-0000-4000-8000-000000000001'::uuid,
  'the owned business link is persisted on the caller profile'
);
select lives_ok(
  $$select public.link_own_business(null)$$,
  'a caller can unlink their business without linking another tenant'
);
select isnt(
  public.create_and_link_own_business(
    'Second owner business', null, null, null, null, null
  ),
  null::uuid,
  'business creation and profile linking complete in one command'
);
select ok(
  exists (
    select 1
    from public.profiles profile_record
    join public.businesses business_record
      on business_record.id = profile_record.business_id
    where profile_record.id = auth.uid()
      and business_record.owner_user_id = auth.uid()
      and business_record.trading_name = 'Second owner business'
  ),
  'the atomic command links only the newly created owned business'
);

reset role;

select isnt(
  (
    select business_id
    from public.profiles
    where id = '81000000-0000-4000-8000-000000000001'
  ),
  null::uuid,
  'the atomic creation command leaves an owned business linked'
);

select * from finish();
rollback;
