begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.wr_id(slot integer) returns uuid language sql as $$
  select ('96071240-0000-4000-8000-'||lpad(slot::text,12,'0'))::uuid $$;
create function pg_temp.wr_owner() returns uuid language sql as $$ select pg_temp.wr_id(1) $$;
create function pg_temp.wr_detail(slot integer) returns jsonb language sql security invoker as $$
  select public.get_own_workspace_upload_v1(pg_temp.wr_id(slot))->'source' $$;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  (pg_temp.wr_owner(),'workspace-read-a@example.invalid',false,false,now(),now()),
  (pg_temp.wr_id(2),'workspace-read-b@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (pg_temp.wr_owner(),pg_temp.wr_id(2))),2,
  'both owner fixtures exist before isolation checks');

insert into public.uploads(id,user_id,storage_path,file_name,file_type,file_size_bytes,extracted_text,extracted_payload,status,created_at)
select pg_temp.wr_id(n),pg_temp.wr_owner(),pg_temp.wr_owner()::text||'/historical/source-'||n||'.pdf',
  'Source '||n||'.pdf','application/pdf',12,
  case when n=10 then E'  Historical preview\n' when n=11 then repeat('😀',20001) else null end,
  case when n=12 then '{"original_retained":true}'::jsonb else null end,
  case when n=10 then 'failed' else 'processing' end,'2026-09-07T01:02:03.123456Z'::timestamptz
from generate_series(10,33) n;
insert into public.uploads(id,user_id,storage_path,file_name,file_type,file_size_bytes,extracted_text)
values (pg_temp.wr_id(50),pg_temp.wr_id(2),pg_temp.wr_id(2)::text||'/original/other.md','Other.md','text/markdown',12,'Other owner secret');
-- These are catalog fixtures, not actual Storage bytes or a download claim.
insert into storage.objects(bucket_id,name,metadata)
select 'original-documents',storage_path,jsonb_build_object('size',12)
from public.uploads where id in(pg_temp.wr_id(10),pg_temp.wr_id(11),pg_temp.wr_id(13),pg_temp.wr_id(14),pg_temp.wr_id(15),pg_temp.wr_id(50));
update storage.objects set metadata='{"size":"malformed"}'::jsonb where name like '%/source-13.pdf';
update storage.objects set metadata='{"size":13}'::jsonb where name like '%/source-14.pdf';
update storage.objects set metadata='{}'::jsonb where name like '%/source-15.pdf';
update public.uploads set storage_path=pg_temp.wr_id(2)::text||'/original/other.md' where id=pg_temp.wr_id(16);
update public.uploads set status='ready',extracted_text='Historical reviewed wording' where id=pg_temp.wr_id(17);
update public.uploads set ingest_extraction_format='pdf',ingest_extraction_truncated=false,
  ingest_extraction_policy_version='upload-resource-policy.1',ingest_extraction_recorded_at=now() where id=pg_temp.wr_id(18);
select is((select count(*)::integer from public.uploads where user_id in(pg_temp.wr_owner(),pg_temp.wr_id(2))),25,
  '25 readable positive fixtures exist');
select is((select count(*)::integer from storage.objects where bucket_id='original-documents'
  and split_part(name,'/',1) in(pg_temp.wr_owner()::text,pg_temp.wr_id(2)::text)),6,'six exact Storage catalog fixtures exist');

set local role service_role;
create temporary table wr_claims(slot integer,receipt jsonb,version text);
insert into wr_claims
select n,public.claim_upload_ingest(pg_temp.wr_id(n),pg_temp.wr_owner(),pg_temp.wr_owner()::text||'/'||pg_temp.wr_id(n)::text||'/source.txt',
  'text/plain','source.txt',12,repeat('a',64),repeat('b',64),'upload-extraction.'||(n-59)), 'upload-extraction.'||(n-59)
from generate_series(60,62) n;
select is(receipt->>'outcome','accepted','modern source '||slot||' is positively admitted') from wr_claims order by slot;
select is(public.advance_upload_ingest(pg_temp.wr_id(slot),pg_temp.wr_owner(),repeat('a',64),(receipt->>'claim_token')::uuid,
  'prepared','storage_dispatched')->>'outcome','advanced','modern source starts retention '||slot) from wr_claims order by slot;
select is(public.advance_upload_ingest(pg_temp.wr_id(slot),pg_temp.wr_owner(),repeat('a',64),(receipt->>'claim_token')::uuid,
  'storage_dispatched','storage_completed')->>'outcome','advanced','modern source records retention '||slot) from wr_claims order by slot;
select is(public.record_upload_extraction_snapshot(pg_temp.wr_id(slot),pg_temp.wr_owner(),repeat('a',64),(receipt->>'claim_token')::uuid,
  repeat('b',64),encode(extensions.digest(convert_to('Checkpoint 😀','UTF8'),'sha256'),'hex'),'Checkpoint 😀','text',false,
  case when version='upload-extraction.3' then 'upload-resource-policy.2' else 'upload-resource-policy.1' end,version,null)->>'outcome',
  'recorded','modern extraction is positively checkpointed '||slot) from wr_claims order by slot;
reset role;
update public.uploads set ingest_heartbeat_at=now()-interval '3 minutes',ingest_lease_expires_at=now()-interval '1 minute'
  where id in(pg_temp.wr_id(60),pg_temp.wr_id(61),pg_temp.wr_id(62));
select is((select count(*)::integer from public.uploads where id in(pg_temp.wr_id(60),pg_temp.wr_id(61),pg_temp.wr_id(62))
  and ingest_lease_expires_at<now()),3,'all modern checkpoint leases are expired before owner reads');
insert into storage.objects(bucket_id,name,metadata)
select 'original-documents',storage_path,'{"size":12}'::jsonb from public.uploads where id in(pg_temp.wr_id(60),pg_temp.wr_id(61),pg_temp.wr_id(62));

select ok(not has_function_privilege('anon','public.get_own_workspace_upload_v1(uuid)','EXECUTE'),'anonymous detail denied');
select ok(not has_function_privilege('anon','public.list_own_workspace_uploads_v1(timestamptz,uuid)','EXECUTE'),'anonymous list denied');
select ok(not has_function_privilege('authenticated','private.workspace_upload_summary(public.uploads)','EXECUTE'),'private projector is not a browser RPC');
select ok(not has_table_privilege('authenticated','public.uploads','SELECT'),'no new blanket table read grant');
select ok(not has_column_privilege('authenticated','public.uploads','ingest_source_manifest','SELECT'),'manifest remains private');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
  where oid in('public.get_own_workspace_upload_v1(uuid)'::regprocedure,'public.list_own_workspace_uploads_v1(timestamptz,uuid)'::regprocedure)),
  'owner read RPCs use fixed empty search paths');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.wr_owner()::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.wr_owner(),'role','authenticated')::text,true);
select is(pg_temp.wr_detail(10)->>'file_name','Source 10.pdf','owner can positively read historical upload');
select is(pg_temp.wr_detail(10)->'preview'->>'text',E'  Historical preview\n','historical whitespace is preserved');
select is(pg_temp.wr_detail(10)->'preview'->'truncated','null'::jsonb,'historical completeness remains unknown');
select is(pg_temp.wr_detail(10)->>'status','failed','old failed status is retained');
select is(pg_temp.wr_detail(10)->>'ingest_status','legacy','missing ingest history is labelled legacy');
select ok(pg_temp.wr_detail(10)->'original' <> 'null'::jsonb,'failed extraction does not hide its stored original');
select is(pg_temp.wr_detail(10)->'original'->'sha256','null'::jsonb,'historical content digest is not fabricated');
select is(char_length(pg_temp.wr_detail(11)->'preview'->>'text'),20000,'reader bounds Unicode code points without splitting astral characters');
select is(pg_temp.wr_detail(11)->'preview'->'truncated','true'::jsonb,'reader clipping marks preview incomplete');
select is(pg_temp.wr_detail(12)->'original','null'::jsonb,'old retained receipt cannot override a missing Storage object');
select is(pg_temp.wr_detail(13)->'original','null'::jsonb,'malformed object size blocks original availability');
select is(pg_temp.wr_detail(14)->'original','null'::jsonb,'contradictory object size blocks original availability');
select ok(pg_temp.wr_detail(15)->'original' <> 'null'::jsonb,'legacy object with unknown size remains available without byte attestation');
select is(pg_temp.wr_detail(16)->'original','null'::jsonb,'cross-owner path cannot become original availability');
select is(pg_temp.wr_detail(18)->'format','null'::jsonb,'partial historical checkpoint does not establish an extracted format');
select is(public.commit_document_import(pg_temp.wr_id(17),pg_temp.wr_id(70),pg_temp.wr_id(71),'Reviewed copy','Synthetic source context',
  '{"primary":{"template_id":"imported_document"}}'::jsonb,
  jsonb_build_array(jsonb_build_object('id',pg_temp.wr_id(72),'name','Document','order_index',0,'content','Historical reviewed wording',
    'status','draft','version_history','[]'::jsonb,'is_required',true)))->>'status','committed','historical imported document is positively committed');
select is(pg_temp.wr_detail(17)->'imported_document',jsonb_build_object('document_id',pg_temp.wr_id(71),'outcome_id',pg_temp.wr_id(70)),
  'owned committed import has its exact saved destination');
reset role;
insert into public.outcomes(id,user_id,situation_text,status) values(pg_temp.wr_id(73),pg_temp.wr_owner(),'Different outcome','in_progress');
update public.uploads set outcome_id=pg_temp.wr_id(73) where id=pg_temp.wr_id(17);
set local role authenticated;
select is(pg_temp.wr_detail(17)->'imported_document','null'::jsonb,'mismatched outcome linkage cannot invent a canonical document destination');
select is(pg_temp.wr_detail(50),'null'::jsonb,'other owner detail is not disclosed');
select is(pg_temp.wr_detail(99),'null'::jsonb,'absent detail has the same response as unowned detail');
select is(pg_temp.wr_detail(n)->'preview'->>'text','Checkpoint 😀','accepted v'||(n-59)||' checkpoint is readable without a lease') from generate_series(60,62) n;
select is(pg_temp.wr_detail(n)->>'format','text','accepted format is preserved for v'||(n-59)) from generate_series(60,62) n;
select is(pg_temp.wr_detail(n)->>'ingest_status','processing','read does not advance classification v'||(n-59)) from generate_series(60,62) n;
select is(pg_temp.wr_detail(n)->'original'->>'sha256',repeat('b',64),'expected accepted digest is preserved v'||(n-59)) from generate_series(60,62) n;
select ok(not exists(select 1 from jsonb_object_keys(pg_temp.wr_detail(62)) k where k like '%manifest%' or k like '%token%' or k like '%response%'),
  'private workflow fields are absent from detail');
create temporary table wr_pages(page integer primary key, payload jsonb);
insert into wr_pages values(1,public.list_own_workspace_uploads_v1());
insert into wr_pages select 2,public.list_own_workspace_uploads_v1((payload->'next_cursor'->>'created_at')::timestamptz,
  (payload->'next_cursor'->>'upload_id')::uuid) from wr_pages where page=1;
select is((select jsonb_array_length(payload->'items') from wr_pages where page=1),20,'first page has bounded 20 items');
select is((select jsonb_array_length(payload->'items') from wr_pages where page=2),7,'second page contains exactly remaining seven owned items');
select is((select payload->'next_cursor' from wr_pages where page=2),'null'::jsonb,'last page terminates');
select is((select count(distinct row->>'upload_id')::integer from wr_pages,jsonb_array_elements(payload->'items') row),27,
  'equal timestamps page without duplicate or lost identities');
select is((select payload->'next_cursor'->>'created_at' from wr_pages where page=1),'2026-09-07T01:02:03.123456+00:00','cursor retains microseconds');
select ok(not exists(select 1 from wr_pages,jsonb_array_elements(payload->'items') row where row ? 'preview'),'list does not carry text bodies');
select throws_ok($$select public.list_own_workspace_uploads_v1(now(),null)$$,'22023','UPLOAD_CURSOR_INVALID','half cursor rejected');
select throws_ok($$select public.list_own_workspace_uploads_v1('infinity',pg_temp.wr_id(10))$$,'22023','UPLOAD_CURSOR_INVALID','infinite cursor rejected');
select throws_ok($$select public.get_own_workspace_upload_v1(null)$$,'22023','UPLOAD_ID_REQUIRED','null detail identity rejected');
select set_config('request.jwt.claim.sub',pg_temp.wr_id(2)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.wr_id(2),'role','authenticated')::text,true);
select is(pg_temp.wr_detail(50)->>'file_name','Other.md','second owner has a positive detail before denial');
select is(jsonb_array_length(public.list_own_workspace_uploads_v1()->'items'),1,'second owner list contains only its own upload');
select is(pg_temp.wr_detail(10),'null'::jsonb,'second owner cannot read first owner source');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.list_own_workspace_uploads_v1()$$,'28000','UNAUTHENTICATED','empty session cannot list');
reset role;
select * from finish();
rollback;
