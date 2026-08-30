# PrompTED Job Application Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** REVISE — approved product direction; implementation and live validation remain required
**Prepared:** 2026-07-27
**Launch wedge:** Honest, tailored job applications built from one job advertisement and the user’s confirmed evidence
**Primary market:** Job seekers who need practical help understanding a role, presenting their real experience and managing an application from discovery through outcome
**Implementation prerequisite:** BLOCKED until the release gates in `docs/plans/2026-07-27-universal-document-generation-stages.md` pass. Job-application contracts and UI may be designed in parallel, but production generation must use the universal pipeline rather than introduce a second path.

## Goal

Turn PrompTED’s existing employment templates, role matching and saved-role infrastructure into one end-to-end job application system:

```text
Paste or upload job ad
  → understand requirements
  → map confirmed evidence and gaps
  → build application pack
  → review factual and ATS usability
  → export and apply on source site
  → track follow-up, interview and outcome
```

The launch promise is:

> Turn one job advertisement into an honest, tailored application you can confidently submit.

PrompTED must not market itself as a guaranteed ATS-beating service, an automatic job-submission bot or a system that can invent missing experience. TED remains the sole in-product intelligence.

## Why this launch wedge

- The user arrives with an urgent, concrete objective.
- A job advertisement gives TED a bounded source against which to ask useful questions.
- The journey naturally creates repeat sessions: analyse, draft, revise, apply, follow up, interview and record the outcome.
- Value is visible through a before/after application pack.
- Existing PrompTED components already cover résumé upload, live role discovery, saved roles, role documents, action items and outcomes.
- Revenue can attach to application packs, version history, advanced review and ongoing tracking without charging for invented certainty.

## Existing foundations to retain

| Capability | Existing implementation | Required evolution |
|---|---|---|
| Role discovery and matching | `FindRolesScreen.tsx`, `job-match` Edge Function | Add direct job-ad ingestion and evidence-first fit explanation |
| Resume/source upload | `ingest-upload`, `UploadAnalysisPanel`, file attachment helpers | Add job-ad-specific extraction, preview and source ledger |
| Saved opportunities | `saved_roles` | Extend into a reliable application opportunity record |
| Application documents | `role_documents` | Expand document types, package membership and version status |
| Preparation actions | `role_action_items` | Connect actions to requirements, documents and deadlines |
| Outcome tracking | `role_outcomes`, `latest_stage` | Add full tracker stages and immutable event history |
| Document generation | `generate-document`, shared document pipeline | Make generation contract-aware and evidence-bound |
| Export | `render-export` | Add ATS-safe DOCX/PDF review and application-pack export |
| Editing and history | `SectionEditor`, `EditWithTED`, `VersionHistory` | Preserve per-opportunity variants and submitted snapshots |

## Non-negotiable product rules

1. TED never invents employment, education, dates, credentials, software, responsibilities, achievements, metrics, references, salary, eligibility, work rights or application outcomes.
2. Every material application claim traces to a confirmed career fact, uploaded source or explicit user-approved wording.
3. Job requirements and user evidence remain separate data. A missing requirement is not repaired by rephrasing unrelated experience.
4. Fit is explained by requirement coverage and evidence strength—not presented as an unexplained or guaranteed percentage.
5. Generated documents are drafts until the user completes a final factual review.
6. PrompTED does not submit applications on the user’s behalf. The user applies on the original employer or authorised job source.
7. Application activity, documents, demographic answers and outcomes are private and excluded from advertising or public profiles.
8. ATS review checks parseability and common usability risks. It does not promise an employer’s system will accept, rank or progress an application.
9. Quality is prioritised over application volume. No streak, score or notification should pressure users to submit unsuitable applications.
10. Every submitted package retains an immutable snapshot of what the user says they sent.

## Launch document library

### Existing documents to make launch-grade

#### 1. Resume

- Build a master résumé from confirmed career evidence.
- Create a version for the target role without changing dates, employers, qualifications or scope.
- Use conventional, ATS-readable headings and a single-column export option.
- Require evidence behind achievement statements.
- Keep a human-readable branded version separate from the ATS-safe version.

#### 2. Cover Letter

- Bind employer, role, requirements and user evidence to the correct paragraphs.
- Keep to one page unless an external requirement says otherwise.
- Avoid generic employer praise when no reliable employer-specific source is available.
- End with a clear, proportionate next step.

#### 3. Selection Criteria Response

- Parse each criterion separately.
- Map one or more evidence examples to every criterion.
- Ask a targeted question when a required criterion has no usable evidence.
- Follow the requested response format and word limit.

#### 4. LinkedIn Profile Rewrite

- Align headline, About, skills and experience with the target role family.
- Keep LinkedIn text broader than a single application unless the user explicitly wants a one-role profile.
- Preserve facts and avoid announcing confidential job-search activity.

#### 5. Recruiter Introduction Email

- State the role family, credible strengths, location/work preferences and requested next step.
- Do not claim a referral, relationship or vacancy unless confirmed.

#### 6. Job Follow-up Email

- Use the confirmed application date, role, contact and follow-up purpose.
- Offer post-application, post-interview and requested-information variants.
- Avoid pressure, entitlement or fabricated employer interest.

#### 7. Interview Preparation Questions

- Generate likely questions from the advertisement, submitted package and genuine gaps.
- Separate questions the user should prepare from claims they must verify.

#### 8. Interview Script

- Produce speaking notes, not memorised fictional dialogue.
- Maintain consistency with the submitted application.
- Flag areas where the user’s evidence is thin or the interviewer may probe.

#### 9. STAR Achievement Bank

- Store reusable Situation, Task, Action and Result evidence.
- Require a real result or label the result as qualitative.
- Support multiple role tags without rewriting one example into unrelated expertise.

#### 10. Job-search Action Checklist

- Generate actions from the actual opportunity and deadline.
- Connect items to document completion, contacts, follow-up and interview preparation.
- Avoid generic busywork.

### New launch documents

#### 11. Job Requirements Evidence Matrix

**Purpose:** the central truth layer for the application.

**Required inputs**

- Job advertisement and source metadata.
- Essential and desirable requirements.
- User’s confirmed career evidence.
- External application instructions and deadlines.

**Output**

| Requirement | Type | Evidence | Strength | Gap | Planned response | Source |
|---|---|---|---|---|---|---|

**Rules**

- Use `confirmed`, `partial`, `not_evidenced` and `not_applicable`; do not use invented percentages.
- A keyword match without supporting experience is not confirmed evidence.
- The user can approve, replace or reject each mapping.

#### 12. Screening Question Response Pack

**Purpose:** reusable, reviewed answers for application forms.

**Supported question types**

- Work rights and location.
- Availability and notice period.
- Salary expectations.
- Qualifications, licences and certifications.
- Years or type of experience.
- Behavioural and role-specific questions.
- Voluntary demographic questions.

**Rules**

- Sensitive and voluntary answers are never inferred.
- Previously saved answers are editable and never submitted automatically.
- Each answer stores the exact question, source opportunity, date and user approval.

#### 13. Portfolio Project Case Study

**Sections**

- Project context.
- Problem or objective.
- User’s actual role.
- Approach and tools.
- Constraints and collaboration.
- Verified outcome.
- Supporting link or attachment.
- Relevance to the target role.

**Rules**

- Separate team outcome from the user’s personal contribution.
- Do not expose confidential client or employer information.
- Metrics require a source or explicit confirmation.

#### 14. Referee Briefing Sheet

**Sections**

- Role and employer.
- Requirements most relevant to the referee.
- Confirmed projects and achievements the referee witnessed.
- Candidate’s current application narrative.
- Interview/application timeline.
- Contact preferences.

**Rules**

- It is context for the referee, not a scripted endorsement.
- Do not invent what the referee thinks or will say.
- Require confirmation that the referee agreed to be contacted.

#### 15. Interview Thank-you Email

- Confirm interviewer, role, date and a real point discussed.
- Restate interest and one relevant value point.
- Include promised information where applicable.
- Keep concise and avoid implying an outcome.

#### 16. Offer Comparison Worksheet

**Comparison fields**

- Confirmed base salary and pay period.
- Superannuation/retirement treatment where applicable.
- Bonus, commission and equity terms.
- Leave and benefits.
- Location, travel and work arrangement.
- Hours, roster and flexibility.
- Responsibilities, title and progression.
- Probation, notice and start date.
- User priorities, uncertainties and questions.

**Rules**

- Unknown remains unknown.
- Do not calculate tax, equity value or legal effect without the required verified inputs and appropriate boundary.

#### 17. Salary and Offer Negotiation Plan

- Establish the confirmed offer and the user’s priorities.
- Identify requested changes, evidence and fallback positions.
- Provide conversation notes and a concise written response.
- Never invent competing offers, market rates or leverage.

#### 18. 30–60–90 Day Plan

- Derive priorities from the job advertisement, interview information and confirmed employer materials.
- Mark assumptions and questions for the manager.
- Cover learning, relationships, delivery and measures without pretending to know internal systems.

#### 19. Application Withdrawal Email

- Confirm role, employer, stage and whether a reason should be given.
- Keep the message polite, final and concise.
- Preserve the relationship without overexplaining.

#### 20. Master Career Evidence Bank

**Evidence types**

- Employment entries.
- Education and qualifications.
- Skills and tools.
- Projects.
- Achievements and metrics.
- Leadership and collaboration.
- Customer/stakeholder examples.
- Challenges and learning.
- Portfolio links.
- Referee relationships.

**Required metadata**

- Evidence ID.
- User-authored title and description.
- Organisation/context.
- Date range.
- Source upload or conversation.
- Confidence/verification state.
- Reusable tags.
- Sensitivity and sharing restrictions.
- Last confirmed timestamp.

This is the source of truth for application claims. A generated document may transform wording but cannot alter the underlying fact.

## Application-pack contract

An application package belongs to one saved opportunity and contains:

- Job Requirements Evidence Matrix.
- Tailored Resume.
- Cover Letter where useful or requested.
- Selection Criteria Response where requested.
- Screening Question Response Pack.
- Optional Portfolio Case Studies.
- Final factual-review checklist.
- Exported files and submitted snapshot.

Package states:

```text
setup
→ evidence_review
→ drafting
→ needs_user_input
→ ready_for_review
→ ready_to_export
→ exported
→ submitted
→ superseded
```

Only the user can confirm `submitted`. Generation or export must never advance the package to that state.

## End-to-end workflow

### Step 1 — Start with the job

The primary launch action is:

> Paste or upload the job you want

Accepted sources:

- Pasted advertisement text.
- PDF, DOCX, TXT or clear image upload.
- Source URL where live retrieval is authorised and succeeds.
- Manual role details when no advertisement is available.

The UI displays an extraction preview before saving:

- Role title.
- Employer.
- Location and work arrangement.
- Closing date.
- Essential requirements.
- Desirable requirements.
- Responsibilities.
- Requested documents.
- Application questions.
- Instructions and word limits.
- Source URL/file and retrieval time.

Low-confidence or ambiguous fields require confirmation.

### Step 2 — Build the evidence map

TED proposes mappings from the Master Career Evidence Bank and uploaded résumé.

The user sees:

- Confirmed evidence.
- Partial evidence.
- Not evidenced.
- Needs clarification.
- External requirement that cannot be assessed.

The central UI is a side-by-side requirement/evidence workspace. Each claim chip opens its source.

### Step 3 — Ask only useful questions

Questions are ordered by impact:

1. A fact required to determine eligibility or document type.
2. Missing evidence for an essential requirement.
3. A material achievement or result needed to make a supported claim.
4. Application-specific details, limits or instructions.
5. Optional improvements.

TED asks one focused question at a time on mobile and must not repeat answered questions.

### Step 4 — Generate the application pack

Quick Application:

- Evidence matrix.
- ATS-safe tailored résumé.
- Short cover letter where appropriate.
- Final review.

Deep Tailoring:

- Full evidence review.
- Résumé.
- Cover letter.
- Criteria responses.
- Screening answers.
- Portfolio examples.
- Interview preparation.

The user may generate only the documents they need.

### Step 5 — Review before export

Three review layers:

1. **Factual review:** names, dates, employers, qualifications, metrics and claims.
2. **Requirement coverage:** essential and desirable criteria, requested documents and instructions.
3. **Export usability:** text extraction, headings, page length, contact details, file type and visual collisions.

The review reports specific findings. It does not show an unsupported “ATS success score”.

### Step 6 — Export and preserve the submitted version

- Export ATS-safe DOCX.
- Export ATS-safe PDF where accepted.
- Export branded human-readable PDF/DOCX as a separate variant.
- Package requested documents in a clearly named ZIP only when the user asks.
- Let the user mark the package submitted.
- Preserve a read-only snapshot of the documents and answers the user says they submitted.

### Step 7 — Track and prepare

Tracker stages:

```text
saved
analysing
drafting
ready
applied
phone_screen
interview
final_round
offer
hired
rejected
no_response
withdrawn
archived
```

Each stage change creates an event. Earlier events are never overwritten.

Tracker actions:

- Add deadline or follow-up reminder.
- Open application pack.
- Record contact and notes.
- Generate follow-up.
- Start interview preparation.
- Record outcome.
- Create offer comparison.

## UI specification

### Launch home

Desktop:

```text
┌────────────────────────────────────────────────────────────┐
│ Turn a job ad into an application you can stand behind     │
│ [ Paste the job advertisement…                         ]   │
│ [Upload job ad]                         [Analyse this job]  │
│                                                            │
│ Or: Find roles with TED | Continue an application          │
└────────────────────────────────────────────────────────────┘
```

Mobile:

- One full-width input.
- Upload control outside the text area.
- Sticky `Analyse this job` action when valid.
- Keyboard submit support.
- No control may obscure entered text.

### Job analysis screen

Tabs or segmented views:

- Overview.
- Requirements.
- Evidence.
- Application Pack.
- Tracker.

Desktop uses a two-column requirement/evidence view. Mobile uses one requirement card at a time with a persistent progress summary.

### Evidence states

- `Confirmed` — green plus icon and source label.
- `Partial` — amber half-circle and explanation.
- `Not evidenced` — neutral outlined icon; never punitive red.
- `Needs confirmation` — blue question icon.
- `External check` — purple link icon for work rights, licence or employer-specific rules.

Never rely on colour alone.

### Application-pack dashboard

Each document card shows:

- Document name.
- Why it is needed.
- Completion state.
- Missing critical facts.
- Last edited time.
- Export state.
- Open/review action.

The primary next action is singular and contextual.

### Tracker

Desktop may use a compact board or grouped list. Mobile defaults to a chronological list because horizontal drag boards are awkward and error-prone on small screens.

Every opportunity card shows:

- Role and employer.
- Closing date.
- Current stage.
- Next action.
- Package readiness.
- Last activity.

### Empty, loading and error states

- Empty tracker: paste a job or find roles.
- No evidence match: explain that TED needs real examples; offer targeted questions.
- Job retrieval failed: retain pasted/manual entry and allow retry.
- Generation failed: preserve package state and offer retry without consuming another document allowance unless a new generation actually starts.
- Export failed: retain reviewed version and show a specific retry.
- Expired authentication: refresh and retry once, then request sign-in without discarding work.

### Accessibility

- WCAG 2.2 AA target.
- Complete keyboard operation.
- Visible focus.
- Programmatic labels and error associations.
- Status changes announced politely.
- Touch targets at least 44 by 44 CSS pixels.
- Reduced-motion support.
- Tables transform into labelled cards on narrow screens.
- Exported documents use heading structure, readable contrast and meaningful link text.

## Data model

### Extend `saved_roles`

Add:

- `job_description_text`
- `job_description_source_type`
- `job_description_source_url`
- `job_description_source_file_id`
- `source_retrieved_at`
- `closing_at`
- `work_arrangement`
- `employment_type`
- `tracker_stage`
- `archived_at`

Deprecate presentation of `match_percentage` after migrating to explainable coverage.

### Create `career_evidence_items`

- `id`
- `user_id`
- `evidence_type`
- `title`
- `organisation`
- `date_start`
- `date_end`
- `fact_payload jsonb`
- `source_type`
- `source_artifact_id`
- `verification_state`
- `sensitivity`
- `last_confirmed_at`
- timestamps

RLS: owner only.

### Create `job_requirements`

- `id`
- `user_id`
- `saved_role_id`
- `requirement_type`
- `requirement_text`
- `source_locator`
- `sort_order`
- `is_mandatory`
- `user_confirmed`
- timestamps

### Create `requirement_evidence_links`

- `job_requirement_id`
- `career_evidence_item_id`
- `coverage_state`
- `explanation`
- `user_approved`
- timestamps

Unique pair constraint. RLS must validate ownership through both parents.

### Create `application_packages`

- `id`
- `user_id`
- `saved_role_id`
- `status`
- `mode`
- `submitted_at`
- `submitted_snapshot_artifact_id`
- timestamps

One active package per opportunity unless explicitly duplicated.

### Extend `role_documents`

Allow:

- `requirements_evidence_matrix`
- `tailored_resume`
- `cover_letter`
- `selection_criteria`
- `screening_response_pack`
- `portfolio_case_study`
- `referee_briefing_sheet`
- `interview_preparation`
- `interview_script`
- `interview_thank_you`
- `offer_comparison`
- `negotiation_plan`
- `thirty_sixty_ninety_plan`
- `withdrawal_email`
- `linkedin_rewrite`
- `follow_up_email`

Add:

- `application_package_id`
- `document_status`
- `submitted_version_id`
- `required_by_source`

### Create `screening_answers`

Store:

- Normalised question.
- Exact source question.
- Answer.
- Sensitivity.
- Reuse permission.
- User approval.
- Source opportunity.
- Last reviewed time.

Voluntary demographic data requires an explicit restricted sensitivity class and must not be reused by default.

### Create immutable `application_events`

- Opportunity/package.
- Event type.
- From/to stage where applicable.
- Note.
- Occurred time.
- Actor.
- Metadata.

Replace the denormalised stage only after the event insert succeeds.

## API and Edge Function design

### `ingest-job-ad`

New authenticated function:

- Accept text or ingested artifact reference.
- Extract structured requirements with source locators and confidence.
- Return preview only.
- Persist only after user confirmation.
- Never fetch a URL that violates existing live-source safety rules.

### `map-job-evidence`

New authenticated function:

- Read confirmed job requirements.
- Retrieve the user’s allowed evidence items.
- Propose coverage links.
- Return `confirmed`, `partial`, `not_evidenced` or `external_check`.
- Never create or alter evidence facts.

### `generate-application-pack`

Orchestrator:

- Validate opportunity and evidence map.
- Determine requested documents.
- Ask for blocking facts.
- Generate selected documents through the existing pipeline.
- Persist versions atomically.
- Return partial progress safely when one document fails.
- Use idempotency keys so retries do not duplicate documents or usage charges.

### `review-application-pack`

Deterministic checks first:

- Required documents present.
- Required fields present.
- Dates and names consistent.
- Claims have provenance.
- Word/page limits.
- Parseable DOCX/PDF text.
- Contact information in readable body text.
- Conventional headings for ATS-safe résumé.
- No unsupported placeholders or hidden text.

Model audit second:

- Relevance.
- Specificity.
- Repetition.
- Tone.
- Requirement coverage.
- Unsupported implication.

### `record-application-event`

- Validate allowed transition.
- Insert immutable event.
- Update latest stage transactionally.
- Prevent generation/export from setting `submitted`.

## ATS-safe review contract

Check:

- Single-column option.
- Conventional section headings.
- Logical reading order.
- Selectable text.
- No essential information only in headers, footers, images, charts or text boxes.
- Consistent dates.
- Correct requested file type.
- Role-relevant terminology supported by real evidence.
- Contact details and document title.

Do not:

- Claim compatibility with every ATS.
- Stuff keywords.
- repeat invisible text.
- assign a fabricated “pass probability”.
- encourage applications where a mandatory requirement is clearly unmet without disclosure.

## Analytics and growth

### Activation

- Job ad successfully analysed.
- At least one requirement confirmed.
- First useful evidence link approved.
- First document generated.
- First export completed.

### Retention

- Opportunity revisited within seven days.
- Package progressed.
- Follow-up or interview preparation generated.
- Outcome recorded.
- Career evidence reused with approval.

### Quality and trust

- Percentage of material claims with provenance.
- User rejection rate for proposed evidence mappings.
- Generation retry/failure rate.
- Export parseability pass rate.
- Factual corrections before export.
- Unsupported-claim audit failures.

### Outcome metrics

Track only user-reported:

- Applied.
- Interview.
- Offer.
- Hired.
- Rejected.
- No response.
- Withdrawn.

Do not attribute employer decisions to a specific document unless the user supplies evidence.

### Acquisition experience

Free Job Ad Analyser:

- Accept one advertisement.
- Return structured requirements.
- Show limited evidence gaps.
- Preview the documents requested.
- Ask the user to sign in to save, map evidence or generate a pack.

Do not expose private résumé content in shareable previews.

## Monetisation boundary

Free:

- One job-ad analysis.
- Limited evidence preview.
- Basic résumé import.
- One ATS usability check preview.

Paid:

- Full application pack.
- Multiple opportunity-specific variants.
- Full tracker and history.
- Advanced review and exports.
- Interview and offer workflows.

Never paywall access to a user’s previously exported/submitted snapshot or account deletion.

## Detailed implementation tasks

### Task 1: Lock the launch scope and remove misleading promises

**Files**

- Modify: `docs/product-promise-registry.json`
- Modify: launch copy in `apps/web`
- Test: `scripts/check-product-promises.mjs`

- [ ] Add the job-application launch promise and explicit non-promises.
- [ ] Remove or replace any unexplained ATS, fit or success percentage claims.
- [ ] Add copy tests for “no automatic submission” and “no invented experience”.
- [ ] Run the product-promise checker.

### Task 2: Add job-application template contracts

**Files**

- Modify: `packages/shared/src/templates/templates.data.json`
- Create/modify: `packages/shared/src/templates/template-generation-contracts.data.json`
- Test: template contract suites

- [ ] Add contracts for all existing launch documents.
- [ ] Add the ten new launch document records.
- [ ] Bind every section to required evidence variables and source types.
- [ ] Add no-invention and final-output acceptance checks.
- [ ] Confirm unique IDs, slugs and display orders.

### Task 3: Create the career evidence schema

**Files**

- Create: `supabase/migrations/<timestamp>_career_evidence.sql`
- Create: `packages/shared/src/job-applications/evidence.ts`
- Test: migration/RLS and type tests

- [ ] Add `career_evidence_items`.
- [ ] Add owner-only RLS and indexes.
- [ ] Add verification, sensitivity and source constraints.
- [ ] Test cross-user reads/writes are rejected.

### Task 4: Extend opportunities and package persistence

**Files**

- Create: `supabase/migrations/<timestamp>_job_application_packages.sql`
- Modify: `apps/web/src/lib/api/saved-roles.ts`
- Test: database transition and RLS tests

- [ ] Extend `saved_roles`.
- [ ] Create requirements, evidence links, packages, screening answers and application events.
- [ ] Extend role document types.
- [ ] Implement safe stage transitions and immutable history.
- [ ] Backfill existing saved roles without inventing source data.

### Task 5: Build job-ad ingestion

**Files**

- Create: `supabase/functions/ingest-job-ad/index.ts`
- Create: shared extraction schema and tests
- Modify: shared API client

- [ ] Write fixtures for text, PDF, DOCX, image and incomplete ads.
- [ ] Preserve source locators and confidence.
- [ ] Add user confirmation before persistence.
- [ ] Handle duplicate and updated advertisements.
- [ ] Test prompt injection inside uploaded ads cannot override system instructions.

### Task 6: Build the evidence mapper

**Files**

- Create: `supabase/functions/map-job-evidence/index.ts`
- Create: `packages/shared/src/job-applications/evidence-mapping.ts`
- Test: mapping and adversarial fixtures

- [ ] Propose links without creating facts.
- [ ] Distinguish partial evidence from confirmed evidence.
- [ ] Expose explanations and source links.
- [ ] Require user approval before generation uses a proposed link.

### Task 7: Build the launch home and setup flow

**Files**

- Modify: `apps/web/src/app/(app)` routes
- Create: `JobAdStart`, `JobAdExtractionReview` and responsive styles/tests
- Modify: primary navigation

- [ ] Make “Paste or upload the job you want” the launch primary action.
- [ ] Keep Find Roles as a secondary path.
- [ ] Implement text, upload and manual fallback.
- [ ] Verify keyboard and mobile layout.
- [ ] Add complete loading, error and recovery states.

### Task 8: Build the requirement/evidence workspace

**Files**

- Create: `RequirementEvidenceWorkspace`
- Create: requirement card, evidence chip and source drawer components
- Test: interaction and accessibility suites

- [ ] Build desktop split view and mobile card flow.
- [ ] Implement all evidence states.
- [ ] Let users approve, replace, reject or add evidence.
- [ ] Add one-question-at-a-time clarification.
- [ ] Verify no status relies only on colour.

### Task 9: Build the application-pack dashboard

**Files**

- Create: package route and document cards
- Modify: generation API orchestration
- Test: package state and partial failure suites

- [ ] Support Quick Application and Deep Tailoring.
- [ ] Show required, optional and unnecessary documents.
- [ ] Generate selected documents idempotently.
- [ ] Preserve successful documents when one generation fails.
- [ ] Prevent generation from marking a package submitted.

### Task 10: Implement launch documents

**Files**

- Modify: shared template catalogue/contracts
- Modify: document pipeline/profile data
- Test: at least three fixtures per document

- [ ] Implement and test the ten existing launch-grade documents.
- [ ] Implement and test the ten new launch documents.
- [ ] Add sufficient-context, missing-vital and invention-pressure fixtures.
- [ ] Verify every required variable reaches its consuming section.
- [ ] Verify final wording contains no scaffolds or unexplained placeholders.

### Task 11: Build application review and ATS-safe checks

**Files**

- Create: `packages/shared/src/job-applications/application-review.ts`
- Create: `supabase/functions/review-application-pack/index.ts`
- Modify: export pipeline
- Test: DOCX/PDF parseability fixtures

- [ ] Implement deterministic review.
- [ ] Add model quality audit after deterministic checks.
- [ ] Replace score theatre with actionable findings.
- [ ] Test complex formatting, image-only files and content in headers/text boxes.
- [ ] Keep branded and ATS-safe exports distinct.

### Task 12: Build tracker and event history

**Files**

- Modify: saved-role API and migrations
- Create: `ApplicationTracker` and stage/history components
- Test: transitions, mobile and RLS

- [ ] Implement tracker stages and permitted transitions.
- [ ] Use immutable events.
- [ ] Add contextual next actions.
- [ ] Build chronological mobile layout.
- [ ] Preserve archived history.

### Task 13: Connect interview, follow-up and offer workflows

**Files**

- Modify: related-document mappings
- Modify: package/tracker actions
- Test: workflow handoff fixtures

- [ ] Generate interview preparation from the actual submitted snapshot.
- [ ] Generate follow-up and thank-you messages from confirmed events.
- [ ] Add offer comparison and negotiation from confirmed offer terms.
- [ ] Add 30–60–90 plan from confirmed role/employer information.
- [ ] Preserve source provenance through every handoff.

### Task 14: Add privacy and security controls

**Files**

- Modify: migrations/RLS and upload policies
- Modify: account deletion coverage
- Test: security and deletion suites

- [ ] Restrict all opportunity, evidence and package records to the owner.
- [ ] Classify sensitive screening answers.
- [ ] Use private storage and signed retrieval.
- [ ] Include new records/files in account deletion.
- [ ] Exclude application content from public analytics and logs.
- [ ] Add retention controls for archived opportunities.

### Task 15: Add analytics without dark patterns

**Files**

- Modify: existing analytics/event layer
- Modify: privacy documentation
- Test: event payload tests

- [ ] Add activation, retention, quality and outcome events.
- [ ] Strip document text and sensitive answers from telemetry.
- [ ] Measure user-reported outcomes only.
- [ ] Add no-pressure notification rules.
- [ ] Verify no metric encourages application spam.

### Task 16: Launch validation and coordinated release

**Files**

- Modify only existing deployment/release workflows
- Add launch fixture pack and release evidence

- [ ] Run shared, web and Edge Function tests.
- [ ] Run type-check, lint and production build.
- [ ] Validate mobile, tablet and desktop flows.
- [ ] Test at least five fictional job personas and advertisements.
- [ ] Verify DOCX/PDF exports in Word, Google Docs and common PDF viewers.
- [ ] Test authentication expiry, generation retry and partial failure recovery.
- [ ] Verify no unsupported claim, duplicated charge or lost draft.
- [ ] Deploy dependent schema, functions and web changes from one reviewed commit set.
- [ ] Smoke-test with an authorised production account.
- [ ] Record deployed versions, logs and evidence.

## Test personas

Use fictional data only:

1. Entry-level applicant with education but little work history.
2. Experienced applicant moving to an adjacent industry.
3. Career returner with a real employment gap.
4. Applicant responding to formal selection criteria.
5. Applicant with accessibility, roster or travel constraints.
6. Applicant with strong experience but weak measurable achievements.
7. Applicant who does not meet one essential requirement.
8. Applicant comparing two confirmed offers.

## Release acceptance matrix

| Requirement | Release evidence |
|---|---|
| Useful first action | User can paste/upload a job ad and understand the next step without browsing templates |
| Correct extraction | Requirements and instructions trace to the uploaded/pasted source |
| Evidence integrity | Every material claim traces to approved career evidence |
| Honest gaps | Missing requirements remain visible and are never disguised |
| Tailored pack | Generated documents respond to the actual advertisement and requested format |
| Factual consistency | Names, dates, employers, qualifications and claims agree across the package |
| ATS usability | ATS-safe export passes deterministic parseability and structure checks |
| No false guarantee | UI contains no guaranteed ATS, interview or job-success claim |
| User control | User chooses documents, approves evidence and confirms submission |
| Recovery | Auth expiry, generation errors and export errors preserve work |
| Tracker integrity | Stage changes create immutable events and cannot be advanced by generation |
| Privacy | RLS, private storage, deletion and telemetry tests pass |
| Accessibility | Keyboard, screen-reader, contrast, touch and responsive checks pass |
| Export fidelity | DOCX and PDF exports are complete, readable and open successfully |
| Launch quality | Fictional end-to-end personas complete the journey without invented facts |

## Rollout sequence

### Phase 1 — Closed beta foundation

- Job-ad paste/upload.
- Evidence matrix.
- Master Career Evidence Bank.
- Tailored résumé and cover letter.
- Factual/ATS review.
- Export.
- Basic tracker.

### Phase 2 — Application depth

- Selection criteria.
- Screening answers.
- Portfolio case studies.
- Application-pack modes.
- Follow-up and interview workflows.

### Phase 3 — Outcome and offer workflows

- Referee briefing.
- Thank-you messages.
- Offer comparison.
- Negotiation plan.
- 30–60–90 plan.
- Outcome analytics.

Do not expose all broader PrompTED templates as the launch message. The library remains available, but acquisition, onboarding and first-run UX should centre on the job-application journey until the closed beta demonstrates reliable generation, export and user trust.

## Commit preparation

Recommended documentation-only commit:

```text
docs(job-applications): add launch implementation plan
```

Commit manifest:

```text
docs/plans/2026-07-27-job-application-launch-implementation-plan.md
```

Do not include unrelated mobile composer, API retry, generated artifacts, deployment archives or parent-worktree changes in this commit.
