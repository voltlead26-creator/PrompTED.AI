# Profile-driven clarification and knowledge confirmation

Date: 8 September 2026, Australia/Melbourne.

## Publication addendum — 9 September 2026

The report below preserves the original repair session's evidence and limits.
Its statement that this task did not push describes that session, not the current
repository. All ten named implementation/contract files were subsequently
committed and pushed in `d96c6cbb6a267d91335192c591a0346eca69813c`, and remain in
`Thought-Enhanced-Document` at `42f1c549486d91f26cd999887c195a69604caed8`.
Five of those files include later integration changes, so the old browser run
must not be described as a test of the exact current wording of every file.

The current full web gate passed on 9 September: 165 deployment tests, 223 script
tests, 423 shared tests and 1,035 web tests, lint, types, production build and
progressive bundle checks. Actual local upload/Profile Chromium and the separate
tEdit component suite also passed. These current checks and their scope are in
[`Test-Toolchain-Advisories-20260909.md`](../../docs/evidence/web-operational-readiness/Test-Toolchain-Advisories-20260909.md).
The ten file hashes and their original-report comparison are recorded in
[`Clarification-Configuration-Publication-20260909.json`](../../docs/evidence/web-operational-readiness/Clarification-Configuration-Publication-20260909.json).

This report and its compact browser receipt are being published at the owner's
request. Raw logs, screenshots and generated harness bundles referenced below
remain local evidence; they are not application dependencies. No deployment or
live-model/persistence result is inferred from publishing this report.

## Implemented behavior

TED's intent and follow-up instructions now use the existing Enhanced Document Intelligence Profiles, including required and high-value facts, section information contracts, evidence, context, depth and risk checks. When several material details are missing, TED is instructed to ask two or three focused questions together. One question is appropriate when only one relevant fact is missing; a complete supplied brief goes to knowledge review without invented extra questions. The previous four-question forced recommendation has been removed.

Before the Home screen offers document creation, it presents the proposed knowledge summary with **Confirm knowledge summary** and **Correct or add details**. The summary contract covers the proposed document, purpose, audience, source-grounded facts, relevant names/dates/figures, section detail and depth, and explicit treatment of unresolved information. A recommendation without a summary cannot unlock creation. A repeat-question repair may not force an ungrounded recommendation.

Corrections return to clarification. Upload changes, reset, reload and account changes invalidate approval; late responses cannot restore an older brief. Duplicate submissions are rejected. Choosing an alternative document returns through that document's profile check and a new summary confirmation. The confirmed brief and transcript enter the existing document-creation handoff, while uploaded source text remains separate. No new database schema, browser facts registry, provider policy or persistence path was introduced.

All 86 compiled active profiles have information contracts. Runtime prompt assembly was checked for each profile's own label, section keys, required facts, evidence and depth. That check reproduced and corrected a supplemental business-proposal override affecting the explicitly selected Proposal, Grant / Funding Proposal and Research Proposal profiles. Explicit document selection also takes precedence over unrelated user memory.

These changes use the existing active profiles. The separate shadow Enhanced DIP V2 definitions were not activated or migrated.

## Code and contracts

- `apps/web/src/hooks/useRecommendation.ts`: knowledge review gate, correction and confirmation handling, exact account/context invalidation, preserved source context and confirmed creation handoff.
- `apps/web/src/app/(app)/home/HomeScreen.tsx`: blocks creation without the current recommendation and rechecks an alternative document before creation.
- `packages/shared/src/orchestration.ts`: optional knowledge-summary response compatibility; the first-turn guard preserves complete proposed briefs for explicit review.
- `supabase/functions/clarify/context.ts`: validates bounded input, preserves follow-up context, avoids a duplicate final answer, and resolves the latest explicit user document selection against the existing catalogue.
- `supabase/functions/clarify/index.ts`: profile context on follow-ups; removes count-based commitment; bounded structured/repeated-question repair with an explicit unresolved failure.
- `supabase/functions/interpret-intent/index.ts`: complete-brief repair instructions and response capacity.
- `_shared/prompt-builder.ts`, `document-intelligence.ts`, `document-intelligence-profiles.ts`: multi-question/profile/summary instructions and selected-profile precedence.
- `_shared/model-output-contracts.ts`: versioned intent-result.2 and clarification-result.2 schemas, with bounded nullable knowledge_summary. Existing callers remain parse-compatible; a complete summary is required to unlock the new UI.
- Focused hook, Home, shared orchestration, clarification-context, prompt and structured-output contract regressions accompany the behavior changes.

## Verification

- Initial regression evidence: four new knowledge-gate tests failed before the hook repair. Existing Home tests reproduced creation becoming unavailable until they performed the newly required summary confirmation. The all-profile runtime test failed before fixing profile precedence. Logs are retained here or in the task's temporary logs.
- Focused web: 44 passed, including Home creation handoff, alternative selection, correction, retry, duplicate sends, stale replies, reload, source replacement and account transitions.
- Focused backend: 16 passed, including all 86 profiles through the actual prompt builder.
- Full backend: 1,201 passed plus 12 test steps; no failures, using the repository's CI command with environment/read permissions.
- Both affected Edge entry points pass Deno type checking.
- Browser: real recommendation hook and conversation component exercised in headless Chrome at desktop and mobile sizes. Three-question display, summary review, corrections, retained answer after failure, retry, explicit confirmation, creation context and reload safety passed. No runtime errors or narrow-screen horizontal overflow were observed.
- The complete final `pnpm verify:web` gate passed: deployment-contract checks, lint, type checking, 223 script tests, 381 shared tests, 1,030 web tests, production build and progressive bundle check. The accepted final log is `verify-web-current.log`.
- Earlier full web runs passed 223 script tests and 381 shared tests, but had one failure in the concurrently changing document-editor test `generation-adoption.test.tsx` (Make clearer button). After another task changed the editor, its 54-test file passed; the complete web gate was rerun against that updated source.

The browser harness uses explicitly simulated TED responses. It proves UI transitions and context handoff, not semantic model quality or real database persistence. Screenshots and `browser-result.json` are retained here. No provider generation, signed-in Supabase save/reopen, real saved-document export or production interaction was performed by this repair. Those remain unverified.

## Repository and ownership

Worktree `/Users/kaichurchw/PrompTED.AI`; remote `https://github.com/voltlead26-creator/PrompTED.AI.git`; branch `Thought-Enhanced-Document`; HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. Node 22.23.2 and pnpm 10.33.0 were verified. The supplied historical mobile worktree does not exist, and the maintained target was used after the live repository/instruction/claims refresher.

This is a shared dirty checkout with another active release/editor task. Existing staged and unstaged work was preserved. This task did not stage, commit, push, merge, deploy, change production data or edit the live user's checklist. The earlier local checklist title/description repair remains present, documented separately in `.codex/checklist-title-verification/Verification.md`.

Tracked source hashes and diffs were checked. The initial comparison includes deliberate repair edits plus concurrent changes in SectionEditor and the existing release harness; a separate final-gate before/after comparison records changes during the final verification run. No unrelated source edits were made by this task.

Final tracked-source comparison: no tracked files changed during the successful final gate.
