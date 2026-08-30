# PrompTED Production Readiness Overview

> **Historical scoped snapshot.** This document preserves an earlier readiness
> assessment and is not current production evidence. Use root `AGENTS.md` for
> release rules, `docs/CANONICAL_ARCHITECTURE.md` for the target system, and a
> revision-specific handoff/audit for current local, CI, staging, or production
> status.

## Current architecture

PrompTED is a pnpm monorepo with:

- `apps/web`: Next.js 15 and React 19 web application.
- `packages/shared`: shared types, templates and orchestration contracts.
- `supabase/functions`: server-side AI and application functions.
- `supabase/migrations`: PostgreSQL schema changes.
- Netlify for web hosting and API proxying.
- Supabase for authentication, database, storage and Edge Functions.
- RevenueCat for subscriptions.
- Sentry, OpenTelemetry and PostHog dependencies for observability.

```text
Browser
  -> Netlify / Next.js
  -> API proxy routes
  -> Supabase Edge Functions
  -> Supabase database, auth and storage
  -> AI and live-data providers
```

## Architecture decision

Keep the current managed Netlify and Supabase architecture. It is appropriate for the present product stage and reduces operational burden.

Do not introduce Kubernetes yet. Reconsider containers only when long-running workers, custom networking, sustained compute, provider portability or measured cost make them necessary.

## Highest production risks

Updated following a direct audit of the live repository, workflows, and connected Supabase/Netlify accounts (see PrompTED-Audit-Technical-Findings for full detail).

1. RESOLVED -- Production deploy previously had no branch restriction; workflow_dispatch could deploy any branch. Fixed: deploy-prod.yml now refuses to run against anything other than refs/heads/ClaudeTED.AI.
2. RESOLVED -- The database migration step silently skipped when SUPABASE_DB_PASSWORD was unset, while function/web deploys continued anyway. Fixed: the step now fails the job loudly instead.
3. CORRECTED, was already fine -- Production deploy order (migrations -> Edge Functions -> web) was already correct in deploy-prod.yml; this had been incorrectly listed as a risk.
4. CORRECTED, was already fine -- Staging and production already run the identical quality gate (type-check, lint, test, build) before deploying; this had been incorrectly listed as a risk.
5. ACCEPTED DECISION, not a bug -- There is no isolated staging Supabase project (confirmed: only two projects exist in the connected Supabase account, neither an isolated staging copy of PrompTED). Staging deliberately shares the production backend until there's real need to pay for isolation. The previously-broken deploy-functions-staging job (pointing at a project ref that didn't resolve to anything real) has been removed. Anything tested on staging is touching production data -- test accordingly.
6. Post-deploy smoke testing and automatic release verification are still missing.
7. Monitoring packages exist, but alert coverage and release health must still be verified against the live Sentry project.
8. External AI requests need consistent timeouts, retry limits and graceful failure states -- not yet verified per-function.
9. Multi-row updates should be atomic to prevent partial data loss -- not yet verified per-function.
10. Backup restoration and rollback procedures need a tested runbook.

## Target release workflow

### Pull request

- install with frozen lockfile,
- type-check shared and web packages,
- lint with zero warnings,
- run tests,
- run a production build,
- deploy a preview,
- run smoke tests.

### Staging

- run the full CI gate,
- apply compatible migrations,
- deploy Edge Functions,
- deploy the web application,
- test sign-in, TED recommendations, generation, checklists, Master Workspace and export.

### Production

- release only from `main` or an approved tag,
- run the full CI gate against the exact commit,
- apply expand-only migrations,
- deploy compatible Edge Functions,
- deploy Netlify,
- run production smoke tests,
- verify errors and latency before marking the release healthy.

## Observability targets

- Web availability: 99.9% monthly.
- Core API availability: 99.5% initially.
- Error-free sessions: above 99%.
- AI success rate: above 97%, excluding valid user errors.
- Cached/navigation p95: under 2.5 seconds.

Use Sentry for errors and release health, PostHog for privacy-safe product events, Netlify for deploy/runtime logs and Supabase for database/function logs. Never send document bodies or uploaded content to analytics.

## Reliability requirements

- timeout every external request,
- retry only transient failures with capped backoff,
- add idempotency for generation, exports and webhooks,
- validate all AI output before persistence,
- use transactions or database functions for multi-row replacement,
- add feature flags and provider kill switches,
- preserve user context during retry,
- keep existing documents usable when AI providers are unavailable.

## Production phases

### Phase A — Release safety

Create shared CI, align staging and production gates, restrict production deployment, correct deployment order and add smoke tests.

### Phase B — Observability

Verify Sentry releases and source maps, add structured logging, dashboards, synthetic monitoring and incident ownership.

### Phase C — Backend reliability

Add timeouts, retries, idempotency, atomic updates, output validation and graceful degradation.

### Phase D — Security and privacy

Review browser/server configuration boundaries, database access policies, upload controls, account deletion, retention and automated dependency scanning.

### Phase E — Recovery and scale

Test restoration, define recovery targets, load-test core workflows, queue long operations when required and tune limits from measured usage.

## Definition of production ready

PrompTED is production ready when every release is gated and reproducible, staging reflects production, schema changes remain compatible, critical user journeys are tested, failures are observable, alerts have owners, user data is isolated, retries cannot corrupt work, backups have been restored successfully and a severe release can be rolled back quickly.
