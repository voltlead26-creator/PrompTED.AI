-- Synthetic durable admission/accounting only; no provider request is sent.
-- A new logical stage must not reset the same operation's failure budget.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values ('94120000-0000-4000-8000-000000000001',
  'generation-budget@example.invalid', false, false, now(), now());

create temp table failure_budget_state(reservation_id uuid, claim_token uuid, result jsonb, preexisting_admission_id uuid);
grant select, update, insert on failure_budget_state to service_role;
set local role service_role;
with reserved as (
  select public.reserve_document_allowance_with_result(
    '94120000-0000-4000-8000-000000000001', 'failure-budget-operation',
    'generate-document', repeat('1',64), 'free', 3, 1800) as value
)
insert into failure_budget_state(reservation_id,claim_token)
select (value->>'reservation_id')::uuid, (value->>'execution_claim_token')::uuid from reserved;

-- Simulate another stage prepared before the two failures were known. It must
-- still be fenced immediately before dispatch after the budget is exhausted.
update failure_budget_state set preexisting_admission_id =
  (public.read_legacy_model_call_checkpoint(
    '94120000-0000-4000-8000-000000000001', 'generate-document', reservation_id,
    'failure-budget-operation', 'generate-document.section:prepared-before-failures',
    repeat('9',64), 2, claim_token, true)->>'attempt_admission_id')::uuid;

do $fixture$
declare
  s failure_budget_state%rowtype;
  admitted jsonb;
  stage text;
  digest text;
begin
  select * into strict s from failure_budget_state;
  for n in 1..2 loop
    stage := 'generate-document.section:budget-' || n;
    digest := repeat(n::text,64);
    admitted := public.read_legacy_model_call_checkpoint(
      '94120000-0000-4000-8000-000000000001', 'generate-document', s.reservation_id,
      'failure-budget-operation', stage, digest, 2, s.claim_token, true);
    if admitted->>'provider_permitted' is distinct from 'true' then
      raise exception 'Synthetic failure fixture was not admitted';
    end if;
    perform public.mark_legacy_model_attempt_dispatched(
      '94120000-0000-4000-8000-000000000001', 'generate-document', s.reservation_id,
      'failure-budget-operation', stage, digest, 1,
      (admitted->>'attempt_admission_id')::uuid, s.claim_token, extensions.gen_random_uuid());
    perform public.record_legacy_model_call_attempt(
      '94120000-0000-4000-8000-000000000001', 'failure-budget-operation', stage, digest,
      admitted->>'attempt_admission_id', 1, 'failed', '', 'http_429',
      'OPENAI_UPSTREAM_ERROR', 0, 0, now(), now(), 'gpt-5.6-sol',
      'routing.test.1', 'deep', 'medium', 'generate-document', s.reservation_id, null, s.claim_token);
  end loop;
end;
$fixture$;

reset role;
select is((select count(*)::integer from public.usage_ledger
  where user_id = '94120000-0000-4000-8000-000000000001'
    and logical_request_id = 'failure-budget-operation' and model_call_status = 'failed'),
  2, 'two dispatched failures are durably accounted across distinct stages');

set local role service_role;
update failure_budget_state set result = public.read_legacy_model_call_checkpoint(
  '94120000-0000-4000-8000-000000000001', 'generate-document', reservation_id,
  'failure-budget-operation', 'generate-document.section:budget-3', repeat('3',64),
  2, claim_token, true);
select is((select result->>'provider_permitted' from failure_budget_state), 'false',
  'a later stage cannot dispatch after two failures in the same operation');

reset role;
select is((select count(*)::integer from private.legacy_model_attempt_admissions
  where user_id = '94120000-0000-4000-8000-000000000001'
    and logical_request_id = 'failure-budget-operation'),
  3, 'the rejected later stage adds nothing beyond the two failures and earlier preparation');

set local role service_role;
select throws_ok(format(
  'select public.mark_legacy_model_attempt_dispatched(%L::uuid,%L,%L::uuid,%L,%L,%L,1,%L::uuid,%L::uuid,%L::uuid)',
  '94120000-0000-4000-8000-000000000001', 'generate-document', reservation_id,
  'failure-budget-operation', 'generate-document.section:prepared-before-failures', repeat('9',64),
  preexisting_admission_id, claim_token, '94120000-0000-4000-8000-000000000009'),
  'PGB01', 'GENERATION_ATTEMPT_LIMIT_REACHED',
  'an earlier preparation cannot dispatch after cumulative failure exhaustion')
from failure_budget_state;
reset role;
select ok((select a.dispatched_at is null from private.legacy_model_attempt_admissions a
  join failure_budget_state s on a.id = s.preexisting_admission_id),
  'the rejected dispatch leaves its original admission undispatched');

set local role service_role;
update failure_budget_state set result = public.read_legacy_model_call_checkpoint_with_fallback(
  '94120000-0000-4000-8000-000000000001', 'generate-document', reservation_id,
  'failure-budget-operation', 'generate-document.section:budget-4', repeat('4',64),
  2, claim_token, true);
select is((select result->>'provider_permitted' from failure_budget_state), 'false',
  'switching to the fallback-capable checkpoint cannot reset the operation budget');
select is((select result->>'error_code' from failure_budget_state), 'GENERATION_ATTEMPT_LIMIT_REACHED',
  'the caller receives an explicit permanent failure-budget code');
reset role;

select * from finish();
rollback;
