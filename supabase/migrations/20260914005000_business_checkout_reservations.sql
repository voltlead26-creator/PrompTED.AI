-- Dormant checkout admission only. No SDK dispatch, entitlement write, expiry,
-- release or resolution is enabled by this migration. A reservation remains
-- unresolved until a separately reviewed provider-proof boundary exists.
begin;

create function private.business_checkout_uuid_valid_v1(p_value uuid)
returns boolean
language sql immutable set search_path = ''
as $function$
  select coalesce(p_value::text ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false)
$function$;

create function private.business_checkout_identifier_valid_v1(p_value jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $function$
declare
  v_text text;
  v_code integer;
  v_units integer := 0;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then
    return false;
  end if;
  v_text := p_value #>> '{}';
  if pg_catalog.char_length(v_text) not between 1 and 200 then
    return false;
  end if;
  -- Match the SDK boundary's 200 UTF-16-unit limit without trimming identities.
  -- Explicit code points make whitespace/control rejection locale independent.
  for v_index in 1..pg_catalog.char_length(v_text) loop
    v_code := pg_catalog.ascii(pg_catalog.substr(v_text, v_index, 1));
    if v_code <= 32 or v_code between 127 and 160
      or v_code in (5760, 8232, 8233, 8239, 8287, 12288, 65279)
      or v_code between 8192 and 8202 then
      return false;
    end if;
    v_units := v_units + case when v_code > 65535 then 2 else 1 end;
    if v_units > 200 then return false; end if;
  end loop;
  return true;
end;
$function$;

create function private.business_checkout_terms_valid_v1(
  p_server_binding jsonb,
  p_offer_snapshot jsonb
)
returns boolean
language plpgsql immutable set search_path = ''
as $function$
begin
  if pg_catalog.jsonb_typeof(p_server_binding) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_offer_snapshot) is distinct from 'object' then
    return false;
  end if;
  if pg_catalog.octet_length(p_server_binding::text) > 1024
    or pg_catalog.octet_length(p_offer_snapshot::text) > 4096
    or not (p_server_binding ?& array[
      'contract_version', 'project_id', 'app_id', 'environment'
    ])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_server_binding)) <> 4
    or not (p_offer_snapshot ?& array[
      'offering_id', 'package_id', 'product_id', 'option_id', 'price_id',
      'currency', 'amount_micros', 'period', 'trial', 'intro_price', 'discount'
    ])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_offer_snapshot)) <> 11 then
    return false;
  end if;
  return coalesce(
    p_server_binding->'contract_version' = '"business-checkout.1"'::jsonb
    and p_server_binding->'project_id' = '"proj12b68907"'::jsonb
    and p_server_binding->'app_id' = '"app0e160cafea"'::jsonb
    and p_server_binding->'environment' in ('"SANDBOX"'::jsonb, '"PRODUCTION"'::jsonb)
    and p_offer_snapshot->'offering_id' = '"business"'::jsonb
    and p_offer_snapshot->'package_id' = '"$rc_monthly"'::jsonb
    and p_offer_snapshot->'product_id' = '"prompted.business.monthly"'::jsonb
    and private.business_checkout_identifier_valid_v1(p_offer_snapshot->'option_id')
    and private.business_checkout_identifier_valid_v1(p_offer_snapshot->'price_id')
    and p_offer_snapshot->'currency' = '"USD"'::jsonb
    and pg_catalog.jsonb_typeof(p_offer_snapshot->'amount_micros') = 'number'
    and p_offer_snapshot->'amount_micros' = '50000000'::jsonb
    and p_offer_snapshot->'period' = '"P1M"'::jsonb
    and p_offer_snapshot->'trial' = 'null'::jsonb
    and p_offer_snapshot->'intro_price' = 'null'::jsonb
    and p_offer_snapshot->'discount' = 'null'::jsonb,
    false
  );
end;
$function$;

create function private.business_checkout_request_sha256_v1(
  p_user_id uuid,
  p_operation_id uuid,
  p_server_binding jsonb,
  p_offer_snapshot jsonb
)
returns text
language sql immutable set search_path = ''
as $function$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'contract_version', 'business-checkout.1',
      'user_id', p_user_id,
      'operation_id', p_operation_id,
      'server_binding', p_server_binding,
      'offer_snapshot', p_offer_snapshot
    )::text, 'UTF8'), 'sha256'), 'hex')
$function$;

create table private.business_checkout_attempts (
  -- Retain the verified UUID even after Auth deletion, like webhook receipts.
  -- A cascading Auth foreign key would destroy unresolved charge evidence.
  user_id uuid not null check (private.business_checkout_uuid_valid_v1(user_id)),
  operation_id uuid not null check (private.business_checkout_uuid_valid_v1(operation_id)),
  server_binding jsonb not null,
  offer_snapshot jsonb not null,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
    check (pg_catalog.isfinite(created_at)),
  state text not null default 'unresolved' check (state = 'unresolved'),
  primary key (user_id, operation_id),
  check (private.business_checkout_terms_valid_v1(server_binding, offer_snapshot)),
  -- Numeric scale is canonicalized only after the RPC validates a JSON number.
  check (offer_snapshot->>'amount_micros' = '50000000'),
  check (request_sha256 = private.business_checkout_request_sha256_v1(
    user_id, operation_id, server_binding, offer_snapshot
  ))
);

create unique index business_checkout_attempts_owner_unresolved_idx
  on private.business_checkout_attempts(user_id) where state = 'unresolved';

comment on table private.business_checkout_attempts is
  'Immutable owner-bound checkout admission evidence. Only fresh insertion permits dispatch; no timeout, cancellation, read, replay or Free access response resolves an attempt.';

alter table private.business_checkout_attempts enable row level security;
revoke all on table private.business_checkout_attempts
  from public, anon, authenticated, service_role;

create function private.reject_business_checkout_attempt_mutation_v1()
returns trigger
language plpgsql set search_path = ''
as $function$
begin
  raise exception 'BUSINESS_CHECKOUT_ATTEMPT_IMMUTABLE' using errcode = '55000';
end;
$function$;

create trigger business_checkout_attempts_immutable
  before update or delete on private.business_checkout_attempts
  for each row execute function private.reject_business_checkout_attempt_mutation_v1();

create function private.business_checkout_attempt_projection_v1(
  p_attempt private.business_checkout_attempts
)
returns jsonb
language sql stable set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'user_id', (p_attempt).user_id,
    'operation_id', (p_attempt).operation_id,
    'server_binding', (p_attempt).server_binding,
    'offer_snapshot', (p_attempt).offer_snapshot,
    'request_sha256', (p_attempt).request_sha256,
    'created_at', pg_catalog.to_char(
      (p_attempt).created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'state', (p_attempt).state
  )
$function$;

create function public.reserve_business_checkout_attempt_v1(
  p_user_id uuid,
  p_operation_id uuid,
  p_server_binding jsonb,
  p_offer_snapshot jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_user auth.users%rowtype;
  v_attempt private.business_checkout_attempts%rowtype;
  v_offer_snapshot jsonb;
  v_request_sha256 text;
  v_access jsonb;
begin
  -- current_user is the definer here; the selected SQL request role is the
  -- same service boundary used by get_effective_product_access_v1.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'BUSINESS_CHECKOUT_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.business_checkout_uuid_valid_v1(p_user_id)
    or not private.business_checkout_uuid_valid_v1(p_operation_id)
    or not private.business_checkout_terms_valid_v1(p_server_binding, p_offer_snapshot) then
    raise exception 'BUSINESS_CHECKOUT_INPUT_INVALID' using errcode = '22023';
  end if;
  -- JSON 50000000 and 50000000.0 have equal approved value but different text.
  -- Normalize this one validated number so equivalent retries have one digest.
  v_offer_snapshot := pg_catalog.jsonb_set(
    p_offer_snapshot, '{amount_micros}', '50000000'::jsonb, false
  );
  v_request_sha256 := private.business_checkout_request_sha256_v1(
    p_user_id, p_operation_id, p_server_binding, v_offer_snapshot
  );

  -- Match existing webhook and account-deletion locks. Keep Auth before attempt
  -- rows; a future receipt linker must separately preserve the full lock order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('revenuecat-user:' || p_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if exists (
    select 1 from private.account_deletion_fences
    where user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED' using errcode = 'P0001';
  end if;
  select * into v_user from auth.users where id = p_user_id for share;
  if not found or v_user.is_anonymous is distinct from false
    or (v_user.email_confirmed_at is null and v_user.phone_confirmed_at is null) then
    raise exception 'BUSINESS_CHECKOUT_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  select * into v_attempt from private.business_checkout_attempts
    where user_id = p_user_id and operation_id = p_operation_id for update;
  if found then
    if v_attempt.server_binding is distinct from p_server_binding
      or v_attempt.offer_snapshot is distinct from v_offer_snapshot
      or v_attempt.request_sha256 is distinct from v_request_sha256 then
      raise exception 'BUSINESS_CHECKOUT_OPERATION_CONFLICT' using errcode = 'P0001';
    end if;
    -- Replay never regains dispatch permission, even if access has since changed.
    return pg_catalog.jsonb_build_object(
      'contract_version', 'business-checkout.1', 'outcome', 'replay',
      'user_id', p_user_id, 'requested_operation_id', p_operation_id,
      'dispatch_permitted', false,
      'attempt', private.business_checkout_attempt_projection_v1(v_attempt)
    );
  end if;

  select * into v_attempt from private.business_checkout_attempts
    where user_id = p_user_id and state = 'unresolved' for update;
  if found then
    return pg_catalog.jsonb_build_object(
      'contract_version', 'business-checkout.1', 'outcome', 'blocked',
      'user_id', p_user_id, 'requested_operation_id', p_operation_id,
      'dispatch_permitted', false,
      'attempt', private.business_checkout_attempt_projection_v1(v_attempt)
    );
  end if;

  v_access := private.resolve_product_access_v1(p_user_id);
  if v_access->>'access_profile' is distinct from 'subscription'
    or v_access->>'effective_plan' is distinct from 'free'
    or exists (
      select 1 from public.subscriptions s where s.user_id = p_user_id and (
        s.plan is distinct from 'free' or s.status is distinct from 'active'
        or s.business_id is not null or s.revenuecat_customer_id is not null
        or s.entitlements is distinct from '{}'::jsonb
        or s.period_start is not null or s.period_end is not null
        or s.revenuecat_event_timestamp_ms is not null or s.revenuecat_event_id is not null
        or s.will_renew is not null or s.billing_issue is distinct from false
        or s.pending_product_id is not null
      )
    )
    or exists (
      select 1 from public.revenuecat_webhook_events e
      where e.event_type not in ('TEST', 'SUBSCRIBER_ALIAS')
        and (e.subject_user_id = p_user_id or p_user_id = any(e.related_user_ids))
    ) then
    raise exception 'BUSINESS_CHECKOUT_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;

  -- This proves local admission only. No local history is not proof that a
  -- customer has no remote charge; the dormant RPC must not activate checkout.
  insert into private.business_checkout_attempts (
    user_id, operation_id, server_binding, offer_snapshot, request_sha256
  ) values (
    p_user_id, p_operation_id, p_server_binding, v_offer_snapshot, v_request_sha256
  ) returning * into v_attempt;
  return pg_catalog.jsonb_build_object(
    'contract_version', 'business-checkout.1', 'outcome', 'created',
    'user_id', p_user_id, 'requested_operation_id', p_operation_id,
    'dispatch_permitted', true,
    'attempt', private.business_checkout_attempt_projection_v1(v_attempt)
  );
end;
$function$;

create function public.read_own_business_checkout_attempt_v1(p_operation_id uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_user auth.users%rowtype;
  v_attempt private.business_checkout_attempts%rowtype;
  v_projection jsonb := null;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'authenticated' then
    raise exception 'BUSINESS_CHECKOUT_FORBIDDEN' using errcode = '42501';
  end if;
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'BUSINESS_CHECKOUT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_operation_id is not null and not private.business_checkout_uuid_valid_v1(p_operation_id) then
    raise exception 'BUSINESS_CHECKOUT_INPUT_INVALID' using errcode = '22023';
  end if;
  if not private.business_checkout_uuid_valid_v1(v_user_id) then
    raise exception 'BUSINESS_CHECKOUT_USER_UNAVAILABLE' using errcode = '42501';
  end if;
  select * into v_user from auth.users where id = v_user_id for share;
  if not found or v_user.is_anonymous is distinct from false
    or (v_user.email_confirmed_at is null and v_user.phone_confirmed_at is null) then
    raise exception 'BUSINESS_CHECKOUT_USER_UNAVAILABLE' using errcode = '42501';
  end if;

  -- A current owner may recover evidence after a deletion fence starts. This
  -- read grants neither a new dispatch nor permission to clear the reservation.
  select * into v_attempt from private.business_checkout_attempts
    where user_id = v_user_id and (
      (p_operation_id is null and state = 'unresolved') or operation_id = p_operation_id
    );
  if found then
    v_projection := private.business_checkout_attempt_projection_v1(v_attempt);
  end if;
  return pg_catalog.jsonb_build_object(
    'contract_version', 'business-checkout.1', 'user_id', v_user_id,
    'requested_operation_id', p_operation_id, 'dispatch_permitted', false,
    'attempt', v_projection
  );
end;
$function$;

revoke all on function private.business_checkout_uuid_valid_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.business_checkout_identifier_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.business_checkout_terms_valid_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.business_checkout_request_sha256_v1(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.reject_business_checkout_attempt_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.business_checkout_attempt_projection_v1(private.business_checkout_attempts)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_business_checkout_attempt_v1(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_business_checkout_attempt_v1(uuid, uuid, jsonb, jsonb)
  to service_role;
revoke all on function public.read_own_business_checkout_attempt_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_own_business_checkout_attempt_v1(uuid)
  to authenticated;

commit;
