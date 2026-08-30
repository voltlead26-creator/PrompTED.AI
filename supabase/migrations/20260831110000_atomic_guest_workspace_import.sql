-- Atomically move one device-only workspace into the authenticated account.
--
-- This is a legacy-unversioned compatibility boundary. It deliberately does
-- not promote imported documents into the captured ledger cohort, infer
-- provenance, or retain a second copy of the user's document body. A private,
-- immutable receipt binds one owner-scoped idempotency key to a canonical
-- request hash so an exact retry is harmless and a mismatched retry fails
-- closed.

begin;

create table private.guest_workspace_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null
    check (char_length(btrim(idempotency_key)) between 1 and 128),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  outcome_id uuid not null,
  document_id uuid not null,
  template_id uuid,
  document_status text not null check (document_status in ('draft', 'archived')),
  section_count integer not null check (section_count between 1 and 200),
  committed_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

comment on table private.guest_workspace_imports is
  'Hash-only immutable receipts for atomic guest-workspace imports. Document bodies remain solely in the owner-scoped public document and section records.';

alter table private.guest_workspace_imports enable row level security;

revoke all on private.guest_workspace_imports
  from public, anon, authenticated, service_role;

create or replace function private.reject_guest_workspace_import_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- Account deletion is the only permitted removal. During an auth.users FK
  -- cascade the parent row has already ceased to be visible to this trigger.
  if tg_op = 'DELETE'
    and not exists (
      select 1
      from auth.users user_record
      where user_record.id = old.user_id
    ) then
    return old;
  end if;

  raise exception 'IMMUTABLE_GUEST_WORKSPACE_IMPORT:%', old.id;
end;
$function$;

create trigger guest_workspace_imports_immutable
  before update or delete on private.guest_workspace_imports
  for each row execute function private.reject_guest_workspace_import_mutation();

revoke all on function private.reject_guest_workspace_import_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.commit_guest_workspace_import(
  p_idempotency_key text,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_situation_text text,
  p_recommendation_payload jsonb,
  p_template_id uuid,
  p_document_status text,
  p_sections jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_idempotency_key text := btrim(p_idempotency_key);
  v_document_status text := lower(btrim(p_document_status));
  v_request_payload jsonb;
  v_request_sha256 text;
  v_existing_import private.guest_workspace_imports%rowtype;
  v_section jsonb;
  v_section_ordinal bigint;
  v_section_id uuid;
  v_section_order integer;
  v_section_ids uuid[] := '{}'::uuid[];
  v_section_orders integer[] := '{}'::integer[];
  v_section_count integer := 0;
  v_created_at timestamptz;
  v_updated_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if p_outcome_id is null or p_document_id is null then
    raise exception 'GUEST_IMPORT_IDENTITY_REQUIRED';
  end if;
  if v_idempotency_key is null
    or char_length(v_idempotency_key) not between 1 and 128 then
    raise exception 'GUEST_IMPORT_IDEMPOTENCY_KEY_INVALID';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(p_title) > 240 then
    raise exception 'GUEST_IMPORT_TITLE_INVALID';
  end if;
  if nullif(btrim(p_situation_text), '') is null
    or octet_length(p_situation_text) > 1048576 then
    raise exception 'GUEST_IMPORT_SITUATION_INVALID';
  end if;
  if jsonb_typeof(p_recommendation_payload) is distinct from 'object'
    or octet_length(p_recommendation_payload::text) > 1048576 then
    raise exception 'GUEST_IMPORT_RECOMMENDATION_INVALID';
  end if;
  if v_document_status is null
    or v_document_status not in ('draft', 'archived') then
    raise exception 'GUEST_IMPORT_DOCUMENT_STATUS_INVALID';
  end if;
  if jsonb_typeof(p_sections) is distinct from 'array'
    or jsonb_array_length(p_sections) not between 1 and 200
    or octet_length(p_sections::text) > 5242880 then
    raise exception 'GUEST_IMPORT_SECTIONS_INVALID';
  end if;
  -- Validate the complete section set before taking locks or changing durable
  -- state. The array position and order_index must describe one unambiguous,
  -- contiguous 0-based ordering.
  for v_section, v_section_ordinal in
    select section_record.value, section_record.ordinality
    from jsonb_array_elements(p_sections) with ordinality as section_record(value, ordinality)
    order by section_record.ordinality
  loop
    if jsonb_typeof(v_section) is distinct from 'object' then
      raise exception 'GUEST_IMPORT_SECTION_INVALID:%', v_section_ordinal;
    end if;
    if coalesce(v_section->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'GUEST_IMPORT_SECTION_ID_INVALID:%', v_section_ordinal;
    end if;

    v_section_id := (v_section->>'id')::uuid;
    if array_position(v_section_ids, v_section_id) is not null then
      raise exception 'GUEST_IMPORT_DUPLICATE_SECTION_ID:%', v_section_id;
    end if;
    v_section_ids := array_append(v_section_ids, v_section_id);

    if jsonb_typeof(v_section->'order_index') is distinct from 'number'
      or coalesce(v_section->>'order_index', '') !~ '^(0|[1-9][0-9]*)$' then
      raise exception 'GUEST_IMPORT_SECTION_ORDER_INVALID:%', v_section_id;
    end if;
    v_section_order := (v_section->>'order_index')::integer;
    if v_section_order <> v_section_ordinal - 1
      or array_position(v_section_orders, v_section_order) is not null then
      raise exception 'GUEST_IMPORT_SECTION_ORDER_INVALID:%', v_section_id;
    end if;
    v_section_orders := array_append(v_section_orders, v_section_order);

    if jsonb_typeof(v_section->'name') is distinct from 'string'
      or nullif(btrim(v_section->>'name'), '') is null
      or char_length(v_section->>'name') > 240 then
      raise exception 'GUEST_IMPORT_SECTION_NAME_INVALID:%', v_section_id;
    end if;
    if jsonb_typeof(v_section->'content') is distinct from 'string'
      or octet_length(v_section->>'content') > 1048576 then
      raise exception 'GUEST_IMPORT_SECTION_CONTENT_INVALID:%', v_section_id;
    end if;
    if jsonb_typeof(v_section->'status') is distinct from 'string'
      or (v_section->>'status') not in ('draft', 'edited', 'approved', 'locked') then
      raise exception 'GUEST_IMPORT_SECTION_STATUS_INVALID:%', v_section_id;
    end if;
    if jsonb_typeof(v_section->'version_history') is distinct from 'array'
      or octet_length((v_section->'version_history')::text) > 1048576 then
      raise exception 'GUEST_IMPORT_SECTION_HISTORY_INVALID:%', v_section_id;
    end if;
    if jsonb_typeof(v_section->'is_required') is distinct from 'boolean' then
      raise exception 'GUEST_IMPORT_SECTION_REQUIRED_INVALID:%', v_section_id;
    end if;
    if v_section ? 'created_at'
      and jsonb_typeof(v_section->'created_at') not in ('string', 'null') then
      raise exception 'GUEST_IMPORT_SECTION_TIMESTAMP_INVALID:%', v_section_id;
    end if;
    if v_section ? 'updated_at'
      and jsonb_typeof(v_section->'updated_at') not in ('string', 'null') then
      raise exception 'GUEST_IMPORT_SECTION_TIMESTAMP_INVALID:%', v_section_id;
    end if;

    if v_section ? 'document_id'
      and coalesce(v_section->>'document_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'GUEST_IMPORT_SECTION_DOCUMENT_INVALID:%', v_section_id;
    end if;
    if v_section ? 'document_id'
      and (v_section->>'document_id')::uuid <> p_document_id then
      raise exception 'GUEST_IMPORT_SECTION_DOCUMENT_MISMATCH:%', v_section_id;
    end if;
    if v_section ? 'user_id'
      and coalesce(v_section->>'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'GUEST_IMPORT_SECTION_OWNER_INVALID:%', v_section_id;
    end if;
    if v_section ? 'user_id'
      and (v_section->>'user_id')::uuid <> v_user_id then
      raise exception 'GUEST_IMPORT_SECTION_OWNER_MISMATCH:%', v_section_id;
    end if;

    begin
      v_created_at := case
        when nullif(v_section->>'created_at', '') is null then now()
        else (v_section->>'created_at')::timestamptz
      end;
      v_updated_at := case
        when nullif(v_section->>'updated_at', '') is null then v_created_at
        else (v_section->>'updated_at')::timestamptz
      end;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'GUEST_IMPORT_SECTION_TIMESTAMP_INVALID:%', v_section_id;
    end;

    if v_updated_at < v_created_at then
      raise exception 'GUEST_IMPORT_SECTION_TIMESTAMP_INVALID:%', v_section_id;
    end if;

    v_section_count := v_section_count + 1;
  end loop;

  v_request_payload := jsonb_build_object(
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'title', p_title,
    'situation_text', p_situation_text,
    'recommendation_payload', p_recommendation_payload,
    'template_id', p_template_id,
    'document_status', v_document_status,
    'sections', p_sections
  );
  v_request_sha256 := encode(
    extensions.digest(convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  -- A deterministic lock order prevents concurrent exact retries, mismatched
  -- replays, and owner-ID collisions from interleaving.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'guest-import-key:' || v_user_id::text || ':' || v_idempotency_key,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended('guest-import-outcome:' || p_outcome_id::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('guest-import-document:' || p_document_id::text, 0)
  );
  for v_section_id in
    select section_id
    from unnest(v_section_ids) section_id
    order by section_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('guest-import-section:' || v_section_id::text, 0)
    );
  end loop;

  select * into v_existing_import
  from private.guest_workspace_imports import_record
  where import_record.user_id = v_user_id
    and import_record.idempotency_key = v_idempotency_key;

  if found then
    if v_existing_import.request_sha256 <> v_request_sha256 then
      raise exception 'GUEST_IMPORT_IDEMPOTENCY_MISMATCH';
    end if;

    return jsonb_build_object(
      'status', 'committed',
      'outcome_id', v_existing_import.outcome_id,
      'document_id', v_existing_import.document_id,
      'idempotent_replay', true
    );
  end if;

  -- Template deletion or retirement after a successful import must not break
  -- an exact replay. New imports still require a currently valid FK target.
  if p_template_id is not null
    and not exists (
      select 1 from public.templates template_record
      where template_record.id = p_template_id
    ) then
    raise exception 'GUEST_IMPORT_TEMPLATE_NOT_FOUND:%', p_template_id;
  end if;

  -- Without a committed immutable receipt, ownership is not provenance. A
  -- caller-controlled ID must never turn this import boundary into an update
  -- or delete path for an existing document, including one owned by the same
  -- account. Historical partial imports require a separately reviewed
  -- reconciliation flow with stronger evidence.
  if exists (
    select 1 from public.outcomes outcome_record
    where outcome_record.id = p_outcome_id
  ) then
    raise exception 'GUEST_IMPORT_OUTCOME_ID_COLLISION:%', p_outcome_id;
  end if;

  if exists (
    select 1 from public.documents document_record
    where document_record.id = p_document_id
  ) then
    raise exception 'GUEST_IMPORT_DOCUMENT_ID_COLLISION:%', p_document_id;
  end if;

  if exists (
    select 1 from public.sections section_record
    where section_record.document_id = p_document_id
  ) then
    raise exception 'GUEST_IMPORT_DOCUMENT_SECTION_COLLISION:%', p_document_id;
  end if;

  for v_section_id in select unnest(v_section_ids)
  loop
    if exists (
      select 1 from public.sections section_record
      where section_record.id = v_section_id
    ) then
      raise exception 'GUEST_IMPORT_SECTION_ID_COLLISION:%', v_section_id;
    end if;
  end loop;

  insert into public.outcomes(
    id, user_id, situation_text, recommendation_payload, status, is_saved
  ) values (
    p_outcome_id, v_user_id, p_situation_text,
    p_recommendation_payload, 'in_progress', true
  );

  insert into public.documents(
    id, user_id, outcome_id, template_id, title, status, is_template
  ) values (
    p_document_id, v_user_id, p_outcome_id, p_template_id,
    p_title, v_document_status, false
  );

  for v_section in
    select section_record.value
    from jsonb_array_elements(p_sections) with ordinality as section_record(value, ordinality)
    order by section_record.ordinality
  loop
    v_created_at := case
      when nullif(v_section->>'created_at', '') is null then now()
      else (v_section->>'created_at')::timestamptz
    end;
    v_updated_at := case
      when nullif(v_section->>'updated_at', '') is null then v_created_at
      else (v_section->>'updated_at')::timestamptz
    end;

    insert into public.sections(
      id, document_id, user_id, name, order_index, content, status,
      version_history, is_required, created_at, updated_at
    ) values (
      (v_section->>'id')::uuid,
      p_document_id,
      v_user_id,
      v_section->>'name',
      (v_section->>'order_index')::integer,
      v_section->>'content',
      v_section->>'status',
      v_section->'version_history',
      (v_section->>'is_required')::boolean,
      v_created_at,
      v_updated_at
    );
  end loop;

  insert into private.guest_workspace_imports(
    user_id, idempotency_key, request_sha256, outcome_id, document_id,
    template_id, document_status, section_count
  ) values (
    v_user_id, v_idempotency_key, v_request_sha256, p_outcome_id,
    p_document_id, p_template_id, v_document_status, v_section_count
  );

  return jsonb_build_object(
    'status', 'committed',
    'outcome_id', p_outcome_id,
    'document_id', p_document_id,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.commit_guest_workspace_import(
  text, uuid, uuid, text, text, jsonb, uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.commit_guest_workspace_import(
  text, uuid, uuid, text, text, jsonb, uuid, text, jsonb
) to authenticated;

commit;
