begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Synthetic styled DOCX from extract-upload/fixtures/source-preservation.docx.
-- Archive/parts/CRC were independently inspected. These tests exercise SQL,
-- not Storage retention, ZIP semantics, browser editing or visual fidelity.
create function pg_temp.source_manifest() returns jsonb language sql as $function$
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
create function pg_temp.upload_id(p_slot integer) returns uuid language sql as $function$
  select ('72006160-0000-4000-8000-' || lpad(p_slot::text,12,'0'))::uuid
$function$;
create function pg_temp.sha(p_value text) returns text language sql as $function$
  select encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$function$;
create function pg_temp.normalize_source(p_manifest jsonb) returns jsonb language sql as $function$
  select private.normalize_upload_source_manifest(p_manifest,
    pg_temp.source_manifest()->>'archiveSha256', 1370)
$function$;
create function pg_temp.claim(p_slot integer, p_version text default 'upload-extraction.2')
returns jsonb language sql as $function$
  select public.claim_upload_ingest(pg_temp.upload_id(p_slot),
    '71006160-0000-4000-8000-000000000001',
    '71006160-0000-4000-8000-000000000001/' || pg_temp.upload_id(p_slot)::text || '/source.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'source.docx',
    1370, repeat('a',64), pg_temp.source_manifest()->>'archiveSha256', p_version)
$function$;
create function pg_temp.token(p_slot integer) returns uuid language sql as $function$
  select ingest_claim_token from public.uploads where id = pg_temp.upload_id(p_slot)
$function$;
create function pg_temp.advance(p_slot integer, p_expected text, p_next text)
returns jsonb language sql as $function$
  select public.advance_upload_ingest(pg_temp.upload_id(p_slot),
    '71006160-0000-4000-8000-000000000001', repeat('a',64), pg_temp.token(p_slot), p_expected, p_next)
$function$;
create function pg_temp.record(p_slot integer, p_manifest jsonb default pg_temp.source_manifest(),
  p_version text default 'upload-extraction.2', p_format text default 'docx')
returns jsonb language sql as $function$
  select public.record_upload_extraction_snapshot(pg_temp.upload_id(p_slot),
    '71006160-0000-4000-8000-000000000001', repeat('a',64), pg_temp.token(p_slot),
    pg_temp.source_manifest()->>'archiveSha256', pg_temp.sha('Format protected document'),
    'Format protected document', p_format, false, 'upload-resource-policy.1', p_version, p_manifest)
$function$;
create function pg_temp.checkpoint(p_slot integer) returns jsonb language sql as $function$
  select public.get_upload_extraction_checkpoint(pg_temp.upload_id(p_slot),
    '71006160-0000-4000-8000-000000000001', repeat('a',64), pg_temp.token(p_slot))
$function$;
create function pg_temp.completed_response(p_slot integer) returns jsonb language sql as $function$
  select jsonb_build_object('upload_id', pg_temp.upload_id(p_slot),
    'storage_path', '71006160-0000-4000-8000-000000000001/'||pg_temp.upload_id(p_slot)::text||'/source.docx',
    'extracted_text', 'Format protected document', 'original_retained', true,
    'classification_status', 'completed', 'extraction_format', 'docx',
    'resource_policy_version', 'upload-resource-policy.1',
    'confirm_payload', jsonb_build_object('summary', 'Synthetic summary',
      'document_type', 'document', 'filename', 'source.docx', 'char_count', 25,
      'truncated', false, 'structure', '[{"title":"Document","items":["Synthetic source"]}]'::jsonb))
$function$;
create function pg_temp.completed_payload() returns jsonb language sql as $function$
  select '{"truncated":false,"original_retained":true,"classification_status":"completed",
    "extraction_format":"docx","resource_policy_version":"upload-resource-policy.1"}'::jsonb
$function$;
create function pg_temp.complete(p_slot integer, p_response jsonb, p_payload jsonb)
returns jsonb language sql as $function$
  select public.settle_upload_ingest(pg_temp.upload_id(p_slot),
    '71006160-0000-4000-8000-000000000001', repeat('a',64), 'completed', 200,
    p_response, 'Format protected document', p_payload, null, pg_temp.token(p_slot))
$function$;

select has_function('public', 'claim_upload_ingest',
  array['uuid','uuid','text','text','text','integer','text','text','text'], 'one version-aware claim command');
select has_function('public', 'record_upload_extraction_snapshot',
  array['uuid','uuid','text','uuid','text','text','text','text','boolean','text','text','jsonb'],
  'one compatible text/source recording command');
select is((select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('claim_upload_ingest','record_upload_extraction_snapshot')),
  2, 'no ambiguous overloads remain');
select ok(not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('claim_upload_ingest','record_upload_extraction_snapshot',
    'get_upload_extraction_checkpoint','load_upload_extraction_snapshot','advance_upload_ingest','settle_upload_ingest')
  and (not p.prosecdef or not(p.proconfig @> array['search_path=""'])
    or not has_function_privilege('service_role',p.oid,'EXECUTE')
    or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))),
  'upload commands retain fixed-path definer/service-only execution');
select ok(not exists (select 1 from pg_catalog.pg_attribute a where a.attrelid='public.uploads'::regclass
  and a.attname in ('ingest_source_manifest','ingest_source_manifest_sha256','ingest_source_digest_version','ingest_extraction_contract_version')
  and (has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT') or has_column_privilege('anon',a.attrelid,a.attnum,'SELECT'))),
  'source manifest, digest and accepted version stay private');

select is(pg_temp.normalize_source(pg_temp.source_manifest()), pg_temp.source_manifest(), 'real synthetic DOCX manifest is accepted literally');
select is(private.upload_source_utf16_units('A😀',true), array[65,55357,56832], 'supplementary text uses two UTF-16 units');
select ok(private.upload_source_utf16_units('😀',false) < private.upload_source_utf16_units(U&'\e000',false),
  'path ordering matches JavaScript rather than Unicode code-point order');
select is(private.upload_source_compact_json('{"x":"a, b : c", "y":[1,2]}'::jsonb,0),
  '{"x":"a, b : c","y":[1,2]}', 'compact size encoding preserves string whitespace');
select is(private.upload_source_manifest_digest(pg_temp.normalize_source(
  jsonb_set(jsonb_set(pg_temp.source_manifest(),'{archiveByteLength}','1370.0'),'{parts,2,crc32}','3329854434.000'))),
  private.upload_source_manifest_digest(pg_temp.normalize_source(pg_temp.source_manifest())),
  'equivalent integral JSON spellings have the same database digest');
select isnt(private.upload_source_manifest_digest(pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),
  '{mainPart,source,nodes,0,text}','"Edited source words"'))),
  private.upload_source_manifest_digest(pg_temp.normalize_source(pg_temp.source_manifest())),
  'whole-manifest digest covers node wording beyond archive and roster identity');
select throws_ok($$select pg_temp.normalize_source(null)$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','SQL null manifest rejects');
select throws_ok($$select pg_temp.normalize_source('null')$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','JSON null manifest rejects');
select throws_ok($$select pg_temp.normalize_source(pg_temp.source_manifest() - 'parts')$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','missing manifest field rejects');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{archiveByteLength}','"1370"'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','string length is not coerced');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{parts,2,crc32}','4294967296'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','CRC beyond unsigned 32-bit rejects');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{parts,2,crc32}','null'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','null CRC rejects');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{parts,2,compressionMethod}','0.5'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','fractional compression method rejects');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{mainPart,source,nodes,0,start}','null'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','one-sided null source range rejects');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{mainPart,source,nodes,0,xmlSpace}','null'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','null XML whitespace policy rejects');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{blockers}','[]'))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','source-only blockers cannot be removed');
select throws_ok($$select pg_temp.normalize_source(jsonb_set(pg_temp.source_manifest(),'{mainPart,source,nodes,0,text}',to_jsonb(chr(1))))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','illegal XML scalar rejects');

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
  ('71006160-0000-4000-8000-000000000001','source-owner@example.invalid',false,false,now(),now()),
  ('71006160-0000-4000-8000-000000000002','source-other@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id in (
  '71006160-0000-4000-8000-000000000001','71006160-0000-4000-8000-000000000002')),2,'two real owner fixtures exist');
set local role service_role;
select is(pg_temp.claim(1)->>'extraction_contract_version','upload-extraction.2','new upload captures source contract');
select is(pg_temp.advance(1,'prepared','storage_dispatched')->>'outcome','advanced','original retention is dispatched');
select is(pg_temp.advance(1,'storage_dispatched','storage_completed')->>'outcome','advanced','retained original stage is accepted');
select is(public.load_upload_extraction_snapshot(pg_temp.upload_id(1),
  '71006160-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(1))->>'extraction_contract_version',
  'upload-extraction.2','extractor snapshot returns the accepted contract');
select is(pg_temp.checkpoint(1),null::jsonb,'no checkpoint is invented');
select throws_ok($$select pg_temp.advance(1,'storage_completed','provider_dispatched')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','provider dispatch needs a durable v2 checkpoint');
select throws_ok($$select pg_temp.record(1,null)$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','DOCX recording requires source');
select throws_ok($$select pg_temp.record(1,'null')$$,'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','JSON null is not a DOCX source');
select throws_ok($$select pg_temp.record(1,null,'upload-extraction.2','text')$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','accepted DOCX cannot downgrade to source-absent text');
select throws_ok($$select pg_temp.record(1,null,'upload-extraction.1')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','old caller cannot downgrade an accepted v2 contract');
select is(pg_temp.record(1)->>'outcome','recorded','source and text checkpoint record atomically');
select is(pg_temp.checkpoint(1)->'source_manifest',pg_temp.source_manifest(),'authoritative read returns the private exact source');
select is((select count(*)::integer from jsonb_object_keys(pg_temp.checkpoint(1))),11,'v2 checkpoint has a closed eleven-key body');
select is(pg_temp.checkpoint(1)->>'source_digest_version','upload-source-manifest-jsonb.1','database digest has a separate version');
select matches(pg_temp.checkpoint(1)->>'source_manifest_sha256','^[0-9a-f]{64}$','database returns its computed digest');
select is(pg_temp.record(1,jsonb_set(pg_temp.source_manifest(),'{archiveByteLength}','1370.00'))->>'outcome',
  'idempotent_replay','equivalent numeric replay keeps the same immutable checkpoint');
select throws_ok($$select pg_temp.record(1,'{}')$$,'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','malformed replacement retains conflict precedence');
select throws_ok($$select pg_temp.record(1,jsonb_set(pg_temp.source_manifest(),'{mainPart,source,nodes,0,text}','"Other words"'))$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','same archive/roster with different source wording cannot replace checkpoint');
select is(public.get_upload_extraction_checkpoint(pg_temp.upload_id(1),
  '71006160-0000-4000-8000-000000000002',repeat('a',64),pg_temp.token(1)),null::jsonb,'other positive owner cannot read checkpoint');
select is(public.get_upload_extraction_checkpoint(pg_temp.upload_id(1),
  '71006160-0000-4000-8000-000000000001',repeat('b',64),pg_temp.token(1)),null::jsonb,'different request cannot read checkpoint');
select is(public.get_upload_extraction_checkpoint(pg_temp.upload_id(1),
  '71006160-0000-4000-8000-000000000001',repeat('a',64),'73006160-0000-4000-8000-000000000099'),null::jsonb,'stale claim cannot read checkpoint');

reset role;
create temporary table accepted_source_before as select ingest_claim_token,ingest_source_manifest,ingest_source_manifest_sha256
  from public.uploads where id=pg_temp.upload_id(1);
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '121 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.upload_id(1);
set local role service_role;
select is(pg_temp.claim(1,'upload-extraction.1')->>'extraction_contract_version','upload-extraction.2','resume adopts accepted version despite old preference');
select is(pg_temp.record(1)->>'outcome','idempotent_replay','new lease adopts the same checkpoint');
reset role;
select isnt((select ingest_claim_token from public.uploads where id=pg_temp.upload_id(1)),
  (select ingest_claim_token from accepted_source_before),'expired claim actually changed');
select is((select ingest_source_manifest_sha256 from public.uploads where id=pg_temp.upload_id(1)),
  (select ingest_source_manifest_sha256 from accepted_source_before),'digest remains unchanged across claim handoff');
select throws_ok($$update public.uploads set ingest_extraction_contract_version='upload-extraction.1' where id=pg_temp.upload_id(1)$$,
  'P0001','UPLOAD_EXTRACTION_CONTRACT_IMMUTABLE','accepted version cannot be rewritten');
select throws_ok($$update public.uploads set ingest_source_manifest=null where id=pg_temp.upload_id(1)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','recorded source cannot be cleared');
set local role service_role;
select is(pg_temp.advance(1,'storage_completed','provider_dispatched')->>'outcome','advanced','provider starts only after durable source');
select is(pg_temp.advance(1,'storage_completed','provider_dispatched')->>'outcome','idempotent_replay','same dispatch is idempotent');
select throws_ok($$select pg_temp.complete(1,pg_temp.completed_response(1)||jsonb_build_object('source_manifest',pg_temp.source_manifest()),pg_temp.completed_payload())$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','private manifest cannot enter a public completed replay');
select throws_ok($$select pg_temp.complete(1,pg_temp.completed_response(1),pg_temp.completed_payload()||jsonb_build_object('nested',jsonb_build_object('sourceManifest',pg_temp.source_manifest())))$$,
  'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID','nested source metadata cannot enter extraction payload');
select throws_ok($$select pg_temp.complete(1,jsonb_set(pg_temp.completed_response(1),'{extracted_text}','"Different words"'),pg_temp.completed_payload())$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','completed public wording must match checkpoint');
select throws_ok($$select pg_temp.complete(1,pg_temp.completed_response(1),jsonb_set(pg_temp.completed_payload(),'{truncated}','true'))$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','completed truncation must match checkpoint');
select throws_ok($$select pg_temp.complete(1,jsonb_set(pg_temp.completed_response(1),'{extraction_format}','"text"'),pg_temp.completed_payload())$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','completed format must match checkpoint');
select is(pg_temp.complete(1,pg_temp.completed_response(1),pg_temp.completed_payload())->>'outcome','settled','exact completed result settles');
select is(pg_temp.complete(1,pg_temp.completed_response(1),pg_temp.completed_payload())->>'outcome','idempotent_replay','exact completed result replays');
select is(pg_temp.claim(1)->'response',pg_temp.completed_response(1),'terminal claim returns the exact public response without private source');

-- Old positional calls retain old request defaults and literal response shapes.
select is(public.claim_upload_ingest(pg_temp.upload_id(2),'71006160-0000-4000-8000-000000000001',
  '71006160-0000-4000-8000-000000000001/'||pg_temp.upload_id(2)::text||'/legacy.txt',
  'text/plain','legacy.txt',25,repeat('a',64),pg_temp.source_manifest()->>'archiveSha256')->>'outcome','accepted','old eight-argument claim still resolves');
select is(pg_temp.advance(2,'prepared','storage_dispatched')->>'outcome','advanced','legacy storage dispatch works');
select is(pg_temp.advance(2,'storage_dispatched','storage_completed')->>'outcome','advanced','legacy storage acknowledgement works');
select is(public.record_upload_extraction_snapshot(pg_temp.upload_id(2),
  '71006160-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(2),
  pg_temp.source_manifest()->>'archiveSha256',pg_temp.sha('Format protected document'),
  'Format protected document','text',false,'upload-resource-policy.1')->>'outcome','recorded','old ten-argument record still resolves');
select is(pg_temp.checkpoint(2),jsonb_build_object('content_sha256',pg_temp.source_manifest()->>'archiveSha256',
  'text_sha256',pg_temp.sha('Format protected document'),'text','Format protected document','format','text',
  'truncated',false,'resource_policy_version','upload-resource-policy.1'),'v1 checkpoint is exactly the old six fields');

select is(pg_temp.claim(3)->>'outcome','accepted','early-failure v2 fixture is accepted');
select is(pg_temp.advance(3,'prepared','storage_dispatched')->>'outcome','advanced','early-failure storage dispatch');
select is(pg_temp.advance(3,'storage_dispatched','storage_completed')->>'outcome','advanced','early-failure retained original');
reset role;
select throws_ok($$update public.uploads set ingest_extraction_format='docx' where id=pg_temp.upload_id(3)$$,
  '23514',null,'incomplete v2 tuple cannot pass a SQL UNKNOWN check');
set local role service_role;
select throws_ok($$select public.settle_upload_ingest(pg_temp.upload_id(3),'71006160-0000-4000-8000-000000000001',
  repeat('a',64),'failed',422,jsonb_build_object('upload_id',pg_temp.upload_id(3),'error',jsonb_build_object('source_manifest',pg_temp.source_manifest())),
  null,'{}','UPLOAD_FORMAT_UNSUPPORTED',pg_temp.token(3))$$,'P0001','UPLOAD_INGEST_SOURCE_PRIVACY_INVALID',
  'private source cannot leak through an extensible failure envelope');
select is(public.settle_upload_ingest(pg_temp.upload_id(3),'71006160-0000-4000-8000-000000000001',
  repeat('a',64),'failed',422,jsonb_build_object('upload_id',pg_temp.upload_id(3),'error','synthetic parser rejection',
    'confirm_payload',jsonb_build_object('structure','synthetic scalar failure detail')),
  null,'{}','UPLOAD_FORMAT_UNSUPPORTED',pg_temp.token(3))->>'outcome','settled',
  'early parser failure remains valid without an invented source checkpoint');

select is(public.claim_upload_ingest(pg_temp.upload_id(4),'71006160-0000-4000-8000-000000000001',
  '71006160-0000-4000-8000-000000000001/'||pg_temp.upload_id(4)::text||'/source.txt',
  'text/plain','source.txt',25,repeat('a',64),pg_temp.source_manifest()->>'archiveSha256','upload-extraction.2')->>'outcome',
  'accepted','new plain-text source contract fixture is accepted');
select is(pg_temp.advance(4,'prepared','storage_dispatched')->>'outcome','advanced','text original dispatch');
select is(pg_temp.advance(4,'storage_dispatched','storage_completed')->>'outcome','advanced','text original retained');
select throws_ok($$select pg_temp.record(4,pg_temp.source_manifest(),'upload-extraction.2','text')$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','non-DOCX cannot record a DOCX source map');
select throws_ok($$select pg_temp.record(4,'null','upload-extraction.2','text')$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','non-DOCX RPC requires SQL null rather than JSONB null');
select is(pg_temp.record(4,null,'upload-extraction.2','text')->>'outcome','recorded','non-DOCX v2 stores explicit source absence');
select is((select count(*)::integer from jsonb_object_keys(pg_temp.checkpoint(4))),11,'non-DOCX v2 retains the full closed checkpoint');
select is(pg_temp.checkpoint(4)->'source_manifest','null'::jsonb,'non-DOCX checkpoint source is explicit JSON null');
select is(pg_temp.checkpoint(4)->'source_manifest_sha256','null'::jsonb,'non-DOCX does not invent a source digest');
select is(pg_temp.checkpoint(4)->'source_digest_version','null'::jsonb,'non-DOCX does not invent a digest version');
select is(pg_temp.advance(4,'storage_completed','provider_dispatched')->>'outcome','advanced','durable text source can dispatch');
reset role;
update public.uploads set ingest_heartbeat_at=clock_timestamp()-interval '121 seconds',
  ingest_lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.upload_id(4);
set local role service_role;
select throws_ok($$select pg_temp.advance(4,'storage_completed','provider_dispatched')$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','expired v2 dispatch cannot bypass the gate through same-stage replay');

select is(public.claim_upload_ingest(pg_temp.upload_id(5),'71006160-0000-4000-8000-000000000001',
  '71006160-0000-4000-8000-000000000001/'||pg_temp.upload_id(5)::text||'/unicode.txt',
  'text/plain','unicode.txt',40001,repeat('a',64),pg_temp.source_manifest()->>'archiveSha256','upload-extraction.2')->>'outcome',
  'accepted','Unicode boundary fixture is accepted');
select is(pg_temp.advance(5,'prepared','storage_dispatched')->>'outcome','advanced','Unicode original dispatch');
select is(pg_temp.advance(5,'storage_dispatched','storage_completed')->>'outcome','advanced','Unicode original retention');
select throws_ok($$select public.record_upload_extraction_snapshot(pg_temp.upload_id(5),
  '71006160-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(5),pg_temp.source_manifest()->>'archiveSha256',
  pg_temp.sha(repeat('😀',10000)||'x'),repeat('😀',10000)||'x','text',false,'upload-resource-policy.1','upload-extraction.2',null)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_INVALID','one unit beyond the UTF-16 checkpoint limit rejects');
select is(public.record_upload_extraction_snapshot(pg_temp.upload_id(5),
  '71006160-0000-4000-8000-000000000001',repeat('a',64),pg_temp.token(5),pg_temp.source_manifest()->>'archiveSha256',
  pg_temp.sha(repeat('😀',10000)),repeat('😀',10000),'text',false,'upload-resource-policy.1','upload-extraction.2',null)->>'outcome',
  'recorded','exact 20000 UTF-16 units record successfully');
select is(pg_temp.checkpoint(5)->>'text',repeat('😀',10000),'Unicode checkpoint readback preserves exact wording');

reset role;

-- A provider-stage replay must check its lease after waiting for the owner lock.
-- These two sessions use this disposable database's authenticated TCP endpoint.
create or replace function pg_temp.require_local_test_sessions(p_names text[])
returns boolean
language plpgsql
set search_path = ''
as $function$
declare
  v_name text;
  v_remote record;
  v_cluster bigint := (select system_identifier from pg_catalog.pg_control_system());
  v_backends integer[] := array[pg_catalog.pg_backend_pid()];
begin
  if cardinality(p_names) is distinct from 2 then
    raise exception 'DATABASE_TEST_SESSION_IDENTITY_MISMATCH';
  end if;
  foreach v_name in array p_names loop
    select * into strict v_remote
    from extensions.dblink(
      v_name,
      'select current_database()::text, system_identifier, pg_backend_pid() from pg_catalog.pg_control_system()'
    ) as identity(database_name text, cluster_id bigint, backend_pid integer);
    if v_remote.database_name is distinct from pg_catalog.current_database()::text
      or v_remote.cluster_id is distinct from v_cluster
      or v_remote.backend_pid is null
      or v_remote.backend_pid = any(v_backends) then
      raise exception 'DATABASE_TEST_SESSION_IDENTITY_MISMATCH';
    end if;
    v_backends := array_append(v_backends, v_remote.backend_pid);
  end loop;
  return true;
end;
$function$;

-- Use this server's TCP address, not a Docker name or loopback trust rule.
-- Supabase's postgres role is not a superuser: dblink must actually authenticate
-- with the supplied synthetic local password. Unix sockets/loopback fail closed.
create or replace function pg_temp.local_test_connection_string()
returns text
language plpgsql
set search_path = ''
as $function$
declare
  v_address inet := pg_catalog.inet_server_addr();
begin
  if v_address is null
    or v_address <<= '127.0.0.0/8'::inet
    or v_address = '::1'::inet then
    raise exception 'DATABASE_TEST_NON_LOOPBACK_TCP_REQUIRED';
  end if;
  return pg_catalog.format(
    'hostaddr=%s port=%s dbname=%L user=postgres password=postgres connect_timeout=5',
    pg_catalog.host(v_address), pg_catalog.current_setting('port'), pg_catalog.current_database()
  );
end;
$function$;

create or replace function pg_temp.wait_for_advisory_lock(
  p_backend_pid integer,
  p_timeout interval default interval '2 seconds'
) returns boolean
language plpgsql
as $function$
declare
  v_deadline timestamptz := clock_timestamp() + p_timeout;
  v_waiting boolean;
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    select exists(
      select 1
      from pg_catalog.pg_stat_activity
      where pid = p_backend_pid
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) into v_waiting;
    if v_waiting then return true; end if;
    if clock_timestamp() >= v_deadline then return false; end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;


select extensions.dblink_connect(
  'source_lease_a',
  pg_temp.local_test_connection_string()
);
select extensions.dblink_connect(
  'source_lease_b',
  pg_temp.local_test_connection_string()
);
select ok(pg_temp.require_local_test_sessions(array['source_lease_a','source_lease_b']),
  'source lease fixture has independent backends in the accepted database/cluster');
select extensions.dblink_exec('source_lease_a', 'set statement_timeout = 5000');
select extensions.dblink_exec('source_lease_b', 'set statement_timeout = 5000');
select extensions.dblink_exec('source_lease_a', $remote$
do $setup$
declare v_claim jsonb; v_token uuid;
begin
  insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at)
  values ('71006160-0000-4000-8000-000000000098','source-lease@example.invalid',false,false,now(),now());
  v_claim := public.claim_upload_ingest('72006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098/72006160-0000-4000-8000-000000000098/source.txt',
    'text/plain','source.txt',4,repeat('a',64),repeat('c',64),'upload-extraction.2');
  if v_claim->>'outcome' is distinct from 'accepted' then raise exception 'SOURCE_LEASE_FIXTURE_NOT_ACCEPTED'; end if;
  v_token := (v_claim->>'claim_token')::uuid;
  perform public.advance_upload_ingest('72006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098',repeat('a',64),v_token,'prepared','storage_dispatched');
  perform public.advance_upload_ingest('72006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098',repeat('a',64),v_token,'storage_dispatched','storage_completed');
  perform public.record_upload_extraction_snapshot('72006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098',repeat('a',64),v_token,repeat('c',64),
    encode(extensions.digest(convert_to('text','UTF8'),'sha256'),'hex'),'text','text',false,
    'upload-resource-policy.1','upload-extraction.2',null);
  perform public.advance_upload_ingest('72006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098',repeat('a',64),v_token,'storage_completed','provider_dispatched');
end
$setup$;
$remote$);
select ok((select ingest_stage='provider_dispatched' and ingest_lease_expires_at>clock_timestamp()
  from public.uploads where id='72006160-0000-4000-8000-000000000098'),
  'positive committed v2 fixture has a checkpoint, provider stage and live lease');
select extensions.dblink_exec('source_lease_b', $remote$
create function pg_temp.try_source_replay() returns text language plpgsql as $attempt$
declare v_token uuid; v_result jsonb;
begin
  select ingest_claim_token into strict v_token from public.uploads
  where id='72006160-0000-4000-8000-000000000098';
  v_result := public.advance_upload_ingest('72006160-0000-4000-8000-000000000098',
    '71006160-0000-4000-8000-000000000098',repeat('a',64),v_token,'storage_completed','provider_dispatched');
  return v_result->>'outcome';
exception when others then return sqlerrm;
end
$attempt$;
$remote$);
create temp table source_lease_waiter(pid integer not null);
insert into source_lease_waiter select pid from extensions.dblink('source_lease_b',
  'select pg_backend_pid()') as remote_backend(pid integer);
select extensions.dblink_exec('source_lease_a', 'begin');
select extensions.dblink_exec('source_lease_a', $remote$do $lock$
begin perform pg_advisory_xact_lock(hashtextextended('71006160-0000-4000-8000-000000000098',91000)); end
$lock$;$remote$);
select is(extensions.dblink_send_query('source_lease_b','select pg_temp.try_source_replay()'),1,
  'v2 replay is dispatched asynchronously while its lease is live');
select ok(pg_temp.wait_for_advisory_lock(pid), 'replay is actually waiting behind the owner lock')
from source_lease_waiter;
-- Expire only after observing the wait. The caller's entry timestamp is now old.
select extensions.dblink_exec('source_lease_a', $remote$update public.uploads
  set ingest_lease_expires_at=clock_timestamp()
  where id='72006160-0000-4000-8000-000000000098'$remote$);
select extensions.dblink_exec('source_lease_a','commit');
select is((select result from extensions.dblink_get_result('source_lease_b') as replay(result text)),
  'UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','v2 replay rejects a lease that expired during lock wait');
select is((select count(*)::integer from extensions.dblink_get_result('source_lease_b') as drained(result text)),
  0,'source replay asynchronous result is completely drained');
select is((select ingest_stage from public.uploads where id='72006160-0000-4000-8000-000000000098'),
  'provider_dispatched','expired replay does not change the durable stage');
select extensions.dblink_exec('source_lease_a', $remote$delete from public.uploads
  where id='72006160-0000-4000-8000-000000000098' and user_id='71006160-0000-4000-8000-000000000098'$remote$);
select extensions.dblink_exec('source_lease_a', $remote$delete from auth.users
  where id='71006160-0000-4000-8000-000000000098'$remote$);
select extensions.dblink_disconnect('source_lease_a');
select extensions.dblink_disconnect('source_lease_b');
select is((select count(*)::integer from auth.users where id='71006160-0000-4000-8000-000000000098'),
  0,'only the exact committed source lease fixture is removed');

select * from finish();
rollback;
