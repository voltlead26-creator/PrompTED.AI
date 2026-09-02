begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

select has_function(
  'public',
  'attest_prompted_release_schema',
  array['text[]', 'text[]'],
  'release schema attestation RPC exists'
);
select function_returns(
  'public',
  'attest_prompted_release_schema',
  array['text[]', 'text[]'],
  'jsonb',
  'release schema attestation RPC returns jsonb'
);
select is(
  (
    select coalesce(array_to_string(proconfig, ','), '')
    from pg_proc
    where oid = 'public.attest_prompted_release_schema(text[],text[])'::regprocedure
  ),
  'search_path=""',
  'release schema attestation fixes an empty search path'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.attest_prompted_release_schema(text[],text[])',
    'EXECUTE'
  ),
  'service role can execute release schema attestation'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.attest_prompted_release_schema(text[],text[])',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.attest_prompted_release_schema(text[],text[])',
    'EXECUTE'
  ),
  'browser roles cannot execute release schema attestation'
);

set local role service_role;

select is(
  public.attest_prompted_release_schema(
    array['documents'],
    array['edit_captured_document_section']
  )->>'schema_version',
  '2',
  'attestation response is explicitly versioned'
);
select is(
  public.attest_prompted_release_schema(
    array['documents'],
    '{}'::text[]
  )#>>'{tables,0,authenticated,select}',
  'true',
  'attestation reports authenticated table privileges'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[],
    array['edit_captured_document_section']
  )#>>'{rpcs,0,authenticated_execute}',
  'true',
  'attestation reports authenticated RPC execution'
);
select is(
  public.attest_prompted_release_schema(
    array['documents'],
    '{}'::text[]
  )#>>'{tables,0,relation_kind}',
  'r',
  'attestation identifies browser objects as base tables'
);
select is(
  public.attest_prompted_release_schema(
    array['documents'],
    '{}'::text[]
  )#>>'{tables,0,rls_enabled}',
  'true',
  'attestation reports live row-level-security state'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[],
    array['reserve_document_allowance']
  )#>>'{rpcs,0,anon_execute}',
  'false',
  'attestation reports anonymous RPC execution separately'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[],
    array['reserve_document_allowance']
  )#>>'{rpcs,0,authenticated_execute}',
  'false',
  'attestation reports browser exclusion from service-only RPCs'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[],
    array['reserve_document_allowance']
  )#>>'{rpcs,0,security_definer}',
  'true',
  'attestation reports security-definer identity'
);
select is(
  public.attest_prompted_release_schema(
    '{}'::text[],
    array['reserve_document_allowance']
  )#>>'{rpcs,0,safe_security_definer_search_path}',
  'true',
  'attestation reports the fixed empty security-definer search path'
);
select is(
  public.attest_prompted_release_schema(
    array['release_object_does_not_exist'],
    array['release_rpc_does_not_exist']
  )#>>'{tables,0,exists}',
  'false',
  'missing tables are reported without row access'
);
select is(
  public.attest_prompted_release_schema(
    array['release_object_does_not_exist'],
    array['release_rpc_does_not_exist']
  )#>>'{rpcs,0,exists}',
  'false',
  'missing RPCs are reported without dynamic execution'
);
select throws_ok(
  $$select public.attest_prompted_release_schema(array['Bad-Name'], '{}'::text[])$$,
  'RELEASE_SCHEMA_ATTESTATION_REQUEST_INVALID',
  'malformed identifiers fail closed'
);
select throws_ok(
  $$select public.attest_prompted_release_schema(array['documents', 'documents'], '{}'::text[])$$,
  'RELEASE_SCHEMA_ATTESTATION_REQUEST_INVALID',
  'duplicate identifiers fail closed'
);

reset role;
select * from finish();
rollback;
