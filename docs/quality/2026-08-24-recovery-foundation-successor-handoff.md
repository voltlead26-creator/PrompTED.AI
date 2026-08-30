# Recovery Foundation Successor — Continuity and Verification Handoff

**Recorded:** 24 August 2026 (Australia/Melbourne)
**Workflow ID:** `01a02eca-55a4-79f3-926a-09c32df95900`
**Status:** locally implemented and verified; not committed, pushed, reviewed in a PR, merged, deployed, or verified against a hosted environment

## Purpose and product guardrail

This workflow re-establishes a narrowly bounded recovery-foundation hardening slice from the new default integration base. It does not import the frozen recovery branch wholesale and does not begin the document-generation expansion.

PrompTED remains an outcome completion platform for non-expert outcome owners who need to turn fragmented facts and unfamiliar processes into safe, usable documents, actions, evidence, and an explicit completed or unresolved next state. TED remains the calm, evidence-aware guidance layer. This infrastructure work supports that product goal by making release identity, credential-bearing probes, and deployment state more trustworthy; it deliberately makes no user-facing design or generation change.

## Authorities used

- External instruction authority: `/Users/kaichurchw/.codex/.chatgpt-projects/g-p-69fcca63e8f08191927ec7a86f3aab0e/prompted-codex-instruction-bible-updated.md`
- Repository process authority: `AGENTS.md`
- Repository plan authority: `docs/plans/PHASED-IMPLEMENTATION-PLAN.md`
- Deployment identity authority: `supabase/deployment-contract.json`

The external instruction file was treated as a product and workflow authority, not as proof that repository or hosted state already matched it. Current Git state and build outputs were independently inspected.

## Canonical repository and workflow location

| Field | Verified value |
|---|---|
| Authorized remote | `https://github.com/voltlead26-creator/PrompTED.git` |
| Shared Git directory | `/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED/.git` |
| Stable worktree | `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor` |
| Workflow branch | `codex/recovery-foundation-successor` |
| Default integration base | `origin/reliably-prompTED` |
| Start/current HEAD before a local commit | `e7f4e37e3087ee166c16ab242b17c60b3877f16b` |
| Production branch | `origin/ClaudeTED.AI` |
| Production commit observed at start | `1f408b631a3dc190bc67ec953c7322c8f3189576` |
| Build command | `pnpm verify:web` under Node 22 and pnpm 10.33.0 |
| Configured web build directory | `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor/apps/web/.next` |

The `.next` directory is ignored by Git and is local to this worktree. No source or generated build output was written into the primary `ClaudeTED.AI` checkout or the frozen recovery worktree.

The read-only recovery reference remains at:

`/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED-worktrees/recovery-workflow-hardening`

Its observed branch and HEAD remain `codex/recovery-workflow-hardening` at `907cfc3f1687e28209d2392e8f38cd98541d8048`. It was not modified, merged, rebased, pushed, or used as branch ancestry.

One separate registered worktree is currently marked prunable by Git:

`/Users/kaichurchw/Documents/GitHub/PrompTED/.claude/worktrees/codex+generation-reliability-recovery`

This workflow did not remove, repair, reuse, or write to that registration.

## Implemented change

1. The production workflow now has an explicit non-mutating `pnpm verify:web` gate before either Supabase or Netlify mutation.
2. Production jobs are serialized with non-cancelling release concurrency and minimum `contents: read` permissions.
3. Production execution is refused unless the selected workflow ref is `refs/heads/ClaudeTED.AI`.
4. The contract project reference and canonical Supabase origin are validated without a service-role credential before the workflow links a project or performs its first database mutation.
5. Active Edge Functions are resolved from `supabase/deployment-contract.json` by a Node launcher that validates every function name and invokes the Supabase CLI with a separate argument array and `shell: false`.
6. The independent `deploy-supabase-functions.yml` production bypass was removed so the production workflow is the only function-deployment route.
7. The contract checker now scans every workflow for direct or launcher-based function deployment, rejects independent deployment routes, validates the production release chain and pre-mutation target gate, rejects unsafe function identifiers, and parses redirect project identity through an exact HTTPS hostname check rather than a permissive text match.
8. Credential-bearing Supabase schema probes now accept only the exact canonical HTTPS hostname for the contract project, with no user information, custom port, path, query, fragment, suffix, or project mismatch. Validation occurs before a service-role credential can reach `fetch`.
9. Supabase and Netlify deployment values are passed to shell commands through quoted environment arguments rather than direct secret interpolation.
10. Targeted hostile-input and regression tests were added and wired into the normal test and release gates.
11. `AGENTS.md` now distinguishes the `reliably-prompTED` default integration branch from the `ClaudeTED.AI` production branch.

## Changed source paths

- `.github/workflows/deploy-prod.yml`
- `.github/workflows/deploy-supabase-functions.yml` — deleted
- `AGENTS.md`
- `package.json`
- `scripts/check-deployment-contract.mjs`
- `scripts/check-deployment-contract.test.mjs`
- `scripts/deploy-contract-functions.mjs` — added
- `scripts/deploy-contract-functions.test.mjs` — added
- `scripts/probe-supabase-contract.mjs`
- `scripts/probe-supabase-contract.test.mjs` — added
- `docs/quality/2026-08-24-recovery-foundation-successor-handoff.md` — added

## Verification evidence

### Release toolchain

- Node: `v22.23.2`
- pnpm: `10.33.0`
- `pnpm install --frozen-lockfile`: passed; lockfile resolution unchanged
- pnpm reported the existing blocked optional build script for `unrs-resolver@1.12.2`; no approval state was changed

### Changed-scope checks

- Node syntax checks for all six changed or added scripts/tests: passed
- Deno lint for all six changed or added scripts/tests: passed
- `actionlint -no-color .github/workflows/deploy-prod.yml`: passed
- YAML parsing for all workflow files: passed
- `git diff --check`: passed
- Deployment contract tests: 29 passed, 0 failed
- Deployment contract reconciliation: passed for 24 declared functions

### Complete local web gate

`pnpm verify:web` passed under the release toolchain. It covered:

- text-encoding check;
- product-promise registry check (6 promises);
- migration validation (23 migrations);
- workspace lint;
- workspace TypeScript checks;
- 29 deployment/security contract tests;
- 110 shared-package tests;
- 374 web tests;
- production Next.js build.

The web test run emitted the existing JSDOM navigation diagnostic while its related tests passed. The production build emitted a Supabase package warning about `process.version` in the Edge Runtime and still compiled successfully.

### Build directory verification

- Resolved output: `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor/apps/web/.next`
- Size at verification: `375M`
- Build ID: `kpmJYqdB0h5e26CHmmHXX`
- Git tracking: ignored by `**/.next/`; no tracked build output
- Build timestamp: `2026-08-24 01:44:35 AEST`

This proves a successful local build from the designated successor worktree. It is not staging, production, Netlify, Supabase, signed-in browser, persistence, export, or live outcome evidence.

## Repository-wide baseline findings outside this slice

- Raw `deno lint supabase/functions scripts` remains red with 81 pre-existing findings across the wider source set. The six files changed or added by this workflow pass focused Deno lint.
- Whole-directory `actionlint` reports four pre-existing shell findings in `apply-enhanced-dip-runtime-contract.yml` and `reconcile-enhanced-dip-upload.yml`. The changed production workflow passes independently.

These findings were not changed because they are outside the claimed recovery-foundation slice. They remain visible and must not be described as green.

## Hosted and workflow evidence not obtained

No GitHub workflow was dispatched. No Supabase function, migration, or schema was changed. No Netlify deployment occurred. No secret, environment, branch protection, GitHub default-branch setting, staging project identity, production project identity, or provider credential was mutated. No live browser workflow was exercised.

Accordingly, this slice is locally verified only. It is not production-ready or deployed evidence by itself.

## Next gate

1. Review the complete local diff and create a bounded local commit if accepted.
2. Push only `codex/recovery-foundation-successor` and open a draft PR into `reliably-prompTED` when explicitly authorized.
3. Require hosted CI and owner review; resolve the repository-wide lint baselines through separately claimed work rather than hiding them in this slice.
4. Merge the foundation successor into `reliably-prompTED` only after review evidence is complete.
5. Promote an approved release revision deliberately from `reliably-prompTED` to `ClaudeTED.AI`; do not treat a default-branch merge as a production release.
6. Begin the separate document-generation/ledger workflow only after the required foundation gate is accepted. Its design must refer back to PrompTED's outcome-completion goal, target users, evidence boundaries, TED's guidance role, and the prohibition on blank or falsely completed sections.

## 25 August 2026 continuation

An independent review of the uncommitted foundation diff found and this continuation repaired two release-contract defects:

1. A bare `permissions:` key could satisfy the workflow authority checker without granting an explicit permission mapping. The checker now accepts only an explicit `{}` declaration or a mapping whose permission values are `read`, `write`, or `none`; a regression test proves blank workflow and job declarations fail.
2. The Supabase probe documentation described `SUPABASE_PROJECT_REF` as optional, but the launcher required it before reading the immutable deployment contract. The override is optional again; when supplied it is still cross-checked with the contract project reference and canonical HTTPS origin.

Verification was repeated in the successor worktree with Node `v22.23.2` and pnpm `10.33.0`:

- targeted deployment-contract suite: 35 passed, 0 failed;
- `pnpm verify:web`: passed, including contract checks, lint, TypeScript, 110 shared-package tests, 374 web tests, and the production Next.js build;
- `git diff --check`: passed.

No hosted workflow, deployment, migration, function, secret, environment, branch protection, push, or pull request action was performed. The next gate remains an owner-authorized local commit and review of this bounded foundation diff; the ledger/generation rebuild remains blocked until that foundation change is accepted.
