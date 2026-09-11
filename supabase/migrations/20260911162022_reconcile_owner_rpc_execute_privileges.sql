-- Reconcile explicit grants observed on the production predecessor, 12 September 2026.
-- These RPCs derive ownership from the caller JWT. Their established callers
-- use authenticated owner clients; service operations have separate commands.
-- Revoke explicit grants as well as PUBLIC inheritance. Preserve bodies,
-- signatures, owner access, triggers, rows and historical receipts.
begin;

revoke execute on function public.apply_legacy_section_edit(uuid,integer,text,text) from public, anon, service_role;
grant execute on function public.apply_legacy_section_edit(uuid,integer,text,text) to authenticated;
revoke execute on function public.approve_captured_document_revision(uuid,integer,uuid,integer) from public, anon, service_role;
grant execute on function public.approve_captured_document_revision(uuid,integer,uuid,integer) to authenticated;
revoke execute on function public.create_and_link_own_business(text,text,text,text,text,text) from public, anon, service_role;
grant execute on function public.create_and_link_own_business(text,text,text,text,text,text) to authenticated;
revoke execute on function public.discard_legacy_section_edit(uuid,text) from public, anon, service_role;
grant execute on function public.discard_legacy_section_edit(uuid,text) to authenticated;
revoke execute on function public.edit_captured_document_section(uuid,integer,uuid,integer,text,integer,text,text) from public, anon, service_role;
grant execute on function public.edit_captured_document_section(uuid,integer,uuid,integer,text,integer,text,text) to authenticated;
revoke execute on function public.get_captured_document_operation(uuid) from public, anon, service_role;
grant execute on function public.get_captured_document_operation(uuid) to authenticated;
revoke execute on function public.get_latest_captured_document_operation(uuid) from public, anon, service_role;
grant execute on function public.get_latest_captured_document_operation(uuid) to authenticated;
revoke execute on function public.link_own_business(uuid) from public, anon, service_role;
grant execute on function public.link_own_business(uuid) to authenticated;
revoke execute on function public.promote_profile_resume(uuid,text) from public, anon, service_role;
grant execute on function public.promote_profile_resume(uuid,text) to authenticated;
revoke execute on function public.request_captured_document_cancellation(uuid,integer,text) from public, anon, service_role;
grant execute on function public.request_captured_document_cancellation(uuid,integer,text) to authenticated;
revoke execute on function public.request_captured_document_export(uuid,integer,uuid,integer,text,text) from public, anon, service_role;
grant execute on function public.request_captured_document_export(uuid,integer,uuid,integer,text,text) to authenticated;
revoke execute on function public.restore_previous_profile_resume() from public, anon, service_role;
grant execute on function public.restore_previous_profile_resume() to authenticated;
revoke execute on function public.save_legacy_section(uuid,integer,text,text,text) from public, anon, service_role;
grant execute on function public.save_legacy_section(uuid,integer,text,text,text) to authenticated;
revoke execute on function public.update_own_profile_details(text,text,text,text,date,text,text,text,text,text,text) from public, anon, service_role;
grant execute on function public.update_own_profile_details(text,text,text,text,date,text,text,text,text,text,text) to authenticated;

-- Existing Auth trigger invocation remains intact; this is not a client RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;

commit;
