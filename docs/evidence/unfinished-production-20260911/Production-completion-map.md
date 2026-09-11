# PrompTED.AI · Production completion map

12 September 2026 · integrated local gate update; 11 September commercial requirements retained

**Status: not yet production accepted.** Evidence-backed remaining-work register, including implementation gaps and unverified gates. Not a claim that every listed area is defective or that the application is ready. The JSON and viewer are documentation snapshots, never runtime state.

Open [the interactive brain map](production-completion-map.html). Its filters and dependency links are read-only; they cannot mark work complete.

## Target and authority

Owner authorises required local/GitHub/Netlify/Supabase/Docker configuration and release work. Preserve user data and verify exact outcomes.

- Repository/branch: `voltlead26-creator/PrompTED.AI` / `Thought-Enhanced-Document`.
- Local and GitHub HEAD freshly matched: `c329e58f8b8d03ff93ceb0577cb11e784b885f69`; uncommitted overlay remains.
- Netlify production re-read: `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`, locked deploy `6a9fc526610f2efb8c05454f`.
- Supabase migration list refreshed on 12 September: the exact 68 recorded versions still match. Prior function inventory: 25 functions. Local has 87 migration files; the latest repair migration is locally verified and not deployed.
- Reference atlas: supplied `PrompTED-audited-atlas-bundle`, pinned to `0b9dbc1a`; retained as historical source guidance.

## Current product decision

Owner 1,000 documents/month. Business allowance equals Premium; Business $50/user/month, Premium $40/month. Exact Pro/Premium document caps and billing currency still need resolution.

## Execution order

Correct owner/paid access and finish retry contracts → integrated local gates → rehearse hosted upgrade and configure genuine model inputs → deploy compatible backend → publish exact reviewed frontend → exercise real persistence, recovery, billing and exports → monitor and refresh release evidence.

Do not infer progress percentages from task counts. P0 means a release or operational acceptance gate; P1 means performance or operational work required before the full operational claim. Historical plans are evidence inputs and may be superseded.

## 01 · Complete product work

### P1 · Finish DOCX source binding

**Locally verified · P0** · Depends on: none

52 SQL assertions pass; service-only binding remains dormant. This is not an active Word editor or export path.

**Complete when:** Review final migration; pass upgrade, schema lint and concurrency/replay checks; integrate only supported source workflows.

[Source / evidence](../../../supabase/migrations/20260910060401_dormant_docx_source_binding.sql)

### P2 · Connect original upload to supported review

**Unverified · P0** · Depends on: P1, B2, B3

Current source includes upload checkpoints and retained-text review; deployed backend is behind. Format preservation and safe unsupported-format behaviour need live proof.

**Complete when:** Upload supported DOCX/RTF/TXT/MD and relevant PDF fixtures; reopen after reload; preserve original bytes, source identity and honest extraction limits.

[Source / evidence](../../../docs/evidence/web-operational-readiness/Master-Import-Format-Preservation.md)

### P3 · Verify document workflow and feature readiness

**Unverified · P0** · Depends on: G2, B3

An endpoint being active does not establish an operational feature. Research, live-source, reports and billing have readiness constraints.

**Complete when:** Trace exposed routes to real capabilities; complete required paths or present exact unavailability without fabricated results. Keep scope explicit for dormant Word editing and billing.

[Source / evidence](../../../docs/plans/2026-09-10-architecture-validation-release.md)

### P4 · Finish cross-account and stale-result review

**Locally verified · P0** · Depends on: none

Account/library and gateway fixes are committed at c3c2ef6; polling additions and owner access are committed at c1cabb6 and locally tested.

**Complete when:** Review integrated lifetimes for TED guidance, profile, library and workspace; prove sign-out/account change cannot retain or overwrite another user’s state.

[Source / evidence](../../../docs/evidence/frontend-library-20260911/Audit.md)

## 02 · Plans, owner & billing

### A1 · Apply owner allowance: 1,000/month

**Locally verified · P0** · Depends on: none

User correction at 23:17 AEST supersedes unlimited owner access. SQL draft now uses a finite 1,000 cap and correct subscription period mapping; all 52 SQL files / 2,730 assertions pass; no hosted owner grant exists.

**Complete when:** One trusted Auth UUID receives all product features and exactly 1,000 monthly documents; billing truth, RLS, rate limits and usage accounting stay intact.

[Source / evidence](../../../supabase/migrations/20260911130803_effective_owner_product_access.sql)

### A2 · Resolve paid document caps

**Needs decision · P0** · Depends on: none

Business must equal Premium. Existing backend Pro/Premium caps are 20/40; UI advertises 50/unlimited. The owner was asked for exact Pro/Premium allowances.

**Complete when:** Record the selected numeric allowances and make SQL, Edge, shared definitions, meters and upgrade copy agree.

[Source / evidence](../../../packages/shared/src/plans.ts)

### A3 · Integrate one effective-access response

**In progress · P0** · Depends on: A1, A2

Database, account UI and Edge guard share a validated owner-aware projection. Combined gate passed 1,609 Edge, 445 shared and 1,163 web tests plus production build; source hashes stayed unchanged. Hosted deployment and real browser acceptance remain pending.

**Complete when:** Fail closed on malformed/error responses; test exact user binding, revocation, cap boundary, concurrent reservations, replay and unchanged subscription history.

[Source / evidence](../../../supabase/functions/_shared/auth-guard.ts)

### A4 · Implement commercial billing truth

**Pending · P0** · Depends on: A2, A3

User sets Premium $40 and Business $50 per user/month, with the same document cap and extra business features. Checkout integration is dormant; currency and live product setup require verification.

**Complete when:** Use existing RevenueCat authority; verify currency, real offerings, seat identity, branded entitlements, webhook ordering, cancellation and reconciliation before accepting payments.

[Source / evidence](../../../apps/web/src/lib/revenuecat.ts)

### A5 · Grant and verify the owner profile

**Pending · P0** · Depends on: A3, B2, B3

Configuration authority is now supplied; the exact confirmed owner UUID must still be securely resolved.

**Complete when:** Merge only the versioned owner marker into existing app_metadata; read it back; verify account UI and actual allowance admission without impersonating a paid subscriber.

[Source / evidence](../../../docs/plans/2026-09-06-owner-access-and-generation-retry-protection.md)

## 03 · Reliable generation

### G1 · Bound automatic browser observation

**Locally verified · P0** · Depends on: none

19 component tests and the complete web gate pass for five failed reads/two-minute ceilings; actual browser exercise remains.

**Complete when:** Exercise timeout, hung reads, cancellation, terminal state, reload and manual GET-only recovery; no poll should restart provider work.

[Source / evidence](../../../apps/web/src/components/organisms/CapturedAdmission.tsx)

### G2 · Persist operation-wide failure budgets

**In progress · P0** · Depends on: none

Legacy and captured preparation/dispatch guards pass the combined local gate: 54 SQL files / 2,761 assertions and 1,617 Edge tests. Historical captured failures without dispatch evidence still need acceptance work. The section-repair guard passes real SQL lifecycle, full Edge/web gates and both current upgrades; hosted and browser acceptance remain.

**Complete when:** Enforce through existing operation/attempt authorities across reloads, tabs and restarts. Preserve partial work; reconcile ambiguous dispatch and stop after cancellation or budget exhaustion.

[Source / evidence](../../../docs/plans/2026-09-06-owner-access-and-generation-retry-protection.md)

### G3 · Configure real model routing and capacity

**Pending · P0** · Depends on: C1, B2

10 September live attestations were unconfigured for four routes. Routing/evaluation/capacity inputs must be refreshed and completed.

**Complete when:** Verify actual model access, bounded capacity and evaluation results for fast/deep/research/review; derive fingerprints from real evidence, preserve authorised fallback restrictions.

[Source / evidence](../../../supabase/deployment-contract.json)

### G4 · Prove recovery and exactly-once usage

**Unverified · P0** · Depends on: G1, G2, G3

A provider response or HTTP 200 does not prove persisted generation. Interruption and settlement need integrated acceptance.

**Complete when:** Interrupt accepted/dispatched/persisting phases; test worker expiry, duplicate requests, retries, cancellation, partial persistence and one settlement per exact operation.

[Source / evidence](../../../scripts/verify-live-document-generation.mjs)

## 04 · Supabase compatibility

### B1 · Reconcile hosted schema and inventory

**Confirmed gap · P0** · Depends on: none

Live migration refresh on 12 September matches the exact recorded 68 versions. Local has 87 migrations; last hosted function inventory had 25. Counts and version names do not prove schema-byte equality.

**Complete when:** Compare ordered ledger, function bodies, grants, RLS, Storage and non-secret catalog attestations; retain a private baseline and explicit migration delta.

[Source / evidence](../../../supabase/deployment-contract.json)

### B2 · Rehearse and apply compatible upgrade

**In progress · P0** · Depends on: B1, P1, A3, G2, Q1

Both 79-to-87 workspace and 68-to-87 recorded-production-history rehearsals pass, preserving original bytes and historical receipts. Schema lint has zero errors and 23 older warnings. No new migration is applied live; hosted catalog and backup/recovery checks remain.

**Complete when:** Run fresh and old-to-new upgrade checks plus schema lint; confirm recovery/backup evidence; apply additive migrations in order and re-probe exact signatures and privileges.

[Source / evidence](../../../docs/evidence/web-operational-readiness/run-isolated-db-baseline.mjs)

### B3 · Deploy required Edge Functions

**Confirmed gap · P0** · Depends on: B2, G3, C1

Live list lacks extract-upload, document-operation and brand-logo. Hosted legacy/dormant functions also need contract disposition.

**Complete when:** Deploy exact reviewed contract closures; compare deployed content/version; prove auth, internal service boundaries, upload and generation RPC availability.

[Source / evidence](../../../scripts/deploy-contract-functions.mjs)

### B4 · Resolve undeclared or dormant endpoints

**Pending · P0** · Depends on: B1

Hosted list includes legacy provider proxy endpoints. The release inventory rejects undeclared functions and requires dormant functions absent.

**Complete when:** Trace live callers and dependencies; close obsolete exposure with a documented target/recovery plan; retain historical provider provenance and required APIs.

[Source / evidence](../../../scripts/backend-release-baseline.mjs)

## 05 · Environment & services

### C1 · Reconcile local and hosted configuration

**In progress · P0** · Depends on: none

Local root dotenv contamination repaired: runtime settings separated, public duplicates checked, conflicting operator copies privately retained. Environment check and 14 regressions pass. Hosted configuration and candidate credential validity remain unverified.

**Complete when:** Public NEXT_PUBLIC values only in web dotenv; private runtime values in ignored Supabase dotenv; operator credentials in ignored tools dotenv. Align service/project/origin mappings without printing secrets.

[Source / evidence](../../../scripts/check-web-build-environment.mjs)

### C2 · Verify Auth, origins and public access

**Unverified · P0** · Depends on: C1

Netlify connector reports password protection on all projects; intended public-launch access and Auth redirects need a logged-out test.

**Complete when:** Verify signup/signin/verification/recovery, allowed origins, redirect URLs, logout, session expiry and expected public access without bypassing account permissions.

[Source / evidence](../../../supabase/config.toml)

### C3 · Stabilise Docker and local verification

**Partially verified · P1** · Depends on: none

Earlier CPJ failures were caused by host sleep during local Supabase startup/reset. Caffeinate -u -i allowed a complete isolated run.

**Complete when:** Keep tests on disposable containers/ports; preserve shared data; record versions, cleanup and unchanged source hashes. Use bounded jobs that survive client exit.

[Source / evidence](../../../docs/evidence/unfinished-production-20260911/Work-plan.md)

## 06 · Integrated verification

### Q1 · Pass the complete integrated source gate

**In progress · P0** · Depends on: P1, P4, A3, G1, G2

Current owner, polling, dormant DOCX and legacy-budget implementation passes fresh SQL, all Edge tests and the complete web gate with unchanged source hashes. Both 87-migration upgrades pass locally. CI 34617376047 passes for c329e58; the new repair slice still needs publication and CI; three pre-existing extra Edge lint diagnostics are recorded.

**Complete when:** Run focused/adjacent tests, all SQL, migration upgrades/lint, all Edge tests/types, web/shared/root tests, lint, types, build and bundle budgets; review final diff and source integrity.

[Source / evidence](../../../scripts/verify-web-release.mjs)

### Q2 · Exercise desktop/mobile browser failures

**Pending · P0** · Depends on: Q1

Earlier library CI covered Chromium/Firefox/WebKit at 320/390/1440 widths; new changes need integrated browser acceptance.

**Complete when:** Test keyboard, focus, touch targets, responsive navigation, network loss, stale tabs, malformed responses, timeouts, retry and cancellation without cross-user leakage.

[Source / evidence](../../../scripts/verify-library-browser.mjs)

### Q3 · Review security and cleanup boundaries

**Pending · P0** · Depends on: Q1, B1

Source review alone cannot prove hosted grants or safe errors. Cleanup must retain originals and useful recovery evidence.

**Complete when:** Review auth/RLS/grants, uploads, export URLs, secrets, private caching and dependency advisories. Keep categorised source/docs/tests separate from ignored archives and runtime files.

[Source / evidence](../../../docs/REPOSITORY-GUIDE.md)

## 07 · Speed & usability

### F1 · Isolate and fix library layout shift

**Confirmed gap · P1** · Depends on: none

Three signed-in desktop reloads on e1d514d each measured CLS 0.163. Component versus extension cause is not yet isolated.

**Complete when:** Capture shift sources in controlled and normal profiles; repair the responsible layout; rerun cold/warm desktop/mobile measurements with stable reserved layout.

[Source / evidence](../../../docs/evidence/unfinished-production-20260911/Production-verification.md)

### F2 · Measure full workflow responsiveness

**Unverified · P1** · Depends on: F1, Q2

Median desktop library LCP was 1,640 ms; this does not establish mobile, INP, load capacity or all-route performance.

**Complete when:** Measure navigation, library, upload, editor and generation start; separate API time, rendering, JS and provider latency; check bundle/long-task/query budgets and pagination.

[Source / evidence](../../../scripts/check-progressive-bundles.mjs)

### F3 · Verify production capacity and limits

**Unverified · P1** · Depends on: G3, B3

No current throughput or concurrent-owner performance acceptance is recorded.

**Complete when:** Use bounded representative concurrency; record p50/p95 latency, errors, rate limiting, memory and capacity exhaustion recovery without uncontrolled provider spending.

[Source / evidence](../../../supabase/deployment-contract.json)

## 08 · Publish & deploy

### R1 · Commit reviewed source and verify exact CI

**In progress · P0** · Depends on: Q1, Q2, Q3

Local/GitHub match c329e58. All four jobs in CI 34617376047 passed, including real local upload/Profile/tEdit browser acceptance. The section-repair guard is a new uncommitted slice and has no CI or production acceptance yet.

**Complete when:** Stage only reviewed files; commit/push Thought-Enhanced-Document; inspect required CI at that exact SHA; resolve failures without weakening checks.

[Source / evidence](../../../.github/workflows/ci.yml)

### R2 · Deploy compatible frontend after backend

**Confirmed gap · P0** · Depends on: R1, B3, B4, C2

Live Netlify aiprompted remains locked to deploy 6a9fc526610f2efb8c05454f at e1d514d.

**Complete when:** Preserve rollback deploy, pass release probes, deploy reviewed SHA via existing workflow, verify published identity and gateway behaviour; change deployment lock only at release transition.

[Source / evidence](../../../scripts/deploy-netlify-production.mjs)

### R3 · Record release and refresh source atlas

**Pending · P1** · Depends on: R2, U1, U2, U3, U4

User-supplied audited atlas is pinned to 0b9dbc1a, not current local/source/production.

**Complete when:** Regenerate immutable-commit manifest and source map after sync; verify hashes, links and navigation; record backend/frontend versions and actual acceptance evidence.

[Source / evidence](../../../docs/plans/2026-09-10-architecture-validation-release.md)

## 09 · Real user outcomes

### U1 · Prove save, reload and account library

**Partially verified · P0** · Depends on: R2, A5

One real-account bookmark save/reload/remove/reload/restore passed on old production; document wording persistence and new release remain unproven.

**Complete when:** Use a labelled test document in the real signed-in workflow: save edits, reload, reopen from My Work/Saved; independently read the exact revision and confirm account isolation.

[Source / evidence](../../../docs/evidence/unfinished-production-20260911/Production-verification.md)

### U2 · Prove clarification and generation outcome

**Unverified · P0** · Depends on: R2, G4, P2

Full facts → clarification → confirmed knowledge → generated document acceptance is outstanding for the release.

**Complete when:** Confirm material facts; invalidate confirmation on changes; produce persisted sections tied to the operation; exercise reload/retry/cancel and safe recovery with real bounded provider calls.

[Source / evidence](../../../scripts/verify-live-document-generation.mjs)

### U3 · Prove review, approval and real export

**Unverified · P0** · Depends on: U2

Gateway receipt propagation is locally repaired. Download success does not prove exact approved wording or a valid artifact.

**Complete when:** Edit and save a revision, approve explicitly, export supported formats; inspect actual file bytes/pages/wording/branding and captured receipt. Reject stale approvals and unsupported PDF paths honestly.

[Source / evidence](../../../scripts/verify-live-document-review.mjs)

### U4 · Verify business branding and billing

**Unverified · P0** · Depends on: R2, A4

Business price/allowance semantics are newly clarified; real seat, branding and entitlement behaviour still needs end-to-end proof.

**Complete when:** Verify per-user entitlement, logo/colour/footer persistence, export branding, correct offers and sandbox purchase/webhook/cancel lifecycle before live checkout activation.

[Source / evidence](../../../supabase/functions/webhooks-revenuecat/index.ts)

## 10 · Operate & maintain

### O1 · Verify monitoring and recoverable errors

**Unverified · P1** · Depends on: R2

Operational health, alert delivery and redacted correlation evidence need a current review.

**Complete when:** Observe one bounded failure and recovery through logs/UI; identify exact operation and release without sensitive content; confirm actionable alerting and support diagnostics.

[Source / evidence](../../../docs/plans/2026-09-06-web-operational-readiness-evidence.md)

### O2 · Rehearse rollback and data recovery

**Unverified · P0** · Depends on: B1

A retained Netlify deployment is only frontend recovery; database and Storage recovery must be established separately.

**Complete when:** Confirm available backups and retention; rehearse compatible restore/roll-forward in isolation; preserve live history and document exact rollback triggers and targets.

[Source / evidence](../../../scripts/deploy-netlify-production.mjs)

### O3 · Finish folder organisation and handoff

**Partially verified · P1** · Depends on: R3

Historical verification cleanup already archived 6,443 ignored files with hash checks. Final release evidence and new map need coherent indexing.

**Complete when:** Keep source/config at framework-required paths; category-index relevant docs/tests/evidence, preserve referenced atlas and originals, remove only verified obsolete duplicates and temporary outputs.

[Source / evidence](../../../docs/REPOSITORY-GUIDE.md)
