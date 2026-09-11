# Unfinished work and production verification — 11 September 2026

## Latest verified state — 12 September 2026

The chronological entries below retain failures and corrections as historical
evidence. Current local acceptance includes 54 SQL files / 2,761 assertions,
1,617 Edge tests (220 steps), 445 shared tests and 1,163 web tests, repository
lint/types, production build and bundle budgets. Both the 79-to-87 workspace
upgrade and recorded production 68-to-87 upgrade passed with exact historical
wording/receipt preservation. Schema lint reports zero errors and 23 retained
warnings in older functions; the new-source warnings were corrected. Cleanup
and source hashes passed. Evidence runs and limitations are recorded below.

This covers dormant DOCX source binding, finite owner access across database,
Edge and account UI, bounded browser observation, and legacy/captured cumulative
guards, including the section-repair budget. Historical captured failures without
dispatch evidence remain under review. Repair-specific browser acceptance and
production deployment remain outstanding. Three additional pre-existing
Edge lint diagnostics remain recorded. The exact Pro/Premium document caps are
still the pending commercial decision; no numeric policy is inferred from price.

Local and remote branch HEAD match published `c329e58`. CI run `34617376047`
has passed all four jobs, including the real local upload, Profile and tEdit
browser gate. This CI evidence applies to that exact published commit.
The working tree now contains the next regression slice, which is not accepted
or published. Netlify production remains locked at `e1d514d`.

### Automatic repair regression in progress

Tracing the legacy pipeline found weak-output recursion, two audit repair rounds
and a final cleanup writer, all using distinct durable stage identities. Their
individual bounds do not enforce one repair for the same logical section.
Checklist generation already uses one stable repair stage. The captured runner
has one retained review checkpoint; its exact-wording adapter assesses the draft
without rewriting it, while its historical replacement adapter remains bounded
by that same single checkpoint. This is source evidence, not hosted acceptance.

The new dispatch-context regression reproduced an exact error-classification
gap: `PGB02 / GENERATION_REPAIR_LIMIT_REACHED` becomes an unresolved dispatch
acknowledgement instead of an explicit permanent denial. The focused command
passed five cases and failed this one for the expected assertion. Mismatched
SQLSTATE/message pairs must continue to fail closed as unresolved.

Six SQL assertions now exercise the existing admission/dispatch authority:
first repair, a competing repair prepared earlier, independent sibling repair,
exact dispatch acknowledgement replay, unchanged undispatched state after denial,
and absence of fabricated failure usage. The disposable database reproduction
ran as `db-20260911154815938-8681087e`: exactly two of the 13 budget assertions
failed because the competing repair dispatched. The other 53 SQL files and web
gate passed; cleanup and source checks passed. Only the explicit current
regression hash was refreshed; historical upgrade manifests were unchanged.

The forward migration `20260911155000_legacy_section_repair_budget.sql` now adds
the section check to the existing locked first-dispatch transition. The old
failure-guard body is byte-identical outside the added repair block/declaration.
An exact `PGB02` denial survives accounting and checkpoint replay. The writer
maps only that exact typed permanent denial to the existing needs-input slot;
ambiguous errors, cancellation and accounting failures still propagate. Final
wording audits remain required and passing siblings are retained. The deployment
contract requires the new backend migration before the changed functions.

All 148 focused/adjacent Edge tests pass, including exact/inexact denial,
worker-context recreation, final audit and sibling preservation. Six changed
Edge files pass lint/type checking. Migration/deployment checks and 13 current
upgrade-manifest tests pass for the exact 87-migration input. Real SQL lifecycle
verification is pending, including newly added retained-denial readback and
same-repair transient retry assertions. Complete Edge/web/database gates and
current upgrade rehearsals remain required; this slice is not yet published.

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

## Source publication and captured-budget regression — 12 September

The corrected combined run passed as recorded in Latest verified state above.
All 52 reviewed paths were committed and pushed normally as
`c1cabb63885086de63a1e48873032bd55d91fa6b`; local and remote HEAD matched and
the working tree was clean immediately afterwards. The reviewed-path secret
pattern scan found no private key, live token or JWT candidates. The final
staged whitespace check passed after correcting the generated map's extra
trailing blank line. Netlify production remains on its older locked revision.

CI `34613219486` at that exact commit has passed its Edge, fresh database and
web gates; browser workflow acceptance is still running. No complete CI or
production acceptance claim is made yet.

The next regression is `captured_generation_failure_budget.test.sql`. It uses
the established real-ledger synthetic admission fixture, records a failed
generation attempt, a successful generation checkpoint and a failed review
attempt through the public commands, and requires the next review preparation
to be denied by the cumulative budget. Synthetic external-egress receipts are
recorded through the existing commands; no provider is contacted. Original
checkpoint and completed-document-credit preservation are independently read.
The fixture is attributed to its exact source hash. Existing tests are unchanged.

The trace confirms captured preparation currently checks the immutable per-stage
ceiling, while generation and review have separate stage identities. Captured
completion accounting and the external-egress receipt are existing authorities
for the upcoming repair; no new counter store is introduced by the regression.
Preflight `db-20260911150217284-c89fad25` passes. The new regression still needs
execution to distinguish the expected cumulative-limit defect from fixture errors.

Run `db-20260911150331319-8499da4b` reproduced that defect: no exception was
raised on the next review preparation and the attempt count rose from three
to four. Exactly two of the new file's 12 assertions failed; all other 53 SQL
files passed. Cleanup, unchanged source hashes and the complete web gate passed.

The additive `20260911151000_captured_generation_failure_budget.sql` now drafts
the cumulative check on the existing captured attempt table and rechecks it
at a new external-egress grant. It joins exact owner/attempt dispatch receipts
to immutable terminal failed attempts, serializes against the operation row,
preserves completed checkpoints and existing dispatch-token replay, and excludes
the known completed-response wording/JSON validation errors. No new counter
table or document-credit path is introduced. Historical failed attempts without
dispatch receipts are not proof of dispatch; their treatment and the separate
repair allowance remain explicit acceptance work rather than inferred usage.

The Edge dispatch acknowledgement regression first failed with the misleading
`MODEL_CALL_PROVIDER_DISPATCH_ACK_UNRESOLVED` response. Exact SQLSTATE/message
recognition now preserves `GENERATION_ATTEMPT_LIMIT_REACHED` without retrying
the acknowledgement. Three focused tests pass for that exact response, rejection
of an inexact marker, and runner terminalization with no preparation on resume.
The SQL file additionally checks denial at the dispatch boundary and preservation
of an existing completed receipt. Full database/Edge integration remains pending;
85-migration preflight `db-20260911151246039-035d695e` passes.

CI `34613219486` completed with Edge, fresh SQL and web gates green. Its browser
job failed at `Prove all current SQL fresh and the reviewed 79-to-81 workspace
upgrade`, before browser execution. The existing upgrade validator still binds
the historical exact 81-migration manifest; the published slice contains 84 and
the next draft 85. A separately reviewed current upgrade manifest/rehearsal is
required. Historical evidence will not be overwritten or re-labelled as current.

## Captured local acceptance and current upgrade inputs — 12 September

Run `db-20260911151421959-c1a48e17` passed all 2,752 assertions across 54 SQL
files, including 15 captured cumulative-budget assertions. Combined job
`job-mtx3k6bb-62e5c3e8` also passed all 1,609 Edge tests (220 steps), the complete
web gate and cleanup; source hashes were unchanged. This verifies the current
captured guard locally, not hosted historical dispatch evidence or the separate
automatic validation-repair budget.

Two new upgrade-validator regressions reproduced rejection of the current
85-migration / 54-test manifest. `reviewed-release-sql-extension.mjs` now pins
the four reviewed added migrations and four added SQL test files explicitly.
Both the 79-version workspace predecessor and the observed 68-version hosted
ledger retain their original immutable manifests. The runner temporarily holds
the exact additional SQL files out of the workspace predecessor, verifies both
active and held inventories/hashes, restores the complete manifest, and runs
all current tests after the upgrade. Unknown, missing or modified files remain
rejected. The original historical mode remains testable at its original pins.

All 100 focused current/historical validator tests pass. Current workspace
preflight `db-20260911152246179-3942808b` and hosted-ledger preflight
`db-20260911152248019-1c9bf959` pass. All three historical baseline JSON files
were byte-compared to HEAD and remain unchanged. These are input/preflight
results; neither current upgrade has been executed yet.

The upgrade modes now run Supabase schema lint on the application's public and
private schemas before and after the upgrade, retaining warning diagnostics and
failing on errors. The CLI's installed help confirms these exact supported
options. CI's step label now describes the current reviewed upgrade rather than
claiming the old 79-to-81 target. The CI/browser gate still needs a new published
revision and successful execution.

Run `db-20260911152344058-5fe2e444` passed the actual 79-to-85 workspace upgrade:
48 predecessor SQL files / 2,511 assertions, then all 54 current files / 2,752
assertions. The authenticated synthetic two-owner workflow preserved historical
wording, save receipts, sibling sections, public RPC identity and grants; old
receipts replayed exactly and new saves persisted independently. Full web gate,
cleanup and source hashes passed. This is disposable authenticated upgrade proof,
not the production account library.

Fresh and upgraded schema lint reported zero errors and retained warnings. Two
new-source warning groups are addressed by the forward-only migration
`20260911153000_access_read_volatility_and_docx_scope.sql`: access wrappers now
declare the deliberate fresh-read volatility of their resolver, and the DOCX
paragraph ordinal has a distinct local name from implicit integer-loop indices.
The copied DOCX function was mechanically compared to its original: only that
local variable rename and CREATE OR REPLACE differ. Published migration files
remain unchanged. Existing unrelated manifest/helper lint warnings are retained
for review rather than suppressed.

The resulting 86-migration release extension has explicit reviewed hashes.
Both workspace and hosted-ledger preflights pass again
(`db-20260911152943828-bbd229f3`, `db-20260911152945791-8e944d57`). The 86-migration
upgrade itself remains pending. Workspace summary metadata now records the actual
validated final migration rather than retaining the old fixed 81-migration end.

At approximately 01:28 AEST, the Supabase connector returned exactly the same
68 ordered migration versions as the immutable recorded hosted baseline, not
merely the same count. No hosted mutation was performed. The next execution
repeats the corrected workspace upgrade and separately rehearses that exact
68-version history through all 18 pending migrations in isolation.

Runs `db-20260911153057822-4785f3a3` (79-to-86 workspace) and
`db-20260911153331378-7dd5642b` (68-to-86 production-history rehearsal) both pass.
Each passed all 54 current SQL files / 2,752 assertions before and after the
upgrade, the complete web gate, cleanup and unchanged source hashes. The
workspace predecessor additionally passed 48 files / 2,511 assertions, and its
23 authenticated synthetic HTTP checks preserved public API identity/grants,
old receipt replay, sibling state and new-save persistence. Its summary records
the actual final migration `20260911153000`.

The production-history rehearsal preserved two owners' outcomes, documents,
four sections, two uploads and two historical save receipts. Both original
DOCX objects retained their exact bytes; both save receipts replayed. This
used isolated synthetic accounts and the recorded production version list.
It does not establish hosted schema-byte equivalence or a production workflow.

Both fresh/upgraded schemas report zero lint errors and 23 existing warnings;
the DOCX scope and owner reader volatility warnings are absent. No provider
was contacted and no hosted mutation occurred. The reviewed current changes
are ready for source publication and CI; remaining operational gates stay open.

## Section repair acceptance — 12 September 2026, 02:04 AEST

`job-mtx54ity-1bd76b49` passed both current upgrade rehearsals and the complete
Edge suite. Workspace run `db-20260911155810914-c71ff4bd` upgraded 79 to 87
migrations, passed 54 SQL files / 2,761 assertions before and after upgrade, and
preserved historical content, public API properties, receipts and sibling state
across 23 authenticated synthetic HTTP checks. Recorded-hosted-history run
`db-20260911160044438-88b41118` applied all 19 pending files to the recorded
68-version baseline, passed the same SQL suite, retained two original DOCX
objects byte-for-byte and replayed both historical save receipts. Both runs
passed the complete web gate (445 shared / 1,163 web tests, lint, types, build
and bundle budgets), cleanup and unchanged source hashes. Schema lint has zero
errors and 23 retained diagnostics. The complete Edge suite passed 1,617 tests
and 220 steps. No provider was called by these fixtures.

The new real SQL assertions prove the second repair cannot dispatch, including
an earlier preparation; independent sections and exact dispatch acknowledgement
remain valid. The denial is durably readable with its exact code, and one
classified transient retry of the same repair remains valid. Existing failure
budget, accounting, replay and final-wording tests remain green.

Read-only hosted refresh after this run still shows the same 68 migrations and
25 functions; required `extract-upload`, `document-operation` and `brand-logo`
remain absent. A private local snapshot captures metadata and definition hashes
for 190 hosted public/private functions, with no application rows or function
bodies. This starts catalog comparison; it is not a completed schema parity or
backup/recovery check. No hosted mutation or deployment has occurred.

## Hosted catalog and recovery inspection — 12 September 2026

The reviewed repair slice is published at
`5f7b12e942eb6dc8b615dd7795ec94fc3a3664e6`; local/origin were confirmed equal
and clean before the following audit-only runner change. CI `34620298898` is
running on that exact commit. Previous CI `34617376047` passed all four jobs.

The existing local `SUPABASE_ACCESS_TOKEN` and distinct
`NEXT_SUPABASE_ACCESS_TOKEN` both return HTTP 401 from the official project
backup-inventory endpoint. No valid Supabase candidate exists in the preserved
operator-candidates file. Values were not printed, overwritten or rotated.
The Supabase connector and signed-in dashboard remain accessible.

The dashboard verifies PrompTED, project `jjsykocqpjlekgsbylkd`, in Little Miss
Scarlett, linked to the requested repository and production branch. Project
status is Healthy. Eight physical backups are listed; latest is
10 September 2026 at 18:44:38 UTC. Point-in-time recovery is not enabled.
The owning organization shows outstanding invoices; no invoice was paid and
no paid add-on or new project was created. Financial disposition remains an
operational issue, distinct from database health.

The dashboard and [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)
confirm database backups exclude Storage object bytes. The existing local
upgrade fixtures prove original-byte preservation, not a full live backup or
a restoration rehearsal. No production restore has been attempted.

The isolated recorded-hosted-history runner now emits public/private function
metadata before and after upgrade. This is read-only catalog instrumentation
using the same function identity, definition hash, definer flag, volatility and
ACL fields captured from production. The next run will enable comparison of
all 190 observed hosted function entries with the reconstructed predecessor.
It does not itself establish table/RLS/Storage parity or authorize migration
if a definition or privilege differs.

## Hosted function comparison and permission correction — 12 September 2026

Catalog run `db-20260911161501018-f9b3cfa7` passed the recorded 68-to-87 upgrade,
54 SQL files / 2,761 assertions, web gate, cleanup and source checks. Its exact
predecessor has the same 190 function identities as production. Every definition
fingerprint, signature, SECURITY DEFINER flag and volatility matches. No function
is missing or extra. This is function-metadata evidence, not whole-schema parity.

Sixteen raw ACLs differ. Effective privilege reads confirm 15 functions have
extra grants: fourteen owner-client functions also allow service-role execution,
and the Auth trigger has a redundant service-role grant. Three of the owner
commands (`update_own_profile_details`, `link_own_business`,
`create_and_link_own_business`) additionally grant anonymous execution. Their
matching bodies still check `auth.uid()`; this finding establishes privilege
drift, not demonstrated anonymous access to another user's data. The sixteenth
raw difference, `set_updated_at`, is equivalent to its existing PUBLIC default
and is not treated as a new effective privilege gap.

Callers were traced through owner-authenticated browser clients and
`document-operation`'s `userClient(req)`. Server commands retain separate
service-role APIs. Forward migration
`20260911162022_reconcile_owner_rpc_execute_privileges.sql`, created by the
Supabase CLI, explicitly restores the owner-only EXECUTE surface and removes
direct client grants on the Auth trigger. It changes no function body, argument,
row, approval, receipt or Storage object.

The disposable predecessor now reproduces the exact observed extra grants before
applying the pending migration set. A new SQL regression checks all fourteen
owner-command roles, direct trigger denial, actual Auth sign-up/profile creation,
and retained service access on the separate entitlement command. The raw local
predecessor and observed-grant fixture catalogs remain separate artifacts.
Fresh and upgraded real SQL verification is pending; static migration/contract
checks and 21 current/historical upgrade-manifest tests pass. No hosted grants
or migrations have been changed.


## Permission correction accepted locally — 12 September 2026, 02:29 AEST

CPJ `job-mtx61xta-8c41ba44` passed both current 88-migration rehearsals:
`db-20260911162409967-4d4d9df5` (recorded hosted 68-to-88, including observed
grants) and `db-20260911162633121-a95f1a92` (workspace 79-to-88).
Each fresh and upgraded database passes 55 SQL files / 2,808 assertions.
This includes all 47 new privilege/sign-up regressions. The predecessor catalog
after grant reproduction matches all 190 hosted entries, including ACL entries
compared as sets. The corrected catalog and SQL tests prove owner EXECUTE access
is retained and anonymous/service execution is removed from the named commands.

Both runs pass historical preservation/replay acceptance, the full web gate
(445 shared and 1,163 web tests, types, lint, production build and bundle checks),
source-before/after equality, unchanged HEAD, and disposable Docker cleanup.
Schema lint reports 23 existing diagnostics across eight functions, zero errors.
No application Edge source changed since the separately passing 1,617-test suite.
CI `34620298898` passed all four jobs on `5f7b12e942eb6dc8b615dd7795ec94fc3a3664e6`.
The permission correction is locally verified; its own publication/CI and all
hosted application, table/RLS/Storage parity and recovery gates remain separate.
