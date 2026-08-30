# Catalogue Information-Contract Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all 79 canonical Document Intelligence profiles to the same information-contract and factual-safety standard as Resume and Cover Letter, integrate every contract into `DIPS`, and make CI reject incomplete, semantically inconsistent, or unreviewed profiles.

**Architecture:** Keep `document-placeholder-policy.ts` as the one runtime policy and `document-intelligence-profiles.ts` as the one profile registry. Add a canonical placeholder vocabulary split into focused domain modules, require each template contract to reference canonical fact definitions, and validate shared-key scope, semantic compatibility, values, fallbacks, reviews and alias ownership before a profile can be complete. Template contracts remain profile-specific, but repeated facts and neutral wording come from canonical definitions rather than copied metadata.

**Tech Stack:** TypeScript, Deno 2-compatible Supabase Edge Function modules, Deno tests, pnpm workspace checks, existing Netlify build configuration.

## Global Constraints

- Preserve one authoritative Document Intelligence engine and one canonical `DIPS` registry.
- Every canonical catalogue profile owns one distinct `informationContract` object; aliases resolve to that canonical profile and never create another contract.
- The nine contract items apply to every required fact: required information, optional information, fact type, placeholder label, exact contextual question, safe automatic fallback decision, export requirement, shared replacement decision and approved neutral replacement decision.
- A missing fallback or shared key is an explicit `undefined` decision, not missing analysis.
- Unknown facts remain declared placeholders unless a canonical, context-safe fallback is selected.
- Never use `TBD`, `To be confirmed`, `Amount not supplied`, `No deadline supplied` or equivalent scaffolding as an automatic fallback that clears export warnings.
- Current role, target role, offered role, employee role and handover role are different facts unless a profile explicitly proves they are identical.
- Employer, provider, client, customer, supplier, landlord, insurer, regulator, institution and primary organisation identities use role-specific shared scopes.
- Complete profiles must pass the full pass gate in `docs/quality/document-intelligence-profile-pass-gate.md` with executable evidence.
- Use Australian English and preserve all unrelated work.

## Verified Baseline and Remaining Gaps

The 6 August 2026 read-only review established this baseline:

| Surface               | Verified state                                                                                                                                                       | Required correction                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime integration   | Only Resume and Cover Letter have `informationContract` values in `DIPS`                                                                                             | Attach corrected contracts to the other 77 canonical profiles and prove 79 distinct object identities                                                         |
| Employment/career     | 20 profiles, 128 facts and 99 export-required facts; 4 direct shared-key collisions, 6 repeated-record risks, and misuse of date-range/event scopes                  | Split role, evidence, recipient, event and availability scopes; add occurrence identities for repeated records and behavioral workflow fixtures               |
| Business/operations   | 26 profiles, 190 facts; all 190 automatically fall back, none require export acknowledgement, and 11 collision groups span 9 profiles                                | Remove blanket fallbacks; replace 26 generic confirmed-detail sections; make each fact, shared scope and export decision profile-specific                     |
| Formal/high-stakes    | 31 profiles are forced to exactly 9 facts (279 total); 127 facts are positionally misassigned, all are export-required, and payment scopes create 45 collision paths | Remove positional distribution; map facts explicitly to sections; author contextual questions; choose required and optional facts from real information needs |
| Canonical consistency | 31 shared keys carry conflicting metadata; 10 local keys split across incompatible meanings                                                                          | Introduce canonical fact IDs, role-specific shared scopes, semantic duplicate detection and compatibility validation                                          |
| Value safety          | `factType` is metadata only                                                                                                                                          | Validate calendar dates, chronological ranges, currency-qualified amounts, percentages, contact details and identifiers                                       |
| Neutral wording       | Common options are copied locally                                                                                                                                    | Resolve reusable options from one canonical fallback library with domain suitability rules                                                                    |
| Review evidence       | Worker review records are generated as passed; their 19 tests are structural                                                                                         | Require literal per-profile fixtures and executable evidence for missing facts, resolution, neutral options, proofreading, export, persistence and recovery   |
| Catalogue CI gate     | Existing 79-profile test does not require contracts                                                                                                                  | Add a fail-closed gate covering contract ownership, completeness, semantics, review evidence and aliases                                                      |

The current worker modules are implementation input, not approved output. Preserve useful section inventories and contextual questions, but do not retain the unsafe constructors or generated pass claims.

---

### Task 1: Lock the known failures with red regression tests

**Files:**

- Create: `supabase/functions/_shared/catalogue-information-contract-regressions.test.ts`
- Use: `supabase/functions/_shared/employment-information-contracts.ts`
- Use: `supabase/functions/_shared/business-information-contracts.ts`
- Use: `supabase/functions/_shared/formal-information-contracts.ts`
- Use: `supabase/functions/_shared/document-placeholder-policy.ts`

**Interfaces:**

- Consumes: the three worker contract records and `resolveDocumentPlaceholders`, `applyDeclaredAutomaticFallback`, `determinePlaceholderExportDecision`.
- Produces: failing behavioral tests for the verified review defects.

- [ ] **Step 1: Add a failing shared-key isolation test**

Create a literal promotion-case fixture containing unresolved `current_role` and `target_role` placeholders. Resolve `current_role` to `Operations Coordinator` and assert `target_role` remains unresolved and its token remains in the target section.

```ts
Deno.test("promotion current role does not resolve target role", () => {
  const result = resolveDocumentPlaceholders(
    contentBySection,
    unresolved,
    "promotion-case.current_role",
    "Operations Coordinator",
  );
  assertEquals(result.resolvedIds, ["promotion-case.current_role"]);
  assert(result.contentBySection.readiness.includes(targetRoleToken));
});
```

- [ ] **Step 2: Run the isolation test and verify RED**

Run:

```bash
deno test --no-config --no-lock supabase/functions/_shared/catalogue-information-contract-regressions.test.ts --filter "promotion current role"
```

Expected: FAIL because both facts currently use `employment.role_title`.

- [ ] **Step 3: Add a failing unsafe-business-fallback test**

Use `workplace-policy.roles_and_responsibilities_confirmed_detail`. Apply its declared automatic fallback and assert that unresolved state cannot become `clear` and rendered content cannot contain `To be confirmed`.

- [ ] **Step 4: Run the fallback test and verify RED**

Expected: FAIL because the current builder assigns `automaticFallback: "To be confirmed"`, removes the unresolved item and clears export warnings.

- [ ] **Step 5: Add failing formal section-mapping tests**

Assert these literal mappings:

```ts
assertSectionFacts("education-cover-letter", "evidence_led_suitability", [
  "evidence_of_fit",
  "motivation",
]);
assertSectionFacts("incident-near-miss-report", "factual_sequence_and_people_involved", [
  "factual_sequence",
  "people_involved",
]);
assertSectionFacts("terms-of-employment", "confirmed_pay_hours_and_location", [
  "pay_terms",
  "hours_location",
]);
```

- [ ] **Step 6: Run the mapping tests and verify RED**

Expected: FAIL because the current formal builder distributes facts by numeric position.

- [ ] **Step 7: Commit the red regression evidence**

```bash
git add supabase/functions/_shared/catalogue-information-contract-regressions.test.ts
git commit -m "test(document): lock catalogue contract regressions"
```

---

### Task 2: Build the canonical placeholder vocabulary and fallback library

**Files:**

- Create: `supabase/functions/_shared/placeholder-registry.ts`
- Create: `supabase/functions/_shared/placeholder-domains/universal.ts`
- Create: `supabase/functions/_shared/placeholder-domains/employment.ts`
- Create: `supabase/functions/_shared/placeholder-domains/business.ts`
- Create: `supabase/functions/_shared/placeholder-domains/education.ts`
- Create: `supabase/functions/_shared/placeholder-domains/financial.ts`
- Create: `supabase/functions/_shared/placeholder-neutral-options.ts`
- Create: `supabase/functions/_shared/placeholder-registry.test.ts`
- Modify: `supabase/functions/_shared/document-placeholder-policy.ts`
- Replace: `supabase/functions/_shared/document-information-contract-registry.ts`

**Interfaces:**

- Produces: `CanonicalPlaceholderId`, `CanonicalPlaceholderDefinition`, `defineCanonicalPlaceholder`, `materialiseRequiredInformation`, `validateCanonicalPlaceholderRegistry`, `CANONICAL_PLACEHOLDERS`, `CANONICAL_NEUTRAL_OPTIONS`.
- Consumes: existing `InformationFactType`, `RequiredInformationDefinition`, `NeutralReplacementOption`.

- [ ] **Step 1: Write failing registry uniqueness and namespace tests**

Require IDs shaped as `<domain>.<role>.<fact>`, unique IDs, unique shared keys, non-empty contextual questions, explicit fallback decisions and valid referenced neutral-option IDs.

```ts
assertEquals(
  validateCanonicalPlaceholderRegistry([
    definition("employment.application.target_role"),
    definition("employment.application.target_role"),
  ]),
  ["duplicate canonical placeholder id: employment.application.target_role"],
);
```

- [ ] **Step 2: Run the registry tests and verify RED**

Expected: FAIL because the registry API does not exist.

- [ ] **Step 3: Define the registry contract**

```ts
export interface CanonicalPlaceholderDefinition {
  id: `${PlaceholderDomain}.${string}.${string}`;
  key: string;
  factType: InformationFactType;
  label: string;
  placeholderLabel: string;
  question: string;
  sharedResolutionKey?: string;
  resolutionScope: "occurrence" | "section" | "outcome";
  allowedProfileKeys: readonly string[] | "all";
  automaticFallbackOptionId?: CanonicalNeutralOptionId;
  neutralOptionIds: readonly CanonicalNeutralOptionId[];
  valueContract?: InformationValueContract;
}
```

- [ ] **Step 4: Define role-specific canonical facts**

At minimum define:

```text
universal.recipient.person_identity
universal.recipient.salutation
universal.document.date
universal.document.reference_number
universal.evidence.attachments
employment.candidate.full_name
employment.current.role_title
employment.application.target_role
employment.offer.role_title
employment.period.date_range
business.primary_organisation.name
business.client.name
business.supplier.name
business.customer.name
education.institution.name
financial.transaction.currency
financial.transaction.amount
financial.invoice.number
financial.payment.due_date
```

Do not retain a generic `organisation.name` or a single `employment.role_title` shared key.

- [ ] **Step 5: Define reusable neutral options**

Create canonical options for `Hiring Manager`, `Recruitment Team`, `Selection Committee`, `To whom it may concern`, `Confidential organisation`, `Dates available on request`, address omission and date omission. Each option declares suitability, export-warning behavior and regeneration behavior. Do not define generic `To be confirmed` options.

- [ ] **Step 6: Implement materialisation**

`materialiseRequiredInformation(canonicalId, overrides)` copies canonical metadata and permits only profile-specific `requiredForExport` and an explicitly narrower question. It must reject changes to `key`, `factType`, `sharedResolutionKey` or neutral-option semantics.

- [ ] **Step 7: Run registry tests and verify GREEN**

```bash
deno test --no-config --no-lock supabase/functions/_shared/placeholder-registry.test.ts
deno check --no-config --no-lock supabase/functions/_shared/placeholder-registry.ts
```

- [ ] **Step 8: Commit the canonical foundation**

```bash
git add supabase/functions/_shared/document-placeholder-policy.ts supabase/functions/_shared/document-information-contract-registry.ts supabase/functions/_shared/placeholder-registry.ts supabase/functions/_shared/placeholder-domains supabase/functions/_shared/placeholder-neutral-options.ts supabase/functions/_shared/placeholder-registry.test.ts
git commit -m "feat(document): add canonical placeholder registry"
```

---

### Task 3: Enforce semantic compatibility and type-specific values

**Files:**

- Create: `supabase/functions/_shared/document-information-contract-validator.ts`
- Create: `supabase/functions/_shared/document-information-contract-validator.test.ts`
- Modify: `supabase/functions/_shared/document-placeholder-policy.ts`

**Interfaces:**

- Produces: `validateCatalogueInformationContracts`, `validateInformationFactValue`, `validateSharedResolutionCompatibility`.
- Consumes: canonical registry definitions and complete profile contracts.

- [ ] **Step 1: Write failing semantic-duplicate tests**

Use literal pairs such as `company_name`/`business_name`, `applicantName`/`candidate_name`, and conflicting `recipient.identity` person/company facts. Require a deterministic error that names both profiles and sections.

- [ ] **Step 2: Write failing shared-scope tests**

Require failure when one outcome assigns the same shared key to current and target role, supplier and customer, or event details and incident chronology.

- [ ] **Step 3: Write failing value-contract tests**

Cover valid and invalid ISO dates, chronological date ranges, currency-qualified amounts, percentages from `0` through `100`, email addresses, phone/contact values and non-empty identifiers.

```ts
assertEquals(validateInformationFactValue("date", "2026-02-30"), ["invalid calendar date"]);
assertEquals(
  validateInformationFactValue("date_range", {
    start: "2026-08-10",
    end: "2026-08-01",
  }),
  ["date range ends before it starts"],
);
```

- [ ] **Step 4: Run validator tests and verify RED**

Expected: FAIL because catalogue semantic and value validators do not exist.

- [ ] **Step 5: Implement namespace, semantic, scope and value validation**

Use explicit synonym groups and canonical IDs; do not rely on fuzzy similarity alone. Value validation returns errors without mutating or normalising user data.

- [ ] **Step 6: Run validator tests and verify GREEN**

```bash
deno test --no-config --no-lock supabase/functions/_shared/document-information-contract-validator.test.ts
```

- [ ] **Step 7: Commit the validators**

```bash
git add supabase/functions/_shared/document-information-contract-validator.ts supabase/functions/_shared/document-information-contract-validator.test.ts supabase/functions/_shared/document-placeholder-policy.ts
git commit -m "feat(document): validate placeholder semantics and values"
```

---

### Task 4: Rebuild the employment and career vertical to flagship depth

**Files:**

- Replace: `supabase/functions/_shared/employment-information-contracts.ts`
- Replace: `supabase/functions/_shared/employment-information-contracts.test.ts`
- Create: `supabase/functions/_shared/employment-information-contract-fixtures.ts`
- Use: `supabase/functions/_shared/resume-information-contract.test.ts`
- Use: `supabase/functions/_shared/cover-letter-strict-workflow-review.test.ts`

**Interfaces:**

- Consumes: canonical registry materialisation and shared strict-workflow harness from Task 3.
- Produces: 20 audited employment/career contracts and explicit behavioral fixtures.

- [ ] **Step 1: Split the 20 profiles into five reviewable batches**

```text
Batch A: job-search-checklist, interview-prep-questions, interview-script, job-follow-up-email
Batch B: pay-rise-request, promotion-case, selection-criteria-response, star-achievement-bank
Batch C: linkedin-profile-rewrite, professional-reference-letter, personal-brand-statement, career-change-plan
Batch D: resignation-letter, networking-outreach-message, recruiter-introduction-email, leave-availability-request
Batch E: performance-improvement-plan, training-plan-skills-matrix, timesheet, staff-roster
```

- [ ] **Step 2: For each profile, write the failing fixture before changing its contract**

Each fixture declares literal expected section keys, required canonical fact IDs, optional facts, unresolved placeholders, one direct answer, one shared-resolution isolation case, neutral-option expectations, export decision and prohibited inventions.

- [ ] **Step 3: Rebuild each contract with explicit section mapping**

Replace `employment.role_title` with role-specific canonical IDs. Reuse a shared key only when two occurrences are the same real-world fact in the same outcome.

- [ ] **Step 4: Run each profile filter before moving to the next profile**

```bash
deno test --no-config --no-lock supabase/functions/_shared/employment-information-contracts.test.ts
```

Expected after implementation: PASS for contract validation, missing-facts generation, resolution isolation, neutral option, proofreading exclusion and export behavior.

- [ ] **Step 5: Run the full employment vertical**

```bash
deno test --no-config --no-lock supabase/functions/_shared/employment-information-contracts.test.ts supabase/functions/_shared/catalogue-information-contract-regressions.test.ts
```

- [ ] **Step 6: Commit one completed batch at a time**

Use messages `feat(document): complete employment contracts batch a` through `batch e`, staging only the three employment files.

---

### Task 5: Rebuild the business and operational vertical to flagship depth

**Files:**

- Replace: `supabase/functions/_shared/business-information-contracts.ts`
- Replace: `supabase/functions/_shared/business-information-contracts.test.ts`
- Create: `supabase/functions/_shared/business-information-contract-fixtures.ts`

**Interfaces:**

- Produces: 26 audited profile-specific contracts with no generic confirmed-detail facts and no blanket fallbacks.

- [ ] **Step 1: Delete the blanket `fact()` fallback behavior under a failing test**

No constructor may default `automaticFallback`, `requiredForExport` or neutral options. Each decision must come from a canonical fact or an explicit profile fixture.

- [ ] **Step 2: Replace all 26 generic confirmed-detail sections**

The affected sections include roles and responsibilities, first-day tasks, first-week tasks, overall rating, proposed solution, assumptions and risks, offering, target market, options, scope, wins, challenges, channels, project scope, owners, priorities, options considered, handover status, rollback, condition, feedback themes and comparison weighting.

- [ ] **Step 3: Split profiles into five batches**

```text
Batch A: business-email, workplace-policy, sop, induction-manual, onboarding-checklist
Batch B: performance-review, meeting-minutes, proposal, business-plan, executive-summary
Batch C: pitch-deck-outline, scope-of-work, board-report, quarterly-business-review, marketing-brief
Batch D: project-plan, project-status-report, meeting-agenda, action-register, decision-log, handover-document
Batch E: change-request, asset-register-maintenance-log, stocktake-inventory-count, customer-feedback-summary, competitor-comparison
```

- [ ] **Step 4: Write and run one literal strict-workflow fixture per profile**

Every test must exercise real placeholder creation, missing-fact rendering, resolution, export and fallback behavior. Tests must not merely enumerate object keys or assert that review prose contains criterion names.

- [ ] **Step 5: Verify the business vertical**

```bash
deno test --no-config --no-lock supabase/functions/_shared/business-information-contracts.test.ts supabase/functions/_shared/catalogue-information-contract-regressions.test.ts
```

- [ ] **Step 6: Commit each completed batch**

Use these messages with explicit paths, in order:

```text
feat(document): complete business contracts batch a
feat(document): complete business contracts batch b
feat(document): complete business contracts batch c
feat(document): complete business contracts batch d
feat(document): complete business contracts batch e
```

---

### Task 6: Rebuild formal, personal and high-stakes contracts to flagship depth

**Files:**

- Replace: `supabase/functions/_shared/formal-information-contracts.ts`
- Replace: `supabase/functions/_shared/formal-information-contracts.test.ts`
- Create: `supabase/functions/_shared/formal-information-contract-fixtures.ts`

**Interfaces:**

- Produces: 31 explicit high-stakes contracts with fact placement determined by semantics rather than fact count.

- [ ] **Step 1: Remove the exactly-nine-facts invariant and positional distributor**

`facts.length !== 9` and `Math.floor(factIndex * sections / 9)` must disappear. Each `SectionInformationContract` declares its own facts directly.

- [ ] **Step 2: Split profiles into six batches**

```text
Batch A: personal-statement, education-cover-letter, reference-request, scholarship-application, statement-of-purpose
Batch B: study-plan, research-proposal, literature-review, academic-appeal-letter, extension-request-letter
Batch C: student-support-plan, course-comparison-matrix, academic-reference-request, budget-workbook, financial-review
Batch D: profit-and-loss-statement, forecasted-earnings, ebitda-analysis, investment-capital-gains-report, invoice
Batch E: cash-flow-forecast, expense-claim, offer-letter, terms-of-employment, service-agreement
Batch F: risk-assessment, grant-funding-proposal, quote-estimate, purchase-order, incident-near-miss-report, business-case
```

- [ ] **Step 3: Write red placement tests for every profile before rebuilding it**

Literal fixtures must identify which section consumes each fact. High-stakes facts use empty neutral option lists unless an approved canonical salutation or omission is demonstrably safe.

- [ ] **Step 4: Add calculation and source-evidence boundaries**

Financial contracts distinguish raw source amounts, currency, tax basis, reporting period, calculation method and derived totals. Legal/employment contracts distinguish parties, roles, terms, dates, clauses, acceptance, signatures and professional-review warnings.

- [ ] **Step 5: Verify the formal vertical**

```bash
deno test --no-config --no-lock supabase/functions/_shared/formal-information-contracts.test.ts supabase/functions/_shared/catalogue-information-contract-regressions.test.ts
```

- [ ] **Step 6: Commit each completed batch**

Use these messages with explicit paths, in order:

```text
feat(document): complete formal contracts batch a
feat(document): complete formal contracts batch b
feat(document): complete formal contracts batch c
feat(document): complete formal contracts batch d
feat(document): complete formal contracts batch e
feat(document): complete formal contracts batch f
```

---

### Task 7: Integrate all 79 distinct contracts into DIPS and enforce alias ownership

**Files:**

- Create: `supabase/functions/_shared/catalogue-information-contracts.ts`
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Modify: `supabase/functions/_shared/document-intelligence-profiles.test.ts`

**Interfaces:**

- Produces: `CATALOGUE_INFORMATION_CONTRACTS`, `getCatalogueInformationContract`, 79 contract-bearing `DIPS` profiles.
- Consumes: Resume, Cover Letter and the three corrected vertical registries.

- [ ] **Step 1: Write a failing exact-79 integration test**

```ts
assertEquals(DIPS.length, 79);
assertEquals(DIPS.filter((profile) => profile.informationContract).length, 79);
assertEquals(new Set(DIPS.map((profile) => profile.informationContract)).size, 79);
```

Also assert every `EXTENDED_CATALOGUE` key matches exactly one contract entry.

- [ ] **Step 2: Run the integration test and verify RED**

Expected: FAIL because only Resume and Cover Letter are currently attached.

- [ ] **Step 3: Merge the corrected records and reject overlaps**

`CATALOGUE_INFORMATION_CONTRACTS` contains exactly the 77 non-flagship profiles. Resume and Cover Letter remain authored in `document-intelligence-profiles.ts` until a later focused extraction.

- [ ] **Step 4: Attach distinct contract values in `completeProfile()`**

Clone the selected contract and review record during profile construction so no two canonical profiles share mutable arrays or objects.

```ts
const catalogueContract = CATALOGUE_INFORMATION_CONTRACTS[key];
const informationContract = structuredClone(
  authored?.informationContract ?? catalogueContract?.informationContract,
);
```

- [ ] **Step 5: Prove aliases reuse canonical profiles**

For every `PROFILE_ALIASES` entry, assert `selectProfile(alias)?.key` equals the canonical catalogue key and no alias key appears in `DIPS` or the contract registry.

- [ ] **Step 6: Run the integration tests and verify GREEN**

```bash
deno test --no-config --no-lock supabase/functions/_shared/document-intelligence-profiles.test.ts
```

- [ ] **Step 7: Commit integration**

```bash
git add supabase/functions/_shared/catalogue-information-contracts.ts supabase/functions/_shared/document-intelligence-profiles.ts supabase/functions/_shared/document-intelligence-profiles.test.ts
git commit -m "feat(document): integrate all catalogue information contracts"
```

---

### Task 8: Add the fail-closed 79-template completion gate

**Files:**

- Create: `supabase/functions/_shared/catalogue-information-contract-gate.test.ts`
- Modify: `.github/workflows/ci.yml` only if the repository test command does not discover the gate.
- Modify: `docs/superpowers/plans/2026-08-02-document-intelligence-profile-migration.md`

**Interfaces:**

- Consumes: all 79 `DIPS` profiles, canonical registry, semantic validators, internal reviews and strict-workflow fixtures.
- Produces: CI failure for any incomplete, contradictory, duplicate, unsafe or unreviewed profile.

- [ ] **Step 1: Add literal gate assertions**

Require:

```text
79 canonical profiles
79 distinct contract object identities
79 complete contracts with auditedAt
exact section coverage
canonical fact IDs for every required fact
valid namespace and value contracts
no semantic duplicates
no incompatible shared keys within an outcome
passed 12-area review with profile-specific counts and test receipts
no prohibited anti-placeholder wording
no competing alias contracts
one strict-workflow fixture per canonical profile
```

- [ ] **Step 2: Mutation-check the gate**

Temporarily remove one contract, duplicate one shared key across current/target role and introduce `To be confirmed`; confirm the gate fails for each mutation, then restore the source.

- [ ] **Step 3: Run focused and broad Deno checks**

```bash
deno fmt --check supabase/functions/_shared
deno lint --rules-exclude=no-import-prefix supabase/functions/_shared
deno check --no-config --no-lock supabase/functions/_shared/document-intelligence-profiles.ts
deno test --no-config --no-lock supabase/functions/_shared
```

- [ ] **Step 4: Run repository checks**

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm build
```

- [ ] **Step 5: Run Netlify parity build**

```bash
npx netlify build
```

Do not deploy. Inspect output for client-exposed secrets and Edge Function bundling failures.

- [ ] **Step 6: Run the Codex Security diff scan**

Scan the PR diff with emphasis on placeholder input validation, cross-fact replacement, sensitive document content, exports and Supabase Edge Function boundaries. Resolve validated blocking findings before publication.

- [ ] **Step 7: Update the migration plan and commit the gate**

Mark tasks complete only when the commands above pass with fresh evidence.

```bash
git add supabase/functions/_shared/catalogue-information-contract-gate.test.ts .github/workflows/ci.yml docs/superpowers/plans/2026-08-02-document-intelligence-profile-migration.md
git commit -m "test(document): enforce 79-profile contract completion"
```

---

## Completion Evidence

The migration is complete only when all of the following are observed on the same head SHA:

- The 79-template gate passes.
- All three corrected vertical suites pass.
- Resume and Cover Letter strict suites remain green.
- Deno format, lint, check and complete shared-function tests pass.
- Workspace type-check, lint, test and build pass.
- Netlify parity build passes without deployment.
- The security diff scan has no unresolved blocking finding.
- The PR remains draft until the exact completion head is pushed and CI confirms the same gates.
