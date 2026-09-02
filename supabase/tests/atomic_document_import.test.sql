begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

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

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'public'
      and procedure_record.proname = 'commit_document_import'
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
      and pg_catalog.has_function_privilege('authenticated', procedure_record.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', procedure_record.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', procedure_record.oid, 'EXECUTE')
  ),
  'document import is an authenticated-only fixed-path SECURITY DEFINER command'
);
select ok(
  not has_table_privilege('authenticated', 'public.uploads', 'SELECT')
    and not has_table_privilege('authenticated', 'public.uploads', 'INSERT')
    and not has_table_privilege('authenticated', 'public.uploads', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.uploads', 'DELETE'),
  'the import command does not grant upload-table access to the browser'
);
select ok(
  not has_table_privilege('authenticated', 'public.sections', 'DELETE'),
  'the import command does not grant section DELETE to the browser'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'import-owner@example.invalid', false, false, now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'import-foreign@example.invalid', false, false, now(), now());

insert into public.uploads(
  id, user_id, storage_path, file_type, file_name, status
)
values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner/success.pdf', 'application/pdf', 'success.pdf', 'ready'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'owner/invalid.pdf', 'application/pdf', 'invalid.pdf', 'ready'),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'owner/foreign-outcome.pdf', 'application/pdf', 'foreign-outcome.pdf', 'ready'),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', 'owner/foreign-document.pdf', 'application/pdf', 'foreign-document.pdf', 'ready'),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000002', 'foreign/upload.pdf', 'application/pdf', 'upload.pdf', 'ready');

insert into public.outcomes(id, user_id, situation_text)
values (
  'a3000000-0000-4000-8000-000000000099',
  'a1000000-0000-4000-8000-000000000002',
  'Foreign outcome'
);
insert into public.documents(id, user_id, outcome_id, title, status)
values (
  'a4000000-0000-4000-8000-000000000099',
  'a1000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000099',
  'Foreign document',
  'draft'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select is(
  public.commit_document_import(
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'Imported resume',
    'Tailor my resume',
    '{"route":"resume"}'::jsonb,
    '[
      {"id":"a5000000-0000-4000-8000-000000000001","name":"Summary","order_index":0,"content":"Grounded summary","status":"edited","is_required":true},
      {"id":"a5000000-0000-4000-8000-000000000002","name":"Experience","order_index":1,"content":"Grounded experience","status":"draft","is_required":true}
    ]'::jsonb
  )#>>'{idempotent_replay}',
  'false',
  'an authenticated owner can atomically commit a valid import'
);

reset role;
select ok(
  exists (
    select 1
    from public.uploads
    where id = 'a2000000-0000-4000-8000-000000000001'
      and user_id = 'a1000000-0000-4000-8000-000000000001'
      and outcome_id = 'a3000000-0000-4000-8000-000000000001'
      and document_id = 'a4000000-0000-4000-8000-000000000001'
      and status = 'committed'
      and completed_at is not null
  ) and exists (
    select 1
    from public.outcomes
    where id = 'a3000000-0000-4000-8000-000000000001'
      and user_id = 'a1000000-0000-4000-8000-000000000001'
  ) and exists (
    select 1
    from public.documents
    where id = 'a4000000-0000-4000-8000-000000000001'
      and user_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'successful import persists one owner-scoped upload/outcome/document unit'
);
select is(
  (
    select count(*)::integer
    from public.sections
    where document_id = 'a4000000-0000-4000-8000-000000000001'
      and user_id = 'a1000000-0000-4000-8000-000000000001'
  ),
  2,
  'successful import persists every validated section exactly once'
);

set local role authenticated;
select is(
  public.commit_document_import(
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000099',
    'a4000000-0000-4000-8000-000000000099',
    'Replay must not rewrite',
    'Replay must not rewrite',
    '{}'::jsonb,
    '[]'::jsonb
  )#>>'{idempotent_replay}',
  'true',
  'the owner-scoped committed upload is an idempotent replay record'
);
reset role;
select ok(
  (
    select title = 'Imported resume'
    from public.documents
    where id = 'a4000000-0000-4000-8000-000000000001'
  ) and (
    select count(*) = 2
    from public.sections
    where document_id = 'a4000000-0000-4000-8000-000000000001'
  ),
  'an idempotent replay cannot replace the committed document or sections'
);

set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.commit_document_import(
      'a2000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000002',
      'a4000000-0000-4000-8000-000000000002',
      'Invalid sections', 'Invalid sections', '{}'::jsonb, '{}'::jsonb
    )$$,
    '%IMPORT_SECTIONS_INVALID%'
  ),
  'document import rejects a non-array section payload'
);
reset role;
select ok(
  not exists (
    select 1 from public.outcomes
    where id = 'a3000000-0000-4000-8000-000000000002'
  ) and exists (
    select 1 from public.uploads
    where id = 'a2000000-0000-4000-8000-000000000002'
      and status = 'ready'
      and outcome_id is null
      and document_id is null
  ),
  'invalid section validation leaves the complete import unit untouched'
);

set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.commit_document_import(
      'a2000000-0000-4000-8000-000000000002',
      'a3000000-0000-4000-8000-000000000002',
      'a4000000-0000-4000-8000-000000000002',
      'Invalid member', 'Invalid member', '{}'::jsonb, '[1]'::jsonb
    )$$,
    '%IMPORT_SECTIONS_INVALID%'
  ),
  'document import rejects non-object section members'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_document_import(
      'a2000000-0000-4000-8000-000000000003',
      'a3000000-0000-4000-8000-000000000099',
      'a4000000-0000-4000-8000-000000000003',
      'Collision', 'Collision', '{}'::jsonb, '[]'::jsonb
    )$$,
    '%OUTCOME_ID_CONFLICT%'
  ),
  'document import explicitly rejects a foreign outcome ID collision'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_document_import(
      'a2000000-0000-4000-8000-000000000004',
      'a3000000-0000-4000-8000-000000000004',
      'a4000000-0000-4000-8000-000000000099',
      'Collision', 'Collision', '{}'::jsonb, '[]'::jsonb
    )$$,
    '%DOCUMENT_ID_CONFLICT%'
  ),
  'document import explicitly rejects a foreign document ID collision'
);
reset role;
select ok(
  not exists (
    select 1 from public.outcomes
    where id = 'a3000000-0000-4000-8000-000000000004'
  ) and (
    select count(*) = 2 from public.uploads
    where id in (
      'a2000000-0000-4000-8000-000000000003',
      'a2000000-0000-4000-8000-000000000004'
    )
      and status = 'ready'
      and outcome_id is null
      and document_id is null
  ),
  'foreign-ID rejection rolls back every attempted import write'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  'a1000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.commit_document_import(
      'a2000000-0000-4000-8000-000000000005',
      'a3000000-0000-4000-8000-000000000005',
      'a4000000-0000-4000-8000-000000000005',
      'Cross owner', 'Cross owner', '{}'::jsonb, '[]'::jsonb
    )$$,
    '%UPLOAD_NOT_FOUND%'
  ),
  'an authenticated caller cannot commit or replay another owner upload'
);

reset role;
select * from finish();
rollback;
