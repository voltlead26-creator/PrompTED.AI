-- Unified, versioned storage for every user-facing TED output.
-- Expand-only: legacy documents, sections and checklist_items remain intact.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.ted_artifacts (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('document','action_plan','checklist','report','recommendation','research_brief','job_match')),
  title text not null,
  template_id text,
  schema_version integer not null default 2 check (schema_version >= 2),
  pipeline_version text not null default 'ted-v2',
  status text not null default 'draft' check (status in ('draft','ready','needs_review','approved','archived')),
  quality_status text not null default 'pending' check (quality_status in ('pending','passed','failed')),
  current_revision integer not null default 1 check (current_revision > 0),
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table public.ted_artifact_blocks (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.ted_artifacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_block_id uuid references public.ted_artifact_blocks(id) on delete cascade,
  kind text not null check (kind in ('section','action','recommendation','finding','reference')),
  stable_key text not null,
  heading text not null default '',
  order_index integer not null default 0,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  approval_status text not null default 'draft' check (approval_status in ('draft','approved','locked')),
  completed_at timestamptz,
  due_date date,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artifact_id, stable_key)
);

create table public.ted_artifact_references (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.ted_artifacts(id) on delete cascade,
  block_id uuid not null references public.ted_artifact_blocks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  url text not null,
  publisher text not null,
  retrieved_at timestamptz not null,
  supports text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  check (length(trim(summary)) > 0 and length(trim(supports)) > 0)
);

create table public.ted_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.ted_artifacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (artifact_id, revision)
);

create table private.ted_generation_runs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid references public.ted_artifacts(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  workflow text not null,
  pipeline_version text not null,
  status text not null,
  duration_ms integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  provider_attempts integer not null default 0,
  repair_count integer not null default 0,
  grounding_used boolean not null default false,
  validation_issue_count integer not null default 0,
  error_code text,
  created_at timestamptz not null default now()
);

create table private.ted_pipeline_rollouts (
  workflow text primary key,
  enabled boolean not null default false,
  rollout_percent integer not null default 0 check (rollout_percent between 0 and 100),
  pipeline_version text not null default 'ted-v2',
  kill_switch boolean not null default false,
  updated_at timestamptz not null default now()
);

create index idx_ted_artifacts_owner_updated on public.ted_artifacts(user_id, updated_at desc);
create index idx_ted_artifacts_outcome_kind on public.ted_artifacts(outcome_id, kind);
create index idx_ted_artifact_blocks_order on public.ted_artifact_blocks(artifact_id, order_index);
create index idx_ted_artifact_blocks_due on public.ted_artifact_blocks(user_id, due_date) where due_date is not null and completed_at is null;
create index idx_ted_artifact_references_artifact on public.ted_artifact_references(artifact_id, block_id);
create index idx_ted_artifact_versions_artifact on public.ted_artifact_versions(artifact_id, revision desc);
create index idx_ted_generation_runs_workflow_created on private.ted_generation_runs(workflow, created_at desc);

alter table public.ted_artifacts enable row level security;
alter table public.ted_artifact_blocks enable row level security;
alter table public.ted_artifact_references enable row level security;
alter table public.ted_artifact_versions enable row level security;

create policy ted_artifacts_own on public.ted_artifacts for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.outcomes o
      where o.id = outcome_id and o.user_id = (select auth.uid())
    )
  );
create policy ted_artifact_blocks_own on public.ted_artifact_blocks for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ted_artifacts a where a.id = artifact_id and a.user_id = (select auth.uid()))
  )
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ted_artifacts a where a.id = artifact_id and a.user_id = (select auth.uid()))
    and (parent_block_id is null or exists (
      select 1 from public.ted_artifact_blocks parent
      where parent.id = parent_block_id and parent.artifact_id = artifact_id and parent.user_id = (select auth.uid())
    ))
  );
create policy ted_artifact_references_own on public.ted_artifact_references for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ted_artifact_blocks b where b.id = block_id and b.artifact_id = artifact_id and b.user_id = (select auth.uid()))
  )
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ted_artifact_blocks b where b.id = block_id and b.artifact_id = artifact_id and b.user_id = (select auth.uid()))
  );
create policy ted_artifact_versions_own on public.ted_artifact_versions for all to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ted_artifacts a where a.id = artifact_id and a.user_id = (select auth.uid()))
  )
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.ted_artifacts a where a.id = artifact_id and a.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.ted_artifacts to authenticated;
grant select, insert, update, delete on public.ted_artifact_blocks to authenticated;
grant select, insert, update, delete on public.ted_artifact_references to authenticated;
grant select, insert on public.ted_artifact_versions to authenticated;
revoke all on private.ted_generation_runs from public, anon, authenticated;
revoke all on private.ted_pipeline_rollouts from public, anon, authenticated;

create or replace function public.save_ted_artifact(p_artifact jsonb, p_blocks jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_artifact_id uuid := coalesce(nullif(p_artifact->>'id', '')::uuid, gen_random_uuid());
  v_existing_id uuid;
  v_block jsonb;
  v_block_id uuid;
  v_reference jsonb;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'blocks must be an array'; end if;
  if not exists (
    select 1 from public.outcomes
    where id = (p_artifact->>'outcome_id')::uuid and user_id = v_user_id
  ) then raise exception 'outcome not found'; end if;

  if nullif(p_artifact->>'request_id', '') is not null then
    select id into v_existing_id
    from public.ted_artifacts
    where user_id = v_user_id and request_id = p_artifact->>'request_id';
    if v_existing_id is not null then return v_existing_id; end if;
  end if;

  insert into public.ted_artifacts (
    id, outcome_id, user_id, kind, title, template_id, schema_version, pipeline_version,
    status, quality_status, current_revision, request_id, updated_at
  ) values (
    v_artifact_id, (p_artifact->>'outcome_id')::uuid, v_user_id, p_artifact->>'kind',
    p_artifact->>'title', nullif(p_artifact->>'template_id', ''),
    coalesce((p_artifact->>'schema_version')::integer, 2),
    coalesce(nullif(p_artifact->>'pipeline_version', ''), 'ted-v2'),
    coalesce(nullif(p_artifact->>'status', ''), 'ready'),
    coalesce(nullif(p_artifact->>'quality_status', ''), 'passed'),
    coalesce((p_artifact->>'current_revision')::integer, 1),
    nullif(p_artifact->>'request_id', ''), now()
  ) on conflict (id) do update set
    title = excluded.title, status = excluded.status, quality_status = excluded.quality_status,
    current_revision = public.ted_artifacts.current_revision + 1, updated_at = now()
  where public.ted_artifacts.user_id = v_user_id;

  insert into public.ted_artifact_versions (artifact_id, user_id, revision, snapshot)
  select v_artifact_id, v_user_id, current_revision, p_artifact || jsonb_build_object('blocks', p_blocks)
  from public.ted_artifacts where id = v_artifact_id
  on conflict (artifact_id, revision) do nothing;

  delete from public.ted_artifact_blocks where artifact_id = v_artifact_id and user_id = v_user_id;

  for v_block in select value from jsonb_array_elements(p_blocks) loop
    v_block_id := coalesce(nullif(v_block->>'id', '')::uuid, gen_random_uuid());
    insert into public.ted_artifact_blocks (
      id, artifact_id, user_id, kind, stable_key, heading, order_index, payload,
      approval_status, completed_at, due_date, revision
    ) values (
      v_block_id, v_artifact_id, v_user_id, v_block->>'kind', v_block->>'stable_key',
      coalesce(v_block->>'heading', ''), coalesce((v_block->>'order_index')::integer, 0),
      coalesce(v_block->'payload', '{}'::jsonb), coalesce(v_block->>'approval_status', 'draft'),
      nullif(v_block->>'completed_at', '')::timestamptz, nullif(v_block->>'due_date', '')::date,
      coalesce((v_block->>'revision')::integer, 1)
    );
    for v_reference in select value from jsonb_array_elements(coalesce(v_block->'references', '[]'::jsonb)) loop
      insert into public.ted_artifact_references (
        artifact_id, block_id, user_id, label, url, publisher, retrieved_at, supports, summary
      ) values (
        v_artifact_id, v_block_id, v_user_id, v_reference->>'label', v_reference->>'url',
        v_reference->>'publisher', (v_reference->>'retrieved_at')::timestamptz,
        v_reference->>'supports', v_reference->>'summary'
      );
    end loop;
  end loop;

  -- Rollback-compatible dual write for plans/checklists while v1 remains active.
  if p_artifact->>'kind' in ('action_plan', 'checklist') then
    delete from public.checklist_items where outcome_id = (p_artifact->>'outcome_id')::uuid and user_id = v_user_id;
    insert into public.checklist_items (
      id, outcome_id, user_id, text, due_date, reason, done, reminder_offset_days,
      reminder_sent, order_index, created_at, updated_at
    )
    select
      coalesce(nullif(block->>'id', '')::uuid, gen_random_uuid()),
      (p_artifact->>'outcome_id')::uuid,
      v_user_id,
      coalesce(block->>'heading', 'General') || chr(9247) || coalesce(block->'payload'->>'title', 'Action'),
      nullif(block->>'due_date', '')::date,
      block->'payload'->>'objective',
      nullif(block->>'completed_at', '') is not null,
      null, false,
      coalesce((block->>'order_index')::integer, 0), now(), now()
    from jsonb_array_elements(p_blocks) block
    where block->>'kind' = 'action';
  end if;
  return v_artifact_id;
end;
$$;

revoke all on function public.save_ted_artifact(jsonb, jsonb) from public, anon;
grant execute on function public.save_ted_artifact(jsonb, jsonb) to authenticated;

create or replace function public.set_ted_block_completed(p_block_id uuid, p_completed boolean, p_expected_revision integer)
returns public.ted_artifact_blocks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare v_result public.ted_artifact_blocks;
begin
  update public.ted_artifact_blocks
  set completed_at = case when p_completed then now() else null end,
      revision = revision + 1, updated_at = now()
  where id = p_block_id and user_id = auth.uid() and revision = p_expected_revision
  returning * into v_result;
  if v_result.id is null then raise exception 'block not found or revision conflict'; end if;
  update public.checklist_items
  set done = p_completed, updated_at = now()
  where id = p_block_id and user_id = auth.uid();
  return v_result;
end;
$$;

revoke all on function public.set_ted_block_completed(uuid, boolean, integer) from public, anon;
grant execute on function public.set_ted_block_completed(uuid, boolean, integer) to authenticated;
