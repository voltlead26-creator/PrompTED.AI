-- Owner product capabilities are an overlay; subscription and usage history
-- remain authoritative. No account is granted access by this migration.
begin;

create function private.resolve_product_access_v1(p_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_user auth.users%rowtype;
  v_subscription public.subscriptions%rowtype;
  v_subscription_plan text := 'free';
  v_effective_plan text := 'free';
  v_owner boolean;
  v_cap integer;
begin
  if p_user_id is null then
    raise exception 'PRODUCT_ACCESS_USER_REQUIRED' using errcode='22023';
  end if;
  select * into v_user from auth.users where id=p_user_id;
  if not found then
    raise exception 'PRODUCT_ACCESS_USER_NOT_FOUND' using errcode='22023';
  end if;
  select * into v_subscription from public.subscriptions where user_id=p_user_id
    order by updated_at desc limit 1;
  if found then
    v_subscription_plan := v_subscription.plan;
    if v_subscription.status in ('active','trialing') then
      v_effective_plan := v_subscription_plan;
    end if;
  end if;
  v_owner := coalesce(
    v_user.is_anonymous is not true
    and (v_user.email_confirmed_at is not null or v_user.phone_confirmed_at is not null)
    and jsonb_typeof(v_user.raw_app_meta_data->'prompted')='object'
    and v_user.raw_app_meta_data #> '{prompted,access_profile}' = '"owner_1000_v1"'::jsonb,
    false);
  -- Preserve the existing database/Edge commercial ceilings. The separately
  -- reported UI-policy discrepancy is not resolved by granting owner access.
  v_cap := case when v_owner then 1000 else case v_effective_plan
    when 'pro' then 20 when 'premium' then 40 when 'business' then 1000 else 3 end end;
  return jsonb_build_object(
    'contract_version','product-access.1','user_id',p_user_id,
    'subscription_plan',v_subscription_plan,'effective_plan',v_effective_plan,
    'subscription_status',v_subscription.status,'current_period_end',v_subscription.period_end,
    'access_profile',case when v_owner then 'owner' else 'subscription' end,
    'monthly_document_cap',v_cap,
    'ai_editing',v_owner or v_effective_plan in ('pro','premium','business'),
    'business_features',v_owner or v_effective_plan='business');
end;
$function$;
revoke all on function private.resolve_product_access_v1(uuid) from public,anon,authenticated,service_role;

create function public.get_effective_product_access_v1(p_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_user_id uuid;
begin
  -- PostgreSQL's selected request role is the authority, not a body field or
  -- user-editable metadata. Service callers name a UUID; browser callers own it.
  if current_setting('role',true) = 'service_role' then
    v_user_id := p_user_id;
  else
    v_user_id := auth.uid();
    if v_user_id is null or (p_user_id is not null and p_user_id <> v_user_id) then
      raise exception 'PRODUCT_ACCESS_FORBIDDEN' using errcode='42501';
    end if;
  end if;
  return private.resolve_product_access_v1(v_user_id);
end;
$function$;
revoke all on function public.get_effective_product_access_v1(uuid) from public,anon;
grant execute on function public.get_effective_product_access_v1(uuid) to authenticated,service_role;

create or replace function private.document_plan_snapshot(p_user_id uuid)
returns table(plan text,monthly_cap integer)
language sql stable security definer set search_path = '' as $function$
  select access->>'effective_plan',(access->>'monthly_document_cap')::integer
    from (select private.resolve_product_access_v1(p_user_id) as access) resolved
$function$;

alter table private.document_allowance_reservations
  add column access_profile text not null default 'subscription'
    check (access_profile in ('subscription','owner'));
alter table private.document_allowance_reservations add constraint allowance_access_cap_consistent
  check ((access_profile='owner' and monthly_cap=1000)
    or (access_profile='subscription' and monthly_cap is not null and monthly_cap>0));

create function private.preserve_allowance_access_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.plan is distinct from old.plan or new.monthly_cap is distinct from old.monthly_cap
    or new.access_profile is distinct from old.access_profile then
    raise exception 'ALLOWANCE_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$function$;
revoke all on function private.preserve_allowance_access_snapshot() from public,anon,authenticated,service_role;
create trigger preserve_allowance_access_snapshot before update on private.document_allowance_reservations
  for each row execute function private.preserve_allowance_access_snapshot();

create or replace function private.reserve_document_allowance_core(
  p_user_id uuid,
  p_request_id text,
  p_route_key text,
  p_request_sha256 text,
  p_plan text,
  p_monthly_cap integer,
  p_ttl_seconds integer,
  p_captured_operation_id uuid default null,
  p_captured_operation_expires_at timestamptz default null,
  p_renew_captured boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_existing_period_start timestamptz;
  v_existing private.document_allowance_reservations%rowtype;
  v_reservation private.document_allowance_reservations%rowtype;
  v_legacy_usage public.usage_ledger%rowtype;
  v_attempt integer;
  v_committed integer;
  v_expiry timestamptz;
  v_access jsonb;
  v_owner boolean;
begin
  if p_user_id is null
    or p_request_id is null
    or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception 'ALLOWANCE_REQUEST_ID_INVALID';
  end if;
  if p_route_key is null
    or p_route_key !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'ALLOWANCE_REQUEST_IDENTITY_INVALID';
  end if;
  if p_plan is null
    or p_plan not in ('free', 'pro', 'premium', 'business')
    or p_monthly_cap is null
    or p_monthly_cap < 1
    or p_ttl_seconds is null
    or p_ttl_seconds not between 60 and 7200 then
    raise exception 'ALLOWANCE_SNAPSHOT_INVALID';
  end if;
  -- Serialize admission with existing account erasure and metadata revocation.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,91000));
  perform 1 from auth.users where id=p_user_id for share;
  v_access := private.resolve_product_access_v1(p_user_id);
  v_owner := v_access->>'access_profile'='owner';
  if v_owner then
    p_plan := v_access->>'effective_plan';
    p_monthly_cap := 1000;
  else
    -- A revoked owner or downgraded subscription cannot reuse a larger stale
    -- guard snapshot. Preserve callers' stricter reservation limits.
    p_plan := v_access->>'effective_plan';
    p_monthly_cap := least(p_monthly_cap,(v_access->>'monthly_document_cap')::integer);
  end if;

  if p_captured_operation_id is null and p_renew_captured then
    raise exception 'ALLOWANCE_CAPTURED_RENEWAL_INVALID';
  end if;
  if p_captured_operation_id is not null
    and p_captured_operation_expires_at is null then
    raise exception 'ALLOWANCE_CAPTURED_OPERATION_EXPIRY_REQUIRED';
  end if;

  v_period_start := private.document_allowance_period_start(v_now);
  v_period_end := v_period_start + interval '1 month';
  perform private.document_allowance_lock(p_user_id, v_period_start);

  -- Only legacy, non-captured reservations expire automatically. A captured
  -- operation has already been durably admitted, so its reservation remains
  -- tied to the immutable operation expiry rather than a shorter worker lease.
  update private.document_allowance_reservations reservation_record
  set status = 'expired',
      release_code = 'reservation_expired',
      released_at = v_now,
      updated_at = v_now
  where reservation_record.user_id = p_user_id
    and reservation_record.billing_period_start = v_period_start
    and reservation_record.status = 'reserved'
    and reservation_record.captured_operation_id is null
    and reservation_record.expires_at <= v_now;

  select * into v_existing
  from private.document_allowance_reservations reservation_record
  where reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id
  order by reservation_record.attempt_number desc
  limit 1;

  if found then
    -- An exact request may outlive a UTC month boundary.  Lock its frozen
    -- billing period before reading or changing that admission; settlement and
    -- release use the same lock.  The current-period lock remains held if a
    -- released/expired request proceeds to a new attempt in the new period.
    v_existing_period_start := v_existing.billing_period_start;
    if v_existing_period_start <> v_period_start then
      perform private.document_allowance_lock(p_user_id, v_existing_period_start);
      select * into v_existing
      from private.document_allowance_reservations reservation_record
      where reservation_record.user_id = p_user_id
        and reservation_record.request_id = p_request_id
      order by reservation_record.attempt_number desc
      limit 1;
      if not found then
        raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND';
      end if;
    end if;

    if v_existing.route_key <> p_route_key
      or v_existing.request_sha256 <> p_request_sha256
      or v_existing.captured_operation_id is distinct from p_captured_operation_id then
      raise exception 'ALLOWANCE_REQUEST_REPLAY_CONFLICT';
    end if;

    if v_existing.status = 'settled' then
      return jsonb_build_object(
        'reservation_id', v_existing.id,
        'state', 'settled',
        'provider_permitted', false,
        'idempotent_replay', true,
        'expires_at', v_existing.expires_at
      );
    end if;

    if v_existing.status = 'reserved'
      and v_existing.captured_operation_id is null
      and v_existing.expires_at <= v_now then
      update private.document_allowance_reservations
      set status = 'expired',
          release_code = 'reservation_expired',
          released_at = v_now,
          updated_at = v_now
      where id = v_existing.id
      returning * into v_existing;
    elsif v_existing.status = 'reserved' then
      if p_renew_captured
        and v_existing.captured_operation_id = p_captured_operation_id then
        v_expiry := p_captured_operation_expires_at;
        if v_expiry <= v_now then
          raise exception 'ALLOWANCE_CAPTURED_OPERATION_EXPIRED';
        end if;
        update private.document_allowance_reservations
        set expires_at = v_expiry,
            updated_at = v_now
        where id = v_existing.id
        returning * into v_existing;
        return jsonb_build_object(
          'reservation_id', v_existing.id,
          'state', 'reserved',
          'provider_permitted', true,
          'idempotent_replay', true,
          'expires_at', v_existing.expires_at
        );
      end if;

      return jsonb_build_object(
        'reservation_id', v_existing.id,
        'state', 'reserved',
        'provider_permitted', false,
        'idempotent_replay', true,
        'expires_at', v_existing.expires_at
      );
    end if;
  end if;

  -- Requests settled before this migration are still exact replays.  Never
  -- run the provider again merely because they lack a reservation row.
  select * into v_legacy_usage
  from public.usage_ledger usage_record
  where usage_record.user_id = p_user_id
    and usage_record.event_type = 'document_created'
    and usage_record.generation_request_id = p_request_id
  order by usage_record.created_at asc
  limit 1;
  if found then
    return jsonb_build_object(
      'reservation_id', null,
      'state', 'settled',
      'provider_permitted', false,
      'idempotent_replay', true,
      'usage_ledger_id', v_legacy_usage.id,
      'expires_at', null
    );
  end if;

  select count(*)::integer into v_committed
  from (
    select reservation_record.id
    from private.document_allowance_reservations reservation_record
    where reservation_record.user_id = p_user_id
      and reservation_record.billing_period_start = v_period_start
      and reservation_record.billing_period_end = v_period_end
      and (
        reservation_record.status = 'settled'
        or (
          reservation_record.status = 'reserved'
          and (
            (
              reservation_record.captured_operation_id is null
              and reservation_record.expires_at > v_now
            )
            or exists (
              select 1
              from private.captured_document_operations operation_record
              where operation_record.id = reservation_record.captured_operation_id
                and operation_record.user_id = reservation_record.user_id
                and operation_record.expires_at > v_now
                and operation_record.status not in (
                  'ready_for_review', 'terminal_failure', 'cancelled'
                )
            )
          )
        )
      )
    union all
    select usage_record.id
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.event_type = 'document_created'
      and usage_record.created_at >= v_period_start
      and usage_record.created_at < v_period_end
      and not exists (
        select 1
        from private.document_allowance_reservations linked_reservation
        where linked_reservation.usage_ledger_id = usage_record.id
      )
  ) committed_or_reserved;

  if v_committed >= p_monthly_cap then
    raise exception 'ALLOWANCE_CAP_REACHED';
  end if;

  select coalesce(max(reservation_record.attempt_number), 0) + 1
  into v_attempt
  from private.document_allowance_reservations reservation_record
  where reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id;

  v_expiry := case
    when p_captured_operation_id is not null then
      p_captured_operation_expires_at
    else v_now + pg_catalog.make_interval(secs => p_ttl_seconds)
  end;
  if v_expiry <= v_now then
    raise exception 'ALLOWANCE_RESERVATION_EXPIRY_INVALID';
  end if;

  insert into private.document_allowance_reservations(
    user_id, request_id, attempt_number, route_key, request_sha256,
    plan, monthly_cap, billing_period_start, billing_period_end,
    status, expires_at, captured_operation_id, access_profile
  ) values (
    p_user_id, p_request_id, v_attempt, p_route_key, p_request_sha256,
    p_plan, p_monthly_cap, v_period_start, v_period_end,
    'reserved', v_expiry, p_captured_operation_id, v_access->>'access_profile'
  ) returning * into v_reservation;

  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'state', v_reservation.status,
    'provider_permitted', true,
    'idempotent_replay', false,
    'expires_at', v_reservation.expires_at,
    'plan', v_reservation.plan,
    'monthly_cap', v_reservation.monthly_cap,
    'billing_period_start', v_reservation.billing_period_start,
    'billing_period_end', v_reservation.billing_period_end
  );
end;
$function$;



comment on column private.document_allowance_reservations.access_profile is
  'Frozen product-access admission evidence; commercial plan and usage remain genuine. Revocation affects new admission, not historical records.';
commit;
