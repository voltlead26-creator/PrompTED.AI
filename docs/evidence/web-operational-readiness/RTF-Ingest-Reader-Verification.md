# V3 ingest reader verification — 7 September 2026

**Implemented; Verified locally:** the existing ingest handler can read an
accepted v3 claim, validate and retain its exact extraction, and resume through
the existing checkpoint/lease commands. The adjacent suite passes **122 tests**,
including 29 new v3 ingest tests and all 40 earlier checkpoint tests. Deno type
checking within the tests, three-file lint, new-test formatting and the full
tracked diff whitespace check pass. The subsequent broad run passed all 1,149
Edge tests, all 26 entry-point type checks and 28-file source lint. Its web build
was blocked by a separately changed local dotenv layout; that layout is now
repaired and fresh complete web verification passed, as recorded below.

**Unverified:** ordinary v3 browser admission, signed-in Master upload,
format-preserving editing/export, CI and production behavior. New claims still
use the same eight RPC arguments and the database's default v1 contract. This
reader change does not activate RTF uploads. RTF retains its mandatory source-only
editing blocker. No SQL, hosted function, provider configuration or public
response field changed in this slice.

## Revision, ownership and boundaries

The selected write target is `/Users/kaichurchw/PrompTED.AI`, branch
`Thought-Enhanced-Document`, HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`, remote
`https://github.com/voltlead26-creator/PrompTED.AI.git`. This is the existing dirty
overlay, with no staged files or new commit. The sole worktree, current root
instructions, Node 22.23.2, pnpm 10.33.0 and Deno 2.9.5 were refreshed. The
schema-2 board has this task's revision-27 claim and the separate owner-access
design claim; no collision or exclusive action was present. Historical guidance
and protected authorization remain as recorded in the main register.

The pre-reader handler was reconstructed from the prior broad gate's exact Git
patch and checked against the original RED hash:
`63eb2ba88c04c18f526993d9b5cb4ee0e4fdd595ca5b2287d93afafa6fa8ce35`.
`rtf-ingest-v3-before.ts.txt` retains that evidence; `rtf-ingest-v3-reader.patch`
isolates this slice from the surrounding dirty overlay. Existing Ollama
execution validation and provenance projections are unchanged.

## Trace and implementation

1. `createUploadIngestStore().claim()` reads the actual accepted `.3` version;
   absent version still means `.1`. Unknown versions fail before extraction.
2. Ingest uses the existing additive readable-version/input/result types. The
   frozen shared v1/v2 aliases remain intact.
3. The existing checkpoint reader requires the exact eleven-key v3 RPC shape,
   reuses the existing v3 wire normalizer, binds original SHA/length, policy `.2`,
   text SHA and the appropriate RTF/DOCX manifest. Other formats require a null
   source triplet. The database manifest digest remains opaque and must have the
   existing digest-domain marker; JavaScript does not recreate a JSONB digest.
4. Fresh results capture primitive fields before asynchronous normalization.
   The accepted extraction version flows into the same twelve-argument record
   command. The historical v1 command still has ten arguments.
5. Validated v3 wording is retained literally. Historical v1/v2 cleanup is
   preserved. RTF's preview digest cannot be invalidated by later trimming.
6. Both successful and uncertain record acknowledgements require authoritative
   readback. Unavailable or missing reads remain retryable; an internally valid
   but different result requires reconciliation. No in-memory result alone can
   dispatch classification.
7. Provider-stage resumes repeat the existing lease/checkpoint transition.
   Cancellation and superseded claims fence classification and settlement.
   Terminal receipts replay without another extraction or classification.

Files changed in this slice:

- `supabase/functions/ingest-upload/handler.ts`: the reader integration above.
- `supabase/functions/ingest-upload/source-checkpoint-v3.test.ts`: new v3
  adapter/recovery/privacy regressions.
- `supabase/functions/ingest-upload/exact-replay.test.ts`: explicitly rejects
  source-version results in its historical-v1-only memory fixture. Its claims
  still use v1; this narrows the fixture honestly instead of pretending it
  implements source manifest/database digest semantics. Existing cases and the
  foreign fallback test are unchanged and pass.
- `docs/evidence/web-operational-readiness/run-master-import-web-gate.mjs`:
  includes the new v3 test in the existing source-lint gate.
- This report and the main implementation register: evidence and activation
  limitations.

## Reproduction and test quality

`rtf-ingest-v3-red.log` and `.json` retain the original **2 passed, 16 failed**
run. The production adapter rejected stored `.3` claims as
`UPLOAD_CLAIM_FAILED`; tests intended to exercise later checkpoint validation
instead received that premature failure. This is the intended reader defect.
The prior setup-only TypeScript error (`supabaseUrl` instead of `baseUrl`) was
corrected before the recorded RED and is not a behavioral reproduction.

Two original fixtures were corrected after the reader implementation: the fake
private-client runtime now uses an allowlisted loopback URL with injected fetch
(no network), and the exact-whitespace case uses `readRtfText` with its matching
wording digest. The ordinary producer deliberately cleans its preview *before*
binding that digest; it is not evidence of post-validation trimming. The
literal-preview fixture tests a valid independently decoded source envelope.

The new fixture mirrors terminal checkpoint scrubbing and idempotent transition
receipts. It captures classifier requests as well as public bodies and settlement
arguments, checking that manifests, original/text hashes, database digest and the
editing-blocker marker do not leak. Other added cases exercise lost and normal
ACKs followed by missing/unavailable reads, later same-checkpoint recovery,
internally valid conflicting RTF readback, provider-stage resume/takeover,
cancellation before and during normalization, and mutable candidate wording
while hashing is pending. The takeover fixture asserts the existing adapter's
bounded two attempts with the same command, not a new retry policy.

The first adjacent run stopped at a real test type incompatibility: the v1-only
memory store could not accept newly widened RTF results. The explicit fixture
guard resolves that mismatch without a cast, disabled check or broadened store.
Lint also caught an async mock without an await; it now returns a real Promise
from its controlled RPC dispatcher. The failed logs remain under
`rtf-ingest-v3-{adjacent,lint,format,diff}.log` and `rtf-ingest-v3-local.json`.

Two independent read-only reviews found no new production defect in this slice.
Their fixture/recovery/privacy recommendations were incorporated and tested by
the parent. Reviewers ran no processes or services.

## Local verification and limits

`rtf-ingest-v3-green-20260907T023215.json` records exact commands, exit statuses
and identical before/after hashes for the four changed code/test/runner files.
Associated logs retain complete results:

```text
deno test --allow-env --allow-read supabase/functions/ingest-upload \
  supabase/functions/_shared/upload-extraction-client-v3.test.ts \
  supabase/functions/extract-upload/handler-v3.test.ts
122 passed, 0 failed; test type checking passed

deno lint <handler, v3 test, exact-replay test>
3 files passed
deno fmt --check supabase/functions/ingest-upload/source-checkpoint-v3.test.ts
passed
git diff --check
passed
```

These fixtures exercise real bounded RTF/DOCX/Markdown producers, the real private
client validator, ingest handler and RPC adapter over controlled transport/RPC
responses. They begin at resumed `storage_completed`; they do not upload an
original over Storage, execute SQL, call a live Edge endpoint or invoke a model.
The separate completed `job-mtqkgbbt-5d952092` establishes fresh/upgrade SQL and
163 real local Auth/PostgREST/Storage checks, with preserved original bytes; its
controlled extraction/classification does not turn these tests into browser proof.

## Required next integration

- The empty-MIME JSON / existing `rtf` metadata compatibility defect is now
  repaired locally without rewriting identities. The alias follow-up passed
  146 adjacent JavaScript tests, fresh and exact-upgrade SQL (1902 assertions
  each), 183 local HTTP checks and the full web gate. See
  [RTF-Mime-Alias-Verification.md](RTF-Mime-Alias-Verification.md). Browser
  admission and terminal-failure recovery remain separate unfinished work.
- Resolve the existing v2/v3 settlement conflict for successful Ollama
  classification: `credit_fallback` is projected by ingest but excluded from the
  closed SQL completed-envelope keys. Preserve actual provider provenance and
  bind any extension to the existing durable model result/usage records. A
  configured fallback is not proof of execution. This requires a separate
  additive command repair and realistic SQL regression, not removal of metadata.
- Connect reviewed admission and source preservation to the existing Master
  import/revision/export authority; exercise authenticated browser upload,
  recovery, editing and real artifacts. Retaining originals is only part of the
  user's formatting-preservation requirement.

## Broad gate completion and local configuration recovery

`job-mtqoa9ec-cb82e472` exited 1 after approximately 65 seconds. Evidence is
`upload-source-full-gate-20260907032008091`. All 1,149 Edge tests, 26 function
entry-point types and 28-file source lint passed. Web deployment/static/lint/type
checks and 165 deployment, 223 root, 297 shared and 896 web tests passed. The real
build environment guard rejected prohibited credential names and a retired
deployment identifier in `apps/web/.env.local`; Next.js compilation and bundle
checks were not reached. This is a local configuration failure, not a
demonstrated Next.js compiler or ingest test failure.

Source, HEAD and web dotenv hashes were unchanged *during* that run, and the
completion comparison found no source drift. The unsafe dotenv hash differed
from the previously passing gate; its filesystem modification time was
2026-09-07T03:18:14Z, before the failed run. The actor is unconfirmed. No credential
exposure is inferred from this evidence.

WP0 explicitly authorizes correcting the actual local layout with values
preserved. Names/consumer review and private comparisons established that every
original value was already retained in `.env.tools.local`, with one anon key
stored under an older alias. The aliases match. The selected anon JWT binds the
same deployment-contract project; the alternate opaque publishable key remains
operator material. The supplied public Web Billing key passed format and
whitespace checks. No key was inferred from a similarly named private secret.

The reviewed one-time `repair-web-dotenv-layout-20260907.mjs` pins both inspected
file hashes, exact assignment names, project/origin and duplicate checks, verifies
ignored private destinations, prepares the candidate and rechecks for concurrent
edits. It restored five canonical public settings in `apps/web/.env.local`,
preserving the production data-environment designation already documented in
`docs/ENVIRONMENT_CONFIGURATION.md`. The exact prior web bytes are retained at
`.env.tools.local.web-layout-20260907T0320`. All three files remain ignored and
0600; the tools file is byte-for-byte unchanged. No provider file, hosted store,
secret, budget or app source changed. Output contains names, booleans and file
hashes only. The coordination claim is now revision 28 for these exact local
paths; existing web-library paths were consolidated to fit the board's path limit.

`web-dotenv-layout-repair-20260907-apply.{log,json}` records the successful apply.
`web-dotenv-layout-repair-20260907-verification.json` records private-file
metadata and **14/14 existing environment-guard tests passing**. The real guard
passes against the repaired files. The final public file SHA is
`0f842efbed22fdd20b34c20246c0bb20f4f019035603a49d9cd6c0acce02140c`.
The failed gate remains failed. A fresh web gate is required; repeating the
unchanged, passing Edge suite is not needed for a dotenv-only repair.

**13:35 AEST fresh web gate passed:** `job-mtqotlvd-f7d48756` exited 0 after
approximately 37 seconds. `master-web-gate-20260907033510725` records complete
`pnpm verify:web`: 165 deployment, 223 root, 297 shared and 896 web tests,
lint/types, the real environment guard, 29-page production build and 11/3/1
progressive-bundle checks. Source, HEAD and dotenv hashes stayed unchanged;
the completion comparison found no source drift. Together with the unchanged
1,149-test Edge result, this closes local broad verification for the ingest
reader slice. Browser, CI, production, editing and export gates remain open.

The subsequent alias trace narrows the earlier activation-risk wording: the
current browser dispatcher and actual multipart serialization use
`application/octet-stream` for empty `File.type`. Literal stored `rtf` arises
from a historical empty-MIME JSON request or already accepted metadata. It is
not evidence that the current ordinary multipart transport produces that alias.
The separate alias regression now distinguishes these paths; v3 browser
admission itself remains inactive for other reasons recorded in this report.


Fallback settlement follow-up,18:28 Melbourne: the separate source/privacy/provenance mismatch is now repaired and verified through fresh+exact historical-upgrade SQL (2028 assertions each),85 adjacent DOCX/RTF handler tests and189 local HTTP checks. See `Upload-Fallback-Settlement-Verification.md`. Full Edge rerun pending; this does not activate new v3 claims or establish Master Workspace formatting-preserving editing.
