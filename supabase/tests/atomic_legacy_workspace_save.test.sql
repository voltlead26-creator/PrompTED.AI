begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean language plpgsql as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

create or replace function pg_temp.sha256(p_value text)
returns text language sql immutable set search_path = '' as $function$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_value, 'UTF8'), 'sha256'), 'hex'
  )
$function$;

create or replace function pg_temp.document_metadata(
  p_title text,
  p_status text default 'draft',
  p_template_id uuid default null,
  p_placeholders jsonb default '[]'::jsonb
) returns jsonb language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'title', p_title,
    'status', p_status,
    'template_id', p_template_id,
    'unresolved_placeholders', p_placeholders
  )
$function$;

select has_function(
  'public', 'save_own_legacy_workspace_v1',
  array['text', 'uuid', 'uuid', 'integer', 'jsonb', 'jsonb', 'jsonb'],
  'legacy document metadata and every section save through one atomic owner command'
);
select has_table(
  'private', 'legacy_workspace_save_receipts',
  'legacy aggregate saves retain one private immutable receipt authority'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_proc procedure_record
    where procedure_record.oid =
      'public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)'::regprocedure
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_own_legacy_workspace_v1(text,uuid,uuid,integer,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'the aggregate command is fixed-path, security-definer and authenticated-owner only'
);
select ok(
  (
    select table_record.relrowsecurity
    from pg_catalog.pg_class table_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'private'
      and table_record.relname = 'legacy_workspace_save_receipts'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'private.legacy_workspace_save_receipts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'private.legacy_workspace_save_receipts', 'SELECT'
  )
  and not exists (
    select 1 from information_schema.columns column_record
    where column_record.table_schema = 'private'
      and column_record.table_name = 'legacy_workspace_save_receipts'
      and column_record.column_name in (
        'content', 'title', 'unresolved_placeholders', 'source', 'evidence'
      )
  ),
  'the receipt table is inaccessible and has no user-content columns'
);

insert into public.templates(
  id, name, domain, category, plain_description, structure_type
) values (
  'f0100000-0000-4000-8000-000000000001',
  'Atomic legacy workspace fixture', 'business', 'test',
  'Synthetic rolled-back pgTAP fixture.', 'compose'
);
insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('f1000000-0000-4000-8000-000000000001', 'legacy-owner@example.invalid', false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'legacy-other@example.invalid', false, false, now(), now()),
  ('f1000000-0000-4000-8000-000000000003', 'legacy-delete@example.invalid', false, false, now(), now());
insert into public.outcomes(
  id, user_id, situation_text, recommendation_payload, status, is_saved
) values
  ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Create a proposal','{"primary":{"template_id":"proposal","reason":"Proposal"},"alternatives":[]}','in_progress',true),
  ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','Update a proposal','{"primary":{"template_id":"proposal","reason":"Proposal"},"alternatives":[]}','in_progress',true),
  ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','Atomic rejection fixture','{"primary":{"template_id":"proposal","reason":"Proposal"},"alternatives":[]}','in_progress',true),
  ('f2000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000002','Foreign fixture','{"primary":{"template_id":"proposal","reason":"Proposal"},"alternatives":[]}','in_progress',true),
  ('f2000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000001','Roster fixture','{"primary":{"template_id":"proposal","reason":"Proposal"},"alternatives":[]}','in_progress',true),
  ('f2000000-0000-4000-8000-000000000006','f1000000-0000-4000-8000-000000000003','Cascade fixture','{"primary":{"template_id":"proposal","reason":"Proposal"},"alternatives":[]}','in_progress',true);

create temporary table legacy_workspace_results(
  name text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on legacy_workspace_results to authenticated;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into legacy_workspace_results(name, result)
values (
  'created',
  public.save_own_legacy_workspace_v1(
    'legacy-create-1',
    'f2000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001',
    0, null,
    pg_temp.document_metadata(
      'Created proposal', 'draft', 'f0100000-0000-4000-8000-000000000001'
    ),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', 'f4000000-0000-4000-8000-000000000001',
        'expected', null,
        'desired', pg_catalog.jsonb_build_object(
          'name', 'Summary', 'order_index', 0,
          'status', 'draft', 'is_required', true
        ),
        'content', 'Created summary'
      ),
      pg_catalog.jsonb_build_object(
        'id', 'f4000000-0000-4000-8000-000000000002',
        'expected', null,
        'desired', pg_catalog.jsonb_build_object(
          'name', 'Details', 'order_index', 1,
          'status', 'draft', 'is_required', false
        ),
        'content', 'Created details'
      )
    )
  )
);
reset role;
select ok(
  (
    select result->>'contract_version' = 'legacy-workspace-save.v1'
      and result->>'state' = 'created'
      and result->>'accepted_document_revision' = '0'
      and result->>'document_revision' = '1'
      and pg_catalog.jsonb_array_length(result->'sections') = 2
      and result->>'idempotent_replay' = 'false'
    from legacy_workspace_results where name = 'created'
  ),
  'one creation command returns exact durable document and section revision truth'
);
select ok(
  (
    select document_record.title = 'Created proposal'
      and document_record.current_revision = 1
      and document_record.ledger_binding_status = 'legacy_unversioned'
      and pg_catalog.count(section_record.id) = 2
    from public.documents document_record
    join public.sections section_record on section_record.document_id = document_record.id
    where document_record.id = 'f3000000-0000-4000-8000-000000000001'
    group by document_record.title, document_record.current_revision,
      document_record.ledger_binding_status
  ),
  'atomic creation commits the parent and complete section roster together'
);

set local role authenticated;
insert into legacy_workspace_results(name, result)
values (
  'created-replay',
  public.save_own_legacy_workspace_v1(
    'legacy-create-1',
    'f2000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001',
    0, null,
    pg_temp.document_metadata(
      'Created proposal', 'draft', 'f0100000-0000-4000-8000-000000000001'
    ),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', 'f4000000-0000-4000-8000-000000000001',
        'expected', null,
        'desired', pg_catalog.jsonb_build_object(
          'name', 'Summary', 'order_index', 0,
          'status', 'draft', 'is_required', true
        ),
        'content', 'Created summary'
      ),
      pg_catalog.jsonb_build_object(
        'id', 'f4000000-0000-4000-8000-000000000002',
        'expected', null,
        'desired', pg_catalog.jsonb_build_object(
          'name', 'Details', 'order_index', 1,
          'status', 'draft', 'is_required', false
        ),
        'content', 'Created details'
      )
    )
  )
);
select ok(
  pg_temp.raises_matching(
    $$select public.save_own_legacy_workspace_v1(
      'legacy-create-1','f2000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000001',0,null,
      pg_temp.document_metadata('Changed replay'),
      jsonb_build_array(jsonb_build_object(
        'id','f4000000-0000-4000-8000-000000000099','expected',null,
        'desired',jsonb_build_object(
          'name','Changed','order_index',0,'status','draft','is_required',true
        ),'content','Changed'
      ))
    )$$,
    '%LEGACY_WORKSPACE_REPLAY_CONFLICT%'
  ),
  'one owner idempotency key cannot represent different workspace content'
);
reset role;
select ok(
  (
    select result->>'idempotent_replay' = 'true'
      and result->>'document_revision' = '1'
    from legacy_workspace_results where name = 'created-replay'
  )
  and (
    select current_revision = 1
    from public.documents where id = 'f3000000-0000-4000-8000-000000000001'
  ),
  'an acknowledgement retry replays without duplicate rows or revisions'
);

insert into public.documents(
  id, user_id, outcome_id, template_id, title, status,
  unresolved_placeholders, ledger_binding_status,
  current_revision, approved_revision
) values (
  'f3000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000002',
  'f0100000-0000-4000-8000-000000000001',
  'Existing proposal', 'approved', '[]', 'legacy_unversioned', 5, 5
);
insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  is_required, ledger_binding_status, revision, approved_revision
) values
  ('f4000000-0000-4000-8000-000000000011','f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','Summary',0,'Preserve unloaded wording','approved',true,'legacy_unversioned',3,3),
  ('f4000000-0000-4000-8000-000000000012','f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','Details',1,'Original loaded wording','approved',false,'legacy_unversioned',4,4);

set local role authenticated;
insert into legacy_workspace_results(name, result)
values (
  'updated',
  public.save_own_legacy_workspace_v1(
    'legacy-update-1',
    'f2000000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000002',
    5,
    pg_temp.document_metadata(
      'Existing proposal', 'approved', 'f0100000-0000-4000-8000-000000000001'
    ),
    pg_temp.document_metadata(
      'Updated proposal', 'approved', 'f0100000-0000-4000-8000-000000000001',
      '[{"id":"missing-fact","requiredForExport":true}]'
    ),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', 'f4000000-0000-4000-8000-000000000012',
        'expected', pg_catalog.jsonb_build_object(
          'revision', 4, 'content_sha256', pg_temp.sha256('Original loaded wording'),
          'name', 'Details', 'order_index', 1, 'status', 'approved', 'is_required', false
        ),
        'desired', pg_catalog.jsonb_build_object(
          'name', 'Details', 'order_index', 0, 'status', 'edited', 'is_required', false
        ),
        'content', 'Revised loaded wording'
      ),
      pg_catalog.jsonb_build_object(
        'id', 'f4000000-0000-4000-8000-000000000011',
        'expected', pg_catalog.jsonb_build_object(
          'revision', 3, 'content_sha256', pg_temp.sha256('Preserve unloaded wording'),
          'name', 'Summary', 'order_index', 0, 'status', 'approved', 'is_required', true
        ),
        'desired', pg_catalog.jsonb_build_object(
          'name', 'Summary', 'order_index', 1, 'status', 'approved', 'is_required', true
        )
      )
    )
  )
);
reset role;
select ok(
  (
    select title = 'Updated proposal' and status = 'edited'
      and current_revision = 8 and approved_revision is null
      and unresolved_placeholders = '[{"id":"missing-fact","requiredForExport":true}]'::jsonb
    from public.documents where id = 'f3000000-0000-4000-8000-000000000002'
  ),
  'two section changes plus metadata commit as one parent result and invalidate approval'
);
select ok(
  (
    select content = 'Preserve unloaded wording' and order_index = 1
      and status = 'edited' and revision = 4 and approved_revision is null
    from public.sections where id = 'f4000000-0000-4000-8000-000000000011'
  )
  and (
    select content = 'Revised loaded wording' and order_index = 0
      and revision = 5 and approved_revision is null
      and pg_catalog.jsonb_array_length(version_history) = 1
    from public.sections where id = 'f4000000-0000-4000-8000-000000000012'
  ),
  'metadata-only unloaded reorder preserves its body while loaded wording records history'
);
select ok(
  (
    select result->>'document_revision' = '8'
      and result->>'document_status' = 'edited'
      and pg_catalog.jsonb_array_length(result->'sections') = 2
      and result::text not like '%Revised loaded wording%'
      and result::text not like '%Updated proposal%'
    from legacy_workspace_results where name = 'updated'
  ),
  'the receipt returns complete metadata truth without duplicating user wording or title'
);

insert into public.documents(
  id, user_id, outcome_id, title, status,
  unresolved_placeholders, ledger_binding_status, current_revision
) values (
  'f3000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000003','Atomic original','draft','[]','legacy_unversioned',2
);
insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  is_required, ledger_binding_status, revision
) values
  ('f4000000-0000-4000-8000-000000000021','f3000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','First',0,'First original','draft',true,'legacy_unversioned',2),
  ('f4000000-0000-4000-8000-000000000022','f3000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','Second',1,'Second original','draft',true,'legacy_unversioned',3);

set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.save_own_legacy_workspace_v1(%L,%L::uuid,%L::uuid,%s,%L::jsonb,%L::jsonb,%L::jsonb)',
      'legacy-atomic-reject','f2000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000003',2,
      pg_temp.document_metadata('Atomic original'),
      pg_temp.document_metadata('Must not persist'),
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id','f4000000-0000-4000-8000-000000000021',
          'expected',pg_catalog.jsonb_build_object(
            'revision',2,'content_sha256',pg_temp.sha256('First original'),
            'name','First','order_index',0,'status','draft','is_required',true
          ),
          'desired',pg_catalog.jsonb_build_object(
            'name','First','order_index',0,'status','edited','is_required',true
          ),'content','First should roll back'
        ),
        pg_catalog.jsonb_build_object(
          'id','f4000000-0000-4000-8000-000000000022',
          'expected',pg_catalog.jsonb_build_object(
            'revision',3,'content_sha256',repeat('0',64),
            'name','Second','order_index',1,'status','draft','is_required',true
          ),
          'desired',pg_catalog.jsonb_build_object(
            'name','Second','order_index',1,'status','edited','is_required',true
          ),'content','Second stale'
        )
      )
    ),
    '%LEGACY_WORKSPACE_SECTION_CONFLICT%'
  ),
  'a stale later section rejects before the first section or document can mutate'
);
reset role;
select is(
  (
    select document_record.title || '|' || first_section.content || '|' || second_section.content
    from public.documents document_record
    join public.sections first_section on first_section.id = 'f4000000-0000-4000-8000-000000000021'
    join public.sections second_section on second_section.id = 'f4000000-0000-4000-8000-000000000022'
    where document_record.id = 'f3000000-0000-4000-8000-000000000003'
  ),
  'Atomic original|First original|Second original',
  'aggregate rejection leaves the complete prior workspace intact'
);
select is(
  (select pg_catalog.count(*)::integer from private.legacy_workspace_save_receipts
    where idempotency_key = 'legacy-atomic-reject'),
  0,
  'a rejected aggregate creates no misleading receipt'
);

insert into public.documents(
  id, user_id, outcome_id, title, status,
  unresolved_placeholders, ledger_binding_status, current_revision
) values (
  'f3000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000005','Roster original','draft','[]','legacy_unversioned',1
);
insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  is_required, ledger_binding_status, revision
) values
  ('f4000000-0000-4000-8000-000000000051','f3000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000001','Known',0,'Known body','draft',true,'legacy_unversioned',1),
  ('f4000000-0000-4000-8000-000000000052','f3000000-0000-4000-8000-000000000005','f1000000-0000-4000-8000-000000000001','Concurrent',1,'Concurrent body','draft',false,'legacy_unversioned',1);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    format(
      'select public.save_own_legacy_workspace_v1(%L,%L::uuid,%L::uuid,1,%L::jsonb,%L::jsonb,%L::jsonb)',
      'legacy-roster-conflict','f2000000-0000-4000-8000-000000000005',
      'f3000000-0000-4000-8000-000000000005',
      pg_temp.document_metadata('Roster original'),
      pg_temp.document_metadata('Roster desired'),
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id','f4000000-0000-4000-8000-000000000051',
        'expected',pg_catalog.jsonb_build_object(
          'revision',1,'content_sha256',pg_temp.sha256('Known body'),
          'name','Known','order_index',0,'status','draft','is_required',true
        ),
        'desired',pg_catalog.jsonb_build_object(
          'name','Known','order_index',0,'status','draft','is_required',true
        )
      ))
    ),
    '%LEGACY_WORKSPACE_SECTION_ROSTER_CONFLICT%'
  ),
  'a concurrently inserted legacy section cannot be omitted from the expected roster'
);
select ok(
  pg_temp.raises_matching(
    $$select public.save_own_legacy_workspace_v1(
      'legacy-foreign','f2000000-0000-4000-8000-000000000004',
      'f3000000-0000-4000-8000-000000000099',0,null,
      pg_temp.document_metadata('Foreign attempt'),
      jsonb_build_array(jsonb_build_object(
        'id','f4000000-0000-4000-8000-000000000099','expected',null,
        'desired',jsonb_build_object(
          'name','Foreign','order_index',0,'status','draft','is_required',true
        ),'content','Forbidden'
      ))
    )$$,
    '%LEGACY_WORKSPACE_UNAVAILABLE%'
  ),
  'a guessed foreign outcome is non-disclosing and cannot be mutated'
);
reset role;

select ok(
  pg_temp.raises_matching(
    $$update private.legacy_workspace_save_receipts set request_sha256 = repeat('0', 64)$$,
    '%LEGACY_WORKSPACE_RECEIPT_IMMUTABLE%'
  )
  and not exists (
    select 1 from private.legacy_workspace_save_receipts receipt_record
    where receipt_record.result::text like '%Created summary%'
      or receipt_record.result::text like '%Updated proposal%'
  ),
  'receipts are immutable and contain no document wording or title'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000003', true
);
set local role authenticated;
insert into legacy_workspace_results(name, result)
values (
  'cascade',
  public.save_own_legacy_workspace_v1(
    'legacy-cascade-1','f2000000-0000-4000-8000-000000000006',
    'f3000000-0000-4000-8000-000000000006',0,null,
    pg_temp.document_metadata('Cascade document'),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id','f4000000-0000-4000-8000-000000000061','expected',null,
      'desired',pg_catalog.jsonb_build_object(
        'name','Cascade','order_index',0,'status','draft','is_required',true
      ),'content','Cascade content'
    ))
  )
);
reset role;
delete from auth.users where id = 'f1000000-0000-4000-8000-000000000003';
select is(
  (select pg_catalog.count(*)::integer from private.legacy_workspace_save_receipts
    where user_id = 'f1000000-0000-4000-8000-000000000003'),
  0,
  'account deletion may cascade its otherwise immutable aggregate receipts'
);

select * from finish();
rollback;
