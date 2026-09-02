begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(66);

create or replace function pg_temp.revenuecat_event(
  p_id text,
  p_type text,
  p_timestamp bigint,
  p_user_id uuid,
  p_entitlements jsonb default '["pro"]'::jsonb,
  p_extra jsonb default '{}'::jsonb
) returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'api_version', '1.0',
    'id', p_id,
    'type', p_type,
    'event_timestamp_ms', p_timestamp,
    'app_user_id', p_user_id,
    'entitlement_ids', p_entitlements,
    'expiration_at_ms', 1900000000000,
    'purchased_at_ms', 1700000000000,
    'period_type', 'NORMAL',
    'product_id', 'prompted.pro.monthly'
  ) || p_extra
$function$;

create or replace function pg_temp.revenuecat_call_fails(
  p_event jsonb,
  p_pattern text
) returns boolean
language plpgsql
as $function$
begin
  perform public.apply_revenuecat_webhook_event(p_event);
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

create or replace function pg_temp.revenuecat_sql_fails(
  p_sql text,
  p_pattern text
) returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

select has_table(
  'public',
  'revenuecat_webhook_events',
  'the immutable RevenueCat receipt table exists'
);
select has_function(
  'public',
  'apply_revenuecat_webhook_event',
  array['jsonb'],
  'the atomic RevenueCat ingestion RPC exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.apply_revenuecat_webhook_event(jsonb)',
    'EXECUTE'
  ),
  'the protected webhook role can execute the ingestion RPC'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_revenuecat_webhook_event(jsonb)',
    'EXECUTE'
  ),
  'authenticated browsers cannot execute the ingestion RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.apply_revenuecat_webhook_event(jsonb)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the ingestion RPC'
);
select ok(
  exists (
    select 1
    from pg_proc procedure_record
    join pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname = 'apply_revenuecat_webhook_event'
      and procedure_record.prosecdef
      and coalesce(procedure_record.proconfig, '{}'::text[]) &&
        array['search_path=', 'search_path=""']::text[]
  ),
  'the ingestion RPC is SECURITY DEFINER with an empty search path'
);
select ok(
  has_table_privilege('service_role', 'public.subscriptions', 'SELECT')
    and not has_table_privilege('service_role', 'public.subscriptions', 'INSERT')
    and not has_table_privilege('service_role', 'public.subscriptions', 'UPDATE')
    and not has_table_privilege('service_role', 'public.subscriptions', 'DELETE'),
  'service-role subscription access is read-only outside the RPC'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.revenuecat_webhook_events',
    'SELECT'
  ) and not has_table_privilege(
    'service_role',
    'public.revenuecat_webhook_events',
    'INSERT'
  ) and not has_table_privilege(
    'service_role',
    'public.revenuecat_webhook_events',
    'UPDATE'
  ) and not has_table_privilege(
    'service_role',
    'public.revenuecat_webhook_events',
    'DELETE'
  ),
  'the immutable receipt table is reachable only through the RPC'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('91000000-0000-4000-8000-000000000001', 'revenuecat-one@example.invalid', false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'revenuecat-source@example.invalid', false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000003', 'revenuecat-destination@example.invalid', false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000004', 'revenuecat-no-state@example.invalid', false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000005', 'revenuecat-tie-forward@example.invalid', false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000006', 'revenuecat-tie-reverse@example.invalid', false, false, now(), now());

set local role service_role;

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-initial',
      'INITIAL_PURCHASE',
      1800000000000,
      '91000000-0000-4000-8000-000000000001'
    )
  )->>'outcome',
  'applied',
  'an initial purchase is atomically applied through the service boundary'
);

reset role;

select is(
  (
    select concat_ws(':', plan, status, will_renew::text, billing_issue::text)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'pro:active:true:false',
  'initial purchase grants the mapped entitlement state'
);
select is(
  (
    select concat_ws(':', event_type, disposition, state_applied::text)
    from public.revenuecat_webhook_events
    where event_id = 'evt-initial'
  ),
  'INITIAL_PURCHASE:applied:true',
  'the initial purchase has one immutable applied receipt'
);
select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-initial',
      'INITIAL_PURCHASE',
      1800000000000,
      '91000000-0000-4000-8000-000000000001'
    )
  )->>'outcome',
  'duplicate',
  'a retried event id is idempotently acknowledged'
);
select is(
  (
    select count(*)::integer
    from public.revenuecat_webhook_events
    where event_id = 'evt-initial'
  ),
  1,
  'a duplicate delivery creates no second receipt'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-renewal',
      'RENEWAL',
      1800000000100,
      '91000000-0000-4000-8000-000000000001',
      '["premium"]'::jsonb,
      '{"product_id":"prompted.premium.annual"}'::jsonb
    )
  )->>'outcome',
  'applied',
  'a causally newer renewal is applied'
);
select is(
  (
    select concat_ws(':', plan, status, revenuecat_event_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'premium:active:evt-renewal',
  'renewal replaces the effective plan and advances the event clock'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-stale-expiration',
      'EXPIRATION',
      1800000000050,
      '91000000-0000-4000-8000-000000000001',
      '[]'::jsonb
    )
  )->>'outcome',
  'stale',
  'an out-of-order expiration is durably classified as stale'
);
select is(
  (
    select concat_ws(':', plan, status, revenuecat_event_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'premium:active:evt-renewal',
  'out-of-order delivery cannot regress the current entitlement'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-tie-z',
      'RENEWAL',
      1800000000150,
      '91000000-0000-4000-8000-000000000005',
      '["premium"]'::jsonb
    )
  )->>'outcome',
  'applied',
  'the lexically greater same-millisecond event can arrive first'
);
select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-tie-a',
      'INITIAL_PURCHASE',
      1800000000150,
      '91000000-0000-4000-8000-000000000005',
      '["pro"]'::jsonb
    )
  )->>'outcome',
  'stale',
  'the lower event-id tie-breaker cannot overwrite the converged state'
);
select is(
  (
    select concat_ws(':', plan, revenuecat_event_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000005'
  ),
  'premium:evt-tie-z',
  'forward same-millisecond delivery converges on the greater event id'
);
select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-reverse-a',
      'INITIAL_PURCHASE',
      1800000000150,
      '91000000-0000-4000-8000-000000000006',
      '["pro"]'::jsonb
    )
  )->>'outcome',
  'applied',
  'the lower same-millisecond event can arrive first in reverse delivery'
);
select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-reverse-z',
      'RENEWAL',
      1800000000150,
      '91000000-0000-4000-8000-000000000006',
      '["premium"]'::jsonb
    )
  )->>'outcome',
  'applied',
  'the greater event-id tie-breaker supersedes reverse delivery'
);
select is(
  (
    select concat_ws(':', plan, revenuecat_event_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000006'
  ),
  'premium:evt-reverse-z',
  'reverse same-millisecond delivery converges on the same ordered outcome'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-product-change',
      'PRODUCT_CHANGE',
      1800000000200,
      '91000000-0000-4000-8000-000000000001',
      '["premium"]'::jsonb,
      '{"new_product_id":"prompted.business.annual"}'::jsonb
    )
  )->>'outcome',
  'applied',
  'a product change is accepted without pre-empting its effective renewal'
);
select is(
  (
    select concat_ws(':', plan, status, pending_product_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'premium:active:prompted.business.annual',
  'product change preserves current access and records the pending product'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-cancellation',
      'CANCELLATION',
      1800000000300,
      '91000000-0000-4000-8000-000000000001',
      '["premium"]'::jsonb,
      '{"cancel_reason":"UNSUBSCRIBE"}'::jsonb
    )
  )->>'outcome',
  'applied',
  'a cancellation is recorded as a future-renewal change'
);
select is(
  (
    select concat_ws(':', plan, status, will_renew::text)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'premium:active:false',
  'cancellation does not revoke access before expiration'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-billing-issue',
      'BILLING_ISSUE',
      1800000000400,
      '91000000-0000-4000-8000-000000000001',
      '["premium"]'::jsonb,
      '{"grace_period_expiration_at_ms":1950000000000}'::jsonb
    )
  )->>'outcome',
  'applied',
  'a billing issue is captured without treating it as expiration'
);
select is(
  (
    select concat_ws(':', plan, status, billing_issue::text)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'premium:active:true',
  'billing issue retains entitlement while flagging payment risk'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-alias',
      'type', 'SUBSCRIBER_ALIAS',
      'event_timestamp_ms', 1800000000500,
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'aliases', array['$RCAnonymousID:synthetic']
    )
  )->>'outcome',
  'recorded',
  'the deprecated alias event is retained for provenance'
);
select is(
  (
    select revenuecat_event_timestamp_ms
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  1800000000400::bigint,
  'alias provenance does not advance the entitlement state clock'
);
select is(
  public.apply_revenuecat_webhook_event(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-dashboard-test',
      'type', 'TEST',
      'event_timestamp_ms', 1800000000550
    )
  )->>'outcome',
  'recorded',
  'the official dashboard TEST event receives a durable no-op receipt'
);
select ok(
  exists (
    select 1
    from public.revenuecat_webhook_events
    where event_id = 'evt-dashboard-test'
      and subject_user_id is null
      and disposition = 'recorded'
      and not state_applied
  ),
  'dashboard TEST is auditable without inventing a local subscriber subject'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-source-purchase',
      'INITIAL_PURCHASE',
      1800000000100,
      '91000000-0000-4000-8000-000000000002'
    )
  )->>'outcome',
  'applied',
  'the transfer source starts with an active subscription'
);
select is(
  public.apply_revenuecat_webhook_event(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-transfer',
      'type', 'TRANSFER',
      'event_timestamp_ms', 1800000000200,
      'transferred_from_user_ids', array['91000000-0000-4000-8000-000000000002'],
      'transferred_to_user_id', '91000000-0000-4000-8000-000000000003'
    )
  )->>'outcome',
  'applied',
  'a mapped transfer moves local entitlement state atomically'
);
select is(
  (
    select concat_ws(':', plan, status, revenuecat_event_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000002'
  ),
  'free:expired:evt-transfer',
  'transfer revokes the mapped source in the same transaction'
);
select is(
  (
    select concat_ws(':', plan, status, revenuecat_event_id)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000003'
  ),
  'pro:active:evt-transfer',
  'transfer grants the merged state to the mapped destination'
);

select is(
  public.apply_revenuecat_webhook_event(
    pg_temp.revenuecat_event(
      'evt-expiration',
      'EXPIRATION',
      1800000000300,
      '91000000-0000-4000-8000-000000000003',
      '[]'::jsonb
    )
  )->>'outcome',
  'applied',
  'a causally newer expiration is applied'
);
select is(
  (
    select concat_ws(':', plan, status, entitlements::text)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000003'
  ),
  'free:expired:{}',
  'expiration is the lifecycle event that revokes access'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_temp.revenuecat_event(
      'evt-initial',
      'INITIAL_PURCHASE',
      1800000000999,
      '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_EVENT_ID_CONFLICT:%'
  ),
  'reusing an event id for different normalized content fails closed'
);
select is(
  (
    select count(*)::integer
    from public.revenuecat_webhook_events
    where event_id = 'evt-initial'
  ),
  1,
  'an event-id conflict cannot modify the immutable receipt'
);
select ok(
  pg_temp.revenuecat_call_fails(
    '{"api_version":"1.0","id":"evt-malformed","type":"RENEWAL","event_timestamp_ms":1800000000600}'::jsonb,
    'REVENUECAT_EVENT_INVALID%'
  ),
  'a malformed mapped event fails closed in the SQL trust boundary'
);
select is(
  (
    select count(*)::integer
    from public.revenuecat_webhook_events
    where event_id = 'evt-malformed'
  ),
  0,
  'a malformed event leaves no partial receipt'
);
select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-unknown',
      'type', 'FUTURE_ENTITLEMENT_EVENT',
      'event_timestamp_ms', 1800000000600,
      'app_user_id', '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'an unmapped event type fails closed without acknowledgement state'
);

create or replace function pg_temp.force_revenuecat_audit_failure()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'synthetic audit failure';
end;
$function$;
create trigger revenuecat_test_audit_failure
  before insert on public.revenuecat_webhook_events
  for each row execute function pg_temp.force_revenuecat_audit_failure();

select ok(
  pg_temp.revenuecat_call_fails(
    pg_temp.revenuecat_event(
      'evt-audit-failure',
      'RENEWAL',
      1800000000600,
      '91000000-0000-4000-8000-000000000001',
      '["business"]'::jsonb
    ),
    'synthetic audit failure%'
  ),
  'an audit insertion failure aborts the atomic RPC'
);
select is(
  (
    select concat_ws(':', plan, revenuecat_event_timestamp_ms::text)
    from public.subscriptions
    where user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'premium:1800000000400',
  'audit failure rolls back the preceding subscription mutation'
);
select is(
  (
    select count(*)::integer
    from public.revenuecat_webhook_events
    where event_id = 'evt-audit-failure'
  ),
  0,
  'audit failure leaves no event receipt'
);

drop trigger revenuecat_test_audit_failure on public.revenuecat_webhook_events;

select ok(
  pg_temp.revenuecat_call_fails(
    pg_temp.revenuecat_event(
      'evt-unmapped-user',
      'RENEWAL',
      1800000000700,
      '91000000-0000-4000-8000-000000000099'
    ),
    'REVENUECAT_USER_UNMAPPED%'
  ),
  'an unmapped local user fails closed before state or audit writes'
);
select is(
  (
    select count(*)::integer
    from public.revenuecat_webhook_events
    where event_id = 'evt-unmapped-user'
  ),
  0,
  'an unmapped user leaves no partial receipt'
);
select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-transfer-missing-source',
      'type', 'TRANSFER',
      'event_timestamp_ms', 1800000000800,
      'transferred_from_user_ids', array['91000000-0000-4000-8000-000000000004'],
      'transferred_to_user_id', '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_TRANSFER_SOURCE_NOT_FOUND%'
  ),
  'a mapped identity without subscription state cannot fabricate a transfer'
);
select ok(
  pg_temp.revenuecat_call_fails(
    pg_temp.revenuecat_event(
      'evt-free-entitlement',
      'INITIAL_PURCHASE',
      1800000001000,
      '91000000-0000-4000-8000-000000000001',
      '["unmapped-tier"]'::jsonb
    ),
    'REVENUECAT_EVENT_UNMAPPED:%'
  ),
  'an unknown entitlement cannot silently map to a free purchase'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-invalid-transfer',
      'type', 'TRANSFER',
      'event_timestamp_ms', 1800000001200,
      'transferred_from_user_ids', array['91000000-0000-4000-8000-000000000001'],
      'transferred_to_user_id', '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'a self-transfer is rejected before persistence'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_temp.revenuecat_event(
      'evt-missing-product',
      'PRODUCT_CHANGE',
      1800000001300,
      '91000000-0000-4000-8000-000000000001',
      '["premium"]'::jsonb,
      '{"product_id":null}'::jsonb
    ),
    'REVENUECAT_EVENT_UNMAPPED:%'
  ),
  'a product change without a target product fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-bad-alias',
      'type', 'SUBSCRIBER_ALIAS',
      'event_timestamp_ms', 1800000001400,
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'aliases', '[]'::jsonb
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'an empty alias event fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-invalid-version',
      'type', 'RENEWAL',
      'event_timestamp_ms', 1800000001500,
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'entitlement_ids', array['premium']
    ) || '{"api_version":"2.0"}'::jsonb,
    'REVENUECAT_EVENT_INVALID%'
  ),
  'an unknown webhook API version fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-missing-transfer-source',
      'type', 'TRANSFER',
      'event_timestamp_ms', 1800000001600,
      'transferred_from_user_ids', array['91000000-0000-4000-8000-000000000099'],
      'transferred_to_user_id', '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_USER_UNMAPPED%'
  ),
  'a transfer with an unmapped identity fails before mutation'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_temp.revenuecat_event(
      'evt-invalid-time',
      'RENEWAL',
      -1,
      '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'a negative event timestamp fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-invalid-entitlements',
      'type', 'RENEWAL',
      'event_timestamp_ms', 1800000001700,
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'entitlement_ids', 'not-an-array'
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'a malformed entitlement collection fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-alias-unmapped-user',
      'type', 'SUBSCRIBER_ALIAS',
      'event_timestamp_ms', 1800000001800,
      'app_user_id', '91000000-0000-4000-8000-000000000099',
      'aliases', array['synthetic']
    ),
    'REVENUECAT_USER_UNMAPPED%'
  ),
  'alias provenance cannot be attached to an unmapped local user'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-transfer-empty',
      'type', 'TRANSFER',
      'event_timestamp_ms', 1800000001900,
      'transferred_from_user_ids', '[]'::jsonb,
      'transferred_to_user_id', '91000000-0000-4000-8000-000000000001'
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'a transfer without a mapped source fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-invalid-id with spaces',
      'type', 'RENEWAL',
      'event_timestamp_ms', 1800000002000,
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'entitlement_ids', array['premium']
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'an invalid event id fails before the idempotency boundary'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-too-new',
      'type', 'RENEWAL',
      'event_timestamp_ms', 8640000000000001,
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'entitlement_ids', array['premium']
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'an out-of-range event timestamp fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-invalid-user',
      'type', 'RENEWAL',
      'event_timestamp_ms', 1800000002100,
      'app_user_id', 'not-a-uuid',
      'entitlement_ids', array['premium']
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'a malformed local identity fails closed'
);

select ok(
  pg_temp.revenuecat_call_fails(
    pg_catalog.jsonb_build_object(
      'api_version', '1.0',
      'id', 'evt-missing-timestamp',
      'type', 'RENEWAL',
      'app_user_id', '91000000-0000-4000-8000-000000000001',
      'entitlement_ids', array['premium']
    ),
    'REVENUECAT_EVENT_INVALID%'
  ),
  'an event without the canonical order timestamp fails closed'
);

select ok(
  pg_temp.revenuecat_sql_fails(
    $$update public.revenuecat_webhook_events
      set disposition = 'stale'
      where event_id = 'evt-initial'$$,
    'REVENUECAT_EVENT_IMMUTABLE:%'
  ),
  'an immutable RevenueCat receipt cannot be updated'
);
select ok(
  pg_temp.revenuecat_sql_fails(
    $$delete from public.revenuecat_webhook_events
      where event_id = 'evt-initial'$$,
    'REVENUECAT_EVENT_IMMUTABLE:%'
  ),
  'an immutable RevenueCat receipt cannot be deleted'
);

select * from finish();
rollback;
