create schema if not exists private;

create table if not exists private.api_rate_limits (
  user_id uuid not null,
  operation text not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (user_id, operation, window_start)
);

revoke all on table private.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_user_id uuid,
  p_operation text,
  p_limit integer default 60,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_user_id is null
    or nullif(btrim(p_operation), '') is null
    or p_limit < 1
    or p_window_seconds < 1
    or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit parameters' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into private.api_rate_limits as bucket (
    user_id,
    operation,
    window_start,
    request_count
  ) values (
    p_user_id,
    left(btrim(p_operation), 120),
    v_window_start,
    1
  )
  on conflict (user_id, operation, window_start)
  do update set request_count = bucket.request_count + 1
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(uuid, text, integer, integer)
  to service_role;

comment on function public.consume_rate_limit(uuid, text, integer, integer) is
  'Atomically consumes a per-user API allowance. Callable only by service-role Edge Functions.';
