begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;
select no_plan();

create or replace function pg_temp.raises_matching(p_sql text, p_pattern text)
returns boolean language plpgsql as $function$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlerrm like p_pattern;
end;
$function$;

create or replace function pg_temp.wait_for_advisory_lock(
  p_backend_pid integer,
  p_timeout interval default interval '2 seconds'
) returns boolean language plpgsql as $function$
declare
  v_deadline timestamptz := pg_catalog.clock_timestamp() + p_timeout;
  v_waiting boolean;
begin
  loop
    select exists (
      select 1
      from pg_catalog.pg_stat_activity
      where pid = p_backend_pid
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    ) into v_waiting;
    if v_waiting then return true; end if;
    if pg_catalog.clock_timestamp() >= v_deadline then return false; end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;

create or replace function pg_temp.insert_completed_upload(
  p_upload_id uuid,
  p_user_id uuid,
  p_file_name text,
  p_file_type text,
  p_file_size integer,
  p_content_sha256 text,
  p_extracted_text text
) returns void language plpgsql as $function$
begin
  insert into public.uploads(
    id, user_id, storage_path, file_type, file_name, file_size_bytes,
    extracted_text, extracted_payload, status, idempotency_key, completed_at,
    ingest_request_sha256, ingest_content_sha256, ingest_status, ingest_stage,
    ingest_http_status, ingest_response
  ) values (
    p_upload_id, p_user_id,
    p_user_id::text || '/' || p_upload_id::text || '/' || p_file_name,
    p_file_type, p_file_name, p_file_size,
    p_extracted_text,
    '{"original_retained":true,"classification_status":"completed"}'::jsonb,
    'ready', p_upload_id::text, now(),
    pg_catalog.repeat('a', 64), p_content_sha256,
    'completed', 'terminal', 200,
    pg_catalog.jsonb_build_object(
      'upload_id', p_upload_id,
      'original_retained', true,
      'classification_status', 'completed',
      'confirm_payload', pg_catalog.jsonb_build_object(
        'summary', 'Synthetic Home source',
        'document_type', 'text file',
        'structure', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('title', 'Source', 'items', pg_catalog.jsonb_build_array('Fact'))
        ),
        'filename', p_file_name,
        'char_count', pg_catalog.char_length(p_extracted_text),
        'truncated', false
      )
    )
  );
end;
$function$;

select has_table(
  'private', 'home_upload_intakes',
  'Home upload state is durable before an outcome exists'
);
select has_function(
  'public', 'begin_own_home_upload_intake_v1',
  array['uuid','uuid','text','text','text','integer','text'],
  'the owner registers deterministic Home upload identity before ingest'
);
select has_function(
  'public', 'get_own_home_upload_intake_v1', array['uuid'],
  'the browser reloads its current owner-bound Home intake'
);
select has_function(
  'public', 'confirm_own_home_upload_intake_v1',
  array['uuid','integer','text'],
  'corrected upload text is committed with revision CAS'
);
select has_function(
  'public', 'cancel_own_home_upload_intake_v1', array['uuid','integer'],
  'abandoning a Home upload is a durable transition'
);
select has_function(
  'public', 'commit_own_home_upload_intake_v1',
  array['uuid','integer','text','jsonb'],
  'the confirmed intake becomes one outcome atomically'
);
select ok(
  (
    select pg_catalog.count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace namespace_record
      on namespace_record.oid = function_record.pronamespace
    where namespace_record.nspname = 'public'
      and function_record.proname in (
        'begin_own_home_upload_intake_v1',
        'get_own_home_upload_intake_v1',
        'confirm_own_home_upload_intake_v1',
        'cancel_own_home_upload_intake_v1',
        'commit_own_home_upload_intake_v1'
      )
      and function_record.prosecdef
      and function_record.proconfig @> array['search_path=""']::text[]
  ) = 5,
  'every Home intake command is fixed-path and SECURITY DEFINER'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.home_upload_intakes', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon', 'private.home_upload_intakes', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'service_role', 'private.home_upload_intakes', 'SELECT'
  )
  and pg_catalog.has_function_privilege(
    'authenticated',
    'public.begin_own_home_upload_intake_v1(uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role',
    'public.begin_own_home_upload_intake_v1(uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.get_own_home_upload_intake_v1(uuid)', 'EXECUTE'
  ),
  'private rows are hidden and each command has the least-privilege caller'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('e1000000-0000-4000-8000-000000000001', 'home-owner@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'home-other@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'home-delete@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000004', 'home-corrupt@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000005', 'home-fenced-begin@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000006', 'home-fenced-confirm@example.invalid', false, false, now(), now()),
  ('e1000000-0000-4000-8000-000000000007', 'home-fenced-commit@example.invalid', false, false, now(), now());

create temporary table home_results(
  name text primary key,
  result jsonb not null
) on commit drop;
grant select, insert, update on home_results to authenticated, service_role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'begin',
  public.begin_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'Please help me use this source.',
    'source.txt', 'text/plain', 21, pg_catalog.repeat('b', 64)
  )
);
reset role;
select ok(
  (
    select result->>'contract_version' = 'home-upload-intake.v1'
      and result->>'state' = 'open'
      and result->>'upload_state' = 'file_required'
      and result->>'revision' = '1'
    from home_results where name = 'begin'
  ),
  'the intake is durable before the first ingest request'
);
select ok(
  exists (
    select 1 from private.home_upload_intakes intake_record
    where intake_record.intake_id = 'e2000000-0000-4000-8000-000000000001'
      and intake_record.user_id = 'e1000000-0000-4000-8000-000000000001'
      and intake_record.state = 'open'
      and intake_record.revision = 1
  ) and not exists (
    select 1 from public.uploads
    where id = 'e3000000-0000-4000-8000-000000000001'
  ),
  'no Storage or provider-capable upload row exists before intake acknowledgement'
);

insert into public.uploads(
  id, user_id, storage_path, file_type, file_name, file_size_bytes,
  extracted_text, extracted_payload, status, idempotency_key, completed_at,
  ingest_request_sha256, ingest_content_sha256, ingest_status, ingest_stage,
  ingest_http_status, ingest_response
) values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/source.txt',
  'text/plain', 'source.txt', 21,
  'Raw retained source.',
  '{"original_retained":true,"classification_status":"completed"}'::jsonb,
  'ready', 'e3000000-0000-4000-8000-000000000001', now(),
  pg_catalog.repeat('a', 64), pg_catalog.repeat('b', 64),
  'completed', 'terminal', 200,
  '{"upload_id":"e3000000-0000-4000-8000-000000000001","original_retained":true,"classification_status":"completed","confirm_payload":{"summary":"Synthetic Home source","document_type":"text file","structure":[{"title":"Source","items":["Fact"]}],"filename":"source.txt","char_count":20,"truncated":false}}'::jsonb
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'loaded',
  public.get_own_home_upload_intake_v1(null)
);
select ok(
  (
    select result->>'contract_version' = 'home-upload-intake.v1'
      and result->>'intake_id' = 'e2000000-0000-4000-8000-000000000001'
      and result->>'owner_user_id' = 'e1000000-0000-4000-8000-000000000001'
      and result->>'state' = 'open'
      and result->>'upload_state' = 'awaiting_confirmation'
      and result->>'extracted_text' = 'Raw retained source.'
      and result#>>'{confirm_payload,filename}' = 'source.txt'
    from home_results where name = 'loaded'
  ),
  'reload returns only the exact durable completed intake state'
);

reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true
);
set local role authenticated;
select public.begin_own_home_upload_intake_v1(
  'e2000000-0000-4000-8000-000000000004',
  'e3000000-0000-4000-8000-000000000004',
  'Do not expose a corrupt completion.',
  'corrupt.txt', 'text/plain', 17, pg_catalog.repeat('4', 64)
);
reset role;
insert into public.uploads(
  id, user_id, storage_path, file_type, file_name, file_size_bytes,
  extracted_text, extracted_payload, status, idempotency_key, completed_at,
  ingest_request_sha256, ingest_content_sha256, ingest_status, ingest_stage,
  ingest_http_status, ingest_response
) values (
  'e3000000-0000-4000-8000-000000000004',
  'e1000000-0000-4000-8000-000000000004',
  'e1000000-0000-4000-8000-000000000004/e3000000-0000-4000-8000-000000000004/corrupt.txt',
  'text/plain', 'corrupt.txt', 17,
  'Sensitive corrupt text.',
  '{"original_retained":true,"classification_status":"completed"}'::jsonb,
  'ready', 'e3000000-0000-4000-8000-000000000004', now(),
  pg_catalog.repeat('3', 64), pg_catalog.repeat('4', 64),
  'completed', 'terminal', 200,
  '{"upload_id":"wrong","confirm_payload":{"filename":"corrupt.txt"}}'::jsonb
);
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000004', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'corrupt-loaded',
  public.get_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000004'
  )
);
reset role;
select ok(
  (
    select result->>'upload_state' = 'terminal_failure'
      and result->'extracted_text' = 'null'::jsonb
      and result->'confirm_payload' = 'null'::jsonb
    from home_results where name = 'corrupt-loaded'
  ),
  'invalid completed-upload data is never exposed for confirmation'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

insert into home_results(name, result)
values (
  'confirmed',
  public.confirm_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000001', 1,
    'User corrected retained source.'
  )
);
select ok(
  (
    select result->>'state' = 'confirmed'
      and result->>'revision' = '2'
      and result->>'confirmed_text' = 'User corrected retained source.'
      and result->>'idempotent_replay' = 'false'
    from home_results where name = 'confirmed'
  ),
  'the corrected text is durably confirmed at the next revision'
);
insert into home_results(name, result)
values (
  'confirmed-replay',
  public.confirm_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000001', 1,
    'User corrected retained source.'
  )
);
select is(
  (select result->>'idempotent_replay' from home_results where name = 'confirmed-replay'),
  'true',
  'a lost confirmation acknowledgement replays exactly'
);

insert into home_results(name, result)
values (
  'committed',
  public.commit_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000001', 2,
    'Create a source-grounded proposal.',
    '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[],"conversation":[],"situation":"forged situation","upload_context":"forged","upload_id":"forged"}'::jsonb
  )
);
reset role;
select ok(
  (
    select result->>'outcome_id' = 'e2000000-0000-4000-8000-000000000001'
      and result->>'state' = 'consumed'
      and result->>'revision' = '3'
      and result->>'idempotent_replay' = 'false'
    from home_results where name = 'committed'
  ),
  'one confirmed intake becomes one stable outcome identity'
);
select ok(
  (
    select snapshot->>'state' = 'consumed'
      and snapshot->>'outcome_id' = 'e2000000-0000-4000-8000-000000000001'
      and snapshot->'confirmed_text' = 'null'::jsonb
      and snapshot->'confirmed_text_sha256' = 'null'::jsonb
    from (
      select public.get_own_home_upload_intake_v1(null) as snapshot
    ) loaded
  ),
  'a lost acknowledgement exposes its consumed outcome identity without retained source'
);
select ok(
  exists (
    select 1 from public.outcomes outcome_record
    where outcome_record.id = 'e2000000-0000-4000-8000-000000000001'
      and outcome_record.user_id = 'e1000000-0000-4000-8000-000000000001'
      and outcome_record.recommendation_payload->>'upload_context' =
        'User corrected retained source.'
      and outcome_record.recommendation_payload->>'upload_id' =
        'e3000000-0000-4000-8000-000000000001'
      and outcome_record.recommendation_payload->>'situation' =
        'Create a source-grounded proposal.'
  )
  and (
    select outcome_id = 'e2000000-0000-4000-8000-000000000001'
    from public.uploads where id = 'e3000000-0000-4000-8000-000000000001'
  ),
  'the corrected text and upload provenance are bound atomically'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'commit-replay',
  public.commit_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000001', 2,
    'Create a source-grounded proposal.',
    '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[],"conversation":[],"situation":"forged situation","upload_context":"forged","upload_id":"forged"}'::jsonb
  )
);
select is(
  (select result->>'idempotent_replay' from home_results where name = 'commit-replay'),
  'true',
  'a lost outcome acknowledgement returns the same outcome exactly'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000001', 2,
      'Conflicting situation.',
      '{"primary":{"template_id":"other","reason":"Other"},"alternatives":[],"conversation":[]}'::jsonb
    )$$,
    '%HOME_UPLOAD_INTAKE_COMMIT_CONFLICT%'
  ),
  'a conflicting replay cannot rewrite the consumed outcome'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000001', 2,
      'Create a source-grounded proposal.',
      '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[],"conversation":[],"unexpected":true}'::jsonb
    )$$,
    '%HOME_UPLOAD_INTAKE_COMMIT_INVALID%'
  ),
  'unexpected recommendation fields are rejected before replay evaluation'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000001', 2,
      'Create a source-grounded proposal.',
      '{"primary":{"template_id":42,"reason":"Business Proposal"},"alternatives":[],"conversation":[]}'::jsonb
    )$$,
    '%HOME_UPLOAD_INTAKE_COMMIT_INVALID%'
  ),
  'numeric primary fields cannot pass recommendation validation through text coercion'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000001', 2,
      'Create a source-grounded proposal.',
      '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[{"template_id":"email","reason":true}],"conversation":[]}'::jsonb
    )$$,
    '%HOME_UPLOAD_INTAKE_COMMIT_INVALID%'
  ),
  'boolean alternative fields cannot pass recommendation validation through text coercion'
);
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000001', 2,
      'Create a source-grounded proposal.',
      '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[],"conversation":[{"role":"user","text":99}]}'::jsonb
    )$$,
    '%HOME_UPLOAD_INTAKE_COMMIT_INVALID%'
  ),
  'numeric conversation text cannot pass recommendation validation through text coercion'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'cancel-begin',
  public.begin_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000002',
    'e3000000-0000-4000-8000-000000000002',
    'Cancel this intake.',
    'cancel.txt', 'text/plain', 9, pg_catalog.repeat('d', 64)
  )
);
reset role;
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'cancelled',
  public.cancel_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000002', 1
  )
);
select ok(
  (
    select result->>'state' = 'cancelled'
      and result->>'revision' = '2'
      and result->>'idempotent_replay' = 'false'
    from home_results where name = 'cancelled'
  ),
  'cancel persists before the Home card may disappear'
);
select lives_ok(
  $$insert into home_results(name, result)
    values (
      'restart-same-upload',
      public.begin_own_home_upload_intake_v1(
        'e2000000-0000-4000-8000-000000000008',
        'e3000000-0000-4000-8000-000000000002',
        'Cancel this intake.',
        'cancel.txt', 'text/plain', 9, pg_catalog.repeat('d', 64)
      )
    )$$,
  'a cancelled file can start a new intake with the same deterministic upload identity'
);
select ok(
  (
    select result->>'state' = 'open'
      and result->>'revision' = '1'
    from home_results where name = 'restart-same-upload'
  ),
  'the restarted same-file intake has a fresh revision stream'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true
);
set local role authenticated;
select is(
  public.get_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000001'
  ),
  null::jsonb,
  'another owner cannot discover an intake by exact identity'
);
reset role;

insert into private.account_deletion_fences(user_key)
values (private.account_deletion_user_key('e1000000-0000-4000-8000-000000000005'));
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000005', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.begin_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000005',
      'e3000000-0000-4000-8000-000000000005',
      'Fenced begin.', 'begin.txt', 'text/plain', 5, pg_catalog.repeat('5', 64)
    )$$,
    '%ACCOUNT_DELETION_FENCED%'
  ),
  'account deletion fencing prevents a new Home intake'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000006', true
);
set local role authenticated;
select public.begin_own_home_upload_intake_v1(
  'e2000000-0000-4000-8000-000000000006',
  'e3000000-0000-4000-8000-000000000006',
  'Fenced confirm.', 'confirm.txt', 'text/plain', 7, pg_catalog.repeat('6', 64)
);
reset role;
select pg_temp.insert_completed_upload(
  'e3000000-0000-4000-8000-000000000006',
  'e1000000-0000-4000-8000-000000000006',
  'confirm.txt', 'text/plain', 7, pg_catalog.repeat('6', 64), 'Confirm source.'
);
insert into private.account_deletion_fences(user_key)
values (private.account_deletion_user_key('e1000000-0000-4000-8000-000000000006'));
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000006', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.confirm_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000006', 1, 'Confirmed source.'
    )$$,
    '%ACCOUNT_DELETION_FENCED%'
  ),
  'account deletion fencing prevents upload confirmation'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000007', true
);
set local role authenticated;
select public.begin_own_home_upload_intake_v1(
  'e2000000-0000-4000-8000-000000000007',
  'e3000000-0000-4000-8000-000000000007',
  'Fenced commit.', 'commit.txt', 'text/plain', 8, pg_catalog.repeat('7', 64)
);
reset role;
select pg_temp.insert_completed_upload(
  'e3000000-0000-4000-8000-000000000007',
  'e1000000-0000-4000-8000-000000000007',
  'commit.txt', 'text/plain', 8, pg_catalog.repeat('7', 64), 'Commit source.'
);
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000007', true
);
set local role authenticated;
select public.confirm_own_home_upload_intake_v1(
  'e2000000-0000-4000-8000-000000000007', 1, 'Confirmed commit source.'
);
reset role;
insert into private.account_deletion_fences(user_key)
values (private.account_deletion_user_key('e1000000-0000-4000-8000-000000000007'));
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000007', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000007', 2,
      'Create a fenced outcome.',
      '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[],"conversation":[]}'::jsonb
    )$$,
    '%ACCOUNT_DELETION_FENCED%'
  ),
  'account deletion fencing prevents final outcome creation'
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true
);
set local role authenticated;
insert into home_results(name, result)
values (
  'delete-begin',
  public.begin_own_home_upload_intake_v1(
    'e2000000-0000-4000-8000-000000000003',
    'e3000000-0000-4000-8000-000000000003',
    'Delete cascade fixture.',
    'delete.txt', 'text/plain', 9, pg_catalog.repeat('f', 64)
  )
);
reset role;
delete from auth.users where id = 'e1000000-0000-4000-8000-000000000003';
select is(
  (
    select pg_catalog.count(*)::integer
    from private.home_upload_intakes
    where user_id = 'e1000000-0000-4000-8000-000000000003'
  ),
  0,
  'account deletion cascades private intake state'
);

update public.uploads
set outcome_id = null
where id = 'e3000000-0000-4000-8000-000000000001';
select pg_catalog.set_config(
  'request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.commit_own_home_upload_intake_v1(
      'e2000000-0000-4000-8000-000000000001', 2,
      'Create a source-grounded proposal.',
      '{"primary":{"template_id":"business-proposal","reason":"Business Proposal"},"alternatives":[],"conversation":[],"situation":"forged situation","upload_context":"forged","upload_id":"forged"}'::jsonb
    )$$,
    '%HOME_UPLOAD_INTAKE_COMMIT_CONFLICT%'
  ),
  'a consumed replay fails closed if its durable upload binding is missing'
);
reset role;
update public.uploads
set outcome_id = 'e2000000-0000-4000-8000-000000000001'
where id = 'e3000000-0000-4000-8000-000000000001';

select lives_ok(
  $$delete from auth.users
    where id = 'e1000000-0000-4000-8000-000000000001'$$,
  'deleting an owner with a consumed intake does not violate lifecycle constraints'
);
select ok(
  not exists (
    select 1 from private.home_upload_intakes
    where user_id = 'e1000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.outcomes
    where id = 'e2000000-0000-4000-8000-000000000001'
  ),
  'consumed intake and outcome state cascade together on account deletion'
);

-- Two real sessions prove the owner-scoped read waits for an in-flight
-- transition and then returns one coherent post-transition snapshot.
select extensions.dblink_connect(
  'home_intake_writer',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'home_intake_reader',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'home_intake_writer',
  $$delete from auth.users where id = 'e1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec(
  'home_intake_writer',
  $$insert into auth.users(
      id, email, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      'e1000000-0000-4000-8000-000000000099',
      'home-concurrency@example.invalid', false, false, now(), now()
    )$$
);
select extensions.dblink_exec(
  'home_intake_writer',
  $$insert into public.uploads(
      id, user_id, storage_path, file_type, file_name, file_size_bytes,
      extracted_text, extracted_payload, status, idempotency_key, completed_at,
      ingest_request_sha256, ingest_content_sha256, ingest_status, ingest_stage,
      ingest_http_status, ingest_response
    ) values (
      'e3000000-0000-4000-8000-000000000099',
      'e1000000-0000-4000-8000-000000000099',
      'e1000000-0000-4000-8000-000000000099/e3000000-0000-4000-8000-000000000099/concurrent.txt',
      'text/plain', 'concurrent.txt', 18, 'Concurrent source.',
      '{"original_retained":true,"classification_status":"completed"}'::jsonb,
      'ready', 'home-concurrency-upload', now(), repeat('a', 64), repeat('9', 64),
      'completed', 'terminal', 200,
      jsonb_build_object(
        'upload_id', 'e3000000-0000-4000-8000-000000000099',
        'original_retained', true,
        'classification_status', 'completed',
        'confirm_payload', jsonb_build_object(
          'summary', 'Concurrent Home source',
          'document_type', 'text file',
          'structure', jsonb_build_array(
            jsonb_build_object('title', 'Source', 'items', jsonb_build_array('Fact'))
          ),
          'filename', 'concurrent.txt',
          'char_count', char_length('Concurrent source.'),
          'truncated', false
        )
      )
    )$$
);
select extensions.dblink_exec(
  'home_intake_writer',
  $$set request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec(
  'home_intake_reader',
  $$set request.jwt.claim.sub = 'e1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec('home_intake_writer', 'set role authenticated');
select extensions.dblink_exec('home_intake_reader', 'set role authenticated');
select is(
  (
    select result->>'state'
    from extensions.dblink(
      'home_intake_writer',
      $$select public.begin_own_home_upload_intake_v1(
        'e2000000-0000-4000-8000-000000000099',
        'e3000000-0000-4000-8000-000000000099',
        'Concurrent Home intake.', 'concurrent.txt', 'text/plain', 18, repeat('9', 64)
      )$$
    ) as remote_result(result jsonb)
  ),
  'open',
  'the concurrency fixture begins as one committed open intake'
);
select is(
  (
    select result->>'state'
    from extensions.dblink(
      'home_intake_writer',
      $$select public.confirm_own_home_upload_intake_v1(
        'e2000000-0000-4000-8000-000000000099', 1,
        'Confirmed concurrent source.'
      )$$
    ) as remote_result(result jsonb)
  ),
  'confirmed',
  'fixture A is durably confirmed before the concurrent transition'
);
create temporary table home_concurrency_backend(pid integer not null) on commit drop;
insert into home_concurrency_backend(pid)
select pid
from extensions.dblink(
  'home_intake_reader', 'select pg_catalog.pg_backend_pid()'
) as remote_backend(pid integer);
select extensions.dblink_exec('home_intake_writer', 'begin');
select is(
  (
    select result->>'state'
    from extensions.dblink(
      'home_intake_writer',
      $$select public.commit_own_home_upload_intake_v1(
        'e2000000-0000-4000-8000-000000000099', 2,
        'Create a concurrent source-grounded outcome.',
        '{"primary":{"template_id":"resume","reason":"Resume"},"alternatives":[],"conversation":[]}'::jsonb
      )$$
    ) as remote_result(result jsonb)
  ),
  'consumed',
  'the writer consumes fixture A while retaining its owner lock'
);
select ok(
  (
    select result->>'intake_id' = 'e2000000-0000-4000-8000-000000000100'
      and result->>'state' = 'open'
      and result->>'revision' = '1'
      and result->>'upload_state' = 'file_required'
    from extensions.dblink(
      'home_intake_writer',
      $$select public.begin_own_home_upload_intake_v1(
        'e2000000-0000-4000-8000-000000000100',
        'e3000000-0000-4000-8000-000000000100',
        'Start the next Home outcome.', 'next.txt', 'text/plain', 4, repeat('8', 64)
      )$$
    ) as remote_result(result jsonb)
  ),
  'the writer stages a new active intake after consuming fixture A'
);
select is(
  extensions.dblink_send_query(
    'home_intake_reader',
    $$select public.get_own_home_upload_intake_v1(null)$$
  ),
  1,
  'the second session requests the default owner snapshot during both transitions'
);
select ok(
  extensions.dblink_is_busy('home_intake_reader') = 1
    and pg_temp.wait_for_advisory_lock(
      (select pid from home_concurrency_backend limit 1)
    ),
  'the default owner snapshot waits before selecting its active intake'
);
select extensions.dblink_exec('home_intake_writer', 'commit');
select results_eq(
  $$select result->>'intake_id', result->>'state',
      (result->>'revision')::integer, result->>'upload_state'
    from extensions.dblink_get_result(
      'home_intake_reader', false
    ) as remote_result(result jsonb)$$,
  $$values (
      'e2000000-0000-4000-8000-000000000100'::text,
      'open'::text, 1, 'file_required'::text
    )$$,
  'after commit the default loader selects new active B rather than consumed A'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result(
      'home_intake_reader', false
    ) as drained_result(result jsonb)
  ),
  0,
  'the asynchronous owner snapshot result is fully drained'
);
select ok(
  (
    select result->>'state' = 'consumed'
      and result->>'outcome_id' = 'e2000000-0000-4000-8000-000000000099'
      and result->'confirmed_text' = 'null'::jsonb
      and result->'confirmed_text_sha256' = 'null'::jsonb
    from extensions.dblink(
      'home_intake_reader',
      $$select public.get_own_home_upload_intake_v1(
        'e2000000-0000-4000-8000-000000000099'
      )$$
    ) as remote_result(result jsonb)
  ),
  'the authenticated exact consumed snapshot preserves identity while redacting source'
);
select extensions.dblink_exec('home_intake_writer', 'reset role');
select extensions.dblink_exec('home_intake_reader', 'reset role');
select extensions.dblink_exec(
  'home_intake_writer',
  $$delete from auth.users where id = 'e1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_disconnect('home_intake_reader');
select extensions.dblink_disconnect('home_intake_writer');

select * from finish();
rollback;
