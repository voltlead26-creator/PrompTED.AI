-- Atomic, owner-scoped replacement for the legacy checklist compatibility UI.
-- The public checklist remains a compatibility projection; this command makes
-- its replacement all-or-nothing and binds it to one exact generation request.

create table if not exists private.checklist_replacement_receipts (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  request_id text not null,
  request_sha256 text not null,
  accepted_outcome_updated_at timestamptz not null,
  result jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (user_id, outcome_id, request_id),
  constraint checklist_replacement_request_id_valid check (
    request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  constraint checklist_replacement_request_sha_valid check (
    request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint checklist_replacement_result_valid check (
    pg_catalog.jsonb_typeof(result) = 'object'
  )
);

alter table private.checklist_replacement_receipts enable row level security;
revoke all on table private.checklist_replacement_receipts
  from public, anon, authenticated, service_role;

create or replace function private.reject_checklist_receipt_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'CHECKLIST_RECEIPT_IMMUTABLE';
end;
$function$;
revoke all on function private.reject_checklist_receipt_update()
  from public, anon, authenticated, service_role;
drop trigger if exists checklist_replacement_receipt_immutable
  on private.checklist_replacement_receipts;
create trigger checklist_replacement_receipt_immutable
  before update on private.checklist_replacement_receipts
  for each row execute function private.reject_checklist_receipt_update();

-- Expand cohort: introduce the atomic replacement RPC while retaining the
-- existing RLS-protected INSERT/UPDATE/DELETE surface used by the currently
-- published checklist client. Removing these legacy verbs belongs to a later,
-- separately gated contract migration after the RPC-only web is proven live;
-- otherwise a failed Netlify publication could strand the old production UI.
grant select, insert, update, delete on public.checklist_items to authenticated;

create or replace function public.replace_own_checklist(
  p_outcome_id uuid,
  p_request_id text,
  p_expected_outcome_updated_at timestamptz,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_payload jsonb;
  v_request_sha256 text;
  v_receipt_sha256 text;
  v_receipt_result jsonb;
  v_outcome_updated_at timestamptz;
  v_committed_outcome_updated_at timestamptz;
  v_prior_items jsonb;
  v_item jsonb;
  v_prior_item jsonb;
  v_item_id uuid;
  v_due_date date;
  v_now timestamptz := pg_catalog.now();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'CHECKLIST_AUTHENTICATION_REQUIRED';
  end if;
  if p_outcome_id is null or p_expected_outcome_updated_at is null then
    raise exception using errcode = '22023', message = 'CHECKLIST_REVISION_REQUIRED';
  end if;
  if p_request_id is null or
     p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception using errcode = '22023', message = 'CHECKLIST_REQUEST_ID_INVALID';
  end if;
  if pg_catalog.jsonb_typeof(p_items) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEMS_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(p_items) < 1 or
     pg_catalog.jsonb_array_length(p_items) > 100 or
     pg_catalog.octet_length(p_items::text) > 262144 then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEMS_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_items) as item_record(value)
    where pg_catalog.jsonb_typeof(item_record.value) is distinct from 'object'
       or nullif(pg_catalog.btrim(item_record.value->>'id'), '') is null
       or nullif(pg_catalog.btrim(item_record.value->>'text'), '') is null
       or pg_catalog.length(item_record.value->>'text') > 2000
       or pg_catalog.length(coalesce(item_record.value->>'reason', '')) > 4000
       or coalesce(item_record.value->>'order_index', '') !~ '^[0-9]{1,3}$'
       or (
         nullif(item_record.value->>'due_date', '') is not null and
         (item_record.value->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       )
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(item_record.value) as field_record(name)
         where field_record.name not in (
           'id', 'text', 'due_date', 'reason', 'order_index'
         )
       )
  ) then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_INVALID';
  end if;

  for v_item in
    select item_record.value
    from pg_catalog.jsonb_array_elements(p_items) as item_record(value)
  loop
    begin
      perform (v_item->>'id')::uuid;
      if nullif(v_item->>'due_date', '') is not null then
        perform (v_item->>'due_date')::date;
      end if;
    exception when others then
      raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_INVALID';
    end;
  end loop;

  if (
    select pg_catalog.count(distinct item_record.value->>'id')
      is distinct from pg_catalog.jsonb_array_length(p_items)::bigint
      or pg_catalog.count(distinct pg_catalog.btrim(item_record.value->>'text'))
      is distinct from pg_catalog.jsonb_array_length(p_items)::bigint
      or pg_catalog.min((item_record.value->>'order_index')::integer) <> 0
      or pg_catalog.max((item_record.value->>'order_index')::integer) <>
         pg_catalog.jsonb_array_length(p_items) - 1
      or pg_catalog.count(distinct (item_record.value->>'order_index')::integer)
      is distinct from pg_catalog.jsonb_array_length(p_items)::bigint
    from pg_catalog.jsonb_array_elements(p_items) as item_record(value)
  ) then
    raise exception using errcode = '22023', message = 'CHECKLIST_ITEM_IDENTITY_INVALID';
  end if;

  v_request_payload := pg_catalog.jsonb_build_object(
    'contract_version', 'checklist-replacement.1',
    'outcome_id', p_outcome_id,
    'items', p_items
  );
  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_request_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select receipt.request_sha256, receipt.result
    into v_receipt_sha256, v_receipt_result
  from private.checklist_replacement_receipts receipt
  where receipt.user_id = v_user_id
    and receipt.outcome_id = p_outcome_id
    and receipt.request_id = p_request_id;
  if found then
    if v_receipt_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'CHECKLIST_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt_result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  select outcome_record.updated_at
    into v_outcome_updated_at
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CHECKLIST_OUTCOME_NOT_FOUND';
  end if;

  -- A concurrent exact request may have committed while this call waited for
  -- the owner outcome lock. Re-check before applying the revision gate.
  select receipt.request_sha256, receipt.result
    into v_receipt_sha256, v_receipt_result
  from private.checklist_replacement_receipts receipt
  where receipt.user_id = v_user_id
    and receipt.outcome_id = p_outcome_id
    and receipt.request_id = p_request_id;
  if found then
    if v_receipt_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'CHECKLIST_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt_result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  if v_outcome_updated_at is distinct from p_expected_outcome_updated_at then
    raise exception using errcode = '40001', message = 'CHECKLIST_REVISION_CONFLICT';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item_record)),
    '[]'::jsonb
  ) into v_prior_items
  from public.checklist_items item_record
  where item_record.outcome_id = p_outcome_id
    and item_record.user_id = v_user_id;

  delete from public.checklist_items
  where outcome_id = p_outcome_id
    and user_id = v_user_id;

  for v_item in
    select item_record.value
    from pg_catalog.jsonb_array_elements(p_items) as item_record(value)
    order by (item_record.value->>'order_index')::integer
  loop
    v_item_id := (v_item->>'id')::uuid;
    v_due_date := nullif(v_item->>'due_date', '')::date;
    select prior_record.value
      into v_prior_item
    from pg_catalog.jsonb_array_elements(v_prior_items) as prior_record(value)
    where prior_record.value->>'id' = v_item->>'id'
       or prior_record.value->>'text' = pg_catalog.btrim(v_item->>'text')
    order by (prior_record.value->>'id' = v_item->>'id') desc
    limit 1;

    insert into public.checklist_items (
      id, outcome_id, user_id, text, due_date, reason, done,
      reminder_offset_days, reminder_sent, order_index, created_at, updated_at
    ) values (
      v_item_id,
      p_outcome_id,
      v_user_id,
      pg_catalog.btrim(v_item->>'text'),
      v_due_date,
      nullif(pg_catalog.btrim(v_item->>'reason'), ''),
      coalesce((v_prior_item->>'done')::boolean, false),
      (v_prior_item->>'reminder_offset_days')::integer,
      case
        when nullif(v_prior_item->>'due_date', '')::date is not distinct from v_due_date
          then coalesce((v_prior_item->>'reminder_sent')::boolean, false)
        else false
      end,
      (v_item->>'order_index')::integer,
      coalesce((v_prior_item->>'created_at')::timestamptz, v_now),
      v_now
    );
  end loop;

  update public.outcomes
  set updated_at = v_now
  where id = p_outcome_id
    and user_id = v_user_id
  returning updated_at into v_committed_outcome_updated_at;

  v_result := pg_catalog.jsonb_build_object(
    'status', 'committed',
    'outcome_id', p_outcome_id,
    'request_id', p_request_id,
    'accepted_outcome_updated_at', p_expected_outcome_updated_at,
    'item_count', pg_catalog.jsonb_array_length(p_items),
    'outcome_updated_at', v_committed_outcome_updated_at,
    'idempotent_replay', false
  );
  insert into private.checklist_replacement_receipts (
    user_id, outcome_id, request_id, request_sha256,
    accepted_outcome_updated_at, result
  ) values (
    v_user_id, p_outcome_id, p_request_id, v_request_sha256,
    p_expected_outcome_updated_at, v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.replace_own_checklist(uuid, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_own_checklist(uuid, text, timestamptz, jsonb)
  to authenticated;
