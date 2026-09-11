-- Real local Auth metadata and allowance rows, rolled back after assertions.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.access_owner() returns uuid language sql as $$
  select '81001111-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.access_other() returns uuid language sql as $$
  select '81001111-0000-4000-8000-000000000002'::uuid $$;
insert into auth.users(id,email,is_sso_user,is_anonymous,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  (pg_temp.access_owner(),'access-owner@example.invalid',false,false,now(),
    '{"prompted":{"access_profile":"owner_1000_v1"}}','{}',now(),now()),
  (pg_temp.access_other(),'access-other@example.invalid',false,false,now(),
    '{}','{"prompted":{"access_profile":"owner_1000_v1"}}',now(),now());
insert into public.subscriptions(user_id,plan,status,period_end)
values(pg_temp.access_owner(),'free','active','2026-10-01T00:00:00Z');

select has_function('public','get_effective_product_access_v1',array['uuid'],
  'one versioned product access authority exists');
select ok(not has_function_privilege('anon','public.get_effective_product_access_v1(uuid)','execute'),
  'anonymous requests cannot resolve account access');
set local role service_role;
select lives_ok($$select public.get_effective_product_access_v1(pg_temp.access_owner())$$,
  'service admission can resolve the exact authenticated owner');
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->>'access_profile',
  'owner','server-controlled owner marker grants product access');
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->'monthly_document_cap',
  '1000'::jsonb,'owner product access has exactly 1000 monthly documents');
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->>'subscription_plan',
  'free','owner access does not fabricate a paid subscription');
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->>'effective_plan',
  'free','commercial plan identity remains separate from owner capabilities');
select is((public.get_effective_product_access_v1(pg_temp.access_owner())->>'current_period_end')::timestamptz,
  '2026-10-01T00:00:00Z'::timestamptz,'projection maps the authoritative subscription period_end');
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->'ai_editing',
  'true'::jsonb,'owner can use AI editing');
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->'business_features',
  'true'::jsonb,'owner can use business product features');
select is(public.get_effective_product_access_v1(pg_temp.access_other())->>'access_profile',
  'subscription','browser-editable metadata grants no access');
select is(public.get_effective_product_access_v1(pg_temp.access_other())->'monthly_document_cap',
  '3'::jsonb,'ordinary free allowance remains unchanged');
select throws_ok($$select public.get_effective_product_access_v1(null)$$,
  '22023','PRODUCT_ACCESS_USER_REQUIRED','service calls must name an exact user');
select throws_ok($$select public.get_effective_product_access_v1('81001111-0000-4000-8000-000000000099')$$,
  '22023','PRODUCT_ACCESS_USER_NOT_FOUND','unknown user is not an access profile');
reset role;

create temp table access_original_subscription as
  select to_jsonb(s) as value from public.subscriptions s where user_id=pg_temp.access_owner();
-- The database independently resolves access when reserving an allowance. A
-- stale numeric client snapshot must not cap the nominated owner.
set local role service_role;
select lives_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-request-1','generate-document',repeat('a',64),'free',1,1800)$$,
  'owner gets a normal durable allowance reservation');
select lives_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-request-2','generate-document',repeat('b',64),'free',1,1800)$$,
  'owner is not stopped by the stale commercial cap');
select lives_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-request-3','generate-document',repeat('c',64),'free',1000,1800)$$,
  'trusted owner admission records the finite owner snapshot');
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-invalid-cap','generate-document',repeat('f',64),'free',0,1800)$$,
  'P0001','ALLOWANCE_SNAPSHOT_INVALID','owner access does not bypass input validation');
select is(public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-request-3','generate-document',repeat('c',64),'free',1000,1800)->'provider_permitted',
  'false'::jsonb,'owner replay cannot dispatch a duplicate provider call');
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_other(),
  'forged-unlimited','generate-document',repeat('d',64),'free',null,1800)$$,
  'P0001','ALLOWANCE_SNAPSHOT_INVALID','an ordinary user cannot claim unlimited admission');
reset role;
select is((select count(*)::integer from private.document_allowance_reservations
  where user_id=pg_temp.access_owner() and monthly_cap=1000 and access_profile='owner'),3,
  'owner reservations freeze the resolved 1000 allowance without fake plan names');
select is((select count(*)::integer from public.usage_ledger where user_id=pg_temp.access_owner()),0,
  'admission alone never invents completed usage');
select is((select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.subscriptions s where user_id=pg_temp.access_owner()),
  (select coalesce(jsonb_agg(value),'[]') from access_original_subscription),
  'resolving and reserving owner access leaves real subscription records unchanged');

select set_config('request.jwt.claim.sub',pg_temp.access_owner()::text,true);
set local role authenticated;
select is(public.get_effective_product_access_v1()->>'user_id',pg_temp.access_owner()::text,
  'browser projection is bound to the current authenticated UUID');
select throws_ok($$select public.get_effective_product_access_v1(pg_temp.access_other())$$,
  '42501','PRODUCT_ACCESS_FORBIDDEN','browser cannot inspect another account access');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.access_other()::text,true);
set local role authenticated;
select is(public.get_effective_product_access_v1()->>'access_profile','subscription',
  'changing users cannot reuse the owner projection');
reset role;

-- Fill the remaining concurrent reservations through constrained fixture rows.
-- Production admission must reject the next request, even with a larger stale cap.
insert into private.document_allowance_reservations
  (user_id,request_id,attempt_number,route_key,request_sha256,plan,monthly_cap,
   billing_period_start,billing_period_end,status,expires_at,access_profile)
select user_id,'owner-boundary-'||n,1,route_key,request_sha256,plan,1000,
  billing_period_start,billing_period_end,'reserved',expires_at,'owner'
from private.document_allowance_reservations cross join generate_series(1,997) n
where user_id=pg_temp.access_owner() and request_id='owner-request-1';
set local role service_role;
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-over-cap','generate-document',repeat('f',64),'free',999999,1800)$$,
  'P0001','ALLOWANCE_CAP_REACHED','owner cannot exceed 1000 concurrent completed/reserved documents');
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'owner-null-cap','generate-document',repeat('f',64),'free',null,1800)$$,
  'P0001','ALLOWANCE_SNAPSHOT_INVALID','owner does not accept an unlimited snapshot');
reset role;
select throws_ok($$update private.document_allowance_reservations set monthly_cap=1001
  where user_id=pg_temp.access_owner() and request_id='owner-request-1'$$,
  'P0001','ALLOWANCE_SNAPSHOT_IMMUTABLE','admitted owner allowance cannot be rewritten');

-- Unknown, malformed and disabled server values retain ordinary access.
update auth.users set raw_app_meta_data='{"prompted":{"access_profile":"owner_1000_v2"}}'
  where id=pg_temp.access_owner();
set local role service_role;
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->>'access_profile',
  'subscription','unknown marker versions grant nothing');
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'revoked-owner-request','generate-document',repeat('e',64),'free',null,1800)$$,
  'P0001','ALLOWANCE_SNAPSHOT_INVALID','revocation is enforced again at database admission');
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_owner(),
  'revoked-owner-numeric','generate-document',repeat('e',64),'free',1000,1800)$$,
  'P0001','ALLOWANCE_CAP_REACHED','revoked owner cannot reuse the former numeric allowance');
select public.reserve_document_allowance(pg_temp.access_other(),
  'ordinary-'||n,'generate-document',repeat('b',64),'free',1000,1800)
from generate_series(1,3) n;
select throws_ok($$select public.reserve_document_allowance(pg_temp.access_other(),
  'ordinary-over-cap','generate-document',repeat('b',64),'free',1000,1800)$$,
  'P0001','ALLOWANCE_CAP_REACHED','ordinary user cannot use a stale higher numeric cap');
reset role;
update auth.users set raw_app_meta_data='{"prompted":["owner_1000_v1"]}'
  where id=pg_temp.access_owner();
set local role service_role;
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->>'access_profile',
  'subscription','malformed server metadata grants nothing');
reset role;
update auth.users set raw_app_meta_data='{"prompted":{"access_profile":false}}'
  where id=pg_temp.access_owner();
set local role service_role;
select is(public.get_effective_product_access_v1(pg_temp.access_owner())->>'access_profile',
  'subscription','disabled server metadata grants nothing');
reset role;
select * from finish();
rollback;
