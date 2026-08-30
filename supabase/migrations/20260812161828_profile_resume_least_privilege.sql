-- Remove legacy default table privileges from the Profile resume resource.
-- RLS protects rows, while these grants restrict which table operations the
-- signed-in browser role can attempt through the Data API.

revoke all on table public.profile_resume_versions from anon;
revoke all on table public.profile_resume_versions from authenticated;

grant select, insert, update, delete
  on table public.profile_resume_versions
  to authenticated;
