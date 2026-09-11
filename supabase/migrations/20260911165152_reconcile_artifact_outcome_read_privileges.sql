-- generate-artifact authorizes the supplied outcome using auth.admin and an
-- exact (id, user_id) read. Its deployment contract already requires SELECT.
-- Fresh databases omitted that grant; production inherited unnecessary writes.
-- Converge both without changing rows, RLS, browser grants or RPC contracts.
begin;
revoke all on table public.outcomes from service_role;
grant select on table public.outcomes to service_role;
commit;
