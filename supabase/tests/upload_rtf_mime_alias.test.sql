begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Database command proof only. The JS roundtrip separately parses actual RTF
-- bytes; SQL binds the submitted source/hash and cannot prove file syntax.
create function pg_temp.alias_bytes() returns bytea language sql as $function$
  select convert_to(E'{\\rtf1\\ansi Keep the original words.}', 'UTF8')
$function$;
create function pg_temp.alias_text() returns text language sql as $function$
  select 'Keep the original words.'::text
$function$;
create function pg_temp.alias_sha(p_bytes bytea) returns text language sql as $function$
  select encode(extensions.digest(p_bytes,'sha256'),'hex')
$function$;
create function pg_temp.alias_manifest() returns jsonb language sql as $function$
  select jsonb_build_object('version','rtf-source-manifest.1','assessment','source_only',
    'originalSha256',pg_temp.alias_sha(pg_temp.alias_bytes()),
    'originalByteLength',octet_length(pg_temp.alias_bytes()),
    'extractedTextSha256',pg_temp.alias_sha(convert_to(pg_temp.alias_text(),'UTF8')),
    'blockers',jsonb_build_array('rtf-format-preserving-editing-unverified'))
$function$;
create function pg_temp.alias_id(p_slot integer) returns uuid language sql as $function$
  select ('72007094-0000-8000-8000-'||lpad(p_slot::text,12,'0'))::uuid
$function$;
create function pg_temp.alias_token(p_slot integer) returns uuid language sql as $function$
  select ingest_claim_token from public.uploads where id=pg_temp.alias_id(p_slot)
$function$;
create function pg_temp.alias_checkpoint(p_slot integer) returns jsonb language sql as $function$
  select public.get_upload_extraction_checkpoint(pg_temp.alias_id(p_slot),
    '71007094-0000-4000-8000-000000000001',repeat('a',64),pg_temp.alias_token(p_slot))
$function$;
create function pg_temp.alias_record(p_slot integer,p_format text default 'rtf',
  p_manifest jsonb default pg_temp.alias_manifest()) returns jsonb language sql as $function$
  select public.record_upload_extraction_snapshot(pg_temp.alias_id(p_slot),
    '71007094-0000-4000-8000-000000000001',repeat('a',64),pg_temp.alias_token(p_slot),
    pg_temp.alias_sha(pg_temp.alias_bytes()),pg_temp.alias_sha(convert_to(pg_temp.alias_text(),'UTF8')),
    pg_temp.alias_text(),p_format,false,
    case when u.ingest_extraction_contract_version='upload-extraction.3'
      then 'upload-resource-policy.2' else 'upload-resource-policy.1' end,
    u.ingest_extraction_contract_version,p_manifest)
  from public.uploads u where u.id=pg_temp.alias_id(p_slot)
$function$;
create function pg_temp.try_alias_record(p_slot integer) returns jsonb language plpgsql as $function$
begin
  return pg_temp.alias_record(p_slot);
exception when others then
  -- Expose exact synthetic command errors to assertions without aborting the
  -- following independent row/snapshot checks when demonstrating the defect.
  return jsonb_build_object('error_code',sqlstate,'error_message',sqlerrm);
end;
$function$;

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at)
values('71007094-0000-4000-8000-000000000001','rtf-alias-owner@example.invalid',false,false,now(),now());
select is((select count(*)::integer from auth.users where id='71007094-0000-4000-8000-000000000001'),
  1,'alias owner fixture is positively created');

set local role service_role;
create temporary table alias_fixtures(slot integer primary key,filename text,mime text,version text);
insert into alias_fixtures values
  (1,'source.rtf','rtf','upload-extraction.3'),
  (2,'source.md','rtf','upload-extraction.3'),
  (3,'source.rtf','rtf; charset=utf-8','upload-extraction.3'),
  (4,'source.md','text/markdown','upload-extraction.3'),
  (5,'source.rtf','rtf','upload-extraction.1'),
  (6,'source.rtf','rtf','upload-extraction.2'),
  (7,U&'SOURCE.\FF32\FF34\FF26',U&'\00A0\FF32\FF34\FF26\FEFF','upload-extraction.3'),
  (8,'source.md','rtf','upload-extraction.3');
select is(public.claim_upload_ingest(pg_temp.alias_id(slot),'71007094-0000-4000-8000-000000000001',
  '71007094-0000-4000-8000-000000000001/'||pg_temp.alias_id(slot)::text||'/'||filename,
  mime,filename,octet_length(pg_temp.alias_bytes()),repeat('a',64),
  pg_temp.alias_sha(pg_temp.alias_bytes()),version)->>'outcome','accepted',
  'alias fixture '||slot::text||' is accepted through the existing command') from alias_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.alias_id(slot),'71007094-0000-4000-8000-000000000001',
  repeat('a',64),pg_temp.alias_token(slot),'prepared','storage_dispatched')->>'outcome','advanced',
  'alias fixture '||slot::text||' starts retaining the original') from alias_fixtures order by slot;
select is(public.advance_upload_ingest(pg_temp.alias_id(slot),'71007094-0000-4000-8000-000000000001',
  repeat('a',64),pg_temp.alias_token(slot),'storage_dispatched','storage_completed')->>'outcome','advanced',
  'alias fixture '||slot::text||' records retention') from alias_fixtures order by slot;
select is((select count(*)::integer from public.uploads u join alias_fixtures f on u.id=pg_temp.alias_id(f.slot)),
  8,'every owned upload exists before positive or denial assertions');

select throws_ok($$select pg_temp.alias_record(1,'text',null)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF filename and alias cannot be downgraded to source-absent text');
select throws_ok($$select pg_temp.alias_record(1,'rtf',null)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','alias never permits an absent RTF manifest');
select throws_ok($$select pg_temp.alias_record(1,'rtf',jsonb_set(pg_temp.alias_manifest(),
  '{extractedTextSha256}',to_jsonb(repeat('f',64))))$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','alias never permits a different preview digest');
select is(pg_temp.alias_checkpoint(1),null::jsonb,'rejected candidates have not created a partial checkpoint');

select is(pg_temp.try_alias_record(1)->>'outcome','recorded','bare RTF alias records through the same versioned command');
select is(pg_temp.alias_checkpoint(1)->>'text',pg_temp.alias_text(),'checkpoint returns the exact RTF wording');
select is(pg_temp.alias_checkpoint(1)->'source_manifest',pg_temp.alias_manifest(),'checkpoint retains the exact source-only manifest');
select is(pg_temp.alias_checkpoint(1)->>'extraction_contract_version','upload-extraction.3','alias retains accepted contract v3');
select is(pg_temp.alias_checkpoint(1)->>'resource_policy_version','upload-resource-policy.2','alias retains v3 resource policy');
select is(pg_temp.alias_checkpoint(1)->>'source_digest_version','upload-source-manifest-jsonb.1','alias retains database digest domain');
select is(pg_temp.try_alias_record(1)->>'outcome','idempotent_replay','same alias checkpoint replays without another row');
select is((select file_type from public.uploads where id=pg_temp.alias_id(1)),'rtf','stored MIME remains literal');
select is((select file_name from public.uploads where id=pg_temp.alias_id(1)),'source.rtf','stored filename remains literal');
select is((select ingest_request_sha256 from public.uploads where id=pg_temp.alias_id(1)),repeat('a',64),'request identity is unchanged');
select is((select ingest_content_sha256 from public.uploads where id=pg_temp.alias_id(1)),
  pg_temp.alias_sha(pg_temp.alias_bytes()),'original content identity is unchanged');

select throws_ok($$select pg_temp.alias_record(2,'text',null)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF MIME alias cannot become a Markdown text checkpoint');
-- Separate positive fixture: a defective successful text write in slot 2 must
-- not turn this metadata rejection into a checkpoint-replay conflict.
select throws_ok($$select pg_temp.alias_record(8)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','RTF MIME alias cannot override the required filename extension');
select is(pg_temp.alias_checkpoint(2),null::jsonb,'conflicting metadata leaves no partial checkpoint');
select throws_ok($$select pg_temp.alias_record(3)$$,
  'P0001','UPLOAD_SOURCE_MANIFEST_INVALID','parameterized alias remains unsupported');
select is(pg_temp.alias_record(4,'text',null)->>'outcome','recorded','ordinary Markdown remains accepted');
select is(pg_temp.alias_checkpoint(4)->'source_manifest','null'::jsonb,'ordinary text keeps explicit source absence');
select throws_ok($$select pg_temp.alias_record(5)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_INVALID','v1 does not gain the RTF format');
select throws_ok($$select pg_temp.alias_record(6)$$,
  'P0001','UPLOAD_EXTRACTION_CHECKPOINT_INVALID','v2 does not gain the RTF format');
select is(pg_temp.try_alias_record(7)->>'outcome','recorded','existing NFKC and whitespace metadata rules cover the same bare alias');
select is((select file_type from public.uploads where id=pg_temp.alias_id(7)),
  U&'\00A0\FF32\FF34\FF26\FEFF','normalization does not rewrite the original metadata');
reset role;
select is(pg_temp.alias_checkpoint(1)->>'source_manifest_sha256',
  private.upload_source_manifest_digest(pg_temp.alias_manifest()),'database source digest independently matches the accepted manifest');

select * from finish();
rollback;
