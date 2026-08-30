# `reliably-prompTED` Architecture Compliance Audit and Extraction Record

- **Audit date:** 24 August 2026 (Australia/Melbourne)
- **Comparison branch:** `origin/reliably-prompTED`
- **Comparison commit:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Current target worktree:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`
- **Current target branch:** `reliably-prompTED`
- **Canonical remote:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Git common directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git`
- **Workflow ID:** `01a029df-a620-7e23-bcf6-7bea2617354b`
- **Status:** audit and bounded successor extraction implemented and verified locally; L0.1/L0.1A owner-approved on 25 August 2026; wider rebuild incomplete

No commit, push, pull request, merge, deployment, hosted migration, secret change, environment change, or other hosted mutation was performed.

## 1. Authority and branch correction

The user supplied two related instruction sources:

| Source | Lines | SHA-256 | Determination |
|---|---:|---|---|
| `/Users/kaichurchw/Downloads/prompted-codex-instruction-bible_2.md` | 2,259 | `6b700529a0a04f2e876874530e63b1f96c9bf715e103928febd99f480b3ba52c` | older attached comparison source |
| current expanded instruction bible at `/Users/kaichurchw/.codex/.chatgpt-projects/g-p-69fcca63e8f08191927ec7a86f3aab0e/prompted-codex-instruction-bible-updated.md` | 3,142 | `ffa0779398e4b373e155f32501c702a45fda4bab73d0bd6f8d954b3ad88706d5` | controlling revision |

The expanded revision adds product-purpose authority, conflict rules, branch/worktree continuity, build attribution, untrusted-input policy, explicit section states, export integrity, observability/privacy, benchmark governance, and staged adoption/change control. Installing the older attachment verbatim would remove those stronger current requirements.

The controlling revision is therefore installed byte-for-byte at the beginning of the sole root `AGENTS.md`, followed by one reviewed repository-local addendum. The ordinary lint gate now rejects any tracked nested `AGENT.md`, `AGENTS.md`, or `CLAUDE.md`.

The verified integration/base branch is `reliably-prompTED`. The corrected successor was created directly from `origin/reliably-prompTED` at `e7f4e37`. `ClaudeTED.AI` remains the production branch; it is not the rebuild base.

## 2. Correct repository and source preservation

The canonical repository root is:

`/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`

It was clean on `reliably-prompTED` at `e7f4e37e3087ee166c16ab242b17c60b3877f16b`. The corrected successor was created as a linked worktree under the exact owner-supplied `PrompTED.worktrees` directory. Its remote is exactly `https://github.com/voltlead26-creator/PrompTED.git`.

The same owner-supplied directory also contains `PrompTED-reliably-prompTED` and `PrompTED-reliably-prompTED.zip`. The directory copy has no `.git` metadata and is therefore an extracted snapshot, not a branch or registered worktree. Its ZIP comment identifies the same `e7f4e37` revision. Neither the extracted copy nor ZIP was modified or represented as Git evidence.

### Additional dirty architecture-spike source

The named Architecture Rebuild clone is:

`/Users/kaichurchw/PrompTED - Historical/PrompTED - Architecture Rebuild`

At correction time it was dirty on `codex/ted-ledger-architecture-spike` at `66b7881ff9bd1152b6f10fc310ef03d52e96551b`, with:

- modified `_redirects` containing an invalid machine-local line;
- untracked `docs/architecture/`;
- untracked `docs/quality/2026-08-19-ted-ledger-architecture-spike.md`;
- untracked `packages/shared/src/architecture-spike/`.

That checkout was treated as read-only source material. It was not cleaned, switched, stashed, reset, committed, or rewritten.

The corrected clean worktree shares the canonical repository's Git common directory at `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git` and preserves the requested repository lineage. It does not share Git metadata with, branch from, or modify the dirty architecture-spike clone, and it does not use the frozen `codex/recovery-workflow-hardening` branch as ancestry.

## 3. Audit coverage

The comparison tree contained 583 tracked files:

| Top-level path | File count |
|---|---:|
| `apps` | 309 |
| `supabase` | 125 |
| `docs` | 55 |
| `scripts` | 30 |
| `packages` | 27 |
| `.github` | 14 |
| `tests` | 4 |
| root/configuration | 19 |

“Cross-check all files” was implemented as a complete tracked-file inventory, repository-wide deterministic scans, and targeted architectural traces. It is not represented as a manual semantic review of every line.

Coverage included:

- every tracked path and instruction-like filename;
- every GitHub Actions trigger, permission, shell block, branch-write route, deployment command, and secret interpolation surface;
- package scripts, workspaces, build configuration, deployment manifests, and output paths;
- all catalogue entries, section keys, DIPs, information contracts, benchmarks, examples, fixtures, and profile validators;
- generation, clarification, placeholder, repair, persistence, billing, export, Workspace, Find a Role, role-folder, and API paths;
- migrations, RPC/security-definer declarations, RLS references, and direct client DML surfaces;
- documentation authority and time-sensitive completion/deployment claims;
- existing tests and the Node 22/pnpm 10.33.0 release contract.

## 4. Summary verdict

`origin/reliably-prompTED` does **not** comply with the Instruction Bible as a deployable complete system.

It contains substantial useful document-intelligence, placeholder, validation, repair, import, and workflow theory. Those assets should be adapted behind one immutable runtime ledger and durable server-owned workflow, not copied into a second production pipeline.

### Evidence-backed 15-task count

- **2 of 15** reliability-recovery tasks have a locally implemented foundation result in the corrected successor: evidence/audit baseline and deployment compatibility/release hardening.
- **0 of 15** has current end-to-end production completion proof.
- Historical or dirty code, isolated architecture-spike tests, local builds, and prior green checks are not counted as hosted or production completion.

| Task | Evidence-backed status |
|---:|---|
| 1. Evidence baseline and ledger | implemented locally as audit/handoff evidence; runtime ledger not implied |
| 2. Deployment compatibility contract | implemented and verified locally in the corrected worktree; hosted execution remains unverified |
| 3. Schema/function compatibility | blocked/unverified; no hosted apply evidence |
| 4. Provider stability | partial; retry/health concepts exist without the complete capability/durability contract |
| 5. Immutable generation snapshot and idempotency | not complete in production runtime |
| 6. Recoverable generation state machine | not complete in production runtime |
| 7. One generation and repair authority | not complete; authorities and paths diverge |
| 8. Runtime-neutral placeholder/content contract | partial; shared ledger types, fail-closed validation, and one draft resume shadow contract are implemented locally, but the live paths still diverge |
| 9. Evidence before drafting | partial; source precedence and provenance requirements are represented in the draft shadow ledger, but no authoritative durable fact/evidence snapshot exists in the live path |
| 10. Converge or disable parallel pipelines | not complete |
| 11. Server persistence and export authority | not complete |
| 12. Bundle reduction and dead-code removal | not complete |
| 13. Local and CI integration environment | partial; the Node 22 local gate exists, while raw Deno lint has 81 inherited findings across 132 files and hosted isolation remains incomplete |
| 14. Flagship resume proof | failed/unverified current |
| 15. Controlled release and production verification | not started for this successor |

## 5. Reusable implementation and theory

| Area | Evidence | Disposition |
|---|---|---|
| Repository lineage | correct remote and production history | retain |
| Catalogue identity | 86 unique templates and 307 catalogue sections; no duplicate keys/orders within one template | migrate into ledger identity/display fields |
| DIP coverage | 86 profiles with information contracts, quality rules, benchmarks, examples, fixtures, and internal-review state | adapt into versioned ledger and approved benchmark assets |
| Missing-fact theory | typed placeholder metadata, contextual questions, shared resolution keys, neutral replacements | migrate into explicit input, clarification, and section-state contracts |
| No-blank safeguards | delivery guard, content checks, deterministic fallbacks, section-scoped quality gate | retain behind ledger authority |
| Targeted repair | affected-section rewrite while preserving safe sections | retain with optimistic concurrency |
| Atomic import | idempotent document-import RPC and original-file preservation | use as transaction-pattern reference |
| Export safety pieces | approval gate, placeholder/content validation, sanitisation | retain inside persisted-approved-revision boundary |
| Role intent | save role, action plan, tailored resume, cover letter, apply link, original-resume copy | connect to durable role folders and lineage |
| Deployment contract | manifest, migration/RPC/route reconciliation | retain and harden |
| Runtime ledger shadow slice | shared cross-runtime types, fail-closed validator, draft resume compiler, exact 18-mismatch inventory | retain as the Phase L0 migration seam; do not treat it as live ledger enforcement |

### Phase L0 continuation implemented locally

The successor now contains the first non-user-facing runtime-ledger slice:

- `packages/shared/src/document-ledger.ts` defines the versioned, serializable cross-runtime template, input, clarification, section, source, validation, persistence, export, benchmark, and test-case contracts.
- The shared validator fails closed on missing versions, template identity drift, duplicate keys/orders, unknown input or section references, dependency cycles, required-section omission, silent blanks, invalid source precedence, missing persistence/export guarantees, unapproved or missing benchmarks, and missing active-template test cases.
- `supabase/functions/_shared/document-ledger-adapter.ts` is an intentionally unreferenced shadow adapter. It compiles only requested, exact-key-compatible catalogue/DIP pairs and does not change live generation output.
- A five-category representative cohort compiles as `draft` under ledger version `2026-08-24.shadow.1`: resume, selection-criteria response, moving-house checklist, complaint letter, and high-risk incident/near-miss report. The resume's existing six catalogue and DIP section keys match exactly.
- The adapter exposes the existing 18 catalogue/profile section-key mismatches deterministically and rejects compilation when keys diverge.

This is migration infrastructure, not a completed runtime ledger. No live generator, persistence path, Workspace screen, export path, billing path, or provider path consumes the new contract yet.

## 6. Architecture-spike theory ingested

The isolated 19 August spike was reviewed as theory, not production code. Its useful findings are adopted into `docs/CANONICAL_ARCHITECTURE.md`:

1. exact versioned profile/ledger identity;
2. source-backed typed facts and explicit contradictions;
3. confirmation that only affirms presented facts and never fills missing facts from a generic “yes”;
4. supersession for corrections instead of contradictory transcript accumulation;
5. immutable generation snapshots with exact fact-record IDs;
6. bounded section concurrency;
7. persist-before-event ordering and committed-event delivery;
8. exact declared placeholders and blocked generation facts;
9. section-isolated recoverable failure;
10. idempotent resume that reuses accepted siblings;
11. zero-usable-section failure rather than false success;
12. stale-write protection that turns late automated output into a suggestion.

The spike code was **not copied** into the successor because it is an unexported, in-memory experimental parallel model based on an older production snapshot. Its own handoff requires transactional persistence, outbox/reconnect behavior, stale-worker rejection, crash recovery, atomic allowance finalisation, a real DIP adapter, RLS tests, and a feature-flagged pilot before production wiring.

The dirty `_redirects` machine-local path was rejected entirely.

## 7. Blocking findings on `reliably-prompTED`

### F1 — Competing template/section authorities

Catalogue JSON, Edge DIPs/information contracts, and fallback templates can each influence structure. The client may supply sections and the server accepts them. Eighteen of 86 catalogue/profile pairs have different section-key sets.

### F2 — Universal runtime ledger absent

Across 86 catalogue entries, none declares the required immutable ledger version, lifecycle, source policy, persistence policy, export policy, template test cases, or complete section missing-information/quality state in one shared runtime shape.

### F3 — Generation success is not an atomic durable result

The Edge Function can emit completion before client-side document/section persistence. Document and section writes are separate, and billing is not atomically coupled to durable result commit.

### F4 — Primary generation is not a resumable durable state machine

The current document path remains one long request with heartbeats. Private artifact-generation tables do not make the primary path resumable.

### F5 — Export trusts caller-supplied final bodies

Useful server checks exist, but authenticated export can still accept document content from the request instead of loading the exact persisted approved revision. Export history is best-effort.

### F6 — Parallel pipelines remain asymmetric

Document, artifact, checklist, report, and edit paths do not share one complete generation, persistence, validation, and output contract.

### F7 — Unsafe and duplicative workflows

The base contained branch-writing/controller automation with `contents: write`, bot commits, rebases, broad staging, automatic conflict resolution, and pushes, plus duplicate validation paths.

### F8 — Deployment bypass and hostile-name boundary

An independent function-deployment workflow bypassed the main release gate, while function names could cross a shell boundary from repository-derived workflow output.

### F9 — “Staging” shared production resources

The base staging workflow documented a shared production Supabase project and mutated a staging branch. That is not isolated staging.

### F10 — Documentation authority drift

Multiple documents claimed canonical/authoritative status while disagreeing on templates, branches, providers, deployment routes, and completion state.

### F11 — Raw Deno lint baseline red

The corrected-worktree repository-wide command reports 81 findings across 132 checked files. The two added instruction-check files and two added ledger-adapter files account for the increased scanned-file count, not new diagnostics; all newly added or changed in-scope scripts and adapter files pass focused Deno lint. The inherited findings cannot be hidden by focused passes.

### F12 — Find a Role role folders incomplete

Schema and UI intent exist, but durable creation/reopen of the full role bundle and original/derived resume lineage are not proven end to end.

### F13 — Master Workspace not ledger-driven end to end

Useful editor, preview, version, approval, import, and recovery pieces exist, but section identity/state and approval are not universally tied to one immutable ledger/document revision.

### F14 — No current production outcome proof

The latest retained live benchmark contains failed/blocked resume and cover-letter outcomes. No newer signed-in production save/reopen/edit/approve/export artifact evidence was obtained.

## 8. Bounded successor extraction

The corrected successor applies only reviewed foundation/design changes:

1. expanded controlling Instruction Bible installed as the sole root `AGENTS.md`;
2. durable CI guard preventing competing instruction files;
3. one read-only CI authority and one serialized production deployment owner;
4. branch-writing, duplicate, stale repair, shared-production staging, and independent deployment workflows removed;
5. exact production-ref and Supabase-target validation before mutation or credential-bearing request;
6. strict function-name validation and shell-free argument-array deployment;
7. generation/review harness included in the ordinary root gate;
8. long-lived canonical architecture rewritten around one ledger, facts/evidence, durable operations, atomic persistence, revision approval, server-owned export, recovery, privacy, observability, adoption, and rollback;
9. stale “canonical” documents explicitly reclassified;
10. this audit and a corrected continuity handoff stored in the correct worktree.

These changes do not implement the runtime ledger, migrations, generation transaction, role-folder workflow, or production proof.

## 9. Verification record

The original results were observed in the architecture source worktree. The proposal and shadow files have now been applied locally to `reliably-prompTED` at uncommitted HEAD/base `e7f4e37`; current target-worktree results are recorded below after fresh verification.

| Check | Result |
|---|---|
| sole `AGENTS.md` guard | passed; root `AGENTS.md` only; 4 regression tests passed |
| controlling instruction hash/prefix | passed; installed prefix SHA-256 `ffa0779398e4b373e155f32501c702a45fda4bab73d0bd6f8d954b3ad88706d5` |
| workflow YAML/actionlint | passed for the three retained workflows |
| changed-script syntax and focused Deno lint | passed for 8 changed/added scripts/tests under Deno 2.9.5 |
| deployment/security tests | 34 passed, 0 failed |
| generation/review harness | 9 passed, 0 failed in focused execution and included in root gate |
| deployment contract reconciliation | passed for 24 declared functions |
| Edge Function checks/tests | 4 repaired entry paths checked; 213 tests passed, 0 failed |
| Node 22/pnpm 10.33.0 `pnpm verify:web` | passed: 47 root tests, 110 shared tests, 374 web tests, lint, type-check, and Next.js production build |
| build output | ignored `apps/web/.next`; build ID `7s6E9XMGhtcwfPW6xi6H8`; about 366M; 24 August 2026 03:26:57 AEST |
| raw repository-wide Deno lint | blocked: 81 inherited findings across 132 checked files; the new ledger/adaptor files add zero findings |
| signed-in browser/persistence/export | unverified; not exercised |
| hosted CI/configuration | unverified; branch not pushed |
| Supabase/Netlify staging or production | unverified; no hosted mutation authorized |

## 10. Protected stop boundary

Stop before committing, pushing, opening a PR, merging, promoting to `ClaudeTED.AI`, changing GitHub settings/secrets/environments, applying hosted migrations, or deploying Supabase/Netlify. Each requires its own current authorization and readiness evidence.

## 11. Phase L0.1 — owner-approved section-key authority and compatibility decision

### Scope and evidence state

This continuation addresses only the 18 known catalogue/profile section-key conflicts. It records the owner-approved ADR, machine-readable matrix, and standalone fail-closed validator with individual tests. It does not rewrite the 86 live Enhanced Document Intelligence Profiles, connect the shadow ledger, change catalogue keys, alter persistence, modify document workflows, change CI/release workflows, deploy, or migrate data.

- **Implemented:** owner-approved compatibility decision, matrix, validator and individual failure-fixture tests exist locally.
- **Verified locally:** live inventory is 86 catalogue templates, 86 enhanced/passed profiles, 68 exact key matches and exactly 18 conflicts; the standalone validator and its 30 individual tests pass under Node `v22.23.2` with pnpm `10.33.0`.
- **Verified in CI:** unverified; no commit or push.
- **Workflow exercised:** owner-decision review workflow only—inventory regeneration, matrix comparison, key accounting, representative rename/split/merge/new-section review, ADR/JSON comparison, invalid-variant rejection and live-import regression inspection.
- **Blocked:** live implementation remains blocked by F0 completion, separate L0.2 authorization and the unimplemented persistence/version boundary.
- **Unverified:** hosted and production behaviour; persisted cohort sizes; signed-in save/reopen/edit/approve/export; actual export artifacts.

### Council Challenge result

- **Strategist:** establish one immutable versioned ledger and retain captured historical identities.
- **Skeptic:** wholesale key replacement could orphan content, misroute placeholders/repair, reset approval or export the wrong structure.
- **Creative:** catalogue keys remain historical aliases while richer profile sections become future-version candidates.
- **Operator:** a standalone decision record and validator are reviewable and reversible without a hosted mutation or workflow wiring.
- **Audience Advocate:** preserve existing content, history, approval and exports; require user judgment for non-deterministic conversion.

The owner-approved position is Alternative C, a versioned ledger with explicit mappings. The strongest rejected alternative is Alternative A, retaining catalogue keys as the permanent canonical authority; it has the lowest migration risk but cannot express the richer section contracts. Wholesale profile-key replacement remains rejected as unsafe.

### Files added or updated for L0.1

- `docs/architecture/ADR-001-section-key-authority-and-compatibility.md` — accepted decision and separate implementation gate.
- `docs/architecture/document-section-key-compatibility.proposed.json` — 18-template mapping and traced consumer evidence.
- `scripts/check-section-key-compatibility.mjs` — live 86/86 inventory and fail-closed owner-approved decision validation.
- `scripts/check-section-key-compatibility.test.mjs` — individual positive and deliberate negative cases.
- this audit and the durable rebuild handoff — continuity, evidence and next gate.

### Owner decisions recorded and next gate

On 25 August 2026, the PrompTED owner approved Alternative C, every candidate future canonical key set, permanent historical-read aliases, non-model split conversion, the `promotion-case` merge, user-visible re-approval and adapter removal criteria. Four profile-only additions are now `new_canonical_section`: optional `interview-script.candidate_questions`, optional `interview-script.closing`, required `job-follow-up-email.sign_off`, and jurisdiction-controlled `terms-of-employment.acknowledgement` that is optional in the generic contract and required only by an approved jurisdiction-specific immutable contract.

The next ledger implementation gate after completion of the separate F0 recovery-foundation acceptance gate and a separate owner authorization is **Phase L0.2 — Immutable Ledger Persistence and Versioned Compatibility Foundation**. Live adapters, database/version persistence, migrations, RLS/RPC controls, replay rules and fresh-local-database verification remain unimplemented and unauthorised.

### L0.1 verification record

| Check | Local result on `reliably-prompTED` at uncommitted HEAD `e7f4e37` |
|---|---|
| runtime | Node `v22.23.2`; pnpm `10.33.0`; Deno `2.9.5` |
| individual compatibility tests | 30 passed, 0 failed; success case, every required deliberate failure family, owner-approval/authority policy, exact new-section requiredness, historical and jurisdiction enforcement, repository-path containment, exact `reliably-prompTED` provenance, exact adoption-step enforcement, rejection of premature CI/application-workflow authorization and rejection of false foundation/hosted claims |
| direct compatibility validator | passed: 86 catalogue templates, 86 enhanced profiles, 68 exact matches, 18 owner-approved conflict decisions |
| JSON parse | passed for the owner-approved matrix |
| `pnpm check:encoding` | passed |
| `pnpm check:instructions` | passed |
| `git diff --check` | passed |
| current `pnpm verify:web` regression gate | passed: 34 deployment/security tests, 47 root tests, 115 shared tests, 374 web tests, lint, type-check and 28-route Next.js build |
| build output | ignored `apps/web/.next`; build ID `BkyAc4x6uRwrkkTqKWIF6`; 429M; 25 August 2026 01:00:09 AEST |
| decision integration | deliberately absent: no compatibility/Profile V2 package script, GitHub Actions hook, generation, persistence or export import |
| hosted/production | unverified; no hosted action occurred |

## 12. Bible-integrated ledger adoption steps

The owner requested that the consolidated root `AGENTS.md` be integrated into the recovery steps and that current profile/compatibility testing remain individual rather than workflow-wired. The ADR and matrix now encode the resulting sequence:

1. **L0.1 — owner approved locally; live implementation not authorised:** section-key authority, 18-conflict mappings and standalone validation.
2. **L0.1A — owner approved as shadow architecture; live integration not authorised:** all 86 Enhanced DIPs compile into an isolated V2 shadow representation with 68 exact structures, 18 compatibility-governed structures and four resolved new-section policies.
3. **F0 — locally applied to `reliably-prompTED`; acceptance pending:** independently review the exact target diff and fresh local evidence. Commit, push, pull request, hosted CI, merge, deployment and production promotion remain distinct protected gates.
4. **L0.2 — not authorised:** immutable ledger/version persistence, provenance, RLS/RPC controls, stale-write protection, replay identity and fresh-local-database proof.
5. **L0.3 — deferred:** version-aware adapters and synthetic local migration/rollback rehearsal for representative rename, split, merge and new-section cases.
6. **L0.4 — deferred:** standalone representative-cohort shadow validation across concise, evidence-rich, list/structured, emotionally sensitive and high-risk profiles.
7. **L1 — deferred explicit owner gate:** first application workflow exercise and one-cohort runtime shadow.
8. **L2 — deferred explicit owner gate:** cohort expansion across all 86 profiles and later single-authority runtime/CI enforcement.
9. **L3 — deferred protected actions:** bypass removal, controlled hosted validation and release.

### Current testing boundary

- **Implemented:** the matrix records `standalone_individual_only` as the current mode.
- **Verified locally:** the standalone validator rejects missing adoption steps and any decision record that prematurely sets CI or application-workflow authorization to `true`.
- **Workflow exercised:** the owner-decision review workflow consists of inventory regeneration, matrix/ADR consistency review, step-gate review and deliberate invalid-variant rejection. No user-facing generation workflow is claimed.
- **Verified in CI:** unverified and intentionally not attempted at this phase.
- **Hosted/production:** unverified; no hosted mutation.

This boundary does not cancel the Bible's eventual three-gate and end-to-end requirements. It defers application workflow testing until L1 and CI/runtime enforcement until L2, after the persistence and compatibility foundations can preserve historical content, edits, approvals, replay and export.

## 13. Recovery Foundation Successor dependency and target placement refresh

Read-only inspection on 25 August 2026 confirmed:

- the successor worktree exists at `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor`;
- it remains on `codex/recovery-foundation-successor` at `e7f4e37e3087ee166c16ab242b17c60b3877f16b`;
- its remote remains `https://github.com/voltlead26-creator/PrompTED.git`;
- its Git common directory is `/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED/.git`, which is different from the `reliably-prompTED` target Git common directory;
- its handoff and implementation remain uncommitted and dirty;
- no hosted CI, merge, deployment or production evidence was added after the 24 August handoff.

The original locally recorded foundation evidence remains source-only evidence. The exact foundation files plus the workflow-authority cleanup required by the checker were subsequently applied through bounded local patches to the clean `reliably-prompTED` worktree. Fresh target verification then passed: 38 focused instruction/deployment/probe tests, 24-function contract reconciliation, and `pnpm verify:web` with 34 deployment/security tests, 47 root tests, 115 shared tests, 374 web tests, lint, type-check and a 28-route build.

**Proposed gate:** F0 is complete only when the owner reviews and accepts the exact local `reliably-prompTED` diff and its fresh local evidence. Commit, push, pull request, hosted CI, merge, deployment and production promotion remain separately authorized actions. Until owner acceptance, L0.2 remains blocked even if ADR-001 is otherwise approved.

## 25 August 2026 — Phase L0.2 local persistence foundation

The owner subsequently accepted the fresh F0 evidence and explicitly authorised local-only L0.2 implementation. The persistence foundation is recorded in `docs/architecture/ADR-002-immutable-ledger-persistence-and-versioned-compatibility-foundation.md` and migration `20260825090000_immutable_document_ledger_persistence.sql`.

### Council Challenge result

- **Strategist:** extend the existing artifact/version store with one private immutable ledger and generation-snapshot authority; do not create a replacement user-document store.
- **Skeptic:** historical rows remain `legacy_unversioned`; hashes, idempotency identity, expected revisions, immutable bindings and append-only captured revisions fail closed against changed replay, stale edits and stale approvals.
- **Creative:** additive source/transformation seams let L0.3 implement the approved compatibility mappings later without activating the 86-profile shadow ledger now.
- **Operator:** one expand-only migration and standalone tests can be applied, reviewed and discarded locally without a hosted mutation.
- **Audience Advocate:** a captured user section cannot be silently re-keyed, blanked, overwritten, approved or deleted outside its exact version and revision boundary.

The chosen design reuses `ted_artifacts`, blocks and versions. The strongest rejected alternative was a replacement ledger-native document schema with immediate historical backfill; that alternative would require guessing identities that current rows do not durably store.

### Evidence state

- **Implemented:** private immutable ledger/version and generation-snapshot tables; dormant activation pointer; explicit legacy/captured identity columns; revision/provenance/export seams; service-only registration/binding RPCs; authenticated revision-checked save/approval RPCs; captured-write guards; shared persistence-boundary types and validators; ADR and handoff evidence.
- **Verified locally:** Node `v22.23.2`, pnpm `10.33.0`, Supabase CLI `2.114.0`, Docker `29.7.2`; all 24 migrations applied from a fresh local database; 60/60 standalone pgTAP assertions passed; 9/9 focused shared ledger tests passed; migration inventory passed.
- **Workflow exercised:** only the individual architecture/database review workflow—fresh reset, immutable registration, exact replay, changed-input conflict, artifact/block binding, edit, stale edit, approval, direct-write rejection and revision-snapshot inspection. No application workflow was exercised.
- **Verified in CI:** Unverified.
- **Hosted:** Unverified; no hosted database, function, Netlify, GitHub or provider mutation.
- **Production:** Unverified.

L0.2 does not resolve the 18 conflicts at runtime. The approved matrix remains the decision authority; live selection, key adapters, historical transformations, backfill, Workspace, Find a Role, library and export integration remain unimplemented. The next proposed gate is L0.3, and it is not authorised by this update.
