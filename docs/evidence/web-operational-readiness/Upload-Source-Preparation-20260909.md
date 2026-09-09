# Master Workspace source preparation — 9 September 2026

Implementation target: `/Users/kaichurchw/PrompTED.AI`, remote
`https://github.com/voltlead26-creator/PrompTED.AI.git`, branch
`Thought-Enhanced-Document`. Base revision: `d96c6cbb6a267d91335192c591a0346eca69813c`.
This record describes a local overlay, not a new published or deployed revision.

## Change and acceptance boundary

Master Workspace previously required a successful provider classification after
original retention and extraction. Its editable text sections are made by the
existing heading/paragraph splitter, independently of that classification.
The new explicit `upload-source-preparation.1` request completes the existing
retained extraction without provider classification. AI-assisted section mapping
and review remain separate unfinished work; this change does not remove that
product requirement or claim that a text preview preserves binary formatting.

The existing upload endpoint, original Storage bucket, upload row, immutable
extraction checkpoint and atomic import command remain authoritative. New requests
have a separately versioned, owner-bound identity. Legacy Home/role ingestion keeps
its literal v1 identity and classification contract. There is no automatic policy
downgrade or new document/allowance store.

The service-role completion command checks identity, live claim, storage stage,
account-deletion fence, original object and stored extraction. It derives the
closed receipt from that checkpoint. It rejects existing provider work and retains
the exact receipt for replay. The handler and client verify the receipt's source
identity, text digest, format and completeness. Complete text may enter the existing
owner review/import flow; binary and truncated previews retain the current import
restrictions.

## Source changes

- `packages/shared/src/upload-source-preparation.ts`: closed source receipt and digest validation.
- `packages/shared/src/api-client/index.ts`: explicit source preparation through the existing upload transport/retry/owner boundary.
- `supabase/functions/ingest-upload/handler.ts`: versioned admission and checkpoint-derived completion before provider dispatch.
- `supabase/functions/_shared/auth-guard.ts`: bounded multipart processing-policy field.
- `supabase/migrations/20260909105519_complete_upload_source_preparation.sql`: completion command and narrow compatibility with the existing text import command.
- `supabase/deployment-contract.json`: exact new migration/RPC dependency for backend and web release.
- `apps/web/src/app/(app)/workspace/MasterWorkspaceImport.tsx`: explicit source preparation and truthful completeness checks.
- Corresponding client, handler, guard, component and database regressions; browser acceptance checks exact new receipts, source bytes, persistence and absence of provider work.
- `apps/web/public/manifest.webmanifest`: removed duplicate of the existing Next.js metadata route after observing repeated HTTP 500 conflicts in the local runtime. Browser acceptance now checks that route returns a valid HTTP 200 manifest.

## Verification so far

Required runtime refreshed: Node 22.23.2, pnpm 10.33.0, Deno 2.9.5.

| Evidence | Result |
| --- | --- |
| Client regression before implementation | 40 failed, 1 passed; absent public source-preparation capability |
| Handler regression before implementation | New v2 identities rejected with 409 by old handler |
| Source client regression after implementation | 41 passed |
| Shared unit suite | 423 passed across 20 files |
| Web unit suite | 1,035 passed across 117 files |
| Upload/authentication Edge tests | 154 passed before six additional source-policy cases; the expanded source file subsequently passed all 10 cases |
| Shared and web type checking | Passed |
| Changed shared/web lint and ingest entrypoint Deno check | Passed |
| Local upload transport tests | 14 passed |
| Deployment contract and migration checks | Passed; 26 functions, 81 migrations |
| Disposable database/browser preflight | Passed: `db-20260909112119961-24973efc` |
| First preflight | Failed because the source inventory included the deliberately deleted, unstaged duplicate manifest; staging that exact deletion resolved the inventory without changing the guard |
| Fresh database tests | Passed: 81 migrations, 50 SQL files, 2,643 assertions |
| Actual browser workflows | Passed: two accounts and desktop/narrow layouts, 16 uploads including PDF, DOCX, RTF, UTF-16 TextEdit text, TXT, MD and CSV; original bytes, text import/reload/replay, Profile access/save/recovery independently checked |
| Production web build and complete web gate | Passed |
| All active Edge entrypoint types and full Edge tests | Passed: 1,575 tests and 220 steps |
| Fresh production dependency audit | Failed: two Next.js critical advisories and one Sharp high advisory; compatible patch upgrade is the next repair before deployment |
| Upgrade, exact-commit CI and production acceptance | Unverified for this overlay |

Raw focused logs are retained under `/tmp/prompted-source-*.log`; the combined
acceptance runner saves durable source hashes, SQL reports, browser reports and
build results in its uniquely identified evidence directory. It uses an isolated
local Supabase instance and synthetic accounts. No hosted reset, paid model call,
credential rotation or production mutation is part of that verification.

## Release state and remaining work

The owner explicitly requested commit, push and deployment on 9 September at
21:18 AEST. The upload implementation has passed its local code/database/browser/build checks and is being prepared for the authorised publication. Production remains blocked by the separate dependency advisories and missing hosted release inputs. Private
environment values have not been changed in this slice. The latest earlier
configuration check authenticated the OpenAI key but did not establish a credit
balance or paid generation. A fresh GitHub repository/production-environment name-only inspection at 21:23 AEST still finds only the fast/deep model inputs. Twelve required OpenAI inputs are absent: research/review models, four capacity fingerprints, four evaluation fingerprints, routing version and evaluation-suite version. These require actual configuration/evaluation evidence before the protected production workflow can pass.

This slice is not the full requested application completion: format-preserving
PDF/DOCX/RTF editing, AI-assisted section review, hosted backend alignment and
synthetic production workflow acceptance remain open. The user's account limits
remain unchanged as instructed.

Completed local evidence is in `db-20260909112432446-28b6d4d2`; the checked source hashes and concise results are in `Upload-Source-Preparation-Verification.json`. No source drift was detected during the run. The original download bytes match the selected fixtures; no generated-export or binary-editing claim follows from that result.
