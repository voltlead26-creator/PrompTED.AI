# PrompTED — Implementation Log

**Format:** newest entry first.

---

## 21 July 2026 — Faster finished-first drafts and educated assumption policy

### Product direction
PrompTED's first draft must be complete enough to use without mandatory editing.
TED should ask only for facts that materially affect correctness or safety, and
should make ordinary professional document choices for the user.

### Changed
- `prompt-builder.ts` now distinguishes safe professional assumptions from
  facts TED must never invent. TED decides structure, ordering, tone, neutral
  wording, standard headings and sensible next steps without interrogating the
  user.
- `document-pipeline.ts` records safe assumptions in the outcome brief and
  applies them consistently during writing and independent audit.
- Section generation now uses bounded concurrency (maximum three provider
  requests) while preserving template order.
- A failed audit now rewrites only affected sections. A document-level issue,
  missing key or malformed key safely falls back to a whole-document repair.
- Hermetic tests cover concurrency, ordering, targeted repair, merge behaviour
  and fail-safe audit routing.

### Expected impact
- Lower time to first finished document, especially for multi-section outputs.
- Lower provider cost when the independent audit requests corrections.
- Fewer unnecessary clarification questions.
- More decisive, complete documents without weakening factual safeguards.

### Deployment
Not deployed. This change requires CI, review and deliberate Edge Function
deployment before production behaviour changes.

---

## 14 July 2026 — Cap scoped to document creation; paywall surfaced honestly; Excel support; structured upload read-back

### Trigger
Founder live-testing hit the free-plan cap (3 docs) mid-session. Because the
cap check ran inside guardRequest on EVERY protected call, the paywall then
blocked uploads, section regenerates — including repairs of TED's own
incomplete sections — and the client's catch-all showed "TED couldn't read
that file" for a 402 billing state. Excel uploads failed separately because
xlsx extraction never existed.

### Changed
**Cap + paywall (product-doctrine fix)**
- `_shared/auth-guard.ts` — `guardRequest(req, { enforceCap })`; the monthly
  cap now meters NEW DOCUMENT CREATION ONLY. Boolean second args from retired
  signatures are tolerated and ignored.
- `enforceCap: false` set in: ingest-upload, edit-section, explain-section,
  proofread-document, render-export, clarify, interpret-intent, recommend,
  research, job-match. Cap remains on generate-document, generate-checklist,
  generate-report. A capped user can always read, repair and export what they
  already created.
- `HomeScreen.tsx` — upload errors now surface the server's plain-English
  message (paywall, unsupported type, too big) instead of blaming the file.

**Upload intelligence**
- `ingest-upload` — xlsx/xls/xlsm extraction via SheetJS (per-sheet CSV with
  sheet-name headers); read-back upgraded from one flat sentence to a
  structured mirror: { document_type, purpose (TED's own words, 1-3
  sentences), sections[] mirroring the document's own headings/entries }.
  All of it fail-soft: a parse failure never fails the upload.
- `api-client` — typed `IngestUploadConfirmPayload`.
- `PhotoConfirmation.tsx` — renders the document's own structure
  (Master-Workspace-style sections) instead of a flat <pre> dump; raw text
  remains reachable via "Looks wrong? Edit".

### Data change (production)
- Founder account `1aa75d74…` given `business` plan subscription
  (entitlements: source=founder_account) to unblock testing.

### Checks run
- Standalone tsc syntax pass on all 14 edited files: clean (remaining
  diagnostics are isolated-check artifacts). Monorepo CI is the merge gate.

### Remaining
- Thin-section generation quality (one-sentence sections) still open —
  pre-cap 200s; needs a reproduction now that the account is uncapped.
- Usage ledger `document_created` is written client-side (`lib/usage.ts`) —
  cap integrity depends on the client being honest. Move server-side.

---


## 13 July 2026 — TED decides job-search routing (keyword gatekeeper removed)

### Why
Follow-up to the job-search hijack fix. The narrowed keyword check was still a
word-matching gatekeeper standing in front of TED, contradicting the product
doctrine that TED interprets meaning, not wording. Kai's direction: every
message should be interpreted and translated; the mode must change with new
user input.

### Design
Every message now goes to TED first. TED's JSON reply includes a new
`job_search` boolean it may set to true ONLY when the user's latest message
explicitly asks to find live job openings. The client routes to jobMatch only
when TED says so, re-decided fresh each turn — so the user enters and leaves
the job flow just by talking normally.

### Changed
- `packages/shared/src/orchestration.ts` — `IntentResult.jobSearch`;
  `coerceIntentResult` accepts only an explicit boolean `true` (strings,
  numbers, absence all coerce to false — fail-safe toward the normal chat).
- `supabase/functions/_shared/prompt-builder.ts` — intent and clarify task
  schemas gain `job_search` with strict guidance: false for mere mentions of
  work/roles/locations, false when the user already has a job, false when
  unsure.
- `apps/web/src/hooks/useRecommendation.ts` — keyword classifier deleted;
  jobMatch now runs only when `next.jobSearch` is true, after TED has
  interpreted the message.
- Tests: `orchestration.test.ts` covers the coercion edge cases;
  `HomeScreen.test.tsx` literals updated for the new field.

### Checks run
- Standalone tsc syntax pass on edited files: clean.
- Coercion logic executed directly (node type-stripping): explicit true →
  true; "true"/1/absent/null → false.
- Full monorepo typecheck/vitest NOT run; CI on the PR is the gate.

### Behavioural notes
- Until the Edge Functions are redeployed, TED never emits `job_search`, so
  the flag is always false and the job flow is unreachable from chat. This is
  the safe failure direction, but it means the client change alone disables
  job matching — deploy the functions with it.
- The `question` field ordering in coerce is unchanged; recommendation logic
  untouched.

---


## 13 July 2026 — Clarify loop diagnosis: job-search hijack fix, upload context threading, forced-commit cap

### Trigger
A live transcript (training-checklist upload) showed TED asking the same
"mastering your role vs exploring other career options" question ~12 times,
ignoring every answer, then asking for the user's location "to match live job
listings" — to a user who repeatedly said they already have a job.

### Diagnosis (verified against deployed source, not assumed)
1. **PR #23 was already live** (clarify v284 contains the repair-retry block;
   the 11 July bulk deploy shipped it). It could not fix this transcript
   because the model was returning *valid* JSON every turn.
2. **Root cause — job-search hijack:** `isJobSearchRequest()` in
   `useRecommendation.ts` classified the ENTIRE combined context (including
   uploaded document text) and hardcoded "near richmond|melbourne" as
   job-board intent. The uploaded checklist plus a Richmond address routed
   every turn to `jobMatch`; `clarify` was never called once. The repeated
   question was jobMatch's `need_more_context.ask`.
3. **Secondary — clarify never saw uploads:** `ClarifyBody` had no
   `extracted_text`; upload text folded into the first history turn was
   truncated by the 8k per-turn slice.
4. **Tertiary — no termination guarantee:** SRS forbids indefinite loops on a
   cooperative user, but nothing enforced it server-side.

### Changed
- `apps/web/src/hooks/useRecommendation.ts` — `isJobSearchRequest` now
  classifies the user's LATEST message only, requires an explicit search
  action + jobs object, honours opt-outs ("I have a job", "not exploring"),
  and drops the hardcoded suburb patterns. `continue` turns now pass upload
  context as `extractedText`.
- `apps/web/src/hooks/useInterpretIntent.ts` — `continue()` accepts and
  forwards `extractedText`.
- `packages/shared/src/api-client/index.ts` — `ClarifyInput.extracted_text`.
- `supabase/functions/clarify/index.ts` — accepts `extracted_text` with its
  own 20k budget as a dedicated context turn; near-repeat question detection
  (token-overlap ≥ 0.7 vs prior assistant turns); forced-commit after 4
  assistant questions (one commit-demanding retry, then an honest
  `intent_clear: true, recommendation: null` surrender that the client's
  existing `recommend()` safety net converts into a recommendation).

### Tests/checks run
- Standalone `tsc --noEmit` per edited file: no syntax errors; remaining
  diagnostics are module-resolution/Deno-types artifacts of isolated checking.
- Full monorepo typecheck/lint NOT run (edits made via GitHub API); CI on the
  PR must pass before merge.

### Not deployed
- Edge Function change ships only on the next deliberate deploy. NOTE:
  deploying `clarify` from branch HEAD also ships the current branch
  `_shared/auth-guard.ts`, which removed anonymous access (FR-012 retired) —
  the deployed guard still allows it. That behavioural change must be a
  conscious decision, not a side effect.

### Remaining issues / next steps
- Deploy decision for clarify + auth-guard drift (above).
- `interpret-intent` does not need the extracted_text change (already has it)
  but shares the auth-guard drift.
- jobMatch's own `ask` phrasing produced the confusing "exploring other
  career options" framing; worth a pass once routing is fixed.

---


## 2 July 2026 — Session audit and major build sprint

### Completed

**Brand identity**
- Replaced Violet Hour purple system with Little Miss Scarlett palette: Scarlet `#C8442B`, Ember `#E0883C`, Paper `#F7F1E7`, Ink `#2B2521`
- Replaced Nunito with DM Sans (single typeface, 400–700). Rationale: DM Sans is used by Australian Government Digital Services and carries the right trust register for PrompTED's non-tech-savvy Australian audience
- Two-colour TED wordmark: "Promp" in paper-tint, "TED" in scarlet
- Ink nav bar matching existing marketing site at `littlemissscarlett.co`
- `apps/web/public/` directory created for the first time; `favicon.svg` and `apple-touch-icon.svg` added
- `manifest.webmanifest`, `robots.txt`, `layout.tsx` viewport/OG metadata added
- `--font-nunito` reference in `globals.css` patched to `--font-body`
- Contrast tests updated (7 WCAG AA assertions, all passing)

**Template library**
- 53 templates confirmed (52 existing + new Profit & Loss Statement)
- All 53 carry `vital[]` and `improver[]` per section — wired end-to-end through `CatalogSection`, `findSectionMeta()`, `sectionListInstruction()`, and `generate-document` Edge Function
- 12 templates missing `missing_detail_rules` fixed; 2 checklist templates confirmed correct-by-design with empty rules
- `sanitise.ts` / `sanitize.ts` duplication resolved: `sanitize.ts` deleted, render path (LivePreview, SectionEditor, VersionHistory) consolidated on `sanitiseSectionContent` which permits `<a>` tags and attributes that the deleted version silently stripped

**Export pipeline**
- Format picker added to WorkspacePane: PDF / Word / Excel dropdown
- `WorkspaceScreen.handleExport` now passes selected format to `useExport.run()`
- Export approval gate error shown inline in toolbar with unapproved sections labelled in dropdown

**Document Intelligence Profiles**
- P&L/Financial Review keyword collision fixed: `selectProfile()` ties go to first array entry; "p&l"/"profit and loss" moved from financial-review profile to new profit-and-loss-statement profile
- Financial Review vital/improver rewritten to reference uploaded P&L line items specifically

**Infrastructure**
- Branch protection on `ClaudeTED.AI` confirmed (force-push/deletion blocked)
- CI/CD confirmed working (GitHub Actions → Netlify via git push to staging branch, not CLI)
- `SUPABASE_DB_PASSWORD` unset now fails loudly rather than skipping migration silently

### Files Changed (PRs #24–#31)

| PR | Files | What |
|---|---|---|
| #24 | `templates.data.json`, `LivePreview.tsx`, `SectionEditor.tsx`, `VersionHistory.tsx` | 12 template missing_detail_rules fixes; sanitise.ts consolidation |
| #25 | `templates/index.ts`, `template-engine.ts`, `document-generation.ts`, `generate-document/index.ts` | Option B wiring: vital/improver through type system and generation prompt |
| #27 | `templates.data.json`, `document-intelligence-profiles.ts` | All 53 templates with vital/improver content; new P&L template; DIP routing fix |
| #28 | `tokens.css`, `TopBar.tsx`, `TopBar.module.css`, `AppNav.module.css`, `contrast.test.ts`, `public/favicon.svg` | Violet Hour brand (subsequently replaced by #31) |
| #29 | `layout.tsx`, `public/apple-touch-icon.svg`, `public/manifest.webmanifest`, `public/robots.txt` | Brand meta, icons, OG, PWA manifest |
| #30 | `WorkspacePane.tsx`, `WorkspacePane.module.css`, `WorkspaceScreen.tsx` | Export format picker + approval gate inline error |
| #31 | `fonts.ts`, `tokens.css`, `layout.tsx`, `TopBar.tsx`, `TopBar.module.css`, `contrast.test.ts`, `favicon.svg`, `apple-touch-icon.svg`, `globals.css` | Little Miss Scarlett palette + DM Sans replaces Violet Hour + Nunito |

### Bugs Found During This Session (not in any prior audit)

| Bug | Severity | Status |
|---|---|---|
| `sanitize.ts` render path stripped `<a>` tags saved by `sanitise.ts` write path — links saved but silently degraded to plain text on every render | High | Fixed (PR #24) |
| `selectProfile()` keyword-overlap scoring: ties go to first array entry — "p&l" in financial-review profile would have silently misrouted P&L creation requests | High | Fixed (PR #27) |
| Budget Workbook vital/improver authored from wrong source — criteria doc described a business budget, live template is a personal budget | Medium | Fixed with original authoring (PR #27) |
| `WorkspaceScreen.handleExport` hardcoded `format: "pdf"` — no way for user to get Word export despite render-export supporting it | Medium | Fixed (PR #30) |
| Export gate error gave no recovery path — user couldn't see which sections to approve | Medium | Fixed (PR #30) |
| `public/` directory didn't exist — no favicon, no PWA manifest, no OG image reference | Low | Partially fixed (SVG assets added; PNG assets still needed) |

### Still Open

- Manual tests: P&L upload → Financial Review figure tracing; routing test for "create a P&L statement"
- `og-image.png` (1200×630) — not yet created
- `apple-touch-icon.png` (180×180 PNG) — SVG only so far; PNG needed for App Store
- `sitemap.xml` — referenced in robots.txt, doesn't exist
- `RENDER_SERVICE_URL` not configured — PDF export falls back to HTML
- Product identity governance resolved: TED is the single product-facing intelligence; retired persona and hierarchy documents were removed.
- Budget Workbook Excel format: `allowedFormats` prop not yet wired from template data into WorkspaceLoaded
- ChecklistScreen / SectionedChecklistScreen duplication unresolved
- Subscription enforcement not verified end-to-end

### Remaining Risk

The app has never been tested end-to-end against the live Supabase project in a real session with a real user. All structural and data integrity checks have passed programmatically, but the two manual tests flagged above (P&L upload, routing) are genuine unknowns until someone runs them live.
