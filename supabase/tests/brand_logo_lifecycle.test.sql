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
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'brand_kits'
      and column_name = 'revision'
      and data_type = 'bigint'
  ) and to_regclass('private.brand_logo_operations') is not null,
  'brand kits expose revision truth and private durable operation receipts'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.brand_kits', 'INSERT')
    and not pg_catalog.has_table_privilege('authenticated', 'public.brand_kits', 'UPDATE')
    and not pg_catalog.has_table_privilege('authenticated', 'public.brand_kits', 'DELETE')
    and pg_catalog.has_table_privilege('authenticated', 'public.brand_kits', 'SELECT')
    and not pg_catalog.has_table_privilege('service_role', 'public.brand_kits', 'INSERT')
    and not pg_catalog.has_table_privilege('service_role', 'public.brand_kits', 'UPDATE')
    and not pg_catalog.has_table_privilege('service_role', 'public.brand_kits', 'DELETE'),
  'the browser may read, while browser and service callers cannot bypass lifecycle RPC mutation'
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
  'authenticated brand reads retain the exact owner-only policy definition'
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
  'authenticated callers retain no direct Storage mutation policy'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('b3000000-0000-4000-8000-000000000001', 'brand-lifecycle@example.invalid', false, false, now(), now()),
  ('b3000000-0000-4000-8000-000000000002', 'brand-foreign@example.invalid', false, false, now(), now());

insert into public.businesses(id, owner_user_id, trading_name)
values
  ('b4000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'Lifecycle Business'),
  ('b4000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002', 'Foreign Business');

insert into public.brand_kits(business_id, logo_url, logo_status)
values (
  'b4000000-0000-4000-8000-000000000001',
  'https://project.test/storage/v1/object/public/assets/brand-kits/b4000000-0000-4000-8000-000000000001/logo.png',
  'legacy_unverified'
);

insert into storage.objects(bucket_id, name, metadata)
values (
  'assets',
  'brand-kits/b4000000-0000-4000-8000-000000000001/logo.png',
  '{"mimetype":"image/png"}'::jsonb
);

set local role service_role;

create temp table first_claim as
select public.claim_brand_logo_operation(
  'b3000000-0000-4000-8000-000000000001',
  'b5000000-0000-8000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  0,
  repeat('a', 64),
  'replace',
  '#dc5430',
  '#efe5d4',
  'Lifecycle footer',
  repeat('b', 64),
  4,
  'image/png'
) as receipt;

select is(
  receipt->>'outcome',
  'accepted',
  'a valid replacement is durably accepted before Storage work'
) from first_claim;

select is(
  receipt->>'new_storage_path',
  'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000001.png',
  'the server derives one immutable operation-keyed logo path'
) from first_claim;

select is(
  public.claim_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    0,
    repeat('a', 64),
    'replace',
    '#dc5430',
    '#efe5d4',
    'Lifecycle footer',
    repeat('b', 64),
    4,
    'image/png'
  )->>'claim_token',
  (select receipt->>'claim_token' from first_claim),
  'an exact replay returns the same durable claim token'
);

select ok(
  pg_temp.raises_matching(
    $$select public.claim_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000001',
      'b5000000-0000-8000-8000-000000000001',
      'b4000000-0000-4000-8000-000000000001',
      0, repeat('c', 64), 'replace', '#dc5430', '#efe5d4',
      'Lifecycle footer', repeat('b', 64), 4, 'image/png'
    )$$,
    '%BRAND_LOGO_OPERATION_CONFLICT%'
  ),
  'one operation identity cannot be rebound to altered input'
);

select ok(
  pg_temp.raises_matching(
    $$select public.claim_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000002',
      'b5000000-0000-8000-8000-000000000002',
      'b4000000-0000-4000-8000-000000000001',
      0, repeat('d', 64), 'keep', '#dc5430', null, null,
      null, null, null
    )$$,
    '%BRAND_LOGO_FORBIDDEN%'
  ),
  'a foreign principal cannot claim the business lifecycle'
);

select ok(
  pg_temp.raises_matching(
    $$select public.claim_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000001',
      'b5000000-0000-8000-8000-000000000003',
      'b4000000-0000-4000-8000-000000000001',
      1, repeat('e', 64), 'keep', '#dc5430', null, null,
      null, null, null
    )$$,
    '%BRAND_KIT_REVISION_CONFLICT%'
  ),
  'a stale expected revision fails before external work'
);

select is(
  public.claim_user_storage_dispatch(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    'brand-logo-publish',
    repeat('1', 64),
    repeat('b', 64),
    ((select receipt->>'publish_dispatch_token' from first_claim))::uuid
  )->>'outcome',
  'accepted',
  'brand publication uses the common deletion-fenced Storage dispatch boundary'
);

reset role;
insert into storage.objects(bucket_id, name, metadata)
values (
  'assets',
  'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000001.png',
  '{"mimetype":"image/png"}'::jsonb
);
set local role service_role;

select is(
  public.complete_user_storage_dispatch(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    'brand-logo-publish',
    repeat('1', 64),
    repeat('b', 64),
    ((select receipt->>'publish_dispatch_token' from first_claim))::uuid
  )->>'outcome',
  'completed',
  'verified publication closes its common Storage dispatch'
);

select is(
  public.record_brand_logo_storage_verified(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    ((select receipt->>'claim_token' from first_claim))::uuid,
    'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000001.png',
    repeat('b', 64), 4, 'image/png'
  )->>'state',
  'storage_verified',
  'exact verified object identity advances the durable operation'
);

select is(
  public.activate_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    ((select receipt->>'claim_token' from first_claim))::uuid,
    'https://project.test/storage/v1/object/public/assets/brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000001.png'
  )->>'state',
  'activated',
  'the new pointer activates only after object verification'
);

select is(
  (public.activate_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    ((select receipt->>'claim_token' from first_claim))::uuid,
    'https://project.test/storage/v1/object/public/assets/brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000001.png'
  ) #>> '{brand_kit,revision}') || ':' ||
  (public.activate_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    ((select receipt->>'claim_token' from first_claim))::uuid,
    'https://project.test/storage/v1/object/public/assets/brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000001.png'
  ) #>> '{brand_kit,logo_status}'),
  '1:reconciliation_required',
  'activation increments once and exposes incomplete old-key cleanup truth'
);

select ok(
  pg_temp.raises_matching(
    $$select public.complete_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000001',
      'b5000000-0000-8000-8000-000000000001',
      ((select receipt->>'claim_token' from first_claim))::uuid,
      repeat('f', 64)
    ) from first_claim$$,
    '%BRAND_LOGO_CLEANUP_INCOMPLETE%'
  ),
  'replacement cannot complete while the retired key remains present'
);

reset role;
select pg_catalog.set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'assets'
  and name = 'brand-kits/b4000000-0000-4000-8000-000000000001/logo.png';
select pg_catalog.set_config('storage.allow_delete_query', 'false', true);
set local role service_role;

select is(
  public.complete_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    ((select receipt->>'claim_token' from first_claim))::uuid,
    repeat('f', 64)
  )->>'outcome',
  'completed',
  'replacement completes only after exact old-key cleanup'
);

select is(
  public.claim_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000001',
    'b4000000-0000-4000-8000-000000000001',
    0, repeat('a', 64), 'replace', '#dc5430', '#efe5d4',
    'Lifecycle footer', repeat('b', 64), 4, 'image/png'
  )->>'outcome',
  'completed',
  'terminal response replay does not advance the revision twice'
);

create temp table remove_claim as
select public.claim_brand_logo_operation(
  'b3000000-0000-4000-8000-000000000001',
  'b5000000-0000-8000-8000-000000000004',
  'b4000000-0000-4000-8000-000000000001',
  1, repeat('9', 64), 'remove', '#dc5430', null, null,
  null, null, null
) as receipt;

select ok(
  pg_temp.raises_matching(
    $$select public.complete_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000001',
      'b5000000-0000-8000-8000-000000000004',
      ((select receipt->>'claim_token' from remove_claim))::uuid,
      repeat('8', 64)
    ) from remove_claim$$,
    '%BRAND_LOGO_REMOVE_INCOMPLETE%'
  ),
  'remove cannot clear the authoritative pointer before verified absence'
);

reset role;
select pg_catalog.set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'assets'
  and name like 'brand-kits/b4000000-0000-4000-8000-000000000001/%';
select pg_catalog.set_config('storage.allow_delete_query', 'false', true);
set local role service_role;

select is(
  public.complete_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000004',
    ((select receipt->>'claim_token' from remove_claim))::uuid,
    repeat('8', 64)
  ) #>> '{brand_kit,revision}',
  '2',
  'verified remove clears the pointer and advances exactly one revision'
);

select ok(
  (public.complete_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000004',
    ((select receipt->>'claim_token' from remove_claim))::uuid,
    repeat('8', 64)
  ) #> '{brand_kit,logo_url}') = 'null'::jsonb
  and (public.complete_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000004',
    ((select receipt->>'claim_token' from remove_claim))::uuid,
    repeat('8', 64)
  ) #> '{brand_kit,logo_storage_path}') = 'null'::jsonb
  and (public.complete_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000004',
    ((select receipt->>'claim_token' from remove_claim))::uuid,
    repeat('8', 64)
  ) #> '{brand_kit,logo_operation_id}') = 'null'::jsonb,
  'completed removal clears every active logo identity field'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'b3000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$update public.brand_kits set logo_url = null
      where business_id = 'b4000000-0000-4000-8000-000000000001'$$,
    '%permission denied%'
  ),
  'a browser cannot bypass the revisioned lifecycle by clearing logo_url'
);

reset role;
set local role service_role;

create temp table mismatch_claim as
select public.claim_brand_logo_operation(
  'b3000000-0000-4000-8000-000000000001',
  'b5000000-0000-8000-8000-000000000006',
  'b4000000-0000-4000-8000-000000000001',
  2, repeat('d', 64), 'replace', '#dc5430', null,
  'Mismatch remains explicit', repeat('c', 64), 4, 'image/png'
) as receipt;

select is(
  public.claim_user_storage_dispatch(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000006',
    'brand-logo-publish',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000006.png',
      'UTF8'
    ), 'sha256'), 'hex'),
    repeat('c', 64),
    ((select receipt->>'publish_dispatch_token' from mismatch_claim))::uuid
  )->>'outcome',
  'accepted',
  'a mismatch can be recorded only after the exact publish dispatch is admitted'
);

reset role;
insert into storage.objects(bucket_id, name, metadata)
values (
  'assets',
  'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000006.png',
  '{"mimetype":"image/png"}'::jsonb
);
set local role service_role;

select is(
  public.mark_brand_logo_reconciliation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000006',
    ((select receipt->>'claim_token' from mismatch_claim))::uuid,
    repeat('e', 64), 3,
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'prompted.brand-logo-reconciliation.v1|b4000000-0000-4000-8000-000000000001|b5000000-0000-8000-8000-000000000006|' ||
        repeat('c', 64) || '|4|' || repeat('e', 64) || '|3',
      'UTF8'
    ), 'sha256'), 'hex')
  )->>'state',
  'reconciliation_required',
  'retained mismatched bytes become a durable explicit reconciliation state'
);

select ok(
  pg_temp.raises_matching(
    $$select public.claim_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000001',
      'b5000000-0000-8000-8000-000000000007',
      'b4000000-0000-4000-8000-000000000001',
      2, repeat('7', 64), 'keep', '#dc5430', null, null,
      null, null, null
    )$$,
    '%BRAND_LOGO_OPERATION_IN_PROGRESS%'
  ),
  'a new brand mutation cannot bypass unresolved conflicting bytes'
);

select is(
  public.claim_user_storage_dispatch(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000006',
    'brand-logo-delete',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000006.png'
      )::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    repeat('d', 64),
    ((select receipt->>'delete_dispatch_token' from mismatch_claim))::uuid
  )->>'outcome',
  'accepted',
  'mismatch cleanup uses the exact common deletion-fenced Storage dispatch'
);

reset role;
select pg_catalog.set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id = 'assets'
  and name = 'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000006.png';
select pg_catalog.set_config('storage.allow_delete_query', 'false', true);
set local role service_role;

select is(
  public.complete_user_storage_dispatch(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000006',
    'brand-logo-delete',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array(
        'brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000006.png'
      )::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    repeat('d', 64),
    ((select receipt->>'delete_dispatch_token' from mismatch_claim))::uuid
  )->>'outcome',
  'completed',
  'exact conflicting-object deletion is durably acknowledged'
);

select is(
  public.resolve_brand_logo_reconciliation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000006',
    ((select receipt->>'claim_token' from mismatch_claim))::uuid,
    'failed',
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      'prompted.brand-logo-mismatch-cleanup.v1|b4000000-0000-4000-8000-000000000001|b5000000-0000-8000-8000-000000000006|brand-kits/b4000000-0000-4000-8000-000000000001/logos/b5000000-0000-8000-8000-000000000006.png|absent',
      'UTF8'
    ), 'sha256'), 'hex')
  ) #>> '{error,code}',
  'BRAND_LOGO_STORAGE_CONFLICT',
  'a verified-absent mismatched object terminates with the stable stored failure'
);

select is(
  public.claim_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000006',
    'b4000000-0000-4000-8000-000000000001',
    2, repeat('d', 64), 'replace', '#dc5430', null,
    'Mismatch remains explicit', repeat('c', 64), 4, 'image/png'
  )->>'outcome',
  'failed',
  'the exact failed operation replays its durable terminal response'
);

create temp table post_mismatch_claim as
select public.claim_brand_logo_operation(
  'b3000000-0000-4000-8000-000000000001',
  'b5000000-0000-8000-8000-000000000008',
  'b4000000-0000-4000-8000-000000000001',
  2, repeat('8', 64), 'keep', '#dc5430', null,
  'Recovered after mismatch', null, null, null
) as receipt;
select is(
  public.complete_brand_logo_operation(
    'b3000000-0000-4000-8000-000000000001',
    'b5000000-0000-8000-8000-000000000008',
    ((select receipt->>'claim_token' from post_mismatch_claim))::uuid,
    repeat('9', 64)
  )->>'outcome',
  'completed',
  'a terminal mismatch releases the business for a later clean brand update'
);

set local role service_role;
select is(
  public.begin_account_deletion_fence(
    'b3000000-0000-4000-8000-000000000001'
  )->>'outcome',
  'ready',
  'completed logo operations do not strand account deletion'
);

select ok(
  pg_temp.raises_matching(
    $$select public.claim_brand_logo_operation(
      'b3000000-0000-4000-8000-000000000001',
      'b5000000-0000-8000-8000-000000000005',
      'b4000000-0000-4000-8000-000000000001',
      2, repeat('7', 64), 'keep', '#dc5430', null, null,
      null, null, null
    )$$,
    '%ACCOUNT_DELETION_FENCED%'
  ),
  'no brand operation can cross the account-deletion tombstone'
);

select * from finish();
rollback;
