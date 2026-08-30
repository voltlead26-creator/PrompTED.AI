-- Close the historical all-column profile UPDATE grant without changing any
-- potentially applied migration. Profile details and business linkage are now
-- separate, explicit RPC commands. Authority/accounting fields remain
-- server-owned.

begin;

revoke update on table public.profiles from authenticated;

drop policy if exists profiles_update_own on public.profiles;

create or replace function public.update_own_profile_details(
  p_display_name text,
  p_full_name text,
  p_preferred_name text,
  p_phone text,
  p_date_of_birth date,
  p_address_line_1 text,
  p_address_line_2 text,
  p_suburb text,
  p_state text,
  p_postcode text,
  p_country text
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if char_length(coalesce(p_display_name, '')) > 160
    or char_length(coalesce(p_full_name, '')) > 200
    or char_length(coalesce(p_preferred_name, '')) > 160
    or char_length(coalesce(p_phone, '')) > 80
    or char_length(coalesce(p_address_line_1, '')) > 240
    or char_length(coalesce(p_address_line_2, '')) > 240
    or char_length(coalesce(p_suburb, '')) > 160
    or char_length(coalesce(p_state, '')) > 160
    or char_length(coalesce(p_postcode, '')) > 40
    or char_length(coalesce(p_country, '')) > 160
  then
    raise exception 'PROFILE_FIELD_TOO_LONG' using errcode = '22001';
  end if;

  if p_date_of_birth is not null and p_date_of_birth > current_date then
    raise exception 'INVALID_DATE_OF_BIRTH' using errcode = '22007';
  end if;

  update public.profiles
  set display_name = nullif(btrim(p_display_name), ''),
      full_name = nullif(btrim(p_full_name), ''),
      preferred_name = nullif(btrim(p_preferred_name), ''),
      phone = nullif(btrim(p_phone), ''),
      date_of_birth = p_date_of_birth,
      address_line_1 = nullif(btrim(p_address_line_1), ''),
      address_line_2 = nullif(btrim(p_address_line_2), ''),
      suburb = nullif(btrim(p_suburb), ''),
      state = nullif(btrim(p_state), ''),
      postcode = nullif(btrim(p_postcode), ''),
      country = nullif(btrim(p_country), '')
  where profiles.id = v_user_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.link_own_business(
  p_business_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if p_business_id is not null and not exists (
    select 1
    from public.businesses
    where businesses.id = p_business_id
      and businesses.owner_user_id = v_user_id
  ) then
    raise exception 'BUSINESS_NOT_OWNED' using errcode = '42501';
  end if;

  update public.profiles
  set business_id = p_business_id
  where profiles.id = v_user_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.create_and_link_own_business(
  p_trading_name text,
  p_legal_name text,
  p_abn text,
  p_industry text,
  p_website text,
  p_email text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if nullif(btrim(p_trading_name), '') is null then
    raise exception 'TRADING_NAME_REQUIRED' using errcode = '22023';
  end if;
  if char_length(p_trading_name) > 200
    or char_length(coalesce(p_legal_name, '')) > 240
    or char_length(coalesce(p_abn, '')) > 40
    or char_length(coalesce(p_industry, '')) > 160
    or char_length(coalesce(p_website, '')) > 500
    or char_length(coalesce(p_email, '')) > 320
  then
    raise exception 'BUSINESS_FIELD_TOO_LONG' using errcode = '22001';
  end if;

  insert into public.businesses (
    owner_user_id,
    trading_name,
    legal_name,
    abn,
    industry,
    website,
    email
  ) values (
    v_user_id,
    btrim(p_trading_name),
    nullif(btrim(p_legal_name), ''),
    nullif(btrim(p_abn), ''),
    nullif(btrim(p_industry), ''),
    nullif(btrim(p_website), ''),
    nullif(btrim(p_email), '')
  )
  returning businesses.id into v_business_id;

  update public.profiles
  set business_id = v_business_id
  where profiles.id = v_user_id;

  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_business_id;
end;
$function$;

-- Replace the historical unsafe search paths while retaining the public
-- function identities used by existing triggers.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;

revoke all on function public.update_own_profile_details(
  text, text, text, text, date, text, text, text, text, text, text
) from public;
revoke all on function public.link_own_business(uuid) from public;
revoke all on function public.create_and_link_own_business(
  text, text, text, text, text, text
) from public;

grant execute on function public.update_own_profile_details(
  text, text, text, text, date, text, text, text, text, text, text
) to authenticated;
grant execute on function public.link_own_business(uuid) to authenticated;
grant execute on function public.create_and_link_own_business(
  text, text, text, text, text, text
) to authenticated;

commit;
