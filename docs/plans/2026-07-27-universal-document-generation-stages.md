# PrompTED Universal Document Generation Stages

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** APPROVED IMPLEMENTATION ORDER — this is the prerequisite for template expansion and the job-application launch
**Prepared:** 2026-07-27
**Scope:** Every generated textual document, checklist, plan, report and application document in PrompTED
**Primary outcome:** Fast, usable final wording that is tailored to the user’s goal, contains no invented facts, and can be traced section-by-section to confirmed inputs or disclosed professional judgement

## Decision

PrompTED will use one generation state machine for every document. A template supplies the document-specific contract; it must not create its own generation workflow.

The existing v2 document pipeline remains the foundation. Its intent interpretation, section planning, concurrent drafting, independent audit, targeted rewrite and final-text guards are retained. The universal work adds:

- a typed generation contract for every template;
- a source and claim ledger instead of flattened context alone;
- one explicit missing-information and clarification gate before drafting;
- persisted stage checkpoints, idempotency and safe resume;
- deterministic validation before model review;
- a final user-language assembly and export gate;
- common quality evidence across all templates and workflows.

The job-application plan, financial uploads, performance reviews, proposals, rosters, timesheets and future documents are downstream consumers of this pipeline.

## Non-negotiable rules

1. TED never invents names, identities, dates, amounts, performance results, credentials, events, legal status, obligations, quotations, evidence or regulatory conclusions.
2. Uploaded material is a source, not automatically a fact. Extraction confidence and provenance are retained.
3. TED asks only questions that materially affect accuracy, safety or usability. Ordinary professional choices are safe assumptions and are recorded.
4. Drafting does not begin while a blocking variable is unresolved.
5. Every section declares its required variables and binds every material factual claim to a source.
6. Calculations, totals, rates, dates and comparisons are produced or checked deterministically where possible.
7. A model cannot approve its own draft. Semantic audit uses a separate request and a constrained review schema.
8. A failed required gate never returns an artifact marked ready.
9. The document contains final wording for the user—not instructions, placeholders, template hints or commentary about what a section should contain.
10. The user can see assumptions, unresolved limitations and the source of material claims without exposing private internal prompts.
11. Retries resume from the earliest invalid stage and do not duplicate records, charges or versions.
12. Logs and analytics contain identifiers, timings, status and reason codes—not document bodies, extracted private content or raw prompts.

## Universal state machine

```text
RECEIVED
  → INTENT_RESOLVED
  → TEMPLATE_RESOLVED
  → SOURCES_READY
  → REQUIREMENTS_ASSESSED
  → AWAITING_CLARIFICATION (only when blocking facts are missing)
  → BRIEF_LOCKED
  → SECTION_PLAN_READY
  → DRAFT_READY
  → DETERMINISTIC_VALIDATION_PASSED
  → SEMANTIC_AUDIT_PASSED
  → FINAL_ASSEMBLY_PASSED
  → RENDER_VALIDATED
  → READY
```

Any stage may enter `FAILED_RETRYABLE`, `FAILED_TERMINAL` or `CANCELLED`. `AWAITING_CLARIFICATION` is a valid pause, not a failure.

## Stage contract shared by every step

Each stage receives and returns a versioned envelope:

```ts
interface GenerationEnvelope {
  schemaVersion: 1;
  pipelineVersion: string;
  generationId: string;
  idempotencyKey: string;
  userId: string;
  templateKey: string;
  templateContractVersion: number;
  currentStage: GenerationStage;
  inputRevision: number;
  sourceLedger: SourceRecord[];
  factLedger: FactRecord[];
  assumptions: AssumptionRecord[];
  unresolvedVariables: MissingVariable[];
  outcomeBrief?: OutcomeBrief;
  sectionPlan?: SectionPlan[];
  draftSections?: DraftSection[];
  validation?: ValidationResult;
  audit?: AuditResult;
  artifactId?: string;
}
```

Every stage must:

- validate its input schema;
- write an immutable stage event with start, finish, version and reason code;
- store only the minimum checkpoint needed to resume;
- reject stale `inputRevision` values;
- be safe to retry with the same idempotency key;
- return a user-safe error and a diagnostic correlation ID;
- avoid logging source text or generated content.

## Template generation contract

Every library item must provide a versioned `TemplateGenerationContract` alongside its display metadata:

```ts
interface TemplateGenerationContract {
  templateKey: string;
  version: number;
  outcomeDefinition: string;
  supportedIntents: string[];
  audienceRules: AudienceRule[];
  requiredSources: SourceRequirement[];
  variables: VariableDefinition[];
  clarificationPolicy: ClarificationPolicy;
  sections: SectionContract[];
  deterministicChecks: CheckDefinition[];
  semanticChecks: CheckDefinition[];
  renderProfiles: RenderProfile[];
  benchmarkProfile: BenchmarkProfile;
  safetyProfile: SafetyProfile;
}
```

Each `SectionContract` must define:

- canonical key and user-facing label;
- section purpose and expected final form;
- required and optional variables;
- allowed source types;
- allowed safe assumptions;
- prohibited claims and prohibited filler;
- minimum useful content and practical maximum length;
- tone, audience and formality;
- calculations or correlations that must appear;
- omission rules;
- document-type benchmark characteristics;
- deterministic and semantic acceptance checks.

Contracts are code-reviewed data. Prompt text must not silently redefine them.

## Stage 0 — Receive, authenticate and de-duplicate

**Purpose:** Establish a safe, traceable generation request before model work begins.

**Inputs**

- Authenticated user.
- Template key or natural-language request.
- Conversation revision.
- Upload references.
- Client-generated idempotency key.

**Outputs**

- `generationId`.
- Normalised request.
- Ownership-checked upload references.
- Initial `RECEIVED` event.

**Blocking rules**

- Reject unauthenticated requests.
- Reject upload references the user does not own.
- Reject unsupported file types, unsafe sizes or malware scan failures.
- Return the existing generation for duplicate idempotency keys.

**Acceptance**

- Repeating the same request does not create a second artifact or second provider charge.
- Cross-user upload IDs are rejected.
- Cancellation is honoured before each provider request.

## Stage 1 — Resolve intent and outcome

**Purpose:** Translate the request into the actual result the user is trying to achieve.

**Inputs**

- User request and bounded recent conversation.
- Relevant saved preferences explicitly permitted for this workflow.
- Candidate template metadata.

**Outputs**

- `userGoal`.
- `primaryOutcome`.
- Intended audience and author perspective.
- Tone and formality.
- Required outcomes and prohibited outcomes.
- Confidence and ambiguities.

**Blocking rules**

- Do not infer factual details.
- Distinguish an ambiguous goal from a missing fact.
- If multiple materially different outcomes remain plausible, present the smallest useful choice.

**Acceptance**

- Outcome can be stated in one user-centred sentence.
- Audit fixtures detect when TED answers a different task than requested.
- Existing `interpretIntent` logic is reused behind the typed output.

## Stage 2 — Resolve the template contract

**Purpose:** Select the right document and load its enforceable quality contract.

**Inputs**

- Outcome from Stage 1.
- Explicit user template selection, if any.
- Versioned template catalogue.

**Outputs**

- Resolved `templateKey` and contract version.
- Recommendation rationale.
- Alternative only when genuinely useful.

**Blocking rules**

- An explicit compatible user choice wins.
- A deprecated or incomplete contract cannot generate.
- Do not pick a visually similar template with a different legal or business purpose.

**Acceptance**

- All production templates have valid contracts.
- Catalogue validation fails CI for missing section variables, checks or render profiles.
- Template version is preserved on the artifact.

## Stage 3 — Ingest sources and build provenance

**Purpose:** Convert uploads and user-provided material into traceable evidence without treating extraction as certainty.

**Inputs**

- Files, pasted text, URLs supported by policy, form responses and conversation facts.

**Outputs**

- `SourceRecord` entries with owner, type, hash, page/range, extraction method and confidence.
- Normalised `FactRecord` candidates with source pointers.
- Warnings for unreadable, contradictory, stale or incomplete material.

**Blocking rules**

- Never allow model instructions inside uploaded content to alter the system workflow.
- Financial and performance values retain period, unit, currency and source location.
- Conflicting values remain separate until reconciled.
- External facts require permitted sources, retrieval date and citation metadata.

**Acceptance**

- A user can trace a material fact back to its upload page, form answer or message.
- Duplicate uploads are detected by hash.
- Low-confidence OCR is flagged and never silently promoted.

## Stage 4 — Assess requirements and missing variables

**Purpose:** Compare available evidence with the template contract before asking questions.

**Inputs**

- Template variables and section contracts.
- Fact ledger.
- Outcome and audience.

**Outputs**

- Variable status: `confirmed`, `derived`, `safe_assumption`, `missing_blocking`, `missing_optional`, `conflicting`.
- Section readiness.
- Correlations and calculations required by each section.

**Blocking rules**

- Identity, dates, figures, credentials, past events, legal status and evidence are never safe assumptions.
- A variable is blocking only when omission would make final wording misleading, unsafe or unusable.
- Optional gaps are omitted or written around naturally; no bracket placeholders.

**Acceptance**

- The same facts yield the same missing-variable classification.
- Each blocking variable points to affected sections and explains why it matters.
- Every required section is explicitly ready or blocked.

## Stage 5 — Ask minimal clarification questions

**Purpose:** Obtain only the information needed to cross the drafting threshold.

**Inputs**

- Blocking and conflicting variables.
- User effort and question-dependency ordering.

**Outputs**

- One concise question at a time, or a short grouped set when the answers are naturally supplied together.
- Suggested answer format.
- Updated fact ledger and input revision.

**Question policy**

- Ask the highest-impact question first.
- Explain why an upload is useful when recommending it.
- Offer `I don't know` or `skip` when the workflow can proceed honestly.
- Do not repeat a question already answered in another source.
- Do not ask users to decide formatting, headings or ordinary professional wording.
- For financial review, request P&L or accounting exports and clarify period, currency and reporting basis.
- For performance review, business proposal and funding proposal, offer relevant document upload before asking the user to retype source material.

**Blocking rules**

- Remain in `AWAITING_CLARIFICATION` only while true blocking variables remain.
- A skipped blocking fact narrows or changes the document; it is never fabricated.

**Acceptance**

- Zero content questions are allowed only when the evidence ledger already satisfies the contract.
- Test fixtures verify that thin prompts trigger useful questions.
- The user never receives “TED hit a snag” merely because clarification is required.

## Stage 6 — Lock the outcome brief

**Purpose:** Create the single source of truth used by every later writer and reviewer.

**Outputs**

- Confirmed goal, audience, author perspective, tone and formality.
- Confirmed facts with provenance.
- Derived values with formula and source variables.
- Safe assumptions with rationale.
- Required content, exclusions, limitations and user-approved choices.
- Section readiness and remaining non-blocking gaps.

**Blocking rules**

- The brief is immutable for its `inputRevision`.
- New user information increments the revision and invalidates dependent stages.
- Providers receive only the context required for their stage.

**Acceptance**

- Draft and audit use the same brief revision.
- No later stage introduces an unrecorded factual premise.

## Stage 7 — Plan sections and bind variables

**Purpose:** Decide what each section will say before prose generation.

**Outputs**

- One plan per canonical section.
- User-facing display label.
- Required variables and exact source/fact IDs.
- Required relationships, calculations, comparisons and cross-references.
- Target form, length, tone and benchmark characteristics.

**Blocking rules**

- Every required variable must be bound or explicitly omitted under the contract.
- Facts may be reused across sections where relevant; conflicting variants cannot be merged.
- Section labels may adapt to the situation but cannot hide the canonical purpose.

**Acceptance**

- Every final material claim can be mapped through a section plan.
- Correlating information is planned together—for example revenue growth with period, baseline, comparison, currency and expense context.

## Stage 8 — Draft section-level final wording

**Purpose:** Produce usable user-facing content from the locked brief and section plan.

**Rules**

- Draft sections independently with bounded concurrency.
- Use first-person or organisational voice required by the contract.
- Write the actual letter, analysis, recommendation, checklist or report content.
- Never emit template instructions, fake quotations, filler, placeholders or purpose descriptions.
- Clearly label scenarios, examples, projections and recommendations so they are not mistaken for historical fact.

**Failure handling**

- A failed section retries independently.
- A section that cannot be honestly completed returns a typed missing-information result, not generic prose.
- Provider errors retain a safe correlation ID and retry classification.

**Acceptance**

- Blank and instructional-output guards pass.
- Section output fits the required form and length.
- No section can silently disappear.

## Stage 9 — Run deterministic validation

**Purpose:** Catch objective defects before spending another model review.

**Checks**

- Schema, required sections and non-empty final content.
- Residual placeholders and instruction leakage.
- Required variable coverage and source bindings.
- Unsupported names, dates, amounts, percentages and credentials.
- Arithmetic, totals, rates, signs, period alignment and currency consistency.
- Duplicate or contradictory statements.
- Document-specific formatting, maximum lengths and required disclosures.
- Accessible heading structure and table semantics in the intermediate document model.

**Blocking rules**

- Deterministic high-severity failures cannot be waived by a model.
- Derived values store formula, inputs and rounding rule.

**Acceptance**

- Purpose-built fixtures fail for one-cent reconciliation errors, mismatched periods, unsupported résumé metrics and blank sections.
- Passing result is saved with validator version.

## Stage 10 — Independent semantic audit and targeted repair

**Purpose:** Judge usefulness and intent alignment that deterministic checks cannot fully measure.

**Audit dimensions**

- Goal and audience fit.
- Factual grounding and assumption discipline.
- Completeness of each section.
- Tailoring and relationship between variables.
- Tone, clarity, formality and practical usability.
- Benchmark alignment for wording, length and structure.
- Safety, legal/financial limitations and misleading certainty.

**Rules**

- Auditor returns structured issues with severity, section key, finding, evidence and required correction.
- Only affected sections are rewritten.
- Rewritten sections pass deterministic validation again.
- One bounded repair cycle is default; a second requires a typed recoverable reason.
- High-severity unresolved issues terminate generation.

**Acceptance**

- Audit cannot modify the brief or approve unsupported facts.
- Repairs do not alter already-approved unrelated sections.
- Existing `auditDraft`, `affectedSectionKeys` and merge logic are retained and strengthened.

## Stage 11 — Assemble final user wording

**Purpose:** Turn approved sections into one coherent document that reads as if written for this user.

**Checks**

- Consistent voice, terminology, tense, names, dates, numbering and cross-references.
- All contract variables appear where required with their correlating context.
- Repetition is purposeful, not accidental.
- Assumptions or limitations visible to the user are phrased naturally.
- No internal labels, audit notes, prompt fragments or source IDs appear in the document body.
- Source notes or citations appear only where the document type requires them.

**Acceptance**

- Final assembly passes a last deterministic scan.
- The artifact remains `draft_for_user_review` when the contract requires factual sign-off.

## Stage 12 — Render, inspect and persist

**Purpose:** Produce a trustworthy editable artifact and verify the exported result, not just the text.

**Outputs**

- Canonical structured artifact.
- Editable DOCX where supported.
- PDF preview/export where supported.
- Preserved template, contract, pipeline and validator versions.
- Immutable generated version and later user-edited versions.

**Checks**

- No clipped, hidden or overflowing text.
- Tables fit or repeat headings appropriately.
- Page breaks, headings, lists, links and footers render correctly.
- Mobile preview remains usable.
- Accessible reading order, contrast and semantic structure.
- Visual workspace changes branding and layout without changing approved facts.

**Blocking rules**

- HTML fallback must be labelled honestly and cannot masquerade as a true DOCX/PDF.
- A render failure leaves the approved structured artifact recoverable but not `READY`.

**Acceptance**

- Representative short, long, table-heavy and upload-derived fixtures are visually inspected.
- Exported files reopen successfully.
- The saved version matches the rendered version byte-for-byte or through a recorded deterministic transform.

## Stage 13 — Deliver, recover and learn safely

**Purpose:** Give the user a clear result and make operational failures diagnosable.

**User result**

- Document ready, needs factual review, needs clarification, or could not be completed.
- Concise assumptions and limitations.
- Edit, regenerate affected section, brand, export and version options.

**Operational evidence**

- Stage duration and provider usage.
- Clarification rate and abandonment stage.
- Deterministic and semantic failure reason codes.
- Repair rate and final readiness.
- Export success and rendering failures.
- No raw document or upload content in analytics.

**Acceptance**

- A user can resume an interrupted generation.
- Generic “TED hit a snag” is reserved for genuinely unknown errors and always includes a correlation ID and retry route.
- Known errors have specific, constructive messages.

## Real-world benchmark policy

Benchmarks guide form, wording, length, detail and formality; they do not supply user facts.

Each contract records:

- benchmark document category and jurisdiction/industry where relevant;
- authoritative or professionally recognised source type;
- retrieval date and review owner;
- structural characteristics, not copied prose;
- expected length range and information density;
- conventional headings, ordering, sign-off and disclosure patterns;
- accessibility and export expectations;
- legal or financial review requirement.

Reference material must be licensed, public-domain, user-owned or used only for non-expressive characteristics. PrompTED must not reproduce proprietary templates or distinctive wording.

## Error taxonomy

| Code | Meaning | User handling |
|---|---|---|
| `AUTH_REQUIRED` | User session is absent or expired | Sign in and resume |
| `SOURCE_ACCESS_DENIED` | Upload ownership failed | Remove or reselect source |
| `SOURCE_UNREADABLE` | Extraction is insufficient | Re-upload or enter key facts |
| `CLARIFICATION_REQUIRED` | Blocking variables remain | Ask targeted question |
| `CONFLICTING_FACTS` | Sources disagree materially | Show conflict for confirmation |
| `CONTRACT_INVALID` | Template cannot safely generate | Disable template and alert operator |
| `PROVIDER_RETRYABLE` | Temporary AI-provider failure | Retry from checkpoint |
| `VALIDATION_FAILED` | Objective content defect remains | Repair affected section |
| `QUALITY_FAILED` | Semantic high-severity issue remains | Explain and retry safely |
| `RENDER_FAILED` | Approved content could not export | Preserve content and retry export |
| `UNKNOWN_ERROR` | Unclassified failure | Correlation ID, safe retry and operator trace |

## Persistence model

Create or extend:

- `document_generations`: owner, template/contract/pipeline versions, stage, input revision, idempotency key, status and timestamps.
- `generation_stage_events`: immutable stage transitions, durations, attempt, provider metadata and reason code.
- `generation_sources`: ownership-checked source metadata and extraction status.
- `generation_facts`: normalised value, data type, unit, period, confidence and provenance pointer.
- `generation_assumptions`: assumption, rationale, affected sections and user approval where required.
- `generation_clarifications`: question, affected variables, answer, skipped state and revision.
- `document_versions`: immutable generated, user-edited, branded and submitted/exported snapshots.

RLS must prove ownership through the parent generation. Service-role writes validate the authenticated user ID supplied by the trusted request context, never a client-provided owner alone.

## Implementation plan

### Task 1: Add universal types and state machine

**Files**

- Create: `packages/shared/src/generation/generation-contract.ts`
- Create: `packages/shared/src/generation/generation-state.ts`
- Create: `packages/shared/src/generation/generation-errors.ts`
- Test: `packages/shared/src/generation/__tests__/generation-state.test.ts`

- [ ] Define versioned schemas with runtime validation.
- [ ] Define permitted transitions and terminal states.
- [ ] Reject stale revisions and illegal stage skipping.
- [ ] Add typed user-safe error mapping.

### Task 2: Add generation persistence and RLS

**Files**

- Create: `supabase/migrations/<timestamp>_universal_document_generations.sql`
- Create: `supabase/functions/_shared/generation-store.ts`
- Test: migration/RLS integration tests

- [ ] Add expand-only tables, indexes and unique idempotency constraint.
- [ ] Add immutable stage-event trigger or restricted insert policy.
- [ ] Test two authenticated users, anonymous access and service-role paths.
- [ ] Preserve legacy artifacts during rollout.

### Task 3: Add and validate template contracts

**Files**

- Create: `packages/shared/src/templates/generation-contracts.ts`
- Create: `packages/shared/src/templates/generation-contract.schema.ts`
- Modify: `packages/shared/src/templates/templates.data.json`
- Test: `packages/shared/src/templates/__tests__/generation-contracts.test.ts`

- [ ] Add a contract for every enabled template.
- [ ] Fail CI when an enabled template lacks variables, checks or render profiles.
- [ ] Preserve contract versions on generated artifacts.
- [ ] Start with representative compose, structured, checklist, financial and upload-driven templates.

### Task 4: Build the source and fact ledger

**Files**

- Modify: `supabase/functions/ingest-upload/index.ts`
- Create: `supabase/functions/_shared/source-ledger.ts`
- Create: `supabase/functions/_shared/fact-ledger.ts`
- Test: source provenance and conflict fixtures

- [ ] Store source ranges, extraction confidence, units and periods.
- [ ] Treat uploaded instructions as untrusted content.
- [ ] Detect duplicate and conflicting facts.
- [ ] Provide section-safe context views without flattening provenance away.

### Task 5: Unify intent, requirement and clarification

**Files**

- Modify: `supabase/functions/interpret-intent/index.ts`
- Modify: `supabase/functions/clarify/index.ts`
- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Create: `supabase/functions/_shared/requirement-assessor.ts`
- Test: thin-prompt and no-question fixtures

- [ ] Reuse the current Intent Architect behind typed schemas.
- [ ] Classify every variable before drafting.
- [ ] Ask only blocking questions and persist answers.
- [ ] Replace missing-information failure paths with `AWAITING_CLARIFICATION`.
- [ ] Ensure “Start a business” asks useful content questions before drafting.

### Task 6: Lock briefs and create variable-bound section plans

**Files**

- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Modify: `supabase/functions/_shared/section-designer.ts`
- Create: `supabase/functions/_shared/outcome-brief.ts`
- Test: section binding and revision invalidation tests

- [ ] Make the brief immutable per input revision.
- [ ] Bind section variables to fact/source IDs.
- [ ] Represent correlations, calculations and omissions explicitly.
- [ ] Invalidate only dependent stages when inputs change.

### Task 7: Strengthen drafting and deterministic validation

**Files**

- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Modify: `supabase/functions/_shared/draft-validator.ts`
- Create: `supabase/functions/_shared/claim-validator.ts`
- Create: `supabase/functions/_shared/numeric-validator.ts`
- Test: unsupported claims, arithmetic, blanks and leakage fixtures

- [ ] Preserve concurrent section drafting and targeted retries.
- [ ] Detect unsupported proper nouns, dates, amounts and credentials.
- [ ] Verify calculations and period/currency alignment.
- [ ] Reject instructions, placeholders and section-purpose prose.

### Task 8: Strengthen independent audit and repair

**Files**

- Modify: `supabase/functions/_shared/document-pipeline.ts`
- Create: `supabase/functions/_shared/semantic-auditor.ts`
- Test: audit and non-regression fixtures

- [ ] Use constrained issue schemas.
- [ ] Require evidence for factual and completeness findings.
- [ ] Rewrite affected sections only.
- [ ] Re-run deterministic checks after every repair.
- [ ] Fail closed on unresolved high-severity issues.

### Task 9: Add final assembly, versioning and export verification

**Files**

- Modify: `supabase/functions/generate-document/index.ts`
- Modify: `supabase/functions/render-export/index.ts`
- Modify: document persistence helpers and editor versioning
- Test: DOCX/PDF reopen, long/table-heavy and mobile-preview fixtures

- [ ] Add cross-section consistency validation.
- [ ] Persist canonical structured artifacts before rendering.
- [ ] Preserve generated, edited, branded and exported versions.
- [ ] Validate actual output files and visible layout.
- [ ] Remove misleading export labels for fallback formats.

### Task 10: Add recoverability, telemetry and user-safe errors

**Files**

- Create: `supabase/functions/_shared/generation-telemetry.ts`
- Modify: generation API clients and error UI
- Modify: `docs/TED-UNIFIED-PIPELINE-ROLLOUT.md`
- Test: retry, cancellation, resume and privacy fixtures

- [ ] Resume from persisted checkpoints.
- [ ] Prevent duplicate charges and artifacts.
- [ ] Map known errors to constructive UI.
- [ ] Add correlation IDs to unknown failures.
- [ ] Confirm logs and analytics contain no private content.

### Task 11: Run the universal template quality matrix

**Files**

- Create: `packages/shared/src/templates/__tests__/universal-generation-matrix.test.ts`
- Create: `docs/quality/universal-generation-evidence.md`
- Add: representative redacted fixtures

- [ ] Test every contract for complete and thin prompts.
- [ ] Test conflicting facts and declined clarification.
- [ ] Test upload, no-upload, short, long and table-heavy paths.
- [ ] Score intent fit, factual grounding, section completeness, usability and render quality.
- [ ] Record failures by contract and stage; do not approve by anecdote.

### Task 12: Roll out without splitting the product

**Files**

- Modify: `docs/TED-UNIFIED-PIPELINE-ROLLOUT.md`
- Modify: environment variable documentation and release runbook

- [ ] Keep a single feature-gated pipeline.
- [ ] Roll out internal → 5% → 25% → 50% → 100%.
- [ ] Stop increases on any unsupported-fact, cross-user access, blank-output or render-clipping defect.
- [ ] Retire legacy generation only after all workflows reach parity.
- [ ] Begin job-application production implementation only after the release gates below pass.

## Universal release gates

All must pass from the same commit:

- [ ] Every enabled template has a valid versioned contract.
- [ ] No artifact is returned after a blocking deterministic or semantic failure.
- [ ] Complete prompts generate without unnecessary questions.
- [ ] Thin prompts ask relevant questions before drafting.
- [ ] Factual claims, calculations and material recommendations trace to sources or disclosed assumptions.
- [ ] Blank, placeholder, instructional and fabricated-content fixtures fail.
- [ ] Interrupted requests resume without duplicate artifacts or charges.
- [ ] Cross-user source and artifact access fails.
- [ ] Logs and analytics contain no document bodies or upload text.
- [ ] Representative DOCX/PDF exports reopen and pass visual inspection.
- [ ] Mobile preview has no overflow, clipped controls or hidden text.
- [ ] Type-check, lint, unit tests, integration tests and production build pass.
- [ ] Staging success exceeds 97% excluding valid input/clarification pauses.
- [ ] Serious and critical accessibility findings are zero.
- [ ] Rollback to the prior cohort is tested.

## Definition of done

The universal stages are complete when a thin request can pause for the right facts, a complete request can proceed without interrogation, each section is grounded and tailored, objective defects are caught deterministically, semantic defects trigger bounded targeted repair, the rendered artifact is visibly correct, and the entire request can be resumed and audited without exposing private content.

Only then should document-specific expansion—including the job-application launch—move from design into production generation.
