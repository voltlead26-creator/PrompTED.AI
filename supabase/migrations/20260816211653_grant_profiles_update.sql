-- The profiles_update_own RLS policy (added in
-- 20260527111048_prompted_documents_auth.sql) was never paired with the
-- underlying table grant. Postgres checks table-level privileges before RLS,
-- so every profile-save attempt from a signed-in user has been failing with
-- "permission denied for table profiles" since the table was created — RLS
-- alone was never enough to let a user update their own row.

grant update
  on public.profiles
  to authenticated;
