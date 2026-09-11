# Unfinished work and production verification — 11 September 2026

## Latest verified state — 12 September 2026

The chronological entries below retain failures and corrections as historical
evidence. Current local acceptance is run `db-20260911144322685-303cf378` and
combined job `job-mtx2gbp6-b9d741f0`: all 53 SQL files / 2,737 assertions, 1,606
Edge tests (220 steps), 445 shared tests and 1,163 web tests passed, together
with repository lint/types, production build and bundle budgets. Cleanup and
all 1,084 pre-test source hashes passed. This covers dormant DOCX source binding,
finite owner access across database/Edge/account UI, bounded browser observation
and the legacy cumulative failure budget. Earlier pending/unlimited-owner draft
entries below are superseded by their later corrections and this current state.

This is fresh local database and source evidence. Captured cumulative failures,
the separate validation-repair budget, 84-migration upgrade rehearsal/schema
lint, real browser acceptance and production deployment remain outstanding.
Three additional pre-existing Edge lint diagnostics remain explicitly recorded.
The exact Pro/Premium document caps remain the pending commercial decision.

At approximately 00:50 AEST, Git fetch confirmed local and remote branch HEAD
still matched `c3c2ef6`; Netlify re-read confirmed locked production remains
`e1d514d`. Reviewed source synchronization is the next publication step.

## Scope and authority

The owner requested completion of the three pre-existing unfinished files and
verification of production performance and real-account library persistence.
Implementation begins from `c3c2ef6dd49bbdf12330b8a4ae5a0c87b2fc3316` on
`Thought-Enhanced-Document` in `/Users/kaichurchw/PrompTED.AI`.
Node 22.23.2, pnpm 10.33.0 and Deno 2.9.5 were verified.
The root instructions and the historical `reliably-prompTED` instruction source
were refreshed. Current repository authority takes precedence over historical
branch instructions.

The owner-access plan was already labelled approved, but its final section still
asked for owner review. The current request supplies implementation authority.
The coordination board retains a design-only claim on that plan; path overlap
is advisory and no conflicting executable-code claim was found. Preserve the
approved requirements and change only implementation/evidence status once the
corresponding work is actually verified.

Source publication remains authorised on the named GitHub branch. On 11 September
at approximately 23:15 AEST the owner explicitly extended authority to removing
release blockers and configuring the existing PrompTED local environment, Netlify,
GitHub, Supabase and Docker targets to reach an operational production release.
This authorises the required hosted work after its compatibility and verification
gates. Preserve existing accounts, documents, unrelated metadata and rollback
evidence. It does not turn test results into deployment or workflow proof.

At 23:17 AEST the owner corrected the commercial requirements: owner access is
1,000 documents/month; Business has the same document allowance as Premium,
at $50 per user/month versus Premium at $40, with business features including
branding. This supersedes the earlier unlimited-owner draft. Exact Pro and
Premium document caps remain a pending question; no numeric policy is inferred
from the price. Prices must use the existing billing authority when activated.

## Required implementation sequence

The owner's requested [production completion brain map](production-completion-map.html)
and [detailed register](Production-completion-map.md) now enumerate 36 tasks in
10 branches with 62 validated dependency links. They are dated documentation,
not a competing runtime workflow. Browser opening of the local HTML was denied
by browser URL policy; no workaround was attempted. Embedded data, JavaScript
syntax, source-link existence and acyclic dependencies passed local inspection.

Read-only hosted refresh on 11 September confirms Supabase remains healthy with
68 migration records and 25 Edge Functions; `extract-upload`, `document-operation`
and `brand-logo` are absent. Netlify confirms the same locked published deploy
and `e1d514d` revision. GitHub and local HEAD still match `c3c2ef6`. Hosted counts
are inventory evidence and do not establish exact schema or function compatibility.

The owner-cap regression has been updated for the newly specified finite 1,000
limit, including rejection above 1,000 existing reservations, rejection of a
null cap, immutable admission snapshots and unchanged real billing. It must
first expose the now-superseded unlimited draft before that draft is corrected.

1. Reproduce the missing DOCX command using the existing regression in an
   attested disposable local database. Preflight passed at 08:48 UTC.
2. Complete dormant source binding from the owned immutable upload checkpoint
   into the existing outcome/document/section aggregate. Validate the exact
   manifest and source units, preserve the original receipt, provide idempotent
   replay, reject cross-owner or conflicting inputs and prevent legacy writes
   from bypassing source provenance. Do not activate unsupported Word editing or
   export merely by creating a binding.
3. Implement the approved owner-access and bounded-generation plan through the
   existing authorities: request admission, both allowance paths, provider
   attempts/checkpoints, account presentation and read-only status observation.
   Preserve ordinary paid/free behaviour, RLS, real subscription truth, usage
   accounting, cancellation and reconciliation.
4. Run focused regressions, adjacent contracts, complete local SQL tests/schema
   lint, changed Edge tests, the web gate and browser failure/recovery checks.
5. Update the unfinished plan and repository guide with exact evidence, review
   the final diff, commit only reviewed work, push the authorised branch and
   inspect CI at its exact revision.

## Production identity and evidence boundary

The Netlify API currently identifies `https://ted.littlemissscarlett.co` as
locked to deploy `6a9fc526610f2efb8c05454f`, commit
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`.
Consequently, a production check cannot prove the newer `c3c2ef6` library code
is deployed or verify new unfinished features before release.

Real-account bookmark persistence was exercised through the signed-in product
UI. One initially unsaved item was saved; a full reload retained its saved
state and the Saved tab included it. The bookmark was removed; another reload
retained the unsaved state and the Saved tab excluded it. Original bookmark
state was restored. The normal bookmark update also changes recent ordering;
no document wording was edited and no document was created or deleted.

Performance samples use the existing signed-in Chrome profile, its normal
cache/network and installed extensions. These are live diagnostic samples,
not a throttled Lighthouse run, a mobile-device benchmark or a population-wide
Core Web Vitals assessment. Private account content and credentials must not
enter committed evidence.

## Status

- Production identity: verified.
- Real-account bookmark save/reload/restore: passed on the deployed revision.
- Production performance: three desktop library samples complete; repeated
  layout shift 0.163 needs improvement. See `Production-verification.md`.
- DOCX regression: freshly reproduced in the disposable baseline run
  `db-20260911085309259-87fdd917`. The missing command caused three failures in
  the 13-assertion DOCX file; the other 50 SQL files passed. Cleanup passed.
- DOCX implementation: draft migration and expanded SQL regressions written.
  Static migration validation (82 migrations) and deployment contract checks
  (26 functions) pass. Database execution and broader acceptance are pending.
  The command remains service-only and dormant: it preserves the original
  upload checkpoint, creates literal wording in the existing sections store,
  serializes identical requests and rejects conflicting projections. Browser
  RLS, privileged mutation guards and existing workspace/export readers prevent
  the aggregate from entering unsupported legacy editing/export. Ordinary
  deletion is fenced until activation has a deletion/replay contract; existing
  account erasure must still cascade and has a regression assertion.
  The first implementation verification run,
  `db-20260911094309598-70868d4f`, timed out during disposable database startup
  after `Seeding globals from roles.sql`; it never reached migration reset or
  SQL assertions. Its cleanup and complete `pnpm verify:web` gate passed, and
  source integrity checks passed. This is an environment blocker, not a DOCX
  acceptance result. Subsequent read-only checks found Docker responsive,
  normal container resource usage and sufficient disk space; the startup cause
  is not established. A fresh isolated retry is the next bounded check.
  The retry `db-20260911101759901-8ef75e1c` again timed out before SQL execution;
  cleanup and the full web gate passed. Subsequent macOS power-history inspection
  found the host sleeping during both startup intervals. In the retry, sleep
  began at 20:18:05 AEST and the timeout was reported on wake at 20:35:14 AEST.
  The next verification uses a process-scoped `caffeinate -i` assertion to
  prevent idle system sleep only while the existing finite runner executes.
  No timeout, test, migration validation or database-isolation gate is weakened.
  Run `db-20260911111203570-5451abd3` successfully started the database and
  applied all migrations, including the DOCX draft, in 29 seconds. Fresh reset
  then timed out before SQL tests. Power history shows maintenance sleep at
  21:12:37 AEST, immediately after reset began, and wake at 21:27:40 AEST.
  The `-i` assertion did not prevent return to maintenance sleep when launched
  from a maintenance wake. Cleanup and the web gate passed. A brief `-u` wake
  assertion and process-scoped `-u -i` are the next local verification step;
  this is temporary process state, not a persistent power-setting change.
  Run `db-20260911114655661-41a7650d` reached fresh SQL tests: startup and reset
  passed in roughly 29 seconds each. All other 50 SQL files passed. The DOCX
  positive case exposed an implementation error: the existing UTF-16 helper
  returns `integer[]`, but the draft compared it with an integer limit. Both
  per-unit and total-length checks now use the array cardinality. This preserves
  JavaScript UTF-16 length semantics, including supplementary characters.
  The DOCX file stopped after 14 assertions, so its later cases remain pending;
  cleanup and the web gate passed. The correction needs a fresh SQL run.
  Run `db-20260911115530581-b43de72e` passed all 48 DOCX assertions reached,
  including creation, replay, cross-owner rejection, invalid projections,
  browser restrictions and privileged legacy mutation/export guards. The SQL
  fixture then attempted a direct Storage metadata deletion, which Supabase's
  built-in deletion protection correctly rejected. The missing-original fixture
  now temporarily changes the metadata path and restores it after the assertion,
  entirely within the disposable test transaction. Storage deletion protection
  remains enabled. Missing-original rejection and account-erasure assertions
  still require execution. All other 50 SQL files, cleanup and the web gate
  passed; source hashes were unchanged by verification.
- DOCX local acceptance: run `db-20260911120042849-794c4b18` passed all 52 DOCX
  assertions and all 2,695 assertions across 51 SQL files, cleanup, source
  integrity and the complete web gate. See `DOCX-source-binding.md` for scope.
- Owner-access/retry implementation: in progress. Bounded browser observation
  reproduced both missing limits with failing regression tests; the fix now
  passes 19 component tests, including five-failure and two-minute stops, hung
  read cancellation, late-response rejection and manual GET-only recovery.
  Broader web verification and browser exercise of this change are pending.
  The owner-access resolver and durable provider-failure budgets remain pending.
  The first broader polling gate passed contract checks and lint, then caught
  unchecked indexing of the test mock's first recorded call (TS2532). That
  assertion now handles an absent call safely while still requiring an aborted
  signal. Web type checking and all 19 focused tests pass after the correction;
  the complete web gate must finish before the slice is broadly verified.
  The corrected complete web gate passed on 11 September: 1,158 web tests,
  423 shared tests, lint, type checking, production build and bundle budgets.
  Browser exercise remains pending. Owner-access SQL regressions now cover
  trusted metadata, browser isolation, revocation, real billing preservation
  and unlimited reservations without duplicate dispatch. They are written
  before the missing resolver/allowance integration is implemented.
  A material existing policy conflict was found: backend Pro/Premium/Business
  caps are 20/40/1,000, while shared UI definitions advertise 50/unlimited/
  unlimited. The owner has been asked which policy is authoritative; no paid
  allowance or advertised entitlement has been changed pending that answer.
  Run `db-20260911130553478-a4eec6cd` reproduced the missing product-access RPC
  (SQLSTATE 42883); the preceding 51 SQL files passed. The additive migration
  `20260911130803_effective_owner_product_access.sql` now drafts that authority,
  preserves real billing fields, restricts browser reads to the current UUID,
  and routes captured plan snapshots and legacy allowance admission through the
  same metadata decision. New owner reservations retain their real commercial
  plan and freeze an unlimited access profile. Revocation is re-read at admission
  under the account-deletion lock and an Auth row lock. No hosted account has
  been marked or modified. Database execution, Edge/browser integration and
  durable provider-failure limits remain pending.
- Deployment or hosted configuration changes: none.

## Owner resolver first execution and correction

Run `db-20260911132611076-81ab7f20` reached SQL and exposed SQLSTATE 42703:
the draft resolver incorrectly referenced `subscriptions.current_period_end`;
the authoritative table column is `period_end`. This also interrupted adjacent
captured/legacy allowance tests, so this is a genuine draft regression, not the
expected finite-cap mismatch alone. The web gate and cleanup passed.

The draft now maps `period_end` into the versioned response, uses the
`owner_1000_v1` metadata marker, freezes `owner`/1,000 admission snapshots, and
retains the non-null database cap constraint. It rejects null cap inputs and
clamps ordinary admission to the current server cap so a revoked owner cannot
reuse a larger stale snapshot. The internal resolver uses a fresh read after
the Auth row lock; no metadata, schema or entitlement has been changed hosted.
Regression coverage now includes a real subscription period, the 1,000 boundary,
null rejection, immutable snapshots, revocation and ordinary stale-cap rejection.
Execution of the corrected slice remains pending. The existing browser usage
reader has the same incorrect period column and will be replaced by the shared
validated access projection in the next integration slice.

Run `db-20260911133053118-704208f9` passed the owner-access and DOCX SQL files.
The remaining three SQL suites stopped at `ALLOWANCE_CAP_REACHED`: they create
Auth users without subscriptions, then request Business/1,000 or Pro/20 in
service arguments. Authoritative access now correctly treats those fixtures as
Free. The repair supplies the actual active Business/Pro subscription rows at
the paid-case setup; existing test assertions and supplied admission arguments
are preserved. This is fixture fidelity for the newly enforced contract, not
a weakened cap, bypassed check or changed expected result. The complete web
gate, cleanup and diff check passed. Integrated SQL re-execution remains pending.

Run `db-20260911133501697-41ae2c3c` stopped before starting a database because
three immutable upgrade-manifest checks correctly rejected changed SQL fixture
hashes. The explicit `paid-plan-fixture-revisions.mjs` revision now binds each
reviewed before/after test hash. Existing historical JSON baselines and every
migration pin remain unchanged. Acceptance validators apply only those exact
fixture changes; unknown hashes and omitted SQL remain rejected. The copied
runner evidence includes the new helper and its tests. This updates test-input
identity and does not relabel any prior upgrade execution as current proof.

All 119 focused fixture/upgrade-validator tests pass. Full runner preflight
`db-20260911133918511-3b30c1e3` passed without starting services. All three
historical baseline files were byte-compared to HEAD and remain identical.
The corrected complete SQL run remains pending. Current 83-migration hosted
upgrade acceptance still requires its own reviewed full manifest and rehearsal;
the historical 79-to-81 checks are not evidence of that newer upgrade.

Run `db-20260911134000615-f41948ac` passed 51 of 52 SQL files. The accounting
file reached 78 passing assertions before its independent crash/reconciliation
account's fourth reservation hit Free/3; that later account also requested Pro/20
without a real subscription. All fixture account setup was rechecked: the
Free/1 ambiguity account remains Free, while the Pro crash and independent
dblink concurrency accounts now receive their actual Pro subscriptions. Existing
assertions remain unchanged. The explicit after-hash pin was refreshed for this
reviewed fixture revision; original baseline hashes remain intact.

## Owner database slice: integrated local gate passed

Run `db-20260911134326723-8f62b31e` passed all 2,730 assertions across 52 SQL
files, including the finite owner allowance, DOCX source binding and existing
legacy/captured recovery suites. Source integrity, cleanup and the full web
gate passed: 1,158 web tests, 423 shared tests, lint, types, production build and
bundle budgets. This is fresh disposable database evidence, not a hosted upgrade,
owner grant or deployed account UI result. Edge/browser access integration and
provider failure budgets remain in progress.

## Effective access browser integration

The shared `parseEffectiveProductAccess` boundary rejects wrong users/versions,
malformed caps, contradictory feature flags and invented billing details. The
new response-boundary regressions failed before implementation; all 47 plan
and access tests now pass. Existing shared callers retain their optional-access
compatibility while resolved account usage uses the server cap.

The account reader now calls the owner-bound access RPC instead of querying the
nonexistent subscription `current_period_end` column. Usage is still read from
the existing usage ledger and now uses a UTC calendar-month boundary. Read
failures, malformed responses, owner changes and cancellation remain errors.
The component shows Owner access, real subscription identity, 1,000 documents
per month and an accurate limit warning without a misleading owner upgrade.
Ordinary account meter/allowance text uses the same server projection; no paid
backend caps or checkout prices have been changed pending the Pro/Premium answer.
All 23 account/usage/component tests, changed-file lint and web/shared type
checks pass. The deployment contract now requires the new browser RPC and
migration before frontend release. Broader gate and real browser execution of
this slice remain pending. Edge auth-guard integration is the next slice.

## Local environment repair — 12 September, 00:00 AEST

Job `job-mtx0oz5c-fc881613` passed lint, types, 445 shared tests and 1,163 web
tests, then the production build correctly rejected private credentials in the
root `.env.local`. This failure does not invalidate the earlier SQL result and
does not count as a successful build of the new browser slice.

The root file also contained six operator assignments with mismatched straight
and typographic quotes. Their corrected values differed from the existing
operator file. The complete original and corrected, unverified operator
candidates are preserved under the ignored private verification directory with
0600 file permissions and a 0700 containing directory; no values are in this
report. Existing `.env.tools.local` was byte-checked and left unchanged.

Eighteen existing private runtime settings moved to ignored `supabase/.env.local`
with 0600 permissions. Three public settings were verified identical to the app
dotenv, and the operator API URL already matched its existing destination.
The redundant root dotenv was removed only after exact backup and concurrent
change checks. `apps/web/.env.local` remains the public web configuration.
No provider policy or hosted configuration was activated by this local move.

The web environment checker and all 14 existing environment regression tests
now pass. Full web gate rerun remains pending; conflicting operator candidates
still require service-specific validation before adoption.

Job `job-mtx0y2el-8a9fe5a9` subsequently passed the complete web gate: 445 shared
tests, 1,163 web tests, lint, types, production build, deployment checks and
progressive bundle budgets. This verifies the browser access slice locally
after environment separation; it does not establish deployed account access.

## Effective access Edge integration — 12 September

The auth guard now reads the same versioned, exact-user access RPC as the account
UI. Its independent plan-cap table and silent Free fallback are removed. Access
and usage reads each have a ten-second deadline, propagate transport cancellation
and reject late responses before model context can be bound. Missing, malformed,
foreign-owner and failed responses stop admission with a safe retry error.
Monthly usage uses UTC, the existing document-created ledger and a validated
non-negative integer count. Raw HEAD count headers are validated before the SDK
can truncate fractional or trailing-text values through `parseInt`.

Owner creation remains finite at 1,000. Non-creation operations remain available
at that cap. All four legacy creation callers carry the validated access profile
to reservation error presentation; both policy-bound and compatibility
reservations return the finite owner limit without an upgrade prompt. This field
does not change RPC arguments or confer allowance authority: the database still
resolves and freezes access at reservation time. Ordinary paid caps are unchanged.

The owner-after-Free-cap and unavailable-access regressions failed against the
old guard, then passed. A separate reservation regression reproduced the false
owner paywall before its repair. Focused auth/deadline/reservation/policy coverage
passes (119 tests in total), including owner cap, malformed count, access timeout,
cancellation and no model context after a late response. Four creation entrypoints
pass Deno type checking; the deployment contract requires the new access RPC and
migration for every shared-guard caller and passes its static check.

An additional Deno lint run found three pre-existing `no-import-prefix`
diagnostics on unchanged direct JSR imports in auth-guard and its test. The new
timer declaration diagnostic was repaired. No lint rules were disabled and no
dependency import migration is bundled into this allowance repair. Repository
web lint previously passed; the extra Edge lint check is not fully green.

The complete Edge suite and web gate for this combined source remain pending.
No hosted migration, owner marker grant, Edge deployment, browser workflow or
new production persistence result has been claimed for this slice.

Job `job-mtx1aoum-7d9bcaad` passed 1,602 Edge tests (220 steps), 445 shared tests,
1,163 web tests, repository lint/types, production build and bundle gates. All
1,082 tracked/untracked reviewable source files matched the pre-test hashes.
The additional three existing direct-JSR import lint diagnostics remain recorded
above; the successful canonical gate does not erase that narrower finding.

## Cumulative generation failure budget: reproduction

The next traced gap is cross-stage admission. Legacy checkpoint admission scopes
its attempts to owner, request, stage and digest; captured admission likewise
enforces each accepted route's attempt ceiling. Those controls do not by
themselves enforce the approved cumulative two-dispatched-failure limit across
stages. Historical attempt and result rows must remain authoritative.

`supabase/tests/generation_failure_budget.test.sql` adds an isolated synthetic
regression using existing reservation, checkpoint, dispatch and accounting RPCs.
It records two failed provider attempts in distinct stages of one operation and
requires the next stage to be denied without another dispatchable admission.
No provider is contacted. The regression is expected to expose the existing
gap; execution and implementation remain pending. No retry-policy change has
been made yet.

Run `db-20260911141739495-a866ce2b` passed the existing 52 SQL files and 2,730
assertions. The new regression completed its synthetic dispatch/accounting setup
but stopped before its assertions: its ledger query incorrectly used the response
field `attempt_status`. The authoritative ledger column is `model_call_status`;
the test query is corrected. This was a test-authoring failure, not reproduction
of the intended budget defect. Runtime retry policy remains unchanged.

Run `db-20260911142037005-c6c7f9ef` reproduced the intended defect: two failed
attempts were durably recorded in distinct stages, but a later stage received
`provider_permitted: true` and the admission count rose from two to three.
Only the two intended regression assertions failed; the other 2,731 assertions
passed. This is local synthetic RPC evidence, not a diagnosed hosted incident.

Migration `20260911143000_legacy_generation_failure_budget.sql` now adds a guard
to the existing legacy admission table at preparation and first dispatch. It
counts immutable failed usage rows joined to exact dispatched admissions within
the same owner/scope/request/reservation identity. Undispatched failures and
completed-but-rejected validation results are excluded. Reservation-backed paths
retain their existing period lock; non-reservation paths now serialize the whole
logical request instead of each stage independently. Both checkpoint readers
return a permanent limit response for the exact custom SQLSTATE. Completed replay
and historical records retain their existing contracts.

The five replacement SQL bodies were compared mechanically to their original
source migrations: only the declared advisory-key changes and checkpoint denial
handling differ. Public signatures and grants are preserved. This explicit
migration does not create a counter store or replace the provider router.

Four focused Edge regressions pass: exact dispatch-budget error recognition,
rejection of mismatched error markers, and no provider/capacity work across repeated
router invocations after an authoritative cumulative denial. Changed retry Edge
files pass Deno lint/type checking. The expanded SQL regression also covers an
attempt prepared before failure exhaustion and the fallback-capable checkpoint.
The 84-migration preflight and static deployment contract pass; full database
integration is pending. Captured-operation cumulative budgets and the separate
one-repair allowance still require implementation and verification.

Run `db-20260911143840677-6857bf4f` passed the new seven-assertion failure-budget
file. The existing accounting/replay suite stopped after 64 passing assertions
when its nonretryable scenario requested a new stage using the operation that
its previous retry-budget scenario had already exhausted. The denied allocation
left no admission ID, so its subsequent dispatch setup correctly failed input
validation. This is now resolved in the fixture by giving only the retry-budget
scenario its own real reservation/request/claim. Its statements and assertions
are otherwise identical after mapping the fixture identities back; the other
scenarios retain their original operation. The new dedicated regression still
requires distinct stages of one operation to share the cumulative failure cap.

The accounting fixture's explicit reviewed hash was updated to
`d3f012961fe1928c0eccad0e6a27609caefa4ddc268767d96ca65b2f78b84e52`.
Historical JSON manifests and migration hashes are unchanged. Fixture-pin tests
and full runner preflight `db-20260911144229553-997b8b28` pass. The corrected
integration run remains pending; no gate has been weakened.
