-- Manual plans use the existing outcome/artifact graph. Checklist rows are a
-- compatibility projection; receipts contain identities, never another copy of
-- editable content. No historical or generated artifact is reclassified.

begin;

-- Generic writers previously accepted these values. Hold their table locks
-- through publication so none can introduce a reserved identity after this
-- inspection but before the new guards become visible. A collision requires
-- a reviewed data decision; never reinterpret or rewrite historical rows.
lock table public.outcomes in share row exclusive mode;
lock table public.ted_artifacts in share row exclusive mode;
lock table public.ted_artifact_versions in share row exclusive mode;

create function private.assert_manual_plan_namespace_available_v1()
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if exists (select 1 from public.outcomes where recommendation_payload ? 'manual_plan')
    or exists (select 1 from public.ted_artifacts
      where pipeline_version = 'manual-plan.1' or request_id like 'manual-plan.1:%')
    or exists (select 1 from public.ted_artifact_versions
      where snapshot->>'pipeline_version' = 'manual-plan.1'
        or snapshot->>'request_id' like 'manual-plan.1:%') then
    raise exception using errcode = '55000', message = 'MANUAL_PLAN_NAMESPACE_CONFLICT';
  end if;
end;
$function$;
revoke all on function private.assert_manual_plan_namespace_available_v1()
  from public, anon, authenticated, service_role;
select private.assert_manual_plan_namespace_available_v1();

create function private.manual_plan_timestamp_v1(p_value timestamptz)
returns text language sql immutable strict set search_path = ''
as $function$
  select pg_catalog.to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$function$;

create function private.manual_plan_keys_v1(p_value jsonb, p_keys text[])
returns boolean language plpgsql immutable set search_path = ''
as $function$
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  return coalesce((select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p_value) k)
    = (select pg_catalog.array_agg(k order by k) from pg_catalog.unnest(p_keys) k), false);
end;
$function$;

create function private.manual_plan_date_valid_v1(p_value text)
returns boolean language plpgsql immutable set search_path = ''
as $function$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or pg_catalog.left(p_value, 4) = '0000' then return false; end if;
  return pg_catalog.to_char(p_value::date, 'YYYY-MM-DD') = p_value;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$function$;

create function private.manual_plan_timestamp_valid_v1(p_value text)
returns boolean language plpgsql immutable set search_path = ''
as $function$
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    or not private.manual_plan_date_valid_v1(pg_catalog.left(p_value, 10)) then return false; end if;
  return private.manual_plan_timestamp_v1(p_value::timestamptz) = p_value;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$function$;

create function private.assert_manual_plan_owner_v1(p_owner uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $function$
begin
  if p_owner is null then
    raise exception using errcode = '28000', message = 'MANUAL_PLAN_AUTHENTICATION_REQUIRED';
  end if;
  -- Share the existing account-deletion lock and fence, before any row lock.
  perform private.assert_home_upload_owner_active_v1(p_owner);
  if not exists (select 1 from auth.users where id = p_owner) then
    raise exception using errcode = '28000', message = 'MANUAL_PLAN_AUTHENTICATION_REQUIRED';
  end if;
end;
$function$;

create function private.is_manual_plan_outcome_v1(p_outcome_id uuid)
returns boolean language sql volatile security definer set search_path = ''
as $function$
  select exists (select 1 from public.ted_artifacts a
    where a.outcome_id = p_outcome_id and a.pipeline_version = 'manual-plan.1')
    or exists (select 1 from public.outcomes o where o.id = p_outcome_id
      and o.recommendation_payload ? 'manual_plan');
$function$;

create table private.manual_plan_save_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  plan_id text not null check (plan_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  artifact_id uuid not null references public.ted_artifacts(id) on delete cascade,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  committed_revision integer not null check (committed_revision > 0),
  committed_updated_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, operation_id)
);
create index manual_plan_save_receipts_artifact_idx
  on private.manual_plan_save_receipts(artifact_id);
alter table private.manual_plan_save_receipts enable row level security;
revoke all on table private.manual_plan_save_receipts from public, anon, authenticated, service_role;

create function private.protect_manual_plan_receipt_v1()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' and (
    not exists (select 1 from auth.users where id = old.user_id)
    or not exists (select 1 from public.outcomes where id = old.outcome_id)
    or not exists (select 1 from public.ted_artifacts where id = old.artifact_id)
  ) then return old; end if;
  raise exception using errcode = '55000', message = 'MANUAL_PLAN_HISTORY_IMMUTABLE';
end;
$function$;
create trigger manual_plan_save_receipt_immutable
before update or delete on private.manual_plan_save_receipts
for each row execute function private.protect_manual_plan_receipt_v1();

-- Protect the owning outcome, including callers that can still update outcome
-- metadata directly. The initial marker is derived from an already inserted
-- artifact; a caller-supplied GUC cannot mint or move a manual outcome identity.
create function private.protect_manual_plan_outcome_v1()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_artifact public.ted_artifacts%rowtype;
  v_marker jsonb;
begin
  if tg_op = 'INSERT' then
    if new.recommendation_payload ? 'manual_plan' then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
    end if;
    return new;
  end if;
  select * into v_artifact from public.ted_artifacts
    where outcome_id = old.id and pipeline_version = 'manual-plan.1';
  if not found then
    if (old.recommendation_payload ? 'manual_plan') or (new.recommendation_payload ? 'manual_plan') then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
    end if;
    return new;
  end if;
  v_marker := pg_catalog.jsonb_build_object('manual_plan', pg_catalog.jsonb_build_object(
    'contract_version', 'manual-plan.1', 'plan_id', pg_catalog.substr(v_artifact.request_id, 15)));
  if old.recommendation_payload is null
    and new.recommendation_payload = v_marker
    and pg_catalog.current_setting('prompted.manual_plan_outcome', true) = old.id::text
    and auth.uid() = old.user_id
    and (pg_catalog.to_jsonb(new) - array['recommendation_payload','updated_at'])
      = (pg_catalog.to_jsonb(old) - array['recommendation_payload','updated_at']) then
    return new;
  end if;
  if new.recommendation_payload is distinct from v_marker
    or (pg_catalog.to_jsonb(new) - array['status','is_saved','updated_at'])
      is distinct from (pg_catalog.to_jsonb(old) - array['status','is_saved','updated_at']) then
    raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
  end if;
  return new;
end;
$function$;
create trigger protect_manual_plan_outcome
before insert or update on public.outcomes
for each row execute function private.protect_manual_plan_outcome_v1();

-- One sink guard covers generic save, completion, approval, ledger binding and
-- projection writers, including a different artifact taking over this outcome.
-- Existing RPCs cannot establish this command scope, and authenticated roles
-- have no direct write privileges on these graph tables.
create function private.protect_manual_plan_graph_v1()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then pg_catalog.to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then pg_catalog.to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_old_outcome uuid;
  v_new_outcome uuid;
  v_artifact public.ted_artifacts%rowtype;
  v_manual boolean := false;
  v_owner uuid := (v_row->>'user_id')::uuid;
  v_scope text := pg_catalog.current_setting('prompted.manual_plan_outcome', true);
begin
  if tg_table_name in ('ted_artifacts', 'checklist_items') then
    v_old_outcome := (v_old->>'outcome_id')::uuid;
    v_new_outcome := (v_new->>'outcome_id')::uuid;
  else
    select outcome_id into v_old_outcome from public.ted_artifacts where id = (v_old->>'artifact_id')::uuid;
    select * into v_artifact from public.ted_artifacts where id = (v_row->>'artifact_id')::uuid;
    v_new_outcome := v_artifact.outcome_id;
  end if;
  v_manual := private.is_manual_plan_outcome_v1(v_old_outcome)
    or private.is_manual_plan_outcome_v1(v_new_outcome)
    or coalesce(v_old->>'pipeline_version' = 'manual-plan.1', false)
    or coalesce(v_new->>'pipeline_version' = 'manual-plan.1', false)
    or coalesce(v_old->>'request_id' like 'manual-plan.1:%', false)
    or coalesce(v_new->>'request_id' like 'manual-plan.1:%', false)
    or coalesce(v_old->'snapshot'->>'pipeline_version' = 'manual-plan.1', false)
    or coalesce(v_new->'snapshot'->>'pipeline_version' = 'manual-plan.1', false);
  if tg_table_name = 'ted_artifact_references' and exists (
    select 1 from public.ted_artifact_blocks b join public.ted_artifacts a on a.id = b.artifact_id
    where b.id in ((v_old->>'block_id')::uuid, (v_new->>'block_id')::uuid)
      and a.pipeline_version = 'manual-plan.1'
  ) then v_manual := true; end if;
  if tg_table_name = 'ted_artifact_blocks' and tg_op <> 'DELETE'
    and v_new->>'parent_block_id' is distinct from v_old->>'parent_block_id'
    and exists (select 1 from public.ted_artifact_blocks parent_block
      join public.ted_artifacts parent_artifact on parent_artifact.id = parent_block.artifact_id
      where parent_block.id = (v_new->>'parent_block_id')::uuid
        and private.is_manual_plan_outcome_v1(parent_artifact.outcome_id)) then
    raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
  end if;
  -- Real parent/account cascades remove the parent before its children. Direct
  -- deletion of a still-live manual graph or version does not get this escape.
  if tg_op = 'DELETE' and (
    not exists (select 1 from auth.users where id = v_owner)
    or (tg_table_name in ('ted_artifacts', 'checklist_items')
      and not exists (select 1 from public.outcomes where id = v_old_outcome))
    or (tg_table_name not in ('ted_artifacts', 'checklist_items') and (
      not exists (select 1 from public.ted_artifacts where id = (v_old->>'artifact_id')::uuid)
      or not exists (select 1 from public.outcomes where id = v_old_outcome)))
  ) then return old; end if;
  if not v_manual then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'ted_artifact_versions' and tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'MANUAL_PLAN_HISTORY_IMMUTABLE';
  end if;
  if tg_table_name = 'ted_artifact_references'
    or v_scope is distinct from coalesce(v_new_outcome, v_old_outcome)::text
    or auth.uid() is distinct from v_owner
    or (tg_op = 'UPDATE' and (
      v_old->>'id' is distinct from v_new->>'id'
      or v_old->>'user_id' is distinct from v_new->>'user_id'
      or v_old_outcome is distinct from v_new_outcome
      or v_old->>'artifact_id' is distinct from v_new->>'artifact_id')) then
    raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
  end if;
  if tg_op = 'DELETE' then
    if tg_table_name = 'checklist_items' then
      if exists (select 1 from public.ted_artifact_blocks b join public.ted_artifacts a on a.id = b.artifact_id
        where b.id = old.id and a.outcome_id = old.outcome_id and a.pipeline_version = 'manual-plan.1') then
        raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
      end if;
    end if;
    return old;
  end if;
  if tg_table_name = 'ted_artifacts' then
    if new.pipeline_version <> 'manual-plan.1' or new.kind <> 'action_plan'
      or new.request_id is null or new.request_id !~ '^manual-plan\.1:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      or new.status <> 'draft' or new.quality_status <> 'pending'
      or new.ledger_binding_status <> 'legacy_unversioned'
      or new.template_id is not null or new.ledger_template_id is not null
      or new.ledger_version is not null or new.benchmark_version is not null
      or new.generation_snapshot_id is not null or new.approved_revision is not null
      or not exists (select 1 from public.outcomes where id = new.outcome_id and user_id = new.user_id)
      or exists (select 1 from public.ted_artifacts where outcome_id = new.outcome_id and id <> new.id)
      or exists (select 1 from public.documents where outcome_id = new.outcome_id)
      or (tg_op = 'UPDATE' and (new.request_id is distinct from old.request_id
        or new.pipeline_version is distinct from old.pipeline_version
        or new.created_at is distinct from old.created_at)) then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
    end if;
  elsif tg_table_name = 'ted_artifact_blocks' then
    if new.kind <> 'action' or new.parent_block_id is not null
      or new.approval_status <> 'draft' or new.ledger_binding_status <> 'legacy_unversioned'
      or new.ledger_section_key is not null or new.ledger_version is not null
      or new.is_required is not null or new.section_state is not null or new.approved_revision is not null
      or new.source_block_id is not null or new.source_section_key is not null or new.transformation_version is not null
      or new.user_id is distinct from v_artifact.user_id
      or new.id <> extensions.uuid_generate_v5(new.artifact_id, new.stable_key)
      or not private.manual_plan_keys_v1(new.payload, array['contract_version','text','notes'])
      or new.payload->>'contract_version' is distinct from 'manual-plan-action.1'
      or pg_catalog.jsonb_typeof(new.payload->'text') is distinct from 'string'
      or pg_catalog.jsonb_typeof(new.payload->'notes') is distinct from 'string'
      or (tg_op = 'UPDATE' and new.stable_key is distinct from old.stable_key) then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
    end if;
  elsif tg_table_name = 'ted_artifact_versions' then
    if new.user_id is distinct from v_artifact.user_id
      or new.revision <> v_artifact.current_revision
      or new.snapshot->>'pipeline_version' is distinct from 'manual-plan.1' then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_HISTORY_IMMUTABLE';
    end if;
  elsif tg_table_name = 'checklist_items' then
    if not exists (select 1 from public.ted_artifact_blocks b
      join public.ted_artifacts a on a.id = b.artifact_id and a.user_id = b.user_id
      where b.id = new.id and b.user_id = new.user_id and a.outcome_id = new.outcome_id
        and a.pipeline_version = 'manual-plan.1'
        and new.text = b.heading || pg_catalog.chr(9247) || (b.payload->>'text')
        and new.reason is not distinct from b.payload->>'notes'
        and new.due_date is not distinct from b.due_date
        and new.done = (b.completed_at is not null) and new.order_index = b.order_index) then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
    end if;
  end if;
  return new;
end;
$function$;
create trigger protect_manual_plan_artifact before insert or update or delete on public.ted_artifacts
for each row execute function private.protect_manual_plan_graph_v1();
create trigger protect_manual_plan_block before insert or update or delete on public.ted_artifact_blocks
for each row execute function private.protect_manual_plan_graph_v1();
create trigger protect_manual_plan_reference before insert or update or delete on public.ted_artifact_references
for each row execute function private.protect_manual_plan_graph_v1();
create trigger protect_manual_plan_version before insert or update or delete on public.ted_artifact_versions
for each row execute function private.protect_manual_plan_graph_v1();
create trigger protect_manual_plan_projection before insert or update or delete on public.checklist_items
for each row execute function private.protect_manual_plan_graph_v1();

create function private.protect_manual_plan_document_link_v1()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and new.outcome_id is not distinct from old.outcome_id then return new; end if;
  -- Lock before inspection so a concurrent graph publication cannot be missed.
  perform 1 from public.outcomes where id = new.outcome_id for update;
  if private.is_manual_plan_outcome_v1(new.outcome_id) then
    raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
  end if;
  return new;
end;
$function$;
create trigger protect_manual_plan_document_link before insert or update of outcome_id on public.documents
for each row execute function private.protect_manual_plan_document_link_v1();

create function private.manual_plan_snapshot_v1(p_artifact_id uuid, p_owner uuid)
returns jsonb language sql stable security definer set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'contract_version', 'manual-plan.1', 'owner_id', a.user_id,
    'plan_id', pg_catalog.substr(a.request_id, 15), 'outcome_id', a.outcome_id,
    'artifact_id', a.id, 'revision', a.current_revision,
    'created_at', private.manual_plan_timestamp_v1(a.created_at),
    'updated_at', private.manual_plan_timestamp_v1(o.updated_at), 'title', a.title,
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', b.stable_key, 'section', b.heading, 'text', b.payload->>'text', 'notes', b.payload->>'notes',
      'due_date', pg_catalog.to_char(b.due_date, 'YYYY-MM-DD'), 'done', b.completed_at is not null
    ) order by b.order_index, b.id), '[]'::jsonb) from public.ted_artifact_blocks b
      where b.artifact_id = a.id and b.user_id = a.user_id)
  ) from public.ted_artifacts a join public.outcomes o on o.id = a.outcome_id and o.user_id = a.user_id
  where a.id = p_artifact_id and a.user_id = p_owner and a.pipeline_version = 'manual-plan.1';
$function$;

create function public.get_own_manual_plan_v1(p_plan_id text default null, p_outcome_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_owner uuid := auth.uid(); v_result jsonb;
begin
  perform private.assert_manual_plan_owner_v1(v_owner);
  if (p_plan_id is null) = (p_outcome_id is null)
    or (p_plan_id is not null and p_plan_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') then
    raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
  end if;
  select pg_catalog.jsonb_build_object('contract_version', 'manual-plan-read.1', 'owner_id', v_owner,
    'plan', (select private.manual_plan_snapshot_v1(a.id, v_owner) from public.ted_artifacts a
      where a.user_id = v_owner and a.pipeline_version = 'manual-plan.1'
        and ((p_plan_id is not null and a.request_id = 'manual-plan.1:' || p_plan_id)
          or (p_outcome_id is not null and a.outcome_id = p_outcome_id)))) into v_result;
  return v_result;
end;
$function$;

create function public.list_own_manual_plans_v1(p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_owner uuid := auth.uid(); v_result jsonb;
begin
  perform private.assert_manual_plan_owner_v1(v_owner);
  if p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
  end if;
  with page as materialized (
    select a.*, o.updated_at as aggregate_updated_at
    from public.ted_artifacts a join public.outcomes o on o.id = a.outcome_id and o.user_id = a.user_id
    where a.user_id = v_owner and a.pipeline_version = 'manual-plan.1'
    order by o.updated_at desc, a.id asc limit (p_limit + 1) offset p_offset
  ), visible as (
    select * from page order by aggregate_updated_at desc, id asc limit p_limit
  ) select pg_catalog.jsonb_build_object(
    'contract_version', 'manual-plan-list.1', 'owner_id', v_owner,
    'has_more', (select pg_catalog.count(*) > p_limit from page),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'owner_id', a.user_id, 'plan_id', pg_catalog.substr(a.request_id, 15),
      'outcome_id', a.outcome_id, 'artifact_id', a.id, 'title', a.title, 'revision', a.current_revision,
      'updated_at', private.manual_plan_timestamp_v1(a.aggregate_updated_at),
      'item_count', counts.item_count, 'completed_count', counts.completed_count,
      'next_due_date', pg_catalog.to_char(counts.next_due_date, 'YYYY-MM-DD')
    ) order by a.aggregate_updated_at desc, a.id asc)
      from visible a cross join lateral (select pg_catalog.count(*) as item_count,
        pg_catalog.count(*) filter (where b.completed_at is not null) as completed_count,
        pg_catalog.min(b.due_date) filter (where b.completed_at is null) as next_due_date
        from public.ted_artifact_blocks b where b.artifact_id = a.id and b.user_id = v_owner) counts
    ), '[]'::jsonb)) into v_result;
  return v_result;
end;
$function$;

create function public.save_own_manual_plan_v1(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_owner uuid := auth.uid();
  v_operation uuid;
  v_plan text;
  v_hash text;
  v_expected jsonb;
  v_item jsonb;
  v_position bigint;
  v_artifact public.ted_artifacts%rowtype;
  v_block public.ted_artifact_blocks%rowtype;
  v_receipt private.manual_plan_save_receipts%rowtype;
  v_outcome uuid;
  v_artifact_id uuid;
  v_block_id uuid;
  v_revision integer;
  v_next_block_revision bigint;
  v_completed_at timestamptz;
  v_due_date date;
  v_payload jsonb;
  v_snapshot jsonb;
  v_status text;
  v_previous_scope text := pg_catalog.current_setting('prompted.manual_plan_outcome', true);
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  perform private.assert_manual_plan_owner_v1(v_owner);
  if not private.manual_plan_keys_v1(p_command, array['contract_version','operation_id','plan_id','expected','title','items'])
    or pg_catalog.octet_length(p_command::text) > 1048576
    or p_command->>'contract_version' is distinct from 'manual-plan-save.1'
    or pg_catalog.jsonb_typeof(p_command->'operation_id') is distinct from 'string'
    or (p_command->>'operation_id') !~ v_uuid_pattern
    or pg_catalog.jsonb_typeof(p_command->'plan_id') is distinct from 'string'
    or (p_command->>'plan_id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    or pg_catalog.jsonb_typeof(p_command->'title') is distinct from 'string'
    or pg_catalog.char_length(p_command->>'title') > 500
    or pg_catalog.jsonb_typeof(p_command->'items') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(p_command->'items') not between 1 and 200 then
    raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_command->'items') loop
    if not private.manual_plan_keys_v1(v_item, array['id','section','text','notes','due_date','done'])
      or pg_catalog.jsonb_typeof(v_item->'id') is distinct from 'string'
      or (v_item->>'id') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      or pg_catalog.jsonb_typeof(v_item->'section') is distinct from 'string'
      or pg_catalog.char_length(v_item->>'section') > 500
      or pg_catalog.jsonb_typeof(v_item->'text') is distinct from 'string'
      or pg_catalog.char_length(v_item->>'text') > 20000
      or pg_catalog.jsonb_typeof(v_item->'notes') is distinct from 'string'
      or pg_catalog.char_length(v_item->>'notes') > 10000
      or pg_catalog.jsonb_typeof(v_item->'done') is distinct from 'boolean'
      or (v_item->'due_date' <> 'null'::jsonb and (
        pg_catalog.jsonb_typeof(v_item->'due_date') is distinct from 'string'
        or not private.manual_plan_date_valid_v1(v_item->>'due_date'))) then
      raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
    end if;
  end loop;
  if (select pg_catalog.count(*) <> pg_catalog.count(distinct item->>'id')
    from pg_catalog.jsonb_array_elements(p_command->'items') item) then
    raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
  end if;
  -- jsonb cannot represent a NUL character; PostgreSQL rejects it before entry.
  v_expected := p_command->'expected';
  if v_expected <> 'null'::jsonb then
    if not private.manual_plan_keys_v1(v_expected, array['outcome_id','artifact_id','revision','updated_at'])
      or pg_catalog.jsonb_typeof(v_expected->'outcome_id') is distinct from 'string'
      or (v_expected->>'outcome_id') !~ v_uuid_pattern
      or pg_catalog.jsonb_typeof(v_expected->'artifact_id') is distinct from 'string'
      or (v_expected->>'artifact_id') !~ v_uuid_pattern
      or pg_catalog.jsonb_typeof(v_expected->'revision') is distinct from 'number'
      or pg_catalog.jsonb_typeof(v_expected->'updated_at') is distinct from 'string'
      or not private.manual_plan_timestamp_valid_v1(v_expected->>'updated_at') then
      raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
    end if;
    if (v_expected->>'revision')::numeric not between 1 and 9007199254740991
      or (v_expected->>'revision')::numeric <> pg_catalog.trunc((v_expected->>'revision')::numeric) then
      raise exception using errcode = '22023', message = 'MANUAL_PLAN_INPUT_INVALID';
    end if;
  end if;
  v_operation := (p_command->>'operation_id')::uuid;
  v_plan := p_command->>'plan_id';
  v_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('owner_id', v_owner, 'command', p_command)::text, 'UTF8'), 'sha256'), 'hex');
  select * into v_receipt from private.manual_plan_save_receipts
    where user_id = v_owner and operation_id = v_operation;
  if found and v_receipt.request_sha256 <> v_hash then
    raise exception using errcode = '23505', message = 'MANUAL_PLAN_OPERATION_CONFLICT';
  end if;
  select * into v_artifact from public.ted_artifacts
    where user_id = v_owner and request_id = 'manual-plan.1:' || v_plan;
  if found then
    if v_artifact.pipeline_version <> 'manual-plan.1' then
      raise exception using errcode = '23505', message = 'MANUAL_PLAN_SOURCE_CONFLICT';
    end if;
    v_outcome := v_artifact.outcome_id;
    v_artifact_id := v_artifact.id;
    perform 1 from public.outcomes where id = v_outcome and user_id = v_owner for update;
    if not found then raise exception using errcode = '42501', message = 'MANUAL_PLAN_NOT_FOUND'; end if;
    select * into v_artifact from public.ted_artifacts where id = v_artifact_id and user_id = v_owner for update;
    if not found then raise exception using errcode = '42501', message = 'MANUAL_PLAN_NOT_FOUND'; end if;
    perform 1 from public.ted_artifact_blocks where artifact_id = v_artifact_id order by id for update;
    v_snapshot := private.manual_plan_snapshot_v1(v_artifact_id, v_owner);
  end if;
  if v_receipt.operation_id is not null then
    if v_snapshot is null or v_receipt.artifact_id is distinct from v_artifact_id
      or v_receipt.outcome_id is distinct from v_outcome or v_receipt.plan_id <> v_plan then
      raise exception using errcode = '42501', message = 'MANUAL_PLAN_NOT_FOUND';
    end if;
    if v_artifact.current_revision = v_receipt.committed_revision
      and (v_snapshot->>'updated_at')::timestamptz = v_receipt.committed_updated_at then
      v_status := 'replayed';
    elsif v_artifact.current_revision >= v_receipt.committed_revision
      and (v_snapshot->>'updated_at')::timestamptz > v_receipt.committed_updated_at then
      v_status := 'superseded';
    else
      raise exception using errcode = '40001', message = 'MANUAL_PLAN_VERSION_CONFLICT';
    end if;
  else
    if v_expected = 'null'::jsonb then
      if v_artifact_id is not null then
        raise exception using errcode = '23505', message = 'MANUAL_PLAN_SOURCE_CONFLICT';
      end if;
      v_outcome := pg_catalog.gen_random_uuid();
      v_artifact_id := pg_catalog.gen_random_uuid();
      v_revision := 1;
    else
      if v_artifact_id is null then raise exception using errcode = '42501', message = 'MANUAL_PLAN_NOT_FOUND'; end if;
      if v_expected->>'outcome_id' <> v_outcome::text or v_expected->>'artifact_id' <> v_artifact_id::text
        or (v_expected->>'revision')::numeric <> v_artifact.current_revision
        or v_expected->>'updated_at' <> v_snapshot->>'updated_at'
        or v_artifact.current_revision = 2147483647 then
        raise exception using errcode = '40001', message = 'MANUAL_PLAN_VERSION_CONFLICT';
      end if;
      v_revision := v_artifact.current_revision + 1;
    end if;
    perform pg_catalog.set_config('prompted.manual_plan_outcome', v_outcome::text, true);
    if v_expected = 'null'::jsonb then
      insert into public.outcomes(id, user_id, situation_text, status, is_saved)
        values (v_outcome, v_owner, 'Manual action plan', 'draft', true);
      insert into public.ted_artifacts(id, outcome_id, user_id, kind, title, pipeline_version, request_id)
        values (v_artifact_id, v_outcome, v_owner, 'action_plan', p_command->>'title', 'manual-plan.1', 'manual-plan.1:' || v_plan);
      update public.outcomes set recommendation_payload = pg_catalog.jsonb_build_object(
        'manual_plan', pg_catalog.jsonb_build_object('contract_version', 'manual-plan.1', 'plan_id', v_plan))
        where id = v_outcome and user_id = v_owner;
    end if;
    if exists (select 1 from public.ted_artifact_blocks removed
      join public.ted_artifact_blocks dependent
        on dependent.source_block_id = removed.id or dependent.parent_block_id = removed.id
      where removed.artifact_id = v_artifact_id
        and not exists (select 1 from pg_catalog.jsonb_array_elements(p_command->'items') item where item->>'id' = removed.stable_key)) then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_ITEM_REMOVAL_BLOCKED';
    end if;
    begin
      delete from public.ted_artifact_blocks b where b.artifact_id = v_artifact_id and b.user_id = v_owner
        and not exists (select 1 from pg_catalog.jsonb_array_elements(p_command->'items') item where item->>'id' = b.stable_key);
    exception when foreign_key_violation then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_ITEM_REMOVAL_BLOCKED';
    end;
    for v_item, v_position in select value, ordinality from pg_catalog.jsonb_array_elements(p_command->'items') with ordinality loop
      v_block_id := extensions.uuid_generate_v5(v_artifact_id, v_item->>'id');
      v_due_date := (v_item->>'due_date')::date;
      v_payload := pg_catalog.jsonb_build_object('contract_version', 'manual-plan-action.1', 'text', v_item->>'text', 'notes', v_item->>'notes');
      select * into v_block from public.ted_artifact_blocks where id = v_block_id;
      if found and (v_block.artifact_id <> v_artifact_id or v_block.user_id <> v_owner or v_block.stable_key <> v_item->>'id') then
        raise exception using errcode = '23505', message = 'MANUAL_PLAN_SOURCE_CONFLICT';
      end if;
      v_completed_at := case when (v_item->>'done')::boolean then coalesce(v_block.completed_at, clock_timestamp()) end;
      if v_block.id is null then
        select coalesce(pg_catalog.max((historical_block->>'revision')::bigint), 0) + 1 into v_next_block_revision
          from public.ted_artifact_versions version_record
          cross join lateral pg_catalog.jsonb_array_elements(version_record.snapshot->'blocks') historical_block
          where version_record.artifact_id = v_artifact_id and version_record.user_id = v_owner
            and historical_block->>'id' = v_block_id::text;
        if v_next_block_revision > 2147483647 then
          raise exception using errcode = '40001', message = 'MANUAL_PLAN_VERSION_CONFLICT';
        end if;
        insert into public.ted_artifact_blocks(id, artifact_id, user_id, kind, stable_key, heading, order_index,
          payload, due_date, completed_at, revision)
          values (v_block_id, v_artifact_id, v_owner, 'action', v_item->>'id', v_item->>'section',
            (v_position - 1)::integer, v_payload, v_due_date, v_completed_at, v_next_block_revision::integer);
      elsif (v_block.heading, v_block.order_index, v_block.payload, v_block.due_date, v_block.completed_at)
        is distinct from (v_item->>'section', (v_position - 1)::integer, v_payload, v_due_date, v_completed_at) then
        if v_block.revision = 2147483647 then
          raise exception using errcode = '40001', message = 'MANUAL_PLAN_VERSION_CONFLICT';
        end if;
        update public.ted_artifact_blocks set heading = v_item->>'section', order_index = (v_position - 1)::integer,
          payload = v_payload, due_date = v_due_date, completed_at = v_completed_at,
          revision = revision + 1, updated_at = clock_timestamp()
          where id = v_block_id and artifact_id = v_artifact_id and user_id = v_owner;
      end if;
      if exists (select 1 from public.checklist_items where id = v_block_id and (user_id <> v_owner or outcome_id <> v_outcome)) then
        raise exception using errcode = '23505', message = 'MANUAL_PLAN_SOURCE_CONFLICT';
      end if;
      insert into public.checklist_items(id, outcome_id, user_id, text, reason, due_date, done, order_index)
        values (v_block_id, v_outcome, v_owner, (v_item->>'section') || pg_catalog.chr(9247) || (v_item->>'text'),
          v_item->>'notes', v_due_date, (v_item->>'done')::boolean, (v_position - 1)::integer)
      on conflict (id) do update set text = excluded.text, reason = excluded.reason, due_date = excluded.due_date,
        done = excluded.done, order_index = excluded.order_index, updated_at = clock_timestamp()
      where (public.checklist_items.text, public.checklist_items.reason, public.checklist_items.due_date,
        public.checklist_items.done, public.checklist_items.order_index)
        is distinct from (excluded.text, excluded.reason, excluded.due_date, excluded.done, excluded.order_index);
    end loop;
    delete from public.checklist_items c where c.outcome_id = v_outcome and c.user_id = v_owner
      and not exists (select 1 from public.ted_artifact_blocks b where b.id = c.id and b.artifact_id = v_artifact_id);
    if v_expected <> 'null'::jsonb then
      update public.ted_artifacts set title = p_command->>'title', current_revision = v_revision, updated_at = clock_timestamp()
        where id = v_artifact_id and user_id = v_owner;
    end if;
    -- Read only after all checklist statement triggers, including the title-only
    -- case. The existing monotonic outcome trigger preserves microsecond CAS.
    update public.outcomes set updated_at = updated_at where id = v_outcome and user_id = v_owner;
    perform private.capture_ted_artifact_revision(v_artifact_id);
    v_snapshot := private.manual_plan_snapshot_v1(v_artifact_id, v_owner);
    insert into private.manual_plan_save_receipts(user_id, operation_id, plan_id, outcome_id, artifact_id,
      request_sha256, committed_revision, committed_updated_at)
      values (v_owner, v_operation, v_plan, v_outcome, v_artifact_id, v_hash, v_revision, (v_snapshot->>'updated_at')::timestamptz)
      returning * into v_receipt;
    perform pg_catalog.set_config('prompted.manual_plan_outcome', coalesce(v_previous_scope, ''), true);
    v_status := 'saved';
  end if;
  return pg_catalog.jsonb_build_object('contract_version', 'manual-plan-save.1', 'owner_id', v_owner,
    'operation_id', v_operation, 'request_sha256', v_hash, 'status', v_status,
    'committed', pg_catalog.jsonb_build_object('outcome_id', v_receipt.outcome_id, 'artifact_id', v_receipt.artifact_id,
      'revision', v_receipt.committed_revision, 'updated_at', private.manual_plan_timestamp_v1(v_receipt.committed_updated_at)),
    'snapshot', v_snapshot);
end;
$function$;

-- Preserve the generated compatibility implementation, but reject manual
-- identities before its create-or-replay early return can claim success.
alter function public.save_ted_artifact(jsonb, jsonb) rename to save_ted_artifact_before_manual_plan_v1;
alter function public.save_ted_artifact_before_manual_plan_v1(jsonb, jsonb) set schema private;
revoke all on function private.save_ted_artifact_before_manual_plan_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
create function public.save_ted_artifact(p_artifact jsonb, p_blocks jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare v_owner uuid := auth.uid(); v_outcome uuid; v_artifact uuid;
begin
  if v_owner is null then raise exception using errcode = '28000', message = 'authentication required'; end if;
  if pg_catalog.jsonb_typeof(p_artifact) = 'object' then
    begin
      v_outcome := nullif(p_artifact->>'outcome_id', '')::uuid;
      v_artifact := nullif(p_artifact->>'id', '')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'ARTIFACT_IDENTITY_INVALID';
    end;
    if p_artifact->>'pipeline_version' = 'manual-plan.1' or p_artifact->>'request_id' like 'manual-plan.1:%'
      or exists (select 1 from public.outcomes where id = v_outcome and user_id = v_owner
        and private.is_manual_plan_outcome_v1(id))
      or exists (select 1 from public.ted_artifacts where id = v_artifact and user_id = v_owner
        and pipeline_version = 'manual-plan.1') then
      raise exception using errcode = '55000', message = 'MANUAL_PLAN_COMMAND_REQUIRED';
    end if;
  end if;
  return private.save_ted_artifact_before_manual_plan_v1(p_artifact, p_blocks);
end;
$function$;

revoke all on function private.manual_plan_timestamp_v1(timestamptz),
  private.manual_plan_keys_v1(jsonb, text[]), private.manual_plan_date_valid_v1(text),
  private.manual_plan_timestamp_valid_v1(text), private.assert_manual_plan_owner_v1(uuid),
  private.is_manual_plan_outcome_v1(uuid), private.protect_manual_plan_receipt_v1(),
  private.protect_manual_plan_outcome_v1(), private.protect_manual_plan_graph_v1(),
  private.protect_manual_plan_document_link_v1(), private.manual_plan_snapshot_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.save_own_manual_plan_v1(jsonb),
  public.get_own_manual_plan_v1(text, uuid), public.list_own_manual_plans_v1(integer, integer),
  public.save_ted_artifact(jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_own_manual_plan_v1(jsonb),
  public.get_own_manual_plan_v1(text, uuid), public.list_own_manual_plans_v1(integer, integer),
  public.save_ted_artifact(jsonb, jsonb) to authenticated;

commit;
