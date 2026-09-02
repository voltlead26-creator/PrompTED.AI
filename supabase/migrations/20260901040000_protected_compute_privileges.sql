-- Exact direct-table privileges for protected Edge compute.
--
-- `service_role` bypasses RLS but does not implicitly receive table ACLs.
-- Every grant below corresponds to a reviewed direct Supabase Data API call
-- in an active Edge Function dependency closure.  Revoke first so this
-- migration converges legacy or drifted ACLs to the intended release state.

begin;

revoke all on table
  public.audit_logs,
  public.businesses,
  public.company_profile,
  public.documents,
  public.export_history,
  public.generation_logs,
  public.job_market_roles,
  public.memberships,
  public.profiles,
  public.sections,
  public.subscriptions,
  public.ted_artifact_blocks,
  public.ted_artifacts,
  public.uploads,
  public.usage_ledger
from service_role;

grant select on table
  public.businesses,
  public.company_profile,
  public.documents,
  public.job_market_roles,
  public.memberships,
  public.profiles,
  public.sections,
  public.subscriptions,
  public.ted_artifact_blocks,
  public.ted_artifacts,
  public.uploads,
  public.usage_ledger
to service_role;

grant insert on table
  public.audit_logs,
  public.company_profile,
  public.export_history,
  public.generation_logs,
  public.uploads,
  public.usage_ledger
to service_role;

grant update on table
  public.company_profile,
  public.profiles
to service_role;

commit;
