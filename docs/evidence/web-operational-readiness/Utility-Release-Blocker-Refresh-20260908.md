# Utility release boundary refresh — 8 September 2026

Read-only source review of `Supabase-Utility-Boundary-Review.md` and
`Supabase-Function-Integration-Audit.md` against the current readiness overlay in
`/Users/kaichurchw/PrompTED.AI`. The parent records branch
`Thought-Enhanced-Document`, base HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`, and owns the running verification.
No Git operation, test, service, provider request, hosted inspection or source
change was performed for this refresh. Only this report was added under the
parent's active coordination claim revision36. References below describe the
current source, not freshly observed production behavior.

## Release disposition

The utility findings remain relevant to **three active deployment entries**:
`calculate-deadline`, `government-evidence` and `transport-victoria`.
`supabase/deployment-contract.json:779` and `supabase/config.toml:89` declare
them active/enabled with gateway JWT verification. All three have
`clientRoute:null`. A targeted source search found no current web/shared caller
or internal caller other than their own handler/client chain. Do not invent a
browser integration or classify these as dormant to close the findings.

The findings below block operational acceptance of those enabled utilities.
They are not a demonstrated cause of Master upload, Profile or workspace-load
failure. A narrowly reviewed recovery release and acceptance of every active
function are different scopes; the existing full deployment contract contains
no utility exemption that this review can grant. No new exploit, credential
disclosure or production calculation error was exercised here.

## Remaining source-confirmed failures

### U1 — Deadline bypasses application account and egress admission

`calculate-deadline/index.ts:51` handles CORS and POST, then calls `req.json()`
at68 and `calculateBusinessDeadline` at69. It never establishes a confirmed
account, calls the rate limiter, applies the shared bounded JSON guard or
participates in the account-deletion external-egress fence. Its contract
explicitly declares `usesSharedRequestGuard:false` and no RPC dependencies.
Gateway JWT validation does not execute the application's confirmed-user policy.
The shared implementation of that policy is at
`_shared/auth-guard.ts:605`–646; rate admission follows at676. The existing
external-egress commands are in migration
`20260901091000_ingest_upload_exact_replay.sql:1088` and1165.

The same endpoint silently turns supplied nonstring `countryCode` into `AU`
and nonstring `subdivisionCode` into omission (`index.ts:35`). This is distinct
from legitimate omitted-field defaults. Every thrown error, including upstream
failure, is returned as HTTP400 with the caught message (`index.ts:84`). The
function therefore cannot truthfully distinguish invalid input, unavailable
holiday data and cancellation.

Smallest coherent repair: expose the unchanged production handler through a
testable dependency seam, then use the existing confirmed-account/body/rate
guard with `enforceCap:false`. Validate optional supplied jurisdiction fields
strictly. Bind each actual holiday request to the existing owner/request/route
egress record; preserve its token-bound acknowledgement and deletion ordering.
Declare the resulting existing RPC/migration dependencies. Do not add another
egress store or document allowance. Separate safe input/dependency/cancellation
responses and avoid returning arbitrary caught messages.

Required intended-failure tests: actual handler with missing/anonymous,
unconfirmed, expired and deletion-fenced identities; rejected rate admission;
oversized/chunked body; supplied numeric/null jurisdiction; upstream HTTP500,
invalid JSON and timeout. Every pre-admission rejection must assert zero
holiday dispatches. Include valid omitted defaults, a capped confirmed user,
same-token lost acknowledgements, completed replay and deletion racing a held
claim. Existing date tests are not a substitute for this endpoint test.

### U2 — Invalid external values can become successful source-labelled output

| Endpoint and live path | Exact current acceptance contradiction | Minimum repair and meaningful regression |
| --- | --- | --- |
| Deadline → `_shared/public-holidays.ts:92` | `fetchPublicHolidays` checks only `Array.isArray` before casting at124. `filterHolidaysForSubdivision:49` treats any truthy `nationalHoliday` as national. Invalid dates, country/year mismatches and malformed subdivision values are not rejected at the boundary. | Accept unknown JSON only after bounded record validation: actual date in the requested year, matching requested country, real booleans and correctly typed optional arrays. Feed a controlled HTTP response with `nationalHoliday:"false"` and an otherwise valid nonmatching subdivision: it must reject before calculation, rather than exclude an extra working day. Also test invalid calendar dates, wrong country/year, null entries and a legitimate empty list. |
| Government → `_shared/ckan-client.ts:115` → `government-evidence/handler.ts:463` | `normaliseCkanDatasets` accepts truthy nonboolean `success` and invents `unknown` identity. JSON `{ "success":"false", "result":{"results":[{}]} }` reaches a fabricated dataset summary under the government source label. `boundedText` coerces nonstrings with `String`, rather than establishing scalar types. | Require `success === true`, a valid result envelope and a genuine dataset identity; distinguish optional missing metadata from wrong supplied types. Test that exact malformed response through the real client and handler. Expect the known invalid response to settle the actual exchange, return explicit unavailable status and publish no dataset. Valid empty collections and valid optional metadata must remain supported. |
| Transport → `_shared/ptv-client.ts:95` → `transport-victoria/handler.ts:755` | `PtvClient.get` returns arbitrary JSON `as T` at120. HTTP200 body `null`, `17` or an error-shaped object therefore reaches `data` in the handler's source-labelled HTTP200 response after completion at789. | Validate the response selected by the admitted action before publication. Current actions are route-types, search, nearby, departures and disruptions (`handler.ts:457`). A real client with controlled HTTP200 `null` must fail before the handler returns data success; assert terminal known exchange settlement and no uncertainty invented from a parsed invalid response. Add each action's valid empty and nonempty responses after primary provider-schema review. |

These examples are **source-derived regression inputs, not newly executed
reproductions**. No provider specification was fetched during this source-only
task. PTV's action schemas and the holiday provider's precise optional-field
semantics must be reviewed before implementation; a guessed closed schema is
not a repair. CKAN's legitimate empty results must not be confused with an empty
dataset object lacking identity.

### U3 — Response size, redirect and work boundaries are missing

All three clients call `response.json()` without a body-byte/media-type/UTF-8
or structure-work limit and use Fetch's default redirect policy:
`public-holidays.ts:106`–124, `ckan-client.ts:177`–197 and
`ptv-client.ts:110`–120. A byte limit cannot be supplied by slicing parsed
results afterward. CKAN additionally maps the entire resource collection before
slicing to10 (`ckan-client.ts:142`), so its output limit does not bound parsing
or iteration. Redirect following can leave the host represented by the accepted
egress identity; this is not evidence that a redirect or secret leak occurred.

Reuse the existing bounded-reader/cancellation patterns already exercised by
`_shared/upload-extraction-client.ts:174` and214, without importing its private
upload wire semantics. Reject redirects, validate the accepted media type, bound
bytes and chunk work before JSON parsing, reject invalid UTF-8, and validate
bounded structures/collections before mapping. Cancel/release unread bodies
without waiting forever on a hostile underlying cleanup promise. Preserve
explicit finite provider deadlines and add an absolute deadline fence before
publication. The current holiday loop already has day/year/fetch-year bounds;
do not report it as unbounded fan-out or remove those limits.

Required tests: declared and streamed exact byte limit/one-over; excessive empty
chunks; wrong MIME; invalid UTF-8; oversized datasets/resources; stalled body and
cleanup; HTTP302/307 and a custom transport returning a redirected response.
Assert no redirected dispatch, no success payload, truthful known/uncertain
exchange settlement and no secret-bearing request URL in errors or logs.

### U4 — Cancellation during accepted admission can still dispatch

Government dependencies at `government-evidence/handler.ts:49` and transport
client `get` at `_shared/ptv-client.ts:95` accept no caller signal. Both handlers
await the external-egress claim then immediately dispatch, at government463–471
and transport755–759. The Request signal is not checked there. The clients'
own8-second/10-second abort signals do not represent the caller's cancellation.

Regression: hold a valid token-bound claim response, abort the original
Request, then resolve that claim as accepted. Current code continues into
`searchCatalogue`/`ptv.get`. The repaired path must make zero upstream calls,
settle the known non-dispatch outcome using the existing record, and return an
explicit cancellation. Add pre-aborted request, cancellation while signing or
reading, after a received response and after completion acknowledgement. Once
dispatch may have occurred, keep uncertainty/reconciliation and do not create a
new token or blind retry. Settlement must outlive transport cancellation where
needed to preserve durable truth.

For government paired requests, retain `Promise.allSettled` at604. It already
waits for both bounded settlements before returning the aggregate, so the earlier
review's generic paired-request warning is **superseded**. A held sibling should
be a positive regression, not a reason to replace this code. Add abort fences
before accepted dispatch and before publication without bypassing settlement.

## Findings in the old audit that must not be reported as current defects

- **Profile permission repair:** `Profile-Permission-Release.md:3`–25 records
  production application on8September at18:48:07 AEST, six authenticated column
  grants, unchanged RLS/private denial and a signed-in Profile load. The old
  integration audit's statements that grant authority/application are pending
  are superseded. This review did not independently requery production.
- **Upload/Profile local browser proof:**
  `Upload-Browser-Acceptance-Preparation.md`, completed execution, and
  `Profile-Browser-Recovery-Verification.md` supersede the original
  “no authenticated browser journey” limit. They record real local
  Auth/PostgREST/Storage, picker/reload/original-download/replay and basic Profile
  persistence/owner-isolation proof with controlled model HTTP. They do not prove
  live model quality or production deployment of the current backend.
- **Research/live-source/report:** current registered entrypoints are deliberate
  authenticated gates. `research/index.ts:14`, `live-source/index.ts:12` and
  `generate-report/index.ts:62` delegate to gates before downstream content,
  reservation or model work. Report's retained implementation is not registered
  and its activation function is hard false. These are explicit unsupported
  capabilities, not active unaudited provider dispatches. Preserve the gates;
  installing a function does not make the workflow complete.
- **Historical raw endpoints:** openai-chat/responses/stream are locally dormant
  and not browser-routable. Historical hosted presence of those or undeclared
  endpoints needs a fresh inventory and approved reconciliation, not a claim
  that current app code calls them. No endpoint removal or reclassification was
  performed.
- **Hosted missing functions/configuration:** the6September counts, versions,
  secret-name and capacity findings are dated. The newer
  `Production-Release-Prerequisites-20260908.md` records another hosted snapshot
  and concrete remaining inputs. Neither snapshot was refreshed in this task;
  use the release owner's exact latest attested baseline before mutation.

## Smallest next implementation order

1. One deadline admission vertical: seam-only extraction and actual-handler RED,
   then existing guard/egress integration plus strict holiday admission and safe
   failure classification. Keep valid date/day/year behavior protected.
2. One CKAN response vertical: exact malformed-success RED, bounded validated
   client response, then handler cancellation/settlement regressions.
3. One PTV response vertical: reviewed action schemas with positive controls,
   real-client malformed-response RED, bounded validated response and caller
   cancellation through signing/dispatch/settlement.

Each slice needs the focused tests above, adjacent auth/egress/deletion tests,
types/lint, the broad Edge/web/deployment checks and source equality under the
parent's finite runner. No utility workflow can be claimed exercised until its
actual endpoint and intended supported consumer are tested. No new UI route is
required to repair these endpoint boundaries.

**Implemented:** report only. **Verified locally:** current source and test-seam
inspection; no new regression execution. **Verified in CI:** unverified for this
refresh. **Workflow exercised / Production exercised / Persistence proven /
Export inspected:** none newly performed. **Blocked:** operational acceptance of
the three active utilities on U1–U4. **Unverified:** exploitability, live upstream
schema/response behavior and current hosted deployment/configuration.

## Verified implementation update — 9 September 2026 AEST

This appended update supersedes the earlier **unfixed** descriptions of U1 and
the holiday/CKAN portions of U2–U3. The earlier section is the dated source
review that established the work, not the current disposition of those repaired
paths. The parent owns the implementation overlay and all execution under its
expanded coordination claim revision37. The report author inspected the saved
logs and current source; no additional tests, services or provider requests were
run to prepare this update. There is no new commit or production deployment
claim here.

### Implementation and attributable regressions

| Boundary | Intended failing execution | Verified focused execution |
| --- | --- | --- |
| CKAN response admission and bounded external JSON transport | [Initial CKAN RED](utility-ckan-red-20260908.log): 8 passed, 24 failed. The additional exact resource-identity regression [RED](utility-ckan-resource-red-20260908.log) recorded 32 passed, 3 failed for Unicode, overlength and control-character identities. | [CKAN/resource GREEN](utility-ckan-resource-green-20260908.log): 63 passed, 0 failed: 35 CKAN, 17 reader and 11 government-handler cases. |
| Holiday response, input, cancellation and failure certainty | [Holiday behavioral RED](utility-holidays-red-2-20260908.log): 10 passed, 34 failed across 44 cases. The earlier `utility-holidays-red-20260908.log` stopped at four fixture type errors and provides no runtime defect proof. | [Holiday GREEN](utility-holidays-green-20260908.log): 63 passed, 0 failed: 46 holiday cases, including two added controls, and 17 reader cases. |
| Actual deadline handler account/body/rate/egress admission | [Handler RED](deadline-handler-red-20260908.log): 3 passed, 29 failed. [Expanded handler RED](deadline-handler-expanded-red-20260908.log): 3 passed, 33 failed after four additional multi-year cases. The extraction of `handler.ts` from `index.ts` was behavior-preserving fixture enablement before these failures. | [Combined GREEN](deadline-holidays-green-20260908.log): **102 passed, 0 failed**: 39 actual-handler, 46 holiday and 17 reader cases. The final three handler controls were added after the expanded RED and are not represented as separately observed failures. |

The relevant implementation is in `_shared/bounded-external-json.ts`,
`_shared/ckan-client.ts`, `_shared/public-holidays.ts` and
`calculate-deadline/handler.ts`, with the production `calculate-deadline/index.ts`
delegating to the tested handler. CKAN now requires genuine success/envelope and
dataset/resource identities instead of coercing or inventing them. Both CKAN
and holiday HTTP responses use the same bounded reader: an accepted JSON media
type, fatal UTF-8/scalar validation, finite byte/collection/depth/chunk work,
redirect rejection, bounded cancellation and nonblocking abandoned-body cleanup.
The client limits are 1 MiB and 8 seconds per external exchange; this is not a
total endpoint deadline.

Holiday rows are validated against the accepted country and year, a genuine
calendar date, literal name, strict national-holiday boolean, nullable subdivision
array and reviewed six-value holiday-type enumeration. The provider contract was
reviewed against the [Nager holiday model](https://nagerholidays.com/api); CKAN's
envelopes were reviewed against its [official action API](https://docs.ckan.org/en/2.11/api/).
Supplied invalid jurisdiction values are rejected. Omitted country still
defaults to AU, and normalized valid same-country subdivisions remain supported.
The accepted provider origin and existing weekend/holiday-category calculation
policy were not changed.

The deadline handler now uses the real shared confirmed-account, bounded-body
and rate guard with `enforceCap:false`; it neither reserves document allowance
nor consumes a document-created event. It hashes the exact accepted country/year
GET URL and guard-derived logical request identity, and admits it through the
existing owner-scoped external-egress commands. Only an exact accepted or
token-matched replay receipt permits that year's provider dispatch. Lost claim
or settlement acknowledgements retry the identical command at most twice;
completed/processing/reconciliation receipts never cause blind provider replay.
The deployment contract now declares `usesSharedRequestGuard:true`, the existing
`20260901091000_ingest_upload_exact_replay` migration and both
`claim_user_external_egress` and `complete_user_external_egress` dependencies.
No schema, provider origin, document cap or UI route was added by this slice.

### What the controlled workflow proves

The 39 handler cases invoke the actual handler, shared guard, Supabase client,
holiday client and calculator with controlled Auth/PostgREST/provider HTTP
responses. They prove confirmed-owner admission and call ordering, strict body
failure before provider dispatch, private/no-store responses, rejected rate and
deletion admission, same-token lost-acknowledgement retries, exact body-only
compatibility identity and no repeat provider call for a completed lookup.
They also prove cancellation after an accepted claim makes zero provider calls
and still acknowledges the known non-dispatch outcome.

Each year is acknowledged before its holiday data is exposed to the calculator.
Multi-year tests prove distinct accepted resource hashes/tokens, deletion on an
expanded year preserving the completed sibling, a known malformed response and
an uncertain sibling retaining their distinct terminal states, and abort after
one completion acknowledgement preventing the next year's dispatch. Calendar
exhaustion at year 2201 and at the existing 20-year limit leaves all previously
completed receipts completed. There is no synthetic calculation-level unknown
receipt. Missing or uncertain acknowledgement takes precedence over ordinary
cancellation or a known sibling failure; success is withheld until the exact
terminal acknowledgement is validated.

These are **controlled HTTP workflow assertions**, not a real utility-provider
request, hosted function exercise or independent database persistence proof.
The receipt fixture models existing RPC responses; it does not replace the
database acceptance suite. A targeted current-source search still found no
active web/shared caller of `calculate-deadline`; all three utility deployment
entries retain `clientRoute:null`. No browser utility journey or new route was
activated or claimed.

### Remaining limits and next boundary

- **Overall guard/RPC deadline remains unverified and unbounded in source.**
  Shared Auth verification, rate admission, plan reads and the two egress RPC
  acknowledgement loops do not yet have a handler-owned elapsed-time bound.
  A finite two-attempt count is not a finite wait. The external 8-second reader
  limit does not cover those awaits. Caller cancellation must not disable a
  necessary terminal settlement after a known or uncertain provider exchange.
- **Calendar policy remains deliberately unchanged.** Saturday/Sunday weekend
  treatment and the existing treatment of all admitted holiday categories are
  not proof of worldwide working-day correctness. Country availability,
  jurisdiction-specific weekends, legal deadline rules and live Nager endpoint
  availability were not exercised. The original `date.nager.at` origin remains;
  documentation at another host does not authorize a silent egress-origin move.
  The existing 60-request/minute default and at most 20 years per calculation
  are unchanged; no per-year rate policy was introduced.
- **Government cancellation U4 remains open.** The CKAN boundary is repaired,
  but `government-evidence/handler.ts` still needs caller cancellation propagated
  through accepted dispatch and publication, preserving its existing joined
  sibling settlement and exact acknowledgement semantics.
- **PTV U2–U4 remain open.** Its action-specific response admission, response
  bounds/redirect handling and caller cancellation still need a separately
  reproduced repair against reviewed official action schemas. Existing local
  deadline/CKAN success does not validate transport responses.
- **Further evidence remains separate.** The combined Deno test run passed
  type checking for its dependency graph. A fresh broader source-stable gate,
  separate lint, CI, production function deployment, real utility persistence
  and live upstream behavior must be reported from their own evidence. The
  parent started the composed DB/web gate after this slice was frozen; this
  update does not anticipate that result. A direct combined caller-abort plus
  missing-completion-ACK regression remains a useful next control, although the
  current error-priority source and separate abort/ACK cases were reviewed.

**Implemented:** bounded CKAN/holiday admission and the deadline account/egress
vertical in the dirty overlay. **Verified locally:** the exact focused results
above and current-source contract inspection. **Verified in CI:** unverified for
this revision. **Workflow exercised:** actual deadline-handler control flow with
controlled HTTP, including failure, cancellation and exact-command replay.
**Production exercised:** none newly performed. **Persistence proven:** not by
these mocked RPC receipts. **Export inspected:** not applicable to this slice.
**Blocked:** full acceptance of the active utility set by the remaining PTV,
government-cancellation and overall guard/RPC boundaries above. **Unverified:**
current hosted utility behavior, global calendar correctness and the new
revision's broader release gates until separately inspected.

### Subsequently inspected broader local gates

The saved composed run
[db-20260908143641420-e9870b03](db-20260908143641420-e9870b03/summary.json)
completed with `passed:true`. Its
[fresh SQL](db-20260908143641420-e9870b03/fresh-tests.log) and
[composed-upgrade SQL](db-20260908143641420-e9870b03/catalogue-composed-upgraded-tests.log)
each report **47 files, 2,365 assertions, PASS**. Its
[web gate](db-20260908143641420-e9870b03/web-gate.log) reports **165 deployment
tests, 223 root tests, 382 shared tests and 1,035 web tests**, all passing,
followed by successful `verify:web`, including types, lint, production build
and progressive bundle checks. This composed run has both workspace-browser
flags false; it does not represent a newly repeated upload/Profile browser
journey. Its deliberate catalogue-conflict SQL command has expected SQLSTATE
23505 and exit 3, so this report does not falsely describe every underlying
command as exiting zero.

The subsequent
[Edge run](upload-source-edge-gate-20260908144147075/summary.json) reports
**1,436 tests and 184 steps, 0 failures** in its
[test log](upload-source-edge-gate-20260908144147075/edge-tests.log), successful
28-target type checking and the runner's existing 28-file source-lint set. That
lint set concerns the upload/source files listed in the manifest; it is not a
new explicit lint execution over every utility file. The summary explicitly
records unchanged source, HEAD and web dotenv inputs around that run.

These results supersede the earlier "broader gate pending" timing statement
for those exact saved inputs. They are local repository/SQL compatibility
evidence, not utility-provider execution, utility-specific durable egress
persistence proof, CI or production release. The outstanding utility limitations
above remain, and later checkpoint-receipt work requires its own tests and
source-stable verification.
