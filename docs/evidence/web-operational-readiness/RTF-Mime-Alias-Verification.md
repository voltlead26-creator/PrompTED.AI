# RTF MIME alias compatibility — 7 September 2026

**Implemented locally; JavaScript regressions, fresh/upgrade SQL, local Auth/PostgREST/Storage and complete web gate verified.** No browser activation, hosted mutation, completed format-preserving editing or export claim.

Repository `/Users/kaichurchw/PrompTED.AI`, branch `Thought-Enhanced-Document`, HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the recorded dirty overlay. Board claim revision 29 covers these paths with no collision. Node 22.23.2, pnpm 10.33.0, Deno 2.9.5, Supabase 2.114.0. No new commit, branch or worktree.

## Reproduction and meaning

An existing empty-MIME **JSON** ingest request keeps its original request digest and stores the extension `rtf` as `file_type`. Actual empty-type browser multipart serialization supplies `application/octet-stream`; it was an already-passing control. The production change must not rewrite those stored identities or pretend these are the same transport.

The JavaScript regression failed on the intended alias metadata rejection: `rtf-alias-ingest-red-reason.log` has two failing JSON cases and two passing multipart controls. `rtf-alias-js-green.log/.json` then records 146 passing adjacent cases, including the real private extraction client, extract handler and bounded RTF producer with controlled auth/storage/checkpoint/classification dependencies. The source manifest remains explicitly `source_only`, with `rtf-format-preserving-editing-unverified` mandatory. V1/v2 remain unchanged.

The database RED run `job-mtqpttwo-bb95e5b8`, `db-20260907040320724-c6bf7516`, applied the unchanged 72-migration predecessor and ran all 42 current SQL files. Exactly **11 of the 52 alias assertions failed**; the other **1,850 assertions passed** (1,902 total). Failures 31–37, 50 and 52 derive from rejected valid aliases; failures 42 and 44 prove the distinct alias-to-text downgrade and unwanted checkpoint. These are two behavioral defects, not eleven independent faults. All positive claims/storage-stage fixtures ran successfully. Full `pnpm verify:web` passed afterward. Cleanup, Docker resources, tracked diff, HEAD and source hashes matched, including a separate completion-time source comparison.

## Narrow repair

- `_shared/upload-extraction.ts` adds literal normalized `rtf` only to the existing v3 RTF metadata allowlist. Filename, MIME mismatch, parser, bounds and unsupported-semantics rejection remain enforced.
- `20260907094500_upload_rtf_mime_alias.sql` replaces only `public.record_upload_extraction_snapshot` with its existing full definition plus `rtf` in two v3 MIME lists. One accepts valid `.rtf` originals; the other prevents an RTF alias from becoming plain text. SHA-256: `143fa67061b164c87529550b2aa9db5e2e83395854fd97d69fd1c604de520804`.
- Accepted `20260907081500_upload_source_checkpoint_v3.sql` remains byte-identical, SHA-256 `effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727`. Signature, defaults, permissions, fixed search path, owner/request/content/claim identities, replay precedence, lease fences, source validation and atomic update are unchanged. There is no backfill or data rewrite.
- The previous v3 slot-10 negative now uses unsupported `rtf; charset=utf-8`, retaining the precise rejection and absent-checkpoint checks. The original test is preserved as `rtf-alias-predecessor-v3-test.sql.txt` and in the RED input hash manifest. Bare alias acceptance is tested positively and against text downgrade by the new 52-assertion suite.
- Both `extract-upload` and `ingest-upload` now require the forward migration in the existing deployment contract. Its static check passes for 26 functions.

An independent read-only SQL review confirmed exactly the two-list change and no other function-definition difference. An independent read-only JavaScript review passed its bounded change and correctly distinguished the JSON and multipart fixtures.

## Prepared acceptance

The existing isolated runner has a separate `--upload-rtf-alias-acceptance` mode, using the same bounded Auth/PostgREST/Storage probe and cleanup. It pins predecessor `20260907081500` to its accepted hash, allows only successor `20260907094500`, and copies every current SQL test/migration. The old v3 upgrade validator remains unchanged and still rejects an extra pending migration. Mixed modes, changed/missing predecessor, missing successor/regression, duplicate versions, extra migrations and omitted/changed SQL inputs reject before services.

The probe prepares one alias original on the predecessor, requires its exact checkpoint rejection and no row mutation, applies the forward migration, then retries that same pending identity without retaining another original. Storage uses `application/octet-stream` for this empty-MIME fixture while its claim retains literal `rtf`. Full-row comparisons cover the candidate and seven historical controls, including canonical v3 ready output and a terminal alias failure. The terminal failure must replay its exact 422 receipt; this migration cannot reopen it. Original bytes are compared before/after, then checkpoint replay, stale-token rejection, owner isolation, terminal settlement and independent persistence reads are exercised.

Quick plan tests: 36 passed. Full no-service preflight: `db-20260907041429037-9d23fced`, passed with 73 migrations and 42 tests. Independent read-only probe review found one duplicate-Storage-request MIME inconsistency; the fixture now uses the same application/octet-stream MIME for initial and duplicate retention. No further source-review blocker was found. JavaScript syntax checks and git diff whitespace checks pass; exact final inputs are in rtf-alias-forward-inputs.json. The subsequent actual fresh/upgrade result is recorded below; preflight itself is not database execution proof.

## Completed local database and web acceptance — 14:19 Melbourne

`job-mtqqbg1f-f83755d6` completed successfully in about 137 seconds. Saved evidence: `db-20260907041702561-a09bb8b2`.

- Fresh: all 73 migrations, **1,902 SQL assertions / 42 files passed**.
- Upgrade: exact verified predecessor `20260907081500` → sole forward migration `20260907094500`, with migration history and disposable database identity checked before/after; **1,902 assertions / 42 files passed again**.
- **183 real local Auth/PostgREST/Storage checks passed**, using two authenticated synthetic users and anonymous denial cases. All **12 retained original files remained byte-identical**. Seven complete historical rows and the pending candidate were unchanged by migration.
- The same retained candidate `4c4cdd36-397a-4e9f-ae88-0704f65aa7a9` first failed the predecessor checkpoint with `P0001 / UPLOAD_SOURCE_MANIFEST_INVALID`, leaving no checkpoint or row mutation. It then recorded, independently read, replayed, survived token handoff and settled on the successor. The original request/hash/file metadata were preserved; it was not re-uploaded or replaced by another identity.
- The separate settled failure replayed its exact failed outcome, HTTP 422 and response. Recovery is proven for the pending candidate, not for terminal failures.
- **Complete `pnpm verify:web` passed**, including lint/type checks, broad web/shared tests, real environment guard, 29-page production build and progressive bundle gate.
- Exact run cleanup succeeded, before/after Docker resources matched, tracked patch/source/HEAD stayed unchanged, and a completion-time comparison again matched all 813 source files under the runner's documented exclusions. Logs retain synthetic fixture IDs; local credentials are redacted.

This establishes the database/persistence side of the alias repair with real local services and precomputed extraction/controlled classification. The JavaScript adjacent suite previously passed 146 cases; the full Edge gate for the final alias overlay also passed: `job-mtqqht30-d0515f7f`, `upload-source-edge-gate-20260907042159412`, **1156 tests / zero failures**, all 26 entry points type checked and 28 affected upload files linted. Source, HEAD and web dotenv hashes were unchanged; completion comparison matched all 885 files under this runner’s exclusions. This completes the alias slice’s local gate. No Edge HTTP deployment, actual browser flow, model call, editing or export was exercised by this database probe.

## Remaining product gates

The shared browser admission still defaults to v1; RTF is not yet enabled in the Master Workspace file selector. Format-preserving edit, revision approval and export integration remain incomplete. PDF/DOCX source retention alone does not satisfy the flagship editing requirement. Already settled historical failures require a reviewed explicit recovery path. The separate v2/v3 fallback-provenance settlement compatibility gap also remains. CI, actual browser workflows, deployed persistence, production acceptance and edited/exported artifact inspection are unverified for this slice.
