# Phase 2 — Software Requirements Specification

**PrompTED · TED AI · SRS Version 1.0 · June 2026**

> Authoritative specification for contractors and developers. Every requirement has an ID, rationale, priority, acceptance criteria, dependencies, and implementation notes. A developer can build from this document without guessing.

---

## 2.1 Executive Summary

PrompTED is a chat-first AI output platform that turns a described situation into finished, professional documents, action plans, and checklists. It is deployed as a responsive web application at `littlemissscarlett.co/app` and an iPhone-first mobile app (Expo / React Native).

The product is scoped to employment, education, and business. It is built for Australians who are capable but overwhelmed. Its core promise is: describe what you are trying to achieve, and TED works out what you need, prepares it, and helps you finish.

The backend is Supabase (Postgres, Auth, Storage, Edge Functions) deployed behind a Netlify proxy. The AI layer is a provider-agnostic gateway wiring OpenAI, Anthropic, and Google. All AI calls are mediated server-side; the client never holds provider keys.

---

## 2.2 Product Overview

**Name:** PrompTED  
**Persona / AI name:** TED  
**Company:** TED AI  
**Domain:** littlemissscarlett.co  
**App URL:** littlemissscarlett.co/app  
**Platforms:** iPhone-first (Expo / React Native) + responsive web (Next.js or equivalent)  
**Deployment:** Netlify (web) + App Store (iOS)  
**Backend:** Supabase (Auth, Postgres, Storage, Edge Functions)  
**Primary language:** TypeScript  
**Primary audience:** Australian individuals and small businesses  

### Core loop (five steps)

1. **Situation understanding** — user describes in plain language; TED interprets domain, intent, confidence.
2. **Recommendation checkpoint** — TED shows what it understood and recommends (documents, format, reason). User confirms or adjusts before anything is drafted.
3. **Document generation** — TED drafts confirmed documents from structured templates, pre-filled from profile.
4. **Master Workspace** — user reviews, edits (manually or with TED), approves section by section. Only approved content exports.
5. **Export** — PDF and Word for all; Excel for Budget Workbook only; bundle "whole pack"; share/copy.

---

## 2.3 User Personas

See Phase 1 (§1.2) for full persona descriptions. Summary:

| ID | Name | Role | Primary need |
|----|------|------|-------------|
| P-01 | Maria | Small-business owner | Policy, email, onboarding docs quickly, on-brand |
| P-02 | Aroha | Manager / HR | Performance reviews, fair employment docs, compliance guardrails |
| P-03 | Daniel | Job seeker | Complete job-ready pack from one request |
| P-04 | Sam | Overwhelmed individual | Research-backed life-event checklist with reminders |
| P-05 | Priya | Student / applicant | Compelling education application from a brief description |

---

## 2.4 User Stories

| ID | As a… | I want… | So that… | Maps to |
|----|-------|---------|---------|---------|
| US-01 | Job seeker | To describe my situation and receive a complete job-ready pack | I can apply with confidence | FR-001, FR-010 |
| US-02 | User unsure which document I need | TED to recommend the best document plus two variants with use cases and benefits | I don't have to know the format | FR-002, FR-003 |
| US-03 | Small-business owner | To generate an on-brand policy or email from a short description | I look professional without hiring help | FR-004, FR-015 |
| US-04 | Manager | To turn rough notes into a fair performance review | I save time and stay consistent | FR-004 |
| US-05 | Business user | To upload a report and get a summary or analysis with tables/charts from my real figures | I can brief others quickly | FR-005 |
| US-06 | Overwhelmed individual | A research-backed checklist with deadlines and reminders | I don't miss important steps | FR-006 |
| US-07 | Any user with an ambiguous request | At most one or two quick clarifying questions | I'm guided without being interrogated | FR-002 |
| US-08 | Any user | To edit and approve each section before export | I trust and own the result | FR-007 |
| US-09 | Returning user | To resume saved work and reuse my templates | I don't start over | FR-011 |
| US-10 | Any user | My data kept private and deletion available | I'm comfortable using it for sensitive work | FR-012, SEC-026 |
| US-11 | Any user | A finished, downloadable document rather than chat text | It's immediately usable | FR-001, FR-008 |
| US-12 | Business user | My business name, logo, and tone applied automatically | Documents look like they came from our team | FR-010 |
| US-13 | Any user | Photo of a letter or form to be understood by TED | I can act on documents I've received | FR-009 |
| US-14 | Free user | To reach a finished draft without signing up | I can evaluate the product before committing | FR-012 |
| US-15 | Business user | Unlimited document generation per seat | I don't count documents or worry about hitting a cap | F-02 |

---

## 2.5 Functional Requirements

Each requirement uses the format:
- **Statement** — what the system must do
- **Rationale** — why
- **Priority** — Must / Should / Could
- **Acceptance criteria** — how we know it's done
- **Dependencies** — what must exist first
- **Implementation notes** — how to build it

---

### FR-001 — Chat-first home screen

**Statement:** The home screen presents a single plain-language text input ("Ask TED") with the headline "What are you trying to achieve?" The user types, pastes, or uploads to describe their situation. The entire input area is also a drag-and-drop dropzone: the user can drag a file (PDF, .docx, image) directly onto the home screen to begin. The home screen never asks what document type the user wants.

**Rationale:** The governing doctrine — "outcome first, never template first." Reduces the cognitive burden for users who don't know what they need.

**Priority:** Must

**Acceptance criteria:**
- Home screen headline is "What are you trying to achieve?" (or approved copy variant)
- Input field placeholder is "Ask TED" (or approved copy variant)
- No document-type picker, format selector, or AI/provider references are visible
- Example chips (rotating, 3–5 items) are shown below the input
- A "Browse" chip opens a searchable, categorised template/outcome list
- A fast lane (Recents, Saved, Your Templates) is visible for returning users
- The input area accepts drag-and-drop of a file (PDF, .docx, JPEG, PNG, HEIC); dragging a file over the screen shows a clear drop-target affordance ("Drop to add as context")
- A visible attach/upload control (e.g. paperclip) provides the same upload entry point for users who do not drag (and for mobile / keyboard / screen-reader users)
- The screen passes AA contrast and 17pt minimum body text

**Dependencies:** None (first screen)

**Implementation notes:** The example chips are drawn from the three domains. A rotating set of 5–8 is shown; shuffle on each session. The Browse chip is a secondary entry point — do not make it the default. On mobile, the fast lane collapses to a horizontal scroll strip.

---

### FR-002 — Intent interpretation and confidence gating

**Statement:** When the user submits a situation description, the system interprets the domain (employment / education / business / personal) and the situation type, and produces a confidence score. If confidence is high, the system proceeds to recommendation. If confidence is low, the system asks targeted clarifying questions — one at a time, each responsive to the last answer — until it understands the intent well enough to recommend. The conversation is warm and adaptive, never an interrogation and never a form.

**Rationale:** Prevents both false assumptions (confident wrong interpretation) and a cold form-filling experience. Convergence is driven by understanding, not by a turn counter — a fixed cap would turn the clarification into a disguised two-step form, defeating its purpose. (Owner decision, June 2026: supersedes the earlier "hard cap of two questions, non-negotiable.")

**Priority:** Must

**Acceptance criteria:**
- System correctly classifies domain for >85% of well-formed inputs in QA
- When confidence is low, system asks adaptive, single-sentence questions until intent is clear
- The system commits to a recommendation as soon as confidence is sufficient (no fixed minimum or maximum question count)
- Each question is responsive to the user's previous answer — never pre-scripted or batched
- The recommendation is still user-adjustable afterwards
- No question asks for information TED can reasonably infer or look up
- The conversation still has a defined end state (the recommendation checkpoint) — it never becomes an open-ended chat

**Dependencies:** FR-001 (home screen input), AI-001 (intent interpretation endpoint)

**Implementation notes:** Intent interpretation is an Edge Function (`interpret-intent`). Confidence threshold for "skip clarification" is configurable — start at 0.75. Clarifying questions are single-sentence, plain English, and each is generated in response to the latest answer. Never ask for information available from the user's profile or inferrable from context. There is no fixed exchange cap; the orchestration layer ends clarification when its "intent clear" signal fires, then transitions to the recommendation checkpoint.

---

### FR-003 — Recommendation checkpoint (summary card)

**Statement:** Before any document is drafted, the system shows a summary card with: (a) what TED understood in one to two plain sentences; (b) the recommended document(s) as a list, each with a one-line reason; (c) if the user's purpose is known but the document type is unclear, a primary recommendation plus exactly two variants, each with format, use-case scenario, and benefits. The user must confirm or adjust before drafting begins.

**Rationale:** The trust mechanism. Nothing is generated without the user seeing and accepting the plan. This is the consent and correction point. It also handles the "I know what I want to achieve but not what document I need" problem without a blank menu.

**Priority:** Must

**Acceptance criteria:**
- No draft content appears before the user confirms the summary card
- Card shows what TED understood (plain language, 1–2 sentences)
- Card shows recommended document(s) with one-line reasons
- When document type is ambiguous: exactly one primary + two variants (total three small cards), each showing document type, use-case scenario, and benefit list
- Card has three actions: Confirm · Adjust · Add detail
- Confirming a multi-document recommendation creates a bundle checklist
- If a photo was attached: card first shows what TED extracted from the image for confirmation
- User can return to this screen and adjust before first export

**Dependencies:** FR-002 (intent interpretation), AI-001 (recommend endpoint)

**Implementation notes:** The three-card variant layout (primary + 2 alternatives) is a dedicated UI component. Do not show this as a dropdown or list — each card is a tappable tile. "Adjust" opens an inline edit/add/remove flow on the same screen. This screen is not a separate navigation destination — it is a step within the Home → draft flow.

---

### FR-004 — Document generation from structured templates

**Statement:** The system generates documents using a deterministic Domain Engine that selects the template, supplies section/field definitions, pre-fills from the user/business profile, and passes the structure to the AI model. The AI writes content into this structure. The AI does not invent document structure at runtime.

**Rationale:** Prevents generic output. Every template has a bespoke structure — a performance review's sections differ from a service agreement's. The Domain Engine is the fix for "wall of text" AI output.

**Priority:** Must

**Acceptance criteria:**
- Every document type corresponds to a template in the template library (authored before build)
- Template structure (sections, field order, names) is identical across all generations of the same template
- AI output fills the template sections and does not add or remove sections
- Missing user details trigger a targeted question (per the template's `missingDetailRules`), not a generic "tell me more"
- Profile fields pre-fill automatically without being re-asked
- Drafting streams into the workspace (user sees progress immediately)

**Dependencies:** FR-003 (confirmed recommendation), DB-005 (templates table), AI-002 (generate-document endpoint)

**Implementation notes:** The template schema is defined in Phase 3 (§3.5). Every template is a JSON record with: name, domain, category, structureType (Compose / Structured form / Checklist), sections or fields, missingDetailRules, fillFromProfile, recommendationReason, relatedDocuments, flags. Templates are authored content — they exist as database seed data before the app launches. The AI prompt includes the template structure and a strict instruction to write into that structure only.

---

### FR-005 — Analytical/report generation from uploads

**Statement:** The system ingests user-provided files (PDF, Word, spreadsheet, image) and generates a structured analytical document — report, summary, findings document, comparative report — grounded exclusively in the user's data. Charts and tables are included where the data supports them. Every figure, table, and chart uses only data the user provided; the system never invents data points.

**Rationale:** A primary business use case is "here is my data, turn it into a report." Analytical documents are a category of output where the structure must be chosen based on the data, not from a fixed template.

**Priority:** Must

**Acceptance criteria:**
- System correctly ingests PDF, Word (.docx), and image uploads
- System recommends document type (report, summary, comparison, etc.) based on the data
- All figures in the generated document are verifiable against the user's input data
- If data is insufficient for a requested chart or claim, system says so explicitly rather than fabricating
- Charts are rendered server-side from a specification derived from user data
- Financial, scientific, and evidence reports carry the relevant advice boundary (SEC-034)

**Dependencies:** FR-009 (upload ingestion), AI-003 (generate-report endpoint), AI-010 (chart specification and render pipeline)

**Implementation notes:** Chart types in V1: bar, line, pie. Chart spec is a JSON structure (labels, values, type, title). Server-side render via a library (e.g. QuickChart API, or canvas-based render in Edge Function). Do not attempt client-side chart rendering for exports — charts must appear in the PDF/Word output. The "no fabrication" guardrail is enforced in the AI prompt and validated in the review pass.

---

### FR-006 — Checklist and action plan generation

**Statement:** The system generates researched, tickable checklists and action plans grounded in real current information (via web search). Each checklist item has: task text, optional deadline (with days remaining), plain-English reason (why it matters and why the timing), and a completion reminder. Checklists are a first-class output type — a user can request one directly. Saved progress persists across sessions.

**Rationale:** The personal track's primary deliverable. Research-backed = accurate, not fabricated. Deadline + reason + reminder = completion scaffolding, not just content generation.

**Priority:** Must

**Acceptance criteria:**
- Checklist items are grounded in web search results, not invented (no fabricated time-sensitive guidance)
- Each item shows: checkbox, task text, deadline (if set), days remaining, reason (expandable), reminder bell
- Items are grouped by timing/priority (immediate first, then by upcoming deadline)
- User can tick items; progress persists across sessions and devices
- Items with deadlines trigger a push notification reminder before the due date
- Checklist can be exported as a printable document (checkboxes included)
- "Edit with TED" refines or adds items

**Dependencies:** FR-001, AI-004 (generate-checklist endpoint), C4 (web search), DB-011 (checklist_items), API-007 (push notifications)

**Implementation notes:** Web search is via the `research` Edge Function (backed by OpenAI Responses API with web search tool, or equivalent). Checklist items include `due_date`, `reason`, `done`, `reminder_offset_days`. The progress bar ("4 of 11 done") is computed from the `done` flag count. Reminders use APNs (iOS) / Web Push (web).

---

### FR-007 — Master Workspace: editing, approval, version history

**Statement:** The Master Workspace provides section-by-section viewing, editing, and approval of every generated document. Manual editing is always available. AI editing ("Edit with TED") is revealed only when the user selects a section and requests it. Each section has a status: Draft → Edited → Approved → Locked. Export is unavailable until all required sections are Approved. Only Approved content exports. Version history allows restoring a previous version of any section.

**Rationale:** The user must trust and own the result. Section-by-section approval ensures the user has reviewed every part of the document. Version history provides a safety net for unwanted edits.

**Priority:** Must

**Acceptance criteria:**
- Section list, editor, and preview are always visible (three-pane on desktop; stacked on mobile)
- Every section has a visible status chip (Draft / Edited / Approved / Locked)
- An approval counter ("3 of 6 sections approved") is shown at the document level
- Export button is disabled and clearly labelled "Approve all sections to export" until all required sections are Approved
- Manual editing is always available without any AI interaction required
- "Edit with TED" panel only appears when the user explicitly requests it on a selected section
- Per-section AI actions: Improve · Shorten · Expand · Change tone · Add detail
- Version history shows previous versions of each section with timestamps; restoring replaces current content
- Selecting a text range within a section allows editing just that selection
- Sections can be reordered by drag-and-drop in the section list; the new order persists (`sections.order_index`) and is reflected in the preview and export
- A keyboard-accessible reordering control (e.g. move up / move down, or ARIA grab/drop) provides the same capability for AA compliance — drag-and-drop is never the only way to reorder
- Locked sections cannot be reordered until unlocked

**Dependencies:** FR-004 (generated sections), DB-008 (sections table with status and version history)

**Implementation notes:** Section status is stored in `sections.status`. Version history is stored in a `section_versions` table (or JSONB array in `sections`). "Edit with TED" sends the current section content + action to the `edit-section` Edge Function. The three-pane layout uses CSS Grid on desktop (list 240px | editor flex | preview 320px); stacked on mobile. Locking a section prevents further edits without explicit unlock. Reordering updates `sections.order_index` (reindex affected rows in a single transaction; the section list always renders ordered by `order_index`). Use a list interaction that exposes both pointer drag-and-drop and a keyboard/ARIA equivalent (e.g. `@dnd-kit` or equivalent with keyboard sensors) so the feature meets AA.

---

### FR-008 — Export system

**Statement:** The system exports approved documents in PDF and Word formats. The Budget Workbook exports in Excel only. A bundle exports as a single combined pack alongside per-document export. Any document can be shared via device share sheet or copied to clipboard.

**Rationale:** The end artifact must be usable, sendable, and submittable. PDF and Word cover >99% of professional use cases. Excel is the only exception and only for the Budget Workbook.

**Priority:** Must

**Acceptance criteria:**
- PDF export renders the document with professional formatting, brand kit (if business account), and all Approved sections only
- Word (.docx) export is structurally equivalent to the PDF
- Excel export exists only for the Budget Workbook, with protected formula cells and editable input cells
- Bundle pack export combines all documents in the bundle into a single file (combined PDF) plus a ZIP of individual files
- Share action uses the device share sheet (iOS share sheet / Web Share API)
- Copy action copies the document content to clipboard as plain text
- Export is not available until all required sections are Approved
- A record is created in `export_history` on every export

**Dependencies:** FR-007 (workspace approval), DB-012 (export_history), API-009 (render-export endpoint)

**Implementation notes:** Export rendering is a server-side Edge Function (`render-export`). For PDF: use a headless renderer (Puppeteer or equivalent) or a PDF library (PDFKit). For Word: use `docx` npm library. For Excel: use `exceljs`. Charts in exports are pre-rendered SVG/PNG images. Brand kit is applied during render: logo (image), colour (CSS variables), footer (text). Do not render exports client-side — server-side only to avoid key exposure and performance issues.

---

### FR-009 — Input ingestion: text, paste, photo, document upload

**Statement:** The user may provide context by typing, pasting text, attaching a photo (of a form, letter, or notice), or uploading a document (PDF, Word). All input types feed the same pipeline. A photo or uploaded document is context for producing an output — not an open Q&A feature. When a photo is attached, TED shows what it extracted on the summary card for confirmation before any drafting.

**Rationale:** "Any input" reduces friction. Photographed letters and uploaded reports are common real-world scenarios. The "confirm what I read" step prevents a misread image from producing a wrong document silently.

**Priority:** Must

**Acceptance criteria:**
- User can type, paste, attach a photo (JPEG/PNG/HEIC), or upload a file (PDF, Word)
- Photo and upload are accepted from the home screen input
- Files can be added by drag-and-drop onto the home screen, by the attach control, or (mobile) by the system file/photo picker — all three feed the same ingestion pipeline
- A keyboard- and screen-reader-accessible upload control is always present as the equivalent of drag-and-drop (drag-and-drop is never the only way to upload)
- Extracted text and meaning from photo/upload appear on the summary card for user confirmation before drafting
- Misread image cannot produce a draft silently — confirmation is required
- Same domain boundaries apply to photo inputs as to typed input
- Upload size limit: 20MB per file (V1)
- Supported upload types: PDF, .docx, JPEG, PNG, HEIC

**Dependencies:** API-008 (ingest-upload endpoint), DB-013 (uploads table), Supabase Storage

**Implementation notes:** Photo OCR uses the vision capability of the selected AI provider (via the `ingest-upload` Edge Function). Text extraction from PDF uses pdf-parse or equivalent. The extracted payload is passed to the intent interpretation step like any other input. Do not process uploads client-side — send to the Edge Function.

---

### FR-010 — Business profile, company memory, and brand kit

**Statement:** Business accounts have a company profile (name, ABN optional, contact, voice/tone, reusable snippets/clauses) and a brand kit (logo, primary colour, secondary colour, footer text, name). The company profile pre-fills all matching fields in generated documents. The brand kit is applied to business outputs during export and previewed live in the workspace.

**Rationale:** Business users should not re-enter their business name and details for every document. Consistency and on-brand output are core business value propositions.

**Priority:** Must

**Acceptance criteria:**
- Business profile fields: trading name, legal name, ABN (optional), address, phone, email, website, industry, voice/tone descriptor, reusable clauses (JSONB array)
- Brand kit fields: logo image, primary colour (hex), secondary colour (hex), footer text
- All fillable template fields with a `fillFromProfile: true` flag are pre-filled automatically
- Live brand preview in the workspace renders with the brand kit applied (correct logo, colour, footer)
- Brand kit can be edited in Settings
- Company profile can be edited in Settings

**Dependencies:** DB-003 (businesses), DB-014 (brand_kits), DB-015 (company_profile), FR-007 (workspace)

**Implementation notes:** `fillFromProfile` mapping in the template schema specifies which template fields draw from which profile fields (e.g. `businessName → businesses.trading_name`). The brand preview is a CSS-injected live preview — it does not require a re-render of the full document. Logo is stored in Supabase Storage; reference URL is in `brand_kits.logo_url`.

---

### FR-011 — Autosave, Library, fast lane (Recents / Saved / Your Templates)

**Statement:** All work autosaves continuously and is restored across sessions and devices. The Library shows all past and in-progress outcomes with a light status chip (Draft / In progress / Done) and a "what's due" list of upcoming checklist deadlines. The fast lane on the home screen shows Recents, Saved, and Your Templates for one-tap re-entry.

**Rationale:** "Nothing is lost" is a core UX promise (B10). Returning users — especially businesses — must be able to re-enter work in one tap.

**Priority:** Must

**Acceptance criteria:**
- All section edits, checklist progress, and form field values are saved to the database within 2 seconds of the user making a change
- Restoring a session shows the exact state at last save, including workspace position and approval status
- Library shows each outcome with status chip (Draft / In progress / Done)
- Status chip is derived from existing outcome and section data (no separate tracking engine)
- "What's due" list shows items with `due_date` within the next 14 days, sorted by date
- Recents shows last 5 outcomes in reverse chronological order
- Saved shows outcomes the user has explicitly bookmarked
- Your Templates shows documents saved as reusable templates

**Dependencies:** DB-007 (outcomes), DB-008 (sections), DB-011 (checklist_items), FR-012 (accounts)

**Implementation notes:** Autosave uses debounced upsert (500ms debounce). Status chip is derived: if no sections → Draft; if any section Approved but not all → In progress; if all required sections Approved and exported → Done. "Your Templates" is a flag on the documents table; "Save as template" adds this flag. Do not build a separate tracking engine — derive from existing data.

---

### FR-012 — User accounts: anonymous start, gated at save/export

**Statement:** A new user can describe their situation and reach a finished draft without signing up. An account is required only at the moment they want to save, export, or return. Sign in with Apple is offered on iOS. Account deletion is available in-app and removes the user's content.

**Rationale:** "Prove value first" — highest-converting pattern. Removing the sign-up barrier from the front door ensures the first experience demonstrates the product before asking for commitment.

**Priority:** Must

**Acceptance criteria:**
- User can complete Home → recommendation → draft → workspace without signing in
- Sign-in prompt appears at the first save, export, or "return to this later" action
- Sign in with Apple is available on iOS
- Email/password and OAuth are available on web
- Account deletion: Settings → Delete account → confirmation → user data deleted from all tables within 24 hours
- Account deletion endpoint is callable from both in-app and from the privacy policy page

**Dependencies:** Supabase Auth, DB-001 (profiles), G2 (auth), G3 (account control)

**Implementation notes:** Anonymous sessions use Supabase anonymous auth (available in Supabase). On sign-in/sign-up, migrate the anonymous session's work to the authenticated user record. Sign in with Apple uses Supabase's Apple OAuth provider with the App Store Connect App ID. Account deletion is a server-side Edge Function that cascades deletes via the FK + ON DELETE CASCADE rules in the schema.

---

### FR-013 — Monetisation: plans, packs, entitlements enforcement

**Statement:** The system enforces document creation and AI-edit caps per plan via a usage ledger. Plans: Free (3 docs/month), Pro ($9.99/wk or $20/mo, 5/wk or 20/mo), Premium ($14.99/wk or $30/mo, 10/wk or 40/mo), Business ($29/seat/month, unlimited fair-use). Payment: Stripe (web), Apple IAP (iOS), RevenueCat syncs entitlements. The paywall appears only at natural limits, never before first value.

**Rationale:** Revenue model. Usage enforcement protects against cost overruns. "Paywall after value" is the conversion doctrine.

**Priority:** Must

**Acceptance criteria:**
- Document creation is blocked when the user's doc count >= plan cap (monthly or weekly, per plan)
- AI-edit actions are blocked for Free plan users; available for Pro/Premium/Business
- Business plan users are not metered by document count (fair-use ceiling enforced separately)
- Paywall never appears before the user has experienced a completed draft
- RevenueCat webhook updates `subscriptions` table within 60 seconds of payment
- `usage_ledger` is the enforcement source of truth; it is updated on every document creation and AI-edit action
- Restore purchases is available on iOS
- No external purchase links or external pricing appear anywhere in the iOS app

**Dependencies:** DB-016 (subscriptions), DB-017 (usage_ledger), API-011 (RevenueCat webhook), F1–F4

**Implementation notes:** RevenueCat is the single entitlement source of truth. Supabase `subscriptions` is a downstream sync from RevenueCat. The `usage_ledger` table records each event with a timestamp; caps are evaluated by counting events within the current billing period. Business plan fair-use ceiling is a configurable constant (read from Edge Function env var, not hardcoded). Packs (pay-per-document) are also RevenueCat products.

---

### FR-014 — Provider-agnostic AI gateway

**Statement:** All AI calls are mediated by a provider-agnostic router that wires OpenAI, Anthropic, and Google behind a single interface. The client never calls a provider directly and never holds provider keys. TED routes each task to the best engine for it silently. Adding or swapping a provider is a configuration change, not a code change.

**Rationale:** Never structurally dependent on one provider. Provider outages do not block the user. Model strengths shift with every release; the routing map must be updateable without a rebuild.

**Priority:** Must

**Acceptance criteria:**
- Three providers are wired and callable: OpenAI (GPT-4.1 / GPT-5.5 / o3), Anthropic (claude-sonnet-4), Google (Gemini 2.5 Pro)
- If the primary provider returns a 429, 500, 502, 503, or 504, the gateway retries with the fallback provider
- No product code (frontend or backend) names a provider or depends on one
- Task-to-provider mapping lives in Edge Function environment configuration, not in product code
- The user never sees which provider ran

**Dependencies:** Supabase Edge Functions, API-001–API-010 (AI endpoints)

**Implementation notes:** The existing `_shared/openai-proxy.ts` is the foundation. Extend it to support Anthropic and Google as equivalent call paths. The router selects provider based on task type: `chat_preview` → fast/cheap; `document_generation` → high-quality structured; `high_reasoning` → GPT-5.5 or claude-opus; `research` → models with web search. Config is in Supabase secrets (PROVIDER_ROUTING_MAP as JSON string). Fallback order: primary → secondary → tertiary.

---

### FR-015 — Clari (reading level and tone personalisation)

**Statement:** Clari adjusts reading level, guidance depth, tone, and detail level based on how the user writes and interacts. It is invisible — never a visible "mode" or toggle. Its only user-facing surface is "Your style" in Settings, where the user can view and adjust the detected preferences.

**Rationale:** Different users need different language. A small-business owner and a corporate manager need different tones. Clari prevents generic output while keeping the UI clean.

**Priority:** Should

**Acceptance criteria:**
- Reading level is adapted for users who write in shorter, simpler sentences vs. longer, complex ones
- Tone adapts: warm/casual vs. professional/formal based on writing style
- Detail level adapts: more or less explanatory text based on user behaviour
- "Your style" in Settings shows detected preferences and allows manual override (simple / moderate / detailed; casual / professional)
- Clari adjustments are applied to TED's output, not the user's input
- Clari preferences are stored in `clari_preferences` table

**Dependencies:** DB-004 (clari_preferences), AI layer (system prompt injection)

**Implementation notes:** Clari is a system prompt modifier. The AI gateway reads the user's `clari_preferences` record and prepends the appropriate style instruction to the system prompt. Initial detection is based on input text complexity (average sentence length, word complexity). "Your style" in Settings is a simple two-axis selector (reading level + tone) — no jargon about "modes."

---

### FR-016 — AI disclosure, consent, and advice boundaries

**Statement:** Onboarding includes a clear disclosure that documents are processed by external AI services, with user consent obtained before any personal data is shared. Documents touching employment law, tax, or finance carry a contextual "general template, not legal or financial advice" boundary. High-stakes documents (termination, terms of employment, financial analysis) show a specific notice that names the actual risk, plus a one-time acknowledgment before drafting.

**Rationale:** App Store Guideline 5.1.2(i) and Australian Privacy Act compliance. Tiered disclaimers preserve the warm tone for low-stakes documents while providing genuine protection on high-stakes ones.

**Priority:** Must

**Acceptance criteria:**
- Onboarding includes a modal: "TED uses external AI services to draft your documents. Your information is processed to produce your result." with Accept and Privacy Policy link
- The modal appears before any personal data is submitted to the AI
- No AI provider names appear in the UI
- Low-stakes documents (resume, email, policy): a brief footer line "This is a general template, not legal advice" where relevant
- High-stakes documents (termination, terms of employment, financial analysis): a specific contextual notice is shown before drafting, naming the actual risk (e.g. "Termination has strict Fair Work rules — check the NES and any applicable award before you act"), plus a one-time acknowledgment checkbox
- One-time acknowledgment is recorded in the user's profile (not re-shown on subsequent documents of the same type)

**Dependencies:** FR-012 (accounts), DB-001 (profiles: acknowledged_advice_boundaries JSONB), G6

**Implementation notes:** The advice boundary tier is a field on the template schema (`adviceBoundary: 'none' | 'light' | 'high-stakes'`). The orchestration layer reads this and injects the appropriate disclosure before the generate-document call. High-stakes acknowledgment is stored as a JSONB array of template IDs in `profiles.acknowledged_advice_boundaries`.

---

### FR-017 — Bundle system

**Statement:** A bundle is a coordinated set of documents and/or checklist items produced from a single situation. V1 bundles: (1) "I need a job", (2) "Onboard a new employee", (3) "Set up the basics of my business", (4) "I'm applying". Bundles are data records, not code. New bundles can be added without a rebuild.

**Rationale:** A situation typically needs multiple related documents. Producing them as a coordinated set is more valuable than asking the user to generate each separately.

**Priority:** Must

**Acceptance criteria:**
- Confirming a bundle recommendation creates an outcome with all bundle documents listed
- Each document shows Generate / View example / Skip
- Bundle progress is visible (e.g. "3 of 7 items complete")
- "Download the whole pack" exports all generated documents as a combined PDF and as a ZIP of individual files
- Each bundle can also share and copy individual documents
- Bundles are database records with a list of template references; adding a new bundle requires only a new database record

**Dependencies:** FR-003 (recommendation checkpoint), DB-006 (bundles), FR-007 (workspace), FR-008 (export)

**Implementation notes:** A bundle record includes: name, description, domain, template_ids (ordered array), checklist_template_id (optional), display_order. The bundle screen shows a checklist of the recommended outputs. The user can skip individual items. "Download the whole pack" is a single API call to `render-export` with all approved document IDs.

---

### FR-018 — Photo confirmation (confirm-what-I-read)

**Statement:** When a photo is attached as input, the summary card first shows what TED extracted from the image, with an explicit confirmation step before any drafting begins.

**Rationale:** A misread image must not silently produce a wrong document. The user must see what TED understood from the photo before anything is generated.

**Priority:** Must

**Acceptance criteria:**
- Summary card shows extracted text/meaning from the photo with heading "What TED read from your photo"
- User must confirm or correct this before the recommendation proceeds
- Correction edits the extracted text inline, not by re-uploading
- If OCR fails or returns low confidence, a plain error is shown and the user is prompted to type the context instead

**Dependencies:** FR-009 (upload ingestion), API-008 (ingest-upload)

---

## 2.6 Non-Functional Requirements

### NFR-001 — Streaming first visible content

**Statement:** Drafting must stream into the workspace. The first visible section content must appear within 2 seconds of the user confirming the recommendation.

**Priority:** Must

**Acceptance criteria:** First visible streamed content appears within 2 seconds on a standard broadband connection. No blank screen or bare spinner during generation.

**Implementation notes:** Use SSE (Server-Sent Events) or chunked HTTP streaming from the Edge Function. The workspace renders each streamed chunk as it arrives.

---

### NFR-002 — Contextual loading messaging

**Statement:** No bare spinners. All loading states show contextual, meaningful progress in TED's voice: "TED is working out what you need," "TED is preparing your documents."

**Priority:** Must

**Acceptance criteria:** No spinner appears without an accompanying message in TED's voice. Message changes at each major processing stage. For sensitive content (employment law, financial), messaging is plain and calm without naming the document type prematurely.

---

### NFR-003 — Accessibility: 17pt floor, AA contrast, VoiceOver, reduced motion

**Statement:** Minimum body text 17pt. Contrast AA minimum, AAA preferred. Full VoiceOver and screen-reader support. Full reduced-motion support. Touch targets ≥44pt. No reliance on colour alone to convey meaning.

**Priority:** Must

**Acceptance criteria:** All text ≥17pt. All text/background combinations pass WCAG 2.1 AA (4.5:1). Interactive elements have accessible labels. Reduced-motion media query disables all non-essential animations. Touch targets ≥44x44pt. All errors, status badges, and labels include text, not colour alone.

---

### NFR-004 — Security: encryption, RLS, no content in logs

**Statement:** All user and business data is encrypted at rest (Supabase) and in transit (HTTPS). Row-level security ensures content is accessible only to its owning user or business. Document content is never written to logs.

**Priority:** Must

**Acceptance criteria:** All tables have RLS enabled. All RLS policies are verified in testing. HTTPS enforced (HSTS). Edge Function logs contain only structured metadata (timestamps, event types, status codes) — never document content, prompt content, or personal data. Security test: one user cannot read another user's data via any API path.

---

### NFR-005 — Privacy: Australian Privacy Principles, consent

**Statement:** Alignment with the Australian Privacy Act 1988 (APP). Privacy policy and terms are live at littlemissscarlett.co/privacy and /terms. AI processing disclosure and consent obtained in onboarding.

**Priority:** Must

**Acceptance criteria:** Privacy policy and terms URLs return 200 and substantive content (not placeholder). AI disclosure modal is shown in onboarding before any data is processed. Privacy policy names the AI processing purpose. Account deletion removes all user data within 24 hours.

---

### NFR-006 — Reliability: provider fallback, graceful degradation

**Statement:** A single AI provider outage must not block the user from completing their outcome. Web search unavailability degrades gracefully (checklist generation continues without live research, with a note to the user).

**Priority:** Must

**Acceptance criteria:** If the primary provider returns an error after 1 retry, the gateway falls back to the secondary provider automatically. The user sees "TED hit a small snag, trying again" — never a technical error. Web search failure shows "TED couldn't get live information — using general guidance instead" and continues.

---

### NFR-007 — Performance: UI responsiveness

**Statement:** All navigation transitions complete within 200ms. Section edits reflect immediately (optimistic update). The Library loads within 1 second.

**Priority:** Should

---

### NFR-008 — Scalability: stateless functions, per-account isolation

**Statement:** Edge Functions are stateless. Per-account data isolation is enforced via RLS. Templates and bundles are data, not code.

**Priority:** Must

---

### NFR-009 — Maintainability: configuration-driven routing and templates

**Statement:** Provider routing and template library are configuration/data, updatable without a rebuild. Model mapping lives in Supabase secrets or a config table.

**Priority:** Must

---

### NFR-010 — Cost control: AI cost monitoring, fair-use ceilings

**Statement:** AI API costs are monitored per provider and per plan. Fair-use ceilings on unlimited plans are configurable constants read from environment variables.

**Priority:** Must

---

## 2.7 System Architecture Overview

See Phase 3 (§3.x) for full diagrams and component maps. Summary:

```
Client (Web / iOS)
  │
  ├── Home screen → intent input
  ├── Summary card → recommendation confirmation
  ├── Document workspace → section editing, approval
  ├── Library → past work, checklists, due dates
  └── Settings → profile, brand kit, subscription, Clari

  │ HTTPS (Netlify proxy → /api/*)
  ▼

Supabase Edge Functions (server-mediated, provider keys never reach client)
  ├── interpret-intent
  ├── recommend
  ├── clarify
  ├── generate-document (streams)
  ├── generate-report
  ├── generate-checklist
  ├── edit-section
  ├── ingest-upload
  ├── research (web search)
  └── render-export (PDF / Word / Excel)

  │
  ├── AI Provider Gateway
  │     ├── OpenAI (GPT-4.1-nano / GPT-5.5 / o3)
  │     ├── Anthropic (claude-sonnet-4 / claude-opus-4)
  │     └── Google (Gemini 2.5 Pro / Flash)
  │
  ├── Supabase Postgres (RLS on all tables)
  ├── Supabase Auth
  └── Supabase Storage (uploads, brand logos)

  │
  └── RevenueCat (webhook → subscriptions table)
```

---

## 2.8 Frontend Architecture

**Web:** Next.js 15 (App Router) deployed on Netlify. Responsive. No SSR required for V1 (all data is user-specific behind auth).

**Mobile:** Expo SDK 52+ / React Native. iPhone-first. iOS first, Android follow.

**Shared design system:** A single token set (colour, typography, spacing, components) published as an npm package or shared directory. Both web and mobile import the same tokens so behaviour and visual identity are identical.

**State management:**
- Server state: React Query (TanStack Query) for all Supabase data
- UI state: React Context or Zustand for workspace state, draft state, and modal state
- No Redux or heavy state libraries

**Key libraries:**
- `@supabase/supabase-js` — database, auth, storage
- `@tanstack/react-query` — server state
- `react-hook-form` + `zod` — form validation
- `framer-motion` — animations (respects reduced-motion)
- `react-pdf` or equivalent — PDF preview (not PDF generation; that's server-side)

**Component architecture:** Atomic — atoms (Button, Input, Badge), molecules (SectionCard, DocumentCard, TemplateChip), organisms (WorkspacePane, ChatInput, RecommendationCard), pages/screens.

---

## 2.9 Backend Architecture

**Supabase project:** Single project for V1. Separate projects for development, staging, production.

**Edge Functions (Deno/TypeScript):** All AI calls, upload ingestion, export rendering, and RevenueCat webhooks are Edge Functions. No server-side Node.js process required.

**Netlify proxy:** `/api/*` routes in `netlify.toml` proxy to Supabase Edge Function URLs. The browser calls `/api/interpret-intent`; Netlify forwards to `https://<project>.supabase.co/functions/v1/interpret-intent`.

**Provider keys:** Stored in Supabase secrets (never in environment variables exposed to the client, never in code).

**Supabase Storage:** Used for user file uploads (PDF, Word, images) and brand kit logos. Storage buckets: `uploads` (private, RLS), `brand-assets` (private, RLS).

---

## 2.10 Database Design

Full DDL is in Phase 3 (§3.5). Requirement-level specifications:

### DB-001 — profiles

**Columns:** id (uuid, FK auth.users), display_name, email (optional), phone (optional), plan (free/pro/premium/business), acknowledged_advice_boundaries (JSONB), clari_ref (FK clari_preferences), created_at, updated_at  
**RLS:** select/update own row only  
**Trigger:** set_updated_at  

### DB-002 — businesses

**Columns:** id, owner_user_id (FK profiles), trading_name, legal_name, abn (optional), address, phone, email, website, industry, voice_descriptor, created_at, updated_at  
**RLS:** select/update/delete by owner_user_id  

### DB-003 — memberships

**Columns:** id, business_id (FK businesses), user_id (FK profiles), role (admin/member)  
**V1 note:** Single admin per business in V1. Multi-seat is V2.  

### DB-004 — clari_preferences

**Columns:** id, user_id (FK profiles), reading_level (simple/moderate/detailed), tone (casual/professional), detail_level (low/medium/high), updated_at  
**RLS:** select/update own row only  

### DB-005 — templates

**Columns:** id, name, domain, category, plain_description, structure_type (compose/structured_form/checklist), sections (JSONB), fields (JSONB), missing_detail_rules (JSONB), fill_from_profile (JSONB), recommendation_reason, related_document_ids (JSONB), advice_boundary (none/light/high-stakes), brandable (bool), flags (JSONB), is_published (bool), display_order  
**RLS:** public read (no RLS), admin write  

### DB-006 — bundles

**Columns:** id, name, description, domain, template_ids (JSONB ordered array), checklist_template_id (nullable FK templates), display_order, is_published (bool)  
**RLS:** public read  

### DB-007 — outcomes

**Columns:** id, user_id (FK profiles), business_id (nullable FK businesses), bundle_id (nullable FK bundles), situation_text, recommendation_payload (JSONB), status (draft/in_progress/completed), created_at, updated_at  
**RLS:** select/insert/update/delete by user_id  

### DB-008 — documents

**Columns:** id, outcome_id (FK outcomes), user_id (FK profiles), template_id (FK templates), title, status (draft/approved/exported/archived), format (pdf/word/excel), created_at, updated_at  
**RLS:** by user_id  

### DB-009 — sections

**Columns:** id, document_id (FK documents), user_id (FK profiles), name, order_index, content (text), status (draft/edited/approved/locked), version_history (JSONB array of {content, saved_at}), created_at, updated_at  
**RLS:** by user_id  

### DB-010 — uploads

**Columns:** id, user_id (FK profiles), outcome_id (nullable FK outcomes), storage_path, file_type, file_name, file_size_bytes, extracted_text (text), extracted_payload (JSONB), created_at  
**RLS:** by user_id  

### DB-011 — checklist_items

**Columns:** id, outcome_id (FK outcomes), user_id (FK profiles), text, due_date (nullable date), reason (text), done (bool, default false), reminder_offset_days (int nullable), reminder_sent (bool), order_index, created_at, updated_at  
**RLS:** by user_id  

### DB-012 — brand_kits

**Columns:** id, business_id (FK businesses), logo_url (nullable), primary_colour (hex), secondary_colour (hex nullable), footer_text (nullable), updated_at  
**RLS:** by business owner via memberships  

### DB-013 — company_profile

**Columns:** id, business_id (FK businesses, unique), voice_tone (text), reusable_clauses (JSONB array of {label, content}), extra_fields (JSONB), updated_at  
**RLS:** by business owner  

### DB-014 — subscriptions

**Columns:** id, user_id (FK profiles), business_id (nullable FK businesses), plan (free/pro/premium/business), status (active/expired/cancelled/trialing), revenuecat_customer_id, entitlements (JSONB), period_start, period_end, updated_at  
**RLS:** select/update by user_id  

### DB-015 — usage_ledger

**Columns:** id, user_id (FK profiles), business_id (nullable FK businesses), event_type (document_created/ai_edit), created_at  
**No updates — append only.** Caps evaluated by counting rows within the current billing period.  
**RLS:** select by user_id  

### DB-016 — audit_logs

**Columns:** id, user_id (FK profiles), event_type (auth_signin/auth_signout/document_export/account_deleted/data_breach_attempt), metadata (JSONB), created_at  
**RLS:** none (server-write only via Edge Function service role)  

### DB-017 — export_history

**Columns:** id, user_id (FK profiles), document_id (FK documents), format (pdf/word/excel/bundle), filename, created_at  
**RLS:** select by user_id  

---

## 2.11 API Design

All endpoints are Supabase Edge Functions, proxied via Netlify `/api/*`.

### API-001 — interpret-intent

**Method:** POST `/api/interpret-intent`  
**Body:** `{ input: string, attachments?: FileRef[], session_id?: string }`  
**Response:** `{ domain: string, situation: string, confidence: number, clarifying_questions?: string[] }`  
**Notes:** If `confidence < 0.75`, returns up to 2 questions. Otherwise returns confidence ≥ 0.75 with no questions.

### API-002 — recommend

**Method:** POST `/api/recommend`  
**Body:** `{ domain: string, situation: string, clarification_answers?: string[], user_id?: string }`  
**Response:** `{ primary: RecommendationItem, variants: RecommendationItem[2], bundle?: BundleRef }`  
**RecommendationItem:** `{ template_id: string, name: string, format: string, reason: string, use_case: string, benefits: string[] }`

### API-003 — clarify

**Method:** POST `/api/clarify`  
**Body:** `{ domain: string, situation: string, history: ClarifyTurn[], answer: string }`  
**Response:** Same as `interpret-intent` (either the next adaptive question or the recommendation)  
**Notes:** No fixed question cap. The endpoint returns `intent_clear: true` with a recommendation as soon as confidence is sufficient; otherwise it returns the next single question, generated in response to the latest answer.

### API-004 — generate-document (streaming)

**Method:** POST `/api/generate-document`  
**Body:** `{ template_id: string, outcome_id: string, profile: ProfileData, company_profile?: CompanyProfileData, extra_context?: string }`  
**Response:** SSE stream of `{ section: string, content_chunk: string, done: boolean }`  
**Notes:** Streams section content as it is generated. Each event names the section being filled.

### API-005 — generate-report

**Method:** POST `/api/generate-report`  
**Body:** `{ outcome_id: string, upload_ids: string[], document_type?: string }`  
**Response:** `{ document_id: string, chart_specs: ChartSpec[], streaming: true }` → then SSE stream  
**Notes:** Chart specifications are returned as part of the response for server-side render.

### API-006 — generate-checklist

**Method:** POST `/api/generate-checklist`  
**Body:** `{ outcome_id: string, situation: string, domain: string }`  
**Response:** `{ items: ChecklistItem[] }` where item = `{ text, due_date, reason, reminder_offset_days }`

### API-007 — edit-section

**Method:** POST `/api/edit-section`  
**Body:** `{ section_id: string, action: 'improve'|'shorten'|'expand'|'change_tone'|'add_detail', selection?: string }`  
**Response:** SSE stream of revised section content

### API-008 — ingest-upload

**Method:** POST `/api/ingest-upload`  
**Body:** multipart/form-data with `file` and `outcome_id`  
**Response:** `{ upload_id: string, extracted_text: string, extracted_payload: object, confirm_payload: ConfirmPayload }`  
**ConfirmPayload:** `{ summary: string, key_details: string[] }` — shown on summary card for user confirmation

### API-009 — research

**Method:** POST `/api/research`  
**Body:** `{ query: string, categories: string[], locale?: string, timezone?: string }`  
**Response:** `{ results: string, sources: string[], cached_at: string }`

### API-010 — render-export

**Method:** POST `/api/render-export`  
**Body:** `{ document_ids: string[], format: 'pdf'|'word'|'excel'|'bundle', brand_kit_id?: string }`  
**Response:** Binary file download (Content-Disposition: attachment)  
**Notes:** Only exports sections with status = 'approved'. Applies brand kit if `brand_kit_id` supplied.

### API-011 — RevenueCat webhook

**Method:** POST `/api/webhooks/revenuecat`  
**Auth:** HMAC signature verification  
**Body:** RevenueCat webhook event  
**Action:** Updates `subscriptions` table; resets `usage_ledger` on renewal

---

## 2.12 Authentication and Authorisation

### SEC-001 — Supabase Auth

**Statement:** Authentication uses Supabase Auth. Sign in with Apple offered on iOS. Email/password and Google OAuth available on web.  
**Priority:** Must  
**Acceptance criteria:** Users can sign in/up via email, Google, and Apple. Sessions persist across app restarts. Tokens auto-refresh.

### SEC-002 — Anonymous sessions

**Statement:** New users get an anonymous Supabase session on first load. Work created in anonymous session is migrated to authenticated user on sign-up.  
**Priority:** Must

### SEC-003 — JWT on every API call

**Statement:** Every Edge Function call includes the Supabase JWT in the Authorization header. Server validates the JWT before processing.  
**Priority:** Must

### SEC-004 — Row-level security on all tables

**Statement:** RLS is enabled on every user-content table. Policies restrict each row to its owning user_id or business_id (via memberships).  
**Priority:** Must  
**Acceptance criteria:** Security test: authenticated user A cannot read, update, or delete rows owned by user B via any API path.

### SEC-005 — Optional 2FA for business exports

**Statement:** Business accounts can enable 2FA (TOTP). High-value exports (full bundle, financial reports) prompt 2FA verification if enabled.  
**Priority:** Should

### SEC-006 — HTTPS enforced

**Statement:** All traffic uses HTTPS. HSTS header set. HTTP redirects to HTTPS.  
**Priority:** Must

---

## 2.13 AI Provider Integration

### AI-001 — Provider-agnostic router

**Statement:** A single internal interface wraps all three providers. Product code calls the interface; the interface routes to the selected provider.  
**Priority:** Must

### AI-002 — OpenAI integration

**Statement:** OpenAI models available: gpt-4.1-nano (fast/cheap), gpt-4.1-mini (balanced), gpt-5.5 (high-quality / high-reasoning), o3 (deep reasoning).  
**Priority:** Must

### AI-003 — Anthropic integration

**Statement:** Anthropic models available: claude-sonnet-4 (default), claude-opus-4 (high-quality drafting), claude-haiku-4-5 (fast).  
**Priority:** Must

### AI-004 — Google integration

**Statement:** Google models available: gemini-2.5-pro (long context / analytical), gemini-2.5-flash (fast).  
**Priority:** Should (V1 wired but task routing may initially focus on OpenAI/Anthropic)

### AI-005 — Automatic fallback

**Statement:** On provider error (429, 5xx), gateway automatically retries with next provider in fallback chain. Max 2 fallback attempts before returning user-safe error.  
**Priority:** Must

---

## 2.14 Prompt Orchestration Layer

### AI-011 — Intent interpretation prompt

The system prompt for `interpret-intent` includes:
- Role: "You are TED, an Australian AI assistant that helps people produce finished documents and plans."
- Task: "Read the user's situation and identify: (1) domain (employment/education/business/personal), (2) a one-sentence summary of what they are trying to achieve, (3) a confidence score 0.0–1.0. If confidence < 0.75, return a single targeted clarifying question, responsive to the conversation so far."
- Convergence rule: "Ask one warm, plain-English question at a time, each building on the last answer. Commit to a recommendation as soon as confidence ≥ 0.75. Do not batch questions, do not interrogate, and do not pad the conversation — get to the recommendation as soon as you genuinely understand the intent."

### AI-012 — Document generation system prompt

The system prompt for `generate-document` includes:
- Template structure (sections/fields with their names and types)
- Profile pre-fill data
- Domain intelligence pack (from existing implementation)
- No-fabrication rule: "Use only information the user provided. Do not invent names, dates, figures, or personal details."
- Advice boundary instruction (if `adviceBoundary = 'high-stakes'`)
- Clari style instruction (from user's clari_preferences)
- Output format: JSON with each section as a key

### AI-013 — Checklist generation system prompt

Includes: domain, situation, web search results, Clari preferences.  
Output: JSON array of checklist items with `text`, `due_date`, `reason`, `reminder_offset_days`.  
No-fabrication rule: "All time-sensitive facts (entitlements, safety standards, regulations) must be grounded in the search results. Do not fabricate current guidance."

### AI-014 — Section edit system prompt

Includes: current section content, action type, optional text selection.  
Constraint: "Edit only the selected section/text. Do not rewrite other sections. Do not change facts or figures."

### AI-015 — Document Intelligence Pack (existing, extend)

The existing domain intelligence pack in `anthropic-messages/index.ts` is the foundation. Extend to support all domain types in the SRS. Move to shared library consumed by all provider paths.

---

## 2.15 Document Generation System

See FR-004 (document generation), FR-005 (analytical reports), FR-017 (bundles), and E2 of the master SRS for template schema detail. Key system rules:

1. The Domain Engine owns document structure. The AI writes into it. AI never invents structure.
2. All 22 V1 templates are authored (as DB seed records) before build. No template is improvised at runtime.
3. Missing details trigger a targeted question per `missingDetailRules`, not a generic prompt.
4. Profile pre-fill is automatic. Fields flagged `fillFromProfile` are pre-populated.
5. Drafting streams. The user sees progress immediately.
6. The `review` pass (using the high-reasoning model) validates output before delivery — checks no-fabrication and advice boundaries.

---

## 2.16 Master Workspace System

See FR-007 and B8 of the master SRS.

**Desktop layout:** Three-pane CSS Grid.
- Left: Section list (240px). Shows all sections with status chips and an approval counter.
- Centre: Editor (flex). Shows the selected section's content with manual edit and "Edit with TED" panel.
- Right: Live preview (320px). Renders the document in a styled preview with brand kit applied.

**Mobile layout:** Stacked. Section list → section editor → preview (as three steps/tabs).

**Status flow:** Draft → (user or TED edits) → Edited → (user approves) → Approved → (user locks) → Locked.

**Export gate:** The export button is disabled until all required sections are Approved. The button label explains why ("Approve all sections to export").

---

## 2.17 Section Editor System

**Manual editing:** A rich-text editor (contenteditable or a lightweight library like Tiptap) for each section. Supports basic formatting: bold, italic, headings, lists, links. Dates and money fields use structured input pickers (not free text).

**AI editing:** "Edit with TED" panel appears when the user selects a section and taps/clicks "Edit with TED." Panel shows action buttons: Improve · Shorten · Expand · Change tone · Add detail. Text selection within a section enables "edit selection" mode.

**Version history:** Every save creates a version entry in the section's `version_history` JSONB array. A "history" icon shows previous versions with timestamps. Restoring a version replaces current content and adds a new version entry.

**Repeating sections:** Templates with array fields (e.g. job history in a resume) render an "Add another" button. Each entry in the array shows edit and delete controls.

**Derived fields:** Some values are computed automatically (e.g. job duration = end_date − start_date, formatted as "1 year, 5 months"). These are computed client-side and displayed read-only.

---

## 2.18 Project / History System

The Library (Library tab in navigation):

- **Recents:** last 5 outcomes in reverse chronological order, with title, domain chip, and light status
- **Saved:** outcomes the user bookmarked
- **Your Templates:** documents saved as reusable templates (flagged in `documents.is_template`)
- **Light status:** derived chip (Draft / In progress / Done) — no separate tracking engine
- **What's due:** upcoming checklist deadlines within 14 days, sorted by date, with item text and days remaining
- **Tap to resume:** opens the outcome at the exact point it was left (workspace, section, approval state)

---

## 2.19 Export System

See FR-008.

**PDF render:** Server-side via Edge Function. Library: Puppeteer (headless Chrome in Edge Function, subject to resource limits) or PDFKit. Preferred: a dedicated render service (Cloudflare Worker or Railway microservice) if Edge Function memory/time limits are tight.

**Word render:** `docx` npm library. Structurally mirrors the PDF.

**Excel render (Budget Workbook only):** `exceljs`. Protected formula cells (cells with formulas are locked). Editable input cells are unlocked. Dashboard sheet with summary charts.

**Brand kit application:** Logo is fetched from Supabase Storage, embedded in the render. Primary colour applied to headings and accents. Footer text added to each page.

**Bundle pack:** Combined PDF uses a cover page with the bundle name and output list. ZIP contains individual PDF and Word files.

---

## 2.20 Error Handling

### NFR-011 — Plain English errors

**Statement:** All user-facing errors are plain English, never codes. Errors reassure: "Nothing's been lost — let's try again." Every error offers a clear retry.

**Priority:** Must

**Examples:**
- Network error: "TED couldn't connect just now. Nothing's been lost — let's try again."
- AI error: "TED hit a small snag. We're trying again automatically."
- Upload failure: "We couldn't read that file. Try a different format or type your details instead."
- Export failure: "We couldn't create your file just now. Your work is saved — try again in a moment."

### NFR-012 — No technical errors surface to the user

**Statement:** HTTP status codes, error stack traces, provider names, and model names never appear in the UI.

**Priority:** Must

---

## 2.21 Logging and Monitoring

### NFR-016 — Structured logging in Edge Functions

**Statement:** Edge Functions log structured JSON events: `{ timestamp, event_type, function_name, duration_ms, status_code, user_id_hash }`. Never log document content, prompt content, or raw personal data.

**Priority:** Must

### NFR-017 — Error monitoring

**Statement:** Unhandled Edge Function exceptions are forwarded to an error monitoring service (Sentry or equivalent). Alerts fire for error rate >1% over 5 minutes.

**Priority:** Should

### NFR-018 — Product analytics

**Statement:** Basic analytics events are recorded: `outcome_started`, `recommendation_confirmed`, `document_generated`, `section_approved`, `document_exported`, `subscription_converted`. Events include only pseudonymous user IDs and event metadata — no content.

**Priority:** Should

---

## 2.22 Security Requirements

### SEC-010 — No provider keys in client code

**Priority:** Must  
**Acceptance criteria:** A search of the client bundle for any AI API key prefix (`sk-`, `AIza`, `ant-`) returns zero results.

### SEC-011 — CORS restriction

**Priority:** Must  
**Statement:** Edge Functions accept CORS only from `littlemissscarlett.co` and `localhost` (dev).

### SEC-012 — Rate limiting

**Priority:** Must  
**Statement:** AI endpoints are rate-limited per user: 60 requests/minute for chat, 10 requests/minute for document generation.

### SEC-013 — Input size limits

**Priority:** Must  
**Statement:** Text input capped at 20,000 characters. Upload size capped at 20MB.

### SEC-014 — Injection prevention

**Priority:** Must  
**Statement:** All user input is sanitised before inclusion in AI prompts. SQL injection is prevented by Supabase parameterised queries. XSS prevented by React's default escaping.

---

## 2.23 Privacy Requirements

### SEC-026 — Australian Privacy Principles alignment

**Priority:** Must  
**Statement:** Data collection is limited to what is necessary for the service. Users can access, correct, and delete their data.

### SEC-027 — Privacy policy and terms

**Priority:** Must  
**Statement:** Live, substantive privacy policy at `littlemissscarlett.co/privacy`. Terms at `littlemissscarlett.co/terms`. Both are linked in-app and in App Store Connect.

### SEC-028 — No cross-app tracking

**Priority:** Must  
**Statement:** PrompTED does not track users across other companies' apps or websites. No third-party analytics that perform cross-app tracking.

### SEC-029 — AI processing disclosure

**Priority:** Must  
**Statement:** Onboarding modal discloses that documents are processed by external AI services. No provider names. Privacy policy reflects this.

---

## 2.24 Data Retention Requirements

### SEC-036 — Autosave retention

**Priority:** Must  
**Statement:** All user work is retained indefinitely while the account is active. Work is associated with the account and restored on any device.

### SEC-037 — Account deletion

**Priority:** Must  
**Statement:** Account deletion removes all user data (profiles, documents, sections, uploads, checklist_items, clari_preferences) within 24 hours. Cascading deletes in the schema handle the removal.

### SEC-038 — Anonymous session expiry

**Priority:** Must  
**Statement:** Anonymous sessions expire after 30 days. Work from expired anonymous sessions is deleted automatically.

### SEC-039 — Log retention

**Priority:** Should  
**Statement:** Structured logs retained for 30 days. Audit logs retained for 12 months.

---

## 2.25 Performance Requirements

### NFR-021 — First visible draft content: ≤2 seconds

See NFR-001.

### NFR-022 — Navigation transitions: ≤200ms

All client-side navigation transitions complete within 200ms.

### NFR-023 — Library load: ≤1 second

The Library screen loads within 1 second from cache or within 2 seconds on first load.

### NFR-024 — Export: ≤30 seconds

PDF/Word export completes within 30 seconds for a standard single document.

### NFR-025 — Upload ingestion: ≤10 seconds

File upload and text extraction complete within 10 seconds for files ≤5MB.

---

## 2.26 Accessibility Requirements

### NFR-026 — 17pt minimum body text

**Priority:** Must  
**Statement:** All body text is at least 17pt (approximately 22.67px at 96dpi). System font sizes are respected if larger.

### NFR-027 — WCAG 2.1 AA contrast

**Priority:** Must  
**Statement:** All text/background pairs achieve at minimum 4.5:1 contrast ratio (AA). AAA (7:1) preferred where achievable.

### NFR-028 — VoiceOver / screen reader support

**Priority:** Must  
**Statement:** All interactive elements have accessible labels. Document structure uses semantic HTML (web) or accessibility roles (native). Screen reader flows are tested on iOS VoiceOver.

### NFR-029 — Reduced motion

**Priority:** Must  
**Statement:** All non-essential animations respect `prefers-reduced-motion: reduce`. Essential state changes (loading, success) use opacity only in reduced-motion mode.

### NFR-030 — Touch targets

**Priority:** Must  
**Statement:** All interactive elements have a minimum touch target of 44×44pt.

---

## 2.27 Testing Requirements

### TEST-001 — Unit tests

**Scope:** Domain Engine template assembly; derived field calculations (job duration); profile pre-fill mapping; no-fabrication assertion (mock AI returns invented figure → test rejects it); Clari reading-level injection.  
**Framework:** Vitest or Jest  
**Coverage target:** ≥80% on domain engine, template, and utility code

### TEST-002 — Integration tests

**Scope:** Provider gateway routing and fallback; upload ingestion (PDF, Word, photo OCR); export rendering (PDF, Word, Excel with charts/tables); entitlement enforcement via usage ledger; RevenueCat webhook sync.

### TEST-003 — End-to-end tests

**Scope:** Core loop (Home → recommendation → draft → workspace → approve → export) on web; each of the four bundles; a standalone research-backed checklist; an analytical report from an uploaded dataset.  
**Framework:** Playwright (web)  
**Devices:** Tested on iPhone 15 Pro simulator and Chrome desktop

### TEST-004 — Accessibility tests

**Scope:** 17pt floor, AA contrast (automated via axe), VoiceOver (manual iOS), reduced motion.  
**Tools:** axe-core, Lighthouse accessibility audit

### TEST-005 — Security tests

**Scope:** RLS isolation (user A cannot read user B's data); auth (unauthenticated calls rejected); no provider keys in client bundle; no document content in logs; account deletion completeness.

### TEST-006 — Content QA

**Scope:** All 22 templates produce correctly structured output; no-fabrication guardrail on financial/scientific reports; advice-boundary notices on high-stakes documents.  
**Method:** Manual review of generated output for each template against template spec

### TEST-007 — UAT

**Scope:** Beta with target personas (Maria, Daniel, Sam, Priya). Core loop on iPhone and web. Acceptance against H3 criteria from master SRS.

---

## 2.28 Deployment Requirements

### DEP-001 — Environments

**Statement:** Three environments: development (local Supabase), staging (Supabase staging project + Netlify deploy preview), production (Supabase production + Netlify production).

### DEP-002 — Netlify deploy

**Statement:** Web app deployed from `main` branch (production) and feature branches (preview). Build command: `npm run build`. Publish directory: `.next/` (Next.js) or `.` (static).

### DEP-003 — Supabase migrations

**Statement:** All schema changes applied via SQL migration files in `supabase/migrations/`. Migrations run via `supabase db push` or CI pipeline. Never modify production schema directly.

### DEP-004 — Edge Function deploy

**Statement:** Edge Functions deployed via `supabase functions deploy <name>` from CI. Secrets set via `supabase secrets set`.

### DEP-005 — App Store submission

**Statement:** iOS app submitted via Xcode / EAS Build (Expo). All G7 checklist items verified before submission. Demo credentials and reviewer notes provided.

### DEP-006 — Environment variables

**Statement:** All secrets are environment variables. Client-safe vars (Supabase URL, anon key) are in `.env.local` (local) and Netlify environment variables (production). Server-secret vars (provider API keys) are Supabase secrets only.

---

## 2.29 Maintenance Requirements

### MAINT-001 — Template library upkeep

**Statement:** Review generated-blueprint demand monthly. Promote popular long-tail document types into authored templates.

### MAINT-002 — Provider routing config update

**Statement:** Update task-to-provider mapping as models change. No rebuild required — update Supabase secret.

### MAINT-003 — Web search sourcing compliance

**Statement:** Review web search sources quarterly for terms-of-service compliance. No scraping of sites that forbid it.

### MAINT-004 — AI cost monitoring

**Statement:** Track AI spend per provider and per plan weekly. Alert if spend exceeds 120% of budget. Tune fair-use ceilings as needed.

### MAINT-005 — Legal/compliance refresh

**Statement:** Review Fair Work references, advice boundaries, privacy policy, and AU entitlement facts in checklists annually or when relevant legislation changes.

### MAINT-006 — Security patching

**Statement:** Patch npm dependencies monthly. Rotate provider API keys quarterly. Monitor Edge Function error rates daily.

### MAINT-007 — Accessibility re-checks

**Statement:** Run axe-core and manual VoiceOver check after every significant UI change.

---

## 2.30 Contractor Task Breakdown

Tasks are sequenced by dependency. Each task maps to one developer or a named pair.

| # | Task | Phase | Est. days | Owner | Dependencies |
|---|------|-------|-----------|-------|-------------|
| T-01 | Design token system + component library foundation | Phase 5 Layer 2 | 3 | Frontend | None |
| T-02 | Supabase schema migration (full V1 schema) | Phase 5 Layer 1 | 2 | Backend | None |
| T-03 | App shell, routing, and navigation | Phase 5 Layer 3 | 2 | Frontend | T-01 |
| T-04 | AI gateway: provider router + fallback | Phase 5 Layer 5 | 3 | Backend | T-02 |
| T-05 | Chat home screen | Phase 5 Layer 4 | 2 | Frontend | T-03 |
| T-06 | Intent interpretation Edge Function | Phase 5 Layer 6 | 2 | Backend | T-04 |
| T-07 | Recommendation checkpoint UI + API | Phase 5 Layer 7 | 3 | Frontend + Backend | T-05, T-06 |
| T-08 | Template library (seed data, all 22 templates) | Phase 5 Layer 10 | 5 | Content/Backend | T-02 |
| T-09 | Document generation Edge Function (streaming) | Phase 5 Layer 6 | 3 | Backend | T-04, T-08 |
| T-10 | Master Workspace UI | Phase 5 Layer 8 | 4 | Frontend | T-03, T-07 |
| T-11 | Section editor (manual + AI) | Phase 5 Layer 9 | 3 | Frontend | T-10 |
| T-12 | Checklist/action plan generation + UI | Phase 5 Layer 6 | 3 | Full-stack | T-06, T-09 |
| T-13 | Bundle system | Phase 5 Layer 10 | 2 | Full-stack | T-08, T-09 |
| T-14 | Upload ingestion Edge Function | Phase 5 Layer 5 | 2 | Backend | T-04 |
| T-15 | Export system (PDF + Word + Excel) | Phase 5 Layer 11 | 4 | Backend | T-10 |
| T-16 | User accounts + auth flow | Phase 5 Layer 12 | 2 | Full-stack | T-02 |
| T-17 | Business profile + brand kit | Phase 5 Layer 12 | 2 | Full-stack | T-16 |
| T-18 | Library + autosave + history | Phase 5 Layer 13 | 3 | Full-stack | T-10, T-16 |
| T-19 | Monetisation: RevenueCat + usage ledger | Phase 5 Layer 12 | 3 | Backend | T-16 |
| T-20 | Clari personalisation | Phase 5 Layer 6 | 2 | Backend | T-06 |
| T-21 | Web search (research Edge Function) | Phase 5 Layer 5 | 1 | Backend | T-04 |
| T-22 | Security hardening (RLS audit, CORS, rate limiting) | Phase 5 Layer 15 | 2 | Backend | T-02, T-16 |
| T-23 | Accessibility pass (17pt, AA, VoiceOver, motion) | Phase 5 Layer 15 | 2 | Frontend | T-10 |
| T-24 | Compliance: AI disclosure, privacy policy, account deletion | Phase 5 Layer 15 | 2 | Full-stack | T-16 |
| T-25 | Testing: unit, integration, E2E, security | Phase 5 Layer 16 | 5 | QA | All |
| T-26 | Deployment: Netlify, Supabase prod, CI pipeline | Phase 5 Layer 17 | 2 | DevOps | All |
| T-27 | App Store submission | Phase 5 Layer 17 | 3 | iOS / DevOps | T-26 |
| T-28 | Monitoring: Sentry, analytics, cost alerting | Phase 5 Layer 18 | 2 | Backend | T-26 |

**Total estimate:** ~70 developer-days for a two-developer team (~7 weeks at 5 days/week), assuming template content authoring is concurrent with engineering.
