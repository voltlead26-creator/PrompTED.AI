# Master Workspace Flagship Navigation, Interactive Plans, Profile & Settings Design

## Purpose

Restore PrompTED's core product destinations as permanent application navigation, keep Checklists / Action Plans as a first-class editable workspace, and establish Profile as TED's trusted personal-resource store while keeping account and product preferences in Settings.

This specification is a product contract. Future shell, routing, design-system, or navigation refactors must preserve the protected destinations and their canonical routes unless a later approved product specification explicitly replaces them.

## Protected primary navigation

The persistent desktop rail and mobile drawer expose these seven protected destinations, in this order:

1. **Home** → `/home`
2. **Master Workspace** → `/workspace`
3. **My Work** → `/library`
4. **Checklists / Action Plans** → `/plans`
5. **Find a Job** → `/roles`
6. **Profile** → `/settings/profile`
7. **Settings** → `/settings`

The active destination is visually and accessibly identified. Desktop retains the current compact persistent rail behaviour. Mobile uses the existing drawer/backdrop behaviour and exposes the same seven destinations.

### Navigation protection contract

The seven destinations must be declared from one shared canonical navigation configuration consumed by the desktop rail, mobile drawer, route-title mapping, and navigation tests wherever practical.

Automated tests must fail if any protected destination:

- is removed;
- is unexpectedly renamed;
- points to a non-canonical route;
- disappears from desktop navigation;
- disappears from mobile navigation; or
- is displaced by a secondary creation or account action.

`Home`, `Master Workspace`, `My Work`, `Checklists / Action Plans`, `Find a Job`, `Profile`, and `Settings` are not temporary implementation details and must not be removed as part of unrelated UI simplification.

## Global creation entry point

The rail includes a secondary `+ Create` control. It is not an eighth primary destination. It opens a compact menu with:

- **Document** → `/create`
- **Checklist / Action Plan** → `/plans?create=ted`
- **Upload to Master Workspace** → `/workspace`

## Home

`/home` remains the user-facing starting point and should provide concise access to recent work, useful next actions, and relevant TED entry points without duplicating the full navigation rail.

Home must not replace or hide the protected primary destinations.

## Master Workspace

`/workspace` remains the direct import-first Master Workspace. Existing upload, section detection, fidelity review, editable section workflow, and handoff to the document workspace are preserved.

A document with any required blank section and valid generation context is not considered complete. Recovery must request only missing required sections where possible so valid existing wording is preserved.

## My Work

`/library` is the consolidated saved-work surface and retains the navigation label **My Work**.

It may contain saved documents, drafts, completed documents, generated outcomes, and other supported saved work. Checklists and action plans remain discoverable through their dedicated flagship destination even if compatible saved-outcome cards also appear in My Work.

## Checklists / Action Plans

`/plans` is a flagship hub with three explicit creation modes.

### Create with TED

The user describes a goal or situation and enters the existing TED recommendation/generation flow for a checklist or action plan. Generated plans open in the interactive plan editor.

### Create manually

The user opens a live interactive editor immediately. The editor starts with a title and one editable action item. Changes happen locally immediately and persist continuously.

The manual editor supports:

- rename plan title;
- add action item;
- edit action text inline;
- mark complete/incomplete;
- delete action item;
- reorder action items with explicit controls;
- optional section/phase label per item;
- optional notes/details per item;
- optional due date;
- continuous persistence for authenticated users and supported guest persistence;
- TED-assisted `Expand`, `Shorten`, and `tEdit` on a selected item without regenerating the entire plan.

### Start from template

The hub links into the existing catalogue/browse flow with checklist/action-plan intent. A separate duplicate template catalogue must not be introduced solely for this feature.

## Existing generated plan editor

The existing generated-plan surface remains the rich generated-plan editor. Manual editing capability must extend rather than replace existing completion tracking, grouped sections, detail panels, progress indicators, and TED-assisted edit review.

## Find a Job

`/roles` remains the flagship employment workflow. Role discovery, saved opportunities, action plans, tailored resumes, cover letters, and related employment outcomes continue to link into the relevant TED workspaces.

## Profile: TED's trusted personal resource store

Profile answers: **What should TED know about me and be able to reuse when relevant?**

The Profile destination is directly available from the primary navigation and is not treated merely as a hidden Settings subsection even if its current route remains `/settings/profile`.

### Personal details

Profile should support user-controlled storage of reusable personal information including:

- full legal name;
- preferred/display name;
- email address;
- phone/contact number;
- date of birth;
- address line 1;
- address line 2 where applicable;
- suburb/locality;
- state/territory;
- postcode;
- country; and
- other clearly justified reusable personal fields required by supported Document Intelligence Profiles.

Sensitive information remains user-controlled. Saved facts are never silently injected into a workflow merely because Profile contains them.

### Profile Resource Selector

When a destination or document workflow can benefit from saved Profile information, TED presents one compact **Profile Resource Selector** before consuming those saved values. It replaces repeated field-by-field permission prompts and avoids adding separate permission steps throughout already complex workflows.

The selector shows the **titles** of all available personal information, not the raw values by default. The core personal-information checklist includes:

- Full name
- Preferred name
- Date of birth
- Address
- Email
- Contact number

Address is represented as one permission item even though Profile stores its structured components separately. A destination may then consume only the address components its contract actually needs.

Additional saved Profile fields may appear only when they are supported reusable facts and are relevant to the workflow. The selector must not become an indiscriminate dump of internal metadata.

Each item behaves as follows:

- **Selected**: TED may use the saved Profile value throughout that specific workflow or document.
- **Unselected**: TED does not read/use the saved Profile value for that workflow.
- **Not saved**: the item remains visible with a `Not saved` state and cannot be selected until a value exists.

If a required fact remains unselected, the workflow offers exactly two resolution paths when that fact is needed:

1. **Enter manually** — the user supplies a workflow-specific value that does not update Profile automatically.
2. **Leave as placeholder** — TED uses the declared Enhanced DIP interactive placeholder for that fact.

A manually entered value belongs only to the active workflow unless the user separately chooses an explicit **Save to Profile** action.

`Leave as placeholder` must preserve the existing Enhanced DIP guarantees: the placeholder stays visibly labelled, interactive, resolvable later, persisted in unresolved-placeholder metadata where applicable, and subject to required-for-export acknowledgement rules. It must never become a blank section, vague filler, or invented information.

Profile-resource selections apply only to the current workflow/document. A new workflow receives a fresh selector rather than inheriting indefinite blanket consent.

### TED-branded selection control

The selector uses a distinctive TED-branded selected state called the **T-check**.

The T-check is a real semantic checkbox underneath, with the visual treatment layered on top so keyboard, screen-reader, focus, and form behaviour remain standard and testable.

Visual contract:

- unselected state: clean rounded checkbox outline using the normal interface border;
- selected state: rounded filled control using the approved TED brand accent;
- selected glyph: a custom **T-shaped checkmark** that reads first as a positive tick and second as a subtle `T` for TED;
- the glyph must remain recognisable at small sizes and must not rely on colour alone;
- hover, focus-visible, pressed, disabled, and `Not saved` states must be visually distinct;
- the entire labelled row is selectable, not only the tiny checkbox target;
- minimum touch target follows the existing mobile accessibility contract.

The T-check must be implemented as a reusable design-system component for Profile-resource selection and other genuine TED approval/checklist moments where its semantics are appropriate. It must not replace ordinary checkboxes everywhere merely for decoration.

### Saved resources selector

When relevant, the same selector includes a separate **Saved resources** group beneath personal information. For employment and resume-aware workflows this may include:

- **Current resume**
- **Previous resume**

Only resources that actually exist are selectable. Current resume is presented first. Neither resume is silently consumed without being selected for that workflow.

### Master resume resource

Profile contains a dedicated **Current resume** resource that TED can make available to relevant workflows through the Profile Resource Selector.

The profile retains exactly the **two most recent accepted master resume versions**:

1. **Current resume** — the active master resume.
2. **Previous resume** — the immediately preceding accepted master version, available to view, compare, restore, or export.

When a newly accepted master resume replaces the current version:

- the accepted version becomes **Current resume**;
- the former Current resume becomes **Previous resume**;
- the older Previous resume is removed from Profile retention; and
- future workflows present the new Current resume as the default first saved-resume resource.

A user may also manually upload a new master resume to Profile. A successful replacement follows the same two-version lifecycle.

### Resume update rules

When TED updates, enhances, corrects, or otherwise changes the user's **master resume**, the newly accepted result becomes the Current resume automatically and the two-version lifecycle applies.

A **job-specific tailored resume does not automatically replace the master resume**. After accepting a tailored resume, the user must be offered an explicit **Update my master resume** action if they want that version to become the Current resume.

Rejecting or abandoning TED's proposed resume changes must not replace either stored master version.

### Resume availability to TED

When a relevant workflow can use resume information, TED resolves the Current and Previous resume metadata from Profile and presents the applicable saved resource choices through the Profile Resource Selector rather than requiring the same file to be uploaded repeatedly.

The selected resume is a supporting evidence source, not permission to invent missing facts. Enhanced DIP and output-integrity rules continue to govern document generation.

## Resume completion and export flow

Whenever TED creates, updates, enhances, or tailors a resume, successful completion must surface a clear post-review save/export choice by default.

After the user accepts the resume wording, the completion interface should expose the applicable actions:

- **Save as current resume in Profile**;
- **Export resume**;
- **Save a copy externally**;
- **Keep as job-specific version only**; and
- **Update my master resume** when the result is a job-specific/tailored version.

For a master-resume workflow, saving the accepted master version follows the two-version lifecycle automatically.

For a tailored/job-specific workflow, the result remains job-specific unless the user explicitly chooses **Update my master resume**.

### External export

External export is a default completion option, not a buried secondary action.

Supported resume export formats should include at minimum:

- **PDF**; and
- **DOCX**.

The app should invoke the normal browser/device download or save flow so the exported resume exists independently of PrompTED.

External files do not count toward the two-version Profile retention limit. Profile retains only the two most recent accepted master resume versions inside PrompTED.

Raw `TED_PLACEHOLDER` tokens, blank required sections, scaffold instructions, or unresolved export-blocking facts must never be silently exported as completed resume wording.

## Settings

Settings answers: **How should my account and TED behave?**

Settings remains distinct from Profile and should contain, where supported:

- **Appearance** — Light, Dark, or System mode;
- **Subscription & usage** — current plan, entitlement/usage visibility, and upgrade/downgrade/cancel entry points where supported;
- **Billing & payment details** — secure handoff to the configured billing provider or supported billing-management surface rather than storing raw payment credentials in PrompTED;
- **Support & help** — help resources and a clear support/contact path;
- **Business & Brand** — existing business profile/brand-kit controls where applicable;
- **Privacy & data controls** — understandable controls for personal data and saved resources;
- **Sign out**;
- **Account deletion** with explicit confirmation and existing safety requirements.

Settings must not absorb Profile's core personal-resource responsibilities merely because the current Profile route is nested beneath `/settings`.

## Quality and safety invariants

- Navigation restoration must not weaken the Enhanced DIP document-generation contract.
- No path may intentionally emit, persist, or export a blank required document section.
- Missing document facts resolve through declared Enhanced DIP placeholders/fallbacks rather than blank content.
- Checklist item editing must never invoke whole-plan AI regeneration for a single-item edit.
- Destructive checklist actions require explicit user action and must not silently delete unrelated items.
- Saved Profile values are consumed only when selected in the active workflow's Profile Resource Selector.
- An unselected required Profile fact resolves through manual entry or a declared Enhanced DIP placeholder, never invention.
- Workflow-specific manual values never silently update Profile.
- Resume master-version replacement occurs only after accepted wording or explicit user upload/replacement.
- Tailored resumes never silently replace the Current master resume.
- Only the two newest accepted master resume versions remain in Profile.
- External resume exports remain independent of the Profile retention limit.
- Mobile controls meet existing touch-target, keyboard, and accessibility conventions.
- `release/ios-v1-locked` must not be modified.

## Acceptance tests

### Protected navigation

- Desktop rail exposes all seven protected destinations in the approved order.
- Mobile drawer exposes the same seven destinations in the same logical order.
- Canonical route tests cover Home, Master Workspace, My Work, Checklists / Action Plans, Find a Job, Profile, and Settings.
- Active highlighting works on direct and appropriate nested routes.
- Removing or renaming a protected destination causes a navigation-contract test failure.
- `+ Create` exposes the three approved creation routes without displacing protected navigation.

### Plans hub/editor

- `/plans` shows saved plans plus Create with TED, Create manually, and Start from template.
- Manual editor can add, edit, delete, reorder, complete, section-label, note, and date items without page reload.
- TED-assisted edits apply only after review/confirmation and never replace unrelated action items.
- Existing generated action plans still render and save.

### Profile resource selector

- The selector lists available Profile information by title without exposing raw values by default.
- Full name, Preferred name, Date of birth, Address, Email, and Contact number are represented in the core checklist.
- Missing fields display `Not saved` and cannot be selected.
- Selected fields are available only to the active workflow/document.
- Unselected required fields resolve through manual entry or Leave as placeholder.
- Manual workflow values do not mutate Profile unless an explicit Save to Profile action is chosen.
- Leave as placeholder produces a declared Enhanced DIP interactive placeholder and never blank content.
- Current and Previous resume appear in a separate Saved resources group when relevant and available.
- The T-check remains a semantic checkbox with keyboard, screen-reader, focus-visible, and touch-target support.
- The T-check selected glyph remains recognisable without relying on colour alone.

### Profile and resume lifecycle

- Profile can persist the approved personal-detail fields for an authenticated user.
- Relevant workflows can request Current or Previous resume through the Profile Resource Selector.
- Accepting an updated master resume promotes it to Current and demotes the former Current to Previous.
- A third accepted master version removes only the oldest retained Profile version.
- Restoring Previous makes it Current while preserving a two-version maximum.
- A job-specific tailored resume does not replace Current without explicit user action.
- Rejecting an edit does not alter Current or Previous resume versions.
- The completion flow surfaces external export by default.
- PDF and DOCX export paths are available where export is permitted.
- External export does not alter the two retained Profile versions unless the user separately chooses to update the master resume.

### Settings

- Settings exposes appearance controls, subscription/usage, billing-management access, support/help, privacy/data controls, sign-out, and account deletion where the underlying capability exists.
- Light/Dark/System appearance selection persists through the existing theme mechanism.
- Payment details are managed through the approved billing-provider surface rather than raw card-data storage in PrompTED.

### Document regression gate

After the final implementation change, run a minimum of **five consecutive independent document-generation acceptance runs** against the final head. Each run must pass all of the following:

1. every expected required section has visible content;
2. final document text is final wording, not drafting instructions;
3. missing information appears only as a declared Enhanced DIP interactive placeholder or approved neutral fallback;
4. no raw `TED_PLACEHOLDER` token, generic scaffold marker, `TBD`, `TODO`, or instruction-like filler is exposed as final wording;
5. no required section is blank or whitespace-only;
6. uploaded or Profile-sourced information used in the request is represented correctly where relevant;
7. existing valid wording survives missing-section recovery;
8. any quality failure is explicit and recoverable rather than silently converted to empty content.

**Pass criterion: 5/5 consecutive successful runs on the final implementation head.** A single failure blocks completion, requires diagnosis and correction, and resets the acceptance sequence to run 1/5.

## Non-goals

- Do not redesign unrelated document Workspace interactions while restoring/protecting navigation.
- Do not replace the existing checklist persistence schema unless a blocking incompatibility is found.
- Do not store raw payment-card details directly in PrompTED.
- Do not keep unlimited resume history inside Profile; the approved retention is exactly two accepted master versions.
- Do not silently promote every tailored resume to the master resume.
- Do not use Profile data in a workflow without selection through the Profile Resource Selector.
- Do not turn the T-check into a universal replacement for ordinary checkbox semantics.
- Do not refactor unrelated application-shell code.
- Do not change `release/ios-v1-locked`.
