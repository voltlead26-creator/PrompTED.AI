begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select ok(has_table_privilege('service_role','public.outcomes',privilege_name) = (privilege_name='SELECT'),
  'artifact owner lookup has exact service privilege: ' || privilege_name)
from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege_name);

insert into auth.users(id,email,is_sso_user,is_anonymous,created_at,updated_at)
values ('94124000-0000-4000-8000-000000000001','artifact-outcome-grants@example.invalid',false,false,now(),now());
insert into public.outcomes(id,user_id,situation_text)
values ('94124000-0000-4000-8000-000000000002','94124000-0000-4000-8000-000000000001','Preserved artifact source');

set local role service_role;
select is((select id::text from public.outcomes
  where id='94124000-0000-4000-8000-000000000002' and user_id='94124000-0000-4000-8000-000000000001'),
  '94124000-0000-4000-8000-000000000002','actual service-role owner lookup can read the matching outcome');
select is((select count(*) from public.outcomes
  where id='94124000-0000-4000-8000-000000000002' and user_id='94124000-0000-4000-8000-000000000003'),
  0::bigint,'the same exact owner-filtered lookup does not match a foreign owner');
select throws_ok($$insert into public.outcomes(user_id,situation_text)
  values ('94124000-0000-4000-8000-000000000001','Forged source')$$,
  '42501','permission denied for table outcomes','service lookup does not grant direct outcome creation');
select throws_ok($$update public.outcomes set situation_text='Overwritten'
  where id='94124000-0000-4000-8000-000000000002'$$,
  '42501','permission denied for table outcomes','service lookup does not grant direct outcome rewriting');
select throws_ok($$delete from public.outcomes where id='94124000-0000-4000-8000-000000000002'$$,
  '42501','permission denied for table outcomes','service lookup does not grant direct outcome deletion');
reset role;
select is((select situation_text from public.outcomes where id='94124000-0000-4000-8000-000000000002'),
  'Preserved artifact source','rejected writes preserve the existing source');
select * from finish();
rollback;
