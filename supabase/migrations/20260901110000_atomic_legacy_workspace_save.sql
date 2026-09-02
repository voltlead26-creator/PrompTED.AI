-- Atomic, replay-safe persistence for the complete legacy-unversioned
-- document workspace aggregate. Captured documents retain their existing
-- operation/ledger command path; direct legacy DML remains only as a bounded
-- rollback adapter during the expand cohort.

begin;

create or replace function private.jsonb_has_exact_keys(
  p_value jsonb,
  p_keys text[]
) returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(p_value) is distinct from 'object' then false
    else coalesce(
      (
        select pg_catalog.array_agg(key_record.key order by key_record.key)
        from pg_catalog.jsonb_object_keys(p_value) key_record(key)
      ) = (
        select pg_catalog.array_agg(expected_record.key order by expected_record.key)
        from pg_catalog.unnest(p_keys) expected_record(key)
      ),
      false
    )
  end
$function$;

revoke all on function private.jsonb_has_exact_keys(jsonb, text[])
  from public, anon, authenticated, service_role;

create table private.legacy_workspace_save_receipts (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  outcome_id uuid not null,
  document_id uuid not null,
  accepted_document_revision integer not null
    check (accepted_document_revision >= 0),
  result_document_revision integer not null
    check (result_document_revision > 0),
  section_count integer not null check (section_count between 1 and 512),
  result jsonb not null check (
    pg_catalog.jsonb_typeof(result) = 'object'
    and pg_catalog.octet_length(result::text) <= 262144
    and not (result ? 'content')
    and not (result ? 'title')
    and not (result ? 'unresolved_placeholders')
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id, idempotency_key)
);

comment on table private.legacy_workspace_save_receipts is
  'Immutable metadata-only receipts for atomic legacy workspace saves. User wording, titles, placeholders and source data remain solely in owner-scoped application rows.';

alter table private.legacy_workspace_save_receipts enable row level security;
revoke all on table private.legacy_workspace_save_receipts
  from public, anon, authenticated, service_role;

create or replace function private.reject_legacy_workspace_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
    and not exists (
      select 1 from auth.users user_record where user_record.id = old.user_id
    ) then
    return old;
  end if;
  raise exception using
    errcode = '55000',
    message = 'LEGACY_WORKSPACE_RECEIPT_IMMUTABLE';
end;
$function$;

revoke all on function private.reject_legacy_workspace_receipt_mutation()
  from public, anon, authenticated, service_role;

create trigger legacy_workspace_save_receipt_immutable
  before update or delete on private.legacy_workspace_save_receipts
  for each row execute function private.reject_legacy_workspace_receipt_mutation();

-- Structural section edits are as revision-sensitive as wording edits. The
-- prior compatibility trigger advanced only for content/status, leaving
-- rename, reorder and required-state changes invisible to CAS and approval.
create or replace function private.advance_legacy_section_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_content_changed boolean;
  v_status_changed boolean;
  v_structure_changed boolean;
  v_changed boolean;
begin
  if old.ledger_binding_status <> 'legacy_unversioned' then
    return new;
  end if;

  new.revision := old.revision;
  new.version_history := old.version_history;
  new.approved_revision := old.approved_revision;
  v_content_changed := new.content is distinct from old.content;
  v_status_changed := new.status is distinct from old.status;
  v_structure_changed := new.name is distinct from old.name
    or new.order_index is distinct from old.order_index
    or new.is_required is distinct from old.is_required;
  v_changed := v_content_changed or v_status_changed or v_structure_changed;

  if not v_changed then
    return new;
  end if;

  new.revision := old.revision + 1;
  if v_content_changed then
    new.version_history := old.version_history || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'content', old.content,
        'saved_at', pg_catalog.clock_timestamp(),
        'label', 'Before saved change',
        'origin', 'system'
      )
    );
  end if;

  if v_content_changed or v_structure_changed then
    new.approved_revision := null;
    if new.status = 'approved' then new.status := 'edited'; end if;
  elsif new.status = 'approved' then
    new.approved_revision := old.revision + 1;
  elsif old.status = 'approved' then
    new.approved_revision := null;
  end if;

  update public.documents document_record
  set current_revision = document_record.current_revision + 1,
      status = case
        when document_record.status in ('approved', 'exported') then 'edited'
        else document_record.status
      end,
      approved_revision = null,
      updated_at = pg_catalog.clock_timestamp()
  where document_record.id = old.document_id
    and document_record.user_id = old.user_id
    and document_record.ledger_binding_status = 'legacy_unversioned';
  return new;
end;
$function$;

revoke all on function private.advance_legacy_section_revision()
  from public, anon, authenticated, service_role;

create or replace function public.save_own_legacy_workspace_v1(
  p_idempotency_key text,
  p_outcome_id uuid,
  p_document_id uuid,
  p_expected_document_revision integer,
  p_expected_document jsonb,
  p_document jsonb,
  p_sections jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_idempotency_key text := p_idempotency_key;
  v_outcome public.outcomes%rowtype;
  v_document public.documents%rowtype;
  v_section public.sections%rowtype;
  v_receipt private.legacy_workspace_save_receipts%rowtype;
  v_patch jsonb;
  v_expected jsonb;
  v_desired jsonb;
  v_ordinality bigint;
  v_section_id uuid;
  v_section_ids uuid[] := '{}'::uuid[];
  v_expected_section_ids uuid[] := '{}'::uuid[];
  v_current_section_ids uuid[] := '{}'::uuid[];
  v_section_orders integer[] := '{}'::integer[];
  v_section_order integer;
  v_section_count integer := 0;
  v_existing_changed boolean := false;
  v_new_count integer := 0;
  v_content_present boolean;
  v_next_content text;
  v_current_content_sha256 text;
  v_template_id uuid;
  v_expected_template_id uuid;
  v_document_status text;
  v_expected_document_status text;
  v_document_metadata_changed boolean := false;
  v_structural_change boolean := false;
  v_document_count integer;
  v_normalized_sections jsonb;
  v_request_payload jsonb;
  v_request_sha256 text;
  v_sections_result jsonb;
  v_result jsonb;
  v_state text;
  v_committed_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'LEGACY_WORKSPACE_AUTHENTICATION_REQUIRED';
  end if;
  if p_outcome_id is null or p_document_id is null then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_IDENTITY_INVALID';
  end if;
  if v_idempotency_key is null
    or v_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_IDEMPOTENCY_INVALID';
  end if;
  if p_expected_document_revision is null or p_expected_document_revision < 0 then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_REVISION_INVALID';
  end if;
  if not private.jsonb_has_exact_keys(
    p_document,
    array['status', 'template_id', 'title', 'unresolved_placeholders']
  ) then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_DOCUMENT_INVALID';
  end if;
  if (p_expected_document_revision = 0 and p_expected_document is not null)
    or (
      p_expected_document_revision > 0
      and not private.jsonb_has_exact_keys(
        p_expected_document,
        array['status', 'template_id', 'title', 'unresolved_placeholders']
      )
    ) then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_EXPECTED_DOCUMENT_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_document->'title') is distinct from 'string'
    or nullif(pg_catalog.btrim(p_document->>'title'), '') is null
    or pg_catalog.octet_length(p_document->>'title') > 500
    or pg_catalog.jsonb_typeof(p_document->'status') is distinct from 'string'
    or p_document->>'status' not in ('draft', 'edited', 'approved', 'exported', 'archived')
    or pg_catalog.jsonb_typeof(p_document->'unresolved_placeholders') is distinct from 'array'
    or pg_catalog.octet_length((p_document->'unresolved_placeholders')::text) > 262144 then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_DOCUMENT_INVALID';
  end if;
  v_document_status := p_document->>'status';
  if pg_catalog.jsonb_typeof(p_document->'template_id') = 'null' then
    v_template_id := null;
  elsif pg_catalog.jsonb_typeof(p_document->'template_id') = 'string'
    and p_document->>'template_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_template_id := (p_document->>'template_id')::uuid;
  else
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_TEMPLATE_INVALID';
  end if;

  if p_expected_document_revision > 0 then
    if pg_catalog.jsonb_typeof(p_expected_document->'title') is distinct from 'string'
      or pg_catalog.jsonb_typeof(p_expected_document->'status') is distinct from 'string'
      or p_expected_document->>'status' not in ('draft', 'edited', 'approved', 'exported', 'archived')
      or pg_catalog.jsonb_typeof(p_expected_document->'unresolved_placeholders') is distinct from 'array'
      or pg_catalog.octet_length((p_expected_document->'unresolved_placeholders')::text) > 262144 then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_EXPECTED_DOCUMENT_INVALID';
    end if;
    v_expected_document_status := p_expected_document->>'status';
    if pg_catalog.jsonb_typeof(p_expected_document->'template_id') = 'null' then
      v_expected_template_id := null;
    elsif pg_catalog.jsonb_typeof(p_expected_document->'template_id') = 'string'
      and p_expected_document->>'template_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_expected_template_id := (p_expected_document->>'template_id')::uuid;
    else
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_EXPECTED_DOCUMENT_INVALID';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_sections) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_sections) not between 1 and 512
    or pg_catalog.octet_length(p_sections::text) > 5242880 then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTIONS_INVALID';
  end if;

  for v_patch, v_ordinality in
    select patch_record.value, patch_record.ordinality
    from pg_catalog.jsonb_array_elements(p_sections)
      with ordinality as patch_record(value, ordinality)
    order by patch_record.ordinality
  loop
    if not private.jsonb_has_exact_keys(v_patch, array['desired', 'expected', 'id'])
      and not private.jsonb_has_exact_keys(v_patch, array['content', 'desired', 'expected', 'id']) then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_INVALID';
    end if;
    if pg_catalog.jsonb_typeof(v_patch->'id') is distinct from 'string'
      or v_patch->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_ID_INVALID';
    end if;
    v_section_id := (v_patch->>'id')::uuid;
    if pg_catalog.array_position(v_section_ids, v_section_id) is not null then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_DUPLICATE_SECTION_ID';
    end if;
    v_section_ids := pg_catalog.array_append(v_section_ids, v_section_id);

    if not private.jsonb_has_exact_keys(
      v_patch->'desired', array['is_required', 'name', 'order_index', 'status']
    )
      or pg_catalog.jsonb_typeof(v_patch#>'{desired,name}') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_patch#>>'{desired,name}'), '') is null
      or pg_catalog.octet_length(v_patch#>>'{desired,name}') > 1024
      or pg_catalog.jsonb_typeof(v_patch#>'{desired,order_index}') is distinct from 'number'
      or v_patch#>>'{desired,order_index}' !~ '^(0|[1-9][0-9]*)$'
      or pg_catalog.jsonb_typeof(v_patch#>'{desired,status}') is distinct from 'string'
      or v_patch#>>'{desired,status}' not in ('draft', 'edited', 'approved', 'locked')
      or pg_catalog.jsonb_typeof(v_patch#>'{desired,is_required}') is distinct from 'boolean' then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_DESIRED_INVALID';
    end if;
    v_section_order := (v_patch#>>'{desired,order_index}')::integer;
    if v_section_order <> v_ordinality - 1
      or pg_catalog.array_position(v_section_orders, v_section_order) is not null then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_ORDER_INVALID';
    end if;
    v_section_orders := pg_catalog.array_append(v_section_orders, v_section_order);

    v_content_present := v_patch ? 'content';
    if v_content_present and (
      pg_catalog.jsonb_typeof(v_patch->'content') is distinct from 'string'
      or pg_catalog.octet_length(v_patch->>'content') > 1048576
    ) then
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_CONTENT_INVALID';
    end if;

    if pg_catalog.jsonb_typeof(v_patch->'expected') = 'null' then
      if not v_content_present then
        raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_NEW_SECTION_CONTENT_REQUIRED';
      end if;
    elsif private.jsonb_has_exact_keys(
      v_patch->'expected',
      array['content_sha256', 'is_required', 'name', 'order_index', 'revision', 'status']
    ) then
      v_expected := v_patch->'expected';
      if pg_catalog.jsonb_typeof(v_expected->'revision') is distinct from 'number'
        or v_expected->>'revision' !~ '^[1-9][0-9]*$'
        or pg_catalog.jsonb_typeof(v_expected->'content_sha256') is distinct from 'string'
        or v_expected->>'content_sha256' !~ '^[0-9a-f]{64}$'
        or pg_catalog.jsonb_typeof(v_expected->'name') is distinct from 'string'
        or nullif(pg_catalog.btrim(v_expected->>'name'), '') is null
        or pg_catalog.octet_length(v_expected->>'name') > 1024
        or pg_catalog.jsonb_typeof(v_expected->'order_index') is distinct from 'number'
        or v_expected->>'order_index' !~ '^(0|[1-9][0-9]*)$'
        or pg_catalog.jsonb_typeof(v_expected->'status') is distinct from 'string'
        or v_expected->>'status' not in ('draft', 'edited', 'approved', 'locked')
        or pg_catalog.jsonb_typeof(v_expected->'is_required') is distinct from 'boolean' then
        raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_EXPECTED_INVALID';
      end if;
      v_expected_section_ids := pg_catalog.array_append(v_expected_section_ids, v_section_id);
    else
      raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_SECTION_EXPECTED_INVALID';
    end if;
    v_section_count := v_section_count + 1;
  end loop;

  select pg_catalog.jsonb_agg(patch_record.value order by patch_record.value->>'id')
  into v_normalized_sections
  from pg_catalog.jsonb_array_elements(p_sections) patch_record(value);
  v_request_payload := pg_catalog.jsonb_build_object(
    'contract_version', 'legacy-workspace-save.v1',
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'expected_document_revision', p_expected_document_revision,
    'expected_document', p_expected_document,
    'document', p_document,
    'sections', v_normalized_sections
  );
  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'legacy-workspace-key:' || v_user_id::text || ':' || v_idempotency_key, 0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'legacy-workspace-outcome:' || p_outcome_id::text, 0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'legacy-workspace-document:' || p_document_id::text, 0
  ));
  for v_section_id in
    select section_record.id
    from pg_catalog.unnest(v_section_ids) section_record(id)
    order by section_record.id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'legacy-workspace-section:' || v_section_id::text, 0
    ));
  end loop;

  select receipt_record.* into v_receipt
  from private.legacy_workspace_save_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.idempotency_key = v_idempotency_key;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'LEGACY_WORKSPACE_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt.result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  select outcome_record.* into v_outcome
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'LEGACY_WORKSPACE_UNAVAILABLE';
  end if;

  select pg_catalog.count(*)::integer into v_document_count
  from public.documents document_record
  where document_record.outcome_id = p_outcome_id
    and document_record.user_id = v_user_id;

  if p_expected_document_revision = 0 then
    if v_document_count <> 0
      or exists (
        select 1 from public.documents document_record
        where document_record.id = p_document_id
      ) then
      raise exception using errcode = '40001', message = 'LEGACY_WORKSPACE_CREATE_CONFLICT';
    end if;
  else
    select document_record.* into v_document
    from public.documents document_record
    where document_record.id = p_document_id
      and document_record.outcome_id = p_outcome_id
      and document_record.user_id = v_user_id
    for update;
    if not found or v_document_count <> 1 then
      raise exception using errcode = '42501', message = 'LEGACY_WORKSPACE_UNAVAILABLE';
    end if;
    if v_document.ledger_binding_status <> 'legacy_unversioned' then
      raise exception using errcode = '42501', message = 'CAPTURED_DOCUMENT_OPERATION_REQUIRED';
    end if;
    if v_document.current_revision <> p_expected_document_revision
      or pg_catalog.jsonb_build_object(
        'title', v_document.title,
        'status', v_document.status,
        'template_id', v_document.template_id,
        'unresolved_placeholders', v_document.unresolved_placeholders
      ) is distinct from p_expected_document then
      raise exception using errcode = '40001', message = 'LEGACY_WORKSPACE_DOCUMENT_CONFLICT';
    end if;
  end if;

  if v_template_id is not null and not exists (
    select 1 from public.templates template_record where template_record.id = v_template_id
  ) then
    raise exception using errcode = '23503', message = 'LEGACY_WORKSPACE_TEMPLATE_UNAVAILABLE';
  end if;

  if p_expected_document_revision > 0 then
    perform 1
    from public.sections section_record
    where section_record.document_id = p_document_id
      and section_record.user_id = v_user_id
    order by section_record.id
    for update;

    select coalesce(
      pg_catalog.array_agg(section_record.id order by section_record.id),
      '{}'::uuid[]
    ) into v_current_section_ids
    from public.sections section_record
    where section_record.document_id = p_document_id
      and section_record.user_id = v_user_id;
    select coalesce(
      pg_catalog.array_agg(expected_record.id order by expected_record.id),
      '{}'::uuid[]
    ) into v_expected_section_ids
    from pg_catalog.unnest(v_expected_section_ids) expected_record(id);
    if v_current_section_ids is distinct from v_expected_section_ids then
      raise exception using errcode = '40001', message = 'LEGACY_WORKSPACE_SECTION_ROSTER_CONFLICT';
    end if;
  elsif pg_catalog.cardinality(v_expected_section_ids) <> 0 then
    raise exception using errcode = '22023', message = 'LEGACY_WORKSPACE_CREATE_EXPECTATION_INVALID';
  end if;

  -- Validate every existing expectation and every new identity before the
  -- first document or section mutation.
  for v_patch in
    select patch_record.value
    from pg_catalog.jsonb_array_elements(p_sections) patch_record(value)
    order by patch_record.value->>'id'
  loop
    v_section_id := (v_patch->>'id')::uuid;
    v_expected := v_patch->'expected';
    if pg_catalog.jsonb_typeof(v_expected) = 'null' then
      if exists (
        select 1 from public.sections section_record where section_record.id = v_section_id
      ) then
        raise exception using errcode = '40001', message = 'LEGACY_WORKSPACE_NEW_SECTION_CONFLICT';
      end if;
    else
      select section_record.* into v_section
      from public.sections section_record
      where section_record.id = v_section_id
        and section_record.document_id = p_document_id
        and section_record.user_id = v_user_id;
      if not found or v_section.ledger_binding_status <> 'legacy_unversioned' then
        raise exception using errcode = '40001', message = 'LEGACY_WORKSPACE_SECTION_CONFLICT';
      end if;
      v_current_content_sha256 := pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(v_section.content, 'UTF8'), 'sha256'),
        'hex'
      );
      if v_section.revision <> (v_expected->>'revision')::integer
        or v_current_content_sha256 <> v_expected->>'content_sha256'
        or v_section.name <> v_expected->>'name'
        or v_section.order_index <> (v_expected->>'order_index')::integer
        or v_section.status <> v_expected->>'status'
        or v_section.is_required <> (v_expected->>'is_required')::boolean then
        raise exception using errcode = '40001', message = 'LEGACY_WORKSPACE_SECTION_CONFLICT';
      end if;
    end if;
  end loop;

  if p_expected_document_revision = 0 then
    insert into public.documents(
      id, user_id, outcome_id, template_id, title, status, format,
      is_template, unresolved_placeholders, ledger_binding_status,
      current_revision, approved_revision
    ) values (
      p_document_id, v_user_id, p_outcome_id, v_template_id,
      p_document->>'title', v_document_status, 'word', false,
      p_document->'unresolved_placeholders', 'legacy_unversioned', 1,
      case when v_document_status in ('approved', 'exported') then 1 else null end
    );
    v_state := 'created';
  else
    v_state := 'saved';
  end if;

  for v_patch in
    select patch_record.value
    from pg_catalog.jsonb_array_elements(p_sections) patch_record(value)
    order by (patch_record.value#>>'{desired,order_index}')::integer
  loop
    v_section_id := (v_patch->>'id')::uuid;
    v_expected := v_patch->'expected';
    v_desired := v_patch->'desired';
    v_content_present := v_patch ? 'content';
    if pg_catalog.jsonb_typeof(v_expected) = 'null' then
      insert into public.sections(
        id, document_id, user_id, name, order_index, content, status,
        version_history, is_required, ledger_binding_status,
        revision, approved_revision
      ) values (
        v_section_id, p_document_id, v_user_id, v_desired->>'name',
        (v_desired->>'order_index')::integer, v_patch->>'content',
        v_desired->>'status', '[]'::jsonb,
        (v_desired->>'is_required')::boolean, 'legacy_unversioned', 1,
        case when v_desired->>'status' = 'approved' then 1 else null end
      );
      v_new_count := v_new_count + 1;
    else
      select section_record.* into v_section
      from public.sections section_record
      where section_record.id = v_section_id
        and section_record.document_id = p_document_id
        and section_record.user_id = v_user_id;
      v_next_content := case when v_content_present then v_patch->>'content' else v_section.content end;
      if v_next_content is distinct from v_section.content
        or v_desired->>'name' is distinct from v_section.name
        or (v_desired->>'order_index')::integer is distinct from v_section.order_index
        or v_desired->>'status' is distinct from v_section.status
        or (v_desired->>'is_required')::boolean is distinct from v_section.is_required then
        update public.sections section_record
        set content = v_next_content,
            name = v_desired->>'name',
            order_index = (v_desired->>'order_index')::integer,
            status = v_desired->>'status',
            is_required = (v_desired->>'is_required')::boolean,
            updated_at = pg_catalog.clock_timestamp()
        where section_record.id = v_section_id
          and section_record.document_id = p_document_id
          and section_record.user_id = v_user_id;
        v_existing_changed := true;
      end if;
    end if;
  end loop;

  select document_record.* into v_document
  from public.documents document_record
  where document_record.id = p_document_id
    and document_record.user_id = v_user_id
  for update;

  if p_expected_document_revision > 0 then
    v_document_metadata_changed :=
      v_document.title is distinct from p_document->>'title'
      or v_document.template_id is distinct from v_template_id
      or v_document.unresolved_placeholders is distinct from
        p_document->'unresolved_placeholders';
    v_structural_change := v_existing_changed
      or v_new_count > 0
      or v_document_metadata_changed;

    if v_structural_change then
      update public.documents document_record
      set title = p_document->>'title',
          template_id = v_template_id,
          unresolved_placeholders = p_document->'unresolved_placeholders',
          status = case
            when v_document_status in ('approved', 'exported') then 'edited'
            else v_document_status
          end,
          approved_revision = null,
          current_revision = document_record.current_revision
            + case when v_document_metadata_changed or v_new_count > 0 then 1 else 0 end,
          updated_at = pg_catalog.clock_timestamp()
      where document_record.id = p_document_id
        and document_record.user_id = v_user_id;
    elsif v_document.status is distinct from v_document_status then
      if v_document_status = 'exported'
        and v_document.approved_revision is distinct from v_document.current_revision then
        raise exception using errcode = '55000', message = 'LEGACY_WORKSPACE_EXPORT_REQUIRES_APPROVAL';
      end if;
      update public.documents document_record
      set status = v_document_status,
          approved_revision = case
            when v_document_status = 'approved' then document_record.current_revision
            when v_document_status = 'exported' then document_record.approved_revision
            else null
          end,
          updated_at = pg_catalog.clock_timestamp()
      where document_record.id = p_document_id
        and document_record.user_id = v_user_id;
    else
      v_state := 'unchanged';
    end if;
  end if;

  select document_record.* into v_document
  from public.documents document_record
  where document_record.id = p_document_id
    and document_record.user_id = v_user_id;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'section_id', section_record.id,
      'status', section_record.status,
      'revision', section_record.revision,
      'approved_revision', section_record.approved_revision,
      'content_sha256', pg_catalog.encode(
        extensions.digest(pg_catalog.convert_to(section_record.content, 'UTF8'), 'sha256'
      ), 'hex'),
      'updated_at', section_record.updated_at
    ) order by section_record.order_index, section_record.id
  ) into v_sections_result
  from public.sections section_record
  where section_record.document_id = p_document_id
    and section_record.user_id = v_user_id;

  v_committed_at := pg_catalog.clock_timestamp();
  v_result := pg_catalog.jsonb_build_object(
    'contract_version', 'legacy-workspace-save.v1',
    'state', v_state,
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'idempotency_key', v_idempotency_key,
    'accepted_document_revision', p_expected_document_revision,
    'document_revision', v_document.current_revision,
    'document_status', v_document.status,
    'document_approved_revision', v_document.approved_revision,
    'document_updated_at', v_document.updated_at,
    'sections', v_sections_result,
    'committed_at', v_committed_at,
    'idempotent_replay', false
  );

  insert into private.legacy_workspace_save_receipts(
    user_id, idempotency_key, request_sha256, outcome_id, document_id,
    accepted_document_revision, result_document_revision, section_count,
    result, committed_at
  ) values (
    v_user_id, v_idempotency_key, v_request_sha256, p_outcome_id,
    p_document_id, p_expected_document_revision, v_document.current_revision,
    v_section_count, v_result, v_committed_at
  );
  return v_result;
end;
$function$;

revoke all on function public.save_own_legacy_workspace_v1(
  text, uuid, uuid, integer, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_own_legacy_workspace_v1(
  text, uuid, uuid, integer, jsonb, jsonb, jsonb
) to authenticated;

commit;
