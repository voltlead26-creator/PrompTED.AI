begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

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

select has_function(
  'public', 'get_workspace_snapshot_v1', array['uuid','uuid'],
  'the initial workspace has one versioned snapshot command'
);
select has_function(
  'public', 'get_workspace_section_body_v1',
  array['uuid','uuid','integer','integer'],
  'deliberate activation has one revision-bound section-body command'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where namespace_record.nspname = 'public'
      and function_record.proname in (
        'get_workspace_snapshot_v1', 'get_workspace_section_body_v1'
      )
      and function_record.prosecdef
      and function_record.provolatile = 's'
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  2,
  'both owner commands are STABLE SECURITY DEFINER functions with an empty search path'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.get_workspace_snapshot_v1(uuid,uuid)', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.get_workspace_section_body_v1(uuid,uuid,integer,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.get_workspace_snapshot_v1(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'public.get_workspace_snapshot_v1(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.get_workspace_section_body_v1(uuid,uuid,integer,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.get_workspace_section_body_v1(uuid,uuid,integer,integer)',
    'EXECUTE'
  ),
  'only authenticated owners receive the snapshot and section-body Data API seams'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('c9400000-0000-4000-8000-000000000001', 'snapshot-owner@example.invalid', false, false, now(), now()),
  ('c9400000-0000-4000-8000-000000000002', 'snapshot-other@example.invalid', false, false, now(), now());

insert into public.uploads(
  id, user_id, storage_path, file_type, file_name, file_size_bytes
) values
  (
    'c9450000-0000-4000-8000-000000000001',
    'c9400000-0000-4000-8000-000000000001',
    'c9400000-0000-4000-8000-000000000001/c9450000-0000-4000-8000-000000000001/source.txt',
    'text/plain', 'source.txt', 32
  ),
  (
    'c9450000-0000-4000-8000-000000000002',
    'c9400000-0000-4000-8000-000000000002',
    'c9400000-0000-4000-8000-000000000002/c9450000-0000-4000-8000-000000000002/private.txt',
    'text/plain', 'private.txt', 24
  );

insert into public.outcomes(id, user_id, situation_text, recommendation_payload)
values (
  'c9410000-0000-4000-8000-000000000001',
  'c9400000-0000-4000-8000-000000000001',
  'Prepare an exact bounded workspace.',
  '{"primary":{"template_id":"complaint-letter","reason":"Complaint Letter"},"conversation_context":"Confirmed context","upload_context":"Confirmed upload","upload_id":"c9450000-0000-4000-8000-000000000001"}'::jsonb
);
insert into public.documents(
  id, user_id, outcome_id, title, content, status, workspace_sections,
  format, current_revision, approved_revision
) values (
  'c9420000-0000-4000-8000-000000000001',
  'c9400000-0000-4000-8000-000000000001',
  'c9410000-0000-4000-8000-000000000001',
  'Bounded workspace', '', 'approved', '[]', 'Word', 1, 1
);
insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  version_history, is_required, revision, approved_revision
) values
  (
    'c9430000-0000-4000-8000-000000000001',
    'c9420000-0000-4000-8000-000000000001',
    'c9400000-0000-4000-8000-000000000001',
    'First', 0, 'Authoritative first body.', 'approved', '[]', true, 1, 1
  ),
  (
    'c9430000-0000-4000-8000-000000000002',
    'c9420000-0000-4000-8000-000000000001',
    'c9400000-0000-4000-8000-000000000001',
    'Second', 1, 'Private deferred second body.', 'approved', '[]', true, 1, 1
  );

select set_config(
  'request.jwt.claim.sub', 'c9400000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  )->>'contract_version',
  'workspace-snapshot.v1',
  'the owner receives the exact snapshot contract version'
);
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  )->>'owner_user_id',
  'c9400000-0000-4000-8000-000000000001',
  'the snapshot binds every browser cache consumer to the authenticated owner'
);
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  )->'outcome'->>'template_id',
  'complaint-letter',
  'document creation keeps its owner-bound template facts without browser cache fallback'
);
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  )->'outcome'->>'upload_id',
  'c9450000-0000-4000-8000-000000000001',
  'the document snapshot retains the exact owner-validated upload identity'
);
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  )->>'active_section_id',
  'c9430000-0000-4000-8000-000000000001',
  'the first deterministic section is selected when no active section is supplied'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.jsonb_array_elements(
      public.get_workspace_snapshot_v1(
        'c9410000-0000-4000-8000-000000000001', null
      )->'sections'
    ) section_payload
    where (section_payload->>'content_loaded')::boolean
      and section_payload->>'content' = 'Authoritative first body.'
  ),
  1,
  'the initial snapshot contains exactly one authoritative body'
);
select ok(
  (
    select pg_catalog.bool_and(
      (section_payload->>'content_loaded')::boolean
      or pg_catalog.jsonb_typeof(section_payload->'content') = 'null'
    )
    from pg_catalog.jsonb_array_elements(
      public.get_workspace_snapshot_v1(
        'c9410000-0000-4000-8000-000000000001', null
      )->'sections'
    ) section_payload
  ),
  'every omitted body is explicit null rather than an authoritative blank'
);
select ok(
  (
    select pg_catalog.bool_and(
      section_payload->>'content_sha256' ~ '^[0-9a-f]{64}$'
      and (section_payload->>'content_length')::integer >= 0
      and (section_payload->>'revision')::integer > 0
    )
    from pg_catalog.jsonb_array_elements(
      public.get_workspace_snapshot_v1(
        'c9410000-0000-4000-8000-000000000001', null
      )->'sections'
    ) section_payload
  ),
  'all section summaries retain digest, byte-length, and revision identity'
);
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  )->'export_eligibility'->>'eligible',
  'true',
  'legacy export eligibility matches all-required-sections-approved semantics'
);
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001',
    'c9430000-0000-4000-8000-000000000002'
  )->'sections'->1->>'content',
  'Private deferred second body.',
  'an explicit active section selects that body without loading its sibling'
);
select is(
  public.get_workspace_section_body_v1(
    'c9410000-0000-4000-8000-000000000001',
    'c9430000-0000-4000-8000-000000000002', 1, 1
  )->>'content',
  'Private deferred second body.',
  'deliberate activation returns the exact owner body at the expected revisions'
);

reset role;
select set_config(
  'request.jwt.claim.sub', 'c9400000-0000-4000-8000-000000000002', true
);
set local role authenticated;
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000001', null
  ),
  null::jsonb,
  'another authenticated user cannot observe the outcome or its document'
);
select ok(
  pg_temp.raises_matching(
    $$select public.get_workspace_section_body_v1(
      'c9410000-0000-4000-8000-000000000001',
      'c9430000-0000-4000-8000-000000000001', 1, 1
    )$$,
    '%WORKSPACE_SECTION_BODY_NOT_FOUND%'
  ),
  'another user cannot load a section body by guessed identity'
);

reset role;
select set_config(
  'request.jwt.claim.sub', 'c9400000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.get_workspace_section_body_v1(
      'c9410000-0000-4000-8000-000000000001',
      'c9430000-0000-4000-8000-000000000001', 2, 1
    )$$,
    '%WORKSPACE_SECTION_BODY_STALE%'
  ),
  'a stale document revision rejects an otherwise current section body'
);
select ok(
  pg_temp.raises_matching(
    $$select public.get_workspace_section_body_v1(
      'c9410000-0000-4000-8000-000000000001',
      'c9430000-0000-4000-8000-000000000001', 1, 2
    )$$,
    '%WORKSPACE_SECTION_BODY_STALE%'
  ),
  'a stale section revision rejects the body without returning content'
);

reset role;
insert into public.outcomes(id, user_id, situation_text, recommendation_payload)
values
  (
    'c9410000-0000-4000-8000-000000000003',
    'c9400000-0000-4000-8000-000000000001',
    'No-document provenance.',
    '{"primary":{"template_id":"resume","reason":"Resume"},"upload_id":"c9450000-0000-4000-8000-000000000001"}'::jsonb
  ),
  (
    'c9410000-0000-4000-8000-000000000004',
    'c9400000-0000-4000-8000-000000000001',
    'Foreign provenance must fail closed.',
    '{"upload_id":"c9450000-0000-4000-8000-000000000002"}'::jsonb
  ),
  (
    'c9410000-0000-4000-8000-000000000005',
    'c9400000-0000-4000-8000-000000000001',
    'Malformed provenance must fail closed.',
    '{"upload_id":"not-a-uuid"}'::jsonb
  );
select set_config(
  'request.jwt.claim.sub', 'c9400000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select is(
  public.get_workspace_snapshot_v1(
    'c9410000-0000-4000-8000-000000000003', null
  )->'outcome'->>'upload_id',
  'c9450000-0000-4000-8000-000000000001',
  'the no-document snapshot retains the same exact upload identity'
);
select ok(
  pg_temp.raises_matching(
    $$select public.get_workspace_snapshot_v1(
      'c9410000-0000-4000-8000-000000000004', null
    )$$,
    '%WORKSPACE_UPLOAD_PROVENANCE_INVALID%'
  ),
  'an owner outcome cannot hydrate another account upload by guessed identity'
);
select ok(
  pg_temp.raises_matching(
    $$select public.get_workspace_snapshot_v1(
      'c9410000-0000-4000-8000-000000000005', null
    )$$,
    '%WORKSPACE_UPLOAD_PROVENANCE_INVALID%'
  ),
  'malformed upload provenance fails closed with the same generic error'
);
reset role;

insert into public.outcomes(id, user_id, situation_text)
values (
  'c9410000-0000-4000-8000-000000000002',
  'c9400000-0000-4000-8000-000000000001',
  'Large bounded document.'
);
insert into public.documents(
  id, user_id, outcome_id, title, content, status, workspace_sections, format
) values (
  'c9420000-0000-4000-8000-000000000002',
  'c9400000-0000-4000-8000-000000000001',
  'c9410000-0000-4000-8000-000000000002',
  'Large document', '', 'draft', '[]', 'Word'
);
insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  version_history, is_required
)
select
  ('c9440000-0000-4000-8000-' || pg_catalog.lpad(series::text, 12, '0'))::uuid,
  'c9420000-0000-4000-8000-000000000002'::uuid,
  'c9400000-0000-4000-8000-000000000001'::uuid,
  'Large section ' || series,
  series - 1,
  pg_catalog.repeat(pg_catalog.chr(96 + (series % 20)), 50000),
  'draft', '[]'::jsonb, true
from pg_catalog.generate_series(1, 200) series;

select set_config(
  'request.jwt.claim.sub', 'c9400000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_catalog.octet_length(
    public.get_workspace_snapshot_v1(
      'c9410000-0000-4000-8000-000000000002', null
    )::text
  ) < 300000,
  'a 200-section document returns one bounded body rather than all ten megabytes'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.jsonb_array_elements(
      public.get_workspace_snapshot_v1(
        'c9410000-0000-4000-8000-000000000002', null
      )->'sections'
    ) section_payload
    where pg_catalog.jsonb_typeof(section_payload->'content') = 'string'
  ),
  1,
  'large documents still expose only one section body'
);
reset role;

-- Two real database sessions prove that an uncommitted concurrent edit cannot
-- produce mixed document/section revisions in a stable snapshot. The next
-- statement after commit sees the complete new revision pair.
select extensions.dblink_connect(
  'workspace_snapshot_writer',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'workspace_snapshot_reader',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'workspace_snapshot_writer',
  $$insert into auth.users(
      id, email, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      'c9400000-0000-4000-8000-000000000099',
      'snapshot-concurrency@example.invalid', false, false, now(), now()
    )$$
);
select extensions.dblink_exec(
  'workspace_snapshot_writer',
  $$insert into public.outcomes(id, user_id, situation_text) values (
      'c9410000-0000-4000-8000-000000000099',
      'c9400000-0000-4000-8000-000000000099', 'Concurrent snapshot'
    )$$
);
select extensions.dblink_exec(
  'workspace_snapshot_writer',
  $$insert into public.documents(
      id, user_id, outcome_id, title, content, status, workspace_sections,
      format, current_revision
    ) values (
      'c9420000-0000-4000-8000-000000000099',
      'c9400000-0000-4000-8000-000000000099',
      'c9410000-0000-4000-8000-000000000099',
      'Concurrent document', '', 'draft', '[]', 'Word', 1
    )$$
);
select extensions.dblink_exec(
  'workspace_snapshot_writer',
  $$insert into public.sections(
      id, document_id, user_id, name, order_index, content, status,
      version_history, is_required, revision
    ) values (
      'c9430000-0000-4000-8000-000000000099',
      'c9420000-0000-4000-8000-000000000099',
      'c9400000-0000-4000-8000-000000000099',
      'Concurrent section', 0, 'Revision one.', 'draft', '[]', true, 1
    )$$
);
select extensions.dblink_exec(
  'workspace_snapshot_writer',
  $$set request.jwt.claim.sub = 'c9400000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec(
  'workspace_snapshot_reader',
  $$set request.jwt.claim.sub = 'c9400000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec('workspace_snapshot_writer', 'set role authenticated');
select extensions.dblink_exec('workspace_snapshot_reader', 'set role authenticated');
select extensions.dblink_exec('workspace_snapshot_writer', 'begin');
select is(
  (
    select result->>'section_revision'
    from extensions.dblink(
      'workspace_snapshot_writer',
      $$select public.save_legacy_section(
        'c9430000-0000-4000-8000-000000000099', 1,
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to('Revision one.', 'UTF8'), 'sha256'
        ), 'hex'),
        'Revision two.', 'edited'
      )$$
    ) as remote_result(result jsonb)
  ),
  '2',
  'the concurrent writer advances the section under an uncommitted transaction'
);
select results_eq(
  $$select
      (snapshot->'document'->>'current_revision')::integer,
      (snapshot->'sections'->0->>'revision')::integer,
      snapshot->'sections'->0->>'content'
    from extensions.dblink(
      'workspace_snapshot_reader',
      $remote$select public.get_workspace_snapshot_v1(
        'c9410000-0000-4000-8000-000000000099', null
      )$remote$
    ) as remote_snapshot(snapshot jsonb)$$,
  $$values (1, 1, 'Revision one.'::text)$$,
  'a reader sees the complete old document/section pair while the edit is uncommitted'
);
select extensions.dblink_exec('workspace_snapshot_writer', 'commit');
select results_eq(
  $$select
      (snapshot->'document'->>'current_revision')::integer,
      (snapshot->'sections'->0->>'revision')::integer,
      snapshot->'sections'->0->>'content'
    from extensions.dblink(
      'workspace_snapshot_reader',
      $remote$select public.get_workspace_snapshot_v1(
        'c9410000-0000-4000-8000-000000000099', null
      )$remote$
    ) as remote_snapshot(snapshot jsonb)$$,
  $$values (2, 2, 'Revision two.'::text)$$,
  'the next snapshot sees the complete committed document/section pair'
);
select is(
  extensions.dblink_send_query(
    'workspace_snapshot_reader',
    $$select public.get_workspace_section_body_v1(
      'c9410000-0000-4000-8000-000000000099',
      'c9430000-0000-4000-8000-000000000099', 1, 1
    )$$
  ),
  1,
  'the reader sends its stale pre-edit body identity after commit'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from extensions.dblink_get_result('workspace_snapshot_reader', false)
      as remote_result(result jsonb)
  ),
  0,
  'stale section activation returns no body'
);
select ok(
  extensions.dblink_error_message('workspace_snapshot_reader')
    like '%WORKSPACE_SECTION_BODY_STALE%',
  'stale section activation receives the stable revision-conflict code'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result(
      'workspace_snapshot_reader', false
    ) as drained_result(result jsonb)
  ),
  0,
  'the asynchronous stale-body error is fully drained before connection cleanup'
);
select extensions.dblink_exec('workspace_snapshot_writer', 'reset role');
select extensions.dblink_exec('workspace_snapshot_reader', 'reset role');
select extensions.dblink_exec(
  'workspace_snapshot_writer',
  $$delete from auth.users
    where id = 'c9400000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_disconnect('workspace_snapshot_reader');
select extensions.dblink_disconnect('workspace_snapshot_writer');

select * from finish();
rollback;
