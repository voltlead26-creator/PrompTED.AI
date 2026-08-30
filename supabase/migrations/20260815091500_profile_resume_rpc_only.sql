-- Resume rotation is an invariant-preserving operation, not a browser-owned
-- table mutation. Keep reads available to the authenticated browser and force
-- all writes through promote_profile_resume / restore_previous_profile_resume,
-- which derive the user from auth.uid() and verify upload ownership.

revoke insert, update, delete
  on table public.profile_resume_versions
  from authenticated;

grant select
  on table public.profile_resume_versions
  to authenticated;

-- The browser no longer has direct DML, so the invariant-preserving RPCs must
-- execute with their owner privileges. Both functions still derive the caller
-- from auth.uid(), constrain every row by that UUID, and promotion verifies
-- ownership of the selected upload before changing either slot.
alter function public.promote_profile_resume(uuid, text)
  security definer;
alter function public.promote_profile_resume(uuid, text)
  set search_path = public, pg_temp;

alter function public.restore_previous_profile_resume()
  security definer;
alter function public.restore_previous_profile_resume()
  set search_path = public, pg_temp;

revoke all on function public.promote_profile_resume(uuid, text) from public, anon;
revoke all on function public.restore_previous_profile_resume() from public, anon;
grant execute on function public.promote_profile_resume(uuid, text) to authenticated;
grant execute on function public.restore_previous_profile_resume() to authenticated;
