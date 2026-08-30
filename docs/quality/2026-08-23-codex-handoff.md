# Handoff: Generation Reliability Recovery Programme

**To:** Codex (or whoever continues this work)
**From:** Claude Code session `prompted-0b`, handing off due to context budget.
**Date:** 2026-08-23

## Where this lives

- **Plan (source of truth for scope):** `docs/superpowers/plans/2026-08-22-prompted-reliability-recovery-architecture.md` — 15 tasks, grouped into 4 PR slices (§14 of the plan).
- **Worktree used so far:** `.claude/worktrees/codex+generation-reliability-recovery` on branch `codex/generation-reliability-recovery`, based off `ClaudeTED.AI` @ `1f408b6`.
- **Per your own coordination rules** (`.codex/coordination/project.yaml`, `codex-coordinator` skill): that skill says coordinated Codex tasks should NOT create a separate worktree — they share the primary checkout/branch. Since this work already exists as committed history on `codex/generation-reliability-recovery`, the simplest continuation is: `git fetch`/checkout that branch (or merge its commits) into whatever checkout you're coordinating from, rather than trying to reuse the actual worktree directory above (which belongs to a different tool's session).
- **Task-execution ledger (authoritative on progress):** `.superpowers/sdd/2026-08-22-prompted-reliability-recovery-architecture/progress.md` in that worktree. This is git-ignored scratch (per the `superpowers:subagent-driven-development` skill's convention), so it won't travel with `git fetch` — read it directly from that worktree path if it's still on disk, otherwise treat this handoff doc + the commits themselves as the record.
- **Evidence ledger (committed, travels with the branch):** `docs/quality/2026-08-23-generation-recovery-ledger.md`.

## Status: Tasks 1-2 of 15 complete

Commits on `codex/generation-reliability-recovery` (in order):
1. `0623562` — Task 1: evidence ledger (audit of every plan claim against actual repo state).
2. `bd49b4e` — correction to that ledger (a `find -maxdepth 2` methodology gap missed `apps/web/netlify.toml`).
3. `a6f378e`, `944850e`, `c51d2ff` — Task 2: deployment compatibility contract (`supabase/deployment-contract.json`, `scripts/check-deployment-contract.mjs`, `scripts/probe-supabase-contract.mjs`, `scripts/verify-web-release.mjs`, CI/deploy workflow wiring). Went through 2 fix rounds after task review; both rounds' findings are resolved and independently re-verified.

**Task 3 (schema/function alignment) has not started.**

## Critical context: the plan's evidence claims don't match this repo

Before starting Task 1, an exhaustive check (working tree, `git log --all` across ~100 branches, all 138 GitHub PRs — all merged/closed, none open — `git fsck` dangling objects, and the sibling repos `PrompTED-clean`/`PrompTED.AI`/`WebPrompTED`/`TED.AI`) found:

- The plan's cited Spec, `docs/quality/2026-08-22-document-generation-pipeline-local-audit.md`, does not exist anywhere.
- Of the plan's "already implemented locally" claims, most are false for this repo: only 1 of 7 migrations Task 3 lists exists (`20260819000000_add_durable_rate_limits.sql`); capability tiers, atomic credit reservation, atomic workspace persistence, and generation-result replay have no code anywhere (not just missing migrations — no calling code either); `packages/shared/src/document-content.ts` and `supabase/functions/render-export/export-gate.ts` didn't exist (Task 2's implementer independently found `apps/web/netlify.toml` DID exist, contradicting my initial audit — worth re-verifying anything you're about to build on, don't trust either audit blindly).
- Full detail and per-claim status (`verified` / `not_started` / `blocked` / etc.) is in `docs/quality/2026-08-23-generation-recovery-ledger.md`.

**Ruling made (owner-approved):** treat Tasks 3-15 as greenfield — build the missing migrations/files/mechanisms as new work, not as "verify and integrate existing code." The plan's task *order* is still correct (it reflects the right dependency sequence — schema before functions, snapshot before run-state, etc.) even though its "already done" framing isn't.

## The actual blocker: no staging credentials

Task 3's exit evidence (and several Task 1 items) require a live/staging Supabase project: current migration ledger version, RPC/table existence checks, template row count, reproducing the `clarify` HTTP 500, confirming deployed function list, Testcontainers Cloud quota. This sandbox has no real credentials (`.env.example` only). **This is exactly why the user is handing this off to you** — if your environment has staging access, you can clear these:

1. Live Supabase migration ledger — latest applied version.
2. `public.consume_rate_limit`, `public.save_document_workspace` RPC existence; `private.document_generation_results` table existence.
3. `select count(*) from public.templates`.
4. Which Edge Functions are actually deployed (`clarify`, `interpret-intent`, `ingest-upload`, `generate-document`, `edit-section`, `render-export`, and the rest per `supabase/deployment-contract.json` now that Task 2 exists).
5. Reproduce the signed-in `clarify` failure once (staging or a safe test account) — capture HTTP status, Edge Function request ID, and the corresponding DB error. **Never capture actual document content or personal data** (this repo's `AGENTS.md` §7 is explicit: no private text, secrets, or PII in logs/records — that rule binds this handoff too).
6. Testcontainers Cloud quota remaining.

Fold results into `docs/quality/2026-08-23-generation-recovery-ledger.md` §4 ("Evidence that requires live/staging access — blocked"), flipping each item from `blocked` to `verified`/`failed` with the evidence.

## Coordination already done

- The other live local Claude Code session (`prompted-2f`) confirmed no overlapping work in flight on the files this plan touches.
- The Codex task-boundary board (`.codex/coordination/project.yaml`) was checked: enabled, schema 2, but no active claims. Per that skill's own rule, a session without a native Codex thread UUID (this Claude Code session) does not register a claim there — if you're a native Codex task, you should register your own claim per the `codex-coordinator` skill's `execution.md` before starting substantial writes, since you DO have a native UUID.

## How to continue

1. Read the plan file (source of truth for task scope) and this handoff.
2. Read `docs/quality/2026-08-23-generation-recovery-ledger.md` for the full per-claim audit.
3. If you have staging credentials: run the live-probe items above first, update the ledger, then proceed to Task 3 proper (migration tests, clean local apply, staging apply, probe, production go/no-go per the plan's own checklist).
4. If you don't have staging credentials either: do Task 3's locally-executable parts (write migration tests, verify clean local apply, `security definer`/`search_path`/grant audits) and record the live-dependent parts as still-blocked — don't fabricate results.
5. Follow the plan's own required sub-skill: `superpowers:subagent-driven-development` or `superpowers:executing-plans`, task-by-task, with review before marking anything complete. Task 2's fix-loop history (2 rounds, both resolving real gaps a first pass missed) is a good example of why the review step matters here — don't skip it under time pressure.
6. Everything stays in the feature branch until a draft PR + owner approval, per the plan's Global Constraints and this repo's `AGENTS.md` §5. Nothing gets pushed or merged without that.
