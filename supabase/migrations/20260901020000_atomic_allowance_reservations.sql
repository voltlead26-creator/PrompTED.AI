-- Atomic admission and settlement for every allowance-consuming generation.
--
-- A usage count followed by provider work is inherently racy: concurrent
-- requests can all observe the same remaining credit.  Reservations make the
-- admission decision inside one short transaction protected by a per-user,
-- per-UTC-billing-period advisory lock.  Provider work happens only after that
-- transaction commits.  A second short transaction appends the usage-ledger
-- row and settles the reservation together; user-visible success is therefore
-- impossible when allowance persistence fails.

begin;

create table private.document_allowance_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null
    check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  attempt_number integer not null check (attempt_number > 0),
  route_key text not null
    check (route_key ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  plan text not null check (plan in ('free', 'pro', 'premium', 'business')),
  monthly_cap integer not null check (monthly_cap > 0),
  billing_period_start timestamptz not null,
  billing_period_end timestamptz not null,
  status text not null default 'reserved'
    check (status in ('reserved', 'settled', 'released', 'expired')),
  expires_at timestamptz not null,
  usage_ledger_id uuid,
  captured_operation_id uuid,
  release_code text,
  reserved_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id, attempt_number),
  unique (usage_ledger_id),
  foreign key (usage_ledger_id, user_id)
    references public.usage_ledger(id, user_id) on delete restrict,
  foreign key (captured_operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade
    deferrable initially deferred,
  check (billing_period_end > billing_period_start),
  check (expires_at > reserved_at),
  check (char_length(coalesce(release_code, '')) <= 120),
  check (
    (status = 'reserved'
      and usage_ledger_id is null
      and settled_at is null
      and released_at is null)
    or
    (status = 'settled'
      and usage_ledger_id is not null
      and settled_at is not null
      and released_at is null)
    or
    (status in ('released', 'expired')
      and usage_ledger_id is null
      and settled_at is null
      and released_at is not null)
  )
);

comment on table private.document_allowance_reservations is
  'Short pre-provider allowance admission. Frozen plan/cap/request identity is settled exactly once with usage_ledger or explicitly released/expired.';

create unique index document_allowance_reservations_live_request_unique
  on private.document_allowance_reservations(user_id, request_id)
  where status in ('reserved', 'settled');

create unique index document_allowance_reservations_live_captured_unique
  on private.document_allowance_reservations(captured_operation_id)
  where captured_operation_id is not null
    and status in ('reserved', 'settled');

create index document_allowance_reservations_cap_lookup_idx
  on private.document_allowance_reservations(
    user_id, billing_period_start, billing_period_end, status, expires_at
  );

create index document_allowance_reservations_captured_lookup_idx
  on private.document_allowance_reservations(captured_operation_id, attempt_number desc)
  where captured_operation_id is not null;

alter table private.document_allowance_reservations enable row level security;
revoke all on private.document_allowance_reservations
  from public, anon, authenticated, service_role;

create or replace function private.document_allowance_period_start(
  p_at timestamptz
) returns timestamptz
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC'
$function$;

create or replace function private.document_allowance_lock(
  p_user_id uuid,
  p_period_start timestamptz
) returns void
language sql
volatile
set search_path = ''
as $function$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'document-allowance:' || p_user_id::text || ':' || p_period_start::text,
      0
    )
  )
$function$;

create or replace function private.document_plan_snapshot(p_user_id uuid)
returns table(plan text, monthly_cap integer)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_plan text;
begin
  select lower(subscription_record.plan)
  into v_plan
  from public.subscriptions subscription_record
  where subscription_record.user_id = p_user_id
    and subscription_record.status in ('active', 'trialing')
  order by subscription_record.updated_at desc
  limit 1;

  v_plan := case
    when v_plan in ('free', 'pro', 'premium', 'business') then v_plan
    else 'free'
  end;

  plan := v_plan;
  monthly_cap := case v_plan
    when 'pro' then 20
    when 'premium' then 40
    when 'business' then 1000
    else 3
  end;
  return next;
end;
$function$;

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
    or p_monthly_cap is null or p_monthly_cap < 1
    or p_ttl_seconds is null
    or p_ttl_seconds not between 60 and 7200 then
    raise exception 'ALLOWANCE_SNAPSHOT_INVALID';
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
    status, expires_at, captured_operation_id
  ) values (
    p_user_id, p_request_id, v_attempt, p_route_key, p_request_sha256,
    p_plan, p_monthly_cap, v_period_start, v_period_end,
    'reserved', v_expiry, p_captured_operation_id
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

create or replace function public.reserve_document_allowance(
  p_user_id uuid,
  p_request_id text,
  p_route_key text,
  p_request_sha256 text,
  p_plan text,
  p_monthly_cap integer,
  p_ttl_seconds integer default 1800
) returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.reserve_document_allowance_core(
    p_user_id, p_request_id, p_route_key, p_request_sha256,
    p_plan, p_monthly_cap, p_ttl_seconds, null, null, false
  )
$function$;

create or replace function public.settle_document_allowance(
  p_user_id uuid,
  p_reservation_id uuid,
  p_request_id text,
  p_task text,
  p_provider text,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_usage_id uuid;
begin
  if p_user_id is null or p_reservation_id is null
    or p_request_id is null
    or p_task is null or p_task !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    or p_provider is null or p_provider <> 'openai'
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0 then
    raise exception 'ALLOWANCE_SETTLEMENT_INPUT_INVALID';
  end if;

  select reservation_record.billing_period_start into v_period_start
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;

  perform private.document_allowance_lock(p_user_id, v_period_start);
  select * into v_reservation
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id
  for update;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;

  if v_reservation.status = 'settled' then
    return jsonb_build_object(
      'reservation_id', v_reservation.id,
      'state', 'settled',
      'usage_ledger_id', v_reservation.usage_ledger_id,
      'idempotent_replay', true
    );
  end if;
  if v_reservation.status <> 'reserved' then
    raise exception 'ALLOWANCE_RESERVATION_NOT_SETTLEABLE:%', v_reservation.status;
  end if;
  if v_reservation.expires_at <= v_now then
    raise exception 'ALLOWANCE_RESERVATION_EXPIRED';
  end if;

  insert into public.usage_ledger(
    user_id, event_type, generation_request_id, task, provider,
    input_tokens, output_tokens, created_at
  ) values (
    p_user_id, 'document_created', p_request_id, p_task, p_provider,
    p_input_tokens, p_output_tokens, v_now
  )
  on conflict on constraint usage_ledger_model_call_dedupe do nothing
  returning id into v_usage_id;

  if v_usage_id is null then
    select usage_record.id into v_usage_id
    from public.usage_ledger usage_record
    where usage_record.user_id = p_user_id
      and usage_record.generation_request_id = p_request_id
      and usage_record.event_type = 'document_created';
  end if;
  if v_usage_id is null then raise exception 'ALLOWANCE_USAGE_WRITE_FAILED'; end if;

  update private.document_allowance_reservations
  set status = 'settled',
      usage_ledger_id = v_usage_id,
      settled_at = v_now,
      updated_at = v_now
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'state', 'settled',
    'usage_ledger_id', v_reservation.usage_ledger_id,
    'idempotent_replay', false
  );
end;
$function$;

create or replace function public.release_document_allowance(
  p_user_id uuid,
  p_reservation_id uuid,
  p_request_id text,
  p_release_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_idempotent_replay boolean;
begin
  if p_user_id is null or p_reservation_id is null
    or p_request_id is null
    or p_release_code is null
    or p_release_code !~ '^[a-z0-9][a-z0-9._:-]{0,119}$' then
    raise exception 'ALLOWANCE_RELEASE_INPUT_INVALID';
  end if;

  select reservation_record.billing_period_start into v_period_start
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;

  perform private.document_allowance_lock(p_user_id, v_period_start);
  select * into v_reservation
  from private.document_allowance_reservations reservation_record
  where reservation_record.id = p_reservation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.request_id = p_request_id
  for update;
  if not found then raise exception 'ALLOWANCE_RESERVATION_NOT_FOUND'; end if;

  v_idempotent_replay := v_reservation.status <> 'reserved';
  if v_reservation.status = 'reserved' then
    update private.document_allowance_reservations
    set status = 'released',
        release_code = p_release_code,
        released_at = v_now,
        updated_at = v_now
    where id = v_reservation.id
    returning * into v_reservation;
  end if;

  return jsonb_build_object(
    'reservation_id', v_reservation.id,
    'state', v_reservation.status,
    'idempotent_replay', v_idempotent_replay
  );
end;
$function$;

-- Existing captured rows, if any, receive a compatibility reservation before
-- triggers become authoritative.  A ready row must already have the captured
-- finalizer's immutable allowance link; otherwise migration fails closed.
do $function$
begin
  if exists (
    select 1
    from private.captured_document_operations operation_record
    left join private.captured_document_allowances allowance_record
      on allowance_record.operation_id = operation_record.id
    where operation_record.status = 'ready_for_review'
      and allowance_record.usage_ledger_id is null
  ) then
    raise exception 'CAPTURED_READY_ALLOWANCE_BACKFILL_MISSING';
  end if;
end;
$function$;

insert into private.document_allowance_reservations(
  user_id, request_id, attempt_number, route_key, request_sha256,
  plan, monthly_cap, billing_period_start, billing_period_end,
  status, expires_at, usage_ledger_id, captured_operation_id,
  release_code, reserved_at, settled_at, released_at, updated_at
)
select
  operation_record.user_id,
  operation_record.idempotency_key,
  1,
  'captured-document-operation',
  operation_record.request_sha256,
  plan_snapshot.plan,
  plan_snapshot.monthly_cap,
  private.document_allowance_period_start(operation_record.created_at),
  private.document_allowance_period_start(operation_record.created_at) + interval '1 month',
  case
    when operation_record.status = 'ready_for_review' then 'settled'
    when operation_record.status in ('terminal_failure', 'cancelled') then 'released'
    else 'reserved'
  end,
  -- A captured reservation is valid for the immutable lifetime of the
  -- operation it protects.  Shortening an existing operation to a generic
  -- two-hour reservation lease would let a still-resumable operation stop
  -- counting against the user's cap after migration.
  greatest(
    operation_record.created_at + interval '1 second',
    operation_record.expires_at
  ),
  allowance_record.usage_ledger_id,
  operation_record.id,
  case
    when operation_record.status in ('terminal_failure', 'cancelled')
      then 'captured_' || operation_record.status
    else null
  end,
  operation_record.created_at,
  case when operation_record.status = 'ready_for_review'
    then operation_record.updated_at else null end,
  case when operation_record.status in ('terminal_failure', 'cancelled')
    then coalesce(operation_record.terminal_at, operation_record.updated_at) else null end,
  operation_record.updated_at
from private.captured_document_operations operation_record
cross join lateral private.document_plan_snapshot(operation_record.user_id) plan_snapshot
left join private.captured_document_allowances allowance_record
  on allowance_record.operation_id = operation_record.id
on conflict do nothing;

-- Provider cost is distinct from the monthly completed-document allowance.
-- Record every durable terminal provider attempt exactly once, including a
-- late completion that is reconciled before owner cancellation.  This row does
-- not use event_type=document_created and therefore never consumes a document
-- credit.  The attempt write and cost row share one transaction.
insert into public.usage_ledger(
  user_id, event_type, generation_request_id, task, provider,
  input_tokens, output_tokens, created_at
)
select
  attempt_record.user_id,
  'model_call',
  'captured-attempt:' || attempt_record.id::text,
  'captured_' || attempt_record.logical_stage_key,
  attempt_record.provider,
  attempt_record.input_tokens,
  attempt_record.output_tokens,
  attempt_record.completed_at
from private.captured_document_provider_attempts attempt_record
where attempt_record.status in ('succeeded', 'failed', 'cancelled')
on conflict on constraint usage_ledger_model_call_dedupe do nothing;

create or replace function private.reconcile_captured_provider_attempt_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usage_id uuid;
begin
  if old.status <> 'prepared'
    or new.status not in ('succeeded', 'failed', 'cancelled') then
    return new;
  end if;

  insert into public.usage_ledger(
    user_id, event_type, generation_request_id, task, provider,
    input_tokens, output_tokens, created_at
  ) values (
    new.user_id,
    'model_call',
    'captured-attempt:' || new.id::text,
    'captured_' || new.logical_stage_key,
    new.provider,
    new.input_tokens,
    new.output_tokens,
    new.completed_at
  )
  on conflict on constraint usage_ledger_model_call_dedupe do nothing
  returning id into v_usage_id;

  if v_usage_id is null then
    select usage_record.id into v_usage_id
    from public.usage_ledger usage_record
    where usage_record.user_id = new.user_id
      and usage_record.event_type = 'model_call'
      and usage_record.generation_request_id =
        'captured-attempt:' || new.id::text;
  end if;
  if v_usage_id is null then
    raise exception 'CAPTURED_PROVIDER_USAGE_RECONCILIATION_FAILED';
  end if;
  return new;
end;
$function$;

create trigger captured_provider_attempt_usage_reconciliation
  after update on private.captured_document_provider_attempts
  for each row execute function private.reconcile_captured_provider_attempt_usage();

create or replace function private.release_captured_document_allowance(
  p_operation_id uuid,
  p_user_id uuid,
  p_release_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_reservation private.document_allowance_reservations%rowtype;
begin
  select * into v_reservation
  from private.document_allowance_reservations reservation_record
  where reservation_record.captured_operation_id = p_operation_id
    and reservation_record.user_id = p_user_id
    and reservation_record.status = 'reserved'
  order by reservation_record.attempt_number desc
  limit 1;
  if not found then return; end if;

  perform public.release_document_allowance(
    p_user_id, v_reservation.id, v_reservation.request_id, p_release_code
  );
end;
$function$;

create or replace function private.bind_captured_document_allowance_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation_id uuid;
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
begin
  if new.event_type <> 'document_created'
    or new.generation_request_id is null
    or new.generation_request_id !~ '^captured-operation:[0-9a-fA-F-]{36}$' then
    return new;
  end if;

  begin
    v_operation_id := substring(
      new.generation_request_id from char_length('captured-operation:') + 1
    )::uuid;
  exception when invalid_text_representation then
    raise exception 'CAPTURED_ALLOWANCE_OPERATION_ID_INVALID';
  end;

  select reservation_record.billing_period_start into v_period_start
  from private.document_allowance_reservations reservation_record
  where reservation_record.captured_operation_id = v_operation_id
    and reservation_record.user_id = new.user_id
    and reservation_record.status in ('reserved', 'settled')
  order by reservation_record.attempt_number desc
  limit 1;
  if not found then raise exception 'CAPTURED_ALLOWANCE_RESERVATION_MISSING'; end if;

  perform private.document_allowance_lock(new.user_id, v_period_start);
  select * into v_reservation
  from private.document_allowance_reservations reservation_record
  where reservation_record.captured_operation_id = v_operation_id
    and reservation_record.user_id = new.user_id
    and reservation_record.status in ('reserved', 'settled')
  order by reservation_record.attempt_number desc
  limit 1
  for update;

  if v_reservation.status = 'settled' then
    if v_reservation.usage_ledger_id <> new.id then
      raise exception 'CAPTURED_ALLOWANCE_SETTLEMENT_CONFLICT';
    end if;
    return new;
  end if;
  if v_reservation.expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_ALLOWANCE_RESERVATION_EXPIRED';
  end if;

  update private.document_allowance_reservations
  set status = 'settled',
      usage_ledger_id = new.id,
      settled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_reservation.id;
  return new;
end;
$function$;

create trigger captured_document_allowance_usage_settlement
  after insert on public.usage_ledger
  for each row execute function private.bind_captured_document_allowance_usage();

create or replace function private.enforce_captured_document_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan text;
  v_cap integer;
  v_result jsonb;
  v_reservation private.document_allowance_reservations%rowtype;
begin
  if tg_op = 'INSERT' then
    select snapshot.plan, snapshot.monthly_cap
    into v_plan, v_cap
    from private.document_plan_snapshot(new.user_id) snapshot;

    v_result := private.reserve_document_allowance_core(
      new.user_id,
      new.idempotency_key,
      'captured-document-operation',
      new.request_sha256,
      v_plan,
      v_cap,
      7200,
      new.id,
      new.expires_at,
      true
    );
    if coalesce((v_result->>'provider_permitted')::boolean, false) is not true then
      raise exception 'CAPTURED_ALLOWANCE_ADMISSION_REJECTED:%', v_result->>'state';
    end if;
    return new;
  end if;

  if new.status in ('terminal_failure', 'cancelled')
    and old.status not in ('terminal_failure', 'cancelled') then
    perform private.release_captured_document_allowance(
      new.id, new.user_id, 'captured_' || new.status
    );
    return new;
  end if;

  if new.status = 'ready_for_review' then
    select * into v_reservation
    from private.document_allowance_reservations reservation_record
    where reservation_record.captured_operation_id = new.id
      and reservation_record.user_id = new.user_id
      and reservation_record.status = 'settled'
    order by reservation_record.attempt_number desc
    limit 1;
    if not found then raise exception 'CAPTURED_ALLOWANCE_SETTLEMENT_REQUIRED'; end if;
    return new;
  end if;

  if new.status in (
    'accepted', 'awaiting_clarification', 'awaiting_capacity', 'generating',
    'validating', 'persisting', 'retryable_failure'
  ) then
    select snapshot.plan, snapshot.monthly_cap
    into v_plan, v_cap
    from private.document_plan_snapshot(new.user_id) snapshot;
    v_result := private.reserve_document_allowance_core(
      new.user_id,
      new.idempotency_key,
      'captured-document-operation',
      new.request_sha256,
      v_plan,
      v_cap,
      7200,
      new.id,
      new.expires_at,
      true
    );
    if coalesce((v_result->>'provider_permitted')::boolean, false) is not true then
      raise exception 'CAPTURED_ALLOWANCE_RENEWAL_REJECTED:%', v_result->>'state';
    end if;
  end if;
  return new;
end;
$function$;

create trigger captured_document_allowance_operation_guard
  before insert or update on private.captured_document_operations
  for each row execute function private.enforce_captured_document_allowance();

revoke all on function private.document_allowance_period_start(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.document_allowance_lock(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.document_plan_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.reserve_document_allowance_core(
  uuid, text, text, text, text, integer, integer, uuid, timestamptz, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.release_captured_document_allowance(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_captured_provider_attempt_usage()
  from public, anon, authenticated, service_role;
revoke all on function private.bind_captured_document_allowance_usage()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_captured_document_allowance()
  from public, anon, authenticated, service_role;

revoke all on function public.reserve_document_allowance(
  uuid, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_document_allowance(
  uuid, text, text, text, text, integer, integer
) to service_role;

revoke all on function public.settle_document_allowance(
  uuid, uuid, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.settle_document_allowance(
  uuid, uuid, text, text, text, integer, integer
) to service_role;

revoke all on function public.release_document_allowance(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.release_document_allowance(uuid, uuid, text, text)
  to service_role;

comment on function public.reserve_document_allowance(
  uuid, text, text, text, text, integer, integer
) is 'Service-only atomic pre-provider document allowance reservation.';
comment on function public.settle_document_allowance(
  uuid, uuid, text, text, text, integer, integer
) is 'Service-only exactly-once usage-ledger insertion and allowance settlement.';
comment on function public.release_document_allowance(uuid, uuid, text, text)
  is 'Service-only release of failed or cancelled pre-provider allowance reservations.';

commit;
