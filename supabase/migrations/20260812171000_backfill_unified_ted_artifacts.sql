-- Idempotent legacy backfill and compatibility links for TED artifact v2.

alter table public.export_history
  add column if not exists artifact_id uuid references public.ted_artifacts(id) on delete set null;
create index if not exists idx_export_history_artifact_id on public.export_history(artifact_id);

create table if not exists private.ted_migration_checkpoints (
  migration_key text primary key,
  migrated_count bigint not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.ted_migration_checkpoints from public, anon, authenticated;

-- Documents and their sections retain their existing UUIDs for traceability.
insert into public.ted_artifacts (
  id, outcome_id, user_id, kind, title, template_id, status, quality_status,
  current_revision, request_id, created_at, updated_at
)
select
  d.id, d.outcome_id, d.user_id, 'document', d.title, d.template_id::text,
  case when d.status in ('approved','exported') then 'approved' else 'ready' end,
  'passed', 1, 'legacy-document:' || d.id::text, d.created_at, d.updated_at
from public.documents d
where d.outcome_id is not null
on conflict (id) do nothing;

insert into public.ted_artifact_blocks (
  id, artifact_id, user_id, kind, stable_key, heading, order_index, payload,
  approval_status, completed_at, due_date, revision, created_at, updated_at
)
select
  s.id, s.document_id, s.user_id, 'section', 'legacy_section_' || s.id::text,
  s.name, s.order_index, jsonb_build_object('content', s.content),
  case when s.status in ('approved','locked') then s.status else 'draft' end,
  null, null, 1, s.created_at, s.updated_at
from public.sections s
join public.ted_artifacts a on a.id = s.document_id and a.kind = 'document'
on conflict (id) do nothing;

-- One deterministic checklist artifact per legacy checklist outcome.
insert into public.ted_artifacts (
  id, outcome_id, user_id, kind, title, status, quality_status, current_revision,
  request_id, created_at, updated_at
)
select
  extensions.uuid_generate_v5('9b8f65d0-262c-4bb2-a8cd-f6456b62db31'::uuid, 'checklist:' || o.id::text),
  o.id, o.user_id, 'checklist',
  coalesce(nullif(o.recommendation_payload->'primary'->>'reason', ''), 'Saved checklist or action plan'),
  'ready', 'passed', 1, 'legacy-checklist:' || o.id::text,
  min(c.created_at), max(c.updated_at)
from public.outcomes o
join public.checklist_items c on c.outcome_id = o.id and c.user_id = o.user_id
group by o.id, o.user_id, o.recommendation_payload
on conflict (id) do nothing;

insert into public.ted_artifact_blocks (
  id, artifact_id, user_id, kind, stable_key, heading, order_index, payload,
  approval_status, completed_at, due_date, revision, created_at, updated_at
)
select
  c.id,
  extensions.uuid_generate_v5('9b8f65d0-262c-4bb2-a8cd-f6456b62db31'::uuid, 'checklist:' || c.outcome_id::text),
  c.user_id, 'action', 'legacy_action_' || c.id::text,
  case when strpos(c.text, chr(9247)) > 0 then split_part(c.text, chr(9247), 1) else 'General' end,
  c.order_index,
  jsonb_build_object(
    'title', case when strpos(c.text, chr(9247)) > 0 then split_part(c.text, chr(9247), 2) else c.text end,
    'objective', coalesce(nullif(c.reason, ''), c.text),
    'instructions', jsonb_build_array(case when strpos(c.text, chr(9247)) > 0 then split_part(c.text, chr(9247), 2) else c.text end),
    'required_inputs', '[]'::jsonb,
    'included_materials', '[]'::jsonb,
    'dependencies', '[]'::jsonb,
    'timing', case when c.due_date is null then 'null'::jsonb else jsonb_build_object('due_date', c.due_date, 'rationale', 'This was the saved due date.') end,
    'completion_criteria', jsonb_build_array('The saved action has been completed and checked.'),
    'cautions', '[]'::jsonb
  ),
  'draft', case when c.done then coalesce(c.updated_at, now()) else null end,
  c.due_date, 1, c.created_at, c.updated_at
from public.checklist_items c
join public.ted_artifacts a on a.id = extensions.uuid_generate_v5('9b8f65d0-262c-4bb2-a8cd-f6456b62db31'::uuid, 'checklist:' || c.outcome_id::text)
on conflict (id) do nothing;

insert into private.ted_migration_checkpoints (migration_key, migrated_count, completed_at)
values (
  'legacy_artifacts_v2',
  (select count(*) from public.ted_artifacts where request_id like 'legacy-%'),
  now()
)
on conflict (migration_key) do update set
  migrated_count = excluded.migrated_count,
  completed_at = excluded.completed_at,
  updated_at = now();

insert into private.ted_pipeline_rollouts (workflow, enabled, rollout_percent)
values
  ('action_plan', false, 0), ('checklist', false, 0), ('document', false, 0),
  ('report', false, 0), ('recommendation', false, 0), ('research_brief', false, 0),
  ('job_match', false, 0)
on conflict (workflow) do nothing;
