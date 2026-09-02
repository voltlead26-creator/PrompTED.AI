-- Captured generation remains default-deny until a service-owned, explicit
-- user assignment exists for the exact environment/workflow/template scope.
-- Existing accepted operations remain replayable under their already captured
-- cohort and activation revisions; this gate applies only to new acceptance.

begin;

create table private.captured_document_rollout_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null
    check (environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  workflow text not null
    check (workflow ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  template_id text not null check (template_id in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  )),
  user_cohort text not null
    check (user_cohort ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  activation_scope_key text not null
    references private.document_ledger_activation_pointers(scope_key)
    on delete restrict,
  assignment_mode text not null default 'explicit'
    check (assignment_mode = 'explicit'),
  assignment_revision integer not null check (assignment_revision > 0),
  enabled boolean not null,
  changed_by text not null check (nullif(btrim(changed_by), '') is not null),
  change_reason text not null check (nullif(btrim(change_reason), '') is not null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, environment, workflow, template_id),
  unique (id, user_id),
  check (
    activation_scope_key =
      environment || ':' || user_cohort || ':' || workflow || ':' || template_id
  )
);

create table private.captured_document_rollout_assignment_revisions (
  assignment_id uuid not null,
  assignment_revision integer not null check (assignment_revision > 0),
  user_id uuid not null,
  environment text not null
    check (environment ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  workflow text not null
    check (workflow ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  template_id text not null check (template_id in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  )),
  user_cohort text not null
    check (user_cohort ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  activation_scope_key text not null
    references private.document_ledger_activation_pointers(scope_key)
    on delete restrict,
  activation_revision integer not null check (activation_revision > 0),
  assignment_mode text not null check (assignment_mode = 'explicit'),
  enabled boolean not null,
  changed_by text not null check (nullif(btrim(changed_by), '') is not null),
  change_reason text not null check (nullif(btrim(change_reason), '') is not null),
  changed_at timestamptz not null default now(),
  primary key (assignment_id, assignment_revision),
  foreign key (assignment_id, user_id)
    references private.captured_document_rollout_assignments(id, user_id)
    on delete cascade,
  check (
    activation_scope_key =
      environment || ':' || user_cohort || ':' || workflow || ':' || template_id
  )
);

create index captured_document_rollout_assignments_owner_scope_idx
  on private.captured_document_rollout_assignments(
    user_id, environment, workflow, template_id
  );
create index captured_document_rollout_assignments_enabled_scope_idx
  on private.captured_document_rollout_assignments(
    environment, workflow, template_id, user_id
  ) where enabled;
create index captured_document_rollout_assignment_revisions_owner_idx
  on private.captured_document_rollout_assignment_revisions(
    user_id, assignment_id, assignment_revision desc
  );

alter table private.captured_document_rollout_assignments
  enable row level security;
alter table private.captured_document_rollout_assignments
  force row level security;
alter table private.captured_document_rollout_assignment_revisions
  enable row level security;
alter table private.captured_document_rollout_assignment_revisions
  force row level security;

revoke all on private.captured_document_rollout_assignments
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_rollout_assignment_revisions
  from public, anon, authenticated, service_role;

comment on table private.captured_document_rollout_assignments is
  'Private explicit-owner rollout pointers. No percentage or browser-supplied assignment is active in the first cohort.';
comment on table private.captured_document_rollout_assignment_revisions is
  'Append-only assignment decisions captured by accepted document operations for rollout provenance and rollback.';

create or replace function private.reject_captured_rollout_assignment_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
    and not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;
  raise exception 'IMMUTABLE_CAPTURED_ROLLOUT_ASSIGNMENT:%', old.assignment_id;
end;
$function$;

create trigger captured_document_rollout_assignment_revisions_immutable
  before update or delete
  on private.captured_document_rollout_assignment_revisions
  for each row execute function
    private.reject_captured_rollout_assignment_revision_mutation();

alter table private.captured_document_operations
  add column rollout_assignment_id uuid,
  add column rollout_assignment_revision integer;

alter table private.captured_document_operations
  add constraint captured_document_operation_rollout_assignment_pair_check
  check (
    (rollout_assignment_id is null and rollout_assignment_revision is null)
    or
    (rollout_assignment_id is not null and rollout_assignment_revision > 0)
  ),
  add constraint captured_document_operation_rollout_assignment_revision_fkey
  foreign key (rollout_assignment_id, rollout_assignment_revision)
    references private.captured_document_rollout_assignment_revisions(
      assignment_id, assignment_revision
    )
    on delete no action
    deferrable initially deferred;

create index captured_document_operations_rollout_assignment_idx
  on private.captured_document_operations(
    rollout_assignment_id, rollout_assignment_revision
  ) where rollout_assignment_id is not null;

-- A transaction-local binding is set only by the server-resolved wrapper. The
-- old service-only acceptance function remains available for exact historical
-- replay, while new application acceptance receives its assignment atomically
-- in the original INSERT statement.
create or replace function private.bind_captured_rollout_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_assignment_id_text text := nullif(
    pg_catalog.current_setting('prompted.captured_rollout_assignment_id', true),
    ''
  );
  v_assignment_revision_text text := nullif(
    pg_catalog.current_setting(
      'prompted.captured_rollout_assignment_revision',
      true
    ),
    ''
  );
  v_assignment private.captured_document_rollout_assignment_revisions%rowtype;
begin
  if v_assignment_id_text is null and v_assignment_revision_text is null then
    return new;
  end if;
  if v_assignment_id_text is null
    or v_assignment_revision_text is null
    or v_assignment_id_text !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_assignment_revision_text !~ '^[1-9][0-9]*$' then
    raise exception 'CAPTURED_ROLLOUT_BINDING_INVALID';
  end if;

  select * into v_assignment
  from private.captured_document_rollout_assignment_revisions
  where assignment_id = v_assignment_id_text::uuid
    and assignment_revision = v_assignment_revision_text::integer
    and user_id = new.user_id
    and environment = new.environment
    and workflow = new.workflow
    and template_id = new.template_id
    and user_cohort = new.user_cohort
    and activation_scope_key = new.activation_scope_key
    and assignment_mode = 'explicit'
    and enabled;
  if not found then
    raise exception 'CAPTURED_ROLLOUT_BINDING_INVALID';
  end if;

  new.rollout_assignment_id := v_assignment.assignment_id;
  new.rollout_assignment_revision := v_assignment.assignment_revision;
  return new;
end;
$function$;

create trigger captured_document_operation_rollout_assignment_bind
  before insert on private.captured_document_operations
  for each row execute function private.bind_captured_rollout_assignment();

create or replace function private.protect_captured_operation_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.outcome_id is distinct from old.outcome_id
    or new.document_id is distinct from old.document_id
    or new.generation_snapshot_id is distinct from old.generation_snapshot_id
    or new.activation_scope_key is distinct from old.activation_scope_key
    or new.activation_revision is distinct from old.activation_revision
    or new.rollout_assignment_id is distinct from old.rollout_assignment_id
    or new.rollout_assignment_revision is distinct from old.rollout_assignment_revision
    or new.environment is distinct from old.environment
    or new.user_cohort is distinct from old.user_cohort
    or new.workflow is distinct from old.workflow
    or new.template_id is distinct from old.template_id
    or new.ledger_version is distinct from old.ledger_version
    or new.benchmark_version is distinct from old.benchmark_version
    or new.pipeline_version is distinct from old.pipeline_version
    or new.routing_version is distinct from old.routing_version
    or new.route_snapshot is distinct from old.route_snapshot
    or new.locale is distinct from old.locale
    or new.jurisdiction is distinct from old.jurisdiction
    or new.contract_version is distinct from old.contract_version
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_sha256 is distinct from old.request_sha256
    or new.input_revision is distinct from old.input_revision
    or new.accepted_document_revision is distinct from old.accepted_document_revision
    or new.safe_section_keys is distinct from old.safe_section_keys
    or new.blocked_section_keys is distinct from old.blocked_section_keys
    or new.correlation_id is distinct from old.correlation_id
    or new.expires_at is distinct from old.expires_at
    or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_CAPTURED_OPERATION_IDENTITY:%', old.id;
  end if;
  return new;
end;
$function$;

create or replace function public.configure_captured_document_rollout_assignment(
  p_user_id uuid,
  p_environment text,
  p_user_cohort text,
  p_workflow text,
  p_template_id text,
  p_enabled boolean,
  p_expected_revision integer,
  p_changed_by text,
  p_change_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_user_cohort text := lower(btrim(p_user_cohort));
  v_workflow text := lower(btrim(p_workflow));
  v_template_id text := lower(btrim(p_template_id));
  v_scope_key text;
  v_activation private.document_ledger_activation_pointers%rowtype;
  v_existing private.captured_document_rollout_assignments%rowtype;
  v_assignment private.captured_document_rollout_assignments%rowtype;
  v_revision integer;
begin
  if p_user_id is null
    or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'CAPTURED_ROLLOUT_USER_NOT_FOUND';
  end if;
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_user_cohort !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_ROLLOUT_SCOPE';
  end if;
  if v_template_id not in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  ) then
    raise exception 'TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%', v_template_id;
  end if;
  if p_expected_revision is null or p_expected_revision < 0
    or nullif(btrim(p_changed_by), '') is null
    or nullif(btrim(p_change_reason), '') is null then
    raise exception 'CAPTURED_ROLLOUT_CHANGE_INVALID';
  end if;

  v_scope_key :=
    v_environment || ':' || v_user_cohort || ':' || v_workflow || ':' || v_template_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'captured-rollout-assignment:' || p_user_id::text || ':' ||
      v_environment || ':' || v_workflow || ':' || v_template_id,
      0
    )
  );

  select * into v_activation
  from private.document_ledger_activation_pointers
  where scope_key = v_scope_key
    and environment = v_environment
    and user_cohort = v_user_cohort
    and workflow = v_workflow
    and template_id = v_template_id
  for share;
  if not found then
    raise exception 'CAPTURED_ROLLOUT_ACTIVATION_NOT_FOUND:%', v_scope_key;
  end if;
  if p_enabled and not v_activation.enabled then
    raise exception 'CAPTURED_ACTIVATION_DISABLED:%', v_scope_key;
  end if;

  select * into v_existing
  from private.captured_document_rollout_assignments
  where user_id = p_user_id
    and environment = v_environment
    and workflow = v_workflow
    and template_id = v_template_id
  for update;

  if found then
    if p_expected_revision <> v_existing.assignment_revision then
      raise exception 'CAPTURED_ROLLOUT_ASSIGNMENT_REVISION_CONFLICT:%:%',
        v_existing.id, v_existing.assignment_revision;
    end if;
    v_revision := v_existing.assignment_revision + 1;
    update private.captured_document_rollout_assignments
    set user_cohort = v_user_cohort,
        activation_scope_key = v_scope_key,
        assignment_revision = v_revision,
        enabled = p_enabled,
        changed_by = btrim(p_changed_by),
        change_reason = btrim(p_change_reason),
        updated_at = clock_timestamp()
    where id = v_existing.id
    returning * into v_assignment;
  else
    if p_expected_revision <> 0 then
      raise exception 'CAPTURED_ROLLOUT_ASSIGNMENT_REVISION_CONFLICT:new:0';
    end if;
    v_revision := 1;
    insert into private.captured_document_rollout_assignments(
      user_id, environment, workflow, template_id, user_cohort,
      activation_scope_key, assignment_mode, assignment_revision, enabled,
      changed_by, change_reason
    ) values (
      p_user_id, v_environment, v_workflow, v_template_id, v_user_cohort,
      v_scope_key, 'explicit', v_revision, p_enabled,
      btrim(p_changed_by), btrim(p_change_reason)
    ) returning * into v_assignment;
  end if;

  insert into private.captured_document_rollout_assignment_revisions(
    assignment_id, assignment_revision, user_id, environment, workflow,
    template_id, user_cohort, activation_scope_key, activation_revision,
    assignment_mode, enabled, changed_by, change_reason
  ) values (
    v_assignment.id, v_revision, p_user_id, v_environment, v_workflow,
    v_template_id, v_user_cohort, v_scope_key, v_activation.revision,
    'explicit', p_enabled, btrim(p_changed_by), btrim(p_change_reason)
  );

  return jsonb_build_object(
    'contract_version', 'captured-rollout-assignment.v1',
    'assignment_id', v_assignment.id,
    'assignment_revision', v_revision,
    'activation_scope_key', v_scope_key,
    'activation_revision', v_activation.revision,
    'environment', v_environment,
    'user_cohort', v_user_cohort,
    'workflow', v_workflow,
    'template_id', v_template_id,
    'assignment_mode', 'explicit',
    'enabled', p_enabled
  );
end;
$function$;

revoke all on function public.configure_captured_document_rollout_assignment(
  uuid, text, text, text, text, boolean, integer, text, text
) from public, anon, authenticated;
grant execute on function public.configure_captured_document_rollout_assignment(
  uuid, text, text, text, text, boolean, integer, text, text
) to service_role;

create or replace function public.accept_assigned_captured_document_operation(
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_environment text,
  p_workflow text,
  p_template_id text,
  p_benchmark_version text,
  p_pipeline_version text,
  p_input_revision integer,
  p_idempotency_key text,
  p_input_values jsonb,
  p_source_snapshot jsonb,
  p_evidence_snapshot jsonb,
  p_locale text default 'en-AU',
  p_jurisdiction text default 'AU',
  p_safe_section_keys text[] default '{}'::text[],
  p_blocked_section_keys text[] default '{}'::text[],
  p_unresolved_input_keys text[] default '{}'::text[],
  p_confirmations jsonb default '{}'::jsonb,
  p_operation_ttl_seconds integer default 86400
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_workflow text := lower(btrim(p_workflow));
  v_template_id text := lower(btrim(p_template_id));
  v_idempotency_key text := btrim(p_idempotency_key);
  v_existing private.captured_document_operations%rowtype;
  v_assignment private.captured_document_rollout_assignments%rowtype;
  v_result jsonb;
begin
  if p_user_id is null or char_length(v_idempotency_key) not between 1 and 128 then
    raise exception 'CAPTURED_OPERATION_IDENTITY_REQUIRED';
  end if;
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_OPERATION_SCOPE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'captured-operation:' || p_user_id::text || ':' || v_idempotency_key,
      0
    )
  );
  select * into v_existing
  from private.captured_document_operations
  where user_id = p_user_id and idempotency_key = v_idempotency_key;

  if found then
    -- Replays use the accepted cohort snapshot and do not consult mutable
    -- assignment or activation pointers.
    return public.accept_captured_document_operation(
      p_user_id,
      p_outcome_id,
      p_document_id,
      p_title,
      v_environment,
      v_existing.user_cohort,
      v_workflow,
      v_template_id,
      p_benchmark_version,
      p_pipeline_version,
      p_input_revision,
      v_idempotency_key,
      p_input_values,
      p_source_snapshot,
      p_evidence_snapshot,
      p_locale,
      p_jurisdiction,
      p_safe_section_keys,
      p_blocked_section_keys,
      p_unresolved_input_keys,
      p_confirmations,
      p_operation_ttl_seconds
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'captured-rollout-assignment:' || p_user_id::text || ':' ||
      v_environment || ':' || v_workflow || ':' || v_template_id,
      0
    )
  );
  select assignment_record.* into v_assignment
  from private.captured_document_rollout_assignments assignment_record
  join private.document_ledger_activation_pointers activation_record
    on activation_record.scope_key = assignment_record.activation_scope_key
  where assignment_record.user_id = p_user_id
    and assignment_record.environment = v_environment
    and assignment_record.workflow = v_workflow
    and assignment_record.template_id = v_template_id
    and assignment_record.assignment_mode = 'explicit'
    and assignment_record.enabled
    and activation_record.environment = assignment_record.environment
    and activation_record.user_cohort = assignment_record.user_cohort
    and activation_record.workflow = assignment_record.workflow
    and activation_record.template_id = assignment_record.template_id
    and activation_record.enabled
  for share of assignment_record, activation_record;
  if not found then
    raise exception 'CAPTURED_ROLLOUT_NOT_ASSIGNED:%:%:%:%',
      p_user_id, v_environment, v_workflow, v_template_id;
  end if;

  perform pg_catalog.set_config(
    'prompted.captured_rollout_assignment_id',
    v_assignment.id::text,
    true
  );
  perform pg_catalog.set_config(
    'prompted.captured_rollout_assignment_revision',
    v_assignment.assignment_revision::text,
    true
  );

  v_result := public.accept_captured_document_operation(
    p_user_id,
    p_outcome_id,
    p_document_id,
    p_title,
    v_environment,
    v_assignment.user_cohort,
    v_workflow,
    v_template_id,
    p_benchmark_version,
    p_pipeline_version,
    p_input_revision,
    v_idempotency_key,
    p_input_values,
    p_source_snapshot,
    p_evidence_snapshot,
    p_locale,
    p_jurisdiction,
    p_safe_section_keys,
    p_blocked_section_keys,
    p_unresolved_input_keys,
    p_confirmations,
    p_operation_ttl_seconds
  );

  perform pg_catalog.set_config(
    'prompted.captured_rollout_assignment_id', '', true
  );
  perform pg_catalog.set_config(
    'prompted.captured_rollout_assignment_revision', '', true
  );
  return v_result;
end;
$function$;

revoke all on function public.accept_assigned_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) from public, anon, authenticated;
grant execute on function public.accept_assigned_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) to service_role;

comment on function public.configure_captured_document_rollout_assignment(
  uuid, text, text, text, text, boolean, integer, text, text
) is
  'Service-only CAS command for explicit user rollout assignment. It never broadens an environment globally.';
comment on function public.accept_assigned_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) is
  'Service-only new-operation gate. Resolves explicit owner assignment server-side and freezes it atomically; exact accepted replays remain pointer-independent.';

commit;
