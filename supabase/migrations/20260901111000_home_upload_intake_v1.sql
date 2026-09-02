-- Preserve Home upload truth across reloads before a recommendation/outcome exists.
-- The browser must acknowledge this owner-scoped intake before it may call the
-- existing exactly-once ingest pipeline. No provider or Storage policy lives here.

begin;

create table if not exists private.home_upload_intakes (
  intake_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  upload_id uuid not null,
  state text not null default 'open',
  revision integer not null default 1,
  typed_situation text not null default '',
  file_name text not null,
  file_type text not null,
  file_size_bytes integer not null,
  content_sha256 text not null,
  confirmed_text text,
  confirmed_text_sha256 text,
  confirmation_request_sha256 text,
  commit_request_sha256 text,
  outcome_id uuid references public.outcomes(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  consumed_at timestamptz,
  constraint home_upload_intakes_state_check check (
    state in ('open', 'confirmed', 'cancelled', 'consumed')
  ),
  constraint home_upload_intakes_revision_check check (revision > 0),
  constraint home_upload_intakes_typed_situation_check check (
    char_length(typed_situation) <= 30000
  ),
  constraint home_upload_intakes_file_name_check check (
    nullif(pg_catalog.btrim(file_name), '') is not null
    and char_length(file_name) <= 300
  ),
  constraint home_upload_intakes_file_type_check check (
    nullif(pg_catalog.btrim(file_type), '') is not null
    and char_length(file_type) <= 200
  ),
  constraint home_upload_intakes_file_size_check check (
    file_size_bytes between 0 and 8388608
  ),
  constraint home_upload_intakes_content_sha256_check check (
    content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint home_upload_intakes_confirmed_text_check check (
    (confirmed_text is null and confirmed_text_sha256 is null
      and confirmation_request_sha256 is null and confirmed_at is null)
    or (
      nullif(pg_catalog.btrim(confirmed_text), '') is not null
      and char_length(confirmed_text) <= 20000
      and confirmed_text_sha256 ~ '^[0-9a-f]{64}$'
      and confirmation_request_sha256 ~ '^[0-9a-f]{64}$'
      and confirmed_at is not null
    )
  ),
  constraint home_upload_intakes_terminal_state_check check (
    (state = 'open' and confirmed_text is null
      and confirmation_request_sha256 is null and commit_request_sha256 is null
      and outcome_id is null and confirmed_at is null
      and consumed_at is null and cancelled_at is null)
    or (state = 'confirmed' and confirmed_text is not null
      and confirmation_request_sha256 is not null and commit_request_sha256 is null
      and outcome_id is null and consumed_at is null and cancelled_at is null)
    or (state = 'cancelled' and commit_request_sha256 is null
      and outcome_id is null and cancelled_at is not null and consumed_at is null)
    or (state = 'consumed' and confirmed_text is not null
      and confirmation_request_sha256 is not null
      and outcome_id = intake_id and consumed_at is not null
      and commit_request_sha256 ~ '^[0-9a-f]{64}$' and cancelled_at is null)
  ),
  constraint home_upload_intakes_time_check check (
    updated_at >= created_at
    and (confirmed_at is null or confirmed_at >= created_at)
    and (cancelled_at is null or cancelled_at >= created_at)
    and (consumed_at is null or consumed_at >= created_at)
  )
);

create unique index if not exists home_upload_intakes_owner_upload_live_unique
  on private.home_upload_intakes(user_id, upload_id)
  where state in ('open', 'confirmed', 'consumed');
create unique index if not exists home_upload_intakes_one_current_per_owner
  on private.home_upload_intakes(user_id)
  where state in ('open', 'confirmed');
create index if not exists home_upload_intakes_owner_updated
  on private.home_upload_intakes(user_id, updated_at desc);

alter table private.home_upload_intakes enable row level security;
revoke all on table private.home_upload_intakes
  from public, anon, authenticated, service_role;

create or replace function private.assert_home_upload_owner_active_v1(
  p_user_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 91000)
  );
  if exists (
    select 1
    from private.account_deletion_fences fence_record
    where fence_record.user_key = private.account_deletion_user_key(p_user_id)
  ) then
    raise exception 'ACCOUNT_DELETION_FENCED' using errcode = '55000';
  end if;
end;
$function$;

revoke all on function private.assert_home_upload_owner_active_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.valid_home_recommendation_payload_v1(
  p_payload jsonb
) returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.octet_length(
      pg_catalog.convert_to(p_payload::text, 'UTF8')
    ) > 262144
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_payload) key_record(key)
      where key_record.key <> all (array[
        'primary', 'alternatives', 'bundle_id', 'conversation', 'situation',
        'conversation_context', 'upload_context', 'upload_id'
      ]::text[])
    )
    or pg_catalog.jsonb_typeof(p_payload->'primary') is distinct from 'object'
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_payload->'primary') key_record(key)
      where key_record.key <> all (array['template_id', 'reason']::text[])
    )
    or pg_catalog.jsonb_typeof(p_payload#>'{primary,template_id}') is distinct from 'string'
    or nullif(pg_catalog.btrim(p_payload#>>'{primary,template_id}'), '') is null
    or pg_catalog.char_length(p_payload#>>'{primary,template_id}') > 160
    or pg_catalog.jsonb_typeof(p_payload#>'{primary,reason}') is distinct from 'string'
    or nullif(pg_catalog.btrim(p_payload#>>'{primary,reason}'), '') is null
    or pg_catalog.char_length(p_payload#>>'{primary,reason}') > 600
    or pg_catalog.jsonb_typeof(p_payload->'alternatives') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_payload->'alternatives') > 20
    or pg_catalog.jsonb_typeof(p_payload->'conversation') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_payload->'conversation') > 100
    or (p_payload ? 'bundle_id' and (
      pg_catalog.jsonb_typeof(p_payload->'bundle_id') is distinct from 'string'
      or nullif(pg_catalog.btrim(p_payload->>'bundle_id'), '') is null
      or pg_catalog.char_length(p_payload->>'bundle_id') > 160
    ))
    or (p_payload ? 'situation' and (
      pg_catalog.jsonb_typeof(p_payload->'situation') is distinct from 'string'
      or pg_catalog.char_length(p_payload->>'situation') > 30000
    ))
    or (p_payload ? 'conversation_context' and (
      pg_catalog.jsonb_typeof(p_payload->'conversation_context') is distinct from 'string'
      or pg_catalog.char_length(p_payload->>'conversation_context') > 30000
    ))
    or (p_payload ? 'upload_context' and (
      pg_catalog.jsonb_typeof(p_payload->'upload_context') is distinct from 'string'
      or pg_catalog.char_length(p_payload->>'upload_context') > 20000
    ))
    or (p_payload ? 'upload_id' and (
      pg_catalog.jsonb_typeof(p_payload->'upload_id') is distinct from 'string'
      or pg_catalog.char_length(p_payload->>'upload_id') > 100
    )) then
    return false;
  end if;

  for v_item in
    select item from pg_catalog.jsonb_array_elements(p_payload->'alternatives') item
  loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_item) key_record(key)
        where key_record.key <> all (array['template_id', 'reason']::text[])
      )
      or pg_catalog.jsonb_typeof(v_item->'template_id') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_item->>'template_id'), '') is null
      or pg_catalog.char_length(v_item->>'template_id') > 160
      or pg_catalog.jsonb_typeof(v_item->'reason') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_item->>'reason'), '') is null
      or pg_catalog.char_length(v_item->>'reason') > 600 then
      return false;
    end if;
  end loop;

  for v_item in
    select item from pg_catalog.jsonb_array_elements(p_payload->'conversation') item
  loop
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_item) key_record(key)
        where key_record.key <> all (array['role', 'text']::text[])
      )
      or pg_catalog.jsonb_typeof(v_item->'role') is distinct from 'string'
      or v_item->>'role' is null
      or v_item->>'role' not in ('user', 'ted')
      or pg_catalog.jsonb_typeof(v_item->'text') is distinct from 'string'
      or nullif(pg_catalog.btrim(v_item->>'text'), '') is null
      or pg_catalog.char_length(v_item->>'text') > 4000 then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function private.valid_home_recommendation_payload_v1(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.home_upload_intake_snapshot_v1(
  p_intake_id uuid,
  p_user_id uuid,
  p_idempotent_replay boolean default false
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_intake private.home_upload_intakes%rowtype;
  v_upload public.uploads%rowtype;
  v_has_upload boolean := false;
  v_valid_upload boolean := false;
  v_valid_completed boolean := false;
  v_upload_state text;
  v_safe_next_action text;
  v_retryable boolean := false;
begin
  select intake_record.* into v_intake
  from private.home_upload_intakes intake_record
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = p_user_id;
  if not found then return null; end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = v_intake.upload_id
    and upload_record.user_id = v_intake.user_id;
  v_has_upload := found;
  if v_has_upload then
    v_valid_upload :=
      v_upload.file_name = v_intake.file_name
      and v_upload.file_type = v_intake.file_type
      and v_upload.file_size_bytes = v_intake.file_size_bytes
      and v_upload.ingest_content_sha256 = v_intake.content_sha256
      and v_upload.outcome_id is null
      and v_upload.document_id is null;
    v_valid_completed := v_valid_upload
      and v_upload.status = 'ready'
      and v_upload.ingest_status = 'completed'
      and private.completed_upload_ingest_is_valid(
        v_upload.id,
        v_upload.ingest_response,
        v_upload.extracted_text,
        v_upload.extracted_payload
      );
  end if;

  if v_intake.state = 'cancelled' then
    v_upload_state := 'cancelled';
    v_safe_next_action := 'Start again or continue without the upload.';
  elsif v_intake.state = 'consumed' then
    v_upload_state := 'consumed';
    v_safe_next_action := 'Continue the saved outcome.';
  elsif not v_has_upload then
    v_upload_state := 'file_required';
    v_retryable := true;
    v_safe_next_action := 'Reselect the same file to continue this upload.';
  elsif not v_valid_upload then
    v_upload_state := 'terminal_failure';
    v_safe_next_action := 'Cancel this intake and start again.';
  elsif v_upload.ingest_status = 'processing' then
    v_upload_state := 'processing';
    v_retryable := true;
    v_safe_next_action := 'TED is still processing this upload.';
  elsif v_valid_completed then
    v_upload_state := case
      when v_intake.state = 'confirmed' then 'confirmed'
      else 'awaiting_confirmation'
    end;
    v_safe_next_action := case
      when v_intake.state = 'confirmed'
        then 'Continue with the text you confirmed.'
      else 'Review and confirm what TED read.'
    end;
  else
    v_upload_state := 'terminal_failure';
    v_safe_next_action := 'Cancel this intake and start again or type the important details.';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract_version', 'home-upload-intake.v1',
    'intake_id', v_intake.intake_id,
    'owner_user_id', v_intake.user_id,
    'upload_id', v_intake.upload_id,
    'state', v_intake.state,
    'revision', v_intake.revision,
    'typed_situation', v_intake.typed_situation,
    'file_name', v_intake.file_name,
    'file_type', v_intake.file_type,
    'file_size_bytes', v_intake.file_size_bytes,
    'content_sha256', v_intake.content_sha256,
    'upload_state', v_upload_state,
    'extracted_text', case
      when v_valid_completed and v_intake.state = 'open'
        then v_upload.extracted_text else null end,
    'confirm_payload', case
      when v_valid_completed and v_intake.state in ('open', 'confirmed')
        then v_upload.ingest_response->'confirm_payload' else null end,
    'confirmed_text', case
      when v_intake.state = 'consumed' then null::text
      else v_intake.confirmed_text end,
    'confirmed_text_sha256', case
      when v_intake.state = 'consumed' then null::text
      else v_intake.confirmed_text_sha256 end,
    'outcome_id', v_intake.outcome_id,
    'retryable', v_retryable,
    'safe_next_action', v_safe_next_action,
    'updated_at', v_intake.updated_at,
    'idempotent_replay', p_idempotent_replay
  );
end;
$function$;

revoke all on function private.home_upload_intake_snapshot_v1(
  uuid, uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function public.begin_own_home_upload_intake_v1(
  p_intake_id uuid,
  p_upload_id uuid,
  p_typed_situation text,
  p_file_name text,
  p_file_type text,
  p_file_size_bytes integer,
  p_content_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing private.home_upload_intakes%rowtype;
  v_upload public.uploads%rowtype;
  v_situation text := pg_catalog.btrim(coalesce(p_typed_situation, ''));
  v_file_name text := pg_catalog.btrim(coalesce(p_file_name, ''));
  v_file_type text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_file_type, ''))
  );
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_intake_id is null or p_upload_id is null
    or char_length(v_situation) > 30000
    or nullif(v_file_name, '') is null
    or char_length(v_file_name) > 300
    or nullif(v_file_type, '') is null
    or char_length(v_file_type) > 200
    or p_file_size_bytes is null or p_file_size_bytes < 0
    or p_file_size_bytes > 8388608
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'HOME_UPLOAD_INTAKE_INPUT_INVALID' using errcode = '22023';
  end if;

  perform private.assert_home_upload_owner_active_v1(v_user_id);
  select intake_record.* into v_existing
  from private.home_upload_intakes intake_record
  where intake_record.intake_id = p_intake_id
  for update;
  if found then
    if v_existing.user_id <> v_user_id
      or v_existing.upload_id <> p_upload_id
      or v_existing.typed_situation <> v_situation
      or v_existing.file_name <> v_file_name
      or v_existing.file_type <> v_file_type
      or v_existing.file_size_bytes <> p_file_size_bytes
      or v_existing.content_sha256 <> p_content_sha256 then
      raise exception 'HOME_UPLOAD_INTAKE_BEGIN_CONFLICT' using errcode = '40001';
    end if;
    return private.home_upload_intake_snapshot_v1(
      p_intake_id, v_user_id, true
    ) || pg_catalog.jsonb_build_object('accepted_revision', 0);
  end if;

  if exists (
    select 1 from private.home_upload_intakes intake_record
    where intake_record.user_id = v_user_id
      and intake_record.state in ('open', 'confirmed')
  ) then
    raise exception 'HOME_UPLOAD_INTAKE_ACTIVE' using errcode = '55000';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;
  if found and (
    v_upload.user_id is distinct from v_user_id
    or v_upload.file_name is distinct from v_file_name
    or v_upload.file_type is distinct from v_file_type
    or v_upload.file_size_bytes is distinct from p_file_size_bytes
    or v_upload.ingest_content_sha256 is distinct from p_content_sha256
    or v_upload.outcome_id is not null
    or v_upload.document_id is not null
    or not (
      (v_upload.status = 'processing' and v_upload.ingest_status = 'processing')
      or (
        v_upload.status = 'ready'
        and v_upload.ingest_status = 'completed'
        and private.completed_upload_ingest_is_valid(
          v_upload.id, v_upload.ingest_response,
          v_upload.extracted_text, v_upload.extracted_payload
        )
      )
    )
  ) then
    raise exception 'HOME_UPLOAD_INTAKE_BEGIN_CONFLICT' using errcode = '40001';
  end if;

  insert into private.home_upload_intakes(
    intake_id, user_id, upload_id, typed_situation, file_name, file_type,
    file_size_bytes, content_sha256
  ) values (
    p_intake_id, v_user_id, p_upload_id, v_situation, v_file_name,
    v_file_type, p_file_size_bytes,
    p_content_sha256
  );
  return private.home_upload_intake_snapshot_v1(
    p_intake_id, v_user_id, false
  ) || pg_catalog.jsonb_build_object('accepted_revision', 0);
end;
$function$;

create or replace function public.get_own_home_upload_intake_v1(
  p_intake_id uuid default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_intake_id uuid;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 91000)
  );
  if p_intake_id is not null then
    v_intake_id := p_intake_id;
  else
    select intake_record.intake_id into v_intake_id
    from private.home_upload_intakes intake_record
    where intake_record.user_id = v_user_id
      and intake_record.state in ('open', 'confirmed', 'consumed')
    order by
      case when intake_record.state in ('open', 'confirmed') then 0 else 1 end,
      intake_record.updated_at desc,
      intake_record.intake_id
    limit 1;
  end if;
  if v_intake_id is null then return null; end if;
  return private.home_upload_intake_snapshot_v1(
    v_intake_id, v_user_id, false
  );
end;
$function$;

create or replace function public.confirm_own_home_upload_intake_v1(
  p_intake_id uuid,
  p_expected_revision integer,
  p_confirmed_text text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_intake private.home_upload_intakes%rowtype;
  v_upload public.uploads%rowtype;
  v_text text := pg_catalog.btrim(coalesce(p_confirmed_text, ''));
  v_text_sha256 text;
  v_request_sha256 text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_intake_id is null or p_expected_revision is null
    or p_expected_revision < 1 or p_expected_revision = 2147483647
    or nullif(v_text, '') is null
    or char_length(v_text) > 20000 then
    raise exception 'HOME_UPLOAD_INTAKE_CONFIRM_INVALID' using errcode = '22023';
  end if;
  perform private.assert_home_upload_owner_active_v1(v_user_id);
  v_text_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_text, 'UTF8'), 'sha256'), 'hex'
  );
  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'contract', 'home-upload-intake-confirm.v1',
          'intake_id', p_intake_id,
          'expected_revision', p_expected_revision,
          'confirmed_text_sha256', v_text_sha256
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select intake_record.* into v_intake
  from private.home_upload_intakes intake_record
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = v_user_id
  for update;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_CONFIRM_CONFLICT' using errcode = '40001';
  end if;
  if v_intake.state = 'confirmed'
    and v_intake.revision = p_expected_revision + 1
    and v_intake.confirmation_request_sha256 = v_request_sha256
    and v_intake.confirmed_text_sha256 = v_text_sha256
    and v_intake.confirmed_text = v_text then
    return private.home_upload_intake_snapshot_v1(
      p_intake_id, v_user_id, true
    ) || pg_catalog.jsonb_build_object('accepted_revision', p_expected_revision);
  end if;
  if v_intake.state <> 'open' or v_intake.revision <> p_expected_revision then
    raise exception 'HOME_UPLOAD_INTAKE_CONFIRM_CONFLICT' using errcode = '40001';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = v_intake.upload_id
    and upload_record.user_id = v_user_id
  for update;
  if not found
    or v_upload.outcome_id is not null
    or v_upload.document_id is not null
    or v_upload.file_name <> v_intake.file_name
    or v_upload.file_type <> v_intake.file_type
    or v_upload.file_size_bytes <> v_intake.file_size_bytes
    or v_upload.ingest_content_sha256 <> v_intake.content_sha256
    or v_upload.status <> 'ready'
    or v_upload.ingest_status <> 'completed'
    or not private.completed_upload_ingest_is_valid(
      v_upload.id, v_upload.ingest_response,
      v_upload.extracted_text, v_upload.extracted_payload
    ) then
    raise exception 'HOME_UPLOAD_INTAKE_NOT_CONFIRMABLE' using errcode = '55000';
  end if;

  update private.home_upload_intakes intake_record
  set state = 'confirmed',
      revision = p_expected_revision + 1,
      confirmed_text = v_text,
      confirmed_text_sha256 = v_text_sha256,
      confirmation_request_sha256 = v_request_sha256,
      confirmed_at = v_now,
      updated_at = v_now
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = v_user_id
    and intake_record.state = 'open'
    and intake_record.revision = p_expected_revision
  returning intake_record.* into v_intake;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_CONFIRM_CONFLICT' using errcode = '40001';
  end if;
  return private.home_upload_intake_snapshot_v1(
    p_intake_id, v_user_id, false
  ) || pg_catalog.jsonb_build_object('accepted_revision', p_expected_revision);
end;
$function$;

create or replace function public.cancel_own_home_upload_intake_v1(
  p_intake_id uuid,
  p_expected_revision integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_intake private.home_upload_intakes%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_intake_id is null or p_expected_revision is null
    or p_expected_revision < 1 or p_expected_revision = 2147483647 then
    raise exception 'HOME_UPLOAD_INTAKE_CANCEL_INVALID' using errcode = '22023';
  end if;
  perform private.assert_home_upload_owner_active_v1(v_user_id);
  select intake_record.* into v_intake
  from private.home_upload_intakes intake_record
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = v_user_id
  for update;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_CANCEL_CONFLICT' using errcode = '40001';
  end if;
  if v_intake.state = 'cancelled'
    and v_intake.revision = p_expected_revision + 1 then
    return private.home_upload_intake_snapshot_v1(
      p_intake_id, v_user_id, true
    ) || pg_catalog.jsonb_build_object('accepted_revision', p_expected_revision);
  end if;
  if v_intake.state not in ('open', 'confirmed')
    or v_intake.revision <> p_expected_revision then
    raise exception 'HOME_UPLOAD_INTAKE_CANCEL_CONFLICT' using errcode = '40001';
  end if;
  update private.home_upload_intakes intake_record
  set state = 'cancelled',
      revision = p_expected_revision + 1,
      cancelled_at = v_now,
      updated_at = v_now
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = v_user_id
    and intake_record.state in ('open', 'confirmed')
    and intake_record.revision = p_expected_revision
  returning intake_record.* into v_intake;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_CANCEL_CONFLICT' using errcode = '40001';
  end if;
  return private.home_upload_intake_snapshot_v1(
    p_intake_id, v_user_id, false
  ) || pg_catalog.jsonb_build_object('accepted_revision', p_expected_revision);
end;
$function$;

create or replace function public.commit_own_home_upload_intake_v1(
  p_intake_id uuid,
  p_expected_revision integer,
  p_situation_text text,
  p_recommendation_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_intake private.home_upload_intakes%rowtype;
  v_upload public.uploads%rowtype;
  v_existing_outcome public.outcomes%rowtype;
  v_situation text := pg_catalog.btrim(coalesce(p_situation_text, ''));
  v_payload jsonb;
  v_request_sha256 text;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_intake_id is null or p_expected_revision is null
    or p_expected_revision < 1 or p_expected_revision = 2147483647
    or nullif(v_situation, '') is null
    or char_length(v_situation) > 30000
    or not private.valid_home_recommendation_payload_v1(
      p_recommendation_payload
    ) then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_INVALID' using errcode = '22023';
  end if;
  perform private.assert_home_upload_owner_active_v1(v_user_id);

  select intake_record.* into v_intake
  from private.home_upload_intakes intake_record
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = v_user_id
  for update;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
  end if;

  v_payload := p_recommendation_payload || pg_catalog.jsonb_build_object(
    'situation', v_situation,
    'upload_context', v_intake.confirmed_text,
    'upload_id', v_intake.upload_id::text
  );
  v_request_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'contract', 'home-upload-intake-commit.v1',
          'intake_id', p_intake_id,
          'expected_revision', p_expected_revision,
          'situation', v_situation,
          'recommendation_payload', v_payload
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_intake.state = 'consumed' then
    if v_intake.revision <> p_expected_revision + 1
      or v_intake.outcome_id <> p_intake_id
      or v_intake.commit_request_sha256 <> v_request_sha256
      or not exists (
        select 1 from public.outcomes outcome_record
        where outcome_record.id = v_intake.outcome_id
          and outcome_record.user_id = v_user_id
      )
      or not exists (
        select 1 from public.uploads upload_record
        where upload_record.id = v_intake.upload_id
          and upload_record.user_id = v_user_id
          and upload_record.outcome_id = v_intake.outcome_id
      ) then
      raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
    end if;
    return pg_catalog.jsonb_build_object(
      'contract_version', 'home-upload-intake-commit.v1',
      'intake_id', p_intake_id,
      'owner_user_id', v_user_id,
      'upload_id', v_intake.upload_id,
      'accepted_revision', p_expected_revision,
      'revision', v_intake.revision,
      'state', 'consumed',
      'outcome_id', v_intake.outcome_id,
      'situation', v_situation,
      'template_id', v_payload#>>'{primary,template_id}',
      'template_name', v_payload#>>'{primary,reason}',
      'conversation_context', coalesce(v_payload->>'conversation_context', ''),
      'upload_context', v_intake.confirmed_text,
      'committed_at', v_intake.consumed_at,
      'idempotent_replay', true
    );
  end if;
  if v_intake.state <> 'confirmed'
    or v_intake.revision <> p_expected_revision
    or v_intake.confirmed_text is null then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = v_intake.upload_id
    and upload_record.user_id = v_user_id
  for update;
  if not found or v_upload.outcome_id is not null
    or v_upload.document_id is not null
    or v_upload.file_name <> v_intake.file_name
    or v_upload.file_type <> v_intake.file_type
    or v_upload.file_size_bytes <> v_intake.file_size_bytes
    or v_upload.ingest_content_sha256 <> v_intake.content_sha256
    or v_upload.status <> 'ready' or v_upload.ingest_status <> 'completed'
    or not private.completed_upload_ingest_is_valid(
      v_upload.id, v_upload.ingest_response,
      v_upload.extracted_text, v_upload.extracted_payload
    ) then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
  end if;

  select outcome_record.* into v_existing_outcome
  from public.outcomes outcome_record
  where outcome_record.id = p_intake_id
  for update;
  if found then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
  end if;

  insert into public.outcomes(
    id, user_id, situation_text, recommendation_payload, status,
    is_saved, created_at, updated_at
  ) values (
    p_intake_id, v_user_id, v_situation, v_payload, 'in_progress',
    false, v_now, v_now
  );
  update public.uploads upload_record
  set outcome_id = p_intake_id
  where upload_record.id = v_intake.upload_id
    and upload_record.user_id = v_user_id
    and upload_record.outcome_id is null
    and upload_record.document_id is null
  returning upload_record.* into v_upload;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
  end if;
  update private.home_upload_intakes intake_record
  set state = 'consumed',
      revision = p_expected_revision + 1,
      outcome_id = p_intake_id,
      commit_request_sha256 = v_request_sha256,
      consumed_at = v_now,
      updated_at = v_now
  where intake_record.intake_id = p_intake_id
    and intake_record.user_id = v_user_id
    and intake_record.state = 'confirmed'
    and intake_record.revision = p_expected_revision
  returning intake_record.* into v_intake;
  if not found then
    raise exception 'HOME_UPLOAD_INTAKE_COMMIT_CONFLICT' using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'contract_version', 'home-upload-intake-commit.v1',
    'intake_id', p_intake_id,
    'owner_user_id', v_user_id,
    'upload_id', v_intake.upload_id,
    'accepted_revision', p_expected_revision,
    'revision', v_intake.revision,
    'state', 'consumed',
    'outcome_id', p_intake_id,
    'situation', v_situation,
    'template_id', v_payload#>>'{primary,template_id}',
    'template_name', v_payload#>>'{primary,reason}',
    'conversation_context', coalesce(v_payload->>'conversation_context', ''),
    'upload_context', v_intake.confirmed_text,
    'committed_at', v_now,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.begin_own_home_upload_intake_v1(
  uuid, uuid, text, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.get_own_home_upload_intake_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_own_home_upload_intake_v1(
  uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.cancel_own_home_upload_intake_v1(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_own_home_upload_intake_v1(
  uuid, integer, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.begin_own_home_upload_intake_v1(
  uuid, uuid, text, text, text, integer, text
) to authenticated;
grant execute on function public.get_own_home_upload_intake_v1(uuid)
  to authenticated;
grant execute on function public.confirm_own_home_upload_intake_v1(
  uuid, integer, text
) to authenticated;
grant execute on function public.cancel_own_home_upload_intake_v1(uuid, integer)
  to authenticated;
grant execute on function public.commit_own_home_upload_intake_v1(
  uuid, integer, text, jsonb
) to authenticated;

commit;
