-- Owner-bound compare-and-swap edits for the legacy checklist projection.
-- A dedicated opaque token is concurrency authority; updated_at remains audit
-- presentation only. Whole-checklist replacement and item edits share the
-- same owner-outcome lock order.

begin;

alter table public.checklist_items
  add column if not exists mutation_token uuid not null
  default extensions.gen_random_uuid();

create or replace function private.rotate_checklist_item_mutation_token()
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

revoke all on function private.rotate_checklist_item_mutation_token()
  from public, anon, authenticated, service_role;

drop trigger if exists checklist_item_mutation_token on public.checklist_items;
create trigger checklist_item_mutation_token
before insert or update on public.checklist_items
for each row execute function private.rotate_checklist_item_mutation_token();

drop function if exists public.update_own_checklist_item(
  uuid, uuid, timestamptz, boolean, text
);

create or replace function public.update_own_checklist_item(
  p_item_id uuid,
  p_outcome_id uuid,
  p_expected_mutation_token uuid,
  p_done boolean default null,
  p_text text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing public.checklist_items%rowtype;
  v_updated public.checklist_items%rowtype;
  v_affected_rows integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'CHECKLIST_AUTHENTICATION_REQUIRED';
  end if;
  if p_item_id is null or p_outcome_id is null or p_expected_mutation_token is null then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_REVISION_REQUIRED';
  end if;
  if (p_done is null) = (p_text is null) then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_CHANGE_INVALID';
  end if;
  if p_text is not null and (
    pg_catalog.length(pg_catalog.btrim(p_text)) < 1 or
    pg_catalog.length(pg_catalog.btrim(p_text)) > 2000
  ) then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_TEXT_INVALID';
  end if;

  -- Lock the owner outcome before any child row, matching
  -- replace_own_checklist and preventing a replacement snapshot from
  -- overwriting an edit that was concurrently accepted.
  perform 1
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CHECKLIST_ITEM_UNAVAILABLE';
  end if;

  select item_record.* into v_existing
  from public.checklist_items item_record
  where item_record.id = p_item_id
    and item_record.outcome_id = p_outcome_id
    and item_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CHECKLIST_ITEM_UNAVAILABLE';
  end if;

  if v_existing.mutation_token is distinct from p_expected_mutation_token then
    return pg_catalog.jsonb_build_object(
      'status', 'revision_conflict',
      'affected_rows', 0,
      'item', pg_catalog.to_jsonb(v_existing)
    );
  end if;

  update public.checklist_items item_record
  set done = coalesce(p_done, v_existing.done),
      text = case
        when p_text is null then v_existing.text
        else pg_catalog.btrim(p_text)
      end
  where item_record.id = v_existing.id
    and item_record.outcome_id = v_existing.outcome_id
    and item_record.user_id = v_existing.user_id
    and item_record.mutation_token = p_expected_mutation_token
  returning item_record.* into v_updated;
  get diagnostics v_affected_rows = row_count;

  if v_affected_rows <> 1 or v_updated.id is null then
    raise exception using errcode = '40001', message = 'CHECKLIST_ITEM_MUTATION_UNCONFIRMED';
  end if;
  if v_updated.mutation_token = p_expected_mutation_token then
    raise exception using errcode = '40001', message = 'CHECKLIST_ITEM_TOKEN_NOT_ROTATED';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'committed',
    'affected_rows', 1,
    'item', pg_catalog.to_jsonb(v_updated)
  );
end;
$function$;

revoke all on function public.update_own_checklist_item(
  uuid, uuid, uuid, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.update_own_checklist_item(
  uuid, uuid, uuid, boolean, text
) to authenticated;

commit;
