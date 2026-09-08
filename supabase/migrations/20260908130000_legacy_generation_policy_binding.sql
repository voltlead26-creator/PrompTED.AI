-- Bind newly reviewed legacy generation policy to the existing allowance
-- reservation. Historical rows remain null and completed responses replay
-- literally. This migration does not activate a captured cohort or change caps.
alter table private.document_allowance_reservations
  add column execution_policy_version text,
  add column execution_policy_sha256 text,
  add constraint document_allowance_execution_policy_shape check (
    (execution_policy_version is null and execution_policy_sha256 is null)
    or (
      execution_policy_version is not null and execution_policy_sha256 is not null
      and execution_policy_version = 'legacy-template-policy.1'
      and execution_policy_sha256 ~ '^[0-9a-f]{64}$'
      and route_key = 'generate-document' and captured_operation_id is null
    )
  );

create or replace function private.preserve_document_allowance_execution_policy()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if old.execution_policy_version is not null and (
    new.execution_policy_version is distinct from old.execution_policy_version
    or new.execution_policy_sha256 is distinct from old.execution_policy_sha256
    or new.user_id is distinct from old.user_id
    or new.request_id is distinct from old.request_id
    or new.route_key is distinct from old.route_key
    or new.request_sha256 is distinct from old.request_sha256
    or new.captured_operation_id is distinct from old.captured_operation_id
  ) then
    raise exception 'IMMUTABLE_ALLOWANCE_EXECUTION_POLICY';
  end if;
  return new;
end;
$function$;
create trigger document_allowance_execution_policy_immutable
  before update on private.document_allowance_reservations
  for each row execute function private.preserve_document_allowance_execution_policy();

create or replace function private.document_allowance_has_provider_work(
  p_user_id uuid, p_request_id text, p_route_key text
) returns boolean language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1 from private.legacy_model_attempt_admissions a
    where a.user_id=p_user_id and a.logical_request_id=p_request_id
      and a.checkpoint_scope=p_route_key
  ) or exists (
    select 1 from private.legacy_model_call_results r
    where r.user_id=p_user_id and r.logical_request_id=p_request_id
      and r.checkpoint_scope=p_route_key
  ) or exists (
    select 1 from public.usage_ledger u
    where u.user_id=p_user_id and u.logical_request_id=p_request_id
      and u.model_call_key is not null
      and left(u.logical_stage_key, char_length(p_route_key)+1)=p_route_key||'.'
  )
$function$;

create or replace function private.valid_document_allowance_replay_result(
  p_user_id uuid, p_reservation_id uuid, p_request_id text, p_route_key text
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_result private.document_allowance_results%rowtype;
begin
  select * into v_result from private.document_allowance_results r
  where r.user_id=p_user_id and r.request_id=p_request_id;
  if not found or v_result.reservation_id is distinct from p_reservation_id
    or v_result.route_key is distinct from p_route_key
    or jsonb_typeof(v_result.response_payload) is distinct from 'object'
    or v_result.response_payload->>'contract_version' is distinct from 'allowance-result.1'
    or v_result.response_payload->>'route_key' is distinct from p_route_key
    or v_result.response_payload->>'transport' is null
    or v_result.response_payload->>'transport' not in ('json','sse')
    or jsonb_typeof(v_result.response_payload->'payload') is distinct from 'object'
    or v_result.response_payload - array['contract_version','route_key','transport','payload'] <> '{}'::jsonb
    or octet_length(v_result.response_payload::text)>8388608
    or octet_length((v_result.response_payload->'payload')::text)>8380000
    or v_result.response_sha256 is distinct from encode(extensions.digest(
      convert_to(v_result.response_payload::text,'UTF8'),'sha256'),'hex') then
    raise exception 'ALLOWANCE_REPLAY_RESULT_INVALID';
  end if;
  return v_result.response_payload;
end;
$function$;

create or replace function public.read_document_allowance_replay(
  p_user_id uuid, p_request_id text, p_route_key text, p_request_sha256 text
) returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_reservation private.document_allowance_reservations%rowtype;
  v_state text := 'absent';
  v_provider_work boolean;
  v_replay jsonb := null;
begin
  if p_user_id is null or p_request_id is null
    or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception 'ALLOWANCE_REQUEST_ID_INVALID';
  end if;
  if p_route_key is null or p_route_key !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
    or p_request_sha256 is null or p_request_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'ALLOWANCE_REQUEST_IDENTITY_INVALID';
  end if;
  select * into v_reservation from private.document_allowance_reservations r
  where r.user_id=p_user_id and r.request_id=p_request_id
  order by r.attempt_number desc limit 1;
  if found then
    if v_reservation.route_key is distinct from p_route_key
      or v_reservation.request_sha256 is distinct from p_request_sha256
      or v_reservation.captured_operation_id is not null then
      raise exception 'ALLOWANCE_REQUEST_REPLAY_CONFLICT';
    end if;
    v_state := case when v_reservation.status='settled' then 'settled' else 'unsettled' end;
    if v_state='settled' then
      v_replay := private.valid_document_allowance_replay_result(
        p_user_id,v_reservation.id,p_request_id,p_route_key);
    elsif exists (select 1 from private.document_allowance_results r
      where r.user_id=p_user_id and r.request_id=p_request_id) then
      raise exception 'ALLOWANCE_REPLAY_RESULT_INVALID';
    end if;
  elsif exists (select 1 from public.usage_ledger u
    where u.user_id=p_user_id and u.generation_request_id=p_request_id
      and u.event_type='document_created') then
    -- Pre-reservation completions have no response FK target. They are not new
    -- requests merely because an exact reusable response is unavailable.
    raise exception 'ALLOWANCE_REPLAY_RESULT_INVALID';
  end if;
  v_provider_work := private.document_allowance_has_provider_work(p_user_id,p_request_id,p_route_key);
  if v_state='absent' and v_provider_work then
    raise exception 'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED';
  end if;
  return jsonb_build_object(
    'contract_version','allowance-replay.1',
    'user_id',p_user_id,'request_id',p_request_id,'route_key',p_route_key,
    'request_sha256',p_request_sha256,'state',v_state,
    'reservation_id',v_reservation.id,'reservation_status',v_reservation.status,
    'expires_at',v_reservation.expires_at,
    'execution_policy_version',v_reservation.execution_policy_version,
    'execution_policy_sha256',v_reservation.execution_policy_sha256,
    'has_prior_provider_work',v_provider_work,
    'reconciliation_required',v_reservation.reconciliation_required_at is not null,
    'replay_result',v_replay
  );
end;
$function$;

-- Invoked only after the original reserve core acquired its existing billing
-- locks. This checks all attempts so expiration/release cannot reset policy.
-- True means the caller must bind atomically with a newly owned execution claim.
create or replace function private.check_document_allowance_execution_policy(
  p_user_id uuid, p_request_id text, p_route_key text, p_request_sha256 text,
  p_result jsonb, p_policy_aware boolean,
  p_execution_policy_version text, p_execution_policy_sha256 text,
  p_legacy_execution_policy_sha256 text
) returns boolean language plpgsql security definer set search_path = ''
as $function$
declare
  v_reservation private.document_allowance_reservations%rowtype;
  v_bound private.document_allowance_reservations%rowtype;
begin
  -- Literal completed replay never chooses a new execution policy.
  if p_result->>'state'='settled' then return false; end if;
  if p_route_key<>'generate-document' then
    if p_policy_aware then raise exception 'ALLOWANCE_EXECUTION_POLICY_INVALID'; end if;
    return false;
  end if;
  select * into v_reservation from private.document_allowance_reservations r
  where r.id=(p_result->>'reservation_id')::uuid and r.user_id=p_user_id;
  if not found or v_reservation.request_id is distinct from p_request_id
    or v_reservation.route_key is distinct from p_route_key
    or v_reservation.request_sha256 is distinct from p_request_sha256
    or v_reservation.captured_operation_id is not null then
    raise exception 'ALLOWANCE_REQUEST_REPLAY_CONFLICT';
  end if;
  select * into v_bound from private.document_allowance_reservations r
  where r.user_id=p_user_id and r.request_id=p_request_id
    and r.execution_policy_version is not null
  order by r.attempt_number desc limit 1;
  if not p_policy_aware then
    if found then raise exception 'ALLOWANCE_EXECUTION_POLICY_REQUIRED'; end if;
    return false;
  end if;
  if p_execution_policy_version is distinct from 'legacy-template-policy.1'
    or p_execution_policy_sha256 is null or p_execution_policy_sha256 !~ '^[0-9a-f]{64}$'
    or (p_legacy_execution_policy_sha256 is not null
      and p_legacy_execution_policy_sha256 !~ '^[0-9a-f]{64}$') then
    raise exception 'ALLOWANCE_EXECUTION_POLICY_INVALID';
  end if;
  if v_bound.id is not null then
    if v_bound.execution_policy_version is distinct from p_execution_policy_version
      or v_bound.execution_policy_sha256 is distinct from p_execution_policy_sha256
      or exists (select 1 from private.document_allowance_reservations r
        where r.user_id=p_user_id and r.request_id=p_request_id
          and r.execution_policy_version is not null
          and (r.execution_policy_version is distinct from p_execution_policy_version
            or r.execution_policy_sha256 is distinct from p_execution_policy_sha256)) then
      raise exception 'ALLOWANCE_EXECUTION_POLICY_CONFLICT';
    end if;
  elsif private.document_allowance_has_provider_work(p_user_id,p_request_id,p_route_key)
    and p_legacy_execution_policy_sha256 is distinct from p_execution_policy_sha256 then
    raise exception 'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED';
  end if;
  return v_reservation.execution_policy_version is null;
end;
$function$;

-- Preserve the public OID: older callers must encounter this fence as well.
-- The existing core, cap calculation, expiry rules and lock order are unchanged.
create or replace function public.reserve_document_allowance(
  p_user_id uuid, p_request_id text, p_route_key text, p_request_sha256 text,
  p_plan text, p_monthly_cap integer, p_ttl_seconds integer default 1800
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_result jsonb;
begin
  v_result := private.reserve_document_allowance_core(
    p_user_id,p_request_id,p_route_key,p_request_sha256,
    p_plan,p_monthly_cap,p_ttl_seconds,null,null,false);
  perform private.check_document_allowance_execution_policy(
    p_user_id,p_request_id,p_route_key,p_request_sha256,v_result,false,null,null,null);
  return v_result;
end;
$function$;

-- One copy of the existing result/claim state machine serves both public APIs.
-- Added policy checks and writes surround the existing execution-claim changes;
-- no environment/GUC flag can grant a bypass to an old worker.
create or replace function private.reserve_document_allowance_result_core(
  p_user_id uuid, p_request_id text, p_route_key text, p_request_sha256 text,
  p_plan text, p_monthly_cap integer, p_ttl_seconds integer,
  p_policy_aware boolean, p_execution_policy_version text,
  p_execution_policy_sha256 text, p_legacy_execution_policy_sha256 text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_result jsonb;
  v_checkpoint private.document_allowance_results%rowtype;
  v_reservation private.document_allowance_reservations%rowtype;
  v_claim private.legacy_generation_execution_claims%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_claim_token uuid;
  v_unresolved boolean;
  v_bind boolean;
begin
  v_result := private.reserve_document_allowance_core(
    p_user_id,p_request_id,p_route_key,p_request_sha256,
    p_plan,p_monthly_cap,p_ttl_seconds,null,null,false);
  if p_policy_aware then v_now := pg_catalog.clock_timestamp(); end if;
  v_bind := private.check_document_allowance_execution_policy(
    p_user_id,p_request_id,p_route_key,p_request_sha256,v_result,p_policy_aware,
    p_execution_policy_version,p_execution_policy_sha256,p_legacy_execution_policy_sha256);
  if v_result->>'state' = 'settled' then
    select * into v_checkpoint
    from private.document_allowance_results result_record
    where result_record.user_id = p_user_id
      and result_record.request_id = p_request_id
      and result_record.route_key = p_route_key;
    if not found then
      return v_result || pg_catalog.jsonb_build_object(
        'completion_state', 'completed_result_unavailable',
        'result_unavailable', true,
        'provider_permitted', false
      );
    end if;
    v_result := v_result || pg_catalog.jsonb_build_object(
      'replay_result', v_checkpoint.response_payload,
      'response_sha256', v_checkpoint.response_sha256
    );
  elsif p_route_key in ('generate-document', 'generate-checklist')
    and (v_result->>'provider_permitted')::boolean is true then
    if v_bind then
      update private.document_allowance_reservations
      set execution_policy_version=p_execution_policy_version,
          execution_policy_sha256=p_execution_policy_sha256
      where id=(v_result->>'reservation_id')::uuid and user_id=p_user_id;
      v_bind := false;
    end if;
    v_claim_token := extensions.gen_random_uuid();
    insert into private.legacy_generation_execution_claims(
      reservation_id, user_id, checkpoint_scope, logical_request_id,
      claim_token, claimed_at, heartbeat_at, lease_expires_at
    ) values (
      (v_result->>'reservation_id')::uuid, p_user_id, p_route_key, p_request_id,
      v_claim_token, v_now, v_now, v_now + interval '120 seconds'
    );
    v_result := v_result || pg_catalog.jsonb_build_object(
      'execution_claim_token', v_claim_token,
      'execution_lease_expires_at', v_now + interval '120 seconds'
    );
  elsif (v_result->>'provider_permitted')::boolean is false then
    select * into v_reservation
    from private.document_allowance_reservations reservation_record
    where reservation_record.id = (v_result->>'reservation_id')::uuid
      and reservation_record.user_id = p_user_id;
    if found and v_reservation.reconciliation_required_at is not null then
      v_result := v_result || pg_catalog.jsonb_build_object(
        'state', 'awaiting_reconciliation',
        'reconciliation_required', true,
        'reconciliation_code', v_reservation.reconciliation_code
      );
    elsif found and p_route_key in ('generate-document', 'generate-checklist') then
      select * into v_claim
      from private.legacy_generation_execution_claims claim_record
      where claim_record.reservation_id = v_reservation.id
        and claim_record.user_id = p_user_id
      for update;
      if found and v_claim.lease_expires_at <= v_now then
        select exists (
          select 1
          from private.legacy_model_attempt_admissions admission_record
          where admission_record.user_id = p_user_id
            and admission_record.checkpoint_scope = p_route_key
            and admission_record.logical_request_id = p_request_id
            and admission_record.dispatched_at is not null
            and not exists (
              select 1
              from public.usage_ledger usage_record
              where usage_record.user_id = admission_record.user_id
                and usage_record.logical_request_id = admission_record.logical_request_id
                and usage_record.logical_stage_key = admission_record.logical_stage_key
                and usage_record.provider_request_sha256 = admission_record.request_sha256
                and usage_record.provider_attempt_number = admission_record.attempt_number
                and usage_record.model_call_key is not null
            )
        ) into v_unresolved;
        if v_unresolved then
          update private.document_allowance_reservations
          set expires_at = 'infinity'::timestamptz,
              reconciliation_required_at = v_now,
              reconciliation_code = 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED',
              updated_at = v_now
          where id = v_reservation.id;
          v_result := v_result || pg_catalog.jsonb_build_object(
            'state', 'awaiting_reconciliation',
            'reconciliation_required', true,
            'reconciliation_code', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
          );
        else
          if v_bind then
            update private.document_allowance_reservations
            set execution_policy_version=p_execution_policy_version,
                execution_policy_sha256=p_execution_policy_sha256
            where id=v_reservation.id and user_id=p_user_id;
            v_bind := false;
          end if;
          v_claim_token := extensions.gen_random_uuid();
          update private.document_allowance_reservations
          set expires_at = v_now + pg_catalog.make_interval(secs => p_ttl_seconds),
              updated_at = v_now
          where id = v_reservation.id;
          update private.legacy_generation_execution_claims
          set claim_token = v_claim_token,
              claim_version = claim_version + 1,
              claimed_at = v_now,
              heartbeat_at = v_now,
              lease_expires_at = v_now + interval '120 seconds'
          where reservation_id = v_reservation.id;
          update private.legacy_model_attempt_admissions admission_record
          set claim_token = v_claim_token
          where admission_record.user_id = p_user_id
            and admission_record.checkpoint_scope = p_route_key
            and admission_record.logical_request_id = p_request_id
            and admission_record.origin_reservation_id = v_reservation.id
            and admission_record.dispatched_at is null
            and not exists (
              select 1
              from public.usage_ledger usage_record
              where usage_record.user_id = admission_record.user_id
                and usage_record.logical_request_id = admission_record.logical_request_id
                and usage_record.logical_stage_key = admission_record.logical_stage_key
                and usage_record.provider_request_sha256 = admission_record.request_sha256
                and usage_record.provider_attempt_number = admission_record.attempt_number
                and usage_record.model_call_key is not null
            );
          v_result := v_result || pg_catalog.jsonb_build_object(
            'state', 'reserved',
            'provider_permitted', true,
            'execution_reclaimed', true,
            'execution_claim_token', v_claim_token,
            'execution_lease_expires_at', v_now + interval '120 seconds'
          );
        end if;
      end if;
    end if;
  end if;
  if v_bind then
    -- No newly owned execution claim: leave the old policy/token and all other
    -- rows unchanged, including any expiry work performed by the original core.
    raise exception 'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED';
  end if;
  return v_result;
end;
$function$;

create or replace function public.reserve_document_allowance_with_result(
  p_user_id uuid, p_request_id text, p_route_key text, p_request_sha256 text,
  p_plan text, p_monthly_cap integer, p_ttl_seconds integer default 1800
) returns jsonb language sql security definer set search_path = ''
as $function$
  select private.reserve_document_allowance_result_core(
    p_user_id,p_request_id,p_route_key,p_request_sha256,p_plan,p_monthly_cap,p_ttl_seconds,
    false,null,null,null)
$function$;

create or replace function public.reserve_document_allowance_with_policy(
  p_user_id uuid, p_request_id text, p_route_key text, p_request_sha256 text,
  p_plan text, p_monthly_cap integer, p_ttl_seconds integer,
  p_execution_policy_version text, p_execution_policy_sha256 text,
  p_legacy_execution_policy_sha256 text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_result jsonb;
  v_reservation private.document_allowance_reservations%rowtype;
  v_replay jsonb := null;
begin
  if p_route_key is distinct from 'generate-document' then
    raise exception 'ALLOWANCE_EXECUTION_POLICY_INVALID';
  end if;
  v_result := private.reserve_document_allowance_result_core(
    p_user_id,p_request_id,p_route_key,p_request_sha256,p_plan,p_monthly_cap,p_ttl_seconds,
    true,p_execution_policy_version,p_execution_policy_sha256,p_legacy_execution_policy_sha256);
  select * into v_reservation from private.document_allowance_reservations r
  where r.id=(v_result->>'reservation_id')::uuid and r.user_id=p_user_id;
  if not found then raise exception 'ALLOWANCE_REPLAY_RESULT_INVALID'; end if;
  if v_result->>'state'='settled' then
    v_replay := private.valid_document_allowance_replay_result(
      p_user_id,v_reservation.id,p_request_id,p_route_key);
  end if;
  return jsonb_build_object(
    'contract_version','allowance-policy-reservation.1',
    'user_id',p_user_id,'request_id',p_request_id,'route_key',p_route_key,
    'request_sha256',p_request_sha256,'reservation_id',v_reservation.id,
    'expires_at',v_reservation.expires_at,'state',v_result->>'state',
    'provider_permitted',v_result->'provider_permitted',
    'execution_claim_token',v_result->>'execution_claim_token',
    'execution_policy_version',v_reservation.execution_policy_version,
    'execution_policy_sha256',v_reservation.execution_policy_sha256,
    'replay_result',v_replay
  );
end;
$function$;

revoke all on function private.preserve_document_allowance_execution_policy()
  from public, anon, authenticated, service_role;
revoke all on function private.document_allowance_has_provider_work(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.valid_document_allowance_replay_result(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.check_document_allowance_execution_policy(uuid,text,text,text,jsonb,boolean,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.reserve_document_allowance_result_core(uuid,text,text,text,text,integer,integer,boolean,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.read_document_allowance_replay(uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.reserve_document_allowance_with_policy(uuid,text,text,text,text,integer,integer,text,text,text)
  from public, anon, authenticated;
grant execute on function public.read_document_allowance_replay(uuid,text,text,text) to service_role;
grant execute on function public.reserve_document_allowance_with_policy(uuid,text,text,text,text,integer,integer,text,text,text) to service_role;
