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

select ok(
  exists (
    select 1
    from storage.buckets bucket_record
    where bucket_record.id = 'assets'
      and bucket_record.name = 'assets'
      and bucket_record.public
      and bucket_record.file_size_limit = 5242880
      and pg_catalog.cardinality(bucket_record.allowed_mime_types) = 3
      and bucket_record.allowed_mime_types @>
        array['image/png', 'image/jpeg', 'image/webp']::text[]
  ),
  'the public assets bucket has the exact reviewed size and MIME contract'
);

select is(
  (
    select pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          policy_record.permissive || '|' || policy_record.cmd || '|' ||
          pg_catalog.array_to_string(policy_record.roles, ',') || '|' ||
          pg_catalog.regexp_replace(
            coalesce(policy_record.qual, ''), E'\\s+', ' ', 'g'
          ) || '|' ||
          pg_catalog.regexp_replace(
            coalesce(policy_record.with_check, ''), E'\\s+', ' ', 'g'
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'storage'
      and policy_record.tablename = 'objects'
      and policy_record.policyname = 'assets_authenticated_owner_select'
  ),
  '0485089deeacb96a541a044cb1891974bc333749128486cd04778b7d41821b09',
  'brand asset reads retain the exact permissive owner-only policy definition'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_policies policy_record
    where policy_record.schemaname = 'storage'
      and policy_record.tablename = 'objects'
      and policy_record.permissive = 'PERMISSIVE'
      and policy_record.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and policy_record.roles && array[
        'public'::name, 'anon'::name, 'authenticated'::name
      ]
  ),
  0,
  'every direct browser Storage mutation policy remains retired'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_record.pronamespace
    where schema_record.nspname = 'private'
      and procedure_record.proname = 'enforce_user_storage_deletion_fence'
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
      and not pg_catalog.has_function_privilege(
        'anon', procedure_record.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'authenticated', procedure_record.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege(
        'service_role', procedure_record.oid, 'EXECUTE'
      )
  ),
  'the deletion fence remains a fixed-path non-callable security definer'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('b1000000-0000-4000-8000-000000000001', 'brand-owner@example.invalid', false, false, now(), now()),
  ('b1000000-0000-4000-8000-000000000002', 'brand-other@example.invalid', false, false, now(), now());

insert into public.businesses(id, owner_user_id, trading_name)
values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'Owner Business'),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'Other Business');

insert into storage.objects(bucket_id, name, metadata)
values (
  'assets',
  'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png',
  '{"owner":"original"}'::jsonb
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
  $$insert into storage.objects(bucket_id, name, metadata)
    values (
      'assets',
      'brand-kits/b2000000-0000-4000-8000-000000000001/logo.webp',
      '{"owner":"browser"}'::jsonb
    )$$,
    '%row-level security%'
  ),
  'an authenticated owner cannot insert a logo outside the protected lifecycle'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'
  ),
  1,
  'the owner can observe the canonical logo row'
);
select lives_ok(
  $$update storage.objects
    set metadata = '{"owner":"updated"}'::jsonb
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'$$,
  'a direct owner overwrite is filtered by the read-only assets policy'
);

reset role;
select ok(
  pg_temp.raises_matching(
    $$insert into storage.objects(bucket_id, name) values
      ('assets', 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.svg')$$,
    '%BRAND_ASSET_PATH_INVALID%'
  ) and pg_temp.raises_matching(
    $$insert into storage.objects(bucket_id, name) values
      ('assets', 'brand-kits/b2000000-0000-4000-8000-000000000001/nested/logo.png')$$,
    '%BRAND_ASSET_PATH_INVALID%'
  ) and pg_temp.raises_matching(
    $$insert into storage.objects(bucket_id, name) values
      ('assets', 'brand-kits/not-a-uuid/logo.png')$$,
    '%BRAND_ASSET_PATH_INVALID%'
  ),
  'noncanonical extension, nesting, and business identifiers fail closed'
);
select ok(
  pg_temp.raises_matching(
    $$insert into storage.objects(bucket_id, name) values
      ('assets', 'brand-kits/b2000000-0000-4000-8000-000000000099/logo.webp')$$,
    '%BRAND_ASSET_BUSINESS_UNAVAILABLE%'
  ),
  'a missing business cannot become a public brand prefix'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000002', true
);
set local role authenticated;

select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'
  ),
  0,
  'another authenticated owner cannot observe the logo row through Data API RLS'
);
select ok(
  pg_temp.raises_matching(
    $$insert into storage.objects(bucket_id, name) values
      ('assets', 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.jpg')$$,
    '%row-level security%'
  ),
  'another owner cannot insert under the first business prefix'
);
select lives_ok(
  $$update storage.objects
    set metadata = '{"owner":"foreign"}'::jsonb
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'$$,
  'a foreign overwrite is filtered without exposing the row'
);

reset role;
select is(
  (
    select metadata->>'owner'
    from storage.objects
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'
  ),
  'original',
  'the filtered foreign overwrite leaves owner data unchanged'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$delete from storage.objects
      where bucket_id = 'assets'
        and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'$$,
    '%Direct deletion from storage tables is not allowed%'
  ),
  'Supabase rejects direct authenticated deletion in addition to the RPC-only policy'
);

reset role;
select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'
  ),
  1,
  'the read-only policy leaves the logo present'
);

set local role service_role;
select is(
  public.begin_account_deletion_fence(
    'b1000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'ready',
  'brand Storage alone does not create unresolved external work'
);
reset role;

select ok(
  pg_temp.raises_matching(
    $$insert into storage.objects(bucket_id, name) values
      ('assets', 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.webp')$$,
    '%ACCOUNT_DELETION_FENCED%'
  ),
  'a new logo cannot commit after the owner deletion tombstone'
);
select ok(
  pg_temp.raises_matching(
    $$update storage.objects
      set metadata = '{"owner":"late"}'::jsonb
      where bucket_id = 'assets'
        and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'$$,
    '%ACCOUNT_DELETION_FENCED%'
  ),
  'an existing logo cannot be rewritten after the owner deletion tombstone'
);

select pg_catalog.set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'assets'
  and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png';
select pg_catalog.set_config('storage.allow_delete_query', 'false', true);
select is(
  (
    select pg_catalog.count(*)::integer
    from storage.objects
    where bucket_id = 'assets'
      and name = 'brand-kits/b2000000-0000-4000-8000-000000000001/logo.png'
  ),
  0,
  'elevated account cleanup can still delete the fenced logo'
);

select * from finish();
rollback;
