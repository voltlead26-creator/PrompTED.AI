-- Forward-only repair for captured operation expiry reconciliation.
--
-- The original 20260831100000 migration may already be recorded on a hosted
-- project, so changing that historical file would not update its function.
-- Re-declare the function here to preserve immutable migration history while
-- ensuring unfinished provider attempts are reconciled before an expired
-- operation releases its allowance.

create or replace function public.claim_captured_document_operation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_owner text,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_token uuid;
  v_reconciled_attempts integer := 0;
begin
  if nullif(btrim(p_lease_owner), '') is null
    or char_length(p_lease_owner) > 160
    or p_lease_seconds not between 15 and 1800 then
    raise exception 'CAPTURED_OPERATION_LEASE_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;

  -- Terminal truth remains immutable even after the operation TTL. Expiry
  -- reconciles unfinished work only; it cannot rewrite a completed result.
  if v_operation.status in ('ready_for_review', 'terminal_failure', 'cancelled') then
    raise exception 'CAPTURED_OPERATION_NOT_CLAIMABLE:%', v_operation.status;
  end if;

  if v_operation.expires_at <= clock_timestamp() then
    -- Terminalize prepared attempts first so usage accounting records the
    -- ambiguous provider outcome exactly once before the allowance is released.
    update private.captured_document_provider_attempts attempt_record
    set status = 'failed',
        input_tokens = 0,
        output_tokens = 0,
        error_code = 'CAPTURED_OPERATION_EXPIRED_OUTCOME_UNKNOWN',
        completed_at = greatest(clock_timestamp(), attempt_record.started_at),
        structured_output = null
    where attempt_record.operation_id = v_operation.id
      and attempt_record.user_id = v_operation.user_id
      and attempt_record.status = 'prepared';
    get diagnostics v_reconciled_attempts = row_count;

    update private.captured_document_operations
    set status = case
          when cancel_requested_at is not null then 'cancelled'
          else 'terminal_failure'
        end,
        operation_revision = operation_revision + 1,
        retryable = false,
        error_code = case
          when cancel_requested_at is not null then null
          else 'OPERATION_EXPIRED'
        end,
        public_error_message = case
          when cancel_requested_at is not null then null
          else 'This generation operation expired before it could finish.'
        end,
        safe_next_action = case
          when cancel_requested_at is not null
            then 'The cancelled operation is retained for audit; start a new operation only when ready.'
          else 'Start a new generation operation.'
        end,
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        terminal_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = p_operation_id
    returning * into v_operation;

    perform private.append_captured_document_event(
      v_operation.id,
      v_operation.user_id,
      v_operation.operation_revision,
      v_operation.status,
      case
        when v_operation.status = 'cancelled'
          then 'operation_cancelled_after_expiry_reconciliation'
        else 'operation_expired'
      end,
      jsonb_build_object(
        'error_code', v_operation.error_code,
        'prepared_attempts_reconciled', v_reconciled_attempts
      )
    );

    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'lease_token', null,
      'prepared_attempts_reconciled', v_reconciled_attempts,
      'expired', true
    );
  end if;

  if v_operation.lease_token is not null
    and v_operation.lease_expires_at > clock_timestamp() then
    if v_operation.lease_owner is distinct from btrim(p_lease_owner) then
      raise exception 'CAPTURED_OPERATION_ALREADY_CLAIMED';
    end if;
    update private.captured_document_operations
    set lease_expires_at = clock_timestamp() +
          pg_catalog.make_interval(secs => p_lease_seconds),
        operation_revision = operation_revision + 1,
        updated_at = clock_timestamp()
    where id = p_operation_id
    returning * into v_operation;
    perform private.append_captured_document_event(
      v_operation.id, v_operation.user_id, v_operation.operation_revision,
      v_operation.status, 'operation_lease_renewed',
      jsonb_build_object(
        'lease_owner', v_operation.lease_owner,
        'lease_expires_at', v_operation.lease_expires_at
      )
    );
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'lease_token', v_operation.lease_token,
      'lease_expires_at', v_operation.lease_expires_at,
      'renewed', true,
      'expired', false
    );
  end if;

  v_token := gen_random_uuid();
  update private.captured_document_operations
  set lease_token = v_token,
      lease_owner = btrim(p_lease_owner),
      lease_expires_at = clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'operation_claimed',
    jsonb_build_object(
      'lease_owner', v_operation.lease_owner,
      'lease_expires_at', v_operation.lease_expires_at
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'lease_token', v_operation.lease_token,
    'lease_expires_at', v_operation.lease_expires_at,
    'renewed', false,
    'expired', false
  );
end;
$function$;

revoke all on function public.claim_captured_document_operation(uuid, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_captured_document_operation(uuid, integer, text, integer)
  to service_role;
