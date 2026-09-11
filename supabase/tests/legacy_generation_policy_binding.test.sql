begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- The only pre-migration adapter calls the actual old seven-argument command.
-- This makes the RED exercise real unbound admission/reclaim behavior. Once
-- the policy RPC exists, its errors always propagate; there is no fallback.
create function pg_temp.policy_reserve(
  p_request text, p_hash text default repeat('a', 64),
  p_policy text default repeat('b', 64), p_legacy text default null,
  p_owner uuid default 'f4130000-0000-4000-8000-000000000001'
) returns jsonb language plpgsql as $function$
declare v_result jsonb;
begin
  if to_regprocedure('public.reserve_document_allowance_with_policy(uuid,text,text,text,text,integer,integer,text,text,text)') is not null then
    execute 'select public.reserve_document_allowance_with_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
      into v_result using p_owner, p_request, 'generate-document', p_hash,
        'business', 1000, 1800, 'legacy-template-policy.1', p_policy, p_legacy;
    return v_result;
  end if;
  return public.reserve_document_allowance_with_result(
    p_owner, p_request, 'generate-document', p_hash, 'business', 1000, 1800
  );
end;
$function$;

create function pg_temp.policy_read(
  p_request text, p_hash text default repeat('a', 64),
  p_owner uuid default 'f4130000-0000-4000-8000-000000000001',
  p_route text default 'generate-document'
) returns jsonb language plpgsql as $function$
declare v_result jsonb;
begin
  if to_regprocedure('public.read_document_allowance_replay(uuid,text,text,text)') is null then
    return null;
  end if;
  execute 'select public.read_document_allowance_replay($1,$2,$3,$4)'
    into v_result using p_owner, p_request, p_route, p_hash;
  return v_result;
end;
$function$;

create function pg_temp.policy_error(p_sql text)
returns text language plpgsql as $function$
begin
  execute p_sql;
  return 'NO_ERROR';
exception when others then return sqlerrm;
end;
$function$;

create function pg_temp.policy_rows() returns jsonb language sql as $function$
  select jsonb_build_object(
    'reservations', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]')
      from private.document_allowance_reservations r
      where r.user_id in ('f4130000-0000-4000-8000-000000000001', 'f4130000-0000-4000-8000-000000000002')),
    'claims', (select coalesce(jsonb_agg(to_jsonb(c) order by c.reservation_id), '[]')
      from private.legacy_generation_execution_claims c
      where c.user_id = 'f4130000-0000-4000-8000-000000000001'),
    'admissions', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]')
      from private.legacy_model_attempt_admissions a
      where a.user_id = 'f4130000-0000-4000-8000-000000000001'),
    'results', (select coalesce(jsonb_agg(to_jsonb(r) order by r.reservation_id), '[]')
      from private.document_allowance_results r
      where r.user_id = 'f4130000-0000-4000-8000-000000000001'),
    'provider_results', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]')
      from private.legacy_model_call_results r
      where r.user_id = 'f4130000-0000-4000-8000-000000000001'),
    'usage', (select coalesce(jsonb_agg(to_jsonb(u) order by u.id), '[]')
      from public.usage_ledger u
      where u.user_id = 'f4130000-0000-4000-8000-000000000001')
  )
$function$;

create temp table policy_state(name text primary key, value jsonb not null);
insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('f4130000-0000-4000-8000-000000000001', 'policy-owner@example.invalid', false, false, now(), now()),
  ('f4130000-0000-4000-8000-000000000002', 'policy-other@example.invalid', false, false, now(), now());
-- Policy fixtures call Business admission; a caller-supplied plan is not a
-- subscription. Keep all existing policy/replay assertions and provide billing.
insert into public.subscriptions(user_id,plan,status) values
  ('f4130000-0000-4000-8000-000000000001','business','active'),
  ('f4130000-0000-4000-8000-000000000002','business','active');
select is((select count(*)::integer from auth.users where id in (
  'f4130000-0000-4000-8000-000000000001', 'f4130000-0000-4000-8000-000000000002'
)), 2, 'both synthetic owners positively exist');

insert into policy_state values ('before-absent', pg_temp.policy_rows());
select is(pg_temp.policy_read('policy-absent'), jsonb_build_object(
  'contract_version', 'allowance-replay.1',
  'user_id', 'f4130000-0000-4000-8000-000000000001',
  'request_id', 'policy-absent', 'route_key', 'generate-document',
  'request_sha256', repeat('a',64), 'state', 'absent',
  'reservation_id', null, 'reservation_status', null, 'expires_at', null,
  'execution_policy_version', null, 'execution_policy_sha256', null,
  'has_prior_provider_work', false, 'reconciliation_required', false,
  'replay_result', null
), 'absent replay read has exactly the fourteen specified public keys');
select is(pg_temp.policy_rows(), (select value from policy_state where name='before-absent'),
  'absent replay read neither reserves credit nor creates a claim');

insert into policy_state values ('canonical', pg_temp.policy_reserve('policy-canonical'));
select ok((select value->>'reservation_id' is not null and value->>'execution_claim_token' is not null
  and value->'provider_permitted' = 'true'::jsonb from policy_state where name='canonical'),
  'canonical first admission positively creates reservation and provider execution claim');
select is((select count(*)::integer from private.document_allowance_reservations r
  join private.legacy_generation_execution_claims c on c.reservation_id=r.id and c.user_id=r.user_id
  where r.user_id='f4130000-0000-4000-8000-000000000001' and r.request_id='policy-canonical'),
  1, 'canonical first admission is independently persisted exactly once');
select is((select value->>'contract_version' from policy_state where name='canonical'),
  'allowance-policy-reservation.1', 'policy reservation has an explicit response contract');
select is((select to_jsonb(r)->>'execution_policy_version' from private.document_allowance_reservations r
  where r.request_id='policy-canonical' and r.user_id='f4130000-0000-4000-8000-000000000001'),
  'legacy-template-policy.1', 'new reservation durably binds the execution policy version');
select is((select to_jsonb(r)->>'execution_policy_sha256' from private.document_allowance_reservations r
  where r.request_id='policy-canonical' and r.user_id='f4130000-0000-4000-8000-000000000001'),
  repeat('b',64), 'new reservation durably binds the exact server template policy digest');
select is((select value - array['contract_version','user_id','request_id','route_key','request_sha256',
  'reservation_id','expires_at','state','provider_permitted','execution_claim_token',
  'execution_policy_version','execution_policy_sha256','replay_result'] from policy_state where name='canonical'),
  '{}'::jsonb, 'policy reservation response does not expose billing or private checkpoints');
select is(pg_temp.policy_reserve('policy-canonical')->'provider_permitted', 'false'::jsonb,
  'same-policy duplicate admission cannot dispatch through the active claim');
select is(pg_temp.policy_read('policy-canonical')->>'state', 'unsettled',
  'read observes the accepted unfinished request');
select is(pg_temp.policy_read('policy-canonical')->'has_prior_provider_work', 'false'::jsonb,
  'an execution lease alone does not invent prepared provider work');

-- Prepare a genuine provider stage; its digest deliberately differs from the
-- upload/body and template-policy digests. No network provider is invoked.
select is(public.read_legacy_model_call_checkpoint(
  'f4130000-0000-4000-8000-000000000001', 'generate-document',
  (select (value->>'reservation_id')::uuid from policy_state where name='canonical'),
  'policy-canonical', 'generate-document.intent', repeat('d',64), 2,
  (select (value->>'execution_claim_token')::uuid from policy_state where name='canonical'), true
)->>'attempt_number', '1', 'canonical interrupted request has an actual prepared provider attempt');
select is(pg_temp.policy_read('policy-canonical')->'has_prior_provider_work', 'true'::jsonb,
  'read reports prepared provider work without allocating another attempt');
update private.legacy_generation_execution_claims
set heartbeat_at=clock_timestamp()-interval '121 seconds', lease_expires_at=clock_timestamp()-interval '1 second'
where reservation_id=(select (value->>'reservation_id')::uuid from policy_state where name='canonical');
insert into policy_state values ('before-conflict', pg_temp.policy_rows());
select is(pg_temp.policy_error($sql$select pg_temp.policy_reserve('policy-canonical',repeat('a',64),repeat('c',64))$sql$),
  'ALLOWANCE_EXECUTION_POLICY_CONFLICT', 'a changed canonical policy cannot reacquire interrupted work');
select is(pg_temp.policy_rows(), (select value from policy_state where name='before-conflict'),
  'policy conflict preserves every reservation, lease, checkpoint and usage field');
select is(pg_temp.policy_error($sql$select public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-canonical','generate-document',repeat('a',64),'business',1000,1800)$sql$),
  'ALLOWANCE_EXECUTION_POLICY_REQUIRED', 'old seven-argument result entry cannot reacquire a policy-bound request');
select is(pg_temp.policy_error($sql$select public.reserve_document_allowance(
  'f4130000-0000-4000-8000-000000000001','policy-canonical','generate-document',repeat('a',64),'business',1000,1800)$sql$),
  'ALLOWANCE_EXECUTION_POLICY_REQUIRED', 'old bare allowance entry cannot acquire a policy-bound request');
select is(pg_temp.policy_rows(), (select value from policy_state where name='before-conflict'),
  'both old-entry refusals preserve the expired claim for a compatible worker');
insert into policy_state values ('canonical-resume', pg_temp.policy_reserve('policy-canonical'));
select is((select value->'provider_permitted' from policy_state where name='canonical-resume'), 'true'::jsonb,
  'the same canonical policy reclaims the interrupted execution');
select isnt((select value->>'execution_claim_token' from policy_state where name='canonical-resume'),
  (select value->>'execution_claim_token' from policy_state where name='canonical'),
  'compatible recovery rotates the execution token');
select is((select count(*)::integer from private.legacy_model_attempt_admissions
  where user_id='f4130000-0000-4000-8000-000000000001' and logical_request_id='policy-canonical'),
  1, 'compatible recovery preserves the single prepared provider attempt');
select is((select a.claim_token::text from private.legacy_model_attempt_admissions a
  where a.user_id='f4130000-0000-4000-8000-000000000001' and a.logical_request_id='policy-canonical'),
  (select value->>'execution_claim_token' from policy_state where name='canonical-resume'),
  'compatible recovery adopts that prepared attempt into the new execution lease');

-- A live historical execution token could dispatch immediately after the
-- policy observation. Do not bind while that old worker still owns execution.
insert into policy_state values ('legacy-clean', public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-legacy-clean','generate-document',repeat('a',64),'business',1000,1800));
insert into policy_state values ('before-live-legacy',pg_temp.policy_rows());
select is(pg_temp.policy_error($sql$select pg_temp.policy_reserve('policy-legacy-clean')$sql$),
  'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED',
  'a live old execution token prevents binding even before any provider preparation');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-live-legacy'),
  'live historical worker refusal leaves policy, token and every source row unchanged');
select is((select to_jsonb(r)->>'execution_policy_sha256' from private.document_allowance_reservations r
  where r.user_id='f4130000-0000-4000-8000-000000000001' and r.request_id='policy-legacy-clean'),
  null::text,'old worker is never presented with a newly relabelled reservation');
update private.legacy_generation_execution_claims
set heartbeat_at=clock_timestamp()-interval '121 seconds', lease_expires_at=clock_timestamp()-interval '1 second'
where reservation_id=(select (value->>'reservation_id')::uuid from policy_state where name='legacy-clean');
insert into policy_state values ('legacy-clean-adopted',pg_temp.policy_reserve('policy-legacy-clean'));
select is((select value->'provider_permitted' from policy_state where name='legacy-clean-adopted'),'true'::jsonb,
  'expired unused historical execution can be atomically adopted');
select isnt((select value->>'execution_claim_token' from policy_state where name='legacy-clean-adopted'),
  (select value->>'execution_claim_token' from policy_state where name='legacy-clean'),
  'canonical adoption rotates the old historical token before permitting provider work');
select is((select to_jsonb(r)->>'execution_policy_sha256' from private.document_allowance_reservations r
  where r.user_id='f4130000-0000-4000-8000-000000000001' and r.request_id='policy-legacy-clean'),
  repeat('b',64), 'expired historical reservation with no provider work receives the canonical binding');
select is(pg_temp.policy_error(format(
  'select public.read_legacy_model_call_checkpoint(%L::uuid,%L,%L::uuid,%L,%L,%L,2,%L::uuid,true)',
  'f4130000-0000-4000-8000-000000000001','generate-document',
  (select value->>'reservation_id' from policy_state where name='legacy-clean'),
  'policy-legacy-clean','generate-document.intent',repeat('d',64),
  (select value->>'execution_claim_token' from policy_state where name='legacy-clean')
)),'LEGACY_GENERATION_EXECUTION_CLAIM_INVALID',
  'real provider admission fences the expired old token after canonical adoption');

insert into policy_state values ('legacy-prepared', public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-legacy-prepared','generate-document',repeat('a',64),'business',1000,1800));
select is(public.read_legacy_model_call_checkpoint(
  'f4130000-0000-4000-8000-000000000001','generate-document',
  (select (value->>'reservation_id')::uuid from policy_state where name='legacy-prepared'),
  'policy-legacy-prepared','generate-document.intent',repeat('e',64),2,
  (select (value->>'execution_claim_token')::uuid from policy_state where name='legacy-prepared'),true
)->>'attempt_number','1','historical fixture positively prepared its original provider stage');
update private.legacy_generation_execution_claims
set heartbeat_at=clock_timestamp()-interval '121 seconds', lease_expires_at=clock_timestamp()-interval '1 second'
where reservation_id=(select (value->>'reservation_id')::uuid from policy_state where name='legacy-prepared');
insert into policy_state values ('before-legacy', pg_temp.policy_rows());
select is(pg_temp.policy_error($sql$select pg_temp.policy_reserve('policy-legacy-prepared')$sql$),
  'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED', 'historical prepared work cannot silently adopt an unproven template policy');
select is(pg_temp.policy_error($sql$select pg_temp.policy_reserve('policy-legacy-prepared',repeat('a',64),repeat('b',64),repeat('c',64))$sql$),
  'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED', 'a different historical provider template cannot be relabelled canonical');
select is(pg_temp.policy_rows(), (select value from policy_state where name='before-legacy'),
  'historical policy rejections leave the complete accepted history unchanged');
insert into policy_state values ('legacy-adopted', pg_temp.policy_reserve(
  'policy-legacy-prepared',repeat('a',64),repeat('b',64),repeat('b',64)));
select is((select value->'provider_permitted' from policy_state where name='legacy-adopted'),'true'::jsonb,
  'trusted identical historical template permits recovery under the same policy');
select is((select to_jsonb(r)->>'execution_policy_sha256' from private.document_allowance_reservations r
  where r.user_id='f4130000-0000-4000-8000-000000000001' and r.request_id='policy-legacy-prepared'),
  repeat('b',64),'proven historical policy binding is durable');

-- Separate actual released and expired attempts prove request-wide inheritance.
insert into policy_state values ('released', pg_temp.policy_reserve('policy-released'));
select is(public.release_document_allowance(
  'f4130000-0000-4000-8000-000000000001',
  (select (value->>'reservation_id')::uuid from policy_state where name='released'),
  'policy-released','synthetic_cancelled'
)->>'state','released','the released fixture uses the real cancellation command');
insert into policy_state values ('before-released',pg_temp.policy_rows());
select is(pg_temp.policy_error($sql$select pg_temp.policy_reserve('policy-released',repeat('a',64),repeat('c',64))$sql$),
  'ALLOWANCE_EXECUTION_POLICY_CONFLICT','released requests retain their accepted execution policy');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-released'),
  'rejected released retry creates no replacement reservation or claim');
insert into policy_state values ('released-retry',pg_temp.policy_reserve('policy-released'));
select isnt((select value->>'reservation_id' from policy_state where name='released-retry'),
  (select value->>'reservation_id' from policy_state where name='released'),
  'same-policy released retry obtains a distinct existing-authority attempt');
select is((select count(*)::integer from private.document_allowance_reservations r
  where r.user_id='f4130000-0000-4000-8000-000000000001' and r.request_id='policy-released'
    and to_jsonb(r)->>'execution_policy_sha256'=repeat('b',64)),2,
  'both original and successor reservation retain the identical policy binding');
insert into policy_state values ('expired',pg_temp.policy_reserve('policy-expired'));
update private.document_allowance_reservations set reserved_at=clock_timestamp()-interval '1801 seconds',
  expires_at=clock_timestamp()-interval '1 second'
where id=(select (value->>'reservation_id')::uuid from policy_state where name='expired');
insert into policy_state values ('before-expired-read',pg_temp.policy_rows());
select is(pg_temp.policy_read('policy-expired')->>'reservation_status','reserved',
  'read reports stored expired-in-time reservation status without mutating it');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-expired-read'),
  'read performs no expiration cleanup or claim renewal');
insert into policy_state values ('expired-retry',pg_temp.policy_reserve('policy-expired'));
select isnt((select value->>'reservation_id' from policy_state where name='expired-retry'),
  (select value->>'reservation_id' from policy_state where name='expired'),
  'expired request creates the existing next reservation attempt');
select is((select count(*)::integer from private.document_allowance_reservations r
  where r.user_id='f4130000-0000-4000-8000-000000000001' and r.request_id='policy-expired'
    and to_jsonb(r)->>'execution_policy_sha256'=repeat('b',64)),2,
  'expiration cannot erase the request-wide policy binding');

-- Completed historical responses remain literal replay, including payload data.
insert into policy_state values ('settled',public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-settled','generate-document',repeat('a',64),'business',1000,1800));
-- The handler persists typed events; the transport emits [DONE] after replay.
insert into policy_state values ('saved-response','{"contract_version":"allowance-result.1","route_key":"generate-document","transport":"sse","payload":{"events":[{"type":"section","key":"historical","label":"Original","content":"Original historical wording."}]}}');
select is(public.settle_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001',
  (select (value->>'reservation_id')::uuid from policy_state where name='settled'),
  'policy-settled','document','openai',0,0,
  (select value from policy_state where name='saved-response')
)->>'state','settled','historical fixture is positively settled through the atomic result command');
insert into policy_state values ('before-settled',pg_temp.policy_rows());
select is(pg_temp.policy_read('policy-settled')->'replay_result',
  (select value from policy_state where name='saved-response'),'settled read returns the exact immutable historical response');
select is(pg_temp.policy_read('policy-settled')->>'state','settled','settled read never grants provider execution');
select is(pg_temp.policy_reserve('policy-settled',repeat('a',64),repeat('c',64))->'replay_result',
  (select value from policy_state where name='saved-response'),'completed history replays before new policy admission');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-settled'),
  'historical replay changes neither policy nor credit, result, provider or lease rows');
select is((select count(*)::integer from public.usage_ledger
  where user_id='f4130000-0000-4000-8000-000000000001' and generation_request_id='policy-settled'
    and event_type='document_created'),1,'historical completion and replay consume one completed-document credit');
select is(pg_temp.policy_error($sql$select pg_temp.policy_read('policy-settled',repeat('c',64))$sql$),
  'ALLOWANCE_REQUEST_REPLAY_CONFLICT','completed result read requires the exact accepted body digest');
select is(pg_temp.policy_error($sql$select pg_temp.policy_read('policy-settled',repeat('a',64),
  'f4130000-0000-4000-8000-000000000001','generate-checklist')$sql$),
  'ALLOWANCE_REQUEST_REPLAY_CONFLICT','completed result read requires the exact accepted route');
select is(pg_temp.policy_read('policy-settled',repeat('a',64),
  'f4130000-0000-4000-8000-000000000002')->>'state','absent',
  'other authenticated identity cannot find the positive owned response');

insert into policy_state values ('bound-settled',pg_temp.policy_reserve('policy-bound-settled'));
select is(public.settle_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001',
  (select (value->>'reservation_id')::uuid from policy_state where name='bound-settled'),
  'policy-bound-settled','document','openai',0,0,
  (select value from policy_state where name='saved-response')
)->>'state','settled','policy-bound completion uses the unchanged atomic result command');
insert into policy_state values ('before-bound-replay',pg_temp.policy_rows());
select is(public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-bound-settled','generate-document',repeat('a',64),'business',1000,1800
)->'replay_result',(select value from policy_state where name='saved-response'),
  'old result entry may replay a completed policy-bound response without acquiring execution');
select is(pg_temp.policy_reserve('policy-bound-settled',repeat('a',64),repeat('c',64))->'replay_result',
  (select value from policy_state where name='saved-response'),
  'new policy selection cannot prevent exact already-completed bound replay');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-bound-replay'),
  'completed bound replay preserves the old accepted policy and exact result');

insert into policy_state values ('without-result',public.reserve_document_allowance(
  'f4130000-0000-4000-8000-000000000001','policy-without-result','generate-document',repeat('a',64),'business',1000,1800));
select is(public.settle_document_allowance(
  'f4130000-0000-4000-8000-000000000001',
  (select (value->>'reservation_id')::uuid from policy_state where name='without-result'),
  'policy-without-result','document','openai',0,0
)->>'state','settled','pre-result historical command positively creates its original completion');
insert into policy_state values ('before-unavailable',pg_temp.policy_rows());
select is(pg_temp.policy_error($sql$select pg_temp.policy_read('policy-without-result')$sql$),
  'ALLOWANCE_REPLAY_RESULT_INVALID','a settled reservation without a durable response fails explicitly');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-unavailable'),
  'missing historical result never fabricates a checkpoint or consumes another credit');

-- Accounting predating scoped provider admissions is still evidence of work.
insert into policy_state values ('usage-only',public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-usage-only','generate-document',repeat('a',64),'business',1000,1800));
select is(public.record_legacy_model_call_attempt(
  'f4130000-0000-4000-8000-000000000001','policy-usage-only','generate-document.intent',repeat('f',64),
  'response:policy-historical-response',1,'succeeded','policy-historical-response','completed',null,
  7,3,now(),now(),'synthetic-policy-model','synthetic-policy-route.1','deep','medium'
)->>'idempotent_replay','false','historical model accounting is positively recorded through its command');
select is((select count(*)::integer from public.usage_ledger
  where user_id='f4130000-0000-4000-8000-000000000001' and logical_request_id='policy-usage-only'
    and model_call_key is not null),1,'historical work fixture contains actual model-call usage');
select is(pg_temp.policy_read('policy-usage-only')->'has_prior_provider_work','true'::jsonb,
  'usage-only historical provider work is not mistaken for a never-started request');
insert into policy_state values ('before-usage-only',pg_temp.policy_rows());
select is(pg_temp.policy_error($sql$select pg_temp.policy_reserve('policy-usage-only')$sql$),
  'ALLOWANCE_EXECUTION_POLICY_RECOVERY_REQUIRED','usage-only history requires matching historical template proof');
select is(pg_temp.policy_rows(),(select value from policy_state where name='before-usage-only'),
  'usage-only recovery rejection leaves its real provider usage and live claim unchanged');

select is(pg_temp.policy_error($sql$update private.document_allowance_reservations
  set execution_policy_sha256=repeat('c',64)
  where user_id='f4130000-0000-4000-8000-000000000001' and request_id='policy-canonical'$sql$),
  'IMMUTABLE_ALLOWANCE_EXECUTION_POLICY','even privileged direct mutation cannot replace an accepted policy digest');
select is(pg_temp.policy_error($sql$update private.document_allowance_reservations
  set execution_policy_version=null,execution_policy_sha256=null
  where user_id='f4130000-0000-4000-8000-000000000001' and request_id='policy-bound-settled'$sql$),
  'IMMUTABLE_ALLOWANCE_EXECUTION_POLICY','completed policy provenance cannot be erased');

-- Existing non-document entry contracts remain unchanged.
insert into policy_state values ('checklist',public.reserve_document_allowance_with_result(
  'f4130000-0000-4000-8000-000000000001','policy-checklist','generate-checklist',repeat('a',64),'business',1000,1800));
select ok((select value->'provider_permitted'='true'::jsonb and value->>'execution_claim_token' is not null
  and not (value ? 'execution_policy_version') from policy_state where name='checklist'),
  'old checklist admission retains its response and provider execution contract');

select has_function('public','read_document_allowance_replay',array['uuid','text','text','text'],
  'read-only replay RPC exists');
select has_function('public','reserve_document_allowance_with_policy',
  array['uuid','text','text','text','text','integer','integer','text','text','text'],
  'policy-bound admission RPC has the exact unambiguous signature');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('read_document_allowance_replay','reserve_document_allowance_with_policy')
    and p.prosecdef and p.proconfig @> array['search_path=""']::text[]),2,
  'both boundary commands are security definers with an empty search path');
select ok(coalesce(has_function_privilege('service_role',to_regprocedure(
  'public.read_document_allowance_replay(uuid,text,text,text)'),'EXECUTE'),false)
  and coalesce(has_function_privilege('service_role',to_regprocedure(
  'public.reserve_document_allowance_with_policy(uuid,text,text,text,text,integer,integer,text,text,text)'),'EXECUTE'),false),
  'only protected execution receives both new command capabilities');
select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure(
  'public.read_document_allowance_replay(uuid,text,text,text)'),'EXECUTE'),true)
  and not coalesce(has_function_privilege('anon',to_regprocedure(
  'public.reserve_document_allowance_with_policy(uuid,text,text,text,text,integer,integer,text,text,text)'),'EXECUTE'),true),
  'browser and anonymous roles receive no replay or policy admission authority');
select ok(not has_table_privilege('service_role','private.document_allowance_reservations','SELECT')
  and not has_table_privilege('authenticated','private.document_allowance_results','SELECT'),
  'new metadata does not expose existing private tables');
select is((select p.provolatile::text from pg_proc p
  where p.oid=to_regprocedure('public.read_document_allowance_replay(uuid,text,text,text)')),
  's','replay projection is explicitly STABLE');

select * from finish();
rollback;
