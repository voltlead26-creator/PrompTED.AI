# RTF private extraction integration — 7 September 2026

**Implemented; Verified locally:** explicit v3 support in the existing private
extraction client, internal handler and entry-point adapter. The combined local
upload suite passes 464 tests, extract/ingest entry-point types pass, 21 selected
files pass lint and `git diff --check` passes. Source hashes were unchanged
through these commands. The new broader web/all-Edge run is a separate gate.

**Unverified:** SQL-backed v3 claim/checkpoint recovery, ordinary RTF admission,
signed-in Master upload, CI, deployed functions, production persistence and
formatting-preserving edits/exports. No hosted or provider request occurred.
RTF retains its mandatory `source_only` editing blocker. This is an integration
dependency of the owner's upload/edit requirement, not completed product acceptance.

## Authority and exact source

The write target remains `/Users/kaichurchw/PrompTED.AI`, canonical remote
`https://github.com/voltlead26-creator/PrompTED.AI.git`, Git common directory
`.git`, branch `Thought-Enhanced-Document`, HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. This is a dirty overlay with no
staged files, branch/worktree change or new commit. The schema-2 board still
records this task's claim revision 27 and the other owner's design-document
claim; no exclusive action is claimed. Current root instructions and the
historical guidance already recorded in the main register apply. The separate
Ollama implementation remains outside this source-review verdict.

Node 22.23.2, pnpm 10.33.0 and Deno 2.9.5 were rechecked. Local synthetic tests
use no hosted project, actual Storage, service credentials or model execution.
The synthetic service-key strings identify test fixtures only.

## Call chain and compatibility

The existing private client now accepts an explicit `upload-extraction.3`
overload. Its old v1, v2 and v1|v2 overloads remain, so ingest's existing narrow
dependency type is unchanged. The original accepted version union remains v1|v2;
an additive readable union allows the private reader to prepare for v3.

The request still sends accepted owner, upload, request and claim identity; v3
explicitly adds its version and requires expected original digest/byte length
before dispatch. The handler's production-used RPC converter accepts the
existing historical response and a closed, typed 11-key v3 snapshot. Exact
request/snapshot version disagreement or an unavailable selected producer fails
before reading Storage. Missing version still means v1; explicit v1 in the
wire request, null and unknown versions remain rejected as before.

After one owned original read and digest check, the selected producer runs.
Both handler and client independently normalize the exact 12-key v3 response:
accepted identities, original SHA/length, policy `.2`, bounded text, explicit
format, truncation and private manifest. RTF requires its original-and-wording
bound manifest; DOCX uses its unchanged normalizer; other formats require literal
null. Returned RTF cannot masquerade as text or omit its blocker. Normalization
owns scalar inputs across asynchronous digest checks and rechecks cancellation.

The existing internal source-success response ceiling remains 1,114,240 bytes;
error bodies retain 64 KiB. V3 also enforces the independent 64 KiB envelope
ceiling excluding the manifest. No new retry, provider, Storage, persistence
path, table or public response field is introduced.

The real private roundtrip tests call client → handler → existing producer →
handler normalization → client normalization for RTF, DOCX and Markdown. Each
requires one transport dispatch, one original read and the selected producer.
These execute real parsing and hashing with a controlled HTTP transport and
snapshot/Storage fixtures; they do not establish Auth, database or browser proof.

## Files and purpose

- `supabase/functions/_shared/upload-extraction-contract.ts`: additive readable
  v3 version type; historical accepted union preserved.
- `supabase/functions/_shared/upload-extraction-client.ts`: explicit v3 input and
  return contracts, exact normalizer, bounded transport selection and preserved
  v1/v2 overloads.
- `supabase/functions/_shared/upload-extraction.ts`: shared v3 metadata check for
  producer and handler; RTF cannot be downgraded to another detected format.
- `supabase/functions/extract-upload/handler.ts`: production snapshot converter,
  selected v3 producer, verified response, source ownership and request lifecycle
  corrections described below.
- `supabase/functions/extract-upload/index.ts`: installs the v3 producer and uses
  the sole tested snapshot converter; existing RPC name/arguments remain.
- `supabase/functions/extract-upload/handler.test.ts`: unknown-version sentinel
  advances from newly supported `.3` to `.4`; rejection assertions are retained.
- `supabase/functions/extract-upload/handler-v3.test.ts`: six contract/roundtrip
  tests, including v3 snapshot shape, missing reader and format/digest rejection.
- `supabase/functions/extract-upload/handler-source-identity.test.ts`: thirteen
  tests for exact original ownership and cancellation across all three versions.
- `supabase/functions/extract-upload/handler-request-lifecycle.test.ts`: eight
  tests for request cancellation, deadline, limits, cleanup and legacy admission.
- `supabase/functions/_shared/upload-extraction-client-v3.test.ts`: seven tests
  covering identity/shape, malformed delivery, response budgets, cancellation,
  one-dispatch behavior and delayed manifest-digest rejection.
- `docs/evidence/web-operational-readiness/run-master-import-web-gate.mjs`: adds
  all four new test files to the broad lint gate; no check is removed or weakened.

## Reproductions and bounded adjacent repairs

`format-preservation/rtf-wire-red.log` records three intended failures before
v3 reader support: requests returned 400 instead of their selected version,
readiness or snapshot-identity behavior. The first green attempt had a TypeScript
literal-inference error, retained in `rtf-wire-first-green.log`; the exact literal
return was corrected without weakening a type or assertion.

Independent review identified an existing source-alias race. Holding original
hashing while changing the Storage adapter's byte array could pair original A's
digest with replacement B's text. The same review found cancellation fences and
hash-error classification gaps. `rtf-handler-ownership-red.log` records nine
intended failures. The handler now validates and copies only the accepted
Uint8Array view before hashing; the same owned bytes reach the parser. Shared
buffers reject. Unexpected hash errors become sanitized retryable 503 responses.

Cancellation is checked before/after Storage, after original hashing, after
parsing and before final publication. `rtf-late-rejection-red.log` records three
more failures where cancellation followed by a typed parser 422 became a terminal
file failure. Cancellation now takes precedence for v1/v2/v3. Independent
read-only final review passed this bounded repair.

`rtf-wire-shape-red.log` records two intended failures: coercible objects used as
v3 identities reached transport, and an extra v3 RPC snapshot field was accepted.
Both now fail at their boundary. `rtf-wire-shape-green.log` records the correction.
The new RTF manifest-hash cancellation test holds the digest, aborts, requires
prompt retryable cancellation and then rejects the held digest without an
unhandled rejection. No real provider or network delay is used for that case.

A second independent review identified an inherited request-reader availability
gap, rather than a newly introduced v3 defect. `rtf-request-lifecycle-red.log`
records four intended failures: stalled reads ignored cancellation, oversized
reads awaited non-settling cleanup, empty chunks allowed unbounded reader work,
and invalid declared length abandoned an unread body without cancellation.

The same local reader now owns a fixed 4096-byte buffer, allows at most 4096
chunks and enforces a five-second body deadline in addition to request abort.
Both timer and absolute clock checks apply, including streams that starve the
timer queue. Timeout/cancellation returns retryable 503; malformed, oversized
and excessive-chunk requests remain 400. Rejected reads cancel once without
awaiting the transport cleanup promise, observe late read/cancel rejection,
remove the abort listener, clear the timer and release the lock. The eight-test
green log includes an actual five-second stalled-body timeout. This is a bound
on request-body reading, not a new claim that every dependency in the complete
handler can be forcibly interrupted.

Final independent read-only review found no required correction in that reader
or its tests. All eight lifecycle tests subsequently passed in the parent's
combined 464-test run; reviewers ran no workloads. The v3 identity/normalization
review also found no new version, identity, manifest or format-validation bypass.

## Verification and next gate

`format-preservation/rtf-wire-local-verification.json` records exact commands,
timings and results. Its source-before/after maps cover tracked and nonignored
source, excluding the evidence directory and `.agents/`; they are identical.
`rtf-wire-final-adjacent.log` records **464 passed, 0 failed** across sixteen
upload/RTF/DOCX/encoding/client/handler/ingest test files. Entry-point type checks,
21-file lint and the full tracked diff whitespace check all exit 0.

The earlier completed `job-mtqbmiaq-99af46ea` broad success belongs to the RTF
foundation revision, before this private integration. It must not be relabelled
as broad acceptance of these subsequent changes. The next broad run records its
own source, web dotenv metadata/hash and result snapshots.

After that gate: add a forward v3 checkpoint migration and narrow ingest support
through the existing uploads/RPC authority; preserve old immutable receipts and
literal v1/v2 behavior; test fresh/upgrade, ownership, replay, lease expiry and
lost acknowledgement; then connect deliberate Master admission with an actual
source-only import fence. Historical failed-upload recovery and real
formatting-preserving PDF/DOCX/RTF editing/export remain required work.

**07:56 AEST completed broader gate:** `job-mtqcokq0-ecd588c6` exited 0 in
approximately 75 seconds. `upload-source-full-gate-20260906215520548` records
1,120 Edge tests, all 26 entry-point type checks, 27-file source lint and complete
`pnpm verify:web` (165 deployment, 223 root, 297 shared, 896 web tests, production
build with 29 pages and 11/3/1 progressive-bundle checks). Source, HEAD and web
dotenv metadata/hash snapshots stayed unchanged. The completion-turn comparison
also found no source drift. The broad gate for this private integration is now
**Verified locally**; the SQL/browser/hosted/edit/export gates above remain open.
