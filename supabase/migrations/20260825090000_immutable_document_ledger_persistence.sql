-- Phase L0.2: immutable Universal Document Generation Ledger persistence.
--
-- Expand-only and deliberately dormant:
-- - current generation does not select a ledger version;
-- - existing documents/artifacts remain explicitly legacy_unversioned;
-- - no compatibility transformation or activation is performed here;
-- - all immutable contracts and generation snapshots remain private;
-- - future captured writes must use revision-checked RPC boundaries.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;

create table private.document_ledger_versions (
  ledger_version text primary key,
  schema_version text not null,
  contract_sha256 text not null unique
    check (contract_sha256 ~ '^[0-9a-f]{64}$'),
  contract_json jsonb not null
    check (jsonb_typeof(contract_json) = 'object')
    check (jsonb_typeof(contract_json->'templates') = 'object'),
  template_count integer not null check (template_count > 0),
  registered_at timestamptz not null default now(),
  registered_by text not null default 'service_role'
    check (length(trim(registered_by)) > 0)
);

comment on table private.document_ledger_versions is
  'Immutable reviewed ledger contracts. Git remains authoring authority; these rows are validated runtime projections.';

create table private.document_ledger_activation_pointers (
  scope_key text primary key,
  ledger_version text references private.document_ledger_versions(ledger_version),
  enabled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  activated_at timestamptz,
  activated_by text,
  updated_at timestamptz not null default now(),
  check (not enabled or ledger_version is not null),
  check (not enabled or activated_at is not null),
  check (not enabled or length(trim(activated_by)) > 0)
);

comment on table private.document_ledger_activation_pointers is
  'Separate rollback-capable activation state. L0.2 creates no enabled pointer and exposes no activation RPC.';

create table private.document_generation_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_request_id text not null
    check (length(trim(generation_request_id)) between 1 and 128),
  template_id text not null check (length(trim(template_id)) > 0),
  ledger_version text not null
    references private.document_ledger_versions(ledger_version),
  benchmark_version text not null check (length(trim(benchmark_version)) > 0),
  pipeline_version text not null check (length(trim(pipeline_version)) > 0),
  input_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_values) = 'object'),
  source_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_snapshot) = 'object'),
  evidence_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_snapshot) = 'object'),
  unresolved_input_keys text[] not null default '{}'::text[],
  confirmations jsonb not null default '{}'::jsonb
    check (jsonb_typeof(confirmations) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (user_id, generation_request_id),
  unique (id, user_id)
);

create index document_generation_snapshots_ledger_template_idx
  on private.document_generation_snapshots(ledger_version, template_id, created_at desc);

comment on table private.document_generation_snapshots is
  'Immutable minimum-necessary generation inputs, provenance and confirmations. Full uploads/document bodies must not be duplicated here.';

create or replace function private.reject_immutable_ledger_row_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'IMMUTABLE_LEDGER_RECORD:% cannot be updated or deleted', tg_table_name;
end;
$$;

create trigger document_ledger_versions_immutable
  before update or delete on private.document_ledger_versions
  for each row execute function private.reject_immutable_ledger_row_mutation();

create trigger document_generation_snapshots_immutable
  before update or delete on private.document_generation_snapshots
  for each row execute function private.reject_immutable_ledger_row_mutation();

revoke all on private.document_ledger_versions from public, anon, authenticated;
revoke all on private.document_ledger_activation_pointers from public, anon, authenticated;
revoke all on private.document_generation_snapshots from public, anon, authenticated;
grant select, insert on private.document_ledger_versions to service_role;
grant select on private.document_ledger_activation_pointers to service_role;
grant select, insert on private.document_generation_snapshots to service_role;

-- Existing rows remain explicitly unversioned. Nothing is inferred from a
-- display label or current profile. Future captured writes must provide every
-- identity field together.
alter table public.documents
  add column if not exists ledger_binding_status text not null default 'legacy_unversioned',
  add column if not exists ledger_template_id text,
  add column if not exists ledger_version text references private.document_ledger_versions(ledger_version),
  add column if not exists generation_snapshot_id uuid references private.document_generation_snapshots(id),
  add column if not exists current_revision integer not null default 1,
  add column if not exists approved_revision integer;

alter table public.documents
  drop constraint if exists documents_ledger_binding_status_check,
  drop constraint if exists documents_current_revision_check,
  drop constraint if exists documents_approved_revision_check,
  drop constraint if exists documents_captured_ledger_identity_check;

alter table public.documents
  add constraint documents_ledger_binding_status_check
    check (ledger_binding_status in ('legacy_unversioned', 'captured')),
  add constraint documents_current_revision_check check (current_revision > 0),
  add constraint documents_approved_revision_check
    check (approved_revision is null or approved_revision between 1 and current_revision),
  add constraint documents_captured_ledger_identity_check check (
    (ledger_binding_status = 'legacy_unversioned'
      and ledger_template_id is null
      and ledger_version is null
      and generation_snapshot_id is null)
    or
    (ledger_binding_status = 'captured'
      and length(trim(ledger_template_id)) > 0
      and ledger_version is not null
      and generation_snapshot_id is not null)
  );

alter table public.sections
  add column if not exists ledger_binding_status text not null default 'legacy_unversioned',
  add column if not exists section_key text,
  add column if not exists ledger_version text references private.document_ledger_versions(ledger_version),
  add column if not exists revision integer not null default 1,
  add column if not exists approved_revision integer,
  add column if not exists source_section_id uuid references public.sections(id) on delete restrict,
  add column if not exists source_section_key text,
  add column if not exists transformation_version text;

alter table public.sections
  drop constraint if exists sections_ledger_binding_status_check,
  drop constraint if exists sections_revision_check,
  drop constraint if exists sections_approved_revision_check,
  drop constraint if exists sections_captured_ledger_identity_check;

alter table public.sections
  add constraint sections_ledger_binding_status_check
    check (ledger_binding_status in ('legacy_unversioned', 'captured')),
  add constraint sections_revision_check check (revision > 0),
  add constraint sections_approved_revision_check
    check (approved_revision is null or approved_revision between 1 and revision),
  add constraint sections_captured_ledger_identity_check check (
    (ledger_binding_status = 'legacy_unversioned'
      and section_key is null
      and ledger_version is null
      and source_section_id is null
      and source_section_key is null
      and transformation_version is null)
    or
    (ledger_binding_status = 'captured'
      and length(trim(section_key)) > 0
      and ledger_version is not null)
  );

alter table public.ted_artifacts
  add column if not exists ledger_binding_status text not null default 'legacy_unversioned',
  add column if not exists ledger_template_id text,
  add column if not exists ledger_version text references private.document_ledger_versions(ledger_version),
  add column if not exists benchmark_version text,
  add column if not exists generation_snapshot_id uuid references private.document_generation_snapshots(id),
  add column if not exists approved_revision integer;

alter table public.ted_artifacts
  drop constraint if exists ted_artifacts_ledger_binding_status_check,
  drop constraint if exists ted_artifacts_approved_revision_check,
  drop constraint if exists ted_artifacts_captured_ledger_identity_check;

alter table public.ted_artifacts
  add constraint ted_artifacts_ledger_binding_status_check
    check (ledger_binding_status in ('legacy_unversioned', 'captured')),
  add constraint ted_artifacts_approved_revision_check
    check (approved_revision is null or approved_revision between 1 and current_revision),
  add constraint ted_artifacts_captured_ledger_identity_check check (
    (ledger_binding_status = 'legacy_unversioned'
      and ledger_template_id is null
      and ledger_version is null
      and benchmark_version is null
      and generation_snapshot_id is null)
    or
    (ledger_binding_status = 'captured'
      and length(trim(ledger_template_id)) > 0
      and ledger_version is not null
      and length(trim(benchmark_version)) > 0
      and generation_snapshot_id is not null)
  );

create unique index if not exists ted_artifacts_generation_snapshot_unique
  on public.ted_artifacts(generation_snapshot_id)
  where generation_snapshot_id is not null;

alter table public.ted_artifact_blocks
  add column if not exists ledger_binding_status text not null default 'legacy_unversioned',
  add column if not exists ledger_section_key text,
  add column if not exists ledger_version text references private.document_ledger_versions(ledger_version),
  add column if not exists is_required boolean,
  add column if not exists section_state text,
  add column if not exists approved_revision integer,
  add column if not exists source_block_id uuid references public.ted_artifact_blocks(id) on delete restrict,
  add column if not exists source_section_key text,
  add column if not exists transformation_version text;

alter table public.ted_artifact_blocks
  drop constraint if exists ted_artifact_blocks_ledger_binding_status_check,
  drop constraint if exists ted_artifact_blocks_section_state_check,
  drop constraint if exists ted_artifact_blocks_approved_revision_check,
  drop constraint if exists ted_artifact_blocks_captured_ledger_identity_check;

alter table public.ted_artifact_blocks
  add constraint ted_artifact_blocks_ledger_binding_status_check
    check (ledger_binding_status in ('legacy_unversioned', 'captured')),
  add constraint ted_artifact_blocks_section_state_check check (
    section_state is null or section_state in (
      'final', 'needs_clarification', 'interactive_placeholder',
      'neutral_fallback', 'omitted_optional', 'failed_validation'
    )
  ),
  add constraint ted_artifact_blocks_approved_revision_check
    check (approved_revision is null or approved_revision between 1 and revision),
  add constraint ted_artifact_blocks_captured_ledger_identity_check check (
    (ledger_binding_status = 'legacy_unversioned'
      and ledger_section_key is null
      and ledger_version is null
      and is_required is null
      and section_state is null
      and source_block_id is null
      and source_section_key is null
      and transformation_version is null)
    or
    (ledger_binding_status = 'captured'
      and length(trim(ledger_section_key)) > 0
      and ledger_version is not null
      and is_required is not null
      and section_state is not null)
  );

create index if not exists ted_artifact_blocks_ledger_key_idx
  on public.ted_artifact_blocks(artifact_id, ledger_version, ledger_section_key)
  where ledger_binding_status = 'captured';

alter table public.export_history
  add column if not exists ledger_version text references private.document_ledger_versions(ledger_version),
  add column if not exists document_revision integer,
  add column if not exists artifact_revision integer,
  add column if not exists approved_revision integer,
  add column if not exists validation_passed boolean,
  add column if not exists validation_result jsonb;

alter table public.export_history
  drop constraint if exists export_history_document_revision_check,
  drop constraint if exists export_history_artifact_revision_check,
  drop constraint if exists export_history_approved_revision_check,
  drop constraint if exists export_history_validation_result_check;

alter table public.export_history
  add constraint export_history_document_revision_check
    check (document_revision is null or document_revision > 0),
  add constraint export_history_artifact_revision_check
    check (artifact_revision is null or artifact_revision > 0),
  add constraint export_history_approved_revision_check
    check (approved_revision is null or approved_revision > 0),
  add constraint export_history_validation_result_check
    check (validation_result is null or jsonb_typeof(validation_result) = 'object');

comment on column public.documents.ledger_binding_status is
  'legacy_unversioned means no ledger identity was inferred; captured requires an immutable ledger and generation snapshot.';
comment on column public.sections.section_key is
  'Version-scoped machine identity. Historical display names are never treated as section keys.';
comment on column public.ted_artifact_blocks.source_section_key is
  'Historical source identity retained for a future reviewed projection; never populated by model redistribution.';
comment on column public.export_history.ledger_version is
  'Exact immutable ledger version used for the exported approved revision. Null identifies a legacy export.';

create or replace function private.ledger_write_context()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(current_setting('prompted.ledger_write_context', true), '')
$$;

create or replace function private.protect_document_ledger_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' and new.ledger_binding_status = 'captured' then
    raise exception 'DOCUMENT_LEDGER_BINDING_RPC_NOT_IMPLEMENTED';
  end if;
  if tg_op = 'DELETE' and old.ledger_binding_status = 'captured' then
    raise exception 'IMMUTABLE_CAPTURED_DOCUMENT:%', old.id;
  end if;
  if tg_op = 'UPDATE' then
    if old.ledger_binding_status = 'legacy_unversioned'
      and new.ledger_binding_status = 'captured' then
      raise exception 'DOCUMENT_LEDGER_BINDING_RPC_NOT_IMPLEMENTED';
    end if;
    if old.ledger_binding_status = 'captured' then
      raise exception 'DOCUMENT_REVISION_RPC_NOT_IMPLEMENTED:%', old.id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger documents_ledger_binding_immutable
  before insert or update or delete on public.documents
  for each row execute function private.protect_document_ledger_binding();

create or replace function private.protect_section_ledger_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' and new.ledger_binding_status = 'captured' then
    raise exception 'SECTION_LEDGER_BINDING_RPC_NOT_IMPLEMENTED';
  end if;
  if tg_op = 'DELETE' and old.ledger_binding_status = 'captured' then
    raise exception 'IMMUTABLE_CAPTURED_SECTION:%', old.id;
  end if;
  if tg_op = 'UPDATE' then
    if old.ledger_binding_status = 'legacy_unversioned'
      and new.ledger_binding_status = 'captured' then
      raise exception 'SECTION_LEDGER_BINDING_RPC_NOT_IMPLEMENTED';
    end if;
    if old.ledger_binding_status = 'captured' then
      raise exception 'SECTION_REVISION_RPC_NOT_IMPLEMENTED:%', old.id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger sections_ledger_binding_immutable
  before insert or update or delete on public.sections
  for each row execute function private.protect_section_ledger_binding();

create or replace function private.protect_ted_artifact_ledger_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' and new.ledger_binding_status = 'captured' then
    raise exception 'LEDGER_BINDING_RPC_REQUIRED:ted_artifacts:%', new.id;
  end if;
  if tg_op = 'DELETE' and old.ledger_binding_status = 'captured' then
    raise exception 'IMMUTABLE_CAPTURED_ARTIFACT:%', old.id;
  end if;
  if tg_op = 'UPDATE' then
    if old.ledger_binding_status = 'legacy_unversioned'
      and new.ledger_binding_status = 'captured'
      and private.ledger_write_context() <> 'bind_artifact' then
      raise exception 'LEDGER_BINDING_RPC_REQUIRED:ted_artifacts:%', old.id;
    end if;
    if old.ledger_binding_status = 'captured'
      and private.ledger_write_context() not in ('bind_block', 'save_block', 'approve_block') then
      raise exception 'REVISION_RPC_REQUIRED:ted_artifacts:%', old.id;
    end if;
    if old.ledger_binding_status = 'captured' and (
      new.ledger_binding_status is distinct from old.ledger_binding_status
      or new.ledger_template_id is distinct from old.ledger_template_id
      or new.ledger_version is distinct from old.ledger_version
      or new.benchmark_version is distinct from old.benchmark_version
      or new.generation_snapshot_id is distinct from old.generation_snapshot_id
    ) then
      raise exception 'IMMUTABLE_LEDGER_BINDING:ted_artifacts:%', old.id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger ted_artifacts_ledger_binding_immutable
  before insert or update or delete on public.ted_artifacts
  for each row execute function private.protect_ted_artifact_ledger_binding();

create or replace function private.protect_ted_artifact_block_ledger_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' and new.ledger_binding_status = 'captured' then
    raise exception 'LEDGER_BINDING_RPC_REQUIRED:ted_artifact_blocks:%', new.id;
  end if;
  if tg_op = 'DELETE' and old.ledger_binding_status = 'captured' then
    raise exception 'IMMUTABLE_CAPTURED_ARTIFACT_BLOCK:%', old.id;
  end if;
  if tg_op = 'UPDATE' then
    if old.ledger_binding_status = 'legacy_unversioned'
      and new.ledger_binding_status = 'captured'
      and private.ledger_write_context() <> 'bind_block' then
      raise exception 'LEDGER_BINDING_RPC_REQUIRED:ted_artifact_blocks:%', old.id;
    end if;
    if old.ledger_binding_status = 'captured'
      and private.ledger_write_context() not in ('save_block', 'approve_block') then
      raise exception 'REVISION_RPC_REQUIRED:ted_artifact_blocks:%', old.id;
    end if;
    if old.ledger_binding_status = 'captured' and (
      new.ledger_binding_status is distinct from old.ledger_binding_status
      or new.ledger_section_key is distinct from old.ledger_section_key
      or new.ledger_version is distinct from old.ledger_version
      or new.is_required is distinct from old.is_required
      or new.source_block_id is distinct from old.source_block_id
      or new.source_section_key is distinct from old.source_section_key
      or new.transformation_version is distinct from old.transformation_version
    ) then
      raise exception 'IMMUTABLE_LEDGER_BINDING:ted_artifact_blocks:%', old.id;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger ted_artifact_blocks_ledger_binding_immutable
  before insert or update or delete on public.ted_artifact_blocks
  for each row execute function private.protect_ted_artifact_block_ledger_binding();

create or replace function private.protect_captured_artifact_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.snapshot->>'ledger_binding_status' = 'captured' then
    raise exception 'IMMUTABLE_CAPTURED_ARTIFACT_VERSION:%', old.id;
  end if;
  return old;
end;
$$;

create trigger ted_artifact_versions_immutable
  before update or delete on public.ted_artifact_versions
  for each row execute function private.protect_captured_artifact_version();

create or replace function private.capture_ted_artifact_revision(p_artifact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.ted_artifacts%rowtype;
  v_blocks jsonb;
begin
  select * into v_artifact
  from public.ted_artifacts
  where id = p_artifact_id;

  if not found then
    raise exception 'ARTIFACT_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.order_index, b.id), '[]'::jsonb)
  into v_blocks
  from public.ted_artifact_blocks b
  where b.artifact_id = p_artifact_id;

  insert into public.ted_artifact_versions(artifact_id, user_id, revision, snapshot)
  values (
    v_artifact.id,
    v_artifact.user_id,
    v_artifact.current_revision,
    to_jsonb(v_artifact) || jsonb_build_object('blocks', v_blocks)
  );
end;
$$;

revoke all on function private.capture_ted_artifact_revision(uuid)
  from public, anon, authenticated;

create or replace function public.register_document_ledger_version(
  p_schema_version text,
  p_ledger_version text,
  p_contract_json jsonb,
  p_contract_sha256 text,
  p_registered_by text default 'service_role'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := lower(trim(p_contract_sha256));
  v_computed_hash text;
  v_template_count integer;
  v_existing private.document_ledger_versions%rowtype;
begin
  if p_schema_version is null or length(trim(p_schema_version)) = 0 then
    raise exception 'LEDGER_SCHEMA_VERSION_REQUIRED';
  end if;
  if p_ledger_version is null or length(trim(p_ledger_version)) = 0 then
    raise exception 'LEDGER_VERSION_REQUIRED';
  end if;
  if jsonb_typeof(p_contract_json) <> 'object'
    or jsonb_typeof(p_contract_json->'templates') <> 'object' then
    raise exception 'LEDGER_CONTRACT_INVALID';
  end if;
  if p_contract_json->>'schemaVersion' <> p_schema_version
    or p_contract_json->>'ledgerVersion' <> p_ledger_version then
    raise exception 'LEDGER_IDENTITY_MISMATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ledger-version:' || p_ledger_version, 0)
  );

  select count(*) into v_template_count
  from jsonb_object_keys(p_contract_json->'templates');
  if v_template_count < 1 then
    raise exception 'LEDGER_TEMPLATE_SET_EMPTY';
  end if;

  v_computed_hash := encode(
    extensions.digest(convert_to(p_contract_json::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_hash !~ '^[0-9a-f]{64}$' or v_hash <> v_computed_hash then
    raise exception 'LEDGER_HASH_MISMATCH';
  end if;

  select * into v_existing
  from private.document_ledger_versions
  where ledger_version = p_ledger_version;

  if found then
    if v_existing.contract_sha256 <> v_hash
      or v_existing.schema_version <> p_schema_version
      or v_existing.contract_json <> p_contract_json then
      raise exception 'LEDGER_VERSION_CONFLICT:%', p_ledger_version;
    end if;
    return jsonb_build_object(
      'ledger_version', v_existing.ledger_version,
      'contract_sha256', v_existing.contract_sha256,
      'template_count', v_existing.template_count,
      'idempotent_replay', true
    );
  end if;

  insert into private.document_ledger_versions(
    ledger_version, schema_version, contract_sha256, contract_json,
    template_count, registered_by
  ) values (
    p_ledger_version, p_schema_version, v_hash, p_contract_json,
    v_template_count, coalesce(nullif(trim(p_registered_by), ''), 'service_role')
  );

  return jsonb_build_object(
    'ledger_version', p_ledger_version,
    'contract_sha256', v_hash,
    'template_count', v_template_count,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.register_document_ledger_version(text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.register_document_ledger_version(text, text, jsonb, text, text)
  to service_role;

create or replace function public.prepare_document_generation_snapshot(
  p_user_id uuid,
  p_generation_request_id text,
  p_ledger_version text,
  p_template_id text,
  p_benchmark_version text,
  p_pipeline_version text,
  p_input_values jsonb,
  p_source_snapshot jsonb,
  p_evidence_snapshot jsonb,
  p_unresolved_input_keys text[] default '{}'::text[],
  p_confirmations jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract jsonb;
  v_payload jsonb;
  v_hash text;
  v_existing private.document_generation_snapshots%rowtype;
  v_id uuid;
begin
  if p_user_id is null then raise exception 'SNAPSHOT_USER_REQUIRED'; end if;
  if length(trim(coalesce(p_generation_request_id, ''))) = 0 then
    raise exception 'GENERATION_REQUEST_ID_REQUIRED';
  end if;
  if jsonb_typeof(coalesce(p_input_values, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_source_snapshot, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_evidence_snapshot, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_confirmations, '{}'::jsonb)) <> 'object' then
    raise exception 'GENERATION_SNAPSHOT_INVALID';
  end if;
  if length(trim(coalesce(p_benchmark_version, ''))) = 0
    or length(trim(coalesce(p_pipeline_version, ''))) = 0 then
    raise exception 'GENERATION_VERSION_IDENTITY_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'generation-snapshot:' || p_user_id::text || ':' || trim(p_generation_request_id),
      0
    )
  );

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = p_ledger_version;
  if not found then raise exception 'UNKNOWN_LEDGER_VERSION:%', p_ledger_version; end if;
  if not (v_contract->'templates' ? p_template_id) then
    raise exception 'UNKNOWN_LEDGER_TEMPLATE:%:%', p_ledger_version, p_template_id;
  end if;

  v_payload := jsonb_build_object(
    'userId', p_user_id,
    'generationRequestId', trim(p_generation_request_id),
    'ledgerVersion', p_ledger_version,
    'templateId', p_template_id,
    'benchmarkVersion', p_benchmark_version,
    'pipelineVersion', p_pipeline_version,
    'inputValues', coalesce(p_input_values, '{}'::jsonb),
    'sourceSnapshot', coalesce(p_source_snapshot, '{}'::jsonb),
    'evidenceSnapshot', coalesce(p_evidence_snapshot, '{}'::jsonb),
    'unresolvedInputKeys', to_jsonb(coalesce(p_unresolved_input_keys, '{}'::text[])),
    'confirmations', coalesce(p_confirmations, '{}'::jsonb)
  );
  v_hash := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select * into v_existing
  from private.document_generation_snapshots
  where user_id = p_user_id
    and generation_request_id = trim(p_generation_request_id);

  if found then
    if v_existing.snapshot_sha256 <> v_hash then
      raise exception 'GENERATION_REPLAY_CONFLICT:%', p_generation_request_id;
    end if;
    return jsonb_build_object(
      'generation_snapshot_id', v_existing.id,
      'snapshot_sha256', v_existing.snapshot_sha256,
      'idempotent_replay', true
    );
  end if;

  insert into private.document_generation_snapshots(
    user_id, generation_request_id, template_id, ledger_version,
    benchmark_version, pipeline_version, input_values, source_snapshot,
    evidence_snapshot, unresolved_input_keys, confirmations, snapshot_sha256
  ) values (
    p_user_id, trim(p_generation_request_id), p_template_id, p_ledger_version,
    p_benchmark_version, p_pipeline_version,
    coalesce(p_input_values, '{}'::jsonb),
    coalesce(p_source_snapshot, '{}'::jsonb),
    coalesce(p_evidence_snapshot, '{}'::jsonb),
    coalesce(p_unresolved_input_keys, '{}'::text[]),
    coalesce(p_confirmations, '{}'::jsonb), v_hash
  ) returning id into v_id;

  return jsonb_build_object(
    'generation_snapshot_id', v_id,
    'snapshot_sha256', v_hash,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.prepare_document_generation_snapshot(
  uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text[], jsonb
) from public, anon, authenticated;
grant execute on function public.prepare_document_generation_snapshot(
  uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text[], jsonb
) to service_role;

create or replace function public.bind_ted_artifact_ledger(
  p_artifact_id uuid,
  p_expected_revision integer,
  p_ledger_version text,
  p_template_id text,
  p_benchmark_version text,
  p_generation_snapshot_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.ted_artifacts%rowtype;
  v_snapshot private.document_generation_snapshots%rowtype;
  v_previous_context text := private.ledger_write_context();
begin
  select * into v_artifact
  from public.ted_artifacts
  where id = p_artifact_id
  for update;
  if not found then raise exception 'ARTIFACT_NOT_FOUND'; end if;

  if v_artifact.ledger_binding_status = 'captured' then
    if v_artifact.ledger_version = p_ledger_version
      and v_artifact.ledger_template_id = p_template_id
      and v_artifact.benchmark_version = p_benchmark_version
      and v_artifact.generation_snapshot_id = p_generation_snapshot_id then
      return jsonb_build_object(
        'artifact_id', v_artifact.id,
        'current_revision', v_artifact.current_revision,
        'idempotent_replay', true
      );
    end if;
    raise exception 'ARTIFACT_LEDGER_BINDING_CONFLICT:%', p_artifact_id;
  end if;

  if v_artifact.current_revision <> p_expected_revision then
    raise exception 'STALE_ARTIFACT_REVISION:expected:%:actual:%',
      p_expected_revision, v_artifact.current_revision;
  end if;

  select * into v_snapshot
  from private.document_generation_snapshots
  where id = p_generation_snapshot_id;
  if not found
    or v_snapshot.user_id <> v_artifact.user_id
    or v_snapshot.ledger_version <> p_ledger_version
    or v_snapshot.template_id <> p_template_id
    or v_snapshot.benchmark_version <> p_benchmark_version then
    raise exception 'GENERATION_SNAPSHOT_BINDING_MISMATCH';
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'bind_artifact', true);

  update public.ted_artifacts
  set ledger_binding_status = 'captured',
      ledger_template_id = p_template_id,
      ledger_version = p_ledger_version,
      benchmark_version = p_benchmark_version,
      generation_snapshot_id = p_generation_snapshot_id,
      approved_revision = null,
      current_revision = current_revision + 1,
      status = 'needs_review',
      updated_at = now()
  where id = p_artifact_id
  returning * into v_artifact;

  perform private.capture_ted_artifact_revision(p_artifact_id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'current_revision', v_artifact.current_revision,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.bind_ted_artifact_ledger(uuid, integer, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.bind_ted_artifact_ledger(uuid, integer, text, text, text, uuid)
  to service_role;

create or replace function public.bind_ted_artifact_block_ledger(
  p_block_id uuid,
  p_expected_artifact_revision integer,
  p_expected_block_revision integer,
  p_ledger_section_key text,
  p_is_required boolean,
  p_section_state text,
  p_source_block_id uuid default null,
  p_source_section_key text default null,
  p_transformation_version text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_contract jsonb;
  v_section jsonb;
  v_previous_context text := private.ledger_write_context();
begin
  select a.* into v_artifact
  from public.ted_artifacts a
  join public.ted_artifact_blocks b on b.artifact_id = a.id
  where b.id = p_block_id
  for update of a;
  if not found then raise exception 'ARTIFACT_BLOCK_NOT_FOUND'; end if;

  select * into v_block
  from public.ted_artifact_blocks
  where id = p_block_id
  for update;

  if v_block.ledger_binding_status = 'captured' then
    if v_block.ledger_section_key = p_ledger_section_key
      and v_block.ledger_version = v_artifact.ledger_version
      and v_block.is_required = p_is_required
      and v_block.source_block_id is not distinct from p_source_block_id
      and v_block.source_section_key is not distinct from p_source_section_key
      and v_block.transformation_version is not distinct from p_transformation_version then
      return jsonb_build_object(
        'artifact_id', v_artifact.id,
        'artifact_revision', v_artifact.current_revision,
        'block_id', v_block.id,
        'block_revision', v_block.revision,
        'idempotent_replay', true
      );
    end if;
    raise exception 'BLOCK_LEDGER_BINDING_CONFLICT:%', p_block_id;
  end if;

  if v_artifact.ledger_binding_status <> 'captured' then
    raise exception 'ARTIFACT_LEDGER_BINDING_REQUIRED';
  end if;
  if v_artifact.current_revision <> p_expected_artifact_revision
    or v_block.revision <> p_expected_block_revision then
    raise exception 'STALE_BLOCK_BINDING_REVISION';
  end if;
  if p_source_block_id = p_block_id then
    raise exception 'SOURCE_BLOCK_SELF_REFERENCE';
  end if;

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = v_artifact.ledger_version;

  select section into v_section
  from jsonb_array_elements(
    v_contract->'templates'->v_artifact.ledger_template_id->'sections'
  ) section
  where section->>'sectionKey' = p_ledger_section_key;

  if v_section is null then
    raise exception 'UNKNOWN_LEDGER_SECTION:%:%:%',
      v_artifact.ledger_version, v_artifact.ledger_template_id, p_ledger_section_key;
  end if;
  if (v_section->>'required')::boolean is distinct from p_is_required then
    raise exception 'LEDGER_SECTION_REQUIREDNESS_MISMATCH:%', p_ledger_section_key;
  end if;
  if p_section_state not in (
    'final', 'needs_clarification', 'interactive_placeholder',
    'neutral_fallback', 'omitted_optional', 'failed_validation'
  ) then
    raise exception 'INVALID_SECTION_STATE:%', p_section_state;
  end if;
  if p_is_required and p_section_state = 'omitted_optional' then
    raise exception 'REQUIRED_SECTION_CANNOT_BE_OMITTED:%', p_ledger_section_key;
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'bind_block', true);

  update public.ted_artifact_blocks
  set ledger_binding_status = 'captured',
      ledger_section_key = p_ledger_section_key,
      ledger_version = v_artifact.ledger_version,
      is_required = p_is_required,
      section_state = p_section_state,
      source_block_id = p_source_block_id,
      source_section_key = p_source_section_key,
      transformation_version = p_transformation_version,
      approval_status = 'draft',
      approved_revision = null,
      revision = revision + 1,
      updated_at = now()
  where id = p_block_id
  returning * into v_block;

  update public.ted_artifacts
  set current_revision = current_revision + 1,
      status = 'needs_review',
      approved_revision = null,
      updated_at = now()
  where id = v_artifact.id
  returning * into v_artifact;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'artifact_revision', v_artifact.current_revision,
    'block_id', v_block.id,
    'block_revision', v_block.revision,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.bind_ted_artifact_block_ledger(
  uuid, integer, integer, text, boolean, text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.bind_ted_artifact_block_ledger(
  uuid, integer, integer, text, boolean, text, uuid, text, text
) to service_role;

create or replace function public.save_ted_artifact_block_revision(
  p_block_id uuid,
  p_expected_artifact_revision integer,
  p_expected_block_revision integer,
  p_payload jsonb,
  p_section_state text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_previous_context text := private.ledger_write_context();
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'BLOCK_PAYLOAD_INVALID'; end if;

  select a.* into v_artifact
  from public.ted_artifacts a
  join public.ted_artifact_blocks b on b.artifact_id = a.id
  where b.id = p_block_id and a.user_id = v_user_id
  for update of a;
  if not found then raise exception 'ARTIFACT_BLOCK_NOT_FOUND'; end if;

  select * into v_block
  from public.ted_artifact_blocks
  where id = p_block_id and user_id = v_user_id
  for update;

  if v_artifact.ledger_binding_status <> 'captured'
    or v_block.ledger_binding_status <> 'captured' then
    raise exception 'LEDGER_BINDING_REQUIRED';
  end if;
  if v_artifact.current_revision <> p_expected_artifact_revision
    or v_block.revision <> p_expected_block_revision then
    raise exception 'STALE_WRITE_CONFLICT';
  end if;
  if p_section_state not in (
    'final', 'needs_clarification', 'interactive_placeholder',
    'neutral_fallback', 'omitted_optional', 'failed_validation'
  ) then
    raise exception 'INVALID_SECTION_STATE:%', p_section_state;
  end if;
  if v_block.is_required and p_section_state = 'omitted_optional' then
    raise exception 'REQUIRED_SECTION_CANNOT_BE_OMITTED:%', v_block.ledger_section_key;
  end if;
  if p_section_state = 'final'
    and v_block.kind = 'section'
    and length(trim(coalesce(p_payload->>'content', ''))) = 0 then
    raise exception 'BLANK_FINAL_SECTION';
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'save_block', true);

  update public.ted_artifact_blocks
  set payload = p_payload,
      section_state = p_section_state,
      approval_status = 'draft',
      approved_revision = null,
      revision = revision + 1,
      updated_at = now()
  where id = p_block_id
  returning * into v_block;

  update public.ted_artifacts
  set current_revision = current_revision + 1,
      status = 'needs_review',
      approved_revision = null,
      updated_at = now()
  where id = v_artifact.id
  returning * into v_artifact;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'artifact_revision', v_artifact.current_revision,
    'block_id', v_block.id,
    'block_revision', v_block.revision,
    'approval_status', v_block.approval_status
  );
end;
$$;

revoke all on function public.save_ted_artifact_block_revision(uuid, integer, integer, jsonb, text)
  from public, anon;
grant execute on function public.save_ted_artifact_block_revision(uuid, integer, integer, jsonb, text)
  to authenticated;

create or replace function public.approve_ted_artifact_block_revision(
  p_block_id uuid,
  p_expected_artifact_revision integer,
  p_expected_block_revision integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_previous_context text := private.ledger_write_context();
begin
  if v_user_id is null then raise exception 'UNAUTHENTICATED' using errcode = '28000'; end if;

  select a.* into v_artifact
  from public.ted_artifacts a
  join public.ted_artifact_blocks b on b.artifact_id = a.id
  where b.id = p_block_id and a.user_id = v_user_id
  for update of a;
  if not found then raise exception 'ARTIFACT_BLOCK_NOT_FOUND'; end if;

  select * into v_block
  from public.ted_artifact_blocks
  where id = p_block_id and user_id = v_user_id
  for update;

  if v_artifact.ledger_binding_status <> 'captured'
    or v_block.ledger_binding_status <> 'captured' then
    raise exception 'LEDGER_BINDING_REQUIRED';
  end if;
  if v_artifact.current_revision <> p_expected_artifact_revision
    or v_block.revision <> p_expected_block_revision then
    raise exception 'STALE_APPROVAL_CONFLICT';
  end if;
  if v_block.section_state <> 'final' then
    raise exception 'SECTION_NOT_FINAL';
  end if;
  if v_block.kind = 'section'
    and length(trim(coalesce(v_block.payload->>'content', ''))) = 0 then
    raise exception 'BLANK_SECTION_CANNOT_BE_APPROVED';
  end if;

  perform pg_catalog.set_config('prompted.ledger_write_context', 'approve_block', true);

  update public.ted_artifact_blocks
  set approval_status = 'approved',
      revision = revision + 1,
      approved_revision = revision + 1,
      updated_at = now()
  where id = p_block_id
  returning * into v_block;

  update public.ted_artifacts
  set current_revision = current_revision + 1,
      status = 'needs_review',
      updated_at = now()
  where id = v_artifact.id
  returning * into v_artifact;

  perform private.capture_ted_artifact_revision(v_artifact.id);
  perform pg_catalog.set_config(
    'prompted.ledger_write_context', v_previous_context, true
  );

  return jsonb_build_object(
    'artifact_id', v_artifact.id,
    'artifact_revision', v_artifact.current_revision,
    'block_id', v_block.id,
    'block_revision', v_block.revision,
    'approved_revision', v_block.approved_revision,
    'approval_status', v_block.approval_status
  );
end;
$$;

revoke all on function public.approve_ted_artifact_block_revision(uuid, integer, integer)
  from public, anon;
grant execute on function public.approve_ted_artifact_block_revision(uuid, integer, integer)
  to authenticated;

-- There is intentionally no activation function, no historical-key adapter,
-- no bulk backfill and no change to existing live generation/export callers in
-- L0.2. Those gates remain separately authorised.
