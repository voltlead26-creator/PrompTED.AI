begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function(
  'public',
  'load_upload_extraction_snapshot',
  array['uuid', 'uuid', 'text', 'uuid'],
  'the parser boundary loads one exact durable upload claim'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.load_upload_extraction_snapshot(uuid,uuid,text,uuid)'
  ) is not null and
  pg_catalog.has_function_privilege(
    'service_role',
    'public.load_upload_extraction_snapshot(uuid,uuid,text,uuid)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.load_upload_extraction_snapshot(uuid,uuid,text,uuid)',
    'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'anon',
    'public.load_upload_extraction_snapshot(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'only protected service compute can load an extraction snapshot'
);

select ok(
  pg_catalog.to_regprocedure(
    'public.load_upload_extraction_snapshot(uuid,uuid,text,uuid)'
  ) is not null and exists (
    select 1
    from pg_catalog.pg_proc function_record
    where function_record.oid =
      'public.load_upload_extraction_snapshot(uuid,uuid,text,uuid)'::regprocedure
      and function_record.prosecdef
      and function_record.provolatile = 's'
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  'the snapshot command is stable and fixed-path'
);

insert into auth.users(
  id, email, is_sso_user, is_anonymous, created_at, updated_at
) values (
  '71000000-0000-4000-8000-000000000011',
  'extract-snapshot@example.invalid', false, false, now(), now()
);

set local role service_role;
select is(
  public.claim_upload_ingest(
    '72000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000011/72000000-0000-4000-8000-000000000011/resume.txt',
    'txt', 'resume.txt', 20, repeat('a', 64), repeat('b', 64)
  )->>'outcome',
  'accepted',
  'the extraction fixture has one accepted durable operation'
);
select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000011',
  '71000000-0000-4000-8000-000000000011',
  repeat('a', 64),
  (select ingest_claim_token from public.uploads
   where id = '72000000-0000-4000-8000-000000000011'),
  'prepared', 'storage_dispatched'
);
select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000011',
  '71000000-0000-4000-8000-000000000011',
  repeat('a', 64),
  (select ingest_claim_token from public.uploads
   where id = '72000000-0000-4000-8000-000000000011'),
  'storage_dispatched', 'storage_completed'
);

select is(
  public.load_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000011',
    repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000011')
  ),
  jsonb_build_object(
    'upload_id', '72000000-0000-4000-8000-000000000011'::uuid,
    'user_id', '71000000-0000-4000-8000-000000000011'::uuid,
    'request_sha256', repeat('a', 64),
    'claim_token', (select ingest_claim_token from public.uploads
      where id = '72000000-0000-4000-8000-000000000011'),
    'storage_path', '71000000-0000-4000-8000-000000000011/72000000-0000-4000-8000-000000000011/resume.txt',
    'filename', 'resume.txt',
    'file_type', 'txt',
    'byte_length', 20,
    'content_sha256', repeat('b', 64),
    'stage', 'storage_completed'
  ),
  'the snapshot comes entirely from the current durable claim'
);

select is(
  public.load_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000011', repeat('f', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000011')
  ), null::jsonb,
  'a different request digest cannot select the upload'
);
select is(
  public.load_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000011', repeat('a', 64),
    '73000000-0000-4000-8000-000000000099'
  ), null::jsonb,
  'a stale claim token cannot select the upload'
);

reset role;
update public.uploads
set ingest_heartbeat_at = clock_timestamp() - interval '2 seconds',
    ingest_lease_expires_at = clock_timestamp() - interval '1 second'
where id = '72000000-0000-4000-8000-000000000011';
set local role service_role;
select is(
  public.load_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000011',
    '71000000-0000-4000-8000-000000000011', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000011')
  ), null::jsonb,
  'an expired lease cannot start extraction'
);

reset role;
select * from finish();
rollback;
