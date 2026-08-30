-- Profile as TED's trusted personal-resource store.
-- Adds structured reusable personal facts and an atomic two-slot master-resume lifecycle.

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists preferred_name text,
  add column if not exists date_of_birth date,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists suburb text,
  add column if not exists state text,
  add column if not exists postcode text,
  add column if not exists country text;

create table if not exists public.profile_resume_versions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  slot text not null check (slot in ('current', 'previous')),
  accepted_at timestamptz not null default now(),
  source_kind text not null default 'upload'
    check (source_kind in ('upload', 'ted_update', 'tailored_promotion', 'restore')),
  created_at timestamptz not null default now(),
  unique(user_id, slot),
  unique(user_id, upload_id)
);

create index if not exists idx_profile_resume_versions_user_accepted
  on public.profile_resume_versions(user_id, accepted_at desc);

alter table public.profile_resume_versions enable row level security;

-- Supabase no longer auto-exposes new public tables to the Data API.
-- The browser reads this table and the SECURITY INVOKER lifecycle functions
-- require the same row privileges; RLS remains the ownership boundary.
revoke all on table public.profile_resume_versions from anon;
grant select, insert, update, delete on table public.profile_resume_versions to authenticated;

drop policy if exists "profile_resume_versions_select_own" on public.profile_resume_versions;
create policy "profile_resume_versions_select_own"
  on public.profile_resume_versions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "profile_resume_versions_insert_own" on public.profile_resume_versions;
create policy "profile_resume_versions_insert_own"
  on public.profile_resume_versions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "profile_resume_versions_update_own" on public.profile_resume_versions;
create policy "profile_resume_versions_update_own"
  on public.profile_resume_versions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "profile_resume_versions_delete_own" on public.profile_resume_versions;
create policy "profile_resume_versions_delete_own"
  on public.profile_resume_versions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.promote_profile_resume(
  p_upload_id uuid,
  p_source_kind text default 'upload'
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_upload public.uploads%rowtype;
  v_current public.profile_resume_versions%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if p_source_kind not in ('upload', 'ted_update', 'tailored_promotion', 'restore') then
    raise exception 'INVALID_RESUME_SOURCE_KIND';
  end if;

  -- Row locks cannot serialize a user's first promotion because no slot rows
  -- exist yet. A transaction-scoped per-user lock covers empty and populated
  -- states and orders promotion, idempotency and restore operations together.
  perform pg_advisory_xact_lock(
    hashtextextended('profile_resume:' || v_user_id::text, 0)
  );

  select * into v_upload
  from public.uploads
  where id = p_upload_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'UPLOAD_NOT_FOUND';
  end if;

  if coalesce(trim(v_upload.extracted_text), '') = '' then
    raise exception 'RESUME_HAS_NO_EXTRACTED_TEXT';
  end if;

  if exists (
    select 1 from public.profile_resume_versions
    where user_id = v_user_id and slot = 'current' and upload_id = p_upload_id
  ) then
    return jsonb_build_object(
      'status', 'current',
      'current_upload_id', p_upload_id,
      'idempotent_replay', true
    );
  end if;

  select * into v_current
  from public.profile_resume_versions
  where user_id = v_user_id and slot = 'current';

  -- Exactly two Profile versions are exposed. Remove the older Previous first.
  delete from public.profile_resume_versions
  where user_id = v_user_id and slot = 'previous';

  if v_current.id is not null then
    update public.profile_resume_versions
    set slot = 'previous'
    where id = v_current.id and user_id = v_user_id;
  end if;

  -- If this upload was formerly referenced in another slot, clear that stale metadata.
  delete from public.profile_resume_versions
  where user_id = v_user_id and upload_id = p_upload_id;

  insert into public.profile_resume_versions (
    user_id, upload_id, slot, accepted_at, source_kind
  ) values (
    v_user_id, p_upload_id, 'current', now(), p_source_kind
  );

  return jsonb_build_object(
    'status', 'current',
    'current_upload_id', p_upload_id,
    'previous_upload_id', case when v_current.id is null then null else v_current.upload_id end,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.promote_profile_resume(uuid, text) from public;
revoke all on function public.promote_profile_resume(uuid, text) from anon;
grant execute on function public.promote_profile_resume(uuid, text) to authenticated;

create or replace function public.restore_previous_profile_resume()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current public.profile_resume_versions%rowtype;
  v_previous public.profile_resume_versions%rowtype;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('profile_resume:' || v_user_id::text, 0)
  );

  select * into v_current
  from public.profile_resume_versions
  where user_id = v_user_id and slot = 'current';

  select * into v_previous
  from public.profile_resume_versions
  where user_id = v_user_id and slot = 'previous';

  if v_previous.id is null then
    raise exception 'PREVIOUS_RESUME_NOT_FOUND';
  end if;

  delete from public.profile_resume_versions
  where user_id = v_user_id;

  insert into public.profile_resume_versions (
    id, user_id, upload_id, slot, accepted_at, source_kind, created_at
  ) values (
    v_previous.id, v_user_id, v_previous.upload_id, 'current', now(), 'restore', v_previous.created_at
  );

  if v_current.id is not null then
    insert into public.profile_resume_versions (
      id, user_id, upload_id, slot, accepted_at, source_kind, created_at
    ) values (
      v_current.id, v_user_id, v_current.upload_id, 'previous', v_current.accepted_at,
      v_current.source_kind, v_current.created_at
    );
  end if;

  return jsonb_build_object(
    'status', 'restored',
    'current_upload_id', v_previous.upload_id,
    'previous_upload_id', case when v_current.id is null then null else v_current.upload_id end
  );
end;
$$;

revoke all on function public.restore_previous_profile_resume() from public;
revoke all on function public.restore_previous_profile_resume() from anon;
grant execute on function public.restore_previous_profile_resume() to authenticated;
