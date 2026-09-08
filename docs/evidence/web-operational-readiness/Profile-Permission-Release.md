# Profile permission recovery — concrete production proposal

Prepared6September; executed8September2026, Australia/Melbourne.
**Applied to production at18:48:07 AEST.**

Target: Supabase project `jjsykocqpjlekgsbylkd`, serving
`https://ted.littlemissscarlett.co`. Repository branch
`Thought-Enhanced-Document`, HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`
plus the documented local readiness overlay. This is a single permission
repair, not acceptance or deployment of the whole overlay.

## Completed execution

The owner explicitly authorised release to the confirmed targets. The exact
original migration below passed a single-migration dry run and was applied using
existing native Supabase CLI credentials. Independent catalog checks confirmed
68 migration records, exactly six authenticated column grants, private columns
denied and unchanged owner RLS. The signed-in production Profile loaded with its
existing resume resource. No user rows were changed; no resume upload/download
or production save was exercised.

Receipts: `profile-production-dry-run-stored-20260908.json` and
`profile-production-apply-stored-20260908.json`. The first dry run using the
selected local operator token failed before mutation because its format was
invalid; it is preserved in `profile-production-dry-run-20260908.json`.

The proposal and historical evidence below describe the reviewed pre-apply
baseline; statements about pending authority or execution are superseded by
this completed record. No whole-app acceptance is implied.

## Exact effect

Apply only `20260906010846_profile_resume_upload_reads.sql`, SHA-256
`7e149781e2f1394f89830ebc8bef8d2bbed3c4cbee32749d765741f8e1caffed`:

```sql
grant select (
  id, file_name, file_type, file_size_bytes, storage_path, extracted_text
) on table public.uploads to authenticated;
```

This lets Profile's existing `uploads!inner(...)` query read its original-file
resource fields. Existing `uploads_own` RLS restricts rows to `auth.uid()`.
There is no table-wide SELECT, anonymous grant, direct write grant, policy
replacement or user-row change. Ingest claim tokens/checkpoints remain private.
The transaction and migration-history record make the applied change attributable.

Live metadata refreshed at **18:11:11 AEST** still shows all six permissions
missing, RLS enabled, the existing owner policy intact, latest hosted migration
`20260905000000`, and this Profile migration absent. See
[current metadata](supabase-profile-release-preflight.json).

## Evidence supporting this exact change

- All **69 fresh migrations**, **36 SQL files / 1,520 assertions** pass,
  including **24 Profile ACL/RLS assertions**.
- Two real local Auth users signed in with password sessions. Three synthetic
  uploads/resume versions were positively created and independently read.
- The browser's actual PostgREST projection reproduced **403 / 42501** under
  the previous ACL. Reapplying the exact copied migration restored **200**
  owner reads and preserved the same stored versions on repeat reads.
- Changed-owner queries returned no prior-owner rows; unfiltered reads stayed
  owner-scoped. Wildcard/private fields and direct PATCH returned403;
  anonymous reads returned401. Independent SQL confirmed original wording
  and relationship counts unchanged.
- Complete web gate passed: **165 deployment**, **223 root**, **291 shared**,
  **870 web** tests, lint/types, production build and progressive bundle checks.
  Earlier unchanged Edge gate passed686 tests, entry-point types and a zero-
  advisory production dependency audit.
- Source hash manifests and tracked diffs were unchanged by execution. The
  exact disposable stack was removed; the shared local database was preserved.

Evidence: [HTTP acceptance](db-20260906080514479-4889adb0/profile-http-acceptance.json),
[SQL acceptance](db-20260906080514479-4889adb0/fresh-tests.log),
[web gate](db-20260906080514479-4889adb0/web-gate.log).
These establish local permission/API recovery, not production browser recovery,
file-ingestion success, exported artifacts or a full historical-schema upgrade.

## Prepared execution and recovery

[Release plan and file hashes](profile-permission-release-plan.json) identify
an isolated 68-migration preparation directory: the 67 unchanged committed
baseline migrations plus only this Profile migration. All source bytes were
verified when preparing it. No `.env`, linked-project credentials, application
builds or other uncommitted migrations were copied. No remote CLI dry run or
mutation has been executed.

After exact permission authorisation:

1. Recheck target metadata, current baseline and every prepared file hash.
2. Use the recorded Supabase CLI2.114 argv with explicit `--project-ref` and
   `--skip-vault`; the dry run must identify **only** this Profile migration.
   Stop if credentials are unavailable or any additional migration appears.
3. Apply that reviewed single migration with its original version identity.
   Never run db push from the broad dirty checkout for this repair.
4. Independently verify the migration version, exact column grants, private
   column denials and unchanged RLS. Reload the existing signed-in Profile
   through the browser and inspect request status and safe UI state without
   saving personal content into evidence. Report production recovery only if
   those reads succeed.

The pending, unactivated v2 grounding migration has an earlier local timestamp
and is outside this permission repair. Its eventual full-release ordering must
be reviewed explicitly; do not silently include it or rewrite hosted history.
The local snapshot and file digest are the current change identity; no new
Git commit, CI acceptance, push or web publication is claimed.

If this exact permission change must be reversed, a forward recovery migration
can revoke these six column grants from authenticated. That restores the prior
denial and may make Profile unavailable again; it does not delete data. Recheck
intervening grants before recovery and record the actual resulting state.

## Authority and remaining scope

The owner's function-installation authority is retained. This operation changes
a hosted database grant, which is separately protected by the owner's handoff
and `AGENTS.md` section0: "Supabase hosted migration, data mutation, Edge
Function deployment, Storage mutation, RLS/grant change, or secret change".
Exact authorisation for this Profile grant is still required.

Missing functions, evaluated production routing/capacity, runtime settings,
legacy-endpoint compatibility, utility-boundary repairs and upload/browser
acceptance remain tracked in the [function audit](Supabase-Function-Integration-Audit.md).
This permission repair does not resolve or waive those release gates.
