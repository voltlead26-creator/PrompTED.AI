-- Pro 20 / Premium 40 / Business 50; old admissions remain immutable.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.plan_user(n integer) returns uuid language sql as $$
  select ('82001111-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
insert into auth.users(id,email,is_sso_user,is_anonymous,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.plan_user(n),'plan-'||n||'@example.invalid',false,false,now(),
  case when n=3 then '{"prompted":{"access_profile":"owner_1000_v1"}}'::jsonb else '{}'::jsonb end,
  '{}',now(),now() from generate_series(1,5) n;
insert into public.subscriptions(user_id,plan,status,period_end)
values (pg_temp.plan_user(1),'premium','active',now()+interval '1 month'),
  (pg_temp.plan_user(2),'business','active',now()+interval '1 month'),
  (pg_temp.plan_user(3),'free','active',now()+interval '1 month'),
  (pg_temp.plan_user(4),'business','active',now()+interval '1 month'),
  (pg_temp.plan_user(5),'pro','active',now()+interval '1 month');
create temp table original_plan_subscriptions as select to_jsonb(s) value
  from public.subscriptions s where user_id in (select pg_temp.plan_user(n) from generate_series(1,5) n);

set local role service_role;
select is(public.get_effective_product_access_v1(pg_temp.plan_user(2))->'monthly_document_cap',
  '50'::jsonb,'Business receives the approved 50-document per-user allowance');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(1))->'monthly_document_cap',
  '40'::jsonb,'Premium receives the approved 40-document allowance');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(5))->'monthly_document_cap',
  '20'::jsonb,'Pro receives the approved 20-document allowance');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(2))->>'subscription_plan',
  'business','the allowance change does not rewrite Business subscription identity');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(2))->'business_features',
  'true'::jsonb,'Business retains its business features');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(1))->'business_features',
  'false'::jsonb,'Premium does not acquire Business features');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(3))->'monthly_document_cap',
  '1000'::jsonb,'the owner retains the separate 1000-document allowance');
select is(public.reserve_document_allowance(pg_temp.plan_user(2),'business-first','generate-document',
  repeat('a',64),'business',1000,1800)->'monthly_cap','50'::jsonb,
  'database admission rejects a stale 1000-document Business snapshot');
select is(public.reserve_document_allowance(pg_temp.plan_user(1),'premium-first','generate-document',
  repeat('a',64),'premium',1000,1800)->'monthly_cap','40'::jsonb,
  'Premium admission uses its independently resolved limit');
reset role;
select is((select monthly_cap from private.document_plan_snapshot(pg_temp.plan_user(2))),50,
  'captured-operation plan snapshots use the same Business allowance');

-- Represent a prior, already admitted Business reservation without rewriting it.
insert into private.document_allowance_reservations
  (user_id,request_id,attempt_number,route_key,request_sha256,plan,monthly_cap,
   billing_period_start,billing_period_end,status,expires_at,access_profile)
select pg_temp.plan_user(4),'historical-business',1,route_key,request_sha256,'business',1000,
  billing_period_start,billing_period_end,'reserved',expires_at,'subscription'
from private.document_allowance_reservations where user_id=pg_temp.plan_user(2) and request_id='business-first';
create temp table historical_business as select to_jsonb(r) value
  from private.document_allowance_reservations r where user_id=pg_temp.plan_user(4);
set local role service_role;
select is(public.reserve_document_allowance(pg_temp.plan_user(4),'historical-business','generate-document',
  repeat('a',64),'business',50,1800)->'provider_permitted','false'::jsonb,
  'replaying a historical larger admission cannot dispatch again');
select is(public.reserve_document_allowance(pg_temp.plan_user(4),'new-business','generate-document',
  repeat('b',64),'business',1000,1800)->'monthly_cap','50'::jsonb,
  'a historical larger reservation does not grandfather a new request');
reset role;
select is((select to_jsonb(r) from private.document_allowance_reservations r
  where user_id=pg_temp.plan_user(4) and request_id='historical-business'),
  (select value from historical_business),'historical reservation identity and every stored field remain unchanged');

-- The intervening 40-document policy is also preserved on exact replay.
insert into private.document_allowance_reservations
  (user_id,request_id,attempt_number,route_key,request_sha256,plan,monthly_cap,
   billing_period_start,billing_period_end,status,expires_at,access_profile)
select user_id,'historical-business-forty',1,route_key,request_sha256,plan,40,
  billing_period_start,billing_period_end,status,expires_at,access_profile
from private.document_allowance_reservations
where user_id=pg_temp.plan_user(4) and request_id='historical-business';
create temp table historical_business_forty as select to_jsonb(r) value
  from private.document_allowance_reservations r
  where user_id=pg_temp.plan_user(4) and request_id='historical-business-forty';
set local role service_role;
select is(public.reserve_document_allowance(pg_temp.plan_user(4),'historical-business-forty','generate-document',
  repeat('a',64),'business',50,1800)->'provider_permitted','false'::jsonb,
  'replaying a historical 40-document admission cannot dispatch again');
reset role;
select is((select to_jsonb(r) from private.document_allowance_reservations r
  where user_id=pg_temp.plan_user(4) and request_id='historical-business-forty'),
  (select value from historical_business_forty),'the former 40-document reservation remains byte-for-byte equivalent');

insert into private.document_allowance_reservations
  (user_id,request_id,attempt_number,route_key,request_sha256,plan,monthly_cap,
   billing_period_start,billing_period_end,status,expires_at,access_profile)
select user_id,'business-boundary-'||n,1,route_key,request_sha256,plan,monthly_cap,
  billing_period_start,billing_period_end,'reserved',expires_at,access_profile
from private.document_allowance_reservations cross join generate_series(1,49) n
where user_id=pg_temp.plan_user(2) and request_id='business-first';
set local role service_role;
select throws_ok($$select public.reserve_document_allowance(pg_temp.plan_user(2),'business-over-cap',
  'generate-document',repeat('c',64),'business',1000,1800)$$,
  'P0001','ALLOWANCE_CAP_REACHED','Business cannot admit a 51st concurrent document with a stale higher cap');
select is(public.reserve_document_allowance(pg_temp.plan_user(2),'business-first','generate-document',
  repeat('a',64),'business',1000,1800)->'provider_permitted','false'::jsonb,
  'an exact replay at the cap remains idempotent');
reset role;
select is((select count(*)::integer from public.usage_ledger where user_id in
  (select pg_temp.plan_user(n) from generate_series(1,5) n)),0,
  'access resolution and reservations do not invent completed usage');
select is((select jsonb_agg(value order by value->>'user_id') from original_plan_subscriptions),
  (select jsonb_agg(to_jsonb(s) order by user_id) from public.subscriptions s where user_id in
    (select pg_temp.plan_user(n) from generate_series(1,5) n)),
  'all original subscription fields are preserved');

update public.subscriptions set status='trialing' where user_id=pg_temp.plan_user(2);
set local role service_role;
select is(public.get_effective_product_access_v1(pg_temp.plan_user(2))->'monthly_document_cap',
  '50'::jsonb,'trialling Business receives the same active allowance');
reset role;
update public.subscriptions set status='expired' where user_id=pg_temp.plan_user(2);
set local role service_role;
select is(public.get_effective_product_access_v1(pg_temp.plan_user(2))->'monthly_document_cap',
  '3'::jsonb,'expired Business falls back to the existing Free allowance');
select is(public.get_effective_product_access_v1(pg_temp.plan_user(2))->'business_features',
  'false'::jsonb,'expired Business loses paid features');
reset role;
select ok(not has_function_privilege('authenticated','private.resolve_product_access_v1(uuid)','execute'),
  'replacing the private resolver retains its execution restriction');
select * from finish();
rollback;
