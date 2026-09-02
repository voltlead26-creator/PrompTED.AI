-- Owner-scoped, replay-safe conversation persistence.
--
-- Conversation saves patch only their three owned recommendation fields. They
-- can no longer replace upload provenance, template choice or alternatives,
-- and delayed browser writes cannot overwrite a newer tab or reload.

begin;

alter table public.outcomes
  add column conversation_revision integer not null default 0;

alter table public.outcomes
  add constraint outcomes_conversation_revision_check
    check (conversation_revision >= 0);

create table private.outcome_conversation_save_receipts (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  request_id text not null check (
    request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
  ),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_conversation_revision integer not null
    check (accepted_conversation_revision >= 0),
  result jsonb not null check (
    pg_catalog.jsonb_typeof(result) = 'object'
    and pg_catalog.octet_length(result::text) <= 8192
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (user_id, outcome_id, request_id)
);

comment on table private.outcome_conversation_save_receipts is
  'Immutable hash-only receipts for outcome conversation saves. Conversation wording remains solely in the owner-scoped outcome payload.';

alter table private.outcome_conversation_save_receipts enable row level security;
revoke all on table private.outcome_conversation_save_receipts
  from public, anon, authenticated, service_role;

create or replace function private.reject_outcome_conversation_receipt_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'OUTCOME_CONVERSATION_RECEIPT_IMMUTABLE';
end;
$function$;

revoke all on function private.reject_outcome_conversation_receipt_update()
  from public, anon, authenticated, service_role;

create trigger outcome_conversation_save_receipt_immutable
  before update on private.outcome_conversation_save_receipts
  for each row execute function private.reject_outcome_conversation_receipt_update();

-- During the expand cohort older clients can still write the whole payload.
-- Rotate the conversation CAS for every such write and prevent direct callers
-- from forging the revision value. A later cohort can remove full-payload
-- browser mutation after the compatible web has drained old sessions.
create or replace function private.advance_outcome_conversation_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.conversation_revision := 0;
    return new;
  end if;

  if new.conversation_revision is distinct from old.conversation_revision then
    raise exception using
      errcode = '22023',
      message = 'OUTCOME_CONVERSATION_REVISION_MANAGED';
  end if;

  v_changed :=
    new.recommendation_payload->'conversation'
      is distinct from old.recommendation_payload->'conversation'
    or new.recommendation_payload->'conversation_context'
      is distinct from old.recommendation_payload->'conversation_context'
    or new.recommendation_payload->'situation'
      is distinct from old.recommendation_payload->'situation';

  new.conversation_revision := old.conversation_revision
    + case when v_changed then 1 else 0 end;
  return new;
end;
$function$;

revoke all on function private.advance_outcome_conversation_revision()
  from public, anon, authenticated, service_role;

create trigger outcomes_conversation_revision_owner
  before insert or update on public.outcomes
  for each row execute function private.advance_outcome_conversation_revision();

create or replace function public.save_own_outcome_conversation(
  p_outcome_id uuid,
  p_expected_conversation_revision integer,
  p_request_id text,
  p_conversation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_outcome public.outcomes%rowtype;
  v_request_sha256 text;
  v_receipt private.outcome_conversation_save_receipts%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_state text;
  v_conversation_sha256 text;
  v_conversation_context text;
  v_situation text;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'OUTCOME_CONVERSATION_AUTHENTICATION_REQUIRED';
  end if;
  if p_outcome_id is null
    or p_expected_conversation_revision is null
    or p_expected_conversation_revision < 0 then
    raise exception using errcode = '22023', message = 'OUTCOME_CONVERSATION_REVISION_REQUIRED';
  end if;
  if p_request_id is null
    or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception using errcode = '22023', message = 'OUTCOME_CONVERSATION_REQUEST_INVALID';
  end if;
  if pg_catalog.jsonb_typeof(p_conversation) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_conversation) < 1
    or pg_catalog.jsonb_array_length(p_conversation) > 256
    or pg_catalog.octet_length(p_conversation::text) > 262144 then
    raise exception using errcode = '22023', message = 'OUTCOME_CONVERSATION_INPUT_INVALID';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_conversation) message_record(value)
    where pg_catalog.jsonb_typeof(message_record.value) is distinct from 'object'
      or message_record.value->>'role' not in ('user', 'ted')
      or nullif(pg_catalog.btrim(message_record.value->>'text'), '') is null
      or pg_catalog.length(message_record.value->>'text') > 20000
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(message_record.value) field_record(name)
        where field_record.name not in ('role', 'text')
      )
  ) then
    raise exception using errcode = '22023', message = 'OUTCOME_CONVERSATION_MESSAGE_INVALID';
  end if;

  select pg_catalog.string_agg(
    case message_record.value->>'role'
      when 'ted' then 'TED: '
      else 'User: '
    end || (message_record.value->>'text'),
    E'\n' order by message_record.ordinality
  ) into v_conversation_context
  from pg_catalog.jsonb_array_elements(p_conversation)
    with ordinality as message_record(value, ordinality);
  if v_conversation_context is null
    or pg_catalog.length(v_conversation_context) > 262144 then
    raise exception using errcode = '22023', message = 'OUTCOME_CONVERSATION_INPUT_INVALID';
  end if;

  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'contract_version', 'outcome-conversation-save.1',
          'outcome_id', p_outcome_id,
          'expected_conversation_revision', p_expected_conversation_revision,
          'conversation', p_conversation
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_conversation_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'conversation', p_conversation,
          'conversation_context', v_conversation_context
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select receipt_record.* into v_receipt
  from private.outcome_conversation_save_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.outcome_id = p_outcome_id
    and receipt_record.request_id = p_request_id;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'OUTCOME_CONVERSATION_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt.result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  select outcome_record.* into v_outcome
  from public.outcomes outcome_record
  where outcome_record.id = p_outcome_id
    and outcome_record.user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'OUTCOME_CONVERSATION_UNAVAILABLE';
  end if;

  select receipt_record.* into v_receipt
  from private.outcome_conversation_save_receipts receipt_record
  where receipt_record.user_id = v_user_id
    and receipt_record.outcome_id = p_outcome_id
    and receipt_record.request_id = p_request_id;
  if found then
    if v_receipt.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode = '23505', message = 'OUTCOME_CONVERSATION_REPLAY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(
      v_receipt.result, '{idempotent_replay}', 'true'::jsonb, true
    );
  end if;

  if v_outcome.conversation_revision <> p_expected_conversation_revision then
    raise exception using errcode = '40001', message = 'OUTCOME_CONVERSATION_REVISION_CONFLICT';
  end if;
  if pg_catalog.jsonb_typeof(v_outcome.recommendation_payload) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.recommendation_payload->'primary')
      is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_outcome.recommendation_payload->'alternatives')
      is distinct from 'array' then
    raise exception using errcode = '55000', message = 'OUTCOME_CONVERSATION_BASE_UNAVAILABLE';
  end if;

  v_situation := case
    when pg_catalog.jsonb_typeof(v_outcome.recommendation_payload->'situation') = 'string'
      and nullif(pg_catalog.btrim(v_outcome.recommendation_payload->>'situation'), '') is not null
      then v_outcome.recommendation_payload->>'situation'
    else v_outcome.situation_text
  end;

  v_payload := pg_catalog.jsonb_set(
    v_outcome.recommendation_payload, '{conversation}', p_conversation, true
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload, '{conversation_context}', pg_catalog.to_jsonb(v_conversation_context), true
  );
  v_payload := pg_catalog.jsonb_set(
    v_payload, '{situation}', pg_catalog.to_jsonb(v_situation), true
  );

  if v_payload is not distinct from v_outcome.recommendation_payload then
    v_state := 'unchanged';
  else
    update public.outcomes outcome_record
    set recommendation_payload = v_payload,
        updated_at = pg_catalog.clock_timestamp()
    where outcome_record.id = p_outcome_id
      and outcome_record.user_id = v_user_id
      and outcome_record.conversation_revision = p_expected_conversation_revision
    returning outcome_record.* into v_outcome;
    if not found
      or v_outcome.conversation_revision <> p_expected_conversation_revision + 1 then
      raise exception using errcode = '40001', message = 'OUTCOME_CONVERSATION_REVISION_CONFLICT';
    end if;
    v_state := 'committed';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'contract_version', 'outcome-conversation-save.1',
    'state', v_state,
    'request_id', p_request_id,
    'outcome_id', p_outcome_id,
    'user_id', v_user_id,
    'accepted_conversation_revision', p_expected_conversation_revision,
    'conversation_revision', v_outcome.conversation_revision,
    'conversation_sha256', v_conversation_sha256,
    'updated_at', v_outcome.updated_at,
    'idempotent_replay', false
  );
  insert into private.outcome_conversation_save_receipts(
    user_id, outcome_id, request_id, request_sha256,
    accepted_conversation_revision, result
  ) values (
    v_user_id, p_outcome_id, p_request_id, v_request_sha256,
    p_expected_conversation_revision, v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.save_own_outcome_conversation(
  uuid, integer, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.save_own_outcome_conversation(
  uuid, integer, text, jsonb
) to authenticated;

commit;
