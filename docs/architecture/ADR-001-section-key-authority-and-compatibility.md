# ADR-001 — Section-key authority and backward compatibility

- **Status:** Accepted by owner — live implementation not authorised
- **Date:** 24 August 2026 (Australia/Melbourne)
- **Continuity refreshed:** 25 August 2026 (Australia/Melbourne)
- **Decider:** PrompTED owner
- **Repository:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Worktree:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`
- **Branch:** `reliably-prompTED`
- **HEAD:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Comparison base:** `reliably-prompTED` at `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Owner approval recorded:** 25 August 2026 (Australia/Melbourne)
- **Machine-readable decision:** `docs/architecture/document-section-key-compatibility.proposed.json` (stable pre-implementation path retained)

The PrompTED owner accepted this architecture and all four new-section policies on 25 August 2026. Acceptance records the section-key authority decision only. It does not authorise a live profile rewrite, key rename, adapter, database migration, generation change, Workspace change, Find a Role change, export change, commit, push, pull request, deployment, or hosted mutation.

## Decision summary

PrompTED adopts **Alternative C: one immutable, versioned canonical ledger with explicit compatibility mappings**.

All 86 catalogue templates have Enhanced Document Intelligence Profiles. Sixty-eight catalogue/profile pairs already have the same ordered section-key set. For the remaining 18, the richer profile keys are approved as candidate canonical keys for a **future** immutable ledger version, subject to the per-template mappings in the machine-readable decision. Existing catalogue keys remain permanent historical identities or aliases wherever persisted documents or consumers can reference them.

No approved candidate canonical key may enter live generation until PrompTED persists the exact ledger version and section identity used by a document, provides a version-aware adapter, protects revisions and approvals from stale writes, and makes repair, replay and export resolve the captured version.

## Product-Purpose Alignment

- **Target user/segment:** non-expert job seekers, small operators, employers and individuals reopening or completing consequential PrompTED documents.
- **Real-world problem:** a structural key migration can make existing content disappear, attach edits or clarification to the wrong section, clear approvals, corrupt replay, or export the wrong revision.
- **Intended completed outcome:** users retain their exact document content, edits, approvals and exportable historical revision while new documents can eventually use richer, explicit section contracts.
- **Outcome-progression step:** `Final user-ready documents and actions → Review, approval, persistence, and export → Evidence of completion`.
- **Burden or risk reduced:** users are not required to reconstruct lost content or understand internal key migrations; unsupported conversions fail closed and ask for judgment.
- **Evidence:** the current 86/86 inventory, exact 18 conflicts, key comparisons, direct consumer trace, current section schema, standalone decision validator and deliberate invalid-fixture tests.
- **Unverified assumptions:** production persisted-data cohort sizes and actual historical key distributions have not been queried; hosted, signed-in, export-artifact and production behaviour remain unverified.

## Context and problem statement

### Observed current implementation

The current checkout contains:

- 86 unique catalogue templates across `templates.data.json` and `phase2-templates.data.json`;
- 86 Enhanced Document Intelligence Profiles, each with an information contract and passed internal review;
- 68 templates whose catalogue and profile section-key arrays match exactly;
- exactly 18 templates whose key arrays differ;
- a shadow ledger and adapter that deliberately reject mismatched pairs and are not imported by live generation;
- a client that supplies keyed sections to `generate-document`;
- a document pipeline that matches profile information-contract sections, placeholders and repairs by exact key;
- Workspace clarification matching that first compares exact keys;
- persisted `sections` rows containing name, order, content, approval status and version history, but no durable section key or ledger version;
- export that renders caller-supplied approved sections and does not reload an exact persisted revision with a captured ledger version.

The profile contracts are richer than many catalogue shapes. However, a profile key is not automatically a safe replacement for a catalogue key. Aggregate catalogue sections may contain inseparable user prose; profile-only sections have no historical identity; semantic expansions need facts the historical section may not contain; and one merge draws from two differently approved source sections.

### Locally verified evidence

The standalone validator regenerates the live inventory from both catalogue JSON files and the exported `DIPS` value. It requires 86 catalogue templates, 86 enhanced profiles, 68 exact matches and exactly the expected 18 conflicts. It checks every current key, proposed canonical key, source path, consumer path and mapping safety field.

### Unverified assumptions

No production database was queried. It is therefore unknown how many documents use each conflicted template, whether any session-only workspaces remain recoverable, or whether historic client builds persisted optional in-memory `Section.key` values outside the current database schema.

## Council Challenge

- **Strategist:** one immutable ledger authority is durable only if every document captures its ledger version and historical catalogue identities remain readable.
- **Skeptic:** a rename, split, merge or assumed mapping can silently orphan text, misroute placeholders and repair, reset approval, overwrite a newer revision, or export a different shape.
- **Creative:** catalogue identities can remain compatibility aliases while future versions use richer profile contracts; derived projections can coexist with immutable historical source rows.
- **Operator:** this decision record is standalone, fail-closed, reversible and reviewable. It performs no live mutation and is tested by individual validator tests rather than being wired into CI or document workflows.
- **Audience Advocate:** users must see the same historical content, editing state, approvals and export result. Any conversion requiring interpretation must be visible and user-approved.

**Decision:** Alternative C.

**Strongest rejected alternative:** Alternative A, retaining catalogue keys as the permanent canonical authority.

**Distinguishing evidence and trade-off:** Alternative A has the lowest migration risk and preserves current consumers, but it would permanently retain broad or lossy structures that cannot express richer section-specific clarification, provenance, quality and export contracts. Alternative C requires an explicit persistence/version boundary and temporary adapters, but preserves historical outcomes while allowing the richer contract to become enforceable safely. Alternative B remains rejected as unsafe because wholesale replacement can lose or misattribute user state.

**Disagreement retained:** Alternative A remains the lowest-migration-risk fallback if future persistence evidence invalidates a mapping. The accepted decision does not permit wholesale or model-based migration; unsupported conversions still fail closed.

## Exact conflict inventory and owner-approved compatibility summary

The machine-readable matrix is authoritative for individual mapping records and evidence. The summary below is intentionally compact.

| Template | Catalogue → approved candidate future profile structure | Principal classification |
|---|---|---|
| `business-email` | `subject/body/action` → `subject_and_greeting/message/call_to_action` | three one-to-one renames |
| `cover-letter` | aggregate `opening` → header, recipient and opening; fit/motivation renames; signature-expanded closing | split, renames, semantic replacement |
| `education-cover-letter` | introduction and suitability become explicit application/opening/evidence/motivation contracts | two splits and a rename |
| `induction-manual` | welcome/work renames; policies and contacts gain safety/systems/first-period scope | renames and semantic replacements |
| `interview-prep-questions` | three broad buckets → seven preparation contracts | two splits and a rename |
| `interview-script` | intro and stories split; tricky renamed; optional candidate questions and closing are new profile-only sections | splits, rename, two new canonical sections |
| `job-follow-up-email` | thanks splits into header/event; value/next renamed; required sign-off is a new profile-only section | split, renames, new canonical section |
| `job-search-checklist` | one `items` list → eight lifecycle checklists | one-to-many split |
| `offer-letter` | offer gains parties/role; terms renamed; conditions and acceptance unchanged | semantic replacement, rename, unchanged |
| `onboarding-checklist` | one `items` list → five time/ownership groupings | one-to-many split |
| `pay-rise-request` | case and script split; ask renamed | splits and rename |
| `personal-statement` | motivation/background split into purpose, evidence and fit; goals renamed | splits and rename |
| `promotion-case` | impact/readiness feed readiness, gaps and capability; proposal splits | semantic replacements, one merge, split |
| `reference-request` | ask/details split into relationship, purpose, context, request/opt-out and sign-off | two splits |
| `resignation-letter` | notice/appreciation/close unchanged; transition → handover | unchanged and rename |
| `sop` | overview/steps/roles gain explicit scope, controls, records and review | three semantic replacements |
| `terms-of-employment` | four broad terms become four richer contracts; acknowledgement is a new jurisdiction-controlled section | semantic replacements and new canonical section |
| `workplace-policy` | three renames; breach gains review contract | renames and semantic replacement |

No evidence-supported catalogue relationship is classified as `legacy_alias_only`. Four profile-only additions are classified as `new_canonical_section`; they have no historical standalone identity and may exist only in a future immutable version under their approved requiredness policies. No model-based redistribution is permitted. The only approved many-to-one merge is `promotion-case` `impact` plus `readiness` into `capability_match`; its source order, headings, duplicate handling, approval conflicts, provenance and rollback are explicit in the matrix.

For the 19 approved one-to-one renames, the compared catalogue description and profile information contract express the same section intent, and the key substitution is deterministic only inside the namespace `(templateId, ledgerVersion)`. Aliases must never be global because generic keys such as `body`, `close` and `terms` have unrelated meanings in other templates. The current profile information-contract type does not independently encode section required/optional status or output type. The future ledger must therefore carry forward the catalogue section's required state and compatible rendering type unchanged for a rename; any later proposal to change either property reclassifies that relationship as `semantic_replacement` or `unresolved` and requires a new owner decision. This constraint, together with captured-version export, is the required rename compatibility proof; it is not a claim that today's persistence already enforces it.

## Decision drivers

1. Existing persisted documents remain readable under the contract used when created.
2. Historical user content is never silently discarded or rewritten by a model.
3. User edits, version history and section approvals remain attributable.
4. Repair and replay cannot overwrite newer or approved revisions.
5. Export uses the exact approved persisted revision and captured ledger version.
6. Unsupported or ambiguous mappings fail closed.
7. The richer profile contracts can eventually become enforceable without retaining two permanent authorities.
8. Temporary adapters have explicit removal criteria.
9. The current shadow ledger remains disconnected during this decision task.

## Alternatives evaluated

### Alternative A — catalogue keys remain canonical indefinitely

This has the lowest immediate compatibility cost. It preserves existing broad structures and avoids most key migration. It was not selected as the general direction because one-key checklist buckets and broad composite sections cannot express the richer section-specific clarification, validation, quality and export contracts. It remains a valid owner choice for individual mappings.

### Alternative B — replace catalogue keys wholesale with profile keys

This immediately aligns generation with Enhanced DIPs. It is rejected because persisted rows lack captured key/version identity, live code compares keys directly, aggregate text cannot be separated safely, profile-only sections have no historical source, and approval/export provenance would be ambiguous.

### Alternative C — versioned canonical ledger with explicit mappings

This is accepted as the architecture. Old versions remain readable; future writes may deliberately select an immutable version only after separately authorised implementation; adapters translate only approved, supported projections; migration occurs cohort by cohort; and old aliases are removed only when no persisted cohort or consumer references them.

## Accepted architecture — implementation pending

### Profile restructuring for the future ledger

The 86 Enhanced DIPs remain source evidence, not a second permanent runtime authority. An approved future ledger compiler should ingest each profile's required information, clarification, quality and section contracts into an immutable ledger entry. For the 68 matching templates, keys can transfer without a compatibility mapping. For the 18 conflicts, only the matrix-approved candidate keys enter the new version.

The live profile source is not rewritten by this ADR. Once the owner approves the decisions and the F0 recovery-foundation acceptance gate is complete, profile/ledger compilation should become a bounded input to Phase L0.2; duplicate runtime validation must then be removed after all consumers use the ledger.

### Recovery-foundation predecessor evidence and local placement

The separate Recovery Foundation Successor handoff was refreshed read-only on 25 August 2026. Its source worktree remains `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor` on `codex/recovery-foundation-successor` at `e7f4e37e3087ee166c16ab242b17c60b3877f16b`. The bounded release-hardening files and the workflow-authority cleanup required by their fail-closed checker were then applied through exact local patches to the clean `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED` worktree on `reliably-prompTED`.

The source and target worktrees use the same GitHub remote and checkpoint but different local Git common directories:

- foundation source: `/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED/.git`;
- `reliably-prompTED` target: `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git`.

This proves bounded local placement in the target working tree. It does not prove a commit, push, pull-request review, hosted CI, merge, deployment or production behaviour. The accepted ledger decision and all 86 V2 profiles remain shadow-only and are not connected to live generation, persistence, Workspace, Find a Role or export.

### Persisted-document compatibility

Every document and generation snapshot must capture template ID, immutable ledger version, section key, section revision, source section identity and transformation version. Reopening resolves the captured version first. Historical catalogue sections render unchanged. A richer projection is a separate derived view and may not replace its source until the user approves a deliberate conversion.

### Splits

Historical aggregate content stays recoverable under its original key and revision. PrompTED must not ask a model to silently distribute it. A conversion may retain the aggregate read-only, preserve it in a versioned legacy-content record, and initialise child sections from deterministic structured fields only. Other child sections enter explicit clarification or placeholder state.

### Merge

For `promotion-case`, source order is `impact` then `readiness`; source headings remain labelled; exact duplicates may render once while retaining both source references; conflicting approvals force the projection to unapproved; every paragraph retains source provenance; rollback discards only the projection and renders the original version.

### Generation, validation and clarification

New generation continues using current keys until approval and L0.2 implementation. A future generation request resolves one ledger version and rejects unknown templates, keys or mappings. Required translated sections cannot become blank. Structural unknowns use ledger-controlled clarification. Profile-only sections are not silently fabricated from historical text.

### Master Workspace

Workspace renders the captured contract and preserves row IDs, order, content, history and approval. A migration preview must label old and proposed sections, show what will and will not transfer, and require explicit acceptance. Editing any derived projection clears its approval without changing historical source approval.

### Find a Role and Document Library

Find a Role directly creates `cover-letter`, `job-search-checklist` and `interview-prep-questions` documents. Role-folder and library reopening must resolve each document's captured version rather than the newest profile. Original and tailored documents retain separate lineage.

### Replay, idempotency, repair and stale-write protection

Idempotency identity must include the logical operation and captured ledger version. Repair targets section ID, key and expected revision. A stale replay or repair returns a conflict/suggestion and cannot overwrite a later edit, clarification answer or approval. Unaffected sections remain unchanged.

### Export

Export must load the persisted approved revision server-side, validate it against its captured ledger version, render historical aliases through that version and record document revision, ledger version, format, time and validation result. It must never export an unapproved derived projection merely because current profile keys differ.

## Privacy, provenance, accessibility and security consequences

- Store mapping and source references, not duplicated full document bodies, where immutable source rows already exist.
- Do not log user content while diagnosing key translation.
- Treat catalogue/profile text and generated content as untrusted data; keys must be resolved through validated contracts, never shell or SQL interpolation.
- Migration previews, conflicts and approval changes require accessible text, keyboard actions and screen-reader labels; state must not rely on colour.
- High-risk employment terms, policies and SOP facts remain clarification-blocked when a richer structure requires facts absent from the historical document.

## Bible-integrated adoption and verification sequence

The root `AGENTS.md` Adoption, Migration, and Change Control sequence governs this decision. The machine-readable `adoptionPlan` in the compatibility matrix is the exact phase record. The steps below integrate the owner's direction that current validation remain individually invoked: no compatibility or Profile V2 validator is added to a package workflow, GitHub Actions, CI, release workflow, application workflow or live generation path during the L0 stages described as individual-only.

| Step | Evidence state | Scope and exit gate |
|---|---|---|
| **L0.1 — Section-key authority and compatibility decision** | Owner approved locally; live implementation not authorised | The 86/86/68/18 inventory, ADR, matrix and standalone validator exist. The owner accepted Alternative C, all mappings and the four new canonical section policies on 25 August 2026. |
| **L0.1A — Enhanced DIP V2 shadow restructuring** | Owner approved as shadow architecture; live integration not authorised | All 86 reviewed profiles compile into an isolated ledger-shaped shadow representation. The four approved new sections resolve to optional, optional, required and jurisdiction-controlled requiredness. It remains unimported by live generation. |
| **F0 — Recovery Foundation Successor acceptance** | Applied locally to `reliably-prompTED`; uncommitted and owner review pending | Review the exact target diff and current local verification. Commit, push, pull request, hosted CI, merge, deployment and production promotion remain separate protected gates. L0.2 cannot claim foundation acceptance until the owner accepts this local foundation evidence. |
| **L0.2 — Immutable Ledger Persistence and Versioned Compatibility Foundation** | Not authorised; explicit owner approval and F0 completion required | A separately authorised task may add immutable ledger/benchmark identity, durable document and section versions, provenance, RLS/RPC controls, stale-write protection, replay identity and fresh-local-database proof. It must not select V2 profiles in live generation. |
| **L0.3 — Version-aware adapters and migration rehearsal** | Deferred; not authorised | Implement only approved rename, split, merge, semantic-replacement and new-section adapters. Exercise synthetic local migration, approval-conflict, replay, repair and rollback fixtures individually. No model redistribution of historical prose. |
| **L0.4 — Representative cohort shadow validation** | Deferred; not authorised | Compare current and future contracts for a concise, evidence-rich, structured-list, emotionally sensitive and high-risk cohort. Standalone shadow comparisons remain non-blocking and do not change live selection. |
| **L1 — Application workflow exercise and one-cohort runtime shadow** | Deferred to an explicit owner gate | Only after L0.4 review may one approved cohort exercise generation, clarification, save, reopen, edit, approval, repair, replay and export. This is the first application-workflow test gate. |
| **L2 — Cohort expansion and authoritative enforcement** | Deferred to an explicit owner gate | Expand across all 86 profiles cohort by cohort. Each cohort passes individual contract tests before workflow tests. Only here may the single authoritative validator be proposed for runtime and CI integration. |
| **L3 — Bypass removal and controlled release** | Deferred protected actions | Remove duplicate prompts, validators and section maps only after all consumers migrate. Commit, push, PR, merge, hosted migration and deployment each remain separately authorised actions. |

### Current individual-testing boundary

Until the owner explicitly opens the L1 gate:

- invoke `scripts/check-section-key-compatibility.test.mjs` and `scripts/check-section-key-compatibility.mjs` directly;
- invoke the Profile V2 Deno format, lint, check and test commands directly;
- use synthetic or authorised redacted fixtures;
- do not test these validators through GitHub workflows, package-wide workflow wiring, deployment workflows or live application journeys;
- do not represent the earlier repository-wide `pnpm verify:web` regression result as evidence that the new compatibility or V2 profile contracts were workflow-tested;
- continue the required `Inspect → Trace → Understand → Plan → Implement → Test → Review → Exercise Workflow → Re-test → Report` sequence by exercising the **owner-decision review workflow** for this documentation phase, not an unauthorised user-facing application workflow.

This is a sequencing constraint, not a permanent exemption from the ledger's eventual CI, runtime and end-to-end acceptance requirements. L1 and L2 deliberately restore those gates only after the persistence, adapter and representative-shadow foundations are reviewable.

## Rollback strategy

Stop new-version selection, retain all immutable historical rows and aliases, discard or deactivate derived projections, and route reopen/repair/export through the captured historical version. Never roll back by deleting source sections or rewriting user content. A failed migration remains diagnosable through source IDs and transformation provenance.

## Risks

- Production cohort size and historical shapes are unverified.
- Current persistence cannot yet represent the required ledger/version boundary.
- Broad semantic replacements can require facts absent from old text.
- The promotion merge may produce overlapping prose and requires user review.
- Profile-only sections may increase clarification burden or document length.
- Temporary adapters can become accidental permanent authorities unless removal gates are enforced.

## Owner decision recorded

On 25 August 2026, the PrompTED owner approved:

1. Alternative C as the general authority model.
2. The profile key arrays as candidate canonical keys for a future immutable version.
3. Permanent historical-read aliases while any persisted cohort or consumer references catalogue keys.
4. The rule that split content is never silently redistributed by a model.
5. The `promotion-case` merge order and conflict/provenance rules.
6. `interview-script.candidate_questions` as a `new_canonical_section`, optional in the base contract and required only by an explicit immutable template variant.
7. `interview-script.closing` as an optional `new_canonical_section`.
8. `job-follow-up-email.sign_off` as a required `new_canonical_section`, stored independently even when rendered adjacent to `next_step`.
9. `terms-of-employment.acknowledgement` as a `new_canonical_section` that is optional in the generic contract and required only by an approved jurisdiction-specific immutable contract.
10. User-facing conversion review and re-approval for any derived structure.
11. Explicit adapter removal criteria and permanent rendering of unmigrated historical versions.

The four new sections have no standalone historical identity. Historical aggregate content remains where it was created and is never automatically extracted, redistributed, backfilled or auto-approved into a new section.

## Future implementation requiring separate authorization

- Phase L0.2 — Immutable Ledger Persistence and Versioned Compatibility Foundation.
- Add immutable ledger/version and section identity persistence through reviewed migrations.
- Implement the approved version-aware compatibility adapter and fail-closed runtime selection.
- Add revision-checked repair, replay, clarification and approval transitions.
- Make export load the exact persisted approved revision and ledger version.
- Add fresh-local-database, RLS/RPC, migration, replay and artifact verification.

Acceptance of ADR-001 does not by itself complete F0, authorise L0.2, or authorize a commit, remote review, hosted check or deployment. Later L0.3–L3 work is not implicitly authorised by approval of L0.2. Each phase must satisfy its entry gate, remain within its recorded test mode, and obtain separate authorization for workflow integration or protected hosted actions.

None of those implementation tasks is authorised by this accepted architecture decision.

## 25 August 2026 execution update — F0 accepted and L0.2 implemented locally

The phase table and future-authorisation language above record the state at ADR-001 acceptance. The owner subsequently accepted the fresh local F0 evidence and then explicitly instructed Codex to proceed with L0.2. That later authorization supersedes only the F0/L0.2 local sequencing statements; it does not authorize L0.3, live selection, compatibility transformations, an application workflow, a commit, push, pull request, hosted migration or deployment.

L0.2 is now implemented and verified locally under `ADR-002-immutable-ledger-persistence-and-versioned-compatibility-foundation.md`. The database can represent immutable ledger contracts, immutable generation snapshots, explicit legacy/captured identities, expected-revision edits and approvals, append-only captured revisions, and future export provenance. All current rows remain `legacy_unversioned`; no production ledger is registered or activated; none of the 18 approved mappings executes at runtime.

Fresh local proof applied all 24 migrations from scratch and passed 60/60 standalone database assertions plus 9/9 focused shared persistence-contract tests. The next proposed gate is L0.3 compatibility adapters and migration rehearsal. L0.3 remains unapproved.
