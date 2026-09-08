begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Use the same explicit projection and FK join as Profile's PostgREST read.
-- Invoker rights are deliberate: a definer helper would hide the defect.
create function pg_temp.profile_resume_projection() returns jsonb
language sql security invoker set search_path = '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', version.id, 'upload_id', version.upload_id,
    'slot', version.slot, 'accepted_at', version.accepted_at,
    'source_kind', version.source_kind,
    'uploads', jsonb_build_object(
      'file_name', upload.file_name, 'file_type', upload.file_type,
      'file_size_bytes', upload.file_size_bytes,
      'storage_path', upload.storage_path, 'extracted_text', upload.extracted_text
    )
  ) order by version.accepted_at desc), '[]'::jsonb)
  from public.profile_resume_versions version
  join public.uploads upload on upload.id = version.upload_id
  where version.user_id = auth.uid();
$function$;

select results_eq(
  $$select attname::text collate "C" from pg_catalog.pg_attribute
    where attrelid = 'public.uploads'::regclass and attnum > 0 and not attisdropped
      and has_column_privilege('authenticated', attrelid, attnum, 'SELECT')
    order by attname::text collate "C"$$,
  $$select name collate "C" from (values
    ('extracted_text'), ('file_name'), ('file_size_bytes'),
    ('file_type'), ('id'), ('storage_path')) expected(name)
    order by name collate "C"$$,
  'only six reviewed upload resource columns are readable'
);
select ok(not has_table_privilege('authenticated', 'public.uploads', 'SELECT'),
  'no blanket upload read grant exposes current or future processing columns');
select ok(not exists (
  select 1 from pg_catalog.pg_attribute
  where attrelid = 'public.uploads'::regclass and attnum > 0 and not attisdropped
    and (has_column_privilege('anon', attrelid, attnum, 'SELECT')
      or has_column_privilege('authenticated', attrelid, attnum, 'INSERT')
      or has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
      or has_column_privilege('authenticated', attrelid, attnum, 'REFERENCES'))
), 'anonymous reads and browser column writes remain unavailable');
select ok(not has_table_privilege('authenticated', 'public.uploads', 'DELETE,TRUNCATE,TRIGGER'),
  'browser destructive and trigger privileges remain unavailable');
select ok((select relrowsecurity from pg_catalog.pg_class
  where oid = 'public.uploads'::regclass), 'upload RLS remains enabled');

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('99061100-0000-4000-8000-000000000001', 'profile-read-a@example.invalid', false, false, now(), now()),
  ('99061100-0000-4000-8000-000000000002', 'profile-read-b@example.invalid', false, false, now(), now());
insert into public.uploads(id, user_id, storage_path, file_name, file_type, file_size_bytes, extracted_text)
values
  ('99061100-0000-4000-8000-000000000011', '99061100-0000-4000-8000-000000000001',
    '99061100-0000-4000-8000-000000000001/current/resume.pdf', 'A current.pdf', 'application/pdf', 120, 'A current original'),
  ('99061100-0000-4000-8000-000000000012', '99061100-0000-4000-8000-000000000001',
    '99061100-0000-4000-8000-000000000001/previous/resume.md', 'A previous.md', 'text/markdown', 110, 'A previous original'),
  ('99061100-0000-4000-8000-000000000021', '99061100-0000-4000-8000-000000000002',
    '99061100-0000-4000-8000-000000000002/current/resume.docx', 'B current.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 130, 'B current original');
insert into public.profile_resume_versions(user_id, upload_id, slot, accepted_at)
values
  ('99061100-0000-4000-8000-000000000001', '99061100-0000-4000-8000-000000000011', 'current', '2026-09-06T00:00:00Z'),
  ('99061100-0000-4000-8000-000000000001', '99061100-0000-4000-8000-000000000012', 'previous', '2026-09-05T00:00:00Z'),
  ('99061100-0000-4000-8000-000000000002', '99061100-0000-4000-8000-000000000021', 'current', '2026-09-06T00:00:00Z');
select is((select count(*) from public.uploads where id::text like '99061100-%'), 3::bigint,
  'all three positive upload fixtures exist before denial checks');
select is((select count(*) from public.profile_resume_versions where user_id::text like '99061100-%'), 3::bigint,
  'all current and previous resume relationships exist');

-- Reproduce the observed 403 against the previous grant boundary, then roll
-- back only this deliberate regression. No test changes hosted permissions.
create function pg_temp.prior_profile_read_failure() returns text
language plpgsql security invoker as $function$
begin
  revoke select (id, file_name, file_type, file_size_bytes, storage_path, extracted_text)
    on table public.uploads from authenticated;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    '{"sub":"99061100-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform pg_temp.profile_resume_projection();
  raise exception 'MISSING_GRANT_WAS_NOT_REPRODUCED';
exception when insufficient_privilege then
  -- The exception rolls back this subtransaction, including ACL and role.
  return sqlstate || ':' || sqlerrm;
end;
$function$;
select is(pg_temp.prior_profile_read_failure(), '42501:permission denied for table uploads',
  'the old ACL reproduces the exact production Profile failure');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99061100-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(jsonb_array_length(pg_temp.profile_resume_projection()), 2,
  'owner A can load both populated Profile resume slots');
select is(pg_temp.profile_resume_projection()#>>'{0,uploads,extracted_text}', 'A current original',
  'the current original wording is returned in accepted order');
select is(pg_temp.profile_resume_projection()#>>'{1,uploads,file_name}', 'A previous.md',
  'the previous original remains accessible');
select is((select count(id) from public.uploads), 2::bigint,
  'unfiltered upload reads expose only owner A rows');
select is((select count(id) from public.uploads where id = '99061100-0000-4000-8000-000000000021'), 0::bigint,
  'guessing owner B upload identity does not expose it');
select throws_ok('select ingest_claim_token, ingest_response from public.uploads', '42501',
  'permission denied for table uploads', 'private ingest tokens and replay bodies are not readable');
select throws_ok('select * from public.uploads', '42501',
  'permission denied for table uploads', 'wildcard upload projection cannot expose private fields');
select throws_ok($$update public.uploads set extracted_text = 'forged'$$, '42501',
  'permission denied for table uploads', 'read access cannot mutate original extraction');
select throws_ok('delete from public.uploads', '42501',
  'permission denied for table uploads', 'read access cannot delete originals');
select throws_ok($$insert into public.uploads(user_id, storage_path, file_name, file_type)
  values ('99061100-0000-4000-8000-000000000001', 'forged', 'forged.md', 'text/markdown')$$,
  '42501', 'permission denied for table uploads', 'read access cannot forge an uploaded resource');

select set_config('request.jwt.claims', '{"sub":"99061100-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is(jsonb_array_length(pg_temp.profile_resume_projection()), 1,
  'owner B has a positive independent profile read');
select is(pg_temp.profile_resume_projection()#>>'{0,uploads,extracted_text}', 'B current original',
  'changed owner receives their own original wording');
select is((select count(id) from public.uploads), 1::bigint,
  'changed owner cannot see the prior owner uploads');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is((select count(id) from public.uploads), 0::bigint,
  'a missing authenticated subject cannot read uploads');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select id, file_name from public.uploads', '42501',
  'permission denied for table uploads', 'anonymous callers cannot read even the resource projection');

reset role;
select is((select extracted_text from public.uploads where id = '99061100-0000-4000-8000-000000000011'),
  'A current original', 'denied mutations preserved the independent stored original');
select * from finish();
rollback;
