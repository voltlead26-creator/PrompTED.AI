# PrompTED Web Production Readiness Design

## Purpose

Finish the existing PrompTED web application, verify it as a complete product, and deploy it before starting Expo mobile development. This release hardens and completes existing workflows; it does not add billing, mobile implementation, or unrelated feature expansion.

## Product outcome

PrompTED must let a non-technical user sign in, describe or upload what they need, create a structured document or action plan, review and edit the result section by section, approve it, export it, and recover it later. The released application must be publicly reachable, secure enough for personal documents, resilient to AI-provider failure, and diagnosable without leaking user content.

## Existing architecture retained

The web application remains a Next.js application in `apps/web`, backed by Supabase Auth, Postgres, Storage, and Edge Functions. Shared contracts remain in `packages/shared`. Netlify remains the web host. No framework replacement or data-model rewrite is part of this release.

The runtime boundary is:

1. The browser renders accessible, responsive workflow states and holds only public configuration.
2. Next.js provides the application shell, security headers, legal routes, environment checks, and browser-facing integration.
3. Supabase owns authentication, durable application data, row-level security, file storage, server-side rate limits, and Edge Function execution.
4. The AI provider router owns provider selection, health tracking, cooldowns, retry/backoff, and sanitised operational logging.
5. GitHub Actions gates releases. Netlify and Supabase receive production changes only after the complete release suite passes.

## Scope

### Current work integration

- Preserve the completed Enhanced DIP contracts for all 86 catalogue templates.
- Finish and verify the Master Workspace editor layout so the section heading and action bar remain fixed while only section prose scrolls.
- Prevent standalone PDF page markers from becoming imported sections.
- Review and integrate existing user-owned repository instructions and plans without deleting unrelated files.

### Existing web workflows

The release covers:

- authentication and account recovery;
- home/create and clarification flows;
- document generation and recovery;
- Master Workspace import, review, editing, approval, history, preview, and export;
- library and saved-work recovery;
- checklists/action plans;
- job discovery and related document tools;
- profile, appearance, account, and application settings;
- responsive behavior at desktop, tablet, and mobile web widths.

### Security and privacy

- Complete a repository security scan using delegated review where safe.
- Fix confirmed critical and high-severity findings in release scope.
- Remove user document fragments and raw upstream provider errors from logs.
- Replace instance-local abuse controls with a durable server-side mechanism where externally callable operations require enforcement.
- Verify RLS for every user-owned table named by the integration suite.
- Add a working privacy route and align session-recording behavior with disclosed policy and consent expectations.
- Tighten CSP and other response headers without breaking required application behavior.
- Resolve or explicitly block release on high-severity production dependency advisories.

### AI resilience

- Route supported tasks through explicit model/provider tiers.
- Track transient provider failures and apply bounded retry, exponential backoff, cooldown, and failover.
- Return stable, user-safe errors and preserve recoverable work.
- Do not consume credits for failed document generation.
- Cover routing, failure, and recovery paths with deterministic tests.

### Delivery safety

- Production Edge Functions must not deploy merely because code was pushed to `ClaudeTED.AI`.
- CI must gate production promotion on web/shared tests, Deno tests/checks, type-checking, linting, build, migration validation, security checks, and smoke tests.
- Environment validation must fail clearly when required public or server secrets are missing.
- Staging or deploy-preview evidence must precede production promotion.
- The production Netlify site must be publicly reachable after release; unintended team protection must be removed.

## UX and error behavior

- Loading, empty, error, retry, and recovery states must be explicit and must not erase user input.
- Imported content with low extraction confidence must be identified for review rather than silently treated as correct.
- Export remains unavailable until required sections are approved, and the UI explains the remaining action.
- Provider or infrastructure errors expose a stable user message and correlation-safe diagnostic metadata, never raw private payloads.
- Keyboard access, focus visibility, semantic labels, reduced motion, contrast, and small-screen overflow are release requirements.

## Compatibility

- Existing database data, template identifiers, URLs, and shared web/mobile contracts remain compatible.
- Database changes are additive unless a safe migration and rollback path is supplied.
- The release does not require users to recreate existing documents.
- Expo will consume the shared contracts after the web release; web-only environment helpers must not leak into mobile contracts.

## Verification contract

Release requires fresh evidence for:

- all repository web/shared unit and integration tests;
- all Supabase/Deno tests and static checks;
- TypeScript type-checking, linting, and production build;
- dependency and repository security scans;
- RLS tests for every user-owned table;
- authenticated browser checks of every principal workflow;
- responsive browser checks at desktop and mobile widths;
- deploy-preview smoke tests;
- post-deployment production smoke tests for public reachability, privacy, authentication entry, creation, saved work, and safe error handling.

## Release rule

No production deployment occurs while a confirmed critical/high security issue, broken core workflow, failing required test, missing legal route, unsafe production deployment path, or inaccessible production site remains. Deployment is the final step after all gates pass. Billing and Expo remain out of scope until this release is complete.
