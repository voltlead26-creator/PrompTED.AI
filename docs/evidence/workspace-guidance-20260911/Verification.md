# Master workspace guidance

Work item: clearer, context-aware explanation and edit assistance for non-expert document owners.

## Baseline and boundaries

- Checkout: `/Users/kaichurchw/PrompTED.AI`, primary and only worktree.
- Remote: `https://github.com/voltlead26-creator/PrompTED.AI.git`.
- Branch: `Thought-Enhanced-Document`.
- Base HEAD: `0b9dbc1aeb07dddc43398d598fd05bfd64606ebc`.
- Before editing: no staged or unstaged tracked changes; 752 existing untracked entries preserved.
- Runtime: Node 22.23.2, pnpm 10.33.0, Deno 2.9.5.
- Current root AGENTS.md governs implementation. Historical `origin/reliably-prompTED:AGENTS.md` was inspected in the historical PrompTED repository for standing product/process rules; its older repository and provider assumptions do not override the current target.
- Coordination: this task owns the assistance components, explanation hook, prompt guidance, tests and this evidence folder. The separate owner-access design claim does not overlap.
- Local implementation and verification only. No hosted mutation, paid provider evaluation, publication, account-limit or environment changes.

## Product-purpose alignment

A person reviewing a document needs to understand its wording and make a deliberate edit without guessing how TED works. This change improves Understanding → Review by exposing explanation beside editing, separating meaning/checks/next step, asking for a tone or new facts only when needed, and preserving the existing foreground proposal review. Satisfaction and real model quality require user and live evaluation; they are not inferred from local tests.

## Trace and invariants

WorkspacePane → SectionEditor → ExplainWithTED / useExplainWithTED → shared explainSection client → existing web gateway → explain-section Edge Function → existing provider router and EXPLAIN_OUTPUT_SCHEMA → existing validation → explanation UI. Explanation is transient, read-only guidance; it does not edit, approve or persist a document.

SectionEditor, SectionedChecklistScreen and ArtifactActionScreen consume EditWithTED. Clarification still dispatches the same EditAction and instruction through the existing callbacks. TED proposals still use the existing operation/revision checks and TedChangeReview Apply/Retry/Discard boundary. Formatting, original files, allowance, document persistence, approval and export commands are unchanged.

## Reproduction

Command: `pnpm --filter @prompted/web exec vitest run src/components/organisms/WorkspaceAssistance.test.tsx src/hooks/useExplainWithTED.test.tsx --maxWorkers=1`.

Before implementation: 9 tests failed for the intended reasons. Empty tone/detail actions dispatched immediately; typed instructions were dropped by quick actions; an immediately resolved explanation did not render; duplicate explanation clicks dispatched twice; no actionable error appeared without a running transition; an older response overwrote the newer result; changing owner retained the previous result; unmount did not abort the request.

## Implementation

- Direct Explain this action in the section toolbar.
- Structured, accessible explanation cards with meaning, relevant checks and one next step, using the existing response contract.
- Immediate local pending state, explicit retry and cancellation, local conversation scrolling and owner/wording-scoped history.
- Request cancellation and stale-result fences in the existing explanation hook.
- Tone choices and fact-entry clarification without an unnecessary provider call; typed instructions accompany quick actions.
- Plain-language progress and review guidance without claims that a generic action description verifies facts.
- Existing explain prompt now asks for a direct answer first, concise relevant lists, a supported next step and explicit uncertainty. No route, schema or provider changes.

## Verification so far

- Focused first integrated run: 28 tests passed across WorkspaceAssistance, useExplainWithTED and SectionEditor revision-edit tests.
- Scoped ESLint: exit 0.
- Expanded regression and adjacent run: 70 tests passed across six files (WorkspaceAssistance, useExplainWithTED, SectionEditor revision-edit, TedChangeReview, ArtifactActionScreen and SectionedChecklistScreen).
- Explanation prompt contract: 8 Deno tests passed. This checks prompt construction, not actual model quality.
- Chromium passed at 1440×1000 and 390×844: keyboard explanation action, structured answers, unchanged document/page position, tone clarification before dispatch, native foreground review, discard, cancellation/late-result fencing, retry and section change. No external network calls or page errors. Desktop tone and narrow-screen explanation screenshots inspected; the narrow-screen sheet and answer have their own scroll areas.
- All 26 active Edge entry points passed type checking; 1,586 Edge tests (220 steps) passed.
- Locked install passed. The first full web gate passed 165 deployment tests, the deployment contract and all lint, then failed on type errors in the new tests (unsupported Testing Library `exact` options and unchecked mock-array indexing). Those test definitions were corrected without changing their assertions; web type checking now passes.
- The first verification run changed no tracked source. Full web-gate rerun pending; broader web tests and production build were not reached by that first invocation.

## Evidence limits

No CI, production, live-model quality, hosted persistence or exported-artifact claims are made by this UI change. Browser fixtures will use synthetic actions and exercise real components/CSS; database persistence remains a separate acceptance boundary.

## Broader regression follow-up

The second web gate passed deployment checks, lint and shared/web types. Shared tests passed 423/423. Web tests passed 1,135/1,138; three existing editor tests still expected the old technical status text and replaced quick-action labels. Updated those expectations to the intentional user-facing wording, retained cancellation/reconciliation blocking assertions, and added an exact question-dispatch assertion. All 21 tests in that file now pass. This is a copy-contract update, not a relaxation of recovery behavior. The second run changed no tracked source. Production build remains pending the final web gate.

Final source review covered current callers, explanation identity/abort/error handling, owner changes, text-only response rendering, typed instruction handling, and unchanged proposal Apply/Discard boundaries. Coordination board remains collision-free.

## Final local acceptance

`pnpm verify:web` passed in 35.128 seconds after the two test-definition corrections described above. It ran deployment-contract tests (165 passed), static deployment validation, repository/shared/web lint, shared/web type checking, root script tests (223 passed), shared unit tests (423 passed), web tests (1,138 passed across 123 files), the Next.js production build and progressive bundle checks. The 165 deployment tests overlap the root script tests; these counts must not be summed as unique cases. No hidden skips were reported in these test summaries.

The verification runner hashed every tracked file before and after: no unexpected changes. `git diff --check` passed. HEAD remains `0b9dbc1aeb07dddc43398d598fd05bfd64606ebc`; implementation is an uncommitted local overlay on `Thought-Enhanced-Document`. `final-source-manifest.json` records the exact changed source and new test/harness inputs with SHA-256 digests. Existing unrelated untracked files were preserved.

| Evidence boundary | Final status |
| --- | --- |
| Implemented | Local editor explanation, edit clarification, stale-request protection, prompt guidance and regression/browser fixtures |
| Verified locally | Locked install, complete web gate, 26 Edge entry-point type checks and 1,586 Edge tests passed |
| Workflow exercised | Actual editor/assistance/review components in Chromium at desktop and narrow widths, using controlled provider hooks; cancellation, retry, section change and review/discard passed |
| Verified in CI | Not run for this uncommitted overlay |
| Production exercised / deployed | Not performed |
| Persistence proven | No new hosted/database persistence claim; browser fixture is intentionally transient |
| Export inspected | Not applicable to this explanation/clarification change; no artifact exported |
| Blocked | No remaining failed local gate for this bounded change |
| Unverified | Real-provider explanation quality, measured customer satisfaction and hosted end-to-end acceptance |

## Changed files and purpose

- `SectionEditor.tsx` and its CSS: direct explanation action, context lifetime, readable review guidance and responsive toolbar.
- `ExplainWithTED.tsx`, `EditWithTED.tsx`, `EditWithTED.module.css`: readable answer cards, explicit scope, clarifications, immediate pending feedback, cancellation/retry and local scrolling.
- `useExplainWithTED.ts`: owner/wording/request identity and abort handling.
- `prompt-builder.ts`: direct plain-language answers, concise relevant checks and supported next steps through the existing explanation contract. Requires the normal future function release before this prompt is hosted.
- Component/hook/prompt tests: regressions and intentional user-facing copy contracts.
- `workspace-guidance-*` browser fixtures and `scripts/verify-workspace-guidance.mjs`: reproducible Chromium checks without provider or hosted account access.

Logs, browser screenshots and summaries were originally retained here. During the owner's subsequent repository cleanup they were moved, with SHA-256 verification, to `.local/verification/workspace-guidance-20260911/`. This report and `final-source-manifest.json` retain the original implementation evidence. The fresh sync audit is in `../github-sync-20260911/Audit.md`. No secrets, .env files, allowance limits, database schemas, persistence commands, export paths, provider routes or uploaded originals were changed.
