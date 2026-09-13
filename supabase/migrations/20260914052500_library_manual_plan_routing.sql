-- Keep the initial library response bounded while preserving the authoritative
-- marker and every key required by the strict manual-plan routing parser.
-- An unnamed table argument makes this a PostgREST computed field, not an RPC.
create function public.library_manual_plan_routing_v1(public.outcomes)
returns jsonb
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(($1).recommendation_payload) = 'object'
      and ($1).recommendation_payload ? 'manual_plan'
    then case
      when pg_catalog.octet_length(($1).recommendation_payload::text) <= 1024
        then ($1).recommendation_payload
      -- A present invalid marker must never become ordinary generated work.
      else '{"manual_plan":null}'::jsonb
    end
    else null::jsonb
  end;
$function$;

revoke all on function public.library_manual_plan_routing_v1(public.outcomes)
  from public, anon, service_role;
grant execute on function public.library_manual_plan_routing_v1(public.outcomes)
  to authenticated;
comment on function public.library_manual_plan_routing_v1(public.outcomes) is
  'Read-only, at-most-1024-byte library routing projection. Existing outcomes RLS controls row visibility; malformed markers remain invalid and stored payloads are unchanged.';

notify pgrst, 'reload schema';
