-- Make saved-role creation and its default action plan one owner-scoped
-- transaction, and give action-item edits opaque compare-and-swap identity.

begin;

alter table public.role_action_items
  add column if not exists action_key text,
  add column if not exists mutation_token uuid not null default extensions.gen_random_uuid();

alter table public.role_action_items
  alter column action_key set default ('legacy:' || extensions.gen_random_uuid()::text);

with ranked_defaults as (
  select
    item.id,
    item.saved_role_id,
    item.sort_order,
    pg_catalog.row_number() over (
      partition by item.saved_role_id, item.sort_order
      order by item.created_at, item.id
    ) as occurrence
  from public.role_action_items item
  where (item.sort_order = 0 and item.label = 'Review job requirements')
     or (item.sort_order = 1 and item.label = 'Tailor resume')
     or (item.sort_order = 2 and item.label = 'Write cover letter')
     or (item.sort_order = 3 and item.label = 'Open official apply link')
     or (item.sort_order = 4 and item.label = 'Email public contact if appropriate')
     or (item.sort_order = 5 and item.label = 'Set a follow-up reminder')
)
update public.role_action_items item
set action_key = case
  when ranked.occurrence = 1 then 'default:' || ranked.sort_order::text
  else 'legacy:' || item.id::text
end
from ranked_defaults ranked
where item.id = ranked.id
  and item.action_key is null;

update public.role_action_items
set action_key = 'legacy:' || id::text
where action_key is null;

alter table public.role_action_items
  alter column action_key set not null;

create unique index if not exists role_action_items_role_action_key_uidx
  on public.role_action_items(saved_role_id, action_key);

do $preflight$
begin
  if exists (
    select 1
    from public.saved_roles role_record
    where role_record.company_name is null
    group by role_record.user_id, role_record.role_title
    having pg_catalog.count(*) > 1
  ) then
    raise exception 'SAVED_ROLE_NULL_COMPANY_DUPLICATES_REQUIRE_RECONCILIATION';
  end if;
end;
$preflight$;

create unique index if not exists saved_roles_owner_title_null_company_uidx
  on public.saved_roles(user_id, role_title)
  where company_name is null;

create or replace function private.rotate_role_action_item_mutation_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.mutation_token := extensions.gen_random_uuid();
  return new;
end;
$function$;

drop trigger if exists role_action_items_rotate_mutation_token
  on public.role_action_items;
create trigger role_action_items_rotate_mutation_token
  before insert or update on public.role_action_items
  for each row execute function private.rotate_role_action_item_mutation_token();

revoke all on function private.rotate_role_action_item_mutation_token()
  from public, anon, authenticated, service_role;

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
    (actor_id, role_id, 'default:3', 'Open official apply link', 'Apply on the employer or government site yourself.', 3),
    (actor_id, role_id, 'default:4', 'Email public contact if appropriate', 'Only public, confirmed contacts — TED never guesses emails.', 4),
    (actor_id, role_id, 'default:5', 'Set a follow-up reminder', 'Note when to follow up if you have not heard back.', 5)
  on conflict (saved_role_id, action_key) do nothing;

  return role_id;
end;
$function$;

create or replace function public.update_own_role_action_item(
  p_item_id uuid,
  p_expected_mutation_token uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  parent_id uuid;
  current_item public.role_action_items%rowtype;
  affected_rows integer := 0;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_item_id is null or p_expected_mutation_token is null or p_status is null or
     p_status not in ('pending', 'done', 'skipped') then
    raise exception 'ROLE_ACTION_CHANGE_INVALID' using errcode = '22023';
  end if;

  select item.saved_role_id
  into parent_id
  from public.role_action_items item
  where item.id = p_item_id
    and item.user_id = actor_id;

  if parent_id is null then
    raise exception 'ROLE_ACTION_ITEM_UNAVAILABLE' using errcode = 'P0002';
  end if;

  perform 1
  from public.saved_roles role_record
  where role_record.id = parent_id
    and role_record.user_id = actor_id
  for update;

  select item.*
  into current_item
  from public.role_action_items item
  where item.id = p_item_id
    and item.saved_role_id = parent_id
    and item.user_id = actor_id
  for update;

  if not found then
    raise exception 'ROLE_ACTION_ITEM_UNAVAILABLE' using errcode = 'P0002';
  end if;

  if current_item.mutation_token = p_expected_mutation_token then
    update public.role_action_items
    set status = p_status,
        updated_at = pg_catalog.clock_timestamp()
    where id = current_item.id
      and user_id = actor_id
      and mutation_token = p_expected_mutation_token
    returning * into current_item;
    get diagnostics affected_rows = row_count;
    if affected_rows = 1 and current_item.mutation_token = p_expected_mutation_token then
      raise exception 'ROLE_ACTION_MUTATION_TOKEN_NOT_ROTATED';
    end if;
    if affected_rows = 0 then
      select item.*
      into current_item
      from public.role_action_items item
      where item.id = p_item_id
        and item.saved_role_id = parent_id
        and item.user_id = actor_id;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', case when affected_rows = 1 then 'committed' else 'revision_conflict' end,
    'affected_rows', affected_rows,
    'item', pg_catalog.jsonb_build_object(
      'id', current_item.id,
      'label', current_item.label,
      'description', current_item.description,
      'status', current_item.status,
      'sort_order', current_item.sort_order,
      'mutation_token', current_item.mutation_token
    )
  );
end;
$function$;

revoke all on function public.save_own_role_with_default_actions(
  text, text, text, integer, text, text, text, text
) from public, anon, service_role;
grant execute on function public.save_own_role_with_default_actions(
  text, text, text, integer, text, text, text, text
) to authenticated;

revoke all on function public.update_own_role_action_item(uuid, uuid, text)
  from public, anon, service_role;
grant execute on function public.update_own_role_action_item(uuid, uuid, text)
  to authenticated;

commit;
