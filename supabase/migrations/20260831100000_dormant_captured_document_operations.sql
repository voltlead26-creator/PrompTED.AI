-- Gate 2: additive, dormant captured-document operation foundation.
--
-- This migration deliberately does not enable any cohort. Existing documents
-- remain legacy_unversioned and existing API/function callers keep their current
-- behaviour. A service-only, revision-checked activation pointer is the only
-- way to admit a new captured operation. Disabling or restoring that pointer
-- affects new work only; accepted operations retain every effective version and
-- may still be reconciled under their captured contract.

begin;

-- Captured artifacts are service-written and never public. Authenticated and
-- anonymous callers must continue through the protected export function rather
-- than receiving a direct Storage object policy.
insert into storage.buckets(
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'captured-exports',
  'captured-exports',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/html'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists captured_exports_no_direct_client_access on storage.objects;
create policy captured_exports_no_direct_client_access
  on storage.objects
  as restrictive
  for all
  to anon, authenticated
  using (bucket_id <> 'captured-exports')
  with check (bucket_id <> 'captured-exports');

-- Evolve the empty L0.2 activation seam into an exact selector. The original
-- scope_key remains the stable pointer identity so the earlier migration and
-- its lineage are preserved.
alter table private.document_ledger_activation_pointers
  add column if not exists environment text,
  add column if not exists user_cohort text,
  add column if not exists workflow text,
  add column if not exists template_id text,
  add column if not exists routing_version text,
  add column if not exists route_snapshot jsonb,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by text;

alter table private.document_ledger_activation_pointers
  drop constraint if exists document_ledger_activation_exact_scope_check,
  drop constraint if exists document_ledger_activation_route_snapshot_check,
  drop constraint if exists document_ledger_activation_actor_check;

alter table private.document_ledger_activation_pointers
  add constraint document_ledger_activation_exact_scope_check check (
    not enabled or (
      nullif(btrim(environment), '') is not null
      and nullif(btrim(user_cohort), '') is not null
      and nullif(btrim(workflow), '') is not null
      and nullif(btrim(template_id), '') is not null
      and nullif(btrim(routing_version), '') is not null
      and ledger_version is not null
      and route_snapshot is not null
    )
  ),
  add constraint document_ledger_activation_route_snapshot_check check (
    route_snapshot is null or (
      jsonb_typeof(route_snapshot) = 'object'
      and octet_length(route_snapshot::text) <= 32768
    )
  ),
  add constraint document_ledger_activation_actor_check check (
    (enabled and activated_at is not null and nullif(btrim(activated_by), '') is not null
      and disabled_at is null and disabled_by is null)
    or
    (not enabled and activated_at is null and activated_by is null)
  );

create unique index if not exists document_ledger_activation_exact_scope_unique
  on private.document_ledger_activation_pointers(
    environment, user_cohort, workflow, template_id
  )
  where environment is not null
    and user_cohort is not null
    and workflow is not null
    and template_id is not null;

create table private.captured_document_activation_revisions (
  scope_key text not null,
  revision integer not null check (revision > 0),
  environment text not null check (nullif(btrim(environment), '') is not null),
  user_cohort text not null check (nullif(btrim(user_cohort), '') is not null),
  workflow text not null check (nullif(btrim(workflow), '') is not null),
  template_id text not null check (nullif(btrim(template_id), '') is not null),
  ledger_version text not null
    references private.document_ledger_versions(ledger_version) on delete restrict,
  routing_version text not null check (nullif(btrim(routing_version), '') is not null),
  route_snapshot jsonb not null check (
    jsonb_typeof(route_snapshot) = 'object'
    and octet_length(route_snapshot::text) <= 32768
  ),
  enabled boolean not null,
  changed_by text not null check (nullif(btrim(changed_by), '') is not null),
  change_reason text not null check (nullif(btrim(change_reason), '') is not null),
  changed_at timestamptz not null default now(),
  primary key (scope_key, revision),
  foreign key (scope_key)
    references private.document_ledger_activation_pointers(scope_key)
    on delete restrict
);

comment on table private.captured_document_activation_revisions is
  'Immutable activation history used to restore a prior pointer without rewriting accepted operations.';

-- Captured sections gain the explicit state and provenance seam required by the
-- ledger. Legacy rows keep null state and their existing direct-DML contract.
alter table public.sections
  add column if not exists section_state text,
  add column if not exists source_references jsonb not null default '[]'::jsonb;

alter table public.sections
  drop constraint if exists sections_section_state_check,
  drop constraint if exists sections_source_references_check,
  drop constraint if exists sections_captured_ledger_identity_check;

alter table public.sections
  add constraint sections_section_state_check check (
    section_state is null or section_state in (
      'final', 'needs_clarification', 'interactive_placeholder',
      'neutral_fallback', 'omitted_optional', 'failed_validation'
    )
  ),
  add constraint sections_source_references_check check (
    jsonb_typeof(source_references) = 'array'
    and octet_length(source_references::text) <= 131072
  ),
  add constraint sections_captured_ledger_identity_check check (
    (ledger_binding_status = 'legacy_unversioned'
      and section_key is null
      and ledger_version is null
      and section_state is null
      and source_section_id is null
      and source_section_key is null
      and transformation_version is null)
    or
    (ledger_binding_status = 'captured'
      and nullif(btrim(section_key), '') is not null
      and ledger_version is not null
      and section_state is not null)
  );

create unique index if not exists captured_sections_document_key_unique
  on public.sections(document_id, ledger_version, section_key)
  where ledger_binding_status = 'captured';

-- Composite owner keys let every private record prove tenant alignment with a
-- structural foreign key instead of trusting a duplicated user_id.
create unique index if not exists outcomes_id_user_id_unique
  on public.outcomes(id, user_id);
create unique index if not exists documents_id_user_id_unique
  on public.documents(id, user_id);
create unique index if not exists sections_id_user_id_unique
  on public.sections(id, user_id);
create unique index if not exists usage_ledger_id_user_id_unique
  on public.usage_ledger(id, user_id);

create table private.captured_document_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id uuid not null,
  document_id uuid not null,
  generation_snapshot_id uuid not null,
  activation_scope_key text not null
    references private.document_ledger_activation_pointers(scope_key) on delete restrict,
  activation_revision integer not null check (activation_revision > 0),
  environment text not null check (nullif(btrim(environment), '') is not null),
  user_cohort text not null check (nullif(btrim(user_cohort), '') is not null),
  workflow text not null check (nullif(btrim(workflow), '') is not null),
  template_id text not null check (nullif(btrim(template_id), '') is not null),
  ledger_version text not null
    references private.document_ledger_versions(ledger_version) on delete restrict,
  benchmark_version text not null check (nullif(btrim(benchmark_version), '') is not null),
  pipeline_version text not null check (nullif(btrim(pipeline_version), '') is not null),
  routing_version text not null check (nullif(btrim(routing_version), '') is not null),
  route_snapshot jsonb not null check (
    jsonb_typeof(route_snapshot) = 'object'
    and octet_length(route_snapshot::text) <= 32768
  ),
  locale text not null check (nullif(btrim(locale), '') is not null),
  jurisdiction text not null check (nullif(btrim(jurisdiction), '') is not null),
  contract_version text not null default 'captured-document-operation.v1'
    check (nullif(btrim(contract_version), '') is not null),
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 1 and 128),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  input_revision integer not null check (input_revision > 0),
  accepted_document_revision integer not null check (accepted_document_revision > 0),
  safe_section_keys text[] not null default '{}'::text[]
    check (array_position(safe_section_keys, null) is null),
  blocked_section_keys text[] not null default '{}'::text[]
    check (array_position(blocked_section_keys, null) is null),
  status text not null default 'accepted' check (status in (
    'accepted', 'awaiting_clarification', 'awaiting_capacity', 'generating',
    'validating', 'persisting', 'ready_for_review', 'retryable_failure',
    'terminal_failure', 'cancelled'
  )),
  operation_revision integer not null default 1 check (operation_revision > 0),
  retryable boolean not null default false,
  correlation_id uuid not null default gen_random_uuid(),
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  cancellation_code text,
  cancel_requested_at timestamptz,
  error_code text,
  public_error_message text,
  safe_next_action text,
  provider_finalized_revision integer,
  latest_document_revision integer,
  finalization_sha256 text,
  expires_at timestamptz not null,
  terminal_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (document_id),
  unique (id, user_id),
  foreign key (outcome_id, user_id)
    references public.outcomes(id, user_id) on delete cascade,
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade
    deferrable initially deferred,
  foreign key (generation_snapshot_id, user_id)
    references private.document_generation_snapshots(id, user_id) on delete cascade,
  check (expires_at > created_at),
  check (
    (lease_token is null and lease_owner is null and lease_expires_at is null)
    or
    (lease_token is not null and nullif(btrim(lease_owner), '') is not null
      and lease_expires_at is not null)
  ),
  check (finalization_sha256 is null or finalization_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    status <> 'ready_for_review'
    or (
      provider_finalized_revision is not null
      and latest_document_revision is not null
      and finalization_sha256 is not null
    )
  ),
  check (
    status not in ('terminal_failure', 'cancelled') or terminal_at is not null
  ),
  check (char_length(coalesce(public_error_message, '')) <= 500),
  check (char_length(coalesce(safe_next_action, '')) <= 500)
);

comment on table private.captured_document_operations is
  'Durable PrompTED product operations. Provider response IDs are subordinate attempt metadata, never product identity.';

create table private.captured_document_operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  user_id uuid not null,
  operation_revision integer not null check (operation_revision > 0),
  status text not null check (status in (
    'accepted', 'awaiting_clarification', 'awaiting_capacity', 'generating',
    'validating', 'persisting', 'ready_for_review', 'retryable_failure',
    'terminal_failure', 'cancelled'
  )),
  event_type text not null check (char_length(btrim(event_type)) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 8192
  ),
  created_at timestamptz not null default now(),
  unique (operation_id, operation_revision),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade
);

create table private.captured_document_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  user_id uuid not null,
  logical_stage_key text not null
    check (char_length(btrim(logical_stage_key)) between 1 and 120),
  attempt_number integer not null check (attempt_number > 0),
  provider text not null default 'openai' check (provider = 'openai'),
  semantic_route text not null check (semantic_route in ('fast', 'deep', 'research', 'review')),
  model text not null check (nullif(btrim(model), '') is not null),
  reasoning_effort text not null check (
    reasoning_effort in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
  ),
  provider_response_id text,
  retention_mode text not null check (
    retention_mode in ('store_false', 'background_store_false', 'provider_default_unverified')
  ),
  status text not null check (status in ('prepared', 'succeeded', 'failed', 'cancelled')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  retry_reason text,
  error_code text,
  started_at timestamptz not null,
  completed_at timestamptz,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  structured_output jsonb check (
    structured_output is null
    or (
      jsonb_typeof(structured_output) = 'object'
      and octet_length(structured_output::text) <= 10485760
    )
  ),
  attempt_sha256 text not null check (attempt_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (operation_id, logical_stage_key, attempt_number),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade,
  check (
    (status = 'prepared'
      and provider_response_id is null
      and input_tokens = 0
      and output_tokens = 0
      and retry_reason is null
      and error_code is null
      and structured_output is null
      and completed_at is null)
    or
    (status in ('succeeded', 'failed', 'cancelled')
      and completed_at is not null
      and completed_at >= started_at
      and (
        (status = 'succeeded' and jsonb_typeof(structured_output) = 'object')
        or (status in ('failed', 'cancelled') and structured_output is null)
      ))
  ),
  check (char_length(coalesce(provider_response_id, '')) <= 255),
  check (char_length(coalesce(retry_reason, '')) <= 240),
  check (char_length(coalesce(error_code, '')) <= 120)
);

create unique index captured_document_provider_response_unique
  on private.captured_document_provider_attempts(provider, provider_response_id)
  where provider_response_id is not null;

create unique index captured_document_provider_prepared_unique
  on private.captured_document_provider_attempts(operation_id, logical_stage_key)
  where status = 'prepared';

create table private.captured_document_revisions (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  document_id uuid not null,
  user_id uuid not null,
  document_revision integer not null check (document_revision > 0),
  ledger_version text not null
    references private.document_ledger_versions(ledger_version) on delete restrict,
  reason text not null check (
    reason in ('accepted', 'generated', 'user_edit', 'service_repair', 'restore')
  ),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'object'
    and octet_length(snapshot::text) <= 10485760
  ),
  validation_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(validation_result) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id, document_revision),
  unique (document_id, document_revision, user_id),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade,
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade
);

create table private.captured_document_approvals (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  document_id uuid not null,
  user_id uuid not null,
  document_revision integer not null check (document_revision > 0),
  revision_sha256 text not null check (revision_sha256 ~ '^[0-9a-f]{64}$'),
  section_revisions jsonb not null check (jsonb_typeof(section_revisions) = 'object'),
  validation_result jsonb not null check (jsonb_typeof(validation_result) = 'object'),
  approved_at timestamptz not null default now(),
  unique (document_id, document_revision),
  unique (id, document_id, document_revision, user_id),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade,
  foreign key (document_id, document_revision, user_id)
    references private.captured_document_revisions(document_id, document_revision, user_id)
    on delete cascade
);

create table private.captured_document_exports (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  approval_id uuid not null,
  document_id uuid not null,
  user_id uuid not null,
  document_revision integer not null check (document_revision > 0),
  ledger_version text not null
    references private.document_ledger_versions(ledger_version) on delete restrict,
  format text not null check (format in ('docx', 'pdf', 'xlsx', 'html_preview')),
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 1 and 128),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'requested'
    check (status in ('requested', 'created', 'failed', 'cancelled')),
  storage_path text,
  artifact_sha256 text,
  renderer_version text,
  artifact_validation_result jsonb,
  completion_sha256 text,
  completed_at timestamptz,
  validation_result jsonb not null check (jsonb_typeof(validation_result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade,
  foreign key (approval_id, document_id, document_revision, user_id)
    references private.captured_document_approvals(id, document_id, document_revision, user_id)
    on delete cascade,
  check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    artifact_validation_result is null
    or jsonb_typeof(artifact_validation_result) = 'object'
  ),
  check (completion_sha256 is null or completion_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    status <> 'created'
    or (
      nullif(btrim(storage_path), '') is not null
      and artifact_sha256 is not null
      and nullif(btrim(renderer_version), '') is not null
      and artifact_validation_result is not null
      and completion_sha256 is not null
      and completed_at is not null
    )
  )
);

create table private.captured_document_allowances (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  document_id uuid not null,
  user_id uuid not null,
  document_revision integer not null check (document_revision > 0),
  usage_ledger_id uuid not null unique,
  allowance_kind text not null default 'document_created'
    check (allowance_kind = 'document_created'),
  consumed_at timestamptz not null default now(),
  foreign key (operation_id, user_id)
    references private.captured_document_operations(id, user_id) on delete cascade,
  foreign key (document_id, document_revision, user_id)
    references private.captured_document_revisions(document_id, document_revision, user_id)
    on delete cascade,
  foreign key (usage_ledger_id, user_id)
    references public.usage_ledger(id, user_id) on delete cascade
);

create table private.captured_document_write_capabilities (
  token uuid primary key,
  transaction_id bigint not null,
  write_context text not null check (write_context in (
    'accept_document', 'finalize_document', 'edit_document_section', 'approve_document'
  )),
  document_id uuid not null,
  operation_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);

create index captured_document_operations_owner_updated_idx
  on private.captured_document_operations(user_id, updated_at desc);
create index captured_document_operations_status_lease_idx
  on private.captured_document_operations(status, lease_expires_at, created_at)
  where status not in ('ready_for_review', 'terminal_failure', 'cancelled');
create index captured_document_operations_outcome_idx
  on private.captured_document_operations(outcome_id, created_at desc);
create index captured_document_events_operation_idx
  on private.captured_document_operation_events(operation_id, operation_revision);
create index captured_document_attempts_operation_idx
  on private.captured_document_provider_attempts(operation_id, logical_stage_key);
create index captured_document_revisions_operation_idx
  on private.captured_document_revisions(operation_id, document_revision desc);
create index captured_document_approvals_operation_idx
  on private.captured_document_approvals(operation_id, approved_at desc);
create index captured_document_exports_operation_idx
  on private.captured_document_exports(operation_id, created_at desc);
create unique index captured_document_exports_storage_path_unique
  on private.captured_document_exports(storage_path)
  where storage_path is not null;
create index captured_document_write_capability_tx_idx
  on private.captured_document_write_capabilities(transaction_id, token);

-- Private operational records are not Data API surfaces. RLS is an additional
-- deny-by-default layer; all access is through the explicit RPCs below.
alter table private.document_ledger_activation_pointers enable row level security;
alter table private.captured_document_activation_revisions enable row level security;
alter table private.captured_document_operations enable row level security;
alter table private.captured_document_operation_events enable row level security;
alter table private.captured_document_provider_attempts enable row level security;
alter table private.captured_document_revisions enable row level security;
alter table private.captured_document_approvals enable row level security;
alter table private.captured_document_exports enable row level security;
alter table private.captured_document_allowances enable row level security;
alter table private.captured_document_write_capabilities enable row level security;

revoke all on private.document_ledger_activation_pointers
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_activation_revisions
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_operations
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_operation_events
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_provider_attempts
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_revisions
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_approvals
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_exports
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_allowances
  from public, anon, authenticated, service_role;
revoke all on private.captured_document_write_capabilities
  from public, anon, authenticated, service_role;

-- Preserve immutable ledger contracts while allowing the existing auth-user
-- cascade to honour account deletion. A snapshot cannot be deleted while its
-- owner still exists; during the FK cascade the parent auth row is already gone.
create or replace function private.reject_immutable_ledger_row_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' and tg_table_name = 'document_generation_snapshots' then
    v_user_id := nullif(to_jsonb(old)->>'user_id', '')::uuid;
    if v_user_id is not null
      and not exists (select 1 from auth.users where id = v_user_id) then
      return old;
    end if;
  end if;
  raise exception 'IMMUTABLE_LEDGER_RECORD:% cannot be updated or deleted', tg_table_name;
end;
$function$;

create or replace function private.reject_captured_audit_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'IMMUTABLE_CAPTURED_RECORD:%', tg_table_name;
end;
$function$;

create trigger captured_document_activation_revisions_immutable
  before update or delete on private.captured_document_activation_revisions
  for each row execute function private.reject_captured_audit_update();
create trigger captured_document_operation_events_immutable
  before update on private.captured_document_operation_events
  for each row execute function private.reject_captured_audit_update();
create or replace function private.protect_captured_provider_attempt_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.operation_id is distinct from old.operation_id
    or new.user_id is distinct from old.user_id
    or new.logical_stage_key is distinct from old.logical_stage_key
    or new.attempt_number is distinct from old.attempt_number
    or new.provider is distinct from old.provider
    or new.semantic_route is distinct from old.semantic_route
    or new.model is distinct from old.model
    or new.reasoning_effort is distinct from old.reasoning_effort
    or new.retention_mode is distinct from old.retention_mode
    or new.started_at is distinct from old.started_at
    or new.request_sha256 is distinct from old.request_sha256
    or new.attempt_sha256 is distinct from old.attempt_sha256
    or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_CAPTURED_PROVIDER_ATTEMPT:%', old.id;
  end if;
  if old.status <> 'prepared'
    or new.status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'INVALID_CAPTURED_PROVIDER_ATTEMPT_TRANSITION:%:%',
      old.status, new.status;
  end if;
  return new;
end;
$function$;

create trigger captured_document_provider_attempt_completion_guard
  before update on private.captured_document_provider_attempts
  for each row execute function private.protect_captured_provider_attempt_completion();
create trigger captured_document_revisions_immutable
  before update on private.captured_document_revisions
  for each row execute function private.reject_captured_audit_update();
create trigger captured_document_approvals_immutable
  before update on private.captured_document_approvals
  for each row execute function private.reject_captured_audit_update();
create trigger captured_document_allowances_immutable
  before update on private.captured_document_allowances
  for each row execute function private.reject_captured_audit_update();

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

create trigger captured_document_operation_identity_immutable
  before update on private.captured_document_operations
  for each row execute function private.protect_captured_operation_identity();

create or replace function private.protect_captured_export_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
    or new.operation_id is distinct from old.operation_id
    or new.approval_id is distinct from old.approval_id
    or new.document_id is distinct from old.document_id
    or new.user_id is distinct from old.user_id
    or new.document_revision is distinct from old.document_revision
    or new.ledger_version is distinct from old.ledger_version
    or new.format is distinct from old.format
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_sha256 is distinct from old.request_sha256
    or new.validation_result is distinct from old.validation_result
    or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_CAPTURED_EXPORT_REQUEST:%', old.id;
  end if;
  if old.status <> 'requested' or new.status <> 'created' then
    raise exception 'INVALID_CAPTURED_EXPORT_TRANSITION:%:%', old.status, new.status;
  end if;
  if nullif(btrim(new.storage_path), '') is null
    or new.artifact_sha256 is null
    or new.artifact_sha256 !~ '^[0-9a-f]{64}$'
    or nullif(btrim(new.renderer_version), '') is null
    or jsonb_typeof(new.artifact_validation_result) is distinct from 'object'
    or new.completion_sha256 is null
    or new.completion_sha256 !~ '^[0-9a-f]{64}$'
    or new.completed_at is null then
    raise exception 'CAPTURED_EXPORT_COMPLETION_INVALID';
  end if;
  return new;
end;
$function$;

create trigger captured_document_export_completion_guard
  before update on private.captured_document_exports
  for each row execute function private.protect_captured_export_completion();

create or replace function private.begin_captured_document_write(
  p_write_context text,
  p_document_id uuid,
  p_operation_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_token uuid := gen_random_uuid();
begin
  if p_write_context not in (
    'accept_document', 'finalize_document', 'edit_document_section', 'approve_document'
  ) then
    raise exception 'INVALID_CAPTURED_WRITE_CONTEXT:%', p_write_context;
  end if;

  insert into private.captured_document_write_capabilities(
    token, transaction_id, write_context, document_id, operation_id
  ) values (
    v_token, pg_catalog.txid_current(), p_write_context, p_document_id, p_operation_id
  );
  perform pg_catalog.set_config('prompted.captured_document_write_token', v_token::text, true);
  return v_token;
end;
$function$;

create or replace function private.end_captured_document_write(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from private.captured_document_write_capabilities
  where token = p_token and transaction_id = pg_catalog.txid_current();
  perform pg_catalog.set_config('prompted.captured_document_write_token', '', true);
end;
$function$;

create or replace function private.captured_document_write_context(p_document_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_token uuid;
  v_context text;
begin
  begin
    v_token := nullif(
      pg_catalog.current_setting('prompted.captured_document_write_token', true), ''
    )::uuid;
  exception when invalid_text_representation then
    return '';
  end;

  if v_token is null then return ''; end if;

  select capability.write_context into v_context
  from private.captured_document_write_capabilities capability
  where capability.token = v_token
    and capability.transaction_id = pg_catalog.txid_current()
    and capability.document_id = p_document_id;

  return coalesce(v_context, '');
end;
$function$;

create or replace function private.captured_content_is_visible(p_content text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select length(
    regexp_replace(
      replace(
        regexp_replace(
          regexp_replace(
            coalesce(p_content, ''),
            '<[^>]*>', '', 'g'
          ),
          '&(nbsp|#0*160|#x0*a0);', '', 'gi'
        ),
        chr(160), ''
      ),
      '[[:space:]]', '', 'g'
    )
  ) > 0
$function$;

create or replace function private.append_captured_document_event(
  p_operation_id uuid,
  p_user_id uuid,
  p_operation_revision integer,
  p_status text,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 8192 then
    raise exception 'CAPTURED_EVENT_METADATA_INVALID';
  end if;
  if coalesce(p_metadata, '{}'::jsonb)::text ~* '\"(prompt|response|content|document_body|source_snapshot|evidence_snapshot|provider_body)\"[[:space:]]*:' then
    raise exception 'CAPTURED_EVENT_METADATA_SENSITIVE_FIELD';
  end if;

  insert into private.captured_document_operation_events(
    operation_id, user_id, operation_revision, status, event_type, metadata
  ) values (
    p_operation_id, p_user_id, p_operation_revision, p_status,
    p_event_type, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$function$;

create or replace function private.capture_captured_document_revision(
  p_operation_id uuid,
  p_document_id uuid,
  p_reason text,
  p_validation_result jsonb,
  p_actor_user_id uuid default null
) returns private.captured_document_revisions
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_sections jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_revision private.captured_document_revisions%rowtype;
begin
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id and document_id = p_document_id;
  if not found then raise exception 'CAPTURED_OPERATION_DOCUMENT_MISMATCH'; end if;

  select * into v_document
  from public.documents
  where id = p_document_id and user_id = v_operation.user_id;
  if not found or v_document.ledger_binding_status <> 'captured' then
    raise exception 'CAPTURED_DOCUMENT_NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', section_record.id,
        'section_key', section_record.section_key,
        'name', section_record.name,
        'order_index', section_record.order_index,
        'content', section_record.content,
        'status', section_record.status,
        'section_state', section_record.section_state,
        'is_required', section_record.is_required,
        'revision', section_record.revision,
        'approved_revision', section_record.approved_revision,
        'source_references', section_record.source_references
      ) order by section_record.order_index, section_record.id
    ),
    '[]'::jsonb
  ) into v_sections
  from public.sections section_record
  where section_record.document_id = p_document_id
    and section_record.user_id = v_operation.user_id;

  v_snapshot := jsonb_build_object(
    'document', jsonb_build_object(
      'id', v_document.id,
      'outcome_id', v_document.outcome_id,
      'title', v_document.title,
      'content', v_document.content,
      'doc_type', v_document.doc_type,
      'status', v_document.status,
      'format', v_document.format,
      'workspace_sections', v_document.workspace_sections,
      'unresolved_placeholders', v_document.unresolved_placeholders,
      'ledger_binding_status', v_document.ledger_binding_status,
      'ledger_template_id', v_document.ledger_template_id,
      'ledger_version', v_document.ledger_version,
      'generation_snapshot_id', v_document.generation_snapshot_id,
      'current_revision', v_document.current_revision,
      'approved_revision', v_document.approved_revision
    ),
    'sections', v_sections
  );
  v_hash := encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into private.captured_document_revisions(
    operation_id, document_id, user_id, document_revision, ledger_version,
    reason, snapshot, validation_result, snapshot_sha256, actor_user_id
  ) values (
    v_operation.id, v_document.id, v_document.user_id, v_document.current_revision,
    v_document.ledger_version, p_reason, v_snapshot,
    coalesce(p_validation_result, '{}'::jsonb), v_hash, p_actor_user_id
  )
  on conflict (document_id, document_revision) do nothing
  returning * into v_revision;

  if v_revision.id is null then
    select * into v_revision
    from private.captured_document_revisions
    where document_id = p_document_id
      and document_revision = v_document.current_revision;
    if v_revision.snapshot_sha256 <> v_hash
      or v_revision.operation_id <> p_operation_id then
      raise exception 'CAPTURED_DOCUMENT_REVISION_CONFLICT:%:%',
        p_document_id, v_document.current_revision;
    end if;
  end if;

  return v_revision;
end;
$function$;

create or replace function private.captured_operation_transition_allowed(
  p_from text,
  p_to text
) returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case p_from
    when 'accepted' then p_to in (
      'awaiting_clarification', 'awaiting_capacity', 'generating',
      'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'awaiting_clarification' then p_to in (
      'accepted', 'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'awaiting_capacity' then p_to in (
      'generating', 'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'generating' then p_to in (
      'validating', 'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'validating' then p_to in (
      'persisting', 'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'persisting' then p_to in (
      'retryable_failure', 'terminal_failure', 'cancelled'
    )
    when 'retryable_failure' then p_to in (
      'accepted', 'awaiting_capacity', 'generating', 'terminal_failure', 'cancelled'
    )
    else false
  end
$function$;

-- Replace the L0.2 placeholder guards. A user-defined GUC alone is not trusted:
-- the trigger requires a random transaction-bound capability row that only the
-- ungranted private helper can create.
create or replace function private.protect_document_ledger_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context text;
begin
  if tg_op = 'DELETE' then
    if old.ledger_binding_status = 'captured'
      and exists (select 1 from auth.users where id = old.user_id) then
      raise exception 'IMMUTABLE_CAPTURED_DOCUMENT:%', old.id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.ledger_binding_status = 'captured' then
      v_context := private.captured_document_write_context(new.id);
      if v_context <> 'accept_document' then
        raise exception 'CAPTURED_DOCUMENT_RPC_REQUIRED:%', new.id;
      end if;
      if new.current_revision <> 1 or new.approved_revision is not null then
        raise exception 'INVALID_CAPTURED_DOCUMENT_ACCEPTANCE_REVISION';
      end if;
    end if;
    return new;
  end if;

  if old.ledger_binding_status = 'legacy_unversioned'
    and new.ledger_binding_status = 'captured' then
    raise exception 'LEGACY_DOCUMENT_PROMOTION_NOT_AUTHORISED:%', old.id;
  end if;
  if old.ledger_binding_status <> 'captured' then return new; end if;

  v_context := private.captured_document_write_context(old.id);
  if v_context = '' then raise exception 'CAPTURED_DOCUMENT_RPC_REQUIRED:%', old.id; end if;

  if new.user_id is distinct from old.user_id
    or new.outcome_id is distinct from old.outcome_id
    or new.ledger_binding_status is distinct from old.ledger_binding_status
    or new.ledger_template_id is distinct from old.ledger_template_id
    or new.ledger_version is distinct from old.ledger_version
    or new.generation_snapshot_id is distinct from old.generation_snapshot_id
    or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_CAPTURED_DOCUMENT_IDENTITY:%', old.id;
  end if;

  if v_context in ('finalize_document', 'edit_document_section') then
    if new.current_revision <> old.current_revision + 1
      or new.approved_revision is not null then
      raise exception 'INVALID_CAPTURED_DOCUMENT_REVISION_ADVANCE:%', old.id;
    end if;
  elsif v_context = 'approve_document' then
    if new.current_revision <> old.current_revision
      or new.approved_revision <> old.current_revision
      or new.content is distinct from old.content
      or new.workspace_sections is distinct from old.workspace_sections
      or new.unresolved_placeholders is distinct from old.unresolved_placeholders then
      raise exception 'INVALID_CAPTURED_DOCUMENT_APPROVAL:%', old.id;
    end if;
  else
    raise exception 'INVALID_CAPTURED_DOCUMENT_WRITE_CONTEXT:%', v_context;
  end if;

  return new;
end;
$function$;

create or replace function private.protect_section_ledger_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context text;
begin
  if tg_op = 'DELETE' then
    if old.ledger_binding_status = 'captured'
      and exists (select 1 from auth.users where id = old.user_id) then
      raise exception 'IMMUTABLE_CAPTURED_SECTION:%', old.id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.ledger_binding_status = 'captured' then
      v_context := private.captured_document_write_context(new.document_id);
      if v_context <> 'finalize_document' then
        raise exception 'CAPTURED_SECTION_RPC_REQUIRED:%', new.id;
      end if;
      if new.revision <> 1 or new.approved_revision is not null then
        raise exception 'INVALID_CAPTURED_SECTION_INITIAL_REVISION';
      end if;
    end if;
    return new;
  end if;

  if old.ledger_binding_status = 'legacy_unversioned'
    and new.ledger_binding_status = 'captured' then
    raise exception 'LEGACY_SECTION_PROMOTION_NOT_AUTHORISED:%', old.id;
  end if;
  if old.ledger_binding_status <> 'captured' then return new; end if;

  v_context := private.captured_document_write_context(old.document_id);
  if v_context = '' then raise exception 'CAPTURED_SECTION_RPC_REQUIRED:%', old.id; end if;

  if new.document_id is distinct from old.document_id
    or new.user_id is distinct from old.user_id
    or new.ledger_binding_status is distinct from old.ledger_binding_status
    or new.section_key is distinct from old.section_key
    or new.ledger_version is distinct from old.ledger_version
    or new.is_required is distinct from old.is_required
    or new.source_section_id is distinct from old.source_section_id
    or new.source_section_key is distinct from old.source_section_key
    or new.transformation_version is distinct from old.transformation_version
    or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_CAPTURED_SECTION_IDENTITY:%', old.id;
  end if;

  if v_context in ('finalize_document', 'edit_document_section') then
    if new.revision <> old.revision + 1 or new.approved_revision is not null then
      raise exception 'INVALID_CAPTURED_SECTION_REVISION_ADVANCE:%', old.id;
    end if;
  elsif v_context = 'approve_document' then
    if new.revision <> old.revision
      or new.approved_revision <> old.revision
      or new.content is distinct from old.content
      or new.section_state is distinct from old.section_state
      or new.source_references is distinct from old.source_references then
      raise exception 'INVALID_CAPTURED_SECTION_APPROVAL:%', old.id;
    end if;
  else
    raise exception 'INVALID_CAPTURED_SECTION_WRITE_CONTEXT:%', v_context;
  end if;

  return new;
end;
$function$;

revoke all on function private.reject_captured_audit_update()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_captured_operation_identity()
  from public, anon, authenticated, service_role;
revoke all on function private.protect_captured_export_completion()
  from public, anon, authenticated, service_role;
revoke all on function private.begin_captured_document_write(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.end_captured_document_write(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.captured_document_write_context(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.capture_captured_document_revision(uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.append_captured_document_event(uuid, uuid, integer, text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.configure_captured_document_activation(
  p_environment text,
  p_user_cohort text,
  p_workflow text,
  p_template_id text,
  p_ledger_version text,
  p_routing_version text,
  p_route_snapshot jsonb,
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
  v_routing_version text := btrim(p_routing_version);
  v_scope_key text;
  v_contract jsonb;
  v_existing private.document_ledger_activation_pointers%rowtype;
  v_revision integer;
begin
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_user_cohort !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_ACTIVATION_SCOPE';
  end if;
  if v_template_id not in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  ) then
    raise exception 'TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%', v_template_id;
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'INVALID_ACTIVATION_EXPECTED_REVISION';
  end if;
  if nullif(v_routing_version, '') is null
    or nullif(btrim(p_changed_by), '') is null
    or nullif(btrim(p_change_reason), '') is null then
    raise exception 'CAPTURED_ACTIVATION_VERSION_AND_ACTOR_REQUIRED';
  end if;
  if jsonb_typeof(p_route_snapshot) is distinct from 'object'
    or p_route_snapshot->>'provider' is distinct from 'openai'
    or p_route_snapshot->>'routingVersion' is distinct from v_routing_version
    or jsonb_typeof(p_route_snapshot->'routes') is distinct from 'object'
    or not coalesce(p_route_snapshot->'routes' ? 'deep', false)
    or not coalesce(p_route_snapshot->'routes' ? 'review', false) then
    raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
  end if;
  if exists (
    select 1
    from jsonb_each(p_route_snapshot->'routes') route_entry
    where jsonb_typeof(route_entry.value) is distinct from 'object'
      or route_entry.value->>'provider' is distinct from 'openai'
      or route_entry.key not in ('fast', 'deep', 'research', 'review')
      or route_entry.value->>'semanticRoute' is distinct from route_entry.key
      or nullif(btrim(route_entry.value->>'model'), '') is null
      or route_entry.value->>'reasoningEffort' is distinct from case route_entry.key
        when 'fast' then 'low'
        when 'review' then 'high'
        else 'medium'
      end
      or route_entry.value->>'routingVersion' is distinct from v_routing_version
      or route_entry.value->>'structuredOutputSchemaVersion'
        is distinct from v_template_id || '.captured-output.1'
      or jsonb_typeof(route_entry.value->'allowedTools') is distinct from 'array'
      or (
        route_entry.key in ('deep', 'review')
        and route_entry.value->'allowedTools' is distinct from '[]'::jsonb
      )
      or case
        when coalesce(route_entry.value->>'timeoutMs', '') ~ '^[0-9]+$'
          then (route_entry.value->>'timeoutMs')::integer not between 1000 and 600000
        else true
      end
      or route_entry.value->>'maxAttempts' not in ('1', '2')
      or route_entry.value->'background' is distinct from 'false'::jsonb
      or route_entry.value->'store' is distinct from 'false'::jsonb
      or (
        route_entry.key <> 'fast'
        and route_entry.value->'fallback' is distinct from 'null'::jsonb
      )
  ) then
    raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
  end if;

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = p_ledger_version;
  if not found then raise exception 'UNKNOWN_LEDGER_VERSION:%', p_ledger_version; end if;
  if not (v_contract->'templates' ? v_template_id) then
    raise exception 'UNKNOWN_LEDGER_TEMPLATE:%:%', p_ledger_version, v_template_id;
  end if;

  v_scope_key := v_environment || ':' || v_user_cohort || ':' || v_workflow || ':' || v_template_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('captured-activation:' || v_scope_key, 0)
  );

  select * into v_existing
  from private.document_ledger_activation_pointers
  where scope_key = v_scope_key
  for update;

  if found then
    if v_existing.environment = v_environment
      and v_existing.user_cohort = v_user_cohort
      and v_existing.workflow = v_workflow
      and v_existing.template_id = v_template_id
      and v_existing.ledger_version = p_ledger_version
      and v_existing.routing_version = v_routing_version
      and v_existing.route_snapshot = p_route_snapshot
      and v_existing.enabled = p_enabled then
      return jsonb_build_object(
        'scope_key', v_scope_key,
        'revision', v_existing.revision,
        'enabled', v_existing.enabled,
        'idempotent_replay', true
      );
    end if;
    if v_existing.revision <> p_expected_revision then
      raise exception 'STALE_ACTIVATION_POINTER:expected:%:actual:%',
        p_expected_revision, v_existing.revision;
    end if;
    v_revision := v_existing.revision + 1;
    update private.document_ledger_activation_pointers
    set environment = v_environment,
        user_cohort = v_user_cohort,
        workflow = v_workflow,
        template_id = v_template_id,
        ledger_version = p_ledger_version,
        routing_version = v_routing_version,
        route_snapshot = p_route_snapshot,
        enabled = p_enabled,
        revision = v_revision,
        activated_at = case when p_enabled then now() else null end,
        activated_by = case when p_enabled then btrim(p_changed_by) else null end,
        disabled_at = case when p_enabled then null else now() end,
        disabled_by = case when p_enabled then null else btrim(p_changed_by) end,
        updated_at = now()
    where scope_key = v_scope_key;
  else
    if p_expected_revision <> 0 then
      raise exception 'STALE_ACTIVATION_POINTER:expected:%:actual:0', p_expected_revision;
    end if;
    v_revision := 1;
    insert into private.document_ledger_activation_pointers(
      scope_key, ledger_version, enabled, revision, activated_at, activated_by,
      updated_at, environment, user_cohort, workflow, template_id,
      routing_version, route_snapshot, disabled_at, disabled_by
    ) values (
      v_scope_key, p_ledger_version, p_enabled, v_revision,
      case when p_enabled then now() else null end,
      case when p_enabled then btrim(p_changed_by) else null end,
      now(), v_environment, v_user_cohort, v_workflow, v_template_id,
      v_routing_version, p_route_snapshot,
      case when p_enabled then null else now() end,
      case when p_enabled then null else btrim(p_changed_by) end
    );
  end if;

  insert into private.captured_document_activation_revisions(
    scope_key, revision, environment, user_cohort, workflow, template_id,
    ledger_version, routing_version, route_snapshot, enabled,
    changed_by, change_reason
  ) values (
    v_scope_key, v_revision, v_environment, v_user_cohort, v_workflow,
    v_template_id, p_ledger_version, v_routing_version, p_route_snapshot,
    p_enabled, btrim(p_changed_by), btrim(p_change_reason)
  );

  return jsonb_build_object(
    'scope_key', v_scope_key,
    'revision', v_revision,
    'enabled', p_enabled,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.configure_captured_document_activation(
  text, text, text, text, text, text, jsonb, boolean, integer, text, text
) from public, anon, authenticated;
grant execute on function public.configure_captured_document_activation(
  text, text, text, text, text, text, jsonb, boolean, integer, text, text
) to service_role;

create or replace function public.accept_captured_document_operation(
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_environment text,
  p_user_cohort text,
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
  v_user_cohort text := lower(btrim(p_user_cohort));
  v_workflow text := lower(btrim(p_workflow));
  v_template_id text := lower(btrim(p_template_id));
  v_idempotency_key text := btrim(p_idempotency_key);
  v_scope_key text;
  v_activation private.document_ledger_activation_pointers%rowtype;
  v_existing private.captured_document_operations%rowtype;
  v_operation private.captured_document_operations%rowtype;
  v_contract jsonb;
  v_ledger_keys text[];
  v_safe_keys text[];
  v_blocked_keys text[];
  v_request_payload jsonb;
  v_request_hash text;
  v_snapshot_result jsonb;
  v_snapshot_id uuid;
  v_snapshot_request_id text;
  v_write_token uuid;
  v_initial_revision private.captured_document_revisions%rowtype;
begin
  if p_user_id is null or p_outcome_id is null or p_document_id is null then
    raise exception 'CAPTURED_OPERATION_IDENTITY_REQUIRED';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(p_title) > 240 then
    raise exception 'CAPTURED_DOCUMENT_TITLE_INVALID';
  end if;
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_user_cohort !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_OPERATION_SCOPE';
  end if;
  if v_template_id not in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  ) then
    raise exception 'TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%', v_template_id;
  end if;
  if p_input_revision is null or p_input_revision < 1
    or char_length(v_idempotency_key) not between 1 and 128
    or nullif(btrim(p_benchmark_version), '') is null
    or nullif(btrim(p_pipeline_version), '') is null
    or nullif(btrim(p_locale), '') is null
    or nullif(btrim(p_jurisdiction), '') is null then
    raise exception 'CAPTURED_OPERATION_VERSION_OR_IDEMPOTENCY_INVALID';
  end if;
  if p_operation_ttl_seconds not between 60 and 604800 then
    raise exception 'CAPTURED_OPERATION_TTL_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_input_values, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_source_snapshot, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_evidence_snapshot, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_confirmations, '{}'::jsonb)) <> 'object' then
    raise exception 'CAPTURED_OPERATION_SNAPSHOT_INVALID';
  end if;
  if array_position(coalesce(p_safe_section_keys, '{}'::text[]), null) is not null
    or array_position(coalesce(p_blocked_section_keys, '{}'::text[]), null) is not null
    or array_position(coalesce(p_unresolved_input_keys, '{}'::text[]), null) is not null then
    raise exception 'CAPTURED_OPERATION_KEY_SET_INVALID';
  end if;

  select coalesce(array_agg(key_value order by key_value), '{}'::text[])
  into v_safe_keys
  from (
    select distinct btrim(key_value) as key_value
    from unnest(coalesce(p_safe_section_keys, '{}'::text[])) key_value
    where nullif(btrim(key_value), '') is not null
  ) normalized;
  select coalesce(array_agg(key_value order by key_value), '{}'::text[])
  into v_blocked_keys
  from (
    select distinct btrim(key_value) as key_value
    from unnest(coalesce(p_blocked_section_keys, '{}'::text[])) key_value
    where nullif(btrim(key_value), '') is not null
  ) normalized;

  if cardinality(v_safe_keys) <> cardinality(coalesce(p_safe_section_keys, '{}'::text[]))
    or cardinality(v_blocked_keys) <> cardinality(coalesce(p_blocked_section_keys, '{}'::text[]))
    or v_safe_keys && v_blocked_keys then
    raise exception 'CAPTURED_OPERATION_SECTION_PARTITION_INVALID';
  end if;

  v_scope_key := v_environment || ':' || v_user_cohort || ':' || v_workflow || ':' || v_template_id;
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
    if v_existing.environment <> v_environment
      or v_existing.user_cohort <> v_user_cohort
      or v_existing.workflow <> v_workflow
      or v_existing.template_id <> v_template_id then
      raise exception 'CAPTURED_OPERATION_REPLAY_CONFLICT:%', v_existing.id;
    end if;
    select contract_json into v_contract
    from private.document_ledger_versions
    where ledger_version = v_existing.ledger_version;
    v_request_payload := jsonb_build_object(
      'userId', p_user_id,
      'outcomeId', p_outcome_id,
      'documentId', p_document_id,
      'title', btrim(p_title),
      'environment', v_environment,
      'userCohort', v_user_cohort,
      'workflow', v_workflow,
      'templateId', v_template_id,
      'ledgerVersion', v_existing.ledger_version,
      'activationRevision', v_existing.activation_revision,
      'benchmarkVersion', btrim(p_benchmark_version),
      'pipelineVersion', btrim(p_pipeline_version),
      'routingVersion', v_existing.routing_version,
      'routeSnapshot', v_existing.route_snapshot,
      'inputRevision', p_input_revision,
      'idempotencyKey', v_idempotency_key,
      'inputValues', coalesce(p_input_values, '{}'::jsonb),
      'sourceSnapshot', coalesce(p_source_snapshot, '{}'::jsonb),
      'evidenceSnapshot', coalesce(p_evidence_snapshot, '{}'::jsonb),
      'locale', btrim(p_locale),
      'jurisdiction', btrim(p_jurisdiction),
      'safeSectionKeys', to_jsonb(v_safe_keys),
      'blockedSectionKeys', to_jsonb(v_blocked_keys),
      'unresolvedInputKeys', to_jsonb(coalesce(p_unresolved_input_keys, '{}'::text[])),
      'confirmations', coalesce(p_confirmations, '{}'::jsonb),
      'operationTtlSeconds', p_operation_ttl_seconds
    );
    v_request_hash := encode(
      extensions.digest(pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );
    if v_existing.request_sha256 <> v_request_hash then
      raise exception 'CAPTURED_OPERATION_REPLAY_CONFLICT:%', v_existing.id;
    end if;
    return jsonb_build_object(
      'contract_version', v_existing.contract_version,
      'operation_id', v_existing.id,
      'document_id', v_existing.document_id,
      'operation_revision', v_existing.operation_revision,
      'accepted_document_revision', v_existing.accepted_document_revision,
      'status', v_existing.status,
      'safe_section_keys', to_jsonb(v_existing.safe_section_keys),
      'blocked_section_keys', to_jsonb(v_existing.blocked_section_keys),
      'retryable', v_existing.retryable,
      'correlation_id', v_existing.correlation_id,
      'routing_version', v_existing.routing_version,
      'route_snapshot', v_existing.route_snapshot,
      'generation_checkpoint', (
        select attempt_record.structured_output
        from private.captured_document_provider_attempts attempt_record
        where attempt_record.operation_id = v_existing.id
          and attempt_record.logical_stage_key = 'generation'
          and attempt_record.status = 'succeeded'
        order by attempt_record.attempt_number desc
        limit 1
      ),
      'review_checkpoint', (
        select attempt_record.structured_output
        from private.captured_document_provider_attempts attempt_record
        where attempt_record.operation_id = v_existing.id
          and attempt_record.logical_stage_key = 'review'
          and attempt_record.status = 'succeeded'
        order by attempt_record.attempt_number desc
        limit 1
      ),
      'idempotency_reference', v_existing.idempotency_key,
      'status_reference', jsonb_build_object(
        'rpc', 'get_captured_document_operation',
        'operation_id', v_existing.id
      ),
      'expires_at', v_existing.expires_at,
      'idempotent_replay', true
    );
  end if;

  select * into v_activation
  from private.document_ledger_activation_pointers
  where scope_key = v_scope_key
    and environment = v_environment
    and user_cohort = v_user_cohort
    and workflow = v_workflow
    and template_id = v_template_id
    and enabled
  for share;
  if not found then raise exception 'CAPTURED_ACTIVATION_DISABLED:%', v_scope_key; end if;

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = v_activation.ledger_version;
  if not found or not (v_contract->'templates' ? v_template_id) then
    raise exception 'CAPTURED_ACTIVATION_LEDGER_INVALID:%', v_scope_key;
  end if;
  if jsonb_typeof(v_contract->'templates'->v_template_id->'sections') <> 'array' then
    raise exception 'CAPTURED_LEDGER_SECTIONS_INVALID:%:%',
      v_activation.ledger_version, v_template_id;
  end if;

  select coalesce(
    array_agg(section_key order by section_ordinal),
    '{}'::text[]
  ) into v_ledger_keys
  from (
    select
      coalesce(section_value->>'sectionKey', section_value->>'key') as section_key,
      section_ordinal
    from jsonb_array_elements(
      v_contract->'templates'->v_template_id->'sections'
    ) with ordinality ledger_section(section_value, section_ordinal)
  ) ledger_keys;

  if cardinality(v_ledger_keys) = 0
    or array_position(v_ledger_keys, null) is not null
    or cardinality(v_ledger_keys) <> (
      select count(distinct key_value)
      from unnest(v_ledger_keys) key_value
    )
    or not (v_ledger_keys <@ (v_safe_keys || v_blocked_keys))
    or not ((v_safe_keys || v_blocked_keys) <@ v_ledger_keys) then
    raise exception 'CAPTURED_OPERATION_SECTION_PARTITION_MISMATCH';
  end if;

  if not exists (
    select 1 from public.outcomes
    where id = p_outcome_id and user_id = p_user_id
  ) then
    raise exception 'CAPTURED_OUTCOME_NOT_FOUND';
  end if;
  if exists (select 1 from public.documents where id = p_document_id) then
    raise exception 'CAPTURED_DOCUMENT_ID_ALREADY_EXISTS:%', p_document_id;
  end if;

  v_request_payload := jsonb_build_object(
    'userId', p_user_id,
    'outcomeId', p_outcome_id,
    'documentId', p_document_id,
    'title', btrim(p_title),
    'environment', v_environment,
    'userCohort', v_user_cohort,
    'workflow', v_workflow,
    'templateId', v_template_id,
    'ledgerVersion', v_activation.ledger_version,
    'activationRevision', v_activation.revision,
    'benchmarkVersion', btrim(p_benchmark_version),
    'pipelineVersion', btrim(p_pipeline_version),
    'routingVersion', v_activation.routing_version,
    'routeSnapshot', v_activation.route_snapshot,
    'inputRevision', p_input_revision,
    'idempotencyKey', v_idempotency_key,
    'inputValues', coalesce(p_input_values, '{}'::jsonb),
    'sourceSnapshot', coalesce(p_source_snapshot, '{}'::jsonb),
    'evidenceSnapshot', coalesce(p_evidence_snapshot, '{}'::jsonb),
    'locale', btrim(p_locale),
    'jurisdiction', btrim(p_jurisdiction),
    'safeSectionKeys', to_jsonb(v_safe_keys),
    'blockedSectionKeys', to_jsonb(v_blocked_keys),
    'unresolvedInputKeys', to_jsonb(coalesce(p_unresolved_input_keys, '{}'::text[])),
    'confirmations', coalesce(p_confirmations, '{}'::jsonb),
    'operationTtlSeconds', p_operation_ttl_seconds
  );
  v_request_hash := encode(
    extensions.digest(pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_snapshot_request_id := 'captured:' || encode(
    extensions.digest(pg_catalog.convert_to(v_idempotency_key, 'UTF8'), 'sha256'),
    'hex'
  );
  v_snapshot_result := public.prepare_document_generation_snapshot(
    p_user_id,
    v_snapshot_request_id,
    v_activation.ledger_version,
    v_template_id,
    btrim(p_benchmark_version),
    btrim(p_pipeline_version),
    coalesce(p_input_values, '{}'::jsonb),
    coalesce(p_source_snapshot, '{}'::jsonb),
    coalesce(p_evidence_snapshot, '{}'::jsonb),
    coalesce(p_unresolved_input_keys, '{}'::text[]),
    coalesce(p_confirmations, '{}'::jsonb)
  );
  v_snapshot_id := (v_snapshot_result->>'generation_snapshot_id')::uuid;

  insert into private.captured_document_operations(
    user_id, outcome_id, document_id, generation_snapshot_id,
    activation_scope_key, activation_revision, environment, user_cohort,
    workflow, template_id, ledger_version, benchmark_version, pipeline_version,
    routing_version, route_snapshot, locale, jurisdiction, idempotency_key,
    request_sha256, input_revision, accepted_document_revision,
    safe_section_keys, blocked_section_keys, status, operation_revision,
    expires_at
  ) values (
    p_user_id, p_outcome_id, p_document_id, v_snapshot_id,
    v_scope_key, v_activation.revision, v_environment, v_user_cohort,
    v_workflow, v_template_id, v_activation.ledger_version,
    btrim(p_benchmark_version), btrim(p_pipeline_version),
    v_activation.routing_version, v_activation.route_snapshot,
    btrim(p_locale), btrim(p_jurisdiction), v_idempotency_key,
    v_request_hash, p_input_revision, 1, v_safe_keys, v_blocked_keys,
    'accepted', 1,
    clock_timestamp() + pg_catalog.make_interval(secs => p_operation_ttl_seconds)
  ) returning * into v_operation;

  v_write_token := private.begin_captured_document_write(
    'accept_document', p_document_id, v_operation.id
  );
  insert into public.documents(
    id, user_id, outcome_id, title, content, doc_type, status,
    workspace_sections, format, unresolved_placeholders,
    ledger_binding_status, ledger_template_id, ledger_version,
    generation_snapshot_id, current_revision, approved_revision
  ) values (
    p_document_id, p_user_id, p_outcome_id, btrim(p_title), '', v_template_id,
    'draft', '[]'::jsonb, 'Word', '[]'::jsonb,
    'captured', v_template_id, v_activation.ledger_version,
    v_snapshot_id, 1, null
  );
  perform private.end_captured_document_write(v_write_token);

  v_initial_revision := private.capture_captured_document_revision(
    v_operation.id,
    p_document_id,
    'accepted',
    jsonb_build_object('passed', false, 'state', 'accepted'),
    null
  );
  perform private.append_captured_document_event(
    v_operation.id,
    p_user_id,
    1,
    'accepted',
    'operation_accepted',
    jsonb_build_object(
      'document_id', p_document_id,
      'document_revision', 1,
      'ledger_version', v_operation.ledger_version,
      'activation_scope_key', v_scope_key,
      'activation_revision', v_operation.activation_revision,
      'routing_version', v_operation.routing_version,
      'snapshot_sha256', v_initial_revision.snapshot_sha256
    )
  );

  return jsonb_build_object(
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'status', v_operation.status,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'retryable', v_operation.retryable,
    'correlation_id', v_operation.correlation_id,
    'routing_version', v_operation.routing_version,
    'route_snapshot', v_operation.route_snapshot,
    'generation_checkpoint', null,
    'review_checkpoint', null,
    'idempotency_reference', v_operation.idempotency_key,
    'status_reference', jsonb_build_object(
      'rpc', 'get_captured_document_operation',
      'operation_id', v_operation.id
    ),
    'expires_at', v_operation.expires_at,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.accept_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) from public, anon, authenticated;
grant execute on function public.accept_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) to service_role;

create or replace function public.get_captured_document_operation(
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document_revision integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id and user_id = v_user_id;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  select current_revision into v_document_revision
  from public.documents
  where id = v_operation.document_id and user_id = v_user_id;

  return jsonb_build_object(
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'document_revision', v_document_revision,
    'operation_revision', v_operation.operation_revision,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'status', v_operation.status,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'retryable', v_operation.retryable,
    'error_code', v_operation.error_code,
    'message', v_operation.public_error_message,
    'safe_next_action', v_operation.safe_next_action,
    'correlation_id', v_operation.correlation_id,
    'expires_at', v_operation.expires_at,
    'updated_at', v_operation.updated_at
  );
end;
$function$;

revoke all on function public.get_captured_document_operation(uuid)
  from public, anon;
grant execute on function public.get_captured_document_operation(uuid)
  to authenticated;

create or replace function public.get_latest_captured_document_operation(
  p_document_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document_revision integer;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_document_id is null then return null; end if;

  select operation_record.* into v_operation
  from private.captured_document_operations operation_record
  where operation_record.document_id = p_document_id
    and operation_record.user_id = v_user_id
  order by
    (operation_record.status not in (
      'ready_for_review', 'terminal_failure', 'cancelled'
    )) desc,
    operation_record.updated_at desc,
    operation_record.id desc
  limit 1;
  if not found then return null; end if;

  select current_revision into v_document_revision
  from public.documents
  where id = v_operation.document_id and user_id = v_user_id;

  return jsonb_build_object(
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'document_revision', v_document_revision,
    'operation_revision', v_operation.operation_revision,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'status', v_operation.status,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'retryable', v_operation.retryable,
    'error_code', v_operation.error_code,
    'message', v_operation.public_error_message,
    'safe_next_action', v_operation.safe_next_action,
    'correlation_id', v_operation.correlation_id,
    'expires_at', v_operation.expires_at,
    'updated_at', v_operation.updated_at
  );
end;
$function$;

revoke all on function public.get_latest_captured_document_operation(uuid)
  from public, anon;
grant execute on function public.get_latest_captured_document_operation(uuid)
  to authenticated;

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

  if v_operation.expires_at <= clock_timestamp() then
    update private.captured_document_operations
    set status = 'terminal_failure',
        operation_revision = operation_revision + 1,
        retryable = false,
        error_code = 'OPERATION_EXPIRED',
        public_error_message = 'This generation operation expired before it could finish.',
        safe_next_action = 'Start a new generation operation.',
        lease_token = null,
        lease_owner = null,
        lease_expires_at = null,
        terminal_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = p_operation_id
    returning * into v_operation;
    perform private.append_captured_document_event(
      v_operation.id, v_operation.user_id, v_operation.operation_revision,
      v_operation.status, 'operation_expired',
      jsonb_build_object('error_code', v_operation.error_code)
    );
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'lease_token', null,
      'expired', true
    );
  end if;
  if v_operation.status in ('ready_for_review', 'terminal_failure', 'cancelled') then
    raise exception 'CAPTURED_OPERATION_NOT_CLAIMABLE:%', v_operation.status;
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

create or replace function public.advance_captured_document_operation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_token uuid,
  p_next_status text,
  p_event_metadata jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_public_error_message text default null,
  p_safe_next_action text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_clear_lease boolean;
begin
  if p_next_status = 'ready_for_review' then
    raise exception 'READY_FOR_REVIEW_REQUIRES_ATOMIC_FINALIZATION';
  end if;
  if p_next_status = 'cancelled' then
    raise exception 'CANCELLED_REQUIRES_CANCELLATION_RPC';
  end if;
  if jsonb_typeof(coalesce(p_event_metadata, '{}'::jsonb)) <> 'object'
    or char_length(coalesce(p_error_code, '')) > 120
    or char_length(coalesce(p_public_error_message, '')) > 500
    or char_length(coalesce(p_safe_next_action, '')) > 500 then
    raise exception 'CAPTURED_OPERATION_ADVANCE_INPUT_INVALID';
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
  if p_lease_token is null
    or v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;
  if v_operation.expires_at <= clock_timestamp()
    and p_next_status <> 'terminal_failure' then
    raise exception 'CAPTURED_OPERATION_EXPIRED';
  end if;
  if not private.captured_operation_transition_allowed(
    v_operation.status, p_next_status
  ) then
    raise exception 'INVALID_CAPTURED_OPERATION_TRANSITION:%:%',
      v_operation.status, p_next_status;
  end if;
  if p_next_status in ('retryable_failure', 'terminal_failure')
    and nullif(btrim(p_error_code), '') is null then
    raise exception 'CAPTURED_OPERATION_ERROR_CODE_REQUIRED';
  end if;

  v_clear_lease := p_next_status in (
    'awaiting_clarification', 'awaiting_capacity',
    'retryable_failure', 'terminal_failure'
  );

  update private.captured_document_operations
  set status = p_next_status,
      operation_revision = operation_revision + 1,
      retryable = p_next_status = 'retryable_failure',
      error_code = case
        when p_next_status in ('retryable_failure', 'terminal_failure')
          then btrim(p_error_code)
        else null
      end,
      public_error_message = case
        when p_next_status in ('retryable_failure', 'terminal_failure')
          then nullif(btrim(p_public_error_message), '')
        else null
      end,
      safe_next_action = case
        when p_next_status in ('retryable_failure', 'terminal_failure')
          then nullif(btrim(p_safe_next_action), '')
        else null
      end,
      lease_token = case when v_clear_lease then null else lease_token end,
      lease_owner = case when v_clear_lease then null else lease_owner end,
      lease_expires_at = case when v_clear_lease then null else lease_expires_at end,
      terminal_at = case when p_next_status = 'terminal_failure' then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'status_changed',
    coalesce(p_event_metadata, '{}'::jsonb) || jsonb_build_object(
      'error_code', v_operation.error_code,
      'retryable', v_operation.retryable
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'retryable', v_operation.retryable,
    'lease_retained', v_operation.lease_token is not null,
    'correlation_id', v_operation.correlation_id
  );
end;
$function$;

revoke all on function public.advance_captured_document_operation(
  uuid, integer, uuid, text, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.advance_captured_document_operation(
  uuid, integer, uuid, text, jsonb, text, text, text
) to service_role;

create or replace function public.record_captured_document_provider_attempt(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_token uuid,
  p_logical_stage_key text,
  p_attempt_number integer,
  p_semantic_route text,
  p_model text,
  p_reasoning_effort text,
  p_provider_response_id text,
  p_retention_mode text,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_retry_reason text,
  p_error_code text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_request_sha256 text,
  p_structured_output jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_existing private.captured_document_provider_attempts%rowtype;
  v_attempt private.captured_document_provider_attempts%rowtype;
  v_route jsonb;
  v_payload jsonb;
  v_hash text;
  v_stage text := btrim(p_logical_stage_key);
  v_attempt_number integer;
begin
  if p_logical_stage_key is null
    or nullif(v_stage, '') is null
    or char_length(p_logical_stage_key) > 120
    or p_attempt_number is null or p_attempt_number < 0
    or p_semantic_route is null
    or p_semantic_route not in ('fast', 'deep', 'research', 'review')
    or nullif(btrim(p_model), '') is null
    or p_reasoning_effort is null
    or p_reasoning_effort not in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    or p_retention_mode is null
    or p_retention_mode not in (
      'store_false', 'background_store_false', 'provider_default_unverified'
    )
    or p_status is null
    or p_status not in ('prepared', 'succeeded', 'failed', 'cancelled')
    or p_input_tokens is null or p_input_tokens < 0
    or p_output_tokens is null or p_output_tokens < 0
    or p_started_at is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or (v_stage = 'generation' and p_semantic_route <> 'deep')
    or (v_stage = 'review' and p_semantic_route <> 'review')
    or v_stage not in ('generation', 'review') then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_INVALID';
  end if;
  if p_status = 'prepared' and (
    p_attempt_number <> 0
    or nullif(btrim(p_provider_response_id), '') is not null
    or p_input_tokens <> 0 or p_output_tokens <> 0
    or nullif(btrim(p_retry_reason), '') is not null
    or nullif(btrim(p_error_code), '') is not null
    or p_completed_at is not null
    or p_structured_output is not null
  ) then
    raise exception 'CAPTURED_PROVIDER_PREPARATION_INVALID';
  end if;
  if p_status <> 'prepared' and (
    p_attempt_number < 1
    or p_completed_at is null
    or p_completed_at < p_started_at
    or (
      p_status = 'succeeded'
      and (
        nullif(btrim(p_provider_response_id), '') is null
        or jsonb_typeof(p_structured_output) is distinct from 'object'
        or octet_length(p_structured_output::text) > 10485760
        or nullif(btrim(p_error_code), '') is not null
      )
    )
    or (
      p_status in ('failed', 'cancelled')
      and (
        p_structured_output is not null
        or nullif(btrim(p_error_code), '') is null
      )
    )
  ) then
    raise exception 'CAPTURED_PROVIDER_COMPLETION_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  v_route := v_operation.route_snapshot->'routes'->p_semantic_route;
  if jsonb_typeof(v_route) is distinct from 'object'
    or v_route->>'provider' is distinct from 'openai'
    or v_route->>'semanticRoute' is distinct from p_semantic_route
    or v_route->>'model' is distinct from p_model
    or v_route->>'reasoningEffort' is distinct from p_reasoning_effort
    or v_route->>'routingVersion' is distinct from v_operation.routing_version then
    raise exception 'CAPTURED_PROVIDER_ROUTE_MISMATCH:%', p_semantic_route;
  end if;

  if p_status = 'prepared' then
    select * into v_existing
    from private.captured_document_provider_attempts
    where operation_id = p_operation_id
      and logical_stage_key = v_stage
      and status = 'prepared';
    if found then
      if v_existing.request_sha256 <> p_request_sha256
        or v_existing.started_at <> p_started_at
        or v_existing.semantic_route <> p_semantic_route
        or v_existing.model <> p_model
        or v_existing.reasoning_effort <> p_reasoning_effort
        or v_existing.retention_mode <> p_retention_mode then
        raise exception 'CAPTURED_PROVIDER_ATTEMPT_RECONCILIATION_REQUIRED';
      end if;
      return jsonb_build_object(
        'attempt_id', v_existing.id,
        'provider_attempt_number', v_existing.attempt_number,
        'provider_client_request_id', v_existing.id::text,
        'operation_id', v_existing.operation_id,
        'operation_revision', v_operation.operation_revision,
        'idempotent_replay', true
      );
    end if;

    if exists (
      select 1
      from private.captured_document_provider_attempts attempt_record
      where attempt_record.operation_id = p_operation_id
        and attempt_record.logical_stage_key = v_stage
        and attempt_record.status = 'succeeded'
    ) then
      raise exception 'CAPTURED_PROVIDER_SUCCESS_RECONCILIATION_REQUIRED';
    end if;

    if v_operation.operation_revision <> p_expected_operation_revision then
      raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
        p_expected_operation_revision, v_operation.operation_revision;
    end if;
    if p_lease_token is null
      or v_operation.lease_token is distinct from p_lease_token
      or v_operation.lease_expires_at is null
      or v_operation.lease_expires_at <= clock_timestamp() then
      raise exception 'CAPTURED_OPERATION_LEASE_LOST';
    end if;
    if (v_stage = 'generation' and v_operation.status <> 'generating')
      or (v_stage = 'review' and v_operation.status <> 'validating') then
      raise exception 'CAPTURED_PROVIDER_ATTEMPT_STATUS_INVALID:%', v_operation.status;
    end if;

    select coalesce(max(attempt_record.attempt_number), 0) + 1
    into v_attempt_number
    from private.captured_document_provider_attempts attempt_record
    where attempt_record.operation_id = p_operation_id
      and attempt_record.logical_stage_key = v_stage;

    v_payload := jsonb_build_object(
      'operationId', p_operation_id,
      'logicalStageKey', v_stage,
      'attemptNumber', v_attempt_number,
      'provider', 'openai',
      'semanticRoute', p_semantic_route,
      'model', p_model,
      'reasoningEffort', p_reasoning_effort,
      'retentionMode', p_retention_mode,
      'requestSha256', p_request_sha256,
      'startedAt', p_started_at
    );
    v_hash := encode(
      extensions.digest(pg_catalog.convert_to(v_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );

    insert into private.captured_document_provider_attempts(
      operation_id, user_id, logical_stage_key, attempt_number, provider,
      semantic_route, model, reasoning_effort, provider_response_id,
      retention_mode, status, input_tokens, output_tokens, retry_reason,
      error_code, started_at, completed_at, request_sha256,
      structured_output, attempt_sha256
    ) values (
      v_operation.id, v_operation.user_id, v_stage, v_attempt_number,
      'openai', p_semantic_route, p_model, p_reasoning_effort, null,
      p_retention_mode, 'prepared', 0, 0, null, null, p_started_at, null,
      p_request_sha256, null, v_hash
    ) returning * into v_attempt;

    update private.captured_document_operations
    set operation_revision = operation_revision + 1,
        updated_at = clock_timestamp()
    where id = p_operation_id
    returning * into v_operation;

    perform private.append_captured_document_event(
      v_operation.id, v_operation.user_id, v_operation.operation_revision,
      v_operation.status, 'provider_attempt_prepared',
      jsonb_build_object(
        'logical_stage_key', v_attempt.logical_stage_key,
        'attempt_number', v_attempt.attempt_number,
        'semantic_route', v_attempt.semantic_route,
        'model', v_attempt.model,
        'attempt_sha256', v_attempt.attempt_sha256
      )
    );

    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'provider_attempt_number', v_attempt.attempt_number,
      'provider_client_request_id', v_attempt.id::text,
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'idempotent_replay', false
    );
  end if;

  select * into v_existing
  from private.captured_document_provider_attempts
  where operation_id = p_operation_id
    and logical_stage_key = v_stage
    and attempt_number = p_attempt_number;
  if not found then
    raise exception 'CAPTURED_PROVIDER_PREPARATION_NOT_FOUND';
  end if;
  if v_existing.status <> 'prepared' then
    if v_existing.request_sha256 <> p_request_sha256
      or v_existing.started_at <> p_started_at
      or v_existing.semantic_route <> p_semantic_route
      or v_existing.model <> p_model
      or v_existing.reasoning_effort <> p_reasoning_effort
      or v_existing.provider_response_id is distinct from nullif(btrim(p_provider_response_id), '')
      or v_existing.status <> p_status
      or v_existing.input_tokens <> p_input_tokens
      or v_existing.output_tokens <> p_output_tokens
      or v_existing.retry_reason is distinct from nullif(btrim(p_retry_reason), '')
      or v_existing.error_code is distinct from nullif(btrim(p_error_code), '')
      or v_existing.completed_at <> p_completed_at
      or v_existing.structured_output is distinct from p_structured_output then
      raise exception 'CAPTURED_PROVIDER_ATTEMPT_REPLAY_CONFLICT';
    end if;
    return jsonb_build_object(
      'attempt_id', v_existing.id,
      'provider_attempt_number', v_existing.attempt_number,
      'provider_client_request_id', v_existing.id::text,
      'operation_id', v_existing.operation_id,
      'operation_revision', v_operation.operation_revision,
      'idempotent_replay', true
    );
  end if;

  if v_existing.request_sha256 <> p_request_sha256
    or v_existing.started_at <> p_started_at
    or v_existing.semantic_route <> p_semantic_route
    or v_existing.model <> p_model
    or v_existing.reasoning_effort <> p_reasoning_effort
    or v_existing.retention_mode <> p_retention_mode then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_REPLAY_CONFLICT';
  end if;

  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if p_lease_token is null
    or v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;
  if (v_stage = 'generation' and v_operation.status <> 'generating')
    or (v_stage = 'review' and v_operation.status <> 'validating') then
    raise exception 'CAPTURED_PROVIDER_ATTEMPT_STATUS_INVALID:%', v_operation.status;
  end if;

  update private.captured_document_provider_attempts
  set provider_response_id = nullif(btrim(p_provider_response_id), ''),
      status = p_status,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      retry_reason = nullif(btrim(p_retry_reason), ''),
      error_code = nullif(btrim(p_error_code), ''),
      completed_at = p_completed_at,
      structured_output = p_structured_output
  where id = v_existing.id
  returning * into v_attempt;

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'provider_attempt_completed',
    jsonb_build_object(
      'logical_stage_key', v_attempt.logical_stage_key,
      'attempt_number', v_attempt.attempt_number,
      'semantic_route', v_attempt.semantic_route,
      'model', v_attempt.model,
      'status', v_attempt.status,
      'input_tokens', v_attempt.input_tokens,
      'output_tokens', v_attempt.output_tokens,
      'attempt_sha256', v_attempt.attempt_sha256
    )
  );

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'provider_attempt_number', v_attempt.attempt_number,
    'provider_client_request_id', v_attempt.id::text,
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.record_captured_document_provider_attempt(
  uuid, integer, uuid, text, integer, text, text, text, text, text, text,
  integer, integer, text, text, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_captured_document_provider_attempt(
  uuid, integer, uuid, text, integer, text, text, text, text, text, text,
  integer, integer, text, text, timestamptz, timestamptz, text, jsonb
) to service_role;

create or replace function public.cancel_captured_document_operation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_token uuid,
  p_cancellation_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_code text := btrim(p_cancellation_code);
begin
  if nullif(v_code, '') is null or char_length(v_code) > 120 then
    raise exception 'CAPTURED_CANCELLATION_CODE_INVALID';
  end if;
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.status = 'cancelled' and v_operation.cancellation_code = v_code then
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'idempotent_replay', true
    );
  end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status in ('ready_for_review', 'terminal_failure', 'cancelled') then
    raise exception 'CAPTURED_OPERATION_NOT_CANCELLABLE:%', v_operation.status;
  end if;
  if v_operation.lease_token is not null
    and v_operation.lease_token is distinct from p_lease_token then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;

  update private.captured_document_operations
  set status = 'cancelled',
      operation_revision = operation_revision + 1,
      retryable = false,
      cancellation_code = v_code,
      cancel_requested_at = clock_timestamp(),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;
  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'operation_cancelled',
    jsonb_build_object('cancellation_code', v_code, 'actor', 'service')
  );
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.cancel_captured_document_operation(uuid, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_captured_document_operation(uuid, integer, uuid, text)
  to service_role;

create or replace function public.request_captured_document_cancellation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_cancellation_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_code text := btrim(p_cancellation_code);
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if nullif(v_code, '') is null or char_length(v_code) > 120 then
    raise exception 'CAPTURED_CANCELLATION_CODE_INVALID';
  end if;
  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id and user_id = v_user_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.status = 'cancelled' and v_operation.cancellation_code = v_code then
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'status', v_operation.status,
      'idempotent_replay', true
    );
  end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status in ('ready_for_review', 'terminal_failure', 'cancelled') then
    raise exception 'CAPTURED_OPERATION_NOT_CANCELLABLE:%', v_operation.status;
  end if;

  update private.captured_document_operations
  set status = 'cancelled',
      operation_revision = operation_revision + 1,
      retryable = false,
      cancellation_code = v_code,
      cancel_requested_at = clock_timestamp(),
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      terminal_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_operation_id
  returning * into v_operation;
  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'operation_cancelled',
    jsonb_build_object('cancellation_code', v_code, 'actor', 'owner')
  );
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'status', v_operation.status,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.request_captured_document_cancellation(uuid, integer, text)
  from public, anon;
grant execute on function public.request_captured_document_cancellation(uuid, integer, text)
  to authenticated;

create or replace function public.finalize_captured_document_operation(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_lease_token uuid,
  p_sections jsonb,
  p_validation_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_contract jsonb;
  v_ledger_section jsonb;
  v_input_section jsonb;
  v_normalized_sections jsonb := '[]'::jsonb;
  v_section_key text;
  v_section_name text;
  v_section_content text;
  v_section_state text;
  v_source_references jsonb;
  v_is_required boolean;
  v_order_index integer;
  v_document_content text;
  v_unresolved jsonb;
  v_finalization_payload jsonb;
  v_finalization_hash text;
  v_write_token uuid;
  v_revision private.captured_document_revisions%rowtype;
  v_usage_ledger_id uuid;
  v_business_id uuid;
  v_allowance private.captured_document_allowances%rowtype;
begin
  if jsonb_typeof(p_sections) is distinct from 'array' then
    raise exception 'CAPTURED_SECTIONS_MUST_BE_ARRAY';
  end if;
  if jsonb_typeof(p_validation_result) <> 'object'
    or coalesce((p_validation_result->>'passed')::boolean, false) is not true then
    raise exception 'CAPTURED_FINALIZATION_VALIDATION_REQUIRED';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = v_operation.ledger_version;
  if not found
    or jsonb_typeof(
      v_contract->'templates'->v_operation.template_id->'sections'
    ) <> 'array' then
    raise exception 'CAPTURED_OPERATION_LEDGER_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sections) input_section
    where jsonb_typeof(input_section) <> 'object'
      or nullif(btrim(input_section->>'section_key'), '') is null
  ) then
    raise exception 'CAPTURED_SECTION_OUTPUT_INVALID';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(p_sections)
  ) <> (
    select count(distinct btrim(input_section->>'section_key'))
    from jsonb_array_elements(p_sections) input_section
  ) then
    raise exception 'CAPTURED_SECTION_KEY_DUPLICATE';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sections) input_section
    where not exists (
      select 1
      from jsonb_array_elements(
        v_contract->'templates'->v_operation.template_id->'sections'
      ) ledger_section
      where coalesce(
        ledger_section->>'sectionKey', ledger_section->>'key'
      ) = btrim(input_section->>'section_key')
    )
  ) then
    raise exception 'CAPTURED_SECTION_KEY_UNKNOWN';
  end if;

  for v_ledger_section, v_order_index in
    select ledger_section, (section_ordinal - 1)::integer
    from jsonb_array_elements(
      v_contract->'templates'->v_operation.template_id->'sections'
    ) with ordinality ordered_section(ledger_section, section_ordinal)
  loop
    v_section_key := coalesce(
      v_ledger_section->>'sectionKey', v_ledger_section->>'key'
    );
    if nullif(btrim(v_section_key), '') is null then
      raise exception 'CAPTURED_LEDGER_SECTION_KEY_INVALID';
    end if;
    begin
      v_is_required := coalesce(
        (v_ledger_section->>'required')::boolean,
        (v_ledger_section->>'is_required')::boolean,
        true
      );
    exception when invalid_text_representation then
      raise exception 'CAPTURED_LEDGER_REQUIREDNESS_INVALID:%', v_section_key;
    end;
    v_section_name := coalesce(
      nullif(btrim(v_ledger_section->>'name'), ''),
      nullif(btrim(v_ledger_section->>'title'), ''),
      v_section_key
    );

    v_input_section := null;
    select input_section into v_input_section
    from jsonb_array_elements(p_sections) input_section
    where btrim(input_section->>'section_key') = v_section_key;

    if v_input_section is null then
      if v_is_required then
        raise exception 'CAPTURED_REQUIRED_SECTION_MISSING:%', v_section_key;
      end if;
      v_section_content := '';
      v_section_state := 'omitted_optional';
      v_source_references := '[]'::jsonb;
    else
      v_section_content := coalesce(v_input_section->>'content', '');
      v_section_state := v_input_section->>'state';
      v_source_references := coalesce(
        v_input_section->'source_references', '[]'::jsonb
      );
      if v_input_section ? 'is_required'
        and (v_input_section->>'is_required')::boolean is distinct from v_is_required then
        raise exception 'CAPTURED_SECTION_REQUIREDNESS_MISMATCH:%', v_section_key;
      end if;
      if v_section_state not in (
        'final', 'interactive_placeholder', 'neutral_fallback', 'omitted_optional'
      ) then
        raise exception 'CAPTURED_SECTION_NOT_READY_FOR_REVIEW:%:%',
          v_section_key, coalesce(v_section_state, 'null');
      end if;
      if v_is_required and v_section_state = 'omitted_optional' then
        raise exception 'CAPTURED_REQUIRED_SECTION_CANNOT_BE_OMITTED:%', v_section_key;
      end if;
      if v_section_state = 'omitted_optional' then
        v_section_content := '';
        v_source_references := '[]'::jsonb;
      elsif not private.captured_content_is_visible(v_section_content) then
        raise exception 'CAPTURED_VISIBLE_SECTION_CONTENT_REQUIRED:%', v_section_key;
      end if;
      if jsonb_typeof(v_source_references) <> 'array'
        or octet_length(v_source_references::text) > 131072 then
        raise exception 'CAPTURED_SECTION_SOURCE_REFERENCES_INVALID:%', v_section_key;
      end if;
    end if;

    v_normalized_sections := v_normalized_sections || jsonb_build_array(
      jsonb_build_object(
        'section_key', v_section_key,
        'name', v_section_name,
        'order_index', v_order_index,
        'content', v_section_content,
        'state', v_section_state,
        'is_required', v_is_required,
        'source_references', v_source_references
      )
    );
  end loop;

  select coalesce(
    pg_catalog.string_agg(
      nullif(input_section->>'content', ''),
      E'\n\n' order by (input_section->>'order_index')::integer
    ),
    ''
  ) into v_document_content
  from jsonb_array_elements(v_normalized_sections) input_section
  where input_section->>'state' <> 'omitted_optional';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'section_key', input_section->>'section_key',
        'state', input_section->>'state'
      ) order by (input_section->>'order_index')::integer
    ),
    '[]'::jsonb
  ) into v_unresolved
  from jsonb_array_elements(v_normalized_sections) input_section
  where input_section->>'state' = 'interactive_placeholder';

  v_finalization_payload := jsonb_build_object(
    'operationId', v_operation.id,
    'acceptedDocumentRevision', v_operation.accepted_document_revision,
    'ledgerVersion', v_operation.ledger_version,
    'templateId', v_operation.template_id,
    'sections', v_normalized_sections,
    'validationResult', p_validation_result
  );
  v_finalization_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(v_finalization_payload::text, 'UTF8'), 'sha256'
    ),
    'hex'
  );

  if v_operation.status = 'ready_for_review' then
    if v_operation.finalization_sha256 <> v_finalization_hash then
      raise exception 'CAPTURED_FINALIZATION_REPLAY_CONFLICT';
    end if;
    select * into v_allowance
    from private.captured_document_allowances
    where operation_id = v_operation.id;
    if not found then
      raise exception 'CAPTURED_FINALIZATION_ALLOWANCE_MISSING';
    end if;
    return jsonb_build_object(
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'document_id', v_operation.document_id,
      'provider_finalized_revision', v_operation.provider_finalized_revision,
      'latest_document_revision', v_operation.latest_document_revision,
      'status', v_operation.status,
      'allowance_id', v_allowance.id,
      'idempotent_replay', true
    );
  end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'persisting' then
    raise exception 'CAPTURED_FINALIZATION_STATUS_INVALID:%', v_operation.status;
  end if;
  if p_lease_token is null
    or v_operation.lease_token is distinct from p_lease_token
    or v_operation.lease_expires_at is null
    or v_operation.lease_expires_at <= clock_timestamp() then
    raise exception 'CAPTURED_OPERATION_LEASE_LOST';
  end if;
  if not exists (
    select 1
    from private.captured_document_provider_attempts provider_attempt
    where provider_attempt.operation_id = v_operation.id
      and provider_attempt.user_id = v_operation.user_id
      and provider_attempt.provider = 'openai'
      and provider_attempt.status = 'succeeded'
  ) then
    raise exception 'CAPTURED_PROVIDER_SUCCESS_REQUIRED';
  end if;

  select * into v_document
  from public.documents
  where id = v_operation.document_id and user_id = v_operation.user_id
  for update;
  if not found or v_document.ledger_binding_status <> 'captured' then
    raise exception 'CAPTURED_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.current_revision <> v_operation.accepted_document_revision
    or v_document.approved_revision is not null
    or exists (
      select 1 from public.sections
      where document_id = v_document.id and user_id = v_document.user_id
    ) then
    raise exception 'STALE_CAPTURED_DOCUMENT_FINALIZATION';
  end if;

  v_write_token := private.begin_captured_document_write(
    'finalize_document', v_document.id, v_operation.id
  );
  insert into public.sections(
    document_id, user_id, name, order_index, content, status,
    version_history, is_required, ledger_binding_status, section_key,
    ledger_version, revision, approved_revision, section_state,
    source_references
  )
  select
    v_document.id,
    v_document.user_id,
    input_section->>'name',
    (input_section->>'order_index')::integer,
    input_section->>'content',
    'draft',
    '[]'::jsonb,
    (input_section->>'is_required')::boolean,
    'captured',
    input_section->>'section_key',
    v_operation.ledger_version,
    1,
    null,
    input_section->>'state',
    input_section->'source_references'
  from jsonb_array_elements(v_normalized_sections) input_section;

  update public.documents
  set content = v_document_content,
      workspace_sections = v_normalized_sections,
      unresolved_placeholders = v_unresolved,
      status = 'edited',
      approved_revision = null,
      current_revision = current_revision + 1,
      updated_at = clock_timestamp()
  where id = v_document.id
  returning * into v_document;
  perform private.end_captured_document_write(v_write_token);

  v_revision := private.capture_captured_document_revision(
    v_operation.id,
    v_document.id,
    'generated',
    p_validation_result,
    null
  );

  select outcome_record.business_id into v_business_id
  from public.outcomes outcome_record
  where outcome_record.id = v_operation.outcome_id
    and outcome_record.user_id = v_operation.user_id;

  insert into public.usage_ledger(
    user_id, business_id, event_type, generation_request_id, task, provider
  ) values (
    v_operation.user_id,
    v_business_id,
    'document_created',
    'captured-operation:' || v_operation.id::text,
    'captured_document_generation',
    null
  )
  on conflict on constraint usage_ledger_model_call_dedupe do nothing
  returning id into v_usage_ledger_id;

  if v_usage_ledger_id is null then
    select id into v_usage_ledger_id
    from public.usage_ledger
    where user_id = v_operation.user_id
      and generation_request_id = 'captured-operation:' || v_operation.id::text
      and event_type = 'document_created';
  end if;
  if v_usage_ledger_id is null then
    raise exception 'CAPTURED_ALLOWANCE_USAGE_WRITE_FAILED';
  end if;

  insert into private.captured_document_allowances(
    operation_id, document_id, user_id, document_revision, usage_ledger_id
  ) values (
    v_operation.id, v_document.id, v_document.user_id,
    v_document.current_revision, v_usage_ledger_id
  )
  on conflict (operation_id) do nothing
  returning * into v_allowance;
  if v_allowance.id is null then
    select * into v_allowance
    from private.captured_document_allowances
    where operation_id = v_operation.id;
    if v_allowance.document_revision <> v_document.current_revision
      or v_allowance.usage_ledger_id <> v_usage_ledger_id then
      raise exception 'CAPTURED_ALLOWANCE_CONFLICT';
    end if;
  end if;

  update private.captured_document_operations
  set status = 'ready_for_review',
      operation_revision = operation_revision + 1,
      retryable = false,
      error_code = null,
      public_error_message = null,
      safe_next_action = null,
      provider_finalized_revision = v_document.current_revision,
      latest_document_revision = v_document.current_revision,
      finalization_sha256 = v_finalization_hash,
      lease_token = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'operation_finalized',
    jsonb_build_object(
      'document_id', v_document.id,
      'document_revision', v_document.current_revision,
      'revision_sha256', v_revision.snapshot_sha256,
      'allowance_id', v_allowance.id,
      'validation_passed', true
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'document_id', v_operation.document_id,
    'provider_finalized_revision', v_operation.provider_finalized_revision,
    'latest_document_revision', v_operation.latest_document_revision,
    'status', v_operation.status,
    'allowance_id', v_allowance.id,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.finalize_captured_document_operation(
  uuid, integer, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.finalize_captured_document_operation(
  uuid, integer, uuid, jsonb, jsonb
) to service_role;

create or replace function public.edit_captured_document_section(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_document_id uuid,
  p_expected_document_revision integer,
  p_section_key text,
  p_expected_section_revision integer,
  p_content text,
  p_section_state text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_section public.sections%rowtype;
  v_workspace_sections jsonb;
  v_document_content text;
  v_unresolved jsonb;
  v_write_token uuid;
  v_revision private.captured_document_revisions%rowtype;
  v_section_contract jsonb;
  v_edit_source_references jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if nullif(btrim(p_section_key), '') is null
    or p_section_state not in (
      'final', 'interactive_placeholder', 'neutral_fallback', 'omitted_optional'
    ) then
    raise exception 'CAPTURED_SECTION_EDIT_INVALID';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
    and document_id = p_document_id
    and user_id = v_user_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'ready_for_review' then
    raise exception 'CAPTURED_DOCUMENT_NOT_READY_FOR_EDIT:%', v_operation.status;
  end if;

  select * into v_document
  from public.documents
  where id = p_document_id and user_id = v_user_id
  for update;
  if not found or v_document.ledger_binding_status <> 'captured' then
    raise exception 'CAPTURED_DOCUMENT_NOT_FOUND';
  end if;
  if v_document.current_revision <> p_expected_document_revision
    or v_operation.latest_document_revision <> v_document.current_revision then
    raise exception 'STALE_CAPTURED_DOCUMENT_REVISION';
  end if;

  select * into v_section
  from public.sections
  where document_id = p_document_id
    and user_id = v_user_id
    and section_key = btrim(p_section_key)
    and ledger_version = v_operation.ledger_version
  for update;
  if not found then raise exception 'CAPTURED_SECTION_NOT_FOUND'; end if;
  if v_section.revision <> p_expected_section_revision then
    raise exception 'STALE_CAPTURED_SECTION_REVISION';
  end if;

  select ledger_section.section_value into v_section_contract
  from private.document_ledger_versions ledger_version_record
  cross join lateral jsonb_array_elements(
    ledger_version_record.contract_json->'templates'->v_operation.template_id->'sections'
  ) ledger_section(section_value)
  where ledger_version_record.ledger_version = v_operation.ledger_version
    and coalesce(
      ledger_section.section_value->>'sectionKey',
      ledger_section.section_value->>'key'
    ) = v_section.section_key;
  if not found
    or coalesce((v_section_contract->>'required')::boolean, false)
      is distinct from v_section.is_required then
    raise exception 'CAPTURED_SECTION_LEDGER_CONTRACT_INVALID:%', p_section_key;
  end if;

  if v_section.is_required and p_section_state = 'omitted_optional' then
    raise exception 'CAPTURED_REQUIRED_SECTION_CANNOT_BE_OMITTED:%', p_section_key;
  end if;
  if p_section_state = 'omitted_optional' and (
    v_section_contract->>'missingInformationBehaviour' is distinct from 'omitIfOptional'
    or nullif(btrim(p_content), '') is not null
  ) then
    raise exception 'CAPTURED_OPTIONAL_OMISSION_NOT_ALLOWED:%', p_section_key;
  end if;
  if p_section_state = 'interactive_placeholder'
    and v_section_contract->>'missingInformationBehaviour'
      is distinct from 'useInteractivePlaceholder' then
    raise exception 'CAPTURED_INTERACTIVE_PLACEHOLDER_NOT_ALLOWED:%', p_section_key;
  end if;
  if p_section_state = 'neutral_fallback' and (
    v_section_contract->>'missingInformationBehaviour' is distinct from 'useNeutralFallback'
    or v_section.section_state <> 'neutral_fallback'
    or v_section.content is distinct from p_content
    or v_section.source_references is distinct from '["system:neutral-fallback"]'::jsonb
  ) then
    raise exception 'CAPTURED_NEUTRAL_FALLBACK_EDIT_NOT_ALLOWED:%', p_section_key;
  end if;
  if p_section_state <> 'omitted_optional'
    and not private.captured_content_is_visible(p_content) then
    raise exception 'CAPTURED_VISIBLE_SECTION_CONTENT_REQUIRED:%', p_section_key;
  end if;

  v_edit_source_references := case p_section_state
    when 'omitted_optional' then '[]'::jsonb
    when 'neutral_fallback' then '["system:neutral-fallback"]'::jsonb
    else '["user:owner-edit"]'::jsonb
  end;

  v_write_token := private.begin_captured_document_write(
    'edit_document_section', v_document.id, v_operation.id
  );
  update public.sections
  set content = case when p_section_state = 'omitted_optional' then '' else p_content end,
      section_state = p_section_state,
      source_references = v_edit_source_references,
      status = 'edited',
      revision = revision + 1,
      approved_revision = null,
      updated_at = clock_timestamp()
  where id = v_section.id
  returning * into v_section;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'section_key', section_record.section_key,
        'name', section_record.name,
        'order_index', section_record.order_index,
        'content', section_record.content,
        'state', section_record.section_state,
        'is_required', section_record.is_required,
        'source_references', section_record.source_references
      ) order by section_record.order_index, section_record.id
    ),
    '[]'::jsonb
  ), coalesce(
    pg_catalog.string_agg(
      nullif(section_record.content, ''),
      E'\n\n' order by section_record.order_index, section_record.id
    ) filter (where section_record.section_state <> 'omitted_optional'),
    ''
  ), coalesce(
    jsonb_agg(
      jsonb_build_object(
        'section_key', section_record.section_key,
        'state', section_record.section_state
      ) order by section_record.order_index, section_record.id
    ) filter (where section_record.section_state = 'interactive_placeholder'),
    '[]'::jsonb
  )
  into v_workspace_sections, v_document_content, v_unresolved
  from public.sections section_record
  where section_record.document_id = v_document.id
    and section_record.user_id = v_user_id;

  update public.documents
  set content = v_document_content,
      workspace_sections = v_workspace_sections,
      unresolved_placeholders = v_unresolved,
      status = 'edited',
      approved_revision = null,
      current_revision = current_revision + 1,
      updated_at = clock_timestamp()
  where id = v_document.id
  returning * into v_document;
  perform private.end_captured_document_write(v_write_token);

  v_revision := private.capture_captured_document_revision(
    v_operation.id,
    v_document.id,
    'user_edit',
    jsonb_build_object(
      'passed', true,
      'validation_source', 'owner_edit',
      'validation_scope', 'ledger_state_and_visible_content',
      'ledger_state_checked', true,
      'visible_content_checked', true,
      'source_reference_ids_checked', true,
      'material_claim_grounding_checked', false,
      'owner_asserted_provenance', p_section_state in (
        'final', 'interactive_placeholder'
      )
    ),
    v_user_id
  );

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      latest_document_revision = v_document.current_revision,
      updated_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;
  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'section_edited',
    jsonb_build_object(
      'document_id', v_document.id,
      'document_revision', v_document.current_revision,
      'section_key', v_section.section_key,
      'section_revision', v_section.revision,
      'revision_sha256', v_revision.snapshot_sha256
    )
  );

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'document_id', v_document.id,
    'document_revision', v_document.current_revision,
    'section_id', v_section.id,
    'section_key', v_section.section_key,
    'section_revision', v_section.revision,
    'persisted', true
  );
end;
$function$;

revoke all on function public.edit_captured_document_section(
  uuid, integer, uuid, integer, text, integer, text, text
) from public, anon;
grant execute on function public.edit_captured_document_section(
  uuid, integer, uuid, integer, text, integer, text, text
) to authenticated;

create or replace function public.approve_captured_document_revision(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_document_id uuid,
  p_expected_document_revision integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_revision private.captured_document_revisions%rowtype;
  v_existing private.captured_document_approvals%rowtype;
  v_approval private.captured_document_approvals%rowtype;
  v_section_revisions jsonb;
  v_write_token uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
    and document_id = p_document_id
    and user_id = v_user_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  select * into v_document
  from public.documents
  where id = p_document_id and user_id = v_user_id
  for update;
  if not found or v_document.ledger_binding_status <> 'captured' then
    raise exception 'CAPTURED_DOCUMENT_NOT_FOUND';
  end if;

  select * into v_existing
  from private.captured_document_approvals
  where document_id = p_document_id
    and document_revision = p_expected_document_revision;
  if found and v_document.approved_revision = p_expected_document_revision then
    return jsonb_build_object(
      'approval_id', v_existing.id,
      'operation_id', v_operation.id,
      'operation_revision', v_operation.operation_revision,
      'document_id', v_document.id,
      'document_revision', v_existing.document_revision,
      'approved', true,
      'idempotent_replay', true
    );
  end if;

  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'ready_for_review'
    or v_operation.latest_document_revision <> v_document.current_revision
    or v_document.current_revision <> p_expected_document_revision then
    raise exception 'STALE_CAPTURED_DOCUMENT_APPROVAL';
  end if;
  if exists (
    select 1
    from public.sections section_record
    where section_record.document_id = v_document.id
      and section_record.user_id = v_user_id
      and (
        section_record.section_state in (
          'needs_clarification', 'interactive_placeholder', 'failed_validation'
        )
        or (section_record.is_required and section_record.section_state = 'omitted_optional')
        or (
          section_record.section_state in ('final', 'neutral_fallback')
          and not private.captured_content_is_visible(section_record.content)
        )
      )
  ) then
    raise exception 'CAPTURED_DOCUMENT_HAS_APPROVAL_BLOCKERS';
  end if;

  select * into v_revision
  from private.captured_document_revisions
  where document_id = v_document.id
    and document_revision = v_document.current_revision
    and operation_id = v_operation.id;
  if not found
    or coalesce((v_revision.validation_result->>'passed')::boolean, false) is not true then
    raise exception 'CAPTURED_DOCUMENT_REVISION_NOT_VALIDATED';
  end if;

  select coalesce(
    jsonb_object_agg(section_record.section_key, section_record.revision),
    '{}'::jsonb
  ) into v_section_revisions
  from public.sections section_record
  where section_record.document_id = v_document.id
    and section_record.user_id = v_user_id;

  insert into private.captured_document_approvals(
    operation_id, document_id, user_id, document_revision,
    revision_sha256, section_revisions, validation_result
  ) values (
    v_operation.id, v_document.id, v_user_id, v_document.current_revision,
    v_revision.snapshot_sha256, v_section_revisions, v_revision.validation_result
  ) returning * into v_approval;

  v_write_token := private.begin_captured_document_write(
    'approve_document', v_document.id, v_operation.id
  );
  update public.sections
  set status = 'approved',
      approved_revision = revision,
      updated_at = clock_timestamp()
  where document_id = v_document.id and user_id = v_user_id;
  update public.documents
  set status = 'approved',
      approved_revision = current_revision,
      updated_at = clock_timestamp()
  where id = v_document.id
  returning * into v_document;
  perform private.end_captured_document_write(v_write_token);

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;
  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'document_revision_approved',
    jsonb_build_object(
      'approval_id', v_approval.id,
      'document_id', v_document.id,
      'document_revision', v_approval.document_revision,
      'revision_sha256', v_approval.revision_sha256
    )
  );

  return jsonb_build_object(
    'approval_id', v_approval.id,
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'document_id', v_document.id,
    'document_revision', v_approval.document_revision,
    'approved', true,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.approve_captured_document_revision(
  uuid, integer, uuid, integer
) from public, anon;
grant execute on function public.approve_captured_document_revision(
  uuid, integer, uuid, integer
) to authenticated;

create or replace function public.request_captured_document_export(
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_document_id uuid,
  p_approved_document_revision integer,
  p_format text,
  p_export_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_format text := lower(btrim(p_format));
  v_idempotency_key text := btrim(p_export_idempotency_key);
  v_request_payload jsonb;
  v_request_hash text;
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_approval private.captured_document_approvals%rowtype;
  v_existing private.captured_document_exports%rowtype;
  v_export private.captured_document_exports%rowtype;
  v_template_contract jsonb;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if v_format not in ('docx', 'pdf', 'xlsx', 'html_preview')
    or char_length(v_idempotency_key) not between 1 and 128 then
    raise exception 'CAPTURED_EXPORT_REQUEST_INVALID';
  end if;

  v_request_payload := jsonb_build_object(
    'operationId', p_operation_id,
    'documentId', p_document_id,
    'approvedDocumentRevision', p_approved_document_revision,
    'format', v_format,
    'idempotencyKey', v_idempotency_key
  );
  v_request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'
    ),
    'hex'
  );

  select * into v_existing
  from private.captured_document_exports
  where user_id = v_user_id and idempotency_key = v_idempotency_key;
  if found then
    if v_existing.request_sha256 <> v_request_hash then
      raise exception 'CAPTURED_EXPORT_REPLAY_CONFLICT';
    end if;
    select * into v_operation
    from private.captured_document_operations
    where id = v_existing.operation_id and user_id = v_user_id;
    if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
    return jsonb_build_object(
      'export_id', v_existing.id,
      'operation_id', v_existing.operation_id,
      'operation_revision', v_operation.operation_revision,
      'document_id', v_existing.document_id,
      'document_revision', v_existing.document_revision,
      'format', v_existing.format,
      'status', v_existing.status,
      'idempotent_replay', true
    );
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = p_operation_id
    and document_id = p_document_id
    and user_id = v_user_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'ready_for_review' then
    raise exception 'CAPTURED_DOCUMENT_NOT_EXPORTABLE:%', v_operation.status;
  end if;

  select * into v_document
  from public.documents
  where id = p_document_id and user_id = v_user_id
  for update;
  if not found
    or v_document.ledger_binding_status <> 'captured'
    or v_document.current_revision <> p_approved_document_revision
    or v_document.approved_revision <> p_approved_document_revision
    or v_operation.latest_document_revision <> p_approved_document_revision then
    raise exception 'CAPTURED_EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL';
  end if;

  select * into v_approval
  from private.captured_document_approvals
  where operation_id = v_operation.id
    and document_id = v_document.id
    and document_revision = p_approved_document_revision;
  if not found
    or coalesce((v_approval.validation_result->>'passed')::boolean, false) is not true then
    raise exception 'CAPTURED_EXPORT_APPROVAL_NOT_VALIDATED';
  end if;

  select contract_json->'templates'->v_operation.template_id
  into v_template_contract
  from private.document_ledger_versions
  where ledger_version = v_operation.ledger_version;
  if v_format = 'xlsx' and not coalesce(
    jsonb_typeof(v_template_contract->'spreadsheetSemantics') = 'object'
    or (
      jsonb_typeof(v_template_contract->'exportFormats') = 'array'
      and (v_template_contract->'exportFormats') ? 'xlsx'
    ),
    false
  ) then
    raise exception 'CAPTURED_TEMPLATE_HAS_NO_SPREADSHEET_SEMANTICS';
  end if;

  insert into private.captured_document_exports(
    operation_id, approval_id, document_id, user_id, document_revision,
    ledger_version, format, idempotency_key, request_sha256,
    status, validation_result
  ) values (
    v_operation.id, v_approval.id, v_document.id, v_user_id,
    p_approved_document_revision, v_operation.ledger_version, v_format,
    v_idempotency_key, v_request_hash, 'requested', v_approval.validation_result
  ) returning * into v_export;

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;
  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'export_requested',
    jsonb_build_object(
      'export_id', v_export.id,
      'document_id', v_export.document_id,
      'document_revision', v_export.document_revision,
      'format', v_export.format
    )
  );

  return jsonb_build_object(
    'export_id', v_export.id,
    'operation_id', v_operation.id,
    'operation_revision', v_operation.operation_revision,
    'document_id', v_export.document_id,
    'document_revision', v_export.document_revision,
    'format', v_export.format,
    'status', v_export.status,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.request_captured_document_export(
  uuid, integer, uuid, integer, text, text
) from public, anon;
grant execute on function public.request_captured_document_export(
  uuid, integer, uuid, integer, text, text
) to authenticated;

create or replace function public.complete_captured_document_export(
  p_export_id uuid,
  p_operation_id uuid,
  p_expected_operation_revision integer,
  p_storage_path text,
  p_artifact_sha256 text,
  p_renderer_version text,
  p_artifact_validation_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_storage_path text := btrim(p_storage_path);
  v_artifact_sha256 text := lower(btrim(p_artifact_sha256));
  v_renderer_version text := btrim(p_renderer_version);
  v_export private.captured_document_exports%rowtype;
  v_operation private.captured_document_operations%rowtype;
  v_document public.documents%rowtype;
  v_completion_payload jsonb;
  v_completion_sha256 text;
begin
  if p_export_id is null or p_operation_id is null then
    raise exception 'CAPTURED_EXPORT_COMPLETION_IDENTITY_REQUIRED';
  end if;
  if p_expected_operation_revision is null or p_expected_operation_revision < 1
    or v_storage_path is null
    or char_length(v_storage_path) not between 1 and 1024
    or v_storage_path like '/%'
    or v_storage_path like '%\\%'
    or position('://' in v_storage_path) > 0
    or v_storage_path ~ '(^|/)\.{1,2}(/|$)'
    or v_artifact_sha256 is null
    or v_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or v_renderer_version is null
    or char_length(v_renderer_version) not between 1 and 120
    or jsonb_typeof(p_artifact_validation_result) is distinct from 'object'
    or p_artifact_validation_result->'passed' is distinct from 'true'::jsonb
    or p_artifact_validation_result->'artifact_inspected' is distinct from 'true'::jsonb
    or octet_length(p_artifact_validation_result::text) > 131072 then
    raise exception 'CAPTURED_EXPORT_COMPLETION_INVALID';
  end if;

  select * into v_export
  from private.captured_document_exports
  where id = p_export_id
  for update;
  if not found then raise exception 'CAPTURED_EXPORT_NOT_FOUND'; end if;
  if v_export.operation_id <> p_operation_id then
    raise exception 'CAPTURED_EXPORT_OPERATION_MISMATCH';
  end if;
  if not (
    v_storage_path like v_export.user_id::text || '/' || v_export.id::text || '/%'
    or v_storage_path like '%/' || v_export.user_id::text || '/' || v_export.id::text || '/%'
  ) then
    raise exception 'CAPTURED_EXPORT_STORAGE_PATH_MISMATCH';
  end if;

  v_completion_payload := jsonb_build_object(
    'exportId', v_export.id,
    'operationId', v_export.operation_id,
    'requestSha256', v_export.request_sha256,
    'documentId', v_export.document_id,
    'documentRevision', v_export.document_revision,
    'format', v_export.format,
    'storagePath', v_storage_path,
    'artifactSha256', v_artifact_sha256,
    'rendererVersion', v_renderer_version,
    'artifactValidationResult', p_artifact_validation_result
  );
  v_completion_sha256 := encode(
    extensions.digest(
      pg_catalog.convert_to(v_completion_payload::text, 'UTF8'), 'sha256'
    ),
    'hex'
  );

  if v_export.status = 'created' then
    if v_export.completion_sha256 <> v_completion_sha256 then
      raise exception 'CAPTURED_EXPORT_COMPLETION_REPLAY_CONFLICT';
    end if;
    select * into v_operation
    from private.captured_document_operations
    where id = v_export.operation_id and user_id = v_export.user_id;
    if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
    return jsonb_build_object(
      'export_id', v_export.id,
      'operation_id', v_export.operation_id,
      'operation_revision', v_operation.operation_revision,
      'document_id', v_export.document_id,
      'document_revision', v_export.document_revision,
      'format', v_export.format,
      'status', v_export.status,
      'storage_path', v_export.storage_path,
      'artifact_sha256', v_export.artifact_sha256,
      'renderer_version', v_export.renderer_version,
      'artifact_validation_result', v_export.artifact_validation_result,
      'completed_at', v_export.completed_at,
      'idempotent_replay', true
    );
  end if;
  if v_export.status <> 'requested' then
    raise exception 'CAPTURED_EXPORT_NOT_COMPLETABLE:%', v_export.status;
  end if;

  select * into v_operation
  from private.captured_document_operations
  where id = v_export.operation_id and user_id = v_export.user_id
  for update;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;
  if v_operation.operation_revision <> p_expected_operation_revision then
    raise exception 'STALE_OPERATION_REVISION:expected:%:actual:%',
      p_expected_operation_revision, v_operation.operation_revision;
  end if;
  if v_operation.status <> 'ready_for_review'
    or v_operation.document_id <> v_export.document_id
    or v_operation.ledger_version <> v_export.ledger_version
    or v_operation.latest_document_revision <> v_export.document_revision then
    raise exception 'CAPTURED_EXPORT_REQUEST_NO_LONGER_CURRENT';
  end if;

  select * into v_document
  from public.documents
  where id = v_export.document_id and user_id = v_export.user_id
  for update;
  if not found
    or v_document.ledger_binding_status <> 'captured'
    or v_document.current_revision <> v_export.document_revision
    or v_document.approved_revision <> v_export.document_revision then
    raise exception 'CAPTURED_EXPORT_REQUEST_NO_LONGER_CURRENT';
  end if;

  update private.captured_document_exports
  set status = 'created',
      storage_path = v_storage_path,
      artifact_sha256 = v_artifact_sha256,
      renderer_version = v_renderer_version,
      artifact_validation_result = p_artifact_validation_result,
      completion_sha256 = v_completion_sha256,
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_export.id
  returning * into v_export;

  update private.captured_document_operations
  set operation_revision = operation_revision + 1,
      updated_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;
  perform private.append_captured_document_event(
    v_operation.id, v_operation.user_id, v_operation.operation_revision,
    v_operation.status, 'export_completed',
    jsonb_build_object(
      'export_id', v_export.id,
      'document_id', v_export.document_id,
      'document_revision', v_export.document_revision,
      'format', v_export.format,
      'artifact_sha256', v_export.artifact_sha256,
      'renderer_version', v_export.renderer_version,
      'artifact_inspected', true
    )
  );

  return jsonb_build_object(
    'export_id', v_export.id,
    'operation_id', v_export.operation_id,
    'operation_revision', v_operation.operation_revision,
    'document_id', v_export.document_id,
    'document_revision', v_export.document_revision,
    'format', v_export.format,
    'status', v_export.status,
    'storage_path', v_export.storage_path,
    'artifact_sha256', v_export.artifact_sha256,
    'renderer_version', v_export.renderer_version,
    'artifact_validation_result', v_export.artifact_validation_result,
    'completed_at', v_export.completed_at,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.complete_captured_document_export(
  uuid, uuid, integer, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_captured_document_export(
  uuid, uuid, integer, text, text, text, jsonb
) to service_role;

-- Private helpers remain unavailable even if schema privileges change later.
revoke all on function private.captured_content_is_visible(text)
  from public, anon, authenticated, service_role;
revoke all on function private.captured_operation_transition_allowed(text, text)
  from public, anon, authenticated, service_role;

comment on function public.configure_captured_document_activation(
  text, text, text, text, text, text, jsonb, boolean, integer, text, text
) is
  'Service-only pointer command. Disable or restore a reviewed revision to roll back new captured admissions; accepted operations retain their snapshot.';
comment on function public.accept_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) is
  'Service-only idempotent acceptance. Persists operation, immutable snapshots, document identity and revision 1 before provider work.';
comment on function public.get_latest_captured_document_operation(uuid) is
  'Returns the current owner-safe durable operation projection for a captured document, or null for legacy, absent or other-tenant documents.';
comment on function public.finalize_captured_document_operation(
  uuid, integer, uuid, jsonb, jsonb
) is
  'Atomically validates and persists ledger sections, revision, durable ready state, usage and exactly one completed-document allowance.';
comment on function public.request_captured_document_export(
  uuid, integer, uuid, integer, text, text
) is
  'Owner command recording only the exact current approved revision; caller-supplied replacement document bodies are not accepted.';
comment on function public.complete_captured_document_export(
  uuid, uuid, integer, text, text, text, jsonb
) is
  'Service-only exact-request completion binding one inspected artifact path, hash, renderer and validation result to the approved revision.';

commit;
