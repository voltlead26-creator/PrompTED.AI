-- Remove the self-referencing RLS predicate from ted_artifact_blocks.
-- Parent ownership and artifact scope are enforced structurally so policy
-- evaluation never needs to query the protected table recursively.

do $$
begin
  if exists (
    select 1
    from public.ted_artifact_blocks child
    join public.ted_artifact_blocks parent on parent.id = child.parent_block_id
    where child.parent_block_id is not null
      and (
        parent.artifact_id is distinct from child.artifact_id
        or parent.user_id is distinct from child.user_id
      )
  ) then
    raise exception
      'TED_ARTIFACT_BLOCK_PARENT_SCOPE_CONFLICT: existing parent block belongs to another artifact or user';
  end if;
end;
$$;

alter table public.ted_artifact_blocks
  add constraint ted_artifact_blocks_parent_scope_unique
  unique (id, artifact_id, user_id);

alter table public.ted_artifact_blocks
  add constraint ted_artifact_blocks_parent_scope_fkey
  foreign key (parent_block_id, artifact_id, user_id)
  references public.ted_artifact_blocks(id, artifact_id, user_id)
  on delete cascade;

drop policy if exists ted_artifact_blocks_own on public.ted_artifact_blocks;

create policy ted_artifact_blocks_own
on public.ted_artifact_blocks
for all
to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.ted_artifacts artifact
    where artifact.id = artifact_id
      and artifact.user_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.ted_artifacts artifact
    where artifact.id = artifact_id
      and artifact.user_id = (select auth.uid())
  )
);

comment on constraint ted_artifact_blocks_parent_scope_fkey
on public.ted_artifact_blocks is
  'Enforces same-artifact and same-owner parent blocks without a recursive RLS lookup.';
