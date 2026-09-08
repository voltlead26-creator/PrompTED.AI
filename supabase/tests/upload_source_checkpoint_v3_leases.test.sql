begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path=public,extensions;
select no_plan();

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


create function pg_temp.wait_for_upload_lock(p_waiter integer,p_blocker integer)
returns boolean language plpgsql as $function$
declare v_deadline timestamptz := clock_timestamp()+interval '2 seconds';
begin
  loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists(select 1 from pg_catalog.pg_stat_activity where pid=p_waiter
      and wait_event_type='Lock') and p_blocker=any(pg_catalog.pg_blocking_pids(p_waiter)) then return true; end if;
    if clock_timestamp()>=v_deadline then return false; end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;
select extensions.dblink_connect('rtf_lease_a',pg_temp.local_test_connection_string());
select extensions.dblink_connect('rtf_lease_b',pg_temp.local_test_connection_string());
select ok(pg_temp.require_local_test_sessions(array['rtf_lease_a','rtf_lease_b']),
  'v3 lease checks use independent backends in the identified disposable cluster');
select extensions.dblink_exec('rtf_lease_a','set statement_timeout=5000');
select extensions.dblink_exec('rtf_lease_b','set statement_timeout=5000');
create temp table rtf_lease_sessions(waiter integer not null,blocker integer not null);
insert into rtf_lease_sessions select b.pid,a.pid
  from extensions.dblink('rtf_lease_a','select pg_backend_pid()') as a(pid integer),
    extensions.dblink('rtf_lease_b','select pg_backend_pid()') as b(pid integer);

-- These are SQL checkpoint-state fixtures, not evidence of parsing file bytes.
select extensions.dblink_exec('rtf_lease_a',$remote$
do $setup$
declare v_slot integer; v_id uuid; v_version text; v_receipt jsonb; v_token uuid;
begin
  insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at)
  values ('71007081-0000-4000-8000-000000000001','rtf-lease@example.invalid',false,false,now(),now());
  for v_slot in 1..6 loop
    v_id := ('72007081-0000-4000-8000-'||lpad(v_slot::text,12,'0'))::uuid;
    v_version := case v_slot when 4 then 'upload-extraction.1' when 5 then 'upload-extraction.2' else 'upload-extraction.3' end;
    v_receipt := public.claim_upload_ingest(v_id,'71007081-0000-4000-8000-000000000001',
      '71007081-0000-4000-8000-000000000001/'||v_id::text||'/source.txt','text/plain','source.txt',4,
      repeat('a',64),repeat('c',64),v_version);
    if v_receipt->>'outcome' is distinct from 'accepted' then raise exception 'RTF_LEASE_FIXTURE_NOT_ACCEPTED'; end if;
    v_token := (v_receipt->>'claim_token')::uuid;
    if v_slot<=3 then
      perform public.advance_upload_ingest(v_id,'71007081-0000-4000-8000-000000000001',
        repeat('a',64),v_token,'prepared','storage_dispatched');
      perform public.advance_upload_ingest(v_id,'71007081-0000-4000-8000-000000000001',
        repeat('a',64),v_token,'storage_dispatched','storage_completed');
    end if;
    if v_slot=3 then
      perform public.record_upload_extraction_snapshot(v_id,'71007081-0000-4000-8000-000000000001',
        repeat('a',64),v_token,repeat('c',64),encode(extensions.digest(convert_to('text','UTF8'),'sha256'),'hex'),
        'text','text',false,'upload-resource-policy.2','upload-extraction.3',null);
      perform public.advance_upload_ingest(v_id,'71007081-0000-4000-8000-000000000001',
        repeat('a',64),v_token,'storage_completed','provider_dispatched');
    end if;
  end loop;
end;
$setup$;
$remote$);
select is((select count(*)::integer from public.uploads where user_id='71007081-0000-4000-8000-000000000001'
  and ingest_lease_expires_at>clock_timestamp()),6,'all six committed fixtures have positive live leases');
create temp table rtf_lease_original_tokens as select id,ingest_claim_token from public.uploads
  where user_id='71007081-0000-4000-8000-000000000001';
select extensions.dblink_exec('rtf_lease_b',$remote$
create function pg_temp.call_upload(p_slot integer) returns text language plpgsql as $call$
declare v_id uuid := ('72007081-0000-4000-8000-'||lpad(p_slot::text,12,'0'))::uuid;
  v_token uuid; v_result jsonb;
begin
  select ingest_claim_token into strict v_token from public.uploads where id=v_id;
  case p_slot
    when 1 then v_result := public.begin_upload_extraction_attempt(v_id,'71007081-0000-4000-8000-000000000001',
      repeat('a',64),v_token);
    when 2 then v_result := public.record_upload_extraction_snapshot(v_id,'71007081-0000-4000-8000-000000000001',
      repeat('a',64),v_token,repeat('c',64),encode(extensions.digest(convert_to('text','UTF8'),'sha256'),'hex'),
      'text','text',false,'upload-resource-policy.2','upload-extraction.3',null);
    when 3 then v_result := public.advance_upload_ingest(v_id,'71007081-0000-4000-8000-000000000001',
      repeat('a',64),v_token,'storage_completed','provider_dispatched');
    else v_result := public.claim_upload_ingest(v_id,'71007081-0000-4000-8000-000000000001',
      '71007081-0000-4000-8000-000000000001/'||v_id::text||'/source.txt','text/plain','source.txt',4,
      repeat('a',64),repeat('c',64),'upload-extraction.3');
  end case;
  return v_result->>'outcome';
exception when others then return sqlerrm;
end;
$call$;
$remote$);

select ok((select ingest_lease_expires_at>clock_timestamp() from public.uploads where id='72007081-0000-4000-8000-000000000001'),
  'attempt starts with a live fixture lease');
select extensions.dblink_exec('rtf_lease_a','begin');
select extensions.dblink_exec('rtf_lease_a',$remote$do $lock$begin perform 1 from public.uploads where id='72007081-0000-4000-8000-000000000001' for update; end;$lock$;$remote$);
select is(extensions.dblink_send_query('rtf_lease_b','select pg_temp.call_upload(1)'),1,
  'attempt is dispatched while its lease is live');
select ok(pg_temp.wait_for_upload_lock(waiter,blocker),'attempt is observed waiting on the exact test blocker') from rtf_lease_sessions;
select extensions.dblink_exec('rtf_lease_a',$remote$update public.uploads set ingest_lease_expires_at=clock_timestamp()
  where id='72007081-0000-4000-8000-000000000001'$remote$);
select extensions.dblink_exec('rtf_lease_a','commit');
select is((select result from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  'UPLOAD_EXTRACTION_ATTEMPT_CONFLICT','attempt preserves the stored-version contract after lock-wait expiry');
select is((select count(*)::integer from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  0,'attempt asynchronous response is fully drained');
select ok((select u.ingest_claim_token=t.ingest_claim_token and u.ingest_lease_expires_at<=clock_timestamp()
  from public.uploads u join rtf_lease_original_tokens t using(id) where u.id='72007081-0000-4000-8000-000000000001'),
  'attempt does not rotate a token or renew an expired lease');

select ok((select ingest_lease_expires_at>clock_timestamp() from public.uploads where id='72007081-0000-4000-8000-000000000002'),
  'record starts with a live fixture lease');
select extensions.dblink_exec('rtf_lease_a','begin');
select extensions.dblink_exec('rtf_lease_a',$remote$do $lock$begin perform 1 from public.uploads where id='72007081-0000-4000-8000-000000000002' for update; end;$lock$;$remote$);
select is(extensions.dblink_send_query('rtf_lease_b','select pg_temp.call_upload(2)'),1,
  'record is dispatched while its lease is live');
select ok(pg_temp.wait_for_upload_lock(waiter,blocker),'record is observed waiting on the exact test blocker') from rtf_lease_sessions;
select extensions.dblink_exec('rtf_lease_a',$remote$update public.uploads set ingest_lease_expires_at=clock_timestamp()
  where id='72007081-0000-4000-8000-000000000002'$remote$);
select extensions.dblink_exec('rtf_lease_a','commit');
select is((select result from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  'UPLOAD_EXTRACTION_CHECKPOINT_CONFLICT','record preserves the stored-version contract after lock-wait expiry');
select is((select count(*)::integer from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  0,'record asynchronous response is fully drained');
select ok((select u.ingest_claim_token=t.ingest_claim_token and u.ingest_lease_expires_at<=clock_timestamp()
  from public.uploads u join rtf_lease_original_tokens t using(id) where u.id='72007081-0000-4000-8000-000000000002'),
  'record does not rotate a token or renew an expired lease');

select ok((select ingest_lease_expires_at>clock_timestamp() from public.uploads where id='72007081-0000-4000-8000-000000000003'),
  'provider replay starts with a live fixture lease');
select extensions.dblink_exec('rtf_lease_a','begin');
select extensions.dblink_exec('rtf_lease_a',$remote$do $lock$begin perform pg_advisory_xact_lock(hashtextextended('71007081-0000-4000-8000-000000000001',91000)); end;$lock$;$remote$);
select is(extensions.dblink_send_query('rtf_lease_b','select pg_temp.call_upload(3)'),1,
  'provider replay is dispatched while its lease is live');
select ok(pg_temp.wait_for_upload_lock(waiter,blocker),'provider replay is observed waiting on the exact test blocker') from rtf_lease_sessions;
select extensions.dblink_exec('rtf_lease_a',$remote$update public.uploads set ingest_lease_expires_at=clock_timestamp()
  where id='72007081-0000-4000-8000-000000000003'$remote$);
select extensions.dblink_exec('rtf_lease_a','commit');
select is((select result from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  'UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED','provider replay preserves the stored-version contract after lock-wait expiry');
select is((select count(*)::integer from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  0,'provider replay asynchronous response is fully drained');
select ok((select u.ingest_claim_token=t.ingest_claim_token and u.ingest_lease_expires_at<=clock_timestamp()
  from public.uploads u join rtf_lease_original_tokens t using(id) where u.id='72007081-0000-4000-8000-000000000003'),
  'provider replay does not rotate a token or renew an expired lease');

select ok((select ingest_lease_expires_at>clock_timestamp() from public.uploads where id='72007081-0000-4000-8000-000000000004'),
  'historical v1 claim starts with a live fixture lease');
select extensions.dblink_exec('rtf_lease_a','begin');
select extensions.dblink_exec('rtf_lease_a',$remote$do $lock$begin perform pg_advisory_xact_lock(hashtextextended('71007081-0000-4000-8000-000000000001',91000)); end;$lock$;$remote$);
select is(extensions.dblink_send_query('rtf_lease_b','select pg_temp.call_upload(4)'),1,
  'historical v1 claim is dispatched while its lease is live');
select ok(pg_temp.wait_for_upload_lock(waiter,blocker),'historical v1 claim is observed waiting on the exact test blocker') from rtf_lease_sessions;
select extensions.dblink_exec('rtf_lease_a',$remote$update public.uploads set ingest_lease_expires_at=clock_timestamp()
  where id='72007081-0000-4000-8000-000000000004'$remote$);
select extensions.dblink_exec('rtf_lease_a','commit');
select is((select result from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  'processing','historical v1 claim preserves the stored-version contract after lock-wait expiry');
select is((select count(*)::integer from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  0,'historical v1 claim asynchronous response is fully drained');
select ok((select u.ingest_claim_token=t.ingest_claim_token and u.ingest_lease_expires_at<=clock_timestamp()
  from public.uploads u join rtf_lease_original_tokens t using(id) where u.id='72007081-0000-4000-8000-000000000004'),
  'historical v1 claim does not rotate a token or renew an expired lease');

select ok((select ingest_lease_expires_at>clock_timestamp() from public.uploads where id='72007081-0000-4000-8000-000000000005'),
  'historical v2 claim starts with a live fixture lease');
select extensions.dblink_exec('rtf_lease_a','begin');
select extensions.dblink_exec('rtf_lease_a',$remote$do $lock$begin perform pg_advisory_xact_lock(hashtextextended('71007081-0000-4000-8000-000000000001',91000)); end;$lock$;$remote$);
select is(extensions.dblink_send_query('rtf_lease_b','select pg_temp.call_upload(5)'),1,
  'historical v2 claim is dispatched while its lease is live');
select ok(pg_temp.wait_for_upload_lock(waiter,blocker),'historical v2 claim is observed waiting on the exact test blocker') from rtf_lease_sessions;
select extensions.dblink_exec('rtf_lease_a',$remote$update public.uploads set ingest_lease_expires_at=clock_timestamp()
  where id='72007081-0000-4000-8000-000000000005'$remote$);
select extensions.dblink_exec('rtf_lease_a','commit');
select is((select result from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  'processing','historical v2 claim preserves the stored-version contract after lock-wait expiry');
select is((select count(*)::integer from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  0,'historical v2 claim asynchronous response is fully drained');
select ok((select u.ingest_claim_token=t.ingest_claim_token and u.ingest_lease_expires_at<=clock_timestamp()
  from public.uploads u join rtf_lease_original_tokens t using(id) where u.id='72007081-0000-4000-8000-000000000005'),
  'historical v2 claim does not rotate a token or renew an expired lease');

select ok((select ingest_lease_expires_at>clock_timestamp() from public.uploads where id='72007081-0000-4000-8000-000000000006'),
  'stored v3 claim starts with a live fixture lease');
select extensions.dblink_exec('rtf_lease_a','begin');
select extensions.dblink_exec('rtf_lease_a',$remote$do $lock$begin perform pg_advisory_xact_lock(hashtextextended('71007081-0000-4000-8000-000000000001',91000)); end;$lock$;$remote$);
select is(extensions.dblink_send_query('rtf_lease_b','select pg_temp.call_upload(6)'),1,
  'stored v3 claim is dispatched while its lease is live');
select ok(pg_temp.wait_for_upload_lock(waiter,blocker),'stored v3 claim is observed waiting on the exact test blocker') from rtf_lease_sessions;
select extensions.dblink_exec('rtf_lease_a',$remote$update public.uploads set ingest_lease_expires_at=clock_timestamp()
  where id='72007081-0000-4000-8000-000000000006'$remote$);
select extensions.dblink_exec('rtf_lease_a','commit');
select is((select result from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  'resumed','stored v3 claim evaluates expiry after acquiring the lock');
select is((select count(*)::integer from extensions.dblink_get_result('rtf_lease_b') as r(result text)),
  0,'stored v3 claim asynchronous response is fully drained');
select ok((select u.ingest_claim_token<>t.ingest_claim_token and u.ingest_lease_expires_at>clock_timestamp()
  and u.ingest_extraction_contract_version='upload-extraction.3' and u.ingest_stage='prepared'
  from public.uploads u join rtf_lease_original_tokens t using(id) where u.id='72007081-0000-4000-8000-000000000006'),
  'stored v3 claim rotates its token with a fresh lease and retains accepted state');

select is((select ingest_extraction_attempt_count from public.uploads where id='72007081-0000-4000-8000-000000000001'),
  0,'expired attempt performs no durable increment');
select is((select ingest_extraction_text from public.uploads where id='72007081-0000-4000-8000-000000000002'),
  null::text,'expired record persists no text');
select is((select ingest_stage from public.uploads where id='72007081-0000-4000-8000-000000000003'),
  'provider_dispatched','expired replay preserves the valid earlier provider stage');
select extensions.dblink_exec('rtf_lease_a',$remote$delete from public.uploads
  where user_id='71007081-0000-4000-8000-000000000001' and id in (
    '72007081-0000-4000-8000-000000000001','72007081-0000-4000-8000-000000000002',
    '72007081-0000-4000-8000-000000000003','72007081-0000-4000-8000-000000000004',
    '72007081-0000-4000-8000-000000000005','72007081-0000-4000-8000-000000000006')$remote$);
select extensions.dblink_exec('rtf_lease_a',$remote$delete from auth.users
  where id='71007081-0000-4000-8000-000000000001'$remote$);
select extensions.dblink_disconnect('rtf_lease_a');
select extensions.dblink_disconnect('rtf_lease_b');
select is((select count(*)::integer from auth.users where id='71007081-0000-4000-8000-000000000001'),
  0,'only exact committed lease fixtures are removed');
select * from finish();
rollback;
