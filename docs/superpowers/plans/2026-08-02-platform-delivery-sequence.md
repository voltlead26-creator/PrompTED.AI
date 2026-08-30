# PrompTED Platform Delivery Sequence

## Decision

The current implementation branch and PR are **web only**.

PrompTED will be delivered in two separate platform passes:

1. Web application
2. Mobile application

The platforms must not be redesigned or implemented in the same PR.

## Why web comes first

Work has already started in `apps/web`, including safe authentication return paths and workspace recovery changes. Finishing that platform first avoids abandoning a partially implemented flow and prevents web CSS, browser interaction patterns, React Native layout patterns, and mobile navigation assumptions from becoming mixed together.

## Web pass

### Scope

- `apps/web/**`
- web-specific tests
- browser accessibility
- responsive browser layouts
- desktop and mobile-browser behavior
- Safari and Chromium validation

### Explicit exclusions

- no changes under `apps/mobile/**`
- no Expo navigation changes
- no React Native component implementation
- no native gesture implementation
- no native safe-area implementation

### Web acceptance gate

The web pass is complete only when:

- the creation workflow is clear on desktop and mobile browsers;
- Master Workspace works at 320px, 375px, 390px, 430px, tablet, laptop, and desktop widths;
- contextual issues replace full-width warning banners;
- global and contextual actions are separated;
- tEdit uses approval-first proposals;
- documents, checklists, and action plans pass browser smoke tests;
- keyboard, screen-reader, focus, touch-target, contrast, and reduced-motion checks pass;
- CI, type-check, lint, tests, and production build pass.

## Mobile pass

The mobile pass begins only after the web PR is approved and integrated normally.

### Branch and PR

Use a new branch and a new draft PR, for example:

`feat/mobile-ai-for-rest-of-us-workflow`

### Scope

- `apps/mobile/**`
- Expo Router navigation
- native safe areas
- native keyboard behavior
- native gestures
- native document and checklist presentation
- iOS and Android testing

### Mobile acceptance gate

The mobile pass is complete only when:

- iOS and Android workflows are designed from native interaction patterns rather than copied browser CSS;
- full-screen editing accounts for native keyboards and safe areas;
- swipe gestures do not interfere with text selection or scrolling;
- platform back behavior is correct;
- VoiceOver and TalkBack labels are meaningful;
- native test and build checks pass.

## Shared-code rule

Changes under `packages/shared/**` or shared Supabase functions are allowed only when they define a true platform-independent contract, such as:

- domain types;
- generation request and response contracts;
- validation rules;
- plain-language issue categories;
- factual-grounding behavior.

Shared code must not contain:

- CSS or browser layout assumptions;
- React Native view assumptions;
- browser-only event handling;
- native gesture handling;
- platform navigation state.

Any shared-code change must be tested independently and must not require simultaneous web and mobile UI changes.

## Execution order

1. Finish Stage 1 for web.
2. Complete web Master Workspace restructuring.
3. Complete web tEdit.
4. Complete web checklist and action-plan surfaces.
5. Complete web creation and navigation simplification.
6. Run the full web acceptance gate.
7. Review and integrate the web PR without force merge.
8. Create the separate mobile branch and mobile implementation plan.
9. Implement and verify mobile independently.

This sequencing is mandatory unless the product owner explicitly changes the platform order.