-- Behavioural RED for current catalogue UUIDs missing from production migrations.
-- No template rows are manufactured by this test. The existing real guest and
-- workspace commands must accept their actual catalogue FK targets.
-- Frozen catalogue source identities, 2026-09-08:
-- templates.data.json: 652b3e8f745274de93339eb5f7c2bc12ab4b15adea811948225c2bd6a57e83f8
-- phase2-templates.data.json: 6e8957d3391d309f219cbd1e3de34a8c5f1cb6f2b130d3a073eb85c7845053c3
-- Both files live in packages/shared/src/templates; this is a test fixture,
-- not a runtime catalogue or a direction to rewrite existing seeded metadata.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table tc_expected_catalogue (
  id uuid primary key,
  slug text not null unique
) on commit drop;
insert into tc_expected_catalogue(id, slug) values
  ('11111111-0000-4000-8000-000000000001', 'resume'),
  ('11111111-0000-4000-8000-000000000002', 'cover-letter'),
  ('11111111-0000-4000-8000-000000000003', 'job-search-checklist'),
  ('11111111-0000-4000-8000-000000000004', 'interview-prep-questions'),
  ('11111111-0000-4000-8000-000000000005', 'interview-script'),
  ('11111111-0000-4000-8000-000000000006', 'job-follow-up-email'),
  ('11111111-0000-4000-8000-000000000007', 'pay-rise-request'),
  ('11111111-0000-4000-8000-000000000008', 'promotion-case'),
  ('11111111-0000-4000-8000-000000000009', 'personal-statement'),
  ('11111111-0000-4000-8000-000000000010', 'education-cover-letter'),
  ('11111111-0000-4000-8000-000000000011', 'reference-request'),
  ('11111111-0000-4000-8000-000000000012', 'business-email'),
  ('11111111-0000-4000-8000-000000000013', 'workplace-policy'),
  ('11111111-0000-4000-8000-000000000014', 'sop'),
  ('11111111-0000-4000-8000-000000000015', 'offer-letter'),
  ('11111111-0000-4000-8000-000000000016', 'terms-of-employment'),
  ('11111111-0000-4000-8000-000000000017', 'induction-manual'),
  ('11111111-0000-4000-8000-000000000018', 'onboarding-checklist'),
  ('11111111-0000-4000-8000-000000000019', 'performance-review'),
  ('11111111-0000-4000-8000-000000000020', 'meeting-minutes'),
  ('11111111-0000-4000-8000-000000000021', 'service-agreement'),
  ('11111111-0000-4000-8000-000000000022', 'proposal'),
  ('11111111-0000-4000-8000-000000000023', 'budget-workbook'),
  ('11111111-0000-4000-8000-000000000024', 'selection-criteria-response'),
  ('11111111-0000-4000-8000-000000000025', 'linkedin-profile-rewrite'),
  ('11111111-0000-4000-8000-000000000026', 'star-achievement-bank'),
  ('11111111-0000-4000-8000-000000000027', 'professional-reference-letter'),
  ('11111111-0000-4000-8000-000000000028', 'personal-brand-statement'),
  ('11111111-0000-4000-8000-000000000029', 'career-change-plan'),
  ('11111111-0000-4000-8000-000000000030', 'resignation-letter'),
  ('11111111-0000-4000-8000-000000000031', 'networking-outreach-message'),
  ('11111111-0000-4000-8000-000000000032', 'recruiter-introduction-email'),
  ('11111111-0000-4000-8000-000000000033', 'business-plan'),
  ('11111111-0000-4000-8000-000000000034', 'executive-summary'),
  ('11111111-0000-4000-8000-000000000035', 'pitch-deck-outline'),
  ('11111111-0000-4000-8000-000000000036', 'scope-of-work'),
  ('11111111-0000-4000-8000-000000000037', 'board-report'),
  ('11111111-0000-4000-8000-000000000038', 'quarterly-business-review'),
  ('11111111-0000-4000-8000-000000000039', 'risk-assessment'),
  ('11111111-0000-4000-8000-000000000040', 'financial-review'),
  ('11111111-0000-4000-8000-000000000041', 'marketing-brief'),
  ('11111111-0000-4000-8000-000000000042', 'grant-funding-proposal'),
  ('11111111-0000-4000-8000-000000000043', 'scholarship-application'),
  ('11111111-0000-4000-8000-000000000044', 'statement-of-purpose'),
  ('11111111-0000-4000-8000-000000000045', 'study-plan'),
  ('11111111-0000-4000-8000-000000000046', 'research-proposal'),
  ('11111111-0000-4000-8000-000000000047', 'literature-review'),
  ('11111111-0000-4000-8000-000000000048', 'academic-appeal-letter'),
  ('11111111-0000-4000-8000-000000000049', 'extension-request-letter'),
  ('11111111-0000-4000-8000-000000000050', 'student-support-plan'),
  ('11111111-0000-4000-8000-000000000051', 'course-comparison-matrix'),
  ('11111111-0000-4000-8000-000000000052', 'academic-reference-request'),
  ('11111111-0000-4000-8000-000000000053', 'profit-and-loss-statement'),
  ('22222222-0000-4000-8000-000000000054', 'forecasted-earnings'),
  ('22222222-0000-4000-8000-000000000055', 'ebitda-analysis'),
  ('22222222-0000-4000-8000-000000000056', 'investment-capital-gains-report'),
  ('22222222-0000-4000-8000-000000000057', 'quote-estimate'),
  ('22222222-0000-4000-8000-000000000058', 'invoice'),
  ('22222222-0000-4000-8000-000000000059', 'purchase-order'),
  ('22222222-0000-4000-8000-000000000060', 'cash-flow-forecast'),
  ('22222222-0000-4000-8000-000000000061', 'expense-claim'),
  ('22222222-0000-4000-8000-000000000062', 'project-plan'),
  ('22222222-0000-4000-8000-000000000063', 'project-status-report'),
  ('22222222-0000-4000-8000-000000000064', 'meeting-agenda'),
  ('22222222-0000-4000-8000-000000000065', 'action-register'),
  ('22222222-0000-4000-8000-000000000066', 'decision-log'),
  ('22222222-0000-4000-8000-000000000067', 'handover-document'),
  ('22222222-0000-4000-8000-000000000068', 'change-request'),
  ('22222222-0000-4000-8000-000000000069', 'leave-availability-request'),
  ('22222222-0000-4000-8000-000000000070', 'performance-improvement-plan'),
  ('22222222-0000-4000-8000-000000000071', 'training-plan-skills-matrix'),
  ('22222222-0000-4000-8000-000000000072', 'incident-near-miss-report'),
  ('22222222-0000-4000-8000-000000000073', 'asset-register-maintenance-log'),
  ('22222222-0000-4000-8000-000000000074', 'stocktake-inventory-count'),
  ('22222222-0000-4000-8000-000000000075', 'business-case'),
  ('22222222-0000-4000-8000-000000000076', 'customer-feedback-summary'),
  ('22222222-0000-4000-8000-000000000077', 'competitor-comparison'),
  ('22222222-0000-4000-8000-000000000078', 'timesheet'),
  ('22222222-0000-4000-8000-000000000079', 'staff-roster'),
  ('22222222-0000-4000-8000-000000000080', 'moving-house-checklist'),
  ('22222222-0000-4000-8000-000000000081', 'new-tenancy-checklist'),
  ('22222222-0000-4000-8000-000000000082', 'complaint-letter'),
  ('22222222-0000-4000-8000-000000000083', 'insurance-claim-letter'),
  ('22222222-0000-4000-8000-000000000084', 'client-engagement-letter'),
  ('22222222-0000-4000-8000-000000000085', 'non-disclosure-agreement'),
  ('22222222-0000-4000-8000-000000000086', 'research-report');

create temporary table tc_results (
  name text primary key,
  value jsonb not null
) on commit drop;
create temporary table tc_original_templates as
  select id, to_jsonb(template_record) as value
  from public.templates template_record;
grant select, insert on tc_results to authenticated;

create function pg_temp.tc_id(p_kind integer, p_slot integer)
returns uuid language sql immutable set search_path = '' as $function$
  select ('ca00000' || p_kind::text || '-0000-4000-8000-' ||
    lpad(p_slot::text, 12, '0'))::uuid
$function$;

-- Test-only diagnostic wrapper: an unexpected error remains a failed positive
-- assertion, and does not abort the file before independent persistence checks.
-- It never falls back to another production command or inserts a missing row.
create function pg_temp.tc_call(p_sql text)
returns jsonb language plpgsql set search_path = '' as $function$
declare
  v_result jsonb;
begin
  execute p_sql into v_result;
  return jsonb_build_object('ok', true, 'result', v_result);
exception when others then
  return jsonb_build_object('ok', false, 'sqlstate', sqlstate, 'message', sqlerrm);
end;
$function$;

create function pg_temp.tc_guest_sections(p_slot integer, p_user_id uuid)
returns jsonb language sql immutable set search_path = '' as $function$
  select jsonb_agg(jsonb_build_object(
    'id', pg_temp.tc_id(4, p_slot * 10 + n::integer),
    'document_id', pg_temp.tc_id(3, p_slot),
    'user_id', p_user_id,
    'name', name,
    'order_index', n - 1,
    'content', case when p_slot = 2 then
      (array[
        'I was charged $10 twice for the same purchase.',
        'The duplicate charge reduced my available balance by $10.',
        'Please refund the duplicate $10 charge.',
        'Please confirm when the refund has been processed.'
      ])[n::integer]
      else 'Preserved original wording for ' || name || '.' end,
    'status', 'edited',
    'version_history', jsonb_build_array(jsonb_build_object(
      'content', 'Earlier device wording for ' || name || '.',
      'saved_at', '2026-09-01T01:00:00.000Z',
      'label', 'Imported original', 'origin', 'imported_original'
    )),
    'is_required', case when p_slot = 2 then n <> 2 else n <> 6 end,
    'created_at', '2026-09-01T00:00:00.000Z',
    'updated_at', '2026-09-01T01:00:00.000Z'
  ) order by n)
  from unnest(case when p_slot = 2
    then array['The Issue', 'Impact', 'Requested Resolution', 'Closing']
    else array['Contact Details', 'Professional Summary', 'Work Experience',
      'Education & Qualifications', 'Key Skills', 'Referees']
  end) with ordinality as section_values(name, n)
$function$;

create function pg_temp.tc_guest_sql(
  p_slot integer, p_template_id uuid, p_user_id uuid
) returns text language sql immutable set search_path = '' as $function$
  select format(
    'select public.commit_guest_workspace_import(%L,%L::uuid,%L::uuid,%L,%L,%L::jsonb,%L::uuid,%L,%L::jsonb)',
    'catalogue-guest:' || p_slot::text,
    pg_temp.tc_id(2, p_slot), pg_temp.tc_id(3, p_slot),
    case when p_slot = 2 then 'Duplicate charge complaint' else 'Preserved guest resume' end,
    'Synthetic preserved device workspace',
    jsonb_build_object('primary', jsonb_build_object(
      'template_id', case when p_slot = 2 then 'complaint-letter' else 'resume' end,
      'reason', 'Synthetic catalogue persistence fixture'
    ), 'alternatives', jsonb_build_array()),
    p_template_id, 'draft', pg_temp.tc_guest_sections(p_slot, p_user_id)
  )
$function$;

create function pg_temp.tc_workspace_sql(p_template_id uuid)
returns text language sql immutable set search_path = '' as $function$
  select format(
    'select public.save_own_legacy_workspace_v1(%L,%L::uuid,%L::uuid,0,null,%L::jsonb,%L::jsonb)',
    'catalogue-workspace:selection',
    pg_temp.tc_id(2, 3), pg_temp.tc_id(3, 3),
    jsonb_build_object(
      'title', 'Selection criteria response', 'status', 'draft',
      'template_id', p_template_id, 'unresolved_placeholders', jsonb_build_array()
    ),
    (select jsonb_agg(jsonb_build_object(
      'id', pg_temp.tc_id(4, 30 + n::integer), 'expected', null,
      'desired', jsonb_build_object(
        'name', name, 'order_index', n - 1, 'status', 'draft', 'is_required', true
      ),
      'content', 'Preserved candidate wording for ' || name || '.'
    ) order by n)
    from unnest(array['Criterion Heading', 'Summary Claim', 'Evidence Example',
      'Outcome & Relevance']) with ordinality as section_values(name, n))
  )
$function$;

select is((select count(*)::integer from tc_expected_catalogue), 86,
  'the frozen fixture positively identifies all 86 current catalogue UUIDs');
select ok(exists (
  select 1 from public.templates where id = '11111111-0000-4000-8000-000000000001'
    and is_published
), 'the real historical resume seed is present before any ownership denial');
select ok(not has_table_privilege('authenticated', 'public.templates', 'INSERT')
  and not has_table_privilege('authenticated', 'public.templates', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.templates', 'SELECT')
  and not has_table_privilege('anon', 'public.templates', 'SELECT'),
  'the bundled browser catalogue requires no direct template table grant');

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  (pg_temp.tc_id(1, 1), 'catalogue-owner@example.invalid', false, false, now(), now()),
  (pg_temp.tc_id(1, 2), 'catalogue-other@example.invalid', false, false, now(), now());
insert into public.outcomes(id, user_id, situation_text, recommendation_payload, status, is_saved)
values
  (pg_temp.tc_id(2, 3), pg_temp.tc_id(1, 1), 'Respond to supplied selection criteria',
   '{"primary":{"template_id":"selection-criteria-response","reason":"Synthetic fixture"},"alternatives":[]}',
   'in_progress', true),
  (pg_temp.tc_id(2, 9), pg_temp.tc_id(1, 2), 'Independent other-owner fixture',
   '{"primary":{"template_id":"resume","reason":"Synthetic fixture"},"alternatives":[]}',
   'in_progress', true);
select is((select count(*)::integer from auth.users
  where id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))), 2,
  'both authenticated identities were positively created');
select is((select count(*)::integer from public.outcomes
  where (id = pg_temp.tc_id(2, 3) and user_id = pg_temp.tc_id(1, 1))
     or (id = pg_temp.tc_id(2, 9) and user_id = pg_temp.tc_id(1, 2))), 2,
  'both independent owned outcome fixtures exist before command tests');

-- Privileged inventory of actual persistence FK targets. The browser obtains
-- this catalogue from bundled JSON, not a templates table selector. Migration
-- 20260831120000 deliberately removed the older broad SELECT grant; preserve it.
-- Actual user persistence commands and owned document reads below still execute
-- as authenticated, so this inventory cannot mask an RPC/ownership failure.
select ok(exists (
  select 1 from public.templates actual where actual.id = expected.id and actual.is_published
), 'published current template is available: ' || expected.slug || ' [' || expected.id::text || ']')
from tc_expected_catalogue expected order by expected.id;

select set_config('request.jwt.claim.sub', pg_temp.tc_id(1, 1)::text, true);
set local role authenticated;
select is(auth.uid(), pg_temp.tc_id(1, 1), 'the first command runs as the actual authenticated owner');

insert into tc_results values ('control', pg_temp.tc_call(pg_temp.tc_guest_sql(
  1, '11111111-0000-4000-8000-000000000001', pg_temp.tc_id(1, 1))));
select is((select value from tc_results where name = 'control'),
  jsonb_build_object('ok', true, 'result', jsonb_build_object(
    'status', 'committed', 'outcome_id', pg_temp.tc_id(2, 1),
    'document_id', pg_temp.tc_id(3, 1), 'idempotent_replay', false)),
  'the real seeded resume commits through the authenticated guest command');
select is((select count(*)::integer from public.documents
  where id = pg_temp.tc_id(3, 1) and user_id = pg_temp.tc_id(1, 1)
    and outcome_id = pg_temp.tc_id(2, 1)
    and template_id = '11111111-0000-4000-8000-000000000001'), 1,
  'the positive control document and its real template FK are independently readable');
select is((select count(*)::integer from public.sections
  where document_id = pg_temp.tc_id(3, 1) and user_id = pg_temp.tc_id(1, 1)), 6,
  'all six positive control sections were durably written');

-- Intended RED on the unchanged migrations: real known catalogue UUID, valid
-- request, actual owner, but GUEST_IMPORT_TEMPLATE_NOT_FOUND before persistence.
insert into tc_results values ('complaint', pg_temp.tc_call(pg_temp.tc_guest_sql(
  2, '22222222-0000-4000-8000-000000000082', pg_temp.tc_id(1, 1))));
select is((select value from tc_results where name = 'complaint'),
  jsonb_build_object('ok', true, 'result', jsonb_build_object(
    'status', 'committed', 'outcome_id', pg_temp.tc_id(2, 2),
    'document_id', pg_temp.tc_id(3, 2), 'idempotent_replay', false)),
  'the current complaint UUID commits the actual preserved guest workspace');
select is((select count(*)::integer from public.documents d
  join public.outcomes o on o.id = d.outcome_id and o.user_id = d.user_id
  where d.id = pg_temp.tc_id(3, 2) and d.user_id = pg_temp.tc_id(1, 1)
    and d.template_id = '22222222-0000-4000-8000-000000000082'
    and d.ledger_binding_status = 'legacy_unversioned'
    and o.id = pg_temp.tc_id(2, 2)), 1,
  'the complaint document is attached once to its owned durable outcome');
select is((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'document_id', s.document_id, 'user_id', s.user_id,
    'name', s.name, 'order_index', s.order_index, 'content', s.content,
    'status', s.status, 'version_history', s.version_history, 'is_required', s.is_required
  ) order by s.order_index) from public.sections s
  where s.document_id = pg_temp.tc_id(3, 2)),
  (select jsonb_agg(v - 'created_at' - 'updated_at' order by n)
    from jsonb_array_elements(pg_temp.tc_guest_sections(2, pg_temp.tc_id(1, 1)))
      with ordinality as expected(v, n)),
  'guest import preserves all exact complaint wording, order, flags and original history');

-- A separate actual workspace save also requires the absent current UUID.
insert into tc_results values ('selection', pg_temp.tc_call(pg_temp.tc_workspace_sql(
  '11111111-0000-4000-8000-000000000024')));
select ok(coalesce((select value->'ok' = 'true'::jsonb
  and value #>> '{result,contract_version}' = 'legacy-workspace-save.v1'
  and value #>> '{result,state}' = 'created'
  and value #>> '{result,document_id}' = pg_temp.tc_id(3, 3)::text
  and value #>> '{result,document_revision}' = '1'
  and value #> '{result,idempotent_replay}' = 'false'::jsonb
  from tc_results where name = 'selection'), false),
  'a new real workspace accepts the current selection-criteria UUID');
select diag(value::text) from tc_results
where name = 'selection' and value->'ok' = 'false'::jsonb;
select is((select count(*)::integer from public.documents d
  join public.sections s on s.document_id = d.id and s.user_id = d.user_id
  where d.id = pg_temp.tc_id(3, 3) and d.outcome_id = pg_temp.tc_id(2, 3)
    and d.user_id = pg_temp.tc_id(1, 1) and d.current_revision = 1
    and d.template_id = '11111111-0000-4000-8000-000000000024'
    and s.content = 'Preserved candidate wording for ' || s.name || '.'), 4,
  'selection-criteria parent FK and all four actual saved bodies are independently proven');

insert into tc_results values
  ('control-replay', pg_temp.tc_call(pg_temp.tc_guest_sql(
    1, '11111111-0000-4000-8000-000000000001', pg_temp.tc_id(1, 1)))),
  ('complaint-replay', pg_temp.tc_call(pg_temp.tc_guest_sql(
    2, '22222222-0000-4000-8000-000000000082', pg_temp.tc_id(1, 1)))),
  ('selection-replay', pg_temp.tc_call(pg_temp.tc_workspace_sql(
    '11111111-0000-4000-8000-000000000024')));
select ok(coalesce((select replay.value->'ok' = 'true'::jsonb
  and replay.value #> '{result,idempotent_replay}' = 'true'::jsonb
  and ((replay.value->'result') - 'idempotent_replay') =
    ((first_call.value->'result') - 'idempotent_replay')
  from tc_results replay join tc_results first_call on first_call.name = expected.name
  where replay.name = expected.name || '-replay'), false),
  'exact retry replays the same immutable receipt: ' || expected.name)
from (values ('control'), ('complaint'), ('selection')) as expected(name);

-- An unknown UUID must still fail; the seed repair cannot introduce a generic
-- fallback or silently discard the selected template from its persistence FK.
select is(pg_temp.tc_call(pg_temp.tc_guest_sql(
    4, 'ca000009-0000-4000-8000-000000000099', pg_temp.tc_id(1, 1)))->>'message',
  'GUEST_IMPORT_TEMPLATE_NOT_FOUND:ca000009-0000-4000-8000-000000000099',
  'an unknown catalogue UUID remains explicitly rejected');
reset role;

select is((select count(*)::integer from private.guest_workspace_imports
  where user_id = pg_temp.tc_id(1, 1)
    and idempotency_key in ('catalogue-guest:1', 'catalogue-guest:2')), 2,
  'guest retries leave exactly one immutable receipt per imported workspace');
select is((select count(*)::integer from private.legacy_workspace_save_receipts
  where user_id = pg_temp.tc_id(1, 1)
    and idempotency_key = 'catalogue-workspace:selection'), 1,
  'workspace retries retain exactly one actual save receipt');
select is((select count(*)::integer from public.documents
  where user_id = pg_temp.tc_id(1, 1)), 3,
  'the two imports and one workspace save create exactly three documents');

create temporary table tc_before_denials as
  select jsonb_build_object(
    'outcomes', (select jsonb_agg(to_jsonb(o) order by o.id) from public.outcomes o
      where o.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'documents', (select jsonb_agg(to_jsonb(d) order by d.id) from public.documents d
      where d.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'sections', (select jsonb_agg(to_jsonb(s) order by s.id) from public.sections s
      where s.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'guest_receipts', (select jsonb_agg(to_jsonb(r) order by r.id) from private.guest_workspace_imports r
      where r.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'workspace_receipts', (select jsonb_agg(to_jsonb(r) order by r.id) from private.legacy_workspace_save_receipts r
      where r.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2)))
  ) as value;

select set_config('request.jwt.claim.sub', pg_temp.tc_id(1, 2)::text, true);
set local role authenticated;
select is((select count(*)::integer from public.outcomes
  where id = pg_temp.tc_id(2, 9)), 1,
  'the second authenticated owner positively reads its own fixture');
select is((select count(*)::integer from public.documents
  where id = pg_temp.tc_id(3, 1)), 0,
  'the second owner cannot read the positively persisted control document');
select is(pg_temp.tc_call(pg_temp.tc_guest_sql(
    1, '11111111-0000-4000-8000-000000000001', pg_temp.tc_id(1, 2)))->>'message',
  'GUEST_IMPORT_OUTCOME_ID_COLLISION:' || pg_temp.tc_id(2, 1)::text,
  'another owner cannot reuse a real occupied guest workspace identity');
select is(pg_temp.tc_call(pg_temp.tc_workspace_sql(
    '11111111-0000-4000-8000-000000000024'))->>'message',
  'LEGACY_WORKSPACE_UNAVAILABLE',
  'another owner cannot save through the positively owned selection outcome');
reset role;
select is((select value from tc_before_denials), jsonb_build_object(
    'outcomes', (select jsonb_agg(to_jsonb(o) order by o.id) from public.outcomes o
      where o.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'documents', (select jsonb_agg(to_jsonb(d) order by d.id) from public.documents d
      where d.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'sections', (select jsonb_agg(to_jsonb(s) order by s.id) from public.sections s
      where s.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'guest_receipts', (select jsonb_agg(to_jsonb(r) order by r.id) from private.guest_workspace_imports r
      where r.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2))),
    'workspace_receipts', (select jsonb_agg(to_jsonb(r) order by r.id) from private.legacy_workspace_save_receipts r
      where r.user_id in (pg_temp.tc_id(1, 1), pg_temp.tc_id(1, 2)))
  ), 'ownership denials change no outcome, document, section or immutable receipt');
select is((select jsonb_agg(value order by id) from tc_original_templates),
  (select jsonb_agg(to_jsonb(t) order by t.id) from public.templates t),
  'application commands never rewrite historical or newly added catalogue rows');
select is((select count(*)::integer from public.outcomes
  where id = pg_temp.tc_id(2, 4)), 0,
  'unknown-template rejection leaves no partial outcome');

-- Required upgrade follow-up, intentionally not simulated by this fresh test:
-- pin predecessor 20260908130000, snapshot every existing template row including
-- created_at/is_published and any synthetic customised historical seed metadata;
-- positively create owned historical guest/save receipts and snapshot their
-- complete parent/section/history rows. Apply only the new additive seed, then
-- compare all pre-existing rows/receipts byte-for-byte and retry those same
-- imports. A pre-existing current UUID with deliberately unpublished metadata
-- must cause an explicit target-identity conflict, with no overwrite or
-- republication. An identical pre-existing target must retain its original
-- created_at. The forward migration contains no ON CONFLICT. This probe must be
-- separately isolated from the standard all-published fresh fixture above.
-- No historical seed migration should be regenerated or reapplied as the fix.
-- Future composed runner mode must retain the exact existing F4 validator:
-- validate the full current manifest and the named/digested seed; run the
-- unchanged 124000 -> 130000 validator and fixture against that exact prefix;
-- then establish the positive template baseline at 130000 and apply only the
-- additive seed. Do not loosen the old validator's future-migration rejection.

select * from finish();
rollback;
