begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temp table expected_owner_commands(signature text);
insert into expected_owner_commands values
  ('public.apply_legacy_section_edit(uuid,integer,text,text)'),
  ('public.approve_captured_document_revision(uuid,integer,uuid,integer)'),
  ('public.create_and_link_own_business(text,text,text,text,text,text)'),
  ('public.discard_legacy_section_edit(uuid,text)'),
  ('public.edit_captured_document_section(uuid,integer,uuid,integer,text,integer,text,text)'),
  ('public.get_captured_document_operation(uuid)'),
  ('public.get_latest_captured_document_operation(uuid)'),
  ('public.link_own_business(uuid)'),
  ('public.promote_profile_resume(uuid,text)'),
  ('public.request_captured_document_cancellation(uuid,integer,text)'),
  ('public.request_captured_document_export(uuid,integer,uuid,integer,text,text)'),
  ('public.restore_previous_profile_resume()'),
  ('public.save_legacy_section(uuid,integer,text,text,text)'),
  ('public.update_own_profile_details(text,text,text,text,date,text,text,text,text,text,text)');
select ok(has_function_privilege('authenticated',signature,'EXECUTE'),
  signature || ': authenticated owner entry point remains available')
from expected_owner_commands order by signature;
select ok(not has_function_privilege('anon',signature,'EXECUTE'),
  signature || ': anonymous invocation is denied at the privilege boundary')
from expected_owner_commands order by signature;
select ok(not has_function_privilege('service_role',signature,'EXECUTE'),
  signature || ': service role cannot use the owner-client command')
from expected_owner_commands order by signature;
select ok(not has_function_privilege(role_name,'public.handle_new_user()','EXECUTE'),
  role_name || ': Auth trigger is not exposed as a direct client function')
from (values ('anon'),('authenticated'),('service_role')) roles(role_name);

-- Execute the real trigger after revocation. This preserves normal sign-up
-- without assuming that a trigger EXECUTE grant is needed by its invoker.
insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at)
values ('94123000-0000-4000-8000-000000000001','owner-rpc-grants@example.invalid',false,false,now(),now());
select ok(exists(select 1 from public.profiles where id='94123000-0000-4000-8000-000000000001'),
  'Auth sign-up still creates its owned profile through the existing trigger');
select ok(has_function_privilege('service_role','public.get_effective_product_access_v1(uuid)','EXECUTE'),
  'the separate server-owned entitlement command retains its intended service access');
select * from finish();
rollback;
