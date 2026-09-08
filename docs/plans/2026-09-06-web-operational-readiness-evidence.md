# Web operational readiness evidence register

Prepared 6 September 2026, Australia/Melbourne. This register implements the
owner's 6 September web-only handoff. It records evidence and remaining gates;
it is not a replacement instruction set, runtime contract or release approval.

## Scope and baseline

- Write target: `/Users/kaichurchw/PrompTED.AI`; primary and only worktree of this
  Git common directory (`.git`). Remote: `https://github.com/voltlead26-creator/PrompTED.AI.git`.
- Branch: `Thought-Enhanced-Document`; base/HEAD:
  `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. Live `git ls-remote --symref`
  confirms GitHub HEAD and canonical branch at this revision. Neither remote
  `main` nor the misspelled branch was advertised.
- Inspected the owner-mentioned historical-path checkout first:
  `/Users/kaichurchw/PrompTED - Historical/GitHub/PrompTED/PrompTED.AI`.
  It remains clean on `main` at `c4995ada1f9840fc1410ba6622c85a80103c1464`
  with the same remote and a separate worktree/common-directory context.
  The current handoff and maintained checkout select the write target above.
  No checkout was switched and no files were transferred.
- Instructions: current root `AGENTS.md`; historical
  `origin/reliably-prompTED:AGENTS.md` at
  `757d72b2a19b120e791de94b039f432d054cefa1` inspected as historical guidance.
  Its old repository/branch instructions do not replace current target authority.
- Runtime verified: Node `22.23.2`, pnpm `10.33.0`, Deno `2.9.5`, Apple Silicon,
  24 GiB RAM and approximately 644 GiB free disk. Node selected through
  `/opt/homebrew/opt/node@22/bin`. Expensive local checks run sequentially.
- Initial Git state: no staged/unstaged tracked changes; untracked `.agents/`,
  `skills-lock.json`, and
  `docs/plans/2026-09-06-owner-access-and-generation-retry-protection.md`.
  The handoff's environment-restructure script is absent at this inspection.
  Preserve these unrelated entries.
- Schema-2 board read with the installed helper. Foreign claim
  `01a053af-1652-71b1-90fc-52c4dcf56419`, revision 3, owns only the owner-access
  design document and `goal-coordination`. This task
  `01a0725d-e55c-7c20-9e17-02bc1e24528e` owns the deployment test and this
  evidence register/directory. No collision. Parent-owned agents only inspect
  sources and upstream advisories; the parent owns writes and verification jobs.
- No push, PR, merge, deployment, hosted migration, hosted data/Storage mutation,
  secret change, model/budget/access change, paid evaluation or external action
  has been performed or authorised by this handoff. Native/mobile app work is
  excluded. Responsive browser acceptance remains required.

## Product-purpose alignment and current slice

The target users need supported final wording, durable documents, exact approval
and usable exports. WP0 makes release checks attributable so an unrelated local
dotenv file cannot conceal defects in the deployment checks. This improves the
reliability of the acceptance evidence; it does not itself prove any user journey.
Core layout, branding, provider policy and persistence contracts are unchanged.

| Item                            | Reproduction / trace                                                                                                                                                                                                                                                                                                                          | Implementation and verification                                                                                                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| WP0-A deployment unit isolation | `deployNetlifyProduction` calls the injected/default environment check with real cwd/env before mocked process execution (`scripts/deploy-netlify-production.mjs:1148`). Most deployment scenarios omitted the dependency. A single success scenario fails with only synthetic `WP0_FIXTURE_API_KEY` present, before its intended assertions. | `scripts/deploy-netlify-production.test.mjs`: explicitly supplies the real guard with an empty temporary repository and controlled environment in 16 call sites. Keeps production default unchanged. New child-process regression proves a successful mocked scenario despite hostile parent dotenv/env; another test exercises default guard rejection of forbidden names and a service-role key in a public field before any process. | **Implemented; Verified locally** for this bounded slice.                                                             |
| WP0-B actual local dotenv       | Names-only inspection now finds only seven `NEXT_PUBLIC_*` browser variables in `apps/web/.env.local`; mode 0600. Provider configuration exists in `supabase/.env.local`, mode 0600. Root/production dotenv variants inspected are absent.                                                                                                    | `node scripts/check-web-build-environment.mjs` exits 0 against current real configuration. Values were not displayed. No environment files changed by this task.                                                                                                                                                                                                                                                                        | **Verified locally** for the existing guard and current layout; no credential-exposure or hosted-configuration claim. |
| WP0-C broad baseline            | Job job-mtonoiys-bd13df29 completed in about 69 seconds at the base revision plus the deployment-test isolation diff.                                                                                                                                                                                                                         | Frozen install and complete verify:web passed; 221 root, 229 shared and 697 web tests passed; lint/types/build/bundle passed. Edge types passed and Edge tests 599/0. Audit alone exited 1 with 8 advisories. HEAD/tracked diff unchanged.                                                                                                                                                                                              | **Verified locally** for that pre-dependency-repair worktree; current new changes still require verification.         |
| WP0-D enabled inventory         | Read source entry points and authoritative command families below; 86 catalogue entries / 307 sections / five captured contracts.                                                                                                                                                                                                             | Initial catalogue CSV contains every entry and ordered catalogue keys. Runtime activation and per-template acceptance are explicitly unverified.                                                                                                                                                                                                                                                                                        | Source inventory recorded; complete WP3 contract/benchmark mapping still **Unverified**.                              |
| WP0-E dependencies              | Fresh audit reproduces 8 advisories (6 high, 2 moderate) in four package families; direct Tiptap/DOM regression reproduces inherited executable attribute behavior.                                                                                                                                                                           | Resolved fast-uri 3.1.7, Browserslist 4.28.7, fflate 0.4.9 and all 28 Tiptap packages 3.30.5. Frozen install, editor regressions, full web gate and zero-advisory audit passed; final lock review PASS.                                                                                                                                                                                                                                 | **Implemented; Verified locally**. Browser workflow and export acceptance remain open.                                |

### Bounded test evidence

Before editing, this command exited 1 with `Web build environment security check
failed` naming only `WP0_FIXTURE_API_KEY`; the selected intended-success test
failed (0 passed, 1 failed, no skips):

```sh
PATH="/opt/homebrew/opt/node@22/bin:$PATH" WP0_FIXTURE_API_KEY=synthetic-nonsecret \
  node --test --test-name-pattern='production deployment uploads once' \
  scripts/deploy-netlify-production.test.mjs
```

After the test-isolation repair, the following command exited 0:
**179 passed, 0 failed, 0 skipped**, approximately 0.43 seconds.
The diagnostic is [wp0-deployment-tests.log](../evidence/web-operational-readiness/wp0-deployment-tests.log).

```sh
PATH="/opt/homebrew/opt/node@22/bin:$PATH" WP0_FIXTURE_API_KEY=synthetic-nonsecret \
  node --test scripts/backend-release-baseline.test.mjs \
  scripts/check-deployment-contract.test.mjs scripts/deploy-contract-functions.test.mjs \
  scripts/deploy-netlify-production.test.mjs scripts/probe-supabase-contract.test.mjs \
  scripts/check-web-build-environment.test.mjs
```

`git diff --check` and Prettier check of the modified test passed. Independent
read-only review: **PASS**, no blocking findings; confirmed real default guard
coverage, controlled fixture environments, bounded subprocesses, finally/after
cleanup, no private-value output, unchanged existing assertions and unchanged
production code. These checks do not constitute deployment or browser proof.

## Baseline completion and dependency-repair slice

The completed baseline's exit 1 is attributable only to the production dependency
audit. The full web gate passed all steps, including the real environment guard,
lint, type checks, tests, production build and progressive bundles. Its initial
165 deployment-contract tests also passed; those overlap the 221 root tests and
must not be added to a supposed unique coverage total. Edge checks passed (599
unit/contract tests). Frozen install and source/HEAD comparison passed.
See [baseline-results.txt](../evidence/web-operational-readiness/baseline-results.txt)
and the individual `baseline-*.log` files.

Build warnings remain visible: Supabase JS uses `process.version` in the Edge
Runtime import trace, and Webpack reports large cache strings. The build succeeded;
these warnings are not proven production failures or responsiveness measurements.
The current dirty worktree contains further edits since that green baseline.

A real editor test before dependency changes reproduced two failures:

1. JSON-origin `__proto__` passed through Tiptap `mergeAttributes` and ProseMirror
   `DOMSerializer` produces an inherited `onclick` attribute. This demonstrates
   the dependency defect, not an application exploit or execution of the handler.
2. Serialise/reopen changes `Date &amp; time` into `Date &amp;amp; time`.
   Original wording around the placeholder stays the same.

The second failure is now repaired in
`apps/web/src/components/organisms/TedPlaceholderExtension.ts` by undoing exactly
one layer of the four entities emitted by canonical text-node serialisation,
then HTML-escaping the label. The serializer, token identity, surrounding content,
persistence path and historical records remain unchanged. Numeric/named brace
references stay literal; whitespace entities cannot create an empty label.
`SectionEditor` consumes this helper at initial content, revision reload and
accepted edits, then serializes on update and before persistence.

The new `TedPlaceholderExtension.security.test.ts` uses real Tiptap/ProseMirror,
not editor mocks. Latest pre-upgrade result: **8 passed, 1 failed**; only the
expected dependency prototype regression remains red against installed 3.27.1.
The passed cases include three repeated reopen cycles, formatting, safe links,
raw/encoded hostile labels, literal entities, nonbreaking spaces, brace references
and whitespace-only entities. An earlier adjacent run passed the existing editor,
revision-edit, sanitisation and analytics tests (45 passing checks plus the
expected prototype failure before the extra entity cases were added).
See [wp0-editor-before.log](../evidence/web-operational-readiness/wp0-editor-before.log),
[wp0-editor-roundtrip-fixed.log](../evidence/web-operational-readiness/wp0-editor-roundtrip-fixed.log)
and [wp0-editor-before-upgrade.log](../evidence/web-operational-readiness/wp0-editor-before-upgrade.log).

Independent final source review: **PASS** for the helper, regressions and manifest
intent; no blocking finding. This is not acceptance of a not-yet-resolved lockfile.
Direct registry metadata was unavailable through the browser tool; upstream release
manifests and npm publication indexes support the target versions. The package
manager must actually resolve them; a failure must not select a silent fallback.

The next saved runner is
[run-dependency-repair.sh](../evidence/web-operational-readiness/run-dependency-repair.sh).
It preserves the initial baseline outputs; records intended lockfile changes;
requires one aligned 3.30.5 Tiptap family and the exact reviewed package patches;
runs a frozen install, focused editor suite, full web gate and fresh audit; then
compares HEAD, tracked diff and hashes of changed/new sources. The combined lock
diff still needs review after the runner completes. No Edge source was changed,
so the already-completed Edge gate is not repeated solely for browser dependencies.
Database, browser workflow, hosted, persistence and artifact-inspection gates remain
unverified. The repair improves stable clarification labels for users reopening
an unfinished document; it does not establish durable database or export acceptance.

### Dependency resolution attempt 1: alignment gate correctly stopped

Verified completion of job `job-mtoo4kjc-0def4710`: resolution exited 0 in
approximately five seconds. All requested patch versions were retrievable,
including fflate 0.4.9 and fast-uri 3.1.7. The new lock contains Tiptap core/pm/
react/starter-kit 3.30.5, Browserslist 4.28.7, fast-uri 3.1.7 and fflate 0.4.9.
However, the published `@tiptap/react@3.30.5` manifest declares optional menu
packages as `^3.30.5`; resolution selected bubble-menu and floating-menu 3.31.3,
whose exact core/pm peer requirements conflict with 3.30.5. The alignment check
exited 1 and prevented the frozen install/editor/web/audit acceptance stages.
These stages were **not run** in this attempt.

The next bounded correction pins only those two existing optional packages to
3.30.5 through root overrides. No extra editor capability is added and no broader
upgrade or fallback is selected. The first attempt's logs and patches are retained
in [dependency-attempt-1](../evidence/web-operational-readiness/dependency-attempt-1/).
HEAD is still e1d514d; the lockfile is an intentional uncommitted change and cannot
be described as accepted until alignment, regressions, audit and final diff review.

Independent review of the first resolved lock: the two menu packages are the
only unexpected Tiptap drift. Other changes are the requested security patches,
Browserslist data dependencies, ProseMirror model 1.25.9 → 1.25.11 required by the
new pm floor, and deduplication of Webpack's enhanced-resolve 5.24.0 to 5.24.5
(the latter version was already present through Tailwind at HEAD). No major
upgrade. Sentry server-utils 10.59.0's optional Vite peer mismatch with Vite 7.3.5
already exists at HEAD; neither Sentry nor Vite changed in this dependency slice.
Final post-correction lockfile review remains required.

## Enabled web surfaces and authoritative paths

The Next catch-all proxy (`apps/web/src/lib/edge-function-proxy.ts`) derives its
allowlist from active client routes in `supabase/deployment-contract.json`.
The 19 current route entries are `clarify`, `recommend`, `interpret-intent`,
`research`, `job-match`, `generate-document`, `document-operation`,
`generate-checklist`, `generate-artifact`, `generate-report`, `edit-section`,
`explain-section`, `proofread-document`, `ingest-upload`, `brand-logo`,
`render-export`, `live-source`, `account-delete`, and `webhooks/revenuecat`.
Active supporting functions without client routes: `extract-upload`,
`calculate-deadline`, `government-evidence`, `transport-victoria`.
An allowed route is not evidence of successful runtime configuration or activation.

| Capability           | Browser / API path                                                                                          | Existing authority and acceptance limitation                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace            | `/outcomes/[id]`; server `loadWorkspaceInitialState`                                                        | `get_workspace_snapshot_v1` authenticates owner and loads outcome/document. RPC failure is unavailable. Browser workflow not exercised.                                                                                                                       |
| Captured generation  | `CapturedAdmission` → `/api/document-operation` → captured runner                                           | Accepted immutable snapshots, operation/attempt records, provider checkpoints and atomic finalization. Five contracts only; activation is server/cohort controlled.                                                                                           |
| Legacy generation    | `useDocument.streamInitialDraft` → shared SSE API → `/api/generate-document` → `runDocumentPipeline`        | Documents/sections saved through `save_own_legacy_workspace_v1`; legacy allowance-response settlement precedes browser attachment. WP2 must reconcile these boundaries.                                                                                       |
| Edits / approval     | Hook/API helpers and section editor                                                                         | Captured `edit_captured_document_section`, `approve_captured_document_revision`; legacy workspace commands. Captured scoped regeneration is explicitly unavailable.                                                                                           |
| Supporting artifacts | `/api/generate-artifact`; artifact workspace                                                                | `ted_artifacts`/blocks; `save_ted_artifact`, `save_ted_artifact_block_revision`, `set_ted_block_completed`. Six active kinds: action_plan, checklist, report, recommendation, research_brief, job_match. Historical document kind is read compatibility only. |
| Checklists / reports | `/outcomes/[id]/checklist`, `/plans`, generate-checklist/report                                             | Existing checklist/artifact commands plus owner-scoped device recovery. Separate settlement/attachment requires proof. Manual plan store is device-only.                                                                                                      |
| Find a Role          | `/roles`; `/find-a-role` redirects                                                                          | Search/match APIs; `save_own_role_with_default_actions`, `saved_roles`, `role_outcomes`, `role_action_items`, `update_own_role_action_item`. Full role-to-document journey unverified.                                                                        |
| Upload / import      | Shared 8 MiB preflight → `/api/ingest-upload`                                                               | `claim_upload_ingest`, `advance_upload_ingest`, `settle_upload_ingest`; private `original-documents`; `attach_own_upload_to_outcome`. Original/reload acceptance unverified.                                                                                  |
| Plans / allowance    | `/settings/account`; subscription route redirects                                                           | Plans free/pro/premium/business; subscription/usage reads and server allowance reservations/settlement. Online web checkout is unavailable. Webhook source exists; purchase flow not proven.                                                                  |
| Export               | `pdf \| word \| excel` vocabulary; only PDF activated by server policy                                      | Captured exact-revision request/approval/export receipts, legacy snapshot/claim/reconciliation commands, immutable private storage. Real DOCX/XLSX and inspected PDF acceptance outstanding.                                                                  |
| Outcome continuation | Home/create/outcome conversation/workspace                                                                  | `create_own_outcome`, `update_own_outcome`, `save_own_outcome_conversation`. Documents, actions and external evidence remain distinct.                                                                                                                        |
| Auth / settings      | sign-in, sign-up, forgot/reset password, auth callback, profile/business/appearance/delete-account/sign-out | Supabase Auth, profile/account commands, ownership-aware data clients. Two-user and expired-session acceptance outstanding.                                                                                                                                   |
| Public / operational | `/`, `/privacy`, `/release-attestation`; library/outcome index/workspace redirects                          | Attestation is release metadata, not proof of product success.                                                                                                                                                                                                |

Catalogue: 53 core plus 33 phase-2 entries. Domains: employment 22, education 14,
business 37, finance 9, personal 4. Structure: structured form 47, compose 34,
checklist 5. Advice boundary: none 42, light 26, high stakes 18.
See [catalogue-inventory.csv](../evidence/web-operational-readiness/catalogue-inventory.csv).
This inventory is not the WP3 completed 86-row contract/evaluation matrix: profile
mapping, required-fact semantics, benchmark review and activation remain to be proven.

Additional source findings for later bounded reproduction:

- `packages/shared/src/plans.ts` advertises Word/Excel while export policy accepts
  only PDF (WP5/WP6).
- Account upgrade callback (`apps/web/src/app/(app)/settings/account/page.tsx`)
  promises team follow-up without a request/send/persistence action in that
  callback (truthful UI, WP6/WP9).
- `apps/web/src/lib/usage.ts` ignores query errors and defaults missing data to
  free/zero (WP6; failure and owner-transition behavior needs reproduction).
- `apps/web/src/app/(app)/plans/manual-plan-store.ts` persists manual plans on the
  device only; include its actual boundary in acceptance (WP9).
- Caller template-policy overrides and the captured intake wiring gap remain
  in the inspected source (F4/F7). Source inspection is not a fresh exploit or
  browser reproduction.

## Dependency research, 6 September 2026

The fresh baseline audit still reports the handoff's eight advisories; upstream
research supplies the newer patch requirements below. Package resolution and
post-upgrade checks are now verified locally in the completion below. Package
severity is distinct from demonstrated application exposure. The table records
the original vulnerable versions and the subsequently verified patch targets.

| Family                           | Current locked version   | Reviewed patch direction | Source / limitation                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browserslist                     | 4.28.4                   | 4.28.7                   | [Cache advisory](https://github.com/browserslist/browserslist/security/advisories/GHSA-c83g-rgw3-j3cx) and [statistics advisory](https://github.com/browserslist/browserslist/security/advisories/GHSA-73wf-gq98-2v4g). Build dependency via Babel/Webpack; application exploit not demonstrated.                        |
| fast-uri                         | 3.1.5, root override     | 3.1.7                    | New September 2 [port advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3) and [authority-bracket advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-58mr-gqgx-xq4g) supersede the handoff's 3.1.6 minimum. AJV/build consumer; application SSRF not demonstrated. |
| Tiptap core/pm/react/starter-kit | 3.27.1; declared ^3.26.0 | Align family at 3.30.5   | [Attribute advisory](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-cp6q-959q-f8rh) plus [core Markdown advisory](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-j95f-988m-3j2f). Active editor/placeholder consumer; actual DOM, edit/save/reload and export regression required.         |
| fflate                           | 0.4.8 through PostHog    | 0.4.9 backport, resolved | [Reviewed advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98) identifies 0.4.9; package retrieval and frozen install subsequently passed. Do not silently substitute a new major/minor family. No direct application unzip use demonstrated; analytics disables session recording/autocapture.                  |

## Successful dependency completion

Verified completion of `job-mtoo8n61-1db368b1`, exit 0 in approximately 51 seconds,
against e1d514d plus the recorded uncommitted WP0 repairs:

- Non-frozen resolution, exact family alignment and subsequent frozen install
  passed. All 28 Tiptap packages resolve to 3.30.5; Browserslist is 4.28.7,
  fast-uri is 3.1.7 and fflate is 0.4.9.
- Focused editor/revision/sanitiser/analytics checks: 52 passed in five files,
  including all nine real Tiptap/ProseMirror regression cases.
- Complete `pnpm verify:web`: passed deployment contracts, real environment
  guard, lint, web/shared types, 221 root tests, 229 shared tests, 706 web tests,
  production build and progressive-bundle checks. These are overlapping suite
  counts, not an additive claim of distinct behavioral coverage.
- `pnpm audit --prod --json`: exit 0, zero advisories in every severity category.
- `git diff --check`, HEAD comparison, tracked-diff comparison and changed/new
  source hashes passed after the intended dependency resolution.
- Independent read-only review of the final lock/manifests and placeholder
  repair: PASS. No mixed Tiptap versions or unrelated major upgrades remain.

See [dependencies-results.txt](../evidence/web-operational-readiness/dependencies-results.txt)
and the `dependencies-*.log`, source-hash and Git-state artifacts in that directory.
Earlier attempt logs remain historical failed/pending evidence; this inspected
completion supersedes their pending dependency acceptance state. WP0 test
isolation, dependency remediation and placeholder round trips are **Implemented;
Verified locally**. Full WP0/WP3 feature coverage and browser/database acceptance
remain open. No CI, deployment, signed-in workflow, persistence or exported-artifact
claim follows from these results.

## WP1 bounded F3 repair: exact legacy final wording

**Implemented; Verified locally** at the pipeline/transport-contract boundary;
broader web/Edge gate queued. Base HEAD remains e1d514d plus the recorded dirty
worktree. No database, approved revision, historical document or provider
provenance was rewritten.

Coordination claim revision 4 includes the two legacy pipeline files and the
existing WP0/evidence paths. Live board refresh reports two active claims, no
conflict or warning; the separate owner-access design remains untouched.
The sequential broader gate is
[run-wp1-legacy-final-audit.sh](../evidence/web-operational-readiness/run-wp1-legacy-final-audit.sh).
It checks the exact checkout/branch/base and runtime, frozen install, full web
gate, active Edge types, complete Edge suite, touched-file lint/format and audit;
it compares tracked changes, HEAD and hashes of both new tests before/after.

Trace: `generate-document/index.ts` calls `runDocumentPipeline`, checks
deliverability, settles the authoritative allowance/result transaction, then emits
section events. Previously, pipeline rounds 0–2 audited a draft; after section
isolation, `enforceFinalText` could call a writer or strip residual text and return
that new wording without another semantic audit. The regression returned a
fabricated criminal admission and $5,000,000 claim from a source about a $10
duplicate charge. A separate regression contains no new numbers, so the factual
review must reject it independently of the numeric backstop.

Changed production file: `supabase/functions/_shared/document-pipeline.ts`.

- Existing rounds, provider requests and checkpoint identities remain intact.
  Compare the cleanup candidate with its input by exact section key, label and
  content. Only a changed candidate receives new grounding and quality audits
  under unique `generate-document.{grounding,quality}:round-3` stages.
- Reuse the existing scoped quality gate for the exact final candidate. Rejected
  sections become declared deterministic unresolved tokens; supported siblings
  retain exact wording. No model rewrite or residual stripping follows that audit.
- An incomplete factual assessment is distinct from a finding that source wording
  is false. Unverifiable evidence after bounded review attempts raises
  `DOCUMENT_FACTUAL_REVIEW_INCOMPLETE`; it cannot become an approval or a request
  for missing user facts by dropping a low-severity issue.
- Join both bounded reviewers on success/failure. Preserve any provider
  reconciliation error using the existing allowance predicate before ordinary
  errors or cancellation. The API therefore retains its existing reservation
  hold for uncertain dispatch, while completed-provider cancellation still fences
  successful document return. No alternate billing classification was introduced.
- Touched-file Deno lint exposed three existing findings: an unreferenced private
  compose helper, an unused parameter and an async return without await. Removed
  only the private helper, retained the public parameter position as `_brief`,
  and explicitly awaited the existing concurrent writer result. Static use review
  found no caller of the removed helper; no policy behavior changed.

New `document-pipeline.final-audit.test.ts` runs the actual pipeline, strict output
contracts, provider router and model-call accounting code with synthetic HTTP/admin
transports, no network permission or live model call. Thirteen cases cover exact
supported replacement, unchanged-output call counts, fabricated numbers, unrelated
criminal admissions, residual stripping, safe siblings, incomplete/malformed
grounding, malformed/rejected quality review, in-flight uncertainty, mixed reviewer
failure precedence and cancellation during final accounting acknowledgement.

Evidence:

- Initial actual-source reproduction: 1 passed / 7 failed, saved in
  [wp1-final-audit-before.log](../evidence/web-operational-readiness/wp1-final-audit-before.log).
- Expanded pre-reconciliation test version against the immutable e1d514d
  production module in isolated temporary imports: control 1 passed / all 11
  defect cases failed. Current sources were not swapped or edited during this
  check. See [wp1-final-audit-baseline-revision.log](../evidence/web-operational-readiness/wp1-final-audit-baseline-revision.log).
- Independent review then found an error-precedence regression in the initial
  all-settled implementation. Two focused tests reproduced it before correction:
  [wp1-final-audit-reconciliation-before.log](../evidence/web-operational-readiness/wp1-final-audit-reconciliation-before.log).
  The corrected tests require the existing reconciliation predicate to remain
  true; they do not merely accept an arbitrary rejection.
- Current focused/adjacent verification: **81 passed, 0 failed**, including all
  13 new pipeline cases, placeholder/fallback/context/output contracts, draft
  validation and allowance contracts. Touched-file Deno lint passes.
  See [wp1-final-audit-adjacent.log](../evidence/web-operational-readiness/wp1-final-audit-adjacent.log)
  and [wp1-final-audit-lint.log](../evidence/web-operational-readiness/wp1-final-audit-lint.log).
- Final independent read-only source/test review: **PASS**, no blocking finding
  in the bounded patch. The broader gate is still required and will be recorded
  separately after its completion is inspected.

F3's legacy ordering defect is repaired in local source; this is not closure of
all WP1 acceptance. Existing settled historical result replays are not retrospectively
revalidated by this pipeline change. Browser settlement/attachment, digest-bound
approval/export and real model quality remain unverified.

The captured path remains a P1 blocker: current validator checks reference-ID
membership only; arbitrary neutral text can pass; reviewer output is replacement
prose; finalization/approval/export SQL and workspace eligibility largely consume
generic `passed`. Owner edits currently produce a whole-document structural
assessment. Closing F1 requires versioned ledger/pipeline/assessment contracts and
matching database commands, not an in-place rewrite of immutable history.

Additional source-confirmed grounding work remains: the legacy evidence normalizer
can reduce punctuation-only/non-Latin-only quotes to an empty string, for which
`sourceText.includes("")` succeeds. An existing quote also does not itself prove
support for an unrelated claim. These are not repaired or described as semantically
verified by the narrower `groundingComplete` indicator above.

## Verified WP1 broader completion

Inspected automatic completion `job-mtop551n-27f5e4e8`: exit 0 in approximately
69 seconds. Frozen install, full `pnpm verify:web`, touched Edge lint/format,
all Edge entry-point types, **612 Edge tests / 0 failed**, and production audit
all passed. The web gate reports 221 root, 229 shared and 706 web tests, plus
lint/types, production build and progressive bundles. Audit has no advisories.
Source hashes, tracked diff and HEAD remained unchanged during verification.
See [wp1-legacy-results.txt](../evidence/web-operational-readiness/wp1-legacy-results.txt)
and its sibling logs/state/hash artifacts. This supersedes the queued broader
gate status above for the verified WP0 plus F3 worktree. No new commit, CI,
browser/database, production, approval/export or outcome acceptance is implied.

WP2 transport work begins under coordination claim revision 5. Source tracing
confirms the legacy parser ignores malformed JSON and terminal markers, invokes
callbacks inside its parse-error catch, and accepts EOF. The hook writes draft
events through canonical workspace/cache state. The server already buffers drafts
and emits them after settlement, so removing that canonical draft callback does
not remove demonstrated early preview latency. Strict expected-set/terminal
validation establishes transport completeness only; the existing wire does not
echo document revision or validation receipt. Initial settled-but-unattached
reload identity, atomic document attachment, editor debounce and real autosave
scheduling remain explicit later WP2/WP4 gates.

## Remaining work and completion boundaries

### WP2 bounded stream and hook repair

**Broader attempt 2 verified:** inspected `job-mtoql50j-b99ea450`, exit 0 in
approximately 35 seconds. All 93 API-client and 83 adjacent web tests pass;
`pnpm verify:web` passes deployment tests/contract, lint, shared/web types,
221 root tests, 272 shared tests, 713 web tests, production build and progressive
bundles. Frozen install and zero-advisory production audit pass. Source hashes,
tracked diff and HEAD are unchanged by the commands. See `wp2-stream-results.txt`
and sibling logs. This supersedes the earlier queued gate for the parser/hook
slice, without establishing database/browser/production or full F2 completion.
The next bounded repair addresses the compatibility wrapper silently filtering
invalid final content after other callbacks may already have mutated state.

**Broader attempt 1 inspected:** `job-mtoqinqk-ee814378` exited 1 after
approximately 12 seconds. Its 93 API-client and 83 adjacent web tests, frozen
install, deployment tests/static contract, full lint and zero-advisory audit all
passed. `pnpm verify:web` stopped at shared type checking with TS18047 in
`completeSectionSet`: TypeScript did not preserve narrowing of mutable
`expectedKeys` inside the section-order callback. The broad unit/build/bundle
steps were not reached. HEAD and source hashes were unchanged by the runner.
The correction captures the expected roster in a local constant and retains
nonempty/count/order checks; independent review passed this correction.
The original runner evidence is preserved in
`wp2-attempt-1-type-check/` before the next run. The full gate is still pending;
this is a type defect in the new implementation, not a dotenv or dependency failure.

**Implemented, uncommitted:** the shared legacy document parser now requires
the exact ordered requested section set (or an early validated bespoke design),
valid bounded metadata, `[DONE]` and EOF before publishing canonical callbacks.
It handles CR/LF/CRLF, comments, multiline data, split UTF-8 and BOM, rejects
malformed/out-of-order/duplicate events, and bounds raw bytes, frames and event
counts. A 60-second per-read idle deadline detects missing server heartbeats or
a stalled close. Consumer exceptions, owner changes, cancellation and structured
provider-reconciliation errors remain observable; an unresolved cleanup promise
cannot hide the original failure. This is transport acceptance, not evidence
that the content has passed semantic review or belongs to a persisted revision.

The document hook no longer accepts draft previews into canonical state/cache.
Initial stream failure leaves existing wording and placeholders intact and
records an explicit issue instead of applying new fallback content. A provider
completion-uncertainty issue pauses scoped retry in the mounted workspace;
editing wording or another section's auth/paywall error cannot clear that hold.
The workspace displays the controlled issue reason and only offers a permitted
retry. Existing optional `retryable` compatibility is retained. This uses the
existing issue state; it is not a new durable operation or billing authority.

Changed files: `packages/shared/src/api-client/index.ts`, new
`document-stream.test.ts`, `apps/web/src/hooks/useDocument.ts`,
`persistence.test.tsx`, and the outcome `WorkspaceScreen.tsx`/test. Coordination
claim revision 6 covers the concrete outcomes parent directory because the
board rejects bracketed `[id]` paths as glob syntax. The current board still has
two active claims and no conflicts; the foreign owner-access design is untouched.

**Verified locally:** the initial 36 parser cases produced 31 expected failures
and five passes against the original parser. Four additional boundary cases and
two cleanup/deadline cases were separately red before their fixes. The final
43 parser cases and all 93 API-client adjacent cases pass, including valid nested
clarification metadata and a charset-qualified event stream. See
`wp2-stream-before.log`, `wp2-stream-boundaries-before.log`,
`wp2-stream-cleanup-before.log` and `wp2-shared-adjacent.log` in the evidence folder.

The initial three hook regressions failed on actual provisional state promotion
and a hidden reconciliation issue. The added edit-through-hold case then failed,
followed by both two-section 401/402 hold-preservation cases; these failures and
the passing reruns are saved in `wp2-hook-*.log`. The draft fixtures positively
invoke the preview callback, preserve an approved sibling, invoke the existing
aggregate save path and inspect both cache and RPC payloads for exclusion of
provisional text. Their mocked autosave callback does not prove real scheduling.
The first adjacent web run passed 79 tests; the final adjacent run passed 83 tests
including additional hold and UI cases. The two UI cases also fail against a temporary
copy of immutable `e1d514d`'s component, for its hard-coded reason; that baseline
copy and temporary fixture were removed without replacing the working component.
The current UI cases use the real issue popover with the document pane isolated,
verify allowed retry/paused action absence, and exercise keyboard closure/focus.
See `wp2-ui-before.log`, `wp2-ui-after.log`, and `wp2-hook-ui-final.log`.

**Review:** independent read-only reviews passed the 43-case parser and final
hook/UI slice after correcting both identified hold-loss paths. Broader web
lint/types/unit/build/bundle verification passed in the inspected second run of
`run-wp2-stream-web-gate.sh` as recorded above.
Edge source has not changed since the verified 612-test WP1 gate, and
active Edge code has no imports of the changed browser API client.

**Unverified / remaining release blockers:** no operation/revision echo is
available in this legacy wire. Server settlement-to-document attachment and
new-tab/reload request identity are still open. The compatibility wrapper's
silent filtering is addressed by the subsequent bounded repair below, while
fuzzy section matching remains open. Canonical
callbacks still apply separately, and real autosave timing/editor debounce need
their own regressions. The new timeout bounds stalled reads only, not pre-response
fetch, active heartbeat duration or arbitrary consumer callbacks. Captured
grounding/digest/approval/export and the complete F2 acceptance matrix remain
open. No CI, authenticated database/browser, production or export proof is claimed.

### WP2 compatibility final-wording boundary

**Implemented, uncommitted:** `apps/web/src/lib/document-generation.ts` collects
final sections and clarification metadata until the shared parser completes,
checks every final body with the existing wording validator and visible-content
check, then awaits publication in order. A later blank/scaffold/instruction/prompt
leak rejects with `DOCUMENT_FINAL_WORDING_INVALID` before any canonical callback.
The error records only section key and reason. Transport errors and rejected
consumers remain observable. Optional transient draft callbacks stay separate.
The wrapper uses the existing `withOwnerDispatchSignal` helper for the initiating
owner lease, its signal and the separately supplied cancellation signal. Checks
surround each awaited publication. No new persistence path or owner policy exists.

**Verified locally:** seven initial regressions were red for invalid-later-body,
late transport rejection and unawaited consumer failure. Two further cancellation
cases were red before using the combined lease. The final 24-case wrapper suite
passes, including real shared-parser SSE success/rejection, real principal leases,
owner/cancel fences before publication and while awaiting a consumer, and ordered
successful delivery. The complete same fixture against a temporary immutable
`e1d514d` wrapper produced **16 failed / 8 passed**, isolating the original wrapper
with the current parser/dependency harness. All baseline copies were removed and
the maintained source was never replaced. Current web type checking and touched
file lint pass. See `wp2-wrapper-before.log`, `wp2-wrapper-cancel-before.log`,
`wp2-wrapper-final.log`, `wp2-wrapper-baseline-revision.log`,
`wp2-wrapper-types.log` and `wp2-wrapper-lint.log`.

**Review:** both read-only reviewers passed the final implementation and 24-case
fixture. Coordination claim revision 9 retains the two new wrapper source/test
paths and removes the temporary baseline-only claims; no collision was observed.
The full adjacent/web/build gate subsequently passed in inspected CPJ job
`job-mtor1t29-ff834726` (34 seconds; exit 0). Frozen installation, adjacent suites,
`pnpm verify:web`, lint/types/build/bundles and production dependency audit passed.
The web gate reported **221 root / 272 shared / 729 web tests**; audit reported
zero advisories. Source hashes, tracked diff and HEAD were unchanged by the runner.
This result covers the earlier wrapper overlay, not the newer adoption slice below.

**Limits at that verification:** body usability does not prove factual grounding.
The later slice below addresses exact mapping and one acceptance/save operation;
settlement-to-document attachment, complete browser recovery and full F2 acceptance
remain open. Cancellation does not roll back an already accepted save.

### WP2 exact section destinations and complete result adoption

**Implemented, uncommitted, based on `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`:**

- `apps/web/src/lib/document-generation.ts`: validates the full document's IDs and
  selected request keys/limits before request-identity allocation or transport;
  binds each returned key to its accepted section ID; rejects fuzzy-label,
  substring, first-empty, ambiguous and missing-target reassignment. Stored names,
  keys, order, ownership and unaffected sibling objects are preserved. Historical
  keyless sections receive only the exact request-derived key on accepted wording.
- One `DocumentGenerationResult` carries the accepted document/request/scope,
  complete ordered final sections and metadata. Both canonical delivery modes
  validate the entire result before callbacks. Exact token/metadata consistency,
  existing required/export restrictions and existing neutral-option permissions
  are checked for the affected scope; sibling metadata remains literal and intact.
  Empty metadata clears only that scope, while duplicate identities, collisions,
  orphaned sibling tokens and incompatible stored keys reject before mutation.
- Scoped repair receives the full document and exact selected IDs. Intake absent
  from device-local pending state uses the accepted workspace context and template.
  This corrects the former generic/untitled request body; it is **not** a claim
  that changed input reuses an already accepted old request identity.
- A returned bespoke design must preserve the accepted ordered section contract.
  A changed design fails explicitly with `DOCUMENT_DESIGN_MAPPING_REQUIRED` before
  canonical adoption. Complete server-created bespoke structure adoption remains
  an open capability; this guard is not its implementation.
- `apps/web/src/hooks/useDocument.ts`: builds one candidate outside React updaters,
  checks owner/resource/observation/mutation epoch, adopts once, caches through the
  existing workspace path and submits the existing aggregate save queue. Save
  failure retains wording and offers save retry without another generation call.
  Retry uses current desired wording; uncertain same-resource commands replay
  exactly before newer wording is submitted.
- Same-owner navigation and unmount fence unaccepted generation. Accepted saves
  keep their owner-scoped lifetime, while a receipt from an old resource cannot
  update a newly loaded document's revision baselines. Out-of-resource uncertain
  commands cannot block that new document's saves. Resource-local generation flags
  and questions reset, and a synchronous in-flight flag admits one scoped retry
  when duplicate clicks arrive before React commits.

**Defect/reproduction evidence:**

| Fixture / log | Observed red result before its corresponding repair |
| --- | --- |
| `wp2-mapping-before.log` | 10 mapping regressions failed for label/blank reassignment, ambiguous keys, provider renaming and provisional acceptance. |
| `wp2-result-before.log` | 7 failed / 60 passed: undeclared token, metadata without token, mismatched stored key, empty result, blank/scaffold/tag-only final bodies. |
| `wp2-adoption-lifetime-before.log` | 5 failed / 4 passed: older save retry, late result after navigation/unmount, late old receipt and uncertain replay failing to save newer wording. |
| `wp2-adoption-review-before.log` | 3 failed / 52 passed: uncertain A command blocked B, duplicate click dispatch and existing required fact downgrade. |
| `wp2-navigation-controls-before.log` | Both selected navigation cases failed: stale drafting control and another outcome's uncertain command. |
| `wp2-wrapper-metadata-before.log` | Both real-SSE canonical delivery modes resolved rather than rejecting an undeclared placeholder; zero-callback expectation failed. |

The earlier `wp2-adoption-before.log` also contains one test-fixture error: it read
an unexposed `legacyDocumentRevision` field instead of the public `currentRevision`.
That failure is not counted as a product defect. Two older request-replay fixtures
had inconsistent document IDs, and the expired-session fixture had no seeded
sections. They now create coherent positive targets and preserve their original
identity/auth assertions, with successful replay wording additionally asserted.
The old draft-preview fixture now expects draft-only termination to reject;
missing-info delivery is tested after a complete nonblank section set. No test is
skipped to manufacture a pass. New preflight/design cases are acceptance coverage;
the red logs above identify the independently reproduced regressions.

**Verified locally:** `wp2-adoption-final.log`: **142 passed** across 46 helper,
50 wrapper, 11 real-autosave adoption and 35 adjacent persistence cases. The
adoption fixture retains the real wrapper, owner leases, workspace cache,
request-identity persistence, autosave and aggregate command builder; generation
transport and database endpoints are controlled synthetic fixtures. It proves
browser-side request/receipt handling, not an actual database write. Real SSE
cases distinguish transport-valid bespoke roster changes from wrapper rejection.
`wp2-adoption-types.log` and `wp2-adoption-lint.log` passed. The sequential broader runner `run-wp2-adoption-web-gate.sh` passed in inspected
job `job-mtoskmca-695f8bb9` (35.7 seconds, exit 0): 93 API and 165 adjacent
workspace cases; frozen install; complete `pnpm verify:web` (221 root / 272 shared /
795 web tests plus lint/types/build/bundles); audit zero advisories; diff check.
Source hashes, tracked diff and HEAD stayed unchanged. See `wp2-adoption-results.txt`
and the corresponding web/adjacent/audit logs.

**Review:** independent read-only persistence and mapping reviewers both passed
the final bounded slice. The broader gate passed as recorded above.
Coordination claim revision 11 adds only `generation-adoption.test.tsx`; the
foreign owner-access design remains untouched and no collision was observed.

**Unverified / next work:** complete F2 remains open. In particular, the real cache
API suppresses storage-denial errors and some UI copy assumes a device save after
cloud failure; ordinary editor autosave/debounce and dismissed-question races
need dedicated behavioral acceptance. Provider settlement/attachment across a new
initial-document identity or new tab remains open. Missing mandatory grounding,
captured generation/approval/export verification, server-owned catalogue policy,
real browser/database workflows, CI, provider evaluations, exports and hosted
acceptance are unchanged release blockers. No document key migration, hosted
mutation, branch/worktree change, push, deploy or paid provider call occurred.

### WP2 current browser-cache and account-save truth

**Implemented, uncommitted:** the existing `workspace-store.saveWorkspace` API now
returns a bounded outcome after the existing owner-bound sessionStorage write.
It distinguishes success, quota, unavailable storage, invalid/incomplete snapshots
and an unavailable guest namespace. No document data or exception text is returned
in diagnostic results. Existing import persistence remains account-first and may
ignore a failed optional cache write without reversing its successful import.

Guest retry uses the existing scope helper to restore only the same unclaimed
namespace. It requires the namespace to have been persisted successfully before
claiming recovery, and rejects a different active namespace or a claimed cache.
The storage envelope and migration-claim formats remain unchanged.

`useDocument` keeps a small cache-write receipt tied to its resource, document
and snapshot; successful device status cannot carry over to a newer snapshot.
A last failed attempt remains visible for that same document until another write,
independent of cloud status. Local setters invalidate the older account-saved
label, and Retry saves the current tab copy for guests as well as authenticated
users. Authenticated retries then use the existing cloud queue. Generation keeps
accepted wording and proceeds to account saving even if the browser copy fails.
Hydration now performs cache receipt updates outside React updaters and checks
active resource/document before adopting fetched baselines.

`useWorkspace` forwards the additive status. `WorkflowTruth`, `WorkspaceScreen`
and the retained `WorkspaceSaveNotice` distinguish a confirmed account save,
a confirmed copy in this browser tab and unconfirmed wording in the open page.
Quota is described as full browser storage. Offline notices no longer promise
unimplemented automatic recovery. The Save button calls the save path rather
than emitting an unconditional success toast. This app uses sessionStorage, so
this copy is not described as cross-tab/device durability. The notice component
has no production caller today; its compatibility tests remain active.

**Regression and acceptance evidence:**

- `wp2-cache-truth-before.log`: 12 failed / 21 passed. Real Storage.setItem denial,
  explicit write outcomes and UI cases reproduce the old unobservable result and
  false device-saved inference. Controlled generation plus real cache/queue tests
  cover quota combined with both success and failure of the account endpoint.
- `wp2-save-ui-before.log`: two Save-button cases reproduced a success toast with
  no save dispatch; two notice cases reproduced unsupported device-save claims.
  Its failed-state screen case also had a test-selector error: ContextIssue's
  accessible name includes the issue title. The corrected selector preserves the
  user-visible assertions; that selector error is not counted as a product defect.
- `wp2-guest-namespace-before.log`: the new guard initially prevented retry after
  the guest namespace was lost. The regression failed before restoring the same
  namespace through the existing helper. Added positive/negative coverage proves
  namespace restoration, different-guest refusal and claimed-cache refusal.
- `wp2-cache-final.log`: **99 passed in seven files**, including real storage reads
  of the older copy after a denied write, current-snapshot invalidation, guest
  retry after namespace loss, save-button dispatch, UI wording and the prior
  persistence/ownership/adoption fixtures. These use controlled cloud endpoints;
  they do not prove a hosted database mutation or real browser acceptance.
- `wp2-cache-types.log`: passed. `wp2-cache-types-first.log` preserves two initial
  TS2683 failures in the new Storage mock functions, fixed with explicit
  `this: Storage` annotations. Source behavior did not change for that correction.
  `wp2-cache-lint.log` records touched-file lint. `git diff --check` passes.

**Review / broader status:** independent persistence/hydration and guest/cache
reviews passed. Touched-file lint passed. The first sequential
`run-wp2-cache-web-gate.sh` run, **job-mtotay1z-e93e5212**, exited 1:
93 API and 207 adjacent workspace tests passed, as did the frozen install,
deployment contract, lint, type checks, 221 root tests and 272 shared tests.
The full web suite had **815 passed / 1 failed / 816 total**. Build and bundle
checks were not reached. The production dependency audit still reported zero
advisories; tracked source, hashes and HEAD were unchanged by the run. All 16
runner evidence files are preserved in `wp2-cache-attempt-1-hydration/`.

The failing hydration test waited for `legacy_unversioned`, a value already
present in its initial fixture, then immediately expected loading to have ended.
The production path still awaited the section response and SHA-256 baseline
work. A held-response reproduction in `wp2-hydration-wait-before.log` proves that
the old wait passes before the response is released and produces the same
loading assertion failure. This is a test synchronization defect, not evidence
of a rejected hydration guard or a new production hydration failure.

The corrected test explicitly holds the response, checks the initial wording,
revision and loading state, releases the response, then waits for the new wording,
revision and completed loading state together. It retains the no-stale-write
assertions and additionally proves that the first subsequent edit sends exactly
one aggregate command using revision 2 and the authoritative wording's hash.
No production code or validation guard changed for this correction.
`wp2-hydration-wait-after.log` records **50 passed** across persistence and real
generation-adoption fixtures; `wp2-hydration-wait-lint.log` records passing lint.
Independent read-only review passed for the corrected fixture and all retained
and added assertions.

The second full gate, **job-mtotk9qg-92d26209**, exited 1 at web type checking:
TS2352 rejected the new test fixture's cast to `Section[]`, because the basic
section type does not declare persisted revision fields. The 93 API and 207
adjacent workspace cases, frozen install, deployment contract and lint passed.
The broader unit suite, build and bundle checks were not reached in this attempt.
Audit again reported zero advisories, and source/HEAD stayed unchanged during
the command. Its 16 runner files are preserved in
`wp2-cache-attempt-2-fixture-type/`.

The fixture now explicitly uses the existing `PersistedSection` type for its
deferred response and authoritative rows, removing the assertion cast. No new
type contract or production change was introduced. Web type checking then passed
(`wp2-hydration-wait-types.log`); the 50 persistence/adoption cases and touched-file
lint passed again. Independent read-only review passed for the final typed
fixture.

**Verified locally:** the third gate, **job-mtotmvep-0dd701da**, passed in about
36 seconds on the recorded uncommitted overlay at `e1d514d`: 93 API cases,
207 adjacent workspace cases, frozen install and all of `pnpm verify:web`
(221 root, 272 shared and **816 web tests**, lint, type checks, production build
and progressive bundle checks). Audit reported zero advisories. Source hashes,
tracked diff and HEAD remained identical before/after. Results and the exact
overlay are recorded in the `wp2-cache-*` runner outputs. This closes the bounded
cache/status local gate; ordinary autosave and the other listed acceptance gaps
remain open. No hosted/CI/browser workflow proof is inferred.

Coordination claim revision 13 adds the existing autosave hook and its tests for
the next bounded repair. The foreign owner-access design and all hosted systems
remain unchanged.

**Open at the cache gate:** ordinary editor changes delivered through `setSections`
advance the mutation epoch that makes the generic autosave discard the current
value. The editor also has an earlier debounce whose newer typing can be reset by
an old save receipt. These are the next bounded WP2 repairs; accurate unsaved
labels and an explicit Save action do not close their automatic persistence or
navigation acceptance. Other F1/F2/F4, browser/DB, export and release gates remain
open. No CI, deployment, production, artifact-inspection or outcome-completion
claim follows from this local cache repair.

### WP2 ordinary-edit autosave and explicit-save cancellation — local implementation

**Trace and reproduction:** `SectionEditor` delivers an edit through `useSection`
and `useWorkspace` into `useDocument.setSections`. The setter advances the local
mutation epoch synchronously. The generic `useAutosave` then discards its pending
snapshot on that transition without scheduling the new value. Existing mocked
persistence tests could not demonstrate automatic saving. Real-hook regressions
in `wp2-autosave-before.log` failed in five cases (22 adjacent cases passed):
ordinary edit, rapid edits, unmount flush, and two opt-in scheduling contracts.

**Implemented:** `useAutosave` has an additive `schedule-current` mutation policy.
Its existing default remains `discard`; only the document hook opts in. Both
policies synchronously cancel the prior snapshot, and retain the live epoch,
principal-lease, ownership and unmount checks. The new committed edit is scheduled
with its current epoch and the existing callback/save queue. No database command,
storage envelope, operation identity or provider policy changed.

A section Apply now leaves whole-workspace save status pending until the existing
aggregate comparison checks its siblings and metadata. Matching applied wording
requires no second RPC. `wp2-autosave-apply-before.log` reproduced two premature
Saved claims; regressions also prove sibling-only content saving against the
applied revision and preservation of newer typing after an earlier receipt.

Explicit generation acceptance, manual Save/Retry and approval consume their
pending debounce using a separate scheduling sequence joined to the local edit
epoch. This does not change the edit epoch used to validate generation results.
A failed explicit save therefore stays recoverable without a hidden debounce
retry; a later genuine edit restores automatic scheduling. The existing queue
still performs a harmless baseline comparison after a successful receipt where
needed. It never needs a competing persistence store.

Save and approval callbacks check the render's edit epoch and active observation
before marking an explicit save. The same-act regression in
`wp2-autosave-stale-save-before.log` reproduced an older callback reporting Saved
with zero RPCs while consuming a newer edit. The guard keeps that callback from
cancelling the new edit's autosave. Captured approval also rejects a callback that
predates an edit or survives workspace unmount.

**Test-evidence review:** the first scratch explicit-save fixture switched fake
and real clocks with a debounce pending, so `wp2-autosave-explicit-before.log` is
not accepted as timing proof. The timed refinement initially also awaited React
state inside one held `act`; those harness failures are not product defects.
The final fixtures hold response receipts and keep one clock through the relevant
timer window. A controlled reproduction temporarily omitted only the three
explicit-save cancellation calls, ran the focused regressions and restored exact
source bytes in a `finally` block; its log is
`wp2-autosave-explicit-cancellation-before.log`. Failure before and after the
500 ms debounce, slow success, manual failure, later-edit recovery and ordinary
failure all retain explicit attempt-count and wording assertions. Outcome reuse
now also retains one fake clock throughout its pending timer and next load.
The final cancellation-disabled reproduction failed all three targeted cases
with two RPCs instead of one. A second controlled preflight-disabled reproduction
(`wp2-autosave-explicit-preflight-before.log`) failed all three targeted Save and
approval cases: zero RPCs for the consumed newer edit and true approval results
for stale/unmounted callbacks. Exact implementation bytes were restored after
each reproduction group; neither temporary variant is the implemented source.

**Verified locally / review:** `wp2-autosave-focused.log` records **78 passed**
(12 generic autosave, 29 real adoption/save-queue and 37 persistence cases).
Touched-file lint (`wp2-autosave-lint.log`), web type checking
(`wp2-autosave-types.log`) and diff checking passed. Both independent reviews
passed, including the final continuous-clock navigation fixture. The unchanged
default-policy test formatting was preserved after those checks; no behavior
changed in that formatting step.

**Verified locally:** `run-wp2-autosave-web-gate.sh`, job
**job-mtouerf4-ba4fb3a8**, passed in about 37 seconds: 93 API cases, 228 adjacent
workspace cases, frozen install and all of `pnpm verify:web` (221 root,
272 shared and **837 web tests**, lint, type checks, production build and bundle
checks). Production audit reported zero advisories. Tracked source hashes, diff
and HEAD stayed unchanged. Exact commands and the verified uncommitted overlay
are saved in `wp2-autosave-*` runner evidence at base `e1d514d`.
The fixture uses real React hooks, cache, command builder and owner leases with
controlled endpoint responses. These are local contract/integration results,
not authenticated browser, database, CI, production or exported-artifact proof.

**Subsequent editor slice:** the typing debounce defect below was reproduced and
repaired after the autosave gate. Its complete web gate is recorded separately;
the autosave job cannot establish verification of those later edits.

### WP2 — Immediate editor publication and save receipt compatibility

**Implemented:** `SectionEditor.tsx` now publishes each accepted Tiptap document
transaction directly through the existing `useSection`/`useDocument` mutation
path. The document hook retains the persistence debounce and aggregate save
queue. Removing the editor's separate delayed HTML publication means the current
wording reaches that queue before a section switch, workspace unmount or earlier
save receipt. No additional durable store or autosave path was added.

`useSection.ts` accepts an optional history flag so consecutive typing within
500 ms shares its initial history snapshot while every transaction reaches current
state. Blur, an external content replacement and deliberate Apply end the burst.
Existing two-argument callers still record a prior-wording snapshot. Existing
history entries remain intact; a locked edit now changes neither body nor history.
The functional updater captures its timestamp outside React's updater.

Incoming section content is compared using the same ProseMirror schema as the
editor, avoiding selection/caret resets for equivalent plain text, HTML and
placeholder tokens. Revision changes still invalidate old suggestions. A small
identity-scoped last-publication ref handles multiple transactions before React
renders; it only suppresses duplicate callbacks and never establishes save truth.
`WorkspacePane.tsx` forwards the existing aggregate Saved status for legacy TED
admission, preserving the exact persisted body and revision requirement. Making
an editor editable emits no generic content edit; persisted legacy Apply remains
on its receipt callback, and captured selection Apply publishes exactly once.

**Reproduced:** `wp2-editor-typing-before.log` records three real Tiptap failures:
late canonical publication, newer wording overwritten by an earlier receipt, and
zero save commands when leaving before the old editor debounce. Independent
review found a same-render insert/revert race in the first immediate-publication
implementation. `wp2-editor-batched-revert-before.log` proves it with canonical
HTML: the reverted insertion reappeared in the editor. The
corrected last-publication comparison passes that regression and immediate keyed
section switching (`wp2-editor-batched-revert-after.log`).

`wp2-editor-history-before.log` ran the new hook tests against the exact historical
`useSection.ts`: two failures demonstrate per-transaction history duplication and
history mutation on a locked row. Exact implementation bytes were restored in a
`finally` block after that controlled reproduction. Unchanged/foreign rows pass
both versions. `wp2-editor-typing-progress.log` records the intermediate duplicate
callback after legacy Apply; its existing no-generic-edit assertion was retained
and now passes.

**Verified locally:** `wp2-editor-focused.log` records **72 passed** across four
files: 38 real document adoption/editor cases, three section/history cases,
10 revision-edit cases and 21 adjacent editor cases. Nine of the real document
cases use the actual Tiptap editor, React hooks, browser cache and save command
builder with controlled transport/DB responses. They check immediate publication,
older receipt/newer typing ordering, unmount flushing, keyed section switching,
same-batch revert, grouped history/caret, placeholder identity across a receipt
and reopen, actual editor input fencing earlier scoped generation, and TED
admission only after an account receipt. The AI hook is mocked in the admission
and selection Apply cases; these establish component contracts, not provider or
hosted persistence behavior. Touched-file lint, web types and diff checking pass.
The source review passed after the batching correction.

**Fixture correction:** the initial new generation-race fixture held first-load
generation, where the loading gate intentionally has no editor. That failed
harness is preserved in `wp2-editor-initial-generation-fixture.log`; it is not a
product defect or acceptance result. The corrected fixture loads an existing
document, starts scoped regeneration, types through the actual editor and then
releases the older result. Section remount fixtures await their asynchronous
recovery effect inside `act`; no warning is suppressed.

**Verified locally:** `run-wp2-editor-web-gate.sh`, job
**job-mtovcrx5-e3caa76f**, passed in about 39 seconds: 93 API cases, 286 adjacent
workspace cases, frozen install, and all of `pnpm verify:web` (221 root,
272 shared and **850 web tests**, lint, types, production build and progressive
bundle checks). The production dependency audit reports zero advisories. Source
hashes, tracked diff and HEAD stayed unchanged. Exact commands and overlay
snapshots are saved in `wp2-editor-*` evidence.
The editor write scope was coordination revision 14;
the foreign owner-access design and all protected-action boundaries remain intact.
Base HEAD remains `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`, with this task's
uncommitted overlay. No new CI, authenticated browser, database, production or
artifact-inspection proof is asserted.

### WP2 — Persist initial document identities before generation

**Implemented:** `useDocument.ts` now admits a fresh document and its complete
section roster through the existing aggregate workspace command before initial
or scoped generation. It waits for the validated receipt and retains the existing
save queue, immutable command identity, acknowledgement replay and revision/hash
baselines. An explicit-save marker consumes the normal debounce; a failed create
does not trigger a hidden retry or start generation. Its section issue names the
save blocker and offers Save/reload recovery. Accepted saves may finish after
unmount, but generation rechecks owner, observation, resource and mutation epoch
before continuing.

The existing legacy saved-document baseline now includes owner, outcome and
document identity. Generation checks that binding. After the current owned read
finds no document, new seed acceptance clears previous outcome baselines so the
new document uses expected revision zero. Scoped retry also checks Loading and
the render-captured mutation epoch before dispatch; it cannot combine the old
state closure with a newer sibling edit.

A persisted server snapshot can resume an untouched initial legacy draft: document
and all section revisions are one, statuses are draft, document approval is absent,
and required section metadata reports an unwritten body. The subsequent owned
full-row read independently rechecks revision/status/approval before fallback or
generation. An already edited snapshot stays on its existing lazy path; newer
edited rows found after a pristine snapshot preserve deliberate blanks and saved
siblings without a new dispatch. Populated progressive summaries remain lazy.

**Reproduced:** `wp2-seed-before.log` records three original failures using real
random seed IDs: provider transport called before a seed receipt, transport called
after rejected creation, and different document identities across a response-loss
remount. The first repair passes these in `wp2-seed-after.log`.
Independent review then identified four additional cases caught in
`wp2-seed-review-before.log`: the server-snapshot reload skipped continuation,
reused hooks could dispatch the previous outcome's sections, a fresh second outcome
inherited the first one's revision baseline, and a pre-render scoped callback
could admit an old snapshot after a sibling edit. All four are repaired.

Two intermediate SSR regressions are separately recorded, not presented as
original production defects. `wp2-seed-edited-snapshot-before.log` shows an
unrequested dispatch for a deliberately cleared required section. Restricting
resume to the untouched revision-one draft fixes it.
`wp2-seed-stale-snapshot-before.log` then shows two dispatches instead of one when
owned reads reveal newer edits after a pristine snapshot. The fresh-row recheck
fixes that case while retaining exact original-request replay for an unchanged
seed.

**Verified locally:** `wp2-seed-focused.log` records **103 passed**: 54 real
adoption/editor/seed cases, 37 adjacent persistence cases and 12 autosave cases.
The 16 new seed cases cover held/rejected creation, the section-retry entry,
uncertain acknowledgement in the same/new tab, storage-independent remount,
concurrent creation, owner change/unmount/local edit during saving, exact final
save revisions and hashes, resource reuse, stale callbacks and both SSR recovery
boundaries. The positive final-save case independently reads endpoint-fixture
bodies after the receipt, rather than relying on a Saved label.

The endpoint fixture retains rows derived from accepted commands and receipts,
serializes its create critical section to model the existing outcome lock, and
preserves omitted update bodies. It models the database contract; it is not real
SQL execution, provider/billing proof or a signed-in browser journey. Production
`saveLegacyWorkspaceV1` keeps its existing strict receipt parser. Two fixture type
errors were corrected with an explicit empty placeholder list and the existing
`PersistedSection` type; no cast or type suppression was introduced. The final
web type check and touched-file lint pass. Both final read-only source reviews
passed; verification commands remain parent-run evidence.

**Bounded conflict behavior:** a concurrent losing create retains its local state,
reports the failed save and does not generate. Explicit reload reads the single
admitted owned document and uses its exact resource IDs/request input. Automatic
winner adoption remains unavailable: the existing cast-based, separate full-row
reads are not a validated aggregate with which to implement that transition.
An uncertain acknowledgement retains and replays the original exact command;
it is never reclassified as a deterministic conflict.

**Verified locally — complete web gate:** Codex Process Jobs
`job-mtowbb9u-bdd9ff91` completed successfully in approximately 40 seconds.
`wp2-seed-results.txt` records 93 shared API and 302 adjacent workspace tests,
a frozen install, `pnpm verify:web` (165 deployment-contract checks, 221 root,
272 shared and 866 web tests, lint, types, production build and progressive
bundle checks), production dependency audit with zero advisories and diff check.
Source hashes, tracked diff and HEAD remained unchanged during verification.
This supersedes the prepared/pending gate status for this slice.

**Unverified:** This scope was coordination revision 15, at base
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` with an uncommitted overlay. No new CI,
real database, browser, production or inspected-export acceptance is claimed.

**Remaining WP2 boundary:** `settle_document_allowance_with_result` still records
a durable generation result and completed credit before the browser's final
aggregate save. Admitting the initial identities closes one replay prerequisite;
it does not atomically attach final wording and settle that credit. That bridge
must bind the existing accepted result, validation identity, destination revisions,
workspace mutation and immutable receipt without a second store or provider path.
Original non-SSR legacy compatibility loading and full-row response validation
also require their broader acceptance work. F1/F4, browser/DB, export, security
and release gates remain open.

### WP1 — Prepared v2 exact-wording assessment boundary (not activated)

**Reproduced:** `wp1-captured-grounding-before.log` records four failures against
the original production validator: invented five-million-dollar damages, a
criminal admission, an unrelated claim with a valid source ID and a fabricated
neutral closing all returned `passed: true`. The fixture uses specific synthetic
facts about a ten-dollar duplicate debit. It is authored regression material,
not an approved model evaluation or a replacement for historical benchmarks.

**Implemented — preparation only:** `document-ledger.ts` now exposes a separate
immutable `ledger.2026-09-first-cohort.2` with mandatory exact-wording review and
exact UTF-8 neutral strings/conditions. V1 remains the default export and input
planning contract. Its pre-edit JSON SHA-256 is pinned by a regression:
`8119b55bc340781f2a8e12e4f4860dd6a5f2ad3931235fd3d99e37a45b800f2a`.
All historical quality benchmarks remain equal, including their dates and
provenance. Education fallback states only that no qualification details appear
in the document; it is permitted only while education input is absent, without
asserting a qualification, availability or owner confirmation. V2 explicitly
separates that state from factual final-content detail/depth requirements.

`captured-document-operation.ts` adds the prepared v2 writer schema/prompt and a
separate structured review schema within the existing validation module. The old
replacement-writing review prompt explicitly rejects a v2 plan. The new reviewer
assesses every complete section, with six mandatory verdicts: material support,
semantic requirements, critical details, source conflicts, repetition/padding and
benchmark copying. Exact accepted input quotes are checked as provenance;
matching a quotation is explicitly not treated as proof of entailment. A failed,
uncertain, missing, malformed or identity-mismatched assessment cannot pass.

Preparation copies the plan, identity and bounded candidate before awaiting
digests. It returns the captured review message as a string made from the same
sources/contract/target. Validation independently rebuilds the target from the
candidate. Identity binds operation/document, accepted document/input revisions,
DB-authored generation snapshot hash, ledger/pipeline/validator/benchmark,
section state, references and exact wording. Each section also has an exact
UTF-8 SHA-256 for future SQL recomputation. The overall review target digest is
an Edge-side opaque identity, **not** a PostgreSQL `jsonb::text` digest. No second
operation, persistence, billing or provider store is introduced.

**Verified locally:** `wp1-captured-grounding-focused.log` records **72 passed**:
44 new assessment cases, six existing structural cases and 22 runner compatibility
cases. `wp1-captured-ledger.log` records **25 passed**, including ten new immutable
contract/runtime-shape cases. Tests cover all four original unassessed fabrications,
positive exact assessment of supported prose, unknown/missing/duplicate/out-of-order
review units, invalid source quotes, identity/revision/source/text changes, review
rejection/uncertainty, required checks, safe sibling preservation, captured prompt
identity, malformed candidate bounds and exact fallback conditions. A positive
synthetic reviewer still cannot authorise a fabricated or altered neutral string.
`wp1-captured-nul-before.log` records an additional review-found NUL regression;
the final 72-test run passes after rejecting NUL and unpaired surrogate output.

The synthetic review verdicts prove protocol behavior, not actual model accuracy.
The old repeated-token fixture was renamed to describe its structural-only scope;
its assertions were not weakened. Shared type checking and touched shared-file
ESLint pass. The first type attempt exposed missing fixture record guards, which
were added without casts or type suppression. Production validator Deno lint
passes. An additional optional Deno lint invocation covering tests reports the
existing repository-wide inline `jsr:` import convention under Deno's
`no-import-prefix` rule; no rule was disabled or import configuration changed.
The repository's required Edge gates remain Deno check/test, with web/shared lint
in `verify:web`.

**Review:** Independent read-only review identified and drove repairs for mutable
review-message inputs, empty-candidate completion flags, coerced verdict values,
revision zero, malformed fallback fields, education-state contradictions and NUL.
All execution results above were run by the parent task. Source checks pass.
The final independent source review returned PASS for preparation after the
NUL and versioned writer-prompt changes; runtime/SQL acceptance remains excluded.
**Verified locally — complete web/Edge gate:** Codex Process Jobs
`job-mtoxbqzq-4e9601c2` completed successfully in approximately 68 seconds.
The inspected `wp1-captured-results.txt` records 72 adjacent captured tests,
25 ledger tests, production validator lint, frozen install, `pnpm verify:web`
(165 deployment-contract checks, 221 root, 282 shared and 866 web tests, lint,
types, production build and progressive bundles), all Edge entry-point type
checks and **656 Edge tests passed**, plus zero production dependency advisories
and diff check. Source hashes, tracked diff and HEAD stayed unchanged. This
supersedes the prepared/pending broad-gate state for the assessment helpers.

**Unverified / next dependency:** The running captured adapter still uses v1.
F1/F8 are **not closed** in an enabled path by these helpers. Next, wire the
assessment through the existing accepted-pipeline adapter, review attempt and
checkpoint; extend existing SQL commands with mandatory checks and recomputed
wording hashes; preserve owner-edit versus reviewed provenance; and enforce the
same requirements at approval/export. No v1 operation, revision, approval,
export, ledger or checkpoint may be relabelled. Resume TTL and activation schema
currently recognise only pipeline/schema v1. New admission must atomically match
the activated ledger/pipeline pair, and start replay across a rollout must recover
an existing v1 acceptance before constructing any v2 request. Neither changing
the default ledger export nor simply bumping the pipeline constant is safe.

The identified local DB preparation plan uses an isolated temporary Supabase
project, unique project/ports and exact copied SQL manifests. The repository's
`project_id = jjsykocqpjlekgsbylkd` is not the disposable target. Docker CLI
29.7.2 and Supabase CLI 2.114.0 were inspected; local daemon/context and ports
remain unverified. No DB was started or reset. A committed historical fixture
must exist before the upgrade migration, then exact old wording/provenance and
receipts must be checked after forward migration. No hosted or paid action has
been taken. Coordination revision 16 covers this preparation at the unchanged
base `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the uncommitted overlay.

### WP1 — Accepted v2 runner integration (activation still pending)

**Reproduced:** after adding the explicit v2 adapter/route compatibility seam,
`wp1-captured-runner-before.log` reaches valid accepted identities and fails
because structurally valid wording causes only a writer dispatch before
finalization; the required review is missing. This is an execution-boundary
failure, distinct from a test rejected by an unsupported pipeline or mismatched
route fixture. `wp1-captured-runner-stale-before.log` separately reproduces stale
finalization incorrectly returning generic HTTP 500 rather than a revision conflict.

**Implemented:** `captured-operation-runner.ts` retains the v1 adapter and adds
accepted v2 execution with a distinct review kind. It restores the accepted
template/sources and validates the pipeline/ledger/policy pairing before provider
work. The accepted document revision and generation snapshot hash now survive
parsing and bind v2 validation; operation state must match that accepted revision.
The writer and reviewer use their distinct immutable schema versions. The existing
review stage, durable attempts, provider checkpoints, leases, capacity handling and
allowance/finalization RPC remain the execution authority.

V2 reviews the unchanged generation checkpoint and supplies the captured review
message from assessment preparation. It validates the stored verdict against the
original writer bytes, accepted sources and exact identities. Structural/neutral
failures stop before spending another review call. Missing generation checkpoints,
malformed checkpoint containers or contradictory writer/verdict bytes require
reconciliation without redispatch. A returned provider value must agree with the
durable checkpoint that its lifecycle completed. Both exact checkpoints can
reconstruct validation and finalize without a provider call. A negative or
malformed review never becomes replacement wording or an implicit repair loop.

The specific SQL `STALE_CAPTURED_DOCUMENT_FINALIZATION` rejection now maps to
HTTP 409, `retryable:false` and an instruction to reload the saved document.
Missing checkpoint reconciliation has HTTP 503 and names reconnecting to the
same operation. Neither path reports a completed document.

**Verified locally:** `wp1-captured-runner-focused.log` records **100 passed**:
50 runner tests (28 new v2 cases plus 22 retained v1 cases), 44 assessment tests
and six structural tests. Cases cover mandatory review and exact section bytes,
negative/uncertain/malformed/replacement/missing/digest-mismatched reviews,
review-only continuation, exact validating/persisting checkpoint replay, changed
wording/source snapshot, missing writer checkpoint, one/two lost review completion
acknowledgements, cancellation during review with known usage recorded first,
provider/committed-checkpoint disagreement, invalid fallback, pipeline mismatch,
review capacity/early reconnect, two exhausted review attempts without attempt
three, uncertain preparation reconciliation and stale finalization. The final
review-suggested case holds checkpoint digest work, requests durable owner
cancellation, then releases hashing: it returns cancelled with zero provider or
finalization calls. Independent source review returned PASS for this slice.

The runner's optional AbortSignal is currently consumed by provider dispatch;
checkpoint-only hashing/finalization follows durable operation cancellation.
The production background wrapper deliberately separates its lifetime from a
browser request ending. A browser disconnection is not recorded as an owner
cancellation. A broader hard AbortSignal contract for every direct runner caller
has not been asserted or tested here.

The synthetic gateway now clones checkpoints and call records, models attempt
numbers by logical stage, and rejects changed completion replays. Shared synthetic
wording/review fixtures moved to `captured-document-grounding.fixtures.ts` so
validator and runner cases exercise the same explicit facts. Runtime tests still
use controlled provider and RPC endpoints; they do not prove live models, SQL
transactions, cloud persistence, billing settlement, approval or artifact output.
Both touched Edge production modules pass Deno lint and diff check. The broader
sequential web/Edge gate also passed: inspected Codex Process Jobs result
`job-mtoy0keq-c17e99b6` completed in approximately 67 seconds. It records 100
adjacent captured tests, 25 ledger tests, both production-module lint checks,
frozen install, `pnpm verify:web` (165 deployment-contract checks, 221 root,
282 shared and 866 web tests, lint/types/build/progressive bundles), all Edge
entry-point types, **684 Edge tests passed**, zero production dependency
advisories and diff check. Tracked source, recorded source hashes and HEAD were
unchanged. This supersedes the pending broad-gate state for the runner slice.

**Unverified / next dependency:** new admissions still select v1, and the database
does not yet expose v2 TTL/activation/assessment eligibility. This supported-resume
code is preparation for the ordered compatible SQL change, not activation or an
F1 closure. A new private verifier must recompute UTF-8 section hashes and require
the exact accepted review checkpoint at the existing revision/finalization,
approval and export boundaries. The initial section UUIDs are generated only
during finalization; preserve the existing revision snapshot as their identity
binding. Owner edits need an explicit asserted variant retaining unchanged sibling
assessments. Preserve historical receipts/replays while rejecting new eligibility
based only on old `passed:true`. Admission must pair versions atomically and
recover lost v1 acceptance acknowledgements across rollout. No SQL or hosted
mutation, activation, migration test or provider evaluation has been performed.

**Read-only local DB preflight:** the parent subsequently verified Docker context
`desktop-linux` uses the local Unix socket and the daemon responds. An existing
seven-container Supabase stack for `jjsykocqpjlekgsbylkd` occupies ports
54321/54322. It is shared existing state, not this task's disposable fixture.
No listener was reported on candidate ports 58320–58322; they must be rechecked
immediately before creating the separate test project. Host `psql` is not on PATH;
SQL fixtures can use the identified new database container's client. No existing
database was queried, reset or stopped. This supersedes the earlier unverified
daemon/context observation and makes the separate-project requirement concrete.

**WP0 / WP7 — disposable DB test isolation (implemented; runtime pending).**
Before any database execution, source tracing found twelve `dblink_connect`
calls across six concurrency tests targeting the fixed Docker hostname of the
existing shared `jjsykocqpjlekgsbylkd` stack. They perform committed synthetic
writes through those sessions, including the home-intake cleanup delete. Merely
copying the suite into a new project would not change that connection target.
The original source was not executed against either database to reproduce this
unsafe destination.

The supplementary `scripts/database-test-isolation.test.mjs` first failed for
all twelve literal endpoints (`wp0-db-isolation-before.log`), then passed after
the correction (`wp0-db-isolation-after.log`). It is wired into the root test
command, which `verify:web` and CI already invoke. This source check is not
runtime isolation or concurrency proof.

Changed tests: `atomic_allowance_reservations`, `openai_capacity_leases`,
`legacy_model_accounting_and_replay`, `home_upload_intake_v1`,
`legacy_section_edit_cas` and `workspace_snapshot_v1` under `supabase/tests`.
The initial connection correction used server-local `127.0.0.1`, PostgreSQL's own
port and current database, retaining the existing synthetic local fixture credentials
and adding a five-second connection timeout. A temporary, invoker-only helper
reads both real remote session identities and requires the same database and
cluster identifier plus distinct local/peer backend PIDs. An identity error
raises and aborts the enclosing test transaction before remote fixture DML;
it is not converted to a failed-but-continuing TAP assertion. Each test adds a
positive identity assertion and a negative duplicate-backend assertion against
the same actual connections. Original fixture DML, locking, asynchronous calls,
assertions and cleanup remain unchanged. Earlier local transactional fixtures
retain their existing position. The database and cluster mismatch predicates
are present; the new negative case specifically exercises backend reuse.

Independent source review found no blocking syntax, privilege, continuation or
fixture-compatibility issue. The guard stays entirely inside PostgreSQL; no
cluster identifier is converted to a JavaScript number. PostgreSQL documents
that [dblink uses libpq connection strings](https://www.postgresql.org/docs/current/contrib-dblink-connect.html)
and exposes the [current database, backend PID and control-system identity](https://www.postgresql.org/docs/current/functions-info.html).
No shared helper include convention is established in the pinned CLI path, so
these bounded temporary test helpers remain inline. No production function,
migration, RLS/grant or application behavior changed in this isolation slice.

The parent prepared `run-isolated-db-baseline.mjs` for one uniquely named,
temporary local Supabase project. It uses CLI 2.114.0, explicit PostgreSQL 17,
the verified Docker Unix socket and ports 58320–58322, with pre-start collision
and port checks. Only individually hashed migration/test SQL files are copied;
no environment, linked project state, Edge Functions or provider credentials are
copied. Start itself applies migrations and is treated as a mutation. Reset and
cleanup require the exact owned temporary marker, unchanged configuration and
SQL manifest; database reads use the identified new container ID. Runtime
attestation checks the database, cluster, image, network, volume and published
ports. Cleanup names this exact project and verifies pre-existing Docker resource
identities remain present. It does not query shared user data. CLI output is
redacted for generated local credentials. Source/HEAD checks and the full web gate
run sequentially after scoped cleanup, with failure outcomes recorded separately.

Independent runner review required exact copied-file inventory checks, source-to-copy
hash equality, an explicit owned PGDATA volume, hard subprocess timeout termination,
complete dotenv rejection and the runner's own digest. These are implemented; the
final source review passed. The run also retains a copy of the exact runner bytes.
The runner's syntax, formatting, migration naming gate (67 migrations), source
regression and diff check pass locally. **Fresh SQL execution and cleanup remain
unverified until its process-job output is inspected.** This run has no historical
upgrade fixture and cannot establish upgrade, browser, model, approval/export or
hosted acceptance. No new SQL assessment enforcement has been implemented yet.
Coordination revision 17 adds the six-test parent and supplementary source test;
there is no foreign ownership overlap.

**First isolated-run result inspected:** `job-mtoyqnh2-996dca8a` failed in
approximately 0.5 seconds at the Docker executable preflight with `ENOENT`.
Node/pnpm/Supabase version checks and branch/HEAD checks passed. The runner's
narrow PATH omitted Docker's installed application binary directory. This is a
local runner configuration failure; database startup/reset/tests, source snapshot
and the web gate were not reached. No container was created and scoped cleanup
was not required. Full evidence is in
`db-20260905223716608-e0df3d41/failure.txt` and `summary.json`.
The earlier hook-blocked result read is superseded by this inspected result.

The parent resolved `/usr/local/bin/docker` to
`/Applications/Docker.app/Contents/Resources/bin/docker`, pinned that executable
for inspection and added only the verified Docker application binary directory
to the child PATH (also required by Docker credential helpers). The environment
allowlist remains intact. A strict `--preflight-only` option now exercises the
same setup, copied SQL manifest, socket/resource/port checks and source/hash
verification without starting services, resetting/testing a database or running
the web gate. Its positive run `db-20260905223951897-94d7b0da` passed all 21
recorded commands, copied and verified 100 SQL files (67 migrations, 33 tests),
and preserved source/HEAD. No SQL or fresh-database acceptance is inferred from
this preflight. The full isolated baseline remains pending the corrected run.

**Second isolated-run result inspected:** `job-mtoyw378-29912bc6` completed in
approximately 95 seconds with exit 1. Startup, all 67 migrations in a fresh
reset, target attestation, scoped cleanup, the full web gate and source/HEAD
checks passed. SQL acceptance failed: 33 test files emitted 1,203 assertions;
27 files completed, while the six concurrency files stopped at their first
`dblink_connect`. Their 278 passing prefix assertions do not establish their
unreached concurrency tails. Every failure reported the same non-superuser
credential-use requirement, before the identity guard or remote fixture DML.
The TAP missing-plan reports result from that early exit, not six independent
application findings. Complete diagnostics are readable in
`db-20260905224130263-79b29d84/fresh-tests.log`.

The target was PostgreSQL 17.6, image
`public.ecr.aws/supabase/postgres:17.6.1.158`, digest
`sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459`,
cluster `7682185181028458534`, in the recorded unique project/network/volume.
No disposable resource remained after exact-project cleanup; the saved Docker
inventories were identical before/after. This establishes resource identity
preservation, not an inspection of another container's internal data. Source
hash maps and tracked diffs were identical, and HEAD remained `e1d514d`.
The web gate passed 165 deployment tests, 222 root tests, 282 shared tests and
866 web tests, plus lint/types/production build/progressive bundles. This is
local dirty-overlay evidence; no new CI, browser, provider or hosted proof.

**Connection authentication correction (implemented; SQL retest pending):**
PostgreSQL's [ordinary dblink authentication check](https://www.postgresql.org/docs/17/contrib-dblink-connect.html)
requires a non-superuser's connection to actually use the provided credentials.
The [exact image-tag HBA source](https://raw.githubusercontent.com/supabase/postgres/17.6.1.158/ansible/files/postgresql_config/pg_hba.conf.j2)
uses trust on loopback and SCRAM on the private/container network ranges. This
explains the observed post-connect failure; the running HBA catalog itself was
not inspected. The literal-loopback choice is superseded by a temporary helper
that derives `inet_server_addr()` from the initiating session, rejects a Unix
socket or loopback input, and uses that typed server address with this server's
port/current database and the same synthetic fixture password. There is no
caller-selected host or fallback target. Ordinary `dblink_connect`, its
credential check and the raising exact database/cluster/PID fence all remain.
No role, HBA, grant, production function or schema was altered.

The supplementary source suite now also requires the derived TCP endpoint and
rejects `dblink_connect_u`, including files with no ordinary connection left.
That added check first failed on the six loopback setups
(`wp0-db-auth-before.log`) and now both source checks pass
(`wp0-db-auth-after.log`). Independent review found no SQL blocker; its source
scanner early-continue finding was corrected. Formatting, 67-migration static
checks and diff check pass. The actual session address and successful
concurrency behavior must still be established by the next full isolated run;
this change is not counted as completed SQL acceptance yet.

**Corrected fresh baseline verified:** inspected job `job-mtoz80kf-1b3a28a4`
passed in approximately 96 seconds. Evidence is under
`db-20260905225046725-317fd8bc`. All 67 migrations applied; **33 SQL files and
1,303 assertions passed**, including all six concurrency tails and their live
identity/duplicate-backend guards. The derived TCP connection and ordinary
dblink authentication now work in the identified disposable PostgreSQL instance.
Database/cluster identity stayed equal across tests. Exact-project cleanup
succeeded and the saved Docker resource inventories were identical before/after.
Source hashes, tracked diffs and HEAD were unchanged. The complete web gate
passed 165 deployment tests, 223 root tests, 282 shared tests and 866 web tests,
plus lint, types, production build and progressive bundles. This supersedes the
pending SQL acceptance for the isolated-baseline/test-connection repair only.

The fresh migration and current SQL suite are now locally verified. This does
not establish historical upgrade safety, new v2 assessment enforcement, live
model grounding, browser persistence, artifact inspection or hosted acceptance.
The baseline's successful v1 fixture contracts retain their original semantics;
they are not retroactively classified as exact-wording assessment.

**WP1 exact omission bytes and SQL version prerequisite (6 September, 10:17
AEST):** independent SQL-boundary review identified that the old structural
validator accepts whitespace-only optional omission, but SQL finalization
persists exactly empty content. The added v2 regression first failed for the
missing `omitted_section_bytes_not_empty` issue (`wp1-omission-before.log`).
The v2 preparation boundary now rejects any nonempty bytes in an omitted
section before calculating the review target. The v1 structural contract is
unchanged. All **45 grounding tests pass** (`wp1-omission-after.log`); this is
focused local verification, not SQL or browser acceptance. The adjacent
structural/grounding/runner suites also pass **101 tests**
(`wp1-omission-adjacent.log`).

The traced SQL activation command still requires both routes to use
`captured-output.1`, while v2 requires `captured-output.2` for generation and
`captured-grounding.2` for assessment. Raw admission also lacks a v2
ledger/pipeline pair check. The new
`supabase/tests/captured_grounding_version_contract.test.sql` exercises those
boundaries through public commands, checks fixture creation and rollback, and
retains v1 admission/replay across a pointer change. It uses explicitly
synthetic minimal ledger contracts and performs no model call. Its first
disposable SQL run is pending and is expected to expose the version defects;
no new migration has been written or applied yet. The generated revision
assessment guard, owner-edit contract and approval/export eligibility remain
unimplemented. Preflight `db-20260906001531502-7a69c6aa` passed without starting
services. The SQL fixture and all activation changes are transaction-scoped in
the disposable test project; no hosted activation is authorized or attempted.

**Version regression reproduced and companion migration prepared:** job
`job-mtp2cnp6-c9307bfa` failed in approximately 97 seconds, with readable
evidence under `db-20260906001822180-c93c569c`. All 67 migrations applied. The
new SQL file completed all 14 assertions with exactly the three intended
failures: pipeline 2 was accepted under a v1 ledger/routes; a v2 activation
accepted the old output/review schemas; the genuine v2 writer/assessment
schemas were rejected. The remaining 11 assertions and the previous **1,303
SQL assertions passed** (34 files, 1,317 total). No fixture/setup failure hid
those results. The full web gate again passed 165 deployment, 223 root,
282 shared and 866 web tests plus lint/types/build/progressive bundles. Exact
disposable-project cleanup succeeded; Docker resource inventories and source
hashes matched before/after, and HEAD remained `e1d514d`.

The additive migration
`supabase/migrations/20260906000500_captured_exact_wording_assessment.sql`
now supersedes the current configuration, raw acceptance and resume RPC
definitions, preserving signatures, defaults, service grants and fixed search
paths. Its private resolver uses the registered immutable ledger and typed
grounding policy. New v2 admissions require the exact ledger/pipeline pair,
writer/reviewer schemas, original benchmark string, workflow and fixed 86400
second TTL. Existing accepted replay returns before the new gate. Resume
recognises pipeline 2 without consulting the current activation pointer.
`wp1-version-functions.diff` records the narrow body changes within these
otherwise retained SQL definitions. Independent review caught the typed
benchmark mismatch (JSON number/boolean converted to text by `#>>`); the
new admission gate now rejects it explicitly.

The expanded SQL tests cover successful v2 admission, both version downgrade
directions, invalid TTL/benchmark types and versions, unchanged replay/resume
after pointer changes, owner isolation and resolver privileges. These remain
synthetic version-boundary tests; the application-equivalent assigned cohort,
real ledger generation/review/finalization fixture is the next slice.
Static validation passes **68 migrations** and diff checking passes; SQL
execution of the companion fix is pending. This migration registers no ledger,
changes no activation pointer, and does not yet enforce generated revision
assessment, owner edits, approval or export. F1 remains open in the enabled
v1 path; v2 initial UI generation remains unactivated.

Final independent source review passed the companion migration and expanded
fixture, including rollback of malformed benchmark trials and the exact
v1 → v2 → v1 pointer revision sequence. Preflight
`db-20260906002817062-ea964617` passed without starting services. Neither
preflight nor source review substitutes for the pending SQL execution.

**Version companion verified locally:** job `job-mtp2qw6f-09066045` passed in
approximately 97 seconds. Evidence `db-20260906002926350-71ae66df` records
**68 applied migrations, 34 SQL files and 1,344 passing assertions**, including
all 41 version-contract assertions. The three original regressions are green;
typed benchmarks, fixed TTL, positive v2 admission and unchanged replay/resume
also pass. Full `verify:web` passed 165 deployment, 223 root, 282 shared and
866 web tests plus lint, types, production build and progressive bundles.
Database identity, source hashes and tracked diffs were unchanged; exact
disposable-project cleanup passed with equal before/after Docker inventories.
These results supersede the pending companion SQL execution above. They do not
establish historical upgrade, generated-wording, browser or hosted acceptance.

**Generated assessment regression preparation:**
`supabase/tests/captured_exact_wording_assessment.test.sql` now creates an
application-equivalent assigned synthetic owner/cohort with explicit local
capacity. It imports the real v2 ledger, accepted plan and authored complaint
candidate using `prepare-grounding-sql-fixture.ts` in the evidence directory.
The separate Deno fixture-contract assertion compares the actual JSON wire
form with the current authoritative definitions; **46 grounding tests pass**
(`wp1-sql-fixture-contract.log`). The full ledger's historical benchmark
provenance is retained; synthetic reviewer verdicts do not reclassify it as a
model evaluation. The SQL target hash is an explicitly opaque synthetic value,
while each section wording hash is independently calculated from UTF-8 bytes.

The SQL fixture exercises generation/review preparation and completion under
the service role, followed by 26 negative finalization trials and an exact
positive/replay. Negative trials include missing review, generic `passed`,
skipped or mistyped checks, wrong identities/digests, fabricated final/fallback
wording, changed whitespace/provenance and malformed durable reviewer verdicts.
They inspect actual post-finalization state before rolling each trial back,
including complete operation/document/revision/source/lease/checkpoint/event/
usage/reservation/write-capability identity. Completed provider usage remains
honest. The generated-revision guard is not written yet; this first SQL run is
expected to expose acceptance of these unsupported finalization inputs.
Preflight `db-20260906004018473-c480da33` passed without services.
Adjacent structural/grounding/runner checks pass **102 tests**
(`wp1-sql-fixture-adjacent.log`). The positive SQL case also independently
checks exact aggregate section order, separate completed model-call usage,
one document-created usage row, settled reservation and immutable replay.
Independent source review passed the new fixture's RPC signatures, role
transitions, actual-state observation and rollback behavior. Its SQL red
failure profile remains to be inspected after execution.

**Generated assessment RED inspected:** job `job-mtp3ae7e-9e345642` failed as
expected against the pre-guard implementation. In `db-20260906004436185-d3c24746`,
68 migrations applied and 35 SQL files ran 1,496 assertions. All 26 negative
finalizations were actually accepted before trial rollback: 104 intended
assertions failed and 48 assertions in the new fixture passed. These are four
failed assertions per admitted invalid trial, not 104 independent defects.
All previous 1,344 assertions and full `verify:web` passed. Source/HEAD and
exact disposable cleanup checks passed. A v2-only generated-revision guard
has since been appended to the same migration; it has not yet executed.
Independent review found two remaining preparation gaps: deterministic
instruction/minimum-depth checks at the SQL boundary and numeric quote parity.
V2 remains unactivated; owner-edit/approval/export contracts remain open.

**Owner steering — Profile/uploads and full function integration audit:** the
owner reported PDF, Word and MD failures and an inaccessible Profile, then
explicitly authorised auditing all Supabase functions and installing required
missing functions on the already confirmed app project. Function installation
and compatible bundle updates are now authorised. Separate schema/grants,
secrets/model/cost settings, legacy endpoint deletion and Netlify publication
remain explicit effects; no hosted mutation has occurred in this continuation.

Read-only production Profile reproduction: personal details GET200; embedded
resume/upload read GET403 with PostgreSQL42501, permission denied for uploads.
Hosted metadata independently confirms missing file-column grants with RLS on.
Prepared migration `20260906010846_profile_resume_upload_reads.sql` grants only
six resource columns; new positive two-owner/anonymous/private-column/write
SQL regressions are pending execution. Existing data and ingest control fields
are preserved.

The live served upload client requires exact UUIDv8 plus completed
classification. Hosted ingest-upload v328 returns random UUIDs and omits the
classification receipt; extract-upload is absent. That is a demonstrated
contract mismatch across formats, not evidence of a specific failed user file
or a production duplicate record. No upload/provider execution was performed.
A distinct local empty-MIME wire defect was reproduced with four intended
failures and repaired; all 65 adjacent upload/shared tests pass. Multiline/
HTML-situation and escaped-filename identity cases remain pending reproduction.
A local missing-function404 triggered a second checklist generation in two
regressions. The repair now requires exact TED_V2_DISABLED404 for the existing
fallback, and its persistence wait remains proved. All 25 adjacent
checklist/Profile/gateway tests pass. No production fixes are claimed.

The full source/caller/hosted audit is recorded in
[Supabase-Function-Integration-Audit.md](../evidence/web-operational-readiness/Supabase-Function-Integration-Audit.md).
26 local entries comprise23 active and3 dormant. Three required active
functions are missing: document-operation, extract-upload, brand-logo. All20
existing active entrypoints differ from the current source; checksums alone do
not establish20 independent defects. All25 hosted bundles were inspected.
All24 required tables,95 RPC entries/declared signatures and67 original
migrations exist. Production configuration has no capacity or reviewed routing/
evaluation records for any of fast/deep/research/review. Names-only inspection
found11 missing required runtime secret/configuration names. Three dormant raw
OpenAI endpoints and two undeclared endpoints remain hosted. These fail the
existing mandatory release contract; no attestation was fabricated or gate
bypassed. The user has authorised function work, but installation prerequisites
are not yet satisfied. Actual file ingestion, database persistence, approved
export and signed-in full journeys remain unverified.

**Integrated function check result:** `job-mtpi0srd-b1b5a6f5` exited1. All686
Edge tests passed; production dependency audit returned zero advisories. The
complete web gate passed:165 deployment tests,223 root tests,291 shared tests,
870 web tests, lint/types, production build and progressive bundle checks.
Tracked/untracked source manifests were unchanged and disposable cleanup
succeeded. Evidence: `function-gate-20260906073702742` and
`db-20260906073737600-51e3502a` under the readiness evidence directory.

Two failed subchecks are distinct. The type-check evidence wrapper assumed an
index.ts in an empty legacy anthropic-messages directory; enumeration now keeps
only existing entrypoints. Direct `deno check supabase/functions/*/index.ts`
then exited0. The declaration/source-presence deployment contract still passes.
No legacy source or endpoint was deleted. Database start failed at statement16
of the new grounding migration, before any SQL tests: unparenthesized CASE
expressions inside a PL/pgSQL IF produced syntax error42601. Independent review
confirmed the cause; both expressions are now parenthesized. Fresh migration
acceptance, the strict grounding SQL cases and the new Profile permission
regression remain pending. The next job reruns the affected disposable database
and its integrated web gate, without repeating the unchanged passing686 Edge
tests or dependency audit. No hosted values or shared database are used.

**Corrected migration rerun:** `job-mtpieo7s-b3d51e11` exited1; evidence
`db-20260906074750017-63fb5473`. All69 migrations applied at both start and
fresh reset. All35 earlier SQL files passed with1496 assertions, including
all152 exact-wording guard assertions (the26 invalid finalizations now reject)
and41 version/compatibility assertions. The new36th Profile test file aborted
on its first results_eq comparison because pg_attribute column names and
expected text had incompatible collation derivations. It ran no assertions;
this is a test defect, not proof that the prepared Profile grant failed.
The comparison now uses explicit C collation on both sides with the exact
six-column expectation unchanged. Independent review confirmed the remaining
fixture's setup, invoker rights, rollback and owner/read/write boundaries.
Profile SQL and actual PostgREST/browser recovery remain unverified.

The full web gate passed again with165/223/291/870 tests plus lint/types,
production build and progressive bundle checks. Cleanup passed; source hash
manifests and tracked patches were identical. No hosted mutation occurred.
V2 remains unactivated, with deterministic depth/instruction parity, numeric
quote parity, owner edits and approval/export integration still open. The next
database run will execute the corrected Profile assertion and remaining
fixture, retaining all earlier cases.

**Profile SQL acceptance now green:** `job-mtpimepq-3df9baea` exited0;
evidence `db-20260906075350975-c3bd58a3`. All69 migrations and36 SQL files /
1520 assertions passed, including all24 new Profile assertions. The complete
web gate passed with165/223/291/870 tests plus lint/types, production build
and progressive checks. Source hashes/patches were identical; exact disposable
cleanup succeeded. No hosted grant or function was changed.

The next bounded acceptance uses the same identified disposable lifecycle,
with `--profile-read-acceptance`. It creates two local synthetic Auth users,
obtains real password sessions, seeds and independently reads three original
resume rows/relationships, reproduces the old ACL's403 through the actual
PostgREST embedding, then reapplies the exact verified migration copy. It
checks successful owner reads/reload, changed-owner isolation, private-column
and anonymous denial, denied direct PATCH and unchanged originals. Local
credentials/passwords/tokens remain in memory; requests pin127.0.0.1:58321,
reject redirects, bound UTF-8 JSON bodies and time out. Independent review
required the verified copied migration as the restoration source; corrected.
The runner retains all source/target/lifecycle assertions and exact cleanup.
This is a local permission-upgrade/API exercise, not a full historical-schema,
browser, hosted, file-ingestion or provider acceptance claim. Execution pending.

An independent source review of the already-hosted deadline/government/PTV
utilities found request-admission, provider-shape, byte/redirect and
cancellation gaps. Detailed evidence and intended regressions are in
[Supabase-Utility-Boundary-Review.md](../evidence/web-operational-readiness/Supabase-Utility-Boundary-Review.md).
No current web caller was found; no arbitrary routes were added. These gaps
remain open and need reproduced bounded repairs before utility acceptance.

**Real Profile Auth/PostgREST acceptance green:** `job-mtpj124h-8663ec9a`
exited0; evidence `db-20260906080514479-4889adb0`. All69 migrations and
36 SQL files/1520 assertions passed, as did the complete165/223/291/870 web
gate. Fifteen actual local HTTP exchanges used two real password sessions,
reproduced old-ACL403/42501 with populated originals, restored exact-grant
owner reads, repeated the query with stable versions and verified cross-owner,
private-field, anonymous and direct-PATCH denial. Independent SQL before/after
proved all three original texts and resume relationships unchanged. Source
hashes/patches matched; owned cleanup passed. No production mutation occurred.

Live metadata refreshed at18:11:11 AEST still shows missing six-column Profile
permissions, enabled owner RLS, latest hosted migration20260905000000 and the
same25 functions with the three known missing actives. The concrete
[Profile permission proposal](../evidence/web-operational-readiness/Profile-Permission-Release.md)
and hashed68-file preparation snapshot are ready for exact hosted-grant
authorisation. They contain only67 unchanged committed baseline migrations
and the tested Profile grant; no remote dry run, broad dirty-overlay migration,
function deployment or publication was performed. The earlier-timestamp,
unactivated v2 migration's eventual ordering remains explicitly open.

| Work package   | Current state / next acceptance                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP0            | Test isolation, dependency repair, editor round trips and full local baseline verified. Complete feature acceptance remains open.                                                                                                     |
| WP1 / F1 F3 F8 | F3 legacy final-audit ordering repaired; full local gate passed. F1/F8 captured grounding, fallback, exact revision/digest and DB/browser acceptance remain open.                                                                     |
| WP2 / F2       | Terminal/parser/draft removal and wrapper passed full web gates. Exact mapping and one adoption/save operation pass 142 focused cases and the full web gate. Attachment/replay and full browser/persistence proof remain open. |
| WP3 / F4       | Initial catalogue inventory only. Server-owned policy, 18 exact mismatches and controlled contract activation remain open.                                                                                                            |
| WP4 / F7       | Authoritative intake, durable clarification, scoped repair and ownership/reload behavior remain open.                                                                                                                                 |
| WP5 / F7       | Real DOCX, PDF inspection and appropriate structured XLSX remain open.                                                                                                                                                                |
| WP6            | Production dependency audit passes after patches. Isolation/security/billing/lifecycle acceptance remains open; no exposure claim from names-only dotenv inspection.                                                                  |
| WP7 / F5 F8    | Playwright/fixtures/CI browser gate absent from the current observed pipeline; deterministic and authorised live evaluations remain open.                                                                                             |
| WP8            | Runtime/resources recorded; measured latency/cost budgets, cumulative retries and maintainability inventory remain open.                                                                                                              |
| WP9            | Source continuation inventory only; persisted action/outcome evidence journeys remain open.                                                                                                                                           |
| WP10 / F6      | Release configuration/evaluation inputs, target inventory, immutable revision, fresh+upgrade DB acceptance and exact protected authorisation remain open.                                                                             |

**Verified in CI:** no new revision or dirty-worktree CI proof.
**Workflow exercised; Production exercised; Persistence proven; Export inspected:**
unverified in this task. No full-completion or catalogue-complete claim.
Fresh/upgrade database testing requires an identified disposable local instance;
this runner does not reset an existing database. Hosted or paid-provider checks
remain at their separately authorised gate.

The sequential baseline runner is
[run-local-baseline.sh](../evidence/web-operational-readiness/run-local-baseline.sh).
It records commands, runtime, revision, exit codes, and before/after Git state.
Results must be inspected before updating any gate. This claim remains active
across its process-job completion because the implementation work is unfinished.

### 22:45 AEST — Master Workspace priority and binding format requirement

Owner clarified PDF, DOCX, TextEdit TXT/RTF and MD import, and requires original
PDF/Word formatting/structure to survive upload AND editing. This supersedes
any interpretation that original-byte retention plus a flattened editable
copy is sufficient. CSV/XLSX and wider readiness work are not silently dropped.

The bounded Master import recovery repair is now implemented. Strict receipt
validation uses the actual server result; replays skip both candidate caches;
uncertain-save retry retains exact confirmed wording and identifiers; a
different saved destination is explained before explicit owner navigation.
Pending content and completions are fenced by owner epoch and component
lifetime, including commit-phase unmount cleanup, with synchronous single
flight. Existing authoritative SQL/import/workspace loader paths are retained.

Local evidence: isolated initial RED18/25; review-driven immutable-confirmation
RED2/17; then **77/77 adjacent tests** across nine files (17 Master UI, 13 receipt
cases), focused ESLint and web type check exit0. Independent final source review
found no further concrete defect in this bounded repair. Full post-change web
gate is prepared but not yet claimed. No new SQL or hosted change was made.

Actual synthetic DOCX/PDF extraction proves format loss: distinct styled source
files collapse to identical four-field extraction results. TXT/MD extraction
accepts the fixtures; RTF rejects with `UPLOAD_FORMAT_UNSUPPORTED`. This evidence
script exits0 because it reproduces the failures, not because formatting passes.
No original was visually inspected and no edited/exported artifact was produced.

[Master-Import-Format-Preservation.md](../evidence/web-operational-readiness/Master-Import-Format-Preservation.md)
records source trace, exact changed files, test evidence, synthetic artifacts,
historical version constraints and the additive contract map for preserving
source structure through import/edit/save/approval/export. Source-format support
and RTF remain unimplemented. Future source bindings must use existing uploads,
documents/sections, operations and receipts; no parallel mutable authority.

The 22:36 owner-supplied Downloads `server.ts` was inspected. The current helper
already includes the same cookie adapter and stronger exact-target config
validation; its Supabase dependencies are already installed. No npm install,
donor copy, package/lockfile change, branch change or publication was performed.

**Implemented:** bounded Master recovery slice. **Verified locally:** focused
checks and reproduction above. **Verified in CI; Workflow exercised; Production
exercised; Persistence proven; Export inspected:** unverified for this repair.
Earlier Profile/DB evidence remains separately attributable. Production upload
still has the previously observed function/configuration release blockers.

**22:47 full Master web gate verified:** `job-mtpt2lnv-be86356f` exited0 in
about34 seconds. Evidence `master-web-gate-20260906124622670` records
165 deployment-contract,223 root,291 shared and895 web tests passing, plus
lint/types/build/progressive-bundle gates. No hidden test skips were reported;
source/HEAD snapshots match. This completes the broad local check for the
bounded Master recovery slice, not formatting or production acceptance.

**Word source-mapping foundation implemented locally:** the existing bounded
XML reader now exposes exact raw UTF-16 locations in a second callback argument,
preserving event objects and existing one-argument extraction consumers. Source
syntax admission, XML normalization order and skipped-token accounting were
reproduced and repaired; reviewed attribute/depth off-by-one cases have their
own red evidence. Focused scanner + actual extraction: **48 passed**, with Deno
type checking/lint green. Full Edge gate `job-mtptr5ct-62b4fc94` passed
**721 tests, zero failures**, all26 existing entry points type-checked and focused
lint/diff checks green. Evidence `upload-source-edge-gate-20260906130527900`
records unchanged source and HEAD. No source-format manifest,
schema binding, rich editor or preserved DOCX/PDF/RTF export is activated.


**Word XML source-part slice — implemented locally, not activated:** new
`wordprocessingml-source.ts` and tests reuse the bounded XML scanner, own exact
UTF-8 original bytes, resolve namespaces, bind patches to original digest/node
identity/expected wording, preserve all non-replaced source bytes, and reparse
the complete output. `source_only` explicitly excludes Word visibility,
pagination and document approval. Existing import, database and export contracts
are unchanged. The scanner adds an optional lexical PI observer without changing
its event objects or existing callers.

Focused acceptance: **85 tests passed** (36 mapping,39 scanner,10 actual
extraction), Deno types/lint and diff check green. Independent review identified
and closed public-continuation cancellation, literal-PI false rejection and
final combined output-limit cases; each has saved red evidence. Final independent
source review passed. The source parts of both real synthetic DOCX fixtures were
patched and inspected with a separate XML implementation; font/size/bold,
alignment/page/margin elements remain unchanged. No package or browser artifact
acceptance is implied. Full evidence and next contract boundaries are in
[Master-Import-Format-Preservation.md](../evidence/web-operational-readiness/Master-Import-Format-Preservation.md).

**Verified in CI; Workflow exercised; Production exercised; Persistence proven;
Export inspected:** still unverified for this source-format slice. No hosted,
Git publication, model or Netlify action occurred. The combined post-change
web/Edge gate is prepared and awaits its recorded execution result.


**23:27 combined gate completion — partial pass, configuration blocker:**
`job-mtpuhy5o-089231df` failed in54seconds. Evidence
`upload-source-full-gate-20260906132618276`: 758Edge tests pass, all26function
entry points plus new source adapter type-check, focused lint/diff checks pass.
Web deployment165/root223/shared291/web895 tests pass; lint/types pass. The build
step stops at the unchanged real dotenv guard before Next compilation because
server/deployment credential names were present in `apps/web/.env.local`.
Progressive bundles were not reached. This is not a demonstrated compilation
failure or a source-map regression. Source/HEAD snapshots match, but that earlier
runner did not fingerprint ignored dotenv files.

Names-only refresh observed the web file modified13:21:58Z, then changed again
at13:28:46Z during diagnosis. It now has seven public entries, mode0600, and the
real guard passes. This task made no dotenv writes. Separate provider/tools/
backup configuration also changed; provider names include duplicates, whose
values were not logged, selected, validated or activated. No attribution to a
particular actor or credential-exposure claim is made. The prior clean WP0
layout remains historical evidence and is not proof of continuous configuration.

The local verification runner now fingerprints only automatically loaded
web/root dotenv paths before/after (whole-file digests and permissions; no
values), rejects a changed configuration and retains existing source/HEAD
checks. The next web retry is prepared; the Edge suite's758-pass evidence remains
valid for the unchanged Edge overlay. Production, browser persistence, complete
format-preserving import/export and RTF remain open.


**23:33 web retry verified:** `job-mtpuqn7o-ec05c3d7` passed in35seconds.
Evidence `master-web-gate-20260906133303999` records deployment165/root223/
shared291/web895 tests, lint/types, real environment guard, production build
(29static pages), progressive-bundle and diff checks passing. Source, HEAD and
web dotenv snapshots match. This closes the local build blockage for that
configuration, without attributing or validating separate provider-file changes.
The unactivated Word source-part slice has broad local web and758Edge-test
verification; package/editing/export/browser and production acceptance stay open.


**Upload source ownership and all-part integrity implemented locally:**
`upload-extraction.ts` now owns each public input before awaiting, removes the
cross-call mutable-buffer WeakMap, shares one archive inspection inside each
read, preserves caller PDF bytes, and fences cancellation/deadline before
success. It also validates actual size/CRC of every archive entry while avoiding
retention of non-text parts. Public extraction signatures, policy version and
response fields remain unchanged; original Storage and persistence are untouched.

Five ownership regressions and four all-part regressions were demonstrated
against their preceding implementation before fixes. Final adjacent check:
**107pass/0fail** across24 extraction,39 scanner,36Word-source and8handler tests;
Deno types/diff checks pass; the focused lint assertion was incorrect and is
corrected below. Native-decompressor controls prove one
inspection and valid style exclusion from wording; aggregate expansion tests
admit exact16MiB and reject one byte over. Independent source reviews passed both
bounded repairs. Full test logs, exact scope and compatibility limits are in
[Master-Import-Format-Preservation.md](../evidence/web-operational-readiness/Master-Import-Format-Preservation.md).

The real synthetic format-loss/RTF exercise was rerun and still reproduces those
open gaps. No package-wide source digest manifest, document/revision binding,
rich editing or preserved-format export is active. The combined web/Edge gate
for this latest source is prepared, not yet verified. CI/production/browser
workflow/persistence/export acceptance remain unverified for this slice.


**23:45 combined result and lint correction:** `job-mtpv5kva-a364e523` failed
only focused Deno lint (two existing PDF throws-in-finally). All772Edge tests,
entry/adapter types and full web gate passed; source/HEAD/web-dotenv fingerprints
match. Evidence `upload-source-full-gate-20260906134440825`. The earlier focused
lint summary incorrectly relied on a compound command's final exit0; its saved
lint log actually failed. That claim is corrected above. Subsequent focused
checks explicitly inspect each exit status, preserving all earlier logs.

**PDF cleanup repaired locally:** a bounded helper captures read success/error,
awaits page/document cleanup and preserves error precedence outside finally.
Existing retryable503 cleanup failure behavior and normalized primary errors
remain; falsy thrown values cannot be mistaken for success. New tests cover
both deferred completion states, cleanup throw/rejection, and nested failure
ordering. Actual PDF behavior remains exercised. Latest112adjacenttests pass;
focused lint exits0 independently; typecheck passes. The full post-change gate
is prepared. No hosted/CI/browser/persistence/export acceptance is claimed.

Independent final review passed the PDF cleanup source and five tests. The
upcoming combined check is the remaining local verification for this bounded
repair; it does not close package/editor/export or hosted workflow acceptance.


**23:55 full local verification passed:** `job-mtpvhh8d-8fd10fb0` completed in
67seconds. Evidence `upload-source-full-gate-20260906135355969`: all777Edge tests,
26entrypoints plus source-adapter type checks, focused Deno lint and full web
gate pass (165deployment/223root/291shared/895web, lint/types/build/29staticpages/
progressivebundles). Source, HEAD and webdotenv fingerprints match. This closes
the prior lint failure for the bounded XML/source-mapping/upload-integrity/PDF
cleanup overlay. Production upload, preserved-format editing/export, RTF and
broader readiness acceptance remain open.

**7 September, DOCX package identity foundation implemented:** the existing
owned Office inspector now has a private opt-in manifest mode with exact archive
SHA/length, deterministic part roster, actual uncompressed part hashes and the
main Word source map. It retains one additional nonselected part at a time,
preserves ordinary extraction and remains explicitly `source_only`. No v1
response/checkpoint, classification, document authority or hosted contract was
changed. Package/style/layout semantics remain blocked; the map is not active in
editing or export.

Review found a Word-parser error-contract mismatch; the intended regression
failed before the narrow adapter fixed malformed/encoding422, structural413 and
cancel/deadline503 behavior. Unexpected exceptions remain unchanged. An initial
limit-test fixture hit the existing512-byte ZIP-path guard; that fixture was
corrected without weakening production limits. Final **125adjacent tests** pass,
including13 new manifest cases; focused lint/types/diff checks pass. Real
synthetic DOCX files were inspected through the adapter, and Python independently
verified archive/part/main-source/roster hashes and metadata. Source review
passed. Exact evidence and remaining contract boundaries are in
[Master-Import-Format-Preservation.md](../evidence/web-operational-readiness/Master-Import-Format-Preservation.md).
The new broad gate is prepared; 777Edge/full-web remains the preceding overlay's
completed broad result. Browser, durable binding, edited DOCX/PDF rendering,
export, RTF and production acceptance remain open.

Read-only hosted metadata refreshed: project ACTIVE_HEALTHY,25functions,
67migrations, and missing active `document-operation`, `extract-upload`,
`brand-logo` unchanged. `ingest-upload` remains version328. Evidence
`hosted-metadata-refresh-20260907.json`; no hosted writes or new function-body,
secret, Profile-grant or capacity/evaluation inspection occurred.

**00:14 full manifest verification passed:** `job-mtpw6jrj-7eb51f46` exited0
in68seconds. Evidence `upload-source-full-gate-20260906141325640`: full web gate
passes (165deployment/223root/291shared/895web tests, lint/types/build/29pages/
progressive bundles), all26entrypoints plus Word adapter typecheck, focused Deno
lint and diff check pass. The complete Edge suite passed790tests. Source, HEAD
and web-dotenv before/after fingerprints match. This is local overlay evidence,
not CI, hosted deployment, durable manifest integration or edited/exported-file
acceptance.

**Extraction response recovery repaired locally:** while tracing the larger
source-checkpoint integration, controlled tests reproduced current client hangs
when fetch/read/cancel ignore cancellation, plus pre-cancelled dispatch and an
unread oversized body. Six isolated regressions failed before the repair. The
existing client now captures identity/signal, observes abort/deadline itself,
discards late response bodies, releases readers without awaiting unbounded
cleanup, and preserves exact v1 success/identity/64KiB validation. Further red
cases closed a fetch-settlement disposal race and bounded empty-chunk producers.

164adjacent tests pass; final16client tests include exact65,536one-byte chunks,
Unicode, exactbyte boundaries, identity changes and late cleanup failures.
Focused lint/types pass and independent review passed. The final chunk-ceiling
test gap was filled without source changes. Full web/Edge verification is now
prepared for this latest overlay;790Edge/full-web remains the preceding completed
gate. No production/browser/durable-manifest/editing/export acceptance is claimed.
The compatible private checkpoint design is recorded in
`docs/evidence/web-operational-readiness/Upload-Source-Checkpoint-Integration.md`;
its wire/SQL changes are not yet implemented or activated.

**00:37 upload response recovery verified broadly:** `job-mtpwzfmn-3f11053d`
passed in69seconds. `upload-source-full-gate-20260906143553308` records801Edge
tests,26entrypoints/Word-adapter types,8-file focused Deno lint and full web gate
passing (165deployment/223root/291shared/895web, lint/types/29page build/bundles).
Source, HEAD and web-dotenv snapshots match. This closes the local verification
gate for that bounded response repair; versioned manifest persistence, RTF,
format-preserving editing/export and production acceptance remain open.

**7 September — private source contract and combined extraction implemented:**
the lightweight server module now validates and owns DOCX manifests against the
accepted archive identity, retaining existing source versions and re-exported
APIs. It enforces bounded shapes, exact parts/node identity, range and numeric
consistency, source-only blockers, serialized size and canonical roster hash.
It does not treat consistency as layout or edit approval. Review reproduced and
closed zero compressed bytes with positive inflated content even when the roster
hash was correctly recomputed. Two lint findings were corrected without disabling
the checks. No parser/provider/storage runtime is pulled into the light module.

The new internal `extractBoundedUploadWithSource` returns text and DOCX source
from one owned archive inspection and one cumulative deadline. The original
text-only API remains exact; PDF/XLSX/TXT/MD/CSV have explicit source absence.
Required DOCX mapping failure rejects the whole result. A compressed-read test
also reproduced missing cancellation cleanup (five passes, one failure). The
reader now initiates unfinished-read cancellation before publishing its primary
error; the same original can subsequently be retried. Underlying cleanup
completion is not claimed.

**Verified locally:** 95 focused/adjacent tests pass; separate Deno lint/types
pass, and independent source reviews passed. Real styled DOCX files went through
the combined extraction and contract roundtrip with unchanged originals; Python
independently verified archive/part/CRC/size/main-source/roster identities.
Evidence, changed files and exact limitations are in
`docs/evidence/web-operational-readiness/Master-Import-Format-Preservation.md`.
The broad verification runner now includes the new contract module and tests.
Its next full run is prepared; the preceding completed gate remains 801 Edge/full
web green and must not be attributed to these later changes.

**Unverified:** the combined producer is not yet selected by the active handler.
Accepted v2 wire, private checkpoint persistence/adoption, RTF, rich editing,
export fidelity and actual browser/production upload remain open. No CI,
deployment, hosted mutation or edited/exported-artifact acceptance is claimed.

**01:08 AEST — full gate failed on changed local dotenv, not an Edge regression.**
`job-mtpy41rn-9c850225`/`upload-source-full-gate-20260906150728252` records818
Edge tests, all26entrypoints/source types and ten-file Deno lint passing. Web
deployment/static/lint/type and165deployment/223root/291shared/895web tests passed.
The build stopped at the real security guard before Next.js compilation; bundle
checks were not reached. Source/HEAD fingerprints matched, web dotenv did not.
The root file disappeared and its exact whole-file hash appeared in the web
directory with prohibited names. No environment write was made by this task.

At01:37 a read-only refresh found the confidential file's hash at the operator
destination and a new0600 public web file with eight names. The guard passed.
The editor/actor remains unconfirmed; no values were logged or credentials
changed/verified. `format-preservation/environment-refresh-after-wire.json`
records metadata only. The failed run remains failed; a fresh full gate is
prepared against this current layout.

**Compatible v2 extraction transport implemented locally:** client/handler/index
now preserve exact v1 defaults and support a separately accepted v2 request with
mandatory original identity and closed manifest variants. The handler checks
request/snapshot version before Storage, calls the combined reader once, checks
format against accepted metadata, validates the manifest, and returns its owned
copy. The client bounds raw/envelope/manifest bytes and chunk work with fixed
storage, retains cancellation through hashing, and checks absolute deadlines
during reads and before publication. No v1 fallback is permitted for v2 failure.
Active ingest/database acceptance remains v1; these compatible readers are not
activation or durable checkpoint completion.

Initial missing-feature runtime reproductions and three independent-review
regressions are retained. Corrections prevent expired immediate streams, late v1
success and accepted DOCX format downgrading.159adjacent tests pass, final focused
lint/types pass, and both source reviews passed. A real styled DOCX traversed
the controlled client/handler/actual parser/client path with unchanged bytes and
exact source identity; Storage/RPC/authenticated browser persistence was not
exercised. Details and logs are in `Master-Import-Format-Preservation.md`.
RTF, database v2 adoption/replay, rich editing/export, CI and production remain
open. No protected deployment or hosted mutation occurred.

**01:42 AEST — compatible v2 transport passed the full local gate.**
`job-mtpzbct2-685fbfc6` completed in 76 seconds with exit 0. Saved evidence
`upload-source-full-gate-20260906154108753` records 834 Edge tests, all 26
entrypoints plus source/Word types, 14-file Deno lint and diff checks passing.
`pnpm verify:web` passed: 165 deployment, 223 root, 291 shared and 895 web tests,
lint/types, the 29-page production build and progressive bundle checks.
Source, HEAD and web-dotenv fingerprints match before/after. This verifies the
dirty overlay on `e1d514d` under Node 22.23.2, pnpm 10.33.0 and Deno 2.9.5;
it is not clean-commit CI or hosted acceptance. The preceding dotenv-drift run
remains failed. Private v2 checkpoint adoption, RTF, rich editing and export
fidelity remain open; no protected action occurred.

**Authoritative extraction readback repaired locally:** successful and lost-ACK
record paths now both read, compare and adopt the existing private checkpoint
before provider dispatch. Null/unavailable reads preserve a retryable processing
state; confirmed mismatches retain reconciliation. The existing stage CAS
rejects a claim handoff during readback. The RPC normalizer also rejects array
format values instead of coercing them to strings.

Five intended adoption regressions and the malformed-RPC regression were
reproduced before their fixes. All 34 ingest cases and 169 adjacent extraction/
source/ingest cases now pass, as do separate lint/types and independent source
review. Evidence is under `format-preservation/checkpoint-adoption-*` and
`checkpoint-format-red.log`; the detailed record explains the corrected initial
test-filter and missing-context fixture attempts. The full runner includes the
two ingest files and is prepared for a fresh gate. No real database/browser/
provider/production acceptance is inferred from these controlled tests.

**01:59 AEST — authoritative readback passed the full local gate:**
`job-mtpzx7di-ac9bd3a0` exited 0 in 70 seconds. Evidence
`upload-source-full-gate-20260906155808143` records 844 Edge tests, all 26
entrypoints/source types, 16-file Deno lint and diff checks passing. The complete
web gate passed (165 deployment, 223 root, 291 shared, 895 web tests; lint/types;
29-page build; progressive bundles). Source, HEAD and web-dotenv fingerprints
matched. No database/hosted mutation or browser/edit/export proof occurred.

**Private source checkpoint migration prepared, execution pending:**
`20260906160000_upload_source_checkpoint_v2.sql` adds private accepted-version/
manifest/digest fields to existing uploads, compatible defaulted claim/record
signatures, immutable source identity, exact historical reads and v2 provider/
completion fences. The deployment contract and signature assertion were updated.
Source-only mapping remains distinct from format/edit approval. Source review
closed an extra-field public-replay privacy gap and a scalar-array safety issue.

New SQL fixtures and the existing disposable runner now cover fresh acceptance
plus a representative historical upgrade, real local old-arity PostgREST calls,
positive owners, private-source denials and independent readback. Reviews passed;
two no-service preflights, JavaScript syntax, 70-migration static checks and diff
checks passed. Actual SQL execution and upgrade results remain unverified.
`Upload-Source-Checkpoint-Integration.md` records exact files, contract limits,
review corrections and acceptance scope. No hosted write, activation or
declaration of working RTF/format-preserving editing was made.


**02:37 AEST — fresh source-checkpoint SQL passed; upgrade runner stopped.**
`job-mtq18ktc-bd1f2fdb` exited 1 after 127 seconds. Saved evidence
`db-20260906163458380-8b03111a` proves all 70 migrations applied on the
identified disposable database and 1,609 assertions across 37 SQL files passed.
This includes 89 new source-checkpoint assertions. The complete web gate passed:
165 deployment, 223 root, 291 shared and 895 web tests, lint/type checks,
29-page production build and progressive bundles. Edge tests were not rerun in
this database job; their latest separate full gate remains 844 passing.

The overall failure is `Historical reset changed the owned container` in the
runner, after the CLI successfully recreated the database at predecessor
`20260906010846`. Saved before/after attestations show changed container and
cluster IDs, with identical project, ports, network, named volume, mount,
PostgreSQL version and exact image/digest. No historical fixtures, forward
upgrade or HTTP acceptance ran. Cleanup removed only this run's disposable
resources; the before/after resource inventories are equal. HEAD, source hashes
and tracked diffs are unchanged. The failed run remains failed.

**Implemented runner correction; upgrade verification pending:**
`run-isolated-db-baseline.mjs` now returns its complete database attestation and
uses `disposable-database-reset.mjs` only around explicit resets. Only container
and cluster identity may change at those boundaries; the entire remaining
configuration must match. Ordinary before/after migration and test checks retain
full identity equality. The guard is fingerprinted with the runner/probes.
`disposable-database-reset.test.mjs` exercises the actual saved reset snapshots
and rejects project, database, version, internal/published port, network, volume,
mount, image and malformed identity drift. All 13 behavioral cases and the two
existing SQL isolation guards pass under Node 22.23.2, as do runner syntax and
`git diff --check`. This changes local acceptance tooling only, with no hosted
mutation, admission activation or claimed browser/edit/export success.


The corrected reset guard passed independent read-only review. No-service
preflight `db-20260906164234090-e8b7f026` passed all 15 guard tests, runtime,
70-migration and target checks; source/HEAD/tracked fingerprints remained
unchanged. A fresh identified disposable acceptance run is the next gate;
its historical upgrade and authenticated HTTP results are not yet known.


**05:24 AEST — historical upgrade and 39 HTTP checks passed; upgraded suite interrupted by low-power sleep.**
`job-mtq1jh28-3d2c01af` exited 1. Saved evidence
`db-20260906164326732-34e410b5` records fresh acceptance of 70 migrations and
1,609 assertions across 37 files. The corrected reset identity gate passed.
The exact forward migration from predecessor `20260906010846` to
`20260906160000` applied successfully, preserved both historical rows and null
historical source fields, and passed all 39 real local Auth/PostgREST checks.
Those checks prove old named-call compatibility, the intended pre-migration
404/PGRST202, two authenticated users' positive owned reads and private-source
denials, authoritative source readback, idempotent recording, terminal replay
and independent SQL readback. The database-owned source digest was
`3e7dfe178b6e888069800e0d2ac95cc8893376a9ca28d90d40e57f082619e78a`.
This is controlled synthetic local persistence; no Storage, browser upload/edit,
real provider, export or production workflow was exercised.

The repeated broad SQL suite on the upgraded database began at 02:44:59 AEST;
23 files reported success before interruption. macOS power logs confirm Low
Power Sleep at 02:45:00 on 1% battery and hibernation wake at 05:23:02 on AC.
The process timeout returned at 05:23:03. No failed SQL assertion was emitted,
but the missing final result means this gate remains failed/incomplete; no test
was waived or timeout extended. See `upload-source-host-interruption-20260907.json`.
Cleanup succeeded with identical before/after resource inventories. The web gate
then passed again (165 deployment, 223 root, 291 shared, 895 web tests,
lint/types, 29-page build, progressive bundles). Source/HEAD/tracked fingerprints
were unchanged. Edge tests were not rerun in this job.

The current Mac power source was independently confirmed as AC and charging.
No application or test implementation change is warranted by this interruption;
the unchanged disposable fresh/upgrade acceptance remains the next required gate.
Active ingest is still v1; RTF and formatting-preserving editing/export remain
unimplemented or unverified. No hosted action or activation occurred.


**05:29 AEST — complete local fresh/upgrade upload acceptance passed.**
`job-mtq7e6er-3c6c4722` exited 0 in 156 seconds. Saved evidence
`db-20260906192717343-52c5a070` records 1,609 assertions across 37 files
passing on both fresh and representative upgraded databases, the exact 70-file
migration history, all 39 real local Auth/PostgREST checks, and the complete web
gate (165 deployment, 223 root, 291 shared, 895 web tests, lint/types, 29-page
build and progressive bundles). Resource inventories, source hashes, HEAD and
tracked diffs matched before/after. The earlier reset-assertion and low-power
runs remain failed. This proves local controlled checkpoint persistence and
historical compatibility, not Storage/browser/provider/edit/export acceptance.

**Dual-version ingestion implemented locally; broader acceptance pending.**
`ingest-upload/handler.ts` retains default-v1 eight-argument admission and exact
legacy public responses. Accepted v2 receipts select the v2 isolated reader and
strict eleven-key checkpoint normalizer, with the accepted SHA/byte length and
claim identity. The existing manifest normalizer owns/canonicalizes source data;
DOCX requires its manifest plus an opaque DB-issued digest/version, while other
formats require the explicit null triplet. V1 recording keeps ten arguments;
v2 adds only version and manifest. No source map or digest is projected into
classification, settlement public payloads or terminal responses. Text cleanup
is separate from the original source-node map.

Both successful and lost write acknowledgements must adopt matching authoritative
readback before dispatch. Missing/unavailable reads remain retryable; different
source-node content reconciles even when text/archive/roster hashes match.
Request aborts before provider work are fenced. V2 provider-stage resumes replay
the existing transition to recheck claim identity after manifest hashing; v1
replay behavior is unchanged. Browser abort after provider dispatch retains the
inherited durable-result settlement semantics; this slice does not prove a new
logical cancellation command or cancellation through every later stage.

Three real-adapter version regressions initially failed for the intended reason
(`ingest-v2-adapter-red.log`). The assembled source tests then exposed canonical
object-order comparison and a missing provider-stage claim recheck; the four
failures are preserved in `ingest-v2-source-red.log`. Fixes passed 79 ingestion
cases, types and lint. The test fixture was corrected to capture the normalized
checkpoint before terminal settlement and return null afterward, matching the
real RPC. `source-checkpoint.test.ts` uses the actual synthetic DOCX producer
with controlled RPC/classifier boundaries; it is not a real Storage/network or
browser journey. The full Edge/web runner now includes its lint check.

**Reopened SQL acceptance: post-lock v2 lease time.** Independent source review
found that `advance_upload_ingest` captures `v_now` before taking locks, then
uses it for the v2 replay lease check. The new ingestion replay fence relies on
that check. A bounded same-database/two-backend regression has been added to
`upload_source_checkpoint_v2.test.sql` to queue a replay behind the owner lock,
expire its lease after observing the wait, then release it. The migration is
still unchanged for the intended failing reproduction. Earlier SQL success did
not cover this race. Correcting it and rerunning the full local gate are required
before this slice is accepted. No hosted migration, function deployment, v2
admission activation or claim of working format-preserving editing occurred.


After the terminal-read fixture correction, all 214 adjacent extraction/source/
ingestion cases passed again, including all 79 ingestion cases. Independent
review accepted the actual two-session SQL regression for execution. Its observed
advisory-wait prerequisite must pass; otherwise a failing run is invalid setup,
not the intended lease-clock reproduction. The prepared migration remains
unchanged for this red run. No source writer or hosted action is running.


**05:51 AEST — v2 replay lease race reproduced; unrelated source drift also detected.**
`job-mtq87n13-36cefccc` exited 1. In `db-20260906195011905-3917f5c1`,
1,616 of 1,617 SQL assertions passed. The only SQL failure was test 94 of 97 in
`upload_source_checkpoint_v2.test.sql`: the queued replay returned
`idempotent_replay`, expected `UPLOAD_EXTRACTION_CHECKPOINT_REQUIRED`. The
independent-session, positive fixture, observed advisory-wait, draining and exact
cleanup assertions all passed. Copied SQL inputs still match their accepted
manifest. This is the intended reproduction, not a test-setup failure.

The runner also detected `ollama-transport.test.ts` changing from SHA
`4fa8f34679cf73dae682d6d29bf66fe2db60da82eb242a1734726cfb82983fec` to
`2699b4ac49dfed758acfb1c388eb7e6dee5d4bec5d922d56f5079c96e4148e4e` during
execution. The web gate completed successfully with the prior test/build counts,
but the whole-source guard failed; final tracked/HEAD comparison steps were not
reached. A separate current HEAD read still returned `e1d514d`. Disposable
resource cleanup succeeded and before/after resource inventories match. Preserve
this run as failed and its copied-SQL reproduction as narrower evidence.

**Implemented and independently reviewed; GREEN execution pending:**
The generator and prepared `20260906160000_upload_source_checkpoint_v2.sql` now
refresh `v_now` only for v2, after both locks and exact row/claim validation.
The refreshed time supplies the v2 expiry check, heartbeat and renewal. Historical
null/v1 timing, signatures, grants, defaults and replay shapes are unchanged.
The regenerated migration differs from the reproduced copy by only this five-line
block. The regression is unchanged. Static migration validation, 15 isolation/
reset guard tests and diff checks pass. This is a local draft migration, not a
change to hosted or previously released history.

**Concurrent provider work is outside this upload change's authorship.**
Read-only review found ongoing provider-router, cost-tracker, model-call-context,
shared document-operation and Deno-lock edits, plus new Ollama/credit-error files.
These began after the 05:29 AEST stable gate; the current coordination board has
no corresponding claim. Their plan asserts a separate owner instruction, which
has not been confirmed in this thread. The owner has been asked whether another
task is editing. Preserve those files; do not accept them by implication or
attribute them to this task. No environment values, provider activation or
hosted changes were performed here. Their runtime/SQL integration and policy
scope need coordinated review before release acceptance. Whole-tree source
guards remain enabled; any continuing drift keeps broad verification unaccepted.

`run-upload-checkpoint-acceptance.mjs` composes the existing disposable DB/web gate
and, only after success and cleanup, the existing Edge-only gate. This retains
all source and target checks and stops on failure. The next run will verify the
copied SQL correction and attempt the broader checks without weakening the
source guard. Source-only retention still does not establish RTF support or
format-preserving PDF/DOCX editing/export.


**Upload SQL scope corrected before the next GREEN run.** A later, separately
owned provider migration and its tests appeared after the previous preflight.
The original exact-one-forward-migration assertion occurred after the fresh
reset and tests, so it could not prevent that unrelated SQL from entering the
upload acceptance database. No service was started on that stale preflight.

The explicit `--upload-source-acceptance` mode now uses
`upload-source-sql-scope.mjs`: it pins the actual RED manifest digest and its
70 migration / 37 test identities, allowing only the separately reviewed five-line
clock-fix SHA. It validates all selected source bytes, counts, unique migration
versions and the one-version suffix before service start. The runner copies only
that declared slice, archives excluded current SQL paths and hashes, and retains
its entire current-tree before/after drift check. The ordinary database mode
continues to copy every current SQL file. This is bounded upload SQL acceptance;
it cannot establish acceptance of the current combined schema or provider policy.

All **23** scope, reset and SQL isolation guard checks pass; Node syntax and
`git diff --check` pass. No-service preflight
`db-20260906201147923-c4543885` passed with 107 selected SQL files, unchanged
source inventory, and two separately recorded exclusions:
`20260907053000_ollama_credit_fallback.sql` and
`ollama_credit_fallback.test.sql`. The foreign migration continued changing
since the read-only review; none of its SQL was applied by this preflight.
The corrected SQL regression's GREEN execution remains pending.

Read-only review found that the foreign migration changes provider accounting,
allowance settlement and effective captured-wording validation, despite leaving
upload/Profile commands intact. Its draft new legacy RPC definitions do not by
themselves prove deployment integration. The 39-check upload HTTP probe settles
controlled synthetic classifications and never executes that shared provider
router. Whole-app/provider compatibility and exact-revision grounding acceptance
remain separate, unverified gates.

Independent review accepted the SQL scope boundary and identified two evidence/
execution details. Both are corrected: the new scope test itself is now saved,
hash-captured and checked at target/final boundaries; a scoped prerequisite
rejection now stops before the expensive web gate. The final no-service
preflight `db-20260906201356281-38686d88` passed, including all 23 guard checks.
The next CPJ command remains the prepared sequential upload DB/web then Edge
wrapper. Actual SQL GREEN, broad integrated-source acceptance, browser workflows,
RTF support and formatting-preserving editing/export are not claimed by this
preflight.


**Latest acceptance launch stopped at a local port prerequisite.**
`job-mtq9362y-46596ba1` exited 1 after approximately 1.3 seconds. Saved evidence
`db-20260906201443007-39855cd2` reports `EADDRINUSE` for local API port 58321.
All 23 scope/isolation guard checks and the current 71-file migration static
check passed. The runner did not start a database, apply migrations, or reach
SQL/HTTP/web/Edge acceptance. Source, HEAD and tracked diff remained unchanged.
This run provides no GREEN result for the corrected lease race. A subsequent
read-only listener/container inventory found no current listener on 58321; the
process that occupied it during launch has not been identified. No existing
process or shared database was stopped or changed.


The failed launch's saved Docker inventory identifies a concurrent disposable
stack `prompted-db-20260906201425835-1fd7323d`. Its separately launched run has
now completed and its resources are absent from the current listener/container
inventory. Read-only inspection of its evidence (not a launch by this task)
shows **1,627/1,630 SQL assertions passed**, with all three failures in the
new `ollama_credit_fallback.test.sql` (9, 11, 12). All **97** upload-source
assertions pass, including the queued replay lease regression. The tested upload
migration and regression hashes match the current reviewed files; every copied
SQL file still matches that run's manifest. Full source inventory was unchanged,
cleanup succeeded and its web gate passed. This establishes a narrower fresh-DB
GREEN result for the clock fix in that combined schema, not acceptance of the
foreign provider changes. No historical upgrade/39-check HTTP probe ran there;
the explicitly scoped upload acceptance remains required. No process was stopped
or shared resource mutated by this inspection.


**06:22 AEST completion — upload SQL GREEN, combined source gate failed.**
`job-mtq9aaql-702e8bce` ran approximately 138 seconds and exited 1. Evidence:
`db-20260906202015598-0546af45`. All **1,617/1,617 SQL assertions** passed in
both the fresh and representative historical-upgrade databases (37 test files,
70 selected migrations), including all 97 source-checkpoint assertions. All
**39 real local Auth/PostgREST checks** passed, including old named-call
compatibility, source readback after discarded acknowledgement, private-column
and cross-owner denials, terminal replay and independent SQL persistence read.
Every copied SQL input still matches its manifest and current selected SQL.
Disposable resource inventories before/after are identical; cleanup succeeded.

`pnpm verify:web` also exited 0 (295 shared tests, 896 web tests, production
build 29 pages, bundle gate 11 deferred boundaries/3 critical routes/1 catalogue
chunk). However, the source guard detected changes to MasterWorkspaceImport.test,
ingest exact-replay.test, plus newly added upload-fallback-provenance.test and
ollama_captured_fallback.test. Final tracked/HEAD comparisons after that guard
were not reached. The wrapper correctly did not start its Edge phase. This is a
failed whole-source run with attributable immutable SQL/HTTP success, not a
stable combined revision pass. The temporary database-action claim was removed
after verified cleanup; the unfinished source claim remains owned.

Independent read-only review found a separate integration conflict in foreign
provider work: valid fallback metadata adds a ninth response and sixth payload
key, while accepted upload-extraction.2 settlement permits exact eight/five-key
sets. Its draft provider migration does not redefine settle_upload_ingest.
That future combination rejects with UPLOAD_INGEST_SOURCE_PRIVACY_INVALID after
classification. The active old-arity admission still defaults to v1; this does
not explain all current failures. Do not remove the private-source key guards
or adopt the foreign policy by implication. No destructive same-hunk overwrite
of the owned checkpoint/identity/Master lease protections was found.

**Next implemented slice — TextEdit decoding and safe Unicode truncation.**
The existing resolver now decodes a copied original once: fatal UTF-8 by default,
or strict UTF-16LE/BE only when the byte-order mark declares that encoding.
Decoded NUL, malformed sequences and resource excess still reject explicitly.
The derived immutable text is reused after the async boundary; original bytes,
request identities, versioned checkpoints and provider policy are unchanged.
The common output ceiling no longer splits a supplementary character, and the
shared confirmation parser accepts the exact positive bounded extracted count
after safe truncation/whitespace cleanup instead of requiring all truncated
results to contain exactly 20,000 code units. Exact count/filename checks remain.

Regressions reproduced 12 text-parser failures and 2 confirmation failures for
the intended reasons before the fix. Initial fixture typing errors are saved
separately and are not RED behavioral evidence. Current verification records
`format-preservation/textedit-local-verification.json`: **200 Edge tests** and
**40 shared upload tests** pass, including 30 new encoding/boundary cases and
four real extractor-handler/client roundtrips, plus an adjacent DOCX boundary
case. Extract/ingest entry types, shared types, three changed Edge-file lint,
shared lint and diff checks pass. The five selected production/test file hashes
are unchanged across these commands. Full web/Edge verification of this new
slice remains pending.

The roundtrips use controlled original reads and HTTP dispatch; they are not
real Storage, provider, browser, hosted or exported-artifact proof. No hosted
migration, deployment, secret, original user file, plugin or native-app change
occurred. Previously failed identical uploads still replay their immutable
failure; an explicit linked recovery contract is required before claiming that
case repaired. RTF needs its own bounded parser/source/wire/SQL/UI contract.
Format-preserving PDF/DOCX editing/export remains incomplete.


**06:42 AEST completion — broader TextEdit checks and lint repair.**
`job-mtqa156e-5f37305f` exited 1 after approximately 73 seconds. Its evidence
`upload-source-full-gate-20260906204108085` records **939/939 Edge tests**,
all **26** active entry-point type checks, and complete `pnpm verify:web`
success: 165 deployment tests, 223 root checks, 297 shared tests, 896 web tests,
29 generated pages and the progressive-bundle gate. Source, HEAD and the web
dotenv metadata/hash snapshot stayed unchanged throughout that run.

Only source lint failed: a foreign import was placed before the existing
file-level Deno import-policy directive in ingest-upload/handler.ts, so the
previously permitted base64 import triggered two lint errors. The directive has
been returned to the first line without changing the executable import order or
body. All **18** targeted files now pass lint; diff checks pass. Saved
`lint-correction.json` proves reversing that two-line swap exactly recreates
the handler hash used by the broad run. The failed CPJ result remains recorded;
`source-lint-corrected.log` is the separate post-fix result.

A later full source comparison also observed foreign model-call-context and
model-call-dispatch-contract test changes, plus its plan update. Therefore the
939-test result must not be promoted to current combined-source acceptance.
The TextEdit slice has focused/adjacent/types/lint and broader runtime evidence,
with historical retry, authenticated browser/Storage, CI and production still
unverified. The continuing RTF implementation must retain its own actual source
format and protected original; enabling a file extension alone is insufficient.


**RTF source preparation — 7 September 2026, continuing implementation.**
The inactive bounded RTF reader and v3 source producer are implemented, with
146 new focused checks and 355 combined adjacent checks passing. Entry types,
eight-file lint and diff checks pass; selected source hashes are stable. Actual
AppKit-produced synthetic RTF matches native text readback exactly, and original
bytes retain SHA256 c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84.
Review-detected shared-buffer, consequential-formatting and font-definition
acceptance failures were reproduced and corrected. Deadline expiry is retryable;
structural limits are permanent and no partial text is accepted on parser error.

Full attribution, error/compatibility decisions, reviewed source limits, exact
files and tests are in `docs/evidence/web-operational-readiness/RTF-Source-Verification.md`
and `format-preservation/rtf-local-verification.json`. The source-only manifest
contains immutable original/wording identity and an editing blocker. Historical
v1/v2 wire and SQL admission remain literal; v3 is not activated. Next is v3
wire/checkpoint/lease/SQL integration and fresh/upgrade persistence proof, then
Master admission and actual source-preserving editing/export. This is not a claim
that RTF uploads currently work in Master or that PDF/Word formatting is protected
through editing. The broader gate for this overlay is pending.

Live refresher also found AGENTS now explicitly documents the separate local
Ollama exception. Earlier observations of unchanged OpenAI-only instructions are
superseded; foreign provider source and its upload-v2 settlement metadata conflict
remain preserved for separate integration review. No publication, hosted mutation,
secret or native-app implementation occurred.


**07:27 AEST — completed broad RTF preparation verification.**
`job-mtqbmiaq-99af46ea` completed in approximately 70 seconds with exit 0.
`upload-source-full-gate-20260906212544478` records 1,086 Edge tests, all 26
active entry-point type checks, all 23 targeted lint files, and complete
`pnpm verify:web`: 165 deployment tests, 223 root checks, 297 shared tests,
896 web tests, 29 generated pages and the 11/3/1 progressive-bundle gate.
Source, HEAD and web dotenv metadata/hash snapshots are identical before/after;
the completion-turn comparison also found no source changes. This is attributable
local verification of the recorded dirty overlay at e1d514d, not committed, CI,
hosted or browser-persistence acceptance. The new v3 reader remains unactivated.
The next authorized slice is its explicit private wire/extractor integration,
followed by v3 durable checkpoint SQL/ingest and Master source-editing admission.

**Private v3 extraction integration — 7 September 2026, local slice.**
The existing private client, handler and entry point now read explicit v3
RTF/DOCX/other supported source responses, bound to the exact accepted original,
owner, upload, claim and request. Old v1/v2 contracts and ingest's accepted union
remain; SQL and browser admission are not activated. Real parsing/hashing in
controlled client-to-handler roundtrips passes for RTF, DOCX and Markdown.

Review found and reproduced a Storage byte-alias/hash race, cancellation
precedence gaps, coercible v3 identities, an open v3 snapshot shape and inherited
request-body stalls/cleanup gaps. Those bounded failures are corrected with
intended RED→GREEN evidence. Request reading has a 4096-byte/chunk ceiling and
five-second deadline; cancellation/timeout remains retryable and late cleanup
cannot replace the selected response. The source-identity/cancellation repair
received an independent read-only PASS, as did the request-reader lifecycle repair.

`RTF-Private-Wire-Verification.md` and `format-preservation/rtf-wire-local-verification.json`
record exact files/commands and **464/464 adjacent tests**, extract/ingest entry
types, 21-file lint, clean whitespace checks and stable whole-source hashes.
This is local dirty-overlay evidence at e1d514d. The new broad web/all-Edge gate
is still required; the previous job's success is not evidence for later edits.
No CI, deployment, hosted schema/data/Storage or paid provider change occurred.
Durable v3 checkpoints, historical failed-upload recovery, signed-in Master
uploads, actual PDF/Word formatting-preserving editing and export remain open.

**07:56 AEST — private v3 integration broad verification completed.**
`job-mtqcokq0-ecd588c6` exited 0 after approximately 75 seconds. Evidence at
`upload-source-full-gate-20260906215520548` records **1,120/1,120 Edge tests**,
all **26** active function entry-point types, **27** targeted lint files and
complete `pnpm verify:web`: 165 deployment tests, 223 root checks, 297 shared
tests, 896 web tests, 29 generated pages and the 11/3/1 progressive-bundle gate.
Source, HEAD and web dotenv metadata/hash snapshots remained identical; a
completion-turn comparison found no subsequent source changes and no staged files.
This verifies the recorded local dirty overlay, with no CI, deployment or hosted
workflow claim. Next is the already-authorized v3 durable checkpoint repair:
first reproduce SQL admission/privacy gaps on the existing disposable local DB
harness, then extend existing upload contracts and prove compatibility/replay.

**V3 database regression prepared, before SQL implementation.**
`supabase/tests/upload_source_checkpoint_v3.test.sql` adds 18 behavioral checks
using the exact 449-byte synthetic AppKit original and inspected preview digest.
The embedded original was independently compared byte-for-byte with the saved
file. Two positive owner fixtures and working old eight-argument/v2 claims are
controls; explicit v3 admission, independent stored version, the missing RTF
normalizer and nested/individual private RTF fields are the intended regressions.
Independent source review expects 10 passing controls and 8 failures on current
v2 SQL, not eight independent production exploits. No v3 migration has been
written or applied at this point.

The unchanged disposable harness passed `--preflight-only`, evidence
`db-20260906220259919-6ad5a5a8`. The planned RED run uses all current migrations
and SQL tests without filtering; separately owned provider SQL may report its
own failures. The runner creates and attests a unique local project, uses no
hosted target or actual user records, and cleans up only that project's resources.
New test SHA256: d27a1bba771cb770eca14a83bd6a89fb530f2323b644891f8bf6092f332bcad1.

**V3 database RED completed; forward migration prepared — 7 September 2026.**
`job-mtqd12v9-54eba0ce` exited 1 for the intended regression, evidence
`db-20260906220503917-00b44fba`: **1,682 SQL assertions across 40 files,
1,674 passed and exactly 8 failed**. All eight were the predicted v3
admission/identity, absent RTF normalizer and private-source exclusions in the
new fixture. The other ten controls in that fixture passed. Every existing SQL
suite, including the separately owned provider tests, passed in this run.
`pnpm verify:web` passed completely (165 deployment, 223 root, 297 shared and
896 web checks; 29 pages; 11/3/1 progressive-bundle gate). Exact owned-stack
cleanup passed; before/after resource inventories and source/HEAD were equal.
The corrected completion comparison uses this DB runner's documented `docs/`
exclusion; its earlier broader comparison method and correction are retained in
the evidence directory rather than treated as unexpected source changes.

The local forward migration
`supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql` now extends
the existing upload row, commands, constraints, immutability and private digest
contract to explicit `.3` claims. It adds the six-key RTF source-only manifest
bound to accepted original identity and exact UTF-8 preview digest, the policy
`.2`/RTF format branch, metadata compatibility and nested public-result privacy
checks. Existing `.1`/`.2` defaults, historical predicates, terminal receipts and
same-token late completion remain intact. The completed-response extra-key
conflict with separately owned `credit_fallback` remains unresolved; no private
provenance is silently dropped or accepted by loosening the envelope.

Review corrected requested-version timing that could affect historical claims:
new v3 insert timestamps are separate from historical invocation time, and
stored-v3 claims refresh their clock only after locking. The expanded SQL
fixtures cover exact RTF/DOCX/text checkpoint writes, private readback, replay,
attempt limits, invalid candidates, source immutability, token takeover,
uncertain storage, failure privacy and same-token late completion. Independent
dblink sessions exercise expiry while waiting on the observed exact blocker for
attempt, record, provider replay and historical/v3 claims. Review also corrected
an oversized-source assertion so its manifest and accepted lengths agree and
only the one-MiB cap is invalid, with a matching inclusive-boundary control.

**Verified locally before fresh SQL execution:** migration filename/order check
passes for 72 migrations; 95 isolation/reset/scope/deployment-contract checks
pass. The unchanged disposable runner's fresh preflight passes at
`db-20260907010754242-672e3022`. **Unverified:** execution of the forward v3 SQL,
historical upgrade, real Auth/PostgREST/Storage v3 journey, ingest/browser
admission and format-preserving editing/export. The next gate uses all current
migrations and tests without the old v2 slice filter. No hosted mutation,
release or v3 ingest activation has occurred. Details:
[RTF durable checkpoint verification](../evidence/web-operational-readiness/RTF-Durable-Checkpoint-Verification.md).

**11:11 AEST — first forward-v3 run caught migration syntax; corrected locally.**
`job-mtqjn2u8-1a41d66d` exited 1 after approximately 57 seconds, evidence
`db-20260907011008017-dd75b6c2`. Supabase startup reached the new migration and
rejected statement 12 (`record_upload_extraction_snapshot`) with SQLSTATE
`42601`: the CASE expression inside the PL/pgSQL IF policy comparison needed
parentheses. The subsequent explicit fresh reset and SQL suites were **not
reached**. This is a confirmed migration defect, not an environment failure or
new behavioral test result. The forward migration now parenthesizes that CASE;
no policy value, expected failure or historical contract was changed.

The sequential `pnpm verify:web` gate passed completely. Exact owned cleanup,
resource inventories, source hashes and HEAD checks passed; the completion-turn
source comparison also found no changes. The failure receipt and original draft
hash are retained. V3 SQL execution, upgrade, Auth/Storage/browser acceptance and
format-preserving editing remain unverified until their gates actually run.

**11:15 AEST — forward-v3 fresh database gate passed.**
`job-mtqjrokv-5cb50a05` exited 0 after approximately 101 seconds; evidence
`db-20260907011342822-ed25ab1c`. All 72 migrations applied on the identified
disposable instance, the explicit fresh reset passed, and all **1,850 SQL
assertions across 41 files passed**, including both v3 suites. Complete web
verification also passed (165 deployment, 223 root, 297 shared, 896 web;
29 pages; progressive bundles 11/3/1). Cleanup, resource inventories, source/HEAD
and the completion-turn comparison passed with no changes. The accepted local
migration hash is `effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727`.

This closes the fresh SQL gate for the private v3 checkpoint slice. The next
authorized verification extends the existing disposable runner with an explicit
v3-upgrade mode: all current SQL, exact predecessor `20260907053000`, only
`20260907081500` forward, full historical v1/v2/NULL-row comparison and real local
Auth/PostgREST/Storage synthetic checks. The old v2 scope filter remains separate.
V3 ingest/browser activation and actual format-preserving editing remain open.

**11:31 AEST — v3 historical/HTTP/Storage acceptance prepared.**
The existing disposable runner now has an exclusive
`--upload-source-v3-acceptance` mode. Its preflight passed at
`db-20260907013117148-1e0f9b39`; 24 new guard/error-contract tests and syntax
checks passed. No production source or SQL changed after the fresh 1,850-assertion
pass. The new probe and every input fixture are hashed, copied, and rechecked.
Before any service starts, the plan requires every current SQL input, exact
predecessor `20260907053000` and sole forward migration `20260907081500`.

`upload-source-v3-upgrade-acceptance.mjs` prepares actual old-default v1 and
explicit v2 processing/completed rows, plus one labelled representative
NULL-contract SQL row. It retains and reads original bytes through the private
Storage API, compares full historical rows across the upgrade, then exercises
explicit v3 RTF/DOCX/UTF-16 TextEdit text/Markdown and a second owner. Its checks
include predecessor rejection, exact snapshots, invalid candidate failures,
application-acknowledgement discard/readback, token takeover, terminal replay,
independent SQL digests/state, original byte preservation and cross-owner/private
access. Extracted wording and classification are controlled fixtures; this does
not exercise Edge extraction, provider execution or the browser.

Both independent source reviews cleared the final probe and harness. They
identified and corrected expiry fixtures that needed to move heartbeat and
expiry together to preserve the existing lease CHECK; exact invalid-response
messages and all snapshot identity fields are now asserted. Actual Auth,
PostgREST, Storage responses and upgrade behavior remain unverified pending the
run. The isolated runner owns exact fixture/blob teardown; no shared or hosted
resource is selected.

**11:35 AEST — v3 historical upgrade, Auth/PostgREST and Storage passed.**
`job-mtqkgbbt-5d952092` exited 0 in approximately 139 seconds, evidence
`db-20260907013252038-6d0938c8`. All **1,850 SQL assertions/41 files passed both
fresh and after the exact predecessor-to-v3 upgrade**. The probe completed
**163 real local HTTP checks**, retained/read **10 original objects**, preserved
all fields of **five historical rows**, and completed five current source
fixtures. Independent SQL verified exact source digests and ready/completed
state. Actual local Storage returned HTTP 400 with `NoSuchKey` for non-owner
reads, `NoSuchBucket` on the private public-object route, `KeyAlreadyExists` on
duplicate retention and `AccessDenied` on browser insertion; all were recognised
expected rejections, followed by unchanged-original readback where applicable.

Complete web verification passed (165 deployment, 223 root, 297 shared, 896 web;
build and bundles). Exact disposable cleanup passed; resource inventories,
source/HEAD and completion comparison were unchanged. This proves local
historical migration, command persistence/replay and original-byte Storage
preservation. It does **not** prove extractor/ingest Edge execution, model
classification, Master browser upload or formatting-preserving editing/export.
The next authorized slice traces and integrates v3 through existing ingest and
Master contracts, including the known accepted-provider provenance conflict.

**12:32 AEST — stored-v3 ingest reader integrated and locally verified.**
The existing ingest RPC adapter now accepts stored `.3` claims, reuses the
authoritative v3 source validator, preserves exact digest-bound wording and
requires durable readback before classification. The eight-argument claim still
defaults to v1; this does not activate RTF browser uploads. Old v1/v2 behavior,
stable identities, original storage and foreign Ollama provenance remain intact.

The recorded RED was 2 passed/16 failed at the intended premature
`UPLOAD_CLAIM_FAILED` boundary. The final adjacent run passes **122 tests**,
including 29 new v3 ingest and all 40 old checkpoint cases. Type checking,
three-file lint, new-test formatting and diff checks pass. Evidence:
`rtf-ingest-v3-green-20260907T023215.json`; implementation/reproduction, fixture
corrections, exact files and limits:
`RTF-Ingest-Reader-Verification.md`. The isolated reader diff is recorded against
the prior independently hash-verified handler; no provider-policy hunk changed.

Read-only independent review cleared the reader and supplied stronger fixture,
readback, cancellation and privacy checks. Initial adjacent type/lint failures
are retained and corrected without bypasses. The broader web/all-Edge gate for
this source revision is pending. Empty-MIME RTF alias compatibility and successful
fallback settlement remain explicit activation blockers. Master browser upload,
format-preserving PDF/DOCX/RTF editing/export, CI and production are unverified.

**13:21 AEST broad completion — Edge passed; local web configuration blocked build.**
`job-mtqoa9ec-cb82e472` exited 1 after approximately 65 seconds, evidence
`upload-source-full-gate-20260907032008091`. All **1,149 Edge tests**, 26 function
entry-point type checks and 28-file source lint passed. Web static/lint/types and
165 deployment, 223 root, 297 shared and 896 web tests passed. The build stopped
at the unchanged security guard because a prior local edit had restored
administration credentials/obsolete names in `apps/web/.env.local`. Next.js
compilation and bundle checks were not reached. Source, HEAD and dotenv hashes
were stable during this run; completion source comparison also passed.

**Local layout repair implemented and guard verified.** The current WP0 mandate
authorizes value-preserving local environment correction. Private comparisons
proved all original values already exist in the ignored operator file; the anon
aliases match and its JWT binds the same deployment-contract project. The
public Web Billing key passed the actual guard's format and consumer whitespace
checks. A reviewed, hash-pinned one-time script restored canonical public web
settings and preserved the exact original web bytes in
`.env.tools.local.web-layout-20260907T0320`; operator and provider settings were
not changed. Public file, operator file and backup remain ignored/0600. The
real guard and all 14 dedicated guard tests passed; no values were displayed.
Evidence and exact limitations are appended to `RTF-Ingest-Reader-Verification.md`.
Claim revision 28 records the added local paths with no collision. The web
build/bundle gate needs a fresh run; passing Edge evidence remains attributable
to unchanged app/function source. Browser activation, formatting-preserving
editing/export and all hosted gates remain unverified.

**13:35 AEST — fresh complete web verification passed after local layout repair.**
`job-mtqotlvd-f7d48756` exited 0 in approximately 37 seconds, evidence
`master-web-gate-20260907033510725`. The complete web gate passed (165 deployment,
223 root, 297 shared, 896 web; lint/types; real guard; 29-page production build;
11/3/1 progressive bundles). Source/HEAD/dotenv and completion comparisons were
unchanged. Combined with the unchanged earlier 1,149 Edge tests, this closes the
local broad gate for the stored-v3 ingest reader. No CI or hosted result is
implied, and actual browser upload/edit/export remains unverified.

**Next bounded slice — retained RTF MIME alias, JavaScript repaired; SQL RED prepared.**
New real-serialization tests distinguish historical JSON empty MIME (stored
`rtf`) from current multipart empty `File.type` (wire and identity MIME
`application/octet-stream`). The RED run had 31 pass/2 fail: both JSON cases
returned `422 UPLOAD_FORMAT_MISMATCH`; both multipart controls already passed.
This corrects the earlier inference that the ordinary current browser transport
itself produces the alias. Producer regressions also failed for the intended
missing alias; a preceding test-only union-narrowing error is retained separately.

The existing shared v3 RTF metadata allowlist now admits the single normalized
literal `rtf`. Its required `.rtf` filename and actual bounded RTF parsing remain;
the old metadata adapter, v1/v2 readers, request IDs and stored metadata are
unchanged. Fresh adjacent tests pass **146/146** with type checking; three-file
lint, two-test-file format and diff checks pass. Evidence:
`rtf-alias-ingest-red{,-reason}.log`, `rtf-alias-producer-red.log`,
`rtf-alias-js-green.{log,json}`. Controlled RPC/classifier dependencies remain;
this is not authenticated browser or real Storage proof.

`upload_rtf_mime_alias.test.sql` adds positive owned fixtures, source/identity
preservation, same-checkpoint replay, NFKC metadata, v1/v2 exclusion and conflicting
RTF-MIME/Markdown-format rejection. No new migration has been written yet; the
accepted `20260907081500` migration remains unchanged. The new SQL assertions
are expected to expose its literal-alias rejection and format-policy mismatch
before a separate forward command repair. Default isolated preflight passed at
`db-20260907034820887-54496841`; full SQL RED execution is the next gate. Existing
SQL tests and their assertions remain untouched at this stage. Admission and the
separate successful-fallback settlement incompatibility remain unresolved.

Both independent source reviews cleared the narrow JS change. SQL review caught
one cascading RED-fixture issue: a wrongly accepted text record could affect the
next expected metadata failure. That case now uses a separately and positively
claimed eighth upload; assertions retain their exact expected errors. The only
additional generated-source change is a `deno.lock` specifier mapping
`jsr:@std/encoding@1` to the already locked 1.0.11, used to encode the synthetic
legacy JSON body. No package version or prior provider-related lock hunk changed.
Claim revision 29 records this lockfile ownership. The accepted v3 migration
still hashes to `effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727`.


## 2026-09-07 14:15 Melbourne — alias SQL RED verified; forward repair prepared

- Read `job-mtqpttwo-bb95e5b8` and saved `db-20260907040320724-c6bf7516`: expected 11/52 alias failures, all other 1850 SQL assertions PASS, 1902 total/42 files. Full web gate PASS, cleanup/resources/source/HEAD unchanged; completion-time source comparison PASS. Two reproduced defects: rejected valid bare alias and accepted alias-to-text downgrade with unwanted persistence.
- Added forward `20260907094500_upload_rtf_mime_alias.sql`: only two v3 MIME-list additions in the existing record command. Accepted 81500 SHA unchanged. No signature/grant/lease/replay or stored-row change. New alias regression retained; prior slot10 now parameterized unsupported alias, original source preserved as evidence. Updated both extraction/ingest deployment prerequisites; static deployment check PASS (26 functions).
- Independent read-only SQL review PASS. Same existing disposable probe/runner now has a separate exact 81500→94500 alias upgrade mode, old v3 pair guard unchanged. Pending alias is prepared before upgrade and must recover with the same retained identity; seven historical controls include v3 ready and terminal-failed output. The failure receipt remains a failure, never silently reopened. Storage wire MIME is separate from literal stored file_type.
- 36 plan/guard unit checks PASS. No-service preflight `db-20260907041429037-9d23fced` PASS with all current 73 migrations/42 tests. Fresh/upgrade SQL and actual local HTTP acceptance not yet run against the new migration. See `docs/evidence/web-operational-readiness/RTF-Mime-Alias-Verification.md` for exact hashes, proof boundaries and remaining browser/edit/export/hosted blockers.


## 2026-09-07 14:19 Melbourne — alias forward fresh/upgrade acceptance PASS

`job-mtqqbg1f-f83755d6` / `db-20260907041702561-a09bb8b2` completed exit 0 in about 137 seconds. All current 73 migrations and 1902 SQL assertions/42 files passed fresh, then the exact81500→94500 upgrade passed the same1902 assertions. There were183 real local Auth/PostgREST/Storage checks; two authenticated owners;12 original objects byte-identical; seven historical full rows and the pending alias row unchanged by migration. The same pending alias first reproduced predecessor checkpoint400/P0001/UPLOAD_SOURCE_MANIFEST_INVALID and then recovered through checkpoint/read/replay/token handoff/settlement with no reupload or new identity. A separate terminal failure retained its exact failed outcome/422/response. Independent database source and ready-state reads passed.

Complete pnpm verify:web PASS, including real dotenv guard and production build/progressive gate. Exact cleanup and Docker resources matched. Tracked/source/HEAD stayed unchanged; completion-time source comparison PASS (813 files under the DB runner exclusions). Report updated in RTF-Mime-Alias-Verification.md. These results are local controlled extraction/classification fixtures, not Edge/browser/provider/editing/export/hosted proof. Full Edge regression for the final alias overlay remains next; successful fallback settlement compatibility and Master/source-preserving editing remain subsequent integration blockers. No protected mutation occurred.


## 2026-09-07 14:22 Melbourne — alias full Edge gate PASS; settlement regression next

`job-mtqqht30-d0515f7f` / `upload-source-edge-gate-20260907042159412`: 1156 Edge tests PASS, zero failures; all26 active entry points type checked;28 affected upload files linted. Source/HEAD/dotenv unchanged during the44-second run; completion comparison PASS over885 source files using this runner’s exclusions. Combined with the unchanged alias fresh/upgrade1902 SQL checks and183 local HTTP acceptance plus full web build, this completes the bounded alias repair’s local gates. No browser activation, provider call, CI or hosted verification, formatting-preserving editing or export claim.

Continuing the already recorded successful-fallback settlement incompatibility through the existing authoritative legacy model result and usage ledgers. Preparing realistic SQL regression before changing the settlement command; no provider configuration or access changes.


## 2026-09-07T15:25:33.962146+10:00 — successful upload fallback settlement regression prepared

Added only supabase/tests/upload_fallback_settlement.test.sql; settlement implementation unchanged. Source trace and read-only reviews confirm existing handler/shared/Master projection and the v2/v3 closed-key mismatch. Fourteen positive upload/checkpoint/stage fixtures and thirteen real-command provider accounting scenarios exercise successful fallback, false attribution, missing disclosure, saved-but-failed validation, exact replay and usage. Hashes pinned in upload-fallback-settlement-red-inputs.json; no-service preflight passed before the final fixture addition. Database RED is the next gate. See Upload-Fallback-Settlement-Verification.md for precise boundary and proof limits.


## 2026-09-07T16:38:33.471983+10:00 — fallback RED interrupted by local sleep; exact resources recovered

job-mtqss4j6-568d752c / db-20260907052600065-53ebd6d8 timed out during disposable reset and cleanup. No SQL tests or web gate reached, so no regression RED claim. Power log records repeated sleep periods across both deadlines. Completion read-only inventory matches pre-run Docker resources, all owned resources absent, reserved ports free, source/HEAD unchanged. Verified per-utility caffeinate -i semantics and exit propagation; retrying the unchanged source/runner with only the scoped idle-sleep assertion. Final SQL source review predicts126 assertions/31 intended failures, unexecuted. No settlement migration or hosted mutation written.


## 2026-09-07T18:06:19.490418+10:00 — fallback SQL defect reproduced; forward implementation ready for GREEN

job-mtqy87ov-15881768 / db-20260907075828703-d9b5dfd9 ran all2028 SQL assertions/43files: intended31/126 new failures, all1902 prior assertions passed;77 setup/provenance assertions passed. Exact valid-fallback diagnostics SOURCE_PRIVACY_INVALID; omission incorrectly allowed completion. FullwebPASS, cleanup/resources/source/HEAD unchanged; completion comparisonPASS. Added only forward20260907102000 settlement definition plus ingest deployment prerequisite. It validates paired existing policy projections against owned result/usage, hash/identity/provider/success/attempt/model; preserves replay/privacy/checkpoints/history. Independent source reviewPASS, migration/deployment checksPASS, no-service preflightPASS. FreshGREEN and subsequent upgrade/client/browser/hosted gates remain pending; no protected action. See Upload-Fallback-Settlement-Verification.md and forward-input hashes.


### 7 September 2026, 18:08 Melbourne — fallback settlement fresh GREEN

**Verified locally:** `job-mtqyiy8j-aaa9e385` / `db-20260907080649669-d1d1e72a` exited0 in about101 seconds: 74 migrations, all2028 SQL assertions in43 files (all126 new fallback regressions) and full `pnpm verify:web` passed. Positive v2/v3 diagnostics are `settled`. Independent cleanup/resources and source/HEAD comparisons matched;815 source files unchanged. Same branch/HEAD plus attributed overlay; no CI or hosted mutation. Next: adjacent actual DOCX/RTF handler projection/replay and an exact94500→102000 upgrade using two pending requests and synthetic provider-accounting receipts. Original retention is not formatting-preserving editing/export completion.


### 7 September 2026, 18:26 Melbourne — fallback adjacent tests and exact upgrade prepared

**Verified locally:**85 source-checkpoint handler tests (12 new), both files' Deno type/lint checks and51 isolated-upgrade guard tests pass. The0/1/2 lost-settlement-ACK cases preserve one extraction/classification and the same receipt; malformed provenance blocks import. Initial81/2 result reflected a corrected test expectation about the existing two-attempt settlement adapter, not a production repair. No production JS changed in this slice. Read-only review improvements were applied; adjacent input hashes unchanged.

**Implemented:** Separate exact94500→102000 mode in existing isolated runner/probe, retaining older upgrade guards and all current SQL. Preflight `db-20260907082321900-7e9ac721` passed. Two pending source uploads will use real local Auth/Storage/provider-accounting RPCs with synthetic receipts; full history/source/provenance/usage preservation and exact settlement recovery remain to be executed.13 originals are expected. See `Upload-Fallback-Settlement-Verification.md` for exact scope. Full Edge rerun, browser and production acceptance remain separate gates; source-format editing/export remains unfinished.


### 7 September 2026, 18:28 Melbourne — exact fallback upgrade GREEN

**Verified locally / Persistence proven locally:** `job-mtqz6vln-a0483fa1` / `db-20260907082525992-5e65e36e` exited0 in143 seconds. All74 migrations;2028 SQL assertions in43 files fresh and upgraded; full `pnpm verify:web` passed.189 real local Auth/PostgREST/Storage/provider-accounting HTTP checks preserved13 originals and seven historical full rows. The same pending v2 DOCX/v3 RTF requests passed predecessor rejection→forward migration→frozen settlement→discarded-ACK receipt recovery→idempotent replay, with source manifests, exact originals and provider result/usage records unchanged. Each used the same two synthetic attempts and26 total recorded tokens; no model call. Cleanup/resources and all815 source files/HEAD matched at completion. Broad Edge rerun is next; browser/hosted/edit/export proof remains unverified. Detailed per-format IDs and artifacts are in `Upload-Fallback-Settlement-Verification.md`.


### 7 September 2026, 18:31 Melbourne — fallback broad Edge GREEN and source import boundary

**Verified locally:** `job-mtqzd3yi-847a1fad` / `upload-source-edge-gate-20260907083016772`:1168 Edge tests passed,26 entry points plus source helper types passed,28 upload-file lint checks passed. Completion comparison matches887 source files, HEAD and dotenv metadata/hashes. Fallback settlement local slice is closed; browser, production and formatting edit/export are not established.

**Next bounded slice, within revision29 claim:** Retained PDF/DOCX/RTF originals need an owner-scoped list/detail/download on Master Workspace. Existing `/workspace` only renders the importer; it converts extracted preview text into generic editable HTML and has no source capability. New source-only files must remain uploads, with no manufactured editable document. Derive bounded public source access from the existing uploads/checkpoint/original identity; keep manifests private, original links owner-scoped and late callbacks fenced. Reopen by `/workspace?upload=<uuid>` and recover retention after classifier/acknowledgement failures using the existing prepared upload identity. Do not infer retention merely from an upload UUID.

The first necessary database repair is the existing `commit_document_import` boundary: a NEW v3 import must require settled complete extraction and reject source-only formats or truncated previews before touching outcome/document/sections. Preserve committed replay before that new check. A matching narrow table guard must reject only new non-null document assignment/reassignment or transition into committed; outcome-only attachments remain supported and FK cleanup to null remains permitted. No new persistence table/source binding column is needed for retention-only files. Existing v1/v2 imports and historical text/documents remain compatible. New v3/RTF browser admission waits for source consumers. Raw TXT/MD editing and actual DOCX/PDF format-preserving editing/export remain subsequent required work; preview normalization/Tiptap HTML is not a lossless representation.

Read-only SQL review confirmed only `commit_document_import` currently sets uploads.document_id/statuscommitted; Home/role source commands set outcome_id only. Browser/service upload DML is already revoked. Existing upload/document links are nullable and non-unique, so they must not be presented as a sufficient future editable source binding. Parent remains sole writer/process owner. No hosted changes are included.


### 7 September 2026 — source import boundary regression prepared

Added `upload_source_import_boundary.test.sql` with positive owned fixtures, complete v3 text/v2 DOCX controls, source-only and truncated import rejections, existing readiness rejection, full-row preservation, outcome-only attachment, independent table transitions, FK cleanup and other-owner denial. Expected71 assertions/11 intended failures on unchanged implementation; not yet executed. The existing unfinished-ingest guard already works and retains `UPLOAD_IMPORT_REQUIRES_COMPLETED_INGEST`. Plan refined to extend that same trigger and relevant column events rather than add a parallel guard. Final74-migration/44-test inputs are hashed. No production migration or browser activation yet; detailed trace and evidence limits in `Upload-Source-Import-Boundary-Verification.md`.


### 7 September 2026, 19:03 Melbourne — source import RED reproduced; forward repair implemented

**Verified locally (RED):** `job-mtr0gb0p-0552c608` / `db-20260907090045513-4d63c618`:2099 assertions/44 files; new71 has expected11 failures/60 passes;2028 previous assertions and full web gate pass. All setup, readiness, ownership, outcome-only and FK controls passed. Cleanup/resources and all816 source files/HEAD unchanged.

**Implemented:** `20260907112000_upload_source_import_boundary.sql` adds a private v3 eligibility helper, used before new import child writes and through the existing terminal-import trigger for status/document-link transitions based on OLD checkpoint fields. Committed replay and all prior readiness logic remain ordered/preserved; no public RPC/schema data/activation changes. Web migration requirement updated.75 migration and26 function deployment checks pass. Fresh GREEN and exact historical upgrade remain required before local closure. Source access/read/download UI and actual protected editing/export remain unfinished. See `Upload-Source-Import-Boundary-Verification.md`.


### 7 September 2026, 19:10 Melbourne — source import fresh GREEN; exact upgrade prepared

**Verified locally:** `job-mtr0qly3-19d07a29` / `db-20260907090846220-903545ee`:75 migrations,2099 SQL assertions/44 files including all71 source-import checks, plus complete web gate passed. Cleanup/resources, HEAD and all817 source files matched. No new Edge implementation changed.

**Prepared:** Existing isolated runner/probe now supports separate fixed102000→112000 source-import upgrade, preserving every older guard.66 guard tests pass; preflight `db-20260907091801137-78701650` passed before final review-only fixture corrections, and guards passed afterward. History fixtures now use real SectionVersion fields and exact four-table preservation/count assertions. Planned16 originals, seven historical/nine current uploads, two actual pre-upgrade committed imports (v3 protected and null-version), five denied/three supported post-upgrade imports, outcome attachment, direct trigger/owner checks and exact FK cleanup. Final independent source review passed. Full upgrade execution, Master retained-original UI and protected-format editing/export remain separate unverified gates. See `Upload-Source-Import-Boundary-Verification.md`.


### 2026-09-07 19:29 Melbourne — source import exact upgrade verified

**Verified locally; Persistence proven (synthetic local scope).** Job `job-mtr1dk7g-175cddf4` / `db-20260907092637052-f0f49175` passed all 75 fresh migrations, all 2099 SQL assertions in 44 files on fresh and exact 102000→112000 upgraded schema, and full `pnpm verify:web`. There were 251 HTTP checks, 16 byte-checked originals, seven historical/nine current uploads and two owners. Immutable historical null/v3 import replay, unsafe import rejection, supported reviewed-wording persistence, source-only context and exact fixture deletion passed. Completion source 817/HEAD/tracked diff/resource comparisons match. See `Upload-Source-Import-Boundary-Verification.md`. **Unverified:** browser integration and format-preserving editing/export, CI, hosted deployment. Continuing the already-scoped owner read/list/detail/download integration using existing uploads; no new provider or persistence authority.


### 2026-09-07 20:08 Melbourne — original browsing implemented; broad gate next

**Implemented; Verified locally (focused scope).** New owner list/detail RPC migration124000, closed shared read contract, bounded exact original download, Master deep-link source view and prepared-ID recovery are implemented. Binary/truncated previews no longer create generic editor sections in Master. New owner transport late-body cleanup regression failed for the correct reason before its fix. Focused results: 78 web/API/transport/import tests, 51 shared tests, web/shared types and focused lint passed. Static76 migrations/26function contract checks and independent SQL/browser source reviews pass. Input hashes and detailed scope in `Workspace-Original-Browsing-Verification.md` and `workspace-original-browsing-inputs.json`. Fresh DB/fullweb, real HTTP/browser persistence/download and upgrade acceptance pending; no v3/RTF activation, preserving editor/export, CI or production claim.


### 2026-09-07 20:09 Melbourne — original browsing fresh gate passes

**Verified locally.** `job-mtr2ub1m-8c54687c` / `db-20260907100737954-50e0967b`: 76 fresh migrations, 2167 assertions in 45 SQL files, full `pnpm verify:web` including 321 shared/937 web tests, build and bundle checks pass. Source 823, HEAD, tracked diff and resources match at completion. New read projection has 68 passing SQL assertions. Browser/HTTP original retrieval and migration upgrade remain separate next gates; no production, activation or preserving-editor claim.

### 2026-09-07 20:28 Melbourne — browser acceptance prerequisite prepared

**Prepared; Unverified (browser).** Refreshed the same branch/HEAD, empty index,
single worktree, locked runtimes and collision-free board. Claim revision30 adds
the browser test/configuration/CI paths. WP7 authorizes a pinned Playwright test
dependency and executable suite; no package currently resolves. The bounded
installer records source hashes and allows only package/lockfile changes, with
Chromium in the ignored repository-local cache. Installation has not yet passed.
The independent read-only plans confirm an exact112000→124000 probe through the
existing isolated runner and a new web build bound to disposable local Auth and
Storage. Historical protected v3 imports must not be recreated after112000.
See `Workspace-Browser-Acceptance-Plan.md`. Actual browser upload, source browsing,
original download, preserving edits/export, CI and hosted acceptance remain open.

### 2026-09-07 21:03 Melbourne — retained-original browser harness prepared

**Implemented; Verified locally (tooling/guards only).** Tooling job
`job-mtr3l4hy-4bcc6930` passed: exact Playwright1.63.0 family/Chromium installed,
frozen install passed, only intended package/lock changes, independent delta
review PASS. New seeded two-owner Playwright suite, private bounded fixture
admission and finite local build/server wrapper integrate with the existing
isolated runner's exact112000→124000 workspace-read upgrade. Full returned-state
checks include one completed v3 source and nine expired checkpoints.77 upgrade
guards,12 hostile/positive fixture guards, strict browser types and isolated
preflight `db-20260907105959393-85377ba4` pass. Runtime browser execution, upgrade
SQL execution and CI invocation are still **Unverified**. Actual file-picker
upload, preserving editing/export, wider WP scope and hosted acceptance remain
required; this is a retained-original acceptance slice. See
`Workspace-Browser-Acceptance-Plan.md` for source/provenance and evidence limits.

Final current-input preflight `db-20260907110417786-49449f7c` and independent
browser/process/fixture source review PASS. Source identities are saved in
`workspace-browser-inputs.json`; current execution remains local-only and
retained-original scope. Continuing to the real browser/upgrade gate under the
existing isolated runner, with no hosted mutation or provider dispatch.

### 2026-09-07 21:29 Melbourne — first browser run failed before discovery; corrected

**Verified locally:** job `job-mtr4w5rg-fdd72370` / `db-20260907110503663-7ab776c9`
passed fresh2167 SQL assertions/45 files, exact112000→124000 application and124
real Auth/PostgREST/Storage checks for25 uploads/12 exact original byte downloads.
Historical domain rows were unchanged across migration and reads. Both the local
browser-target build and complete web gate passed;828 source hashes/HEAD/diff and
Docker resources matched. **Browser unverified:** no test executed because the
fixture loader rejected Playwright's expected output-directory deletion at
discovery. Upgraded full SQL rerun was also not reached. No production conclusion
follows from this partial run.

The intended lifecycle regression reproduced1 failure/12 passes before the fix;
15 tests now pass, including present output symlink/file rejection. Exact parent,
run manifest, owner, original path and hash checks remain required. Strict browser
types and focused lint pass. Cleanup handles an absent exact diagnostic child
without masking the primary failure. See `Workspace-Browser-Acceptance-Plan.md`.
Continuing the already-authorized local browser/upgrade rerun; no app source or
hosted configuration changed for this harness correction.


### 7 September 2026 — retained-original browser and exact upgrade GREEN

**Verified locally; Workflow exercised; Persistence proven (synthetic local scope).**
`job-mtr5tams-8df1f4cf` / `db-20260907113049621-2c43ef87` exited0 in approximately
201 seconds. All76 fresh migrations and2167 SQL assertions/45 files passed on
fresh and exact112000→124000 upgraded schema.124 real Auth/PostgREST/Storage
checks cover25 uploads,12 original objects and two authenticated owners.
Chromium desktop1440×1000 and narrow390×844 both passed (2 tests,35.2 seconds,
one worker,no retries or skips). Each viewport downloaded12 originals whose
bytes,length and SHA matched the source fixtures. Sign-in,pagination,selected
preview,reload,new-tab,missing original,historical workspace link and account
switch/anonymous isolation passed. Browser errors,warnings and external requests
were empty. Domain snapshots were unchanged across migration,HTTP and browser
reads. The local Next build/server completed and cleaned up; full `pnpm verify:web`
passed (321 shared,937 web tests,lint,types,production build,bundle checks).
All828 source hashes,HEAD,tracked diff and Docker resources matched. See that
run's `completion-comparison.json`, browser reports and downloaded originals.

**Implemented; Unverified (new layout correction).** Visual inspection of the
saved narrow screenshots found selected detail below the entire20-row list.
The existing detail now precedes the list in DOM; named CSS grid areas preserve
desktop columns and place detail above files at widths≤700px. The browser test
now requires the complete selected heading and Download original button in the
initial viewport. Focused component13 tests,ESLint,strict browser types and diff
checks pass. The updated browser/layout gate remains pending; the preceding
green run does not prove this subsequent source change.

**Unverified:** actual new file-picker upload/extraction/provider execution,
format-preserving PDF/DOCX/RTF editing or generated approved exports,CI invocation,
profile browser access and production. Downloaded artifacts here are retained
originals, not generated exports. No hosted mutation or provider call occurred.


Final narrow-layout source review PASS after synchronizing viewport checks with
all20 first-page rows and visible Load more, before any scrolling. Full ratio1
checks now cannot pass on the old loading-placeholder layout. Strict browser
types and focused lint pass (only existing root framework-detection notes).
Exact preflight `db-20260907124215959-f2d45907` passed; current13 inputs are hashed
in `workspace-browser-inputs.json`. Continuing the existing finite browser/upgrade
and full-web verification for this changed UI. Claim revision30 remains active
for unfinished uploads and wider readiness work, with no ownership collision.


### 8 September 2026 — narrow browser GREEN; adjacent test sequencing repair

**Verified locally; Workflow exercised; Persistence proven (synthetic local
scope).** `job-mtr8emkt-3f50a881` / `db-20260907124324131-54e91250` passed both
actual Chromium journeys (2 tests,46.85 seconds,zero skips/retries), including
fully visible selected heading/download after all20 file rows load. The saved
narrow screenshot was visually inspected: selected detail and download appear
above the file list. Each viewport downloaded12 byte/length/SHA-matching originals;
console errors,warnings and external requests were empty. All76 fresh migrations,
2167 SQL assertions/45 files on fresh and exact112000→124000 upgrade,124 real
HTTP checks,domain preservation,owned-server cleanup and private-fixture removal
passed. All828 source hashes,HEAD,tracked diff and Docker resources matched.
See `completion-comparison.json` for the separate passed/failed boundaries.

**Blocked at the broader web gate:** the overall run exited1 because
`FindRolesScreen.test.tsx` timed out awaiting the oversized-TXT alert (936 web
passes,1 failure;321 shared passed). Lint and types passed earlier in that gate;
the gate's later production build and bundle checks were not reached. The
separate production-mode local browser-target build had passed. These two build
contexts are not interchangeable.

**Implemented; Verified locally (test correction).** A controlled pending XLSX
response deterministically reproduced the original test's scheduling bug: it
sent the second change while the input was disabled and upload handler busy,
so the second selection was ignored before metadata validation. RED evidence:
`find-roles-upload-sequencing-red.log` (1 intended failure,13 cases filtered by
the focused test name). The correction waits for the exact accepted XLSX
filename/summary and enabled input, then verifies the oversized-TXT error,
exactly one total ingestion call and preserved accepted resume. It keeps a
deferred first response and positively proves the pending disabled state.
No timeout, production handler or expected error was changed. All14 tests pass
in `find-roles-upload-sequencing-green.log`; focused ESLint,web TypeScript,diff
check and independent source review pass. The earlier unmodified focused run
also passed, consistent with the observed scheduling dependence.

The remaining verification for this correction is the web-only broad gate;
unchanged database/browser suites need no repeat. Actual new file-picker
upload/extraction,v3/RTF admission,protected editing/export,CI,Profile browser
access and production remain separate open work. This evidence proves original
retrieval and the responsive source view,not the requested editing flagship.


### 8 September 2026 — web gate restored; source admission implemented locally

**Verified locally:** `job-mtrcuict-e6a10eb9` / `master-web-gate-20260907144743594`
passed full `pnpm verify:web` (321 shared,937 web,lint,types,production build,
progressive bundles). All900 source hashes,HEAD,tracked diff and web dotenv
snapshots matched. This closes the adjacent sequential-selection test correction
and preceding original-browser layout slice. Actual new file-picker ingestion
and preserving edits/export were not exercised by that web gate.

**Implemented; Verified locally (focused scope):** new server claims explicitly
request extraction.3 and require that exact new accepted receipt; existing
NULL/v1/v2 readers and literal terminal replay remain authoritative. The shared
client validates the existing resource-policy/format discriminator and the
closed v3 public response, preserving exact nonblank UTF-16-bounded preview
text. Master explicitly opts into a new RTF1MiB metadata policy and routes RTF
to retained-original readback, never generic editor sections. Original v1 public
metadata exports and other screens' file admission stay unchanged. No identity
hash,request body,SQL default,provider policy or original file bytes are changed.
The ingest release prerequisite now includes112000's source-import guard.

Regressions reproduced missing RTF admission,cutoff-whitespace response rejection
and missing explicit server version before repair. Current focused results:
153 shared (58 new admission cases),128 ingest Edge,55 Master/FindRole/outcome
web tests and56 Profile/Home/attachment tests PASS;shared/web types,ingest entry
types,focused lint and26-function deployment contract PASS. Source review PASS.
Eight appended SQL assertions are prepared for stored NULL/v1/v2 resume and
exact v3 terminal replay; historical NULL is inserted as a distinct fixture,
with valid expired heartbeat/lease timestamps. They are not yet executed.
Exact disposable preflight `db-20260907150745623-bac3827f` passed. See
`Upload-Source-Admission-Verification.md` and `upload-source-admission-inputs.json`.

**Unverified:** this new overlay's complete fresh SQL/web/Edge gate,actual new
browser picker/extraction/classification/persistence,CI,hosted activation and
format-preserving editing/export. Local admission implementation supersedes the
earlier statement that v3/RTF code activation had not begun; no hosted activation
has occurred. Claim revision30 retains the existing bounded write scope.

### 2026-09-08 — source admission broad local completion

**Verified locally:** job `job-mtrdpfvn-66ddf71f` exit0,147s. Detailed saved results
inspected:76 fresh migrations;2175 SQL/45 files;full `pnpm verify:web` with379
shared/19 files and941 web/113 files,lint/types/build/progressive bundles;26 Edge
entries plus2 helpers typecheck,28-file lint,and1171 Edge tests/0 failures.
Evidence `db-20260907151146706-1878a43f/completion-comparison.json` and
`upload-source-edge-gate-20260907151329597/summary.json`.829 source hashes,HEAD,
tracked diff and Docker resources unchanged;Edge source/HEAD/dotenv unchanged.
The8 new SQL resume/replay assertions now pass. This supersedes their pending
status above;branch/HEAD remain `Thought-Enhanced-Document`/`e1d514d` plus overlay.

**Next:** a separate actual new-upload browser mode through real Next and two
production function entrypoints,real disposable Auth/RPC/Storage,with controlled
synthetic Responses transport. Existing read-browser unchanged-domain proof stays
separate. **Unverified:** that new picker flow,live models,CI,hosted activation,
format-preserving editing and approved generated exports.

### 2026-09-08 — real new-upload browser harness prepared

**Implemented:** separate exclusive new-upload acceptance mode,actual Next
gateway and production ingest/extract entrypoints with controlled Responses
transport;8 file variants per desktop/narrow project,real owner authentication,
original bytes,reload,replay,lost acknowledgement,Markdown commit/reopen and
independent SQL/Storage/accounting proof. Existing read-browser mode unchanged.
**Verified locally:**14 transport and12 private-fixture guards,E2E types/root
ESLint,Deno types/lint,preflight `db-20260907153604528-36f4885b`.Source reviews
resolved concrete harness errors before runtime. See
`Upload-Browser-Acceptance-Preparation.md` and `upload-browser-inputs.json`.
**Unverified:** actual execution of new browser mode,remaining fault matrix,
XLSX browser picker,CI/hosted/live models,format-preserving editing/export.
No production behavior changed in this harness slice. Claim30 retained.

### 2026-09-08 — actual upload run exposes detached SDK RPC failures

**Workflow exercised (partial):** `job-mtrer7m2-12063d31` failed both browser
projects on saved Markdown reload.12 downloaded originals across PDF,DOCX,RTF,
UTF16LE/BE and UTF8 TXT were independently byte/hash verified;14 controlled
provider dispatches. CSV and final independent DB/accounting checks not reached.
The actual page showed unavailable,no snapshot RPC. Fresh SQL2175/45 and full
web379shared/941web+lint/types/build passed;833source hashes,HEAD,tracked diff,
Docker resources unchanged. Evidence `db-20260907154108941-cf51607a`.

**Implemented; Verified locally:** real SDK tests reproduced lost `this` at
server snapshot and deferred section RPCs;both now use direct methods. Server
RED2fail/4pass,sectionRED1fail/6pass;focused GREEN32/5files,webtypes/lint PASS.
Foreign-owner,revision,digest and fail-closed checks retained. Independent source
review confirms cause. See `Workspace-SDK-Receiver-Repair.md`.

**Harness correction:** original browser failure now stays primary;completed
exit1 is separated from cleanup failure. Four disposition and14transport tests
PASS. Partial reports/commit receipts and bounded owner-only DB diagnostics
survive later failures. Old misleading cleanup artifact retained and explained
in its completion comparison. **Unverified:** fixed full browser/broad gates,
CI/hosted/profile/live models,preserving editing and generated exports.

Receiver repair review PASS;new upload preflight
`db-20260907155802682-d32f3ba6` PASS. Final report/receipt handling typecheck and
ESLint PASS. The full owned browser/DB/web run remains the next gate;the prior
failed workflow has not been described as fixed in production.

### 2026-09-08 — actual new-upload browser and workspace reload pass

**Implemented; Verified locally; Workflow exercised; Persistence proven (local):**
`job-mtrfetyh-3791d4c6` exit0,199s. Inspected detailed logs,independent proofs,
all16 actual downloaded original byte/hash comparisons and desktop/narrow
screenshots. Evidence `db-20260907155930992-74ef6363/completion-comparison.json`.
This closes the pending receiver repair and new-upload browser slice locally.

Desktop1440×1000 and narrow390×844:2PASS,one worker,no retries/skips. Eight file
variants each:PDF,DOCX,AppKit RTF,UTF16LE/BE/UTF8 TXT,MD,CSV.16 uploads,16 controlled
Responses dispatches,16 immutable originals. Real Next gateway and production
ingest/extract entrypoints use real disposable Auth/RPC/Storage. Exact upload
replay,lost PDF acknowledgement recovery,Markdown commit/reload/both section
reads and repeat-import destination pass. Both corrected SDK calls now dispatch
their real RPCs successfully. Independent SQL/Storage/accounting checks bind all
receipts,source digests,owners,provider attempts/usage/capacity and exact imported
documents/sections. Changed-owner denial passes; no browser errors or external
network requests recorded.

Fresh76 migrations/2175 SQL across45files and complete `pnpm verify:web` pass:
379shared/944web tests,lint/types/build/progressive bundles.833 source hashes,
HEAD,tracked diff and Docker resources unchanged;execution and cleanup both
pass,private credentials removed. Branch/HEAD remain Thought-Enhanced-Document /
e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b plus the fingerprinted overlay.

**Unverified:** Profile browser access,XLSX new chooser,complete failure matrix,
CI,live provider/model quality/cost/latency,hosted deployment,format-preserving
editing and approved generated exports. Original byte preservation does not
establish formatting-preserving editing. Full app/release acceptance remains open.

### 2026-09-08 — Profile refresh failures reproduced and repaired locally

**Implemented; Verified locally (focused):** Profile resume refresh now preserves
unsaved personal edits and accepted save baseline; failed reads remain visible
and disable stale resource actions. Upload/restore distinguishes its acknowledged
mutation from failed follow-up refresh;retry reads only. Initial error/retry
still hydrates details. No persistence/schema/provider change.

RED6fail/7pass (lost values or missing alert),then39PASS/5adjacentfiles including
14Profile tests;web/E2Etypes,focused lint and syntax checks pass. Source review
PASS. Details `Profile-Browser-Recovery-Verification.md`;input hashes
`profile-browser-recovery-inputs.json`. Existing claim30 retained.

The actual upload browser mode now also prepares Profile navigation,initial
read503/retry,real save/reload/independent-tab,account and anonymous isolation,
plus independent owner SQL/PostgREST and protected-field preservation proofs.
Preflight `db-20260907162011623-aa5fdafb` PASS;final owner-field assertion refinement
will be included in the full-run fingerprint. **Unverified:** actual new Profile
browser proof,full web gate on this overlay,CI/hosted,resume lifecycle browser,
format-preserving editing/export and wider app acceptance.

Final Profile source/SQL/auth reviews PASS;distinct owner-field checks included.
E2Etypes/lint,syntax,diff and final preflight
`db-20260907162235853-e9784c5c` PASS. Full owned browser/DB/web execution is next;
no pending runtime gate has been described as passed.

### 2026-09-08 — Profile browser fault fixture corrected after full web PASS

`job-mtrg9aex-2f2019d1` failed only its browser stage:both Profile pages loaded
successfully when a one-shot503 was expected to show failure.16 upload cases and
original downloads passed before that assertion. All16 artifacts byte/hash
compared;both Profile screenshots visually inspected. Bounded failure SQL reads
16 uploads and2 exact committed Markdown documents with2 sections. Full final
accounting/Profile proof was not reached. Detailed evidence
`db-20260907162311989-6f30460d/completion-comparison.json`.

**Verified locally:** Profile production fixes pass fresh76 migrations/2175SQL,
full web379shared/951web,lint/types/build/bundles.833source hashes,HEAD,tracked
diff and Docker resources unchanged;cleanupPASS,private fixture credentials
removed. No new production defect is inferred from this harness failure.

Installed SDK behavior reproduced:one503→automatic retry200;held503→error after
4 attempts;manual subsequent read succeeds afterrelease.2 actual-SDK controlled
testsPASS. Corrected browser fixture holds/records the bounded failure and
removes it only before explicit Try again;Profile-scoped alert avoids Next's
route announcer. Owner form comparisons now use the actual owned read projection
and still reject prior unique values. E2Etypes/lint/syntax/diff pass;no production
retry policy changed. Full corrected browser/independent Profile proof remains
**Unverified**,as doCI/hosted,resume lifecycle,preserving edits and approvedexports.

Corrected-harness independent source review PASS;preflight
`db-20260907172528555-382f4051` PASS,including2 actual-SDK retry guards.

### 2026-09-08 — Master upload and Profile browser/persistence PASS

**Implemented; Verified locally; Workflow exercised; Persistence proven (local):**
`job-mtriiezl-ea7baaed` exit0,211s. Detailed saved results,16 downloaded originals
independently byte/hash compared,and4 desktop/narrow screenshots inspected.
Evidence `db-20260907172617062-91024083/completion-comparison.json`.

Desktop/narrow2PASS,worker1,no retries/skips. Profile real navigation,4 bounded
failed-read attempts,visible error/manual retry,owner save204,reload,new tab,
changed-owner distinct fields and anonymous redirect allpass. Independent SQL
and fresh owner Data API reads prove both exact saved profiles,unchanged
protected columns and cross-owner denial. Empty resume slots are explicit;
populated resume lifecycle browser is not implied.

All16 uploads/originals and16 controlled provider dispatches pass,including
replay,lost-ack recovery,Markdown saved documents and full independent original,
source,accounting/capacity,ordered-section and owner proofs. Fresh76 migrations,
2175SQL/45files;complete web379shared/951web pluslint/types/build/bundlesPASS.
833 source hashes,HEAD,tracked diff and Docker resources unchanged;execution and
cleanupPASS,private fixture credentials removed. Branch/HEAD remain
Thought-Enhanced-Document/e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b plus overlay.

The pending local basic Profile statements above are superseded. **Unverified:**
CI,hosted/production,live models,Profile resume lifecycle,XLSX new chooser/full
fault matrix,format-preserving PDF/Word edits and approved generated exports,
and remaining full-app WP0–WP10 acceptance. Original preservation is proven;
format-preserving editing remains required work.


## 8 September 2026 — unactivated whole-DOCX candidate compiler

The next source-preservation slice now rebuilds a complete DOCX candidate from
the exact original archive and bounded Word text-node patches, using the
existing Office reader and lexical patcher. All old source-only assessments
and import/edit/export restrictions remain. No SQL or runtime activation was
added. The initial missing-compiler regression failed for its intended reason;
149 adjacent tests plus 12 archive cases now pass, with four-file lint and
diff/syntax checks. Three synthetic artifact pairs independently pass Python
ZIP/XML inspection, including retained original bytes, unchanged sibling parts
and metadata, and only the requested XML text replacement. Independent code
review found no blocking compiler issue. See
`docs/evidence/web-operational-readiness/DOCX-Candidate-Compiler-Verification.md`.
LibreOffice rendering/visual inspection and the new combined web/Edge run are
pending. This does not complete or activate formatting-preserving editing.


### DOCX compiler completion verified — 8 September 2026, 06:38 AEST

The completed artifact/full gate job exited0 in82.209s. Full web gate passes
(165deployment contracts,223root,379shared,951web,lint/types/build/bundles);
Edge1185tests+12steps pass,26entrypoints+2helpers typecheck,28files lint.
Three actual DOCX original/candidate pairs independently pass ZIP/XML checks
and open/render with LibreOffice26.2.5.2. All six rendered page images were
visually inspected; two distinct single-heading Arial/left and Times New
Roman/centred configurations preserve fonts, margins, alignment and one-page
structure. Only the requested word changes. 905source hashes,9accepted inputs
and byte-identical raw copies,6DOCX inputs,HEAD and tracked diff are unchanged.
Exact evidence: `docs/evidence/web-operational-readiness/docx-candidate-20260908/verification-20260907203716713/completion-comparison.json`.
This closes the unactivated source-compiler slice only. Source binding,
revision-aware in-app editing/approval/export and representative complex
layout/overflow assessment remain required; PDF/RTF editing remains open.
No CI, hosted mutation, product export receipt or source-bound persistence was
proven by this run.


### Exact Word source-unit mapping — local slice prepared 8 September 2026

Added a dormant literal-text unit projection in the existing Word traversal,
with exact direct-body paragraph membership and unchanged v1 source manifests.
The reverse projection requires the complete current roster and emits all
current changes against the retained original. New XML and complete-DOCX
regressions prove editB retains editA and untouchedC; partial or stale rosters
reject. No SQL/UI/approval/export activation was added.159adjacent tests plus
12archive steps pass, as do focused lint/frozen types. Exact limits and
independent patch-budget failures are tested. All six regenerated previous
DOCX files match the bytes already independently opened/rendered/visually
inspected. Independent code review found no concrete blocker. See
`docs/evidence/web-operational-readiness/Word-Source-Unit-Mapping-Verification.md`.
Fresh full web/Edge verification is pending. Next authorised local work is the
source binding and versioned save/guard contract, retaining approval/export
blockers until their exact-revision preservation assessment is implemented.


### Word source-unit full gate verified — 8 September 2026, 07:06 AEST

Job `job-mtrqb96c-fedaf569` exited0 in82.158s. Full web gate165deployment/223root/
379shared/951web tests,lint/types/build/bundles passes. Edge1195tests+12steps,
26entrypoints+2helpers typecheck and28-filelint pass.905source hashes,9accepted
input hashes/exact copies,6DOCX inputs,HEAD and tracked diff match. LibreOffice
opens/renders all six artifacts again; text/fonts/parsedpositions/PNGbytes match
previous inspected pages, and two distinct candidate layouts were reopened.
Only the HTML wrapper CreationDate differed in an initial comparison; the
metadata difference and subsequent parsed-position/preview proof are recorded.
Exact result: `docs/evidence/web-operational-readiness/docx-candidate-20260908/verification-20260907210439836/completion-comparison.json`.
This verifies the dormant source-unit mapping slice locally. Source-bound
persistence, in-app edit/approve/export, CI and hosted activation remain open.


### 8 September 2026 — selected dotenv reconfigured; current production mismatch confirmed

Owner selected the exact `apps/web/.env.local` and explicitly requested
reconfiguration. The current combined file failed the real security guard.
Local values are now separated into the existing web/backend/operator files;
Next-resolved source values take precedence, exact0600 backups preserve all
three originals, existing provider policies remain unchanged. Real guard,
14guard regressions and actual Next loader PASS. Full web gate and separate
real-dotenv production build are prepared; completion is pending.

Fresh read-only production evidence: Netlify deploy6a9fc526610f2efb8c05454f
published18:22AEST still reports e1d514d, excluding the local repairs.
Supabase remains67migrations/25functions,ingestv328,with extract-upload absent.
Authenticated uploads SELECT is absent, confirming the Profile join dependency
is still denied. Exact narrow Profile grant and nine-migration upload release
dependencies are documented. No hosted mutation or repaired production journey
was performed. See `Local-Environment-and-Hosted-Incident-20260908.md` and
`hosted-incident-20260908.json`. The full app remains not release-accepted.


## 8 September 2026 — production Profile recovery and publication preparation

Implemented: the exact selected web dotenv was securely split into the existing
web/backend/operator destinations with private byte-exact backups. Job
`job-mtsf8idg-6c75df46` passed all13 steps, including the full web gate and a
separate build using that real configured file; recorded source/env hashes
remained unchanged. This is local build proof, not hosted routing configuration.

Production exercised: under the owner's explicit release instruction, original
migration `20260906010846_profile_resume_upload_reads` was applied alone to
`jjsykocqpjlekgsbylkd` at18:48:07 AEST. Hosted count68, precise six-column SELECT,
private columns denied, existing owner RLS unchanged. The signed-in Profile
rendered saved details and its resume resource. Upload, download and save were
not exercised in production. See `Profile-Permission-Release.md`.

Account/read proof: the current failing outcome belongs to a confirmed, unbanned
account with an existing profile and active Business entitlement (server cap1000).
The exact outcome snapshot RPC succeeded under authenticated owner identity.
The old published `e1d514d` loader still detaches the SDK receiver; local receiver
repairs and actual-SDK dispatch tests are ready for publication. The observed
outcome has no attached document; a successful intake snapshot does not prove
all generated documents. The requested unrestricted owner entitlement remains
unimplemented; changing the legacy profile plan would not implement it.

Click feedback: four focused new regressions initially failed for missing
immediate acknowledgement, late action cleanup and popup handling. Profile now
reserves Open's tab during the click, shows visible labelled busy state, admits
one signing request, cancels at component teardown/owner change, bounds waits
to30seconds, and permits safe retry without late download/navigation. Primary
Button press feedback now follows variant hover rules; loading labels are
visible. Seven new Profile regressions plus adjacent suites passed38tests.
An initial green run exposed an incorrect test query for the accessible name
of role=status; assertions now use its actual live-region text. Broader and
real-browser verification of this latest change remains pending.

Publication preparation: user explicitly requested all latest reviewed updates
committed and pushed to `Thought-Enhanced-Document`. Netlify native CLI confirms
that branch is linked and builds are active. Publishing must retain the current
production release until compatible backend/CI gates pass. Local Netlify token
selected by the owner is malformed for an HTTP Authorization header; existing
native CLI login remains usable. No credentials were printed or rotated.

A publication review found the new E2E entrypoint pinned to old HEAD `e1d514d`.
The runner now captures and retains the current exact revision, checks canonical
root/origin/branch, optionally requires an explicitly supplied expected SHA, and
checks HEAD/source hashes again after execution. Historical migration manifests
and disposable-stack identity/reset guards remain intact. Six source-identity
regressions pass. All required helper/fixture files must be published with it.

Blocked/unverified: no new commit/push/CI or Netlify publication is claimed yet;
production extraction/document-operation/brand-logo installation, eight remaining
migrations, reviewed OpenAI capacity/routing/evaluation configuration, source-
preserving edit/approval/export activation, and the full WP0–WP10 gates remain.

Owner clarification at19:26 AEST: leave the existing Business limit unchanged.
The earlier unrestricted-access request is superseded; no account entitlement
was changed. Publication checking found two whitespace-only blank lines in the
unpublished Ollama migration; they were removed with identical SQL tokens.
Historical evidence manifests retain their original hashes; the current SQL
will receive fresh verification. PDF/DOCX/RTF fixtures are now explicitly binary
in Git attributes, preserving exact bytes and avoiding newline conversion.


## 8 September 2026 — tEdit visible review and release integration

Implemented shared native modal review with keyboard access, current-viewport placement and awaited single actions. Checklist/section/artifact callers preserve exact source/revision and proposal recovery on failures, removed items and stale callbacks. 103 focused tests passed before additional keyboard checks; 15 shared dialog tests then passed, and 70 generation-adoption/SectionEditor tests passed after the broader gate exposed and reproduced a first-click save/recovery regression. Counts overlap. Actual Chromium desktop/narrow component workflows passed with source hashes unchanged; screenshots were opened and inspected. See `TEdit-Viewport-and-Revision-Verification.md`.

The full gate at 22:21 AEST passed deployment checks, lint/types and 1,200 Edge tests but stopped with 1,026 web tests passing and one first-click regression failing. That regression is now green in the focused suite; full web/build re-verification remains pending. A source-equality difference was confined to untracked generated browser evidence from a separate task. The runner now excludes only that exact untracked output directory while retaining tracked-file checks.

Fresh hosted read-only attestations at 22:22 AEST show all four OpenAI capacity and routing/evaluation routes unconfigured. There are still 25 hosted functions; extract-upload, document-operation and brand-logo are absent. No provider call, function deployment, account-limit change or web release occurred. The completed knowledge-confirmation task released its source boundary at 22:30 AEST. Integration review found two remaining cases involving attachment-as-selection authority and long-input continuation; focused correction is in progress. The ready-summary first-turn job-search guard is already fixed in its final source and needs regression proof, not redundant implementation.

Knowledge-confirmation integration correction is now locally verified: seven intended regression failures (four web, three Edge) became 46 passing Home/recommendation tests and seven passing clarification-context tests; 30 shared tests prove the released initial-search guard. Profile selection now excludes synthetic upload/assistant authority while preserving provider evidence; exact 20,000-character first messages and historical prefixed turns continue safely, and rejected new input remains editable without changing accepted answers. No provider, schema, allowance or activation changes were made. The final source pass identified no further concrete blocker within this bounded flow; full lint/types/build, broader gates, inspected browser evidence for the corrected source, CI and hosted acceptance remain unverified here. See `docs/evidence/web-operational-readiness/Knowledge-Confirmation-Integration.md` for attribution and limits. The earlier task's uninspected browser artifacts are not counted as final-source workflow proof.


### 8 September 2026, 22:52 AEST — integrated web gate passed

`master-web-gate-20260908125140321` passed the complete web release gate:165 deployment/223 root/382 shared/1,035 web tests, lint/types, production build and progressive bundles. Source, HEAD and selected dotenv snapshots remained identical. tEdit, corrected knowledge-confirmation flow and CI-portability changes are locally verified at this boundary. New Linux browser CI is implemented but has not run on a committed revision.37 identity/runtime tests and current Mac preflight passed.

F4 behavioral RED is now attributable:32 tests passed and17 intended admission failures were reproduced against the unchanged policy through an extracted production handler. Two earlier attempts failed only during fixture type checking and are not counted as defect reproductions. The new repair must bind server-canonical policy in the existing allowance reservation, preserve immutable completed replay and distinguish new interrupted requests from legacy ones. Additive local SQL/handler/test implementation and exact historical upgrade proof are next; no hosted schema change or function deployment occurred.

Current integrity scope correction: F3's unaudited final-rewrite ordering is repaired locally. Generated-v2 captured assessment and SQL guards are implemented, including the later authorised-provider compatibility override; stale statements that they are unwritten are superseded. New captured admissions still select pipeline1, and v2 owner-edit/approval/export eligibility plus server-assigned admission selection remain open. No v2 activation is authorised by passing helper tests. Existing empty benchmark examples do not establish reviewed output quality.

### 8 September 2026, 23:25 AEST — server policy binding and integrated acceptance

Implemented canonical catalogue admission in the existing generation handler and immutable execution-policy binding in the existing private allowance reservation. Unknown catalogue IDs, policy downgrades and invalid section destinations reject before dispatch. Explicit bespoke generation requires the existing server designer; completed historical receipts replay before new policy selection. Old worker entry points cannot reacquire a policy-bound unfinished request, and a live historical claim cannot silently acquire new policy. The original allowance core, cap, historical rows and settled responses are preserved. New migration: `20260908130000_legacy_generation_policy_binding.sql`; no hosted application of it occurred.

Attributable tests: the production-handler predecessor produced 17 intended failures with 32 controls passing; the SQL predecessor produced 43 failures and 33 passes in the new 76-assertion file, with all other SQL files passing. Those failure counts include contract-existence checks and are not separate production defects. Corrected implementation passed 84 focused tests plus 86 catalogue admission steps. The final ten-file lint pass passed using existing direct-JSR conventions and the same locked assertion library; no test assertions or validation checks were relaxed.

`db-20260908131248224-81ab4600` passed all 77 migrations and 2,251 assertions across 46 SQL files, actual desktop/narrow Chromium upload and Profile acceptance, and the full web gate (165 deployment, 223 root, 382 shared and 1,035 web tests; lint/types/build/progressive bundles). Sixteen originals across eight format/encoding variants were independently read from database/Storage and matched original byte length/SHA-256. Both synthetic Profile edits persisted with protected fields and other-owner denial checked. Screenshots were opened. This proves original retention, not formatting-preserving editing or generated export.

`db-20260908131630204-3d04929b` passed the exact predecessor-to-policy migration through local Auth/PostgREST, preserving old reservation/result/claim/usage rows and proving one policy-bound reservation/credit, exact replay, changed-identity rejection and private-RPC role denial. Both disposable runs cleaned up their own database and retained identical source/HEAD. `upload-source-edge-gate-20260908131901909` passed 1,261 tests plus 98 steps, all entry-point types and the existing source lint gate; source/HEAD/dotenv snapshots remained unchanged. Curated attribution: `Generation-Policy-Admission-20260908.md`.

Remaining catalogue blockers are now precisely inventoried in `Template-Contract-Coverage-20260908.md` and its JSON: 18 mismatches disconnect 163 authored fact definitions (80 export-required) from 48 current sections. Thirty-seven current catalogue UUIDs lack migration seeds; guest import and UUID-bearing workspace saves reject those valid templates. Source tracing establishes reachability; intended-failure runtime/SQL regressions are being prepared before repair. The historical compatibility proposal supplies exact metadata mappings, but does not authorise moving saved prose or rewriting immutable contracts. Runtime profile mapping must also enter the accepted policy digest.

Active utility endpoints retain admission/response/cancellation findings documented in `Utility-Release-Blocker-Refresh-20260908.md`; their absence from web callers does not prove hosted retirement. `Captured-Owner-Assertion-Repair-Contract.md` is a proposed contract only; no owner-edit approval repair or cohort activation is claimed. The publication manifest/index remain an older 214-file candidate and will be refreshed explicitly after these source slices stabilise. No new commit, push, CI verification, function deployment or web release has occurred. The Business limit remains unchanged. Production route/capacity/evaluation inputs and legacy endpoint reconciliation remain unresolved.


### 9 September 2026 AEST — catalogue and external-boundary slices

**Implemented / verified locally:** exact fact-profile projection for all 86 catalogue entries, preserving current keys, requested repair order, authored contracts and settled history; exact profile/risk/quality/example snapshot enters existing execution policy. Corrected RED isolates 18 mismatches; latest adjacent check passes 65 tests/172 steps. Details: `Generation-Policy-Admission-20260908.md`.

**Implemented / focused verification:** bespoke completed-design validation and provider/cancellation recovery; independent review's abort/uncertainty race now passes within 81 designer/allowance/router tests. Real transport seams are controlled synthetic fixtures, not production provider or SQL proof. Details: `Bespoke-Structure-Recovery-20260908.md`.

**Implemented / focused verification:** CKAN strict unknown-response validation and bounded external JSON reader. Initial 24 defects plus three resource-identity cases failed for the intended reason; current CKAN/reader/government-handler check passes 63 tests, seven-file adjacent lint passes. Other active utility function repairs remain open.

**Implemented, database GREEN pending:** new additive `20260908140000_complete_catalogue_persistence_seeds.sql`. Corrected disposable RED `db-20260908134623129-85ca604c` ran 47 SQL files/2365 assertions: only new catalogue test failed exactly 47/114 cases, all other files passed. Real complaint guest import and selection workspace save demonstrated missing-template persistence. Web gate and exact cleanup passed; source/HEAD equal. Parent independently compared every persisted field of all 37 new payload rows to the shared catalogue; hash `fca22da9bc8280d49ba38eb97eed8664b8385e59e19759e09d9b42b44de67350`. Existing 49 IDs are outside the write roster. Web deployment prerequisite added. No hosted seed mutation; explicit composed historical upgrade remains to prepare and execute.

**Unverified / remaining:** combined database/web/Edge gates on the new overlay, exact new upgrade, browser generated-document/approval/export journeys, post-design bespoke policy, captured owner-edited assessment, format-preserving editing, complete Supabase utility audit, live route/capacity/evaluation configuration and production acceptance. No commit/push/new deployment from these slices; the staged publication manifest remains stale and will be rebuilt explicitly after integration.


### 9 September 2026 — bespoke snapshot, dependency and utility boundary follow-up

The bespoke candidate-policy regression run passed54 tests and86 steps (`bespoke-profile-policy-green-20260908.log`), closing its six intended predecessor failures. The accepted ordered profile candidates and private supplemental profile are captured before provider work and enter only the existing bespoke execution-policy digest; catalogue policy hashes retain their prior shape. The prompt test import was aligned to the existing Node assertion convention after expanded lint found two unversioned/direct-import rules; its assertion bodies remain unchanged. The import-only recheck passed, and all six affected files passed lint (`bespoke-holidays-lint-green-20260908.log`). See the curated generation and bespoke reports for remaining arbitrary-designed-section semantics.

The refreshed production dependency audit JSON reports zero vulnerabilities across384 production dependencies (`production-dependency-audit-20260908T1420.json`). This is dependency advisory evidence, not an application exploit assessment or a complete security gate.

Holiday response validation passed63 tests including the shared bounded reader (`utility-holidays-green-20260908.log`). The original holiday RED had10 passes and34 intended failures; additional successful controls cover input snapshotting and uncertainty across joined year requests. Independent review confirmed the response/cancellation boundary and identified explicit remaining legacy calendar-policy semantics and aggregate deadline limits; no calendar correctness or hosted workflow acceptance is claimed.

The actual deadline handler was extracted without behavior changes for testing. Its first executable RED had3 passes and29 intended failures; a second run added four multi-year/deletion/cancellation controls and recorded3 passes and33 failures (`deadline-handler-expanded-red-20260908.log`). These reproduce missing authenticated/rate/egress admission, request-shape bounds, and truthful per-dispatch settlement. Production repair is in progress; these are grouped boundary defects, not33 independent production exploits.

The composed catalogue upgrade harness passed41 guard tests, syntax checks and the no-service preflight (`db-20260908142647409-2b60976f`). Actual composed upgrade execution is still pending. It retains the strict old F4 helper and adds a separately pinned complete78-migration/47-test manifest, non-empty historical guest/save receipts, exact seed collision/replay and independent persisted-row checks. No new commit, push, CI, hosted migration/function or Netlify deployment occurred in this follow-up. The existing Business limit remains unchanged.


### 9 September 2026 — composed upgrade execution passed

`db-20260908143641420-e9870b03` passed the complete78-migration chain and all2,365 assertions in47 SQL files on both the fresh and upgraded database. The unchanged policy helper exercised124000→130000, followed by the actual catalogue seed130000→140000. The25 catalogue HTTP checks used two real local Auth users and PostgREST; independent SQL preserved49 historical template rows, one identical target timestamp, two historical documents, two guest receipts and one title-save receipt. The precise23505 collision left all rows unchanged; the successful migration produced86 catalogue rows; executing the same file again was a data no-op. Old policy reservation/result/claim/usage rows remained exact.

The full web gate passed165 deployment,223 root,382 shared and1,035 web tests, lint/types, production build and progressive bundles. All911 source hashes and HEAD were unchanged; cleanup completed with exit0. This mode did not run browser/provider/export/hosted workflows. The subsequent full Edge gate `upload-source-edge-gate-20260908144147075` passed1,436 tests plus184 steps, entry-point types and the existing28-file lint gate; source/HEAD/selected dotenv stayed unchanged. No commit, push, CI or hosted deployment is claimed.

### 9 September 2026 — exact wording receipts and recovery classification

The existing model accounting/context/router now supply an internal frozen checkpoint receipt with exact owner, logical request, stage, request digest, terminal usage/result identity and current reservation authority. Actual readback route facts must agree with the saved envelope. Lost completion acknowledgements retain reconciliation precedence over cancellation. Internal opt-in request data is copied before asynchronous work; provider request hashes and historical result digests retain their existing serialization.

The dormant pipeline assessment binds actual final quality/grounding receipts to accepted sources, execution policy, exact reviewed/final wording and unit hashes. Regressions caught and repaired mixed-script omission, empty-normalised/symbol-only evidence, omitted quality-review source context, and a retained preview reference changing wording during final hashing. Safe sibling support is separate from whole-document composition support. The handler does not yet activate this option, and no document attachment, approval or export is inferred from a provider receipt.

The corrected schema counterfactual reproduced the actual mutated outbound schema in an isolated temporary source copy; original source/test hashes were unchanged. Its initial SHA comparison had used the wrong canonical ordering, so only the corrected run is cited as schema-specific evidence. The final combined focused run passed 148 tests and 18 steps. Four adjacent files passed 83 tests and 172 steps after synthetic acknowledgement fixtures adopted the existing exact model-call key; behavior assertions were preserved. Focused lint passed 14 files and the heading-only no-audit control passed.

Full Edge gate `upload-source-edge-gate-20260908152635463` passed **1,496 tests and 202 steps**, all entry-point/helper types, expanded 42-file lint and diff checks. Source, HEAD and selected dotenv were unchanged. See `Legacy-Wording-Assessment-Receipt-Verification-20260908.md` for RED/ GREEN evidence and limits. The prior full web and database passes predate this latest source slice and remain separately attributed. No new commit, push, CI, hosted migration/function, Netlify release or paid provider evaluation occurred.

F2 atomic document attachment remains open. Read-only tracing confirmed that pending browser saves are not flushed merely because document IDs exist; allowance settlement precedes the browser save; and the finalizer needs durable pre-dispatch audit metadata, source snapshots and document/section revision binding in the existing records. Those integration changes, cancellation acknowledgement, partial results and historical recovery remain required before activation.

### 9 September 2026 — pre-dispatch audit identity codec and predecessor tests

**Implemented / verified locally:** the new internal `document-audit-binding.ts` defines closed audit metadata and five-field source snapshots for the existing admission/reservation records. Versioned length-prefixed UTF-8 digests preserve literal source text, section order and wording; six independently computed fixtures cover Unicode, delimiters and source-field boundaries. Existing provider request/result hashes are unchanged. Metadata is bounded to 128 sections, 512 units and 4 MiB; sources are bounded to 1 MiB of cumulative UTF-8 bytes. The dormant pipeline assessment records the new digest contract version, but the handler still does not activate it.

Independent review drove intended failures for custom iterators, sparse arrays, accessors, identifier whitespace and worst-case JSON escaping. The first descriptor regression rejected its unit before reproducing substitution because its counter included all property reads; the corrected `legacy-audit-codec-descriptor-red-2-20260908.log` proves the actual frozen result contained an unchecked changed unit ID and that a target digest could use substituted wording. The repair snapshots checked data descriptors without subsequent reads from the caller's object. `legacy-audit-codec-descriptor-green-20260908.log` passed **62 tests and 18 steps**, including the adjacent final-audit pipeline tests; four-file lint and diff checks passed. This is a local JavaScript input-boundary reproduction, not evidence of a production HTTP exploit.

**Tests implemented / production integration pending:** the frozen transport predecessor `legacy-audit-admission-transport-red-3-20260908.log` passed 102 controls and 16 steps with 22 intended failures for missing audit-binding transport. The first attempt was compilation-only and the second overlapped a codec edit; neither replaces the clean third run. The new SQL test uses existing real reservation/admission/terminal commands and checks immutable source/binding identities, replay, grants, cancellation and history. Its proposed twelve-argument audited checkpoint wrapper and migration do not yet exist. The forthcoming predecessor database run is expected to report the missing contract; that absence is not itself a reproduction of atomic persistence defect F2.

**Unverified:** audited checkpoint migration/transport implementation, pipeline dispatch activation, atomic document save and credit settlement, browser recovery and approval/export integration. The broad 1,496-test Edge pass predates this new slice; the current test-only transport additions intentionally fail pending implementation. No new commit, push, CI run, hosted mutation or release occurred.

### 9 September 2026 — completed job reconciliation and SQL fixture correction

The delayed completion of `job-mtsmg95a-de7d6208` is now directly inspected. It failed at browser launch on 8 September at 22:04 AEST because Playwright's Chromium headless-shell executable was absent. It exercised no dialog behavior. The later successful `tedit-browser-20260908121932756` remains the applicable local component-browser evidence: desktop and narrow viewport checks passed. All six recorded source/harness hashes were independently compared again and still match. This closes the old test-prerequisite failure without claiming signed-in persistence or production acceptance.

`job-mtsv7nlg-73ba42ac` / `db-20260908160936182-b98a1bb9` exited 1 after 104 seconds. All 78 migrations applied to the identified disposable database, all 47 existing SQL files passed their 2,365 assertions, and the full web gate passed (165 deployment, 223 root, 382 shared and 1,035 web tests, lint/types/build/progressive checks). The new audit-binding SQL test reached 22 assertions: seven controls passed and 15 missing-contract checks failed. An unterminated SQL string in the reversed-unit fixture then caused psql's later `invalid command` diagnostic and prevented the rest of that test from executing. This is partial predecessor evidence; a corrected run is required before claiming its complete intended-failure matrix. No production audit-binding migration existed during this run.

All 915 source hashes, HEAD and tracked diff were unchanged; exact disposable cleanup exited 0 with no cleanup failure. The fixture-only quoting repair is being reviewed before the corrected predecessor run. F2 remains open, and no new publication or hosted action occurred.

### 9 September 2026 — corrected audit-binding predecessor completed

`job-mtsvd5cn-3f27abd9` / `db-20260908161352471-1eadec09` completed the new SQL test without a parse error: **137 assertions, 51 passed and 86 failed**, with a complete TAP plan and normal psql exit. The failures establish the absent audited-checkpoint boundary and immutable source/binding fields; they are not 86 independent production defects. All 47 existing SQL files passed their 2,365 assertions. The complete run executed 48 files and 2,502 assertions against the same 78-migration predecessor. The full web gate passed again, all 915 source hashes and HEAD were unchanged, and exact disposable cleanup exited 0.

The independent pipeline predecessor then passed 27 controls and failed five new tests for the intended reason: reviewers had no pre-dispatch audit-binding RPCs (zero instead of two/four) and missing, malformed or changed synthetic audit metadata did not cause rejection. Evidence: `legacy-audit-pipeline-dispatch-red-20260908.log`. Database migration, provider transport and paired-pipeline integration are now being implemented in separate owned files. No handler activation or completed F2 persistence claim is made.

### 9 September 2026 — pre-dispatch integration focused GREEN

The implemented tracker/context/router and dormant paired pipeline passed **196 tests and 34 steps** in 30 seconds (`legacy-audit-admission-integrated-first-20260908.log`). Ten-file lint, the 26-function deployment contract, 79-file migration validation and diff checks passed. Independent source review found no additional transport/pipeline blocker. Exact pre-dispatch metadata/source capture, actual provider schema rosters, changed/malformed bindings, final-cleanup round identity, lost acknowledgements, historical probes, bounded units and cancellation are covered by controlled transport tests.

The additive SQL migration and test are ready for their first database run. The test now has 143 assertions: the original 137 plus five safe historical-probe controls and one intended identifier-whitespace failure. SQL currently accepts a consistently whitespace-prefixed identifier roster that the TypeScript codec rejects; this precise mismatch is deliberately left for an attributable SQL RED before correction. Literal label whitespace remains valid. No database, full-Edge, browser or hosted acceptance of this combined source is claimed yet. Detailed source/evidence map: `Legacy-Pre-Dispatch-Audit-Binding-20260908.md`.


### 9 September 2026 — full Edge pass and intended SQL mismatch reproduced

Completed `job-mtsvvef6-4cb63c65` ran the full Edge gate first: `upload-source-edge-gate-20260908162804040` passed **1,564 tests and 220 steps**, all 26 entry-point and two helper type checks, and the expanded 44-file lint gate. Source, HEAD and the selected web dotenv stayed unchanged.

The following database run `db-20260908162851217-e37cdf8b` applied 79 migrations and executed **2,508 assertions: 2,506 passed, two failed**. The new audit-binding SQL file passed 141 of 143 assertions. Its whitespace-identifier case proved unwanted acceptance, and its independent unchanged-row sentinel caught the resulting mutation; these are the same narrow mismatch, not two unrelated defects. All 47 older SQL files passed. The full web gate passed 165 deployment, 223 root, 382 shared and 1,035 web tests plus lint/types/build/progressive checks. All 916 source hashes, HEAD and tracked diff were unchanged; exact disposable cleanup exited zero.

**Implemented / independently reviewed:** the new private identifier helper now requires exact ECMAScript trim equality only for section keys, unit IDs and unit section keys. Existing type, Unicode and UTF-16 bounds remain; labels retain literal whitespace. All 143 assertions are preserved, with three additional positive real-command/returned-value/independent-row controls for a label containing tabs, spaces and a nonbreaking space. Post-fix 146-assertion acceptance remains pending. Migration SHA-256: `c50026119bda6235692d13adfa78d857427eb544e8358685d8811914ce8ef32a`.

The historical-upgrade helper is being prepared against the exact reviewed 78-migration/47-test predecessor, followed only by this 79th migration. It must preserve old operation, usage and allowance records and exercise the new contract through real local Auth/PostgREST. No generated-document attachment, browser recovery, approval/export, CI or hosted acceptance is inferred from these checks. F2 and deployment readiness remain open; no new commit, push or hosted mutation occurred.


### 9 September 2026 — exact historical audit upgrade prepared

The new `legacy-audit-upgrade-acceptance.mjs` and existing disposable runner now compose full fresh 79-migration/48-test acceptance with an exact 140000→150000 upgrade. The baseline independently matches all 78 migrations and 47 old SQL tests from the corrected predecessor; only the new audit migration and regression are held for the historical phase. Both held files and both phase inventories are hash-checked. Existing policy/catalogue validators and target/reset/cleanup controls remain unchanged.

All **30 new guard/vector tests** passed in `legacy-audit-upgrade-guards-20260908.log`; runner syntax and diff checks passed. No-service preflight `db-20260908164135694-f03ac127` passed with all 916 source hashes equal before/after. This preflight did not start a database or run the web gate. Actual upgrade execution is pending. Prepared real-local-Auth/PostgREST checks cover positive historical preparations, dispatch and terminal accounting, literal old replay, exact old-column preservation, rejection of retrospective audit metadata, safe undispatched adoption, paired new admissions, malformed/conflicting requests, browser/other-owner/anonymous denials and independent SQL reads. These planned checks are not yet passing workflow evidence.


### 9 September 2026 — identifier fix passed; positive fixture typing corrected

`job-mtsweend-30474aa9` / `db-20260908164250794-48b24216` ran the corrected migration and passed every executed assertion: 2,494 total, including 129 in the audit-binding test. The original whitespace-identifier rejection and unchanged-row sentinel now pass. PostgreSQL stopped at the new positive label fixture because `to_jsonb` could not infer the type of its Unicode string literal. This is a fixture error, not a demonstrated failure in the corrected production migration. The remaining 17 assertions, final TAP plan and historical upgrade were not reached.

The full web gate passed; all 916 source hashes, HEAD and tracked diff stayed unchanged; exact disposable cleanup exited zero. The fixture-only correction adds `::text` to the literal, preserving the tab, spaces and nonbreaking space and all 146 intended assertions. Independent review found no other untyped polymorphic fixture inputs. The exact helper test-file pin was updated to `878ffb2325dd55e738f621d507200f4daa6861f6ad3e5d5a26d765e8f8361a15`; all 30 guard tests and the diff check passed. Migration bytes remain `c50026119bda6235692d13adfa78d857427eb544e8358685d8811914ce8ef32a`. Complete corrected SQL and historical-upgrade acceptance still require execution. No new hosted action or publication occurred.


### 9 September 2026 — pre-dispatch audit binding fresh and historical GREEN

Completed `job-mtswjsfw-07e3aa5c` / `db-20260908164701953-5aab36ed` passed **2,511 SQL assertions in 48 files** on both fresh and upgraded databases, including all 146 audit-binding assertions. Its exact 78-migration predecessor passed 2,365 assertions in 47 files before applying only migration 150000. All 208 harness checks passed.

The **66 actual local Auth/PostgREST checks** positively created historical and new records and proved paired admissions, exact terminal replay, malformed/conflicting input rejection, owner/role denials and independent SQL persistence. All old columns of six reservations, six claims, five admissions, two model results, one allowance result and four usage rows remained exact immediately across migration. Historical dispatched/completed work could not gain retrospective audit metadata; safe undispatched adoption retained the original admission ID. This is local internal-operation persistence proof, not generated-document attachment, browser approval/export or actual provider evaluation.

The full web gate passed 165 deployment, 223 root, 382 shared and 1,035 web tests, lint/types, production build and progressive checks. All 916 source hashes, HEAD and tracked diff remained equal; exact disposable cleanup exited zero. Runtime Edge source is still the source that passed 1,564 tests and 220 steps in the prior attributed gate. Detailed results: `Legacy-Pre-Dispatch-Audit-Binding-20260908.md`.

The next bounded F2 prerequisite extracts the already-authoritative workspace save body into a private explicit-actor core, preserving the authenticated public function, literal idempotency receipts, revision triggers and grants. This enables a later trusted finalizer to call that same save path in the allowance transaction without JWT impersonation or a competing persistence authority. New regression tests precede that extraction. F2 remains open; no new commit, push, CI, hosted mutation or deployment is claimed.


### 9 September 2026 — workspace save core regression prepared

The next F2 prerequisite is test-only: new `supabase/tests/legacy_workspace_core.test.sql` prepares 62 assertions against the existing public save and the proposed private explicit-actor core. Actual public creation/replay and independently seeded revision-five workspaces serve as positive controls. Private-core absence returns an explicit diagnostic instead of aborting the entire fixture or falling back to the public writer. The negative baseline is pending; the production extraction migration has not been written.

The fixture covers unchanged public contracts/grants, core owner-only execution, actor isolation from ambient JWT settings, exact receipt reuse across both entry points, literal wording/history, parent revision 5→8, approval invalidation, stale full-roster rejection, and injected receipt-storage failure after positively observed pending workspace changes followed by complete rollback. Source isolation checks passed (2/2), the existing79 migration inventory passed, and the new file has no whitespace-check diagnostics.

Read-only caller/trigger review confirmed that the body can be extracted without changing the public API or request hash. Planned migration safeguards include the exact original PostgreSQL function body SHA `6a7eb1228611c35c64720b3d3c2654f039d510c797010739b34046639fa5897b`, a temporary full public pg_proc identity snapshot excluding only prosrc, the existing wrapper owner on the new invoker core, and no effective core EXECUTE grant beyond that owner. The planned core body changes only its actor initializer and has SHA `cbebe21e2b42c68b96ee588075889c1c2f83e90ca7d644e59d5de1164057a756`. These are source-derived migration safeguards, not completed behavior or upgrade proof. No allowance finalizer or generation-handler activation is included in this prerequisite.


### 9 September 2026 — workspace core intended RED and implementation

`job-mtswzp8o-97e352a0` / `db-20260908165924298-b9ed843e` completed its full predecessor TAP run: all 2,511 existing SQL assertions passed, and the new 62-assertion file had 35 passes and 27 expected missing-core failures. No SQL parse or setup error interrupted it. The complete web gate passed; all 917 source hashes, HEAD and tracked diff remained equal; exact disposable cleanup exited zero. These failures establish the new extraction contract's absence, not 27 separate production defects or a completed F2 reproduction.

**Implemented / independently source-reviewed, database GREEN pending:** `20260908160000_legacy_workspace_save_core.sql` introduces the private explicit-actor invoker core and keeps the existing public seven-argument SECURITY DEFINER wrapper. The extracted body differs in exactly one actor-initializer line. The transaction checks the original body hash, transfers core ownership to the existing wrapper owner using a quoted role name, rejects any non-owner core EXECUTE grant, and compares all public pg_proc metadata except the intentionally changed body. A temporary snapshot is removed on transaction completion; no new persistence authority or JWT substitution is introduced. Migration SHA-256: `2c1d3624c48f5f6c2abb7adc888515095cff44fb8b27e7b8b345e81db95576d6`.

The web deployment contract now requires migration160000, with no new public RPC signature or execute grant. Static validation passed for all80 migrations and26 functions. The existing disposable runner has a new exclusive core-upgrade mode that preserves old modes and their exact manifests. Its new79/48 baseline independently matches the completed audit-upgrade GREEN. The real Auth/public-RPC historical receipt and public OID/ACL checks are being prepared before the first80-migration run. No finalizer, handler activation, CI or hosted deployment is claimed.

### 9 September 2026 — workspace core upgrade preflight passed

The frozen upgrade helper and runner integration passed independent source review. All **56 new guard tests** passed (`legacy-workspace-core-upgrade-guards-20260908.log`); runner syntax passed. No-service preflight `db-20260908170833363-a476d487` passed all **264 harness assertions**, with all **918 source hashes** equal before and after and no failed steps. It started no database and did not execute the web gate.

The next actual run will apply all 80 migrations and 49 SQL tests fresh, rebuild the exact 79-migration/48-test predecessor, create two authenticated owners and historical workspaces through real local APIs, apply only migration160000, and verify old rows, complete public function identity, literal receipt replay and new saves before repeating the upgraded SQL and full web gates. This remains pending execution; no generated-document finalizer or hosted release is included. The parent refreshed the existing checkout, branch, HEAD, active ownership and required runtimes before launch; executable inputs are frozen.

### 9 September 2026 — fresh workspace core GREEN; upgrade harness OID mismatch

Completed `job-mtsxhal0-2a936b33` / `db-20260908171305113-2d23f299` applied all **80 migrations** and passed all **2,573 assertions in 49 SQL files**, including the complete 62-assertion workspace-core regression. The exact 79-migration predecessor also passed all **2,511 assertions in 48 files**. Four real Auth requests created and authenticated two synthetic owners before the upgrade helper stopped at its initial public function metadata check.

The harness incorrectly required JavaScript numbers for PostgreSQL `oid` and `proowner` values. Actual `jsonb_build_object` output contains decimal strings for these OID types. The failure occurred before historical workspace creation or application of the forward migration in the upgrade phase. It does not invalidate the fresh SQL pass, and the historical upgrade remains unverified. The fix will validate the actual canonical nonzero OID string representation while retaining full before/after catalog, ownership, grant and signature comparisons; production migration and regression bytes stay unchanged.

All **264 harness assertions** and the complete web gate passed (165 deployment, 223 root, 382 shared and 1,035 web tests, lint/types/build/progressive checks). All **918 source hashes**, HEAD and tracked diff remained equal; exact disposable cleanup exited zero with no cleanup failure. No generated-document attachment, provider evaluation, browser workflow, CI or hosted release is inferred from this run.

The corrected metadata fixture first produced **63 passes and five intended failures** in `legacy-workspace-core-oid-red-20260908.log`. The helper now validates exact nonzero uint32 decimal strings for function, owner, language and result-type OIDs, requires agreement with the retained raw catalog, and preserves every input value and full before/after comparison. All **68 tests pass** in `legacy-workspace-core-oid-green-20260908.log`; the actual saved PostgreSQL metadata also passes unchanged. Syntax and diff checks pass.

Independent review identified one additional harness expectation mismatch before rerun: direct PostgREST maps SQLSTATE `40001` to HTTP500, while `23505` remains409 ([primary error mapping](https://docs.postgrest.org/en/v14/references/errors.html#http-status-codes)). Only the stale-revision fixture's expected HTTP status changed; its exact database code/message and independent unchanged-row assertions remain. No production error behavior changed.

Corrected no-service preflight `db-20260908171854960-94c971f0` passed **276 harness assertions**, with all **918 source hashes** equal before and after and no failed steps. Production migration and 62-assertion SQL regression retain their previously verified hashes. The complete historical upgrade remains pending the next actual database run.

### 9 September 2026 — workspace save core fresh and historical GREEN

Completed `job-mtsxpjg3-3c4803a7` / `db-20260908171929839-fa874a7a` passed the complete composed acceptance: **80 migrations / 49 SQL files / 2,573 assertions** fresh and after upgrade, plus **79 migrations / 48 files / 2,511 assertions** in the exact predecessor. All **276 harness assertions** passed.

The **23 actual local Auth/PostgREST requests** created and authenticated two owners, created owned outcomes and workspaces, edited one section, replayed older receipts against newer revisions, rejected cross-owner/anonymous/service requests, and verified new saves, duplicate replay, changed-intent conflict and stale-revision rejection. Independent SQL compared every historical row across migration: two outcomes, two documents, four sections and three original receipts were exact. The complete public pg_proc identity excluding only its intentionally changed body remained exact; actual authenticated, anonymous and service-role calls to the private core were denied. A trusted explicit-actor call replayed the same old public receipt. Four final persisted receipt results independently matched their API acknowledgements. Omitted sibling wording/history remained intact. These are actual local workspace-save persistence and historical compatibility proofs.

The full web gate passed **165 deployment, 223 root, 382 shared and 1,035 web tests**, lint/types/build and progressive checks. All **918 source hashes**, HEAD and tracked diff stayed equal; exact disposable cleanup exited zero. Migration and SQL regression hashes remain unchanged from the fresh pass. Independent review accepted the narrow harness corrections.

**Still unverified:** generation attachment plus allowance settlement in one transaction, real provider evaluation, browser generation recovery, approval/export integration, CI and hosted release. The next F2 slice binds the existing reservation to the owned workspace revision, full section roster and existing source snapshot before any provider dispatch. It reuses this verified private save core later; no second document or billing authority is introduced.


### 9 September 2026 — owner-prioritised publication checkpoint

The owner explicitly requested pushing the verified fixes now, with remaining improvements to continue afterwards. New F2 admission implementation is paused; no admission test or migration was created. The root refreshed the selected checkout/branch, current board and staged inventory. Runtime source still matches the latest GREEN database/web snapshot; only package/CI wiring subsequently changed, to invoke the already verified exact79→80 workspace-core acceptance mode. The new package command passed its no-service preflight; the production dependency audit reports zero advisories across384 dependencies. Independent review found no missing dependency across86 CI helper/import/fixture references.

At2026-09-08T17:51:44.531Z the root used existing exact-target release authority to lock and independently read back the current aiprompted production deploy6a9fc526610f2efb8c05454f. It still serves e1d514d; repo/branch/site all matched. This reversible hold prevents automatic publication of a frontend whose hosted backend is not yet ready. No access-control or Business-limit change occurred. Git publication remains a separate action from backend release, exact-commit CI and signed-in production acceptance.

The refreshed source candidate is being explicitly staged and checked by exact path/digest and credential scans. See Publication-Checkpoint-20260909.md for the current evidence and limitations. This entry records preparation; it does not yet claim the commit or push succeeded.
