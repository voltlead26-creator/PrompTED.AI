-- Dormant exact-review provenance on the existing legacy authorities. This
-- accepts sources before reviewer dispatch only; it does not attest that an
-- earlier writer used those sources, approve wording, attach a workspace, or
-- activate a new generation path. Historical rows begin and remain null unless
-- the explicit command safely binds an owned, undispatched admission.

create function private.legacy_document_audit_source_sha256(p_sources jsonb)
returns text language plpgsql immutable strict set search_path = '' as $function$
declare
  v_field jsonb;
  v_text text;
  v_bytes integer := 0;
  v_frame text := '21:legacy-audit-source.1' || '1:5';
begin
  -- JSON escaping can expand admitted control characters by six times. This
  -- representation guard is deliberately separate from the exact raw-byte cap.
  if pg_catalog.octet_length(p_sources::text) > 8388608
    or pg_catalog.jsonb_typeof(p_sources) is distinct from 'array' then
    raise exception 'LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID';
  end if;
  if pg_catalog.jsonb_array_length(p_sources) <> 5 then
    raise exception 'LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID';
  end if;
  for v_field in select value from pg_catalog.jsonb_array_elements(p_sources) loop
    if pg_catalog.jsonb_typeof(v_field) is distinct from 'string' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID';
    end if;
    -- PostgreSQL JSONB rejects NUL and unpaired surrogates before this boundary.
    -- No trimming, case folding, newline conversion, or Unicode normalisation.
    v_text := v_field #>> '{}';
    v_bytes := v_bytes + pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8'));
    if v_bytes > 1048576 then
      raise exception 'LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID';
    end if;
    v_frame := v_frame || pg_catalog.octet_length(pg_catalog.convert_to(v_text,'UTF8'))::text || ':' || v_text;
  end loop;
  return pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_frame,'UTF8'),'sha256'),'hex');
end;
$function$;

create function private.legacy_document_audit_metadata_text_valid(p_value jsonb,p_limit integer)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_text text;
begin
  if p_value is null or p_limit is null or p_limit not between 1 and 1000
    or pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  v_text := p_value #>> '{}';
  if pg_catalog.octet_length(v_text) > p_limit * 4
    or pg_catalog.length(pg_catalog.btrim(v_text,
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) = 0 then
    return false;
  end if;
  -- Reuse the existing exact Unicode-to-UTF16 utility. Its XML mode is off;
  -- ordinary admitted control characters remain literal data.
  return pg_catalog.cardinality(private.upload_source_utf16_units(v_text,false)) <= p_limit;
end;
$function$;

create function private.legacy_document_audit_identifier_valid(p_value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $function$
declare v_text text;
begin
  if not private.legacy_document_audit_metadata_text_valid(p_value,200) then return false; end if;
  v_text := p_value #>> '{}';
  -- Match the existing TypeScript identifier boundary exactly. Labels retain
  -- their literal whitespace; identifiers must already be in their trim form.
  return v_text collate "C" = pg_catalog.btrim(v_text,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') collate "C";
end;
$function$;

create function private.normalize_legacy_document_audit_binding(p_binding jsonb)
returns jsonb language plpgsql immutable strict set search_path = '' as $function$
declare
  v_kind text;
  v_round integer;
  v_field text;
  v_section jsonb;
  v_unit jsonb;
  v_key text;
  v_keys text[] := array[]::text[];
  v_ordinals integer[] := array[]::integer[];
  v_index integer;
  v_previous integer := 0;
begin
  -- Four MiB exceeds the worst JSON escaping of the closed 128/512 row and
  -- UTF16 field limits in both compact JS JSON and PostgreSQL JSONB text.
  if pg_catalog.octet_length(p_binding::text) > 4194304
    or not private.jsonb_has_exact_keys(p_binding,array[
      'version','digest_version','validator_version','unit_policy_version',
      'review_kind','round','output_schema_name','output_schema_version',
      'evidence_mode','source_sha256','execution_policy_version',
      'execution_policy_sha256','target_sha256','sections','units']) then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
  end if;
  if p_binding->'version' is distinct from '"legacy-document-audit-binding.1"'::jsonb
    or p_binding->'digest_version' is distinct from '"legacy-document-audit-digests.1"'::jsonb
    or p_binding->'validator_version' is distinct from '"legacy-wording-assessment.1"'::jsonb
    or p_binding->'unit_policy_version' is distinct from '"legacy-factual-units.2"'::jsonb
    or p_binding->'evidence_mode' is distinct from '"verbatim"'::jsonb
    or p_binding->'execution_policy_version' is distinct from '"legacy-template-policy.1"'::jsonb
    or pg_catalog.jsonb_typeof(p_binding->'round') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_binding->'sections') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_binding->'units') is distinct from 'array'
    or p_binding->'review_kind' not in ('"quality"'::jsonb,'"grounding"'::jsonb) then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
  end if;
  if (p_binding->>'round')::numeric not between 0 and 3
    or (p_binding->>'round')::numeric <> pg_catalog.trunc((p_binding->>'round')::numeric) then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
  end if;
  v_round := (p_binding->>'round')::numeric::integer;
  v_kind := p_binding->>'review_kind';
  if p_binding->'output_schema_name' is distinct from pg_catalog.to_jsonb('prompted_document_'||v_kind||'_audit')
    or p_binding->'output_schema_version' is distinct from pg_catalog.to_jsonb('document-'||v_kind||'-audit.1')
    or pg_catalog.jsonb_array_length(p_binding->'sections') not between 1 and 128
    or pg_catalog.jsonb_array_length(p_binding->'units') > 512
    or (v_kind='grounding' and pg_catalog.jsonb_array_length(p_binding->'units')=0) then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
  end if;
  foreach v_field in array array['source_sha256','execution_policy_sha256','target_sha256'] loop
    if pg_catalog.jsonb_typeof(p_binding->v_field) is distinct from 'string'
      or (p_binding->>v_field) !~ '^[0-9a-f]{64}$' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
    end if;
  end loop;
  for v_section in select value from pg_catalog.jsonb_array_elements(p_binding->'sections') loop
    if not private.jsonb_has_exact_keys(v_section,array['key','label','content_sha256'])
      or not private.legacy_document_audit_identifier_valid(v_section->'key')
      or not private.legacy_document_audit_metadata_text_valid(v_section->'label',1000)
      or pg_catalog.jsonb_typeof(v_section->'content_sha256') is distinct from 'string'
      or (v_section->>'content_sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
    end if;
    v_key := v_section->>'key';
    if v_key collate "C" = any(v_keys) then raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'; end if;
    v_keys := pg_catalog.array_append(v_keys,v_key);
    v_ordinals := pg_catalog.array_append(v_ordinals,0);
  end loop;
  for v_unit in select value from pg_catalog.jsonb_array_elements(p_binding->'units') loop
    if not private.jsonb_has_exact_keys(v_unit,array['id','section_key','content_sha256'])
      or not private.legacy_document_audit_identifier_valid(v_unit->'id')
      or not private.legacy_document_audit_identifier_valid(v_unit->'section_key')
      or pg_catalog.jsonb_typeof(v_unit->'content_sha256') is distinct from 'string'
      or (v_unit->>'content_sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
    end if;
    v_key := v_unit->>'section_key';
    v_index := pg_catalog.array_position(v_keys collate "C",v_key collate "C");
    if v_index is null or v_index < v_previous then raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID'; end if;
    v_ordinals[v_index] := v_ordinals[v_index]+1;
    if (v_unit->>'id') collate "C" is distinct from (v_key||'#'||v_ordinals[v_index]) collate "C" then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
    end if;
    v_previous := v_index;
  end loop;
  -- Normalise only integral JSON number spelling, matching the JS number.
  return pg_catalog.jsonb_set(p_binding,'{round}',pg_catalog.to_jsonb(v_round));
end;
$function$;

alter table private.document_allowance_reservations
  add column audit_source_snapshot jsonb,
  add column audit_source_sha256 text,
  add column audit_source_digest_version text,
  add constraint document_allowance_audit_source_shape check (
    (audit_source_snapshot is null and audit_source_sha256 is null and audit_source_digest_version is null)
    or (audit_source_snapshot is not null and audit_source_sha256 is not null and audit_source_digest_version is not null
      and audit_source_digest_version='legacy-document-audit-digests.1'
      and audit_source_sha256 ~ '^[0-9a-f]{64}$'
      and audit_source_sha256=private.legacy_document_audit_source_sha256(audit_source_snapshot)
      and route_key='generate-document' and captured_operation_id is null
      and execution_policy_version is not null and execution_policy_version='legacy-template-policy.1'
      and execution_policy_sha256 is not null)
  );

alter table private.legacy_model_attempt_admissions
  add column audit_binding jsonb,
  add column audit_binding_sha256 text,
  add constraint legacy_model_admission_audit_binding_shape check (
    (audit_binding is null and audit_binding_sha256 is null)
    or (audit_binding is not null and audit_binding_sha256 is not null
      and audit_binding=private.normalize_legacy_document_audit_binding(audit_binding)
      and audit_binding_sha256=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(audit_binding::text,'UTF8'),'sha256'),'hex')
      and checkpoint_scope='generate-document' and origin_reservation_id is not null
      and logical_stage_key='generate-document.'||(audit_binding->>'review_kind')||':round-'||(audit_binding->>'round'))
  );

create function private.preserve_legacy_document_audit_source()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.audit_source_snapshot is not null and (
    new.audit_source_snapshot is distinct from old.audit_source_snapshot
    or new.audit_source_sha256 is distinct from old.audit_source_sha256
    or new.audit_source_digest_version is distinct from old.audit_source_digest_version
    or new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.request_id is distinct from old.request_id or new.request_sha256 is distinct from old.request_sha256
    or new.route_key is distinct from old.route_key or new.captured_operation_id is distinct from old.captured_operation_id
    or new.execution_policy_version is distinct from old.execution_policy_version
    or new.execution_policy_sha256 is distinct from old.execution_policy_sha256
  ) then raise exception 'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_SOURCE'; end if;
  return new;
end;
$function$;
create trigger document_allowance_audit_source_immutable
  before update on private.document_allowance_reservations
  for each row execute function private.preserve_legacy_document_audit_source();

create function private.preserve_legacy_document_audit_binding()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_source private.document_allowance_reservations%rowtype;
begin
  if tg_op='UPDATE' and old.audit_binding is not null then
    if new.audit_binding is distinct from old.audit_binding
      or new.audit_binding_sha256 is distinct from old.audit_binding_sha256
      or new.id is distinct from old.id or new.user_id is distinct from old.user_id
      or new.checkpoint_scope is distinct from old.checkpoint_scope
      or new.logical_request_id is distinct from old.logical_request_id
      or new.logical_stage_key is distinct from old.logical_stage_key
      or new.request_sha256 is distinct from old.request_sha256
      or new.attempt_number is distinct from old.attempt_number
      or new.origin_reservation_id is distinct from old.origin_reservation_id
      or new.prepared_at is distinct from old.prepared_at then
      raise exception 'IMMUTABLE_LEGACY_DOCUMENT_AUDIT_BINDING';
    end if;
    -- Existing token recovery, dispatch, heartbeat, and reconciliation updates
    -- remain legal. Deletion uses the existing owner-scoped cascade.
    return new;
  end if;
  if new.audit_binding is not null then
    if new.dispatched_at is not null or new.dispatch_token is not null
      or exists (select 1 from public.usage_ledger u where u.user_id=new.user_id
        and u.checkpoint_scope=new.checkpoint_scope and u.logical_request_id=new.logical_request_id
        and u.logical_stage_key=new.logical_stage_key and u.model_call_key is not null
        and (u.provider_attempt_id=new.id::text or u.provider_attempt_number=new.attempt_number))
      or exists (select 1 from private.legacy_model_call_results r where r.user_id=new.user_id
        and r.checkpoint_scope=new.checkpoint_scope and r.logical_request_id=new.logical_request_id
        and r.logical_stage_key=new.logical_stage_key) then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED';
    end if;
    select * into v_source from private.document_allowance_reservations r
      where r.id=new.origin_reservation_id and r.user_id=new.user_id;
    if not found or v_source.request_id is distinct from new.logical_request_id
      or v_source.route_key is distinct from new.checkpoint_scope
      or v_source.audit_source_snapshot is null
      or new.audit_binding->>'source_sha256' is distinct from v_source.audit_source_sha256
      or new.audit_binding->>'digest_version' is distinct from v_source.audit_source_digest_version
      or new.audit_binding->>'execution_policy_version' is distinct from v_source.execution_policy_version
      or new.audit_binding->>'execution_policy_sha256' is distinct from v_source.execution_policy_sha256 then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
    end if;
  end if;
  return new;
end;
$function$;
create trigger legacy_model_admission_audit_binding_immutable
  before insert or update on private.legacy_model_attempt_admissions
  for each row execute function private.preserve_legacy_document_audit_binding();

revoke all on function private.legacy_document_audit_source_sha256(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.legacy_document_audit_metadata_text_valid(jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function private.legacy_document_audit_identifier_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.normalize_legacy_document_audit_binding(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.preserve_legacy_document_audit_source() from public,anon,authenticated,service_role;
revoke all on function private.preserve_legacy_document_audit_binding() from public,anon,authenticated,service_role;

create function public.read_legacy_document_audit_checkpoint_v1(
  p_user_id uuid,
  p_checkpoint_scope text,
  p_origin_reservation_id uuid,
  p_logical_request_id text,
  p_logical_stage_key text,
  p_request_sha256 text,
  p_max_attempts integer,
  p_execution_claim_token uuid,
  p_allocate_attempt boolean,
  p_audit_binding jsonb,
  p_with_fallback boolean,
  p_source_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_binding jsonb;
  v_binding_sha256 text;
  v_source_sha256 text;
  v_period_start timestamptz;
  v_reservation private.document_allowance_reservations%rowtype;
  v_origin private.document_allowance_reservations%rowtype;
  v_admission private.legacy_model_attempt_admissions%rowtype;
  v_result private.legacy_model_call_results%rowtype;
  v_usage public.usage_ledger%rowtype;
  v_prior record;
  v_checkpoint jsonb;
  v_has_usage boolean;
  v_has_result boolean;
begin
  if p_user_id is null or p_checkpoint_scope is distinct from 'generate-document'
    or p_origin_reservation_id is null or p_execution_claim_token is null
    or p_logical_request_id is null or p_logical_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    or p_logical_stage_key is null or p_logical_stage_key !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
    or p_request_sha256 is null or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_max_attempts is null or p_max_attempts not between 1 and 2
    or p_allocate_attempt is null or p_with_fallback is null or p_audit_binding is null then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
  end if;
  v_binding := private.normalize_legacy_document_audit_binding(p_audit_binding);
  if p_logical_stage_key is distinct from
    'generate-document.'||(v_binding->>'review_kind')||':round-'||(v_binding->>'round') then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_INVALID';
  end if;
  v_source_sha256 := private.legacy_document_audit_source_sha256(p_source_snapshot);
  if v_source_sha256 is null or v_source_sha256 is distinct from v_binding->>'source_sha256' then
    raise exception 'LEGACY_DOCUMENT_AUDIT_SOURCE_INVALID';
  end if;
  v_binding_sha256 := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_binding::text,'UTF8'),'sha256'),'hex');

  -- Acquire the unchanged reader's exact existing lock order BEFORE calling it.
  -- Its entry clock is therefore sampled after these waits. No late terminal
  -- accounting command or historical reader is modified by this new boundary.
  select r.billing_period_start into v_period_start
    from private.document_allowance_reservations r
    where r.id=p_origin_reservation_id and r.user_id=p_user_id;
  if not found then raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID'; end if;
  perform private.document_allowance_lock(p_user_id,v_period_start);
  select * into v_reservation from private.document_allowance_reservations r
    where r.id=p_origin_reservation_id and r.user_id=p_user_id for update;
  if not found or v_reservation.request_id is distinct from p_logical_request_id
    or v_reservation.route_key is distinct from p_checkpoint_scope
    or v_reservation.captured_operation_id is not null then
    raise exception 'LEGACY_MODEL_RESULT_RESERVATION_INVALID';
  end if;
  perform 1 from private.legacy_generation_execution_claims c
    where c.reservation_id=p_origin_reservation_id and c.user_id=p_user_id for update;
  if p_with_fallback then
    v_checkpoint := public.read_legacy_model_call_checkpoint_with_fallback(
      p_user_id,p_checkpoint_scope,p_origin_reservation_id,p_logical_request_id,
      p_logical_stage_key,p_request_sha256,p_max_attempts,p_execution_claim_token,p_allocate_attempt);
  else
    v_checkpoint := public.read_legacy_model_call_checkpoint(
      p_user_id,p_checkpoint_scope,p_origin_reservation_id,p_logical_request_id,
      p_logical_stage_key,p_request_sha256,p_max_attempts,p_execution_claim_token,p_allocate_attempt);
  end if;
  if v_reservation.execution_policy_version is distinct from v_binding->>'execution_policy_version'
    or v_reservation.execution_policy_sha256 is distinct from v_binding->>'execution_policy_sha256' then
    raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
  end if;

  -- The live owner/request reservation is unique. Its existing allowance lock
  -- serialises admission and release. Accepted predecessors are immutable and
  -- are inspected only after the current reservation/claim lock ordering.
  for v_prior in select r.audit_source_snapshot,r.audit_source_sha256,r.audit_source_digest_version,
      r.request_sha256,r.execution_policy_version,r.execution_policy_sha256
    from private.document_allowance_reservations r
    where r.user_id=p_user_id and r.request_id=p_logical_request_id
      and r.route_key=p_checkpoint_scope and r.audit_source_snapshot is not null loop
    if v_prior.audit_source_snapshot is distinct from p_source_snapshot
      or v_prior.audit_source_sha256 is distinct from v_source_sha256
      or v_prior.audit_source_digest_version is distinct from v_binding->>'digest_version' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_SOURCE_CONFLICT';
    end if;
    if v_prior.request_sha256 is distinct from v_reservation.request_sha256
      or v_prior.execution_policy_version is distinct from v_reservation.execution_policy_version
      or v_prior.execution_policy_sha256 is distinct from v_reservation.execution_policy_sha256 then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
    end if;
  end loop;
  for v_prior in select a.audit_binding from private.legacy_model_attempt_admissions a
    where a.user_id=p_user_id and a.checkpoint_scope=p_checkpoint_scope
      and a.logical_request_id=p_logical_request_id and a.audit_binding is not null
      and a.audit_binding->'round'=v_binding->'round' loop
    if (v_prior.audit_binding-array['review_kind','output_schema_name','output_schema_version'])
      is distinct from (v_binding-array['review_kind','output_schema_name','output_schema_version']) then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
    end if;
  end loop;

  if v_checkpoint->>'state'='not_found' then
    -- This includes observing the next, not-yet-allocated retry. No candidate
    -- source or attempt is accepted by a missing-checkpoint read.
    return pg_catalog.jsonb_build_object('contract_version','legacy-document-audit-checkpoint.1',
      'checkpoint',v_checkpoint,'audit_binding',null,'audit_binding_sha256',null);
  end if;

  if v_checkpoint->>'state'='replay' then
    select * into v_result from private.legacy_model_call_results r
      where r.user_id=p_user_id and r.checkpoint_scope=p_checkpoint_scope
        and r.logical_request_id=p_logical_request_id and r.logical_stage_key=p_logical_stage_key;
    if not found or v_result.request_sha256 is distinct from p_request_sha256
      or v_result.response_sha256 is distinct from v_checkpoint->>'response_sha256' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED';
    end if;
    select * into v_usage from public.usage_ledger u
      where u.id=v_result.usage_ledger_id and u.user_id=p_user_id;
    if not found or v_usage.id::text is distinct from v_checkpoint#>>'{usage,usage_ledger_id}'
      or v_usage.event_type is distinct from 'model_call'
      or v_usage.checkpoint_scope is distinct from p_checkpoint_scope
      or v_usage.logical_request_id is distinct from p_logical_request_id
      or v_usage.logical_stage_key is distinct from p_logical_stage_key
      or v_usage.provider_request_sha256 is distinct from p_request_sha256 then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED';
    end if;
    -- provider_attempt_id is historical TEXT. Match the actual admission UUID
    -- as text rather than casting an arbitrary historical provider identifier.
    select * into v_admission from private.legacy_model_attempt_admissions a
      where a.id::text=v_usage.provider_attempt_id and a.user_id=p_user_id
        and a.checkpoint_scope=p_checkpoint_scope and a.logical_request_id=p_logical_request_id
        and a.logical_stage_key=p_logical_stage_key and a.request_sha256=p_request_sha256
        and a.attempt_number=v_usage.provider_attempt_number;
    if not found then raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED'; end if;
  elsif v_checkpoint ? 'attempt_admission_id' then
    select * into v_admission from private.legacy_model_attempt_admissions a
      where a.id::text=v_checkpoint->>'attempt_admission_id' and a.user_id=p_user_id
        and a.checkpoint_scope=p_checkpoint_scope and a.logical_request_id=p_logical_request_id
        and a.logical_stage_key=p_logical_stage_key and a.request_sha256=p_request_sha256;
    if not found then raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED'; end if;
  else
    select * into v_admission from private.legacy_model_attempt_admissions a
      where a.user_id=p_user_id and a.checkpoint_scope=p_checkpoint_scope
        and a.logical_request_id=p_logical_request_id and a.logical_stage_key=p_logical_stage_key
        and a.request_sha256=p_request_sha256
      order by a.attempt_number desc limit 1;
    if not found then
      if exists (select 1 from public.usage_ledger u where u.user_id=p_user_id
          and u.checkpoint_scope=p_checkpoint_scope and u.logical_request_id=p_logical_request_id
          and u.logical_stage_key=p_logical_stage_key and u.model_call_key is not null)
        or exists (select 1 from private.legacy_model_call_results r where r.user_id=p_user_id
          and r.checkpoint_scope=p_checkpoint_scope and r.logical_request_id=p_logical_request_id
          and r.logical_stage_key=p_logical_stage_key) then
        raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED';
      end if;
      return pg_catalog.jsonb_build_object('contract_version','legacy-document-audit-checkpoint.1',
        'checkpoint',v_checkpoint,'audit_binding',null,'audit_binding_sha256',null);
    end if;
  end if;

  -- A later attempt cannot retroactively relabel a null prior admission. All
  -- attempts in this audited stage share the same exact pre-dispatch metadata.
  for v_prior in select a.id,a.audit_binding from private.legacy_model_attempt_admissions a
    where a.user_id=p_user_id and a.checkpoint_scope=p_checkpoint_scope
      and a.logical_request_id=p_logical_request_id and a.logical_stage_key=p_logical_stage_key
      and a.id<>v_admission.id loop
    if v_prior.audit_binding is null then raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED'; end if;
    if v_prior.audit_binding is distinct from v_binding then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
    end if;
  end loop;

  if v_admission.audit_binding is null then
    select exists (select 1 from public.usage_ledger u where u.user_id=p_user_id
      and u.checkpoint_scope=p_checkpoint_scope and u.logical_request_id=p_logical_request_id
      and u.logical_stage_key=p_logical_stage_key and u.model_call_key is not null
      and (u.provider_attempt_id=v_admission.id::text or u.provider_attempt_number=v_admission.attempt_number)) into v_has_usage;
    select exists (select 1 from private.legacy_model_call_results r where r.user_id=p_user_id
      and r.checkpoint_scope=p_checkpoint_scope and r.logical_request_id=p_logical_request_id
      and r.logical_stage_key=p_logical_stage_key) into v_has_result;
    if v_checkpoint->>'state' is distinct from 'prepared'
      or v_admission.dispatched_at is not null or v_admission.dispatch_token is not null
      or v_has_usage or v_has_result
      or v_admission.origin_reservation_id is distinct from p_origin_reservation_id
      or v_admission.claim_token is distinct from p_execution_claim_token then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_REQUIRED';
    end if;
    if not p_allocate_attempt then
      -- The old document reader can report an existing prepared admission on a
      -- nonallocating probe. Preserve that literal inspection result without
      -- binding anything. The allocating call must obtain proof before dispatch.
      return pg_catalog.jsonb_build_object('contract_version','legacy-document-audit-checkpoint.1',
        'checkpoint',v_checkpoint,'audit_binding',null,'audit_binding_sha256',null);
    end if;
  else
    if v_admission.audit_binding is distinct from v_binding
      or v_admission.audit_binding_sha256 is distinct from v_binding_sha256 then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
    end if;
    select * into v_origin from private.document_allowance_reservations r
      where r.id=v_admission.origin_reservation_id and r.user_id=p_user_id;
    if not found or v_origin.request_id is distinct from p_logical_request_id
      or v_origin.route_key is distinct from p_checkpoint_scope
      or v_origin.request_sha256 is distinct from v_reservation.request_sha256
      or v_origin.execution_policy_version is distinct from v_reservation.execution_policy_version
      or v_origin.execution_policy_sha256 is distinct from v_reservation.execution_policy_sha256
      or v_origin.audit_source_snapshot is distinct from p_source_snapshot
      or v_origin.audit_source_sha256 is distinct from v_source_sha256
      or v_origin.audit_source_digest_version is distinct from v_binding->>'digest_version' then
      raise exception 'LEGACY_DOCUMENT_AUDIT_BINDING_CONFLICT';
    end if;
  end if;

  if v_reservation.audit_source_snapshot is null then
    update private.document_allowance_reservations
      set audit_source_snapshot=p_source_snapshot,audit_source_sha256=v_source_sha256,
        audit_source_digest_version=v_binding->>'digest_version'
      where id=p_origin_reservation_id and user_id=p_user_id;
  end if;
  if v_admission.audit_binding is null then
    update private.legacy_model_attempt_admissions
      set audit_binding=v_binding,audit_binding_sha256=v_binding_sha256
      where id=v_admission.id and user_id=p_user_id
      returning * into v_admission;
  end if;
  return pg_catalog.jsonb_build_object('contract_version','legacy-document-audit-checkpoint.1',
    'checkpoint',v_checkpoint,'audit_binding',v_admission.audit_binding,
    'audit_binding_sha256',v_admission.audit_binding_sha256);
end;
$function$;

revoke all on function public.read_legacy_document_audit_checkpoint_v1(
  uuid,text,uuid,text,text,text,integer,uuid,boolean,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.read_legacy_document_audit_checkpoint_v1(
  uuid,text,uuid,text,text,text,integer,uuid,boolean,jsonb,boolean,jsonb) to service_role;

comment on column private.document_allowance_reservations.audit_source_snapshot is
  'Private immutable five-string audit source snapshot. Dormant reviewer admission only; not proof that historical writers used it.';
comment on column private.legacy_model_attempt_admissions.audit_binding is
  'Private exact pre-dispatch review identity; no verdict, workspace attachment, approval or document credit is inferred.';
