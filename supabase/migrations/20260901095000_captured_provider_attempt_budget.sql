-- Enforce the immutable accepted route's provider-attempt ceiling in the
-- database. A worker restart must not reset an invocation-local retry loop and
-- allocate attempt N+1 after the accepted maxAttempts budget is exhausted.

begin;

create or replace function private.enforce_captured_provider_attempt_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_route text;
  v_limit_text text;
  v_limit integer;
begin
  if new.status <> 'prepared' then return new; end if;
  v_route := case new.logical_stage_key
    when 'generation' then 'deep'
    when 'review' then 'review'
    else null
  end;
  if v_route is null or new.semantic_route <> v_route then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_STAGE_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = new.operation_id;
  if not found or v_operation.user_id <> new.user_id then
    raise exception 'CAPTURED_OPERATION_NOT_FOUND';
  end if;
  v_limit_text :=
    v_operation.route_snapshot->'routes'->v_route->>'maxAttempts';
  if v_limit_text is null
    or v_limit_text !~ '^[12]$' then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_BUDGET_INVALID:%', v_route;
  end if;
  v_limit := v_limit_text::integer;
  if new.attempt_number > v_limit then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_LIMIT_EXCEEDED:%:%:%',
      v_route, new.attempt_number, v_limit;
  end if;
  return new;
end;
$function$;

create trigger captured_provider_attempt_budget_guard
  before insert on private.captured_document_provider_attempts
  for each row execute function
    private.enforce_captured_provider_attempt_budget();

revoke all on function private.enforce_captured_provider_attempt_budget()
  from public, anon, authenticated, service_role;

comment on function private.enforce_captured_provider_attempt_budget() is
  'Rejects provider-attempt allocation beyond the immutable accepted route maxAttempts across worker restarts.';

commit;
