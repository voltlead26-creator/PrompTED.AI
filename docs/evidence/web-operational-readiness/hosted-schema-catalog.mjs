// Read-only release audit input, shared by live metadata inspection and the
// disposable predecessor rehearsal. No application rows or Storage object
// names/bytes are read. Compare platform-owned Storage definitions separately.
// Reproduce observed application grant/policy differences only inside the
// disposable predecessor. Storage platform DDL is not an application migration.
export const observedSchemaGrantFixture = `
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
grant select on public.brand_kits to service_role;
grant select,insert,update,delete on public.bundles,public.checklist_items,
  public.clari_preferences,public.outcomes,public.profile_data_consents,
  public.profile_resume_versions,public.revision_history,public.role_action_items,
  public.role_documents,public.role_outcomes,public.saved_roles,
  public.ted_artifact_references,public.ted_artifact_versions,public.templates to service_role;
create policy audit_logs_insert_own on public.audit_logs for insert to authenticated
  with check ((select auth.uid())=user_id);
create policy audit_logs_select_own on public.audit_logs for select to authenticated
  using ((select auth.uid())=user_id);
`;

export const hostedSchemaCatalogSql = `
with relations as (
  select c.*, n.nspname as schema_name
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where (n.nspname in ('public','private') or
    (n.nspname='storage' and c.relname in ('objects','buckets')))
    and c.relkind in ('r','p','v','m','S')
), tables as (
  select schema_name, relname as name, relkind as kind,
    pg_catalog.pg_get_userbyid(relowner) as owner, relrowsecurity as rls,
    relforcerowsecurity as force_rls, relacl::text as acl, reloptions as options,
    case when relkind in ('v','m') then pg_catalog.pg_get_viewdef(oid,true) end as view_definition
  from relations
), columns as (
  select r.schema_name,r.relname as table_name,a.attname as name,a.attnum as position,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,
    a.attidentity as identity,a.attgenerated as generated,a.attacl::text as acl,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
  from relations r join pg_catalog.pg_attribute a on a.attrelid=r.oid
  left join pg_catalog.pg_attrdef d on d.adrelid=r.oid and d.adnum=a.attnum
  where a.attnum>0 and not a.attisdropped and r.relkind<>'S'
), constraints as (
  select r.schema_name,r.relname as table_name,c.conname as name,c.contype as type,
    c.convalidated as validated,pg_catalog.pg_get_constraintdef(c.oid,true) as definition
  from relations r join pg_catalog.pg_constraint c on c.conrelid=r.oid
), indexes as (
  select r.schema_name,r.relname as table_name,c.relname as name,
    i.indisvalid as valid,i.indisready as ready,pg_catalog.pg_get_indexdef(i.indexrelid) as definition
  from relations r join pg_catalog.pg_index i on i.indrelid=r.oid
  join pg_catalog.pg_class c on c.oid=i.indexrelid
), triggers as (
  select r.schema_name,r.relname as table_name,t.tgname as name,t.tgenabled as enabled,
    pg_catalog.pg_get_triggerdef(t.oid,true) as definition
  from relations r join pg_catalog.pg_trigger t on t.tgrelid=r.oid where not t.tgisinternal
), policies as (
  select schemaname as schema_name,tablename as table_name,policyname as name,
    permissive,roles,cmd,qual,with_check
  from pg_catalog.pg_policies where schemaname in ('public','private','storage')
), defaults as (
  select pg_catalog.pg_get_userbyid(d.defaclrole) as owner,
    coalesce(n.nspname,'*') as schema_name,d.defaclobjtype as type,d.defaclacl::text as acl
  from pg_catalog.pg_default_acl d left join pg_catalog.pg_namespace n on n.oid=d.defaclnamespace
  where n.nspname in ('public','private','storage') or d.defaclnamespace=0
), schemas as (
  select nspname as name,pg_catalog.pg_get_userbyid(nspowner) as owner,nspacl::text as acl
  from pg_catalog.pg_namespace where nspname in ('public','private','storage')
), buckets as (
  select id,name,public,file_size_limit,allowed_mime_types from storage.buckets
)
select jsonb_build_object(
  'relations',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,name),'[]'::jsonb) from tables t),
  'columns',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,position),'[]'::jsonb) from columns t),
  'constraints',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,name),'[]'::jsonb) from constraints t),
  'indexes',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,name),'[]'::jsonb) from indexes t),
  'triggers',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,name),'[]'::jsonb) from triggers t),
  'policies',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,table_name,name),'[]'::jsonb) from policies t),
  'defaults',(select coalesce(jsonb_agg(to_jsonb(t) order by schema_name,owner,type),'[]'::jsonb) from defaults t),
  'schemas',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]'::jsonb) from schemas t),
  'buckets',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from buckets t)
) as catalog;
`;
