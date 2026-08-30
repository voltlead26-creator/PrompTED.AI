# Profile Contract Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Resume-depth per-profile intelligence while extracting only independently proven common contract/review logic into shared category profiles with explicit per-template overrides.

**Architecture:** Every template remains a resolved Document Intelligence Profile. A category profile may provide shared contract fragments, review invariants, shared-resolution keys and neutral fallback rules, while each template owns its differences explicitly. Completion is evaluated only against the fully composed profile, and every affected template must independently pass the Resume-depth nine-decision contract validation, strict 12-point review, all-facts-missing zero-blank tests and repository CI.

**Tech Stack:** TypeScript/Deno shared document intelligence, GitHub Actions, Markdown quality evidence.

## Global Constraints

- Resume remains the strict benchmark for contract depth.
- Per-profile authored contracts and per-profile written review evidence must exist before consolidation.
- Consolidation happens only where completed profiles demonstrate genuine semantic overlap.
- Shared contracts cannot erase or weaken per-template rules.
- Every required fact in the resolved profile must define: key, label, fact type, placeholder label, contextual clarification question, automatic-fallback decision, export requirement, shared-resolution key, and neutral replacement options.
- Every resolved profile must independently pass all 12 strict review points.
- Missing information must never produce a blank section or blank document.
- Shared rules must never invent names, dates, amounts, legal terms, employment terms, procedures, safety instructions, approvals or other unsupported facts.

---

### Task 1: Capture and verify profile-specific ground truth

**Files:**
- Verify: `docs/quality/2026-08-09-workplace-policy-dip-review.md`
- Verify: `docs/quality/2026-08-09-sop-dip-review.md`
- Verify: `docs/quality/2026-08-09-offer-letter-dip-review.md`
- Verify: `docs/quality/2026-08-09-terms-of-employment-dip-review.md`
- Verify: `docs/quality/2026-08-09-induction-manual-dip-review.md`
- Verify: `docs/quality/2026-08-09-onboarding-checklist-dip-review.md`
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Test: `supabase/functions/_shared/workplace-governance-resume-equivalence.test.ts`

**Interfaces:**
- Consumes: existing individual contract content and profile-specific review evidence.
- Produces: a stable six-profile baseline used for semantic comparison.

- [ ] Confirm every profile review describes template-specific risks and decisions rather than merely copying the 12 review headings.
- [ ] Confirm every current resolved contract passes `validateDocumentInformationContract`, `auditProfilePlaceholderRules`, and all-facts-missing non-blank checks.
- [ ] Record any profile-specific rule that must never move into a shared category contract.

### Task 2: Introduce composable category-contract primitives

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Test: `supabase/functions/_shared/workplace-governance-resume-equivalence.test.ts`

**Interfaces:**
- Produces: `CategoryInformationContract`, `TemplateContractOverrides`, and a deterministic `composeInformationContract(base, overrides)` path that returns a normal `DocumentInformationContract`.
- Consumes: existing `DocumentInformationContract` and required-information definitions without changing placeholder-token behavior.

- [ ] Write failing tests proving a shared category contract plus template overrides resolves to the same required information as the original hand-authored profile.
- [ ] Add the smallest composition helper needed to merge sections by `sectionKey` and required facts by `key`, preserving template-owned values on conflicts.
- [ ] Reject duplicate or ambiguous override keys instead of silently choosing one.
- [ ] Re-run focused tests.

### Task 3: Extract proven shared employment-term contract

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Modify: `docs/quality/2026-08-09-offer-letter-dip-review.md`
- Modify: `docs/quality/2026-08-09-terms-of-employment-dip-review.md`
- Create: `docs/quality/2026-08-09-employment-terms-shared-profile-review.md`
- Test: `supabase/functions/_shared/workplace-governance-resume-equivalence.test.ts`

**Interfaces:**
- Shared base covers only independently matching employment identity/role/start/pay/hours/location semantics.
- Offer Letter retains offer conditions, acceptance method/deadline and offer-question contact rules.
- Terms of Employment retains duties, policies, obligations, leave/end terms and acknowledgement rules.

- [ ] Add a failing equivalence test comparing pre-consolidation expected fields with the composed Offer Letter and Terms of Employment profiles.
- [ ] Extract only identical or semantically equivalent facts into the shared employment category contract.
- [ ] Encode minute differences as explicit template overrides.
- [ ] Write the shared-profile review explaining why each extracted rule is safe to share and what remains template-owned.
- [ ] Update each per-profile written review with a post-consolidation section confirming no information loss.

### Task 4: Assess operational-governance profiles for smaller shared fragments

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Modify the four corresponding per-profile review docs.
- Create shared review docs only for fragments that prove substantial overlap.
- Test: `supabase/functions/_shared/workplace-governance-resume-equivalence.test.ts`

**Interfaces:**
- Candidates: organisation identity, owner/review semantics, established-policy references, stage-based timing, and generic completion/status semantics.
- Non-candidates remain template-owned: policy sanctions/process, SOP ordered steps/decision branches, induction safety/system guidance, onboarding task/evidence semantics.

- [ ] Compare Workplace Policy, SOP, Induction Manual and Onboarding Checklist fact-by-fact.
- [ ] Extract a shared fragment only when the semantic meaning, fallback behaviour, export rule and clarification intent are materially the same.
- [ ] Keep one-off similarities in the template instead of creating tiny abstractions.
- [ ] Document every extraction decision and every deliberate non-extraction.

### Task 5: Enforce resolved-profile Resume equivalence in CI

**Files:**
- Modify: `supabase/functions/_shared/workplace-governance-resume-equivalence.test.ts`
- Modify: `.github/workflows/apply-resume-information-contract.yml`

**Interfaces:**
- Consumes fully composed profiles from `DIPS`.
- Produces a hard release gate that cannot be satisfied by the shared category object alone.

- [ ] Assert each resolved profile retains all expected profile-specific section keys and required facts.
- [ ] Assert every required fact still supplies all nine decisions after composition.
- [ ] Assert all 12 strict review areas pass per resolved profile.
- [ ] Assert every section remains non-empty when every fact is unresolved.
- [ ] Assert per-profile written review files exist for all six profiles and shared review files exist for every extracted category contract.
- [ ] Run the focused Deno gate, TED gate, Edge Function tests, type-check, lint, package tests and production builds.

### Task 6: Final consolidation audit

**Files:**
- Create: `docs/quality/2026-08-09-profile-consolidation-audit.md`

**Interfaces:**
- Consumes final shared/category contracts, template overrides and CI evidence.
- Produces the evidence record for future catalogue groups.

- [ ] List every extracted shared rule and every per-template override.
- [ ] Record before/after resolved-contract equivalence for each affected template.
- [ ] Confirm no template lost a required fact, clarification question, fallback rule, shared-resolution behavior, export requirement or neutral replacement option.
- [ ] Confirm all six templates still pass the Resume benchmark and strict 12-point review.
