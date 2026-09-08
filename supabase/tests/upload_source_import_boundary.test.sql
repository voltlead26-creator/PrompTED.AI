begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Synthetic command fixtures. DOCX/RTF manifests are the reviewed local parser
-- fixtures; this test exercises database imports, not parsers, Storage or editing.
create function pg_temp.ui_owner() returns uuid language sql as $$
  select '71007120-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.ui_id(p_kind text,p_slot integer) returns uuid language sql as $$
  select (case p_kind when 'upload' then '72007120' when 'outcome' then '73007120'
    when 'document' then '74007120' else '75007120' end||'-0000-4000-8000-'||lpad(p_slot::text,12,'0'))::uuid $$;
create function pg_temp.ui_sha(p_text text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.ui_token(p_slot integer) returns uuid language sql as $$
  select ingest_claim_token from public.uploads where id=pg_temp.ui_id('upload',p_slot) $$;
create temporary table ui_fixtures(slot integer primary key,format text,version text,content text,
  chars integer,manifest jsonb,content_sha text,byte_length integer,mime text,truncated boolean);
insert into ui_fixtures values
  (1,'pdf','upload-extraction.3','Synthetic PDF preview.',22,null,repeat('a',64),128,'application/pdf',false),
  (2,'docx','upload-extraction.3','Format protected document',25,$docx${"version": "docx-source-manifest.1", "assessment": "source_only", "archiveSha256": "a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799", "archiveByteLength": 1370, "rosterEncodingVersion": "office-part-roster-json.1", "partRosterSha256": "07b8b7bb4adb894c32d73c83c0c58ca81bb8ccf77f094be87d29c2220fc7be11", "parts": [{"path": "[Content_Types].xml", "compressionMethod": 0, "compressedByteLength": 374, "uncompressedByteLength": 374, "crc32": 1971342327, "contentSha256": "be93955457110f3ebc23e1adae61d6f74f304482e1a2de069aa44e7804fcd0c6"}, {"path": "_rels/.rels", "compressionMethod": 0, "compressedByteLength": 242, "uncompressedByteLength": 242, "crc32": 1127185249, "contentSha256": "22c01d12e912dc45bdf191c382dd5b80cdeca1a9e95af86a477798a9f7e541e9"}, {"path": "word/document.xml", "compressionMethod": 0, "compressedByteLength": 410, "uncompressedByteLength": 410, "crc32": 3329854434, "contentSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a"}], "mainPart": {"path": "word/document.xml", "source": {"version": "word-xml-source.1", "originalSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a", "assessment": "source_only", "blockers": [], "nodes": [{"id": "t:1", "text": "Format protected document", "start": 223, "end": 248, "xmlSpace": "default", "lexicallyPatchable": true}]}}, "blockers": ["layout_unassessed", "package_semantics_unassessed", "styles_and_visibility_unassessed"]}$docx$::jsonb,'a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799',1370,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',false),
  (3,'rtf','upload-extraction.3',$text$Source-preservation fixture
Renée — 日本語 😀
Keep each paragraph and these exact words.$text$,85,$rtf${"version": "rtf-source-manifest.1", "assessment": "source_only", "originalSha256": "c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84", "originalByteLength": 449, "extractedTextSha256": "8f4a2ccc7caabefe92a6b7a07e63babde18f86e54e8815d506efa195d39ad3ea", "blockers": ["rtf-format-preserving-editing-unverified"]}$rtf$::jsonb,'c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84',449,'application/rtf',false),
  (4,'text','upload-extraction.3','Truncated preview.',18,null,repeat('b',64),128,'text/plain',true),
  (5,'text','upload-extraction.3','Pending classification.',23,null,repeat('c',64),128,'text/plain',false),
  (6,'text','upload-extraction.3','Complete text preview.',22,null,repeat('d',64),128,'text/plain',false),
  (7,'docx','upload-extraction.2','Format protected document',25,$docx${"version": "docx-source-manifest.1", "assessment": "source_only", "archiveSha256": "a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799", "archiveByteLength": 1370, "rosterEncodingVersion": "office-part-roster-json.1", "partRosterSha256": "07b8b7bb4adb894c32d73c83c0c58ca81bb8ccf77f094be87d29c2220fc7be11", "parts": [{"path": "[Content_Types].xml", "compressionMethod": 0, "compressedByteLength": 374, "uncompressedByteLength": 374, "crc32": 1971342327, "contentSha256": "be93955457110f3ebc23e1adae61d6f74f304482e1a2de069aa44e7804fcd0c6"}, {"path": "_rels/.rels", "compressionMethod": 0, "compressedByteLength": 242, "uncompressedByteLength": 242, "crc32": 1127185249, "contentSha256": "22c01d12e912dc45bdf191c382dd5b80cdeca1a9e95af86a477798a9f7e541e9"}, {"path": "word/document.xml", "compressionMethod": 0, "compressedByteLength": 410, "uncompressedByteLength": 410, "crc32": 3329854434, "contentSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a"}], "mainPart": {"path": "word/document.xml", "source": {"version": "word-xml-source.1", "originalSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a", "assessment": "source_only", "blockers": [], "nodes": [{"id": "t:1", "text": "Format protected document", "start": 223, "end": 248, "xmlSpace": "default", "lexicallyPatchable": true}]}}, "blockers": ["layout_unassessed", "package_semantics_unassessed", "styles_and_visibility_unassessed"]}$docx$::jsonb,'a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799',1370,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',false),
  (8,'rtf','upload-extraction.3',$text$Source-preservation fixture
Renée — 日本語 😀
Keep each paragraph and these exact words.$text$,85,$rtf${"version": "rtf-source-manifest.1", "assessment": "source_only", "originalSha256": "c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84", "originalByteLength": 449, "extractedTextSha256": "8f4a2ccc7caabefe92a6b7a07e63babde18f86e54e8815d506efa195d39ad3ea", "blockers": ["rtf-format-preserving-editing-unverified"]}$rtf$::jsonb,'c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84',449,'application/rtf',false);
grant select on ui_fixtures to service_role,authenticated;
create function pg_temp.ui_path(p_slot integer) returns text language sql as $$
  select pg_temp.ui_owner()::text||'/'||pg_temp.ui_id('upload',p_slot)::text||'/source.'||
    case when format='text' then 'txt' else format end from ui_fixtures where slot=p_slot $$;
create function pg_temp.ui_response(p_slot integer) returns jsonb language sql as $$
  select jsonb_build_object('upload_id',pg_temp.ui_id('upload',slot),'storage_path',pg_temp.ui_path(slot),
    'extracted_text',content,'original_retained',true,'classification_status','completed','extraction_format',format,
    'resource_policy_version',case when version='upload-extraction.3' then 'upload-resource-policy.2' else 'upload-resource-policy.1' end,
    'confirm_payload',jsonb_build_object('summary','Synthetic classification','document_type','document',
      'filename','source.'||case when format='text' then 'txt' else format end,'char_count',chars,'truncated',truncated,
      'structure','[{"title":"Document","items":["Synthetic wording"]}]'::jsonb)) from ui_fixtures where slot=p_slot $$;
create function pg_temp.ui_payload(p_slot integer) returns jsonb language sql as $$
  select jsonb_build_object('truncated',truncated,'original_retained',true,'classification_status','completed',
    'extraction_format',format,'resource_policy_version',case when version='upload-extraction.3'
      then 'upload-resource-policy.2' else 'upload-resource-policy.1' end) from ui_fixtures where slot=p_slot $$;
create function pg_temp.ui_import(p_slot integer,p_target integer default null) returns jsonb language sql as $$
  select public.commit_document_import(pg_temp.ui_id('upload',p_slot),pg_temp.ui_id('outcome',coalesce(p_target,p_slot)),
    pg_temp.ui_id('document',coalesce(p_target,p_slot)),'Imported '||p_slot,'Synthetic import',
    '{"primary":{"template_id":"imported_document"}}'::jsonb,
    jsonb_build_array(jsonb_build_object('id',pg_temp.ui_id('section',p_slot),'name','Document','order_index',0,
      'content','Owner reviewed wording '||p_slot,'status','draft','version_history','[]'::jsonb,'is_required',true))) $$;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  (pg_temp.ui_owner(),'source-import-owner@example.invalid',false,false,now(),now()),
  ('71007120-0000-4000-8000-000000000002','source-import-other@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (pg_temp.ui_owner(),
  '71007120-0000-4000-8000-000000000002')),2,'both import fixture owners exist');
set local role service_role;
select is(public.claim_upload_ingest(pg_temp.ui_id('upload',slot),pg_temp.ui_owner(),pg_temp.ui_path(slot),mime,
  'source.'||case when format='text' then 'txt' else format end,byte_length,pg_temp.ui_sha('request/'||slot),
  content_sha,version)->>'outcome','accepted','source fixture '||slot||' positively admitted') from ui_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.ui_id('upload',slot),pg_temp.ui_owner(),pg_temp.ui_sha('request/'||slot),
  pg_temp.ui_token(slot),'prepared','storage_dispatched')->>'outcome','advanced','source fixture '||slot||' retention dispatched') from ui_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.ui_id('upload',slot),pg_temp.ui_owner(),pg_temp.ui_sha('request/'||slot),
  pg_temp.ui_token(slot),'storage_dispatched','storage_completed')->>'outcome','advanced','source fixture '||slot||' retention acknowledged') from ui_fixtures order by slot;
select is(public.record_upload_extraction_snapshot(pg_temp.ui_id('upload',slot),pg_temp.ui_owner(),pg_temp.ui_sha('request/'||slot),
  pg_temp.ui_token(slot),content_sha,pg_temp.ui_sha(content),content,format,truncated,
  case when version='upload-extraction.3' then 'upload-resource-policy.2' else 'upload-resource-policy.1' end,version,manifest)->>'outcome',
  'recorded','source fixture '||slot||' immutable checkpoint recorded') from ui_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.ui_id('upload',slot),pg_temp.ui_owner(),pg_temp.ui_sha('request/'||slot),
  pg_temp.ui_token(slot),'storage_completed','provider_dispatched')->>'outcome','advanced','source fixture '||slot||' classification dispatched') from ui_fixtures order by slot;
select is(public.settle_upload_ingest(pg_temp.ui_id('upload',slot),pg_temp.ui_owner(),pg_temp.ui_sha('request/'||slot),
  'completed',200,pg_temp.ui_response(slot),content,pg_temp.ui_payload(slot),null,pg_temp.ui_token(slot))->>'outcome',
  'settled','source fixture '||slot||' classification settled') from ui_fixtures where slot<>5 order by slot;
reset role;
select is((select count(*)::integer from public.uploads where user_id=pg_temp.ui_owner() and status='ready'),7,
  'all completed fixtures independently read as ready');
select is((select ingest_status from public.uploads where id=pg_temp.ui_id('upload',5)),'processing',
  'unsettled fixture remains genuinely processing');
select ok(not has_table_privilege('authenticated','public.uploads','INSERT')
  and not has_table_privilege('authenticated','public.uploads','UPDATE')
  and not has_table_privilege('service_role','public.uploads','UPDATE'),'direct upload writes remain unavailable');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ui_owner()::text,true);
select is(pg_temp.ui_import(6)->>'status','committed','complete v3 text may still be imported as reviewed wording');
select is(pg_temp.ui_import(7)->>'status','committed','existing v2 DOCX import stays compatible');
select is(pg_temp.ui_import(7,6)->>'document_id',pg_temp.ui_id('document',7)::text,'committed legacy replay retains original destination');
reset role;
create temporary table ui_control as select to_jsonb(d) document,
  (select jsonb_agg(to_jsonb(s) order by id) from public.sections s where document_id=d.id) sections
  from public.documents d where id=pg_temp.ui_id('document',6);
create temporary table ui_uploads_before as select id,to_jsonb(u) original from public.uploads u
  where user_id=pg_temp.ui_owner() and id in (select pg_temp.ui_id('upload',slot) from ui_fixtures where slot in (1,2,3,4,5));

set local role authenticated;
select throws_ok($$select pg_temp.ui_import(1,6)$$,'P0001','UPLOAD_SOURCE_IMPORT_UNAVAILABLE',
  'v3 PDF cannot replace an existing editable document with reconstructed text');
select throws_ok($$select pg_temp.ui_import(2)$$,'P0001','UPLOAD_SOURCE_IMPORT_UNAVAILABLE',
  'v3 DOCX source-only assessment prevents reconstructed editable import');
select throws_ok($$select pg_temp.ui_import(3)$$,'P0001','UPLOAD_SOURCE_IMPORT_UNAVAILABLE',
  'v3 RTF source-only assessment prevents reconstructed editable import');
select throws_ok($$select pg_temp.ui_import(4)$$,'P0001','UPLOAD_IMPORT_PREVIEW_INCOMPLETE',
  'v3 truncated preview cannot become a complete editable import');
select throws_ok($$select pg_temp.ui_import(5)$$,'P0001','UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST',
  'existing readiness guard still rejects an unsettled classification');
-- Source context remains a valid use of a retained file; it does not create an editable source document.
select is(public.attach_own_upload_to_outcome(pg_temp.ui_id('outcome',6),pg_temp.ui_id('upload',8))->>'outcome_id',
  pg_temp.ui_id('outcome',6)::text,'source-only RTF remains attachable as outcome context');
reset role;
select is((select to_jsonb(d) from public.documents d where id=pg_temp.ui_id('document',6)),
  (select document from ui_control),'denied import leaves the complete existing document row unchanged');
select is((select jsonb_agg(to_jsonb(s) order by id) from public.sections s where document_id=pg_temp.ui_id('document',6)),
  (select sections from ui_control),'denied import preserves every existing section row');
select is((select count(*)::integer from ui_uploads_before b join public.uploads u using(id) where b.original=to_jsonb(u)),
  5,'all five denied source imports preserve their full upload rows');
select is((select count(*)::integer from public.documents where user_id=pg_temp.ui_owner()),2,
  'denied sources do not create extra documents');
select is((select count(*)::integer from public.outcomes where user_id=pg_temp.ui_owner()),2,
  'denied sources do not create extra outcomes');
select is((select document_id from public.uploads where id=pg_temp.ui_id('upload',8)),null::uuid,
  'outcome context does not create a document link');

-- A privileged command cannot bypass the same source-only transition rule.
-- These UPDATE probes are inside the disposable test transaction, not hosted DML.
select throws_ok($$update public.uploads set document_id=pg_temp.ui_id('document',6)
  where id=pg_temp.ui_id('upload',8)$$,'P0001','UPLOAD_SOURCE_IMPORT_UNAVAILABLE',
  'table boundary rejects a source-only document assignment independently of import RPC');
select throws_ok($$update public.uploads set status='committed'
  where id=pg_temp.ui_id('upload',8)$$,'P0001','UPLOAD_SOURCE_IMPORT_UNAVAILABLE',
  'table boundary rejects a source-only transition into committed');
select lives_ok($$delete from public.documents where id=pg_temp.ui_id('document',6)$$,
  'existing document deletion may clear an upload link through its foreign key');
select is((select document_id from public.uploads where id=pg_temp.ui_id('upload',6)),null::uuid,
  'foreign-key cleanup does not preserve a dangling source link');

set local role authenticated;
select set_config('request.jwt.claim.sub','71007120-0000-4000-8000-000000000002',true);
select throws_like($$select pg_temp.ui_import(8)$$,'UPLOAD_NOT_FOUND:%','other owner cannot import retained source');
reset role;
select * from finish();
rollback;
