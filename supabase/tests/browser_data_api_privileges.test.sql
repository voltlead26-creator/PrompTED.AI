begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

create temp table browser_expected_table_privileges (
  table_name text not null,
  privilege_name text not null,
  primary key (table_name, privilege_name)
);

insert into browser_expected_table_privileges(table_name, privilege_name)
values
  ('brand_kits', 'SELECT'),
  ('businesses', 'SELECT'),
  ('businesses', 'UPDATE'),
  ('checklist_items', 'SELECT'),
  ('documents', 'SELECT'),
  ('documents', 'INSERT'),
  ('documents', 'UPDATE'),
  ('memberships', 'SELECT'),
  ('outcomes', 'SELECT'),
  ('outcomes', 'INSERT'),
  ('outcomes', 'UPDATE'),
  ('profile_resume_versions', 'SELECT'),
  ('profiles', 'SELECT'),
  ('role_action_items', 'SELECT'),
  ('role_action_items', 'INSERT'),
  ('role_action_items', 'UPDATE'),
  ('role_outcomes', 'SELECT'),
  ('role_outcomes', 'INSERT'),
  ('saved_roles', 'SELECT'),
  ('saved_roles', 'INSERT'),
  ('saved_roles', 'UPDATE'),
  ('sections', 'SELECT'),
  ('sections', 'INSERT'),
  ('sections', 'UPDATE'),
  ('subscriptions', 'SELECT'),
  ('ted_artifact_blocks', 'SELECT'),
  ('ted_artifact_references', 'SELECT'),
  ('ted_artifacts', 'SELECT'),
  ('usage_ledger', 'SELECT');

select ok(
  not exists (
    with actual as (
      select relation_record.relname as table_name, privilege.privilege_name
      from pg_catalog.pg_class relation_record
      join pg_catalog.pg_namespace schema_record
        on schema_record.oid = relation_record.relnamespace
      cross join unnest(array[
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER'
      ]) privilege(privilege_name)
      where schema_record.nspname = 'public'
        and relation_record.relkind in ('r', 'p', 'v', 'm', 'f')
        and pg_catalog.has_table_privilege(
          'authenticated',
          relation_record.oid,
          privilege.privilege_name
        )
    )
    (
      select table_name, privilege_name from actual
      except
      select table_name, privilege_name from browser_expected_table_privileges
    )
    union all
    (
      select table_name, privilege_name from browser_expected_table_privileges
      except
      select table_name, privilege_name from actual
    )
  ),
  'authenticated has exactly the reviewed public-table privileges across every ACL verb'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_class relation_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = relation_record.relnamespace
    cross join unnest(array[
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER'
    ]) privilege(privilege_name)
    where schema_record.nspname = 'public'
      and relation_record.relkind in ('r', 'p', 'v', 'm', 'f')
      and pg_catalog.has_table_privilege(
        'anon',
        relation_record.oid,
        privilege.privilege_name
      )
  ),
  'anonymous callers have no public-table privileges'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname = 'save_ted_artifact'
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
      and pg_catalog.has_function_privilege(
        'authenticated',
        procedure_record.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_record.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role',
        procedure_record.oid,
        'EXECUTE'
      )
  ),
  'save_ted_artifact is an authenticated-only SECURITY DEFINER RPC with an empty search path'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname = 'set_ted_block_completed'
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
      and pg_catalog.has_function_privilege(
        'authenticated',
        procedure_record.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'anon',
        procedure_record.oid,
        'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role',
        procedure_record.oid,
        'EXECUTE'
      )
  ),
  'set_ted_block_completed is an authenticated-only SECURITY DEFINER RPC with an empty search path'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('91000000-0000-4000-8000-000000000001', 'artifact-owner@example.invalid', false, false, now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'artifact-foreign-owner@example.invalid', false, false, now(), now());

insert into public.outcomes(id, user_id, situation_text)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Owner artifact privilege test'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'Foreign artifact privilege test');

insert into public.ted_artifacts(
  id,
  outcome_id,
  user_id,
  kind,
  title,
  request_id
)
values (
  '93000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000002',
  'document',
  'Foreign owner artifact',
  'artifact-foreign-owner-request'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '91000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
    $$insert into public.outcomes(id, user_id, situation_text)
      values (
        '92000000-0000-4000-8000-000000000099',
        '91000000-0000-4000-8000-000000000002',
        'Cross-owner direct outcome'
      )$$,
    '%row-level security%'
  ),
  'legacy direct INSERT remains owner-isolated by outcome RLS'
);

select lives_ok(
  $$update public.outcomes
    set situation_text = 'Legacy compatible owner update'
    where id = '92000000-0000-4000-8000-000000000001'$$,
  'the expand cohort retains the published owner-scoped UPDATE path'
);

select ok(
  pg_temp.raises_matching(
    $$insert into public.ted_artifact_versions(
        artifact_id,
        user_id,
        revision,
        snapshot
      ) values (
        '93000000-0000-4000-8000-000000000001',
        auth.uid(),
        99,
        '{"forged":true}'::jsonb
      )$$,
    '%permission denied for table ted_artifact_versions%'
  ),
  'authenticated callers cannot forge an artifact-version row directly'
);

select ok(
  pg_temp.raises_matching(
    $$insert into public.ted_artifacts(
        id,
        outcome_id,
        user_id,
        kind,
        title,
        current_revision
      ) values (
        '93000000-0000-4000-8000-000000000099',
        '92000000-0000-4000-8000-000000000001',
        auth.uid(),
        'document',
        'Forged direct artifact',
        999
      )$$,
    '%permission denied for table ted_artifacts%'
  ),
  'authenticated callers cannot seed artifact revisions through direct INSERT'
);

select ok(
  pg_temp.raises_matching(
    $$select public.save_ted_artifact(
      '{
        "outcome_id":"92000000-0000-4000-8000-000000000001",
        "kind":"document",
        "title":"Invalid null blocks",
        "request_id":"artifact-null-blocks-request"
      }'::jsonb,
      null::jsonb
    )$$,
    '%blocks must be an array%'
  ),
  'save_ted_artifact rejects a null block collection before writing'
);

select is(
  public.save_ted_artifact(
    '{
      "id":"93000000-0000-4000-8000-000000000001",
      "outcome_id":"92000000-0000-4000-8000-000000000001",
      "kind":"checklist",
      "title":"Owner artifact",
      "template_id":"complaint-letter",
      "schema_version":2,
      "pipeline_version":"ted-v2",
      "status":"ready",
      "quality_status":"passed",
      "current_revision":999,
      "request_id":"artifact-owner-request",
      "user_id":"91000000-0000-4000-8000-000000000002",
      "ledger_binding_status":"captured",
      "ledger_version":"forged-ledger.999",
      "approved_revision":999,
      "provider":"forged-provider",
      "provenance":{"source":"forged-caller-provenance"}
    }'::jsonb,
    '[{
      "id":"94000000-0000-4000-8000-000000000001",
      "kind":"action",
      "stable_key":"authoritative_section",
      "heading":"Persisted section",
      "order_index":0,
      "payload":{
        "content":"Persisted authoritative block content",
        "title":"Authoritative checklist action",
        "objective":"Complete the authoritative action"
      },
      "approval_status":"approved",
      "revision":999,
      "user_id":"91000000-0000-4000-8000-000000000002",
      "ledger_binding_status":"captured",
      "provider_provenance":"forged-block-provenance",
      "references":[{
        "label":"Authoritative reference",
        "url":"https://example.invalid/evidence",
        "publisher":"Evidence Publisher",
        "retrieved_at":"2026-09-01T00:00:00Z",
        "supports":"The persisted section",
        "summary":"Synthetic supporting evidence",
        "user_id":"91000000-0000-4000-8000-000000000002",
        "provider":"forged-reference-provider",
        "extra_provenance":"forged-reference-provenance"
      }]
    }]'::jsonb
  )::text,
  '93000000-0000-4000-8000-000000000001',
  'authenticated save_ted_artifact still returns the persisted artifact ID'
);

reset role;

select is(
  (
    select pg_catalog.count(*)::integer
    from public.ted_artifact_versions
    where artifact_id = '93000000-0000-4000-8000-000000000001'
      and user_id = '91000000-0000-4000-8000-000000000001'
      and revision = 1
  ),
  1,
  'save_ted_artifact captures exactly one owner-scoped version'
);

select ok(
  (
    select
      snapshot->>'user_id' = '91000000-0000-4000-8000-000000000001'
      and snapshot->>'ledger_binding_status' = 'legacy_unversioned'
      and snapshot->>'ledger_version' is null
      and snapshot->>'approved_revision' is null
      and not snapshot ? 'provider'
      and not snapshot ? 'provenance'
      and snapshot->>'title' = 'Owner artifact'
      and snapshot->>'current_revision' = '1'
      and snapshot->'blocks'->0->>'user_id' = '91000000-0000-4000-8000-000000000001'
      and snapshot->'blocks'->0->>'ledger_binding_status' = 'legacy_unversioned'
      and not snapshot->'blocks'->0 ? 'provider_provenance'
      and snapshot->'blocks'->0->>'heading' = 'Persisted section'
      and snapshot->'blocks'->0->>'revision' = '1'
      and snapshot->'blocks'->0->>'approval_status' = 'draft'
      and snapshot->'blocks'->0->'payload'->>'content'
        = 'Persisted authoritative block content'
      and snapshot->'blocks'->0->'references'->0->>'label'
        = 'Authoritative reference'
      and snapshot->'blocks'->0->'references'->0->>'url'
        = 'https://example.invalid/evidence'
      and snapshot->'blocks'->0->'references'->0->>'publisher'
        = 'Evidence Publisher'
      and (snapshot->'blocks'->0->'references'->0->>'retrieved_at')::timestamptz
        = '2026-09-01T00:00:00Z'::timestamptz
      and snapshot->'blocks'->0->'references'->0->>'supports'
        = 'The persisted section'
      and snapshot->'blocks'->0->'references'->0->>'summary'
        = 'Synthetic supporting evidence'
      and snapshot->'blocks'->0->'references'->0->>'user_id'
        = '91000000-0000-4000-8000-000000000001'
      and not snapshot->'blocks'->0->'references'->0 ? 'provider'
      and not snapshot->'blocks'->0->'references'->0 ? 'extra_provenance'
      and (
        select current_revision = 1
        from public.ted_artifacts
        where id = '93000000-0000-4000-8000-000000000001'
      )
      and (
        select revision = 1 and approval_status = 'draft'
        from public.ted_artifact_blocks
        where id = '94000000-0000-4000-8000-000000000001'
      )
    from public.ted_artifact_versions
    where artifact_id = '93000000-0000-4000-8000-000000000001'
      and revision = 1
  ),
  'immutable snapshots contain authoritative persisted rows and exclude caller-forged metadata'
);

set local role authenticated;

select ok(
  pg_temp.raises_matching(
    $$update public.ted_artifact_blocks
      set revision = 999, approval_status = 'approved'
      where id = '94000000-0000-4000-8000-000000000001'$$,
    '%permission denied for table ted_artifact_blocks%'
  ),
  'authenticated callers cannot forge block revision or approval through direct UPDATE'
);

select ok(
  pg_temp.raises_matching(
    $$insert into public.ted_artifact_references(
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
        '93000000-0000-4000-8000-000000000001',
        '94000000-0000-4000-8000-000000000001',
        auth.uid(),
        'Forged direct reference',
        'https://example.invalid/forged',
        'Forged publisher',
        pg_catalog.now(),
        'Forged support',
        'Forged summary'
      )$$,
    '%permission denied for table ted_artifact_references%'
  ),
  'authenticated callers cannot forge provenance through direct reference INSERT'
);

select is(
  public.save_ted_artifact(
    '{
      "id":"93000000-0000-4000-8000-000000000001",
      "outcome_id":"92000000-0000-4000-8000-000000000001",
      "kind":"checklist",
      "title":"Owner artifact updated",
      "current_revision":999,
      "request_id":"artifact-owner-update-request"
    }'::jsonb,
    '[{
      "id":"94000000-0000-4000-8000-000000000099",
      "kind":"action",
      "stable_key":"authoritative_section",
      "heading":"Persisted section updated",
      "order_index":0,
      "payload":{
        "content":"Persisted authoritative block content updated",
        "title":"Authoritative checklist action updated",
        "objective":"Complete the updated authoritative action"
      },
      "approval_status":"approved",
      "revision":999
    }]'::jsonb
  )::text,
  '93000000-0000-4000-8000-000000000001',
  'a non-replay full save returns the existing owner artifact ID'
);

reset role;

select ok(
  (
    select current_revision = 2
    from public.ted_artifacts
    where id = '93000000-0000-4000-8000-000000000001'
  )
  and (
    select revision = 2 and approval_status = 'draft'
    from public.ted_artifact_blocks
    where id = '94000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1
    from public.ted_artifact_blocks
    where id = '94000000-0000-4000-8000-000000000099'
  )
  and (
    select
      snapshot->>'current_revision' = '2'
      and snapshot->'blocks'->0->>'id'
        = '94000000-0000-4000-8000-000000000001'
      and snapshot->'blocks'->0->>'revision' = '2'
      and snapshot->'blocks'->0->>'approval_status' = 'draft'
    from public.ted_artifact_versions
    where artifact_id = '93000000-0000-4000-8000-000000000001'
      and revision = 2
  ),
  'full saves preserve stable-key block identity, advance revisions, and reset approval to draft'
);

set local role authenticated;

select ok(
  (
    select
      completed_at is not null
      and revision = 3
      and id = '94000000-0000-4000-8000-000000000001'
    from public.set_ted_block_completed(
      '94000000-0000-4000-8000-000000000001',
      true,
      2
    )
  ),
  'set_ted_block_completed remains the owner-scoped optimistic completion command'
);

reset role;

select ok(
  (
    select completed_at is not null and revision = 3
    from public.ted_artifact_blocks
    where id = '94000000-0000-4000-8000-000000000001'
  )
  and (
    select done
    from public.checklist_items
    where id = '94000000-0000-4000-8000-000000000001'
      and user_id = '91000000-0000-4000-8000-000000000001'
  ),
  'completion RPC persists the block and legacy checklist dual update after table UPDATE revoke'
);

set local role authenticated;

select is(
  public.save_ted_artifact(
    '{
      "id":"93000000-0000-4000-8000-000000000099",
      "outcome_id":"92000000-0000-4000-8000-000000000001",
      "kind":"document",
      "title":"Replay must not replace this title",
      "request_id":"artifact-owner-request"
    }'::jsonb,
    '[]'::jsonb
  )::text,
  '93000000-0000-4000-8000-000000000001',
  'owner-scoped request replay returns the original artifact ID'
);

select ok(
  pg_temp.raises_matching(
    $$select public.save_ted_artifact(
      '{
        "id":"93000000-0000-4000-8000-000000000002",
        "outcome_id":"92000000-0000-4000-8000-000000000001",
        "kind":"document",
        "title":"Cross-owner overwrite",
        "request_id":"artifact-cross-owner-request"
      }'::jsonb,
      '[]'::jsonb
    )$$,
    '%artifact not found%'
  ),
  'save_ted_artifact rejects a caller-supplied artifact ID owned by another user'
);

reset role;

select ok(
  (select title from public.ted_artifacts where id = '93000000-0000-4000-8000-000000000002')
    = 'Foreign owner artifact'
    and not exists (
      select 1
      from public.ted_artifact_versions
      where artifact_id = '93000000-0000-4000-8000-000000000002'
        and user_id = '91000000-0000-4000-8000-000000000001'
    )
    and not exists (
      select 1
      from public.ted_artifact_blocks
      where artifact_id = '93000000-0000-4000-8000-000000000002'
        and user_id = '91000000-0000-4000-8000-000000000001'
    ),
  'a rejected cross-owner save leaves the foreign artifact graph unchanged'
);

select * from finish();
rollback;
