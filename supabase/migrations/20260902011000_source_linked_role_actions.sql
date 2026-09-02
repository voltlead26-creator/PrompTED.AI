begin;

update public.role_action_items
set label = 'Open source-linked apply page',
    description = 'Verify the listing on the source site, then apply yourself',
    updated_at = pg_catalog.clock_timestamp()
where action_key = 'default:3'
  and label = 'Open official apply link';

create or replace function public.save_own_role_with_default_actions(
  p_role_title text,
  p_company_name text default null,
  p_location text default null,
  p_match_percentage integer default null,
  p_job_url text default null,
  p_source_label text default null,
  p_contact_email text default null,
  p_contact_source_status text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_title text := pg_catalog.btrim(p_role_title);
  normalized_company text := nullif(pg_catalog.btrim(p_company_name), '');
  role_id uuid;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if normalized_title is null or normalized_title = '' or pg_catalog.length(normalized_title) > 300 then
    raise exception 'SAVED_ROLE_TITLE_INVALID' using errcode = '22023';
  end if;
  if normalized_company is not null and pg_catalog.length(normalized_company) > 300 then
    raise exception 'SAVED_ROLE_COMPANY_INVALID' using errcode = '22023';
  end if;
  if p_match_percentage is not null and (p_match_percentage < 0 or p_match_percentage > 100) then
    raise exception 'SAVED_ROLE_MATCH_INVALID' using errcode = '22023';
  end if;
  if p_contact_source_status is not null and p_contact_source_status not in (
    'official', 'public_listing', 'needs_confirmation'
  ) then
    raise exception 'SAVED_ROLE_CONTACT_STATUS_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'saved-role:' || actor_id::text || ':' || normalized_title || ':' ||
      coalesce(normalized_company, '<null>'),
      0
    )
  );

  select role_record.id
  into role_id
  from public.saved_roles role_record
  where role_record.user_id = actor_id
    and role_record.role_title = normalized_title
    and role_record.company_name is not distinct from normalized_company
  order by role_record.updated_at desc, role_record.id
  limit 1
  for update;

  if role_id is null then
    insert into public.saved_roles(
      user_id,
      role_title,
      company_name,
      location,
      match_percentage,
      job_url,
      source_label,
      contact_email,
      contact_source_status
    ) values (
      actor_id,
      normalized_title,
      normalized_company,
      nullif(pg_catalog.btrim(p_location), ''),
      p_match_percentage,
      nullif(pg_catalog.btrim(p_job_url), ''),
      nullif(pg_catalog.btrim(p_source_label), ''),
      nullif(pg_catalog.btrim(p_contact_email), ''),
      p_contact_source_status
    ) returning id into role_id;
  else
    update public.saved_roles
    set location = nullif(pg_catalog.btrim(p_location), ''),
        match_percentage = p_match_percentage,
        job_url = nullif(pg_catalog.btrim(p_job_url), ''),
        source_label = nullif(pg_catalog.btrim(p_source_label), ''),
        contact_email = nullif(pg_catalog.btrim(p_contact_email), ''),
        contact_source_status = p_contact_source_status,
        updated_at = pg_catalog.clock_timestamp()
    where id = role_id
      and user_id = actor_id;
  end if;

  insert into public.role_action_items(
    user_id, saved_role_id, action_key, label, description, sort_order
  ) values
    (actor_id, role_id, 'default:0', 'Review job requirements', 'Read the listing closely and note must-haves.', 0),
    (actor_id, role_id, 'default:1', 'Tailor resume', 'Create a role-specific resume copy — the original is never changed.', 1),
    (actor_id, role_id, 'default:2', 'Write cover letter', 'Draft a complete, role-specific cover letter with TED.', 2),
    (actor_id, role_id, 'default:3', 'Open source-linked apply page', 'Verify the listing on the source site, then apply yourself', 3),
    (actor_id, role_id, 'default:4', 'Email public contact if appropriate', 'Only public, confirmed contacts — TED never guesses emails.', 4),
    (actor_id, role_id, 'default:5', 'Set a follow-up reminder', 'Note when to follow up if you have not heard back.', 5)
  on conflict (saved_role_id, action_key) do nothing;

  return role_id;
end;
$function$;

revoke all on function public.save_own_role_with_default_actions(
  text, text, text, integer, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_own_role_with_default_actions(
  text, text, text, integer, text, text, text, text
) to authenticated;

commit;
