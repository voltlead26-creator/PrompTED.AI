begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Disposable database fixtures use the real claim/checkpoint/completion/import
-- commands. Storage rows prove command preconditions, not uploaded bytes.
create function pg_temp.sp_owner() returns uuid language sql as $$
  select '71000909-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.sp_id(p_slot integer) returns uuid language sql as $$
  select ('72000909-0000-8000-8000-'||lpad(p_slot::text,12,'0'))::uuid $$;
create function pg_temp.sp_sha(p_value text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.sp_token(p_slot integer) returns uuid language sql as $$
  select ingest_claim_token from public.uploads where id=pg_temp.sp_id(p_slot) $$;
create function pg_temp.sp_path(p_slot integer) returns text language sql as $$
  select pg_temp.sp_owner()::text||'/'||pg_temp.sp_id(p_slot)::text||'/source.'||case when p_slot=2 then 'pdf' else 'md' end $$;
create function pg_temp.sp_complete(p_slot integer) returns jsonb language sql as $$
  select public.complete_upload_source_preparation_v1(pg_temp.sp_id(p_slot),pg_temp.sp_owner(),
    pg_temp.sp_sha('request/'||p_slot),pg_temp.sp_token(p_slot)) $$;
create function pg_temp.sp_import(p_slot integer) returns jsonb language sql as $$
  select public.commit_document_import(pg_temp.sp_id(p_slot),
    ('73000909-0000-4000-8000-'||lpad(p_slot::text,12,'0'))::uuid,
    ('74000909-0000-4000-8000-'||lpad(p_slot::text,12,'0'))::uuid,
    'Reviewed source','Synthetic import','{"primary":{"template_id":"imported_document"}}'::jsonb,
    jsonb_build_array(jsonb_build_object('id',('75000909-0000-4000-8000-'||lpad(p_slot::text,12,'0'))::uuid,
      'name','Source','order_index',0,'content','Original source wording.','status','draft',
      'version_history','[]'::jsonb,'is_required',true))) $$;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  (pg_temp.sp_owner(),'source-preparation-owner@example.invalid',false,false,now(),now()),
  ('71000909-0000-4000-8000-000000000002','source-preparation-other@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (pg_temp.sp_owner(),
  '71000909-0000-4000-8000-000000000002')),2,'both authenticated fixture owners exist');
select ok(has_function_privilege('service_role','public.complete_upload_source_preparation_v1(uuid,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_upload_source_preparation_v1(uuid,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.complete_upload_source_preparation_v1(uuid,uuid,text,uuid)','EXECUTE'),
  'source completion is service-role only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid='public.complete_upload_source_preparation_v1(uuid,uuid,text,uuid)'::regprocedure),
  'source command has fixed empty search path and explicit definer authority');

set local role service_role;
select is(public.claim_upload_ingest(pg_temp.sp_id(slot),pg_temp.sp_owner(),pg_temp.sp_path(slot),
  case when slot=2 then 'application/pdf' else 'text/markdown' end,
  case when slot=2 then 'source.pdf' else 'source.md' end,128,pg_temp.sp_sha('request/'||slot),repeat('a',64),
  'upload-extraction.3')->>'outcome','accepted','fixture '||slot||' admitted') from generate_series(1,10) slot;
select is(public.advance_upload_ingest(pg_temp.sp_id(slot),pg_temp.sp_owner(),pg_temp.sp_sha('request/'||slot),
  pg_temp.sp_token(slot),'prepared','storage_dispatched')->>'outcome','advanced','fixture '||slot||' storage dispatched')
  from generate_series(1,10) slot;
select is(public.advance_upload_ingest(pg_temp.sp_id(slot),pg_temp.sp_owner(),pg_temp.sp_sha('request/'||slot),
  pg_temp.sp_token(slot),'storage_dispatched','storage_completed')->>'outcome','advanced','fixture '||slot||' retention acknowledged')
  from generate_series(1,10) slot;
select is(public.record_upload_extraction_snapshot(pg_temp.sp_id(slot),pg_temp.sp_owner(),pg_temp.sp_sha('request/'||slot),
  pg_temp.sp_token(slot),repeat('a',64),pg_temp.sp_sha('Original source wording.'),'Original source wording.',
  case when slot=2 then 'pdf' else 'text' end,slot=3,'upload-resource-policy.2','upload-extraction.3',null)->>'outcome',
  'recorded','fixture '||slot||' immutable extraction recorded') from generate_series(1,10) slot where slot<>6;
reset role;
insert into storage.objects(bucket_id,name,metadata)
  select 'original-documents',pg_temp.sp_path(slot),jsonb_build_object('size',case when slot=9 then 127 else 128 end)
  from generate_series(1,10) slot where slot<>5;
select is((select count(*)::integer from storage.objects where name like pg_temp.sp_owner()::text||'/%'),9,
  'nine original object fixtures exist before completion');
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '120 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.sp_id(7);
insert into private.legacy_model_attempt_admissions(user_id,checkpoint_scope,logical_request_id,logical_stage_key,
  request_sha256,attempt_number,claim_token,lease_expires_at)
  values(pg_temp.sp_owner(),'ingest-upload',pg_temp.sp_id(10)::text,'ingest-upload.classify',repeat('b',64),1,
    pg_temp.sp_token(10),clock_timestamp()+interval '120 seconds');

set local role service_role;
select is(public.advance_upload_ingest(pg_temp.sp_id(4),pg_temp.sp_owner(),pg_temp.sp_sha('request/4'),pg_temp.sp_token(4),
  'storage_completed','provider_dispatched')->>'outcome','advanced','provider-stage fixture is genuinely dispatched');
select is(pg_temp.sp_complete(1)->>'outcome','settled','complete source settles without provider classification');
select is(pg_temp.sp_complete(2)->>'outcome','settled','PDF source may be retained without permitting reconstructed editing');
select is(pg_temp.sp_complete(3)->>'outcome','settled','truncated preview retains its truthful completeness state');
select is(pg_temp.sp_complete(1)->>'outcome','idempotent_replay','lost response returns the same completion');
select throws_ok($$select pg_temp.sp_complete(4)$$,'P0001','UPLOAD_SOURCE_PREPARATION_CONFLICT','provider dispatch cannot become no-AI completion');
select throws_ok($$select pg_temp.sp_complete(5)$$,'P0001','UPLOAD_SOURCE_PREPARATION_ORIGINAL_UNAVAILABLE','missing original prevents completion');
select throws_ok($$select pg_temp.sp_complete(6)$$,'P0001','UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','missing checkpoint prevents completion');
select throws_ok($$select pg_temp.sp_complete(7)$$,'P0001','UPLOAD_SOURCE_PREPARATION_CONFLICT','expired lease prevents completion');
select throws_ok($$select public.complete_upload_source_preparation_v1(pg_temp.sp_id(8),
  '71000909-0000-4000-8000-000000000002',pg_temp.sp_sha('request/8'),pg_temp.sp_token(8))$$,
  'P0001','UPLOAD_SOURCE_PREPARATION_CONFLICT','another owner cannot complete the source');
select throws_ok($$select public.complete_upload_source_preparation_v1(pg_temp.sp_id(8),pg_temp.sp_owner(),
  repeat('f',64),pg_temp.sp_token(8))$$,'P0001','UPLOAD_SOURCE_PREPARATION_CONFLICT','wrong request cannot complete the source');
select throws_ok($$select public.complete_upload_source_preparation_v1(pg_temp.sp_id(8),pg_temp.sp_owner(),
  pg_temp.sp_sha('request/8'),'76000909-0000-4000-8000-000000000001')$$,
  'P0001','UPLOAD_SOURCE_PREPARATION_CONFLICT','stale claim cannot complete the source');
select throws_ok($$select pg_temp.sp_complete(9)$$,'P0001','UPLOAD_SOURCE_PREPARATION_ORIGINAL_UNAVAILABLE','wrong original size prevents completion');
select throws_ok($$select pg_temp.sp_complete(10)$$,'P0001','UPLOAD_SOURCE_PREPARATION_PROVIDER_WORK_EXISTS','existing provider attempt is never relabelled');
reset role;

create temporary table sp_original_receipt as select ingest_response from public.uploads where id=pg_temp.sp_id(1);
select is((select ingest_response from public.uploads where id=pg_temp.sp_id(1)),
  jsonb_build_object('contract_version','upload-source-preparation.1','upload_id',pg_temp.sp_id(1),
    'storage_path',pg_temp.sp_path(1),'original_retained',true,'classification_status','not_requested',
    'extracted_text','Original source wording.','extraction_format','text','resource_policy_version','upload-resource-policy.2',
    'extraction_text_sha256',pg_temp.sp_sha('Original source wording.'),'truncated',false),'independent read has exact source receipt and no model confirmation');
select ok(not private.completed_upload_ingest_is_valid(id,ingest_response,extracted_text,extracted_payload),
  'source receipt does not claim the Home classification contract') from public.uploads where id=pg_temp.sp_id(1);
select is((select count(*)::integer from public.usage_ledger where user_id=pg_temp.sp_owner()),0,'source completion creates no model or document charge');
select is((select count(*)::integer from public.uploads where user_id=pg_temp.sp_owner() and ingest_status='completed'),3,
  'all rejected fixtures remain uncompleted');

set local role authenticated;
select set_config('request.jwt.claim.sub','71000909-0000-4000-8000-000000000002',true);
select throws_like($$select pg_temp.sp_import(1)$$,'UPLOAD_NOT_FOUND:%','other owner cannot import a completed source');
select set_config('request.jwt.claim.sub',pg_temp.sp_owner()::text,true);
select is(pg_temp.sp_import(1)->>'status','committed','owner-reviewed complete text imports through the existing atomic command');
select is(pg_temp.sp_import(1)->>'idempotent_replay','true','repeat import reopens the same document');
select throws_ok($$select pg_temp.sp_import(2)$$,'P0001','UPLOAD_SOURCE_IMPORT_UNAVAILABLE','PDF preview cannot bypass format preservation');
select throws_ok($$select pg_temp.sp_import(3)$$,'P0001','UPLOAD_IMPORT_PREVIEW_INCOMPLETE','truncated source cannot become a complete editable document');
reset role;
select is((select count(*)::integer from public.documents where user_id=pg_temp.sp_owner()),1,'only the confirmed complete text creates a document');
select is((select ingest_response from public.uploads where id=pg_temp.sp_id(1)),(select ingest_response from sp_original_receipt),
  'import preserves the original source completion receipt');
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '120 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.sp_id(1);
set local role service_role;
select is(pg_temp.sp_complete(1)->>'outcome','idempotent_replay','committed historical receipt survives lease expiry');
reset role;
insert into private.account_deletion_fences(user_key) values(private.account_deletion_user_key(pg_temp.sp_owner()));
set local role service_role;
select throws_ok($$select pg_temp.sp_complete(8)$$,'P0001','ACCOUNT_DELETION_FENCED','deletion fence prevents new completion');
reset role;
select * from finish();
rollback;
