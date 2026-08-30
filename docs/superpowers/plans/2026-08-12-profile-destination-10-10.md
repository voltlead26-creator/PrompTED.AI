# Profile Destination 10/10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Profile as a 10/10 UI, 10/10 responsive layout, and 10/10 workflow destination that safely stores reusable personal facts and exactly two accepted master-resume versions, then exposes stable resource-selection infrastructure for other TED destinations.

**Architecture:** Extend the existing `profiles` row for structured personal facts, add a dedicated two-version `profile_resume_versions` table that references retained `uploads`, and keep all Profile data access behind a focused web service module. Build Profile from small sections and reusable design-system controls, including the semantic TED-branded `TCheck`. Other destinations consume Profile through a single `ProfileResourceSelector` contract rather than reading Profile tables directly.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS Modules, Supabase/Postgres RLS, Supabase Storage via existing `ingest-upload`, Vitest/Testing Library, existing PrompTED design tokens and Enhanced DIP placeholder contracts.

## Global Constraints

- Profile is a protected primary destination at `/settings/profile`.
- Target is 10/10 UI, 10/10 layout, and 10/10 workflow functionality, not visual polish alone.
- The personal-information selector exposes titles, not raw values by default.
- Core selector items: Full name, Preferred name, Date of birth, Address, Email, Contact number.
- Selected Profile facts are available only to the active workflow/document.
- Unselected required facts resolve through manual entry or `Leave as placeholder`; they are never invented and never become blank required sections.
- Workflow-specific manual values never silently update Profile.
- The T-check is a real semantic checkbox with a TED-branded T-shaped selected glyph.
- Profile retains exactly two accepted master-resume versions: Current and Previous.
- A third accepted master resume removes only the oldest retained master version.
- Tailored/job-specific resumes never replace Current without explicit user action.
- External PDF/DOCX exports do not count toward the two-version Profile retention limit.
- Reuse the existing authenticated `ingest-upload` pipeline and `original-documents` storage rather than creating a parallel upload mechanism.
- Do not weaken Enhanced DIP, output-integrity, authentication, export or RLS rules.
- Do not modify `release/ios-v1-locked`.

---

### Task 1: Profile persistence schema and two-version resume lifecycle

**Files:**
- Create: `supabase/migrations/20260812230000_profile_personal_resources.sql`
- Test/verify: migration checks used by repository CI.

**Interfaces:**
- Extends `public.profiles` with: `full_name`, `preferred_name`, `date_of_birth`, `address_line_1`, `address_line_2`, `suburb`, `state`, `postcode`, `country`.
- Produces `public.profile_resume_versions(id, user_id, upload_id, slot, accepted_at, source_kind, created_at)` where `slot` is `current|previous` and `(user_id, slot)` is unique.
- `upload_id` references `public.uploads(id)` and stored originals continue living in the existing `original-documents` bucket.

- [ ] Write the migration with idempotent profile-column additions, the resume-version table, indexes, RLS, own-row policies, and a transaction-safe SQL function `promote_profile_resume(p_upload_id uuid, p_source_kind text)` that moves Current → Previous, removes the older Previous row, and promotes the supplied upload to Current.
- [ ] Add `restore_previous_profile_resume()` that swaps Previous back to Current while keeping the two-slot maximum.
- [ ] Ensure deleting/replacing a slot removes only metadata references; storage cleanup is handled deliberately after successful promotion so a failed transaction cannot lose the prior resume.
- [ ] Run migration validation in CI and fix any policy/idempotency errors.
- [ ] Commit with `feat(profile): add personal resource persistence`.

---

### Task 2: Typed Profile data/service boundary

**Files:**
- Create: `apps/web/src/lib/profile-resources.ts`
- Create: `apps/web/src/lib/profile-resources.test.ts`

**Interfaces:**
- Produces `ProfileDetails`, `ProfileResumeResource`, `ProfileResourceSnapshot`.
- Produces `fetchProfileResources()`, `saveProfileDetails(input)`, `uploadMasterResume(file)`, `promoteMasterResume(uploadId, sourceKind)`, `restorePreviousResume()`, `getProfileResourceAvailability(snapshot)`.

- [ ] Write failing tests for normalising empty strings to `null`, preserving structured address parts, resource availability, current/previous ordering and source-kind validation.
- [ ] Implement Profile fetch/update through the browser Supabase client.
- [ ] Implement master-resume upload by calling existing `ingestUpload(file, note)` first, then promoting the returned upload ID through the database RPC.
- [ ] Treat an upload with empty extracted text as a failed resume resource and do not rotate Current/Previous.
- [ ] Surface typed user-facing errors for fetch, save, upload, promote and restore failures.
- [ ] Run focused tests and commit with `feat(profile): add typed profile resource service`.

---

### Task 3: TED-branded semantic T-check

**Files:**
- Create: `apps/web/src/components/atoms/TCheck.tsx`
- Create: `apps/web/src/components/atoms/TCheck.module.css`
- Create: `apps/web/src/components/atoms/TCheck.test.tsx`

**Interfaces:**
- Props: `label`, `checked`, `onChange`, `disabled?`, `statusText?`, `description?`, `name?`.
- Underlying control remains `<input type="checkbox">`.

- [ ] Write failing tests for semantic checkbox role, keyboard toggling, disabled state, accessible label and status text.
- [ ] Implement a full-row selectable control with visually hidden native input and custom rounded indicator.
- [ ] Draw the selected glyph with CSS/SVG as a compact T-shaped tick using existing TED accent tokens; do not rely on colour alone.
- [ ] Provide hover, pressed, focus-visible, checked, disabled and `Not saved` states with minimum touch targets.
- [ ] Verify reduced-motion and dark/light token compatibility.
- [ ] Commit with `feat(ui): add TED T-check control`.

---

### Task 4: Reusable Profile Resource Selector workflow infrastructure

**Files:**
- Create: `apps/web/src/components/organisms/ProfileResourceSelector.tsx`
- Create: `apps/web/src/components/organisms/ProfileResourceSelector.module.css`
- Create: `apps/web/src/components/organisms/ProfileResourceSelector.test.tsx`
- Create: `apps/web/src/lib/profile-resource-selection.ts`
- Create: `apps/web/src/lib/profile-resource-selection.test.ts`

**Interfaces:**
- Consumes `ProfileResourceSnapshot`.
- Produces `ProfileResourceSelection` containing selected personal fact keys and optional selected resume version.
- Produces `resolveUnselectedRequiredFact({ key, manualValue, leaveAsPlaceholder })` for destination adapters; it returns manual workflow-only input or a declared placeholder decision, never Profile mutation.

- [ ] Write tests proving the selector shows titles only, marks missing facts `Not saved`, disables missing resources, groups Current/Previous resumes separately, and never exposes raw DOB/address by default.
- [ ] Implement one compact checklist instead of repeated permission prompts.
- [ ] Keep selection state scoped to the caller/workflow; do not persist blanket consent.
- [ ] Implement the manual-entry/Leave-as-placeholder resolution model as a small independent helper contract so downstream destinations can integrate without duplicating privacy logic.
- [ ] Add tests that manual values do not call Profile save functions and that placeholder resolution cannot yield blank required content.
- [ ] Commit with `feat(profile): add resource selection workflow contract`.

---

### Task 5: 10/10 Profile page UI and responsive layout

**Files:**
- Replace: `apps/web/src/app/(app)/settings/profile/page.tsx`
- Create: `apps/web/src/app/(app)/settings/profile/ProfilePage.module.css`
- Create: `apps/web/src/app/(app)/settings/profile/ProfilePage.test.tsx`
- Create focused components only if the page would exceed a clear single responsibility, e.g. `PersonalDetailsSection.tsx` and `ResumeResourceSection.tsx`.

**Interfaces:**
- Consumes `fetchProfileResources`, `saveProfileDetails`, `uploadMasterResume`, `restorePreviousResume`.
- Produces no cross-destination API; Profile Resource Selector remains the consumer interface.

- [ ] Write failing UI tests for all approved fields, loading/error states, dirty/save state, Current/Previous resume cards, upload replacement, restore, and accessible headings.
- [ ] Build a compact page header explaining Profile as “information TED can reuse when you choose”.
- [ ] Use two desktop columns where space allows: personal information as the primary column, saved resources as the secondary column; collapse to one natural-scroll column on tablet/mobile.
- [ ] Group fields into Personal details and Address. Use responsive two-column field rows for short paired fields, but keep address line fields full width.
- [ ] Show email from auth as a trusted account value while keeping Profile reusable-email semantics explicit; do not silently create a second conflicting account email field.
- [ ] Build Current resume and Previous resume cards with filename, accepted date, source label, Open/Download where technically supported, Replace Current, and Restore Previous.
- [ ] Show a clear empty Current-resume state with upload CTA; never render an empty decorative card.
- [ ] Use inline save status and toast feedback without blocking the whole page after initial hydration.
- [ ] Ensure desktop uses the existing app-shell scroll container and the Profile page does not calculate its own viewport height.
- [ ] Ensure mobile has no horizontal overflow, no clipped actions, 44px+ touch targets, sensible sticky behaviour only where genuinely useful, and safe-area-compatible bottom spacing.
- [ ] Commit with `feat(profile): rebuild profile destination`.

---

### Task 6: Profile destination navigation protection

**Files:**
- Modify: `apps/web/src/components/organisms/AppNav.tsx` or the new canonical navigation config introduced by PR #100.
- Modify: `apps/web/src/components/organisms/TopBar.tsx` or shared page-title mapping.
- Modify tests: `AppNav.test.tsx`, `shell.test.tsx`, relevant TopBar tests.

**Interfaces:**
- Protected route remains `/settings/profile` with label `Profile`.

- [ ] Update the navigation contract test to require all seven protected destinations, including Profile.
- [ ] Ensure `/settings/profile` highlights Profile, while `/settings` highlights Settings rather than Profile.
- [ ] Ensure mobile drawer exposes Profile in the same logical order.
- [ ] Run shell/navigation tests and commit with `feat(nav): protect profile destination`.

---

### Task 7: Workflow-level Profile acceptance tests

**Files:**
- Create: `apps/web/src/app/(app)/settings/profile/profile-workflow.test.tsx`
- Extend: `apps/web/src/lib/profile-resources.test.ts`
- Extend: `apps/web/src/components/organisms/ProfileResourceSelector.test.tsx`

**Acceptance scenarios:**
1. New user with no optional details can open Profile, enter details and save them without losing account email.
2. User can upload first master resume and it becomes Current.
3. Uploading a second accepted master resume moves the first to Previous.
4. Uploading a third retains only second as Previous and third as Current.
5. User can restore Previous and the two-version invariant still holds.
6. Failed upload/extraction never rotates resume slots.
7. Resource selector exposes available titles, disables missing values and keeps raw values hidden by default.
8. Selected facts are returned to the active workflow only.
9. Unselected required fact offers manual value or declared placeholder path; neither invents content or writes Profile implicitly.
10. Profile remains fully operable with keyboard only and on a narrow mobile viewport.

- [ ] Implement the ten scenarios using mocked Supabase/API boundaries where appropriate and real pure lifecycle helpers.
- [ ] Run focused Profile test suite repeatedly until every scenario is green.
- [ ] Run type-check, lint, all web tests and production build.
- [ ] Commit with `test(profile): require complete profile workflows`.

---

### Task 8: 10/10 audit and scoring gate

**Files:**
- Create: `docs/quality/2026-08-12-profile-destination-audit.md`

**Scoring gate:**
- UI 10/10: information hierarchy, clear actions, coherent TED branding, accessible states, no misleading/dead controls, light/dark compatibility.
- Layout 10/10: desktop efficiency, tablet/mobile reflow, no nested viewport math, no horizontal overflow, no clipped controls, correct shell scrolling, consistent spacing/touch targets.
- Workflow 10/10: persisted details, deterministic two-resume lifecycle, failure recovery, restore, resource-selector contract, manual/placeholder resolution, no silent Profile mutation, no dead-end states.

- [ ] Audit every Profile state: loading, empty, partially populated, fully populated, saving, save failure, uploading, upload failure, Current-only, Current+Previous, restore, narrow mobile, keyboard-only.
- [ ] Record any defect as a blocker rather than rounding 9/10 up to 10/10.
- [ ] Fix all blockers, rerun focused tests and full repository verification after the final fix.
- [ ] Run the existing document 5/5 acceptance gate on the final PR head because Profile resources become generation inputs.
- [ ] Only record 10/10 for each category when evidence is green on the final head.

---

### Task 9: PR #100 final safety review for the Profile slice

**Files:**
- Review all Profile-related changes against `ClaudeTED.AI` and the current PR #100 head.

- [ ] Confirm Profile work exists only on `feat/restore-master-workspace-flagships` / PR #100 and is not duplicated on PR #92 or another feature branch.
- [ ] Confirm migration order is valid and no locked branch changed.
- [ ] Confirm PR #100 remains draft until all final-head CI checks and 5/5 document acceptance are green.
- [ ] Do not merge without explicit approval of the exact final PR head SHA.
