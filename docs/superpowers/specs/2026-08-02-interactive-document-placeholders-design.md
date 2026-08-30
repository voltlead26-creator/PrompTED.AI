# Interactive Document Placeholders Design

## Goal

PrompTED must always generate complete, usable final wording for every section in every document template. When an integral factual value is unknown, TED must not invent it, blank the section, or fail the document. It must insert a structured interactive placeholder at the exact point where the missing fact belongs.

## Product rule

Never invent a missing fact. Never blank a section. Never hide the gap. Generate the complete section around a visible interactive placeholder.

## Two-layer Document Intelligence model

Document Intelligence uses one authoritative engine with two layers.

### Layer 1: universal document rules

These rules are defined once and apply to every current and future document template:

1. Generate every section in final user-facing wording.
2. Never invent, infer as fact, or conceal missing factual information.
3. Insert a declared interactive placeholder when a required fact is unknown.
4. Never omit, blank, discard, or fail an otherwise valid section merely because information is missing.
5. Use a declared neutral fallback only when that fallback is fact-safe for the document and section.
6. Treat valid structured placeholders as explicit unknowns rather than unsupported factual claims.
7. Exclude unresolved placeholder labels from grammar, tone, structure, layout, and editorial proofread findings while continuing to proofread surrounding text.
8. Count unresolved placeholders before export. Warn for optional or fallback-safe placeholders and require explicit acknowledgement for placeholders marked `required_for_export`.
9. Resolve every matching placeholder in the current outcome when an answer shares a declared `shared_resolution_key`.
10. Render malformed or metadata-missing placeholders safely as visible unresolved text and log the fault. Never discard surrounding content.
11. Keep genuinely blank output, instruction leakage, undeclared placeholder tokens, and unsupported factual claims as blocking safety failures.
12. Prohibit legacy instructions that require no placeholders, require asking instead of drafting, or require a section to fail solely because a vital fact is unavailable.

These universal rules must not be copied into each profile. The shared generation, audit, proofread, resolution, and export layers enforce them once.

### Layer 2: template-specific information contracts

Every template defines only the information that differs by document type. Each section declares:

1. required information;
2. optional information;
3. fact type;
4. placeholder label;
5. exact question TED asks;
6. safe fallback wording, when one exists;
7. export requirement;
8. shared replacement key, when one answer should update multiple locations.

The template contract supplies the facts and questions. The universal layer supplies the behaviour. There must be no second Document Intelligence registry and no duplicated behavioural rules maintained per template.

## Universal template-library scope

This rule applies to every current and future template in the PrompTED template library that uses Document Intelligence.

No template may rely only on a generic list of missing information. Every template must explicitly declare the information contract for each section, including:

- required facts needed for accurate final wording
- optional facts that improve the result but never block generation
- the semantic fact type for each required value
- the visible placeholder label used when the value is unknown
- the exact contextual question TED asks the user
- any safe neutral fallback wording
- whether the unresolved value requires acknowledgement before export
- whether one answer may resolve multiple placeholders in the same outcome

A template is not considered Document Intelligence complete until every section has this information contract.

## Document Intelligence template contract

Each template section must define a `required_information` collection. Each entry contains:

- `key`: stable semantic key within the template, such as `recipient_name`
- `label`: human-readable fact name
- `fact_type`: semantic type such as `person_name`, `company_name`, `date`, `amount`, `address`, `contact_detail`, `credential`, `reference`, or `other`
- `question`: the exact question TED asks when the user selects the placeholder or contextual issue
- `placeholder_label`: short inline wording such as `hiring manager's name`
- `fallback`: optional neutral wording that does not invent a fact
- `required_for_export`: whether unresolved export needs explicit acknowledgement
- `shared_resolution_key`: optional key allowing one answer to replace matching placeholders across sections in the same outcome

Each section may also define `optional_information` entries. Missing optional information never creates an unresolved issue unless the template explicitly says that the user should be offered the choice.

Document Intelligence validates the library so that:

1. every template section has a declared information contract;
2. every required fact has a question and placeholder label;
3. every fallback is neutral and fact-safe;
4. every placeholder key is unique within its template unless intentionally linked by `shared_resolution_key`;
5. no required information item can cause a section to be omitted or returned blank.

Templates added later must pass the same validation before release.

## Placeholder contract

Each unresolved placeholder is represented in generated markdown using a stable token:

`{{TED_PLACEHOLDER:<id>:<label>}}`

The generation response also carries metadata:

- `id`: stable placeholder identifier
- `template_id`: canonical template identifier
- `section_key`: canonical section key
- `information_key`: key from the template's `required_information` contract
- `label`: short visible wording
- `question`: the exact question TED asks the user
- `fallback`: optional neutral wording TED may use
- `required_for_export`: whether unresolved export needs explicit acknowledgement
- `fact_type`: semantic fact type
- `shared_resolution_key`: optional key for replacing related occurrences in the same outcome

Raw tokens are never shown to the user. They are converted to interactive inline controls by the renderer.

## Generation behaviour

1. TED writes the full section in final wording for every template.
2. Only unknown factual values declared by the template contract become placeholders.
3. TED still authors ordinary professional wording, tone, summaries, structure, introductions, recommendations, transitions, and safe conventional phrasing.
4. Missing identity-critical or other integral information no longer stops drafting.
5. Document Intelligence supplies the required-information contract to the writer and auditor for each template and section.
6. The factual safety gate treats valid structured placeholder tokens as explicit unknowns, not unsupported claims.
7. Truly blank output, instruction leakage, malformed undeclared placeholders, and unsupported factual claims remain blocking.
8. A section may never be returned as an empty shell merely because one or more required facts are unavailable.

## Rendering and interaction

Unresolved placeholders render as inline buttons inside the document:

- italic text
- accessible amber/accent colour with AA contrast
- light tinted background
- dotted underline
- visible keyboard focus
- accessible name `Missing information: <label>`

Selecting a placeholder opens the existing contextual missing-information control for that placeholder. The user can:

- enter the factual value
- apply the provided neutral fallback when available
- dismiss temporarily

The section-level `Needs attention` indicator opens the first unresolved placeholder for that section and allows navigation through the remaining placeholders.

## Resolution behaviour

When the user answers:

1. Replace every matching placeholder ID in the current document.
2. Replace placeholders sharing the same `shared_resolution_key` within the same outcome when appropriate.
3. Persist the updated section content through the existing versioned edit path.
4. Remove the resolved missing-information entry.
5. Re-run generation only for surrounding wording when grammatical agreement or context requires it; otherwise perform deterministic replacement.
6. Preserve the answer for other occurrences in the same outcome.

## Proofread behaviour

Proofread must exclude unresolved placeholder labels from grammar and quality findings. It must not report a placeholder as awkward wording. Surrounding text remains eligible for proofread suggestions.

## Export behaviour

Before export, PrompTED counts unresolved placeholders.

- No unresolved placeholders: export normally.
- Unresolved optional or fallback-safe placeholders: warn and allow export.
- Unresolved `required_for_export` placeholders: require explicit acknowledgement before export.

Exported documents keep the visible placeholder wording when the user knowingly proceeds.

## Data flow

1. The selected template provides its section-level information contract.
2. Document Intelligence compares confirmed source facts with the template contract.
3. The document pipeline returns complete sections and structured placeholder metadata.
4. The generation stream emits placeholder metadata alongside section events.
5. `useDocument` and `useWorkspace` store unresolved placeholders with the outcome.
6. Section rendering converts placeholder tokens into interactive controls.
7. `MissingInfoIssue` resolves a placeholder and updates affected sections.
8. Proofread and export utilities receive unresolved placeholder metadata.

## Error handling

- Malformed placeholder tokens are rendered as plain text and logged, never discarded.
- Missing metadata falls back to the token label.
- Missing template contract data fails template validation rather than failing a user's document at runtime.
- Failed answer persistence leaves the placeholder unresolved and shows the existing save issue.
- A failed local replacement never removes the missing-information record.

## Accessibility

- Placeholder controls are keyboard reachable.
- Their accessible names identify the missing fact.
- Colour is not the only status indicator; italics, underline, background and button semantics are also used.
- Contextual answer controls restore focus to the placeholder after closing.

## Template-library migration

Implementation must include an audit and migration of every existing template in the library.

For each template:

1. inventory every section;
2. identify the integral facts required for accurate final wording;
3. distinguish required facts from optional quality improvers;
4. define placeholder labels, questions, fallbacks, fact types, and export rules;
5. add automated validation coverage;
6. confirm that a document can still generate every section when all required facts are absent.

The migration is complete only when every template passes the Document Intelligence contract validator. Templates without a complete contract must fail CI, not fail users in production.

## Testing

Add tests for:

- universal rules are defined once and consumed by all templates
- no profile contains contradictory anti-placeholder wording
- every template and section has a valid information contract
- template-library validation fails for missing questions, labels, or unsafe fallbacks
- generation with all required facts missing still returns every section with final wording
- only declared factual values become placeholders
- safety audits allow valid structured placeholders but still block invented facts
- placeholder token parsing and rendering
- click and keyboard activation
- deterministic replacement of all matching occurrences
- shared resolution across matching placeholders in one outcome
- section issue navigation
- proofread exclusion
- export warnings and acknowledgement
- malformed token fallback
- future templates cannot be added without a complete information contract

## Non-goals

- Native Expo implementation in this PR
- arbitrary user-created template variables
- cross-outcome global autofill
- changing unrelated document layout or navigation
- allowing unsupported facts through the safety gate
