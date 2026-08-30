# Phase L0.2 — Immutable Ledger Persistence and Versioned Compatibility Foundation Handoff

- **Recorded:** 25 August 2026 (Australia/Melbourne)
- **Status:** implemented and verified locally; owner review required before L0.3 or any protected action
- **Workflow/claim ID:** `01a02f99-b81f-7102-ab15-f9b5a4a7a9e4`
- **Predecessor foundation workflow ID:** `01a02eca-55a4-79f3-926a-09c32df95900`
- **Repository:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Git common directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git`
- **Worktree and durable output directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`
- **Branch:** `reliably-prompTED`
- **HEAD and comparison base:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Build command:** `pnpm verify:web`
- **Configured web build directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/apps/web/.next`

The PrompTED owner accepted the fresh local F0 evidence and separately instructed Codex to proceed with L0.2. That authority covered local implementation and individual verification of the persistence/version foundation. It did not authorize live ledger selection, compatibility adapters, historical conversion, application workflow testing, a commit, push, pull request, hosted migration, deployment, production change, or L0.3.

## What Changed

L0.2 adds an expand-only, dormant persistence foundation for a future immutable document ledger:

1. A private immutable ledger-version store with server-calculated contract hashing, conflict detection, and service-only idempotent registration.
2. A private immutable generation-snapshot store keyed by user and generation request, with exact replay and changed-input conflict handling.
3. An intentionally dormant activation-pointer table with no enabled row and no activation RPC.
4. Explicit `legacy_unversioned` and `captured` identity seams on existing document, section, artifact, and block stores. Existing and newly inserted legacy rows remain unversioned; no identity is inferred or backfilled.
5. Service-only artifact/block binding RPCs and authenticated owner-scoped edit and approval RPCs with exact artifact and block revision checks.
6. Captured-write guards, approval invalidation on edit, required-section state enforcement, append-only captured artifact versions, and export-provenance fields.
7. Shared TypeScript persistence-boundary types and validators.
8. A focused 60-assertion pgTAP contract suite, expanded shared ledger tests, and updated standalone compatibility/profile guards.
9. ADR, matrix, audit, and continuity evidence recording the implemented boundary and the still-unimplemented live behaviour.

No production ledger row was registered. No activation pointer was enabled. No current catalogue/profile key was renamed or transformed. None of the 18 approved mappings runs at runtime.

## Why

Section-key authority cannot safely enter persistence, replay, repair, approval, or export until PrompTED can prove which immutable ledger, generation snapshot, section identity, and revision owns a piece of user content. Without that boundary, a future split, merge, rename, or semantic replacement could silently detach edits, overwrite approved content, replay stale work, or export a different revision.

The selected design extends the existing user-content stores instead of replacing them. That keeps historical documents readable exactly as stored and creates an explicit version boundary for future captured documents without guessing metadata for current rows.

## Product-Purpose Alignment

- **Target user/segment:** non-expert outcome owners, including job seekers and small operators, who must reopen, edit, approve, repair, replay, and export consequential documents without understanding database or ledger migrations.
- **Real-world problem:** structural migration can otherwise cause lost text, blank sections, incorrect section identity, stale approval, or export of the wrong revision.
- **Intended completed outcome:** future captured documents retain one immutable contract and generation snapshot, and every accepted edit or approval remains attributable to an exact revision while historical documents continue to reopen unchanged.
- **Outcome-progression step:** `Final user-ready documents → Review and approval → Persistence and export evidence`.
- **Burden or risk reduced:** the user does not have to reconstruct lost wording or detect a silent migration error; unsupported identities and stale operations fail closed.
- **Evidence:** a fresh local database applied the 24-migration chain; 60 database assertions exercised immutable registration, replay, binding, edit, approval, stale-write, and direct-write rejection; focused shared/profile/compatibility checks passed; source tracing found no live generation, Workspace, Find a Role, export, workflow, or deployment import of the L0.2 boundary.
- **Unverified assumptions:** production cohort size and historical key distribution, hosted PostgreSQL behaviour, signed-in application behaviour, actual export artifacts, and provider/production performance remain unverified.

## Council Challenge

- **Strategist:** create one private immutable version authority while retaining existing artifact/document stores as the user-content authority.
- **Skeptic:** never infer historical identity; hash immutable snapshots; reject changed replay, stale edits, stale approvals, direct captured writes, unknown keys, and mismatched requiredness.
- **Creative:** add dormant identity and transformation seams now so approved adapters can be implemented later without selecting the 86-profile shadow registry.
- **Operator:** use one expand-only migration and standalone local tests so the proposal can be reviewed and discarded before any hosted mutation.
- **Audience Advocate:** keep historical content visible as stored and prevent future captured content from being silently blanked, re-keyed, overwritten, approved, or deleted outside its revision boundary.

**Chosen position:** extend the existing persistence model with private immutable contracts and snapshots, explicit legacy/captured identity, and expected-revision RPCs.

**Strongest rejected alternative:** create a replacement ledger-native document schema and immediately backfill existing rows.

**Deciding trade-off:** the replacement could be conceptually simpler after a full migration, but current rows do not contain enough durable key/version identity for a non-lossy backfill. The additive design preserves compatibility and defers consolidation until every persisted cohort and consumer can be proven migrated.

## Files Changed for L0.2

- `supabase/migrations/20260825090000_immutable_document_ledger_persistence.sql` — immutable ledger/snapshot tables, dormant activation seam, additive identity/provenance fields, RLS/grants, write guards, and version/revision RPCs.
- `supabase/tests/immutable_document_ledger_persistence.test.sql` — standalone 60-assertion pgTAP persistence, replay, RLS/RPC, immutability, concurrency, edit, approval, and rollback-seam contract.
- `packages/shared/src/document-ledger.ts` — versioned persistence identity and revision-state types plus fail-closed validation helpers.
- `packages/shared/src/document-ledger.test.ts` — focused persistence-boundary validation cases; nine shared ledger tests in total.
- `supabase/functions/_shared/document-intelligence-profiles-v2.ts` — shadow guard updated to recognise the locally implemented L0.2 state while requiring every live-integration flag to remain false.
- `docs/architecture/ADR-002-immutable-ledger-persistence-and-versioned-compatibility-foundation.md` — authoritative L0.2 design, challenge, controls, evidence, rollback, and next gate.
- `docs/architecture/ADR-001-section-key-authority-and-compatibility.md` — records the later F0 acceptance and local L0.2 implementation without changing the approved compatibility decision.
- `docs/architecture/document-section-key-compatibility.proposed.json` — records the accepted F0 gate, locally implemented L0.2 evidence, exact test counts, and false live-integration flags.
- `scripts/check-section-key-compatibility.mjs` — validates the authorised L0.2 record, evidence paths/counts, and false live-implementation claims.
- `scripts/check-section-key-compatibility.test.mjs` — 31 success/negative validator cases, including rejection of a false live-L0.2 claim.
- `docs/quality/2026-08-24-reliably-prompted-architecture-compliance-audit.md` — L0.2 Council Challenge and evidence-state addendum.
- `docs/quality/2026-08-24-reliably-prompted-architecture-rebuild-handoff.md` — continuation provenance and phase-boundary addendum.
- `docs/quality/2026-08-24-recovery-foundation-successor-handoff.md` — owner acceptance and L0.2 successor-gate addendum.
- `docs/quality/2026-08-25-immutable-ledger-persistence-foundation-handoff.md` — this durable handoff.

No GitHub workflow, package-script integration, runtime template selector, live profile definition, Workspace component, Find a Role component, library hook, export renderer, or deployment contract was changed by L0.2.

## Testing Performed

All Node checks were run from the reported `reliably-prompTED` worktree at uncommitted HEAD `e7f4e37e3087ee166c16ab242b17c60b3877f16b`.

### Toolchain

- `node --version` → `v22.23.2`
- `pnpm --version` → `10.33.0`
- `supabase --version` → `2.114.0`
- Docker engine → `29.7.2`

### Database and focused contracts

- `supabase start` → passed; a fresh local stack applied all 24 migrations.
- `supabase test db --local supabase/tests/immutable_document_ledger_persistence.test.sql` → passed, 60/60 assertions.
- `supabase stop --no-backup` → passed; the disposable local test database was stopped without retaining data.
- `pnpm check:migrations` → passed, 24 migrations.
- `pnpm --filter @prompted/shared exec vitest run src/document-ledger.test.ts` → passed, 9/9 tests.
- `pnpm --filter @prompted/shared test` → passed, 119/119 tests.
- Focused shared type-check and lint commands → passed.

### Compatibility and profile checks

- `node --test scripts/check-section-key-compatibility.test.mjs` → passed, 31/31 tests, including all deliberate invalid variants.
- `node scripts/check-section-key-compatibility.mjs` → passed; 86 catalogue templates, 86 Enhanced DIPs, 68 exact matches, and exactly the approved 18 conflicts.
- JSON parse validation for `docs/architecture/document-section-key-compatibility.proposed.json` → passed.
- Focused Deno formatting, lint, and checking for the V2 profile and ledger-adapter files → passed.
- Focused Deno tests → passed, 19/19 tests: 14 V2 profile tests and 5 adapter tests.

### Repository gate

- `pnpm check:encoding` → passed.
- `pnpm check:instructions` → passed.
- `git diff --check` → passed.
- `pnpm verify:web` → passed under Node `v22.23.2` and pnpm `10.33.0`, covering 34 deployment/security tests, 47 root tests, 119 shared tests, 374 web tests, lint, type-check, and a 28-route Next.js production build.

The web run emitted the inherited JSDOM navigation diagnostic while its related tests passed. The build emitted the existing Supabase Edge Runtime warning and completed successfully.

### Build evidence

- **Output:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/apps/web/.next`
- **Tracking:** ignored by Git; not durable source or release evidence.
- **Build ID:** `6PV0uZDPsnqpVsex2fTGn`
- **Observed size:** `479M`
- **Observed completion time:** `2026-08-25 19:13:03 AEST`

This proves a local regression build from the identified dirty `reliably-prompTED` worktree. It is not CI, preview, staging, hosted Supabase, Netlify, signed-in workflow, persistence, export-artifact, or production evidence.

## Results

- **Implemented:** L0.2 source and documentation exist in the reported local worktree.
- **Verified locally:** fresh 24-migration application; 60/60 pgTAP assertions; 9/9 focused and 119/119 full shared tests; 31/31 compatibility-validator tests; 19/19 Deno shadow tests; JSON, encoding, instruction, migration and diff checks; complete `pnpm verify:web` regression gate.
- **Verified in CI:** Unverified. No workflow was dispatched and no commit exists for hosted CI.
- **Workflow exercised:** the individual architecture/database review workflow only—fresh migration, immutable registration, exact replay, changed-input conflict, artifact/block binding, edit, stale-edit rejection, approval, direct-write rejection, and revision-snapshot inspection. No application workflow was exercised, as required by the current standalone-only testing policy.
- **Hosted:** Unverified. No hosted database, function, Netlify, GitHub setting, branch, pull request, or provider state was mutated.
- **Production:** Unverified. No production data, workflow, export, or deployment was exercised.
- **Blocked:** L0.3 and every live-integration or protected action remain blocked pending a separate owner authorization.
- **Unverified:** signed-in UI behaviour, production cohorts, historical-key distributions, hosted migration behaviour, actual export artifacts, and application persistence/reopen behaviour.

## UI/Workflow Verification

No live UI behaviour was changed. Master Workspace, Find a Role, document-library reopening, and export rendering were not exercised. The authorised review workflow was deliberately individual and database-focused: regenerate/validate the 86/68/18 inventory; compare matrix and ADR; apply the migration to a fresh local stack; exercise immutable registration, replay, binding, edit, approval, stale-write, and direct-write controls; inspect stored revisions; and confirm no live import or activation path was introduced.

## Regression Review

- **Generation imports:** exact searches found no live import of the V2 profile registry, ledger adapter, new migration RPCs, or persistence validators.
- **Catalogue/profile definitions:** current live catalogue and Enhanced DIP definition files were not rewritten; the 86-profile shadow remains isolated.
- **Persistence:** existing rows and new legacy-path inserts remain `legacy_unversioned`; no backfill or guessed key/version occurs. Captured rows fail closed unless explicitly bound.
- **Replay and repair:** immutable generation snapshots reject changed input under a reused request identity; runtime replay/repair integration remains unimplemented.
- **Master Workspace:** no component or hook changed; future captured edits have a revision-safe database boundary but no UI caller yet.
- **Find a Role:** no component, role-folder behaviour, or template selection changed.
- **Library reopening:** no hook changed; legacy reads remain unchanged and captured reopen integration remains future work.
- **Exports:** export history can record ledger/revision validation provenance, but current renderers and callers are unchanged and actual artifacts were not inspected.
- **Tests and fixtures:** L0.2 adds only focused shared, Deno-shadow, compatibility, and local pgTAP evidence. No application workflow or CI wiring was added.
- **Node 22 gate:** the full local web regression gate passed under the required release toolchain.
- **Hosted changes:** none.

## Remaining Risks

1. The inherited `ted_artifact_blocks_own` RLS policy self-references the same table and produced an infinite-recursion error during a direct authenticated-update probe. Captured edits use the new owner RPC, and the captured-write trigger was independently exercised as the privileged database role; the inherited policy still needs a separately scoped review.
2. Production cohort sizes, historical key distributions, and hosted PostgreSQL behaviour have not been inspected.
3. PostgreSQL `jsonb` canonical text is the hash boundary used locally. A later external registrar must calculate the same canonical representation or use a narrowly controlled registration service.
4. Generation snapshots must remain minimum-necessary metadata and must not become a duplicate store of sensitive uploads.
5. L0.3 must prove non-lossy rename, split, merge, semantic-replacement, and new-section projections with source identity, deterministic ordering, approval conflict handling, rollback, and no model redistribution.
6. The complete dirty recovery/foundation diff remains uncommitted and has no hosted review or CI evidence.

## Continuity and Provenance

- **Canonical remote:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Git common directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git`
- **Exact worktree:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`
- **Durable output directory:** the exact worktree above; all source, ADR, matrix, tests, audit, and handoff files are retained there.
- **Workflow ID:** `01a02f99-b81f-7102-ab15-f9b5a4a7a9e4`
- **Branch:** `reliably-prompTED`
- **HEAD:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Comparison base:** local `reliably-prompTED` at the same checkpoint; the task continues identified owner-authorized uncommitted recovery work.
- **Configured build/output directories:** `apps/web/.next`, ignored and worktree-local. pnpm's dependency store is shared tooling state, not deployable output.
- **Status before L0.2:** dirty identified recovery work; 18 tracked paths modified/deleted, 19 untracked paths, 0 staged paths.
- **Status after L0.2 handoff:** dirty identified recovery work; 18 tracked paths modified/deleted, 21 untracked paths, 0 staged paths. Exact final status must be re-read before any later task because the entire diff remains user-owned and uncommitted.
- **Claim status:** bounded L0.2 claim retained through final verification and released at this terminal handoff gate; any later phase requires a fresh or resumed claim check.
- **Protected actions:** no commit, push, branch switch, pull request, merge, rebase, workflow dispatch, hosted migration, deployment, provider mutation, or production action occurred.

## 26 August 2026 Cross-Day Resume Verification

The interrupted L0.2 task was resumed in the same worktree, branch, HEAD and claim. The four owner decisions were already durably recorded and were not rewritten: `interview-script.candidate_questions` and `interview-script.closing` remain optional new canonical sections, `job-follow-up-email.sign_off` remains a separately stored required section for new immutable versions, and `terms-of-employment.acknowledgement` remains jurisdiction-controlled and optional in the generic contract.

Fresh local verification under Node `v22.23.2`, pnpm `10.33.0`, Deno `2.9.5`, Supabase CLI `2.114.0` and Docker `29.7.2` produced:

- 24 migrations applied from scratch to a disposable local Supabase stack;
- 60/60 focused pgTAP persistence assertions passed;
- 31/31 compatibility-validator tests, the direct 86/86/68/18 validator and JSON parsing passed;
- 9/9 focused shared ledger tests, shared type-check and shared lint passed;
- 19/19 focused Deno shadow-profile and adapter tests plus scoped format, lint and check passed;
- exact searches again found no live L0.2/V2 consumer, activation RPC, enabled pointer, package-script integration or GitHub workflow integration;
- `pnpm verify:web` passed with 34 deployment/security tests, 47 root tests, 119 shared tests, 374 web tests, lint, type-check and a 28-route production build;
- the disposable Supabase stack was stopped with `--no-backup`; no synthetic database state was retained.
- the test-created `supabase/.branches/_current_branch` local CLI marker was removed; the final recovery worktree contains 18 tracked modified/deleted paths, 23 untracked files and 0 staged paths.

The refreshed ignored build output is `apps/web/.next`, build ID `jnx59vUPSkx8qwJB1WqhW`, observed size `480M`, completed at `2026-08-26 05:27:32 AEST`. This remains local build evidence only. No application workflow, hosted environment or production behaviour was exercised.

## Next Gate

The proposed next task is:

```text
Phase L0.3 — Version-Aware Compatibility Adapters and Migration Rehearsal
```

L0.3 is not authorized by this handoff. If separately approved, it should implement and individually test representative one-to-one rename, one-to-many split, many-to-one merge, semantic-replacement, and approved new-section adapters against synthetic local fixtures. It must preserve source identity, content, order, revisions, approval conflicts, provenance, rollback, and historical rendering; unsupported mappings must fail closed; no model may redistribute historical prose.

No live key, hosted database, generation path, export path, application workflow, Git branch, or remote repository was mutated by L0.2.
