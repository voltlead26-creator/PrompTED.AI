-- RevenueCat webhook ingestion must be one short database transaction.
--
-- RevenueCat retries preserve event.id and event_timestamp_ms.  The immutable
-- event receipt below makes event.id the idempotency boundary; the per-user
-- event clock prevents delayed deliveries from regressing entitlement state.
-- RevenueCat exposes no sequence for distinct events generated in the same
-- millisecond, so event_id is a deterministic tie-breaker (not a causal claim)
-- that makes reverse delivery converge to the same final subscription state.
-- CANCELLATION and BILLING_ISSUE intentionally retain access.  Only EXPIRATION
-- revokes it.  PRODUCT_CHANGE records the pending product without pretending a
-- deferred change is already effective.

begin;

alter table public.subscriptions
  add column if not exists revenuecat_event_timestamp_ms bigint,
  add column if not exists revenuecat_event_id text,
  add column if not exists will_renew boolean,
  add column if not exists billing_issue boolean not null default false,
  add column if not exists pending_product_id text;

alter table public.subscriptions
  add constraint subscriptions_revenuecat_event_timestamp_nonnegative
    check (
      revenuecat_event_timestamp_ms is null or
      revenuecat_event_timestamp_ms >= 0
    ),
  add constraint subscriptions_revenuecat_event_id_valid
    check (
      revenuecat_event_id is null or
      revenuecat_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    ),
  add constraint subscriptions_pending_product_id_length
    check (
      pending_product_id is null or
      char_length(pending_product_id) between 1 and 200
    );

create table public.revenuecat_webhook_events (
  event_id text primary key
    check (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  event_type text not null check (
    event_type in (
      'INITIAL_PURCHASE',
      'RENEWAL',
      'PRODUCT_CHANGE',
      'CANCELLATION',
      'BILLING_ISSUE',
      'TEST',
      'SUBSCRIBER_ALIAS',
      'TRANSFER',
      'EXPIRATION'
    )
  ),
  event_timestamp_ms bigint not null check (event_timestamp_ms >= 0),
  api_version text not null check (api_version = '1.0'),
  subject_user_id uuid,
  related_user_ids uuid[] not null default '{}'::uuid[],
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  normalized_event jsonb not null check (
    pg_catalog.jsonb_typeof(normalized_event) = 'object'
  ),
  disposition text not null check (disposition in ('applied', 'stale', 'recorded')),
  state_applied boolean not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (state_applied and disposition = 'applied') or
    (not state_applied and disposition in ('stale', 'recorded'))
  )
);

comment on table public.revenuecat_webhook_events is
  'Immutable, sanitized RevenueCat event receipt. event_id is the retry idempotency key and event_timestamp_ms is the state ordering clock.';

create index revenuecat_webhook_events_subject_time_idx
  on public.revenuecat_webhook_events(subject_user_id, event_timestamp_ms desc);

alter table public.revenuecat_webhook_events enable row level security;
revoke all on table public.revenuecat_webhook_events
  from public, anon, authenticated, service_role;

create or replace function private.reject_revenuecat_webhook_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'REVENUECAT_EVENT_IMMUTABLE:%', old.event_id;
end;
$function$;

revoke all on function private.reject_revenuecat_webhook_event_mutation()
  from public, anon, authenticated, service_role;

create trigger revenuecat_webhook_events_immutable
  before update or delete on public.revenuecat_webhook_events
  for each row execute function private.reject_revenuecat_webhook_event_mutation();

create or replace function public.apply_revenuecat_webhook_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_type text;
  v_event_id text;
  v_event_timestamp_ms bigint;
  v_payload_sha256 text;
  v_existing_sha256 text;
  v_user_id uuid;
  v_source_ids uuid[] := '{}'::uuid[];
  v_destination_id uuid;
  v_related_ids uuid[] := '{}'::uuid[];
  v_lock_user_id uuid;
  v_entitlement_ids text[] := '{}'::text[];
  v_entitlements jsonb := '{}'::jsonb;
  v_plan text := 'free';
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_grace_period_end timestamptz;
  v_current public.subscriptions%rowtype;
  v_has_current boolean := false;
  v_is_stale boolean := false;
  v_state_applied boolean := false;
  v_disposition text := 'recorded';
  v_pending_product_id text;
  v_source_count integer := 0;
  v_merge_record public.subscriptions%rowtype;
  v_transfer_plan text := 'free';
  v_transfer_status text := 'expired';
  v_transfer_entitlements jsonb := '{}'::jsonb;
  v_transfer_period_start timestamptz;
  v_transfer_period_end timestamptz;
  v_transfer_will_renew boolean := false;
  v_transfer_billing_issue boolean := false;
  v_transfer_pending_product_id text;
begin
  if p_event is null or pg_catalog.jsonb_typeof(p_event) <> 'object' then
    raise exception 'REVENUECAT_EVENT_INVALID';
  end if;

  v_type := p_event ->> 'type';
  v_event_id := p_event ->> 'id';
  if (p_event ->> 'api_version') is distinct from '1.0'
    or v_type is null
    or v_type not in (
      'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'CANCELLATION',
      'BILLING_ISSUE', 'TEST', 'SUBSCRIBER_ALIAS', 'TRANSFER', 'EXPIRATION'
    )
    or v_event_id is null
    or v_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or coalesce(p_event ->> 'event_timestamp_ms', '') !~ '^[0-9]{1,16}$' then
    raise exception 'REVENUECAT_EVENT_INVALID';
  end if;

  v_event_timestamp_ms := (p_event ->> 'event_timestamp_ms')::bigint;
  if v_event_timestamp_ms > 8640000000000000 then
    raise exception 'REVENUECAT_EVENT_INVALID';
  end if;

  v_payload_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_event::text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- Serialize duplicate deliveries before any state lock or mutation. Hash
  -- collisions merely serialize unrelated events; they do not merge them.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('revenuecat-event:' || v_event_id, 0)
  );
  select event_record.payload_sha256
    into v_existing_sha256
  from public.revenuecat_webhook_events event_record
  where event_record.event_id = v_event_id;
  if found then
    if v_existing_sha256 <> v_payload_sha256 then
      raise exception 'REVENUECAT_EVENT_ID_CONFLICT:%', v_event_id;
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'duplicate',
      'eventId', v_event_id,
      'stateApplied', false
    );
  end if;

  if v_type = 'TRANSFER' then
    if pg_catalog.jsonb_typeof(p_event -> 'transferred_from_user_ids') is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_event -> 'transferred_from_user_ids') < 1
      or pg_catalog.jsonb_array_length(p_event -> 'transferred_from_user_ids') > 100
      or coalesce(p_event ->> 'transferred_to_user_id', '') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_event -> 'transferred_from_user_ids') item
      where pg_catalog.jsonb_typeof(item) <> 'string'
        or (item #>> '{}') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    ) then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    select pg_catalog.array_agg(distinct (item #>> '{}')::uuid order by (item #>> '{}')::uuid)
      into v_source_ids
    from pg_catalog.jsonb_array_elements(p_event -> 'transferred_from_user_ids') item;
    v_destination_id := (p_event ->> 'transferred_to_user_id')::uuid;
    if v_destination_id = any(v_source_ids) then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    v_related_ids := pg_catalog.array_append(v_source_ids, v_destination_id);
    v_user_id := v_destination_id;
  elsif v_type = 'TEST' then
    -- Dashboard TEST is a real RevenueCat webhook event but carries no
    -- authoritative PrompTED subscriber state.
    v_user_id := null;
    v_related_ids := '{}'::uuid[];
  else
    if coalesce(p_event ->> 'app_user_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    v_user_id := (p_event ->> 'app_user_id')::uuid;
    v_related_ids := array[v_user_id];
  end if;

  for v_lock_user_id in
    select distinct user_id
    from pg_catalog.unnest(v_related_ids) user_id
    order by user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('revenuecat-user:' || v_lock_user_id::text, 0)
    );
  end loop;

  if (
    select pg_catalog.count(distinct user_record.id)
    from auth.users user_record
    where user_record.id = any(v_related_ids)
  ) <> pg_catalog.cardinality(v_related_ids) then
    raise exception 'REVENUECAT_USER_UNMAPPED';
  end if;

  if v_type in (
    'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'CANCELLATION',
    'BILLING_ISSUE', 'EXPIRATION'
  ) then
    if p_event ? 'entitlement_ids' and
      pg_catalog.jsonb_typeof(p_event -> 'entitlement_ids') <> 'array' then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    if coalesce(pg_catalog.jsonb_array_length(p_event -> 'entitlement_ids'), 0) > 100
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          coalesce(p_event -> 'entitlement_ids', '[]'::jsonb)
        ) item
        where pg_catalog.jsonb_typeof(item) <> 'string'
          or pg_catalog.char_length(item #>> '{}') not between 1 and 200
      ) then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    select coalesce(pg_catalog.array_agg(distinct item #>> '{}' order by item #>> '{}'), '{}'::text[])
      into v_entitlement_ids
    from pg_catalog.jsonb_array_elements(
      coalesce(p_event -> 'entitlement_ids', '[]'::jsonb)
    ) item;
    select coalesce(pg_catalog.jsonb_object_agg(entitlement_id, true), '{}'::jsonb)
      into v_entitlements
    from pg_catalog.unnest(v_entitlement_ids) entitlement_id;

    v_plan := case
      when v_entitlement_ids @> array['business'] then 'business'
      when v_entitlement_ids @> array['premium'] then 'premium'
      when v_entitlement_ids @> array['pro'] then 'pro'
      else 'free'
    end;

    if p_event ? 'purchased_at_ms' then
      if coalesce(p_event ->> 'purchased_at_ms', '') !~ '^[0-9]{1,16}$'
        or (p_event ->> 'purchased_at_ms')::bigint > 8640000000000000 then
        raise exception 'REVENUECAT_EVENT_INVALID';
      end if;
      v_period_start := pg_catalog.to_timestamp(
        (p_event ->> 'purchased_at_ms')::double precision / 1000.0
      );
    end if;
    if p_event ? 'expiration_at_ms' and p_event -> 'expiration_at_ms' <> 'null'::jsonb then
      if coalesce(p_event ->> 'expiration_at_ms', '') !~ '^[0-9]{1,16}$'
        or (p_event ->> 'expiration_at_ms')::bigint > 8640000000000000 then
        raise exception 'REVENUECAT_EVENT_INVALID';
      end if;
      v_period_end := pg_catalog.to_timestamp(
        (p_event ->> 'expiration_at_ms')::double precision / 1000.0
      );
    end if;
    if p_event ? 'grace_period_expiration_at_ms'
      and p_event -> 'grace_period_expiration_at_ms' <> 'null'::jsonb then
      if coalesce(p_event ->> 'grace_period_expiration_at_ms', '') !~ '^[0-9]{1,16}$'
        or (p_event ->> 'grace_period_expiration_at_ms')::bigint > 8640000000000000 then
        raise exception 'REVENUECAT_EVENT_INVALID';
      end if;
      v_grace_period_end := pg_catalog.to_timestamp(
        (p_event ->> 'grace_period_expiration_at_ms')::double precision / 1000.0
      );
    end if;

    select subscription_record.*
      into v_current
    from public.subscriptions subscription_record
    where subscription_record.user_id = v_user_id
    for update;
    v_has_current := found;
    v_is_stale := v_has_current
      and v_current.revenuecat_event_timestamp_ms is not null
      and (
        v_current.revenuecat_event_timestamp_ms > v_event_timestamp_ms
        or (
          v_current.revenuecat_event_timestamp_ms = v_event_timestamp_ms
          -- Event IDs have no causal meaning; their UTF-8 bytes provide only
          -- a stable, cross-locale tie-breaker for equal millisecond clocks.
          and pg_catalog.convert_to(
            coalesce(v_current.revenuecat_event_id, ''), 'UTF8'
          ) >= pg_catalog.convert_to(v_event_id, 'UTF8')
        )
      );

    if v_is_stale then
      v_disposition := 'stale';
    elsif v_type in ('INITIAL_PURCHASE', 'RENEWAL') then
      if v_plan = 'free' then
        raise exception 'REVENUECAT_EVENT_UNMAPPED:entitlements';
      end if;
      insert into public.subscriptions (
        user_id, plan, status, revenuecat_customer_id, entitlements,
        period_start, period_end, updated_at, revenuecat_event_timestamp_ms,
        revenuecat_event_id, will_renew, billing_issue, pending_product_id
      ) values (
        v_user_id,
        v_plan,
        case when p_event ->> 'period_type' = 'TRIAL' then 'trialing' else 'active' end,
        v_user_id::text,
        v_entitlements,
        v_period_start,
        v_period_end,
        pg_catalog.clock_timestamp(),
        v_event_timestamp_ms,
        v_event_id,
        true,
        false,
        null
      )
      on conflict (user_id) do update set
        plan = excluded.plan,
        status = excluded.status,
        revenuecat_customer_id = excluded.revenuecat_customer_id,
        entitlements = excluded.entitlements,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        updated_at = excluded.updated_at,
        revenuecat_event_timestamp_ms = excluded.revenuecat_event_timestamp_ms,
        revenuecat_event_id = excluded.revenuecat_event_id,
        will_renew = excluded.will_renew,
        billing_issue = excluded.billing_issue,
        pending_product_id = excluded.pending_product_id;
      v_state_applied := true;
      v_disposition := 'applied';
    elsif v_type = 'PRODUCT_CHANGE' then
      if not v_has_current then
        raise exception 'REVENUECAT_SUBSCRIPTION_STATE_MISSING';
      end if;
      v_pending_product_id := coalesce(
        nullif(p_event ->> 'new_product_id', ''),
        nullif(p_event ->> 'product_id', '')
      );
      if v_pending_product_id is null
        or pg_catalog.char_length(v_pending_product_id) > 200 then
        raise exception 'REVENUECAT_EVENT_UNMAPPED:product';
      end if;
      update public.subscriptions
      set pending_product_id = v_pending_product_id,
          updated_at = pg_catalog.clock_timestamp(),
          revenuecat_event_timestamp_ms = v_event_timestamp_ms,
          revenuecat_event_id = v_event_id
      where user_id = v_user_id;
      v_state_applied := true;
      v_disposition := 'applied';
    elsif v_type = 'CANCELLATION' then
      if not v_has_current and v_plan = 'free' then
        raise exception 'REVENUECAT_SUBSCRIPTION_STATE_MISSING';
      end if;
      if v_has_current then
        update public.subscriptions
        set period_end = coalesce(v_period_end, period_end),
            will_renew = false,
            billing_issue = billing_issue or
              coalesce(p_event ->> 'cancel_reason' = 'BILLING_ERROR', false),
            updated_at = pg_catalog.clock_timestamp(),
            revenuecat_event_timestamp_ms = v_event_timestamp_ms,
            revenuecat_event_id = v_event_id
        where user_id = v_user_id;
      else
        insert into public.subscriptions (
          user_id, plan, status, revenuecat_customer_id, entitlements,
          period_start, period_end, updated_at, revenuecat_event_timestamp_ms,
          revenuecat_event_id, will_renew, billing_issue
        ) values (
          v_user_id,
          v_plan,
          case when p_event ->> 'period_type' = 'TRIAL' then 'trialing' else 'active' end,
          v_user_id::text,
          v_entitlements,
          v_period_start,
          v_period_end,
          pg_catalog.clock_timestamp(),
          v_event_timestamp_ms,
          v_event_id,
          false,
          coalesce(p_event ->> 'cancel_reason' = 'BILLING_ERROR', false)
        );
      end if;
      v_state_applied := true;
      v_disposition := 'applied';
    elsif v_type = 'BILLING_ISSUE' then
      if not v_has_current and v_plan = 'free' then
        raise exception 'REVENUECAT_SUBSCRIPTION_STATE_MISSING';
      end if;
      if v_has_current then
        update public.subscriptions
        set period_end = coalesce(v_grace_period_end, v_period_end, period_end),
            billing_issue = true,
            updated_at = pg_catalog.clock_timestamp(),
            revenuecat_event_timestamp_ms = v_event_timestamp_ms,
            revenuecat_event_id = v_event_id
        where user_id = v_user_id;
      else
        insert into public.subscriptions (
          user_id, plan, status, revenuecat_customer_id, entitlements,
          period_start, period_end, updated_at, revenuecat_event_timestamp_ms,
          revenuecat_event_id, will_renew, billing_issue
        ) values (
          v_user_id,
          v_plan,
          case when p_event ->> 'period_type' = 'TRIAL' then 'trialing' else 'active' end,
          v_user_id::text,
          v_entitlements,
          v_period_start,
          coalesce(v_grace_period_end, v_period_end),
          pg_catalog.clock_timestamp(),
          v_event_timestamp_ms,
          v_event_id,
          true,
          true
        );
      end if;
      v_state_applied := true;
      v_disposition := 'applied';
    elsif v_type = 'EXPIRATION' then
      insert into public.subscriptions (
        user_id, plan, status, revenuecat_customer_id, entitlements,
        period_end, updated_at, revenuecat_event_timestamp_ms,
        revenuecat_event_id, will_renew, billing_issue, pending_product_id
      ) values (
        v_user_id,
        'free',
        'expired',
        v_user_id::text,
        '{}'::jsonb,
        v_period_end,
        pg_catalog.clock_timestamp(),
        v_event_timestamp_ms,
        v_event_id,
        false,
        false,
        null
      )
      on conflict (user_id) do update set
        plan = excluded.plan,
        status = excluded.status,
        entitlements = excluded.entitlements,
        period_end = excluded.period_end,
        updated_at = excluded.updated_at,
        revenuecat_event_timestamp_ms = excluded.revenuecat_event_timestamp_ms,
        revenuecat_event_id = excluded.revenuecat_event_id,
        will_renew = excluded.will_renew,
        billing_issue = excluded.billing_issue,
        pending_product_id = excluded.pending_product_id;
      v_state_applied := true;
      v_disposition := 'applied';
    end if;
  elsif v_type in ('SUBSCRIBER_ALIAS', 'TEST') then
    if v_type = 'SUBSCRIBER_ALIAS' and (
      pg_catalog.jsonb_typeof(p_event -> 'aliases') is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_event -> 'aliases') < 1
      or pg_catalog.jsonb_array_length(p_event -> 'aliases') > 100
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(p_event -> 'aliases') item
        where pg_catalog.jsonb_typeof(item) <> 'string'
          or pg_catalog.char_length(item #>> '{}') not between 1 and 200
      )
    ) then
      raise exception 'REVENUECAT_EVENT_INVALID';
    end if;
    -- SUBSCRIBER_ALIAS is deprecated and TEST is synthetic. Neither contains
    -- authoritative entitlement state, so neither advances the state clock.
    v_disposition := 'recorded';
  elsif v_type = 'TRANSFER' then
    select pg_catalog.count(*)::integer
      into v_source_count
    from public.subscriptions subscription_record
    where subscription_record.user_id = any(v_source_ids);
    if v_source_count = 0 then
      raise exception 'REVENUECAT_TRANSFER_SOURCE_NOT_FOUND';
    end if;

    v_is_stale := exists (
      select 1
      from public.subscriptions subscription_record
      where subscription_record.user_id = any(v_related_ids)
        and subscription_record.revenuecat_event_timestamp_ms is not null
        and (
          subscription_record.revenuecat_event_timestamp_ms > v_event_timestamp_ms
          or (
            subscription_record.revenuecat_event_timestamp_ms = v_event_timestamp_ms
            and pg_catalog.convert_to(
              coalesce(subscription_record.revenuecat_event_id, ''), 'UTF8'
            ) >= pg_catalog.convert_to(v_event_id, 'UTF8')
          )
        )
    );
    if v_is_stale then
      v_disposition := 'stale';
    else
      for v_merge_record in
        select subscription_record.*
        from public.subscriptions subscription_record
        where subscription_record.user_id = any(v_related_ids)
        order by subscription_record.user_id
        for update
      loop
        if v_merge_record.status in ('active', 'trialing') then
          v_transfer_entitlements := v_transfer_entitlements ||
            coalesce(v_merge_record.entitlements, '{}'::jsonb);
          if (case v_merge_record.plan
              when 'business' then 4
              when 'premium' then 3
              when 'pro' then 2
              else 1
            end) > (case v_transfer_plan
              when 'business' then 4
              when 'premium' then 3
              when 'pro' then 2
              else 1
            end) then
            v_transfer_plan := v_merge_record.plan;
          end if;
          if v_merge_record.status = 'active' then
            v_transfer_status := 'active';
          elsif v_transfer_status <> 'active' then
            v_transfer_status := 'trialing';
          end if;
          if v_transfer_period_start is null
            or v_merge_record.period_start < v_transfer_period_start then
            v_transfer_period_start := v_merge_record.period_start;
          end if;
          if v_transfer_period_end is null
            or v_merge_record.period_end > v_transfer_period_end then
            v_transfer_period_end := v_merge_record.period_end;
          end if;
          v_transfer_will_renew := v_transfer_will_renew or
            coalesce(v_merge_record.will_renew, false);
          v_transfer_billing_issue := v_transfer_billing_issue or
            v_merge_record.billing_issue;
          v_transfer_pending_product_id := coalesce(
            v_transfer_pending_product_id,
            v_merge_record.pending_product_id
          );
        end if;
      end loop;

      insert into public.subscriptions (
        user_id, plan, status, revenuecat_customer_id, entitlements,
        period_start, period_end, updated_at, revenuecat_event_timestamp_ms,
        revenuecat_event_id, will_renew, billing_issue, pending_product_id
      ) values (
        v_destination_id,
        v_transfer_plan,
        v_transfer_status,
        v_destination_id::text,
        v_transfer_entitlements,
        v_transfer_period_start,
        v_transfer_period_end,
        pg_catalog.clock_timestamp(),
        v_event_timestamp_ms,
        v_event_id,
        v_transfer_will_renew,
        v_transfer_billing_issue,
        v_transfer_pending_product_id
      )
      on conflict (user_id) do update set
        plan = excluded.plan,
        status = excluded.status,
        revenuecat_customer_id = excluded.revenuecat_customer_id,
        entitlements = excluded.entitlements,
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        updated_at = excluded.updated_at,
        revenuecat_event_timestamp_ms = excluded.revenuecat_event_timestamp_ms,
        revenuecat_event_id = excluded.revenuecat_event_id,
        will_renew = excluded.will_renew,
        billing_issue = excluded.billing_issue,
        pending_product_id = excluded.pending_product_id;

      update public.subscriptions
      set plan = 'free',
          status = 'expired',
          entitlements = '{}'::jsonb,
          will_renew = false,
          billing_issue = false,
          pending_product_id = null,
          updated_at = pg_catalog.clock_timestamp(),
          revenuecat_event_timestamp_ms = v_event_timestamp_ms,
          revenuecat_event_id = v_event_id
      where user_id = any(v_source_ids);

      v_state_applied := true;
      v_disposition := 'applied';
    end if;
  end if;

  insert into public.revenuecat_webhook_events (
    event_id,
    event_type,
    event_timestamp_ms,
    api_version,
    subject_user_id,
    related_user_ids,
    payload_sha256,
    normalized_event,
    disposition,
    state_applied
  ) values (
    v_event_id,
    v_type,
    v_event_timestamp_ms,
    '1.0',
    v_user_id,
    v_related_ids,
    v_payload_sha256,
    p_event,
    v_disposition,
    v_state_applied
  );

  return pg_catalog.jsonb_build_object(
    'outcome', v_disposition,
    'eventId', v_event_id,
    'stateApplied', v_state_applied
  );
end;
$function$;

revoke all on function public.apply_revenuecat_webhook_event(jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_revenuecat_webhook_event(jsonb)
  to service_role;

-- The service role still needs SELECT for allowance/auth checks. All RevenueCat
-- subscription mutation now passes through the transactional RPC.
revoke insert, update, delete on table public.subscriptions from service_role;
grant select on table public.subscriptions to service_role;

commit;
