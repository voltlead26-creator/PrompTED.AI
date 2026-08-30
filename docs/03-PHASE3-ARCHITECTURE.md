# Phase 3 — Architecture

**PrompTED · TED AI · Architecture Version 1.0 · June 2026**

> Do not write production code until this architecture is fully defined and reviewed. Every technical decision in this document has a rationale.

---

## 3.1 Recommended Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Web frontend | Next.js 15 (App Router) | Incremental SSR capability, file-based routing, React ecosystem, Netlify deployment |
| Mobile frontend | Expo SDK 52 / React Native | iPhone-first, share business logic with web, App Store distribution |
| Shared design system | Custom token package (CSS-in-JS tokens + RN StyleSheet) | Single source of truth for colours, type, spacing across both platforms |
| State: server | TanStack Query (React Query) | Declarative cache/sync for Supabase data; optimistic updates for autosave |
| State: UI | Zustand | Lightweight, no boilerplate; workspace state, draft state, modal stack |
| Form handling | react-hook-form + Zod | Type-safe validation; handles structured form templates cleanly |
| Rich text editor | Tiptap (ProseMirror-based) | Accessible, extensible, well-maintained; supports custom extensions for PrompTED section behaviour |
| Animations | Framer Motion (web) / React Native Reanimated (native) | Both respect reduced-motion; declarative APIs |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions) | All-in-one; RLS baked in; Edge Functions for AI mediation |
| AI functions runtime | Deno (Supabase Edge Functions) | Existing; fast cold start; TypeScript native |
| Export: PDF | Puppeteer (headless Chrome) or server-side PDFKit | Server-side only; Puppeteer preferred for pixel-perfect fidelity; PDFKit as fallback if memory limits hit |
| Export: Word | docx (npm) | Pure JS, no system dependencies; runs in Edge Function |
| Export: Excel | exceljs (npm) | Full Excel support including formula cell protection |
| Charts | QuickChart.io API or canvas/sharp | Generates PNG charts from spec; embeds in PDF/Word |
| Deployment: Web | Netlify | Existing; proxy routes for API; deploy previews |
| Deployment: iOS | EAS Build (Expo) | Managed build pipeline; OTA updates |
| Payments | RevenueCat + Stripe (web) + Apple IAP (iOS) | RevenueCat as unified entitlement layer |
| Email (future) | Resend or Postmark | Transactional email; not required V1 |
| Monitoring | Sentry (Edge Functions + frontend) | Error tracking; alerting |
| Analytics | PostHog (self-hosted or cloud) | Privacy-respecting product analytics; no cross-app tracking |
| CI/CD | GitHub Actions | Automated test + deploy pipeline |

### Why not Next.js SSR for the app?

The app (`littlemissscarlett.co/app`) is entirely behind user auth — there is no publicly indexable content to SSR. Client-side rendering with static export on Netlify is simpler, faster to deploy, and avoids the complexity of SSR for this use case. The landing page (`index.html`) is already static. If SEO for app pages is needed in V2, SSR can be introduced.

### Why Netlify proxy instead of a dedicated API server?

The existing architecture uses Netlify proxy rules (`/api/*` → Supabase Edge Functions). This keeps the backend entirely in Supabase, eliminates a separate server to operate, and keeps provider keys out of the client bundle. This pattern is proven and sufficient for V1.

---

## 3.2 Folder Structure

> **Monorepo structure** per the Build Routine. Root contains `apps/`, `packages/`, and `supabase/`.
> The existing `app/` prototype and `index.html` landing page are preserved at root as reference
> artifacts; they are not the production build targets.

```
/
├── apps/
│   ├── web/                          # Next.js 15 web app (littlemissscarlett.co/app)
│   │   ├── src/
│   │   │   ├── app/                  # Next.js App Router pages
│   │   │   │   ├── layout.tsx        # Root layout (providers, fonts, theme)
│   │   │   │   ├── page.tsx          # Redirect → /home
│   │   │   │   ├── (auth)/           # Auth flow screens
│   │   │   │   │   ├── sign-in/
│   │   │   │   │   └── sign-up/
│   │   │   │   ├── home/             # Chat home screen (Layer 4)
│   │   │   │   ├── outcomes/
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── page.tsx         # Recommendation checkpoint (Layer 7)
│   │   │   │   │       └── workspace/
│   │   │   │   │           └── page.tsx     # Master Workspace (Layer 8)
│   │   │   │   ├── library/          # Past work, recents, saved (Layer 13)
│   │   │   │   ├── settings/         # Profile, brand kit, subscription, Clari
│   │   │   │   └── (legal)/          # Privacy, Terms (static)
│   │   │   ├── components/
│   │   │   │   ├── atoms/            # Button, Input, Badge, Icon, Avatar, etc.
│   │   │   │   ├── molecules/        # SectionCard, DocumentCard, ChecklistItem, etc.
│   │   │   │   ├── organisms/        # WorkspacePane, ChatInput, SummaryCard, etc.
│   │   │   │   └── providers/        # QueryClient, Auth, Theme
│   │   │   ├── hooks/                # useOutcome, useDocument, useAutosave, useExport…
│   │   │   └── lib/
│   │   │       ├── supabase/         # Browser + server + middleware clients
│   │   │       └── api/              # Typed wrappers around Edge Function calls
│   │   ├── public/                   # Favicon, icons, static assets
│   │   ├── next.config.ts
│   │   └── package.json
│   │
│   └── mobile/                       # Expo SDK 52 / React Native (iPhone-first)
│       ├── app/                      # Expo Router screens (mirrors web structure)
│       │   ├── _layout.tsx
│       │   ├── (tabs)/
│       │   │   ├── home.tsx
│       │   │   ├── library.tsx
│       │   │   ├── business.tsx      # Business plan only
│       │   │   └── settings.tsx
│       │   └── outcomes/
│       │       └── [id]/
│       ├── components/               # Native UI overrides (same names as web organisms)
│       └── package.json
│
├── packages/
│   └── shared/                       # Shared across web + mobile (no platform-specific deps)
│       ├── tokens/
│       │   ├── colours.ts            # Cream, coral, charcoal + full palette
│       │   ├── typography.ts         # Nunito scale, 17pt floor
│       │   ├── spacing.ts            # 8pt grid
│       │   └── index.ts
│       ├── types/                    # Outcome, Document, Section, Template, Bundle, etc.
│       ├── api-client/               # Typed API call functions (used by both apps)
│       ├── domain-engine/            # Pre-fill, derived fields, section assembly
│       └── utils/                    # Date, currency, text formatters
│
├── supabase/
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── provider-router.ts    # Provider-agnostic router (replaces openai-proxy)
│   │   │   ├── prompt-builder.ts     # System prompt: role + domain pack + Clari + boundary
│   │   │   ├── template-engine.ts    # Load template + apply pre-fill
│   │   │   ├── auth-guard.ts         # JWT + plan check + usage ledger
│   │   │   └── cors.ts               # CORS headers: littlemissscarlett.co + localhost only
│   │   ├── interpret-intent/
│   │   ├── recommend/
│   │   ├── clarify/
│   │   ├── generate-document/        # Streaming
│   │   ├── generate-report/          # Analytical + chart specs
│   │   ├── generate-checklist/       # Web-search grounded
│   │   ├── edit-section/             # Streaming
│   │   ├── ingest-upload/            # OCR + extraction
│   │   ├── research/                 # Web search
│   │   ├── render-export/            # PDF / Word / Excel
│   │   ├── account-delete/
│   │   └── webhooks/
│   │       └── revenuecat/
│   ├── migrations/
│   │   ├── 20260527111048_prompted_documents_auth.sql  # Existing (keep)
│   │   └── 20260608000000_prompted_v1_schema.sql       # Full V1 schema (Layer 1)
│   └── seed/
│       ├── templates.sql             # All V1 templates (see Layer 10 for count)
│       └── bundles.sql               # 4 V1 bundles
│
├── docs/                             # Phase 1–8 documentation (this folder)
├── app/                              # EXISTING prototype (reference only — not production)
├── index.html                        # EXISTING landing page (keep, not part of monorepo build)
├── _redirects                        # Netlify routing
├── netlify.toml                      # Netlify config + /api/* → Supabase proxy
└── package.json                      # Root workspace (pnpm/npm workspaces)
```

> **Deployment decision (Layer 1):** **Netlify is the sole web deployment target.** There is no
> Vercel configuration in this repository — no `vercel.json`, no `.vercel/` directory, on any
> branch including the default branch. The five Vercel projects historically attached to this repo
> (`promp-ted-prototype`, `promp-ted-prototype-yroz`, `promp-ted-web`, `promp-ted-web-a5a8`,
> `promp-ted-web-54jn`) are connected via the **Vercel GitHub App integration**, which is configured
> in the GitHub/Vercel dashboards — not in repo files — so their builds cannot be controlled from
> here. **Action required (dashboard, one-time):** disconnect the Vercel GitHub App from this repo
> (GitHub → repo Settings → GitHub Apps → Vercel → Configure → remove this repository) **or** delete
> the five projects in the Vercel dashboard. Until that is done, those checks will fail on every PR;
> the failures are cosmetic and do not affect the Netlify deployment.
---

## 3.3 Frontend Component Map

### Atoms (building blocks)

| Component | Props | Notes |
|-----------|-------|-------|
| `Button` | variant (primary/ghost/text/danger), size, loading, disabled, icon | Coral primary, charcoal ghost |
| `Input` | type, label, error, hint, required, disabled | 17pt minimum, accessible label |
| `Textarea` | same as Input + rows, autoResize | Auto-resize via JS |
| `Badge` | variant (draft/edited/approved/locked/done/in_progress), label | Colour + text (never colour only) |
| `Icon` | name (Tabler icon set), size, colour | Tabler icons throughout |
| `Avatar` | src, fallback initials, size | For user and business profiles |
| `Chip` | label, onTap, active, closeable | Example chips, domain chips |
| `ProgressBar` | value (0-1), label | Checklist progress, bundle progress |
| `Spinner` | size, label | Only with contextual message |
| `Divider` | | Section separators |
| `Tooltip` | content, placement | Keyboard-accessible |
| `Toast` | message, variant (info/success/error), duration | Autosave confirmation, export success |

### Molecules (composed from atoms)

| Component | Contains | Notes |
|-----------|---------|-------|
| `SectionCard` | section name, status Badge, content preview, approve/edit buttons | Core workspace building block |
| `DocumentCard` | title, domain Chip, status Badge, timestamp, actions | Library list item |
| `TemplateChip` | domain icon, template name, tap action | Browse modal and example chips |
| `RecommendationCard` | document name, use-case scenario, benefits list, select action | Primary + variant cards on summary screen |
| `ChecklistItem` | checkbox, text, deadline chip, days-remaining, reason (expandable), reminder bell | Checklist screen item |
| `BundleProgressItem` | document name, status, generate/skip buttons | Bundle screen item |
| `ProfileField` | label, value, edit-in-place | Profile screen form fields |
| `BrandColourPicker` | hex input + colour swatch | Brand kit editor |
| `UploadDropzone` | accept types, file list, remove | Home screen attachment and upload ingestion |
| `SearchInput` | placeholder, onChange, clear | Browse modal and Library search |
| `PlanCard` | plan name, price, features, CTA | Subscription/paywall screen |

### Organisms (complex UI sections)

| Component | Contains | Notes |
|-----------|---------|-------|
| `ChatInput` | Textarea, send Button, UploadDropzone, example chips | Home screen primary action |
| `SummaryCard` | what-TED-understood text, RecommendationCard(s), Confirm/Adjust/AddDetail actions | Recommendation checkpoint |
| `WorkspacePane` | SectionList, SectionEditor, LivePreview (three-pane desktop) | Master Workspace |
| `SectionList` | list of SectionCard + approval counter + export Button | Left pane |
| `SectionEditor` | rich text editor (Tiptap), EditWithTED panel, version history | Centre pane |
| `EditWithTED` | action buttons (Improve/Shorten/Expand/Tone/Detail), streaming result | AI editing panel |
| `LivePreview` | styled document render with brand kit | Right pane |
| `BundleScreen` | outcome header, BundleProgressItem list, action checklist, download-all Button | Bundle/documents screen |
| `ChecklistScreen` | header, ProgressBar, grouped ChecklistItem list, footer actions | Checklist/action plan view |
| `LibraryList` | Recents/Saved/Templates tabs, DocumentCard list, Whatsdue panel | Library screen |
| `BrandKitEditor` | logo upload, colour pickers, footer text input, live preview | Settings: brand kit |
| `PaywallModal` | feature description, PlanCard list, purchase CTA | Triggered at plan limits |
| `AuthModal` | email/password, Google OAuth, Apple Sign In | Triggered at save/export |
| `OnboardingModal` | TED intro, AI disclosure, consent, privacy link | First-time experience |

---

## 3.4 Backend Service Map

### Edge Function responsibilities

| Function | Responsibility | Provider(s) | Auth required |
|----------|---------------|-------------|---------------|
| `interpret-intent` | Domain classification, confidence score, clarifying questions | Primary (fast model) | Optional (anon) |
| `recommend` | Template selection, variant generation | Primary | Optional |
| `clarify` | Process clarification answer, re-evaluate | Primary | Optional |
| `generate-document` | Streaming section content from template + profile | High-quality model | Required |
| `generate-report` | Analytical document from uploaded data + chart specs | Long-context model | Required |
| `generate-checklist` | Research-backed checklist items | High-quality + web search | Required |
| `edit-section` | Per-section AI editing actions | Primary or high-quality | Required |
| `ingest-upload` | File parsing, OCR, text extraction | Vision-capable model | Optional |
| `research` | Web search, grounded current facts | Search-capable model | Required |
| `render-export` | PDF/Word/Excel server-side rendering | None (render library) | Required |
| `account-delete` | Cascading user data deletion | None | Required (service role) |
| `webhooks/revenuecat` | RevenueCat event → subscriptions + usage_ledger | None | HMAC signature |

### Shared modules

| Module | Responsibility |
|--------|---------------|
| `provider-router.ts` | Selects provider based on task type; retry/fallback logic |
| `prompt-builder.ts` | Assembles system prompt: role, domain pack, Clari style, advice boundary, template structure |
| `template-engine.ts` | Loads template from DB, applies profile pre-fill, returns structured prompt input |
| `auth-guard.ts` | Validates JWT, loads user plan from `subscriptions`, checks `usage_ledger` cap |

---

## 3.5 Database Schema (Full V1 DDL)

This is the complete migration to run as `supabase/migrations/20260608000000_prompted_v1_schema.sql`.

```sql
-- =====================================================
-- PrompTED V1 Full Schema Migration
-- =====================================================

create extension if not exists "uuid-ossp";

-- -----------------------------------------------
-- PROFILES (extends existing)
-- -----------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists acknowledged_advice_boundaries jsonb not null default '[]'::jsonb,
  add column if not exists business_id uuid; -- populated after business creation

-- -----------------------------------------------
-- BUSINESSES
-- -----------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default uuid_generate_v4(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  trading_name text not null,
  legal_name text,
  abn text,
  address text,
  phone text,
  email text,
  website text,
  industry text,
  voice_descriptor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_businesses_owner on public.businesses(owner_user_id);
alter table public.businesses enable row level security;
create policy "businesses_owner" on public.businesses
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

-- -----------------------------------------------
-- MEMBERSHIPS
-- -----------------------------------------------
create table if not exists public.memberships (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique(business_id, user_id)
);
alter table public.memberships enable row level security;
create policy "memberships_own" on public.memberships
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- CLARI PREFERENCES
-- -----------------------------------------------
create table if not exists public.clari_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  reading_level text not null default 'moderate' check (reading_level in ('simple', 'moderate', 'detailed')),
  tone text not null default 'professional' check (tone in ('casual', 'professional')),
  detail_level text not null default 'medium' check (detail_level in ('low', 'medium', 'high')),
  updated_at timestamptz not null default now()
);
alter table public.clari_preferences enable row level security;
create policy "clari_own" on public.clari_preferences
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- TEMPLATES (global authored content)
-- -----------------------------------------------
create table if not exists public.templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  domain text not null check (domain in ('employment', 'education', 'business', 'personal', 'finance')),
  category text not null,
  plain_description text not null,
  structure_type text not null check (structure_type in ('compose', 'structured_form', 'checklist')),
  sections jsonb not null default '[]'::jsonb,
  fields jsonb not null default '[]'::jsonb,
  missing_detail_rules jsonb not null default '[]'::jsonb,
  fill_from_profile jsonb not null default '{}'::jsonb,
  recommendation_reason text,
  related_document_ids jsonb not null default '[]'::jsonb,
  advice_boundary text not null default 'none' check (advice_boundary in ('none', 'light', 'high-stakes')),
  brandable boolean not null default false,
  flags jsonb not null default '{}'::jsonb,
  is_published boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
-- No RLS — templates are global read; writes via service role (seed/admin)

-- -----------------------------------------------
-- BUNDLES (global authored content)
-- -----------------------------------------------
create table if not exists public.bundles (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  domain text not null,
  template_ids jsonb not null default '[]'::jsonb,
  checklist_template_id uuid references public.templates(id) on delete set null,
  display_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
-- No RLS — global read

-- -----------------------------------------------
-- OUTCOMES
-- -----------------------------------------------
create table if not exists public.outcomes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  bundle_id uuid references public.bundles(id) on delete set null,
  situation_text text not null,
  recommendation_payload jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_progress', 'completed')),
  is_saved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_outcomes_user_updated on public.outcomes(user_id, updated_at desc);
alter table public.outcomes enable row level security;
create policy "outcomes_own" on public.outcomes
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- DOCUMENTS (replaces old documents table; extend existing)
-- -----------------------------------------------
alter table public.documents
  add column if not exists outcome_id uuid references public.outcomes(id) on delete cascade,
  add column if not exists template_id uuid references public.templates(id) on delete set null,
  add column if not exists is_template boolean not null default false;

-- Update status check to include 'exported'
-- (drop and recreate constraint)
alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check
  check (status in ('draft', 'edited', 'approved', 'exported', 'archived'));

-- -----------------------------------------------
-- SECTIONS
-- -----------------------------------------------
create table if not exists public.sections (
  id uuid primary key default uuid_generate_v4(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  order_index integer not null default 0,
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'edited', 'approved', 'locked')),
  version_history jsonb not null default '[]'::jsonb,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sections_document on public.sections(document_id, order_index);
alter table public.sections enable row level security;
create policy "sections_own" on public.sections
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- UPLOADS
-- -----------------------------------------------
create table if not exists public.uploads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id uuid references public.outcomes(id) on delete set null,
  storage_path text not null,
  file_type text not null,
  file_name text not null,
  file_size_bytes integer,
  extracted_text text,
  extracted_payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.uploads enable row level security;
create policy "uploads_own" on public.uploads
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- CHECKLIST ITEMS
-- -----------------------------------------------
create table if not exists public.checklist_items (
  id uuid primary key default uuid_generate_v4(),
  outcome_id uuid not null references public.outcomes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  due_date date,
  reason text,
  done boolean not null default false,
  reminder_offset_days integer,
  reminder_sent boolean not null default false,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_checklist_outcome on public.checklist_items(outcome_id, order_index);
alter table public.checklist_items enable row level security;
create policy "checklist_own" on public.checklist_items
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- BRAND KITS
-- -----------------------------------------------
create table if not exists public.brand_kits (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  logo_url text,
  primary_colour text not null default '#DC5430',
  secondary_colour text,
  footer_text text,
  updated_at timestamptz not null default now()
);
alter table public.brand_kits enable row level security;
create policy "brand_kits_owner" on public.brand_kits
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_user_id = (select auth.uid())
  ));

-- -----------------------------------------------
-- COMPANY PROFILE
-- -----------------------------------------------
create table if not exists public.company_profile (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  voice_tone text,
  reusable_clauses jsonb not null default '[]'::jsonb,
  extra_fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.company_profile enable row level security;
create policy "company_profile_owner" on public.company_profile
  using (exists (
    select 1 from public.businesses b
    where b.id = business_id and b.owner_user_id = (select auth.uid())
  ));

-- -----------------------------------------------
-- SUBSCRIPTIONS
-- -----------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'premium', 'business')),
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled', 'trialing')),
  revenuecat_customer_id text,
  entitlements jsonb not null default '{}'::jsonb,
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_subscriptions_user on public.subscriptions(user_id);
alter table public.subscriptions enable row level security;
create policy "subscriptions_own" on public.subscriptions
  using ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- USAGE LEDGER (append-only)
-- -----------------------------------------------
create table if not exists public.usage_ledger (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  event_type text not null check (event_type in ('document_created', 'ai_edit')),
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_user_created on public.usage_ledger(user_id, created_at desc);
alter table public.usage_ledger enable row level security;
create policy "usage_own_read" on public.usage_ledger
  for select using ((select auth.uid()) = user_id);

-- -----------------------------------------------
-- AUDIT LOGS (server-write only)
-- -----------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- No RLS — service role only. Do not expose to client.

-- -----------------------------------------------
-- TRIGGERS: set_updated_at on new tables
-- -----------------------------------------------
create trigger businesses_updated_at before update on public.businesses
  for each row execute function public.set_updated_at();
create trigger outcomes_updated_at before update on public.outcomes
  for each row execute function public.set_updated_at();
create trigger sections_updated_at before update on public.sections
  for each row execute function public.set_updated_at();
create trigger checklist_updated_at before update on public.checklist_items
  for each row execute function public.set_updated_at();

-- -----------------------------------------------
-- INDEXES for performance
-- -----------------------------------------------
create index if not exists idx_outcomes_business on public.outcomes(business_id);
create index if not exists idx_documents_outcome on public.documents(outcome_id);
create index if not exists idx_checklist_due on public.checklist_items(user_id, due_date) where due_date is not null;
create index if not exists idx_usage_business on public.usage_ledger(business_id, created_at desc) where business_id is not null;
```

---

## 3.6 API Endpoint List

See SRS §2.11 for full request/response specs. Quick reference:

| Endpoint | Method | Function | Auth | Notes |
|----------|--------|----------|------|-------|
| `/api/interpret-intent` | POST | `interpret-intent` | Optional | Intent classification |
| `/api/recommend` | POST | `recommend` | Optional | Primary + 2 variant recommendations |
| `/api/clarify` | POST | `clarify` | Optional | Clarification loop |
| `/api/generate-document` | POST | `generate-document` | Required | Streams SSE |
| `/api/generate-report` | POST | `generate-report` | Required | Streams SSE |
| `/api/generate-checklist` | POST | `generate-checklist` | Required | Returns JSON |
| `/api/edit-section` | POST | `edit-section` | Required | Streams SSE |
| `/api/ingest-upload` | POST | `ingest-upload` | Optional | Multipart |
| `/api/research` | POST | `research` | Required | Cached 1hr |
| `/api/render-export` | POST | `render-export` | Required | Binary response |
| `/api/account-delete` | DELETE | `account-delete` | Required | Service role cascade |
| `/api/webhooks/revenuecat` | POST | `webhooks/revenuecat` | HMAC | |

Netlify proxy routes (in `netlify.toml`):
```toml
[[redirects]]
  from = "/api/*"
  to = "https://<SUPABASE_URL>/functions/v1/:splat"
  status = 200
  force = true
  [redirects.headers]
    X-Forwarded-Host = "littlemissscarlett.co"
```

---

## 3.7 AI Orchestration Flow

```
User input (text / photo / file)
    │
    ▼
[ingest-upload] (if photo/file attached)
  → extracted_text, confirm_payload
  → shown on summary card for user confirmation
    │
    ▼
[interpret-intent]
  input: text + extracted_text
  output: { domain, situation, confidence }
    │
    ├── confidence ≥ 0.75 → skip to [recommend]
    └── confidence < 0.75 → ask one adaptive question, then re-assess
                            (loop until intent clear, no fixed cap) → [recommend]
    │
    ▼
[recommend]
  output: { primary: RecommendationItem, variants: [2], bundle? }
  → shown on summary card
  → user confirms / adjusts
    │
    ▼
User confirms recommendation
    │
    ├── Document outcome → [generate-document] (streaming)
    │     ├── Load template from DB
    │     ├── Apply profile pre-fill
    │     ├── Build system prompt (prompt-builder.ts)
    │     ├── Select provider (provider-router.ts)
    │     ├── Stream sections into workspace
    │     └── Review pass (high-reasoning model validates no fabrication)
    │
    ├── Checklist outcome → [generate-checklist]
    │     ├── [research] (web search for current facts)
    │     └── Generate items with deadlines + reasons
    │
    └── Report outcome → [generate-report]
          ├── Load uploaded data from DB/Storage
          ├── Generate chart specs
          ├── Stream report sections
          └── Validate: all figures from user data only
```

### Provider selection rules (configurable, not hardcoded)

| Task | Default provider | High-reasoning override |
|------|-----------------|------------------------|
| Intent interpretation | GPT-4.1-nano | — |
| Recommendation | GPT-4.1-mini | — |
| Document generation (standard) | Claude Sonnet 4 | GPT-5.5 |
| Document generation (legal/financial) | GPT-5.5 | GPT-5.5 |
| Section editing | GPT-4.1-mini | — |
| Checklist generation | GPT-4.1-mini + web search | — |
| Analytical report | Gemini 2.5 Pro (long context) | GPT-5.5 |
| Research / web search | GPT-4.1-mini + web search tool | — |
| Review pass | GPT-5.5 | — |

---

## 3.8 Authentication Flow

```
New user opens app
    │
    ▼
[Supabase anonymous session created]
User can: Home → recommend → draft → workspace
    │
    ▼
User hits: Save / Export / "Return to this later"
    │
    ▼
[AuthModal shown]
  ├── Sign in with Apple (iOS)
  ├── Google OAuth (Web)
  └── Email / password
    │
    ▼
[Supabase anonymous session → authenticated session migration]
Work from anonymous session transferred to authenticated user
    │
    ▼
[Profile created via handle_new_user trigger]
[Subscription record created: plan = 'free']
[Clari preferences record created: defaults]
    │
    ▼
Returning user:
    JWT auto-refresh → transparent session persistence
```

---

## 3.9 Document Generation Flow

```
User confirms recommendation (FR-003)
    │
    ▼
POST /api/generate-document
  body: { template_id, outcome_id, profile, company_profile?, extra_context? }
    │
    ▼
[auth-guard.ts]
  → Validate JWT
  → Check usage_ledger: is doc_created count < plan cap?
  → If over cap: return 429 with paywall trigger
    │
    ▼
[template-engine.ts]
  → Load template record from DB by template_id
  → Apply fill_from_profile mapping: profile fields → template fields
  → Identify missing required fields (from missing_detail_rules)
  → If missing fields: return clarification request (not a generation)
    │
    ▼
[prompt-builder.ts]
  → Role instruction: "You are TED, an Australian AI..."
  → Template structure: paste section names, descriptions, order
  → Profile pre-fill: paste filled values
  → Clari style: paste reading level + tone instruction
  → Domain intelligence pack: paste domain-specific guidance
  → Advice boundary: if high-stakes, paste disclaimer instruction
  → No-fabrication rule: "Use only provided data. Do not invent names, dates, figures."
  → Output format: "Return JSON: { section_name: section_content, ... }"
    │
    ▼
[provider-router.ts]
  → Select provider based on task type + high_reasoning flag
  → Call provider API
  → If error: retry with fallback provider
    │
    ▼
Streaming response
  → Parse SSE chunks: { section: string, content_chunk: string }
  → Upsert each section to sections table as it streams
  → Client renders each chunk as it arrives
    │
    ▼
[Review pass: high-reasoning model]
  → Validate: no invented figures in financial/factual sections
  → Validate: advice boundary language present if required
  → If validation fails: log (not surface to user); generation still delivers
    │
    ▼
[usage_ledger insert: event_type = 'document_created']
    │
    ▼
Client: workspace renders all sections with status = 'draft'
```

---

## 3.10 Master Workspace Flow

```
Document generated → sections in DB with status = 'draft'
    │
    ▼
WorkspacePane renders:
  SectionList: all sections with status chips
  SectionEditor: first section selected, content editable
  LivePreview: document rendered with brand kit
    │
    ▼
User manually edits section
  → section.status → 'edited'
  → content autosaved (debounced 500ms)
  → version added to section.version_history
    │
    ▼
User requests "Edit with TED" on a section
  → EditWithTED panel appears
  → User picks action: Improve / Shorten / Expand / Change tone / Add detail
  → POST /api/edit-section
  → Streamed revised content replaces section content
  → status → 'edited'
    │
    ▼
User approves section
  → section.status → 'approved'
  → approval counter increments
  → if all required sections approved: export button enabled
    │
    ▼
User exports
  → POST /api/render-export
  → PDF/Word rendered server-side
  → File download triggered
  → export_history record inserted
  → document.status → 'exported'
```

---

## 3.11 Export Flow

```
User clicks Export (all required sections Approved)
    │
    ▼
POST /api/render-export
  body: { document_ids: [id], format: 'pdf'|'word', brand_kit_id? }
    │
    ▼
[auth-guard.ts]
  → Validate JWT
  → Verify all sections[].status = 'approved' for each document_id
    │
    ▼
[render-export/index.ts]
  → Fetch sections from DB (approved only)
  → Fetch brand kit if brand_kit_id supplied
  → Fetch logo from Supabase Storage if logo_url set
    │
    ▼
Format: PDF
  → Build HTML template with brand colours, logo, footer
  → Inject section content (sanitised HTML from Tiptap output)
  → Render to PDF via Puppeteer or PDFKit
  → If charts: fetch PNG from QuickChart API, embed in HTML before render

Format: Word
  → Build docx Document object via docx library
  → Apply styles (heading sizes, body size, brand colour on headings)
  → Embed chart PNGs as images

Format: Excel (Budget Workbook only)
  → Build workbook via exceljs
  → Lock formula cells (worksheet.protect())
  → Insert user-entered values in input cells
  → Dashboard sheet with summary charts
    │
    ▼
Binary response → file download in browser
export_history record inserted
```

---

## 3.12 Error Handling Flow

```
Any operation fails
    │
    ├── AI provider error (429, 5xx)
    │     → provider-router.ts retries with fallback provider
    │     → if all providers fail: return { error: { user_message: "TED hit a small snag..." } }
    │
    ├── Upload ingestion error (unsupported format, OCR failure)
    │     → return { error: { user_message: "We couldn't read that file..." } }
    │
    ├── Export error
    │     → return { error: { user_message: "We couldn't create your file just now. Your work is saved..." } }
    │
    ├── Network error (client-side)
    │     → TanStack Query retry: 2 automatic retries
    │     → After 2 retries: show toast "TED couldn't connect just now. Nothing's been lost — let's try again."
    │
    └── Auth error (expired session)
          → Supabase client auto-refreshes JWT
          → If refresh fails: show AuthModal
```

---

## 3.13 Deployment Flow

```
Development
  ├── supabase start (local Supabase)
  ├── next dev (web app)
  └── expo start (mobile app)

Pull Request
  ├── GitHub Actions: lint + type-check + unit tests
  └── Netlify: deploy preview URL generated

Staging (merge to staging branch)
  ├── supabase db push --db-url $STAGING_DB_URL (apply migrations)
  ├── supabase functions deploy --all (deploy Edge Functions)
  └── Netlify: staging deployment

Production (merge to main)
  ├── supabase db push --db-url $PROD_DB_URL
  ├── supabase functions deploy --all
  ├── Netlify: production deployment
  └── EAS Build: iOS build submitted to App Store

Environment variables:
  Client-safe (Netlify env):
    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY
    NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY
  
  Server-secret (Supabase secrets only):
    OPENAI_API_KEY
    ANTHROPIC_API_KEY
    GOOGLE_AI_API_KEY
    REVENUECAT_WEBHOOK_SECRET
    PROVIDER_ROUTING_MAP (JSON string)
    BUSINESS_PLAN_FAIR_USE_CEILING (number)
```
