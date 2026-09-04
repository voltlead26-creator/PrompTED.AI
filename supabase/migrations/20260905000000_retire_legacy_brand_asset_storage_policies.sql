-- The production migration baseline contains the original direct browser
-- Storage policies. Later lifecycle migrations replaced those policies with
-- an owner-scoped read policy and RPC-controlled mutations, but the original
-- policy names also need to be retired when that historical baseline is
-- replayed from scratch.

begin;

drop policy if exists brand_assets_select_own on storage.objects;
drop policy if exists brand_assets_insert_own on storage.objects;
drop policy if exists brand_assets_update_own on storage.objects;
drop policy if exists brand_assets_delete_own on storage.objects;

commit;
