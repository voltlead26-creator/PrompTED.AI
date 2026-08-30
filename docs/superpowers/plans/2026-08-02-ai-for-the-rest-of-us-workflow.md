# AI for the Rest of Us Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure PrompTED so every creation, document, checklist, and action-plan workflow is minimal, contextual, mobile-first, and understandable without knowledge of AI systems or PrompTED’s internal architecture.

**Architecture:** Preserve the existing Next.js application, Supabase persistence, shared generation pipelines, and section data model. Introduce a small set of reusable interaction contracts: safe return-to authentication, contextual issue indicators, a universal `tEdit` proposal flow, mobile full-screen work surfaces, and consistent top/global versus bottom/contextual actions. Deliver the work in independently testable stages so generation safety and stored user work remain unchanged while the presentation and workflow are simplified.

**Tech Stack:** Next.js 15 App Router, React, TypeScript strict mode, CSS Modules, Supabase Auth/Postgres, pnpm workspaces, Vitest, Testing Library, vitest-axe, shared `@prompted/shared` document and artifact clients.

## Platform Delivery Boundary

This plan is now executed **web first**. The current branch and PR may modify `apps/web/**` and genuinely platform-independent shared contracts only. It must not modify `apps/mobile/**`.

After the web workflow passes its own acceptance gate and is integrated normally, mobile will be implemented from a new branch, a separate mobile-specific plan, and a separate draft PR. Browser-responsive behavior and native Expo behavior must not be built in the same implementation pass.

The mandatory sequencing and shared-code rules are defined in:

`docs/superpowers/plans/2026-08-02-platform-delivery-sequence.md`

## Global Constraints

- Product doctrine: **AI for the rest of us**.
- Primary design enemy: **confusion**.
- One clear purpose and one obvious next action per screen.
- Documents, checklists, and action plans must dominate the viewport.
- No full-width warning or recovery banners inside working surfaces.
- Problems must appear beside the exact section, checklist item, or action step they affect.
- Global actions stay at the top: **Approve all**, **Save**, **Proofread**.
- Contextual editing actions stay at the bottom: **Expand**, **Shorten**, **tEdit**.
- `tEdit` replaces “Refine with TED”, “Improve with TED”, “Edit with TED”, and equivalent labels.
- TED must show a proposed change before modifying user content.
- Proposal actions are **Apply**, **Try again**, and **Discard**.
- Mobile-browser document exit supports both visible back/close and swipe-down collapse where browser input and text-selection behavior remain safe.
- Browser page navigation uses margin-only horizontal swipes plus accessible previous/next controls.
- Native mobile gestures are excluded from this web pass and will be designed independently in `apps/mobile`.
- Preview is not a permanent action; Export and Alternate formats belong in overflow menus.
- Existing generation safety, factual grounding, autosave, credits, and user content must not be weakened.
- No merge, deployment, force push, force merge, schema deletion, or destructive data migration as part of this plan.

---

## Final Repo Audit

### Current architecture that should remain

- `apps/web/src/hooks/useDocument.ts` owns workspace loading, local/remote persistence, generation state, missing information, retry state, and section updates.
- `apps/web/src/lib/document-generation.ts` routes workspace documents through the audited shared document pipeline.
- `supabase/functions/_shared/document-pipeline-utils.ts` and `ted-artifact-pipeline.ts` enforce output quality and grounding.
- `apps/web/src/components/organisms/WorkspacePane.tsx` and `SectionEditor.tsx` are the correct presentation seams for active sections, previews, and editing.
- `apps/web/src/app/(app)/outcomes/[id]/WorkspaceScreen.tsx` is the document-workspace orchestration seam.
- `apps/web/src/components/organisms/TopBar.tsx`, `AppNav.tsx`, and `apps/web/src/app/(app)/AppShell.tsx` own app-level navigation and shell behavior.
- The existing `checklist_items` data model and artifact generation pipeline should remain the basis for interactive plans and checklists.

### Current structures that create confusion

- `GenerationRecoveryPanel.tsx` turns local issues into a large page-level panel and mixes authentication, credits, and content-generation recovery in one component.
- `useDocument.ts` stores infrastructure failures as pseudo-section IDs (`__auth__`, `__paywall__`), causing technical state to leak into the content UI.
- Successful sign-in always routes to `/home`; interrupted document context is lost.
- Workspace actions mix document-wide actions, section actions, preview/export actions, and AI actions in the same visual tier.
- The active document contains action buttons that can clip horizontally on narrow browser viewports.
- Section previews use a separate nested scrolling region and can obscure labels or consume excessive height.
- Alternate formats are promoted ahead of the checklist/action plan itself.
- Similar AI-editing behavior has multiple labels and presentation patterns.
- Internal terms such as generation recovery, safe wording, artifacts, alternate outputs, and authentication errors are exposed to users.

### Features deliberately excluded

The audit found no need to add chat-first navigation, analytics dashboards, prompt controls, model selectors, autonomous document replacement, complex project-management views, additional primary navigation destinations, or permanent AI sidebars. Those features would increase cognitive load without improving the core outcome-completion promise.

---

## Stage 1: Restore interrupted work and replace recovery banners

### Task 1.1: Safe authentication return paths

**Files:**
- Create: `apps/web/src/lib/auth-return.ts`
- Create: `apps/web/src/lib/auth-return.test.ts`
- Modify: `apps/web/src/app/(auth)/sign-in/page.tsx`
- Modify: `apps/web/src/app/auth/callback/route.ts`

**Interfaces:**
- Produces: `safeInternalReturnPath(value: string | null | undefined, fallback?: string): string`
- Produces: `signInHref(returnPath: string): string`
- Consumed by: sign-in page, OAuth callback, workspace recovery actions.

- [x] **Step 1: Write tests for accepted internal paths and rejected external/protocol-relative paths.**
- [x] **Step 2: Run `pnpm --filter @prompted/web test -- auth-return.test.ts` and confirm failure before implementation.**
- [x] **Step 3: Implement `safeInternalReturnPath` so only a single-origin path beginning with one `/` is accepted and backslashes/control characters are rejected.**
- [x] **Step 4: Read `next` from the sign-in URL; route password login to the safe return path.**
- [x] **Step 5: Include the same encoded `next` value in Google OAuth’s `/auth/callback` redirect URL.**
- [x] **Step 6: Sanitize the callback route’s `next` parameter before redirecting.**
- [ ] **Step 7: Run focused tests, type-check, and lint.**
- [x] **Step 8: Commit `fix(auth): return users to interrupted work`.**

### Task 1.2: Clear stale authentication state

**Files:**
- Modify: `apps/web/src/hooks/useDocument.ts`
- Test: `apps/web/src/hooks/persistence.test.tsx` or create `apps/web/src/hooks/useDocument.auth.test.tsx` if the current harness cannot isolate auth transitions.

**Interfaces:**
- Consumes: `AUTH_SECTION_ID`, authenticated `userId` from `useAuth()`.
- Produces: authenticated workspaces no longer retain a stale expired-session issue.

- [ ] **Step 1: Add a regression test that starts with an auth generation issue, restores a user session, and expects the auth issue to disappear.**
- [ ] **Step 2: Run the focused test and confirm the stale issue remains.**
- [ ] **Step 3: Filter `AUTH_SECTION_ID` from `generationIssues` when `userId` becomes available.**
- [ ] **Step 4: Preserve paywall and content issues during the same transition.**
- [ ] **Step 5: Run the focused test and existing persistence tests.**
- [ ] **Step 6: Commit `fix(workspace): clear resolved sign-in issue`.**

### Task 1.3: Contextual issue model

**Files:**
- Create: `apps/web/src/components/molecules/ContextIssue.tsx`
- Create: `apps/web/src/components/molecules/ContextIssue.module.css`
- Create: `apps/web/src/components/molecules/ContextIssue.test.tsx`
- Modify: `apps/web/src/components/organisms/GenerationRecoveryPanel.tsx`
- Modify: `apps/web/src/components/organisms/GenerationRecoveryPanel.test.tsx`
- Modify: `apps/web/src/components/organisms/WorkspacePane.tsx`
- Modify: `apps/web/src/components/organisms/SectionEditor.tsx`

**Interfaces:**
- Produces: `ContextIssue` with `title`, `message`, `actionLabel`, `onAction`/`href`, `tone`, and accessible popover state.
- Consumes: section-local missing information, unsupported wording, authentication, and credit issues.

- [ ] **Step 1: Test a compact issue trigger that opens an anchored popover and returns focus when closed.**
- [ ] **Step 2: Implement the issue component using a button, `aria-expanded`, `aria-controls`, Escape dismissal, and click-away dismissal.**
- [ ] **Step 3: Replace section-generation rows with issue markers attached to the matching section card/editor.**
- [ ] **Step 4: Present authentication and credit actions as compact workspace-level status controls near the affected action rather than a document-covering panel.**
- [ ] **Step 5: Remove the page-level recovery panel from normal workspace flow.**
- [ ] **Step 6: Verify no issue UI exceeds the width of its parent or pushes the active document below the fold.**
- [ ] **Step 7: Run component tests, axe tests, type-check, lint, and build.**
- [ ] **Step 8: Commit `refactor(workspace): replace recovery banners with contextual issues`.**

---

## Stage 2: Rebuild Web Master Workspace around the document

### Task 2.1: Separate global and contextual actions

**Files:**
- Modify: `apps/web/src/app/(app)/outcomes/[id]/WorkspaceScreen.tsx`
- Modify: `apps/web/src/app/(app)/outcomes/[id]/WorkspaceScreen.module.css`
- Create: `apps/web/src/components/organisms/WorkspaceGlobalActions.tsx`
- Create: `apps/web/src/components/organisms/WorkspaceContextActions.tsx`
- Create tests beside both components.

**Interfaces:**
- Global actions: `onApproveAll`, save state, `onProofread`, overflow actions.
- Context actions: `onExpand`, `onShorten`, `onTEdit`, selected section/text scope.

- [ ] **Step 1: Add tests asserting top actions are Approve all, Save, and Proofread only.**
- [ ] **Step 2: Add tests asserting bottom actions are Expand, Shorten, and tEdit only.**
- [ ] **Step 3: Move Export and Alternate formats into an accessible overflow menu.**
- [ ] **Step 4: Remove the permanent Preview action and any duplicate Approve section control inside the page.**
- [ ] **Step 5: Make Save a status-aware action (`Saving…`, `Saved`, `Save`) without a banner.**
- [ ] **Step 6: Run component and workspace tests.**
- [ ] **Step 7: Commit `feat(workspace): establish clear action hierarchy`.**

### Task 2.2: Full-screen narrow-browser section editor

**Files:**
- Modify: `apps/web/src/components/organisms/WorkspacePane.tsx`
- Modify: `apps/web/src/components/organisms/WorkspacePane.module.css`
- Create: `apps/web/src/hooks/useMobileWorkspaceGestures.ts`
- Create: `apps/web/src/hooks/useMobileWorkspaceGestures.test.ts`

**Interfaces:**
- Produces: `expanded`, `openExpanded`, `closeExpanded`, margin swipe page navigation, swipe-down close handlers.
- Consumes: active section index and section-selection callback.

- [ ] **Step 1: Test tap-to-expand, close-button exit, and swipe-down exit in supported mobile browsers.**
- [ ] **Step 2: Test horizontal swipes only navigate when initiated in defined left/right margin hit zones.**
- [ ] **Step 3: Implement a narrow-browser fixed editor using `100dvh` and CSS safe-area insets.**
- [ ] **Step 4: Keep editable text selection and scrolling independent from browser page gestures.**
- [ ] **Step 5: Add visible previous/next controls and `n of total` live page indicator.**
- [ ] **Step 6: Lock browser background scrolling while expanded and restore focus to the originating preview on close.**
- [ ] **Step 7: Test reduced-motion behavior and keyboard Escape.**
- [ ] **Step 8: Commit `feat(workspace): add narrow-browser full-screen document editing`.**

### Task 2.3: Repair section-preview orientation and overflow

**Files:**
- Modify: `apps/web/src/components/organisms/WorkspacePane.module.css`
- Modify: `apps/web/src/app/(app)/workspace/ImportReviewPanel.module.css`
- Modify relevant workspace visual tests.

- [ ] **Step 1: Add layout assertions or screenshot checks for 320px, 375px, 390px, and 430px browser viewports.**
- [ ] **Step 2: Keep section thumbnails in one horizontal strip below the active page in overview mode only.**
- [ ] **Step 3: Ensure each card’s page preview, name, number, and status remain inside the card.**
- [ ] **Step 4: Add scroll snapping and visible partial-next-card affordance without clipping text.**
- [ ] **Step 5: Account for mobile Safari bottom chrome and `safe-area-inset-bottom`.**
- [ ] **Step 6: Commit `fix(workspace): make narrow-browser section navigation predictable`.**

---

## Stage 3: Create one universal web tEdit interaction

### Task 3.1: Proposal state and shared API contract

**Files:**
- Create: `apps/web/src/lib/tedit/types.ts`
- Create: `apps/web/src/hooks/useTEditProposal.ts`
- Create: `apps/web/src/hooks/useTEditProposal.test.ts`
- Reuse existing rewrite/generation API clients rather than creating another model endpoint.

**Interfaces:**
- `TEditScope = "selection" | "section" | "whole-item"`
- `TEditProposal = { original: string; suggested: string; instruction: string; scope: TEditScope }`
- Hook actions: `requestProposal`, `retryProposal`, `applyProposal`, `discardProposal`.

- [ ] **Step 1: Test that requesting a proposal never mutates source content.**
- [ ] **Step 2: Test Apply mutates once, Try again replaces only the proposal, and Discard preserves original content.**
- [ ] **Step 3: Adapt the existing rewrite client to return proposed wording without applying it.**
- [ ] **Step 4: Preserve selection/section scope through retries.**
- [ ] **Step 5: Commit `feat(tedit): add approval-first proposal state`.**

### Task 3.2: Compact TED browser sheet

**Files:**
- Create: `apps/web/src/components/organisms/TEditSheet.tsx`
- Create: `apps/web/src/components/organisms/TEditSheet.module.css`
- Create: `apps/web/src/components/organisms/TEditSheet.test.tsx`
- Modify: `SectionEditor.tsx` and workspace orchestration.

- [ ] **Step 1: Test opening tEdit replaces the contextual toolbar rather than stacking above it.**
- [ ] **Step 2: Render instruction input and scope control with section/selection as the default.**
- [ ] **Step 3: Stream or progressively reveal the suggested text inside a proposal card while leaving original content visible.**
- [ ] **Step 4: Render Apply, Try again, and Discard as the only proposal actions.**
- [ ] **Step 5: Restore focus to the edited section after Apply or Discard.**
- [ ] **Step 6: Test desktop, narrow-browser, keyboard, focus, and axe behavior.**
- [ ] **Step 7: Commit `feat(tedit): add approval-first editing sheet`.**

---

## Stage 4: Web checklists and action plans

### Task 4.1: Put usable work before secondary formats

**Files:**
- Audit and modify the current checklist and action-plan routes/components under `apps/web/src/app/(app)/plans/**` and `apps/web/src/components/organisms/ChecklistLibrary*`.
- Add focused component tests beside the modified work surfaces.

- [ ] **Step 1: Identify the components that currently render alternate formats ahead of checklist or action items.**
- [ ] **Step 2: Write tests that expect progress and actionable items before alternate-format controls.**
- [ ] **Step 3: Move alternate formats and export controls into overflow.**
- [ ] **Step 4: Make item completion and editing available directly on the primary surface.**
- [ ] **Step 5: Commit `refactor(plans): put actionable work first`.**

### Task 4.2: Reuse contextual actions and tEdit

- [ ] **Step 1: Add Expand, Shorten, and tEdit to the selected checklist item or action step.**
- [ ] **Step 2: Reuse `useTEditProposal` and `TEditSheet`; do not create a checklist-only AI editor.**
- [ ] **Step 3: Preserve completion state when item wording changes.**
- [ ] **Step 4: Attach missing-information or quality issues to the exact item.**
- [ ] **Step 5: Run checklist/action-plan interaction tests.**
- [ ] **Step 6: Commit `feat(plans): add contextual item editing`.**

---

## Stage 5: Simplify the web creation workflow

### Target flow

1. Tell TED what you need.
2. Confirm what TED understood.
3. Create the first usable outcome.
4. Review and improve it.
5. Finish and use it.

### Tasks

- [ ] Audit Home, creation entry points, templates, upload, and bespoke document screens.
- [ ] Remove early choices that can be inferred after the user describes the outcome.
- [ ] Replace internal generation language with outcome language.
- [ ] Make the next action visually dominant and keep secondary options behind progressive disclosure.
- [ ] Add route-level tests for document, upload, checklist, and action-plan creation.
- [ ] Commit the creation simplification in independently reviewable slices.

---

## Stage 6: Simplify web navigation and copy

### Primary navigation

- Home
- My work
- Create
- Profile

### Tasks

- [ ] Map existing routes beneath these four user concepts without deleting valid deep links.
- [ ] Replace Document Library, Plans & checklists, and similar database-shaped labels where the user is choosing a destination rather than filtering content.
- [ ] Remove “safe wording,” “generation recovery,” “artifact,” and “alternate output” from user-facing copy.
- [ ] Preserve accessible route names and browser history behavior.
- [ ] Run shell, navigation, axe, and route tests.

---

## Stage 7: Web verification gate

- [ ] Test 320px, 375px, 390px, 430px, tablet, laptop, and wide desktop browser widths.
- [ ] Test portrait and landscape mobile-browser orientation.
- [ ] Test Safari and Chromium browser chrome, safe areas, and virtual keyboard effects.
- [ ] Test keyboard-only operation, focus restoration, Escape behavior, screen-reader names, contrast, and reduced motion.
- [ ] Smoke-test document creation, upload improvement, cover letter, checklist, action plan, section retry, tEdit proposal, sign-in return, save, export, and proofread.
- [ ] Run repository type-check, lint, tests, production build, Edge Function checks, and safety gates.
- [ ] Confirm no `apps/mobile/**` files changed in this PR.
- [ ] Keep the PR draft until the web gate is complete.

---

## Mobile follow-up

Mobile implementation is not part of this branch. After the web pass is integrated, create a fresh mobile branch and mobile-specific plan covering Expo Router, React Native layout, native safe areas, native keyboard handling, iOS/Android back behavior, gestures, VoiceOver, TalkBack, and native build verification. The web implementation may inform the product hierarchy, but its CSS and browser interaction code must not be copied mechanically into the native app.
