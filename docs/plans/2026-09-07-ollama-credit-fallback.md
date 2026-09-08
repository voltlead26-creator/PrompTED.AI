# OpenAI credit exhaustion to Ollama fallback

User request: automatically use local Ollama when OpenAI has no credit. This
explicitly updates the earlier OpenAI-only policy for this fallback. No cloud
deployment, API key creation, public exposure of the Mac, or billing change is
authorized by this local implementation task.

## Inspected target and first findings

- Repository: voltlead26-creator/PrompTED.AI.
- Branch: Thought-Enhanced-Document; HEAD e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b.
- Requested reliably-prompTED ref is absent; the current root AGENTS.md applies.
- Node 22.23.2, pnpm 10.33.0, Deno 2.9.5.
- Active upload/readiness work owns broad shared paths. Existing provider-router
  and its test file were clean before this task; changes here avoid that task's
  dirty extraction, document, and persistence hunks.
- Ollama 0.33.2 responds on 127.0.0.1:11434. Local inference needs no API key.
- No hosted Ollama endpoint was supplied. Local Mac integration is the initial
  environment; deployment requires a backend-reachable, authenticated endpoint.
- The adapter currently discards OpenAI error bodies, so credit exhaustion is
  indistinguishable from a temporary 429 and is retried against OpenAI.
- The usage ledger, captured attempts, accepted routes, and release attestations
  contain OpenAI-only checks. Merely redirecting HTTP would mislabel results.
- Capacity admission precedes inference; missing capacity configuration must
  remain an explicit blocker rather than being mistaken for exhausted credit.

## Acceptance requirements

1. Trigger only on explicit OpenAI credit_balance_exhausted or insufficient_quota
   responses with an appropriate status. Never trigger on invalid credentials,
   transient RPM/TPM limits, malformed bodies, timeouts, or ambiguous outcomes.
2. Use the installed local gpt-oss:20b candidate only after real structured-output
   verification. Do not invent a free cloud key or use a cloud-tagged model.
3. Preserve exact user, request, operation, revision, cancellation, and replay
   identities. Failed persistence must block completion, including fallback.
4. Persist actual provider, model, token counts, and fallback reason. Retain the
   primary OpenAI rejection and distinguish accepted policy from execution.
5. Keep earlier OpenAI records replayable. Do not rewrite historical provenance.
6. Bound fallback requests and concurrency. Do not forward OpenAI credentials
   to Ollama; validate the server-configured destination and disallow redirects.
7. Reject unsupported research/tools explicitly; never silently claim equivalent
   web research from a local model with no research tools.
8. Show fallback provenance and unavailable-server failures in the applicable
   user workflow. Ordinary successful OpenAI calls remain unchanged.

## Work sequence and status

- [x] Inspect routes, runtime, ownership, database contracts, and local server.
- [x] Reproduce credit misclassification with a failing adapter regression:
  current code dispatched twice and returned OPENAI_UPSTREAM_ERROR.
- [x] Add bounded error-body classification and terminal credit error handling;
  the regression now passes with one dispatch. Two parser tests also pass.
- [x] Run the full provider regression suite and local Ollama schema preflight:
  44 tests passed; local gpt-oss:20b produced the expected heading structure in
  9.485 seconds (174 input, 78 output tokens). This is one synthetic capability
  case, not a production quality evaluation.
- [x] Implement the isolated Ollama transport with pinned model identity,
  bounded context/output/deadline, schema validation, explicit provenance,
  cancellation and ambiguity handling. Nine focused tests pass.
- [x] Exercise that actual transport against local Ollama within the existing
  30-second fast-route budget: 9.838 seconds, 161 input and 92 output tokens;
  expected headings and schema preserved in one synthetic case.
- [x] Extend the existing provider/attempt contracts and audited persistence
  functions with a backward-compatible fallback execution representation.
- [x] Implement automatic bounded fallback with exact error trigger, admission,
  cancellation, durability, replay, and actual-provider output.
- [x] Wire server-only local configuration and applicable UI provenance.
- [ ] Validate database upgrade/replay, focused integration, types/lint, full
  suites/build, and actual upload workflow with injected OpenAI exhaustion.
- [x] Review the fallback diff, document activation constraints, report exact evidence.

Automatic fallback is implemented and the local server dotenv is configured.
Hosted activation and complete browser workflow acceptance remain outstanding. Existing provider-router test lint has pre-existing
inline-import and require-await findings; new implementation lint is checked
separately. No lint rules are weakened.

## Persistence design to implement next

The accepted route remains the original OpenAI intent, with an optional frozen
credit-fallback policy specifying Ollama model, digest and configuration
version. Actual provider/model identity belongs on each executed attempt and
its usage record; the OpenAI rejection and Ollama attempt remain separate.
Earlier operations without fallback in their accepted policy remain unchanged.

Extend the existing legacy checkpoint/attempt RPCs through explicitly versioned
entry points so old signatures and checkpoints retain their behavior. Permit
one fallback admission only after the exact same user/request/stage/hash has a
known, zero-token OpenAI credit rejection. Return the prior credit state from
checkpoint reads so a process restart does not dispatch OpenAI again or reset
the attempt budget. Persist actual provider and model and reconstruct them on
replay. Do not use process-global credit caches or a second result store.

Captured preparation must choose and persist the execution from the immutable
accepted fallback policy plus the preceding exact credit rejection; return that
execution in the preparation receipt. Completion, exact-wording assessment,
final usage accounting and UI provenance must validate it against that same
policy, while keeping all existing revision, lease, cancellation and ownership
fences. Modify these contracts together before enabling the fallback flag.

The initial transport-only stage left fallback disabled; see the latest local
configuration and acceptance status below.
The local transport uses the pinned interpreted @cfworker/json-schema 4.1.1
validator so validation does not require runtime code generation in Edge workers.

## Integration work awaiting database and broader verification

The router now consumes durable fallback preparation receipts and saves actual
provider/model/token provenance. Three focused mocked integration tests pass:
primary rejection persistence precedes fallback, persistence/admission failure
prevents fallback dispatch, and a resumed admitted fallback needs no OpenAI key
or redispatch. Transport errors retain measured usage when output is rejected;
unknown usage remains a reconciliation blocker. Type checking passes for the
router and captured runner; implementation/transport lint passes.

The additive migration extends legacy RPCs, captured preparation/finalisation,
exact-wording assessment and allowance provider validation. Existing signatures
remain available. The deployment contract declares the new RPCs and migration;
static deployment and migration checks pass. A new pgTAP regression exercises
real legacy credit rejection, duplicate admission, cross-user denial, actual
usage persistence and replay. Database execution is still pending. The existing
isolated database harness will use a newly created disposable Supabase project,
not the user's existing local stack or hosted project.

Automatic fallback remains disabled in dotenv. UI provenance, captured SQL
fallback exercise, local end-to-end upload, broad tests/build and final review
remain outstanding. No production success or completed workflow is claimed.

## First broad gate and correction

The 2026-09-07 06:16 AEST gate passed all 907 Edge tests, Edge type checks,
production dependency audit, and the complete verify:web pipeline (lint, types,
shared/web tests, production build and progressive bundles). All 71 migrations
applied on a new disposable local database. The existing 37 database test files
passed; the new fallback SQL test exposed a second admission predicate still
limited to transient OpenAI errors. Its three failures and missing fallback
admission were reproduced against real Postgres. The predicate is corrected
using the same exact error/status/zero-token eligibility in both checks.

The outer source alert was a concurrent change to the other owner's readiness
evidence document. The tests did not modify application source.

New work after that gate: captured writer/reviewer fallback SQL acceptance using
the reviewed real ledger fixture; validated persisted upload fallback metadata
and a pre-confirmation UI notice; provider-aware reconciliation; and document
allowance attribution derived from the existing per-attempt usage ledger. One
upload-handler replay regression, four API-boundary cases and the focused UI
notice/reset regression pass. Broad re-verification remains pending.

## Corrected broad gate

At 06:29 AEST, all 39 SQL test files and 1,664 assertions passed, including
legacy fallback replay and captured writer/reviewer finalisation. The Edge
suite and types passed. verify:web passed with 295 shared and 896 web tests,
lint/types, production build and progressive bundles. The outer job correctly
flagged source movement: a separate task added upload-text-encoding.test.ts and
changed ingest-upload.test.ts during the run. This prevents describing the
whole mutable checkout as one frozen verified revision; the fallback source
and SQL inputs themselves were unchanged during the run.

The next bounded acceptance uses real local Auth/Storage/PostgREST and Ollama
with synthetic document facts and an injected OpenAI exhausted-credit response.
It runs the actual upload guard, handler, local parser, provider router and
checkpoint RPCs, then repeats from a fresh Deno process without an OpenAI key.
It does not claim a browser exercise or extractor worker process isolation.
The fixture is confined to a newly created disposable local Supabase project.

Live-workflow harness corrections: the first launch failed before setup because
a referenced helper import was relative to the wrong evidence directory; its
read-only preflight passed after correction. The next launch reached real local
Auth, original-file Storage and extraction, and the application correctly
rejected the harness returning v2 extraction for an accepted v1 request. The
harness now runs the actual parser for the requested contract. No OpenAI or
Ollama inference was dispatched by that rejected upload.

The next real upload exposed a pre-existing dispatch serialization defect:
markLegacyModelAttemptDispatched supplied undefined for a required nullable
p_origin_reservation_id. The actual SDK omitted that key, so PostgREST could
not match its non-defaulted RPC signature; the adapter reported dispatch
reconciliation and correctly withheld inference. A new regression using the
real Supabase SDK serialization reproduced MODEL_CALL_DISPATCH_ACK_UNRESOLVED.
Changing that one value to explicit null makes the regression pass. Adjacent
dispatch/provider/accounting tests and live workflow re-execution are pending.

## Actual upload acceptance and local configuration

Job job-mtqa4tq3-381eb6ff passed the real local upload and separate-process
replay. Evidence: docs/evidence/ollama-credit-fallback/live-db-20260906204359849-8ff85bc5/ollama-live-upload-summary.json.
The synthetic OpenAI credit rejection was persisted once, real gpt-oss:20b used
329 input and 79 output tokens, the original and classification were retained,
and a fresh process returned the identical saved response with zero provider or
extraction calls. The 62 dispatch/provider/accounting regressions passed,
including the nullable RPC serialization repair. Disposable resources cleaned
up successfully.

The outer job exited 1 only because the shared upload handler changed during
verification. Comparing its captured input diff to the current diff showed
only the existing file-level lint directive moving above the added import.
No executable upload behaviour changed. A fresh acceptance is being run to
obtain an unchanged-source result; the prior job is not relabelled successful.

The ignored supabase/.env.local now contains the seven local settings documented
in the setup file. Existing bytes, including OpenAI credentials, were preserved;
permissions are 0600. The real application configuration validator accepted the
saved configuration without printing credentials. No API key was created or
required for the local Ollama service. The web environment still targets the
hosted backend; saving server dotenv alone does not activate that hosted app.
See 2026-09-07-ollama-local-setup.md for scope and prerequisites.

Remaining limits: browser upload/review/import/reload has not been exercised
against this fallback; the live acceptance calls the real parser in-process,
so extractor worker isolation is covered by tests rather than that live run.
Captured writer/reviewer persistence passes database tests with synthetic
provider output, but real local document-generation quality and export are not
proven. Hosted activation remains deliberately rejected by configuration.

Latest lint scope: upload handler and new SDK dispatch regression pass. Linting
the existing model-call-context.ts also reports its pre-existing first-line
inline JSR import (no-import-prefix). The null serialization repair did not
change that import. This is an outstanding baseline lint finding; no lint rule
or application import was changed to suppress it. The final live runner checks
the handler and new test, and records existing broader evidence separately.

## Final local verification — 2026-09-07 06:54 AEST

Job job-mtqafmmw-fb896869 completed with exit 0. Every check in
`docs/evidence/ollama-credit-fallback/live-db-20260906205223882-57f9e39f/summary.json`
passed. Source hashes matched before and after the run, and still matched when
the completion was inspected. Repository and HEAD remained the inspected target.

- 62 dispatch, provider and accounting regressions passed.
- 80 upload regressions passed, with Deno type checking.
- Upload handler and new SDK dispatch contract test lint passed.
- Real local Auth, Storage, PostgREST, parser and Ollama completed one synthetic
  upload. The OpenAI insufficient_quota response was injected deliberately;
  there was no paid OpenAI request. One OpenAI rejection and one real Ollama
  attempt were persisted, with actual Ollama usage of 329 input/79 output tokens.
- Exactly one original file was retained. A fresh Deno process with no OpenAI
  key replayed the identical persisted response with zero OpenAI, Ollama or
  extraction calls. The saved provider was Ollama/gpt-oss:20b with pinned digest.
- The isolated database resources were cleaned up successfully.
- Final review checked fallback trigger/order, admission and persistence failure
  paths, actual provider/usage identity, bounded transport and cleanup, immutable
  replay, server-only settings and compatibility with old accepted operations.
  git diff --check passed. No tests modified tracked source during this run.

The local fallback implementation, configuration and tested backend upload/replay
slice are verified. This is not a claim that all app acceptance or release gates
have passed: browser review/import/reload, real captured generation quality and
export remain unverified, as does hosted activation. The earlier full SQL and
web/build evidence retains its stated scope; the existing Deno lint baseline
finding remains recorded above. No commit, push or hosted deployment occurred.
