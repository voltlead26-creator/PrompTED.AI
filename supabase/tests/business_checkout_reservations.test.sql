-- Dormant Business checkout reservation boundary. No provider or access writes.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (
  id, email, is_sso_user, is_anonymous, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '95100000-0000-4000-8000-000000000001',
  'checkout-reservation-owner@example.invalid', false, false, now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

select has_table('private', 'business_checkout_attempts',
  'checkout reservations have a durable private owner-bound table');
select has_function('public', 'reserve_business_checkout_attempt_v1',
  array['uuid', 'uuid', 'jsonb', 'jsonb'],
  'checkout reservation has an exact service RPC contract');
select has_function('public', 'read_own_business_checkout_attempt_v1',
  array['uuid'],
  'an owner can recover the current or exact checkout reservation');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok($reserve$
  select public.reserve_business_checkout_attempt_v1(
    '95100000-0000-4000-8000-000000000001'::uuid,
    '95100000-0000-4000-8000-000000000101'::uuid,
    '{
      "contract_version": "business-checkout.1",
      "project_id": "proj12b68907",
      "app_id": "app0e160cafea",
      "environment": "SANDBOX"
    }'::jsonb,
    '{
      "offering_id": "business",
      "package_id": "$rc_monthly",
      "product_id": "prompted.business.monthly",
      "option_id": "synthetic-monthly-option",
      "price_id": "synthetic-usd-monthly-price",
      "currency": "USD",
      "amount_micros": 50000000,
      "period": "P1M",
      "trial": null,
      "intro_price": null,
      "discount": null
    }'::jsonb
  );
$reserve$, 'the service can reserve for an existing confirmed fresh owner');
reset role;

-- These fixtures are deliberately synthetic. Reservation permission is not a
-- configured RevenueCat offer, purchase, webhook settlement or access grant.
create function pg_temp.checkout_user(p_number integer) returns uuid
language sql immutable as $$
  select ('95100000-0000-4000-8000-' || lpad(p_number::text,12,'0'))::uuid
$$;
create function pg_temp.checkout_operation(p_number integer) returns uuid
language sql immutable as $$
  select ('95100000-0000-4000-8000-' || lpad((100+p_number)::text,12,'0'))::uuid
$$;
create function pg_temp.checkout_binding() returns jsonb language sql immutable as $$
  select '{"contract_version":"business-checkout.1","project_id":"proj12b68907",
    "app_id":"app0e160cafea","environment":"SANDBOX"}'::jsonb
$$;
create function pg_temp.checkout_offer() returns jsonb language sql immutable as $$
  select '{"offering_id":"business","package_id":"$rc_monthly",
    "product_id":"prompted.business.monthly","option_id":"synthetic-monthly-option",
    "price_id":"synthetic-usd-monthly-price","currency":"USD","amount_micros":50000000,
    "period":"P1M","trial":null,"intro_price":null,"discount":null}'::jsonb
$$;
create function pg_temp.checkout_error(
  p_user uuid, p_operation uuid, p_binding jsonb, p_offer jsonb
) returns jsonb language plpgsql as $$
begin
  perform public.reserve_business_checkout_attempt_v1(p_user,p_operation,p_binding,p_offer);
  -- Roll back even an unexpectedly successful negative case. The sentinel is
  -- never an expected product error, so this isolation cannot turn it green.
  raise exception 'CHECKOUT_TEST_UNEXPECTED_SUCCESS' using errcode='ZC001';
exception when others then
  return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end;
$$;
create function pg_temp.checkout_sql_error(p_sql text) returns jsonb language plpgsql as $$
begin
  execute p_sql;
  raise exception 'CHECKOUT_TEST_UNEXPECTED_SUCCESS' using errcode='ZC001';
exception when others then
  return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end;
$$;
create function pg_temp.checkout_expected_error(p_state text,p_message text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('sqlstate',p_state,'message',p_message)
$$;
create function pg_temp.checkout_keys(p_value jsonb) returns text[] language sql immutable as $$
  select array_agg(key order by key) from jsonb_object_keys(p_value) key
$$;
create function pg_temp.checkout_stored_attempt(p_user uuid,p_operation uuid)
returns jsonb language sql as $$
  select jsonb_build_object(
    'user_id',a.user_id,'operation_id',a.operation_id,
    'server_binding',a.server_binding,'offer_snapshot',a.offer_snapshot,
    'request_sha256',a.request_sha256,
    'created_at',to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'state',a.state)
  from private.business_checkout_attempts a
  where a.user_id=p_user and a.operation_id=p_operation
$$;
create function pg_temp.checkout_billing_state() returns jsonb language sql as $$
  select jsonb_build_object(
    'subscriptions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.user_id,s.id),'[]')
      from public.subscriptions s),
    'usage',(select coalesce(jsonb_agg(to_jsonb(u) order by u.id),'[]') from public.usage_ledger u),
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by e.event_id),'[]')
      from public.revenuecat_webhook_events e),
    'access',(select coalesce(jsonb_agg(private.resolve_product_access_v1(u.id) order by u.id),'[]')
      from auth.users u where u.id::text like '95100000-%'))
$$;
create function pg_temp.checkout_event(p_id text,p_type text,p_user uuid,p_time bigint)
returns jsonb language sql immutable as $$
  select jsonb_build_object('api_version','1.0','id',p_id,'type',p_type,
    'event_timestamp_ms',p_time,'app_user_id',p_user,'entitlement_ids',jsonb_build_array('business'),
    'expiration_at_ms',1900000000000,'purchased_at_ms',1700000000000,
    'period_type','NORMAL','product_id','prompted.business.monthly')
$$;

insert into auth.users(id,email,is_sso_user,is_anonymous,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.checkout_user(n),'checkout-reservation-'||n||'@example.invalid',
  false,false,now(),'{}'::jsonb,'{}'::jsonb,now(),now() from generate_series(2,40) n;
update auth.users set email_confirmed_at=null where id=pg_temp.checkout_user(5);
update auth.users set is_anonymous=true where id=pg_temp.checkout_user(6);
update auth.users set raw_app_meta_data='{"prompted":{"access_profile":"owner_1000_v1"}}'
  where id=pg_temp.checkout_user(8);
update auth.users set email_confirmed_at=null,phone='+15550000020',phone_confirmed_at=now()
  where id=pg_temp.checkout_user(20);

create temp table checkout_receipts(label text primary key,value jsonb not null);
create temp table checkout_snapshots(label text primary key,value jsonb not null);
grant select,insert on checkout_receipts to authenticated,service_role;
grant select on checkout_snapshots to authenticated,service_role;
insert into checkout_snapshots values ('billing-before-core',pg_temp.checkout_billing_state());
insert into checkout_snapshots values ('initial-row',
  (select to_jsonb(a) from private.business_checkout_attempts a
    where user_id=pg_temp.checkout_user(1) and operation_id=pg_temp.checkout_operation(1)));

select ok(has_function_privilege('service_role',
  'public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)','EXECUTE'),
  'only the service boundary receives reserve execution');
select ok(not has_function_privilege(role_name,
  'public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)','EXECUTE'),
  role_name||' cannot mint dispatch permission') from unnest(array['anon','authenticated']) role_name;
select ok(has_function_privilege('authenticated',
  'public.read_own_business_checkout_attempt_v1(uuid)','EXECUTE'),
  'authenticated owners can recover checkout evidence');
select ok(not has_function_privilege(role_name,
  'public.read_own_business_checkout_attempt_v1(uuid)','EXECUTE'),
  role_name||' cannot use the authenticated owner recovery RPC')
  from unnest(array['anon','service_role']) role_name;
select ok(not has_table_privilege(role_name,'private.business_checkout_attempts',
  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  role_name||' has no direct checkout table authority')
  from unnest(array['anon','authenticated','service_role']) role_name;
select ok((select relrowsecurity from pg_class where oid='private.business_checkout_attempts'::regclass),
  'private checkout rows have RLS enabled');
select ok(not exists(select 1 from pg_policies
  where schemaname='private' and tablename='business_checkout_attempts'),
  'no row policy creates a second direct checkout access path');
select ok((select bool_and(prosecdef and coalesce(proconfig @> array['search_path=""'],false))
  from pg_proc where oid in (
    'public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.read_own_business_checkout_attempt_v1(uuid)'::regprocedure)),
  'both privileged RPCs fix their search path');
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
  where p.oid in ('public.reserve_business_checkout_attempt_v1(uuid,uuid,jsonb,jsonb)'::regprocedure,
    'public.read_own_business_checkout_attempt_v1(uuid)'::regprocedure)
    and acl.grantee=0 and acl.privilege_type='EXECUTE'),
  'PUBLIC does not inherit either checkout RPC');
select is(pg_temp.checkout_error(pg_temp.checkout_user(4),pg_temp.checkout_operation(4),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_FORBIDDEN'),
  'a service JWT setting does not elevate the selected postgres role');

set local role service_role;
insert into checkout_receipts values ('created',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(2),pg_temp.checkout_operation(2),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('replay',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(2),pg_temp.checkout_operation(2),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('semantic-replay',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(2),pg_temp.checkout_operation(2),
  '{"environment":"SANDBOX","app_id":"app0e160cafea","project_id":"proj12b68907","contract_version":"business-checkout.1"}',
  '{"discount":null,"intro_price":null,"trial":null,"period":"P1M","amount_micros":50000000.0,
    "currency":"USD","price_id":"synthetic-usd-monthly-price","option_id":"synthetic-monthly-option",
    "product_id":"prompted.business.monthly","package_id":"$rc_monthly","offering_id":"business"}'));
insert into checkout_receipts values ('lost-initial-ack',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(1),pg_temp.checkout_operation(1),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('blocked',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(2),pg_temp.checkout_operation(3),
  pg_temp.checkout_binding()||'{"environment":"PRODUCTION"}',pg_temp.checkout_offer()));
select is(pg_temp.checkout_error(pg_temp.checkout_user(2),pg_temp.checkout_operation(2),
  pg_temp.checkout_binding()||'{"environment":"PRODUCTION"}',pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('P0001','BUSINESS_CHECKOUT_OPERATION_CONFLICT'),
  'changing the environment on an existing operation is a conflict');
select is(pg_temp.checkout_error(pg_temp.checkout_user(2),pg_temp.checkout_operation(2),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()||jsonb_build_object(field,'another-synthetic-choice')),
  pg_temp.checkout_expected_error('P0001','BUSINESS_CHECKOUT_OPERATION_CONFLICT'),
  'changing the exact '||field||' on an existing operation is a conflict')
  from unnest(array['option_id','price_id']) field;
reset role;

select is(pg_temp.checkout_keys(value),array[
  'attempt','contract_version','dispatch_permitted','outcome','requested_operation_id','user_id'],
  label||' has exactly the agreed reserve receipt keys') from checkout_receipts;
select is((select value from checkout_receipts where label='created'),jsonb_build_object(
  'contract_version','business-checkout.1','outcome','created','user_id',pg_temp.checkout_user(2),
  'requested_operation_id',pg_temp.checkout_operation(2),'dispatch_permitted',true,
  'attempt',pg_temp.checkout_stored_attempt(pg_temp.checkout_user(2),pg_temp.checkout_operation(2))),
  'created permission names the exact owner, operation and persisted attempt');
select is(pg_temp.checkout_keys(value->'attempt'),array[
  'created_at','offer_snapshot','operation_id','request_sha256','server_binding','state','user_id'],
  label||' exposes only immutable attempt evidence') from checkout_receipts;
select is((select value->'attempt'->'server_binding' from checkout_receipts where label='created'),
  pg_temp.checkout_binding(),'the exact approved server binding is retained');
select is((select value->'attempt'->'offer_snapshot' from checkout_receipts where label='created'),
  pg_temp.checkout_offer(),'all displayed offer terms including explicit null terms are retained');
select is((select value->'attempt'->>'state' from checkout_receipts where label='created'),
  'unresolved','reservation does not invent purchase settlement');
select matches((select value->'attempt'->>'created_at' from checkout_receipts where label='created'),
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$',
  'receipt timestamps use the canonical six-digit UTC form');
select is((select value->'attempt'->>'request_sha256' from checkout_receipts where label='created'),
  encode(extensions.digest(convert_to(jsonb_build_object(
    'contract_version','business-checkout.1','user_id',pg_temp.checkout_user(2),
    'operation_id',pg_temp.checkout_operation(2),'server_binding',pg_temp.checkout_binding(),
    'offer_snapshot',pg_temp.checkout_offer())::text,'UTF8'),'sha256'),'hex'),
  'the server fingerprint binds the complete agreed owner, operation and terms envelope');
select is((select value from checkout_receipts where label='replay'),
  (select value||'{"outcome":"replay","dispatch_permitted":false}'::jsonb
    from checkout_receipts where label='created'),
  'an exact replay retains every attempt field and never reissues dispatch permission');
select is((select value from checkout_receipts where label='semantic-replay'),
  (select value from checkout_receipts where label='replay'),
  'key reordering and the equivalent numeric amount 50000000.0 retain the same attempt and fingerprint');
select is((select value from checkout_receipts where label='lost-initial-ack'),jsonb_build_object(
  'contract_version','business-checkout.1','outcome','replay','user_id',pg_temp.checkout_user(1),
  'requested_operation_id',pg_temp.checkout_operation(1),'dispatch_permitted',false,
  'attempt',pg_temp.checkout_stored_attempt(pg_temp.checkout_user(1),pg_temp.checkout_operation(1))),
  'an initially lost reserve acknowledgement stays unresolved without another dispatch');
select is((select value from checkout_receipts where label='blocked'),
  (select value||jsonb_build_object('outcome','blocked','dispatch_permitted',false,
    'requested_operation_id',pg_temp.checkout_operation(3)) from checkout_receipts where label='created'),
  'another operation is blocked by the same owner attempt even in a different environment');
select is((select count(*) from private.business_checkout_attempts where user_id=pg_temp.checkout_user(2)),
  1::bigint,'replay, changed terms and cross-environment blocking create no second owner row');
select is((select to_jsonb(a) from private.business_checkout_attempts a where user_id=pg_temp.checkout_user(1)),
  (select value from checkout_snapshots where label='initial-row'),
  'the lost-acknowledgement replay does not refresh or otherwise mutate its original row');
insert into checkout_snapshots values ('created-row',
  (select to_jsonb(a) from private.business_checkout_attempts a where user_id=pg_temp.checkout_user(2)));

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(1)::text,true);
set local role authenticated;
insert into checkout_receipts values ('read-exact',public.read_own_business_checkout_attempt_v1(pg_temp.checkout_operation(1)));
insert into checkout_receipts values ('read-recovery',public.read_own_business_checkout_attempt_v1());
insert into checkout_receipts values ('read-foreign',public.read_own_business_checkout_attempt_v1(pg_temp.checkout_operation(2)));
reset role;
select is(pg_temp.checkout_keys(value),array[
  'attempt','contract_version','dispatch_permitted','requested_operation_id','user_id'],
  label||' has exactly the agreed owner-read keys') from checkout_receipts where label like 'read-%';
select is((select value from checkout_receipts where label='read-exact'),jsonb_build_object(
  'contract_version','business-checkout.1','user_id',pg_temp.checkout_user(1),
  'requested_operation_id',pg_temp.checkout_operation(1),'dispatch_permitted',false,
  'attempt',pg_temp.checkout_stored_attempt(pg_temp.checkout_user(1),pg_temp.checkout_operation(1))),
  'an exact owner read recovers immutable evidence without dispatch permission');
select is((select value from checkout_receipts where label='read-recovery'),
  (select value||'{"requested_operation_id":null}'::jsonb from checkout_receipts where label='read-exact'),
  'omitting the operation recovers the same unresolved owner attempt after reload');
select is((select value from checkout_receipts where label='read-foreign'),jsonb_build_object(
  'contract_version','business-checkout.1','user_id',pg_temp.checkout_user(1),
  'requested_operation_id',pg_temp.checkout_operation(2),'dispatch_permitted',false,'attempt',null),
  'a foreign operation returns exact owner-scoped absence without exposing another attempt');
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(3)::text,true);
set local role authenticated;
select is(public.read_own_business_checkout_attempt_v1(),jsonb_build_object(
  'contract_version','business-checkout.1','user_id',pg_temp.checkout_user(3),
  'requested_operation_id',null,'dispatch_permitted',false,'attempt',null),
  'a fresh owner has an explicit empty recovery result');
reset role;
set local role service_role;
insert into checkout_receipts values ('other-owner-created',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(3),pg_temp.checkout_operation(2),
  pg_temp.checkout_binding()||'{"environment":"PRODUCTION"}',pg_temp.checkout_offer()));
reset role;
select is((select value from checkout_receipts where label='other-owner-created'),jsonb_build_object(
  'contract_version','business-checkout.1','outcome','created','user_id',pg_temp.checkout_user(3),
  'requested_operation_id',pg_temp.checkout_operation(2),'dispatch_permitted',true,
  'attempt',pg_temp.checkout_stored_attempt(pg_temp.checkout_user(3),pg_temp.checkout_operation(2))),
  'another owner can independently use the same opaque operation UUID');
select is((select count(*) from private.business_checkout_attempts where operation_id=pg_temp.checkout_operation(2)),
  2::bigint,'operation identity is composite with the owner rather than globally colliding');
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(3)::text,true);
set local role authenticated;
insert into checkout_receipts values ('read-other-owner-same-op',public.read_own_business_checkout_attempt_v1(pg_temp.checkout_operation(2)));
reset role;
select is((select value from checkout_receipts where label='read-other-owner-same-op'),jsonb_build_object(
  'contract_version','business-checkout.1','user_id',pg_temp.checkout_user(3),
  'requested_operation_id',pg_temp.checkout_operation(2),'dispatch_permitted',false,
  'attempt',pg_temp.checkout_stored_attempt(pg_temp.checkout_user(3),pg_temp.checkout_operation(2))),
  'colliding operation UUIDs still read only the current owner attempt');

-- All malformed cases run on a fresh owner and are isolated if the boundary
-- mistakenly accepts one. JSONB has already consumed raw duplicate keys; the
-- later HTTP boundary must separately validate the original JSON representation.
create temp table checkout_bad_bindings(label text,value jsonb);
insert into checkout_bad_bindings values
  ('SQL null',null),('JSON null','null'),('array','[]'),('string','"binding"'),
  ('number','7'),('boolean','true'),('empty object','{}'),
  ('extra key',pg_temp.checkout_binding()||'{"unexpected":true}'),
  ('caller fingerprint',pg_temp.checkout_binding()||jsonb_build_object('request_sha256',repeat('a',64))),
  ('contract version',pg_temp.checkout_binding()||'{"contract_version":"business-checkout.2"}'),
  ('project',pg_temp.checkout_binding()||'{"project_id":"another-project"}'),
  ('app',pg_temp.checkout_binding()||'{"app_id":"another-app"}'),
  ('unknown environment',pg_temp.checkout_binding()||'{"environment":"TEST"}'),
  ('lowercase environment',pg_temp.checkout_binding()||'{"environment":"sandbox"}'),
  ('environment whitespace',pg_temp.checkout_binding()||'{"environment":"SANDBOX "}');
insert into checkout_bad_bindings
select 'missing '||key,pg_temp.checkout_binding()-key from jsonb_object_keys(pg_temp.checkout_binding()) key;
insert into checkout_bad_bindings
select key||' JSON null',pg_temp.checkout_binding()||jsonb_build_object(key,null)
  from jsonb_object_keys(pg_temp.checkout_binding()) key;
create temp table checkout_bad_offers(label text,value jsonb);
insert into checkout_bad_offers values
  ('SQL null',null),('JSON null','null'),('array','[]'),('string','"offer"'),
  ('number','7'),('boolean','true'),('empty object','{}'),
  ('extra key',pg_temp.checkout_offer()||'{"unexpected":true}'),
  ('caller fingerprint',pg_temp.checkout_offer()||jsonb_build_object('request_sha256',repeat('a',64))),
  ('offering',pg_temp.checkout_offer()||'{"offering_id":"pro"}'),
  ('package',pg_temp.checkout_offer()||'{"package_id":"$rc_annual"}'),
  ('product',pg_temp.checkout_offer()||'{"product_id":"prompted.pro.monthly"}'),
  ('currency',pg_temp.checkout_offer()||'{"currency":"AUD"}'),
  ('lowercase currency',pg_temp.checkout_offer()||'{"currency":"usd"}'),
  ('amount below agreement',pg_temp.checkout_offer()||'{"amount_micros":49999999}'),
  ('amount above agreement',pg_temp.checkout_offer()||'{"amount_micros":50000001}'),
  ('fractional amount',pg_temp.checkout_offer()||'{"amount_micros":50000000.5}'),
  ('amount string',pg_temp.checkout_offer()||'{"amount_micros":"50000000"}'),
  ('amount boolean',pg_temp.checkout_offer()||'{"amount_micros":true}'),
  ('amount null',pg_temp.checkout_offer()||'{"amount_micros":null}'),
  ('annual period',pg_temp.checkout_offer()||'{"period":"P1Y"}'),
  ('numeric period',pg_temp.checkout_offer()||'{"period":1}'),
  ('trial',pg_temp.checkout_offer()||'{"trial":{"period":"P1W"}}'),
  ('introductory price',pg_temp.checkout_offer()||'{"intro_price":1000000}'),
  ('discount',pg_temp.checkout_offer()||'{"discount":false}');
insert into checkout_bad_offers
select 'missing '||key,pg_temp.checkout_offer()-key from jsonb_object_keys(pg_temp.checkout_offer()) key;
insert into checkout_bad_offers
select field||' '||bad.label,pg_temp.checkout_offer()||jsonb_build_object(field,bad.value)
from unnest(array['option_id','price_id']) field cross join (values
  ('empty','""'::jsonb),('JSON null','null'::jsonb),('number','12'::jsonb),
  ('object','{}'::jsonb),('array','[]'::jsonb),('boolean','true'::jsonb),
  ('over 200 characters',to_jsonb(repeat('x',201))),('leading space',to_jsonb(' synthetic'::text)),
  ('over 200 UTF-16 units',to_jsonb(repeat('😀',101))),
  ('trailing space',to_jsonb('synthetic '::text)),('internal space',to_jsonb('synthetic choice'::text)),
  ('tab',to_jsonb('synthetic'||chr(9)||'choice')),('newline',to_jsonb('synthetic'||chr(10))),
  ('carriage return',to_jsonb('synthetic'||chr(13))),('control byte',to_jsonb('synthetic'||chr(1))),
  ('delete control',to_jsonb('synthetic'||chr(127))),('C1 control',to_jsonb('synthetic'||chr(133))),
  ('nonbreaking space',to_jsonb('synthetic'||chr(160))),('Unicode line separator',to_jsonb('synthetic'||chr(8232))),
  ('Unicode byte order mark',to_jsonb('synthetic'||chr(65279)))) bad(label,value);
grant select on checkout_bad_bindings,checkout_bad_offers to service_role;
set local role service_role;
select is(pg_temp.checkout_error(pg_temp.checkout_user(4),pg_temp.checkout_operation(4),
  value,pg_temp.checkout_offer()),pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),
  'reject server binding: '||label) from checkout_bad_bindings;
select is(pg_temp.checkout_error(pg_temp.checkout_user(4),pg_temp.checkout_operation(4),
  pg_temp.checkout_binding(),value),pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),
  'reject offer terms: '||label) from checkout_bad_offers;
select is(pg_temp.checkout_error(null,pg_temp.checkout_operation(4),pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),'reserve requires an owner UUID');
select is(pg_temp.checkout_error(pg_temp.checkout_user(4),null,pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),'reserve requires an operation UUID');
select is(pg_temp.checkout_error(bad_id,pg_temp.checkout_operation(4),pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),
  'reserve rejects unsupported owner UUID '||bad_id::text)
from unnest(array['00000000-0000-0000-0000-000000000000'::uuid,
  '95100000-0000-9000-8000-000000000004','95100000-0000-4000-7000-000000000004']) bad_id;
select is(pg_temp.checkout_error(pg_temp.checkout_user(4),bad_id,pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),
  'reserve rejects unsupported operation UUID '||bad_id::text)
from unnest(array['00000000-0000-0000-0000-000000000000'::uuid,
  '95100000-0000-9000-8000-000000000104','95100000-0000-4000-7000-000000000104']) bad_id;
reset role;
select is((select count(*) from private.business_checkout_attempts where user_id=pg_temp.checkout_user(4)),
  0::bigint,'malformed commands leave a fresh owner without a reservation');

set local role service_role;
insert into checkout_receipts values ('max-choice',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(23),pg_temp.checkout_operation(23),pg_temp.checkout_binding(),
  pg_temp.checkout_offer()||jsonb_build_object('option_id',repeat('界',200),'price_id',repeat('p',200))));
insert into checkout_receipts values ('min-choice',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(24),'95100000-0000-8000-b000-000000000124'::uuid,pg_temp.checkout_binding(),
  pg_temp.checkout_offer()||'{"option_id":"o","price_id":"p"}'));
insert into checkout_receipts values ('astral-choice',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(37),pg_temp.checkout_operation(37),pg_temp.checkout_binding(),
  pg_temp.checkout_offer()||jsonb_build_object('option_id',repeat('😀',100),'price_id','opaque:/._-$9~+=@')));
insert into checkout_receipts values ('numeric-creation',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(25),pg_temp.checkout_operation(25),pg_temp.checkout_binding(),
  pg_temp.checkout_offer()||'{"amount_micros":50000000.0}'));
insert into checkout_receipts values ('phone-confirmed',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(20),pg_temp.checkout_operation(20),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
select is(pg_temp.checkout_error(pg_temp.checkout_user(n),pg_temp.checkout_operation(n),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_USER_UNAVAILABLE'),
  label||' cannot reserve') from (values (5,'unconfirmed Auth user'),(6,'anonymous Auth user'),(99,'missing Auth user')) v(n,label);
reset role;
select is((select value->'attempt'->'offer_snapshot' from checkout_receipts where label='max-choice'),
  pg_temp.checkout_offer()||jsonb_build_object('option_id',repeat('界',200),'price_id',repeat('p',200)),
  '200-character opaque choices are retained verbatim rather than trimmed or byte-truncated');
select is((select value->>'outcome' from checkout_receipts where label='min-choice'),'created',
  'one-character choices and supported version-eight operation UUIDs remain valid');
select is((select value->'attempt'->'offer_snapshot' from checkout_receipts where label='astral-choice'),
  pg_temp.checkout_offer()||jsonb_build_object('option_id',repeat('😀',100),'price_id','opaque:/._-$9~+=@'),
  'exactly 200 UTF-16 units and bounded opaque punctuation retain their original identities');
select is((select value#>>'{attempt,offer_snapshot,amount_micros}' from checkout_receipts where label='numeric-creation'),
  '50000000','fresh admission canonicalizes equivalent numeric scale before persistence and fingerprinting');
select is((select value->>'outcome' from checkout_receipts where label='phone-confirmed'),'created',
  'a confirmed nonanonymous phone identity does not require email confirmation too');

select set_config('request.jwt.claim.sub',pg_temp.checkout_user(1)::text,true);
set local role authenticated;
select is(pg_temp.checkout_sql_error(format('select public.read_own_business_checkout_attempt_v1(%L::uuid)',bad_id)),
  pg_temp.checkout_expected_error('22023','BUSINESS_CHECKOUT_INPUT_INVALID'),
  'owner read rejects unsupported explicit operation UUID '||bad_id::text)
from unnest(array['00000000-0000-0000-0000-000000000000'::uuid,
  '95100000-0000-9000-8000-000000000104','95100000-0000-4000-7000-000000000104']) bad_id;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()'),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_FORBIDDEN'),
  'owner recovery requires a current authenticated subject');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(5)::text,true);
set local role authenticated;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()'),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_USER_UNAVAILABLE'),
  'owner recovery refuses an unconfirmed Auth identity');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(6)::text,true);
set local role authenticated;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()'),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_USER_UNAVAILABLE'),
  'owner recovery refuses an anonymous Auth identity');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(99)::text,true);
set local role authenticated;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()'),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_USER_UNAVAILABLE'),
  'a stale token for a missing Auth user cannot read recovery evidence');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
set local role authenticated;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()'),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_USER_UNAVAILABLE'),
  'unsupported Auth-derived owner identity cannot become a recovery authority');
reset role;

-- JWT role text is deliberately wrong here: the selected SQL role remains the
-- boundary. The error helper retains exact product errors where execution is
-- granted; privilege denials are asserted by SQLSTATE rather than server wording.
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(1)::text,true);
set local role authenticated;
select is(pg_temp.checkout_error(pg_temp.checkout_user(4),pg_temp.checkout_operation(4),
  pg_temp.checkout_binding(),pg_temp.checkout_offer())->>'sqlstate','42501',
  'an authenticated caller cannot reserve by spoofing a service JWT role');
select is(pg_temp.checkout_sql_error('select * from private.business_checkout_attempts')->>'sqlstate','42501',
  'an authenticated owner cannot read the private table directly');
reset role;
set local role anon;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()')->>'sqlstate','42501',
  'the anonymous role cannot invoke recovery even with another subject in JWT settings');
reset role;
set local role service_role;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()')->>'sqlstate','42501',
  'service callers cannot use an owner JWT setting to invoke owner recovery');
select is(pg_temp.checkout_sql_error(statement)->>'sqlstate','42501',description)
from (values
  ('insert into private.business_checkout_attempts default values','service direct INSERT is denied'),
  ('update private.business_checkout_attempts set state=state','service direct UPDATE is denied'),
  ('delete from private.business_checkout_attempts','service direct DELETE is denied'),
  ('truncate private.business_checkout_attempts','service direct TRUNCATE is denied')) v(statement,description);
reset role;
select is(pg_temp.checkout_sql_error(statement),
  pg_temp.checkout_expected_error('55000','BUSINESS_CHECKOUT_ATTEMPT_IMMUTABLE'),description)
from (values
  ('update private.business_checkout_attempts set state=state where user_id=''95100000-0000-4000-8000-000000000002''',
    'even privileged no-op updates cannot refresh an unresolved reservation'),
  ('update private.business_checkout_attempts set offer_snapshot=offer_snapshot||''{"option_id":"replacement"}'' where user_id=''95100000-0000-4000-8000-000000000002''',
    'privileged offer rewrites cannot change an immutable attempt'),
  ('delete from private.business_checkout_attempts where user_id=''95100000-0000-4000-8000-000000000002''',
    'privileged deletes cannot forget an unresolved obligation')) v(statement,description);
select is((select to_jsonb(a) from private.business_checkout_attempts a where user_id=pg_temp.checkout_user(2)),
  (select value from checkout_snapshots where label='created-row'),
  'the full original attempt row is unchanged after recovery and denied mutations');
select is(pg_temp.checkout_billing_state(),
  (select value from checkout_snapshots where label='billing-before-core'),
  'reservation, replay, blocking, recovery and malformed calls change no subscriptions, usage, events or access');

-- Billing eligibility is read from the existing authority. Isolate each kind
-- of local evidence so checking only the commercial/effective plan cannot pass.
insert into public.subscriptions(user_id,plan,status) values
  (pg_temp.checkout_user(7),'pro','active'),
  (pg_temp.checkout_user(10),'business','expired'),
  (pg_temp.checkout_user(11),'free','active'),
  (pg_temp.checkout_user(12),'free','active'),
  (pg_temp.checkout_user(14),'business','active'),
  (pg_temp.checkout_user(19),'free','active'),
  (pg_temp.checkout_user(26),'free','active'),
  (pg_temp.checkout_user(27),'free','active'),
  (pg_temp.checkout_user(28),'free','active'),
  (pg_temp.checkout_user(29),'free','active'),
  (pg_temp.checkout_user(30),'free','active'),
  (pg_temp.checkout_user(31),'free','active'),
  (pg_temp.checkout_user(32),'free','active'),
  (pg_temp.checkout_user(33),'free','active'),
  (pg_temp.checkout_user(34),'free','expired'),
  (pg_temp.checkout_user(35),'premium','cancelled'),
  (pg_temp.checkout_user(36),'premium','trialing');
update public.subscriptions set revenuecat_customer_id='synthetic-historical-customer' where user_id=pg_temp.checkout_user(11);
update public.subscriptions set revenuecat_event_id='CHECKOUT-HISTORICAL-EVENT' where user_id=pg_temp.checkout_user(12);
update public.subscriptions set entitlements='{"business":true}' where user_id=pg_temp.checkout_user(14);
update public.subscriptions set billing_issue=true where user_id=pg_temp.checkout_user(26);
update public.subscriptions set will_renew=false where user_id=pg_temp.checkout_user(27);
update public.subscriptions set period_start='2020-01-01T00:00:00Z' where user_id=pg_temp.checkout_user(28);
update public.subscriptions set period_end='2020-02-01T00:00:00Z' where user_id=pg_temp.checkout_user(29);
update public.subscriptions set pending_product_id='synthetic-prior-product' where user_id=pg_temp.checkout_user(30);
update public.subscriptions set entitlements='{"retired-entitlement":false}' where user_id=pg_temp.checkout_user(31);
insert into public.businesses(id,owner_user_id,trading_name)
values('95100000-0000-4000-8000-000000000500',pg_temp.checkout_user(32),'Synthetic checkout history business');
update public.subscriptions set business_id='95100000-0000-4000-8000-000000000500' where user_id=pg_temp.checkout_user(32);
update public.subscriptions set revenuecat_event_timestamp_ms=1700000000000 where user_id=pg_temp.checkout_user(33);

set local role service_role;
select is(public.apply_revenuecat_webhook_event(pg_temp.checkout_event(
  'CHECKOUT-EXPIRATION','EXPIRATION',pg_temp.checkout_user(13),1700000000200))->>'outcome','applied',
  'the canonical webhook creates the expired Free billing-history fixture');
select is(public.apply_revenuecat_webhook_event(jsonb_build_object(
  'api_version','1.0','id','CHECKOUT-TRANSFER','type','TRANSFER','event_timestamp_ms',1700000000300,
  'transferred_from_user_ids',jsonb_build_array(pg_temp.checkout_user(14)),
  'transferred_to_user_id',pg_temp.checkout_user(15)))->>'outcome','applied',
  'the canonical webhook records source and destination in one transfer receipt');
select is(public.apply_revenuecat_webhook_event(pg_temp.checkout_event(
  'CHECKOUT-ALIAS','SUBSCRIBER_ALIAS',pg_temp.checkout_user(18),1700000000200)||
  '{"aliases":["synthetic-checkout-alias"]}')->>'outcome','recorded',
  'a canonical alias audit fixture changes no subscription state');
insert into checkout_receipts values ('before-paid-history',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(21),pg_temp.checkout_operation(21),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
select is(public.apply_revenuecat_webhook_event(pg_temp.checkout_event(
  'CHECKOUT-LATE-PURCHASE','INITIAL_PURCHASE',pg_temp.checkout_user(21),1700000000200))->>'outcome','applied',
  'a later canonical purchase can advance subscription authority independently of a pending reservation');
reset role;
select is((select plan||':'||status from public.subscriptions where user_id=pg_temp.checkout_user(13)),
  'free:expired','EXPIRATION really rewrites commercial plan to Free');
select ok((select related_user_ids @> array[pg_temp.checkout_user(14),pg_temp.checkout_user(15)]
  and subject_user_id=pg_temp.checkout_user(15) from public.revenuecat_webhook_events where event_id='CHECKOUT-TRANSFER'),
  'the source is related history while the destination is the transfer subject');
-- Simulate retained immutable receipts after historical subscription cleanup.
-- This makes receipt-only refusal observable instead of relying on paid rows.
delete from public.subscriptions where user_id in (pg_temp.checkout_user(14),pg_temp.checkout_user(15));
insert into public.revenuecat_webhook_events(event_id,event_type,event_timestamp_ms,api_version,
  subject_user_id,related_user_ids,payload_sha256,normalized_event,disposition,state_applied)
select 'CHECKOUT-STALE-RENEWAL','RENEWAL',1700000000000,'1.0',pg_temp.checkout_user(16),
  array[pg_temp.checkout_user(16)],encode(extensions.digest(convert_to(event::text,'UTF8'),'sha256'),'hex'),
  event,'stale',false from (select pg_temp.checkout_event(
    'CHECKOUT-STALE-RENEWAL','RENEWAL',pg_temp.checkout_user(16),1700000000000) event) fixture;
-- Historical audit rows can contain an owner association without establishing
-- paid access. TEST remains an exemption even when its IDs match the caller.
insert into public.revenuecat_webhook_events(event_id,event_type,event_timestamp_ms,api_version,
  subject_user_id,related_user_ids,payload_sha256,normalized_event,disposition,state_applied)
select 'CHECKOUT-TEST-AUDIT','TEST',1700000000000,'1.0',pg_temp.checkout_user(17),
  array[pg_temp.checkout_user(17)],encode(extensions.digest(convert_to(event::text,'UTF8'),'sha256'),'hex'),
  event,'recorded',false from (select pg_temp.checkout_event(
    'CHECKOUT-TEST-AUDIT','TEST',pg_temp.checkout_user(17),1700000000000) event) fixture;
insert into checkout_snapshots values ('billing-before-history-checks',pg_temp.checkout_billing_state());

set local role service_role;
select is(pg_temp.checkout_error(pg_temp.checkout_user(n),pg_temp.checkout_operation(n),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('P0001','BUSINESS_CHECKOUT_NOT_ELIGIBLE'),
  'fresh checkout refuses '||label)
from (values
  (7,'active paid access'),(8,'independent owner access'),(10,'expired historical Business'),
  (11,'a retained customer identity on Free'),(12,'a retained event identity on Free'),
  (13,'Free rewritten by EXPIRATION'),(14,'receipt-only transfer source history'),
  (15,'receipt-only transfer destination history'),(16,'a stale lifecycle receipt without a subscription'),
  (26,'a retained billing issue'),(27,'explicit nonrenewal history'),(28,'a previous billing start'),
  (29,'a previous billing end'),(30,'a pending product identity'),(31,'retained entitlement evidence'),
  (32,'a business subscription association'),(33,'a retained event timestamp'),
  (34,'an expired Free history row'),(35,'cancelled historical Premium'),(36,'trialing paid access')) v(n,label);
insert into checkout_receipts values ('test-audit-eligible',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(17),pg_temp.checkout_operation(17),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('alias-audit-eligible',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(18),pg_temp.checkout_operation(18),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('clean-free-eligible',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(19),pg_temp.checkout_operation(19),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('replay-after-paid-history',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(21),pg_temp.checkout_operation(21),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
insert into checkout_receipts values ('blocked-after-paid-history',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(21),pg_temp.checkout_operation(40),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
reset role;
select is(value->>'outcome','created',label||' does not manufacture a previous paid purchase')
  from checkout_receipts where label in ('test-audit-eligible','alias-audit-eligible','clean-free-eligible');
select is((select value from checkout_receipts where label='replay-after-paid-history'),
  (select value||'{"outcome":"replay","dispatch_permitted":false}'::jsonb from checkout_receipts where label='before-paid-history'),
  'new paid access cannot reissue permission or erase the original unresolved attempt');
select is((select value from checkout_receipts where label='blocked-after-paid-history'),
  (select value||jsonb_build_object('outcome','blocked','dispatch_permitted',false,
    'requested_operation_id',pg_temp.checkout_operation(40)) from checkout_receipts where label='before-paid-history'),
  'a different operation remains blocked by the unresolved attempt after billing changes');
select is(pg_temp.checkout_billing_state(),
  (select value from checkout_snapshots where label='billing-before-history-checks'),
  'billing-history eligibility checks and replays preserve complete subscriptions, usage, receipts and access');

-- Admission fences stop both fresh work and replay, while recovery remains
-- visible to the existing confirmed owner. Auth deletion cannot cascade away
-- the immutable obligation or allow a stale token to read it.
set local role service_role;
select public.begin_account_deletion_fence(pg_temp.checkout_user(1));
select public.begin_account_deletion_fence(pg_temp.checkout_user(9));
select is(pg_temp.checkout_error(pg_temp.checkout_user(1),pg_temp.checkout_operation(1),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('P0001','ACCOUNT_DELETION_FENCED'),
  'a deletion fence rejects even an exact reservation replay');
select is(pg_temp.checkout_error(pg_temp.checkout_user(1),pg_temp.checkout_operation(40),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('P0001','ACCOUNT_DELETION_FENCED'),
  'a deletion fence takes precedence over an existing unresolved attempt');
select is(pg_temp.checkout_error(pg_temp.checkout_user(9),pg_temp.checkout_operation(9),
  pg_temp.checkout_binding(),pg_temp.checkout_offer()),
  pg_temp.checkout_expected_error('P0001','ACCOUNT_DELETION_FENCED'),
  'a fresh fenced owner cannot reserve');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(1)::text,true);
set local role authenticated;
select is(public.read_own_business_checkout_attempt_v1(pg_temp.checkout_operation(1)),
  (select value from checkout_receipts where label='read-exact'),
  'an established fence does not remove exact owner recovery evidence');
select is(public.read_own_business_checkout_attempt_v1(),
  (select value from checkout_receipts where label='read-recovery'),
  'null-operation recovery also remains available after a fence');
reset role;
select is(pg_temp.checkout_billing_state(),
  (select value from checkout_snapshots where label='billing-before-history-checks'),
  'fenced admission and owner recovery leave subscriptions, usage, receipts and access unchanged');
set local role service_role;
insert into checkout_receipts values ('before-auth-delete',public.reserve_business_checkout_attempt_v1(
  pg_temp.checkout_user(22),pg_temp.checkout_operation(22),pg_temp.checkout_binding(),pg_temp.checkout_offer()));
select public.begin_account_deletion_fence(pg_temp.checkout_user(22));
reset role;
insert into checkout_snapshots values ('before-auth-delete-row',
  (select to_jsonb(a) from private.business_checkout_attempts a where user_id=pg_temp.checkout_user(22)));
delete from auth.users where id=pg_temp.checkout_user(22);
select is((select to_jsonb(a) from private.business_checkout_attempts a where user_id=pg_temp.checkout_user(22)),
  (select value from checkout_snapshots where label='before-auth-delete-row'),
  'actual Auth deletion retains every immutable attempt field and original owner UUID');
select set_config('request.jwt.claim.sub',pg_temp.checkout_user(22)::text,true);
set local role authenticated;
select is(pg_temp.checkout_sql_error('select public.read_own_business_checkout_attempt_v1()'),
  pg_temp.checkout_expected_error('42501','BUSINESS_CHECKOUT_USER_UNAVAILABLE'),
  'a deleted owner token cannot read the retained private obligation');
reset role;
select is((select count(*) from private.business_checkout_attempts where user_id=pg_temp.checkout_user(9)),
  0::bigint,'fenced fresh admission leaves no reservation');
select is((select to_jsonb(a) from private.business_checkout_attempts a where user_id=pg_temp.checkout_user(1)),
  (select value from checkout_snapshots where label='initial-row'),
  'fencing and recovery never alter the original unresolved reservation');
select is(pg_temp.checkout_billing_state(),
  (select jsonb_set(value,'{access}',
    (select jsonb_agg(item order by item->>'user_id')
      from jsonb_array_elements(value->'access') item
      where item->>'user_id' <> pg_temp.checkout_user(22)::text))
    from checkout_snapshots where label='billing-before-history-checks'),
  'only the deliberately deleted Auth identity leaves access; all other billing evidence remains unchanged');

select * from finish();
rollback;
