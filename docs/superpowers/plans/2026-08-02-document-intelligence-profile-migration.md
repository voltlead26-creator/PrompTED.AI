# Document Intelligence Profile Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and validate the nine-item information contract for every Document Intelligence profile while keeping universal placeholder behaviour in one shared foundation.

**Architecture:** The universal placeholder policy remains the sole source of behavioural rules. Each existing Document Intelligence profile owns one `informationContract` containing section-level required and optional information plus the seven required placeholder attributes: fact type, placeholder label, exact contextual question, automatic fallback where safe, export requirement, shared-resolution key where applicable, and approved neutral replacement options. Legacy profile summaries are derived from this contract so duplicate truths cannot drift.

**Tech Stack:** TypeScript, Deno tests, existing Supabase shared Document Intelligence modules.

## Global Constraints

- Keep one authoritative Document Intelligence engine.
- Do not create a second profile registry.
- Universal placeholder behaviour is defined once and never copied into each profile.
- Every missing factual item receives its own placeholder; sections and documents may contain unlimited placeholders.
- Never invent missing facts or blank a section.
- Remove or reject all active anti-placeholder rules.
- Complete and report one document at a time.
- Apply the strict 12-area workflow review to every profile.
- A profile is complete only after contract validation, contradiction tests, focused workflow tests, formatting and applicable repository CI pass.

---

### Task 1: Wire the universal foundation into Document Intelligence

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Modify: `supabase/functions/_shared/document-intelligence-profiles.test.ts`
- Use: `supabase/functions/_shared/document-placeholder-policy.ts`

**Interfaces:**
- Consumes: `DocumentInformationContract`, derived summary helpers, universal placeholder rules and contradiction scanner.
- Produces: `DocumentIntelligenceProfile.informationContract` and one rendered universal policy block.

- [x] Add `informationContract?: DocumentInformationContract` to `DocumentIntelligenceProfile`.
- [ ] Derive legacy information summaries from a complete contract where practical without breaking existing profile routing.
- [x] Render universal placeholder rules once for document-writing tasks.
- [x] Add a validator that scans profile text fields for prohibited legacy anti-placeholder wording.
- [x] Replace shared legacy wording that requires no placeholders or requires stopping before drafting.
- [x] Run focused Document Intelligence tests and commit.

### Task 2: Resume

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Add focused Resume contract and strict workflow tests.

**Interfaces:**
- Produces: complete `resume` information contract covering contact details, summary, work experience, education, skills and referees.

- [x] Inventory every résumé section and current vital/improver requirement.
- [x] Define required and optional information for each section.
- [x] Define all nine information-contract items for every required fact.
- [x] Remove résumé-specific anti-placeholder contradictions.
- [x] Verify multiple placeholders can coexist in each section.
- [x] Verify repeated candidate details resolve through shared keys.
- [x] Verify all résumé sections remain generated when required facts are absent.
- [x] Pass the strict 12-area workflow review, run tests and commit.

### Task 3: Remaining profiles in manifest order

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Add one focused strict workflow test for each migrated profile.

**Interfaces:**
- Produces: one complete validated information contract per `EXTENDED_CATALOGUE` profile.

For each profile in `EXTENDED_CATALOGUE`, starting with `cover-letter` after Resume:

- [ ] Inventory every output section and full app workflow dependency.
- [ ] Define all nine information-contract items.
- [ ] Reconcile aliases with the canonical profile instead of duplicating contracts.
- [ ] Remove profile-specific anti-placeholder contradictions.
- [ ] Verify complete section generation with all required facts missing.
- [ ] Verify direct answers, shared replacements, automatic fallbacks and approved neutral options where applicable.
- [ ] Verify proofread, workspace state, unresolved navigation, export and failure-recovery behaviour through the shared contract.
- [ ] Pass all 12 strict review areas.
- [ ] Run focused validation, contradiction, formatting and repository tests.
- [ ] Commit and report that document complete before moving automatically to the next profile.

### Task 4: Catalogue completion gate

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.test.ts`
- Modify relevant CI test configuration only if existing Deno test discovery does not include the validator.

**Interfaces:**
- Consumes: `DIPS`, `EXTENDED_CATALOGUE`, every `informationContract` and internal review record.
- Produces: CI failure for incomplete, contradictory or unreviewed profile contracts.

- [ ] Assert every catalogue key resolves to exactly one profile.
- [ ] Assert every profile has a complete audited nine-item information contract.
- [ ] Assert every contract passes structural validation.
- [ ] Assert every profile has a passed strict 12-area internal review record.
- [ ] Assert no active profile text contains prohibited anti-placeholder rules.
- [ ] Assert aliases do not create competing contracts.
- [ ] Run the complete shared-function and repository test suites.
- [ ] Mark the migration PR ready only after all checks pass.
