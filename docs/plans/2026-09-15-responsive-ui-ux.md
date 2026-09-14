# PrompTED responsive UI/UX implementation plan

Prepared 15 September 2026 from the owner's five-part P1405 guidance. This is a
product-specific implementation plan, not a replacement architecture or agent
instruction file. Source foundation: `Thought-Enhanced-Document@12eb65e`.

## 1. Executive summary

Make PrompTED easier to navigate, read and operate on phones, tablets and
desktop screens while retaining its scarlet, paper and ink branding, existing
document workflow and Supabase persistence authority. Prioritise people who
need help turning their own information into usable documents, including
people using keyboard navigation, larger text or a small phone. Start with
the shared navigation and Master Workspace: opening a menu must not move the
document or leave keyboard focus behind an overlay, and selecting or reopening
an original must have a clear, reachable place in the layout. Keep saving,
original retention, reviewed changes and export status truthful throughout.

## 2. Responsive strategy

Use a mobile-first content layout with content-driven enhancements. Retain the
existing 768px navigation and 900px document-workspace transitions to avoid an
unrelated rewrite of every panel breakpoint. These are complementary rules:

| Width | Navigation and content |
| --- | --- |
| 320–767px | Modal navigation drawer; single content column; normal vertical document flow; full-width essential controls. |
| 768–899px | Desktop navigation rail; stacked workspace panels. Tablet touch users must be able to reveal navigation labels by focus/tap, without requiring hover. |
| 900–1199px | Bounded desktop editor; document remains dominant; secondary panels collapse or move below when their combined minimum widths do not fit. Upload/library pages keep natural-height content inside the main scroll area. |
| 1200–1439px | Document and useful secondary controls may sit side by side. Avoid an empty secondary panel consuming a third of the screen. |
| 1440px+ | Expand workspace tools when useful; cap document reading width rather than stretching prose across the monitor. |

Test 320, 375, 768, 900, 1024, 1440 and 1920px widths, plus 767/768 and 899/900
boundary pairs. Include 568px-high screens, landscape phones, 200% zoom, the
existing large/larger text preference and browser text enlargement.

- Set `min-width: 0` on flex/grid content boundaries; wrap long names and URLs.
  Do not hide horizontal overflow as a substitute for making controls fit.
- Retain `100dvh` ownership at the desktop app shell and editor. Do not give
  every nested upload/library panel a viewport height or a competing scrollbar.
- Keep essential tap targets at least the existing 44px token, with space between
  destructive and ordinary controls. Hover supplies extra feedback, never the
  only way to discover or invoke an action.
- Add safe-area padding at the header and outer mobile content boundaries;
  avoid repeatedly adding the same inset to nested panels.
- Use fluid padding within existing spacing tokens. Keep body and document
  text readable through rem-based preferences; do not shrink text to fit a toolbar.
- Use intrinsic image dimensions and responsive sizes for actual image assets.
  The current text-oriented workspace does not need decorative image downloads.

## 3. Performance blueprint

Targets are **not measured results**. Aim for p75 LCP ≤2.5s, INP ≤200ms and CLS
≤0.1 on representative real devices. Keep the supplied <100ms interaction goal
as a stretch target for local UI responses. Google defines the good INP threshold
as 200ms; a single fast lab run cannot prove real-user performance.
[Web Vitals reference](https://web.dev/articles/vitals?hl=en).

1. Record a production-build baseline for Home, Master Workspace, My Work and
   an opened document: route bytes, requests, LCP, layout shift, menu opening,
   document typing and time until an existing document can be edited.
2. Keep static route shells/server reads in Next.js; use client islands for
   menus, editors and forms. Retain existing lazy loading of heavy editors,
   review tools, history and export code; confirm it in bundle output.
3. Reserve navigation space so revealing labels does not resize document content.
   Prefer short transform/opacity motion; profile before adding `will-change`.
   Persistent layer promotion wastes memory and is not a general speed fix.
4. Use CSS containment only after checking menus, focus outlines, sticky controls
   and resizing. Never contain an element merely to hide its overflowing UI.
5. Keep existing request ownership, cancellation and pagination. Do not replace
   them with a second client cache or fetch every saved document to fill a grid.
6. Keep offline recovery explicitly labelled as local. Network failure must not
   produce a server-saved badge. Do not cache private documents in a service
   worker without a separate privacy, invalidation and ownership design.
7. Run bundle checks after changes. Verify reduced motion and visible loading
   states even when optional chunks or backend requests fail.

## 4. Design system specification

Use `apps/web/src/design-system/tokens.css` and its existing theme consumers as
the source of truth. Continue CSS Modules for scoped layout; reuse shared atoms
instead of adding another UI framework, font system or token file.

- Palette: scarlet `#C8442B`, deep scarlet for accessible actions, paper `#F7F1E7`,
  ink `#2B2521`, sage for confirmed success. Use semantic foreground/background
  tokens so dark mode remains coherent; never communicate state through colour alone.
- Typography: retain the installed Arial/Helvetica/system stack and existing
  text-size preferences. Default body is 1.0625rem; secondary content should use
  the existing label/caption tokens rather than arbitrary very small text.
- Spacing: retain the 4px-derived scale; use 16–24px panel padding and 16–24px
  separation for related workspace regions, tightening through tokens on mobile.
- Corners and elevation: reuse existing radii. Use quiet borders for adjacent
  content, elevation for overlays and menus; avoid a new shadow on every region.
- Motion: use existing 120–180ms navigation feedback, respect reduced motion,
  and avoid moving the document canvas when revealing controls.
- Iconography: use the existing `Icon` component, consistent icon sizes and
  visible action labels. Icon-only buttons need an accessible name and a 44px target.
- States: distinguish ready, selected, disabled, loading, unsaved, failed and
  confirmed saved states through wording as well as styling.

Verify real contrast in both themes. The accessibility target is WCAG 2.2 AA,
meeting the supplied 2.1 AA minimum; do not claim conformance from automated
checks alone.

## 5. UX/UI pattern library plan

| Pattern | PrompTED acceptance requirement |
| --- | --- |
| App navigation | Preserve seven existing destinations and the Create disclosure. Stable desktop rail; mobile focus enters and stays in the open menu; Escape closes Create before the drawer; closing restores a useful focus target. |
| Wayfinding | Preserve active-route labels, useful screen titles and links back to the owning outcome. Avoid duplicate navigation levels without a user task. |
| Master Workspace | Upload affordance, retained-original list and selected-file detail form one readable page. TXT section review and PDF/DOCX original viewing remain distinct. |
| Document editor | Document wording remains primary. On narrow screens, move secondary panels below or behind explicit controls. Keep section title, save state and toolbar reachable without covering prose. |
| My Work | Clear empty/error/loading states, wrapping titles and bounded pagination. Show owner-confirmed server results; preserve stale-response and ownership guards. |
| Forms | Visible labels, appropriate autocomplete/input types, inline actionable errors, preserved user input and a clear retry. Focus the first actionable error after submission. |
| AI review | Keep suggested wording separate from applied changes. Knowledge-summary confirmation, section approval and exact-revision export remain explicit. |
| Loading and failure | Reserve relevant space, explain the operation, allow cancellation where supported, and show the exact safe next step after a timeout or partial save. |

The mobile menu follows the W3C modal interaction pattern: content behind it
is inert, focus remains inside, and closing restores context.
[W3C modal dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

## 6. Technical architecture

Retain Next.js 15, React 19, TypeScript, CSS Modules and existing design tokens.
Supabase remains responsible for authentication, originals, document identity,
revisions and durable state. Do not add Redux, another database or another
provider policy to solve layout problems.

Implementation order and ownership:

1. `AppShell.tsx` and `AppLayout.module.css`: responsive navigation lifetime,
   focus/inert behaviour, stable rail width, viewport and scrolling boundaries.
2. `AppNav.module.css` and `TopBar.module.css`: labels, scrolling of short
   navigation areas, safe-area spacing and account-link target size.
3. Workspace page/CSS Modules: natural upload-page flow, consistent panel edges,
   file-name wrapping and reachable saved files. Keep the three decorative
   section thumbnails in a compact row so they do not enlarge the upload area.
4. Existing `WorkspaceScreen`, `WorkspacePane` and `SectionEditor`: inspect the
   actual populated editor before changing toolbar or panel structure.
5. Existing Home, library, plans, roles and settings components: apply the same
   measured responsive/accessibility checks to their actual workflows.

Keep UI-only verification fixtures outside production routes. A fixture can
prove responsive rendering or focus behaviour; it cannot prove authentication,
upload persistence, model correctness or export fidelity.

## 7. Phased rollout plan

**Phase A — current layout repair:** reproduce mobile focus escape; add meaningful
navigation regression coverage; repair the shell and upload-page layout; verify
the original behaviour remains intact. Preserve the existing visual identity.

**Phase B — populated document workflows:** inspect long and short documents,
section navigation, proofread panel, editable-text import, retained PDF/DOCX,
failed upload/retry and recovery after reload. Fix only observed layout defects.

**Phase C — all main screens:** cover Home/create, My Work, plans/checklists,
roles/profile and account settings at each target width and text size. Standardise
controls through existing atoms/tokens where concrete inconsistencies exist.

**Phase D — measured polish and release:** compare production-build performance
and accessibility against baseline, review light/dark/reduced-motion states,
publish the exact verified revision, then exercise the signed-in hosted workflows.

Record each phase separately as implemented, locally verified, CI verified,
deployed and workflow exercised. Earlier backend upload deployment does not mean
these later layout changes are already live.

## 8. Quality checklist and evidence

- [ ] No horizontal page overflow at every target width, enlarged text and zoom.
- [x] Desktop label expansion does not move the document/content boundary.
- [ ] Mobile drawer focus entry, forward/backward Tab, nested Create, Escape,
      outside click, route change, resize and unmount restore a usable state.
- [x] Long navigation/file names wrap or reveal their full label accessibly.
- [ ] Header and primary actions meet the 44px target; notches/landscape remain usable.
- [ ] Upload area, saved-file list and selected file are reachable without nested
      viewport-height traps; originals retain their existing IDs and wording.
- [ ] Populated editor toolbar, prose and side panels remain usable on phones.
- [ ] Light/dark contrast, keyboard focus, screen reader names and reduced motion checked.
- [x] Relevant regression/integration suites, types, lint, full web suite and production build pass.
- [x] Tracked source and environment files did not change unexpectedly during verification.
- [ ] Performance measured on a production build; field targets kept distinct from lab observations.
- [ ] Signed-in hosted save/reopen/upload/retry/export exercised before making outcome claims.

Current repair evidence is maintained in `.local/verification/layout-20260915/`.
Unchecked items are pending verification or later phases, not implied passes.

The first local component check uses the actual shell, upload and retained-file
components with React 19.2.7 and synthetic account/file data. It showed no page
overflow at 320, 375, 767, 768, 899, 900, 1024, 1440 and 1920px. At 1440px,
the content boundary stayed at 72px while navigation expanded from 72 to 224px;
all navigation labels fit their boxes. Mobile Tab/Shift+Tab, Escape, focus return
and inert background were exercised in Chrome. Light/dark rendering was inspected.
This is component-layout evidence, not a production Next.js workflow or persistence
test. Enlarged text, zoom, assistive-technology and other-browser checks remain open.

`pnpm verify:web` passed on 15 September under Node 22.23.2 and pnpm 10.33.0:
192 deployment-contract tests, 254 repository tests, 547 shared tests and 1,824
web tests, lint, types, Next.js production build and progressive-bundle checks.
The verification snapshot found no changed source files. The build reported
216 kB first-load JavaScript for `/workspace`; this is bundle evidence, not a
measured LCP, INP or production performance result.
