begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
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

create or replace function pg_temp.wait_for_lock(p_pid integer)
returns boolean
language plpgsql
as $function$
declare
  v_deadline timestamptz := clock_timestamp() + interval '2 seconds';
begin
  loop
    if exists (
      select 1
      from pg_catalog.pg_stat_activity activity
      where activity.pid = p_pid
        and activity.wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    if clock_timestamp() >= v_deadline then return false; end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$function$;

select has_table(
  'private', 'legacy_section_edit_operations',
  'legacy TED suggestions have a private durable operation table'
);
select has_function(
  'public', 'prepare_legacy_section_edit',
  array['uuid','uuid','uuid','uuid','integer','text','text','jsonb'],
  'service prepare binds one exact owner document section revision and hash'
);
select has_function(
  'public', 'complete_legacy_section_edit',
  array['uuid','uuid','text','text','text','jsonb','jsonb'],
  'service completion persists one immutable suggestion before SSE success'
);
select has_function(
  'public', 'mark_legacy_section_edit_dispatched',
  array['uuid','uuid','text'],
  'service dispatch claim prevents provider redispatch'
);
select has_function(
  'public', 'settle_legacy_section_edit',
  array['uuid','uuid','text','text','text'],
  'service settlement persists exact terminal replay state'
);
select has_function(
  'public', 'save_legacy_section',
  array['uuid','integer','text','text','text'],
  'authenticated manual save is a revision and hash CAS command'
);
select has_function(
  'public', 'apply_legacy_section_edit',
  array['uuid','integer','text','text'],
  'authenticated apply is a revision-bound CAS command'
);
select has_function(
  'public', 'discard_legacy_section_edit', array['uuid','text'],
  'authenticated discard terminalises a saved suggestion'
);
select has_function(
  'public', 'get_latest_legacy_section_edit', array['uuid'],
  'authenticated reload recovery is bounded to one section'
);
select ok(
  lower(pg_get_functiondef(
    'public.get_latest_legacy_section_edit(uuid)'::regprocedure
  )) ~ (
    'from private[.]legacy_section_edit_operations'
    || '[[:space:][:print:]]*for update;'
    || '[[:space:][:print:]]*from public[.]sections'
    || '[[:space:][:print:]]*for update;'
  ),
  'recovery locks the owner operation before reloading and locking its exact section'
);
select ok(
  not has_table_privilege(
    'service_role', 'private.legacy_section_edit_operations', 'SELECT'
  ) and not has_table_privilege(
    'authenticated', 'private.legacy_section_edit_operations', 'SELECT'
  ),
  'neither protected compute nor browser roles can read the private table directly'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.prepare_legacy_section_edit(uuid,uuid,uuid,uuid,integer,text,text,jsonb)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.prepare_legacy_section_edit(uuid,uuid,uuid,uuid,integer,text,text,jsonb)',
    'EXECUTE'
  ) and has_function_privilege(
    'service_role',
    'public.mark_legacy_section_edit_dispatched(uuid,uuid,text)',
    'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.apply_legacy_section_edit(uuid,integer,text,text)',
    'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.save_legacy_section(uuid,integer,text,text,text)',
    'EXECUTE'
  ),
  'provider lifecycle is service-only while save and Apply are owner-authenticated'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_proc function_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = function_record.pronamespace
    where schema_record.nspname = 'public'
      and function_record.proname in (
        'prepare_legacy_section_edit', 'complete_legacy_section_edit',
        'mark_legacy_section_edit_dispatched', 'settle_legacy_section_edit',
        'save_legacy_section',
        'apply_legacy_section_edit', 'discard_legacy_section_edit',
        'get_latest_legacy_section_edit'
      )
      and function_record.prosecdef
      and pg_catalog.array_to_string(function_record.proconfig, ',') in (
        'search_path=', 'search_path=""'
      )
  ),
  8,
  'all eight public commands are SECURITY DEFINER with an empty search path'
);
select is(
  (
    select count(*)::integer
    from pg_catalog.pg_trigger trigger_record
    join pg_catalog.pg_class table_record
      on table_record.oid = trigger_record.tgrelid
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = table_record.relnamespace
    where not trigger_record.tgisinternal
      and (
        (schema_record.nspname = 'private'
          and table_record.relname = 'legacy_section_edit_operations'
          and trigger_record.tgname = 'legacy_section_edit_operation_guard')
        or
        (schema_record.nspname = 'public'
          and table_record.relname = 'sections'
          and trigger_record.tgname = 'legacy_sections_revision_owner')
      )
  ),
  2,
  'operation immutability and legacy section revision triggers are installed'
);

insert into auth.users(id, email, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', 'edit-owner@example.invalid', false, false, now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'edit-other@example.invalid', false, false, now(), now()),
  ('a1000000-0000-4000-8000-000000000003', 'edit-delete@example.invalid', false, false, now(), now());

insert into public.documents(
  id, user_id, title, content, status, workspace_sections, format,
  current_revision, approved_revision
) values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Owner legacy document', '', 'approved', '[]', 'Word', 1, 1
  ),
  (
    'a2000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000003',
    'Cascade document', '', 'draft', '[]', 'Word', 1, null
  ),
  (
    'a2000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000001',
    'Cross-tab legacy document', '', 'draft', '[]', 'Word', 1, null
  ),
  (
    'a2000000-0000-4000-8000-000000000010',
    'a1000000-0000-4000-8000-000000000001',
    'Ready replay document', '', 'draft', '[]', 'Word', 1, null
  ),
  (
    'a2000000-0000-4000-8000-000000000011',
    'a1000000-0000-4000-8000-000000000001',
    'Expired accepted document', '', 'draft', '[]', 'Word', 1, null
  ),
  (
    'a2000000-0000-4000-8000-000000000012',
    'a1000000-0000-4000-8000-000000000001',
    'Expired dispatched document', '', 'draft', '[]', 'Word', 1, null
  ),
  (
    'a2000000-0000-4000-8000-000000000013',
    'a1000000-0000-4000-8000-000000000001',
    'Active accepted document', '', 'draft', '[]', 'Word', 1, null
  ),
  (
    'a2000000-0000-4000-8000-000000000014',
    'a1000000-0000-4000-8000-000000000001',
    'Active dispatched document', '', 'draft', '[]', 'Word', 1, null
  );

insert into public.sections(
  id, document_id, user_id, name, order_index, content, status,
  version_history, is_required, revision, approved_revision
) values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Owner section', 0, '<p>Original wording.</p>', 'approved', '[]', true, 1, 1
  ),
  (
    'a3000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000003',
    'Cascade section', 0, '<p>Cascade wording.</p>', 'draft', '[]', true, 1, null
  ),
  (
    'a3000000-0000-4000-8000-000000000005',
    'a2000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000001',
    'Cross-tab section', 0, '<p>Shared r1.</p>', 'draft', '[]', true, 1, null
  ),
  (
    'a3000000-0000-4000-8000-000000000010',
    'a2000000-0000-4000-8000-000000000010',
    'a1000000-0000-4000-8000-000000000001',
    'Ready replay section', 0, '<p>Ready base r1.</p>', 'draft', '[]', true, 1, null
  ),
  (
    'a3000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000011',
    'a1000000-0000-4000-8000-000000000001',
    'Expired accepted section', 0, '<p>Accepted expiry.</p>', 'draft', '[]', true, 1, null
  ),
  (
    'a3000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000012',
    'a1000000-0000-4000-8000-000000000001',
    'Expired dispatched section', 0, '<p>Dispatched expiry.</p>', 'draft', '[]', true, 1, null
  ),
  (
    'a3000000-0000-4000-8000-000000000013',
    'a2000000-0000-4000-8000-000000000013',
    'a1000000-0000-4000-8000-000000000001',
    'Active accepted section', 0, '<p>Active accepted.</p>', 'draft', '[]', true, 1, null
  ),
  (
    'a3000000-0000-4000-8000-000000000014',
    'a2000000-0000-4000-8000-000000000014',
    'a1000000-0000-4000-8000-000000000001',
    'Active dispatched section', 0, '<p>Active dispatched.</p>', 'draft', '[]', true, 1, null
  );

-- Two accepted operations against the same revision prove the winner applies
-- once and the later concurrent result cannot overwrite it.
select is(
  public.prepare_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    1,
    encode(digest(convert_to('<p>Original wording.</p>', 'UTF8'), 'sha256'), 'hex'),
    repeat('1', 64),
    '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
  )->>'state',
  'accepted',
  'first service prepare accepts the authoritative persisted revision'
);
select is(
  public.prepare_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000001',
    1,
    encode(digest(convert_to('<p>Original wording.</p>', 'UTF8'), 'sha256'), 'hex'),
    repeat('2', 64),
    '{"contract_version":"legacy-section-edit.1","action":"shorten","scope":"section"}'::jsonb
  )->>'authoritative_content',
  '<p>Original wording.</p>',
  'provider input is reloaded from the authoritative row, not trusted browser text'
);

select is(
  public.mark_legacy_section_edit_dispatched(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001', repeat('1', 64)
  )->>'idempotent_replay',
  'false',
  'first dispatch claim admits one provider attempt'
);
select is(
  public.mark_legacy_section_edit_dispatched(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001', repeat('1', 64)
  )->>'idempotent_replay',
  'true',
  'dispatch replay cannot admit a second provider attempt'
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000002', repeat('2', 64)
);

select is(
  public.complete_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000001', repeat('1', 64),
    'Clear revised wording.', '<p>Clear revised wording.</p>',
    '["Clarified wording"]'::jsonb,
    '{"provider":"openai","response_id":"synthetic-1"}'::jsonb
  )->>'state',
  'ready',
  'completion durably records a reviewable suggestion'
);
select lives_ok(
  $$select public.complete_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000002', repeat('2', 64),
    'Short revised wording.', '<p>Short revised wording.</p>', '[]'::jsonb,
    '{"provider":"openai","response_id":"synthetic-2"}'::jsonb
  )$$,
  'a concurrent suggestion can finish but still cannot bypass Apply CAS'
);

select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000010',
  'a2000000-0000-4000-8000-000000000010',
  'a3000000-0000-4000-8000-000000000010', 1,
  encode(digest(convert_to('<p>Ready base r1.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('a', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000010', repeat('a', 64)
);
select public.complete_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000010', repeat('a', 64),
  'Ready suggestion.', '<p>Ready suggestion.</p>', '[]'::jsonb,
  '{"provider":"openai","response_id":"synthetic-ready-replay"}'::jsonb
);

select ok(
  pg_temp.raises_matching(
    $$update private.legacy_section_edit_operations
      set request_sha256 = repeat('9', 64)
      where id = 'a4000000-0000-4000-8000-000000000001'$$,
    '%LEGACY_SECTION_EDIT_IDENTITY_IMMUTABLE%'
  ),
  'accepted identity and request hash are immutable'
);
select ok(
  pg_temp.raises_matching(
    $$update private.legacy_section_edit_operations
      set suggested_content = 'forged'
      where id = 'a4000000-0000-4000-8000-000000000001'$$,
    '%LEGACY_SECTION_EDIT_SUGGESTION_IMMUTABLE%'
  ),
  'ready suggestion wording and metadata are immutable'
);
select ok(
  pg_temp.raises_matching(
    $$update private.legacy_section_edit_operations
      set status = 'cancelled'
      where id = 'a4000000-0000-4000-8000-000000000001'$$,
    '%LEGACY_SECTION_EDIT_TRANSITION_INVALID%'
  ),
  'ready cannot enter the impossible cancelled row shape'
);
select ok(
  pg_temp.raises_matching(
    $$delete from private.legacy_section_edit_operations
      where id = 'a4000000-0000-4000-8000-000000000001'$$,
    '%LEGACY_SECTION_EDIT_DELETE_FORBIDDEN%'
  ),
  'material operation rows cannot be deleted directly'
);

select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.save_legacy_section(
    'a3000000-0000-4000-8000-000000000005', 1,
    encode(digest(convert_to('<p>Shared r1.</p>', 'UTF8'), 'sha256'), 'hex'),
    '<p>Tab A r2.</p>', 'edited'
  )->>'section_revision',
  '2',
  'first browser session wins the expected revision/hash manual-save CAS'
);
select is(
  public.save_legacy_section(
    'a3000000-0000-4000-8000-000000000005', 1,
    encode(digest(convert_to('<p>Shared r1.</p>', 'UTF8'), 'sha256'), 'hex'),
    '<p>Tab A r2.</p>', 'edited'
  )->>'idempotent_replay',
  'true',
  'an exact lost manual-save acknowledgement returns authoritative truth idempotently'
);
select results_eq(
  $$select revision, jsonb_array_length(version_history)
    from public.sections
    where id = 'a3000000-0000-4000-8000-000000000005'$$,
  $$values (2, 1)$$,
  'exact manual-save replay does not append history or advance the section twice'
);
select is(
  (select current_revision from public.documents
    where id = 'a2000000-0000-4000-8000-000000000005'),
  2,
  'exact manual-save replay does not advance the parent document twice'
);
select ok(
  pg_temp.raises_matching(
    $$select public.save_legacy_section(
      'a3000000-0000-4000-8000-000000000005', 1,
      encode(digest(convert_to('<p>Shared r1.</p>', 'UTF8'), 'sha256'), 'hex'),
      '<p>Tab B stale overwrite.</p>', 'edited'
    )$$,
    '%LEGACY_SECTION_SAVE_STALE%'
  ),
  'second browser session cannot overwrite the winner with stale revision/hash'
);
select is(
  (select content from public.sections
    where id = 'a3000000-0000-4000-8000-000000000005'),
  '<p>Tab A r2.</p>',
  'stale manual save leaves the winning content unchanged'
);

select public.save_legacy_section(
  'a3000000-0000-4000-8000-000000000010', 1,
  encode(digest(convert_to('<p>Ready base r1.</p>', 'UTF8'), 'sha256'), 'hex'),
  '<p>External save r2.</p>', 'edited'
);
reset role;
select results_eq(
  $$select
      replay->>'state', replay->>'code',
      replay->>'current_section_revision',
      (replay ? 'suggested_content')::text
    from (
      select public.prepare_legacy_section_edit(
        'a1000000-0000-4000-8000-000000000001',
        'a4000000-0000-4000-8000-000000000010',
        'a2000000-0000-4000-8000-000000000010',
        'a3000000-0000-4000-8000-000000000010', 1,
        encode(digest(convert_to('<p>Ready base r1.</p>', 'UTF8'), 'sha256'), 'hex'),
        repeat('a', 64),
        '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
      ) replay
    ) source$$,
  $$values (
    'stale'::text, 'LEGACY_SECTION_EDIT_STALE'::text, '2'::text, 'false'::text
  )$$,
  'ready replay revalidates current revision/hash and exposes no stale suggestion'
);
select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select ok(
  pg_temp.raises_matching(
    $$select public.apply_legacy_section_edit(
      'a4000000-0000-4000-8000-000000000001', 1,
      encode(digest(convert_to('Clear revised wording.', 'UTF8'), 'sha256'), 'hex'),
      '<p>Unrelated caller-controlled wording.</p>'
    )$$,
    '%LEGACY_SECTION_EDIT_APPLY_CONTENT_MISMATCH%'
  ),
  'Apply rejects arbitrary caller content even when result identity is valid'
);

select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000001'
  )->>'suggested_content',
  'Short revised wording.',
  'reload recovery returns the owner latest ready suggestion'
);

reset role;
select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true
);
set local role authenticated;
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000001'
  ),
  null::jsonb,
  'another user cannot discover or read the owner suggestion'
);
select ok(
  pg_temp.raises_matching(
    $$select public.apply_legacy_section_edit(
      'a4000000-0000-4000-8000-000000000001', 1,
      encode(digest(convert_to('Clear revised wording.', 'UTF8'), 'sha256'), 'hex'),
      '<p>Clear revised wording.</p>'
    )$$,
    '%LEGACY_SECTION_EDIT_NOT_FOUND%'
  ),
  'another user cannot apply the owner suggestion'
);

reset role;
select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;

select is(
  public.apply_legacy_section_edit(
    'a4000000-0000-4000-8000-000000000001', 1,
    encode(digest(convert_to('Clear revised wording.', 'UTF8'), 'sha256'), 'hex'),
    '<p>Clear revised wording.</p>'
  )->>'section_revision',
  '2',
  'Apply atomically advances the exact accepted section revision'
);
select results_eq(
  $$select revision, approved_revision, status
    from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001'$$,
  $$values (2, null::integer, 'edited'::text)$$,
  'Apply resets exact-section approval together with content revision'
);
select results_eq(
  $$select current_revision, status, approved_revision
    from public.documents
    where id = 'a2000000-0000-4000-8000-000000000001'$$,
  $$values (2, 'edited'::text, null::integer)$$,
  'Apply advances the parent revision and resets approved truth atomically'
);
select is(
  public.apply_legacy_section_edit(
    'a4000000-0000-4000-8000-000000000001', 1,
    encode(digest(convert_to('Clear revised wording.', 'UTF8'), 'sha256'), 'hex'),
    '<p>Clear revised wording.</p>'
  )->>'idempotent_replay',
  'true',
  'a lost Apply acknowledgement replays exactly without a second revision'
);
select is(
  (select revision from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001'),
  2,
  'exact Apply replay does not advance the section twice'
);
select ok(
  pg_temp.raises_matching(
    $$select public.apply_legacy_section_edit(
      'a4000000-0000-4000-8000-000000000002', 1,
      encode(digest(convert_to('Short revised wording.', 'UTF8'), 'sha256'), 'hex'),
      '<p>Short revised wording.</p>'
    )$$,
    '%LEGACY_SECTION_EDIT_STALE%'
  ),
  'the losing concurrent suggestion cannot overwrite the applied revision'
);
select ok(
  not (
    public.get_latest_legacy_section_edit(
      'a3000000-0000-4000-8000-000000000001'
    ) ? 'suggested_content'
  ),
  'a stale ready recovery state no longer exposes suggestion wording'
);
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000001'
  )->>'state',
  'stale',
  'a ready suggestion whose accepted revision lost the race recovers as stale, not reviewable'
);

-- Manual browser changes use the authenticated revision/hash CAS. Approval
-- may only be established by the exact status transition, never forged.
select public.save_legacy_section(
  'a3000000-0000-4000-8000-000000000001', 2,
  encode(digest(convert_to('<p>Clear revised wording.</p>', 'UTF8'), 'sha256'), 'hex'),
  '<p>Clear revised wording.</p>', 'approved'
);
select results_eq(
  $$select revision, approved_revision from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001'$$,
  $$values (3, 3)$$,
  'status approval binds approval to the newly advanced exact revision'
);
update public.sections
set approved_revision = 1
where id = 'a3000000-0000-4000-8000-000000000001';
select results_eq(
  $$select revision, approved_revision from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001'$$,
  $$values (3, 3)$$,
  'an otherwise unchanged browser update cannot forge approved_revision'
);
update public.documents
set status = 'approved', approved_revision = 1
where id = 'a2000000-0000-4000-8000-000000000001';
select public.save_legacy_section(
  'a3000000-0000-4000-8000-000000000001', 3,
  encode(digest(convert_to('<p>Clear revised wording.</p>', 'UTF8'), 'sha256'), 'hex'),
  '<p>Direct browser autosave.</p>', 'edited'
);
select results_eq(
  $$select revision, approved_revision, status from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001'$$,
  $$values (4, null::integer, 'edited'::text)$$,
  'manual CAS save returns a monotonic revision and clears section approval'
);
select results_eq(
  $$select current_revision, status, approved_revision from public.documents
    where id = 'a2000000-0000-4000-8000-000000000001'$$,
  $$values (4, 'edited'::text, null::integer)$$,
  'manual CAS save advances parent revision and cannot bypass approval reset'
);
select is(
  jsonb_array_length((select version_history from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001')),
  2,
  'each content change appends exactly one prior body to section history'
);

select results_eq(
  $$select
      payload->>'state', payload->>'code',
      (payload->>'section_revision')::integer,
      payload->>'section_content'
    from (
      select public.apply_legacy_section_edit(
        'a4000000-0000-4000-8000-000000000001', 1,
        encode(digest(convert_to('Clear revised wording.', 'UTF8'), 'sha256'), 'hex'),
        '<p>Clear revised wording.</p>'
      ) payload
    ) replay$$,
  $$values (
    'applied_then_superseded'::text,
    'APPLIED_THEN_SUPERSEDED'::text,
    4,
    '<p>Direct browser autosave.</p>'::text
  )$$,
  'lost Apply acknowledgement after a later save returns current superseded truth'
);
select is(
  (select content from public.sections
    where id = 'a3000000-0000-4000-8000-000000000001'),
  '<p>Direct browser autosave.</p>',
  'superseded Apply replay never restores its old applied wording'
);

reset role;

-- Real two-session proof. Both independently authenticated browser sessions
-- read r1/hash-A. Tab A commits r2; Tab B then sends its already-captured r1
-- CAS and the database rejects it without changing Tab A's wording.
select extensions.dblink_connect(
  'legacy_section_save_tab_a',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_connect(
  'legacy_section_save_tab_b',
  'host=supabase_db_jjsykocqpjlekgsbylkd port=5432 dbname=' || current_database()
    || ' user=postgres password=postgres'
);
select extensions.dblink_exec(
  'legacy_section_save_tab_a',
  $sql$
    insert into auth.users(
      id, email, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      'a1000000-0000-4000-8000-000000000099',
      'legacy-section-cas-tabs@example.test', false, false, now(), now()
    )
  $sql$
);
select extensions.dblink_exec(
  'legacy_section_save_tab_a',
  $sql$
    insert into public.documents(
      id, user_id, title, content, status, workspace_sections, format,
      current_revision, approved_revision
    ) values (
      'a2000000-0000-4000-8000-000000000099',
      'a1000000-0000-4000-8000-000000000099',
      'Two-session legacy CAS', '', 'draft', '[]', 'Word', 1, null
    )
  $sql$
);
select extensions.dblink_exec(
  'legacy_section_save_tab_a',
  $sql$
    insert into public.sections(
      id, document_id, user_id, name, order_index, content, status,
      version_history, is_required, revision, approved_revision
    ) values (
      'a3000000-0000-4000-8000-000000000099',
      'a2000000-0000-4000-8000-000000000099',
      'a1000000-0000-4000-8000-000000000099',
      'Two-session section', 0, '<p>Session-shared r1.</p>', 'draft',
      '[]', true, 1, null
    )
  $sql$
);
select extensions.dblink_exec(
  'legacy_section_save_tab_a',
  $remote$
    do $operation$
    begin
      perform public.prepare_legacy_section_edit(
        'a1000000-0000-4000-8000-000000000099',
        'a4000000-0000-4000-8000-000000000099',
        'a2000000-0000-4000-8000-000000000099',
        'a3000000-0000-4000-8000-000000000099', 1,
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to('<p>Session-shared r1.</p>', 'UTF8'), 'sha256'
        ), 'hex'),
        repeat('f', 64),
        '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
      );
      perform public.mark_legacy_section_edit_dispatched(
        'a1000000-0000-4000-8000-000000000099',
        'a4000000-0000-4000-8000-000000000099', repeat('f', 64)
      );
      perform public.complete_legacy_section_edit(
        'a1000000-0000-4000-8000-000000000099',
        'a4000000-0000-4000-8000-000000000099', repeat('f', 64),
        'Concurrent recovery suggestion.',
        '<p>Concurrent recovery suggestion.</p>', '[]'::jsonb,
        '{"provider":"openai","response_id":"synthetic-concurrent-recovery"}'::jsonb
      );
    end;
    $operation$;
  $remote$
);
create temporary table legacy_recovery_backend(pid integer) on commit drop;
insert into legacy_recovery_backend(pid)
select pid
from extensions.dblink(
  'legacy_section_save_tab_b', 'select pg_backend_pid()'
) as remote_backend(pid integer);
select extensions.dblink_exec(
  'legacy_section_save_tab_a',
  $$set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec(
  'legacy_section_save_tab_b',
  $$set request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_exec('legacy_section_save_tab_a', 'set role authenticated');
select extensions.dblink_exec('legacy_section_save_tab_b', 'set role authenticated');
select ok(
  (
    select revision = 1 and content_sha256 = encode(
      digest(convert_to('<p>Session-shared r1.</p>', 'UTF8'), 'sha256'), 'hex'
    )
    from extensions.dblink(
      'legacy_section_save_tab_a',
      $$select revision,
          pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(content, 'UTF8'), 'sha256'),
            'hex'
          )
        from public.sections
        where id = 'a3000000-0000-4000-8000-000000000099'$$
    ) as remote_state(revision integer, content_sha256 text)
  ) and (
    select revision = 1 and content_sha256 = encode(
      digest(convert_to('<p>Session-shared r1.</p>', 'UTF8'), 'sha256'), 'hex'
    )
    from extensions.dblink(
      'legacy_section_save_tab_b',
      $$select revision,
          pg_catalog.encode(
            extensions.digest(pg_catalog.convert_to(content, 'UTF8'), 'sha256'),
            'hex'
          )
        from public.sections
        where id = 'a3000000-0000-4000-8000-000000000099'$$
    ) as remote_state(revision integer, content_sha256 text)
  ),
  'two independent authenticated sessions capture the same r1/content hash'
);
select extensions.dblink_exec('legacy_section_save_tab_a', 'begin');
select is(
  (
    select result->>'section_revision'
    from extensions.dblink(
      'legacy_section_save_tab_a',
      $$select public.save_legacy_section(
        'a3000000-0000-4000-8000-000000000099', 1,
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to('<p>Session-shared r1.</p>', 'UTF8'), 'sha256'
        ), 'hex'),
        '<p>Tab A committed r2.</p>', 'edited'
      )$$
    ) as remote_result(result jsonb)
  ),
  '2',
  'Tab A writes its expected revision/hash CAS while retaining the transaction lock'
);
select is(
  extensions.dblink_send_query(
    'legacy_section_save_tab_b',
    $$select public.get_latest_legacy_section_edit(
      'a3000000-0000-4000-8000-000000000099'
    )$$
  ),
  1,
  'recovery starts in a second authenticated session while the save lock is held'
);
select ok(
  extensions.dblink_is_busy('legacy_section_save_tab_b') = 1
    and pg_temp.wait_for_lock(
      (select pid from legacy_recovery_backend limit 1)
    ),
  'recovery locks the operation then waits for the concurrently saved section'
);
select extensions.dblink_exec('legacy_section_save_tab_a', 'commit');
select results_eq(
  $$select payload->>'state',
      (payload ? 'suggested_content')::text,
      (payload ? 'applied_candidate_content')::text
    from extensions.dblink_get_result(
      'legacy_section_save_tab_b', false
    ) as remote_result(payload jsonb)$$,
  $$values ('stale'::text, 'false'::text, 'false'::text)$$,
  'recovery reloads the locked post-save section and never exposes its stale ready payload'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result(
      'legacy_section_save_tab_b', false
    ) as drained_result(payload jsonb)
  ),
  0,
  'the asynchronous recovery result is fully drained before the next command'
);
select is(
  extensions.dblink_send_query(
    'legacy_section_save_tab_b',
    $$select public.save_legacy_section(
      'a3000000-0000-4000-8000-000000000099', 1,
      pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to('<p>Session-shared r1.</p>', 'UTF8'), 'sha256'
      ), 'hex'),
      '<p>Tab B stale overwrite.</p>', 'edited'
    )$$
  ),
  1,
  'Tab B sends its stale request through a distinct database session'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('legacy_section_save_tab_b', false)
      as remote_result(result jsonb)
  ),
  0,
  'the stale two-session loser receives no mutation result'
);
select ok(
  extensions.dblink_error_message('legacy_section_save_tab_b')
    like '%LEGACY_SECTION_SAVE_STALE%',
  'the stale two-session loser receives the stable CAS conflict code'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result(
      'legacy_section_save_tab_b', false
    ) as drained_result(result jsonb)
  ),
  0,
  'the asynchronous stale error is fully drained before connection cleanup'
);
select is(
  (select content from public.sections
    where id = 'a3000000-0000-4000-8000-000000000099'),
  '<p>Tab A committed r2.</p>',
  'the true two-session stale request leaves the winning body unchanged'
);
select extensions.dblink_exec('legacy_section_save_tab_a', 'reset role');
select extensions.dblink_exec(
  'legacy_section_save_tab_a',
  $$delete from auth.users
    where id = 'a1000000-0000-4000-8000-000000000099'$$
);
select extensions.dblink_disconnect('legacy_section_save_tab_a');
select extensions.dblink_disconnect('legacy_section_save_tab_b');

-- A fresh current-revision suggestion can be explicitly discarded and is no
-- longer recoverable after reload.
select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001', 4,
  encode(digest(convert_to('<p>Direct browser autosave.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('4', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000004', repeat('4', 64)
);
select public.complete_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000004', repeat('4', 64),
  'Discard this suggestion.', '<p>Discard this suggestion.</p>', '[]'::jsonb,
  '{"provider":"openai","response_id":"synthetic-4"}'::jsonb
);
select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select is(
  public.discard_legacy_section_edit(
    'a4000000-0000-4000-8000-000000000004',
    encode(digest(convert_to('Discard this suggestion.', 'UTF8'), 'sha256'), 'hex')
  )->>'state',
  'discarded',
  'explicit Discard persists a terminal operation state'
);
select results_eq(
  $$select state, recoverable::text,
      (payload ? 'suggested_content')::text
    from (
      select public.get_latest_legacy_section_edit(
        'a3000000-0000-4000-8000-000000000001'
      ) as payload
    ) source
    cross join lateral (
      select payload->>'state' state,
        (payload->>'recoverable')::boolean recoverable
    ) parsed$$,
  $$values ('discarded'::text, 'false'::text, 'false'::text)$$,
  'discarded operation is visible as terminal but exposes no suggestion'
);

reset role;
-- Selection edits persist the exact deterministic full-section patch. Apply
-- rejects unrelated caller content and accepts only that stored candidate.
select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000006',
  'a2000000-0000-4000-8000-000000000005',
  'a3000000-0000-4000-8000-000000000005', 2,
  encode(digest(convert_to('<p>Tab A r2.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('6', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"selection","selection_sha256":"synthetic"}'::jsonb
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000006', repeat('6', 64)
);
select public.complete_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000006', repeat('6', 64),
  'Tab A polished', '<p>Tab A polished r2.</p>', '[]'::jsonb,
  '{"provider":"openai","response_id":"synthetic-6"}'::jsonb
);
update public.documents
set status = 'exported', approved_revision = current_revision
where id = 'a2000000-0000-4000-8000-000000000005';
select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select ok(
  pg_temp.raises_matching(
    $$select public.apply_legacy_section_edit(
      'a4000000-0000-4000-8000-000000000006', 2,
      encode(digest(convert_to('Tab A polished', 'UTF8'), 'sha256'), 'hex'),
      '<p>Different full result.</p>'
    )$$,
    '%LEGACY_SECTION_EDIT_APPLY_CONTENT_MISMATCH%'
  ),
  'selection Apply rejects a caller body unrelated to the persisted patch'
);
select is(
  public.apply_legacy_section_edit(
    'a4000000-0000-4000-8000-000000000006', 2,
    encode(digest(convert_to('Tab A polished', 'UTF8'), 'sha256'), 'hex'),
    '<p>Tab A polished r2.</p>'
  )->>'section_revision',
  '3',
  'selection Apply accepts the exact persisted deterministic full result'
);
select results_eq(
  $$select current_revision, status, approved_revision
    from public.documents
    where id = 'a2000000-0000-4000-8000-000000000005'$$,
  $$values (3, 'edited'::text, null::integer)$$,
  'Apply invalidates an exported parent and advances its authoritative revision'
);

reset role;
-- Pre-dispatch cancellation, exact terminal failure, and ambiguous provider
-- outcome are immutable and replayable. A new attempt always uses a new UUID.
select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000007',
  'a2000000-0000-4000-8000-000000000005',
  'a3000000-0000-4000-8000-000000000005', 3,
  encode(digest(convert_to('<p>Tab A polished r2.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('7', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select is(
  public.settle_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000007', repeat('7', 64),
    'cancelled', 'LEGACY_SECTION_EDIT_CANCELLED_BEFORE_DISPATCH'
  )->>'state',
  'cancelled',
  'pre-dispatch cancellation is durably terminal'
);
select is(
  public.settle_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000007', repeat('7', 64),
    'cancelled', 'LEGACY_SECTION_EDIT_CANCELLED_BEFORE_DISPATCH'
  )->>'idempotent_replay',
  'true',
  'lost cancellation acknowledgement replays exactly'
);
select is(
  public.prepare_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000008',
    'a2000000-0000-4000-8000-000000000005',
    'a3000000-0000-4000-8000-000000000005', 3,
    encode(digest(convert_to('<p>Tab A polished r2.</p>', 'UTF8'), 'sha256'), 'hex'),
    repeat('8', 64),
    '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
  )->>'state',
  'accepted',
  'an explicit new attempt is admitted only under a new operation UUID'
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000008', repeat('8', 64)
);
select is(
  public.settle_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000008', repeat('8', 64),
    'terminal_failure', 'OPENAI_KEY_UNAVAILABLE'
  )->>'terminal_code',
  'OPENAI_KEY_UNAVAILABLE',
  'exact provider failure persists one stable safe terminal code'
);
select is(
  public.settle_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000008', repeat('8', 64),
    'terminal_failure', 'OPENAI_KEY_UNAVAILABLE'
  )->>'idempotent_replay',
  'true',
  'lost terminal-failure acknowledgement replays exactly'
);
select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000009',
  'a2000000-0000-4000-8000-000000000005',
  'a3000000-0000-4000-8000-000000000005', 3,
  encode(digest(convert_to('<p>Tab A polished r2.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('9', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000009', repeat('9', 64)
);
select is(
  public.settle_legacy_section_edit(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000009', repeat('9', 64),
    'reconciliation_required', 'OPENAI_PROVIDER_RECONCILIATION_REQUIRED'
  )->>'state',
  'reconciliation_required',
  'post-dispatch ambiguous outcome requires reconciliation and never redispatches'
);

-- Reload recovery is also the worker-death liveness authority. Explicitly aged
-- synthetic rows avoid wall-clock waiting and prove that authenticated polling
-- terminalises only the owner's expired operation without exposing a proposal.
insert into private.legacy_section_edit_operations(
  id, user_id, document_id, section_id, accepted_section_revision,
  accepted_content_sha256, request_sha256, request_metadata, status,
  created_at, updated_at
) values (
  'a4000000-0000-4000-8000-000000000011',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000011',
  'a3000000-0000-4000-8000-000000000011', 1,
  encode(digest(convert_to('<p>Accepted expiry.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('b', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb,
  'accepted',
  clock_timestamp() - interval '6 minutes',
  clock_timestamp() - interval '6 minutes'
);
insert into private.legacy_section_edit_operations(
  id, user_id, document_id, section_id, accepted_section_revision,
  accepted_content_sha256, request_sha256, request_metadata, status,
  created_at, dispatched_at, updated_at
) values (
  'a4000000-0000-4000-8000-000000000012',
  'a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000012',
  'a3000000-0000-4000-8000-000000000012', 1,
  encode(digest(convert_to('<p>Dispatched expiry.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('c', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb,
  'provider_dispatched',
  clock_timestamp() - interval '6 minutes',
  clock_timestamp() - interval '6 minutes',
  clock_timestamp() - interval '6 minutes'
);

select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true
);
set local role authenticated;
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000011'
  ),
  null::jsonb,
  'another owner cannot discover or terminalise an expired accepted operation'
);
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000012'
  ),
  null::jsonb,
  'another owner cannot discover or terminalise an expired dispatched operation'
);
reset role;
select results_eq(
  $$select id, status from private.legacy_section_edit_operations
    where id in (
      'a4000000-0000-4000-8000-000000000011',
      'a4000000-0000-4000-8000-000000000012'
    ) order by id$$,
  $$values
    ('a4000000-0000-4000-8000-000000000011'::uuid, 'accepted'::text),
    ('a4000000-0000-4000-8000-000000000012'::uuid, 'provider_dispatched'::text)$$,
  'cross-owner recovery leaves both owner operations active and unchanged'
);

select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select results_eq(
  $$select payload->>'state', payload->>'terminal_code',
      (payload ? 'suggested_content')::text,
      (payload ? 'applied_candidate_content')::text
    from (
      select public.get_latest_legacy_section_edit(
        'a3000000-0000-4000-8000-000000000011'
      ) payload
    ) source$$,
  $$values (
    'terminal_failure'::text,
    'LEGACY_SECTION_EDIT_ACCEPTANCE_EXPIRED'::text,
    'false'::text, 'false'::text
  )$$,
  'expired accepted recovery becomes a safe terminal failure without proposal content'
);
select results_eq(
  $$select payload->>'state', payload->>'terminal_code',
      (payload ? 'suggested_content')::text,
      (payload ? 'applied_candidate_content')::text
    from (
      select public.get_latest_legacy_section_edit(
        'a3000000-0000-4000-8000-000000000012'
      ) payload
    ) source$$,
  $$values (
    'reconciliation_required'::text,
    'LEGACY_SECTION_EDIT_DISPATCH_OUTCOME_AMBIGUOUS'::text,
    'false'::text, 'false'::text
  )$$,
  'expired dispatched recovery becomes ambiguous terminal truth without proposal content'
);
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000011'
  )->>'terminal_code',
  'LEGACY_SECTION_EDIT_ACCEPTANCE_EXPIRED',
  'expired accepted recovery repeats the same terminal result idempotently'
);
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000012'
  )->>'terminal_code',
  'LEGACY_SECTION_EDIT_DISPATCH_OUTCOME_AMBIGUOUS',
  'expired dispatched recovery repeats the same terminal result idempotently'
);
reset role;
select ok(
  pg_temp.raises_matching(
    $$select public.mark_legacy_section_edit_dispatched(
      'a1000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000011', repeat('b', 64)
    )$$,
    '%LEGACY_SECTION_EDIT_STATE_INVALID:terminal_failure%'
  ),
  'a late worker cannot dispatch an accepted operation after recovery terminalises it'
);
select ok(
  pg_temp.raises_matching(
    $$select public.complete_legacy_section_edit(
      'a1000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000012', repeat('c', 64),
      'Late result.', '<p>Late result.</p>', '[]'::jsonb,
      '{"provider":"openai","response_id":"late-after-expiry"}'::jsonb
    )$$,
    '%LEGACY_SECTION_EDIT_STATE_INVALID:reconciliation_required%'
  ),
  'a late worker cannot complete or reopen a reconciled dispatched operation'
);

select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000013',
  'a2000000-0000-4000-8000-000000000013',
  'a3000000-0000-4000-8000-000000000013', 1,
  encode(digest(convert_to('<p>Active accepted.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('d', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000014',
  'a2000000-0000-4000-8000-000000000014',
  'a3000000-0000-4000-8000-000000000014', 1,
  encode(digest(convert_to('<p>Active dispatched.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('e', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select public.mark_legacy_section_edit_dispatched(
  'a1000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000014', repeat('e', 64)
);
select set_config(
  'request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000013'
  )->>'state',
  'accepted',
  'a non-expired accepted operation remains active for its only admitted attempt'
);
select is(
  public.get_latest_legacy_section_edit(
    'a3000000-0000-4000-8000-000000000014'
  )->>'state',
  'provider_dispatched',
  'a non-expired dispatched operation remains active and blocks a fresh attempt'
);
reset role;
select is(
  public.mark_legacy_section_edit_dispatched(
    'a1000000-0000-4000-8000-000000000001',
    'a4000000-0000-4000-8000-000000000014', repeat('e', 64)
  )->>'idempotent_replay',
  'true',
  'active recovery cannot acquire or cause a second provider dispatch'
);

-- Nested FK cascade deletion remains possible for account deletion even though
-- direct operation deletion is forbidden.
select public.prepare_legacy_section_edit(
  'a1000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000003',
  'a3000000-0000-4000-8000-000000000003', 1,
  encode(digest(convert_to('<p>Cascade wording.</p>', 'UTF8'), 'sha256'), 'hex'),
  repeat('3', 64),
  '{"contract_version":"legacy-section-edit.1","action":"improve","scope":"section"}'::jsonb
);
select lives_ok(
  $$delete from auth.users
    where id = 'a1000000-0000-4000-8000-000000000003'$$,
  'account deletion can cascade through the private operation at nested trigger depth'
);
select is(
  (select count(*)::integer from private.legacy_section_edit_operations
    where id = 'a4000000-0000-4000-8000-000000000003'),
  0,
  'cascade removes the nested private operation'
);

select * from finish();
rollback;
