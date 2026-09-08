begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Exact synthetic AppKit-produced RTF from format-preservation/rtf-appkit-original.rtf.
-- This proves database admission/identity/privacy only, not Storage or layout editing.
create function pg_temp.rtf_bytes() returns bytea language sql as $function$
  select decode('e1xydGYxXGFuc2lcYW5zaWNwZzEyNTJcY29jb2FydGYyODcwClxjb2NvYXRleHRzY2FsaW5nMFxjb2NvYXBsYXRmb3JtMHtcZm9udHRibFxmMFxmc3dpc3NcZmNoYXJzZXQwIEhlbHZldGljYS1MaWdodDt9CntcY29sb3J0Ymw7XHJlZDI1NVxncmVlbjI1NVxibHVlMjU1O30Ke1wqXGV4cGFuZGVkY29sb3J0Ymw7O30KXHBhcmRcdHg1NjBcdHgxMTIwXHR4MTY4MFx0eDIyNDBcdHgyODAwXHR4MzM2MFx0eDM5MjBcdHg0NDgwXHR4NTA0MFx0eDU2MDBcdHg2MTYwXHR4NjcyMFxwYXJkaXJuYXR1cmFsXHBhcnRpZ2h0ZW5mYWN0b3IwCgpcZjBcZnMyNCBcY2YwIFNvdXJjZS1wcmVzZXJ2YXRpb24gZml4dHVyZVwKUmVuXCdlOWUgXCc5NyBcdWMwXHUyNjA4NSBcdTI2NDEyIFx1MzU0ODYgIFx1NTUzNTcgXHU1NjgzMiBcCktlZXAgZWFjaCBwYXJhZ3JhcGggYW5kIHRoZXNlIGV4YWN0IHdvcmRzLn0=', 'base64')
$function$;
create function pg_temp.rtf_text() returns text language sql as $function$
  select E'Source-preservation fixture\nRenée — 日本語 😀\nKeep each paragraph and these exact words.'
$function$;
create function pg_temp.rtf_manifest() returns jsonb language sql as $function$
  select '{"version":"rtf-source-manifest.1","assessment":"source_only",
    "originalSha256":"c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84",
    "originalByteLength":449,
    "extractedTextSha256":"8f4a2ccc7caabefe92a6b7a07e63babde18f86e54e8815d506efa195d39ad3ea",
    "blockers":["rtf-format-preserving-editing-unverified"]}'::jsonb
$function$;
create function pg_temp.upload_id(p_slot integer) returns uuid language sql as $function$
  select ('72007080-0000-4000-8000-' || lpad(p_slot::text,12,'0'))::uuid
$function$;

-- Capture failures as visible test data so an absent admission version does not
-- abort the transaction and hide the independent privacy regressions below.
create function pg_temp.try_claim(p_slot integer, p_version text default null)
returns jsonb language plpgsql as $function$
begin
  if p_version is null then
    return public.claim_upload_ingest(pg_temp.upload_id(p_slot),
      '71007080-0000-4000-8000-000000000001',
      '71007080-0000-4000-8000-000000000001/'||pg_temp.upload_id(p_slot)::text||'/source.txt',
      'text/plain', 'source.txt', 449, repeat('a',64), pg_temp.rtf_manifest()->>'originalSha256');
  end if;
  return public.claim_upload_ingest(pg_temp.upload_id(p_slot),
    '71007080-0000-4000-8000-000000000001',
    '71007080-0000-4000-8000-000000000001/'||pg_temp.upload_id(p_slot)::text||'/source.rtf',
    'application/rtf', 'source.rtf', 449, repeat('a',64),
    pg_temp.rtf_manifest()->>'originalSha256', p_version);
exception when others then
  return jsonb_build_object('error_code', sqlstate, 'error_message', sqlerrm);
end;
$function$;

select is(octet_length(pg_temp.rtf_bytes()), 449, 'RTF fixture has the inspected original byte length');
select is(encode(extensions.digest(pg_temp.rtf_bytes(),'sha256'),'hex'),
  pg_temp.rtf_manifest()->>'originalSha256', 'RTF fixture original digest matches the actual bytes');
select is(encode(extensions.digest(convert_to(pg_temp.rtf_text(),'UTF8'),'sha256'),'hex'),
  pg_temp.rtf_manifest()->>'extractedTextSha256', 'RTF preview digest matches exact inspected wording');

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  ('71007080-0000-4000-8000-000000000001','rtf-source-owner@example.invalid',false,false,now(),now()),
  ('71007080-0000-4000-8000-000000000002','rtf-source-other@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (
  '71007080-0000-4000-8000-000000000001','71007080-0000-4000-8000-000000000002')),
  2,'both authenticated owner fixtures are positively created');

set local role service_role;
create temporary table claim_receipts(slot integer primary key, receipt jsonb not null);
insert into claim_receipts values (1,pg_temp.try_claim(1)),
  (2,pg_temp.try_claim(2,'upload-extraction.2')),
  (3,pg_temp.try_claim(3,'upload-extraction.3'));
select is((select receipt->>'outcome' from claim_receipts where slot=1),
  'accepted','old eight-argument claim still accepts');
select ok(not (select receipt ? 'extraction_contract_version' from claim_receipts where slot=1),
  'old claim receipt still omits its default version');
select is((select ingest_extraction_contract_version from public.uploads where id=pg_temp.upload_id(1)),
  'upload-extraction.1','old claim keeps its existing stored default');
select is((select receipt->>'outcome' from claim_receipts where slot=2),
  'accepted','explicit v2 claim still accepts');
select is((select receipt->>'extraction_contract_version' from claim_receipts where slot=2),
  'upload-extraction.2','explicit v2 receipt is literal');
select diag('v3 admission fixture: '||(select receipt::text from claim_receipts where slot=3));
select is((select receipt->>'outcome' from claim_receipts where slot=3),
  'accepted','explicit v3 RTF claim is admitted');
select is((select receipt->>'extraction_contract_version' from claim_receipts where slot=3),
  'upload-extraction.3','v3 admission receipt reports the stored version');
select is((select ingest_extraction_contract_version from public.uploads where id=pg_temp.upload_id(3)),
  'upload-extraction.3','v3 admission is independently visible in the authoritative upload row');
reset role;

select has_function('private','normalize_upload_rtf_source_manifest',array['jsonb','text','integer','text'],
  'RTF manifest validation binds original identity and exact preview text in SQL');
select ok(not private.upload_public_result_is_source_free(jsonb_build_object('error',
  jsonb_build_object('context',jsonb_build_array(pg_temp.rtf_manifest()))),0),
  'raw RTF manifest cannot leak through nested failure metadata');
select ok(not private.upload_public_result_is_source_free(jsonb_build_object('details',
  jsonb_build_object('originalSha256',repeat('a',64))),0), 'private RTF original digest cannot leak alone');
select ok(not private.upload_public_result_is_source_free(jsonb_build_object('details',
  jsonb_build_object('originalByteLength',449)),0), 'private RTF original size cannot leak alone');
select ok(not private.upload_public_result_is_source_free(jsonb_build_object('details',
  jsonb_build_object('extractedTextSha256',repeat('b',64))),0), 'private RTF wording digest cannot leak alone');
select ok(private.upload_public_result_is_source_free('{"error":{"code":"READING_FAILED"},"retryable":true}',0),
  'ordinary source-free failure remains permitted');

create function pg_temp.sha(p_text text) returns text language sql as $function$
  select encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex')
$function$;
create function pg_temp.manifest_for_text(p_text text) returns jsonb language sql as $function$
  select jsonb_set(pg_temp.rtf_manifest(),'{extractedTextSha256}',to_jsonb(pg_temp.sha(p_text)))
$function$;
create function pg_temp.normalize_rtf(p_manifest jsonb, p_text text default pg_temp.rtf_text())
returns jsonb language sql as $function$
  select private.normalize_upload_rtf_source_manifest(p_manifest,
    pg_temp.rtf_manifest()->>'originalSha256',449,p_text)
$function$;
create function pg_temp.token(p_slot integer) returns uuid language sql as $function$
  select ingest_claim_token from public.uploads where id=pg_temp.upload_id(p_slot)
$function$;
create function pg_temp.advance(p_slot integer,p_expected text,p_next text) returns jsonb language sql as $function$
  select public.advance_upload_ingest(pg_temp.upload_id(p_slot),'71007080-0000-4000-8000-000000000001',
    repeat('a',64),pg_temp.token(p_slot),p_expected,p_next)
$function$;
create function pg_temp.checkpoint(p_slot integer) returns jsonb language sql as $function$
  select public.get_upload_extraction_checkpoint(pg_temp.upload_id(p_slot),
    '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(p_slot))
$function$;
create function pg_temp.record(p_slot integer,p_manifest jsonb default pg_temp.rtf_manifest(),
  p_format text default 'rtf',p_policy text default 'upload-resource-policy.2',
  p_version text default 'upload-extraction.3',p_text text default pg_temp.rtf_text(),p_truncated boolean default false)
returns jsonb language sql as $function$
  select public.record_upload_extraction_snapshot(pg_temp.upload_id(p_slot),
    '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(p_slot),
    pg_temp.rtf_manifest()->>'originalSha256',pg_temp.sha(p_text),p_text,
    p_format,p_truncated,p_policy,p_version,p_manifest)
$function$;
create function pg_temp.completed_response(p_slot integer) returns jsonb language sql as $function$
  select jsonb_build_object('upload_id',pg_temp.upload_id(p_slot),'storage_path',
    '71007080-0000-4000-8000-000000000001/'||pg_temp.upload_id(p_slot)::text||'/source.rtf',
    'extracted_text',pg_temp.rtf_text(),'original_retained',true,'classification_status','completed',
    'extraction_format','rtf','resource_policy_version','upload-resource-policy.2',
    'confirm_payload',jsonb_build_object('summary','Synthetic retained wording','document_type','document',
      'filename','source.rtf','char_count',85,'truncated',false,
      'structure','[{"title":"Document","items":["Synthetic retained wording"]}]'::jsonb))
$function$;
create function pg_temp.completed_payload() returns jsonb language sql as $function$
  select '{"truncated":false,"original_retained":true,"classification_status":"completed",
    "extraction_format":"rtf","resource_policy_version":"upload-resource-policy.2"}'::jsonb
$function$;
create function pg_temp.complete(p_slot integer,p_response jsonb,p_payload jsonb default pg_temp.completed_payload())
returns jsonb language sql as $function$
  select public.settle_upload_ingest(pg_temp.upload_id(p_slot),'71007080-0000-4000-8000-000000000001',
    repeat('a',64),'completed',200,p_response,pg_temp.rtf_text(),p_payload,null,pg_temp.token(p_slot))
$function$;

select is(pg_temp.normalize_rtf(pg_temp.rtf_manifest()),pg_temp.rtf_manifest(),
  'inspected RTF manifest normalizes exactly');
select is(private.upload_source_manifest_digest(pg_temp.normalize_rtf(
  jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','449.00'))),
  private.upload_source_manifest_digest(pg_temp.rtf_manifest()),'integral numeric spelling has one database digest');
select is(private.upload_source_manifest_digest(pg_temp.rtf_manifest()),
  pg_temp.sha('upload-source-manifest-jsonb.1'||E'\n'||pg_temp.rtf_manifest()::text),
  'RTF uses the existing explicit database digest domain');
select throws_ok(format('select pg_temp.normalize_rtf(%L::jsonb)',candidate),
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID',description)
from (values
  (null::jsonb,'SQL null manifest rejects'),('null'::jsonb,'JSON null manifest rejects'),
  ('[]'::jsonb,'array manifest rejects'),('{}'::jsonb,'missing manifest fields reject'),
  (pg_temp.rtf_manifest()||'{"extra":true}','extra manifest field rejects'),
  (pg_temp.rtf_manifest()-'blockers','missing blocker field rejects'),
  (jsonb_set(pg_temp.rtf_manifest(),'{version}','"rtf-source-manifest.2"'),'unknown source version rejects'),
  (jsonb_set(pg_temp.rtf_manifest(),'{assessment}','"editable"'),'source-only cannot become edit approval'),
  (jsonb_set(pg_temp.rtf_manifest(),'{originalSha256}',to_jsonb(repeat('f',64))),'wrong original digest rejects'),
  (jsonb_set(pg_temp.rtf_manifest(),'{extractedTextSha256}',to_jsonb(repeat('f',64))),'wrong exact wording digest rejects'),
  (jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','"449"'),'string length is not coerced'),
  (jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','449.1'),'fractional length rejects'),
  (jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','448'),'wrong accepted length rejects'),
  (jsonb_set(pg_temp.rtf_manifest(),'{blockers}','[]'),'editing blocker cannot disappear'),
  (jsonb_set(pg_temp.rtf_manifest(),'{blockers}','["other"]'),'editing blocker cannot be replaced'),
  (jsonb_set(pg_temp.rtf_manifest(),'{blockers}','["rtf-format-preserving-editing-unverified","extra"]'),'extra blocker rejects')
) variants(candidate,description);
select throws_ok(format('select pg_temp.normalize_rtf(pg_temp.manifest_for_text(%L),%L)',wording,wording),
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF rejects forbidden scalar '||label)
from (values (E'A\rB','CR'),('A'||chr(127)||'B','DEL'),('A'||chr(133)||'B','C1'),
  ('A'||chr(65534)||'B','FFFE'),('A'||chr(65535)||'B','FFFF')) cases(wording,label);
select lives_ok($$select pg_temp.normalize_rtf(pg_temp.manifest_for_text(E'A\tB\nRenée 日本語 😀'),
  E'A\tB\nRenée 日本語 😀')$$,'permitted tab/LF and multilingual scalars pass');
select lives_ok($$select pg_temp.normalize_rtf(pg_temp.manifest_for_text(repeat('😀',10000)),repeat('😀',10000))$$,
  'exactly 20000 UTF-16 units are accepted');
select throws_ok($$select pg_temp.normalize_rtf(pg_temp.manifest_for_text(repeat('😀',10000)||'A'),repeat('😀',10000)||'A')$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','20001 UTF-16 units reject despite fewer PostgreSQL characters');
select lives_ok($$select private.normalize_upload_rtf_source_manifest(
  jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','1048576'),
  pg_temp.rtf_manifest()->>'originalSha256',1048576,pg_temp.rtf_text())$$,
  'RTF accepts the exact one-MiB boundary with matching accepted manifest length');
select throws_ok($$select private.normalize_upload_rtf_source_manifest(
  jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','1048577'),
  pg_temp.rtf_manifest()->>'originalSha256',1048577,pg_temp.rtf_text())$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF original size cannot use the generic eight-MiB allowance');
select throws_ok($$select pg_temp.normalize_rtf(pg_temp.rtf_manifest(),pg_temp.rtf_text()||' ')$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','exact wording is not silently trimmed before hashing');
select is(private.upload_source_metadata_v3(U&'\FEFFSOURCE.\FF32\FF34\FF26\00A0'),
  'source.rtf','metadata uses NFKC, supported case and browser whitespace rules');

select ok(not has_function_privilege('authenticated',
  'private.normalize_upload_rtf_source_manifest(jsonb,text,integer,text)','EXECUTE')
  and not has_function_privilege('anon',
  'private.normalize_upload_rtf_source_manifest(jsonb,text,integer,text)','EXECUTE')
  and not has_function_privilege('service_role',
  'private.normalize_upload_rtf_source_manifest(jsonb,text,integer,text)','EXECUTE'),
  'RTF helper stays private to fixed-path commands');
select ok(not exists(select 1 from pg_attribute a where a.attrelid='public.uploads'::regclass
  and a.attname in ('ingest_source_manifest','ingest_source_manifest_sha256','ingest_source_digest_version')
  and (has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT')
    or has_column_privilege('anon',a.attrelid,a.attnum,'SELECT'))),'source fields are not exposed to browser roles');

set local role service_role;
select is(pg_temp.advance(3,'prepared','storage_dispatched')->>'outcome','advanced','v3 storage dispatch is acknowledged');
select is(pg_temp.advance(3,'storage_dispatched','storage_completed')->>'outcome','advanced','v3 original retention is acknowledged');
select is(pg_temp.checkpoint(3),null::jsonb,'missing checkpoint stays explicitly absent');
select is(public.load_upload_extraction_snapshot(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(3))->>'extraction_contract_version',
  'upload-extraction.3','extractor snapshot uses the accepted v3 version');
select is((select count(*)::integer from jsonb_object_keys(public.load_upload_extraction_snapshot(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(3)))),11,'extractor snapshot remains closed');
select throws_ok($$select pg_temp.advance(3,'storage_completed','provider_dispatched')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','v3 cannot dispatch classification without its checkpoint');
select is(public.begin_upload_extraction_attempt(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(3))->>'total_attempts','1','first v3 extraction attempt is durable');
select is(public.begin_upload_extraction_attempt(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(3))->>'total_attempts','2','second bounded attempt is durable');
select throws_ok($$select public.begin_upload_extraction_attempt(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(3))$$,
  'P0001','UPLOAD_EXTRACTION_ATTEMPT_LIMIT','third attempt under the same claim rejects');
select throws_ok($$select pg_temp.record(3,null)$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF checkpoint requires its manifest');
select throws_ok($$select pg_temp.record(3,'null')$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF JSON null is not a manifest');
select throws_ok($$select pg_temp.record(3,null,'text')$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','accepted RTF cannot downgrade to source-absent text');
select throws_ok($$select pg_temp.record(3,pg_temp.rtf_manifest(),'rtf','upload-resource-policy.1')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_INVALID','v3 cannot use old resource policy');
select throws_ok($$select pg_temp.record(3,pg_temp.rtf_manifest(),'rtf','upload-resource-policy.2','upload-extraction.2')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','record version must match accepted claim');
select is(pg_temp.checkpoint(3),null::jsonb,'rejected candidates do not partially record a checkpoint');
select is(pg_temp.record(3)->>'outcome','recorded','v3 text and private source record atomically');
select is(pg_temp.checkpoint(3)->'source_manifest',pg_temp.rtf_manifest(),'authoritative read returns exact private RTF manifest');
select is(pg_temp.checkpoint(3)->>'text',pg_temp.rtf_text(),'authoritative text exactly matches the manifest-bound preview');
select is((select count(*)::integer from jsonb_object_keys(pg_temp.checkpoint(3))),11,'v3 checkpoint has the existing eleven-field envelope');
select is(pg_temp.checkpoint(3)->>'source_digest_version','upload-source-manifest-jsonb.1','checkpoint reports the existing database digest domain');
select is(pg_temp.record(3,jsonb_set(pg_temp.rtf_manifest(),'{originalByteLength}','449.00'))->>'outcome',
  'idempotent_replay','equivalent numeric spelling replays one immutable checkpoint');
select throws_ok($$select pg_temp.record(3,'{}')$$,'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','replacement keeps conflict precedence over payload validation');
select throws_ok($$select pg_temp.record(3,pg_temp.rtf_manifest(),'rtf','upload-resource-policy.2','upload-extraction.3',pg_temp.rtf_text(),true)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','changed truncation cannot rewrite an accepted checkpoint');
select is(public.begin_upload_extraction_attempt(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(3))->>'outcome','checkpoint_exists',
  'checkpoint reuse avoids another extraction attempt');
select is((select ingest_extraction_attempt_count from public.uploads where id=pg_temp.upload_id(3)),2,'checkpoint reuse retains the exact attempt count');
select is(public.get_upload_extraction_checkpoint(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000002',repeat('a',64),pg_temp.token(3)),null::jsonb,'other positively created owner cannot read source');
select is(public.get_upload_extraction_checkpoint(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('b',64),pg_temp.token(3)),null::jsonb,'wrong request cannot read source');
select is(public.get_upload_extraction_checkpoint(pg_temp.upload_id(3),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),'73007080-0000-4000-8000-000000000099'),null::jsonb,'stale claim cannot read source');
reset role;
select is((select ingest_source_manifest_sha256 from public.uploads where id=pg_temp.upload_id(3)),
  private.upload_source_manifest_digest(pg_temp.rtf_manifest()),'independent row read proves server-computed source digest');
select throws_ok($$update public.uploads set ingest_extraction_text='Changed' where id=pg_temp.upload_id(3)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','direct update cannot alter accepted wording');
select throws_ok($$update public.uploads set ingest_source_manifest=null where id=pg_temp.upload_id(3)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','direct update cannot strip accepted source');
select throws_ok($$update public.uploads set ingest_extraction_contract_version='upload-extraction.2' where id=pg_temp.upload_id(3)$$,
  'P0001','UPLOAD_EXTRACTION_CONTRACT_IMMUTABLE','direct update cannot relabel accepted version');
set local role service_role;
select is(pg_temp.advance(3,'storage_completed','provider_dispatched')->>'outcome','advanced','durable v3 checkpoint permits classifier dispatch');
select is(pg_temp.advance(3,'storage_completed','provider_dispatched')->>'outcome','idempotent_replay','live exact provider-stage replay is idempotent');
select throws_ok($$select pg_temp.complete(3,jsonb_set(pg_temp.completed_response(3),'{confirm_payload,char_count}','84'))$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','import preview count uses UTF-16 units including emoji');
select throws_ok($$select pg_temp.complete(3,jsonb_set(pg_temp.completed_response(3),'{storage_path}','"other/path"'))$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','completed result must name the retained original');
select throws_ok($$select pg_temp.complete(3,pg_temp.completed_response(3)||jsonb_build_object('metadata',pg_temp.rtf_manifest()))$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','completed receipt cannot expose private RTF metadata');
reset role;
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '121 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.upload_id(3);
set local role service_role;
select throws_ok($$select pg_temp.advance(3,'storage_completed','provider_dispatched')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','expired provider-stage replay cannot bypass the v3 lease fence');
select is(pg_temp.complete(3,pg_temp.completed_response(3))->>'outcome','settled',
  'same-token late acknowledgement can settle exact completed wording after lease expiry');
select is(pg_temp.complete(3,pg_temp.completed_response(3))->>'outcome','idempotent_replay','lost terminal acknowledgement replays the same result');
select throws_ok($$select pg_temp.complete(3,jsonb_set(pg_temp.completed_response(3),'{confirm_payload,summary}','"Changed"'))$$,
  'P0001','UPLOAD_INGEST_SETTLEMENT_CONFLICT','terminal receipt cannot be changed');
select is(pg_temp.checkpoint(3),null::jsonb,'terminal checkpoint is no longer an active private processing read');
select is(pg_temp.try_claim(3,'upload-extraction.1')->'response',pg_temp.completed_response(3),
  'old caller replays the exact terminal v3 response without relabelling it');
select is((select status||'/'||ingest_status from public.uploads where id=pg_temp.upload_id(3)),
  'ready/completed','independent final row read proves usable persisted state');
reset role;

set local role service_role;
select is(pg_temp.try_claim(4,'upload-extraction.3')->>'outcome','accepted','recovery fixture is positively admitted');
select is(pg_temp.advance(4,'prepared','storage_dispatched')->>'outcome','advanced','recovery storage dispatch is acknowledged');
select is(pg_temp.advance(4,'storage_dispatched','storage_completed')->>'outcome','advanced','recovery original is retained');
select is(pg_temp.record(4)->>'outcome','recorded','recovery starts with a durable source checkpoint');
reset role;
create temp table old_rtf_claim as select ingest_claim_token,ingest_source_manifest,ingest_source_manifest_sha256
  from public.uploads where id=pg_temp.upload_id(4);
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '121 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.upload_id(4);
grant select on old_rtf_claim to service_role;
set local role service_role;
select is(pg_temp.try_claim(4,'upload-extraction.1')->>'extraction_contract_version','upload-extraction.3',
  'reconnect adopts stored v3 despite the old caller preference');
select isnt(pg_temp.token(4),(select ingest_claim_token from old_rtf_claim),'expired claim rotates exactly its observation token');
select is(pg_temp.checkpoint(4)->'source_manifest',(select ingest_source_manifest from old_rtf_claim),
  'reconnect recovers the same retained source');
select is(pg_temp.checkpoint(4)->>'source_manifest_sha256',(select ingest_source_manifest_sha256 from old_rtf_claim),
  'reconnect retains the same database digest');
select throws_ok($$select public.record_upload_extraction_snapshot(pg_temp.upload_id(4),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),(select ingest_claim_token from old_rtf_claim),
  pg_temp.rtf_manifest()->>'originalSha256',pg_temp.sha(pg_temp.rtf_text()),pg_temp.rtf_text(),
  'rtf',false,'upload-resource-policy.2','upload-extraction.3',pg_temp.rtf_manifest())$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','old claim cannot write after ownership of work rotates');

select is(pg_temp.try_claim(5,'upload-extraction.3')->>'outcome','accepted','uncertain-storage fixture is admitted');
select is(pg_temp.advance(5,'prepared','storage_dispatched')->>'outcome','advanced','uncertain storage reaches dispatch stage');
reset role;
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '121 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.upload_id(5);
set local role service_role;
create temp table uncertain_rtf_claim as select pg_temp.try_claim(5,'upload-extraction.1') as receipt;
select is((select receipt->'storage_permitted' from uncertain_rtf_claim),'false'::jsonb,
  'uncertain storage recovery never grants blind redispatch');
select is((select receipt->>'extraction_contract_version' from uncertain_rtf_claim),'upload-extraction.3',
  'uncertain storage retains its v3 contract');
select throws_ok($$select public.settle_upload_ingest(pg_temp.upload_id(5),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),'reconciliation_required',409,
  jsonb_build_object('upload_id',pg_temp.upload_id(5),'metadata',pg_temp.rtf_manifest()),
  null,'{}','STORAGE_UNCERTAIN',pg_temp.token(5))$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','reconciliation cannot expose an RTF manifest');
select is(public.settle_upload_ingest(pg_temp.upload_id(5),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),'reconciliation_required',409,
  jsonb_build_object('upload_id',pg_temp.upload_id(5),'error',jsonb_build_object('code','STORAGE_UNCERTAIN')),
  null,'{}','STORAGE_UNCERTAIN',pg_temp.token(5))->>'outcome','settled',
  'truthful storage reconciliation does not require a checkpoint that never existed');

select is(pg_temp.try_claim(6,'upload-extraction.3')->>'outcome','accepted','failed-extraction fixture is admitted');
select is(pg_temp.advance(6,'prepared','storage_dispatched')->>'outcome','advanced','failed-extraction storage dispatch is acknowledged');
select is(pg_temp.advance(6,'storage_dispatched','storage_completed')->>'outcome','advanced','failed-extraction original is retained');
select throws_ok($$select public.settle_upload_ingest(pg_temp.upload_id(6),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),'failed',422,
  jsonb_build_object('upload_id',pg_temp.upload_id(6),'error',jsonb_build_object('details',pg_temp.rtf_manifest())),
  null,'{}','RTF_INVALID',pg_temp.token(6))$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','failure response cannot expose nested private RTF fields');
select throws_ok($$select public.settle_upload_ingest(pg_temp.upload_id(6),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),'failed',422,
  jsonb_build_object('upload_id',pg_temp.upload_id(6),'error',jsonb_build_object('code','RTF_INVALID')),
  null,jsonb_build_object('details',jsonb_build_object('extractedTextSha256',repeat('b',64))),
  'RTF_INVALID',pg_temp.token(6))$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','failure payload cannot expose a standalone private digest');
select is(public.settle_upload_ingest(pg_temp.upload_id(6),
  '71007080-0000-4000-8000-000000000001',repeat('a',64),'failed',422,
  jsonb_build_object('upload_id',pg_temp.upload_id(6),'error',jsonb_build_object('code','RTF_INVALID')),
  null,'{}','RTF_INVALID',pg_temp.token(6))->>'outcome','settled',
  'expected extraction failure stays settleable without a completed checkpoint');
reset role;

create function pg_temp.docx_manifest() returns jsonb language sql as $function$
select $manifest${
  "version":"docx-source-manifest.1","assessment":"source_only",
  "archiveSha256":"a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799",
  "archiveByteLength":1370,"rosterEncodingVersion":"office-part-roster-json.1",
  "partRosterSha256":"07b8b7bb4adb894c32d73c83c0c58ca81bb8ccf77f094be87d29c2220fc7be11",
  "parts":[
    {"path":"[Content_Types].xml","compressionMethod":0,"compressedByteLength":374,"uncompressedByteLength":374,"crc32":1971342327,"contentSha256":"be93955457110f3ebc23e1adae61d6f74f304482e1a2de069aa44e7804fcd0c6"},
    {"path":"_rels/.rels","compressionMethod":0,"compressedByteLength":242,"uncompressedByteLength":242,"crc32":1127185249,"contentSha256":"22c01d12e912dc45bdf191c382dd5b80cdeca1a9e95af86a477798a9f7e541e9"},
    {"path":"word/document.xml","compressionMethod":0,"compressedByteLength":410,"uncompressedByteLength":410,"crc32":3329854434,"contentSha256":"0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a"}
  ],
  "mainPart":{"path":"word/document.xml","source":{
    "version":"word-xml-source.1","assessment":"source_only",
    "originalSha256":"0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a",
    "blockers":[],"nodes":[{"id":"t:1","text":"Format protected document","start":223,"end":248,"xmlSpace":"default","lexicallyPatchable":true}]
  }},
  "blockers":["layout_unassessed","package_semantics_unassessed","styles_and_visibility_unassessed"]
}$manifest$::jsonb
$function$;

create function pg_temp.claim_variant(p_slot integer,p_filename text,p_mime text,p_length integer,p_sha text)
returns jsonb language sql as $function$
  select public.claim_upload_ingest(pg_temp.upload_id(p_slot),'71007080-0000-4000-8000-000000000001',
    '71007080-0000-4000-8000-000000000001/'||pg_temp.upload_id(p_slot)::text||'/variant',
    p_mime,p_filename,p_length,repeat('a',64),p_sha,'upload-extraction.3')
$function$;
create function pg_temp.record_variant(p_slot integer,p_format text,p_text text,p_source jsonb)
returns jsonb language sql as $function$
  select public.record_upload_extraction_snapshot(pg_temp.upload_id(p_slot),
    '71007080-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(p_slot),
    (select ingest_content_sha256 from public.uploads where id=pg_temp.upload_id(p_slot)),
    pg_temp.sha(p_text),p_text,p_format,false,'upload-resource-policy.2','upload-extraction.3',p_source)
$function$;
set local role service_role;
select is(pg_temp.claim_variant(7,'source.docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',1370,
  pg_temp.docx_manifest()->>'archiveSha256')->>'outcome','accepted','v3 accepts a real known DOCX original identity');
select is(pg_temp.advance(7,'prepared','storage_dispatched')->>'outcome','advanced','DOCX storage dispatch state is recorded');
select is(pg_temp.advance(7,'storage_dispatched','storage_completed')->>'outcome','advanced','DOCX original-retained state is recorded');
select throws_ok($$select pg_temp.record_variant(7,'text','Format protected document',null)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','v3 DOCX cannot downgrade to source-absent text');
select throws_ok($$select pg_temp.record_variant(7,'docx','Format protected document',pg_temp.rtf_manifest())$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','v3 DOCX cannot accept an RTF source family');
select is(pg_temp.record_variant(7,'docx','Format protected document',pg_temp.docx_manifest())->>'outcome','recorded',
  'v3 DOCX uses its existing source normalizer with policy two');
select is(pg_temp.checkpoint(7)->'source_manifest',pg_temp.docx_manifest(),'v3 preserves the exact existing DOCX source mapping');
select is(pg_temp.checkpoint(7)->>'resource_policy_version','upload-resource-policy.2','DOCX v3 reports its accepted resource policy');

select is(pg_temp.claim_variant(8,'source.txt','text/plain',4,pg_temp.sha('text'))->>'outcome','accepted',
  'v3 ordinary text original is admitted');
select is(pg_temp.advance(8,'prepared','storage_dispatched')->>'outcome','advanced','text storage dispatch is recorded');
select is(pg_temp.advance(8,'storage_dispatched','storage_completed')->>'outcome','advanced','text original retention is recorded');
select throws_ok($$select pg_temp.record_variant(8,'text','text','null')$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','JSON null cannot replace explicit SQL absence');
select throws_ok($$select pg_temp.record_variant(8,'text','text',pg_temp.rtf_manifest())$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','source-absent text cannot carry an RTF manifest');
select is(pg_temp.record_variant(8,'text','text',null)->>'outcome','recorded','v3 text records without invented source metadata');
select is(pg_temp.checkpoint(8)->'source_manifest','null'::jsonb,'text source is explicit null in the private envelope');
select is(pg_temp.checkpoint(8)->'source_manifest_sha256','null'::jsonb,'text has no invented source digest');
select is(pg_temp.checkpoint(8)->'source_digest_version','null'::jsonb,'text has no invented digest version');

-- These cases exercise accepted metadata compatibility, retaining exact originals.
select is(pg_temp.claim_variant(9,U&'\FEFFSOURCE.\FF32\FF34\FF26\00A0','unknown',449,
  pg_temp.rtf_manifest()->>'originalSha256')->>'outcome','accepted','v3 retains an original NFKC filename and stored unknown MIME');
select is(pg_temp.advance(9,'prepared','storage_dispatched')->>'outcome','advanced','metadata fixture dispatch is recorded');
select is(pg_temp.advance(9,'storage_dispatched','storage_completed')->>'outcome','advanced','metadata fixture original is retained');
select throws_ok($$select pg_temp.record_variant(9,'text',pg_temp.rtf_text(),null)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','NFKC filename cannot evade the mandatory RTF source');
select is(pg_temp.record_variant(9,'rtf',pg_temp.rtf_text(),pg_temp.rtf_manifest())->>'outcome','recorded',
  'NFKC filename and the existing unknown MIME adapter remain readable');
select is((select file_name from public.uploads where id=pg_temp.upload_id(9)),U&'\FEFFSOURCE.\FF32\FF34\FF26\00A0',
  'metadata validation does not rewrite the stored original filename');
select is(pg_temp.claim_variant(10,'source.rtf','rtf; charset=utf-8',449,pg_temp.rtf_manifest()->>'originalSha256')->>'outcome','accepted',
  'parameterized extension alias reaches private validation only');
select is(pg_temp.advance(10,'prepared','storage_dispatched')->>'outcome','advanced','literal alias fixture dispatch is recorded');
select is(pg_temp.advance(10,'storage_dispatched','storage_completed')->>'outcome','advanced','literal alias fixture original is retained');
select throws_ok($$select pg_temp.record_variant(10,'rtf',pg_temp.rtf_text(),pg_temp.rtf_manifest())$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','unsupported parameters on the extension alias are rejected');
select is(pg_temp.checkpoint(10),null::jsonb,'unsupported metadata does not create a partial source checkpoint');
reset role;

-- The new function requests v3 for every claim. Existing request metadata and
-- the stored extraction version remain authoritative after that code change.
create function pg_temp.reclaim_as_v3(p_slot integer) returns jsonb language sql as $function$
  select public.claim_upload_ingest(u.id,u.user_id,u.storage_path,u.file_type,
    u.file_name,u.file_size_bytes,u.ingest_request_sha256,u.ingest_content_sha256,'upload-extraction.3')
  from public.uploads u where u.id=pg_temp.upload_id(p_slot)
$function$;
insert into public.uploads(id,user_id,storage_path,file_type,file_name,file_size_bytes,status,
  idempotency_key,ingest_request_sha256,ingest_content_sha256,ingest_status,ingest_stage,
  ingest_claim_token,ingest_heartbeat_at,ingest_lease_expires_at,ingest_extraction_contract_version)
select pg_temp.upload_id(11),user_id,user_id::text||'/'||pg_temp.upload_id(11)::text||'/source.txt',
  file_type,file_name,file_size_bytes,status,pg_temp.upload_id(11)::text,repeat('d',64),
  ingest_content_sha256,ingest_status,ingest_stage,gen_random_uuid(),ingest_heartbeat_at,ingest_lease_expires_at,null
from public.uploads where id=pg_temp.upload_id(1);
select is((select count(*)::integer from public.uploads where id=pg_temp.upload_id(11)
  and ingest_extraction_contract_version is null),1,'representative historical NULL row is inserted from a positively accepted v1 fixture');
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '2 minutes',
  ingest_lease_expires_at=clock_timestamp()-interval '1 minute'
  where id in (pg_temp.upload_id(1),pg_temp.upload_id(2),pg_temp.upload_id(11));
create temporary table admission_before as
  select id,to_jsonb(u)-'ingest_claim_token'-'ingest_heartbeat_at'-'ingest_lease_expires_at'-'updated_at' as immutable
  from public.uploads u where id in (pg_temp.upload_id(1),pg_temp.upload_id(2),pg_temp.upload_id(11));
select is((select count(*)::integer from admission_before),3,'NULL, v1 and v2 fixtures exist before resume checks');
set local role service_role;
create temporary table new_code_receipts as
  select slot,pg_temp.reclaim_as_v3(slot) as receipt from (values (1),(2),(11)) slots(slot);
select is((select count(*)::integer from new_code_receipts where receipt->>'outcome'='resumed'),3,
  'new v3-requesting code resumes all three existing accepted versions');
select ok(not (select receipt ? 'extraction_contract_version' from new_code_receipts where slot=1),
  'new caller retains the v1 receipt shape');
select ok(not (select receipt ? 'extraction_contract_version' from new_code_receipts where slot=11),
  'new caller retains the historical NULL receipt shape');
select is((select receipt->>'extraction_contract_version' from new_code_receipts where slot=2),'upload-extraction.2',
  'new caller receives the accepted v2 reader version');
select is(pg_temp.reclaim_as_v3(3)->'response',pg_temp.completed_response(3),
  'new caller returns the exact already-settled v3 public receipt');
reset role;
select is((select count(*)::integer from admission_before b join public.uploads u using(id)
  where b.immutable=to_jsonb(u)-'ingest_claim_token'-'ingest_heartbeat_at'-'ingest_lease_expires_at'-'updated_at'),3,
  'request identities, versions, content, checkpoints and receipts are unchanged by new-code resume');

select * from finish();
rollback;
