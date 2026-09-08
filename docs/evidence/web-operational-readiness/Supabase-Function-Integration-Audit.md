# Supabase function integration audit — 6 September 2026

**Dated update — 8 September 2026:** the original inventory and findings below are preserved as the 6 September audit record. Its pending Profile grant statements are superseded by [Profile-Permission-Release.md](./Profile-Permission-Release.md), which records the authorised production grant migration and signed-in Profile load. Later local upload/Profile browser and persistence checks, including `db-20260908131248224-81ab4600`, are recorded in [Generation-Policy-Admission-20260908.md](./Generation-Policy-Admission-20260908.md). Current utility findings and superseded observations are separated in [Utility-Release-Blocker-Refresh-20260908.md](./Utility-Release-Blocker-Refresh-20260908.md). Current production inputs, missing functions and endpoint reconciliation remain in [Production-Release-Prerequisites-20260908.md](./Production-Release-Prerequisites-20260908.md). These later local checks do not establish deployment of the full repair candidate.

Target: `jjsykocqpjlekgsbylkd`; web: https://ted.littlemissscarlett.co.
Source: `Thought-Enhanced-Document` at `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the explicitly uncommitted readiness overlay. No branch switch, push, deployment or hosted mutation was performed in this audit.

The owner explicitly authorised auditing and installing required Supabase functions at 11:12 AEST. That authority is retained for the function release after its prerequisite checks. Database privileges, secrets/model configuration, web publication, removal of hosted legacy endpoints and paid evaluations are separate effects and remain explicit.

## Observed result

- 26 local declared/configured entry points: 23 active, 3 dormant. All have source entry points.
- 25 hosted functions were listed and their 270 bundled source files inspected and fingerprinted without copying source into the implementation.
- 3 active functions are missing: **document-operation, extract-upload, brand-logo**.
- All 20 already-hosted active entry points differ from the current source. A checksum difference proves drift, not an independent runtime defect in every function. 14 hosted bundles contain the legacy provider router.
- 3 dormant raw OpenAI endpoints remain hosted. Two additional hosted endpoints are outside the current contract: anthropic-messages and bcm-analyze-floor-plan. They have not been removed.
- All 24 required public tables, 95 requested RPC entries and their declared argument signatures exist. The 67 original migration versions are hosted. Existence/signature checks are not behavioral or upgrade acceptance.
- Production capacity and reviewed routing/evaluation records are absent for **fast, deep, research and review**.
- Names-only secret inventory found 11 missing required names: OPENAI_DEEP_MODEL, OPENAI_FAST_MODEL, OPENAI_RESEARCH_MODEL, OPENAI_REVIEW_MODEL, OPENAI_ROUTING_VERSION, PROMPTED_DEPLOYMENT_ENV, PTV_DEVELOPER_ID, PTV_TIMETABLE_KEY, RENDER_SERVICE_ALLOWED_ORIGIN, RENDER_SERVICE_URL, REVENUECAT_WEBHOOK_SECRET. Existing secret values were not read.

## Function/caller matrix

The contract's authMode anon usually means gateway verify_jwt=false with a confirmed-account guard inside the handler. It is not anonymous user authorisation. Internal extraction implements service-role bearer and apikey checks.

| Function | Local contract | Hosted version / JWT | Caller or deliberate gate | Required internal functions |
| --- | --- | --- | --- | --- |
| clarify | active; anon | 350 / false | useInterpretIntent → shared clarify | — |
| recommend | active; anon | 351 / false | useRecommendation → shared recommend | — |
| interpret-intent | active; anon | 348 / false | useInterpretIntent → shared interpretIntent | — |
| research | active; anon | 349 / false | Declared gateway route; intentional claim-verification 409 gate | — |
| job-match | active; anon | 330 / false | FindRolesScreen / useRecommendation → shared jobMatch | — |
| generate-document | active; anon | 353 / false | useDocument → document-generation → reviewed stream consumer | — |
| document-operation | active; anon | **Missing** | CapturedAdmission; operation start/status/resume/cancel clients | — |
| generate-checklist | active; anon | 349 / false | ConversationView / InteractiveChecklistOutcome | — |
| generate-artifact | active; anon | 58 / false | InteractiveChecklistOutcome → createOrReplayArtifact | — |
| generate-report | active; anon | 340 / false | Declared gateway route; intentional durable-checkpoint 409 gate | — |
| edit-section | active; anon | 349 / false | useEditWithTED → exact proposal/apply command | — |
| explain-section | active; anon | 125 / false | useExplainWithTED | — |
| proofread-document | active; jwt | 74 / true | ProofreadPanel; suggestions remain unapplied | — |
| extract-upload | active; internal-service-role | **Missing** | Internal upload-extraction-client; never browser-routable | — |
| ingest-upload | active; anon | 328 / false | Home / Master import / Find Roles / Profile / outcome uploads | extract-upload |
| brand-logo | active; anon | **Missing** | BrandKitEditor → saveBrandKitOperation | — |
| render-export | active; anon | 342 / false | useExport; approved revision and immutable receipt | — |
| live-source | active; jwt | 109 / true | Declared gateway route; intentional claim-verification 409 gate | — |
| openai-chat | dormant; jwt | 107 / true | Dormant; no app route | — |
| openai-responses | dormant; jwt | 108 / true | Dormant; no app route | — |
| openai-stream | dormant; jwt | 106 / true | Dormant; no app route | — |
| calculate-deadline | active; jwt | 26 / true | No active app/internal caller found; gateway JWT only | — |
| government-evidence | active; jwt | 26 / true | No active app/internal caller found; confirmed-user/egress guards | — |
| transport-victoria | active; jwt | 27 / true | No active app/internal caller found; confirmed-user/egress guards | — |
| account-delete | active; anon | 112 / false | Settings delete-account; user authentication and deletion fence | — |
| webhooks-revenuecat | active; anon | 112 / false | RevenueCat ingress; shared secret verification | — |

## Reproduced workflow failures and bounded repairs

**Profile:** the authenticated production page showed “TED couldn't load your saved resume resources. Please try again.” Its personal-details request returned 200; the profile_resume_versions query embedding uploads returned 403 / PostgreSQL 42501, permission denied for table uploads. Catalog inspection independently confirms RLS is enabled but authenticated has neither table SELECT nor file_name SELECT. The earlier browser-privilege convergence migration omitted the join dependency. A new local migration grants only id, file_name, file_type, file_size_bytes, storage_path and extracted_text. It does not expose ingest claim tokens/checkpoints or change write/RLS policy. All 24 new SQL assertions pass: both owners, populated joins, exact old-ACL reproduction, anonymous/subjectless denial and private-column/write denial. Real local Auth/PostgREST acceptance is being prepared; deployed recovery remains unverified. Function installation alone cannot fix this direct Data API read.

**All-format upload contract mismatch:** the served chunk 1071-3c18eb0fb0e4a6e7.js rejects a response whose upload ID differs from the accepted UUIDv8 or whose classification_status is not completed. Hosted ingest-upload v328 creates crypto.randomUUID() IDs and omits classification_status. These contracts cannot agree even when legacy extraction succeeds. The current client can replay one malformed acknowledgement; against the legacy non-idempotent endpoint that may dispatch another retained upload. No production upload was dispatched in this audit, and no duplicate record or paid use is claimed as observed. Correct current ingest and internal extract must be released together, with extraction installed first. Strict acceptance must not be relaxed to accept the legacy response.

**Untyped multipart files:** the current local client hashed an empty MIME while the actual multipart encoder emitted application/octet-stream. Four intended regression assertions failed (empty-MIME PDF, DOCX, MD and identity equivalence). The client now captures the real wire MIME before hashing. Explicit MIME values and the server's existing JSON identity contract stay intact. 65 focused shared tests pass. Additional situation-text line-ending/HTML-sanitization and unusual filename wire cases are source-derived concerns still needing paired guard/identity reproductions. This MIME correction is not a claim of universal canonicalization.

**Checklist missing-function fallback:** local reproduction showed that an unknown function 404 started a second legacy generation. Two regressions failed for that exact reason. The fallback now requires both HTTP404 and TED_V2_DISABLED. A real missing function remains an explicit recovery failure; the deliberate cohort-disabled path still waits for persistence. The 7 checklist tests and 18 adjacent profile/gateway tests pass.

## Integration limits requiring closure

- research, live-source and generate-report intentionally return safety gates in the current code. Installing them does not make research/report capabilities complete. Their gates must be preserved.
- calculate-deadline has no demonstrated app consumer and only gateway JWT; confirmed-user/rate/bounded-body/deletion-egress validation and provider holiday shapes need focused review and behavioral proof before exposure. government-evidence and transport-victoria likewise have no demonstrated app consumer, despite stronger guards. No arbitrary routes were added.
- The independent [utility boundary review](Supabase-Utility-Boundary-Review.md) records source-confirmed request admission, response-shape, byte/redirect and cancellation gaps across deadline/government/transport. These cases need reproductions and bounded repairs before those active utilities receive an operational acceptance label; passing existing tests does not close them.
- The new v2 grounding SQL/TypeScript remains unactivated preparation. Its 152 generated-revision SQL assertions now pass, including the 26 rejection scenarios previously accepted before the guard. Independent-review follow-ups for deterministic depth/instruction checks and numeric parity remain open. Do not activate v2 as part of missing-function installation or describe the whole grounding contract as complete.
- The deployment contract forbids undeclared/dormant hosted functions and requires exact capacity/evaluation attestations before function release. Current hosted state fails these checks. Existing function-installation authority does not supply missing evaluated models, renderer/PTV/webhook configuration or authority to delete legacy endpoints.

## Release sequence and evidence requirements

1. Finish attributable local function/type/DB/web checks; preserve failed gates and the exact source manifest.
2. Resolve reviewed production model/capacity/evaluation evidence and missing runtime configuration through secure inputs; do not infer values from legacy provider code or fabricate hashes.
3. Resolve dormant/undeclared endpoint compatibility and exact removal/disable authorisation; no blanket deletion.
4. Revalidate the immutable hosted baseline and schema/configuration immediately before mutation. Deploy named current contract functions in dependency order using the established workflow, including extract-upload before ingest-upload. Function installation/update is authorised by the latest owner instruction; the prerequisites remain mandatory.
5. Re-read deployed source identities, function versions and JWT modes. Safe method/auth probes establish reachability only.
6. With the exact synthetic workflow scope authorised, exercise PDF/DOCX/MD ingestion, independent original/row reads, replay, destination attachment/promotion, reload and truthful UI recovery. Inspect exports separately.

The prepared Profile grant and web MIME/checklist fixes need their separately attributable publication steps. Never label installed files, a method probe, unit mocks or a Saved label as full operational proof.

## Evidence

- **Latest real API acceptance:** `job-mtpj124h-8663ec9a` exited0. All69 migrations,36 SQL files/1520 assertions and the full165/223/291/870 web gate passed. Fifteen local Auth/PostgREST exchanges proved real sign-ins, the old Profile403, exact-grant recovery, repeat reads, two-owner isolation, private/anonymous denials and blocked direct PATCH. Independent SQL confirmed original rows and resume relationships unchanged; source equality and cleanup passed. [HTTP report](db-20260906080514479-4889adb0/profile-http-acceptance.json), [SQL report](db-20260906080514479-4889adb0/fresh-tests.log), [web gate](db-20260906080514479-4889adb0/web-gate.log).
- Hosted metadata refreshed at18:11:11 AEST confirms the six Profile grants are still absent, RLS/owner policy remain enabled, latest migration is20260905000000, and the same25 functions remain hosted with document-operation/extract-upload/brand-logo absent. [Metadata refresh](supabase-profile-release-preflight.json).
- The [concrete Profile permission proposal](Profile-Permission-Release.md) records exact bytes, effect, evidence, prepared isolated migration snapshot, execution verification and recovery. Hosted grant authorisation is required; no protected action has been executed.
- Latest database rerun: `job-mtpimepq-3df9baea` exited 0. All 69 migrations applied; all 36 SQL files / 1,520 assertions passed, including the 24 Profile assertions. Full web verification passed (165 deployment, 223 root, 291 shared, 870 web tests plus lint/types, production build and progressive bundle checks). Cleanup and source/patch equality passed. [Database acceptance](db-20260906075350975-c3bd58a3/fresh-tests.log), [web acceptance](db-20260906075350975-c3bd58a3/web-gate.log).
- Earlier database rerun: `job-mtpieo7s-b3d51e11` exited 1. All 69 migrations applied successfully at start and fresh reset. 35 SQL files passed, with 1,496 assertions including all 152 grounding-guard assertions. The 36th file, the new Profile regression, aborted at its first assertion because the catalog column-name and expected-text collations differed. Both projections now explicitly use the same C collation, preserving exact column equality; the remainder of the fixture and the six-column grant were independently reviewed against the Profile consumer. Full web verification passed again, cleanup succeeded and source hashes/patches were unchanged.
- [Earlier database results](db-20260906074750017-63fb5473/fresh-tests.log), [earlier passing web gate](db-20260906074750017-63fb5473/web-gate.log). The test-only collation correction follows [PostgreSQL 17 collation rules](https://www.postgresql.org/docs/17/collation.html); it changes no database/application policy. The corrected Profile regression passed in the latest rerun above.
- Earlier integrated check: `job-mtpi0srd-b1b5a6f5` exited 1. All 686 Edge tests passed; production dependency audit reported zero advisories; the complete web gate passed (165 deployment tests, 223 root tests, 291 shared tests, 870 web tests, lint/types, production build and progressive bundle checks). Source manifests were identical before/after and disposable cleanup succeeded.
- The failed Edge type subcheck invented an entry point for an empty legacy `anthropic-messages` directory. The evidence runner now enumerates existing entry-point files; a direct `deno check supabase/functions/*/index.ts` rerun passed. The separate deployment-contract check still enforces declared source presence. No legacy directory or endpoint was deleted.
- That earlier database subcheck stopped during migration start, before SQL tests, because two SQL `CASE` expressions inside the new grounding trigger's PL/pgSQL `IF` needed parentheses. The exact error and an independent review identified this syntax defect. The latest rerun proves that correction and the grounding SQL cases. This was not a production schema failure.
- [Integrated check results](function-gate-20260906073702742/summary.json), [database start failure](db-20260906073737600-51e3502a/start.log), [complete passing web gate](db-20260906073737600-51e3502a/web-gate.log), [corrected Edge type check](function-entrypoint-types-corrected.log).
- [Hosted function bundle manifest](supabase-functions-hosted-before.json)
- [Per-function source comparison](supabase-function-compatibility-audit.json)
- [Hosted tables, RPCs, grants and migrations](supabase-function-schema-audit.json)
- [Routing/capacity record presence](supabase-routing-readiness-audit.json)
- [Required secret-name inventory](supabase-secret-name-audit.json)
- [Multipart regression red](upload-multipart-red.log), [65-test green](upload-multipart-green.log)
- [Missing-function fallback red](function-fallback-red.log), [25-test green](function-fallback-green.log)

**Implemented:** local MIME, checklist recovery and Profile grant preparation. **Verified locally:** focused checks, all Edge tests, dependency audit, complete web gate, corrected entry-point types, 69 fresh migrations, 1,520 SQL assertions and real local Auth/PostgREST Profile recovery. **Verified in CI:** no new revision. **Production exercised:** read-only Profile failure, served-client inspection and metadata refresh only. **Persistence proven:** generated-revision and Profile fixtures in the disposable database, including independent original/relationship reads; no new hosted fixture or complete browser journey. **Export inspected:** no. **Blocked:** exact hosted Profile-grant authority, utility boundary repairs and production configuration/release prerequisites. **Unverified:** deployed repairs and end-to-end authenticated browser success.
