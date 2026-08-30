# Master Workspace Flagship Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore PrompTED's four flagship application destinations and add a first-class Checklists / Action Plans creation hub with a live interactive manual editor while preserving the existing generated-plan and document pipelines.

**Architecture:** Reuse the existing app shell and canonical routes (`/workspace`, `/library`, `/plans`, `/roles`) instead of creating parallel navigation. Extend the plans surface with creation cards and a local-first manual editor backed by the existing checklist persistence conventions. Extend, rather than replace, `ArtifactActionScreen` for item-scoped editing. Keep all document-generation changes out of this feature and prove non-regression through the five-run document acceptance gate.

**Tech Stack:** Next.js App Router, React, TypeScript, CSS modules, Supabase browser client, existing `@prompted/shared` APIs, existing TED edit pipeline.

## Global Constraints

- Primary navigation order is exactly: Master Workspace, Documents, Checklists / Action Plans, Find a Role.
- `+ Create` is a secondary action, not a fifth primary destination.
- Preserve `/workspace`, `/library`, `/plans`, and `/roles` as canonical routes.
- Do not touch `release/ios-v1-locked`.
- Do not weaken Enhanced DIP, blank-section delivery guards, authentication, export gates, or upload-retention behaviour.
- Manual checklist editing must update only the selected item; no whole-plan AI regeneration for item edits.
- Final acceptance requires 5/5 fresh document-generation runs with zero blank sections and final wording only.

---

### Task 1: Restore flagship application navigation

**Files:**
- Modify: `apps/web/src/components/organisms/AppNav.tsx`
- Modify: `apps/web/src/components/organisms/AppNav.module.css`
- Test: `apps/web/src/components/organisms/AppNav.test.tsx`

**Interfaces:**
- Consumes: `usePathname()`, Next.js `Link`, existing `Icon` component.
- Produces: four primary links and one secondary create menu using canonical routes.

- [ ] **Step 1: Add failing navigation tests**

Create tests that render `AppNav` with mocked pathnames and assert labels and hrefs in exact order: `Master Workspace` → `/workspace`, `Documents` → `/library`, `Checklists / Action Plans` → `/plans`, `Find a Role` → `/roles`. Assert Home/Profile are absent from primary navigation and `+ Create` exposes Document, Checklist / Action Plan, and Upload to Master Workspace.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run the web test command targeted at `AppNav.test.tsx`. Expected: failure because the current nav exposes Home, My work, Create, and Profile.

- [ ] **Step 3: Replace the current NAV_ITEMS and add the secondary create control**

Use:

```ts
const NAV_ITEMS = [
  { href: "/workspace", label: "Master Workspace", icon: "file-pencil" },
  { href: "/library", label: "Documents", icon: "books" },
  { href: "/plans", label: "Checklists / Action Plans", icon: "list-check" },
  { href: "/roles", label: "Find a Role", icon: "briefcase" },
] as const;
```

Add a `<details>`-based create menu below the primary list with links to `/create`, `/plans?create=ted`, and `/workspace`. Use the existing rail expansion/mobile patterns and keyboard-accessible summary/button semantics.

- [ ] **Step 4: Extend CSS without changing the existing rail geometry**

Add styles for a divider, secondary create summary, and menu panel. Desktop labels remain hidden until rail hover/focus. Mobile labels/menu are fully visible.

- [ ] **Step 5: Run the focused navigation tests**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(nav): restore PrompTED flagship destinations`.

---

### Task 2: Turn `/plans` into a flagship creation hub

**Files:**
- Modify: `apps/web/src/app/(app)/plans/page.tsx`
- Create: `apps/web/src/app/(app)/plans/PlansHub.module.css`
- Create: `apps/web/src/app/(app)/plans/PlansCreatePanel.tsx`
- Test: `apps/web/src/app/(app)/plans/PlansCreatePanel.test.tsx`

**Interfaces:**
- Consumes: `ChecklistLibrary`, `WhatsDue`, `useAuth`, Next.js `Link` and `useSearchParams`.
- Produces: three creation entry points and manual-editor mode.

- [ ] **Step 1: Add failing plans-hub tests**

Assert the page exposes three creation actions with exact copy: `Create with TED`, `Create manually`, `Start from template`. Assert query `?create=manual` opens the manual editor and `?create=ted` shows a TED creation prompt/action.

- [ ] **Step 2: Run focused tests and confirm failure**

Expected: existing `/plans` only renders due items and saved checklist library.

- [ ] **Step 3: Implement `PlansCreatePanel`**

Render three cards. `Create with TED` links to `/create` with checklist/action-plan intent in the query string. `Create manually` switches the hub into the manual editor using `?create=manual`. `Start from template` links to `/create?intent=plan-template` so the existing create/browse surface owns catalogue selection.

- [ ] **Step 4: Integrate into `PlansPage`**

Keep `WhatsDue` and `ChecklistLibrary` unchanged below the creation area. Ensure guest messaging remains visible.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat(plans): make plans a flagship creation hub`.

---

### Task 3: Add live interactive manual checklist/action-plan editor

**Files:**
- Create: `apps/web/src/app/(app)/plans/ManualPlanEditor.tsx`
- Create: `apps/web/src/app/(app)/plans/ManualPlanEditor.module.css`
- Create: `apps/web/src/app/(app)/plans/manual-plan-store.ts`
- Test: `apps/web/src/app/(app)/plans/ManualPlanEditor.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, browser `localStorage`, `createClient`, existing `Icon`, existing TED item-edit hook where compatible.
- Produces:

```ts
export interface ManualPlanItem {
  id: string;
  section: string;
  text: string;
  notes: string;
  dueDate: string;
  done: boolean;
}

export interface ManualPlanState {
  id: string;
  title: string;
  items: ManualPlanItem[];
  updatedAt: string;
}
```

- [ ] **Step 1: Add failing editor interaction tests**

Cover initial one-item state, title editing, item text editing, add, delete, move up/down, section label, notes, due date, complete toggle, and persistence callback/local-storage write.

- [ ] **Step 2: Run focused editor tests and confirm failure**

Expected: editor does not exist.

- [ ] **Step 3: Implement pure store helpers**

Implement `createManualPlan`, `normaliseManualPlan`, `moveManualPlanItem`, `loadGuestManualPlan`, and `saveGuestManualPlan`. Empty item text remains editable in the editor but is never treated as a completed/exportable plan step.

- [ ] **Step 4: Implement `ManualPlanEditor`**

Use controlled inputs with immediate local state updates. Add explicit Move up, Move down, Delete, and Complete controls per item. Add section, notes, and due-date fields in a collapsible detail area. Persist after changes using a debounced effect; authenticated persistence may use existing checklist rows only if it can be done without schema changes, otherwise persist this first version under a dedicated local-storage key while the user remains in the editor and clearly label account-sync state.

- [ ] **Step 5: Add item-scoped TED editing**

Reuse `useEditWithTED`. Selection is one item ID. `Expand`, `Shorten`, and `tEdit` operate on `item.text`, show the existing review/apply pattern, and update only that item on apply.

- [ ] **Step 6: Run focused editor tests**

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat(plans): add live interactive manual editor`.

---

### Task 4: Preserve generated-plan behaviour and add deterministic edit controls where missing

**Files:**
- Modify: `apps/web/src/components/organisms/ArtifactActionScreen.tsx`
- Modify: `apps/web/src/components/organisms/ArtifactActionScreen.module.css`
- Test: `apps/web/src/components/organisms/ArtifactActionScreen.test.tsx`

**Interfaces:**
- Consumes: `useArtifact`, `useEditWithTED`, `TedChangeReview`.
- Produces: no API changes; maintains existing action-plan rendering while ensuring item edits are scoped.

- [ ] **Step 1: Add regression tests for generated plans**

Assert completion toggles, selected-item TED editing, review-before-apply, and preservation of non-selected items.

- [ ] **Step 2: Run tests against current implementation**

Record whether current implementation already passes. Only change code for uncovered gaps; do not refactor working behaviour.

- [ ] **Step 3: Add missing deterministic controls only if required by tests**

If generated artifact persistence exposes safe reorder/delete/update APIs, wire them. Otherwise leave generated artifact structure immutable except existing completion and TED text edits; manual structural editing remains in `ManualPlanEditor`.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `test(plans): protect generated interactive plan behaviour` or `feat(plans): complete generated plan editor controls` depending on whether code changes were needed.

---

### Task 5: Navigation and responsive UI audit

**Files:**
- Review: `apps/web/src/app/(app)/AppShell.tsx`
- Review: `apps/web/src/app/(app)/AppLayout.module.css`
- Review/Modify if needed: `apps/web/src/components/organisms/AppNav.module.css`
- Review: `apps/web/src/components/organisms/TopBar.tsx`

**Interfaces:**
- Consumes: current mobile drawer state and focus behaviour.
- Produces: no new public API.

- [ ] **Step 1: Verify desktop and mobile shell behaviour**

Check rail width, expansion, main-content width, backdrop, Escape close, mobile close button, and link click close.

- [ ] **Step 2: Verify accessibility**

Ensure primary nav has `aria-label="Main navigation"`, active link gets `aria-current="page"`, create menu is keyboard reachable, and interactive editor controls have explicit labels.

- [ ] **Step 3: Run lint, type-check, web tests, and production build**

Expected: all green with no new warnings.

- [ ] **Step 4: Commit any audit corrections**

Commit message: `fix(ui): harden flagship navigation responsiveness`.

---

### Task 6: Minimum five-run document non-regression acceptance gate

**Files:**
- Create: `scripts/verify-document-generation-five-runs.mjs` if an existing repeated-generation harness cannot be parameterised.
- Reuse: existing Enhanced DIP/document pipeline test fixtures and Deno tests.
- Test data: use five varied, deterministic document-generation cases, including Resume with missing fields and Resume with uploaded source context.

**Interfaces:**
- Consumes: current document generation pipeline test entry points and Enhanced DIP profile resolver.
- Produces: machine-readable pass/fail output for five independent runs.

- [ ] **Step 1: Define five cases**

At minimum:

1. Resume with complete user facts.
2. Resume with several missing user facts that require declared placeholders/fallbacks.
3. Resume populated from uploaded source context.
4. Cover letter with incomplete recipient/employer facts.
5. A non-employment document profile with missing required facts.

- [ ] **Step 2: Validate every run against the same strict assertions**

For every generated section assert `content.trim().length > 0`. Reject generic scaffold markers, `TBD`, raw `TED_PLACEHOLDER`, instruction-like drafting copy, and undeclared placeholder syntax. Assert declared Enhanced DIP placeholders/fallbacks are accepted. For upload-backed test, assert representative source facts survive into the relevant final wording.

- [ ] **Step 3: Run the full five-case sequence once**

Expected: 5/5. If any case fails, stop, diagnose the failure, fix it on this branch, and restart the count from run 1.

- [ ] **Step 4: Repeat the complete five-case sequence until one fresh sequence is 5/5 after the final code change**

No partial carry-over from before a fix.

- [ ] **Step 5: Run repository verification**

Run type-check, lint, shared tests, web tests, focused Deno tests, migration validation, Edge Function checks, and production build.

- [ ] **Step 6: Commit the acceptance harness/results**

Commit message: `test(document): require five-run no-blank acceptance gate`.

---

### Task 7: Independent review, PR, and landing readiness

**Files:**
- Review all branch changes.

**Interfaces:**
- Produces: draft PR targeting `ClaudeTED.AI`.

- [ ] **Step 1: Run changed-code review and static analysis**

Review for navigation regressions, state-loss risk, accidental whole-plan AI regeneration, unsafe persistence, dead code, accessibility problems, and unrelated changes.

- [ ] **Step 2: Compare branch against `ClaudeTED.AI`**

Confirm only the approved navigation/plans/editor/test/doc files changed.

- [ ] **Step 3: Open a draft PR**

PR body must include design summary, test evidence, exact 5/5 document-generation results, and any known limitations.

- [ ] **Step 4: Do not merge automatically**

Stop at landing readiness unless the user explicitly confirms the exact PR/head SHA.
