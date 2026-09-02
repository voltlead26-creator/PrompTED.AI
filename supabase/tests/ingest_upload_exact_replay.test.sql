begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean language plpgsql as $function$
begin execute p_sql; return false;
exception when others then return sqlerrm like p_pattern;
end;
$function$;

create or replace function pg_temp.legacy_pdf_binding(
  p_user_id uuid,
  p_request_id uuid,
  p_binding_character text,
  p_renderer_character text,
  p_target_kind text default 'inline',
  p_target_id uuid default null,
  p_target_revision integer default null,
  p_approved_revision integer default null
) returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'binding_version','prompted.legacy-pdf-export.v2',
    'binding_sha256',pg_catalog.repeat(p_binding_character,64),
    'target_kind',p_target_kind,
    'target_id',p_target_id,
    'target_revision',p_target_revision,
    'approved_revision',p_approved_revision,
    'target_identity_sha256',pg_catalog.repeat('1',64),
    'format','pdf',
    'input_sha256',pg_catalog.repeat('2',64),
    'html_sha256',pg_catalog.repeat('3',64),
    'renderer_policy_sha256',pg_catalog.repeat('4',64),
    'renderer_resource_sha256',pg_catalog.repeat(p_renderer_character,64),
    'storage_path',p_user_id::text || '/' || p_request_id::text || '/legacy.pdf',
    'storage_path_sha256',pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          p_user_id::text || '/' || p_request_id::text || '/legacy.pdf',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    'filename','legacy.pdf'
  )
$function$;

create or replace function pg_temp.legacy_pdf_validation(p_byte_length integer)
returns jsonb
language sql
immutable
as $function$
  select pg_catalog.jsonb_build_object(
    'passed',true,
    'artifact_inspected',true,
    'inspection_contract','prompted.rendered-pdf.v1',
    'byte_length',p_byte_length,
    'content_sha256',pg_catalog.repeat('5',64),
    'section_order_sha256',pg_catalog.repeat('6',64),
    'content_type','application/pdf',
    'checks',pg_catalog.jsonb_build_object(
      'transport_envelope',true,
      'inspection_version',true,
      'renderer_status',true,
      'renderer_structural',true,
      'content_matches',true,
      'section_order_matches',true,
      'artifact_hash_matches',true
    )
  )
$function$;

select has_column('public','uploads','ingest_request_sha256','upload request identity is durable');
select has_column('public','uploads','ingest_content_sha256','upload content identity is durable');
select has_column('public','uploads','ingest_stage','upload side-effect stage is durable');
select has_column('public','uploads','ingest_claim_token','upload execution claim is durable');
select has_column('public','uploads','ingest_lease_expires_at','upload execution lease is durable');
select has_column('public','uploads','ingest_response','terminal HTTP response is replayable');
select has_column('private','user_storage_dispatches','reconciliation_evidence_sha256','Storage reconciliation evidence is durable');
select has_column('private','user_external_egress_dispatches','reconciliation_evidence_sha256','external-egress reconciliation evidence is durable');
select has_table('private','legacy_pdf_export_receipts','explicit legacy PDF replay has one private durable receipt');
select has_column('private','legacy_pdf_export_receipts','binding_sha256','legacy PDF receipt binds the canonical request');
select has_column('private','legacy_pdf_export_receipts','artifact_validation_result','legacy PDF receipt retains inspection evidence before upload');
select has_column('private','legacy_pdf_export_receipts','history_id','legacy PDF receipt binds exactly one export-history row');
select has_function('public','claim_user_external_egress',
  array['uuid','text','text','text','uuid'],
  'external-egress claim signature is stable');
select has_function('public','complete_user_external_egress',
  array['uuid','text','text','text','uuid','text'],
  'external-egress completion signature is stable');
select has_function('public','reconcile_user_external_egress',
  array['uuid','text','text','text','text','text'],
  'external-egress reconciliation signature is stable');
select has_function('public','claim_user_storage_dispatch',
  array['uuid','uuid','text','text','text','uuid'],
  'captured Storage claim signature binds path, artifact, and execution token');
select has_function('public','get_captured_document_export_receipt',
  array['uuid','uuid','uuid'],
  'captured export replay receipt signature is stable');
select has_function('public','load_legacy_export_snapshot',
  array['uuid','uuid','uuid'],
  'legacy export parent and child wording share one owner-bound snapshot');
select ok(exists(
  select 1
  from pg_catalog.pg_proc function_record
  join pg_catalog.pg_namespace namespace_record
    on namespace_record.oid=function_record.pronamespace
  where namespace_record.nspname='public'
    and function_record.proname='load_legacy_export_snapshot'
    and function_record.provolatile='s'
    and function_record.prosecdef
    and function_record.proconfig @> array['search_path=""']::text[]
), 'legacy export snapshot is stable, fixed-path, and security-definer');
select has_function('public','claim_legacy_pdf_export',
  array['uuid','uuid','jsonb'],
  'legacy PDF claim binds owner, request, and canonical identity');
select has_function('public','claim_persisted_pdf_export',
  array['uuid','uuid','jsonb'],
  'active PDF export claims require one persisted target');
select has_function('public','get_legacy_pdf_export_binding',
  array['uuid','uuid'],
  'legacy PDF retry can load its hash-only historical renderer binding');
select has_function('public','record_legacy_pdf_export_artifact',
  array['uuid','uuid','text','text','integer','text','jsonb'],
  'legacy PDF artifact evidence is persisted before upload');
select has_function('public','complete_legacy_pdf_export',
  array['uuid','uuid','text'],
  'legacy PDF finalisation is one owner-bound command');
select has_function('public','mark_legacy_pdf_export_reconciliation',
  array['uuid','uuid','text','text'],
  'legacy PDF ambiguity is durable and explicit');
select has_function('public','advance_upload_ingest',
  array['uuid','uuid','text','uuid','text','text'],
  'ingest stage transition signature is stable');
select has_trigger(
  'storage','objects','user_storage_deletion_fence',
  'protected user Storage objects have an authoritative late-write fence'
);
select ok(exists(
  select 1
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private'
    and p.proname='enforce_user_storage_deletion_fence'
    and p.prosecdef
    and p.proconfig @> array['search_path=""']::text[]
    and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
), 'Storage late-write fence runs as a fixed-path trigger with no direct Data API grant');

select ok(
  not has_table_privilege('anon','private.account_deletion_fences','SELECT')
  and not has_table_privilege('authenticated','private.account_deletion_fences','SELECT')
  and not has_table_privilege('service_role','private.account_deletion_fences','SELECT')
  and not has_table_privilege('anon','private.user_storage_dispatches','SELECT')
  and not has_table_privilege('authenticated','private.user_storage_dispatches','SELECT')
  and not has_table_privilege('service_role','private.user_storage_dispatches','SELECT')
  and not has_table_privilege('anon','private.user_external_egress_dispatches','SELECT')
  and not has_table_privilege('authenticated','private.user_external_egress_dispatches','SELECT')
  and not has_table_privilege('service_role','private.user_external_egress_dispatches','SELECT')
  and not has_table_privilege('anon','private.legacy_pdf_export_receipts','SELECT')
  and not has_table_privilege('authenticated','private.legacy_pdf_export_receipts','SELECT')
  and not has_table_privilege('service_role','private.legacy_pdf_export_receipts','SELECT'),
  'private deletion and side-effect receipts have no direct Data API access'
);
select ok(
  has_table_privilege('service_role','public.uploads','SELECT')
  and not has_table_privilege('service_role','public.uploads','INSERT')
  and not has_table_privilege('service_role','public.uploads','UPDATE')
  and not has_table_privilege('service_role','public.uploads','DELETE'),
  'protected compute mutates uploads only through fixed commands'
);
select ok(not exists(
  select 1 from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=any(array[
    'claim_upload_ingest','advance_upload_ingest','settle_upload_ingest',
    'reconcile_upload_ingest_storage','claim_user_storage_dispatch',
    'complete_user_storage_dispatch','reconcile_user_storage_dispatch',
    'claim_user_external_egress','complete_user_external_egress',
    'reconcile_user_external_egress','begin_account_deletion_fence',
    'get_captured_document_export_receipt','load_legacy_export_snapshot',
    'claim_legacy_pdf_export',
    'get_legacy_pdf_export_binding',
    'record_legacy_pdf_export_artifact','complete_legacy_pdf_export',
    'mark_legacy_pdf_export_reconciliation'
  ]) and (
    not p.prosecdef or not (p.proconfig @> array['search_path=""']::text[])
    or not pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    or pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
  )
), 'all ingest, dispatch, reconciliation, and deletion RPCs are fixed-path service-only');

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at) values
('71000000-0000-4000-8000-000000000001','ingest-owner@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000002','ingest-other@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000003','delete-fence@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000004','provider-reconcile@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000005','storage-fence@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000006','legacy-export@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000007','legacy-other@example.invalid',false,false,now(),now()),
('71000000-0000-4000-8000-000000000008','legacy-delete@example.invalid',false,false,now(),now());

insert into public.documents(
  id,user_id,title,status,current_revision,approved_revision,unresolved_placeholders
) values (
  '79000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000006',
  'Snapshot document','approved',7,7,'[]'::jsonb
);
insert into public.sections(id,document_id,user_id,name,order_index,content,status,is_required)
values
  ('79100000-0000-4000-8000-000000000002',
   '79000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000006','Second',2,'wording N second','approved',true),
  ('79100000-0000-4000-8000-000000000001',
   '79000000-0000-4000-8000-000000000001',
   '71000000-0000-4000-8000-000000000006','First',1,'wording N first','approved',true);

set local role service_role;
select ok(pg_temp.raises_matching($sql$
  select public.claim_persisted_pdf_export(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000009',
    pg_temp.legacy_pdf_binding(
      '71000000-0000-4000-8000-000000000006',
      '77000000-0000-4000-8000-000000000009','9','6'
    )
  )
$sql$,'%PERSISTED_PDF_EXPORT_TARGET_REQUIRED%'),
  'the active export claim cannot create a new inline-only receipt');
select is(
  public.load_legacy_export_snapshot(
    '71000000-0000-4000-8000-000000000006',
    '79000000-0000-4000-8000-000000000001',null
  )#>>'{target,current_revision}',
  '7',
  'one legacy snapshot returns the exact parent revision'
);
select is(
  public.load_legacy_export_snapshot(
    '71000000-0000-4000-8000-000000000006',
    '79000000-0000-4000-8000-000000000001',null
  )#>>'{sections,0,content}',
  'wording N first',
  'one legacy snapshot returns child wording in deterministic ledger order'
);
select is(
  public.load_legacy_export_snapshot(
    '71000000-0000-4000-8000-000000000007',
    '79000000-0000-4000-8000-000000000001',null
  ),
  null::jsonb,
  'legacy snapshot does not expose another owner target'
);
reset role;
update public.sections
set content='wording N+1 first'
where id='79100000-0000-4000-8000-000000000001';
set local role service_role;
select is(
  public.load_legacy_export_snapshot(
    '71000000-0000-4000-8000-000000000006',
    '79000000-0000-4000-8000-000000000001',null
  )#>>'{target,current_revision}',
  '8',
  'a committed section edit advances the parent seen by the same snapshot'
);
select is(
  public.load_legacy_export_snapshot(
    '71000000-0000-4000-8000-000000000006',
    '79000000-0000-4000-8000-000000000001',null
  )#>>'{sections,0,content}',
  'wording N+1 first',
  'the advanced parent snapshot returns the matching committed wording'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['complete_user_external_egress']
  )#>>'{rpcs,0,argument_types}',
  'uuid, text, text, text, uuid, text',
  'release attestation reports the exact canonical RPC argument types'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['get_captured_document_export_receipt']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid, uuid',
  'release attestation reports the exact captured replay receipt signature'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['load_legacy_export_snapshot']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid, uuid',
  'release attestation reports the exact legacy export snapshot signature'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['claim_legacy_pdf_export']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid, jsonb',
  'release attestation reports the exact legacy PDF claim signature'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['get_legacy_pdf_export_binding']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid',
  'release attestation reports the exact legacy PDF binding lookup signature'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['record_legacy_pdf_export_artifact']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid, text, text, integer, text, jsonb',
  'release attestation reports the exact legacy PDF evidence signature'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['complete_legacy_pdf_export']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid, text',
  'release attestation reports the exact legacy PDF completion signature'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[], array['mark_legacy_pdf_export_reconciliation']
  )#>>'{rpcs,0,argument_types}',
  'uuid, uuid, text, text',
  'release attestation reports the exact legacy PDF reconciliation signature'
);

select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )
)->>'outcome','requested','one explicit legacy PDF UUID is bound before renderer work');
select ok(pg_temp.raises_matching($sql$
  select public.claim_legacy_pdf_export(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001',
    pg_catalog.jsonb_set(
      pg_temp.legacy_pdf_binding(
        '71000000-0000-4000-8000-000000000006',
        '77000000-0000-4000-8000-000000000001','a','7'
      ),
      '{input_sha256}',
      pg_catalog.to_jsonb(pg_catalog.repeat('f',64))
    )
  )
$sql$,'%LEGACY_PDF_EXPORT_BINDING_CONFLICT%'),
  'one owner/request UUID cannot be reused for different canonical input');
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000007',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000007',
    '77000000-0000-4000-8000-000000000001','b','8'
  )
)->>'outcome','requested','the same request UUID is isolated by authenticated owner');

select is(public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000006','render-service','pdf',repeat('7',64),
  '78000000-0000-4000-8000-000000000001'
)->>'outcome','accepted','legacy renderer dispatch is admitted exactly once');
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )
)->>'outcome','processing','concurrent legacy retry polls while renderer is active');
select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000006','render-service','pdf',repeat('7',64),
  '78000000-0000-4000-8000-000000000001','completed');
select is(public.record_legacy_pdf_export_artifact(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',repeat('a',64),repeat('c',64),140,
  'render-export.pdf.3',pg_temp.legacy_pdf_validation(140)
)->>'outcome','recorded','inspected artifact SHA, length, and evidence persist before upload');
select is(public.record_legacy_pdf_export_artifact(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',repeat('a',64),repeat('c',64),140,
  'render-export.pdf.3',pg_temp.legacy_pdf_validation(140)
)->>'outcome','idempotent_replay','lost evidence acknowledgement replays without changing evidence');
select is(public.claim_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001','legacy-export',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )->>'storage_path_sha256',repeat('c',64),
  '78000000-0000-4000-8000-000000000002'
)->>'outcome','accepted','legacy artifact upload is admitted only after evidence persistence');
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )
)->>'outcome','processing','exact retry does not race an active immutable upload');
insert into storage.objects(bucket_id,name) values(
  'captured-exports',
  '71000000-0000-4000-8000-000000000006/77000000-0000-4000-8000-000000000001/legacy.pdf'
);
reset role;
update private.user_storage_dispatches
set dispatched_at=clock_timestamp()-interval '2 seconds',
    lease_expires_at=clock_timestamp()-interval '1 second'
where operation_id='77000000-0000-4000-8000-000000000001'
  and dispatch_kind='legacy-export';
set local role service_role;
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )
)->>'outcome','storage_recovery','expired upload ack recovers only by exact object readback');
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )
)->>'storage_dispatch_token','78000000-0000-4000-8000-000000000002',
  'recovery returns only the original private dispatch token');
select is(public.complete_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001','legacy-export',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )->>'storage_path_sha256',repeat('c',64),
  '78000000-0000-4000-8000-000000000002'
)->>'outcome','completed','reinspected exact object seals the original Storage dispatch');
select is(public.complete_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',repeat('a',64)
)->>'outcome','completed','legacy PDF and export history finalise atomically');
select is(public.complete_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',repeat('a',64)
)->>'outcome','completed','lost final DB acknowledgement replays the exact completed receipt');
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000001',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000001','a','7'
  )
)->>'outcome','completed','lost HTTP response replays the exact stored-artifact receipt');
reset role;
select is((select count(*)::integer from public.export_history
  where user_id='71000000-0000-4000-8000-000000000006'
    and filename='legacy.pdf'),1,'exact replay creates no duplicate export history');
select ok(exists(select 1 from public.export_history history_record
  join private.legacy_pdf_export_receipts receipt_record
    on receipt_record.history_id=history_record.id
  where receipt_record.owner_user_id='71000000-0000-4000-8000-000000000006'
    and receipt_record.request_id='77000000-0000-4000-8000-000000000001'
    and history_record.validation_passed
    and history_record.validation_result->>'content_type'='application/pdf'),
  'history points to the one inspected durable legacy artifact');

set local role service_role;
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000002',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000002','c','9'
  )
)->>'outcome','requested','ambiguous-render fixture is accepted');
select public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000006','render-service','pdf',repeat('9',64),
  '78000000-0000-4000-8000-000000000003');
select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000006','render-service','pdf',repeat('9',64),
  '78000000-0000-4000-8000-000000000003','reconciliation_required');
select is(public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000006',
  '77000000-0000-4000-8000-000000000002',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000006',
    '77000000-0000-4000-8000-000000000002','c','9'
  )
)->>'outcome','reconciliation_required','ambiguous renderer is never dispatched twice');

reset role;
delete from auth.users where id='71000000-0000-4000-8000-000000000007';
select is((select count(*)::integer from private.legacy_pdf_export_receipts
  where owner_user_id='71000000-0000-4000-8000-000000000007'),0,
  'private legacy receipts cascade with the authenticated owner');

set local role service_role;
select public.claim_legacy_pdf_export(
  '71000000-0000-4000-8000-000000000008',
  '77000000-0000-4000-8000-000000000003',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000008',
    '77000000-0000-4000-8000-000000000003','d','e'
  )
);
select public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000008','render-service','pdf',repeat('e',64),
  '78000000-0000-4000-8000-000000000004'
);
select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000008','render-service','pdf',repeat('e',64),
  '78000000-0000-4000-8000-000000000004','completed'
);
select public.record_legacy_pdf_export_artifact(
  '71000000-0000-4000-8000-000000000008',
  '77000000-0000-4000-8000-000000000003',repeat('d',64),repeat('f',64),140,
  'render-export.pdf.3',pg_temp.legacy_pdf_validation(140)
);
select public.claim_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000008',
  '77000000-0000-4000-8000-000000000003','legacy-export',
  pg_temp.legacy_pdf_binding(
    '71000000-0000-4000-8000-000000000008',
    '77000000-0000-4000-8000-000000000003','d','e'
  )->>'storage_path_sha256',repeat('f',64),
  '78000000-0000-4000-8000-000000000005'
);
reset role;
insert into storage.objects(bucket_id,name) values(
  'captured-exports',
  '71000000-0000-4000-8000-000000000008/77000000-0000-4000-8000-000000000003/legacy.pdf'
);
set local role service_role;
select is(public.begin_account_deletion_fence(
  '71000000-0000-4000-8000-000000000008')->>'outcome','blocked',
  'account deletion waits for an in-flight legacy artifact upload');
reset role;
select ok(pg_temp.raises_matching($$insert into storage.objects(bucket_id,name) values(
  'captured-exports',
  '71000000-0000-4000-8000-000000000008/77000000-0000-4000-8000-000000000003/late.pdf'
)$$, '%ACCOUNT_DELETION_FENCED%'),
  'a legacy artifact cannot commit a second object after deletion is fenced');
update private.user_storage_dispatches
set dispatched_at=clock_timestamp()-interval '2 seconds',
    lease_expires_at=clock_timestamp()-interval '1 second'
where operation_id='77000000-0000-4000-8000-000000000003'
  and dispatch_kind='legacy-export';
set local role service_role;
select is(public.begin_account_deletion_fence(
  '71000000-0000-4000-8000-000000000008')->>'outcome','ready',
  'expired bounded Storage work cannot permanently deadlock deletion');
reset role;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id='captured-exports'
  and name like '71000000-0000-4000-8000-000000000008/%';
select set_config('storage.allow_delete_query', 'false', true);
delete from auth.users where id='71000000-0000-4000-8000-000000000008';
select is((select count(*)::integer from private.legacy_pdf_export_receipts
  where owner_user_id='71000000-0000-4000-8000-000000000008'),0,
  'legacy replay receipt cascades after its artifact is removed');
select is((select count(*)::integer from storage.objects
  where bucket_id='captured-exports'
    and name like '71000000-0000-4000-8000-000000000008/%'),0,
  'account deletion leaves no deterministic legacy PDF artifact');

set local role service_role;
select is(public.claim_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000001/resume.txt',
  'text/plain','resume.txt',20,repeat('a',64),repeat('b',64)
)->>'outcome','accepted','one stable upload request is atomically accepted');
select is(public.claim_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000001/resume.txt',
  'text/plain','resume.txt',20,repeat('a',64),repeat('b',64)
)->>'outcome','processing','live exact replay polls without duplicate work');
select ok(pg_temp.raises_matching(format($sql$select public.settle_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  repeat('a',64),'completed',200,
  '{"upload_id":"72000000-0000-4000-8000-000000000001","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Confirmed purpose","document_type":"resume","structure":[{"title":"Experience","items":["Reliable work"]}],"filename":"resume.txt","char_count":13,"truncated":false}}'::jsonb,
  'Retained text','{"original_retained":true,"classification_status":"completed"}'::jsonb,null,%L::uuid)$sql$,
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001')),
  '%UPLOAD_INGEST_SETTLEMENT_CONFLICT%'), 'settlement cannot skip durable side-effect stages');

select is(public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',repeat('a',64),
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001'),
  'prepared','storage_dispatched')->>'stage','storage_dispatched','Storage dispatch is durable before upload');
select ok(pg_temp.raises_matching($$select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',repeat('a',64),
  '99999999-9999-4999-8999-999999999999','storage_dispatched','storage_completed')$$,
  '%UPLOAD_INGEST_ADVANCE_CONFLICT%'), 'stale upload worker cannot advance');
select is(public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',repeat('a',64),
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001'),
  'storage_dispatched','storage_completed')->>'stage','storage_completed','exact retained-object proof advances Storage completion');
select is(public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',repeat('a',64),
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001'),
  'storage_completed','provider_dispatched')->>'stage','provider_dispatched','provider dispatch is durable before classification');
select ok(pg_temp.raises_matching(format($sql$select public.settle_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  repeat('a',64),'completed',200,
  '{"upload_id":"72000000-0000-4000-8000-000000000001","original_retained":true,"classification_status":"failed","confirm_payload":{"summary":"","document_type":"","structure":[]}}'::jsonb,
  'Retained text','{"original_retained":true,"classification_status":"failed"}'::jsonb,null,%L::uuid)$sql$,
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001')),
  '%UPLOAD_INGEST_SETTLEMENT_INVALID%'),
  'completed ingest cannot settle a failed or empty classification confirmation');
select ok(pg_temp.raises_matching(format($sql$select public.settle_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  repeat('a',64),'completed',200,
  '{"upload_id":"72000000-0000-4000-8000-000000000001","classification_status":"completed","confirm_payload":{"summary":"Confirmed purpose","document_type":"resume","structure":[{"title":"Experience","items":["Reliable work"]}],"filename":"resume.txt","char_count":13,"truncated":false}}'::jsonb,
  'Retained text','{"classification_status":"completed"}'::jsonb,null,%L::uuid)$sql$,
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001')),
  '%UPLOAD_INGEST_SETTLEMENT_INVALID%'),
  'missing retained-original confirmation is false, never SQL-null acceptance');
select ok(pg_temp.raises_matching(format($sql$select public.settle_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  repeat('a',64),'completed',200,
  '{"upload_id":"72000000-0000-4000-8000-000000000001","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Confirmed purpose","document_type":"resume","structure":[{"title":"Experience"}],"filename":"resume.txt","char_count":13,"truncated":false}}'::jsonb,
  'Retained text','{"original_retained":true,"classification_status":"completed"}'::jsonb,null,%L::uuid)$sql$,
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001')),
  '%UPLOAD_INGEST_SETTLEMENT_INVALID%'),
  'classification structure without an items array is never completion eligible');
select is(public.settle_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',repeat('a',64),
  'completed',200,'{"upload_id":"72000000-0000-4000-8000-000000000001","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Confirmed purpose","document_type":"resume","structure":[{"title":"Experience","items":["Reliable work"]}],"filename":"resume.txt","char_count":13,"truncated":false}}'::jsonb,
  'Retained text','{"original_retained":true,"classification_status":"completed"}'::jsonb,null,
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000001')
)->>'outcome','settled','terminal ingest result settles atomically');
select is(public.claim_upload_ingest(
  '72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000001/resume.txt',
  'text/plain','resume.txt',20,repeat('a',64),repeat('b',64)
)#>>'{response,classification_status}','completed','lost HTTP response replays exact terminal payload');

select is(public.claim_upload_ingest(
  '72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/crash.txt',
  'text/plain','crash.txt',20,repeat('c',64),repeat('d',64)
)->>'outcome','accepted','crash fixture accepted');
select public.advance_upload_ingest(
  '72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',repeat('c',64),
  (select ingest_claim_token from public.uploads where id='72000000-0000-4000-8000-000000000002'),
  'prepared','storage_dispatched');
reset role;
update public.uploads
set ingest_heartbeat_at=clock_timestamp()-interval '2 seconds',
    ingest_lease_expires_at=clock_timestamp()-interval '1 second'
where id='72000000-0000-4000-8000-000000000002';
set local role service_role;
select is(public.claim_upload_ingest(
  '72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000002/crash.txt',
  'text/plain','crash.txt',20,repeat('c',64),repeat('d',64)
)->>'outcome','resumed','expired Storage-dispatched work resumes only for exact readback');

select public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000001','render-service','pdf',repeat('0',64),
  '73000000-0000-4000-8000-000000000010');
select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000001','render-service','pdf',repeat('0',64),
  '73000000-0000-4000-8000-000000000010','completed');
select is(public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000001','render-service','pdf',repeat('0',64),
  '73000000-0000-4000-8000-000000000011'
)->>'outcome','completed','a completed egress identity never redispatches');

select is(public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000001'
)->>'outcome','accepted','provider dispatch is durable before fetch');
select is(public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000001'
)->>'outcome','idempotent_replay','one exact claim acknowledgement retry stays permitted');
select ok((public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000001'
)->>'lease_expires_at')::timestamptz between pg_catalog.clock_timestamp()
  and pg_catalog.clock_timestamp()+interval '120 seconds',
  'an admitted worker receives its bounded absolute dispatch deadline');
select is(
  public.claim_user_external_egress(
    '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
    '73000000-0000-4000-8000-000000000001'
  )->>'lease_expires_at',
  public.claim_user_external_egress(
    '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
    '73000000-0000-4000-8000-000000000001'
  )->>'lease_expires_at',
  'claim acknowledgement replay never extends the dispatch deadline'
);
select is(public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000099'
)->>'egress_permitted','false','a concurrent worker cannot repeat the same provider side effect');
select ok(pg_temp.raises_matching($$select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000099','completed')$$,
  '%USER_EXTERNAL_EGRESS_CONFLICT%'), 'only the owning execution token may complete egress');
select is(public.begin_account_deletion_fence('71000000-0000-4000-8000-000000000003')->>'outcome','blocked','deletion blocks admitted provider work');
select ok(pg_temp.raises_matching($$select public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('2',64),
  '73000000-0000-4000-8000-000000000002')$$,
  '%ACCOUNT_DELETION_FENCED%'), 'pre-authenticated request cannot dispatch after deletion fence');
select is(public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000001','completed'
)->>'outcome','completed','exact worker seals known terminal provider work');
select is(public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000003','openai','responses',repeat('1',64),
  '73000000-0000-4000-8000-000000000001','completed'
)->>'terminal_state','completed','lost completion acknowledgement replays the exact terminal state');
select is(public.begin_account_deletion_fence('71000000-0000-4000-8000-000000000003')->>'outcome','ready','deletion becomes ready after provider completion');
reset role;
delete from auth.users where id='71000000-0000-4000-8000-000000000003';
select is((
  select count(*)::integer
  from private.account_deletion_fences
  where user_key = private.account_deletion_user_key(
    '71000000-0000-4000-8000-000000000003'
  )
),1,'the deleted user deletion tombstone survives auth-user cascade');

set local role service_role;
select is(public.claim_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),repeat('a',64),'75000000-0000-4000-8000-000000000001'
)->>'outcome','accepted','captured export Storage dispatch is durable');
select is(public.claim_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),repeat('a',64),'75000000-0000-4000-8000-000000000002'
)->>'outcome','processing','concurrent export worker cannot upload');
select ok(pg_temp.raises_matching($$select public.complete_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),repeat('a',64),'75000000-0000-4000-8000-000000000002')$$,
  '%USER_STORAGE_DISPATCH_CONFLICT%'), 'a non-owning export worker cannot seal another upload');
select is(public.begin_account_deletion_fence('71000000-0000-4000-8000-000000000002')->>'outcome','blocked','deletion blocks unresolved export Storage');
reset role;
update private.user_storage_dispatches
set dispatched_at=clock_timestamp()-interval '2 seconds',
    lease_expires_at=clock_timestamp()-interval '1 second';
set local role service_role;
select is(public.reconcile_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),'verified_removed',repeat('f',64)
)->>'outcome','reconciled','proof-bearing service reconciliation clears expired Storage ambiguity');
select is(public.reconcile_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),'verified_removed',repeat('f',64)
)->>'outcome','idempotent_replay','exact reconciliation replay is idempotent');
select ok(pg_temp.raises_matching($$select public.reconcile_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),'verified_absent',repeat('9',64))$$,
  '%USER_STORAGE_RECONCILIATION_CONFLICT%'), 'contradictory reconciliation evidence is rejected');
reset role;
select ok(exists(select 1 from private.user_storage_dispatches where
  reconciliation_resolution='verified_removed' and reconciliation_evidence_sha256=repeat('f',64)
  and reconciled_at is not null), 'reconciliation evidence is immutable and durable');

-- Exact late-write interleaving: an object already present before the fence
-- remains deletable, while a dispatch admitted before the fence cannot commit
-- a second object after the durable tombstone wins the shared user lock.
insert into storage.objects(bucket_id,name) values (
  'original-documents',
  '71000000-0000-4000-8000-000000000005/before-fence.txt'
);
set local role service_role;
select is(public.claim_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000005','74000000-0000-4000-8000-000000000005',
  'captured-export',repeat('5',64),repeat('6',64),'75000000-0000-4000-8000-000000000005'
)->>'outcome','accepted','Storage dispatch may be admitted before account deletion starts');
select is(public.begin_account_deletion_fence(
  '71000000-0000-4000-8000-000000000005')->>'outcome','blocked',
  'deletion tombstone is durable while an admitted Storage dispatch is unresolved');
reset role;
select ok(pg_temp.raises_matching($$insert into storage.objects(bucket_id,name) values (
  'captured-exports',
  '71000000-0000-4000-8000-000000000005/74000000-0000-4000-8000-000000000005/late.pdf'
)$$, '%ACCOUNT_DELETION_FENCED%'),
  'admitted-before-fence Storage cannot commit an object after the tombstone');
select ok(pg_temp.raises_matching($$update storage.objects
  set metadata='{"late":true}'::jsonb
  where bucket_id='original-documents'
    and name='71000000-0000-4000-8000-000000000005/before-fence.txt'$$,
  '%ACCOUNT_DELETION_FENCED%'),
  'existing protected Storage objects cannot be rewritten after the tombstone');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects
where bucket_id='original-documents'
  and name='71000000-0000-4000-8000-000000000005/before-fence.txt';
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::integer from storage.objects
  where bucket_id='original-documents'
    and name='71000000-0000-4000-8000-000000000005/before-fence.txt'),0,
  'account cleanup DELETE remains allowed after the late-write fence');
select ok(pg_temp.raises_matching($$insert into storage.objects(bucket_id,name) values (
  'original-documents','not-a-user-prefix/late.txt'
)$$, '%USER_STORAGE_PREFIX_INVALID%'),
  'protected Storage writes require a validated leading user UUID');

set local role service_role;
select public.claim_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  '76000000-0000-4000-8000-000000000001');
select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  '76000000-0000-4000-8000-000000000001','reconciliation_required');
select is(public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  '76000000-0000-4000-8000-000000000001','reconciliation_required'
)->>'terminal_state','reconciliation_required',
  'ambiguous egress replay retains its exact terminal state');
select is(public.begin_account_deletion_fence(
  '71000000-0000-4000-8000-000000000004')->>'outcome','blocked',
  'ambiguous provider outcome remains deletion-blocking');
reset role;
update private.user_external_egress_dispatches
set dispatched_at=clock_timestamp()-interval '2 seconds',
    lease_expires_at=clock_timestamp()-interval '1 second'
where state='reconciliation_required';
set local role service_role;
select is(public.begin_account_deletion_fence(
  '71000000-0000-4000-8000-000000000004')->>'outcome','ready',
  'expired bounded ambiguous egress cannot permanently deadlock deletion');
select is(public.reconcile_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  'provider_terminal_reconciled',repeat('8',64))->>'outcome','reconciled',
  'proof-bearing service reconciliation clears provider ambiguity');
select is(public.reconcile_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  'provider_terminal_reconciled',repeat('8',64))->>'outcome','idempotent_replay',
  'provider reconciliation exact replay is idempotent');
select ok(pg_temp.raises_matching($$select public.reconcile_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  'provider_terminal_reconciled',repeat('9',64))$$,
  '%USER_EXTERNAL_EGRESS_RECONCILIATION_CONFLICT%'),
  'contradictory provider reconciliation evidence is rejected');
reset role;
select ok(exists(select 1 from private.user_external_egress_dispatches where
  reconciliation_resolution='provider_terminal_reconciled'
  and reconciliation_evidence_sha256=repeat('8',64) and reconciled_at is not null),
  'provider reconciliation evidence is immutable and durable');

set local role service_role;
select ok(pg_temp.raises_matching($$select public.complete_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  '76000000-0000-4000-8000-000000000001',null)$$,
  '%USER_EXTERNAL_EGRESS_INVALID%'), 'null external-egress terminal state fails closed');
select ok(pg_temp.raises_matching($$select public.reconcile_user_external_egress(
  '71000000-0000-4000-8000-000000000004','openai','responses',repeat('3',64),
  null,repeat('8',64))$$,
  '%USER_EXTERNAL_EGRESS_RECONCILIATION_INVALID%'), 'null external-egress resolution fails closed');
select ok(pg_temp.raises_matching($$select public.reconcile_user_storage_dispatch(
  '71000000-0000-4000-8000-000000000002','74000000-0000-4000-8000-000000000001',
  'captured-export',repeat('e',64),null,repeat('f',64))$$,
  '%USER_STORAGE_RECONCILIATION_INVALID%'), 'null Storage reconciliation resolution fails closed');
select ok(pg_temp.raises_matching($$select public.reconcile_upload_ingest_storage(
  '72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001',
  repeat('c',64),null,repeat('7',64))$$,
  '%UPLOAD_STORAGE_RECONCILIATION_INVALID%'), 'null ingest reconciliation resolution fails closed');

reset role;
update public.uploads set status='committed'
where id='72000000-0000-4000-8000-000000000001';
select is((select status from public.uploads where id='72000000-0000-4000-8000-000000000001'),
  'committed','only a retained original with completed classification and nonempty confirmation is import eligible');

insert into public.uploads(id,user_id,storage_path,file_type,file_name,file_size_bytes,status) values(
  '72000000-0000-4000-8000-000000000010','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/historical.txt','text/plain','historical.txt',1,'ready');
update public.uploads set status='committed' where id='72000000-0000-4000-8000-000000000010';
select is((select status from public.uploads where id='72000000-0000-4000-8000-000000000010'),'committed','safe historical ready upload remains import-compatible');
select ok(pg_temp.raises_matching($$update public.uploads set status='committed'
  where id='72000000-0000-4000-8000-000000000002'$$,
  '%UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST%'), 'processing ingest cannot race document import');

insert into public.uploads(
  id,user_id,storage_path,file_type,file_name,file_size_bytes,status,
  ingest_request_sha256,ingest_content_sha256,ingest_status,ingest_stage,
  ingest_http_status,ingest_response
) values (
  '72000000-0000-4000-8000-000000000011','71000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001/72000000-0000-4000-8000-000000000011/unsafe.txt',
  'text/plain','unsafe.txt',1,'ready',repeat('1',64),repeat('2',64),'completed','terminal',200,
  '{"upload_id":"72000000-0000-4000-8000-000000000011","original_retained":false,"classification_status":"completed","confirm_payload":{"summary":"Purpose","document_type":"resume","structure":[{"title":"Experience","items":[]}],"filename":"unsafe.txt","char_count":1,"truncated":false}}'::jsonb
);
select ok(pg_temp.raises_matching($$update public.uploads set status='committed'
  where id='72000000-0000-4000-8000-000000000011'$$,
  '%UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST%'),
  'a completed-looking ingest without a retained original is never import eligible');

select * from finish();
rollback;
