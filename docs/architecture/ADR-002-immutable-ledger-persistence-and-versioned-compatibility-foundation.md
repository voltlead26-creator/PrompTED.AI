# ADR-002 — Immutable ledger persistence and versioned compatibility foundation

- **Status:** Implemented and verified locally — owner review required before L0.3 or publication
- **Date:** 25 August 2026 (Australia/Melbourne)
- **Decider:** PrompTED owner for the local L0.2 scope
- **Repository:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Git common directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git`
- **Worktree:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`
- **Branch:** `reliably-prompTED`
- **HEAD and comparison base:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **L0.2 workflow/claim ID:** `01a02f99-b81f-7102-ab15-f9b5a4a7a9e4`
- **Predecessor foundation workflow ID:** `01a02eca-55a4-79f3-926a-09c32df95900`
- **Migration:** `supabase/migrations/20260825090000_immutable_document_ledger_persistence.sql`
- **Database contract test:** `supabase/tests/immutable_document_ledger_persistence.test.sql`

The owner accepted the fresh local F0 foundation evidence and then explicitly authorised local L0.2 implementation. This authority does not include a commit, push, pull request, hosted migration, deployment, live ledger selection, historical-key transformation, catalogue/profile rewrite, application workflow test, or L0.3 implementation.

## Decision

PrompTED will persist immutable ledger contracts and immutable generation snapshots in a private database boundary. Existing document and artifact stores remain the user-content authority; they receive additive, version-aware identity and revision fields rather than being replaced by a second document store.

Existing rows remain explicitly `legacy_unversioned`. The migration does not infer a key or version from display labels, current catalogue data, or current Enhanced DIPs. A future captured artifact must bind to one registered ledger version and one immutable generation snapshot through service-only, fail-closed RPCs. Once captured, edits and approvals use owner-scoped expected-revision RPCs, and every accepted change appends a durable artifact revision.

An activation-pointer table is present as a future rollback seam, but L0.2 grants service-role read access only, creates no enabled pointer, exposes no activation RPC, registers no production ledger row, and changes no live selector. Version-aware rename, split, merge, semantic-replacement, and new-section adapters remain L0.3 work.

## Product-Purpose Alignment

- **Target users:** non-expert users reopening, editing, approving, replaying, repairing, or exporting meaningful documents, especially job seekers and small operators whose content cannot safely be reconstructed after a structural migration.
- **Problem:** the current database cannot prove which immutable ledger, benchmark, section identity, input snapshot, or approved revision produced a document. A future key migration could therefore lose content, attach an edit to the wrong section, approve stale text, replay older generation over newer work, or export a different revision.
- **Intended completed outcome:** each future captured document can be reopened and changed against the exact contract and revision that owns it, while historical rows remain readable without invented metadata.
- **Outcome-progression step:** `Final user-ready documents → Review and approval → Persistence and export evidence`.
- **Burden and risk reduced:** users will not have to understand ledger migration mechanics or recreate lost text; ambiguous historical identities stay historical, and stale operations fail instead of overwriting work.
- **Local evidence:** all 24 migrations applied from scratch; 60 database assertions and 9 focused shared-contract tests passed; the migration remains absent from all live generation, Workspace, Find a Role, export, workflow, and deployment imports.
- **Unverified assumptions:** production cohort sizes, historical key distributions, hosted PostgreSQL behaviour, signed-in application behaviour, export artifacts, and provider/production performance were not inspected.

## Council Challenge

- **Strategist:** establish one immutable version authority without creating a second user-document store. Reuse `ted_artifacts`, blocks, and append-only versions while adding a private ledger/snapshot boundary.
- **Skeptic:** never infer missing legacy keys; hash immutable snapshots; reject an idempotency key reused with different inputs; prevent legacy whole-artifact saves, direct block writes, stale edits, or stale approvals from mutating captured work.
- **Creative:** use additive identity seams and a dormant activation pointer so L0.3 can project approved mappings later without prematurely connecting the 86 shadow profiles.
- **Operator:** one expand-only migration, one focused shared contract, one standalone pgTAP suite, and a fresh local reset make the change reviewable and reversible before any hosted mutation.
- **Audience Advocate:** historical content remains visible exactly as stored. A future captured section cannot silently become blank, omitted, re-keyed, edited, approved, or deleted outside its explicit state and revision boundary.

**Chosen position:** extend the existing persistence model with immutable private contracts and snapshots, explicit legacy/captured identity, and revision-checked RPCs.

**Strongest rejected alternative:** create a replacement ledger-native document schema and immediately backfill existing rows.

**Deciding evidence and trade-off:** a replacement schema could be conceptually cleaner, but current documents and artifacts already have active consumers and incomplete durable key metadata. Immediate backfill would require guessing. The additive design retains current read compatibility and provides a future migration seam, at the cost of temporarily supporting legacy and captured states in the same tables.

**Disagreement retained:** a fully ledger-native store may eventually be appropriate after all consumers and persisted cohorts are proven migrated. L0.2 does not decide or implement that future consolidation.

## Observed current implementation

Before L0.2, PrompTED had:

- legacy `documents` and `sections`, where sections stored display name, order, content, status and version history but no durable section key or ledger version;
- `ted_artifacts`, `ted_artifact_blocks`, and `ted_artifact_versions`, with artifact/block revisions and approval status but no immutable ledger or benchmark identity;
- `save_ted_artifact`, which replaces a complete block set and does not require an expected artifact revision;
- `usage_ledger.generation_request_id`, which prevents duplicate billing but is not a complete generation snapshot or replay contract;
- export history without the exact ledger version, approved revision, or validation result;
- an isolated 86-profile shadow ledger representation and an owner-approved 18-template compatibility matrix, neither imported by live generation.

The inherited `ted_artifact_blocks_own` RLS policy self-references the same table and produced an infinite-recursion error during a direct authenticated-update probe. L0.2 does not broaden scope to replace that existing policy. The captured-write trigger was therefore also exercised from the privileged database role, where it independently rejected a direct mutation. Captured application edits use the new owner-scoped RPC rather than direct DML.

## Implemented local architecture

### Immutable private authority

`private.document_ledger_versions` stores:

- immutable `ledger_version` and `schema_version`;
- canonical JSON contract;
- lowercase SHA-256 digest calculated again inside PostgreSQL;
- template count and registration provenance.

Registration is service-role-only. Re-registering byte-equivalent canonical JSON for the same version is idempotent. Reusing a version for different content fails with `LEDGER_VERSION_CONFLICT`. Updates and deletes fail through an immutable-row trigger.

`private.document_generation_snapshots` stores the minimum versioned identity needed for replay and audit:

- user and generation request identity;
- template, ledger, benchmark, and pipeline versions;
- validated input values, source/evidence references, unresolved input keys, and confirmations;
- a deterministic SHA-256 digest.

The unique identity is `(user_id, generation_request_id)`. Exact replay returns the existing snapshot; changed input under the same identity fails with `GENERATION_REPLAY_CONFLICT`. Registration and snapshot preparation take transaction advisory locks so concurrent duplicates serialize before their idempotency decision.

The snapshot contract explicitly forbids treating this table as a duplicate upload store. Full source documents and unnecessary sensitive bodies remain outside the snapshot.

### Dormant activation seam

`private.document_ledger_activation_pointers` can eventually identify a selected version and revision. L0.2 deliberately provides:

- no rows;
- no enabled pointer;
- no activation RPC;
- no authenticated or anonymous access;
- service-role `SELECT` only.

This makes activation a later explicit migration and review decision rather than an accidental side effect of persistence.

### Existing stores remain authoritative for user content

Additive columns on `documents`, `sections`, `ted_artifacts`, and `ted_artifact_blocks` distinguish:

- `legacy_unversioned`, where every new identity field must remain null; and
- `captured`, where required version identity must be complete.

Current rows receive the `legacy_unversioned` default. No backfill runs. Display labels are not converted into section keys.

Captured `ted_artifacts` bind to template, ledger, benchmark, and generation-snapshot identity. Captured blocks bind to the exact ledger version and section key, requiredness, explicit section state, and optional future source/transformation provenance. The database rejects unknown ledger versions, templates, and section keys and rejects caller-supplied requiredness that differs from the immutable contract.

The existing `documents` and `sections` tables receive a dormant captured-identity seam, but L0.2 exposes no RPC that can transition them to captured state. Attempts to insert or transition a captured legacy row fail closed until a later reviewed boundary is implemented.

### Revision and approval safety

Captured artifact writes are allowed only through an internal transaction-scoped write context set by the approved security-definer RPC. The context is restored before the RPC returns. Existing whole-artifact saves, direct block updates, and deletes cannot mutate a captured artifact.

`save_ted_artifact_block_revision` requires:

- authenticated ownership;
- captured artifact and block identity;
- expected artifact revision;
- expected block revision;
- a supported section state;
- nonblank content when a section is declared `final`;
- no `omitted_optional` state for a required section.

A successful edit increments both revisions, clears approval, keeps the artifact in review state, and appends an immutable artifact snapshot.

`approve_ted_artifact_block_revision` requires the exact current revisions, a `final` state, and nonblank section content. Approval increments the block revision, records that exact revision as `approved_revision`, increments the artifact revision, and appends a snapshot. A delayed or replayed approval cannot approve newer content.

Captured artifact versions cannot be updated or deleted. Legacy artifact versions retain their previous lifecycle so the expand-only migration does not unexpectedly block deletion of pre-L0.2 artifacts.

### Export and compatibility seam

`export_history` can now record ledger version, document/artifact revision, approved revision, validation status, and structured validation result. L0.2 does not change export callers. A later phase must load and validate the exact approved revision before populating these fields.

Source block/section IDs, historical source keys, and transformation version fields exist for L0.3. They remain null in L0.2, and no compatibility projection runs.

## RLS, grants, and RPC controls

- Private schema access is revoked from `public`, `anon`, and `authenticated`.
- Service role can insert/select immutable versions and snapshots through narrowly granted tables and functions.
- Ledger registration, snapshot preparation, artifact binding, and block binding are not executable by `anon` or `authenticated`.
- Section edit and approval RPCs are executable by `authenticated`, but derive ownership from `auth.uid()` and use expected revisions.
- Security-definer functions use an empty or explicit `pg_catalog` search path and schema-qualified relations/functions.
- Unsupported identities and states fail closed.

L0.2 does not change broad legacy table grants or replace inherited RLS policies. The captured-write triggers add a separate database guard so a privileged direct update still cannot silently bypass the revision boundary.

## Locally verified evidence

Environment:

- Node `v22.23.2`;
- pnpm `10.33.0`;
- Supabase CLI `2.114.0`;
- Docker Desktop engine `29.7.2`;
- local Supabase only; no linked or hosted database command.

Evidence obtained:

1. `supabase start` created a fresh local stack and applied all 24 migrations from an empty local database; `supabase stop --no-backup` later discarded that test database.
2. `supabase test db --local supabase/tests/immutable_document_ledger_persistence.test.sql` passed 60 of 60 assertions.
3. `pnpm --filter @prompted/shared exec vitest run src/document-ledger.test.ts` passed 9 of 9 focused tests.
4. `pnpm check:migrations` accepted all 24 migrations.

The database assertions cover schema and RPC presence, grants, dormant activation, explicit legacy identity, contract hashing, idempotent registration, immutable rows, request replay, changed-input conflicts, unknown templates and sections, requiredness mismatch, artifact/block binding, stale edit rejection, approval binding, direct-write rejection, append-only versions, captured deletion rejection, and stored version/section identity.

## Unverified and future work

L0.2 does not prove:

- hosted migration application or rollback;
- production data compatibility or cohort size;
- live generation consumption;
- live registration or activation of an 86-template ledger;
- rename, split, merge, semantic-replacement, or new-section adapter correctness;
- library reopen, Master Workspace, Find a Role, replay/repair, or export UI behaviour;
- signed-in browser behaviour or actual exported artifacts;
- CI, preview, staging, or production behaviour.

## Rollout sequence

1. Owner reviews this ADR, migration, tests, and handoff.
2. If authorised, L0.3 implements only the approved compatibility adapters and synthetic migration rehearsal against this persistence seam.
3. L0.4 performs representative shadow comparisons without live selection.
4. L1 is the first phase permitted to exercise an application workflow and one runtime-shadow cohort.
5. L2 expands cohorts and proposes runtime/CI enforcement.
6. L3 removes bypasses and requests each protected publication or hosted action separately.

## Rollback strategy

Before hosted application, rollback is simply to withhold the uncommitted migration; the local database is disposable test state. After a future hosted expand-only application, rollback means leaving the new nullable/defaulted columns and private tables dormant, keeping activation disabled, and continuing legacy reads. Do not delete immutable rows, source content, aliases, or history. A destructive down migration is intentionally not provided.

## Risks and owner gates

- The production database and historical cohorts remain uninspected.
- The inherited recursive block RLS policy needs a separately scoped review before direct authenticated DML can be used as evidence; captured edit/approval RPCs do not rely on direct client DML.
- JSON hashing is deterministic for PostgreSQL `jsonb` canonical text within this boundary; any external registrar must submit the digest calculated from the same canonical representation or use a future narrowly controlled registration service.
- Private snapshots must remain minimum-necessary and must not become a second store of sensitive uploads.
- L0.3 must prove source preservation, ordering, approval conflicts, rollback, and no model redistribution.
- No live ledger may be registered or selected, and no migration may be applied to a hosted environment, without a later explicit owner action.

## Next decision

The next proposed task is **Phase L0.3 — Version-Aware Compatibility Adapters and Migration Rehearsal**. It is not authorised by this ADR or by the L0.2 implementation instruction.
