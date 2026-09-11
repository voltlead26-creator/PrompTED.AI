-- One automatic repair per legacy document section, across existing phase identities.
-- Preserve the prior cumulative failure guard, public RPCs, claims, receipts
-- and historical wording. No new counter or persistence authority.
begin;

create or replace function private.enforce_legacy_generation_failure_budget()
returns trigger language plpgsql security definer set search_path = ''
as $budget$
declare
  v_period timestamptz;
  v_failures integer;
  v_section_parts text[];
begin
  if tg_op = 'UPDATE' and (old.dispatched_at is not null or new.dispatched_at is null) then
    return new;
  end if;
  if new.origin_reservation_id is not null then
    select billing_period_start into v_period from private.document_allowance_reservations
    where id = new.origin_reservation_id and user_id = new.user_id;
    if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;
    perform private.document_allowance_lock(new.user_id, v_period);
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      new.user_id::text || '|' || new.checkpoint_scope || '|' || new.logical_request_id, 0));
  end if;

  select count(*) into v_failures
  from public.usage_ledger u
  join private.legacy_model_attempt_admissions a
    on a.user_id = u.user_id and a.checkpoint_scope = u.checkpoint_scope
    and a.logical_request_id = u.logical_request_id and a.logical_stage_key = u.logical_stage_key
    and a.request_sha256 = u.provider_request_sha256 and a.attempt_number = u.provider_attempt_number
  where a.user_id = new.user_id and a.checkpoint_scope = new.checkpoint_scope
    and a.logical_request_id = new.logical_request_id
    and a.origin_reservation_id is not distinct from new.origin_reservation_id
    and a.dispatched_at is not null and u.event_type = 'model_call'
    and u.model_call_key is not null and u.model_call_status = 'failed'
    -- Capacity/configuration denials never crossed the provider boundary.
    -- A completed but unusable result belongs to the separate repair budget.
    and u.provider_status not in ('rejected_before_provider', 'completed_rejected', 'completed');
  if v_failures >= 2 then
    raise exception using errcode = 'PGB01', message = 'GENERATION_ATTEMPT_LIMIT_REACHED';
  end if;
  -- Admission can precede another worker's dispatch. Recheck under the same
  -- operation lock at the first irreversible dispatch transition. Completed
  -- receipts and exact-token replays return before this transition; a permitted
  -- transient retry of the same logical repair keeps its original stage key.
  if tg_op = 'UPDATE' and new.checkpoint_scope = 'generate-document' then
    v_section_parts := pg_catalog.regexp_match(new.logical_stage_key,
      '^generate-document[.]section:([a-z0-9._-]+):([a-z0-9._-]+)$');
    if v_section_parts is not null and v_section_parts[2] <> 'draft' and exists (
      select 1 from private.legacy_model_attempt_admissions a
      where a.user_id = new.user_id and a.checkpoint_scope = new.checkpoint_scope
        and a.logical_request_id = new.logical_request_id
        and a.origin_reservation_id is not distinct from new.origin_reservation_id
        and a.dispatched_at is not null
        and a.logical_stage_key <> new.logical_stage_key
        and a.logical_stage_key ~ '^generate-document[.]section:[a-z0-9._-]+:[a-z0-9._-]+$'
        and pg_catalog.split_part(a.logical_stage_key, ':', 2) = v_section_parts[1]
        and pg_catalog.split_part(a.logical_stage_key, ':', 3) <> 'draft'
    ) then
      raise exception using errcode = 'PGB02', message = 'GENERATION_REPAIR_LIMIT_REACHED';
    end if;
  end if;
  return new;
end;
$budget$;
revoke all on function private.enforce_legacy_generation_failure_budget()
  from public, anon, authenticated, service_role;

commit;
