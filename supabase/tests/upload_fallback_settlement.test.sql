begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Real command/ledger regression, with synthetic extraction and provider receipts.
-- No model is called. Upload request hashes and provider request hashes differ.
create function pg_temp.uf_owner(p_other boolean default false) returns uuid language sql as $$
  select case when p_other then '71007101-0000-4000-8000-000000000002'::uuid
    else '71007101-0000-4000-8000-000000000001'::uuid end
$$;
create function pg_temp.uf_id(p_slot integer) returns uuid language sql as $$
  select ('72007101-0000-8000-8000-'||lpad(p_slot::text,12,'0'))::uuid
$$;
create function pg_temp.uf_sha(p_value text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex')
$$;
create function pg_temp.uf_request(p_slot integer) returns text language sql as $$
  select pg_temp.uf_sha('upload-request/'||p_slot::text)
$$;
create function pg_temp.uf_text() returns text language sql as $$
  select 'Keep the original wording.'::text
$$;
create function pg_temp.uf_policy() returns jsonb language sql as $$
  select jsonb_build_object('provider','ollama','model','gpt-oss:20b',
    'modelDigest',repeat('a',64),'configurationVersion','upload-fallback-test.1')
$$;
create function pg_temp.uf_token(p_slot integer) returns uuid language sql as $$
  select ingest_claim_token from public.uploads where id=pg_temp.uf_id(p_slot)
$$;
create function pg_temp.uf_classification() returns jsonb language sql as $$
  select jsonb_build_object('document_type','document','purpose','Synthetic classification.',
    'sections',jsonb_build_array(jsonb_build_object('title','Document','items',jsonb_build_array('Original wording'))))
$$;
create function pg_temp.uf_response(p_slot integer,p_policy jsonb) returns jsonb language sql as $$
  select jsonb_build_object('upload_id',u.id,'storage_path',u.storage_path,
    'extracted_text',pg_temp.uf_text(),'original_retained',true,'classification_status','completed',
    'extraction_format',u.ingest_extraction_format,'resource_policy_version',u.ingest_extraction_policy_version,
    'confirm_payload',jsonb_build_object('summary','Synthetic classification.','document_type','document',
      'filename',u.file_name,'char_count',length(pg_temp.uf_text()),'truncated',false,
      'structure',jsonb_build_array(jsonb_build_object('title','Document','items',jsonb_build_array('Original wording')))))
    || case when p_policy is null then '{}'::jsonb else jsonb_build_object('credit_fallback',p_policy) end
  from public.uploads u where id=pg_temp.uf_id(p_slot)
$$;
create function pg_temp.uf_payload(p_slot integer,p_policy jsonb) returns jsonb language sql as $$
  select jsonb_build_object('truncated',false,'original_retained',true,'classification_status','completed',
    'extraction_format',u.ingest_extraction_format,'resource_policy_version',u.ingest_extraction_policy_version)
    || case when p_policy is null then '{}'::jsonb else jsonb_build_object('credit_fallback',p_policy) end
  from public.uploads u where id=pg_temp.uf_id(p_slot)
$$;
create function pg_temp.uf_settle(p_slot integer,p_response_policy jsonb default pg_temp.uf_policy(),
  p_payload_policy jsonb default pg_temp.uf_policy()) returns jsonb language sql as $$
  select public.settle_upload_ingest(pg_temp.uf_id(p_slot),pg_temp.uf_owner(),pg_temp.uf_request(p_slot),
    'completed',200,pg_temp.uf_response(p_slot,p_response_policy),pg_temp.uf_text(),
    pg_temp.uf_payload(p_slot,p_payload_policy),null,pg_temp.uf_token(p_slot))
$$;
create function pg_temp.uf_try_settle(p_slot integer) returns jsonb language plpgsql as $$
begin
  return pg_temp.uf_settle(p_slot);
exception when others then
  -- Keep the intended RED command error visible without aborting later checks.
  return jsonb_build_object('error_code',sqlstate,'error_message',sqlerrm);
end;
$$;
create function pg_temp.uf_replay(p_slot integer) returns jsonb language sql as $$
  select public.claim_upload_ingest(u.id,u.user_id,u.storage_path,u.file_type,u.file_name,
    u.file_size_bytes,u.ingest_request_sha256,u.ingest_content_sha256)
  from public.uploads u where u.id=pg_temp.uf_id(p_slot)
$$;

-- Seed actual durable admission/dispatch/usage/result commands. Merely enabling
-- a route policy is deliberately insufficient to prove fallback execution.
create function pg_temp.uf_provider(p_slot integer,p_kind text default 'ollama',p_other boolean default false,
  p_stage text default 'ingest-upload.classify',p_scope text default 'ingest-upload',
  p_request_id text default null) returns jsonb language plpgsql as $$
declare
  v_owner uuid := pg_temp.uf_owner(p_other);
  v_request text := coalesce(p_request_id,pg_temp.uf_id(p_slot)::text);
  v_hash text := pg_temp.uf_sha('provider-request/'||p_slot::text);
  v_admission jsonb; v_record jsonb; v_dispatch jsonb; v_attempt integer;
  v_route jsonb := jsonb_build_object('provider','openai','semanticRoute','fast','model','gpt-5.6-luna',
    'reasoningEffort','low','routingVersion','upload-test.1','structuredOutputSchemaVersion','ingest-upload.classification.1',
    'allowedTools','[]'::jsonb,'timeoutMs',30000,'maxAttempts',2,'background',false,'store',false,
    'fallback',null,'creditFallback',pg_temp.uf_policy());
  v_envelope jsonb;
begin
  if p_kind not in ('ollama','openai','failed','unknown','completed_failed') then raise exception 'TEST_PROVIDER_KIND_INVALID'; end if;
  v_envelope := jsonb_build_object('version','legacy-provider-result.1','text',pg_temp.uf_classification()::text,
    'structured',pg_temp.uf_classification(),'sources','[]'::jsonb,'route_snapshot',v_route);
  for v_attempt in 1..(case when p_kind='openai' then 1 else 2 end) loop
    v_admission := public.read_legacy_model_call_checkpoint_with_fallback(v_owner,p_scope,null,v_request,
      p_stage,v_hash,2,null,true);
    if v_admission->>'attempt_number' is distinct from v_attempt::text then
      raise exception 'TEST_PROVIDER_ADMISSION_FAILED'; end if;
    v_dispatch := public.mark_legacy_model_attempt_dispatched(v_owner,p_scope,null,v_request,p_stage,v_hash,
      v_attempt,(v_admission->>'attempt_admission_id')::uuid,
      (v_admission->>'execution_claim_token')::uuid,extensions.gen_random_uuid());
    if v_dispatch->>'state' is distinct from 'dispatched' then raise exception 'TEST_PROVIDER_DISPATCH_FAILED'; end if;
    if v_attempt=1 and p_kind<>'openai' then
      v_record := public.record_legacy_model_call_attempt_with_provider(v_owner,v_request,p_stage,v_hash,
        v_admission->>'attempt_admission_id',1,'failed','','http_429','OPENAI_CREDIT_EXHAUSTED',0,0,
        now(),now(),'gpt-5.6-luna','upload-test.1','fast','low',p_scope,null,null,
        (v_admission->>'execution_claim_token')::uuid,'openai');
    else
      v_record := public.record_legacy_model_call_attempt_with_provider(v_owner,v_request,p_stage,v_hash,
        v_admission->>'attempt_admission_id',v_attempt,
        case p_kind when 'failed' then 'failed' when 'completed_failed' then 'failed'
          when 'unknown' then 'unknown' else 'succeeded' end,
        'synthetic-upload-receipt',
        case p_kind when 'failed' then 'http_503' when 'unknown' then 'ambiguous' else 'completed' end,
        case p_kind when 'failed' then 'OLLAMA_UNAVAILABLE' when 'unknown' then 'OLLAMA_PROVIDER_RECONCILIATION_REQUIRED'
          when 'completed_failed' then 'MODEL_RESPONSE_INVALID' end,
        case when p_kind in ('openai','ollama','completed_failed') then 17 else 0 end,
        case when p_kind in ('openai','ollama','completed_failed') then 9 else 0 end,
        now(),now(),case when p_kind='openai' then 'gpt-5.6-luna' else 'gpt-oss:20b' end,
        'upload-test.1','fast','low',p_scope,null,
        case when p_kind in ('openai','ollama','completed_failed') then v_envelope end,
        (v_admission->>'execution_claim_token')::uuid,case when p_kind='openai' then 'openai' else 'ollama' end);
    end if;
    if v_record->>'usage_ledger_id' is null then raise exception 'TEST_PROVIDER_USAGE_MISSING'; end if;
  end loop;
  return v_record;
end;
$$;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  (pg_temp.uf_owner(),'upload-fallback-owner@example.invalid',false,false,now(),now()),
  (pg_temp.uf_owner(true),'upload-fallback-other@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (pg_temp.uf_owner(),pg_temp.uf_owner(true))),
  2,'both fixture owners are positively created');
set local role service_role;
create temporary table uf_fixtures(slot integer primary key,version text);
insert into uf_fixtures select slot,case when slot=1 then 'upload-extraction.2'
  when slot=12 then 'upload-extraction.1' else 'upload-extraction.3' end from generate_series(1,14) slot;
select is(public.claim_upload_ingest(pg_temp.uf_id(slot),pg_temp.uf_owner(),
  pg_temp.uf_owner()::text||'/'||pg_temp.uf_id(slot)::text||'/source.txt','text/plain','source.txt',
  octet_length(pg_temp.uf_text()),pg_temp.uf_request(slot),pg_temp.uf_sha(pg_temp.uf_text()),version)->>'outcome',
  'accepted','upload '||slot||' is positively claimed') from uf_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.uf_id(slot),pg_temp.uf_owner(),pg_temp.uf_request(slot),
  pg_temp.uf_token(slot),'prepared','storage_dispatched')->>'outcome','advanced',
  'upload '||slot||' dispatches original retention') from uf_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.uf_id(slot),pg_temp.uf_owner(),pg_temp.uf_request(slot),
  pg_temp.uf_token(slot),'storage_dispatched','storage_completed')->>'outcome','advanced',
  'upload '||slot||' records original retention') from uf_fixtures order by slot;
select is(public.record_upload_extraction_snapshot(pg_temp.uf_id(slot),pg_temp.uf_owner(),pg_temp.uf_request(slot),
  pg_temp.uf_token(slot),pg_temp.uf_sha(pg_temp.uf_text()),pg_temp.uf_sha(pg_temp.uf_text()),pg_temp.uf_text(),
  'text',false,case when version='upload-extraction.3' then 'upload-resource-policy.2' else 'upload-resource-policy.1' end,
  version,null)->>'outcome','recorded','upload '||slot||' has an authoritative checkpoint') from uf_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.uf_id(slot),pg_temp.uf_owner(),pg_temp.uf_request(slot),
  pg_temp.uf_token(slot),'storage_completed','provider_dispatched')->>'outcome','advanced',
  'upload '||slot||' passes the checkpoint dispatch fence') from uf_fixtures order by slot;
select is((select count(*)::integer from public.uploads u join uf_fixtures f on u.id=pg_temp.uf_id(f.slot)
  where u.ingest_status='processing' and u.ingest_extraction_text=pg_temp.uf_text()),14,
  'all live owned fixtures exist with checkpoints before denials');

create temporary table uf_provider_receipts(slot integer primary key,receipt jsonb);
insert into uf_provider_receipts values
  (1,pg_temp.uf_provider(1)),(2,pg_temp.uf_provider(2)),(3,pg_temp.uf_provider(3)),
  (5,pg_temp.uf_provider(5,'openai')),(6,pg_temp.uf_provider(6,'ollama',true)),
  (7,pg_temp.uf_provider(7,'ollama',false,'unrelated.stage')),
  (8,pg_temp.uf_provider(8,'ollama',false,'ingest-upload.classify','ingest-upload',pg_temp.uf_id(1008)::text)),
  (9,pg_temp.uf_provider(9,'ollama',false,'ingest-upload.classify','recommend')),
  (10,pg_temp.uf_provider(10,'failed')),(11,pg_temp.uf_provider(11,'openai')),
  (12,pg_temp.uf_provider(12)),(13,pg_temp.uf_provider(13,'unknown')),
  (14,pg_temp.uf_provider(14,'completed_failed'));
select is((select count(*)::integer from uf_provider_receipts where receipt->>'usage_ledger_id' is not null),13,
  'provider scenarios positively wrote durable usage through existing commands');
select ok(pg_temp.uf_request(2)<>pg_temp.uf_sha('provider-request/2'),
  'upload body and provider request hashes intentionally differ');
reset role;
select is((select count(*)::integer from private.legacy_model_call_results r join public.usage_ledger u
  on u.id=r.usage_ledger_id and u.user_id=r.user_id and u.provider_request_sha256=r.request_sha256
  where r.user_id=pg_temp.uf_owner() and r.checkpoint_scope='ingest-upload'
  and r.logical_request_id in (pg_temp.uf_id(1)::text,pg_temp.uf_id(2)::text,pg_temp.uf_id(3)::text)
  and r.logical_stage_key='ingest-upload.classify' and u.provider='ollama' and u.model_call_status='succeeded'
  and u.provider_attempt_number=2 and r.response_envelope#>'{route_snapshot,creditFallback}'=pg_temp.uf_policy()),
  3,'positive fallback fixtures have matching owner/request/stage/result/usage provenance');
select is((select count(*)::integer from private.legacy_model_call_results
  where user_id=pg_temp.uf_owner() and logical_request_id in (pg_temp.uf_id(10)::text,pg_temp.uf_id(13)::text)),
  0,'failed and uncertain fallback attempts have no completed result');
select is((select count(*)::integer from private.legacy_model_call_results r join public.usage_ledger u
  on u.id=r.usage_ledger_id and u.user_id=r.user_id where r.user_id=pg_temp.uf_owner()
  and r.checkpoint_scope='ingest-upload' and r.logical_request_id=pg_temp.uf_id(14)::text
  and r.logical_stage_key='ingest-upload.classify' and u.provider='ollama'
  and u.provider_status='completed' and u.model_call_status='failed' and u.provider_error_code='MODEL_RESPONSE_INVALID'),
  1,'completed provider response with failed validation positively retains its result and failed usage');
set local role service_role;

select throws_ok(format('select pg_temp.uf_settle(2,%L::jsonb,%L::jsonb)',policy,policy),
  'P0001','UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID',label)
from (values ('null'::jsonb,'explicit null cannot represent execution'),
  (pg_temp.uf_policy()-'modelDigest','missing provider fields reject'),
  (pg_temp.uf_policy()||'{"extra":true}','extra provider fields reject'),
  (pg_temp.uf_policy()||'{"provider":"openai"}','another provider cannot be projected as fallback'),
  (pg_temp.uf_policy()||'{"model":"different-model"}','another execution model rejects'),
  (pg_temp.uf_policy()||'{"modelDigest":"invalid"}','invalid provider digest rejects'),
  (pg_temp.uf_policy()||jsonb_build_object('modelDigest',repeat('b',64)),'another model digest rejects'),
  (pg_temp.uf_policy()||'{"configurationVersion":"another-version"}','another configuration rejects')) cases(policy,label);
select throws_ok($$select pg_temp.uf_settle(2,pg_temp.uf_policy(),null)$$,
  'P0001','UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID','response-only fallback projection rejects');
select throws_ok($$select pg_temp.uf_settle(2,null,pg_temp.uf_policy())$$,
  'P0001','UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID','payload-only fallback projection rejects');
select throws_ok($$select pg_temp.uf_settle(2,pg_temp.uf_policy(),pg_temp.uf_policy()||'{"model":"different"}')$$,
  'P0001','UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID','different response and payload projections reject');
select throws_ok($$select pg_temp.uf_settle(2,pg_temp.uf_policy()||'{"source_manifest":{}}',pg_temp.uf_policy())$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','provider projection cannot hide private source metadata');
select throws_ok($$select pg_temp.uf_settle(3,null,null)$$,
  'P0001','UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID','actual fallback cannot be silently omitted');
select throws_ok(format('select pg_temp.uf_settle(%s)',slot),
  'P0001','UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID',label)
from (values (4,'missing durable result rejects'),(5,'configured fallback with OpenAI execution rejects'),
  (6,'another owner result cannot be borrowed'),(7,'another stage result cannot be borrowed'),
  (8,'another request result cannot be borrowed'),(9,'another checkpoint scope cannot be borrowed'),
  (10,'failed fallback cannot be called complete'),(13,'uncertain fallback cannot be called complete'),
  (14,'a saved result whose validation failed cannot be called successful')) cases(slot,label);
select is((select ingest_status from public.uploads where id=pg_temp.uf_id(slot)),'processing',
  'denied upload '||slot||' remains processing') from (values(2),(3),(4),(5),(6),(7),(8),(9),(10),(13),(14)) slots(slot);

create temporary table uf_completed as
  select slot,pg_temp.uf_try_settle(slot) receipt from (values(1),(2)) slots(slot);
select diag('fallback settlement candidate '||slot||': '||receipt::text) from uf_completed order by slot;
select is((select receipt->>'outcome' from uf_completed where slot=1),'settled','v2 accepts exact durable fallback provenance');
select is((select receipt->>'outcome' from uf_completed where slot=2),'settled','v3 accepts exact durable fallback provenance');
select is(pg_temp.uf_settle(11,null,null)->>'outcome','settled','configured fallback does not change successful OpenAI output');
select is(pg_temp.uf_try_settle(12)->>'outcome','settled','historical v1 successful fallback behavior remains readable');
select is((select status||'/'||ingest_status from public.uploads where id=pg_temp.uf_id(slot)),
  'ready/completed','accepted upload '||slot||' is durably ready') from (values(1),(2),(11),(12)) slots(slot);
select is((select ingest_response->'credit_fallback' from public.uploads where id=pg_temp.uf_id(slot)),
  pg_temp.uf_policy(),'accepted upload '||slot||' stores exact public provenance') from (values(1),(2),(12)) slots(slot);
select is(pg_temp.uf_try_settle(2)->>'outcome','idempotent_replay','exact fallback settlement replays');
select is(pg_temp.uf_replay(2),jsonb_build_object('outcome','completed','http_status',200,
  'response',pg_temp.uf_response(2,pg_temp.uf_policy())),'reload recovers the same completed fallback receipt');
select throws_ok($$select pg_temp.uf_settle(2,null,null)$$,'P0001','UPLOAD_INGEST_SETTLEMENT_CONFLICT',
  'terminal receipt cannot drop its original provider provenance');
reset role;
select is((select count(*)::integer from public.usage_ledger where user_id=pg_temp.uf_owner()
  and checkpoint_scope='ingest-upload' and logical_request_id=pg_temp.uf_id(2)::text
  and logical_stage_key='ingest-upload.classify'),2,'settlement retries create no new provider usage');
select is((select sum(input_tokens+output_tokens)::integer from public.usage_ledger where user_id=pg_temp.uf_owner()
  and checkpoint_scope='ingest-upload' and logical_request_id=pg_temp.uf_id(2)::text),26,
  'true provider usage survives completed upload settlement');
select * from finish();
rollback;
