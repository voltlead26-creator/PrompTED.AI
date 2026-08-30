-- Harden persistence-related RLS and indexes.
-- Apply after review in Supabase, because this changes public table access and privileges.

-- Public catalogue tables are read by the app but should still have RLS enabled.
alter table public.templates enable row level security;
alter table public.bundles enable row level security;

-- Audit logs should not be publicly readable or writable through the Data API.
alter table public.audit_logs enable row level security;

-- Public read access for non-sensitive catalogue data.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'templates' and policyname = 'templates_select_published'
  ) then
    create policy templates_select_published
      on public.templates
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bundles' and policyname = 'bundles_select_published'
  ) then
    create policy bundles_select_published
      on public.bundles
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_market_roles' and policyname = 'job_market_roles_select_public'
  ) then
    create policy job_market_roles_select_public
      on public.job_market_roles
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;

-- Keep audit logs server-side only. Service-role Edge Functions bypass RLS.
revoke all on public.audit_logs from anon, authenticated;

-- Auth trigger function should not be directly executable via RPC.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- Missing FK indexes reported by Supabase advisors and relevant to persistence.
create index if not exists idx_documents_template_id on public.documents(template_id);
create index if not exists idx_sections_user_id on public.sections(user_id);
create index if not exists idx_uploads_user_id on public.uploads(user_id);
create index if not exists idx_uploads_outcome_id on public.uploads(outcome_id);
create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id);
create index if not exists idx_export_history_document_id on public.export_history(document_id);
