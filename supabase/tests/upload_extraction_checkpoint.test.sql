begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function(
  'public', 'begin_upload_extraction_attempt',
  array['uuid', 'uuid', 'text', 'uuid'],
  'extraction work has one durable attempt command'
);
select has_function(
  'public', 'record_upload_extraction_snapshot',
  array['uuid', 'uuid', 'text', 'uuid', 'text', 'text', 'text', 'text', 'boolean', 'text'],
  'successful extraction has one immutable checkpoint command'
);
select has_function(
  'public', 'get_upload_extraction_checkpoint',
  array['uuid', 'uuid', 'text', 'uuid'],
  'replay loads one exact extraction checkpoint'
);

select ok(not exists (
  select 1
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid = function_record.pronamespace
  where namespace_record.nspname = 'public'
    and function_record.proname = any(array[
      'begin_upload_extraction_attempt',
      'record_upload_extraction_snapshot',
      'get_upload_extraction_checkpoint'
    ])
    and (
      not function_record.prosecdef
      or not (function_record.proconfig @> array['search_path=""']::text[])
      or not pg_catalog.has_function_privilege(
        'service_role', function_record.oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'authenticated', function_record.oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege('anon', function_record.oid, 'EXECUTE')
    )
  ), 'all extraction checkpoint commands are fixed-path and service-only'
);

insert into auth.users(
  id, email, is_sso_user, is_anonymous, created_at, updated_at
) values (
  '71000000-0000-4000-8000-000000000012',
  'extract-checkpoint@example.invalid', false, false, now(), now()
);

set local role service_role;
select is(
  public.claim_upload_ingest(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012/72000000-0000-4000-8000-000000000012/resume.txt',
    'text/plain', 'resume.txt', 20, repeat('a', 64), repeat('b', 64)
  )->>'outcome', 'accepted', 'checkpoint fixture is accepted'
);
select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000012', repeat('a', 64),
  (select ingest_claim_token from public.uploads
   where id = '72000000-0000-4000-8000-000000000012'),
  'prepared', 'storage_dispatched'
);
select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000012', repeat('a', 64),
  (select ingest_claim_token from public.uploads
   where id = '72000000-0000-4000-8000-000000000012'),
  'storage_dispatched', 'storage_completed'
);

select is(
  public.get_upload_extraction_checkpoint(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012')
  ), null::jsonb, 'no successful parser result is invented'
);
select is(
  public.begin_upload_extraction_attempt(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012')
  )->>'attempt_for_claim', '1',
  'the first isolated parser attempt is durably admitted'
);

select is(
  public.record_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012'),
    repeat('b', 64),
    encode(digest(convert_to('Reliable source text', 'UTF8'), 'sha256'), 'hex'),
    'Reliable source text', 'text', false, 'upload-resource-policy.1'
  )->>'outcome', 'recorded',
  'successful extraction is checkpointed before provider dispatch'
);
select is(
  public.record_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012'),
    repeat('b', 64),
    encode(digest(convert_to('Reliable source text', 'UTF8'), 'sha256'), 'hex'),
    'Reliable source text', 'text', false, 'upload-resource-policy.1'
  )->>'outcome', 'idempotent_replay',
  'the exact extraction checkpoint is idempotent'
);
select is(
  public.get_upload_extraction_checkpoint(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012')
  )->>'text', 'Reliable source text',
  'replay loads the exact immutable extracted text'
);

select throws_ok(
  format($sql$select public.record_upload_extraction_snapshot(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64), %L::uuid,
    repeat('b', 64), repeat('c', 64), 'Changed text', 'text', false,
    'upload-resource-policy.1')$sql$,
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012')),
  'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT',
  'different parser output cannot replace the checkpoint'
);

select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000012', repeat('a', 64),
  (select ingest_claim_token from public.uploads
   where id = '72000000-0000-4000-8000-000000000012'),
  'storage_completed', 'provider_dispatched'
);
select is(
  public.get_upload_extraction_checkpoint(
    '72000000-0000-4000-8000-000000000012',
    '71000000-0000-4000-8000-000000000012', repeat('a', 64),
    (select ingest_claim_token from public.uploads
     where id = '72000000-0000-4000-8000-000000000012')
  )->>'format', 'text',
  'provider-dispatched replay uses the same checkpoint without parsing again'
);

reset role;
insert into public.uploads(
  id, user_id, storage_path, file_type, file_name, file_size_bytes,
  status, idempotency_key, ingest_request_sha256, ingest_content_sha256,
  ingest_status, ingest_stage, ingest_claim_token, ingest_heartbeat_at,
  ingest_lease_expires_at
) values (
  '72000000-0000-4000-8000-000000000013',
  '71000000-0000-4000-8000-000000000012',
  '71000000-0000-4000-8000-000000000012/72000000-0000-4000-8000-000000000013/conflict.txt',
  'text/plain', 'conflict.txt', 20, 'processing',
  '72000000-0000-4000-8000-000000000013', repeat('d', 64), repeat('e', 64),
  'processing', 'storage_completed',
  '73000000-0000-4000-8000-000000000013', clock_timestamp(),
  clock_timestamp() + interval '120 seconds'
);
set local role service_role;
select is(
  public.settle_upload_ingest(
    '72000000-0000-4000-8000-000000000013',
    '71000000-0000-4000-8000-000000000012', repeat('d', 64),
    'reconciliation_required', 409,
    '{"upload_id":"72000000-0000-4000-8000-000000000013","error":{"code":"UPLOAD_EXTRACTION_SOURCE_CONFLICT"}}'::jsonb,
    null,
    '{"original_retained":null,"storage_status":"conflict","classification_status":"reconciliation_required"}'::jsonb,
    'UPLOAD_EXTRACTION_SOURCE_CONFLICT',
    '73000000-0000-4000-8000-000000000013'
  )->>'outcome', 'settled',
  'a retained source conflict can settle from storage_completed'
);

reset role;
select * from finish();
rollback;
