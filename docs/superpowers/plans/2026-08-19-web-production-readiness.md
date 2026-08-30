# PrompTED Web Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish, secure, verify, and deploy the existing PrompTED web application before Expo mobile development begins.

**Architecture:** Retain the Next.js, shared-package, Supabase, and Netlify architecture. Harden each existing boundary in place, gate production promotion through one manual release workflow, and prove core behavior with automated and authenticated browser evidence.

**Tech Stack:** Next.js 15, React 19, TypeScript, pnpm workspaces, Vitest, Supabase/Postgres/Deno Edge Functions, GitHub Actions, Netlify.

**Spec:** `docs/superpowers/specs/2026-08-19-web-production-readiness-design.md`

## Global Constraints

- Billing and Expo implementation are out of scope.
- Existing database data, template identifiers, URLs, and shared web/mobile contracts remain compatible.
- Production deployment happens only after every required release gate passes.
- No user document content, raw provider body, credential, or secret may be logged.
- Preserve unrelated user-owned files and changes.

---

### Task 1: Integrate the completed template and Master Workspace fixes

**Files:**
- Modify: `apps/web/src/app/(app)/workspace/import-structure.ts`
- Modify: `apps/web/src/app/(app)/workspace/import-structure.test.ts`
- Modify: `apps/web/src/components/organisms/SectionEditor.module.css`
- Modify: `apps/web/src/components/organisms/WorkspacePane.module.css`
- Create: `apps/web/src/components/organisms/workspace-editor-layout.test.ts`

**Interfaces:**
- Consumes: `splitImportedDocument`, `SectionEditor`, and `WorkspacePane` existing contracts.
- Produces: imports without standalone page-marker sections and a fixed-chrome section editor whose prose is the only scroll owner.

- [ ] **Step 1: Run the focused regression tests**

Run: `pnpm --dir apps/web exec vitest run 'src/app/(app)/workspace/import-structure.test.ts' src/components/organisms/editor.test.tsx src/components/organisms/workspace-editor-layout.test.ts`

Expected: all tests pass, including the standalone page-number and fixed-chrome cases.

- [ ] **Step 2: Inspect the diff and validate CSS behavior contracts**

Run: `git diff --check && git diff -- apps/web/src/app/'(app)'/workspace/import-structure.ts apps/web/src/components/organisms/SectionEditor.module.css apps/web/src/components/organisms/WorkspacePane.module.css`

Expected: no whitespace errors; `.documentViewport` is bounded, `.editorWrap` scrolls, and `.contextBar` is a non-scrolling final row.

- [ ] **Step 3: Run static checks**

Run: `pnpm --filter @prompted/web type-check && pnpm --filter @prompted/web lint`

Expected: exit code 0.

- [ ] **Step 4: Commit the integrated fixes**

```bash
git add 'apps/web/src/app/(app)/workspace/import-structure.ts' 'apps/web/src/app/(app)/workspace/import-structure.test.ts' apps/web/src/components/organisms/SectionEditor.module.css apps/web/src/components/organisms/WorkspacePane.module.css apps/web/src/components/organisms/workspace-editor-layout.test.ts
git commit -m "fix(workspace): keep editor chrome fixed and ignore page markers"
```

### Task 2: Establish privacy-safe analytics and legal disclosure

**Files:**
- Create: `apps/web/src/app/privacy/page.tsx`
- Create: `apps/web/src/app/privacy/PrivacyPage.module.css`
- Create: `apps/web/src/app/privacy/page.test.tsx`
- Modify: `apps/web/src/lib/analytics.ts`
- Modify: `apps/web/src/components/providers/MonitoringProvider.tsx`
- Test: `apps/web/src/components/providers/MonitoringProvider.test.tsx`

**Interfaces:**
- Consumes: existing PostHog initialization and root provider mounting.
- Produces: a public `/privacy` route and analytics defaults that do not record text inputs or document content.

- [ ] **Step 1: Write failing privacy-route and analytics tests**

The route test must assert a `Privacy` heading and disclosure of account data, uploaded documents, AI processing, analytics, retention, deletion, and contact method. The provider test must assert session recording is disabled unless an explicit public consent/config flag is true and that text/input masking remains enabled.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `pnpm --dir apps/web exec vitest run src/app/privacy/page.test.tsx src/components/providers/MonitoringProvider.test.tsx`

Expected: fail because the route and consent-safe configuration do not yet exist.

- [ ] **Step 3: Implement the route and safe analytics configuration**

Use a server-rendered privacy page with semantic sections and the existing design tokens. Configure PostHog with:

```ts
session_recording: {
  maskAllInputs: true,
  maskInputOptions: { password: true },
},
disable_session_recording: process.env.NEXT_PUBLIC_POSTHOG_SESSION_RECORDING !== "true",
```

Do not emit document text in event properties.

- [ ] **Step 4: Run focused tests, type-check, and lint**

Run: `pnpm --dir apps/web exec vitest run src/app/privacy/page.test.tsx src/components/providers/MonitoringProvider.test.tsx && pnpm --filter @prompted/web type-check && pnpm --filter @prompted/web lint`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/privacy apps/web/src/lib/analytics.ts apps/web/src/components/providers/MonitoringProvider.tsx apps/web/src/components/providers/MonitoringProvider.test.tsx
git commit -m "feat(web): add privacy disclosure and safe analytics defaults"
```

### Task 3: Harden provider routing, retries, and logging

**Files:**
- Modify: `supabase/functions/_shared/provider-router.ts`
- Modify: `supabase/functions/_shared/provider-router.test.ts`

**Interfaces:**
- Consumes: `ProviderRequest`, `ProviderResponse`, environment routing configuration, and `meterSuccessfulModelCall`.
- Produces: task-tier model selection, bounded transient retry, provider cooldown, failover, and metadata-only logs.

- [ ] **Step 1: Add failing tests for the production failure matrix**

Cover: primary success; transient 429/500/502/503 retry then success; permanent 400 without same-provider retry; provider cooldown after repeated transient failure; next-provider failover; abort without retry; required-JSON failure without response-tail logging; and all-provider failure with a stable error code.

- [ ] **Step 2: Run the router tests and confirm the new cases fail**

Run: `deno test --allow-env --allow-read supabase/functions/_shared/provider-router.test.ts`

Expected: new resilience and redaction cases fail against the current router.

- [ ] **Step 3: Implement bounded resilience**

Add pure helpers for retry classification and delay calculation. Use at most two attempts per provider, exponential delays capped at two seconds, and process-local cooldown metadata as an optimisation only. Preserve cross-provider fallback. Replace response tails and raw error messages with fields limited to task, provider, status, error code, response length, attempt, and cooldown state.

- [ ] **Step 4: Run router and full Edge Function tests**

Run: `deno test --allow-env --allow-read supabase/functions/_shared/provider-router.test.ts && deno test --allow-env --allow-read supabase/functions`

Expected: exit code 0 and no test expecting raw response content in logs.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/provider-router.ts supabase/functions/_shared/provider-router.test.ts
git commit -m "fix(ai): harden provider failover and redact logs"
```

### Task 4: Replace instance-local rate limiting with durable enforcement

**Files:**
- Create: `supabase/migrations/20260819000000_add_durable_rate_limits.sql`
- Modify: `supabase/functions/_shared/rate-limiter.ts`
- Create: `supabase/functions/_shared/rate-limiter.test.ts`
- Modify: `supabase/functions/_shared/auth-guard.ts`
- Modify: `supabase/functions/_shared/auth-guard.test.ts`

**Interfaces:**
- Consumes: authenticated user ID, Supabase service client, operation key, limit, and window length.
- Produces: `enforceRateLimit({ client, userId, operation, limit, windowSeconds }): Promise<void>` and the existing safe 429 response.

- [ ] **Step 1: Add failing tests for durable behavior**

Test permitted requests, rejection above the limit, separate user/operation buckets, database failure fail-closed behavior for chargeable AI calls, and the stable 429 payload.

- [ ] **Step 2: Add an atomic Postgres rate-limit function**

Create a private bucket table keyed by user, operation, and window start. Add a security-definer function that atomically upserts and returns whether the request is permitted. Revoke direct table access from public roles and allow only service-role execution.

- [ ] **Step 3: Convert callers to await durable enforcement**

Replace synchronous `checkRateLimit(userId)` calls with the new async contract after authentication and before provider invocation. Do not accept a client-supplied user ID.

- [ ] **Step 4: Run migration validation, Deno checks, and tests**

Run: `pnpm check:migrations && deno check supabase/functions/ingest-upload/index.ts supabase/functions/generate-document/index.ts supabase/functions/edit-section/index.ts supabase/functions/render-export/index.ts && deno test --allow-env --allow-read supabase/functions`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260819000000_add_durable_rate_limits.sql supabase/functions
git commit -m "fix(security): enforce durable per-user rate limits"
```

### Task 5: Complete RLS and dependency security coverage

**Files:**
- Modify: `scripts/test-rls.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create or modify: `.github/dependabot.yml`

**Interfaces:**
- Consumes: repository table list, Supabase test credentials, and pnpm audit output.
- Produces: explicit cross-user isolation checks for every user-owned table and no unresolved high-severity production advisory.

- [ ] **Step 1: Enumerate user-owned tables and assert test coverage**

Derive the table set from migrations and make the RLS harness fail when a named user-owned table lacks owner-read, owner-write, and cross-user-denial assertions.

- [ ] **Step 2: Run the current RLS harness and capture missing coverage**

Run: `node scripts/test-rls.mjs`

Expected: either pass with configured integration credentials or emit an explicit skipped/blocked result naming the missing credentials; never claim eight-table coverage from a single table.

- [ ] **Step 3: Resolve high production dependency advisories**

Run: `pnpm audit --prod --audit-level high`.

Upgrade the owning dependency or add the narrowest compatible pnpm override for the patched `image-size` line, regenerate the lockfile with `pnpm install`, and rerun the audit. Do not suppress advisories without a documented non-reachability proof.

- [ ] **Step 4: Add scheduled dependency monitoring**

Configure weekly grouped pnpm updates for the workspace with a small open-PR limit.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-rls.mjs package.json pnpm-lock.yaml .github/dependabot.yml
git commit -m "test(security): complete RLS and dependency coverage"
```

### Task 6: Tighten browser security and production configuration

**Files:**
- Modify: `apps/web/netlify.toml`
- Create: `apps/web/src/security/headers.test.ts`
- Modify: `apps/web/src/lib/supabase/client.ts`
- Modify: `apps/web/src/lib/supabase/server.ts`
- Modify: `apps/web/src/middleware.ts`
- Modify: `apps/web/src/app/auth/callback/route.ts`
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/lib/env.test.ts`

**Interfaces:**
- Consumes: public Supabase and monitoring environment variables.
- Produces: validated environment access and a CSP without `unsafe-eval`, with the minimum host allowlist required by the app.

- [ ] **Step 1: Add failing header and environment tests**

Assert CSP omits `unsafe-eval`, includes only configured Supabase/PostHog/Sentry hosts, and that missing required production variables produce a clear configuration error without exposing secret values.

- [ ] **Step 2: Centralise environment parsing**

Return typed public configuration from one module. Keep all provider keys server-side. Replace duplicated hard-coded project URLs in runtime code with validated configuration.

- [ ] **Step 3: Tighten Netlify headers**

Retain frame, MIME, referrer, permissions, and HSTS protections. Remove `unsafe-eval`; remove `unsafe-inline` where compatible with Next.js output, or document the exact framework constraint in the test if style nonces require a later framework-level migration.

- [ ] **Step 4: Run security, type, lint, and build checks**

Run: `pnpm --dir apps/web exec vitest run src/security && pnpm --filter @prompted/web type-check && pnpm --filter @prompted/web lint && pnpm --filter @prompted/web build`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/netlify.toml apps/web/src/security apps/web/src/lib
git commit -m "fix(web): tighten runtime configuration and security headers"
```

### Task 7: Make CI the single production release gate

**Files:**
- Modify: `.github/workflows/deploy-supabase-functions.yml`
- Modify: `.github/workflows/deploy-prod.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`
- Create: `scripts/verify-web-release.mjs`
- Create: `scripts/verify-web-release.test.mjs`

**Interfaces:**
- Consumes: repository checks, GitHub environments/secrets, Netlify CLI, and Supabase CLI.
- Produces: `pnpm verify:web` and one manual, production-branch-only deployment workflow.

- [ ] **Step 1: Add a release-contract test**

Assert no push-triggered workflow deploys production Supabase functions, production deployment is restricted to `refs/heads/ClaudeTED.AI`, deployment depends on validation, and `verify:web` includes type, lint, tests, Deno checks/tests, build, migration checks, and production audit.

- [ ] **Step 2: Disable duplicate automatic production deployment**

Make `deploy-supabase-functions.yml` manual-only or remove it after moving its necessary behavior into `deploy-prod.yml`. Keep the production environment approval boundary.

- [ ] **Step 3: Add the canonical verification command**

Add:

```json
"verify:web": "pnpm check:encoding && pnpm check:promises && pnpm check:migrations && pnpm type-check && pnpm lint && pnpm test && deno check supabase/functions/ingest-upload/index.ts supabase/functions/generate-document/index.ts supabase/functions/edit-section/index.ts supabase/functions/render-export/index.ts && deno test --allow-env --allow-read supabase/functions && pnpm build && pnpm audit --prod --audit-level high"
```

Use the same command in CI and production deployment so local and remote release gates cannot drift.

- [ ] **Step 4: Run workflow contract tests and YAML validation**

Run: `node --test scripts/verify-web-release.test.mjs && pnpm verify:web`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows package.json scripts/verify-web-release.mjs scripts/verify-web-release.test.mjs
git commit -m "ci: gate web production deployment on full verification"
```

### Task 8: Complete product QA and production deployment

**Files:**
- Modify: `docs/06-PRODUCTION-READINESS-OVERVIEW.md`
- Create: `docs/quality/2026-08-19-web-production-release.md`
- Modify only when a reproduced defect requires a scoped fix: affected web/shared/Supabase source and tests.

**Interfaces:**
- Consumes: a clean `ClaudeTED.AI` branch, authenticated Netlify/Supabase/GitHub access, and the canonical verification command.
- Produces: a public production deployment with recorded release evidence.

- [ ] **Step 1: Run the complete local release gate from a clean tree**

Run: `pnpm verify:web`.

Expected: every command exits 0; no critical/high production advisory remains.

- [ ] **Step 2: Run authenticated browser workflow QA on a deploy preview**

Verify sign-in, create/clarify/generate, upload/import, first-section layout, text-only scrolling, edit/recovery, approval/export, library, plans, roles, profile/settings, privacy, keyboard navigation, and desktop/mobile widths. Record the tested URL and outcome without recording private document content.

- [ ] **Step 3: Push the reviewed branch and confirm GitHub CI**

Run: `git push origin ClaudeTED.AI` followed by `gh run list --branch ClaudeTED.AI --limit 10` and `gh run watch <run-id> --exit-status`.

Expected: required CI workflows pass on the exact commit.

- [ ] **Step 4: Deploy production through the guarded workflow**

Run: `gh workflow run deploy-prod.yml --ref ClaudeTED.AI`, identify the created run, and watch it to completion.

Expected: environment approval succeeds, migrations and functions deploy, Netlify production deploy succeeds, and the workflow exits 0.

- [ ] **Step 5: Remove unintended Netlify Team Protection and smoke-test production**

Use the authenticated Netlify connection to make the intended public site accessible. Verify the canonical URL returns the application rather than an access-control redirect, `/privacy` returns 200, authentication entry loads, and public assets/security headers are correct.

- [ ] **Step 6: Record release evidence and commit it**

Document commit SHA, CI run, deployment run, production URL, smoke-test results, known non-blocking limitations, and the explicit transition point to Expo work. Commit with:

```bash
git add docs
git commit -m "docs: record PrompTED web production release"
git push origin ClaudeTED.AI
```
