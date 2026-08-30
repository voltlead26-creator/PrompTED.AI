begin;

create extension if not exists pgtap with schema extensions;
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

create or replace function pg_temp.guest_sections(
  p_user_id uuid,
  p_document_id uuid,
  p_first_section_id uuid,
  p_second_section_id uuid,
  p_second_content text default 'Preserved supporting detail'
) returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_array(
    jsonb_build_object(
      'id', p_first_section_id,
      'document_id', p_document_id,
      'user_id', p_user_id,
      'name', 'Summary',
      'order_index', 0,
      'content', 'Preserved guest summary',
      'status', 'edited',
      'version_history', jsonb_build_array(
        jsonb_build_object(
          'content', 'Earlier guest summary',
          'saved_at', '2026-08-30T01:00:00.000Z',
          'label', 'Imported original',
          'origin', 'imported_original'
        )
      ),
      'is_required', true,
      'created_at', '2026-08-30T00:00:00.000Z',
      'updated_at', '2026-08-30T01:00:00.000Z'
    ),
    jsonb_build_object(
      'id', p_second_section_id,
      'document_id', p_document_id,
      'user_id', p_user_id,
      'name', 'Details',
      'order_index', 1,
      'content', p_second_content,
      'status', 'draft',
      'version_history', '[]'::jsonb,
      'is_required', false,
      'created_at', '2026-08-30T00:00:00.000Z',
      'updated_at', '2026-08-30T00:00:00.000Z'
    )
  )
$function$;

create or replace function pg_temp.guest_import_sql(
  p_idempotency_key text,
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_first_section_id uuid,
  p_second_section_id uuid,
  p_second_content text default 'Preserved supporting detail'
) returns text
language sql
set search_path = ''
as $function$
  select format(
    'select public.commit_guest_workspace_import(%L,%L::uuid,%L::uuid,%L,%L,%L::jsonb,%L::uuid,%L,%L::jsonb)',
    p_idempotency_key,
    p_outcome_id,
    p_document_id,
    p_title,
    'Synthetic guest situation',
    '{"primary":{"template_id":"resume","reason":"Synthetic test"},"alternatives":[]}',
    'a1000000-0000-4000-8000-000000000001',
    'draft',
    pg_temp.guest_sections(
      p_user_id, p_document_id, p_first_section_id,
      p_second_section_id, p_second_content
    )
  )
$function$;

select has_table(
  'private', 'guest_workspace_imports',
  'private hash-only guest import receipts exist'
);
select has_function(
  'public',
  'commit_guest_workspace_import',
  array['text','uuid','uuid','text','text','jsonb','uuid','text','jsonb'],
  'the one-call authenticated guest import RPC exists'
);
select ok(
  (
    select table_record.relrowsecurity
    from pg_class table_record
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'private'
      and table_record.relname = 'guest_workspace_imports'
  ),
  'the private receipt table has RLS enabled'
);
select ok(
  not has_table_privilege(
    'authenticated', 'private.guest_workspace_imports', 'SELECT'
  )
  and not has_table_privilege(
    'authenticated', 'private.guest_workspace_imports', 'INSERT'
  )
  and not has_table_privilege(
    'service_role', 'private.guest_workspace_imports', 'SELECT'
  ),
  'no client or service role receives direct private receipt access'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.commit_guest_workspace_import(text,uuid,uuid,text,text,jsonb,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated callers can execute only the guarded import command'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.commit_guest_workspace_import(text,uuid,uuid,text,text,jsonb,uuid,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.commit_guest_workspace_import(text,uuid,uuid,text,text,jsonb,uuid,text,jsonb)',
    'EXECUTE'
  ),
  'anonymous and service roles cannot invoke the authenticated import RPC'
);
select is(
  (
    select count(*)::integer
    from pg_proc function_record
    join pg_namespace schema_record on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname = 'commit_guest_workspace_import'
      and function_record.prosecdef
      and array_to_string(function_record.proconfig, ',') in (
        'search_path=', 'search_path=""'
      )
  ),
  1,
  'the import RPC is SECURITY DEFINER with an empty search path'
);
select ok(
  not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'private'
      and column_record.table_name = 'guest_workspace_imports'
      and column_record.column_name in (
        'title', 'situation_text', 'recommendation_payload',
        'sections', 'content', 'version_history'
      )
  ),
  'the immutable receipt does not duplicate user document bodies'
);

insert into public.templates(
  id, name, domain, category, plain_description, structure_type
) values (
  'a1000000-0000-4000-8000-000000000001',
  'Synthetic guest import template',
  'employment',
  'test',
  'Synthetic template used only inside the rolled-back pgTAP transaction.',
  'compose'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('a2000000-0000-4000-8000-000000000001', 'guest-owner@example.invalid', false, false, now(), now()),
  ('a2000000-0000-4000-8000-000000000002', 'guest-other@example.invalid', false, false, now(), now()),
  ('a2000000-0000-4000-8000-000000000003', 'guest-delete@example.invalid', false, false, now(), now());

select set_config(
  'request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.commit_guest_workspace_import(
    'guest-workspace:fresh',
    'a3000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'Guest resume',
    'Synthetic guest situation',
    '{"primary":{"template_id":"resume","reason":"Synthetic test"},"alternatives":[]}',
    'a1000000-0000-4000-8000-000000000001',
    'draft',
    pg_temp.guest_sections(
      'a2000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000002'
    )
  ),
  jsonb_build_object(
    'status', 'committed',
    'outcome_id', 'a3000000-0000-4000-8000-000000000001'::uuid,
    'document_id', 'a4000000-0000-4000-8000-000000000001'::uuid,
    'idempotent_replay', false
  ),
  'a fresh call commits the complete workspace and returns the stable contract'
);
select is(
  (
    select count(*)::integer
    from public.outcomes outcome_record
    join public.documents document_record
      on document_record.outcome_id = outcome_record.id
    where outcome_record.id = 'a3000000-0000-4000-8000-000000000001'
      and outcome_record.user_id = auth.uid()
      and outcome_record.is_saved
      and document_record.id = 'a4000000-0000-4000-8000-000000000001'
      and document_record.user_id = auth.uid()
      and document_record.ledger_binding_status = 'legacy_unversioned'
  ),
  1,
  'fresh import creates one saved owner outcome and legacy-compatible document'
);
select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'content', section_record.content,
        'version_history', section_record.version_history
      ) order by section_record.order_index
    )
    from public.sections section_record
    where section_record.document_id = 'a4000000-0000-4000-8000-000000000001'
      and section_record.user_id = auth.uid()
  ),
  jsonb_build_array(
    jsonb_build_object(
      'content', 'Preserved guest summary',
      'version_history', jsonb_build_array(
        jsonb_build_object(
          'content', 'Earlier guest summary',
          'saved_at', '2026-08-30T01:00:00.000Z',
          'label', 'Imported original',
          'origin', 'imported_original'
        )
      )
    ),
    jsonb_build_object(
      'content', 'Preserved supporting detail',
      'version_history', '[]'::jsonb
    )
  ),
  'guest section content and version_history are preserved exactly'
);

update public.documents
set title = 'User title after import'
where id = 'a4000000-0000-4000-8000-000000000001';
update public.sections
set content = 'User wording after import'
where id = 'a5000000-0000-4000-8000-000000000001';

select is(
  public.commit_guest_workspace_import(
    'guest-workspace:fresh',
    'a3000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'Guest resume',
    'Synthetic guest situation',
    '{"primary":{"template_id":"resume","reason":"Synthetic test"},"alternatives":[]}',
    'a1000000-0000-4000-8000-000000000001',
    'draft',
    pg_temp.guest_sections(
      'a2000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000002'
    )
  ),
  jsonb_build_object(
    'status', 'committed',
    'outcome_id', 'a3000000-0000-4000-8000-000000000001'::uuid,
    'document_id', 'a4000000-0000-4000-8000-000000000001'::uuid,
    'idempotent_replay', true
  ),
  'an exact retry replays the completed receipt instead of running the import again'
);
select is(
  (
    select document_record.title || '|' || section_record.content
    from public.documents document_record
    join public.sections section_record
      on section_record.document_id = document_record.id
    where document_record.id = 'a4000000-0000-4000-8000-000000000001'
      and section_record.id = 'a5000000-0000-4000-8000-000000000001'
  ),
  'User title after import|User wording after import',
  'exact replay never overwrites wording changed after the completed import'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:fresh',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      'Mismatched replay title',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000002'
    ),
    '%GUEST_IMPORT_IDEMPOTENCY_MISMATCH%'
  ),
  'the same owner key rejects a request-hash mismatch'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:blank-title',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000011',
      'a4000000-0000-4000-8000-000000000011',
      '   ',
      'a5000000-0000-4000-8000-000000000011',
      'a5000000-0000-4000-8000-000000000012'
    ),
    '%GUEST_IMPORT_TITLE_INVALID%'
  ),
  'blank required input is rejected before any durable write'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.commit_guest_workspace_import(%L,%L::uuid,%L::uuid,%L,%L,%L::jsonb,%L::uuid,%L,%L::jsonb)',
      'guest-workspace:duplicate-id',
      'a3000000-0000-4000-8000-000000000012',
      'a4000000-0000-4000-8000-000000000012',
      'Duplicate section test',
      'Synthetic guest situation',
      '{"primary":{"template_id":"resume"}}',
      'a1000000-0000-4000-8000-000000000001',
      'draft',
      jsonb_set(
        pg_temp.guest_sections(
          'a2000000-0000-4000-8000-000000000001',
          'a4000000-0000-4000-8000-000000000012',
          'a5000000-0000-4000-8000-000000000021',
          'a5000000-0000-4000-8000-000000000022'
        ),
        '{1,id}',
        to_jsonb('a5000000-0000-4000-8000-000000000021'::text)
      )
    ),
    '%GUEST_IMPORT_DUPLICATE_SECTION_ID%'
  ),
  'duplicate section IDs are rejected'
);
select ok(
  pg_temp.raises_matching(
    format(
      'select public.commit_guest_workspace_import(%L,%L::uuid,%L::uuid,%L,%L,%L::jsonb,%L::uuid,%L,%L::jsonb)',
      'guest-workspace:duplicate-order',
      'a3000000-0000-4000-8000-000000000013',
      'a4000000-0000-4000-8000-000000000013',
      'Duplicate order test',
      'Synthetic guest situation',
      '{"primary":{"template_id":"resume"}}',
      'a1000000-0000-4000-8000-000000000001',
      'draft',
      jsonb_set(
        pg_temp.guest_sections(
          'a2000000-0000-4000-8000-000000000001',
          'a4000000-0000-4000-8000-000000000013',
          'a5000000-0000-4000-8000-000000000023',
          'a5000000-0000-4000-8000-000000000024'
        ),
        '{1,order_index}',
        '0'::jsonb
      )
    ),
    '%GUEST_IMPORT_SECTION_ORDER_INVALID%'
  ),
  'duplicate or non-contiguous section order is rejected'
);

insert into public.outcomes(
  id, user_id, situation_text, recommendation_payload, status, is_saved
) values (
  'a3000000-0000-4000-8000-000000000014',
  auth.uid(),
  'Interrupted earlier attempt',
  '{}'::jsonb,
  'draft',
  false
);
insert into public.documents(
  id, user_id, outcome_id, title, status
) values (
  'a4000000-0000-4000-8000-000000000014',
  auth.uid(),
  'a3000000-0000-4000-8000-000000000014',
  'Interrupted document',
  'draft'
);
insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  version_history, is_required
) values (
  'a5000000-0000-4000-8000-000000000025',
  'a4000000-0000-4000-8000-000000000014',
  auth.uid(),
  'Old partial section',
  0,
  'Partial content',
  'draft',
  '[]'::jsonb,
  true
);

select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:owner-collision',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000014',
      'a4000000-0000-4000-8000-000000000014',
      'Must not replace existing work',
      'a5000000-0000-4000-8000-000000000025',
      'a5000000-0000-4000-8000-000000000026'
    ),
    '%GUEST_IMPORT_OUTCOME_ID_COLLISION%'
  ),
  'same ownership never authorises replacement without an immutable receipt'
);

reset role;

select is(
  (
    select outcome_record.situation_text || '|' ||
      outcome_record.status || '|' ||
      document_record.title || '|' ||
      section_record.name || '|' ||
      section_record.content || '|' ||
      section_record.version_history::text || '|' ||
      (select count(*)::text from public.sections sibling
       where sibling.document_id = document_record.id) || '|' ||
      (select count(*)::text from private.guest_workspace_imports receipt
       where receipt.idempotency_key = 'guest-workspace:owner-collision')
    from public.documents document_record
    join public.outcomes outcome_record on outcome_record.id = document_record.outcome_id
    join public.sections section_record
      on section_record.document_id = document_record.id
    where document_record.id = 'a4000000-0000-4000-8000-000000000014'
      and document_record.user_id = auth.uid()
      and section_record.id = 'a5000000-0000-4000-8000-000000000025'
  ),
  'Interrupted earlier attempt|draft|Interrupted document|Old partial section|Partial content|[]|1|0',
  'a rejected collision preserves every existing row and creates no receipt'
);

select set_config(
  'request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true
);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:foreign-outcome',
      'a2000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000021',
      'Foreign outcome collision',
      'a5000000-0000-4000-8000-000000000031',
      'a5000000-0000-4000-8000-000000000032'
    ),
    '%GUEST_IMPORT_OUTCOME_ID_COLLISION%'
  ),
  'another tenant cannot claim the owner outcome ID'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:foreign-document',
      'a2000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000022',
      'a4000000-0000-4000-8000-000000000001',
      'Foreign document collision',
      'a5000000-0000-4000-8000-000000000033',
      'a5000000-0000-4000-8000-000000000034'
    ),
    '%GUEST_IMPORT_DOCUMENT_ID_COLLISION%'
  ),
  'another tenant cannot claim the owner document ID'
);
select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:foreign-section',
      'a2000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000023',
      'a4000000-0000-4000-8000-000000000023',
      'Foreign section collision',
      'a5000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000035'
    ),
    '%GUEST_IMPORT_SECTION_ID_COLLISION%'
  ),
  'another tenant cannot claim the owner section ID'
);

reset role;

create or replace function pg_temp.reject_guest_import_test_section()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.content = 'ROLLBACK_MARKER' then
    raise exception 'TEST_SECTION_INSERT_FAILURE';
  end if;
  return new;
end;
$function$;

create trigger reject_guest_import_test_section
  before insert on public.sections
  for each row execute function pg_temp.reject_guest_import_test_section();

select set_config(
  'request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
    pg_temp.guest_import_sql(
      'guest-workspace:rollback',
      'a2000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000031',
      'a4000000-0000-4000-8000-000000000031',
      'Rollback test',
      'a5000000-0000-4000-8000-000000000041',
      'a5000000-0000-4000-8000-000000000042',
      'ROLLBACK_MARKER'
    ),
    '%TEST_SECTION_INSERT_FAILURE%'
  ),
  'a section persistence failure aborts the complete import statement'
);

reset role;
drop trigger reject_guest_import_test_section on public.sections;

select is(
  (
    select
      (select count(*) from public.outcomes where id = 'a3000000-0000-4000-8000-000000000031')
      + (select count(*) from public.documents where id = 'a4000000-0000-4000-8000-000000000031')
      + (select count(*) from public.sections where document_id = 'a4000000-0000-4000-8000-000000000031')
      + (select count(*) from private.guest_workspace_imports where idempotency_key = 'guest-workspace:rollback')
  )::integer,
  0,
  'failed persistence rolls back outcome, document, sections, and receipt together'
);
select ok(
  pg_temp.raises_matching(
    $$update private.guest_workspace_imports
      set document_status = 'archived'
      where idempotency_key = 'guest-workspace:fresh'$$,
    '%IMMUTABLE_GUEST_WORKSPACE_IMPORT%'
  ),
  'a completed private receipt cannot be updated'
);
select ok(
  pg_temp.raises_matching(
    $$delete from private.guest_workspace_imports
      where idempotency_key = 'guest-workspace:fresh'$$,
    '%IMMUTABLE_GUEST_WORKSPACE_IMPORT%'
  ),
  'a completed private receipt cannot be deleted while its owner exists'
);

select set_config(
  'request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000003', true
);
set local role authenticated;

select is(
  public.commit_guest_workspace_import(
    'guest-workspace:account-delete',
    'a3000000-0000-4000-8000-000000000041',
    'a4000000-0000-4000-8000-000000000041',
    'Delete cascade test',
    'Synthetic guest situation',
    '{"primary":{"template_id":"resume"}}',
    null,
    'draft',
    pg_temp.guest_sections(
      'a2000000-0000-4000-8000-000000000003',
      'a4000000-0000-4000-8000-000000000041',
      'a5000000-0000-4000-8000-000000000051',
      'a5000000-0000-4000-8000-000000000052'
    )
  )->>'status',
  'committed',
  'a guest document without a recognised template commits through the authenticated RPC'
);

reset role;

select is(
  (
    select count(*)::integer
    from private.guest_workspace_imports
    where user_id = 'a2000000-0000-4000-8000-000000000003'
  ),
  1,
  'the account-deletion fixture has one immutable receipt before deletion'
);
select lives_ok(
  $$delete from auth.users
    where id = 'a2000000-0000-4000-8000-000000000003'$$,
  'account deletion is not blocked by the immutable receipt trigger'
);
select is(
  (
    select
      (select count(*) from private.guest_workspace_imports where user_id = 'a2000000-0000-4000-8000-000000000003')
      + (select count(*) from public.outcomes where user_id = 'a2000000-0000-4000-8000-000000000003')
      + (select count(*) from public.documents where user_id = 'a2000000-0000-4000-8000-000000000003')
      + (select count(*) from public.sections where user_id = 'a2000000-0000-4000-8000-000000000003')
  )::integer,
  0,
  'account deletion cascades the imported workspace and its private receipt'
);

select * from finish();
rollback;
