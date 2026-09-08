# Upload fallback settlement compatibility

**Implemented; fresh and exact historical-upgrade SQL, adjacent DOCX/RTF handlers and full web gate verified locally. Broad Edge verification passed; browser and hosted activation remain unverified.** This follows the completed local RTF alias repair. Scope remains the web app and its existing upload/provider/database contracts. No provider configuration, hosted mutation, new policy/store or browser activation is involved.

Repository `/Users/kaichurchw/PrompTED.AI`; branch `Thought-Enhanced-Document`; HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the recorded overlay. Board claim revision 29 covers these paths; the owner-access design remains untouched. The previous broad gate passed 1156 Edge tests, all 26 entry point checks and 28 upload-file lint checks, with source/HEAD/dotenv unchanged. Before this new regression, fresh and upgraded SQL passed all 1902 assertions and the complete web gate passed.

## Trace and source-confirmed defect

Auth assigns owner and the `ingest-upload` checkpoint scope. After deriving and verifying upload identity, the handler calls `setModelCallRequestIdentity(req.signal, uploadId)`. Classification uses that signal and `logicalStageKey: ingest-upload.classify`.

The provider adapter returns optional `execution` only for actual successful fallback execution or its durable replay. Ingest validates the existing four-key Ollama policy, then includes the same `credit_fallback` object in its completed response and extracted payload. The shared API validates and preserves it; Master Workspace carries it in pending import and displays its existing notice. It is not document wording or private source data.

However, the v2/v3 settlement definition retained in `20260907081500_upload_source_checkpoint_v3.sql` permits only eight completed-response keys and five payload keys. The valid extra provenance field fails `UPLOAD_INGEST_SOURCE_PRIVACY_INVALID`. Default new v1 admission can conceal this integration problem; this is not yet a demonstrated cause of the user's current production upload failure.

## Authoritative repair boundary

Use the existing private legacy model result and its own usage row, matched by owner, checkpoint scope `ingest-upload`, upload UUID string and exact `ingest-upload.classify` stage. The result's provider request hash must match the usage row's provider request hash; it must not be compared to the distinct upload body hash.

For a new completed v2/v3 settlement, both public policy fields must be present together, valid and exactly equal to the successful saved execution policy. A successful matching Ollama execution requires that disclosure. Configured policy alone, another owner/request/stage/scope, a failed/uncertain attempt or a saved response whose validation failed cannot establish successful execution. Preserve terminal replay before new checks, recursive private-source checks, existing checkpoint/text/policy/revision identity and v1/non-fallback compatibility. A new precise provider-provenance command error is specified in the regression; no public API field is added.

## Regression preparation

`supabase/tests/upload_fallback_settlement.test.sql` positively creates two users and fourteen uploads through existing claim, retention-stage, checkpoint and provider-dispatch commands. It creates thirteen provider scenarios through actual admission/dispatch/usage/result commands with synthetic responses; no provider is called. Fixtures include v2/v3 successful fallback, v1 compatibility, configured OpenAI success, absent result, cross-owner/request/stage/scope results, failed/uncertain attempts and a completed saved provider response with failed validation. The last fixture positively joins its saved result to failed usage before requiring denial.

Assertions cover exact response/payload policy, malformed/missing/mismatched policy, source privacy, mandatory disclosure of actual fallback, truthful processing/ready state, exact settlement/reload replay and unchanged provider usage. Positive settlement errors are retained as diagnostic JSON so an intended RED failure cannot abort the remaining assertions. The producer/checkpoint data here is text; adjacent v2 DOCX/v3 RTF handler projection tests remain necessary before closing the slice.

A read-only reviewer found the base fixtures coherent and identified the saved-but-failed result gap, which was added. No-service preflight `db-20260907050138868-ac68bc2b` passed before that final fixture addition; the upcoming run executes all current SQL, including the final test. Exact source hashes and the 73-migration/43-test input manifest are in `upload-fallback-settlement-red-inputs.json`. No forward settlement migration has been written yet.

## Evidence limits

The first database execution must fail for the intended contract/provenance reasons before implementation. Tests expecting a new provider-provenance error express the proposed precise boundary; a different existing rejection code is not a separate production exploit. No actual Edge request, browser upload, hosted persistence, model request or edited/exported document is proved by these database fixtures.

## First execution interrupted by local sleep — 7 September 2026

`job-mtqss4j6-568d752c`, evidence `db-20260907052600065-53ebd6d8`, exited 1 after about 31 minutes. **No SQL assertion or web gate ran.** The disposable reset reported `ETIMEDOUT / SIGKILL`; the cleanup command also timed out. Both command logs printed completion, but that text does not override the unsuccessful process statuses.

A read-only power-log query verified repeated sleep intervals during the run, including 15:29:19–15:47:09 and 15:47:11–15:57:08 Melbourne. Docker responded normally at completion inspection. Independent container/volume/network inventory then matched the exact pre-run resources; none of this run’s project resources remained, and all three reserved test ports were free. Completion source/HEAD comparison matched all814 source files under the DB runner exclusions. This is an interrupted verification run, not the intended failing regression or a demonstrated app defect.

The next execution uses the unchanged test and runner under `/usr/bin/caffeinate -i`, scoped to the utility lifetime. The local manual and a quick failure-exit propagation check were verified; the assertion ends with the runner. Existing test deadlines remain intact.

Final independent source review predicts **126 assertions, 31 failures and 95 passes** on the unchanged settlement command. This is a prediction only. The expected positive-case diagnostics are `P0001 / UPLOAD_INGEST_SOURCE_PRIVACY_INVALID`; the saved-but-failed result fixture was reviewed and found coherent. The next run must establish the actual counts and failure reasons.

## Verified RED and forward repair — 18:05 Melbourne

The protected-from-idle-sleep run `job-mtqy87ov-15881768`, evidence `db-20260907075828703-d9b5dfd9`, completed in about100 seconds. It executed all2028 SQL assertions across43 files: exactly31 of126 new assertions failed, with95 passing in the new file and all1902 previous assertions passing. All77 setup/provenance assertions passed, including the saved-but-failed provider fixture. Both valid fallback settlement diagnostics were `P0001 / UPLOAD_INGEST_SOURCE_PRIVACY_INVALID`. Omitted provenance on actual fallback incorrectly allowed completion. Remaining failures included precise error-contract expectations and dependent persistence/replay assertions; these are not31 independent production defects. Full pnpm verify:web passed, cleanup/resources matched and source/HEAD were unchanged, including the completion comparison over814 source files.

Added `supabase/migrations/20260907102000_upload_fallback_settlement.sql`, SHA256 `8fd4a9d24e3ee6c8c78c18119fc55843d97733da08079f36eda8bab01455147e`. It replaces only the existing settlement function. The two completed outer key checks permit the existing `credit_fallback` field; a new v2/v3 completed-settlement block validates it against the owned result and usage receipt. The saved JSONB response digest, provider request identity, execution status, attempt number, null error, policy and model must match. Both public projections must be present and equal. Matching Ollama result rows are retained before success filtering so saved-but-failed output cannot pass or silently omit provenance. Missing/false proof raises `UPLOAD_INGEST_PROVIDER_PROVENANCE_INVALID`.

Terminal replay, recursive source privacy, v1 compatibility, exact checkpoint comparisons and the final update retain their original order. There is no new RPC, signature/default/grant change, activation, policy store, backfill or history rewrite. The accepted81500 and94500 migrations remain unchanged. `ingest-upload` now requires the new migration; the already required shared request-guard migrations supply the existing provider-policy helper. Independent source review found no blocker. Migration validation passed for74 files; deployment-contract validation passed for26 functions; git diff whitespace checks passed. No-service preflight `db-20260907080458902-33d7287b` passed.

Fresh GREEN, an exact historical upgrade, adjacent v2/v3 handler projection/replay tests, browser and hosted acceptance remain pending. Existing public client/Master projection already consumes this field and needs no second persistence path.


## Fresh GREEN verified — 18:08 Melbourne

`job-mtqyiy8j-aaa9e385`, evidence `db-20260907080649669-d1d1e72a`, exited0 in about101 seconds. All74 migrations applied; all2028 SQL assertions across43 files passed, including all126 fallback assertions. Both positive v2/v3 diagnostics report `settled`. The complete `pnpm verify:web` gate passed. Cleanup and independent resource comparison matched; source and HEAD remained unchanged, including all815 files in the runner's completion comparison. This proves fresh local settlement and its regression boundaries. Exact historical upgrade, adjacent DOCX/RTF handler checks, real browser usage and hosted acceptance remain separate gates.


## Adjacent handlers and upgrade preparation — 18:26 Melbourne

**Verified locally:** 85 Deno tests pass across the existing v2 source-checkpoint and v3 source-checkpoint files, including12 new tests. Both files type-check through `deno test` and pass `deno lint`. Actual DOCX/RTF parser fixtures flow through the handler and store adapter with controlled classifier/RPC responses. The tests prove identical initial/settled/replayed public provenance, private manifest retention without public leakage, exact signal/upload/stage context, malformed policy rejection and unchanged non-fallback key sets.

The first test run had81 passes and two test-expectation failures: the new test expected503 after one lost settlement acknowledgement, but the existing store retries the exact settlement twice and correctly returned200. No production change was made. The fixture now simulates0/1/2 lost acknowledgements, enforces the same terminal receipt and returns `idempotent_replay` on retry. Zero or one lost acknowledgement returns200; losing both returns503 and the next request recovers200 with the same receipt. Repeated settlement arguments are identical; extraction, classification and checkpoint write each occur once. Source review prompted stricter signal reference and initial-response equality assertions. The final85-test log is `upload-fallback-handler-tests-green.log`; the initial expectation failure is retained separately.

The existing isolated runner and shared upgrade probe now have a separate fixed `--upload-fallback-acceptance` mode. It pins94500→102000 and the reviewed81500/94500/102000 hashes, admits all current SQL and preserves both older upgrade guards. All51 guard tests pass. No-service preflight `db-20260907082321900-7e9ac721` passed. Exact adjacent input hashes are in `upload-fallback-adjacent-inputs.json`; all six recorded inputs remained unchanged through the focused checks.

The prepared exercise retains13 originals across seven historical and six current uploads, including pending v2 DOCX/v3 RTF candidates. Before migration it records synthetic credit-exhaustion and successful fallback receipts through actual local provider-accounting RPCs, then requires the predecessor settlement rejection. Across migration it compares full upload/result/usage rows and original bytes. Afterward it submits the same frozen settlement bodies, discards their application acknowledgements, reads persistence independently, recovers exact receipts and proves unchanged attempts/tokens. This is not an injected network drop or a real model call. A reviewer found the initial usage column-name mismatch during source review; actual `provider_attempt_number`/`provider_error_code` names are now used. Final source review found no blocker; execution remains pending. No browser activation, hosted mutation, provider configuration or formatting/editing/export claim.


## Exact historical upgrade verified — 18:28 Melbourne

`job-mtqz6vln-a0483fa1`, evidence `db-20260907082525992-5e65e36e`, exited0 in about143 seconds. The reviewed94500→102000 upgrade passed. All74 migrations and all2028 SQL assertions across43 files passed on the fresh schema and again on the upgraded database. The complete `pnpm verify:web` passed:165 deployment tests,223 root tests,297 shared tests,896 web tests, lint/types, production build and progressive-loading checks. These counts remain distinct from the HTTP persistence exercise.

**Workflow exercised / Persistence proven locally:**189 HTTP checks used two real local authenticated users, PostgREST, Storage and provider-accounting RPCs. Thirteen originals were independently read byte-for-byte; seven complete historical upload rows were unchanged across migration. Pending RTF upload `2ade6f17-9a30-4fe6-8881-4cf899475191` (v3) and DOCX upload `5b1b34e8-02cd-4d7e-9e84-7c0254c32569` (v2) both encountered the expected predecessor `UPLOAD_INGEST_SOURCE_PRIVACY_INVALID` rejection. Their complete upload/provider-result/usage rows survived the migration unchanged. Each then completed using its frozen settlement, recovered the same receipt after its application acknowledgement was discarded, and replayed idempotently. Extraction source manifests, source digests, original bytes, actual execution policy and existing two-attempt/17-input/9-output-token synthetic usage records remained unchanged. No real model was invoked.

Both per-format RED/GREEN receipts, full independent SQL reads, HTTP checks and original-byte evidence are saved in that run directory. Cleanup succeeded, resources before/after matched, and completion inspection confirmed unchanged HEAD and all815 source files under the runner exclusions. No CI, hosted mutation, browser upload, formatting-preserving edit or exported artifact is proved. The remaining broad Edge rerun includes the new handler tests; the next product slice must connect source-aware import/edit eligibility to Master Workspace before enabling RTF/source-version admission.


## Broad Edge gate verified — 18:31 Melbourne

`job-mtqzd3yi-847a1fad`, evidence `upload-source-edge-gate-20260907083016772`, exited0 in44 seconds. All1168 Edge tests passed, including the12 new handler cases; all26 active entry points plus the source contract helpers type-checked and all28 selected upload files passed lint. The runner and completion inspection confirm unchanged source/HEAD and web dotenv files;887 source files matched under this runner's broader documentation-inclusive exclusions. This closes the fallback settlement slice locally. CI, browser/production and edited/exported source artifacts remain unverified.
