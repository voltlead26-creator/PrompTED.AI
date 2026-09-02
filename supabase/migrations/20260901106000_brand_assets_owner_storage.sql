-- Version the public brand-logo bucket assumed by the web and export paths,
-- and bind every admitted write to the business owner deletion fence.

begin;

do $preflight$
begin
  if exists (
    select 1
    from storage.buckets bucket_record
    where bucket_record.id = 'assets'
      and not bucket_record.public
  ) and exists (
    select 1 from storage.objects object_record
    where object_record.bucket_id = 'assets'
  ) then
    raise exception 'ASSETS_BUCKET_PUBLICATION_REQUIRES_INVENTORY';
  end if;

  if exists (
    select 1
    from storage.objects object_record
    where object_record.bucket_id = 'assets'
      and object_record.name !~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo[.](png|jpg|webp)$'
  ) then
    raise exception 'ASSETS_BUCKET_CONTENT_REQUIRES_INVENTORY';
  end if;
end;
$preflight$;

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'assets',
  'assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists assets_authenticated_owner_boundary on storage.objects;
create policy assets_authenticated_owner_boundary
  on storage.objects
  as restrictive
  for all
  to authenticated
  using (
    bucket_id <> 'assets'
    or (
      name ~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo[.](png|jpg|webp)$'
      and exists (
        select 1
        from public.businesses business_record
        where business_record.id::text = pg_catalog.split_part(name, '/', 2)
          and business_record.owner_user_id = (select auth.uid())
      )
    )
  )
  with check (
    bucket_id <> 'assets'
    or (
      name ~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo[.](png|jpg|webp)$'
      and exists (
        select 1
        from public.businesses business_record
        where business_record.id::text = pg_catalog.split_part(name, '/', 2)
          and business_record.owner_user_id = (select auth.uid())
      )
    )
  );

drop policy if exists assets_authenticated_access on storage.objects;
create policy assets_authenticated_access
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'assets')
  with check (bucket_id = 'assets');

drop policy if exists assets_no_direct_client_delete on storage.objects;
create policy assets_no_direct_client_delete
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (bucket_id <> 'assets');

create or replace function private.enforce_user_storage_deletion_fence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_new_user_id uuid;
  v_old_user_id uuid;
  v_prefix text;
begin
  if new.bucket_id in ('original-documents', 'captured-exports') then
    v_prefix := pg_catalog.split_part(new.name, '/', 1);
    if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'USER_STORAGE_PREFIX_INVALID';
    end if;
    v_new_user_id := v_prefix::uuid;
  elsif new.bucket_id = 'assets' then
    if new.name !~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo[.](png|jpg|webp)$' then
      raise exception 'BRAND_ASSET_PATH_INVALID';
    end if;
    v_prefix := pg_catalog.split_part(new.name, '/', 2);
    select business_record.owner_user_id
      into v_new_user_id
    from public.businesses business_record
    where business_record.id = v_prefix::uuid;
    if not found then
      raise exception 'BRAND_ASSET_BUSINESS_UNAVAILABLE';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and old.bucket_id in ('original-documents', 'captured-exports') then
    v_prefix := pg_catalog.split_part(old.name, '/', 1);
    if v_prefix !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'USER_STORAGE_PREFIX_INVALID';
    end if;
    v_old_user_id := v_prefix::uuid;
  elsif tg_op = 'UPDATE' and old.bucket_id = 'assets' then
    if old.name !~ '^brand-kits/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo[.](png|jpg|webp)$' then
      raise exception 'BRAND_ASSET_PATH_INVALID';
    end if;
    v_prefix := pg_catalog.split_part(old.name, '/', 2);
    select business_record.owner_user_id
      into v_old_user_id
    from public.businesses business_record
    where business_record.id = v_prefix::uuid;
    if not found then
      raise exception 'BRAND_ASSET_BUSINESS_UNAVAILABLE';
    end if;
  end if;

  if v_new_user_id is null and v_old_user_id is null then return new; end if;

  if v_new_user_id is not null and v_old_user_id is not null
    and v_new_user_id is distinct from v_old_user_id then
    if v_new_user_id::text < v_old_user_id::text then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_new_user_id::text, 91000)
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_old_user_id::text, 91000)
      );
    else
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_old_user_id::text, 91000)
      );
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_new_user_id::text, 91000)
      );
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        coalesce(v_new_user_id, v_old_user_id)::text,
        91000
      )
    );
  end if;

  if (v_new_user_id is not null and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key = private.account_deletion_user_key(v_new_user_id)
    ))
    or (v_old_user_id is not null and exists (
      select 1 from private.account_deletion_fences fence_record
      where fence_record.user_key = private.account_deletion_user_key(v_old_user_id)
    )) then
    raise exception 'ACCOUNT_DELETION_FENCED';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_user_storage_deletion_fence()
  from public, anon, authenticated, service_role;

commit;
