begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

with expected(table_name, can_select, can_insert, can_update, can_delete) as (
  values
    ('audit_logs', false, true, false, false),
    ('businesses', true, false, false, false),
    ('company_profile', true, true, true, false),
    ('documents', true, false, false, false),
    ('export_history', false, true, false, false),
    ('generation_logs', false, true, false, false),
    ('job_market_roles', true, false, false, false),
    ('memberships', true, false, false, false),
    ('profiles', true, false, true, false),
    ('sections', true, false, false, false),
    ('subscriptions', true, false, false, false),
    ('ted_artifact_blocks', true, false, false, false),
    ('ted_artifacts', true, false, false, false),
    ('uploads', true, false, false, false),
    ('usage_ledger', true, true, false, false)
)
select ok(
  has_table_privilege(
    'service_role', format('public.%I', table_name), 'SELECT'
  ) = can_select
    and has_table_privilege(
      'service_role', format('public.%I', table_name), 'INSERT'
    ) = can_insert
    and has_table_privilege(
      'service_role', format('public.%I', table_name), 'UPDATE'
    ) = can_update
    and has_table_privilege(
      'service_role', format('public.%I', table_name), 'DELETE'
    ) = can_delete,
  format('service_role has the exact reviewed privileges on public.%I', table_name)
)
from expected
order by table_name;

select ok(
  not exists (
    select 1
    from unnest(array[
      'audit_logs',
      'businesses',
      'company_profile',
      'documents',
      'export_history',
      'generation_logs',
      'job_market_roles',
      'memberships',
      'profiles',
      'sections',
      'subscriptions',
      'ted_artifact_blocks',
      'ted_artifacts',
      'uploads',
      'usage_ledger'
    ]) protected_table(table_name)
    where has_table_privilege(
      'service_role',
      format('public.%I', protected_table.table_name),
      'TRUNCATE'
    ) or has_table_privilege(
      'service_role',
      format('public.%I', protected_table.table_name),
      'REFERENCES'
    ) or has_table_privilege(
      'service_role',
      format('public.%I', protected_table.table_name),
      'TRIGGER'
    )
  ),
  'service_role has no unreviewed structural privileges on protected tables'
);

select * from finish();
rollback;
