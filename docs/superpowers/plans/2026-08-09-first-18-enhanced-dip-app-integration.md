# First 18 Enhanced DIP App Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the first 18 Resume-standard Document Intelligence Profiles into the live PrompTED document workflow without importing contradictory legacy rules, while preserving existing useful DIP intelligence and guaranteeing final wording, factual grounding, interactive clarification for missing facts, and zero blank sections/documents.

**Architecture:** Integrate in ordered slices rather than merging PR #89 wholesale. First establish one canonical document rule/placeholder contract in the core engine; next compose the existing broad Document Intelligence layer with the new per-profile information contracts into one resolved Enhanced DIP; then port the 18 independently passed templates; finally wire structured placeholders through generation, persistence, editing and export. Universal rules are applied first, any future proven category/shared contract second, and per-template rules last so template-specific decisions always win.

**Tech Stack:** Deno Supabase Edge Functions, TypeScript, React/Next.js web app, shared TypeScript API client, GitHub Actions.

## Global Constraints

- Resume is the strict benchmark for every resolved template DIP.
- Every required fact must retain all nine DIP decisions: `key`, `label`, `factType`, `placeholderLabel`, contextual `question`, automatic-fallback decision, `requiredForExport`, `sharedResolutionKey`, and `neutralReplacementOptions`.
- Every template must have its own written review and independently pass all 12 strict DIP review areas.
- Missing information is not unsafe content. It becomes a declared interactive placeholder or an explicitly approved neutral fallback.
- Never invent names, dates, figures, organisations, credentials, achievements, events, duties, legal status, obligations, evidence or other factual details.
- Every requested section must contain usable final wording. No blank section, blank document, headings-only output, scaffold text or drafting instructions may be delivered.
- Declared `{{TED_PLACEHOLDER:...}}` tokens are valid unresolved document content; undeclared/raw placeholders remain invalid.
- The user receives final wording around placeholders. Clarification questions belong to placeholder metadata/UI, not as drafting instructions inside the document.
- A genuine runtime or unrecoverable document-level quality failure may fail generation; ordinary missing facts must not.
- Never force-push. Never touch `release/ios-v1-locked`.
- Core/universal-rule integration and template payload integration ship separately.

---

### Task 1: Stabilise branch-writing workflows before integration

**Files:**
- Modify: `.github/workflows/apply-resume-information-contract.yml`
- Modify: `.github/workflows/verify-workplace-governance-per-profile.yml`

**Interfaces:**
- Consumes: PR head branch from `github.event.pull_request.head.ref`.
- Produces: deterministic, serialised branch writes without force pushes.

- [ ] **Step 1: Reproduce the existing failure from Actions evidence**

Confirm the failing per-profile run completed all benchmark steps, created a local commit, then failed with non-fast-forward push because another workflow advanced the same PR branch.

- [ ] **Step 2: Serialize both writing workflows with one shared concurrency group**

Both workflows must contain:

```yaml
concurrency:
  group: dip-branch-write-${{ github.event.pull_request.head.ref }}
  cancel-in-progress: false
```

- [ ] **Step 3: Rebase generated commits before a normal push**

After each bot commit, use:

```bash
git fetch origin "${GITHUB_HEAD_REF}"
git rebase "origin/${GITHUB_HEAD_REF}"
git push origin "HEAD:${GITHUB_HEAD_REF}"
```

Do not use `--force`, `--force-with-lease`, reset, or overwrite the remote branch.

- [ ] **Step 4: Verify workflow behavior**

Expected: catalogue and per-profile workflows do not race; if no generated diff remains, the workflow exits successfully; if a generated commit exists, it rebases cleanly and pushes normally.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/apply-resume-information-contract.yml .github/workflows/verify-workplace-governance-per-profile.yml
git commit -m "fix(ci): serialize DIP branch writes"
```

---

### Task 2: Create the core-only integration branch and lock outcome invariants

**Branch:** `refactor/document-core-enhanced-dip`

**Files:**
- Create: `supabase/functions/_shared/document-outcome-invariants.test.ts`
- Modify: `supabase/functions/_shared/document-placeholder-policy.ts`
- Modify: `supabase/functions/_shared/document-intelligence.ts`
- Modify: `supabase/functions/_shared/prompt-builder.ts`
- Modify: `supabase/functions/_shared/draft-validator.ts`
- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Add from PR #93: `supabase/functions/_shared/document-delivery-guard.ts`
- Add from PR #93: `supabase/functions/_shared/document-delivery-guard.test.ts`
- Modify: `supabase/functions/generate-document/index.ts`

**Interfaces:**
- Consumes: existing TED document pipeline and PR #89 universal placeholder policy only; no first-18 template payload in this slice.
- Produces: one canonical core contract that distinguishes declared interactive placeholders from invalid scaffold placeholders.

- [ ] **Step 1: Write failing invariant tests before changing core behavior**

Tests must prove:

```text
1. Declared TED placeholder token is allowed in otherwise final wording.
2. Raw [insert name], {{name}}, TBD and scaffold text remain rejected.
3. Missing required information never causes content:"".
4. Unsupported factual claims remain blocking/rewrite targets.
5. A blank section cannot cross the delivery boundary.
6. Final wording containing declared placeholders is not classified as instruction leakage.
```

Run:

```bash
deno test --no-lock \
  supabase/functions/_shared/document-placeholder-policy.test.ts \
  supabase/functions/_shared/document-outcome-invariants.test.ts \
  supabase/functions/_shared/document-delivery-guard.test.ts
```

Expected initially: failures where current validator/auditor treats all placeholders as forbidden.

- [ ] **Step 2: Make `document-placeholder-policy.ts` the sole placeholder authority**

Keep `UNIVERSAL_DOCUMENT_PLACEHOLDER_RULES`, token parsing, contract validation, resolution and export-decision logic there. Add a helper that distinguishes declared TED tokens from arbitrary placeholder syntax so validators do not duplicate token grammar.

- [ ] **Step 3: Remove contradictory placeholder doctrine from `document-intelligence.ts`**

Preserve product identity, expertise, factual discipline, domain controls and section-quality knowledge. Replace legacy free-text rules such as raw bracket placeholders and `Missing vital details:` lines with the canonical structured-placeholder policy. Do not maintain a second placeholder syntax in this module.

- [ ] **Step 4: Remove duplicated contradictory rules from `prompt-builder.ts`**

Delete task-level instructions that say `never use bracketed placeholders` or require writing around every unknown. Replace them with one reference rendered from the canonical placeholder rules. Preserve final-wording, user-voice, factual-grounding and no-blank requirements.

- [ ] **Step 5: Make `draft-validator.ts` token-aware**

Before generic `{{...}}` rejection, mask valid parsed `{{TED_PLACEHOLDER:...}}` tokens exactly as markdown links/checkboxes are protected. `stripResidual()` must preserve declared TED tokens while still removing raw placeholders, TODO/TBD markers and scaffold copy.

- [ ] **Step 6: Remove blank-section manufacture from `document-pipeline.ts`**

Delete the release behavior that maps blocked sections to `{ ...section, content: "" }`. Missing-information state must be represented through declared placeholders and metadata, not an empty section. Keep factual and quality auditing, targeted repair and true document-level failure for unrecoverable pipeline/quality faults.

- [ ] **Step 7: Teach the auditor that declared unresolved placeholders are valid**

Update audit prompts and deterministic checks so a declared token is excluded from grammar/style findings and is not itself a factual claim. Surrounding prose and all unsupported factual claims remain fully audited.

- [ ] **Step 8: Add PR #93 delivery guard at the final SSE boundary**

Call `assertDeliverableSections(reviewedSections)` before streaming the first section. This is a last-resort invariant, not the mechanism used to handle missing information.

- [ ] **Step 9: Run core verification**

```bash
deno test --no-lock supabase/functions/_shared/*.test.ts
deno check supabase/functions/generate-document/index.ts
pnpm type-check
pnpm lint
pnpm test
pnpm --filter web build
```

Acceptance: core passes without importing any of the 18 template contracts.

---

### Task 3: Blend the existing DIP and new information contracts into one Enhanced DIP

**Branch:** `feat/enhanced-dip-runtime` from the merged core branch.

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Modify: `supabase/functions/_shared/document-intelligence.ts`
- Modify: `supabase/functions/_shared/prompt-builder.ts`
- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Create: `supabase/functions/_shared/enhanced-dip-resolution.test.ts`

**Interfaces:**
- Consumes: existing `DocumentIntelligenceProfile` fields (`matches`, `domains`, required/high-value information, questions, uploads, inferable information, risk checks, output structure, quality, benchmarks, proof fixtures) plus the new `informationContract` and `internalReview`.
- Produces: one resolved `DocumentIntelligenceProfile` used consistently by prompt construction, planning, generation and audit.

- [ ] **Step 1: Write resolution tests**

For Resume and one non-Resume fixture, assert that resolution preserves existing routing/quality/benchmark intelligence while adding the new information contract rather than replacing the old DIP.

- [ ] **Step 2: Define one precedence order**

Resolved profile precedence must be:

```text
Universal engine rules
→ proven category/shared profile rules (none required for first integration)
→ existing template DIP intelligence
→ new per-template information contract and template-specific rules
→ confirmed runtime/user facts
```

Later layers may specialise earlier defaults but may not weaken universal factual/no-blank invariants.

- [ ] **Step 3: Make `renderProfile()` render one Enhanced DIP**

The rendered profile must contain existing quality/benchmark/risk intelligence plus the complete nine-item information contract and universal placeholder behavior. Remove any legacy summary rule that contradicts the resolved contract instead of rendering both.

- [ ] **Step 4: Select the profile once per pipeline execution**

Resolve the Enhanced DIP near the start of `runDocumentPipeline()` and pass it to intent/planning/writing/audit stages. Do not repeatedly re-select slightly different profiles from free-text hints in separate stages.

- [ ] **Step 5: Verify legacy intelligence is not lost**

Tests must assert Resume keeps its existing quality benchmark, evidence rules and proof fixtures after information-contract integration.

---

### Task 4: Port the first 18 passed profiles as template-owned payloads

**Branch:** `feat/first-18-enhanced-dips` from the merged Enhanced DIP runtime.

**Profiles:** Resume; Cover Letter; Job-search Action Checklist; Interview Preparation Questions; Interview Script; Job Follow-up Email; Pay-rise Request & Conversation Script; Promotion Case; Personal Statement; Application Letter — Education; Reference Request; Business Email; Workplace Policy; Standard Operating Procedure; Offer Letter; Terms of Employment; Induction Manual; Onboarding Checklist.

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Port the existing per-profile review documents under `docs/quality/`
- Port/retain per-profile strict tests under `supabase/functions/_shared/`
- Retire migration-only scripts once their payload is represented directly in the canonical profile source and parity tests prove equivalence.

**Interfaces:**
- Consumes: Enhanced DIP runtime from Task 3.
- Produces: 18 canonical resolved profiles directly usable by document generation.

- [ ] **Step 1: Port profiles without abstraction**

Bring each independently passed contract across as its own template-owned contract first. Do not consolidate category overlap during this step.

- [ ] **Step 2: Preserve all nine decisions and written reviews**

For every required fact, compare the integrated contract to PR #89 source and fail parity if any decision changed or disappeared.

- [ ] **Step 3: Run every profile through the strict 12-point benchmark**

The existing Resume-standard profile tests remain the acceptance gate. Shared/group tests may supplement but cannot replace per-profile PASS.

- [ ] **Step 4: Add generation fixtures for each profile**

Each profile must cover:

```text
complete facts
all required facts missing
partial facts
contradictory facts
invention pressure
multiple unresolved placeholders in one section
approved neutral fallback where declared
```

Expected for missing facts: final wording + structured placeholder metadata, never blank content.

- [ ] **Step 5: Run first-18 verification**

Require 18/18 profile PASS plus full Deno/TypeScript/lint/test/build CI before this slice can merge.

---

### Task 5: Wire structured placeholders through the API and Workspace

**Branch:** `feat/interactive-placeholder-workspace` from the merged first-18 branch.

**Files:**
- Modify: `supabase/functions/generate-document/index.ts`
- Modify: `packages/shared/src/api-client/index.ts`
- Modify: `apps/web/src/lib/document-generation.ts`
- Modify: `apps/web/src/hooks/useDocument.ts`
- Modify the existing Workspace section renderer/editor component that displays `Section.content` after locating it in the branch at implementation time.
- Add/update: `apps/web/src/lib/document-generation-stream.test.ts`

**Interfaces:**
- Consumes: structured placeholder tokens and unresolved placeholder metadata from the pipeline.
- Produces: clickable/selectable unresolved facts, contextual clarification questions, scoped resolution, persistence and export warnings.

- [ ] **Step 1: Extend generation events with unresolved placeholder metadata**

Do not overload the old `missing_info` string array. Add typed metadata containing placeholder id, profile/section/information keys, label, question, fact type, export requirement, shared-resolution key and neutral options.

- [ ] **Step 2: Preserve final wording in `useDocument`**

A section containing a declared unresolved placeholder must not be added to `generationIssues` as a failed/blank section. `missingRequiredSections()` continues to flag actual empty required sections only.

- [ ] **Step 3: Render declared tokens as interactive controls**

The Workspace displays the placeholder label inline, and selecting it surfaces that placeholder's exact DIP clarification question. Raw undeclared placeholder-looking text is displayed as text or rejected by the validator; it is never silently treated as a valid control.

- [ ] **Step 4: Resolve by placeholder id/shared-resolution key**

Use `resolveDocumentPlaceholders()` so only the selected token and explicitly linked semantic occurrences update. Preserve all unrelated user edits.

- [ ] **Step 5: Persist unresolved metadata**

Local and signed-in workspace persistence must save both section wording and unresolved placeholder state so refresh/reopen does not lose questions or falsely mark a document complete.

- [ ] **Step 6: Apply export behavior**

Use `determinePlaceholderExportDecision()`: optional unresolved facts warn; `requiredForExport` facts require acknowledgement/resolution according to the contract. Generation itself remains available.

---

### Task 6: Remove superseded rules and prove there is one rule source

**Files:**
- Modify: `supabase/functions/_shared/document-intelligence.ts`
- Modify: `supabase/functions/_shared/prompt-builder.ts`
- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Modify: `supabase/functions/_shared/draft-validator.ts`
- Modify: `supabase/functions/_shared/document-intelligence-profiles.ts`
- Test: `supabase/functions/_shared/document-placeholder-policy.test.ts`
- Create: `supabase/functions/_shared/document-rule-precedence.test.ts`

- [ ] **Step 1: Scan all document prompts/rules for contradictions**

Fail the test if core/profile rule text contains legacy patterns such as `never use placeholders`, `do not use placeholders`, `fail if required fact is missing`, or a release path that writes `content: ""`.

- [ ] **Step 2: Delete superseded duplicates rather than leaving comments around them**

Keep each concept in one authoritative place:

```text
placeholder syntax/resolution/export → document-placeholder-policy.ts
product/domain expertise → document-intelligence.ts
per-template intelligence/contracts → document-intelligence-profiles.ts
pipeline orchestration/repair → document-pipeline.ts
final deterministic text validation → draft-validator.ts
last delivery invariant → document-delivery-guard.ts
```

- [ ] **Step 3: Verify precedence and outcome invariants**

Run all document core tests and first-18 tests. No module may weaken `no invented facts`, `no blank sections/documents`, or `final user wording`.

---

### Task 7: Post-integration similarity assessment and conservative consolidation

**Files:**
- Create: `docs/quality/2026-08-09-first-18-shared-contract-assessment.md`
- Modify `document-intelligence-profiles.ts` only for overlap proven by the assessment.
- Add composition parity tests for every template touched by consolidation.

- [ ] **Step 1: Compare the integrated, individually passing contracts**

Measure semantic overlap after app integration. Do not infer a category contract merely because templates share a domain name.

- [ ] **Step 2: Extract only materially identical rules**

A shared contract may own common semantics such as employee identity or organisation identity only when the independently authored contracts agree on fact meaning and safety behavior.

- [ ] **Step 3: Keep minute differences in template rules**

Template rules are applied last. Candidate vs employee terminology, legal-vs-trading employer name, export criticality, clarification wording and neutral fallback differences remain template-owned.

- [ ] **Step 4: Re-run Resume benchmark after composition**

The resolved final DIP, not the shared fragment, must still pass all nine-decision validation, all 12 review areas, all-facts-missing zero-blank tests and full CI.

---

### Task 8: Final release gate and merge order

**Merge order:**

```text
1. Core engines + canonical universal rules
2. Enhanced DIP composition/runtime
3. First 18 per-profile contracts/reviews
4. Interactive placeholder Workspace/API integration
5. Optional proven shared-contract consolidation
```

- [ ] **Step 1: Run end-to-end outcome matrix for all 18 profiles**

For each profile verify: final user wording; factual grounding; no invented facts; no blank section; no blank document; declared placeholders for missing required facts; exact clarification questions; safe neutral fallbacks only when declared; user edits preserved; export policy enforced.

- [ ] **Step 2: Verify no old rule source survives**

Search the merged candidate for contradictory placeholder bans and `content: ""` quality-gate release behavior. Any hit must be explained as test text or removed.

- [ ] **Step 3: Run repository gates**

```bash
pnpm type-check
pnpm lint
pnpm test
pnpm --filter web build
deno test --no-lock supabase/functions/_shared/*.test.ts
deno check supabase/functions/generate-document/index.ts
```

- [ ] **Step 4: Merge only after all sequential slices are green**

No force merge. A later slice may not be merged to compensate for a red earlier slice. If an acceptance test fails, fix/revert that slice before continuing.
