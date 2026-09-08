-- Accept successful upload fallback provenance only from the existing owned
-- model result and usage receipt. Preserve terminal replay, v1 compatibility,
-- source privacy, exact checkpoints, signatures, grants and historical rows.

create or replace function public.settle_upload_ingest(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_ingest_status text,
  p_http_status integer,
  p_response jsonb,
  p_extracted_text text,
  p_extracted_payload jsonb,
  p_error_code text,
  p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
  v_saved_fallback jsonb;
  v_execution_provider text;
  v_execution_verified boolean;
begin
  if p_upload_id is null
    or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
    or p_ingest_status is null
    or p_ingest_status not in (
      'completed', 'failed', 'reconciliation_required'
    )
    or p_http_status is null
    or p_http_status not between 200 and 599
    or p_response is null
    or pg_catalog.jsonb_typeof(p_response) <> 'object'
    or p_response->>'upload_id' is distinct from p_upload_id::text
    or p_extracted_payload is null
    or pg_catalog.jsonb_typeof(p_extracted_payload) <> 'object'
    or char_length(coalesce(p_extracted_text, '')) > 20000
    or char_length(coalesce(p_error_code, '')) > 128
    or (p_ingest_status = 'completed' and (
      p_http_status <> 200 or p_error_code is not null
      or not private.completed_upload_ingest_is_valid(
        p_upload_id, p_response, p_extracted_text, p_extracted_payload
      )
    ))
    or (p_ingest_status = 'failed' and (
      p_http_status < 400 or nullif(p_error_code, '') is null
    ))
    or (p_ingest_status = 'reconciliation_required' and (
      p_http_status <> 409 or nullif(p_error_code, '') is null
    )) then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_INVALID';
  end if;

  select upload_record.* into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
  for update;

  if not found
    or v_upload.user_id is distinct from p_user_id
    or v_upload.ingest_request_sha256 is distinct from p_request_sha256
    or v_upload.ingest_claim_token is distinct from p_claim_token then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
  end if;

  if v_upload.ingest_status in (
    'completed', 'failed', 'reconciliation_required'
  ) then
    if v_upload.ingest_status is distinct from p_ingest_status
      or v_upload.ingest_http_status is distinct from p_http_status
      or v_upload.ingest_response is distinct from p_response
      or v_upload.extracted_text is distinct from p_extracted_text
      or v_upload.extracted_payload is distinct from p_extracted_payload
      or v_upload.error_code is distinct from p_error_code then
      raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('outcome', 'idempotent_replay');
  end if;

  if v_upload.ingest_status is distinct from 'processing'
    or v_upload.status is distinct from 'processing'
    or (
      p_ingest_status = 'completed'
      and v_upload.ingest_stage is distinct from 'provider_dispatched'
    )
    or (
      p_ingest_status = 'failed'
      and v_upload.ingest_stage not in ('storage_completed', 'provider_dispatched')
    )
    or (
      p_ingest_status = 'reconciliation_required'
      and v_upload.ingest_stage not in (
        'storage_dispatched', 'storage_completed', 'provider_dispatched'
      )
    ) then
    raise exception 'UPLOAD_INGEST_SETTLEMENT_CONFLICT';
  end if;

  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3') and (
    not private.upload_public_result_is_source_free(p_response, 0)
    or not private.upload_public_result_is_source_free(p_extracted_payload, 0)
    or (p_ingest_status = 'completed' and (
      not private.jsonb_has_exact_keys(p_response - 'credit_fallback', array['upload_id', 'extracted_text',
        'original_retained', 'storage_path', 'classification_status', 'extraction_format',
        'resource_policy_version', 'confirm_payload'])
      or not private.jsonb_has_exact_keys(p_extracted_payload - 'credit_fallback', array['truncated',
        'original_retained', 'classification_status', 'extraction_format', 'resource_policy_version'])
      or not private.jsonb_has_exact_keys(p_response->'confirm_payload', array['summary',
        'document_type', 'structure', 'filename', 'char_count', 'truncated'])
      or exists (select 1 from pg_catalog.jsonb_array_elements(case
        when pg_catalog.jsonb_typeof(p_response#>'{confirm_payload,structure}') = 'array'
        then p_response#>'{confirm_payload,structure}' else '[]'::jsonb end) item(value)
        where not private.jsonb_has_exact_keys(item.value, array['title', 'items']))
    ))
  ) then
    raise exception 'UPLOAD_INGEST_SOURCE_PRIVACY_INVALID';
  end if;
  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
    and p_ingest_status = 'completed' then
    -- The upload UUID is the logical provider request identity. Its upload-body
    -- digest is a different domain from the provider request digest below.
    select result_record.response_envelope #> '{route_snapshot,creditFallback}',
      usage_record.provider,
      coalesce(
        result_record.origin_reservation_id is null
        and result_record.result_version = 'legacy-provider-result.1'
        and result_record.response_envelope->>'version' = 'legacy-provider-result.1'
        and result_record.response_sha256 = pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(result_record.response_envelope::text,'UTF8'),'sha256'),'hex')
        and usage_record.event_type = 'model_call'
        and usage_record.checkpoint_scope = result_record.checkpoint_scope
        and usage_record.logical_request_id = result_record.logical_request_id
        and usage_record.logical_stage_key = result_record.logical_stage_key
        and usage_record.provider_request_sha256 = result_record.request_sha256
        and usage_record.provider = 'ollama'
        and usage_record.provider_attempt_number = 2
        and usage_record.provider_status = 'completed'
        and usage_record.model_call_status = 'succeeded'
        and usage_record.provider_error_code is null
        and private.valid_ollama_credit_policy(
          result_record.response_envelope #> '{route_snapshot,creditFallback}')
        and usage_record.model = result_record.response_envelope #>> '{route_snapshot,creditFallback,model}',
        false)
      into v_saved_fallback, v_execution_provider, v_execution_verified
    from private.legacy_model_call_results result_record
    join public.usage_ledger usage_record
      on usage_record.id = result_record.usage_ledger_id
      and usage_record.user_id = result_record.user_id
    where result_record.user_id = v_upload.user_id
      and result_record.checkpoint_scope = 'ingest-upload'
      and result_record.logical_request_id = v_upload.id::text
      and result_record.logical_stage_key = 'ingest-upload.classify';

    -- A configured fallback is not an execution receipt. Keep projections
    -- paired and exact, and never omit a retained actual Ollama execution.
    if p_response ? 'credit_fallback' or p_extracted_payload ? 'credit_fallback'
      or v_execution_provider = 'ollama' then
      if not (p_response ? 'credit_fallback' and p_extracted_payload ? 'credit_fallback')
        or not private.valid_ollama_credit_policy(p_response->'credit_fallback')
        or p_response->'credit_fallback' is distinct from p_extracted_payload->'credit_fallback'
        or p_response->'credit_fallback' is distinct from v_saved_fallback
        or not coalesce(v_execution_verified,false) then
        raise exception 'UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID';
      end if;
    end if;
  end if;

  if v_upload.ingest_extraction_contract_version in ('upload-extraction.2','upload-extraction.3')
    and p_ingest_status = 'completed' and (
      v_upload.ingest_extraction_text is null
      or p_extracted_text is distinct from v_upload.ingest_extraction_text
      or p_response->'storage_path' is distinct from pg_catalog.to_jsonb(v_upload.storage_path)
      or p_response#>'{confirm_payload,filename}' is distinct from pg_catalog.to_jsonb(v_upload.file_name)
      or p_response#>'{confirm_payload,char_count}' is distinct from pg_catalog.to_jsonb(
        pg_catalog.cardinality(private.upload_source_utf16_units(v_upload.ingest_extraction_text, false)))
      or p_response->'extracted_text' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_text)
      or p_response->'extraction_format' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_format)
      or p_extracted_payload->'extraction_format' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_format)
      or p_response->'resource_policy_version' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_policy_version)
      or p_extracted_payload->'resource_policy_version' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_policy_version)
      or p_response#>'{confirm_payload,truncated}' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_truncated)
      or p_extracted_payload->'truncated' is distinct from pg_catalog.to_jsonb(v_upload.ingest_extraction_truncated)
    ) then
    raise exception 'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT';
  end if;

  update public.uploads
  set extracted_text = p_extracted_text,
      extracted_payload = p_extracted_payload,
      status = case when p_ingest_status = 'completed' then 'ready' else 'failed' end,
      completed_at = pg_catalog.clock_timestamp(),
      error_code = p_error_code,
      ingest_status = p_ingest_status,
      ingest_stage = 'terminal',
      ingest_http_status = p_http_status,
      ingest_response = p_response
  where id = p_upload_id;

  return pg_catalog.jsonb_build_object('outcome', 'settled');
end;
$function$;
