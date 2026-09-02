-- Role-aware, metadata-only release attestation.
--
-- PostgREST's OpenAPI document is caller-role scoped, so a service-role
-- document cannot prove that browser-only objects are exposed to
-- `authenticated`.  This bounded RPC reports only object identity and fixed
-- role privilege facts; it never reads application rows or accepts a role
-- name from the caller.

create or replace function public.attest_prompted_release_schema(
  p_tables text[] default '{}'::text[],
  p_rpcs text[] default '{}'::text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tables jsonb;
  v_rpcs jsonb;
begin
  if p_tables is null or p_rpcs is null
    or cardinality(p_tables) > 256
    or cardinality(p_rpcs) > 256
    or array_position(p_tables, null) is not null
    or array_position(p_rpcs, null) is not null
    or exists (
      select 1
      from unnest(p_tables || p_rpcs) requested_name
      where requested_name !~ '^[a-z][a-z0-9_]{0,62}$'
    )
    or cardinality(p_tables) <> (
      select count(distinct requested_name)
      from unnest(p_tables) requested_name
    )
    or cardinality(p_rpcs) <> (
      select count(distinct requested_name)
      from unnest(p_rpcs) requested_name
    ) then
    raise exception 'RELEASE_SCHEMA_ATTESTATION_REQUEST_INVALID';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', requested.name,
        'exists', object_record.oid is not null,
        'relation_kind', object_record.relkind,
        'rls_enabled', coalesce(object_record.relrowsecurity, false),
        'rls_forced', coalesce(object_record.relforcerowsecurity, false),
        'authenticated', jsonb_build_object(
          'select', coalesce(pg_catalog.has_table_privilege(
            'authenticated', object_record.oid, 'SELECT'
          ), false),
          'insert', coalesce(pg_catalog.has_table_privilege(
            'authenticated', object_record.oid, 'INSERT'
          ), false),
          'update', coalesce(pg_catalog.has_table_privilege(
            'authenticated', object_record.oid, 'UPDATE'
          ), false),
          'delete', coalesce(pg_catalog.has_table_privilege(
            'authenticated', object_record.oid, 'DELETE'
          ), false)
        ),
        'service_role', jsonb_build_object(
          'select', coalesce(pg_catalog.has_table_privilege(
            'service_role', object_record.oid, 'SELECT'
          ), false),
          'insert', coalesce(pg_catalog.has_table_privilege(
            'service_role', object_record.oid, 'INSERT'
          ), false),
          'update', coalesce(pg_catalog.has_table_privilege(
            'service_role', object_record.oid, 'UPDATE'
          ), false),
          'delete', coalesce(pg_catalog.has_table_privilege(
            'service_role', object_record.oid, 'DELETE'
          ), false)
        )
      ) order by requested.ordinality
    ),
    '[]'::jsonb
  ) into v_tables
  from unnest(p_tables) with ordinality requested(name, ordinality)
  left join lateral (
    select
      class_record.oid,
      class_record.relkind,
      class_record.relrowsecurity,
      class_record.relforcerowsecurity
    from pg_catalog.pg_class class_record
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = class_record.relnamespace
    where schema_record.nspname = 'public'
      and class_record.relname = requested.name
      and class_record.relkind in ('r', 'p', 'v', 'm', 'f')
    limit 1
  ) object_record on true;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', requested.name,
        'exists', coalesce(procedure_record.overload_count, 0) > 0,
        'overload_count', coalesce(procedure_record.overload_count, 0),
        'anon_execute', coalesce(
          procedure_record.anon_execute, false
        ),
        'authenticated_execute', coalesce(
          procedure_record.authenticated_execute, false
        ),
        'service_role_execute', coalesce(
          procedure_record.service_role_execute, false
        ),
        'security_definer', coalesce(
          procedure_record.security_definer, false
        ),
        'safe_security_definer_search_path', coalesce(
          procedure_record.safe_security_definer_search_path, false
        )
      ) order by requested.ordinality
    ),
    '[]'::jsonb
  ) into v_rpcs
  from unnest(p_rpcs) with ordinality requested(name, ordinality)
  left join lateral (
    select
      count(*)::integer as overload_count,
      bool_and(pg_catalog.has_function_privilege(
        'anon', procedure_candidate.oid, 'EXECUTE'
      )) as anon_execute,
      bool_and(pg_catalog.has_function_privilege(
        'authenticated', procedure_candidate.oid, 'EXECUTE'
      )) as authenticated_execute,
      bool_and(pg_catalog.has_function_privilege(
        'service_role', procedure_candidate.oid, 'EXECUTE'
      )) as service_role_execute,
      bool_and(procedure_candidate.prosecdef) as security_definer,
      bool_and(
        not procedure_candidate.prosecdef
        or coalesce(
          procedure_candidate.proconfig @> array['search_path=""']::text[],
          false
        )
      ) as safe_security_definer_search_path
    from pg_catalog.pg_proc procedure_candidate
    join pg_catalog.pg_namespace schema_record
      on schema_record.oid = procedure_candidate.pronamespace
    where schema_record.nspname = 'public'
      and procedure_candidate.proname = requested.name
  ) procedure_record on true;

  return jsonb_build_object(
    'schema_version', 2,
    'tables', v_tables,
    'rpcs', v_rpcs
  );
end;
$function$;

revoke all on function public.attest_prompted_release_schema(text[], text[])
  from public, anon, authenticated;
grant execute on function public.attest_prompted_release_schema(text[], text[])
  to service_role;

comment on function public.attest_prompted_release_schema(text[], text[]) is
  'Service-only, bounded metadata attestation for release-time role privilege checks.';
