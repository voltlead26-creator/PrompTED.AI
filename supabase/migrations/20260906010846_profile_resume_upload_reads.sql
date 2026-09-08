-- Profile reads the current/previous resume through uploads!inner. The
-- browser Data API allowlist revoked that dependency's SELECT privilege.
-- Expose only the original-file resource projection plus its join key;
-- ingest leases, response checkpoints and processing fields stay private.
-- Existing uploads_own RLS remains the row-ownership boundary. Upload and
-- resume mutations continue through their existing server commands.

begin;

grant select (
  id,
  file_name,
  file_type,
  file_size_bytes,
  storage_path,
  extracted_text
) on table public.uploads to authenticated;

commit;
