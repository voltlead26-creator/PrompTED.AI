-- Make the browser-facing Data API boundary explicit.
--
-- RLS decides which rows an authenticated user may access; table privileges
-- decide which operations can reach those policies at all. Earlier migrations
-- created several RLS-protected tables without explicit grants, leaving a
-- fresh project unable to serve the progressively rendered workspace. Keep
-- each grant aligned with the operations the current web client actually uses.

begin;

-- Converge every public relation before granting the reviewed Data API
-- surface.  RLS cannot protect TRUNCATE and earlier migrations granted
-- REFERENCES/TRIGGER on several tables through broad schema defaults.
revoke all on all tables in schema public from anon, authenticated;

grant select on table
  public.brand_kits,
  public.businesses,
  public.checklist_items,
  public.documents,
  public.outcomes,
  public.profile_resume_versions,
  public.profiles,
  public.role_action_items,
  public.role_outcomes,
  public.saved_roles,
  public.sections,
  public.subscriptions,
  public.ted_artifact_blocks,
  public.ted_artifact_references,
  public.ted_artifacts,
  public.usage_ledger
to authenticated;

grant insert, update on table
  public.brand_kits,
  public.documents,
  public.outcomes,
  public.saved_roles,
  public.sections
to authenticated;

grant update on table
  public.businesses
to authenticated;

grant insert, update, delete on table
  public.checklist_items
to authenticated;

grant insert, update on table
  public.role_action_items
to authenticated;

grant insert on table
  public.role_outcomes
to authenticated;

-- Capture immutable artifact history exclusively from authoritative persisted
-- rows. References are nested beneath their owning block in a deterministic
-- order so provenance remains complete without admitting caller-only keys.
create or replace function private.capture_ted_artifact_revision(
  p_artifact_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
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

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(block_record)
        || pg_catalog.jsonb_build_object(
          'references',
          coalesce(
            (
              select pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(reference_record)
                order by reference_record.created_at, reference_record.id
              )
              from public.ted_artifact_references reference_record
              where reference_record.artifact_id = block_record.artifact_id
                and reference_record.block_id = block_record.id
                and reference_record.user_id = block_record.user_id
            ),
            '[]'::jsonb
          )
        )
      order by block_record.order_index, block_record.id
    ),
    '[]'::jsonb
  ) into v_blocks
  from public.ted_artifact_blocks block_record
  where block_record.artifact_id = p_artifact_id
    and block_record.user_id = v_artifact.user_id;

  insert into public.ted_artifact_versions(
    artifact_id,
    user_id,
    revision,
    snapshot
  ) values (
    v_artifact.id,
    v_artifact.user_id,
    v_artifact.current_revision,
    pg_catalog.to_jsonb(v_artifact)
      || pg_catalog.jsonb_build_object('blocks', v_blocks)
  );
end;
$function$;

-- Artifact versions are append-only audit records.  The authenticated save
-- command is the only browser boundary that may capture one; callers must not
-- be able to forge or read snapshots through direct table access.
create or replace function public.save_ted_artifact(
  p_artifact jsonb,
  p_blocks jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_artifact_id uuid := coalesce(
    nullif(p_artifact->>'id', '')::uuid,
    extensions.uuid_generate_v4()
  );
  v_existing_id uuid;
  v_existing_owner uuid;
  v_persisted_id uuid;
  v_prior_blocks jsonb;
  v_prior_block jsonb;
  v_block jsonb;
  v_block_id uuid;
  v_reference jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;
  if pg_catalog.jsonb_typeof(p_artifact) is distinct from 'object' then
    raise exception 'artifact must be an object';
  end if;
  if pg_catalog.jsonb_typeof(p_blocks) is distinct from 'array' then
    raise exception 'blocks must be an array';
  end if;
  if not exists (
    select 1
    from public.outcomes
    where id = (p_artifact->>'outcome_id')::uuid
      and user_id = v_user_id
  ) then
    raise exception 'outcome not found';
  end if;

  -- Preserve the stable owner-scoped replay behavior before considering the
  -- caller-supplied artifact ID.
  if nullif(p_artifact->>'request_id', '') is not null then
    select id into v_existing_id
    from public.ted_artifacts
    where user_id = v_user_id
      and request_id = p_artifact->>'request_id';
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  -- SECURITY DEFINER bypasses RLS.  Lock and reject a foreign existing ID
  -- before any child or version write so an ON CONFLICT no-op cannot continue
  -- into another tenant's artifact graph.
  select user_id into v_existing_owner
  from public.ted_artifacts
  where id = v_artifact_id
  for update;
  if found and v_existing_owner <> v_user_id then
    raise exception 'artifact not found';
  end if;

  insert into public.ted_artifacts (
    id,
    outcome_id,
    user_id,
    kind,
    title,
    template_id,
    schema_version,
    pipeline_version,
    status,
    quality_status,
    current_revision,
    request_id,
    updated_at
  ) values (
    v_artifact_id,
    (p_artifact->>'outcome_id')::uuid,
    v_user_id,
    p_artifact->>'kind',
    p_artifact->>'title',
    nullif(p_artifact->>'template_id', ''),
    coalesce((p_artifact->>'schema_version')::integer, 2),
    coalesce(nullif(p_artifact->>'pipeline_version', ''), 'ted-v2'),
    coalesce(nullif(p_artifact->>'status', ''), 'ready'),
    coalesce(nullif(p_artifact->>'quality_status', ''), 'passed'),
    1,
    nullif(p_artifact->>'request_id', ''),
    pg_catalog.now()
  ) on conflict (id) do update set
    title = excluded.title,
    status = excluded.status,
    quality_status = excluded.quality_status,
    current_revision = public.ted_artifacts.current_revision + 1,
    updated_at = pg_catalog.now()
  where public.ted_artifacts.user_id = v_user_id
  returning id into v_persisted_id;

  if v_persisted_id is null then
    raise exception 'artifact not found';
  end if;

  select coalesce(
    pg_catalog.jsonb_object_agg(
      stable_key,
      pg_catalog.jsonb_build_object('id', id, 'revision', revision)
    ),
    '{}'::jsonb
  ) into v_prior_blocks
  from public.ted_artifact_blocks
  where artifact_id = v_artifact_id
    and user_id = v_user_id;

  delete from public.ted_artifact_blocks
  where artifact_id = v_artifact_id
    and user_id = v_user_id;

  for v_block in
    select value from pg_catalog.jsonb_array_elements(p_blocks)
  loop
    v_prior_block := v_prior_blocks->(v_block->>'stable_key');
    v_block_id := coalesce(
      nullif(v_prior_block->>'id', '')::uuid,
      nullif(v_block->>'id', '')::uuid,
      extensions.uuid_generate_v4()
    );
    insert into public.ted_artifact_blocks (
      id,
      artifact_id,
      user_id,
      kind,
      stable_key,
      heading,
      order_index,
      payload,
      approval_status,
      completed_at,
      due_date,
      revision
    ) values (
      v_block_id,
      v_artifact_id,
      v_user_id,
      v_block->>'kind',
      v_block->>'stable_key',
      coalesce(v_block->>'heading', ''),
      coalesce((v_block->>'order_index')::integer, 0),
      coalesce(v_block->'payload', '{}'::jsonb),
      'draft',
      nullif(v_block->>'completed_at', '')::timestamptz,
      nullif(v_block->>'due_date', '')::date,
      coalesce(
        (v_prior_block->>'revision')::integer + 1,
        1
      )
    );

    for v_reference in
      select value
      from pg_catalog.jsonb_array_elements(
        coalesce(v_block->'references', '[]'::jsonb)
      )
    loop
      insert into public.ted_artifact_references (
        artifact_id,
        block_id,
        user_id,
        label,
        url,
        publisher,
        retrieved_at,
        supports,
        summary
      ) values (
        v_artifact_id,
        v_block_id,
        v_user_id,
        v_reference->>'label',
        v_reference->>'url',
        v_reference->>'publisher',
        (v_reference->>'retrieved_at')::timestamptz,
        v_reference->>'supports',
        v_reference->>'summary'
      );
    end loop;
  end loop;

  -- Rollback-compatible dual write for plans/checklists while v1 remains
  -- active.
  if p_artifact->>'kind' in ('action_plan', 'checklist') then
    delete from public.checklist_items
    where outcome_id = (p_artifact->>'outcome_id')::uuid
      and user_id = v_user_id;

    insert into public.checklist_items (
      id,
      outcome_id,
      user_id,
      text,
      due_date,
      reason,
      done,
      reminder_offset_days,
      reminder_sent,
      order_index,
      created_at,
      updated_at
    )
    select
      block_record.id,
      (p_artifact->>'outcome_id')::uuid,
      v_user_id,
      coalesce(block_record.heading, 'General')
        || pg_catalog.chr(9247)
        || coalesce(block_record.payload->>'title', 'Action'),
      block_record.due_date,
      block_record.payload->>'objective',
      block_record.completed_at is not null,
      null,
      false,
      block_record.order_index,
      pg_catalog.now(),
      pg_catalog.now()
    from public.ted_artifact_blocks block_record
    where block_record.artifact_id = v_artifact_id
      and block_record.user_id = v_user_id
      and block_record.kind = 'action';
  end if;

  -- Capture only the rows that survived the authoritative persistence
  -- boundary.  Never copy caller JSON into an immutable version: extra
  -- ledger, approval, provider, or provenance keys are untrusted input.
  perform private.capture_ted_artifact_revision(v_artifact_id);

  return v_artifact_id;
end;
$function$;

revoke all on function public.save_ted_artifact(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_ted_artifact(jsonb, jsonb)
  to authenticated;

-- Checklist completion is an authenticated command, not a browser UPDATE
-- permission. Keep the stable signature/result and legacy checklist dual
-- write while enforcing ownership and optimistic concurrency explicitly.
create or replace function public.set_ted_block_completed(
  p_block_id uuid,
  p_completed boolean,
  p_expected_revision integer
) returns public.ted_artifact_blocks
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.ted_artifact_blocks%rowtype;
  v_result public.ted_artifact_blocks%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select * into v_existing
  from public.ted_artifact_blocks
  where id = p_block_id
    and user_id = v_user_id
  for update;

  if not found or v_existing.revision <> p_expected_revision then
    raise exception 'block not found or revision conflict';
  end if;

  update public.ted_artifact_blocks
  set completed_at = case
        when p_completed then pg_catalog.now()
        else null
      end,
      revision = revision + 1,
      updated_at = pg_catalog.now()
  where id = p_block_id
    and user_id = v_user_id
    and revision = p_expected_revision
  returning * into v_result;

  if v_result.id is null then
    raise exception 'block not found or revision conflict';
  end if;

  update public.checklist_items
  set done = p_completed,
      updated_at = pg_catalog.now()
  where id = p_block_id
    and user_id = v_user_id;

  return v_result;
end;
$function$;

revoke all on function public.set_ted_block_completed(uuid, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_ted_block_completed(uuid, boolean, integer)
  to authenticated;

commit;
