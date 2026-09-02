begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

select has_column(
  'public', 'outcomes', 'conversation_revision',
  'outcomes expose a dedicated conversation concurrency revision'
);
select col_type_is(
  'public', 'outcomes', 'conversation_revision', 'integer',
  'conversation concurrency is a monotonic integer contract'
);
select has_table(
  'private', 'outcome_conversation_save_receipts',
  'conversation saves have one immutable receipt authority'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.outcome_conversation_save_receipts', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'private.outcome_conversation_save_receipts', 'SELECT'
  )
  and not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'private'
      and column_record.table_name = 'outcome_conversation_save_receipts'
      and column_record.column_name in (
        'conversation', 'conversation_context', 'situation', 'payload', 'content'
      )
  ),
  'conversation receipts are inaccessible and contain no conversation body'
);
select has_function(
  'public', 'save_own_outcome_conversation',
  array['uuid', 'integer', 'text', 'jsonb'],
  'conversation persistence has one exact owner/CAS command'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure_record
    where procedure_record.oid =
      'public.save_own_outcome_conversation(uuid,integer,text,jsonb)'::regprocedure
      and procedure_record.prosecdef
      and procedure_record.proconfig @> array['search_path=""']::text[]
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_own_outcome_conversation(uuid,integer,text,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.save_own_outcome_conversation(uuid,integer,text,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.save_own_outcome_conversation(uuid,integer,text,jsonb)',
    'EXECUTE'
  ),
  'only authenticated owners may use the fixed-path conversation command'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('e1000000-0000-4000-8000-000000000011', 'conversation-owner@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000012', 'conversation-other@example.invalid', false, false, now(), now());

insert into public.outcomes(
  id, user_id, situation_text, recommendation_payload, status, is_saved
) values
  (
    'e2000000-0000-4000-8000-000000000011',
    'e1000000-0000-4000-8000-000000000011',
    'Prepare a proposal',
    '{
      "primary":{"template_id":"business-proposal","reason":"Business Proposal"},
      "alternatives":[{"template_id":"action-plan","reason":"Action Plan"}],
      "upload_id":"e3000000-0000-4000-8000-000000000011",
      "upload_context":"Retained source evidence",
      "conversation":[{"role":"user","text":"Original request"}],
      "conversation_context":"User: Original request",
      "situation":"Prepare a proposal"
    }',
    'in_progress', true
  ),
  (
    'e2000000-0000-4000-8000-000000000012',
    'e1000000-0000-4000-8000-000000000012',
    'Other outcome',
    '{
      "primary":{"template_id":"cover-letter","reason":"Cover Letter"},
      "alternatives":[],
      "conversation":[{"role":"user","text":"Other request"}]
    }',
    'in_progress', false
  );

create temporary table conversation_results(
  name text primary key,
  result jsonb not null
) on commit drop;
grant select, insert on conversation_results to authenticated;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000011', true
);
set local role authenticated;
insert into conversation_results(name, result)
values (
  'first',
  public.save_own_outcome_conversation(
    'e2000000-0000-4000-8000-000000000011',
    0,
    'conversation-save-0',
    '[
      {"role":"user","text":"Original request"},
      {"role":"ted","text":"What deadline applies?"},
      {"role":"user","text":"Friday"}
    ]'
  )
);
reset role;

select ok(
  (
    select result->>'contract_version' = 'outcome-conversation-save.1'
      and result->>'state' = 'committed'
      and result->>'accepted_conversation_revision' = '0'
      and result->>'conversation_revision' = '1'
      and result->>'idempotent_replay' = 'false'
      and result->>'conversation_sha256' ~ '^[0-9a-f]{64}$'
    from conversation_results where name = 'first'
  ),
  'the first changed conversation returns one explicit committed revision'
);
select ok(
  (
    select conversation_revision = 1
      and recommendation_payload->'conversation'->2->>'text' = 'Friday'
      and recommendation_payload->>'conversation_context'
        = E'User: Original request\nTED: What deadline applies?\nUser: Friday'
      and recommendation_payload->>'situation' = 'Prepare a proposal'
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  'conversation fields persist against exactly one database revision'
);
select ok(
  (
    select recommendation_payload#>>'{primary,template_id}' = 'business-proposal'
      and recommendation_payload#>>'{alternatives,0,template_id}' = 'action-plan'
      and recommendation_payload->>'upload_id'
        = 'e3000000-0000-4000-8000-000000000011'
      and recommendation_payload->>'upload_context' = 'Retained source evidence'
      and status = 'in_progress'
      and is_saved
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  'conversation persistence preserves template, upload and workflow truth'
);

set local role authenticated;
insert into conversation_results(name, result)
values (
  'first-replay',
  public.save_own_outcome_conversation(
    'e2000000-0000-4000-8000-000000000011',
    0,
    'conversation-save-0',
    '[
      {"role":"user","text":"Original request"},
      {"role":"ted","text":"What deadline applies?"},
      {"role":"user","text":"Friday"}
    ]'
  )
);
reset role;
select ok(
  (
    select result->>'idempotent_replay' = 'true'
      and result->>'conversation_revision' = '1'
    from conversation_results where name = 'first-replay'
  )
  and (
    select conversation_revision = 1
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  'an acknowledgement retry replays without another conversation revision'
);

set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.save_own_outcome_conversation(
      'e2000000-0000-4000-8000-000000000011', 0,
      'conversation-save-0',
      '[{"role":"user","text":"Different replay"}]'
    )$$,
    '%OUTCOME_CONVERSATION_REPLAY_CONFLICT%'
  ),
  'one request identity cannot acknowledge different conversation content'
);
insert into conversation_results(name, result)
values (
  'second',
  public.save_own_outcome_conversation(
    'e2000000-0000-4000-8000-000000000011',
    1,
    'conversation-save-1',
    '[
      {"role":"user","text":"Original request"},
      {"role":"ted","text":"What deadline applies?"},
      {"role":"user","text":"Friday at 5pm"}
    ]'
  )
);
insert into conversation_results(name, result)
values (
  'first-replay-after-second',
  public.save_own_outcome_conversation(
    'e2000000-0000-4000-8000-000000000011',
    0,
    'conversation-save-0',
    '[
      {"role":"user","text":"Original request"},
      {"role":"ted","text":"What deadline applies?"},
      {"role":"user","text":"Friday"}
    ]'
  )
);
select ok(
  (
    select result->>'state' = 'superseded'
      and result->>'accepted_conversation_revision' = '0'
      and result->>'committed_conversation_revision' = '1'
      and result->>'conversation_revision' = '2'
      and result->>'idempotent_replay' = 'true'
      and result->>'retryable' = 'false'
      and result->>'safe_next_action' = 'reload'
    from conversation_results where name = 'first-replay-after-second'
  )
  and (
    select conversation_revision = 2
      and recommendation_payload->'conversation'->2->>'text' = 'Friday at 5pm'
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  'an older exact receipt is superseded without lowering or mutating current conversation truth'
);
select ok(
  pg_temp.raises_matching(
    $$select public.save_own_outcome_conversation(
      'e2000000-0000-4000-8000-000000000011', 0,
      'late-old-conversation',
      '[{"role":"user","text":"Late old wording"}]'
    )$$,
    '%OUTCOME_CONVERSATION_REVISION_CONFLICT%'
  ),
  'a delayed older save cannot overwrite the newer accepted conversation'
);
select ok(
  pg_temp.raises_matching(
    $$select public.save_own_outcome_conversation(
      'e2000000-0000-4000-8000-000000000012', 0,
      'foreign-conversation',
      '[{"role":"user","text":"Forbidden"}]'
    )$$,
    '%OUTCOME_CONVERSATION_UNAVAILABLE%'
  ),
  'an owner cannot observe or mutate another account conversation'
);
reset role;

select ok(
  (
    select conversation_revision = 2
      and recommendation_payload->'conversation'->2->>'text' = 'Friday at 5pm'
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  'the newest ordered conversation is the only durable current value'
);

select ok(
  pg_temp.raises_matching(
    $$update public.outcomes
      set conversation_revision = 999
      where id = 'e2000000-0000-4000-8000-000000000011'$$,
    '%OUTCOME_CONVERSATION_REVISION_MANAGED%'
  ),
  'direct callers cannot forge the managed conversation revision'
);
update public.outcomes
set recommendation_payload = pg_catalog.jsonb_set(
  recommendation_payload,
  '{conversation}',
  '[{"role":"user","text":"Legacy client update"}]'::jsonb,
  true
)
where id = 'e2000000-0000-4000-8000-000000000011';
select is(
  (
    select conversation_revision
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  3,
  'retained whole-payload compatibility writes rotate the CAS'
);
update public.outcomes
set is_saved = false
where id = 'e2000000-0000-4000-8000-000000000011';
select is(
  (
    select conversation_revision
    from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000011'
  ),
  3,
  'unrelated outcome state changes do not advance conversation revision'
);
select ok(
  pg_temp.raises_matching(
    $$update private.outcome_conversation_save_receipts
      set request_sha256 = repeat('0', 64)$$,
    '%OUTCOME_CONVERSATION_RECEIPT_IMMUTABLE%'
  )
  and not exists (
    select 1
    from private.outcome_conversation_save_receipts
    where result::text like '%Friday%'
  ),
  'conversation receipts are immutable and contain no user wording'
);

select * from finish();
rollback;
