# PrompTED.AI

PrompTED is an outcome-completion workspace for creating evidence-grounded,
reviewable documents. This repository rebuilds the application in the existing
PrompTED lineage around four fixed platform boundaries:

- Next.js 15 and React 19 for the progressively rendered web workspace;
- Supabase Auth, Postgres, RLS, RPCs, Storage, and Edge Functions for durable
  workflow truth;
- one server-owned OpenAI Responses adapter for all active intelligence;
- Netlify for the web build, with stable `/api/*` paths served by the
  environment-scoped Next.js gateway and protected Supabase Edge Functions.

Repository-root [`AGENTS.md`](./AGENTS.md) is the implementation authority.
Committed `ClaudeTED.AI@3a9a7bc7afa26c66fcbfa56266302c148d9dfc37`
is an immutable source-import foundation: each retained file must be audited,
and no dirty overlay is part of this repository.

## First captured cohort

The rebuild defines these document contracts as the first permitted captured
cohort, but leaves every captured activation pointer disabled by default:

1. `resume`
2. `selection-criteria-response`
3. `moving-house-checklist`
4. `complaint-letter`
5. `incident-near-miss-report`

Other historical documents remain readable through compatibility paths. They
are not silently rebound to a new ledger or provider.

Captured activation remains an explicit later cohort action. It is blocked
until an owner-controlled revisioned per-user/tenant cohort assignment exists,
claim-level grounding/conflict fixtures pass, and the clarification,
reload/resume, approval, and exact-revision export acceptance matrix passes for
the selected environment and assigned users. A process-wide cohort label is
not sufficient production activation authority.

## Workspace

```text
apps/web/          Next.js application and focused client interaction islands
packages/shared/   Public contracts, ledger definitions, and deterministic logic
supabase/          Forward migrations, protected orchestration, RLS/RPC tests
scripts/           Immutable-import and release verification
docs/              Current decisions and evidence; history stays in Git lineage
```

Mobile is deliberately outside this web-first rebuild. The incomplete imported
Expo scaffold and its Metro-only patch are not part of the active workspace.

## Local requirements

- Node.js `22.23.2`
- pnpm `10.33.0`

```bash
pnpm install --frozen-lockfile
pnpm verify:web
pnpm dev
```

When no public deployment binding is exported, `pnpm verify:web` uses an
isolated test-only Supabase identity for its non-mutating production build.
Partial or explicit bindings are never completed with synthetic values and
must pass the same fail-closed environment validation as a direct build.

Copy public browser configuration from `.env.example` into
`apps/web/.env.local`. Keep the existing OpenAI key and Supabase service-role
key in the protected Supabase environment; never put either secret in a browser
or Netlify build variable.

## Intelligence routes

| Route      | Candidate model                   | Purpose                                     |
| ---------- | --------------------------------- | ------------------------------------------- |
| `fast`     | `gpt-5.6-luna`                    | conversation, intent, and clarification     |
| `deep`     | `gpt-5.6-sol`                     | durable document wording and section repair |
| `research` | `gpt-5.6-terra`                   | separately approved source-aware research   |
| `review`   | `gpt-5.6-sol` with high reasoning | conditional high-risk review                |

These are versioned configuration candidates, not proof of hosted model access.
There is no Anthropic or Google fallback. Deep, research, and review routes fail
durably when unavailable; a fast-route fallback stays disabled until evaluated.

## Durable completion contract

A provider response is not a saved document. Every captured generation is
accepted in Supabase before provider work and becomes reviewable only after the
exact ledger, source/evidence snapshot, operation, section revisions, usage,
allowance, and document revision commit atomically. Approval binds that exact
persisted revision. Export reloads and validates it and never trusts caller-
supplied replacement content.

## Netlify

`netlify.toml` builds `apps/web` with Node `22.23.2` and pnpm `10.33.0`, keeps
the established `/api/*` paths, and lets the fail-closed Next.js gateway route
only deployment-contract-approved work to the selected Supabase environment.
Generated output remains covered by Netlify secret scanning;
authenticated API responses are private and non-cacheable.

Deployment, hosted Supabase changes, secret changes, provider calls, and GitHub
mutations remain separately authorised operations. A ready Netlify deploy alone
does not prove signed-in generation, persistence, approval, export quality, or
production completion.
