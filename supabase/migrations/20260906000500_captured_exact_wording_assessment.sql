-- Versioned exact-wording assessment preparation. This migration registers no
-- ledger, changes no activation pointer, and relabels no accepted operation.
-- Existing v1 reads/replays retain their immutable accepted contracts.

create or replace function private.captured_uses_exact_grounding(
  p_ledger_version text,
  p_template_id text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_ledger private.document_ledger_versions%rowtype;
  v_template jsonb;
  v_policy jsonb;
begin
  select * into v_ledger
  from private.document_ledger_versions
  where ledger_version = p_ledger_version;
  if not found then raise exception 'UNKNOWN_LEDGER_VERSION:%', p_ledger_version; end if;
  v_template := v_ledger.contract_json->'templates'->p_template_id;
  if jsonb_typeof(v_template) is distinct from 'object' then
    raise exception 'UNKNOWN_LEDGER_TEMPLATE:%:%', p_ledger_version, p_template_id;
  end if;
  v_policy := v_template #> '{validationPolicy,groundingReview}';
  -- Missing is the retained v1 contract. JSON null or an unknown explicit
  -- policy is not a request to silently fall back to that older validator.
  if p_ledger_version = 'ledger.2026-09-first-cohort.2' or v_policy is not null then
    if p_ledger_version is distinct from 'ledger.2026-09-first-cohort.2'
      or v_policy is distinct from '"exact_wording_v2"'::jsonb
      or v_ledger.schema_version is distinct from '1.0.0' then
      raise exception 'CAPTURED_GROUNDING_VERSION_MISMATCH';
    end if;
    return true;
  end if;
  return false;
end;
$function$;

revoke all on function private.captured_uses_exact_grounding(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.configure_captured_document_activation(
  p_environment text,
  p_user_cohort text,
  p_workflow text,
  p_template_id text,
  p_ledger_version text,
  p_routing_version text,
  p_route_snapshot jsonb,
  p_enabled boolean,
  p_expected_revision integer,
  p_changed_by text,
  p_change_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_user_cohort text := lower(btrim(p_user_cohort));
  v_workflow text := lower(btrim(p_workflow));
  v_template_id text := lower(btrim(p_template_id));
  v_routing_version text := btrim(p_routing_version);
  v_scope_key text;
  v_contract jsonb;
  v_exact_grounding boolean;
  v_existing private.document_ledger_activation_pointers%rowtype;
  v_revision integer;
begin
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_user_cohort !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_ACTIVATION_SCOPE';
  end if;
  if v_template_id not in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  ) then
    raise exception 'TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%', v_template_id;
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'INVALID_ACTIVATION_EXPECTED_REVISION';
  end if;
  if nullif(v_routing_version, '') is null
    or nullif(btrim(p_changed_by), '') is null
    or nullif(btrim(p_change_reason), '') is null then
    raise exception 'CAPTURED_ACTIVATION_VERSION_AND_ACTOR_REQUIRED';
  end if;
  if jsonb_typeof(p_route_snapshot) is distinct from 'object'
    or p_route_snapshot->>'provider' is distinct from 'openai'
    or p_route_snapshot->>'routingVersion' is distinct from v_routing_version
    or jsonb_typeof(p_route_snapshot->'routes') is distinct from 'object'
    or not coalesce(p_route_snapshot->'routes' ? 'deep', false)
    or not coalesce(p_route_snapshot->'routes' ? 'review', false) then
    raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
  end if;
  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = p_ledger_version;
  if not found then raise exception 'UNKNOWN_LEDGER_VERSION:%', p_ledger_version; end if;
  if not (v_contract->'templates' ? v_template_id) then
    raise exception 'UNKNOWN_LEDGER_TEMPLATE:%:%', p_ledger_version, v_template_id;
  end if;

  v_exact_grounding := private.captured_uses_exact_grounding(p_ledger_version, v_template_id);

  if exists (
    select 1
    from jsonb_each(p_route_snapshot->'routes') route_entry
    where jsonb_typeof(route_entry.value) is distinct from 'object'
      or route_entry.value->>'provider' is distinct from 'openai'
      or route_entry.key not in ('fast', 'deep', 'research', 'review')
      or route_entry.value->>'semanticRoute' is distinct from route_entry.key
      or nullif(btrim(route_entry.value->>'model'), '') is null
      or route_entry.value->>'reasoningEffort' is distinct from case route_entry.key
        when 'fast' then 'low'
        when 'review' then 'high'
        else 'medium'
      end
      or route_entry.value->>'routingVersion' is distinct from v_routing_version
      or route_entry.value->>'structuredOutputSchemaVersion'
        is distinct from case
          when v_exact_grounding and route_entry.key = 'review'
            then v_template_id || '.captured-grounding.2'
          when v_exact_grounding then v_template_id || '.captured-output.2'
          else v_template_id || '.captured-output.1'
        end
      or jsonb_typeof(route_entry.value->'allowedTools') is distinct from 'array'
      or (
        route_entry.key in ('deep', 'review')
        and route_entry.value->'allowedTools' is distinct from '[]'::jsonb
      )
      or case
        when coalesce(route_entry.value->>'timeoutMs', '') ~ '^[0-9]+$'
          then (route_entry.value->>'timeoutMs')::integer not between 1000 and 600000
        else true
      end
      or route_entry.value->>'maxAttempts' not in ('1', '2')
      or route_entry.value->'background' is distinct from 'false'::jsonb
      or route_entry.value->'store' is distinct from 'false'::jsonb
      or (
        route_entry.key <> 'fast'
        and route_entry.value->'fallback' is distinct from 'null'::jsonb
      )
  ) then
    raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
  end if;

  v_scope_key := v_environment || ':' || v_user_cohort || ':' || v_workflow || ':' || v_template_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('captured-activation:' || v_scope_key, 0)
  );

  select * into v_existing
  from private.document_ledger_activation_pointers
  where scope_key = v_scope_key
  for update;

  if found then
    if v_existing.environment = v_environment
      and v_existing.user_cohort = v_user_cohort
      and v_existing.workflow = v_workflow
      and v_existing.template_id = v_template_id
      and v_existing.ledger_version = p_ledger_version
      and v_existing.routing_version = v_routing_version
      and v_existing.route_snapshot = p_route_snapshot
      and v_existing.enabled = p_enabled then
      return jsonb_build_object(
        'scope_key', v_scope_key,
        'revision', v_existing.revision,
        'enabled', v_existing.enabled,
        'idempotent_replay', true
      );
    end if;
    if v_existing.revision <> p_expected_revision then
      raise exception 'STALE_ACTIVATION_POINTER:expected:%:actual:%',
        p_expected_revision, v_existing.revision;
    end if;
    v_revision := v_existing.revision + 1;
    update private.document_ledger_activation_pointers
    set environment = v_environment,
        user_cohort = v_user_cohort,
        workflow = v_workflow,
        template_id = v_template_id,
        ledger_version = p_ledger_version,
        routing_version = v_routing_version,
        route_snapshot = p_route_snapshot,
        enabled = p_enabled,
        revision = v_revision,
        activated_at = case when p_enabled then now() else null end,
        activated_by = case when p_enabled then btrim(p_changed_by) else null end,
        disabled_at = case when p_enabled then null else now() end,
        disabled_by = case when p_enabled then null else btrim(p_changed_by) end,
        updated_at = now()
    where scope_key = v_scope_key;
  else
    if p_expected_revision <> 0 then
      raise exception 'STALE_ACTIVATION_POINTER:expected:%:actual:0', p_expected_revision;
    end if;
    v_revision := 1;
    insert into private.document_ledger_activation_pointers(
      scope_key, ledger_version, enabled, revision, activated_at, activated_by,
      updated_at, environment, user_cohort, workflow, template_id,
      routing_version, route_snapshot, disabled_at, disabled_by
    ) values (
      v_scope_key, p_ledger_version, p_enabled, v_revision,
      case when p_enabled then now() else null end,
      case when p_enabled then btrim(p_changed_by) else null end,
      now(), v_environment, v_user_cohort, v_workflow, v_template_id,
      v_routing_version, p_route_snapshot,
      case when p_enabled then null else now() end,
      case when p_enabled then null else btrim(p_changed_by) end
    );
  end if;

  insert into private.captured_document_activation_revisions(
    scope_key, revision, environment, user_cohort, workflow, template_id,
    ledger_version, routing_version, route_snapshot, enabled,
    changed_by, change_reason
  ) values (
    v_scope_key, v_revision, v_environment, v_user_cohort, v_workflow,
    v_template_id, p_ledger_version, v_routing_version, p_route_snapshot,
    p_enabled, btrim(p_changed_by), btrim(p_change_reason)
  );

  return jsonb_build_object(
    'scope_key', v_scope_key,
    'revision', v_revision,
    'enabled', p_enabled,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.configure_captured_document_activation(
  text, text, text, text, text, text, jsonb, boolean, integer, text, text
) from public, anon, authenticated;
grant execute on function public.configure_captured_document_activation(
  text, text, text, text, text, text, jsonb, boolean, integer, text, text
) to service_role;

create or replace function public.accept_captured_document_operation(
  p_user_id uuid,
  p_outcome_id uuid,
  p_document_id uuid,
  p_title text,
  p_environment text,
  p_user_cohort text,
  p_workflow text,
  p_template_id text,
  p_benchmark_version text,
  p_pipeline_version text,
  p_input_revision integer,
  p_idempotency_key text,
  p_input_values jsonb,
  p_source_snapshot jsonb,
  p_evidence_snapshot jsonb,
  p_locale text default 'en-AU',
  p_jurisdiction text default 'AU',
  p_safe_section_keys text[] default '{}'::text[],
  p_blocked_section_keys text[] default '{}'::text[],
  p_unresolved_input_keys text[] default '{}'::text[],
  p_confirmations jsonb default '{}'::jsonb,
  p_operation_ttl_seconds integer default 86400
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_environment text := lower(btrim(p_environment));
  v_user_cohort text := lower(btrim(p_user_cohort));
  v_workflow text := lower(btrim(p_workflow));
  v_template_id text := lower(btrim(p_template_id));
  v_idempotency_key text := btrim(p_idempotency_key);
  v_scope_key text;
  v_activation private.document_ledger_activation_pointers%rowtype;
  v_existing private.captured_document_operations%rowtype;
  v_operation private.captured_document_operations%rowtype;
  v_contract jsonb;
  v_exact_grounding boolean;
  v_ledger_keys text[];
  v_safe_keys text[];
  v_blocked_keys text[];
  v_request_payload jsonb;
  v_request_hash text;
  v_snapshot_result jsonb;
  v_snapshot_id uuid;
  v_snapshot_request_id text;
  v_write_token uuid;
  v_initial_revision private.captured_document_revisions%rowtype;
begin
  if p_user_id is null or p_outcome_id is null or p_document_id is null then
    raise exception 'CAPTURED_OPERATION_IDENTITY_REQUIRED';
  end if;
  if nullif(btrim(p_title), '') is null or char_length(p_title) > 240 then
    raise exception 'CAPTURED_DOCUMENT_TITLE_INVALID';
  end if;
  if v_environment !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_user_cohort !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    or v_workflow !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'INVALID_CAPTURED_OPERATION_SCOPE';
  end if;
  if v_template_id not in (
    'resume', 'selection-criteria-response', 'moving-house-checklist',
    'complaint-letter', 'incident-near-miss-report'
  ) then
    raise exception 'TEMPLATE_OUTSIDE_FIRST_CAPTURED_COHORT:%', v_template_id;
  end if;
  if p_input_revision is null or p_input_revision < 1
    or char_length(v_idempotency_key) not between 1 and 128
    or nullif(btrim(p_benchmark_version), '') is null
    or nullif(btrim(p_pipeline_version), '') is null
    or nullif(btrim(p_locale), '') is null
    or nullif(btrim(p_jurisdiction), '') is null then
    raise exception 'CAPTURED_OPERATION_VERSION_OR_IDEMPOTENCY_INVALID';
  end if;
  if p_operation_ttl_seconds not between 60 and 604800 then
    raise exception 'CAPTURED_OPERATION_TTL_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_input_values, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_source_snapshot, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_evidence_snapshot, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_confirmations, '{}'::jsonb)) <> 'object' then
    raise exception 'CAPTURED_OPERATION_SNAPSHOT_INVALID';
  end if;
  if array_position(coalesce(p_safe_section_keys, '{}'::text[]), null) is not null
    or array_position(coalesce(p_blocked_section_keys, '{}'::text[]), null) is not null
    or array_position(coalesce(p_unresolved_input_keys, '{}'::text[]), null) is not null then
    raise exception 'CAPTURED_OPERATION_KEY_SET_INVALID';
  end if;

  select coalesce(array_agg(key_value order by key_value), '{}'::text[])
  into v_safe_keys
  from (
    select distinct btrim(key_value) as key_value
    from unnest(coalesce(p_safe_section_keys, '{}'::text[])) key_value
    where nullif(btrim(key_value), '') is not null
  ) normalized;
  select coalesce(array_agg(key_value order by key_value), '{}'::text[])
  into v_blocked_keys
  from (
    select distinct btrim(key_value) as key_value
    from unnest(coalesce(p_blocked_section_keys, '{}'::text[])) key_value
    where nullif(btrim(key_value), '') is not null
  ) normalized;

  if cardinality(v_safe_keys) <> cardinality(coalesce(p_safe_section_keys, '{}'::text[]))
    or cardinality(v_blocked_keys) <> cardinality(coalesce(p_blocked_section_keys, '{}'::text[]))
    or v_safe_keys && v_blocked_keys then
    raise exception 'CAPTURED_OPERATION_SECTION_PARTITION_INVALID';
  end if;

  v_scope_key := v_environment || ':' || v_user_cohort || ':' || v_workflow || ':' || v_template_id;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'captured-operation:' || p_user_id::text || ':' || v_idempotency_key,
      0
    )
  );

  select * into v_existing
  from private.captured_document_operations
  where user_id = p_user_id and idempotency_key = v_idempotency_key;

  if found then
    if v_existing.environment <> v_environment
      or v_existing.user_cohort <> v_user_cohort
      or v_existing.workflow <> v_workflow
      or v_existing.template_id <> v_template_id then
      raise exception 'CAPTURED_OPERATION_REPLAY_CONFLICT:%', v_existing.id;
    end if;
    select contract_json into v_contract
    from private.document_ledger_versions
    where ledger_version = v_existing.ledger_version;
    v_request_payload := jsonb_build_object(
      'userId', p_user_id,
      'outcomeId', p_outcome_id,
      'documentId', p_document_id,
      'title', btrim(p_title),
      'environment', v_environment,
      'userCohort', v_user_cohort,
      'workflow', v_workflow,
      'templateId', v_template_id,
      'ledgerVersion', v_existing.ledger_version,
      'activationRevision', v_existing.activation_revision,
      'benchmarkVersion', btrim(p_benchmark_version),
      'pipelineVersion', btrim(p_pipeline_version),
      'routingVersion', v_existing.routing_version,
      'routeSnapshot', v_existing.route_snapshot,
      'inputRevision', p_input_revision,
      'idempotencyKey', v_idempotency_key,
      'inputValues', coalesce(p_input_values, '{}'::jsonb),
      'sourceSnapshot', coalesce(p_source_snapshot, '{}'::jsonb),
      'evidenceSnapshot', coalesce(p_evidence_snapshot, '{}'::jsonb),
      'locale', btrim(p_locale),
      'jurisdiction', btrim(p_jurisdiction),
      'safeSectionKeys', to_jsonb(v_safe_keys),
      'blockedSectionKeys', to_jsonb(v_blocked_keys),
      'unresolvedInputKeys', to_jsonb(coalesce(p_unresolved_input_keys, '{}'::text[])),
      'confirmations', coalesce(p_confirmations, '{}'::jsonb),
      'operationTtlSeconds', p_operation_ttl_seconds
    );
    v_request_hash := encode(
      extensions.digest(pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
      'hex'
    );
    if v_existing.request_sha256 <> v_request_hash then
      raise exception 'CAPTURED_OPERATION_REPLAY_CONFLICT:%', v_existing.id;
    end if;
    return jsonb_build_object(
      'contract_version', v_existing.contract_version,
      'operation_id', v_existing.id,
      'document_id', v_existing.document_id,
      'operation_revision', v_existing.operation_revision,
      'accepted_document_revision', v_existing.accepted_document_revision,
      'status', v_existing.status,
      'safe_section_keys', to_jsonb(v_existing.safe_section_keys),
      'blocked_section_keys', to_jsonb(v_existing.blocked_section_keys),
      'retryable', v_existing.retryable,
      'correlation_id', v_existing.correlation_id,
      'routing_version', v_existing.routing_version,
      'route_snapshot', v_existing.route_snapshot,
      'generation_checkpoint', (
        select attempt_record.structured_output
        from private.captured_document_provider_attempts attempt_record
        where attempt_record.operation_id = v_existing.id
          and attempt_record.logical_stage_key = 'generation'
          and attempt_record.status = 'succeeded'
        order by attempt_record.attempt_number desc
        limit 1
      ),
      'review_checkpoint', (
        select attempt_record.structured_output
        from private.captured_document_provider_attempts attempt_record
        where attempt_record.operation_id = v_existing.id
          and attempt_record.logical_stage_key = 'review'
          and attempt_record.status = 'succeeded'
        order by attempt_record.attempt_number desc
        limit 1
      ),
      'idempotency_reference', v_existing.idempotency_key,
      'status_reference', jsonb_build_object(
        'rpc', 'get_captured_document_operation',
        'operation_id', v_existing.id
      ),
      'expires_at', v_existing.expires_at,
      'idempotent_replay', true
    );
  end if;

  select * into v_activation
  from private.document_ledger_activation_pointers
  where scope_key = v_scope_key
    and environment = v_environment
    and user_cohort = v_user_cohort
    and workflow = v_workflow
    and template_id = v_template_id
    and enabled
  for share;
  if not found then raise exception 'CAPTURED_ACTIVATION_DISABLED:%', v_scope_key; end if;

  select contract_json into v_contract
  from private.document_ledger_versions
  where ledger_version = v_activation.ledger_version;
  if not found or not (v_contract->'templates' ? v_template_id) then
    raise exception 'CAPTURED_ACTIVATION_LEDGER_INVALID:%', v_scope_key;
  end if;
  if jsonb_typeof(v_contract->'templates'->v_template_id->'sections') <> 'array' then
    raise exception 'CAPTURED_LEDGER_SECTIONS_INVALID:%:%',
      v_activation.ledger_version, v_template_id;
  end if;

  -- The replay branch above returns the original request before consulting
  -- current activation policy. Only new admissions cross this version gate.
  v_exact_grounding := private.captured_uses_exact_grounding(
    v_activation.ledger_version, v_template_id
  );
  if v_exact_grounding or btrim(p_pipeline_version) = 'captured-operation-pipeline.2' then
    if not v_exact_grounding
      or btrim(p_pipeline_version) is distinct from 'captured-operation-pipeline.2' then
      raise exception 'CAPTURED_GROUNDING_VERSION_MISMATCH';
    end if;
    if p_operation_ttl_seconds is distinct from 86400
      or v_workflow is distinct from 'master-workspace'
      or jsonb_typeof(v_contract #> array[
        'templates', v_template_id, 'qualityBenchmark', 'benchmarkVersion'
      ]) is distinct from 'string'
      or btrim(p_benchmark_version) is distinct from
        v_contract #>> array['templates', v_template_id, 'qualityBenchmark', 'benchmarkVersion'] then
      raise exception 'CAPTURED_GROUNDING_EXECUTION_CONTRACT_MISMATCH';
    end if;
    if v_activation.route_snapshot #>> '{routes,deep,structuredOutputSchemaVersion}'
        is distinct from v_template_id || '.captured-output.2'
      or v_activation.route_snapshot #>> '{routes,review,structuredOutputSchemaVersion}'
        is distinct from v_template_id || '.captured-grounding.2' then
      raise exception 'INVALID_OPENAI_ROUTE_SNAPSHOT';
    end if;
  end if;

  select coalesce(
    array_agg(section_key order by section_ordinal),
    '{}'::text[]
  ) into v_ledger_keys
  from (
    select
      coalesce(section_value->>'sectionKey', section_value->>'key') as section_key,
      section_ordinal
    from jsonb_array_elements(
      v_contract->'templates'->v_template_id->'sections'
    ) with ordinality ledger_section(section_value, section_ordinal)
  ) ledger_keys;

  if cardinality(v_ledger_keys) = 0
    or array_position(v_ledger_keys, null) is not null
    or cardinality(v_ledger_keys) <> (
      select count(distinct key_value)
      from unnest(v_ledger_keys) key_value
    )
    or not (v_ledger_keys <@ (v_safe_keys || v_blocked_keys))
    or not ((v_safe_keys || v_blocked_keys) <@ v_ledger_keys) then
    raise exception 'CAPTURED_OPERATION_SECTION_PARTITION_MISMATCH';
  end if;

  if not exists (
    select 1 from public.outcomes
    where id = p_outcome_id and user_id = p_user_id
  ) then
    raise exception 'CAPTURED_OUTCOME_NOT_FOUND';
  end if;
  if exists (select 1 from public.documents where id = p_document_id) then
    raise exception 'CAPTURED_DOCUMENT_ID_ALREADY_EXISTS:%', p_document_id;
  end if;

  v_request_payload := jsonb_build_object(
    'userId', p_user_id,
    'outcomeId', p_outcome_id,
    'documentId', p_document_id,
    'title', btrim(p_title),
    'environment', v_environment,
    'userCohort', v_user_cohort,
    'workflow', v_workflow,
    'templateId', v_template_id,
    'ledgerVersion', v_activation.ledger_version,
    'activationRevision', v_activation.revision,
    'benchmarkVersion', btrim(p_benchmark_version),
    'pipelineVersion', btrim(p_pipeline_version),
    'routingVersion', v_activation.routing_version,
    'routeSnapshot', v_activation.route_snapshot,
    'inputRevision', p_input_revision,
    'idempotencyKey', v_idempotency_key,
    'inputValues', coalesce(p_input_values, '{}'::jsonb),
    'sourceSnapshot', coalesce(p_source_snapshot, '{}'::jsonb),
    'evidenceSnapshot', coalesce(p_evidence_snapshot, '{}'::jsonb),
    'locale', btrim(p_locale),
    'jurisdiction', btrim(p_jurisdiction),
    'safeSectionKeys', to_jsonb(v_safe_keys),
    'blockedSectionKeys', to_jsonb(v_blocked_keys),
    'unresolvedInputKeys', to_jsonb(coalesce(p_unresolved_input_keys, '{}'::text[])),
    'confirmations', coalesce(p_confirmations, '{}'::jsonb),
    'operationTtlSeconds', p_operation_ttl_seconds
  );
  v_request_hash := encode(
    extensions.digest(pg_catalog.convert_to(v_request_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_snapshot_request_id := 'captured:' || encode(
    extensions.digest(pg_catalog.convert_to(v_idempotency_key, 'UTF8'), 'sha256'),
    'hex'
  );
  v_snapshot_result := public.prepare_document_generation_snapshot(
    p_user_id,
    v_snapshot_request_id,
    v_activation.ledger_version,
    v_template_id,
    btrim(p_benchmark_version),
    btrim(p_pipeline_version),
    coalesce(p_input_values, '{}'::jsonb),
    coalesce(p_source_snapshot, '{}'::jsonb),
    coalesce(p_evidence_snapshot, '{}'::jsonb),
    coalesce(p_unresolved_input_keys, '{}'::text[]),
    coalesce(p_confirmations, '{}'::jsonb)
  );
  v_snapshot_id := (v_snapshot_result->>'generation_snapshot_id')::uuid;

  insert into private.captured_document_operations(
    user_id, outcome_id, document_id, generation_snapshot_id,
    activation_scope_key, activation_revision, environment, user_cohort,
    workflow, template_id, ledger_version, benchmark_version, pipeline_version,
    routing_version, route_snapshot, locale, jurisdiction, idempotency_key,
    request_sha256, input_revision, accepted_document_revision,
    safe_section_keys, blocked_section_keys, status, operation_revision,
    expires_at
  ) values (
    p_user_id, p_outcome_id, p_document_id, v_snapshot_id,
    v_scope_key, v_activation.revision, v_environment, v_user_cohort,
    v_workflow, v_template_id, v_activation.ledger_version,
    btrim(p_benchmark_version), btrim(p_pipeline_version),
    v_activation.routing_version, v_activation.route_snapshot,
    btrim(p_locale), btrim(p_jurisdiction), v_idempotency_key,
    v_request_hash, p_input_revision, 1, v_safe_keys, v_blocked_keys,
    'accepted', 1,
    clock_timestamp() + pg_catalog.make_interval(secs => p_operation_ttl_seconds)
  ) returning * into v_operation;

  v_write_token := private.begin_captured_document_write(
    'accept_document', p_document_id, v_operation.id
  );
  insert into public.documents(
    id, user_id, outcome_id, title, content, doc_type, status,
    workspace_sections, format, unresolved_placeholders,
    ledger_binding_status, ledger_template_id, ledger_version,
    generation_snapshot_id, current_revision, approved_revision
  ) values (
    p_document_id, p_user_id, p_outcome_id, btrim(p_title), '', v_template_id,
    'draft', '[]'::jsonb, 'Word', '[]'::jsonb,
    'captured', v_template_id, v_activation.ledger_version,
    v_snapshot_id, 1, null
  );
  perform private.end_captured_document_write(v_write_token);

  v_initial_revision := private.capture_captured_document_revision(
    v_operation.id,
    p_document_id,
    'accepted',
    jsonb_build_object('passed', false, 'state', 'accepted'),
    null
  );
  perform private.append_captured_document_event(
    v_operation.id,
    p_user_id,
    1,
    'accepted',
    'operation_accepted',
    jsonb_build_object(
      'document_id', p_document_id,
      'document_revision', 1,
      'ledger_version', v_operation.ledger_version,
      'activation_scope_key', v_scope_key,
      'activation_revision', v_operation.activation_revision,
      'routing_version', v_operation.routing_version,
      'snapshot_sha256', v_initial_revision.snapshot_sha256
    )
  );

  return jsonb_build_object(
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'document_id', v_operation.document_id,
    'operation_revision', v_operation.operation_revision,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'status', v_operation.status,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'retryable', v_operation.retryable,
    'correlation_id', v_operation.correlation_id,
    'routing_version', v_operation.routing_version,
    'route_snapshot', v_operation.route_snapshot,
    'generation_checkpoint', null,
    'review_checkpoint', null,
    'idempotency_reference', v_operation.idempotency_key,
    'status_reference', jsonb_build_object(
      'rpc', 'get_captured_document_operation',
      'operation_id', v_operation.id
    ),
    'expires_at', v_operation.expires_at,
    'idempotent_replay', false
  );
end;
$function$;

revoke all on function public.accept_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) from public, anon, authenticated;
grant execute on function public.accept_captured_document_operation(
  uuid, uuid, uuid, text, text, text, text, text, text, text, integer,
  text, jsonb, jsonb, jsonb, text, text, text[], text[], text[], jsonb, integer
) to service_role;

create or replace function public.get_captured_document_resume_payload(
  p_user_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_generation private.document_generation_snapshots%rowtype;
  v_accepted_revision private.captured_document_revisions%rowtype;
  v_ledger private.document_ledger_versions%rowtype;
  v_ledger_template jsonb;
  v_title text;
begin
  if p_user_id is null or p_operation_id is null then
    raise exception 'CAPTURED_OPERATION_IDENTITY_REQUIRED';
  end if;

  select * into v_operation
  from private.captured_document_operations operation_record
  where operation_record.id = p_operation_id
    and operation_record.user_id = p_user_id;
  if not found then raise exception 'CAPTURED_OPERATION_NOT_FOUND'; end if;

  select * into v_generation
  from private.document_generation_snapshots snapshot_record
  where snapshot_record.id = v_operation.generation_snapshot_id
    and snapshot_record.user_id = v_operation.user_id;
  if not found then raise exception 'CAPTURED_OPERATION_SNAPSHOT_NOT_FOUND'; end if;

  select * into v_accepted_revision
  from private.captured_document_revisions revision_record
  where revision_record.operation_id = v_operation.id
    and revision_record.document_id = v_operation.document_id
    and revision_record.user_id = v_operation.user_id
    and revision_record.document_revision = v_operation.accepted_document_revision;
  if not found then raise exception 'CAPTURED_ACCEPTED_REVISION_NOT_FOUND'; end if;

  select * into v_ledger
  from private.document_ledger_versions ledger_record
  where ledger_record.ledger_version = v_operation.ledger_version;
  if not found then raise exception 'CAPTURED_ACCEPTED_LEDGER_NOT_FOUND'; end if;

  v_ledger_template := v_ledger.contract_json->'templates'->v_operation.template_id;
  if jsonb_typeof(v_ledger_template) is distinct from 'object'
    or v_ledger.schema_version is distinct from
      v_ledger.contract_json->>'schemaVersion'
    or v_ledger.ledger_version is distinct from
      v_ledger.contract_json->>'ledgerVersion'
    or v_generation.user_id is distinct from v_operation.user_id
    or v_generation.template_id is distinct from v_operation.template_id
    or v_generation.ledger_version is distinct from v_operation.ledger_version
    or v_generation.benchmark_version is distinct from v_operation.benchmark_version
    or v_generation.pipeline_version is distinct from v_operation.pipeline_version
    or v_accepted_revision.ledger_version is distinct from v_operation.ledger_version
    or v_accepted_revision.snapshot->'document'->>'id' is distinct from
      v_operation.document_id::text
    or v_accepted_revision.snapshot->'document'->>'ledger_template_id' is distinct from
      v_operation.template_id
    or v_accepted_revision.snapshot->'document'->>'ledger_version' is distinct from
      v_operation.ledger_version
    or (
      v_ledger_template->'qualityBenchmark' ? 'benchmarkVersion'
      and v_ledger_template->'qualityBenchmark'->>'benchmarkVersion' is distinct from
        v_operation.benchmark_version
    ) then
    raise exception 'CAPTURED_ACCEPTED_SNAPSHOT_IDENTITY_MISMATCH';
  end if;

  v_title := nullif(
    btrim(v_accepted_revision.snapshot->'document'->>'title'),
    ''
  );
  if v_title is null then raise exception 'CAPTURED_DOCUMENT_TITLE_INVALID'; end if;

  return jsonb_build_object(
    'action', 'resume',
    'contract_version', v_operation.contract_version,
    'operation_id', v_operation.id,
    'accepted_user_id', v_operation.user_id,
    'accepted_environment', v_operation.environment,
    'accepted_user_cohort', v_operation.user_cohort,
    'workflow', v_operation.workflow,
    'outcome_id', v_operation.outcome_id,
    'document_id', v_operation.document_id,
    'accepted_document_revision', v_operation.accepted_document_revision,
    'title', v_title,
    'template_id', v_operation.template_id,
    'generation_request_id', v_operation.idempotency_key,
    'generation_snapshot_id', v_generation.id,
    'generation_snapshot_request_id', v_generation.generation_request_id,
    'generation_snapshot_sha256', v_generation.snapshot_sha256,
    'request_sha256', v_operation.request_sha256,
    'input_revision', v_operation.input_revision,
    'input_values', v_generation.input_values,
    'source_snapshot', v_generation.source_snapshot,
    'evidence_snapshot', v_generation.evidence_snapshot,
    'unresolved_input_keys', to_jsonb(v_generation.unresolved_input_keys),
    'confirmations', v_generation.confirmations,
    'safe_section_keys', to_jsonb(v_operation.safe_section_keys),
    'blocked_section_keys', to_jsonb(v_operation.blocked_section_keys),
    'locale', v_operation.locale,
    'jurisdiction', v_operation.jurisdiction,
    'activation_scope_key', v_operation.activation_scope_key,
    'activation_revision', v_operation.activation_revision,
    'ledger_schema_version', v_ledger.schema_version,
    'ledger_version', v_operation.ledger_version,
    'ledger_contract_sha256', v_ledger.contract_sha256,
    'ledger_template', v_ledger_template,
    'benchmark_version', v_operation.benchmark_version,
    'pipeline_version', v_operation.pipeline_version,
    'routing_version', v_operation.routing_version,
    'route_snapshot', v_operation.route_snapshot,
    'operation_ttl_seconds', case
      when v_operation.pipeline_version in (
        'captured-operation-pipeline.1', 'captured-operation-pipeline.2'
      )
        then 86400
      else null
    end
  );
end;
$function$;

revoke all on function public.get_captured_document_resume_payload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_captured_document_resume_payload(uuid, uuid)
  to service_role;

comment on function public.get_captured_document_resume_payload(uuid, uuid) is
  'Service-only reconstruction of the immutable accepted request for idempotent background resume. Never exposed to browser roles.';

-- Inspect values, never serialized JSON keys, punctuation or concatenated
-- siblings. These helpers are subordinate checks on the accepted snapshot.
create or replace function private.captured_grounding_scalar_leaves(p_value jsonb)
returns setof jsonb
language sql
immutable
set search_path = ''
as $function$
  with recursive nodes(value) as (
    select p_value
    union all
    select child.value from nodes parent cross join lateral (
      select value from jsonb_array_elements(case jsonb_typeof(parent.value)
        when 'array' then parent.value else '[]'::jsonb end)
      union all
      select value from jsonb_each(case jsonb_typeof(parent.value)
        when 'object' then parent.value else '{}'::jsonb end)
    ) child
  )
  select value from nodes where jsonb_typeof(value) in ('string', 'number', 'boolean');
$function$;

create or replace function private.captured_grounding_has_value(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select exists (
    select 1 from private.captured_grounding_scalar_leaves(p_value) leaf
    where jsonb_typeof(leaf) in ('number', 'boolean')
      or (jsonb_typeof(leaf) = 'string' and length(btrim(leaf #>> '{}',
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0)
  );
$function$;

create or replace function private.captured_grounding_quote_matches(p_value jsonb, p_quote text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(length(p_quote) between 1 and 8000 and length(btrim(p_quote,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
    and exists (
      select 1 from private.captured_grounding_scalar_leaves(p_value) leaf
      where strpos(case
        when jsonb_typeof(leaf) in ('string', 'boolean') then leaf #>> '{}'
        -- Exact shared JS/SQL representation for safe integers, including
        -- JSON 10.0, 1e1 and -0. Other numeric leaves do not establish quote
        -- evidence until their cross-runtime representation is verified.
        when jsonb_typeof(leaf) = 'number' then case
          when abs((leaf #>> '{}')::numeric) <= 9007199254740991
            and trunc((leaf #>> '{}')::numeric) = (leaf #>> '{}')::numeric
          then ((leaf #>> '{}')::numeric)::bigint::text
          else null
        end
        else null
      end, p_quote) > 0
    ), false);
$function$;

revoke all on function private.captured_grounding_scalar_leaves(jsonb),
  private.captured_grounding_has_value(jsonb),
  private.captured_grounding_quote_matches(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function private.enforce_captured_exact_wording_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_operation private.captured_document_operations%rowtype;
  v_generation private.document_generation_snapshots%rowtype;
  v_existing private.captured_document_revisions%rowtype;
  v_template jsonb;
  v_validation jsonb := new.validation_result;
  v_sections jsonb := new.snapshot->'sections';
  v_section jsonb;
  v_contract_section jsonb;
  v_result jsonb;
  v_assessment jsonb;
  v_reference jsonb;
  v_evidence jsonb;
  v_source jsonb;
  v_key text;
  v_hash text;
  v_index integer;
  v_count integer;
  v_final_sections jsonb := '[]'::jsonb;
  v_review_sections jsonb := '[]'::jsonb;
  v_workspace_sections jsonb := '[]'::jsonb;
  v_document_content text;
  v_attempt private.captured_document_provider_attempts%rowtype;
  v_stage text;
  v_route text;
  v_exact boolean;
begin
  select * into v_operation from private.captured_document_operations
  where id = new.operation_id and user_id = new.user_id;
  if not found then raise exception 'CAPTURED_OPERATION_DOCUMENT_MISMATCH'; end if;
  select contract_json->'templates'->v_operation.template_id into v_template
  from private.document_ledger_versions where ledger_version = v_operation.ledger_version;
  -- Preserve legacy revision writes under their original semantics. Only an
  -- explicit v2 identity/policy marker invokes the new strict resolver.
  if v_operation.pipeline_version <> 'captured-operation-pipeline.2'
    and v_operation.ledger_version <> 'ledger.2026-09-first-cohort.2'
    and new.ledger_version <> 'ledger.2026-09-first-cohort.2'
    and v_template #> '{validationPolicy,groundingReview}' is distinct from '"exact_wording_v2"'::jsonb then
    return new;
  end if;
  v_exact := private.captured_uses_exact_grounding(v_operation.ledger_version, v_operation.template_id);
  if not v_exact or v_operation.pipeline_version <> 'captured-operation-pipeline.2'
    or new.ledger_version is distinct from v_operation.ledger_version
    or new.document_id is distinct from v_operation.document_id then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;

  -- ON CONFLICT must never disguise a different assessment or revision reason.
  -- An exact existing snapshot remains replayable after operation advancement.
  select * into v_existing from private.captured_document_revisions
  where document_id = new.document_id and document_revision = new.document_revision;
  if found then
    if v_existing.operation_id is distinct from new.operation_id
      or v_existing.user_id is distinct from new.user_id
      or v_existing.ledger_version is distinct from new.ledger_version
      or v_existing.reason is distinct from new.reason
      or v_existing.actor_user_id is distinct from new.actor_user_id
      or v_existing.snapshot is distinct from new.snapshot
      or v_existing.snapshot_sha256 is distinct from new.snapshot_sha256
      or v_existing.validation_result is distinct from new.validation_result then
      raise exception 'CAPTURED_DOCUMENT_REVISION_CONFLICT:%:%', new.document_id, new.document_revision;
    end if;
    return new;
  end if;
  if new.reason <> 'generated' then return new; end if;

  select * into v_generation from private.document_generation_snapshots
  where id = v_operation.generation_snapshot_id and user_id = v_operation.user_id;
  if not found
    or v_generation.template_id is distinct from v_operation.template_id
    or v_generation.ledger_version is distinct from v_operation.ledger_version
    or v_generation.benchmark_version is distinct from v_operation.benchmark_version
    or v_generation.pipeline_version is distinct from v_operation.pipeline_version
    or v_operation.status is distinct from 'persisting'
    or new.document_revision is distinct from v_operation.accepted_document_revision + 1
    or new.actor_user_id is not null
    or new.snapshot_sha256 is distinct from encode(extensions.digest(
      convert_to(new.snapshot::text, 'UTF8'), 'sha256'), 'hex')
    or new.snapshot #> '{document,id}' is distinct from to_jsonb(v_operation.document_id)
    or new.snapshot #> '{document,outcome_id}' is distinct from to_jsonb(v_operation.outcome_id)
    or new.snapshot #> '{document,generation_snapshot_id}' is distinct from to_jsonb(v_generation.id)
    or new.snapshot #> '{document,current_revision}' is distinct from to_jsonb(new.document_revision)
    or new.snapshot #> '{document,approved_revision}' is distinct from 'null'::jsonb
    or new.snapshot #> '{document,ledger_version}' is distinct from to_jsonb(v_operation.ledger_version)
    or new.snapshot #> '{document,ledger_template_id}' is distinct from to_jsonb(v_operation.template_id)
    or jsonb_typeof(v_sections) is distinct from 'array'
    or jsonb_typeof(v_validation) is distinct from 'object' then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;
  if jsonb_typeof(v_template->'sections') is distinct from 'array'
    or jsonb_typeof(v_validation->'sections') is distinct from 'array'
    or v_validation - array['passed','validator_version','mandatory_checks_complete',
      'material_claim_grounding_checked','grounding_scope','identity','target_sha256','issues','sections']
      is distinct from '{}'::jsonb
    or v_validation->'passed' is distinct from 'true'::jsonb
    or v_validation->'mandatory_checks_complete' is distinct from 'true'::jsonb
    or v_validation->'material_claim_grounding_checked' is distinct from 'true'::jsonb
    or v_validation->'validator_version' is distinct from '"captured-output-validator.2"'::jsonb
    or v_validation->'grounding_scope' is distinct from '"exact_wording_review"'::jsonb
    or jsonb_typeof(v_validation->'target_sha256') is distinct from 'string'
    or (v_validation->>'target_sha256') !~ '^[0-9a-f]{64}$'
    or v_validation->'issues' is distinct from '[]'::jsonb
    or v_validation->'identity' is distinct from jsonb_build_object(
      'operation_id', v_operation.id, 'document_id', v_operation.document_id,
      'accepted_document_revision', v_operation.accepted_document_revision,
      'input_revision', v_operation.input_revision,
      'generation_snapshot_sha256', v_generation.snapshot_sha256,
      'ledger_version', v_operation.ledger_version, 'pipeline_version', v_operation.pipeline_version
    )
    or jsonb_typeof(v_generation.source_snapshot->'sources') is distinct from 'array'
    or jsonb_typeof(v_generation.evidence_snapshot->'permitted_source_ids') is distinct from 'array'
    or v_generation.evidence_snapshot->'material_claims_require_source_reference' is distinct from 'true'::jsonb then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;
  if jsonb_array_length(v_sections) <> jsonb_array_length(v_template->'sections')
    or jsonb_array_length(v_sections) <> jsonb_array_length(v_validation->'sections')
    or jsonb_array_length(v_sections) = 0
    or jsonb_array_length(v_sections) <> (select count(distinct section->'section_key') from jsonb_array_elements(v_sections) section)
    or jsonb_array_length(v_sections) <> (select count(distinct section->'id') from jsonb_array_elements(v_sections) section) then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;

  for v_contract_section, v_index in
    select section, (ordinal - 1)::integer
    from jsonb_array_elements(v_template->'sections') with ordinality a(section, ordinal)
  loop
    v_section := v_sections->v_index;
    v_result := v_validation->'sections'->v_index;
    v_assessment := v_result->'assessment';
    v_key := v_contract_section->>'sectionKey';
    v_hash := encode(extensions.digest(convert_to(v_section->>'content', 'UTF8'), 'sha256'), 'hex');
    if jsonb_typeof(v_section) is distinct from 'object'
      or jsonb_typeof(v_section->'content') is distinct from 'string'
      or length(v_section->>'content') > 40000
      or v_section->'section_key' is distinct from to_jsonb(v_key)
      or v_section->'name' is distinct from to_jsonb(coalesce(
        nullif(btrim(v_contract_section->>'name'), ''),
        nullif(btrim(v_contract_section->>'title'), ''), v_key))
      or v_section->'order_index' is distinct from to_jsonb(v_index)
      or v_section->'revision' is distinct from '1'::jsonb
      or v_section->'approved_revision' is distinct from 'null'::jsonb
      or v_section->'is_required' is distinct from v_contract_section->'required'
      or jsonb_typeof(v_section->'source_references') is distinct from 'array'
      or jsonb_typeof(v_result) is distinct from 'object'
      or v_result - array['section_key','content_sha256','state','source_references','assessment'] is distinct from '{}'::jsonb
      or v_result->'section_key' is distinct from v_section->'section_key'
      or v_result->'state' is distinct from v_section->'section_state'
      or v_result->'content_sha256' is distinct from to_jsonb(v_hash)
      or v_result->'source_references' is distinct from v_section->'source_references'
      or jsonb_typeof(v_assessment) is distinct from 'object'
      or v_assessment - array['section_key','content_sha256','checks','evidence','issues'] is distinct from '{}'::jsonb
      or v_assessment->'section_key' is distinct from v_section->'section_key'
      or v_assessment->'content_sha256' is distinct from to_jsonb(v_hash)
      or v_assessment->'checks' is distinct from '{"material_claim_support":"pass", "semantic_requirements":"pass",
        "critical_details":"pass", "source_conflicts":"pass", "no_padding_or_repetition":"pass", "no_benchmark_copying":"pass"}'::jsonb
      or v_assessment->'issues' is distinct from '[]'::jsonb
      or jsonb_typeof(v_assessment->'evidence') is distinct from 'array'
      or v_key = any(v_operation.blocked_section_keys) then
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;
    if jsonb_array_length(v_section->'source_references') > 32
      or jsonb_array_length(v_assessment->'evidence') > 64
      or (select count(*) from jsonb_array_elements(v_section->'source_references')) <>
        (select count(distinct ref) from jsonb_array_elements(v_section->'source_references') ref) then
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;

    if v_section->>'section_state' = 'final' then
      if not private.captured_content_is_visible(v_section->>'content')
        or jsonb_array_length(v_section->'source_references') = 0 then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
      for v_reference in select value from jsonb_array_elements(v_section->'source_references') loop
        if jsonb_typeof(v_reference) is distinct from 'string'
          or length(v_reference #>> '{}') not between 7 and 160
          or left(v_reference #>> '{}', 6) <> 'input:'
          or not coalesce(v_contract_section->'dependsOnInputs' @>
            jsonb_build_array(substring(v_reference #>> '{}' from 7)), false)
          or not coalesce(v_generation.evidence_snapshot->'permitted_source_ids' @> jsonb_build_array(v_reference), false)
          or v_generation.confirmations->substring(v_reference #>> '{}' from 7)->'confirmed' is distinct from 'true'::jsonb
          or v_generation.confirmations->substring(v_reference #>> '{}' from 7)->'source_id' is distinct from v_reference
          or substring(v_reference #>> '{}' from 7) = any(v_generation.unresolved_input_keys) then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
        select count(*) into v_count from jsonb_array_elements(v_generation.source_snapshot->'sources') source
        where source->'id' = v_reference;
        if v_count <> 1 then raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED'; end if;
        select source into v_source from jsonb_array_elements(v_generation.source_snapshot->'sources') source
        where source->'id' = v_reference;
        if v_source->'input_key' is distinct from to_jsonb(substring(v_reference #>> '{}' from 7))
          or v_source->'source_type' is distinct from '"confirmed_request_input"'::jsonb
          or v_source->'value' is distinct from v_generation.input_values->substring(v_reference #>> '{}' from 7)
          or not private.captured_grounding_has_value(v_source->'value')
          or not exists (select 1 from jsonb_array_elements(v_assessment->'evidence') item
            where item->'source_id' = v_reference) then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
      end loop;
      for v_evidence in select value from jsonb_array_elements(v_assessment->'evidence') loop
        if jsonb_typeof(v_evidence) is distinct from 'object'
          or v_evidence - array['source_id','quote'] is distinct from '{}'::jsonb
          or jsonb_typeof(v_evidence->'source_id') is distinct from 'string'
          or jsonb_typeof(v_evidence->'quote') is distinct from 'string'
          or not coalesce(v_section->'source_references' @> jsonb_build_array(v_evidence->'source_id'), false) then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
        select source into v_source from jsonb_array_elements(v_generation.source_snapshot->'sources') source
        where source->'id' = v_evidence->'source_id';
        if not private.captured_grounding_quote_matches(v_source->'value', v_evidence->>'quote') then
          raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
        end if;
      end loop;
    elsif v_section->>'section_state' = 'omitted_optional' then
      if v_contract_section->'required' is distinct from 'false'::jsonb
        or v_contract_section->>'missingInformationBehaviour' is distinct from 'omitIfOptional'
        or v_section->'content' is distinct from '""'::jsonb
        or v_section->'source_references' is distinct from '[]'::jsonb
        or v_assessment->'evidence' is distinct from '[]'::jsonb then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
    elsif v_section->>'section_state' = 'neutral_fallback' then
      if v_contract_section->>'missingInformationBehaviour' is distinct from 'useNeutralFallback'
        or v_contract_section #>> '{neutralFallback,comparison}' is distinct from 'exact_utf8'
        or v_section->'content' is distinct from v_contract_section #> '{neutralFallback,content}'
        or v_section->'source_references' is distinct from '["system:neutral-fallback"]'::jsonb
        or v_assessment->'evidence' is distinct from '[]'::jsonb
        or jsonb_typeof(v_contract_section #> '{neutralFallback,whenInputsAbsent}') is distinct from 'array' then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
      if exists (select 1 from jsonb_array_elements_text(v_contract_section #> '{neutralFallback,whenInputsAbsent}') key
        where private.captured_grounding_has_value(v_generation.input_values->key)) then
        raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
      end if;
    else
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;
    v_final_sections := v_final_sections || jsonb_build_array(jsonb_build_object(
      'section_key', v_section->'section_key', 'content', v_section->'content',
      'state', v_section->'section_state', 'source_references', v_section->'source_references'));
    v_workspace_sections := v_workspace_sections || jsonb_build_array(jsonb_build_object(
      'section_key', v_section->'section_key', 'name', v_section->'name', 'order_index', v_section->'order_index',
      'content', v_section->'content', 'state', v_section->'section_state',
      'is_required', v_section->'is_required', 'source_references', v_section->'source_references'));
    v_review_sections := v_review_sections || jsonb_build_array(v_assessment);
  end loop;
  select coalesce(string_agg(section->>'content', E'\n\n' order by ordinal), '') into v_document_content
  from jsonb_array_elements(v_final_sections) with ordinality a(section, ordinal)
  where section->>'state' <> 'omitted_optional';
  if new.snapshot #> '{document,content}' is distinct from to_jsonb(v_document_content)
    or new.snapshot #> '{document,workspace_sections}' is distinct from v_workspace_sections
    or new.snapshot #> '{document,unresolved_placeholders}' is distinct from '[]'::jsonb then
    raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
  end if;

  foreach v_stage in array array['generation', 'review'] loop
    v_route := case v_stage when 'generation' then 'deep' else 'review' end;
    select count(*) into v_count from private.captured_document_provider_attempts
    where operation_id = v_operation.id and user_id = v_operation.user_id
      and logical_stage_key = v_stage and status = 'succeeded';
    if v_count <> 1 then raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED'; end if;
    select * into v_attempt from private.captured_document_provider_attempts
    where operation_id = v_operation.id and user_id = v_operation.user_id
      and logical_stage_key = v_stage and status = 'succeeded';
    if v_attempt.provider is distinct from 'openai'
      or v_attempt.semantic_route is distinct from v_route
      or v_attempt.retention_mode is distinct from 'store_false'
      or v_attempt.completed_at is null or nullif(btrim(v_attempt.provider_response_id), '') is null
      or v_attempt.model is distinct from v_operation.route_snapshot #>> array['routes',v_route,'model']
      or v_attempt.reasoning_effort is distinct from v_operation.route_snapshot #>> array['routes',v_route,'reasoningEffort']
      or v_operation.route_snapshot #>> array['routes',v_route,'structuredOutputSchemaVersion'] is distinct from
        v_operation.template_id || (case v_stage when 'generation' then '.captured-output.2' else '.captured-grounding.2' end)
      or v_attempt.structured_output is distinct from (case v_stage
        when 'generation' then jsonb_build_object('sections', v_final_sections)
        else jsonb_build_object('target_sha256', v_validation->'target_sha256', 'sections', v_review_sections)
      end) then
      raise exception 'CAPTURED_EXACT_WORDING_ASSESSMENT_REQUIRED';
    end if;
  end loop;
  return new;
end;
$function$;

revoke all on function private.enforce_captured_exact_wording_assessment()
  from public, anon, authenticated, service_role;
create trigger captured_document_revision_exact_wording_guard
  before insert on private.captured_document_revisions
  for each row execute function private.enforce_captured_exact_wording_assessment();
