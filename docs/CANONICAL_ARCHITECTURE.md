# PrompTED Long-Lived Canonical System Design

- **Status:** approved PrompTED.AI target architecture and migration boundary; not proof of implementation
- **Applies to:** web, mobile, Supabase, Netlify, document generation, clarification, persistence, billing, recovery, export, role workflows, CI, and release operations
- **Process authority:** repository-root `AGENTS.md`
- **Implementation evidence:** current source code, tests, migrations, deployment contracts, and observed environments
- **Maintainer:** PrompTED owner or explicitly delegated architecture maintainer
- **Last reconciled:** 31 August 2026 (Australia/Melbourne)
- **Review trigger:** any change to ledger versions, section keys, generation states, evidence precedence, persistence, replay, billing, export, provider boundaries, template lifecycle, role folders, repository structure, or release sequencing

This document replaces the earlier short canonical-architecture summary as the durable target design. It deliberately separates three things that older documents often collapsed:

1. **current evidence** — what exists in a named revision or environment;
2. **approved target design** — the architecture PrompTED is migrating toward;
3. **release proof** — the exact checks and workflows required before a target capability may be described as complete.

Historical phase plans, audits, benchmark registers, implementation plans, and handoffs remain useful evidence. They are not parallel architecture authorities. When they disagree with this design, preserve the evidence and follow this design unless the owner records a newer decision.

The maintained implementation line is `voltlead26-creator/PrompTED.AI` on its
canonical `Thought-Enhanced-Document` branch. The committed
`voltlead26-creator/PrompTED` snapshot
`ClaudeTED.AI@3a9a7bc7afa26c66fcbfa56266302c148d9dfc37` is immutable donor evidence,
not a writable application checkout. The current platform is Next.js 15 and
React 19 on Netlify, with Supabase as the durable application core and OpenAI
as the sole active inference provider.

---

## 1. Product-purpose alignment

### Target users and segments

PrompTED serves non-expert outcome owners who need to complete meaningful employment, small-business, community, personal, or administrative work. The first operational emphasis is on job seekers and practical Australian users, while locale and jurisdiction remain explicit contract inputs rather than hidden global assumptions.

### Problem being solved

The user has fragmented facts, incomplete evidence, unfamiliar process requirements, and uncertainty about what a credible finished result should contain. A generic chatbot or blank template leaves the user responsible for coordinating the workflow, detecting fabrication, preserving versions, knowing whether work was saved, and deciding what happens next.

### Intended completed outcome

The user reaches a state in which:

- the required facts and evidence are visible and attributable;
- missing or conflicting information is explicit;
- TED produces usable document wording and actions without invented facts;
- every section is final, deliberately unresolved, or deliberately omitted under a versioned contract;
- user edits and approvals are durable and recoverable;
- export uses the exact approved persisted revision;
- external actions are separately authorized and evidenced;
- the completed outcome or next unresolved step is understandable.

### Outcome progression improved

```text
Situation
→ Understanding
→ Required facts and evidence
→ Minimal clarification
→ Action plan
→ Final documents and actions
→ Review and approval
→ Durable persistence and export
→ Evidence of completion
→ Completed outcome or explicit unresolved next step
```

### User burden and risk reduced

The design removes the need for the user to understand prompts, model providers, schema names, recovery mechanics, or deployment state. It prevents fluent output, an SSE completion event, a local cache write, a “Saved” label, or a successful download response from masquerading as a completed outcome.

### Product and market assumptions not yet verified

This design does not establish market size, willingness to pay, preferred geography, acquisition cost, or relative commercial priority between segments. Those are owner-approved research questions, not architecture facts.

---

## 2. Decision record

### Council challenge

- **Strategist:** preserve the existing Git, Supabase, Netlify, and production lineage; create a compatible migration path rather than a replacement application.
- **Skeptic:** the repository currently contains valuable safeguards but also duplicated authorities and incomplete persistence boundaries. Documentation alone cannot repair those runtime failures.
- **Creative:** turn the strongest existing DIPs, placeholder metadata, validation, targeted repair, atomic import, artifact, and export concepts into adapters feeding one immutable runtime ledger.
- **Operator:** separate foundation/release hardening from generation/schema/UI migration. Each cohort must be testable, reversible, and independently attributable.
- **Audience Advocate:** keep valid work visible; explain what is missing, why it matters, what remains usable, whether it is saved, and the next action in plain language.

### Chosen position

PrompTED will remain a modular monorepo using the existing Next.js, shared TypeScript, Supabase, and Netlify stack. It will converge on one runtime document ledger, one server-owned generation command boundary, one durable generation state machine, one persisted approval/export authority, and one release path.

### Strongest rejected alternative

Bulk-copying or rebasing a historical “reliable” worktree into a new branch was rejected. It would preserve hidden branch provenance, conflicting template systems, controller workflows, stale build output, and unverified completion claims. Theory may be transferred only as reviewed, bounded design and implementation slices.

### Trade-off that decided the issue

Incremental compatibility adapters take longer than a rewrite, but preserve persisted documents, deployment identity, source provenance, user edits, and rollback options. Those properties are more valuable than short-term code uniformity.

---

## 3. Current evidence baseline

The following snapshot was observed on 24 August 2026 against historical donor
line `origin/reliably-prompTED` at
`e7f4e37e3087ee166c16ab242b17c60b3877f16b`. It is donor audit evidence, not
the current PrompTED.AI implementation state or an evergreen claim.

| Surface | Current evidence | Architectural determination |
|---|---|---|
| Repository | 583 tracked files in historical `voltlead26-creator/PrompTED` | Review file by file against the immutable donor commit; accept only attributable source into PrompTED.AI |
| Template catalogue | 86 catalogue entries, 307 catalogue sections | Useful identity and display data; not a complete runtime ledger |
| Document Intelligence Profiles | 86 DIPs with information contracts, quality rules, benchmarks, examples, fixtures, and internal-review flags | Valuable theory and test assets; must become ledger-owned or adapter-fed |
| Contract alignment | 18 of 86 template/profile pairs have section-key set mismatches | Blocking contract drift |
| Ledger completeness | 0 catalogue entries declare immutable ledger version, lifecycle, source policy, persistence policy, export policy, or template test cases in the required runtime shape | Universal ledger not implemented |
| Server template selection | client can submit section structures; the Edge Function also has a small fallback registry and an unknown-template generic fallback | Three authorities; fail-closed selection not implemented |
| Generation | strong no-blank, placeholder, quality, factual-audit, and targeted-repair logic exists | Reusable, but not durable or ledger-owned end to end |
| Persistence | imports have an atomic RPC; generated documents save later through client-side document and section writes | Generated-result atomicity not implemented |
| Generation state | private artifact-generation tables exist, but the primary document stream does not use a durable resumable run | Recovery state machine incomplete |
| Billing | request-level uniqueness pieces exist; document charging is fire-and-forget after generation output | Billing is not atomically coupled to durable success |
| Export | server checks approval, placeholders, and final content, but can render caller-supplied document sections and best-effort export history | Exact persisted approved-revision export not implemented |
| Find a Role | role search, save, action plan, tailor resume, cover letter, and apply actions exist | UI theory is useful; durable role-folder population is incomplete |
| Master Workspace | section editing, preview, history, approval, placeholders, recovery, and imports exist | Must consume ledger state and transactional persistence instead of reconstructing it |
| Migrations | 23 ordered migrations on the audited base | Missing the later reviewed generation-result compatibility slice; hosted application unverified |
| Release | multiple CI, controller, staging, and production routes existed on the base | Must converge to one CI authority and one production release route |
| Flagship proof | the latest retained live benchmark records failed or blocked resume/cover-letter completion | No current production completion proof |

### Reliability-recovery programme status

Against the retained 15-task recovery plan, the evidence-backed status is:

| Task | Status on audited base/successor | Reason |
|---:|---|---|
| 1. Evidence baseline and ledger | **Implemented locally** | durable audit/handoff evidence exists, but must be refreshed per revision |
| 2. Deployment compatibility contract | **Implemented and verified locally** | contract checker, hostile-input tests, target validation, and named function launcher exist in the successor |
| 3. Schema/function compatibility | **Blocked / unverified** | later reviewed migrations are not on the audited base; no hosted apply evidence |
| 4. Provider stability | **Partial** | retry/health logic exists; the required capability matrix and durable semantics are incomplete |
| 5. Effective generation snapshot and idempotency | **Not complete** | no immutable ledger/evidence/source snapshot at the primary command boundary |
| 6. Recoverable generation state machine | **Not complete** | primary document generation remains one long streaming request without durable stage ownership |
| 7. One generation and repair authority | **Not complete** | catalogue, DIPs, fallback templates, and parallel artifact paths diverge |
| 8. Runtime-neutral content and placeholder contract | **Partial** | useful placeholder metadata and validators exist, but states and durable contracts diverge across layers |
| 9. Evidence before drafting | **Partial** | factual-audit concepts exist without a durable versioned fact/evidence snapshot |
| 10. Converge or disable parallel pipelines | **Not complete** | document, artifact, checklist, and report paths remain asymmetric |
| 11. Server persistence and export authority | **Not complete** | generated save and export remain caller/client influenced |
| 12. Bundle reduction and dead-code removal | **Not complete** | large generated profile source and legacy migration/controller material remain |
| 13. Local and CI integration environment | **Partial** | strong local gate exists; fresh database, hosted isolation, and complete raw Deno baseline remain incomplete |
| 14. Flagship resume proof | **Failed / unverified current** | retained live benchmark did not complete the journey; no newer signed-in proof was observed |
| 15. Controlled release and production verification | **Not started for successor** | no commit, CI, PR, merge, deploy, signed-in production workflow, persistence proof, or export inspection |

**Count:** 2 of 15 tasks have a locally implemented foundation result in the successor. Zero of 15 has current end-to-end production completion evidence.

---

## 4. Architectural invariants

These invariants apply before component or provider choices.

1. **One runtime ledger.** Template identity, inputs, section keys, section order, missing-information behaviour, quality expectations, source policy, persistence, export, lifecycle, and tests come from one versioned authority.
2. **Immutable snapshots.** A generation run captures immutable ledger, source, evidence, locale, jurisdiction, policy, and provider-routing versions.
3. **Server-owned commands.** The client selects an allowed intent/template and submits facts; it does not define authoritative sections, ledger policy, billing, or export state.
4. **Explicit section states.** A required section never becomes a silent blank and never masquerades as final after validation failure.
5. **Evidence before wording.** Facts and conflicts are resolved or explicitly blocked before a model is asked to draft claims.
6. **Atomic durable success.** Result, state transition, section revisions, billing decision, and audit event commit together or remain recoverable.
7. **Idempotent replay.** The same operation key returns or resumes the same logical operation without duplicate documents, charges, or side effects.
8. **Stale-write protection.** Provider output, delayed clarification answers, repairs, and exports cannot overwrite a newer user edit or approval.
9. **Approval is revision-specific.** Approval belongs to a precise persisted section/document revision, not a mutable document identity.
10. **Export reloads the source of truth.** Export never trusts caller-supplied section bodies for an authenticated document.
11. **External actions are separate.** Generate, save, approve, export, send, submit, and deploy are distinct states and authorizations.
12. **Least privilege and data minimization.** User content, secrets, provider bodies, and sensitive facts are absent from routine logs and analytics.
13. **Adapters expire.** Compatibility paths have owners, telemetry, removal criteria, and no authority to become permanent parallel systems.
14. **Evidence labels remain narrow.** Local checks, CI, preview, staging, production, persistence, export, and external action proof never imply one another.

---

## 5. High-level system

```text
┌──────────────────────────────── Client applications ────────────────────────────────┐
│ Web / Mobile                                                                         │
│ Situation intake · source selection · clarification · workspace · approval · export │
└──────────────────────────────────────┬────────────────────────────────────────────────┘
                                       │ typed commands and queries
                                       ▼
┌──────────────────────────── Application command boundary ────────────────────────────┐
│ Authentication · authorization · input validation · idempotency · revision checks    │
│ Start generation · answer clarification · repair section · approve · request export  │
└───────────────┬──────────────────────┬───────────────────────┬────────────────────────┘
                │                      │                       │
                ▼                      ▼                       ▼
┌──────────────────────┐  ┌────────────────────────┐  ┌──────────────────────────────┐
│ Runtime ledger       │  │ Fact/evidence service  │  │ Persistence transaction     │
│ immutable versions   │  │ provenance/conflicts   │  │ runs/results/revisions      │
│ templates/sections   │  │ source snapshots       │  │ billing/outbox/audit        │
└──────────┬───────────┘  └────────────┬───────────┘  └──────────────┬───────────────┘
           │                            │                             │
           └────────────────────────────┼─────────────────────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │ Generation orchestrator │
                          │ plan → draft → validate │
                          │ repair → commit         │
                          └────────────┬─────────────┘
                                       │ versioned OpenAI task requests
                                       ▼
                          ┌──────────────────────────┐
                          │ OpenAI route adapter    │
                          │ bounded retry; no       │
                          │ cross-provider fallback│
                          │ health/cost/timeout     │
                          └──────────────────────────┘

Persisted approved revision ──► export validator/renderer ──► inspected artifact record
Committed domain event ───────► privacy-safe outbox ────────► metrics/alerts/integrations
```

### Deployment shape

The current managed stack remains appropriate:

- Next.js web application;
- shared TypeScript package for portable public contracts and deterministic helpers;
- Supabase Auth, PostgreSQL, Storage, and Edge Functions;
- Netlify for web build and hosting;
- one server-owned OpenAI Responses adapter with versioned fast, deep,
  research, and conditional review routes.

A separate microservice is not required until measured workload, execution-duration, queue, isolation, or regional constraints justify it. The logical command boundary must exist before physical service separation.

---

## 6. Component ownership

### 6.1 Client applications

Clients own presentation and user intent, not policy.

They may:

- display ledger-derived sections and states;
- collect and validate user answers for immediate feedback;
- maintain an offline/device-only draft cache with explicit labelling;
- request generation, repair, approval, and export;
- render progress from durable events;
- preserve unsaved edits until remote persistence succeeds.

They must not:

- invent section structure for an active catalogue template;
- decide whether an unresolved fact is exportable;
- mark a provider response as durably saved;
- charge usage;
- construct authenticated export bodies from mutable local content;
- silently apply TED suggestions;
- translate a failed persistence call into “Saved” or “Complete.”

### 6.2 Runtime ledger

The runtime ledger is a versioned, serializable contract consumed by client, orchestrator, validator, persistence, and export.

It owns:

- template identity, aliases, locale, jurisdiction, risk, and lifecycle;
- typed input definitions and source policy;
- stable section keys, order, dependencies, and output types;
- clarification and fallback policy;
- deterministic and model-assisted validation rules;
- benchmark references and calibrated section expectations;
- persistence and replay policy;
- export policy;
- compatibility, deprecation, and migration decisions;
- contract test fixtures.

The current catalogue JSON and DIPs become migration inputs. Neither remains a second authority.

### 6.3 Fact and evidence service

The fact layer normalizes information before drafting.

Each fact records:

- stable fact key;
- typed value or structured value;
- source type and source identifier;
- captured time and extraction version;
- user assertion, extraction, external verification, or deterministic derivation status;
- confidence only where meaningful and controlled;
- conflicts and precedence decision;
- sensitivity and retention class;
- sections allowed to consume it.

Model wording is never promoted to verified evidence. User confirmation changes approval/selection state; it does not imply independent verification.

### 6.4 Generation orchestrator

The orchestrator executes a durable plan:

1. resolve the immutable ledger version;
2. resolve and validate source facts;
3. detect missing and conflicting required facts;
4. create explicit clarification/placeholder states;
5. plan only sections safe to generate;
6. draft bounded sections from permitted facts;
7. run deterministic structure and grounding checks;
8. run controlled quality review where configured;
9. repair only affected sections;
10. commit one logical result transaction;
11. publish a privacy-safe completion event after commit.

Provider adapters receive the minimum source material needed for the current section. Uploaded documents and conversation history are not duplicated into every prompt by default.

### 6.5 Persistence service

Persistence owns transactionality and revision identity. Logical commands may be implemented as reviewed SQL functions, an Edge Function transaction coordinator, or a future service, but all callers use one command contract.

It owns:

- generation operation identity;
- immutable snapshots;
- run leases and recovery;
- document and section revisions;
- clarification history;
- approval records;
- usage/billing records;
- export requests and artifacts;
- outbox events;
- optimistic concurrency.

Direct authenticated DML remains only where deliberately allowed. Surfaces marked RPC-only have direct grants revoked and tested.

### 6.6 Export service

Export accepts an authenticated document ID, approved revision ID, format, and idempotency key. It reloads the revision, ledger version, approval, section states, and export policy from storage.

It must:

- reject stale or unapproved revisions;
- reject unresolved required clarification and non-exportable placeholders;
- validate final wording and supported structure;
- render each required section once in ledger order;
- sanitize target-format content;
- record artifact hash, format, renderer version, validation result, and source revision;
- return a recoverable failure without changing approval.

An optional preview request may render caller-local content, but it is explicitly a preview, not an authenticated final export, and cannot create an export-complete record.

### 6.7 Capability router

Clients and product workflows request capabilities such as fast interpretation, document drafting, factual review, or high-reasoning review. They do not request raw model names.

The router owns:

- provider/model mapping in validated server configuration;
- timeout and retry policy;
- retryable failure classification;
- bounded fallback;
- health/cooldown semantics;
- token/cost accounting;
- response schema validation;
- cancellation propagation;
- redacted operational events.

Provider success never overrides ledger, factual, persistence, billing, or export invariants.

---

## 7. Durable domain model

The names below describe logical records. Implementation must extend the repository's authoritative types and migrations rather than creating an unconnected parallel model.

### 7.1 Immutable contract records

```text
ledger_versions
  schema_version
  ledger_version
  content_hash
  lifecycle_status
  introduced_at
  supersedes_version?

template_contracts
  ledger_version + template_id
  locale/jurisdiction/risk/lifecycle
  source_policy
  missing_information_policy
  validation_policy
  persistence_policy
  export_policy

section_contracts
  ledger_version + template_id + section_key
  stable order and dependencies
  state/output/quality contract
```

Once referenced by a persisted snapshot, a ledger version is immutable. Corrections create a new version and an explicit compatibility decision.

### 7.2 Source and evidence records

```text
source_snapshots
  snapshot_id
  user_id
  retention/redaction policy
  captured_at

source_refs
  source_id
  type
  owner and access scope
  extraction version

fact_records
  fact_key
  typed value
  source_id
  assertion/verification class
  captured_at
  sensitivity

fact_conflicts
  conflicting facts
  precedence decision or clarification state
```

Snapshots store only the minimum normalized material required to reproduce and audit a decision. They do not duplicate complete uploads by default.

### 7.3 Generation records

```text
generation_operations
  operation_id
  user_id
  idempotency_key
  template_id + ledger_version
  source_snapshot_id + evidence_snapshot_id
  status + revision
  lease owner/expiry
  created/updated/completed timestamps

generation_events
  operation_id + monotonically increasing sequence
  stage and safe metadata

document_revisions
  document_id + revision
  operation_id
  immutable document status
  validation summary

section_revisions
  document_id + document revision + section key + section revision
  explicit section state
  content/structured fields
  used fact keys and source refs
  validation issues

clarification_items
  stable question ID
  input key + affected section keys
  answer/skip/fallback history
  state revision

approvals
  document and section revision IDs
  approver and time

usage_entries
  operation ID + billable event
  idempotent uniqueness

outbox_events
  committed domain event awaiting external delivery
```

### 7.4 Export records

```text
export_requests
  export operation ID
  document revision ID
  format + renderer version
  idempotency key
  status

export_artifacts
  artifact ID
  source revision ID
  content hash
  storage reference
  validation result
  created time
```

---

## 8. State machines

### 8.1 Generation operation

```text
requested
  → validating_contract
  → resolving_sources
  → needs_clarification ───────────────┐
  → planning                           │ answer/approved fallback
  → drafting_safe_sections             │
  → validating_sections                │
  → repairing_affected_sections        │
  → committing_result                  │
  → committed ─────────────────────────┘
  → failed_recoverable
  → failed_terminal
  → cancelled
```

`committed` is the first state that may support a durable “Saved” message. A stream close or provider completion is not this state.

### 8.2 Section state

```text
needs_clarification
  → interactive_placeholder
  → final

interactive_placeholder → final
neutral_fallback → final
final → failed_validation → final
final → user_edited → approved
approved → user_edited (approval cleared for new revision)
optional_unresolved → omitted_optional
```

Required sections may be `needs_clarification`, `interactive_placeholder`, `neutral_fallback`, `final`, `user_edited`, `approved`, or `failed_validation` only as allowed by their ledger contract. They are never silent blanks.

### 8.3 Document and outcome state

Document state is derived from persisted section states, approvals, and export policy. It is not accepted from the client or model.

```text
drafting
→ needs_clarification | partial_reviewable | review_ready
→ changes_requested | approval_ready
→ approved_revision
→ export_requested
→ exported_revision
```

The broader outcome remains open until its required documents, actions, approvals, external steps, and evidence satisfy the workflow contract. Exporting a file does not automatically complete the outcome.

---

## 9. Command and query contracts

Exact route names may evolve; semantic boundaries may not.

### Commands

- **Start generation** — template/workflow intent, source references, user answers, locale, expected parent revision, idempotency key.
- **Resume generation** — operation ID, expected operation revision, idempotency key.
- **Answer clarification** — stable question ID, typed answer or approved fallback, expected state revision.
- **Repair section** — document ID, section key, expected section revision, selected issue, idempotency key.
- **Save user edit** — section revision, sanitized content, expected revision.
- **Approve section/document** — precise revision IDs and expected current revision.
- **Request export** — approved document revision, format, idempotency key.
- **Record external action** — explicit action type, authority/evidence reference, and result; never inferred from a generated recommendation.

### Queries

- **Get operation** — durable stage, safe progress, blockers, recoverable actions.
- **Get document revision** — ledger-derived ordered sections, validation, approvals, clarification, and export eligibility.
- **Get library/folder** — role and outcome grouping with original/derived document lineage.
- **Get export** — artifact state, source revision, format, and validation result.

### Error contract

Errors expose a stable code, plain-language message, retryability, affected state, and safe next action. Raw provider responses, SQL details, stack traces, credentials, private content, and internal prompts never reach the client.

---

## 10. Idempotency, concurrency, and billing

### Idempotency

- The client creates one operation key for one user intent.
- Server uniqueness is scoped by user, operation type, and idempotency key.
- Replay returns the same operation or resumes it; it does not create a new document by default.
- Section repair, clarification answer, export, and external action have their own idempotency scopes.
- Provider request IDs are subordinate execution details, not the product idempotency boundary.

### Concurrency

- Every mutable aggregate has a monotonically increasing revision.
- Commands include the expected revision.
- A stale provider response cannot overwrite a later user edit.
- A delayed clarification answer cannot replace a newer answer without a conflict workflow.
- Approval is cleared when its exact content revision changes.
- Run leases expire and may be reclaimed without duplicating committed work.

### Billing

Billable usage commits only when the billing contract's durable success condition is met. For document creation, the default boundary is the transaction that commits the usable document result. A failed provider call, failed validation, failed persistence, idempotent replay, or technical resume does not charge again.

If charging and result persistence cannot share one database transaction, use a transactional outbox and an idempotent billing consumer. Do not use unawaited best-effort billing as the final authority.

---

## 11. Clarification and missing information

Clarification is a first-class state, not a model improvisation.

- Resolve known facts before asking.
- Ask at most three questions in an ordinary batch; use up to five only for a justified high-risk template.
- Attach each question to an input key, affected sections, reason, validation rules, skip/fallback consequence, and export effect.
- Preserve safe generated sections while blocked sections wait.
- Persist question and answer history.
- Validate answers before state transition.
- Regenerate or repair only affected sections.
- Keep source classification as a user assertion unless independently verified.

The current DIP question banks and placeholder metadata should be transformed into ledger input definitions and clarification policies, not copied into a second system.

---

## 12. Validation and quality

Validation is layered:

1. **Contract validation:** version, template, keys, dependencies, states, required fields, placeholder/export rules.
2. **Content integrity:** visible non-empty content, no scaffold/instruction leakage, correct structure, bounded lengths.
3. **Grounding:** claims map to allowed source facts; conflicts and unsupported claims are explicit.
4. **Quality:** specificity, depth, tone, emotional fit, repetition, and approved benchmark calibration.
5. **Persistence:** committed result and revision identity exist.
6. **Artifact:** exported bytes are readable, ordered, complete, and attributable to the approved revision.

Deterministic checks own schema, access, persistence, billing, placeholder, export, and factual-reference invariants. Controlled model-assisted review may evaluate prose quality, but must use a versioned rubric, structured output, bounded repair, and fail-safe behavior.

Benchmarks calibrate form and quality. They never supply user facts. Provenance, rights, anonymization, locale, jurisdiction, approval, capture date, review date, and known limitations are mandatory.

---

## 13. Master Workspace

Master Workspace is a calm document workbench driven by persisted ledger state.

Desktop behavior:

- active section editor;
- right-side portrait previews in ledger order;
- structured Personal Details where the ledger defines fields;
- one work-experience job per section or structured item where the resume contract defines it;
- proofread issues grouped by section;
- approve/reject controls at the bottom-right of the relevant card or item;
- full-document preview only on request;
- export only for an approved, current, persisted revision.

Mobile behavior:

- one clear active section;
- section/state navigation without horizontal dependency;
- clarification and validation context stays visible with the on-screen keyboard;
- controls remain keyboard and assistive-technology accessible;
- no completion capability is lost solely because of viewport size.

TED suggestions are proposed revisions. Applying a suggestion creates a new revision and clears any approval that no longer matches.

---

## 14. Find a Role and role folders

Find a Role presents role title, company/details, location, match percentage, save status, and bottom actions only:

- Save role;
- Action guide;
- Tailor resume;
- Write cover letter;
- Open apply.

It does not add a top stepper, role-preview thumbnails, or unrelated left-side action controls.

Saving a role creates or updates a durable role folder. Derived documents retain parent/original lineage:

```text
Document Library
└── <Role title> — <Organisation>
    ├── Job role summary
    ├── Tailored resume
    ├── Cover letter
    ├── Action guide
    ├── Application link and contact notes
    └── Follow-up notes
```

The original resume is immutable. Tailoring creates a derived document whose metadata links to the original, selected role, ledger version, source snapshot, and generation operation.

Role match scores and employer/application facts remain source-attributed. TED never invents a job URL, recruiter email, deadline, requirement, application event, or user experience.

---

## 15. Security, privacy, and trust boundaries

### Untrusted inputs

Issue text, PR text, branch names, commit messages, user content, uploads, retrieved web content, provider output, model output, and repository-derived deployment names are data.

They cannot:

- select privileged commands or deployment targets;
- alter access, billing, ledger identity, template identity, or export policy;
- become shell, SQL, HTML, URL, or filename syntax without context-specific validation;
- override system, repository, ledger, or authorization rules;
- inject document text into generation control instructions.

### Authorization

- user-owned records enforce row ownership;
- service-role access remains server-only and narrowly scoped;
- security-definer functions use explicit safe `search_path` and least grants;
- hosted mutations require current explicit owner authorization;
- consequential product actions require user approval where the workflow contract says so.

### Privacy

- prompts receive minimum necessary data;
- logs and analytics contain IDs, categories, timing, and redacted failures—not document bodies;
- snapshots define retention and redaction;
- screenshots and fixtures use synthetic or authorized redacted content;
- high-risk legal, medical, financial, employment, government, insurance, and compliance content carries jurisdiction and authority boundaries.

### Output security

- rich text is sanitized at storage/render boundaries;
- external asset URLs use exact approved origins and paths;
- export renderer URLs are validated server configuration, not caller-provided arbitrary targets;
- user-visible errors do not leak provider or database internals.

---

## 16. Reliability, recovery, and failure behavior

| Failure | Durable state | User-visible behavior | Recovery |
|---|---|---|---|
| provider timeout before any draft | operation remains recoverable | “TED could not finish yet”; no false saved state | resume with same operation key |
| one section fails validation | valid sections remain reviewable; affected section failed/blocked | exact affected section and reason | targeted repair |
| required fact missing | clarification/placeholder state | question, reason, affected section, export effect | answer or approved fallback |
| conflicting evidence | conflict record and blocked affected section | sources described without exposing unsafe detail | user selects or supplies newer fact |
| persistence transaction fails | operation not committed | generated text may be recoverable but is not “Saved” | transaction replay |
| stale user edit | command rejected with revision conflict | compare/keep/retry options | explicit merge or reload |
| duplicate request | same operation returned | no duplicate document or charge | resume existing operation |
| export renderer fails | approved revision remains approved; export request failed | retry/download alternative if policy allows | replay export key |
| outbox delivery fails | core transaction remains committed | no false external-action success | idempotent outbox retry |
| hosted release target invalid | release stops before credentials or mutation | operator sees target validation failure | correct approved configuration |

---

## 17. Observability and service objectives

### Privacy-safe events

Record:

- correlation and operation IDs;
- template ID and ledger version;
- stage and section-state transition;
- validator category and severity;
- provider class, outcome, latency, and retry count where permitted;
- persistence, replay, billing, clarification, and export outcomes;
- redacted failure classification.

Do not record full documents, full prompts, uploads, clarification answers, contact details, credentials, or provider bodies in ordinary telemetry.

### Initial reliability objectives

Exact numeric SLOs require current production volume and owner approval. Until measured, instrument these indicators without inventing targets:

- workflow completion rate by template cohort;
- time from generation request to committed reviewable state;
- section validation and repair rate;
- clarification repetition rate;
- persistence conflict and failure rate;
- idempotent replay and duplicate-charge rate;
- save/reopen/edit/approve/export success;
- export artifact validation failures;
- OpenAI route latency, bounded retry, validation, and unavailable-route distribution;
- mobile/desktop completion parity.

### Capacity posture

Do not add queues, caches, or microservices from hypothetical scale. First measure concurrent generation operations, provider latency, Edge Function duration, database transaction time, export render time, payload size, and retry amplification. Introduce a durable queue when long-running operations exceed reliable request lifetimes or require controlled concurrency; retain the same operation/event contracts.

---

## 18. Release and operational architecture

### Repository and branch topology

- `PrompTED.AI/Thought-Enhanced-Document` is the maintained implementation and production-release
  line.
- `ClaudeTED.AI@3a9a7bc7…` is the immutable committed donor snapshot.
- the donor checkout's dirty overlay and historical recovery branches are
  read-only evidence and are never import or release ancestry.
- no parallel branch, worktree, or writer is created without an exact owner
  decision and a non-overlapping coordination claim.

### Local and CI sequence

```text
encoding/configuration/static checks
→ ledger and deployment contract checks
→ unit/integration/security tests
→ type-check and lint
→ production build
→ isolated migration and function compatibility tests
→ workflow exercise
→ artifact inspection
→ hosted mutation only after explicit authorization
```

### Production release sequence

```text
verify exact production ref and target
→ complete non-mutating release gate
→ validate secrets without exposing them
→ validate canonical Supabase target before credential-bearing request
→ apply compatible migrations
→ probe live schema
→ deploy contract-named Edge Functions through safe argument boundaries
→ smoke-probe functions
→ deploy web
→ exercise signed-in production journey
→ inspect persistence and export evidence
```

No independent function, staging, controller, or branch-writing workflow may bypass the release authority. Staging that shares production data is not isolated staging and cannot be treated as such.

Hosted configuration must be verified separately through read-only API evidence: branch protection, required checks, reviews, force-push restrictions, environment reviewers, default token permissions, and workflow-approval settings.

---

## 19. Adoption and migration plan

### Phase F — Foundation gate

1. Consolidate the sole root `AGENTS.md`.
2. Preserve the clean default-base lineage and frozen-branch boundary.
3. Consolidate CI and production release authority.
4. Validate hostile function names and exact deployment targets before credentials or mutation.
5. Record complete local evidence and unresolved repository-wide baselines.

**Exit:** reviewed foundation diff, Node 22/pnpm 10.33.0 local gate, workflow static validation, hosted configuration blockers recorded. No generation claim implied.

### Phase L0 — Ledger schema and adapter shadow mode

1. Extend the existing authoritative shared types with versioned ledger contracts.
2. Build deterministic validator and catalogue compiler.
3. Map catalogue JSON, DIPs, placeholder contracts, and benchmarks into one runtime ledger artifact.
4. Fail the build on the current 18 section-key mismatches and unknown references.
5. Run shadow validation without changing user output.

**Exit:** representative pilot contracts compile; no permanent second ledger; mismatch inventory has owner decisions.

### Phase L1 — Representative pilot

Pilot at least:

- concise: resignation letter;
- evidence-rich: selection criteria or grant proposal;
- structured/list: action guide or checklist;
- emotionally sensitive: complaint, apology, or character reference;
- high-risk/official: one supported employment/government/contract category.

Each pilot proves complete input, missing required input, missing optional input, conflict, hostile input, timeout, malformed provider output, clarification/reload/repair, stale write, save/reopen/edit/approve/export, mobile/desktop, and artifact inspection.

### Phase P — Transactional generation persistence

1. Add immutable snapshots and generation-operation records through expand-only migrations.
2. Introduce one atomic result-commit command with idempotency and optimistic concurrency.
3. Adapt the current stream to durable events.
4. Couple billing to durable success.
5. Prove failure and replay with real database integration tests.

### Phase E — Export authority

1. Require persisted approved revision IDs.
2. Reload and validate server-side.
3. version renderers and record hashes.
4. inspect real PDF/Word/spreadsheet artifacts.
5. remove authenticated caller-supplied final document bodies.

### Phase U — Workspace and role workflows

1. Render ledger-derived section states in Master Workspace.
2. preserve section-level clarification and repair.
3. enforce approval/revision semantics.
4. populate durable role folders and original/derived resume lineage.
5. prove accessible desktop/mobile completion.

### Phase C — Catalogue cohorts

1. migrate active templates in reviewed cohorts;
2. preserve persisted version compatibility;
3. remove migrated DIP/catalogue bypasses;
4. retain draft templates as unavailable;
5. publish coverage by cohort, never as an unsupported universal claim.

### Phase R — Controlled release

1. pass static, functional, and workflow gates;
2. obtain hosted configuration evidence;
3. use an isolated environment where required;
4. inspect production persistence and export artifacts;
5. retain rollback and recovery evidence;
6. mark only the exercised template cohorts as released.

---

## 20. Verification matrix

### Static correctness

- ledger schema and catalogue compiler;
- unknown template/version/key rejection;
- dependency-cycle and order validation;
- TypeScript and Deno checks;
- lint and formatting;
- migration ordering;
- workflow YAML, actionlint, and shell analysis;
- secret/bundle scan;
- production build.

### Functional correctness

- missing-information state selection;
- no-blank required sections;
- fact/source precedence and conflicts;
- deterministic placeholder handling;
- provider timeout/malformed response;
- section-scoped repair;
- idempotent replay;
- stale-write rejection;
- transaction rollback;
- duplicate-charge prevention;
- export reload and revision validation;
- RLS, grants, security-definer, and search-path tests.

### Workflow correctness

- signed-in situation through recommendation and confirmation;
- source selection/upload and evidence visibility;
- clarification with safe sections preserved;
- generation to committed reviewable workspace;
- reload and resume;
- edit, suggestion, rejection, and approval;
- save/reopen across session;
- export and actual artifact inspection;
- role save, role folder, derived resume, cover letter, action guide, and apply-link handling;
- error/recovery states;
- keyboard, screen-reader semantics, and mobile viewport.

### Evidence labels

- **Implemented:** source exists in the reported checkout.
- **Verified locally:** named local check passed on the exact branch/commit/toolchain.
- **Verified in CI:** hosted check passed for the exact commit.
- **Workflow exercised:** stated journey was actually performed in the named environment.
- **Blocked:** required gate could not proceed and the concrete blocker is recorded.
- **Unverified:** no current evidence supports the claim.

---

## 21. Rollback and compatibility

- Migrations are expand-only until old and new consumers are proven.
- Persisted documents retain original template and ledger versions.
- Compatibility adapters are read/write scoped and observable.
- Old readers remain available until migration/reopen/export tests pass.
- No section-key rename occurs without a versioned mapping and consumer inventory.
- Rollback never deletes user documents, originals, revisions, clarification history, or newly written records merely to restore old code.
- Release recovery separates web, function, and schema compatibility. Netlify
  candidates are smoke-tested before production; after publication, recovery
  is a reviewed fix-forward deploy rather than an automated restore of a stale
  artifact. Database history is never destructively rolled back.
- Feature flags may control cohort selection, but cannot bypass a known safety, fabrication, access, billing, or export defect.

---

## 22. Architecture decisions to revisit with evidence

Revisit these only when measured evidence warrants it:

- durable queue versus request/resume execution;
- extraction service separation;
- content-addressed immutable snapshot storage;
- OpenAI regional, retention, and capacity configuration;
- real-time collaboration and multi-user approval;
- supporting another person with delegated consent;
- cache layers for ledger and source resolution;
- dedicated export workers;
- multi-region availability;
- enterprise retention and audit policies.

For every revisit, record the user outcome, measured constraint, chosen option, strongest alternative, migration/rollback plan, and verification evidence.

---

## 23. Definition of architectural completion

This architecture is not complete because this document exists. A migrated template cohort is complete only when:

- its immutable ledger contract is active and validated;
- generation, clarification, repair, persistence, billing, approval, and export consume that contract;
- no bypass or competing authority can produce a final result;
- old persisted documents reopen under a defined compatibility policy;
- complete, missing, conflicting, hostile, timeout, persistence-failure, stale-write, and replay cases pass;
- desktop and mobile workflows are exercised;
- the actual export artifact is inspected;
- evidence is tied to an exact branch, commit, toolchain, and environment;
- remaining assumptions and external blockers are explicit.

The governing invariant is:

```text
verified source facts
+ immutable ledger and benchmark versions
+ explicit generation, section, and clarification states
+ atomic persistence, replay, and billing
+ user-visible validation and revision-specific approval
+ server-reloaded inspected export artifact
= a document outcome PrompTED may accurately describe as complete
```

If any required term is missing, report the narrower evidence-backed state.
