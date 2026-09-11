-- Count existing terminal attempts joined to the existing exact dispatch
-- receipts. Preparation, capacity rejection and completed-but-unusable wording
-- are not provider failures. No counter or alternate persistence store is added.
begin;

create function private.assert_captured_generation_failure_budget(
  p_operation_id uuid, p_user_id uuid
) returns void language plpgsql volatile security definer set search_path = ''
as $budget$
declare
  v_user_key text;
  v_failures integer;
begin
  -- Serialize with attempt completion and every other admission for this
  -- operation. Public preparation already owns this same row lock.
  perform 1 from private.captured_document_operations
    where id=p_operation_id and user_id=p_user_id for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  v_user_key := private.account_deletion_user_key(p_user_id);
  select count(*) into v_failures
  from private.captured_document_provider_attempts a
  join private.user_external_egress_dispatches d
    on d.user_key=v_user_key and d.egress_kind='openai' and d.egress_route='responses'
    and d.resource_sha256=pg_catalog.encode(extensions.digest(a.id::text,'sha256'),'hex')
  where a.operation_id=p_operation_id and a.user_id=p_user_id and a.status='failed'
    and d.reconciliation_resolution is distinct from 'verified_not_dispatched'
    -- These adapter errors follow a completed response and consume the separate
    -- validation/repair allowance rather than the transport failure allowance.
    and a.error_code not in ('OPENAI_EMPTY_RESPONSE','OPENAI_INVALID_STRUCTURED_OUTPUT',
      'OLLAMA_STRUCTURED_OUTPUT_INVALID');
  if v_failures >= 2 then
    raise exception using errcode='PGB01', message='GENERATION_ATTEMPT_LIMIT_REACHED';
  end if;
end;
$budget$;
revoke all on function private.assert_captured_generation_failure_budget(uuid,uuid)
  from public,anon,authenticated,service_role;

create function private.enforce_captured_generation_failure_budget()
returns trigger language plpgsql security definer set search_path = ''
as $budget$
begin
  if new.status='prepared' then
    perform private.assert_captured_generation_failure_budget(new.operation_id,new.user_id);
  end if;
  return new;
end;
$budget$;
revoke all on function private.enforce_captured_generation_failure_budget()
  from public,anon,authenticated,service_role;
create trigger captured_generation_failure_budget_guard
before insert on private.captured_document_provider_attempts
for each row execute function private.enforce_captured_generation_failure_budget();

-- The gateway's existing resource identity is SHA-256(exact attempt UUID).
-- Index that immutable expression to avoid scanning attempt history per egress.
create index captured_provider_attempt_dispatch_identity
on private.captured_document_provider_attempts
  ((pg_catalog.encode(extensions.digest(id::text,'sha256'),'hex')));

create function private.enforce_captured_dispatch_failure_budget()
returns trigger language plpgsql security definer set search_path = ''
as $budget$
declare
  v_attempt private.captured_document_provider_attempts%rowtype;
begin
  if new.egress_kind <> 'openai' or new.egress_route <> 'responses' then return new; end if;
  -- Existing dispatch-token replay is handled by the original public command;
  -- this guard must not reinterpret an already granted dispatch as a new one.
  if exists (select 1 from private.user_external_egress_dispatches d
    where d.user_key=new.user_key and d.egress_kind=new.egress_kind
      and d.egress_route=new.egress_route and d.resource_sha256=new.resource_sha256) then
    return new;
  end if;
  select * into v_attempt from private.captured_document_provider_attempts a
    where pg_catalog.encode(extensions.digest(a.id::text,'sha256'),'hex')=new.resource_sha256
      and private.account_deletion_user_key(a.user_id)=new.user_key;
  if found then
    perform private.assert_captured_generation_failure_budget(v_attempt.operation_id,v_attempt.user_id);
  end if;
  return new;
end;
$budget$;
revoke all on function private.enforce_captured_dispatch_failure_budget()
  from public,anon,authenticated,service_role;
create trigger captured_dispatch_failure_budget_guard
before insert on private.user_external_egress_dispatches
for each row execute function private.enforce_captured_dispatch_failure_budget();

commit;
