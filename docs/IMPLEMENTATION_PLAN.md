# PrompTED — Implementation Plan

**Status:** Historical July 2026 audit snapshot; retained as evidence, not current implementation or deployment authority.
**Branch:** `ClaudeTED.AI`
**Last updated:** 2 July 2026

> Current authority: root `AGENTS.md` governs process and
> `docs/CANONICAL_ARCHITECTURE.md` governs the long-lived target design. Every
> completion, deployment, template-count, and live-state claim below must be
> re-verified against the exact checkout and environment before reuse.

---

## Current App Status

The app is substantially built. This is not a scaffold requiring a ground-up build. Direct audit findings:

| Layer | State |
|---|---|
| Framework | Next.js 15 / React 19 / pnpm monorepo — working |
| Design system | DM Sans + Little Miss Scarlett palette (Scarlet/Ember/Paper/Ink) — live as of today |
| Routes | home, library, outcomes/[id], workspace, conversation, checklist, plans, roles, settings — all exist |
| Components | 72 organism-level components — working |
| Edge Functions | 22 Supabase Edge Functions — deployed |
| Database | 18-table Postgres schema with RLS — deployed |
| Template library | 53 templates with vital/improver section criteria — complete |
| Export pipeline | PDF/Word/Excel via render-export Edge Function — wired end-to-end |
| Section editor | Tiptap rich text, autosave, approve/unapprove, version history — working |
| Upload pipeline | ingest-upload Edge Function + UploadAnalysisPanel — working |
| Auth | Supabase Auth with RLS — working |
| CI/CD | GitHub Actions → Netlify (git push to staging branch) — working |

---

## Confirmed Gaps (from audit, not from planning docs)

### P0 — Blockers

| Gap | Detail |
|---|---|
| Product identity governance | Resolved: `AGENTS.md` defines TED as the single product-facing intelligence. Retired persona and hierarchy documents have been removed. |
| Manual tests not run | Upload → Financial Review figure tracing; P&L routing to new template vs Financial Review; both need a live session against the real Supabase project. |
| No post-deploy smoke test | No automated release verification after Netlify deploy. |
| `og-image.png` missing | OpenGraph share previews show blank. Referenced in `layout.tsx` metadata but file doesn't exist. |
| `apple-touch-icon.png` missing | iOS App Store / pre-Safari-15.4 requires 180×180 PNG. SVG covers modern browsers only. |

### P1 — Quality gaps

| Gap | Detail |
|---|---|
| Budget Workbook Excel format not surfaced | `allowedFormats` prop exists in WorkspacePane but not wired from template data — Excel option never appears for Budget Workbook users. |
| `ChecklistScreen` vs `SectionedChecklistScreen` | Both exist, purpose overlap unresolved. |
| `sitemap.xml` missing | `robots.txt` references it; 404 from day one. |
| Sentry/OpenTelemetry coverage | Dependencies present, not verified as capturing real errors against live project. |
| RENDER_SERVICE_URL not set | PDF export falls back to HTML download. Real PDF requires a render service configured in Supabase env. |

### P2 — Deferred by decision

| Gap | Decision |
|---|---|
| Mobile (iOS/Android) | Expo scaffold exists. Deferred pending new hardware. |
| Subscription enforcement | RevenueCat + Stripe integrated at webhook level. Paywall modal exists. Tier enforcement in UI not verified end-to-end. |

---

## Build Phases — What Remains

Phases 1–6 from the original build instructions are substantially complete. Remaining work maps to these phases:

### Phase A — Verification (immediate)
- [ ] Run manual test: upload a real P&L, generate Financial Review, confirm figures trace
- [ ] Run manual test: "create a P&L statement" routes to Profit & Loss template not Financial Review
- [ ] Confirm Sentry is capturing errors in the live Supabase project
- [ ] Confirm per-function timeout/retry consistency on AI requests
- [ ] Test backup restore runbook

### Phase B — Polish gaps (this sprint)
- [ ] Wire `allowedFormats` from template data into WorkspaceLoaded so Excel appears for Budget Workbook
- [ ] Resolve ChecklistScreen duplication
- [ ] Generate `og-image.png` (1200×630) and commit to `public/`
- [ ] Generate `apple-touch-icon.png` (180×180) and commit to `public/`
- [ ] Add `sitemap.xml` (static or generated)

### Phase C — Pre-launch hardening
- [ ] Configure `RENDER_SERVICE_URL` in Supabase for real PDF output
- [ ] Verify subscription enforcement end-to-end (free tier limits, paywall gate, RevenueCat webhook)
- [ ] Add post-deploy smoke test to CI
- [ ] Verify Sentry release health tracking

### Phase D — iOS (deferred)
- [ ] Blocked on hardware. Expo scaffold at `apps/mobile/` is ready to build on.

---

## Files That Should Not Be Changed Without Audit

These files were touched during the July 2026 session and are in a known-good state:

- `packages/shared/src/templates/templates.data.json` — 53 templates, all with vital/improver, missing_detail_rules complete
- `supabase/functions/_shared/document-intelligence-profiles.ts` — P&L/Financial Review routing split confirmed correct
- `supabase/functions/_shared/template-engine.ts` — vital/improver wired into generation prompt
- `apps/web/src/lib/sanitise.ts` — canonical sanitizer; `sanitize.ts` (American spelling) deleted
- `apps/web/src/design-system/tokens.css` — Little Miss Scarlett palette, do not revert to Violet Hour
- `apps/web/src/design-system/fonts.ts` — DM Sans, single typeface

---

## Architecture Reference (confirmed from repo, not planning docs)

```
voltlead26-creator/PrompTED (ClaudeTED.AI branch)
├── apps/
│   ├── web/                    Next.js 15 — primary web app
│   └── mobile/                 Expo scaffold — deferred
├── packages/
│   └── shared/                 Types, templates, orchestration, export logic
│       └── src/templates/templates.data.json   53 templates
└── supabase/
    ├── functions/              22 Edge Functions (Deno/TypeScript)
    │   ├── _shared/            provider-router, prompt-builder, template-engine,
    │   │                       document-pipeline, document-intelligence-profiles
    │   ├── generate-document/  Main doc generation (vital/improver wired)
    │   ├── render-export/      PDF/Word/Excel export with approval gate
    │   ├── ingest-upload/      File upload → text extraction
    │   ├── interpret-intent/   Chat → intent classification
    │   ├── recommend/          Template recommendation
    │   └── clarify/            Follow-up question generation
    └── migrations/             18-table schema with RLS
```

---

## Test Checklist

Run before any release:

- [ ] `pnpm -r type-check` — zero errors
- [ ] `pnpm -r lint` — zero errors
- [ ] `pnpm -r test` — contrast assertions pass (7), persistence tests pass
- [ ] Build: `pnpm --filter @prompted/web build` — succeeds
- [ ] Home page loads
- [ ] New conversation → intent interpreted → recommendation shown
- [ ] Recommendation accepted → workspace opens → document generated (no blank sections)
- [ ] Section editor: edit, approve, export as PDF → downloads file
- [ ] Section editor: export with unapproved section → gate error shown inline
- [ ] Upload a PDF → text extracted → workspace opens pre-populated
- [ ] "Create a P&L statement" → routes to Profit & Loss template (not Financial Review)
- [ ] Upload a P&L → generate Financial Review → figures in output match upload
- [ ] Dark mode toggle → all colours switch cleanly

---

## Deployment Checklist

- [ ] All Supabase Edge Functions deployed (`deploy-supabase-functions.yml`)
- [ ] `RENDER_SERVICE_URL` set in Supabase env for PDF
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in Netlify
- [ ] Supabase service role key NOT in any frontend env
- [ ] Netlify deploy triggered via git push to staging branch (not CLI)
- [ ] Post-deploy: open `/home`, `/library`, one workspace route — confirm no 500s
