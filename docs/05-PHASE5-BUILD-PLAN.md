# Phase 5 — Build Plan

**PrompTED · TED AI · Build Plan Version 1.0 · June 2026**  
**Updated:** Reconciled with Build Routine (`promptedbuildroutine.md`)

> Work one layer at a time. Do not skip layers. Each layer has a clear goal, file list, acceptance criteria, and testing checklist. After each layer: review, test, commit.

### Confirmed deltas from the Build Routine

| Delta | Decision |
|-------|---------|
| **Delta 1 — Home/clarification model** | **Confirmed.** Outcome-first home. When intent is unclear, TED clarifies through a short, warm, adaptive conversation — open questions responsive to the last answer, converging on a recommendation. Not a cold form, not an open chat thread. |
| **Delta 2 — Drag-and-drop section reordering** | **Confirmed — in V1.** Built in Layer 8. The Master Workspace section list supports drag-and-drop reordering (keyboard-accessible equivalent required for AA). Small additive interaction; reinforces user ownership of the result. See FR-007. |
| **Delta 3 — FR-001 ID granularity** | **Confirmed — granular format.** The SRS uses the full per-requirement `FR-001…FR-018` format (not consolidated `FR-1…FR-15`). This is the standard for contractor handover. No rewrite needed; ratified as-is. |
| **Delta 5 — Drag-and-drop file upload on home** | **Confirmed — in V1.** The home "Ask TED" input is also a drag-and-drop dropzone: users can drag a file (PDF, .docx, image) directly onto the home screen to start. Built in Layers 4 (home UI) + 5 (ingest). See FR-001 and FR-009. |
| **Delta 4 — History location** | **Confirmed.** Library model (Recents/Saved/Your Templates in B7b). Not "through chat." |

> **Pragmatic deviation from literal layer order (per Build Routine):** The core database schema
> is stood up in **Layer 1**, not Layer 14. You cannot build the AI gateway (Layer 5) or accounts
> (Layer 12) without a schema. Layer 14 is therefore "complete persistence, autosave, and retention"
> — not the first introduction of a database. This is the Build Routine's explicit instruction.

---

## Layer 1 — Project Setup

### Goal

Establish the monorepo structure (`apps/web`, `apps/mobile`, `packages/shared`), tooling, Supabase project, environment management, CI pipeline, and **base schema scaffolded** (Volume D tables). No UI features in this layer.

### Files to create or edit

```
/package.json                              # Root pnpm/npm workspace config
/apps/web/package.json                     # Next.js web app
/apps/web/next.config.ts                   # Next.js config
/apps/web/tsconfig.json                    # TypeScript strict config
/apps/mobile/package.json                  # Expo app
/apps/mobile/app.json                      # Expo config (bundle ID, App Store ID 6761510921)
/packages/shared/package.json              # Shared types, API client, tokens
/packages/shared/types/index.ts            # Outcome, Document, Section, Template, etc.
/packages/shared/api-client/index.ts       # Typed API call stubs (empty, to be filled)
/.env.example                              # Template: all required env vars, no real values
/.eslintrc.json                            # ESLint: TypeScript + React + jsx-a11y
/.prettierrc                               # Prettier
/vitest.config.ts                          # Vitest (root)
/.github/workflows/ci.yml                  # Lint + type-check + test on every PR
/supabase/config.toml                      # Review and update for local dev
/supabase/migrations/20260608000000_prompted_v1_schema.sql  # Full V1 schema (Phase 3 §3.5)
```

### Components required

None — this layer is tooling and schema only.

### Backend requirements

- Supabase project created: development + staging + production (three separate projects)
- Supabase CLI installed and `supabase start` runs locally
- Edge Functions runtime scaffolded (empty `_shared/` directory)

### Database requirements

**Scaffold the full Volume D schema in this layer** (per Build Routine pragmatic note):
- profiles, businesses, memberships, clari_preferences
- templates, bundles
- outcomes, documents, sections
- uploads, checklist_items
- brand_kits, company_profile
- subscriptions, usage_ledger, audit_logs, export_history
- All RLS policies (even if empty rows — schema first)

Apply via `supabase db push` on the development project.

### API requirements

Scaffold the typed API client stubs in `packages/shared/api-client/`. Functions exist but are empty. They will be filled in Layers 5–6.

### Acceptance criteria

- `pnpm -w run dev` (or equivalent) starts `apps/web` on localhost:3000 without errors
- `pnpm -w run type-check` passes with zero TypeScript errors across all packages
- `pnpm -w run lint` passes with zero errors
- `pnpm -w run test` runs (zero tests is fine at this stage)
- GitHub Actions CI passes on a clean PR
- Supabase migration applies to the local dev DB without errors: `supabase db reset` succeeds
- All 17 Volume D tables present in local DB: `\dt` in psql confirms
- `.env.example` present; `.env.local` in `.gitignore`; zero secrets committed

### Common mistakes to avoid

- Do not put the schema migration in Layer 14 — it must exist now so layers 5–13 have a DB to work with
- Do not use `app/` as the web app directory — the monorepo uses `apps/web/`
- Do not mix `apps/web` dependencies into `apps/mobile` or `packages/shared`
- Do not use `any` TypeScript types — `"strict": true` in all tsconfigs
- Do not commit `.env.local` or any file containing real keys

### Testing checklist

- [ ] Both apps start (`apps/web`, `apps/mobile`) without errors
- [ ] Type-check passes across all packages
- [ ] ESLint passes
- [ ] Vitest runs
- [ ] CI green on a clean clone + install
- [ ] Supabase migration applies cleanly: `supabase db reset` returns no errors
- [ ] All 17 tables present in local DB
- [ ] `.env.local` absent from git history (`git log --all -- .env.local` returns nothing)
- [ ] `.env.example` present with all required variable names

---

## Layer 2 — Design System

### Goal

Build the complete design token system and base component library. Every subsequent layer imports from this system. No ad-hoc styles.

### Files to create or edit

```
/app/src/design-system/
  tokens.css                   # CSS custom properties (colours, type, spacing, shadow, radius)
  tokens.ts                    # TypeScript constants (same values, for JS use)
  fonts.ts                     # Font loading helpers
  
/app/src/components/atoms/
  Button.tsx                   # All variants: primary, ghost, text, danger
  Button.test.tsx
  Input.tsx                    # Text, textarea, date, money, number
  Input.test.tsx
  Badge.tsx                    # Status: draft, edited, approved, locked, done, in_progress
  Icon.tsx                     # Tabler icon wrapper
  Avatar.tsx
  Chip.tsx                     # Example chips, domain chips
  ProgressBar.tsx
  Spinner.tsx                  # Always with label prop
  Divider.tsx
  Toast.tsx                    # + ToastProvider
  Tooltip.tsx

/app/src/components/atoms/index.ts  # Re-export all atoms
/app/globals.css               # Base styles: reset, font-face, body, :root tokens
```

### Components required

All atoms listed above.

### Acceptance criteria

- All atoms render in isolation (Storybook or visual test)
- All atoms pass WCAG AA contrast check (automated via axe-core or jest-axe)
- All interactive atoms have keyboard focus states (visible outline)
- Spinner always has an accompanying text label
- Badge always uses colour + icon + text (never colour alone)
- All type sizes ≥17pt for body content
- Button minimum touch target 44×44pt (min-height/min-width enforced in CSS)
- All tokens reference the CSS custom properties, not hardcoded values

### Common mistakes to avoid

- Do not define colours inline — always reference token
- Do not use `px` units for font sizes — use `rem` (1rem = 16px; 17pt ≈ 22.67px ≈ 1.42rem)
- Do not add `disabled` without also adding `aria-disabled`
- Do not make `Spinner` the only visual feedback — always pair with text

### Testing checklist

- [ ] axe-core passes on all atom components
- [ ] Colour contrast: cream `#F6F0E6` + charcoal `#26211C` ≥ 7:1 ✓
- [ ] Colour contrast: coral `#DC5430` + white ≥ 4.5:1 (check this — may need text on coral)
- [ ] All font sizes ≥1.42rem (17pt)
- [ ] Focus visible on all interactive elements
- [ ] Keyboard navigation: Tab through all atoms in order
- [ ] Reduced motion: animations disabled when `prefers-reduced-motion: reduce`

---

## Layer 3 — App Shell and Routing

### Goal

Build the app skeleton: navigation structure, layout wrappers, route definitions, provider tree, and auth-aware rendering. No real data yet.

### Files to create or edit

```
/app/src/app/
  layout.tsx                   # Root: fonts, providers, theme, metadata
  (app)/layout.tsx             # Authenticated app layout: side nav (web) / bottom tabs (mobile)
  (app)/home/page.tsx          # Placeholder: "Home"
  (app)/library/page.tsx       # Placeholder: "Library"
  (app)/settings/page.tsx      # Placeholder: "Settings"
  (app)/outcomes/[id]/page.tsx # Placeholder: "Outcome"
  (auth)/sign-in/page.tsx      # Placeholder: "Sign in"
  (auth)/sign-up/page.tsx      # Placeholder: "Sign up"

/app/src/components/providers/
  QueryClientProvider.tsx      # TanStack Query
  AuthProvider.tsx             # Supabase session context
  ThemeProvider.tsx            # Light/dark theme toggle

/app/src/components/organisms/
  AppNav.tsx                   # Side nav (web) + bottom tabs (mobile)
  TopBar.tsx                   # Logo + auth state (sign in / avatar)

/app/src/lib/supabase/
  client.ts                    # Browser Supabase client
  server.ts                    # Server Supabase client (for Next.js server components)
  middleware.ts                # Session refresh middleware (next/middleware.ts)

/app/src/types/
  index.ts                     # Shared TypeScript types (Outcome, Document, Section, etc.)

/app/middleware.ts              # Next.js middleware: session refresh
```

### Backend requirements

- Supabase project URL and anon key in `.env.local`
- Supabase Auth configured (email + Google OAuth)

### Acceptance criteria

- Navigating to each route renders the placeholder without error
- Auth state is accessible via `useAuth()` hook in any component
- Unauthenticated users are not redirected — they see the app with a "Sign in" CTA in the top bar
- Session persists across page refreshes
- Bottom tabs on mobile, side nav on desktop (CSS media query)
- Navigation passes axe-core (nav landmark, aria-current on active tab)

### Common mistakes to avoid

- Do not use client-side redirect for all unauthenticated users — PrompTED allows anonymous browsing (FR-012)
- Do not store the Supabase session in localStorage manually — Supabase client handles this
- Do not use `useRouter().push()` for auth redirects inside providers — use middleware

### Testing checklist

- [ ] All routes render without console errors
- [ ] Sign in / sign out cycle works
- [ ] Session persists on page refresh
- [ ] Bottom nav on mobile, side nav on desktop
- [ ] Screen reader: nav has role="navigation", active item has aria-current="page"

---

## Layer 4 — Home / Outcome Input

### Goal

Build the outcome-first Home screen (B5) — single input, photo attach, **drag-and-drop file dropzone** (Delta 5, confirmed), example chips, "Jump back in" fast lane — **plus the chat-responsive clarification layer** (Delta 1, confirmed). No AI calls yet (those wire in Layer 6), but the UI for both the input and the clarification conversation must be built here.

### Files to create or edit

```
/apps/web/src/components/organisms/
  ChatInput.tsx               # Textarea + attach + example chips + send
  ExampleChips.tsx            # Rotating domain chips + Browse chip
  FastLane.tsx                # Recents + Saved + Your Templates strip
  ChatResponsiveClarify.tsx   # Warm adaptive clarification conversation UI (NEW)

/apps/web/src/app/(app)/home/page.tsx   # Complete home screen

/apps/web/src/hooks/
  useFileAttachment.ts        # File picker + drag-and-drop, validation, attachment state
  useDropzone.ts              # Home dropzone: drag-over affordance, drop handling (NEW)

/packages/shared/
  example-chips.ts            # Static chip data (3 domains, rotating 5–8)
```

### The clarification model (Delta 1 — confirmed)

When TED needs more to understand the intent, it does **not** show a static form of closed questions. It opens a short, warm, adaptive conversation:

- Each message is a single open question, phrased like a capable, friendly helper
- Each question is responsive to what the user just said — not pre-scripted
- The conversation has a clear purpose: converge on the recommendation as quickly as possible
- **No fixed exchange cap.** TED keeps clarifying until it genuinely understands the
  intent, then commits to a recommendation. Convergence is driven by understanding —
  the orchestration layer's "intent clear" signal — not by a turn counter. A hard cap
  would turn the conversation into a disguised two-step form, which defeats the purpose.
  (Supersedes the earlier "2 exchanges" cap — owner decision, June 2026.)
- The thread **never becomes an open-ended chat** — it still has a defined end state
  (the recommendation checkpoint), and no "keep chatting" affordance
- Visually: uses the same chat bubble style as the main input (not a form, not a modal)

The `ChatResponsiveClarify` component holds this conversation state. It receives messages from the orchestration layer (Layer 6) and renders them as a thread above the input.

### Acceptance criteria

- Headline: "What are you trying to achieve?"
- Subline: "Tell TED what's going on — TED works out what you need."
- Input: `<textarea>` (auto-resizes), placeholder "Ask TED"
- Attach opens file picker: PDF, Word, JPEG, PNG, HEIC, ≤20MB
- Photo button opens camera on iOS (PHPicker)
- **Drag-and-drop:** dragging a file anywhere over the home input area shows a clear drop-target affordance ("Drop to add as context"); dropping a valid file attaches it; the attach control remains as the non-drag (and screen-reader/keyboard) equivalent
- Drag-and-drop validates the same types/size as the picker; invalid drops show a plain message, not a technical error
- Attached file shows as a chip with × remove below input
- Example chips: 3–5 visible, horizontal scroll; tapping fills input
- Browse chip opens searchable categorised list (placeholder modal for now)
- Fast lane: hidden for first-time users; visible for users with >0 outcomes
- Send button: coral pill, "Ask TED →", disabled when input and attachment are both empty
- **Clarification UI:** if AI returns a clarifying question, it renders as a warm TED bubble above the input; user replies in the same input box; the UI transitions to the recommendation checkpoint automatically once TED's "intent clear" signal arrives (no fixed exchange count)
- Clarification conversation does not have a "keep chatting" affordance — it ends when TED commits
- Enter submits (desktop); Return submits (iOS keyboard "Send" key); Shift+Enter = newline

### Common mistakes to avoid

- Do not build the clarification as a form with labelled fields — it must feel conversational
- Do not impose a fixed exchange cap — let TED converge on understanding; capping turns it into a disguised form
- Do not let the clarification conversation become an open thread — it has a defined end state (the recommendation checkpoint), even without a turn cap
- Do not lose the original typed message when clarification starts
- Do not auto-submit on file attach
- Do not expose MIME type errors as technical messages

### Testing checklist

- [ ] Textarea auto-resizes; send disabled when empty
- [ ] File attach: PDF/Word/JPEG accepted; .exe rejected with plain message
- [ ] File >20MB: plain error shown
- [ ] Drag a file over home: drop-target affordance appears; dropping attaches it
- [ ] Drag an invalid file type: plain message, no attach
- [ ] Attach control works without drag (keyboard + screen reader)
- [ ] Example chip: tap fills input, does not auto-submit
- [ ] Browse chip: opens modal
- [ ] Fast lane: hidden for new users, visible when outcomes exist
- [ ] Clarification: first exchange renders as warm TED bubble
- [ ] Clarification: an unbounded thread of exchanges renders correctly (no turn cap)
- [ ] Clarification: transition to recommendation checkpoint is automatic when intent is clear (no user action needed)
- [ ] Screen reader: textarea labelled "What are you trying to achieve?", send button labelled "Ask TED"

---

## Layer 5 — AI Gateway

### Goal

Build the provider-agnostic AI gateway in the Edge Functions. Extend the existing `openai-proxy.ts` into a full `provider-router.ts` that supports OpenAI, Anthropic, and Google. Add auth-guard and rate-limiting middleware.

### Files to create or edit

```
/supabase/functions/_shared/
  provider-router.ts          # NEW: unified router for all three providers
  auth-guard.ts               # NEW: JWT validation + plan check + usage check
  cost-tracker.ts             # NEW: log AI token usage per provider
  prompt-builder.ts           # NEW: assemble system prompts
  template-engine.ts          # NEW: load template + apply pre-fill
  (openai-proxy.ts retained for reference, calls migrated to provider-router)

/supabase/functions/research/
  index.ts                    # Web search (extend existing live-source)
```

### Backend requirements

- `OPENAI_API_KEY` in Supabase secrets (existing)
- `ANTHROPIC_API_KEY` in Supabase secrets (existing)
- `GOOGLE_AI_API_KEY` added to Supabase secrets
- `PROVIDER_ROUTING_MAP` in Supabase secrets (JSON: task → provider)

### Acceptance criteria

- A POST to any AI endpoint with a valid JWT routes to the correct provider per the routing map
- If primary provider returns 429 or 5xx, request is retried with the fallback provider automatically
- If all providers fail, response includes `{ error: { user_message: "TED hit a small snag..." } }`
- No provider names appear in the response or in client-visible error messages
- Auth-guard rejects unauthenticated requests to protected endpoints with 401
- Auth-guard rejects requests over plan cap with 402 (+ paywall trigger payload)
- Rate limiting: 60 requests/minute per user for chat; 10/minute for document generation
- AI token usage is logged per call (for cost monitoring, not document content)

### Common mistakes to avoid

- Do not store the routing map in code — it must be in configuration (env var or Supabase secret)
- Do not log prompt content or document content in any function
- Do not expose the provider-selection decision to the client
- Do not retry indefinitely — max 2 fallback attempts, then return the user-safe error

### Testing checklist

- [ ] OpenAI call succeeds with valid key
- [ ] Anthropic call succeeds with valid key
- [ ] Google AI call succeeds with valid key
- [ ] Fallback triggers on 429 (mock primary to return 429)
- [ ] All providers fail → user-safe error message returned
- [ ] Unauthenticated request → 401
- [ ] Over cap request → 402 with paywall payload
- [ ] No provider name in any response body or error message
- [ ] No document content in Supabase logs

---

## Layer 6 — Prompt Orchestration

### Goal

Build the intent interpretation → recommendation → clarification → generation pipeline as Edge Functions. Wire these to the AI gateway.

### Files to create or edit

```
/supabase/functions/
  interpret-intent/index.ts    # Domain + situation + confidence
  recommend/index.ts           # Primary + 2 variants
  clarify/index.ts             # Adaptive clarification loop (no fixed cap; ends on "intent clear")
  generate-document/index.ts   # Streaming document generation
  generate-report/index.ts     # Analytical report from uploads
  generate-checklist/index.ts  # Research-backed checklist

/supabase/functions/_shared/
  prompt-builder.ts            # System prompts for each task type (complete)
  domain-intelligence.ts       # Domain packs: employment, business, finance, education, personal
  advice-boundaries.ts         # Tiered disclaimer logic
```

### Acceptance criteria

- `interpret-intent` returns domain, situation, confidence (0.0–1.0) for 10 test inputs
- `clarify`: asks one adaptive question at a time and commits to a recommendation as soon as confidence is sufficient (no fixed question count); returns `intent_clear` + recommendation when done
- `recommend`: returns primary + exactly 2 variants, each with `name`, `format`, `use_case`, `benefits[]`
- `generate-document`: streams section content; first chunk arrives within 2 seconds
- `generate-document`: all section names match the template schema; no improvised sections
- `generate-document`: pre-filled fields in the output match the test profile data
- `generate-document`: no fabricated data in financial sections (review pass validates)
- `generate-checklist`: returns items grounded in web search results, each with `text`, `due_date`, `reason`
- High-stakes template: advice boundary notice is present in system prompt and output

### Common mistakes to avoid

- Do not allow the AI to invent template sections — pass the exact section list in the system prompt
- Do not ask clarifying questions in `generate-document` — all clarification is done before this point
- Do not fabricate job titles, names, dates, or figures in document output — validate in review pass
- Do not stream JSON without a delimiter — use `\n` separated JSON events for SSE

### Testing checklist

- [ ] 10 varied inputs → correct domain classification for ≥9
- [ ] Clarification: commits to a recommendation once intent is clear (no fixed question count); never loops indefinitely on a cooperative user
- [ ] Recommendation: always 1 primary + 2 variants
- [ ] Document generation: sections match template exactly
- [ ] Streaming: first token <2s on standard connection
- [ ] High-stakes template: disclaimer text present in output
- [ ] No fabricated figures in financial document test case
- [ ] Checklist items have `due_date` and `reason` fields populated

---

## Layer 7 — Output Selection Logic

### Goal

Build the recommendation checkpoint UI: the summary card, three-card variant picker, photo confirmation flow, and bundle selection. Wire to the intent interpretation and recommendation Edge Functions.

### Files to create or edit

```
/app/src/components/organisms/
  SummaryCard.tsx              # What TED understood + recommended outputs
  RecommendationCardGroup.tsx  # Primary + 2 variant recommendation cards
  PhotoConfirmation.tsx        # "What TED read from your photo" confirmation step
  BundleSelector.tsx           # Bundle checklist: generate/skip per item

/app/src/app/(app)/outcomes/[id]/page.tsx  # Full recommendation checkpoint screen

/app/src/hooks/
  useOutcome.ts                # CRUD for outcome: create, update, confirm recommendation
  useInterpretIntent.ts        # Call interpret-intent + recommend
  useRecommendation.ts         # State management for recommendation + confirmation

/app/src/lib/api/
  interpret-intent.ts          # Typed API call
  recommend.ts                 # Typed API call
```

### Acceptance criteria

- After submitting home input, summary card appears (no draft content shown yet)
- Summary card shows: "What TED understood" (1–2 sentences), recommended outputs with reasons
- When document type is ambiguous: 3-card layout (primary full-width + 2 variants side by side)
- Each card shows: document name, use-case scenario, bullet benefits
- "Confirm" creates the outcome record and proceeds to generation
- "Adjust" allows add/remove document, edit the understood situation inline
- "Add detail" shows a text input for additional context
- Photo confirmation step: if photo attached, summary card first shows extracted text for confirmation
- Confirming a bundle recommendation shows the bundle screen with generate/skip per item
- Back navigation returns to home screen; unconfirmed drafts are discarded

### Common mistakes to avoid

- Do not generate any content before the user confirms — the recommendation is the gate
- Do not show all variants as equals — the primary card must be visually distinct
- Do not use a dropdown for variant selection — all three cards must be visible
- Do not allow confirmation of a recommendation if required fields are missing from the profile (prompt for them inline)

### Testing checklist

- [ ] Summary card always appears before generation
- [ ] Three-card layout renders: primary visually distinguished (coral accent, "TED recommends" label)
- [ ] Selecting a variant proceeds to generation with that variant's template_id
- [ ] "Adjust" removes a document from the recommendation list
- [ ] Photo flow: extracted text shown on summary card before any generation
- [ ] Bundle: all bundle items listed; Skip removes from queue without error
- [ ] Back from summary card → home screen, no partial draft created

---

## Layer 8 — Master Workspace

### Goal

Build the three-pane Master Workspace for desktop and stacked/tab view for mobile. Section list, approval workflow, export gate, and **drag-and-drop section reordering** (Delta 2, confirmed) with a keyboard/ARIA-accessible equivalent.

### Files to create or edit

```
/app/src/components/organisms/
  WorkspacePane.tsx            # Three-pane layout container
  SectionList.tsx              # Left pane: section cards + approval counter + export button
  SectionListItem.tsx          # Individual section in the list: name, status badge, actions
  LivePreview.tsx              # Right pane: styled document render with brand kit

/app/src/app/(app)/outcomes/[id]/workspace/page.tsx  # Workspace screen

/app/src/hooks/
  useWorkspace.ts              # Section state management, approval counter
  useDocument.ts               # Document CRUD + status management
  useSection.ts                # Section CRUD, status transitions, version history
  useSectionReorder.ts         # Drag-and-drop + keyboard reorder; persists order_index (NEW)
  useAutosave.ts               # Debounced autosave (500ms) for section content

/app/src/lib/api/
  sections.ts                  # Supabase CRUD for sections
  documents.ts                 # Supabase CRUD for documents
```

### Acceptance criteria

- Three-pane layout on ≥1024px: section list (240px) | editor (flex) | preview (320px)
- Mobile: three tabs (Sections | Editor | Preview), Sections default
- Section list shows all sections with status badge and approval counter ("2 of 5 sections approved")
- Export button: disabled ("Approve all sections to export") until all required sections = 'approved'
- Export button: enabled (coral, "Export PDF") when all required sections approved
- Approve button per section: transitions status draft/edited → approved
- Section status change is persisted to DB within 500ms
- **Reordering:** sections can be reordered by drag-and-drop in the section list; new order persists to `sections.order_index` and is reflected in the preview and on export
- **Reordering (a11y):** a keyboard/ARIA equivalent (move up / move down, or grab-and-drop) provides the same capability — drag is never the only path
- Locked sections cannot be reordered until unlocked
- Autosave: content changes are saved within 500ms
- LivePreview updates on every section content change (optimistic, from local state)
- Brand kit is applied in LivePreview if business account (logo, primary colour, footer)

### Common mistakes to avoid

- Do not render the export button active until all REQUIRED sections are approved (not all sections — some may be optional)
- Do not re-fetch all sections on every autosave — update the local cache optimistically
- Do not build the preview as a PDF render — it is a styled HTML preview only (PDF render is on export)
- Do not lock approved sections from editing — the user can un-approve and re-edit
- Do not ship drag-and-drop reordering without the keyboard/ARIA equivalent — that fails AA
- Do not reorder by rewriting every row's content — reindex `order_index` only, in one transaction

### Testing checklist

- [ ] Three panes on desktop, three tabs on mobile
- [ ] Approval counter accurate (counts only approved sections)
- [ ] Export gate: disabled before all approved, enabled after
- [ ] Autosave triggers 500ms after last change; content visible in DB
- [ ] Brand kit in preview: logo visible, primary colour on headings, footer text present
- [ ] Section status badge updates immediately on approve
- [ ] Approval survives page refresh (persisted to DB)
- [ ] Drag a section to a new position: order updates, persists, survives refresh
- [ ] Keyboard reorder (move up/down) works without a mouse
- [ ] New section order is reflected in the preview and on export
- [ ] Locked section cannot be reordered

---

## Layer 9 — Section Editor

### Goal

Build the full section editor with Tiptap rich text, "Edit with TED" AI panel, version history, and streaming AI edits.

### Files to create or edit

```
/app/src/components/organisms/
  SectionEditor.tsx            # Full section editor (centre pane)
  EditWithTED.tsx              # AI editing action panel (streaming)
  VersionHistory.tsx           # Version history modal/panel

/app/src/hooks/
  useEditWithTED.ts            # Call edit-section API, handle streaming
  useVersionHistory.ts         # Version restore logic

/supabase/functions/edit-section/index.ts  # Edit section Edge Function (complete)
```

### Acceptance criteria

- Tiptap editor: bold, italic, H2, H3, bullet list, numbered list
- All Tiptap toolbar items work; output is clean HTML stored in `sections.content`
- "Edit with TED" button: appears in the footer bar; clicking expands the panel (does not auto-appear)
- Five actions: Improve, Shorten, Expand, Change tone, Add detail
- AI edit streams into the editor (replaces current content as tokens arrive)
- While streaming: editor is read-only; "Cancel" button stops the stream and restores previous content
- After AI edit: section status → 'edited'; a version is added to `version_history`
- "History" button: shows a list of previous versions with timestamps; clicking a version shows its content; "Restore" replaces current content and creates a new version entry
- Selecting a text range in the editor and clicking "Edit with TED" enables edit-selection mode (action applied only to selected text)
- Section editor passes axe-core (contenteditable with proper ARIA roles)

### Common mistakes to avoid

- Do not stream directly into the Tiptap editor's DOM — build the content string from chunks, then apply as a transaction at the end (or use a streaming-optimised approach like inserting tokens as text nodes)
- Do not store raw HTML from untrusted sources without sanitisation — use DOMPurify before storing to DB
- Do not show "Edit with TED" as the primary action — manual editing must always be easier
- Do not delete version history on section approve — always preserve history

### Testing checklist

- [ ] Tiptap toolbar: all 6 format actions work
- [ ] Edit with TED panel hidden until button tapped/clicked
- [ ] Streaming: AI edit tokens appear in editor in real time
- [ ] Cancel mid-stream: editor restores to pre-edit content
- [ ] Version history: 3 versions created, all accessible, restore works
- [ ] Edit selection: only selected text is modified by AI action
- [ ] Section status → 'edited' after any edit (manual or AI)
- [ ] Screen reader: editor has role="textbox" + aria-label + aria-multiline

---

## Layer 10 — Document Templates

### Goal

Author all 22 V1 templates as database seed records. This is primarily a content deliverable. Templates must be complete, accurate, and production-ready before the app launches.

### Files to create or edit

```
/supabase/seed/templates.sql   # All 22 templates as INSERT statements
/supabase/seed/bundles.sql     # 4 V1 bundles

/app/src/types/template.ts     # TypeScript type definitions matching DB schema
/app/src/lib/templates/
  index.ts                     # Client-side template utilities
  pre-fill.ts                  # fillFromProfile mapping logic
  derived-fields.ts            # Computed field logic (e.g. job duration)
```

### Template schema per record

Each template record includes:
- `name`: e.g. "Resume"
- `domain`: "employment"
- `category`: "Job application"
- `plain_description`: One sentence plain English description
- `structure_type`: "compose" | "structured_form" | "checklist"
- `sections`: JSON array of `{ name: string, description: string, is_required: boolean, order: number }`
- `fields`: JSON array of `{ name, type, label, placeholder, fillFromProfile?, required, options? }`
- `missing_detail_rules`: JSON array of `{ field, reason, is_required: bool }`
- `fill_from_profile`: JSON object mapping template fields to profile fields
- `recommendation_reason`: One-line reason shown on summary card
- `related_document_ids`: Array of template IDs commonly needed alongside this one
- `advice_boundary`: "none" | "light" | "high-stakes"
- `brandable`: bool
- `display_order`: integer

### Template count

> **Note:** The Build Routine references a `prompted-template-library.md` document as the
> authoritative template library. The SRS Appendix 1 lists ~22 launch templates. If the template
> library document specifies a different count (e.g. 33), that document wins for template content.
> The list below is from Appendix 1; reconcile against the template library before seeding.

**Employment (8):**
1. Resume (structured_form, compose sections: Summary, Experience, Education, Skills)
2. Cover Letter (compose)
3. Job-search Action Checklist (checklist)
4. Interview Preparation Questions (compose)
5. Interview Script (compose)
6. Job Follow-up Email (compose, light advice boundary)
7. Pay-rise Request + Conversation Script (compose)
8. Promotion Case (compose)

**Education (3):**
9. Personal Statement (compose)
10. Application/Cover Letter — Education (compose)
11. Reference Request (compose)

**Business (10):**
12. Business Email (compose)
13. Workplace Policy (compose, light advice boundary)
14. Standard Operating Procedure (compose)
15. Offer Letter (compose, high-stakes advice boundary)
16. Terms of Employment (compose, high-stakes advice boundary)
17. Induction Manual (compose)
18. Onboarding Checklist (checklist)
19. Performance Review (compose, light advice boundary)
20. Meeting Minutes / Briefing (compose)
21. Service Agreement (compose, high-stakes advice boundary)
22. Proposal (compose)

**Finance (1):**
23. Budget Workbook (structured_form, Excel export only)

**4 Bundles:**
1. "I need a job" → templates 1,2,3,4,5,6 + Budget Workbook
2. "Onboard a new employee" → templates 15,16,17,18,12
3. "Set up the basics of my business" → templates 13,14,19,12
4. "I'm applying" → templates 9,10,11

### Acceptance criteria

- All 22 templates inserted into the `templates` table via seed migration
- Template QA: each template generates a structurally correct document (manual review)
- Pre-fill mapping: test profile data → correct fields populated
- Advice boundaries: offer letter, terms, service agreement, performance review show correct boundary tier
- Budget Workbook: structured_form with all income/expense/savings/debt fields; export_format = 'excel'
- `display_order` correctly sequences templates within domain

### Common mistakes to avoid

- Do not create vague section names ("Section 1", "Content") — every section must have a specific, descriptive name (e.g. "Employment History", "Key Responsibilities")
- Do not make all fields required — respect the `missing_detail_rules` to know what is optional
- Do not include legal citations in the template structure — templates are general, not legal advice
- Do not use the same sections for different templates — each template's sections are bespoke

### Testing checklist

- [ ] All 22 templates inserted without error
- [ ] 4 bundles inserted with correct template_ids
- [ ] Manual review: generate one document from each template, verify structure
- [ ] Pre-fill test: profile with name/business/job → correct fields auto-populated
- [ ] Advice boundary: offer letter shows high-stakes notice, email shows none
- [ ] Budget Workbook: structured_form verified; all fields present

---

## Layer 11 — Export System

### Goal

Build the PDF, Word, and Excel export pipeline as a server-side Edge Function.

### Files to create or edit

```
/supabase/functions/render-export/
  index.ts                    # Main export function
  pdf-renderer.ts             # PDF generation (Puppeteer or PDFKit)
  word-renderer.ts            # Word generation (docx library)
  excel-renderer.ts           # Excel generation (exceljs, Budget Workbook only)
  brand-kit-applier.ts        # Apply logo, colours, footer to document
  chart-renderer.ts           # Fetch chart PNG from QuickChart, embed
  html-template.ts            # HTML template for PDF render
```

### Acceptance criteria

- PDF export: professional formatting, correct sections, brand kit applied
- PDF: approved sections only; unapproved sections never appear in export
- Word: equivalent structure to PDF; opens correctly in Microsoft Word and Google Docs
- Excel (Budget Workbook): formula cells protected; input cells editable; dashboard sheet present
- Chart rendering: bar, line, pie charts correctly embedded from chart spec + user data
- Bundle export: combined PDF with cover page + all documents; ZIP file with individual files
- Export completes within 30 seconds for a standard single document
- A record is inserted in `export_history` on every successful export
- Export endpoint rejects requests where not all required sections are 'approved'

### Common mistakes to avoid

- Do not attempt client-side PDF rendering — always server-side
- Do not include section content in export if status ≠ 'approved' (double-check in the Edge Function, not just the UI)
- Do not embed base64 logo inline in HTML if it's large — fetch from Storage URL during render
- Do not use Puppeteer if Edge Function memory limits are hit — fall back to PDFKit

### Testing checklist

- [ ] PDF export: correct content, correct sections, brand kit applied
- [ ] PDF export: unapproved section content NOT present
- [ ] Word export: opens in MS Word without errors
- [ ] Excel export: formula cells locked; input cells editable
- [ ] Chart PNG embedded in PDF and Word
- [ ] Bundle export: combined PDF and ZIP generated
- [ ] Export rejects request if sections not all approved (API returns 400)
- [ ] export_history record created on success

---

## Layer 12 — User Accounts and Monetisation

### Goal

Build the full auth flow (sign in, sign up, anonymous-to-authenticated migration, Sign in with Apple), user profile, business profile, brand kit editor, and subscription/entitlement enforcement.

### Files to create or edit

```
/app/src/app/(auth)/
  sign-in/page.tsx             # Sign in form + Google OAuth + Apple Sign In
  sign-up/page.tsx             # Sign up form
  callback/page.tsx            # OAuth callback handler

/app/src/app/(app)/settings/
  page.tsx                     # Settings layout
  profile/page.tsx             # User profile editor
  business/page.tsx            # Business profile + brand kit editor
  subscription/page.tsx        # Plan, usage, upgrade

/app/src/components/organisms/
  AuthModal.tsx                # Triggered at save/export
  OnboardingModal.tsx          # First-time: TED intro + AI disclosure + consent
  BrandKitEditor.tsx           # Logo, colours, footer editor
  PaywallModal.tsx             # Plan comparison, upgrade CTA
  SubscriptionPlan.tsx         # Current plan + usage meter

/supabase/functions/
  webhooks/revenuecat/index.ts # RevenueCat webhook → subscriptions sync
  account-delete/index.ts      # Cascading account deletion

/app/src/lib/
  revenuecat.ts                # RevenueCat SDK integration (web)
  usage.ts                     # Check usage ledger, determine if at cap
```

### Acceptance criteria

- New user: anonymous session → draft → workspace → save → AuthModal → sign up → work migrated
- Sign in with Apple available on iOS (Supabase Apple OAuth)
- Onboarding modal: shown once per user, includes AI disclosure, Accept button required before proceeding
- Business profile: trading name, legal name, ABN, address, phone, email, website, voice
- Brand kit: logo upload (image → Supabase Storage), primary colour picker, footer text
- Brand kit live preview in workspace (FR-010)
- Subscription: plan shown in Settings; usage meter shows docs used / cap
- RevenueCat webhook updates `subscriptions` within 60 seconds of payment event
- Paywall modal: shown at cap, not before; "See plans" / "Not now" options
- Account deletion: Settings → Delete account → confirm → all user data deleted within 24 hours

### Common mistakes to avoid

- Do not gate the app behind sign-up — anonymous session must work for the full core loop
- Do not lose anonymous session work on sign-up — migrate via `supabase.auth.linkIdentity()` or equivalent
- Do not show the paywall before the user has a completed draft
- Do not implement IAP pricing in the web app on iOS (anti-steering rule)
- Do not hardcode plan prices — read from RevenueCat configuration

### Testing checklist

- [ ] Anonymous session: full loop to workspace without auth
- [ ] AuthModal: appears at save/export, not before
- [ ] Work migration: outcome created in anonymous session visible after sign up
- [ ] Apple Sign In: available on iOS
- [ ] Onboarding modal: shown once, AI disclosure present
- [ ] Brand kit: logo uploads, colour saves, preview updates
- [ ] Subscription: plan displays correctly; usage meter accurate
- [ ] RevenueCat webhook: plan update reflected in UI within 60 seconds
- [ ] Account deletion: all user rows deleted; sign-in returns 404 for that user

---

## Layer 13 — Project History (Library)

### Goal

Build the Library screen: recents, saved, your templates, what's-due, and the checklist/action plan screen.

### Files to create or edit

```
/app/src/app/(app)/library/page.tsx    # Library screen

/app/src/components/organisms/
  LibraryList.tsx                      # Recents/Saved/Templates tabs + DocumentCard list
  WhatsDue.tsx                         # Upcoming checklist deadlines panel
  ChecklistScreen.tsx                  # Full checklist/action plan view (B7a)

/app/src/hooks/
  useLibrary.ts                        # Fetch outcomes, documents, saved/templates
  useChecklist.ts                      # Checklist CRUD, tick/untick, progress
  useReminders.ts                      # Push notification scheduling for due dates
```

### Acceptance criteria

- Library shows all user outcomes, most recent first
- Status chip derived from section/outcome data (no separate engine)
- "What's due" panel shows checklist items with `due_date` within 14 days, sorted ascending
- Tapping any item resumes the exact outcome state (workspace at last-edited section)
- Saved toggle: tapping bookmark icon on a DocumentCard toggles `outcomes.is_saved`
- Your Templates tab: shows `documents.is_template = true` documents
- Checklist screen: grouped by timing, progress bar, expandable reasons, ticking persists
- Reminders: tapping bell icon on a checklist item schedules a push notification
- Checklist export: "Download" exports checklist as printable PDF with checkboxes

### Common mistakes to avoid

- Do not build a separate tracking engine — derive all status from existing data
- Do not fetch all outcomes upfront — paginate: 10 per page, load more on scroll
- Do not show "What's due" section if no items have `due_date` — render conditionally

### Testing checklist

- [ ] Library shows all user outcomes, correct status chips
- [ ] Tap to resume: workspace opens at correct section
- [ ] Save toggle: persists across refresh
- [ ] What's due: shows items due within 14 days only
- [ ] Checklist: tick persists across session/device
- [ ] Reminder bell: schedules notification (or shows permission request on iOS)
- [ ] Checklist PDF export: checkboxes rendered in PDF

---

## Layer 14 — Database Persistence

### Goal

Apply the full V1 schema migration to all environments. Verify RLS policies. Run the seed data. This layer is also the final check that autosave and cross-session retention work correctly end-to-end.

### Files to create or edit

```
/supabase/migrations/20260608000000_prompted_v1_schema.sql   # Full schema (Phase 3 §3.5)
/supabase/seed/templates.sql                                  # 22 templates
/supabase/seed/bundles.sql                                    # 4 bundles
```

### Acceptance criteria

- Migration runs cleanly on a fresh Supabase project with zero errors
- All tables created with correct columns, types, constraints, and indexes
- RLS enabled on all user-content tables
- RLS policies verified: user A cannot read/write user B's rows on any table
- Seed: all 22 templates and 4 bundles inserted
- Autosave: section content change → DB update within 500ms (manual test)
- Cross-session: sign out, sign in → workspace shows all sections at last-saved state
- Cross-device: log in on second browser/device → Library shows all outcomes correctly
- Anonymous session expiry: 30-day-old anonymous outcomes not returned in queries

### Common mistakes to avoid

- Do not apply the migration directly in production — always run on staging first
- Do not use `drop table if exists` for tables that may contain production data — use `alter table add column if not exists`
- Do not create RLS policies without testing them (do not trust "looks right" — actually test with two users)

### Testing checklist

- [ ] Migration on fresh DB: zero errors
- [ ] RLS test: user A token cannot SELECT/UPDATE/DELETE user B's outcomes (Supabase Test Runner)
- [ ] Seed: 22 templates, 4 bundles in DB
- [ ] Autosave: edit section → refresh → content present
- [ ] Cross-device: session restored on second device
- [ ] Index performance: `explain analyze` on common queries (Library load, section fetch)

---

## Layer 15 — Security Hardening

### Goal

Audit and harden all security controls: CORS, rate limiting, input sanitisation, provider key isolation, accessibility final pass.

### Files to create or edit

```
/supabase/functions/_shared/
  cors.ts                      # CORS headers: allow only littlemissscarlett.co + localhost
  rate-limiter.ts              # Per-user rate limiting via Supabase (or upstash Redis)
  input-sanitiser.ts           # Strip HTML, cap lengths, validate types

/app/src/lib/
  sanitise.ts                  # DOMPurify for content from Tiptap before DB storage
```

### Acceptance criteria

- CORS: Edge Functions reject calls from origins other than `littlemissscarlett.co` and `localhost` (returns 403)
- Rate limiting: >60 requests/minute to chat endpoints from same user → 429
- Client bundle: grep for `sk-`, `AIza`, `ant-` → zero results
- Input: text input capped at 20,000 characters (client validation + server validation)
- Upload: files >20MB rejected with plain error
- Tiptap output: DOMPurify applied before storing to `sections.content`
- SQL: all DB operations use Supabase JS client (parameterised) — no string-concatenated SQL
- XSS: `dangerouslySetInnerHTML` used nowhere in the app; all user content rendered via safe React text nodes or sanitised HTML
- App Store readiness: all G7 checklist items verified (see SRS §2.27)
- Accessibility final pass: axe-core clean on all screens, manual VoiceOver test on iPhone

### Testing checklist

- [ ] CORS test: `curl` with wrong origin → 403
- [ ] Rate limit test: 61 rapid requests → 429 on 61st
- [ ] Bundle scan: no provider keys found
- [ ] Input over 20,000 chars: truncated/rejected before sending to AI
- [ ] File over 20MB: error shown
- [ ] DOMPurify test: `<script>alert(1)</script>` in section → stripped
- [ ] RLS final audit: two-user isolation test on all tables
- [ ] axe-core: zero violations on home, workspace, library, settings
- [ ] VoiceOver: navigate home → recommendation → workspace → export using VoiceOver only

---

## Layer 16 — Testing

### Goal

Complete the full test suite: unit, integration, end-to-end, accessibility, security, and content QA.

### Files to create or edit

```
/app/src/
  **/*.test.tsx               # Unit tests (co-located)
  
/tests/
  e2e/
    core-loop.spec.ts         # Home → recommend → draft → workspace → approve → export
    bundles.spec.ts           # All 4 bundles
    checklist.spec.ts         # Standalone checklist with reminder
    analytical-report.spec.ts # Upload → report with chart
  integration/
    gateway.spec.ts           # Provider routing + fallback
    export.spec.ts            # PDF, Word, Excel rendering
    entitlements.spec.ts      # Usage ledger enforcement
  security/
    rls.spec.ts               # RLS isolation between users
    auth.spec.ts              # Auth required on protected endpoints
    bundle-scan.spec.ts       # No provider keys in client bundle
  accessibility/
    axe.spec.ts               # axe-core on all screens
```

### Acceptance criteria

- Unit test coverage ≥80% on domain-engine, template utilities, and derived-field calculations
- All 4 E2E bundle tests pass on web (Playwright)
- Core loop E2E passes on iPhone simulator (Detox or manual)
- No axe-core violations on any screen
- RLS test: user A cannot read user B's data on any table
- No provider keys in client bundle
- Content QA: all 22 templates produce correctly structured output (manual checklist)

### Testing checklist

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All E2E tests pass on web
- [ ] All E2E tests pass on iPhone simulator
- [ ] axe-core: zero violations
- [ ] VoiceOver: complete core loop manually
- [ ] RLS: two-user isolation verified
- [ ] Content QA: all 22 templates reviewed

---

## Layer 17 — Deployment

### Goal

Deploy to production. App Store submission. CI/CD pipeline running.

### Files to create or edit

```
/.github/workflows/
  ci.yml                      # Lint + type-check + unit tests on every PR
  deploy-staging.yml           # Deploy to staging on merge to staging branch
  deploy-prod.yml              # Deploy to production on merge to main

/netlify.toml                  # Verify all API proxy routes are correct
/eas.json                      # EAS Build config for iOS
/app.json                      # Expo app config (bundle ID, App Store ID)
```

### Acceptance criteria

- Web app live at `littlemissscarlett.co/app`
- Landing page live at `littlemissscarlett.co`
- All API routes proxying correctly to Supabase Edge Functions
- iOS app submitted to App Store Connect; build passing (no rejections for any G7 item)
- CI: lint + type-check + unit tests run on every PR
- CD: staging deploys on push to staging; production deploys on merge to main
- Environment variables: all secrets in Netlify/Supabase; none in code

### Common mistakes to avoid

- Do not submit to App Store without demo credentials and reviewer notes
- Do not submit without all G7 items verified (privacy policy live, AI disclosure, account deletion in-app)
- Do not use the same Supabase project for staging and production

### Testing checklist

- [ ] Web app loads at production URL
- [ ] All 11 API endpoints reachable at `/api/*`
- [ ] iOS app runs on physical iPhone without crashes
- [ ] App Store review criteria (G7) all verified
- [ ] CI runs on PR, fails fast on lint errors
- [ ] CD deploys staging on push, production on merge

---

## Layer 18 — Monitoring and Maintenance

### Goal

Set up error monitoring, product analytics, cost alerting, and document the maintenance procedures.

### Files to create or edit

```
/app/src/lib/
  analytics.ts                # PostHog event helpers
  monitoring.ts               # Sentry init

/supabase/functions/_shared/
  cost-tracker.ts             # Log token usage per call (for cost monitoring)

/docs/08-MAINTENANCE.md      # Maintenance procedures (generated in Phase 8)
```

### Acceptance criteria

- Sentry: unhandled errors from Edge Functions and frontend appear in Sentry dashboard
- Sentry alert: fires when error rate >1% over 5 minutes
- Analytics: `outcome_started`, `recommendation_confirmed`, `document_exported`, `subscription_converted` events firing in PostHog
- Cost monitoring: AI token usage visible per provider per day in Supabase logs
- Cost alert: configured to fire when daily AI spend >120% of expected budget
- North-star dashboard: outcome completion rate visible in PostHog (outcome_started → document_exported funnel)

### Testing checklist

- [ ] Sentry: trigger a test error; confirm it appears in Sentry
- [ ] Analytics: complete core loop; confirm events in PostHog
- [ ] Cost monitoring: generate 5 documents; token counts visible in logs
- [ ] Alert: confirm alert configuration (cannot test without a real alert firing)

---

## End-of-Layer Review Template

Use this template after completing each layer:

```
## Layer [N] Review — [Layer Name]

### What is complete
[List everything that was built and is working]

### What is incomplete
[List anything that was scoped but not delivered]

### What may break
[List edge cases, known fragilities, or untested paths]

### What needs testing
[List specific things QA should verify]

### Recommended improvements
[Non-blocking: things to improve in a follow-up, not a blocker]

### Should we continue to the next layer?
[ ] Yes — all acceptance criteria met
[ ] Conditional — continue with the following caveats: [caveats]
[ ] No — the following must be resolved first: [blockers]
```
