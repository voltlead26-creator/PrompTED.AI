-- Explicitly document that job-market reference rows are service-role only.
-- The service role bypasses RLS; public API roles are denied at both the grant
-- and policy layers.
create policy job_market_roles_service_only
  on public.job_market_roles
  for all
  to anon, authenticated
  using (false)
  with check (false);
;
