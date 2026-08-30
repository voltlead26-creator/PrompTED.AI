# `reliably-prompTED` Architecture Rebuild — Continuity Handoff

**Recorded:** 24 August 2026 (Australia/Melbourne)
**Workflow ID:** `01a029df-a620-7e23-bcf6-7bea2617354b`
**Status:** bounded foundation and architecture work implemented locally; L0.1/L0.1A owner-approved and individually verified; wider 15-task rebuild incomplete; no commit, push, PR, merge, deployment, migration, or hosted configuration mutation

## What changed

1. Installed the expanded current PrompTED Codex Instruction Bible as the sole root `AGENTS.md`, with one reviewed repository-local addendum.
2. Added an enforced tracked-file check and four regression tests so competing nested `AGENT.md`, `AGENTS.md`, or `CLAUDE.md` files fail the normal gate.
3. Audited all 583 tracked files at the exact `reliably-prompTED` base and recorded reusable theory, contract drift, release risks, and the evidence-backed 15-task count.
4. Rewrote the canonical architecture as a long-lived system design covering the runtime ledger, facts/evidence, durable generation, transactions, idempotency, billing, clarification, quality, persistence, export, Workspace, Find a Role, security, observability, adoption, verification, and rollback.
5. Reduced GitHub Actions to three owned workflows: read-only CI, one serialized production release owner, and narrowly permissioned stale-item housekeeping.
6. Removed branch-writing controllers, duplicate validation routes, shared-production “staging,” the independent function deployment bypass, and stale repair automation.
7. Hardened production sequencing, exact ref/target validation, credential order, function-name validation, and shell-free contract-driven deployment.
8. Included the focused generation/review harness in the ordinary root test/release gate.
9. Reclassified conflicting old architecture/readiness documents as historical or scoped evidence.
10. Added the first Phase L0 shadow slice: shared cross-runtime ledger contracts, deterministic fail-closed validation, a five-category draft pilot cohort, and an exact 18-mismatch audit. It is deliberately disconnected from live generation.

## Why

`reliably-prompTED` contains valuable intelligence, placeholder, validation, repair, import, and workflow theory, but it does not meet the governing runtime, persistence, export, release, or evidence contracts. The safe recovery path is bounded extraction into a clean branch based directly on `reliably-prompTED`, not bulk-copying a dirty checkout or using the frozen recovery branch as ancestry.

The strongest rejected alternative was copying the architecture spike into production. Its pure contracts prove useful concepts, but its in-memory store and isolated unexported types would create another authority without transaction, RLS, outbox, crash-recovery, billing, adapter, or live-workflow proof.

## Product-purpose alignment

- **Target user:** non-expert job seekers, small operators, and people completing consequential documents or administrative outcomes.
- **Problem:** fluent output can appear complete while facts, persistence, approval, export, or external state is absent or inconsistent.
- **Intended outcome:** TED moves the user from situation and evidence through necessary clarification, safe documents/actions, durable review, approval, export, and visible completion evidence.
- **Progression improved:** this slice strengthens the foundation between action/document intent and trustworthy evidence/completion state.
- **Risk reduced:** one instruction authority, one release route, explicit deployment identity, fail-closed hostile-input checks, and a single migration target reduce hidden user and operator uncertainty.
- **Evidence:** exact-base audit, deterministic guards, tests, Edge checks, and local production build listed below.
- **Unverified assumption:** no market, conversion, hosted reliability, or production-completion claim was inferred from local source or tests.

## Canonical repository and worktree identity

| Field | Verified value |
|---|---|
| GitHub remote | `https://github.com/voltlead26-creator/PrompTED.git` |
| Canonical repository | `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED` |
| Git common directory | `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git` |
| Stable worktree / durable output | `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED` |
| Branch | `reliably-prompTED` |
| Base branch | `reliably-prompTED` |
| Base and current uncommitted HEAD | `e7f4e37e3087ee166c16ab242b17c60b3877f16b` |
| Production branch observation | `origin/ClaudeTED.AI` at `1f408b631a3dc190bc67ec953c7322c8f3189576` |
| Build command | `pnpm verify:web` under Node `v22.23.2`, pnpm `10.33.0` |
| Build output | ignored `apps/web/.next`, build ID `hPFE3FqeUSuuGtlajMfDX`, about `430M` |

The destination was clean before the bounded patch was applied. It remains dirty only because the reviewed successor work is intentionally uncommitted.

The owner-supplied `PrompTED.worktrees/PrompTED-reliably-prompTED` directory and ZIP were not modified. The directory is an extracted snapshot without Git metadata, not a branch/worktree. The dirty architecture-spike checkout and both mistakenly created successor worktrees were preserved and were not represented as final output.

## Files changed

- Instruction authority: `AGENTS.md`; `scripts/check-agent-instructions.mjs`; `scripts/check-agent-instructions.test.mjs`; `package.json`.
- Retained workflows: `.github/workflows/ci.yml`; `.github/workflows/deploy-prod.yml`; `.github/workflows/stale.yml`.
- Removed workflows: `.github/workflows/apply-enhanced-dip-core.yml`; `apply-enhanced-dip-runtime-contract.yml`; `apply-resume-information-contract.yml`; `deploy-staging.yml`; `deploy-supabase-functions.yml`; `document-generation-recovery-contract.yml`; `reconcile-enhanced-dip-upload.yml`; `reconcile-enhanced-dip-visible.yml`; `repair-stack-ci.yml`; `verify-workplace-governance-per-profile.yml`.
- Release code/tests: `scripts/check-deployment-contract.mjs`; `scripts/check-deployment-contract.test.mjs`; `scripts/deploy-contract-functions.mjs`; `scripts/deploy-contract-functions.test.mjs`; `scripts/probe-supabase-contract.mjs`; `scripts/probe-supabase-contract.test.mjs`.
- Architecture/governance: `README.md`; `docs/00-TABLE-OF-CONTENTS.md`; `docs/06-PRODUCTION-READINESS-OVERVIEW.md`; `docs/IMPLEMENTATION_PLAN.md`; `docs/CANONICAL_ARCHITECTURE.md`; `docs/quality/2026-08-24-reliably-prompted-architecture-compliance-audit.md`; this handoff.
- Runtime-ledger shadow slice: `packages/shared/src/document-ledger.ts`; `packages/shared/src/document-ledger.test.ts`; `packages/shared/src/index.ts`; `supabase/functions/_shared/document-ledger-adapter.ts`; `supabase/functions/_shared/document-ledger-adapter.test.ts`.

Removed workflow files remain recoverable from Git history. No application feature source, user document, migration, secret, or hosted resource was deleted.

## Testing performed and results

| Check | Exact corrected-worktree result |
|---|---|
| `pnpm install --frozen-lockfile` | passed; lockfile unchanged; existing `unrs-resolver@1.12.2` build script remained unapproved |
| sole instruction guard | passed; root `AGENTS.md` only; 4 tests passed |
| controlling Instruction Bible prefix | passed; SHA-256 `ffa0779398e4b373e155f32501c702a45fda4bab73d0bd6f8d954b3ad88706d5` |
| workflow actionlint/YAML | passed for all three retained workflows |
| `git diff --check` | passed |
| focused Deno lint | passed for 8 changed/added scripts/tests |
| deployment/security tests | 34 passed, 0 failed |
| generation/review harness | 9 passed, 0 failed in focused execution and included in root gate |
| deployment contract | passed for 24 functions |
| shared ledger contract tests | 5 passed, 0 failed |
| ledger shadow-adapter tests | 5 passed, 0 failed; five-category draft pilot cohort compiles and the exact 18-mismatch inventory remains visible |
| focused ledger/adaptor Deno lint | passed; the new Edge files add no raw Deno findings |
| Edge Function type-check | four repaired entry paths passed |
| ledger shadow-adapter type-check | passed |
| Edge Function tests | 218 passed, 0 failed |
| `pnpm verify:web` | passed under Node `v22.23.2`, pnpm `10.33.0` |
| root tests inside full gate | 47 passed, 0 failed |
| shared tests | 115 passed, 0 failed |
| web tests | 374 passed, 0 failed |
| workspace lint/types | passed |
| Next.js 15 production build | passed; 28 routes generated/analysed |
| raw `deno lint supabase/functions scripts` | **blocked:** 81 inherited findings across 132 files; the new ledger/adaptor files add zero findings |

The web suite emitted its existing JSDOM navigation diagnostic while the related tests passed. The build emitted existing webpack cache-size and Supabase Edge Runtime warnings before compiling successfully. These are recorded observations, not hidden failures and not hosted/browser proof.

One advisory Node `v26.7.0` run failed 15 existing local-storage tests because Node 26 exposed an unavailable global web-storage surface ahead of JSDOM. No product or test code was changed for that advisory-runtime incompatibility. The required Node `v22.23.2` gate was then run fresh and passed all 374 web tests and the production build.

## UI and workflow verification

Automated tests exercised Workspace, Find a Role, persistence error messaging, recovery controls, accessibility, sanitisation, generation streams, output integrity, and route compilation.

No signed-in browser journey, real provider call, live database persistence, role-folder reopen, save/reopen/edit/approve/export flow, actual export artifact inspection, mobile-device journey, staging environment, or production recovery was exercised.

## Regression review

- Imports, lint, types, shared/web tests, Edge checks, and Edge tests passed.
- Static release validation proves verify-before-mutation order, exact production ref, exact target validation, named contract deployment, least privilege, and non-cancelling release serialization.
- Useful specialised tests remain reachable through root tests or CI Edge tests after unsafe controller workflows are removed.
- Build output remained inside this worktree's ignored `apps/web/.next` and did not alter tracked source.
- No responsive/live-browser claim is made beyond automated component coverage.

## Remaining risks and next gates

The programme remains **2 of 15 locally implemented, 0 of 15 production-proven**. This branch is not the completed rebuild.

Required remaining work:

1. resolve the 81 raw Deno lint findings through bounded ownership and a reviewed import-map migration rather than suppressing the rules;
2. expand the draft shadow ledger through the representative pilot cohort, resolve all 18 catalogue/profile key mismatches through explicit compatibility decisions, then introduce versioned persistence before any live enforcement;
3. add schema/function compatibility and fresh-database proof;
4. implement atomic generation, durable state, replay, stale-write protection, and billing coupling;
5. make export reload exact persisted approved revisions and inspect actual artifacts;
6. make Workspace and Find a Role consume durable ledger/revision state and prove role-folder/original-resume lineage;
7. obtain hosted CI, branch-protection, environment, and isolated-host evidence;
8. exercise complete, missing, conflicting, timeout, persistence-failure, repair, approval, export, and rollback journeys;
9. conduct controlled promotion and production verification only after those gates.

The immediate safe next gate is owner review of this uncommitted diff. Commit, push, PR, merge, migration, and deployment remain separate protected actions requiring current authorization and readiness evidence.

## Phase L0.1 continuation — owner-approved section-key authority

### Continuity and ownership

- **Workflow ID:** `01a029df-a620-7e23-bcf6-7bea2617354b` (durable rebuild workflow); coordination claim `01a02f99-b81f-7102-ab15-f9b5a4a7a9e4` was reused for bounded ADR, matrix, validator/tests and handoff integration follow-ups and released at each terminal handoff gate.
- **Worktree/branch/HEAD/base:** the bounded artifacts are now in the primary worktree from the identity table above; uncommitted HEAD remains `e7f4e37e3087ee166c16ab242b17c60b3877f16b` on `reliably-prompTED`.
- **Dirty state:** this was an owner-authorised continuation of the existing dirty recovery workflow. At entry to the owner-approval follow-up there were 18 tracked changes, 19 untracked files and no staged changes. At this handoff the counts remain 18 tracked changes, 19 untracked files and no staged changes because the decision update modified only nine already-changed or already-untracked files. Existing staged, unstaged and untracked work was preserved. No clean, stash, reset, switch or unrelated reformat occurred.
- **Output/build location:** durable source remains this worktree; the configured ignored build output remains `apps/web/.next`. The owner-approved decision remains standalone and is not wired into GitHub Actions, package scripts, release workflows or live document workflows.

### Compatibility decision record

The current checkout deterministically contains 86 catalogue templates and 86 enhanced/passed Document Intelligence Profiles. Sixty-eight ordered section-key arrays match; exactly the expected 18 differ. On 25 August 2026 the PrompTED owner accepted ADR-001: one immutable versioned ledger, future profile keys as candidate canonical identities, and permanent historical reads for catalogue identities while referenced.

The accepted decision preserves historical section rows, content, order, version history and approval state. Splits never silently redistribute prose. The `promotion-case` merge has deterministic ordering, heading, duplicate, approval-conflict, provenance and rollback rules. Four profile-only additions are approved as `new_canonical_section`: optional `candidate_questions`, optional interview `closing`, required follow-up-email `sign_off`, and jurisdiction-controlled employment `acknowledgement`.

### Evidence and testing

- **Implemented locally:** accepted ADR, owner-approved JSON matrix, standalone validator, 30 individual validator tests, Profile V2 decision projection, audit and handoff update.
- **Verified locally:** validator regenerates the 86/86/68/18 inventory, accounts for every current and proposed key, checks source/consumer paths, and rejects all required deliberately invalid variants.
- **Workflow exercised:** representative rename (`business-email`), split (`cover-letter`), merge (`promotion-case`) and new canonical sections (`interview-script`, `job-follow-up-email`, `terms-of-employment`) were traced through definitions, generation, exact-key profile validation, repair, persistence, Workspace, library and export.
- **Verified in CI:** unverified.
- **Hosted/production:** unverified; no hosted mutation.

The owner-approval update uses Node `v22.23.2`, pnpm `10.33.0` and Deno `2.9.5`. The direct validator passes with 86 catalogue templates, 86 enhanced profiles, 68 exact matches and 18 owner-approved conflicts. Individual compatibility tests pass 30/30, including owner-approval/authority policy, exact new-section requiredness, non-lossy history and jurisdiction-authority failures. Profile V2 tests pass 14/14 with the four resolved requiredness policies. JSON parse, encoding, instruction authority and `git diff --check` are rechecked before handoff. The earlier target-worktree `pnpm verify:web` gate passed—34 deployment/security tests, 47 root tests, 115 shared tests, 374 web tests, lint, type-check and a 28-route Next.js build. Its ignored output is in `apps/web/.next`, build ID `BkyAc4x6uRwrkkTqKWIF6`, 429M. That earlier gate is not represented as testing this later owner-decision update; compatibility and Profile V2 tests remain individually invoked and intentionally absent from workflow wiring.

### Owner decisions recorded

On 25 August 2026 the owner approved Alternative C, candidate canonical sets, permanent historical aliases, split/merge rules, the four new-section policies, re-approval behaviour and adapter removal gates. This records architecture approval only; it does not imply live conflict migration, F0 acceptance, L0.2 authorization, commit, hosted review or deployment.

### Bible-integrated step sequence and testing boundary

The durable sequence is now:

```text
L0.1 section-key decision (owner approved locally; live implementation not authorised)
→ L0.1A all-86 Profile V2 shadow restructuring (owner approved as shadow architecture; live integration not authorised)
→ F0 recovery-foundation successor acceptance (locally applied to reliably-prompTED; uncommitted and owner review pending)
→ L0.2 immutable persistence/version foundation (not authorised)
→ L0.3 adapters and local migration rehearsal (deferred)
→ L0.4 representative cohort shadow validation (deferred)
→ L1 first application workflow exercise (explicit owner gate)
→ L2 all-86 cohort expansion and CI/runtime enforcement (explicit owner gate)
→ L3 bypass removal and controlled release (separate protected actions)
```

Current testing mode is `standalone_individual_only`. Compatibility tests and Profile V2 Deno tests are invoked directly. They are not wired into package scripts, GitHub Actions, CI, release workflows, live generation or user-facing workflow tests. The machine-readable matrix validator fails if the current plan prematurely authorizes CI or application-workflow testing. Eventual workflow testing is deferred to L1, not removed.

### Foundation dependency and exact next gate

Read-only continuity refresh on 25 August 2026 confirmed that the Recovery Foundation Successor remains at `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor`, on `codex/recovery-foundation-successor` at `e7f4e37e3087ee166c16ab242b17c60b3877f16b`, with its locally verified changes still dirty and uncommitted. Its Git common directory differs from the `reliably-prompTED` target. The bounded foundation files and the workflow-authority cleanup required by their checker were then applied through exact local patches to the clean target worktree.

The immediate dependency remains **F0 — Recovery Foundation Successor acceptance**, but its source is now locally placed in `reliably-prompTED`. F0 requires owner review of the exact target diff and current local verification. Commit, push, pull request, hosted CI, merge, deployment and production promotion remain separately gated.

ADR/Profile V2 approval is now recorded. Only after F0 completion and separate owner authorization does the next ledger implementation task become **Phase L0.2 — Immutable Ledger Persistence and Versioned Compatibility Foundation**. That separate task may design and locally implement the approved persistence/version boundary, migration ordering, RLS/RPC controls, replay rules and fresh-local-database proof. It is not authorised by this handoff.

### Target-branch review verdicts

- **Document Quality — PASS:** all 86 V2 profiles remain shadow-only; required-section, clarification, source, quality and historical-key rules are machine validated without changing generated documents.
- **Builder — PASS:** Node syntax, JSON parsing, shared lint/type-check/tests, Deno format/lint/check/tests, repository-wide `actionlint`, deployment reconciliation and the production web build passed in the target worktree.
- **Systems — PASS:** the foundation centralises the production release chain, validates target identity before mutation and removes independent deployment routes; no persistence or billing claim is introduced by the shadow ledger.
- **Architect — PASS:** one accepted future immutable ledger authority is retained, compatibility mappings are version-bound, and the V2 registry and adapter are not imported by live generation.
- **Workflow — PASS:** no user journey or application workflow is changed; clarification, approval, replay and export remain explicit later gates rather than being falsely claimed.
- **Compliance — PASS:** hostile URL/function input is rejected before credential-bearing operations, shell evaluation is disabled for derived deployment arguments and no user document content is added to logs or fixtures.
- **Product Identity — PASS:** TED remains the sole product intelligence and the accepted decision is framed around protecting non-technical users' content, approvals and completed outcomes.
- **UI — not required for this batch:** no interface, copy, navigation or responsive behaviour changed.

## 25 August 2026 — L0.2 continuation handoff

The earlier “F0 pending / L0.2 not authorised” statements above describe the prior gate and are superseded for local sequencing only. On 25 August 2026 the owner accepted the fresh F0 evidence and instructed Codex to proceed with L0.2. Commit, push, PR, hosted CI, merge, deployment and production promotion remain separately protected and were not authorised.

L0.2 is now implemented and verified locally in this same `reliably-prompTED` worktree at uncommitted HEAD `e7f4e37e3087ee166c16ab242b17c60b3877f16b`. The durable decision is `docs/architecture/ADR-002-immutable-ledger-persistence-and-versioned-compatibility-foundation.md`; the durable phase handoff is `docs/quality/2026-08-25-immutable-ledger-persistence-foundation-handoff.md`.

The local foundation adds immutable private ledger contracts, immutable generation snapshots, explicit `legacy_unversioned`/`captured` persistence identity, dormant activation state, service-only binding, owner-scoped stale-write and approval RPCs, append-only captured artifact revisions, provenance seams and export revision metadata. Existing historical rows are not backfilled or re-keyed. No live ledger is registered or activated; no compatibility adapter or application workflow is connected.

Fresh local verification applied all 24 migrations from scratch and passed 60/60 pgTAP assertions plus 9/9 focused shared contract tests. Compatibility and V2 tests remain individually invoked, and the current application-workflow-testing boundary remains closed until L1. The next proposed task is **L0.3 — Version-Aware Compatibility Adapters and Migration Rehearsal**, which remains owner-gated and unauthorised.
