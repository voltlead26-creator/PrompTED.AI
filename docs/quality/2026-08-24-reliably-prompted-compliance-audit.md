# `reliably-prompTED` Compliance Audit and Successor Extraction Record

- **Audit date:** 24 August 2026 (Australia/Melbourne)
- **Comparison branch:** `origin/reliably-prompTED`
- **Comparison commit:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Successor worktree:** `/Users/kaichurchw/PrompTED/PrompTED-worktrees/recovery-foundation-successor`
- **Successor branch:** `codex/recovery-foundation-successor`
- **Successor base:** exact `origin/reliably-prompTED` comparison commit above
- **Canonical remote:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Git common directory:** `/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED/.git`
- **Workflow ID:** `01a029df-a620-7e23-bcf6-7bea2617354b`
- **Status:** audit complete; successor implementation in progress; no commit, push, PR, merge, deployment, hosted migration, or hosted configuration change

## 1. Instruction-authority resolution

The user supplied two related sources in the same request:

| Source | Lines | SHA-256 | Determination |
|---|---:|---|---|
| `/Users/kaichurchw/Downloads/prompted-codex-instruction-bible_2.md` | 2,259 | `6b700529a0a04f2e876874530e63b1f96c9bf715e103928febd99f480b3ba52c` | older attachment and comparison baseline |
| current expanded instruction bible supplied in the request and available at `/Users/kaichurchw/.codex/.chatgpt-projects/g-p-69fcca63e8f08191927ec7a86f3aab0e/prompted-codex-instruction-bible-updated.md` | 3,142 | `ffa0779398e4b373e155f32501c702a45fda4bab73d0bd6f8d954b3ad88706d5` | controlling revision |

The expanded revision contains 922 additions and 39 changes relative to the Downloads attachment. Material additions include product-purpose authority, instruction conflict rules, branch/worktree continuity, build-directory attribution, untrusted-input policy, explicit section states, export integrity, observability/privacy, benchmark governance, and staged adoption/change control.

Installing the older attachment verbatim would silently remove those stronger current requirements. The successor therefore installs the expanded revision as the sole root `AGENTS.md` and merges only non-conflicting, reviewed repository-local constraints into that same file.

## 2. Scope and audit method

The comparison tree contained 583 tracked files:

| Top-level path | File count |
|---|---:|
| `apps` | 309 |
| `supabase` | 125 |
| `docs` | 55 |
| `scripts` | 30 |
| `packages` | 27 |
| `.github` | 14 |
| `tests` | 4 |
| root/configuration | 19 |

“Cross-check all files” was implemented as a complete tracked-file inventory plus repository-wide deterministic checks and targeted architectural traces. It is not represented as a human semantic review of every line.

Coverage included:

- every tracked path and file type;
- every agent/instruction-like filename;
- every GitHub Actions workflow, trigger, permission, shell block, branch-write path, deployment command, and secret interpolation surface;
- package scripts, workspace configuration, build configuration, deployment manifests, and output directories;
- all template catalogue entries and section keys;
- all DIPs, information contracts, benchmarks, examples, fixtures, and profile validators;
- generation, clarification, placeholder, repair, persistence, billing, export, workspace, Find a Role, role-folder, and API paths;
- all migrations, RPC/security-definer declarations, RLS references, and direct client DML call sites;
- documentation authority and time-sensitive completion/deployment claims;
- repository-wide logger, HTML, URL, provider, secret, and prompt-composition call sites;
- existing tests and the Node 22/pnpm 10.33.0 release gate.

## 3. Summary verdict

`origin/reliably-prompTED` does **not** comply with the governing instruction bible as a deployable complete system.

It does contain significant reviewed theory and several working safeguards worth preserving. The correct recovery strategy is bounded extraction into the independently based successor, not bulk transfer or ancestry from the frozen recovery branch.

### Evidence-backed task count

- **2 of 15** retained reliability-recovery tasks have a locally implemented foundation result in the successor: the evidence baseline and deployment compatibility contract.
- **0 of 15** has current production end-to-end completion proof.
- Task 3's later reviewed migration slice exists in another historical/dirty recovery context but is not on `origin/reliably-prompTED` and has no current hosted application evidence. It is not counted as complete here.

## 4. What passed or is reusable

| Area | Evidence | Use in successor design |
|---|---|---|
| Repository lineage | correct Git remote and preserved production history | retain |
| Sole instruction filename on base | only root `AGENTS.md` was tracked | retain and replace content with current consolidated authority |
| Toolchain declaration | `pnpm@10.33.0`; Node 22 workflows | retain |
| Catalogue identity | 86 unique templates and 307 sections; no duplicate section keys/orders within a template | migrate into ledger identity/display layer |
| DIP coverage | 86/86 profiles have information contracts, quality rules, benchmarks, examples, proof fixtures, and internal-review state | transform into versioned ledger fields and approved benchmark assets |
| Missing-fact theory | typed placeholder metadata, contextual questions, shared resolution keys, neutral replacements | migrate into explicit input/clarification/section-state contracts |
| No-blank safeguards | delivery guard, content checks, deterministic fallbacks, section-scoped quality gate | preserve behind ledger authority |
| Targeted repair | affected-section rewrite and preservation of safe sections | preserve with revision checks |
| Import persistence | atomic, idempotent document-import RPC and retained original-file design | use as transaction-pattern reference |
| Artifact model | typed artifact blocks, revision fields, validation findings, private generation-run concepts | adapt where compatible; do not create a second document authority |
| Export safety pieces | approval gate, placeholder metadata checks, content validation, sanitization | retain inside persisted-revision export boundary |
| Role-workflow intent | save role, action plan, tailored resume, cover letter, apply link, original-resume protection copy | connect to durable role folders and lineage |
| Release-contract theory | deployment manifest, migration/RPC/route reconciliation, exact URL validation | retained and hardened in successor |

## 5. Blocking findings on the comparison branch

### F1 — Competing template and section authorities

**Severity:** blocking architecture defect.

The repository has at least three structural authorities:

1. catalogue JSON and `CatalogTemplate` in `packages/shared`;
2. DIPs and `DocumentInformationContract` in the Edge Function shared source;
3. `STUB_TEMPLATES` plus an unknown-template generic fallback in `template-engine.ts`.

The client may submit sections in the generation request. The server accepts them as the effective structure. This violates server-owned template selection and fail-closed unknown-template behavior.

**Measured drift:** 18 of 86 catalogue/profile pairs have different section-key sets.

**Required disposition:** compile one immutable runtime ledger; fail on unknown versions/keys and unresolved mappings; use adapters only during a measured migration window.

### F2 — Universal ledger is not implemented

**Severity:** blocking product-contract defect.

Across all 86 catalogue entries:

- lifecycle fields: 0;
- immutable ledger version: 0;
- source policy: 0;
- persistence policy: 0;
- export policy: 0;
- template test cases: 0;
- section missing-information behavior: 0 of 307;
- section quality-expectation object: 0 of 307.

DIPs contain related prose and metadata, but they are not the required shared runtime ledger and do not remove the separate catalogue/fallback authorities.

### F3 — Generation success is not an atomic durable result

**Severity:** blocking reliability/billing defect.

The primary generation Edge Function streams reviewed sections and emits completion before the client performs document/section persistence. Authenticated save writes the document and sections through separate client calls. A failure can leave generated output, local cache, remote document, remote sections, usage, and visible status out of agreement.

The document charge is started as fire-and-forget work after successful generation output. It is not atomically coupled to durable result commit.

**Required disposition:** immutable operation snapshot; durable run; transactional result/section/revision/usage commit; idempotent replay; stale-write protection.

### F4 — Primary generation is not a resumable state machine

**Severity:** blocking recovery defect.

The document path remains one long request with heartbeats. Private artifact-generation tables do not make the primary path durable. A disconnect or function interruption cannot reliably answer which stage committed, which sections are safe, or whether retry is a replay.

### F5 — Export trusts caller-supplied final content

**Severity:** blocking export-integrity defect.

The server performs useful approval/placeholder/content validation, but an authenticated export may still provide title and section bodies in the request. It does not require loading the exact approved persisted document revision. Export history is best-effort.

The current placeholder policy also allows required unresolved placeholders after explicit acknowledgement, whereas the governing default blocks export unless a reviewed low-risk contract explicitly permits it.

**Required disposition:** persisted approved revision ID only; server reload; ledger/version validation; artifact hash and durable export record.

### F6 — Parallel generation pipelines remain asymmetric

**Severity:** blocking consistency defect for universal coverage.

`generate-document` has the strongest pipeline. Artifact, checklist, report, edit, and other paths have different validation, persistence, and output contracts. Catalogue-wide reliability cannot be inferred from the strongest path.

### F7 — Branch-writing and controller workflows

**Severity:** blocking repository-security defect.

The base contained PR/push workflows with `contents: write`, bot commits, rebases, merges, broad `git add -A`, automatic `--ours` conflict resolution, and branch pushes. One file explicitly described itself as a temporary controller. Several referenced stale repair branches.

Affected workflows included:

- `apply-enhanced-dip-runtime-contract.yml`;
- `apply-resume-information-contract.yml`;
- `reconcile-enhanced-dip-upload.yml`;
- `reconcile-enhanced-dip-visible.yml`;
- `verify-workplace-governance-per-profile.yml`.

The base also had duplicate general CI and specialized controller workflows that could drift.

**Successor disposition:** remove branch-writing controllers and duplicate CI paths; preserve verification in the authoritative root test/CI path.

### F8 — Independent function-deployment bypass and unsafe function-name boundary

**Severity:** blocking release-security defect on the base; addressed locally in successor.

`deploy-supabase-functions.yml` could deploy independently of the production release gate, and function names were interpolated from workflow output into shell source.

**Successor disposition:** remove the independent route; resolve active names from the contract in Node; validate strict lower-kebab-case; call the CLI with separate arguments and `shell: false`; test hostile contract values.

### F9 — Staging is not isolated

**Severity:** release blocker.

The base staging workflow documented that it shared the production Supabase project, then pushed a staging branch after a partial gate. This is a preview using production data, not isolated staging.

**Successor disposition:** remove the misleading/mutating staging workflow. Reintroduce staging deployment only with an explicitly approved isolated contract or label a non-mutating preview accurately.

### F10 — Documentation authorities conflict and contain stale claims

**Severity:** high governance risk.

The repository contained several documents claiming to be canonical or authoritative, with mutually inconsistent template counts, branches, deployment paths, providers, and completion states. Examples include an old master table of contents, phase architecture, implementation plan, production-readiness overview, and dated quality reports.

**Successor disposition:** root `AGENTS.md` is process authority; rewritten `docs/CANONICAL_ARCHITECTURE.md` is target-system authority; source/migrations/tests prove implementation; dated material is historical/scoped evidence.

### F11 — Repository-wide raw Deno lint is red

**Severity:** release-quality blocker, not hidden by focused passes.

The inherited successor handoff recorded 81 pre-existing findings for `deno lint supabase/functions scripts`. The changed foundation scripts pass focused Deno lint. Both statements must remain visible.

### F12 — Find a Role role folders are only partially implemented

**Severity:** product-workflow gap.

The schema defines `role_documents`, and the UI says saved roles become role folders, but current application traces do not demonstrate durable population and reopen of the full role bundle. Button labels also diverge (`Action plan`, `Cover letter`) from the approved plain-language labels (`Action guide`, `Write cover letter`) in places.

### F13 — Master Workspace is not fully ledger-driven

**Severity:** product-contract gap.

The interface contains useful editor, preview, version, approval, import, and recovery pieces. Section identity and state are still reconstructed from catalogue/client/generation responses rather than one persisted ledger revision. Approval is not yet universally tied to an immutable document revision.

### F14 — Current production outcome proof is absent

**Severity:** release blocker.

The latest retained live benchmark records resume and cover-letter completion failures or blockers. Local builds, non-empty events, historical provider success, and locally green tests do not supersede that evidence. No newer signed-in production save/reopen/edit/approve/export artifact proof was obtained in this audit.

## 6. Successor changes applied from reviewed theory

The successor preserves source branch state and applies bounded changes only:

1. current consolidated instruction bible installed as the sole root `AGENTS.md`;
2. verified repository-local branch, coordination, review, and language rules merged into that file;
3. production release split into a non-mutating verification gate followed by schema/function/web mutation;
4. explicit production-ref, target, URL, function-name, and credential-order validation;
5. contract-driven safe Edge Function launcher;
6. independent function-deployment route removed;
7. branch-writing/staging/controller and duplicate general CI workflows removed;
8. CI push target aligned to `reliably-prompTED` and every retained workflow/job given explicit permissions;
9. focused generation harness tests folded into the authoritative root test command;
10. canonical architecture rewritten as a long-lived target design with compatibility, migration, recovery, security, observability, and verification boundaries;
11. this audit and the continuity handoff preserved in the durable successor worktree.

These changes establish a compliant foundation direction. They do not implement the runtime ledger, generation transaction, schema slice, role-folder workflow, or production proof.

## 7. Build and output identity

| Field | Value |
|---|---|
| Required runtime | Node 22 |
| Required package manager | pnpm 10.33.0 |
| Full local gate | `pnpm verify:web` |
| Configured web output | `apps/web/.next` |
| Output ownership | ignored, branch-local worktree output |
| Deployment manifest | root `netlify.toml` |
| Supabase deployment identity | `supabase/deployment-contract.json` |

The prior inherited local build output under this worktree was attributable to the earlier successor slice. Fresh post-integration verification is required before the expanded diff receives a local-pass label.

## 8. Verification record

This section is updated only with fresh post-change evidence.

| Check | Result | Environment |
|---|---|---|
| sole `AGENTS.md` filename scan | pending | local successor |
| instruction content/hash and merge review | pending | local successor |
| workflow YAML parse | pending | local successor |
| actionlint | pending | local successor |
| changed-script syntax and Deno lint | pending | local successor |
| deployment hostile-input tests | pending | local successor |
| deployment contract reconciliation | pending | local successor |
| documentation links/encoding/diff check | pending | local successor |
| `pnpm verify:web` under Node 22/pnpm 10.33.0 | pending | local successor |
| raw `deno lint supabase/functions scripts` | expected inherited red; rerun pending | local successor |
| signed-in browser workflow | unverified | no hosted/browser action authorized or exercised |
| hosted CI | unverified | branch not pushed |
| GitHub configuration checkpoint | unverified | no current API evidence gathered |
| Supabase/Netlify staging or production | unverified | no hosted mutation authorized |
| persistence and export artifact | unverified | no hosted workflow exercised |

## 9. Stop and proceed boundary

Proceed locally with foundation review and verification.

Stop before:

- committing the successor;
- pushing the branch;
- opening a PR;
- merging into `reliably-prompTED`;
- promoting to `ClaudeTED.AI`;
- changing GitHub settings, secrets, or environments;
- applying migrations or deploying Supabase/Netlify;
- claiming the runtime ledger or production workflow is complete.

Each action requires its own current authorization and readiness evidence.
