-- Source binding must be created by the trusted backend from a completed,
-- owned immutable checkpoint. This is local SQL evidence, not editor activation.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
create function pg_temp.ds_owner() returns uuid language sql as $$
  select '71001010-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.ds_upload() returns uuid language sql as $$
  select '72001010-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.ds_sha(p_value text) returns text language sql as $$
  select encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex') $$;
create function pg_temp.ds_path() returns text language sql as $$
  select pg_temp.ds_owner()::text||'/'||pg_temp.ds_upload()::text||'/source-preservation.docx' $$;
create function pg_temp.ds_token() returns uuid language sql as $$
  select ingest_claim_token from public.uploads where id=pg_temp.ds_upload() $$;
create temp table ds_fixture(manifest jsonb, units jsonb);
insert into ds_fixture values($source${"version": "docx-source-manifest.1", "assessment": "source_only", "archiveSha256": "a096ad4a8de77f395cef7f999d2e0037147945ae62c6663fabf6b43556c3b799", "archiveByteLength": 1370, "rosterEncodingVersion": "office-part-roster-json.1", "partRosterSha256": "07b8b7bb4adb894c32d73c83c0c58ca81bb8ccf77f094be87d29c2220fc7be11", "parts": [{"path": "[Content_Types].xml", "compressionMethod": 0, "compressedByteLength": 374, "uncompressedByteLength": 374, "crc32": 1971342327, "contentSha256": "be93955457110f3ebc23e1adae61d6f74f304482e1a2de069aa44e7804fcd0c6"}, {"path": "_rels/.rels", "compressionMethod": 0, "compressedByteLength": 242, "uncompressedByteLength": 242, "crc32": 1127185249, "contentSha256": "22c01d12e912dc45bdf191c382dd5b80cdeca1a9e95af86a477798a9f7e541e9"}, {"path": "word/document.xml", "compressionMethod": 0, "compressedByteLength": 410, "uncompressedByteLength": 410, "crc32": 3329854434, "contentSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a"}], "mainPart": {"path": "word/document.xml", "source": {"version": "word-xml-source.1", "originalSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a", "assessment": "source_only", "nodes": [{"id": "t:1", "text": "Format protected document", "start": 223, "end": 248, "xmlSpace": "default", "lexicallyPatchable": true}], "blockers": []}}, "blockers": ["layout_unassessed", "package_semantics_unassessed", "styles_and_visibility_unassessed"]}$source$::jsonb,$units${"version": "word-xml-units.1", "contentEncoding": "literal-text.1", "assessment": "source_only", "source": {"version": "word-xml-source.1", "originalSha256": "0e25a6cd1eb6b80519f8b622946c99be228b6e1d5a6238af4883647896fc515a", "assessment": "source_only", "nodes": [{"id": "t:1", "text": "Format protected document", "start": 223, "end": 248, "xmlSpace": "default", "lexicallyPatchable": true}], "blockers": []}, "blockers": ["layout_unassessed", "package_semantics_unassessed", "styles_and_visibility_unassessed"], "paragraphs": [{"id": "p:1", "unitIds": ["t:1"]}], "units": [{"nodeId": "t:1", "paragraphId": "p:1", "content": "Format protected document", "lexicallyPatchable": true}]}$units$::jsonb);
grant select on ds_fixture to service_role;
create temp table ds_receipt(result jsonb);
grant select,insert on ds_receipt to service_role;
insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  (pg_temp.ds_owner(),'docx-binding-owner@example.invalid',false,false,now(),now()),
  ('71001010-0000-4000-8000-000000000002','docx-binding-other@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (pg_temp.ds_owner(),
  '71001010-0000-4000-8000-000000000002')),2,'both source-binding fixture owners exist');
set local role service_role;
select is(public.claim_upload_ingest(pg_temp.ds_upload(),pg_temp.ds_owner(),pg_temp.ds_path(),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','source-preservation.docx',
  (manifest->>'archiveByteLength')::integer,pg_temp.ds_sha('docx-binding-request'),manifest->>'archiveSha256',
  'upload-extraction.3')->>'outcome','accepted','owned original positively admitted') from ds_fixture;
select is(public.advance_upload_ingest(pg_temp.ds_upload(),pg_temp.ds_owner(),pg_temp.ds_sha('docx-binding-request'),
  pg_temp.ds_token(),'prepared','storage_dispatched')->>'outcome','advanced','original retention dispatched');
select is(public.advance_upload_ingest(pg_temp.ds_upload(),pg_temp.ds_owner(),pg_temp.ds_sha('docx-binding-request'),
  pg_temp.ds_token(),'storage_dispatched','storage_completed')->>'outcome','advanced','original retention acknowledged');
select is(public.record_upload_extraction_snapshot(pg_temp.ds_upload(),pg_temp.ds_owner(),pg_temp.ds_sha('docx-binding-request'),
  pg_temp.ds_token(),manifest->>'archiveSha256',pg_temp.ds_sha('Format protected document'),'Format protected document',
  'docx',false,'upload-resource-policy.2','upload-extraction.3',manifest)->>'outcome','recorded',
  'real fixture source manifest recorded in the immutable owned checkpoint') from ds_fixture;
reset role;
insert into storage.objects(bucket_id,name,metadata)
  select 'original-documents',pg_temp.ds_path(),
    jsonb_build_object('size',(manifest->>'archiveByteLength')::integer) from ds_fixture;
select is((select count(*)::integer from storage.objects
  where bucket_id='original-documents' and name=pg_temp.ds_path()),1,
  'owned retained object fixture exists before source completion');
set local role service_role;
select is(public.complete_upload_source_preparation_v1(pg_temp.ds_upload(),pg_temp.ds_owner(),
  pg_temp.ds_sha('docx-binding-request'),pg_temp.ds_token())->>'outcome','settled','source preparation completed without provider work');
reset role;
select is((select count(*)::integer from public.uploads where id=pg_temp.ds_upload() and user_id=pg_temp.ds_owner()
  and status='ready' and ingest_status='completed'),1,'positive source fixture is ready before source binding');
create temp table ds_before as select ingest_response,ingest_source_manifest,ingest_source_manifest_sha256,
  ingest_content_sha256,storage_path from public.uploads where id=pg_temp.ds_upload();
set local role service_role;
select lives_ok($command$
  insert into ds_receipt select public.prepare_docx_source_document_v1(pg_temp.ds_owner(),pg_temp.ds_upload(),
    (select ingest_source_manifest_sha256 from public.uploads where id=pg_temp.ds_upload()),units) from ds_fixture
$command$,'trusted source preparation creates a source-bound document through the existing aggregate');
reset role;
select is((select count(*)::integer from public.documents where user_id=pg_temp.ds_owner()),1,
  'exactly one authoritative document exists after source binding');
select is((select count(*)::integer from public.sections where user_id=pg_temp.ds_owner()
  and content='Format protected document'),1,'initial literal source wording belongs to the existing section store');
select is((select jsonb_build_object('response',ingest_response,'manifest',ingest_source_manifest,
  'digest',ingest_source_manifest_sha256,'original',ingest_content_sha256,'path',storage_path)
  from public.uploads where id=pg_temp.ds_upload()),
  (select jsonb_build_object('response',ingest_response,'manifest',ingest_source_manifest,
  'digest',ingest_source_manifest_sha256,'original',ingest_content_sha256,'path',storage_path) from ds_before),
  'binding never rewrites the immutable original checkpoint or ingest receipt');
select is((select count(*)::integer from public.usage_ledger where user_id=pg_temp.ds_owner()),0,
  'source binding does not consume a generated-document credit');
create function pg_temp.ds_document() returns uuid language sql as $$
  select (result->>'document_id')::uuid from ds_receipt $$;
create function pg_temp.ds_outcome() returns uuid language sql as $$
  select (result->>'outcome_id')::uuid from ds_receipt $$;
create function pg_temp.ds_prepare(p_units jsonb default null) returns jsonb language sql as $$
  select public.prepare_docx_source_document_v1(pg_temp.ds_owner(),pg_temp.ds_upload(),
    (select ingest_source_manifest_sha256 from ds_before),coalesce(p_units,units)) from ds_fixture $$;
grant select on ds_before,ds_fixture,ds_receipt to authenticated,service_role;
select is((select result->>'assessment' from ds_receipt),'source_only',
  'receipt never claims editing or format-preserving export is activated');
set local role service_role;
select is(pg_temp.ds_prepare()->>'idempotent_replay','true','identical retry returns a durable replay');
select is(pg_temp.ds_prepare()->>'document_id',pg_temp.ds_document()::text,'retry preserves document identity');
select is(pg_temp.ds_prepare()->>'outcome_id',pg_temp.ds_outcome()::text,'retry preserves outcome identity');
select throws_ok($$select public.prepare_docx_source_document_v1(
  '71001010-0000-4000-8000-000000000002',pg_temp.ds_upload(),
  (select ingest_source_manifest_sha256 from ds_before),(select units from ds_fixture))$$,
  '22023','DOCX_SOURCE_BINDING_CONFLICT','foreign owner cannot bind or replay the upload');
select throws_ok($$select public.prepare_docx_source_document_v1(pg_temp.ds_owner(),pg_temp.ds_upload(),
  repeat('0',64),(select units from ds_fixture))$$,'22023','DOCX_SOURCE_BINDING_CONFLICT',
  'stale manifest digest cannot bind or replay');
select throws_ok($$select pg_temp.ds_prepare('[]'::jsonb)$$,
  '22023','DOCX_SOURCE_BINDING_INPUT_INVALID','non-object projection is rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{units,0,content}','"changed"')) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','forged literal wording is rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{source,originalSha256}',to_jsonb(repeat('0',64)))) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','forged original-part identity is rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{units}','[]')) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','missing source nodes are rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{units}',(units->'units')||(units->'units'))) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','duplicate source nodes are rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{units,0,paragraphId}','"p:2"')) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','unbound paragraph identities are rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{paragraphs,0,unitIds}','[]')) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','paragraph partition cannot drop source nodes');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{blockers}','[]')) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','projection cannot erase source-only blockers');
select throws_ok($$select pg_temp.ds_prepare(units||'{"unexpected":true}'::jsonb) from ds_fixture$$,
  '22023','DOCX_SOURCE_UNITS_INVALID','unknown projection keys are rejected');
select throws_ok($$select pg_temp.ds_prepare(jsonb_set(units,'{blockers}',
  (units->'blockers')||'"wording_controls_unmapped"'::jsonb)) from ds_fixture$$,
  '22023','DOCX_SOURCE_BINDING_CONFLICT','even a valid alternative assessment cannot rewrite an existing binding');
select throws_ok($$select public.load_legacy_export_snapshot(pg_temp.ds_owner(),pg_temp.ds_document(),gen_random_uuid())$$,
  'P0001','DOCX_SOURCE_EXPORT_NOT_ACTIVATED','legacy export cannot silently serialize literal DOCX content as HTML');
reset role;
select is((select count(*)::integer from public.documents where user_id=pg_temp.ds_owner()),1,
  'retries and rejected requests never create duplicate documents');
select is((select count(*)::integer from private.docx_source_bindings where user_id=pg_temp.ds_owner()),1,
  'exactly one durable binding survives all rejected requests');
select throws_ok($$update public.sections set content='changed' where document_id=pg_temp.ds_document()$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','privileged legacy writes cannot bypass source-only state');
select throws_ok($$insert into public.sections(document_id,user_id,name,order_index,content,status,is_required)
  values(pg_temp.ds_document(),pg_temp.ds_owner(),'Injected',99,'extra','draft',true)$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','privileged insert cannot add unbound source wording');
select throws_ok($$delete from public.sections where document_id=pg_temp.ds_document()$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','source-node removal is rejected');
select throws_ok($$update public.documents set title='changed' where id=pg_temp.ds_document()$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','legacy document mutation is rejected');
select throws_ok($$update public.outcomes set status='complete' where id=pg_temp.ds_outcome()$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','legacy outcome mutation is rejected');
select throws_ok($$delete from public.documents where id=pg_temp.ds_document()$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','ordinary deletion cannot erase replay identity before activation');
select throws_ok($$delete from public.outcomes where id=pg_temp.ds_outcome()$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','outcome deletion cannot silently activate recreation');
select throws_ok($$update private.docx_source_bindings set units_sha256=repeat('0',64) where document_id=pg_temp.ds_document()$$,
  'P0001','DOCX_SOURCE_BINDING_IMMUTABLE','binding digest is immutable');
select throws_ok($$delete from private.docx_source_bindings where document_id=pg_temp.ds_document()$$,
  'P0001','DOCX_SOURCE_BINDING_IMMUTABLE','removing binding cannot unlock a legacy edit bypass');
select throws_ok($$delete from public.uploads where id=pg_temp.ds_upload()$$,
  'P0001','DOCX_SOURCE_BINDING_IMMUTABLE','source upload cannot be removed while its bound document remains');
select set_config('request.jwt.claim.sub',pg_temp.ds_owner()::text,true);
set local role authenticated;
select throws_ok($$select pg_temp.ds_prepare()$$,'42501',
  'permission denied for function prepare_docx_source_document_v1','browser owner cannot invoke service-only binding');
select is((select count(*)::integer from public.documents where id=pg_temp.ds_document()),0,
  'source-only document is absent from the ordinary browser document store');
select is((select count(*)::integer from public.outcomes where id=pg_temp.ds_outcome()),0,
  'source-only outcome is absent from the ordinary My Work list');
select is((select count(*)::integer from public.sections where document_id=pg_temp.ds_document()),0,
  'literal wording cannot enter the ordinary browser HTML editor through RLS');
select throws_ok($$select public.get_workspace_snapshot_v1(pg_temp.ds_outcome(),null)$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','security-definer workspace hydration obeys the source-only boundary');
select throws_ok($$select public.get_workspace_section_body_v1(pg_temp.ds_outcome(),gen_random_uuid(),1,1)$$,
  'P0001','DOCX_SOURCE_EDITING_NOT_ACTIVATED','security-definer section hydration obeys the source-only boundary');
reset role;
-- This is metadata-only SQL setup in a rolled-back disposable fixture, not a
-- Storage API deletion. Make the exact retained path unavailable while leaving
-- Supabase's direct-deletion protection enabled.
update storage.objects set name=pg_temp.ds_path()||'.fixture-unavailable'
  where bucket_id='original-documents' and name=pg_temp.ds_path();
set local role service_role;
select throws_ok($$select pg_temp.ds_prepare()$$,'22023','DOCX_SOURCE_BINDING_CONFLICT',
  'even an identical replay requires its retained original to remain available');
reset role;
update storage.objects set name=pg_temp.ds_path()
  where bucket_id='original-documents' and name=pg_temp.ds_path()||'.fixture-unavailable';
-- Account erasure is an existing authority and must still cascade normally.
select lives_ok($$delete from auth.users where id=pg_temp.ds_owner()$$,
  'existing account erasure can cascade through dormant bindings and sections');
select is((select count(*)::integer from private.docx_source_bindings where user_id=pg_temp.ds_owner()),0,
  'account erasure leaves no source binding');
select is((select count(*)::integer from public.sections where user_id=pg_temp.ds_owner()),0,
  'account erasure leaves no literal wording');
select * from finish();
rollback;
