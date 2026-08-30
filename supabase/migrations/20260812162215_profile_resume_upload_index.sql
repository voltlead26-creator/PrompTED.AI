-- Cover the upload foreign key used by Profile resume joins and cascades.
create index if not exists idx_profile_resume_versions_upload_id
  on public.profile_resume_versions(upload_id);
