begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at)
values ('ea700000-0000-4000-8000-000000000001','ollama-fallback@example.test',false,false,now(),now()),
('ea700000-0000-4000-8000-000000000002','ollama-other@example.test',false,false,now(),now());

create temp table fallback_fixture as select
'ea700000-0000-4000-8000-000000000001'::uuid user_id,
jsonb_build_object('provider','ollama','model','gpt-oss:20b','modelDigest',repeat('a',64),'configurationVersion','ollama-test.1') policy,
'{"provider":"openai","semanticRoute":"fast","model":"gpt-5.6-luna","reasoningEffort":"low","routingVersion":"routing.test.1","structuredOutputSchemaVersion":"test.1","allowedTools":[],"timeoutMs":30000,"maxAttempts":2,"background":false,"store":false,"fallback":null}'::jsonb route;
update fallback_fixture set route = route || jsonb_build_object('creditFallback',policy);
select ok(private.valid_ollama_credit_policy((select policy from fallback_fixture)), 'pinned local policy is valid');
select ok(not private.valid_ollama_credit_policy((select policy || '{"extra":true}' from fallback_fixture)), 'unexpected policy fields are rejected');
select ok(not private.valid_ollama_credit_policy((select policy || '{"model":"gpt-oss:20b-cloud"}' from fallback_fixture)), 'cloud model cannot masquerade as local');
select ok(not private.valid_ollama_credit_policy((select policy || '{"modelDigest":"invented"}' from fallback_fixture)), 'invalid digest is rejected');
select ok(not has_function_privilege('authenticated','public.read_legacy_model_call_checkpoint_with_fallback(uuid,text,uuid,text,text,text,integer,uuid,boolean)','EXECUTE'), 'browser cannot allocate fallback attempts');
select ok(not has_function_privilege('anon','public.record_legacy_model_call_attempt_with_provider(uuid,text,text,text,text,integer,text,text,text,text,integer,integer,timestamptz,timestamptz,text,text,text,text,text,uuid,jsonb,uuid,text)','EXECUTE'), 'anonymous cannot write provider provenance');

create temp table primary_admission as select public.read_legacy_model_call_checkpoint_with_fallback(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,null,true) result;
select is((select result->>'fallback_required' from primary_admission),'false','first attempt remains OpenAI');
select public.mark_legacy_model_attempt_dispatched(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),1,
(select (result->>'attempt_admission_id')::uuid from primary_admission),
(select (result->>'execution_claim_token')::uuid from primary_admission),'ea700000-0000-4000-8000-000000000003');
select public.record_legacy_model_call_attempt_with_provider(
(select user_id from fallback_fixture),'ollama-request','upload.classify',repeat('b',64),
(select result->>'attempt_admission_id' from primary_admission),1,'failed','','http_429','OPENAI_CREDIT_EXHAUSTED',0,0,
now(),now(),'gpt-5.6-luna','routing.test.1','fast','low','ingest-upload',null,null,
(select (result->>'execution_claim_token')::uuid from primary_admission),'openai');
select is(public.read_legacy_model_call_checkpoint(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,null,false)->>'state',
 'terminal_error','old OpenAI contract never starts a fallback');
select is(public.read_legacy_model_call_checkpoint_with_fallback(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,null,false)->>'fallback_required',
 'true','reload observes retained credit rejection before new admission');
create temp table fallback_admission as select public.read_legacy_model_call_checkpoint_with_fallback(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,null,true) result;
select is((select result->>'attempt_number' from fallback_admission),'2','fallback uses the second durable attempt');
select is((select result->>'fallback_required' from fallback_admission),'true','admission carries fallback decision');
select is(public.read_legacy_model_call_checkpoint_with_fallback(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,null,true)->>'state',
'in_progress','duplicate request cannot claim the active fallback');
select throws_ok($$select public.record_legacy_model_call_attempt_with_provider(
'ea700000-0000-4000-8000-000000000002','ollama-request','upload.classify',repeat('b',64),'not-admitted',2,'failed','','rejected_before_provider','OLLAMA_UNAVAILABLE',0,0,
now(),now(),'gpt-oss:20b','routing.test.1','fast','low','ingest-upload',null,null,null,'ollama')$$,
'P0001','OLLAMA_DURABLE_CREDIT_REJECTION_REQUIRED','another user cannot borrow the primary credit rejection');
select public.mark_legacy_model_attempt_dispatched(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,
(select (result->>'attempt_admission_id')::uuid from fallback_admission),
(select (result->>'execution_claim_token')::uuid from fallback_admission),'ea700000-0000-4000-8000-000000000004');
create temp table fallback_result as select public.record_legacy_model_call_attempt_with_provider(
(select user_id from fallback_fixture),'ollama-request','upload.classify',repeat('b',64),
(select result->>'attempt_admission_id' from fallback_admission),2,'succeeded','ollama:synthetic-receipt','completed',null,17,9,
now(),now(),'gpt-oss:20b','routing.test.1','fast','low','ingest-upload',null,
jsonb_build_object('version','legacy-provider-result.1','text','{"decision":"approve"}','structured','{"decision":"approve"}'::jsonb,'sources','[]'::jsonb,'route_snapshot',(select route from fallback_fixture)),
(select (result->>'execution_claim_token')::uuid from fallback_admission),'ollama') result;
create temp table replay as select public.read_legacy_model_call_checkpoint_with_fallback(
(select user_id from fallback_fixture),'ingest-upload',null,'ollama-request','upload.classify',repeat('b',64),2,null,false) result;
select is((select result->>'state' from replay),'replay','saved fallback result is replayable');
select is((select result #>> '{usage,provider}' from replay),'ollama','replay retains actual provider');
select is((select result #>> '{usage,model}' from replay),'gpt-oss:20b','replay retains actual model');
select is((select result #>> '{usage,input_tokens}' from replay),'17','replay retains actual input usage');
select is((select result #>> '{usage,output_tokens}' from replay),'9','replay retains actual output usage');
select is((select result #> '{response_envelope,route_snapshot,creditFallback}' from replay),(select policy from fallback_fixture),'saved result retains pinned policy');
select is((select count(*)::integer from public.usage_ledger where user_id=(select user_id from fallback_fixture) and logical_request_id='ollama-request'),2,'primary and fallback remain two distinct usage records');
select throws_ok($$select public.read_legacy_model_call_checkpoint_with_fallback(
'ea700000-0000-4000-8000-000000000001','ingest-upload',null,'ollama-request','upload.classify',repeat('c',64),2,null,false)$$,
'P0001','LEGACY_MODEL_CHECKPOINT_REQUEST_CONFLICT','changed input cannot replay earlier fallback');
select is(private.legacy_allowance_execution_provider(
(select user_id from fallback_fixture),'ingest-upload','ollama-request','openai'),
'ollama','allowance attribution excludes the zero-token primary credit rejection');
select is(private.legacy_allowance_execution_provider(
'ea700000-0000-4000-8000-000000000002','ingest-upload','ollama-request','openai'),
'openai','allowance attribution cannot borrow another user local execution');
select * from finish();
rollback;
