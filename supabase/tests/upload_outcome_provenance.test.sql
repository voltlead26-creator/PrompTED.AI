begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

select has_function(
  'public', 'upsert_own_outcome_with_upload',
  array['uuid','text','jsonb','text','uuid'],
  'new upload-backed outcomes use one atomic owner command'
);
select has_function(
  'public', 'attach_own_upload_to_outcome', array['uuid','uuid'],
  'existing outcomes replace their active source through one atomic owner command'
);
select is(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where namespace_record.nspname = 'public'
      and function_record.proname in (
        'upsert_own_outcome_with_upload', 'attach_own_upload_to_outcome'
      )
      and function_record.prosecdef
      and function_record.proconfig @> array['search_path=""']::text[]
  ),
  2,
  'both provenance commands are SECURITY DEFINER with an empty search path'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.upsert_own_outcome_with_upload(uuid,text,jsonb,text,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated', 'public.attach_own_upload_to_outcome(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.upsert_own_outcome_with_upload(uuid,text,jsonb,text,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'public.attach_own_upload_to_outcome(uuid,uuid)', 'EXECUTE'
  ),
  'only authenticated owners can invoke the provenance commands'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('ca400000-0000-4000-8000-000000000001', 'upload-owner@example.invalid', false, false, now(), now()),
  ('ca400000-0000-4000-8000-000000000002', 'upload-other@example.invalid', false, false, now(), now());

insert into public.uploads(
  id, user_id, storage_path, file_type, file_name, file_size_bytes,
  extracted_text, extracted_payload, status, idempotency_key, completed_at,
  ingest_request_sha256, ingest_content_sha256, ingest_status, ingest_stage,
  ingest_http_status, ingest_response
) values
  (
    'ca450000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001/ca450000-0000-4000-8000-000000000001/source-one.txt',
    'text/plain', 'source-one.txt', 21,
    'Exact retained source one.',
    '{"original_retained":true,"classification_status":"completed"}'::jsonb,
    'ready', 'ca450000-0000-4000-8000-000000000001', now(),
    pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64),
    'completed', 'terminal', 200,
    '{"upload_id":"ca450000-0000-4000-8000-000000000001","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Synthetic source one","document_type":"text","structure":[{"title":"Source","items":["Fact"]}],"filename":"source-one.txt","char_count":21,"truncated":false}}'::jsonb
  ),
  (
    'ca450000-0000-4000-8000-000000000002',
    'ca400000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001/ca450000-0000-4000-8000-000000000002/source-two.txt',
    'text/plain', 'source-two.txt', 22,
    'Exact retained source two.',
    '{"original_retained":true,"classification_status":"completed"}'::jsonb,
    'ready', 'ca450000-0000-4000-8000-000000000002', now(),
    pg_catalog.repeat('c', 64), pg_catalog.repeat('d', 64),
    'completed', 'terminal', 200,
    '{"upload_id":"ca450000-0000-4000-8000-000000000002","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Synthetic source two","document_type":"text","structure":[{"title":"Source","items":["Fact"]}],"filename":"source-two.txt","char_count":22,"truncated":false}}'::jsonb
  ),
  (
    'ca450000-0000-4000-8000-000000000003',
    'ca400000-0000-4000-8000-000000000002',
    'ca400000-0000-4000-8000-000000000002/ca450000-0000-4000-8000-000000000003/private.txt',
    'text/plain', 'private.txt', 18,
    'Other owner source.',
    '{"original_retained":true,"classification_status":"completed"}'::jsonb,
    'ready', 'ca450000-0000-4000-8000-000000000003', now(),
    pg_catalog.repeat('e', 64), pg_catalog.repeat('f', 64),
    'completed', 'terminal', 200,
    '{"upload_id":"ca450000-0000-4000-8000-000000000003","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Private source","document_type":"text","structure":[{"title":"Source","items":["Fact"]}],"filename":"private.txt","char_count":18,"truncated":false}}'::jsonb
  ),
  (
    'ca450000-0000-4000-8000-000000000004',
    'ca400000-0000-4000-8000-000000000001',
    'ca400000-0000-4000-8000-000000000001/ca450000-0000-4000-8000-000000000004/pending.txt',
    'text/plain', 'pending.txt', 7,
    null, null, 'processing', 'ca450000-0000-4000-8000-000000000004', null,
    null, null, null, null, null, null
  );

select set_config(
  'request.jwt.claim.sub', 'ca400000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.upsert_own_outcome_with_upload(
    'ca410000-0000-4000-8000-000000000001',
    'Prepare an upload-backed result.',
    '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"upload_context":"caller-forged excerpt","upload_id":"ca450000-0000-4000-8000-000000000001"}'::jsonb,
    'in_progress',
    'ca450000-0000-4000-8000-000000000001'
  ),
  'ca410000-0000-4000-8000-000000000001'::uuid,
  'the upload-backed outcome is created under the authenticated owner'
);

reset role;
select is(
  (
    select recommendation_payload->>'upload_context'
    from public.outcomes
    where id = 'ca410000-0000-4000-8000-000000000001'
  ),
  'Exact retained source one.',
  'server-retained text replaces caller-supplied upload context'
);
select is(
  (
    select outcome_id from public.uploads
    where id = 'ca450000-0000-4000-8000-000000000001'
  ),
  'ca410000-0000-4000-8000-000000000001'::uuid,
  'the upload row and outcome payload bind in the same transaction'
);

select set_config(
  'request.jwt.claim.sub', 'ca400000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select is(
  public.attach_own_upload_to_outcome(
    'ca410000-0000-4000-8000-000000000001',
    'ca450000-0000-4000-8000-000000000002'
  )->>'upload_id',
  'ca450000-0000-4000-8000-000000000002',
  'replacing the source returns the exact new upload identity'
);
reset role;
select is(
  (
    select recommendation_payload->>'upload_context'
    from public.outcomes
    where id = 'ca410000-0000-4000-8000-000000000001'
  ),
  'Exact retained source two.',
  'replacement atomically uses the new retained source body'
);
select is(
  (
    select outcome_id from public.uploads
    where id = 'ca450000-0000-4000-8000-000000000001'
  ),
  null::uuid,
  'the prior non-import source is no longer attributed to the outcome'
);

select set_config(
  'request.jwt.claim.sub', 'ca400000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.attach_own_upload_to_outcome(
      'ca410000-0000-4000-8000-000000000001',
      'ca450000-0000-4000-8000-000000000003'
    )$$,
    '%OUTCOME_UPLOAD_BINDING_INVALID%'
  ),
  'another owner upload fails with the same non-disclosing binding error'
);
select ok(
  pg_temp.raises_matching(
    $$select public.attach_own_upload_to_outcome(
      'ca410000-0000-4000-8000-000000000001',
      'ca450000-0000-4000-8000-000000000004'
    )$$,
    '%OUTCOME_UPLOAD_BINDING_INVALID%'
  ),
  'an incomplete upload cannot become generation provenance'
);
select ok(
  pg_temp.raises_matching(
    $$select public.upsert_own_outcome_with_upload(
      'ca410000-0000-4000-8000-000000000099', 'Invalid mismatch',
      '{"upload_id":"ca450000-0000-4000-8000-000000000001"}'::jsonb,
      'in_progress', 'ca450000-0000-4000-8000-000000000002'
    )$$,
    '%OUTCOME_UPLOAD_BINDING_INVALID%'
  ),
  'the payload identity must exactly match the locked upload identity'
);

reset role;
select is(
  (
    select pg_catalog.count(*)::integer from public.outcomes
    where id = 'ca410000-0000-4000-8000-000000000099'
  ),
  0,
  'a rejected binding leaves no partially created outcome'
);

select * from finish();
rollback;
