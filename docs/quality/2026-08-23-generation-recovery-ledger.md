# Generation Recovery Ledger

**Plan:** `docs/superpowers/plans/2026-08-22-prompted-reliability-recovery-architecture.md`
**Purpose:** Task 1 evidence baseline — audits every claim the plan makes against the
actual repository state, using the plan as source of truth for *what to check*, not
for *what is already true*. Status values follow `AGENTS.md` §8:
`not_started`, `existing_unverified`, `in_progress`, `blocked`, `implemented_unverified`,
`verified`, `failed`, `deferred_by_gate`.

## 0. Environment

| Item | Value |
|---|---|
| Base commit | `1f408b631a3dc190bc67ec953c7322c8f3189576` (`ClaudeTED.AI`, matches `origin`) |
| Worktree | `.claude/worktrees/codex+generation-reliability-recovery` |
| Branch | `codex/generation-reliability-recovery` |
| Node | v26.7.0 |
| pnpm | 10.33.0 |
| Deno | 2.9.5 (stable, aarch64-apple-darwin) |
| Supabase CLI | present at `/opt/homebrew/bin/supabase` |
| Netlify CLI | **not installed** in this environment |
| `git status` at branch-off | clean except untracked `.vscode/` and the plan doc itself — no concurrent dirty work to reconcile |

## 1. Plan-evidence audit: does the cited spec exist?

- `docs/quality/2026-08-22-document-generation-pipeline-local-audit.md` (the plan's cited
  **Spec**) — **not_started**. Does not exist anywhere in the working tree, in any of
  ~100 local/remote branches (`git log --all`), in any of 138 GitHub PRs (all merged or
  closed, none open), in `git fsck` dangling objects, or in the four related sibling
  GitHub repos (`PrompTED-clean`, `PrompTED.AI`, `WebPrompTED`, `TED.AI`). Treated as
  never-produced. `AGENTS.md` is the surviving authoritative process doc and was used
  in its place for the parts of this audit it governs (review gates, change control).

## 2. Executive Finding claims, audited

| Claim | Status | Evidence |
|---|---|---|
| `consume_rate_limit` RPC is called by the shared request guard before provider routing | **verified (locally)** | `supabase/functions/_shared/rate-limiter.ts:51` calls `store.rpc("consume_rate_limit", ...)`; `auth-guard.test.ts:52` asserts on the same RPC path. |
| `consume_rate_limit` is defined in a migration not yet applied live | **implemented_unverified** | Migration exists locally: `supabase/migrations/20260819000000_add_durable_rate_limits.sql` defines the function. Whether it is applied to any live/staging project is **blocked** — no staging credentials available in this environment (see §6). |
| Local workspace contains later migrations for durable rate limiting, credit reservations, atomic workspace persistence, catalogue sync, and generation-result replay | **not_started** (contradicts plan) | Only `20260819000000_add_durable_rate_limits.sql` exists. Repository has 23 migrations total, newest dated `20260819000000`. No file or identifier resembling `save_document_workspace`, `reserve_document_credit`, `document_generation_result` exists anywhere in `supabase/functions/`, `apps/web/src/`, or `packages/` — confirming the *calling code*, not just the migration, was never written. |
| Document path has accumulated multiple recovery mechanisms (server validation, client fallback, cache recovery, replay, section regen, export gates) | **verified (locally)** | Present: `document-placeholder-policy.ts` (453 lines), `draft-validator.ts` (136 lines), `output-integrity.ts` (55 lines), `TedPlaceholderExtension.ts` (82 lines), `document-delivery-guard.ts` (17 lines — thin), `document-pipeline.ts` (1408 lines). |
| `generate-document` has the strongest validation/replay boundary; `generate-artifact`/`generate-checklist`/`generate-report` are thinner, separate flows | **verified (locally)** | Line counts: `generate-document/index.ts` 475, `edit-section/index.ts` 193, `generate-checklist/index.ts` 133, `generate-report/index.ts` 128, `generate-artifact/index.ts` 78. Confirms real asymmetry, though the plan's claim that generate-report "bypasses canonical document validation entirely" was not independently re-verified line-by-line (would require reading generate-report/index.ts in full — flagged for Task 10). |
| Client receives section events only after full pipeline resolves; heartbeats only, no durable progress | **existing_unverified** — plausible from file structure (`generate-document/index.ts` has a single request/response handler, no separate run-state store exists), not exhaustively traced end-to-end in this pass. |
| Repository has two Netlify manifests with different route lists | **verified** | **Correction (2026-08-23):** the original audit pass in this ledger was wrong — it ran `find . -maxdepth 2 -iname netlify.toml`, which excludes `./apps/web/netlify.toml` (a depth-3 path) by construction. Task 2's implementer found the real file during implementation: `apps/web/netlify.toml` existed and had genuinely diverged from the root manifest (missing `explain-section`/`proofread-document` routes in both directions). Reconciled to one root manifest as part of Task 2 (commit `a6f378e`). Recorded here as a correction to this ledger's own methodology, not just a plan-vs-reality note — a shallow `find` depth is not proof of absence. |

## 3. "Implemented locally but not yet release-proven" claims, audited

| Claim | Status | Evidence |
|---|---|---|
| Capability tiers (fast/document/review/reasoning) and per-tier provider model variables | **not_started (contradicts plan)** | `provider-router.ts` exports no `ModelTier` type or tier abstraction — grep for tier-name literals and `ModelTier` returned nothing. Callers pass a raw `task` string mapped through `PROVIDER_ROUTING_MAP`/`PROVIDER_FALLBACK_ORDER` env vars, not a tier. Matches `AGENTS.md`'s own "Phase 0.2: Not started" line (still current). |
| Bounded provider retries and in-memory provider cooldown | **implemented_unverified** | `provider-router.ts` has `ProviderHealth` interface, `providerIsCoolingDown`, `recordProviderSuccess`, `recordProviderFailure`, `retryDelayMs`, `isRetryableProviderStatus` — real, in-memory (not durable — matches Task 4's requirement to "make health/cooldown state durable or deliberately instance-local with documented semantics"). This is *more* advanced than `AGENTS.md`'s 31-July snapshot ("Zero cooldown... Not started"), so real progress has landed since that doc was last verified. |
| Provider router test coverage (12-scenario matrix) | **implemented_unverified, partial** | `provider-router.test.ts` is 102 lines (5 real Deno.test blocks: JSON-container accept/reject, retry-status classification, one retry-recovery integration test, one invalid-JSON-no-leak test). This is more than `AGENTS.md`'s "16 lines, JSON-shape only" (31 July) but well short of the 12-scenario matrix Task 4 requires — no fallback-chain test, no cooldown test, no abort-propagation test found. |
| Canonical section restoration and visible-content checks | **implemented_unverified** | `document-pipeline.ts` (1408 lines) and `output-integrity.ts` exist and are substantial; content not fully read line-by-line in this pass — deeper read deferred to Task 7/8 implementers. |
| Required-section TED fallbacks and unresolved-placeholder export gating | **implemented_unverified** | `document-placeholder-policy.ts` (453 lines) and `TedPlaceholderExtension.ts` (82 lines) exist. |
| Atomic document-and-section persistence migration | **not_started (contradicts plan)** | No migration matching this exists; no RPC name (`save_document_workspace` or similar) referenced anywhere in code. |
| Atomic document credit reservation and result replay migrations | **not_started (contradicts plan)** | Same — no migration, no calling code. Current allowance mechanism is simpler: `generate-document/index.ts` charges the usage ledger only after the pipeline succeeds (comment at line ~271, ~426), using the existing `usage_ledger_generation_idempotency` migration (`20260722080500`) — a real but different mechanism than the "reservation + lease + replay" architecture Tasks 5/6 propose building. |
| Server-owned template section selection for catalogue documents | **existing_unverified** — not independently traced in this pass; deferred to Task 7 implementer, who touches this code directly. |
| Server-side export reload and output-integrity checks | **existing_unverified** — `render-export/` exists; `export-gate.ts` specifically (which Task 8/11 reference) does **not** exist at `supabase/functions/render-export/export-gate.ts`. |

## 4. Evidence that requires live/staging access — blocked

The following Task 1 exit-evidence items cannot be produced from this sandboxed
worktree; no real Supabase staging credentials are configured (only `.env.example`
is present, no `.env`). **Status: blocked pending credentials**, not silently skipped
(per `AGENTS.md` §7 rule 8):

- Live Supabase migration ledger version (plan claims it stops at `20260812162215`).
- Live existence check for `consume_rate_limit`, `save_document_workspace` RPCs and
  `private.document_generation_results` table.
- Live `public.templates` row count (plan claims 23).
- Reproducing the signed-in immediate `clarify` HTTP 500 in staging or a safe test
  account, with request ID and corresponding database error.
- Confirming which Edge Functions are actually deployed/active on the live project.
- Testcontainers Cloud quota check (plan claims 50 minutes available).

**Owner action needed:** supply a staging Supabase project URL + service-role (or
equivalent) key, confirmed non-production, before these items can move from
`blocked` to `verified` or `failed`.

## 5. Local gate results

| Gate | Command | Result |
|---|---|---|
| Deno check (generate-document) | `deno check --lock=deno.lock supabase/functions/generate-document/index.ts` | **pass** |
| `verify:web` composite gate | `corepack pnpm verify:web` | **does not exist** — no such script in `package.json`. Task 1's instruction to run it assumes Task 2 (which creates `scripts/verify-web-release.mjs` and wires the script) has already happened. Not run; recorded as a plan-ordering gap, not a failure. |
| Raw Deno lint | `deno lint supabase/functions scripts` | **fail** — 81 problems across 121 checked files: 41× `no-import-prefix` (inline `npm:`/`jsr:`/`https:` specifiers, mostly in `*.test.ts` files), 25× `no-unversioned-import` (paired with the above), 6× `require-await`, 4× `no-unused-vars`, 3× `no-regex-spaces`, 1× `no-empty`, 1× `no-control-regex`. Two named in the plan's own Task 12 text are present: `document-pipeline.ts` has an unused `isCommunicationDocument` function (line 302), an unused `brief` parameter (line 324), and `generateDraft` (line 909) is `async` with no `await`. Recorded verbatim, not weakened; this is Task 12's "reduce raw Deno lint problem set to zero or record a time-boxed baseline" starting point. |

## 6. Rulings carried from preflight (see `.superpowers/sdd/.../progress.md` and `preflight-scan.md`)

- **Greenfield ruling:** Tasks 3+ build the plan's "already implemented" migrations
  and files as new work, not verify-and-integrate. Cost if wrong: rework if that work
  resurfaces elsewhere — exhaustive search (branches, PRs, dangling objects, sibling
  repos) found nothing, so this is treated as settled, not provisional.
- **Task 2 apps/web/netlify.toml removal:** ~~no-op, file doesn't exist~~ — **superseded**, see §2 correction above. The file existed; this ruling was wrong and the implementer caught it independently.
- **Task 8 export-gate.ts / document-content.ts:** authored fresh, not edited, since
  neither exists yet.
- **Coordination:** peer Claude Code session `prompted-2f` confirmed no overlapping
  work in flight. The repository's Codex task-boundary board
  (`.codex/coordination/project.yaml`) is enabled but empty (no active claims) and is
  scoped to native Codex CLI thread UUIDs, which this session does not have; per that
  skill's own rule, a session without a native UUID does not register a claim and
  continues single-task work instead. No collision risk exists regardless, since this
  work is isolated to its own worktree/branch and lands only via reviewed PR merge —
  the same change-control path `AGENTS.md` §5 already requires.

## 7. Next steps

1. Run raw `deno lint supabase/functions scripts` and record the result here.
2. Obtain staging credentials from the owner to clear §4's blocked items.
3. Proceed to Task 2 (deployment compatibility contract) — genuinely new work, no
   plan-vs-reality gap found there beyond the netlify.toml no-op already ruled on.
