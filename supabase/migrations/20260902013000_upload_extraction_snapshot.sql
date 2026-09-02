begin;

create or replace function public.load_upload_extraction_snapshot(
  p_upload_id uuid,
  p_user_id uuid,
  p_request_sha256 text,
  p_claim_token uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_upload public.uploads%rowtype;
begin
  if p_upload_id is null
    or p_user_id is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_claim_token is null then
    return null;
  end if;

  select upload_record.*
  into v_upload
  from public.uploads upload_record
  where upload_record.id = p_upload_id
    and upload_record.user_id = p_user_id
    and upload_record.status = 'processing'
    and upload_record.ingest_status = 'processing'
    and upload_record.ingest_stage in (
      'storage_completed', 'provider_dispatched'
    )
    and upload_record.ingest_request_sha256 = p_request_sha256
    and upload_record.ingest_claim_token = p_claim_token
    and upload_record.ingest_lease_expires_at > pg_catalog.statement_timestamp();

  if not found then
    return null;
  end if;

  return pg_catalog.jsonb_build_object(
    'upload_id', v_upload.id,
    'user_id', v_upload.user_id,
    'request_sha256', v_upload.ingest_request_sha256,
    'claim_token', v_upload.ingest_claim_token,
    'storage_path', v_upload.storage_path,
    'filename', v_upload.file_name,
    'file_type', v_upload.file_type,
    'byte_length', v_upload.file_size_bytes,
    'content_sha256', v_upload.ingest_content_sha256,
    'stage', v_upload.ingest_stage
  );
end;
$function$;

revoke all on function public.load_upload_extraction_snapshot(
  uuid, uuid, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.load_upload_extraction_snapshot(
  uuid, uuid, text, uuid
) to service_role;

comment on function public.load_upload_extraction_snapshot(
  uuid, uuid, text, uuid
) is
  'Loads parser metadata only for the exact live durable upload claim. Service-role only.';

commit;
