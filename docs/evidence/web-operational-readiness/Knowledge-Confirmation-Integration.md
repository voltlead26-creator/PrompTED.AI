# Knowledge confirmation integration — 8 September 2026

**Implemented; verified locally in focused tests.** This report covers the completed knowledge-confirmation task and the bounded integration corrections made after its coordination claim was released. Verification applies to the working-tree overlay on `Thought-Enhanced-Document`, based on `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. It is not an exact-commit CI or production claim.

The reviewed flow is Home text submission → intent/clarification → document-profile requirements → proposed knowledge summary → explicit confirmation → recommendation handoff. The completed task added optional shared `knowledgeSummary` support, versioned intent/clarification output schemas, profile-driven questions and a browser confirmation checkpoint. It removed the forced recommendation after four questions. Existing owner-dispatch checks, context invalidation, duplicate-send control and the outcome persistence path remain in use. Alternative document selection re-enters clarification before handoff.

**Integration corrections.** Two findings remained in the task's released source:

- An uploaded `resume` heading, or a previous assistant message naming that profile, could override a user's cover-letter request. `supabase/functions/clarify/context.ts` now derives the profile hint from actual user statements. The original upload and assistant history still appear in provider messages. Tests check both the intended profile and preservation of the supplied evidence.
- A first message containing 20,000 characters acquired a 14-character `User request: ` prefix. Intent accepted it, but later clarification rejected the retained situation/history. New first messages now retain their exact wording without that prefix. New messages exceeding the existing 20,000 UTF-16-unit input budget are rejected before changing knowledge or conversation state. Home keeps rejected input editable and clears only an accepted, unchanged input under the same principal. Historical prefixed user turns and situations retain their complete admitted 20,000-character body through a narrowly bounded compatibility allowance; new answers and attachments do not receive that allowance.

The initially reported first-turn job-search bypass was already corrected in the released shared helper. Its existing implementation was retained, and a positive regression verifies that a complete proposed summary retains its recommendation while clearing `jobSearch` before confirmation. The inactive hydrate/upload-context observation was also corrected in the released source; it was not treated as an additional release blocker.

The correction changed `clarify/context.ts`, `useRecommendation.ts` and Home's text-submit handler. Regression changes are in `clarify/context.test.ts`, `useRecommendation.knowledge.test.tsx`, `HomeScreen.test.tsx` and `orchestration.test.ts`. No provider policy, profile catalogue data, database schema, allowance, account limit or activation setting changed in this correction.

**Verification evidence.** The parent executed and inspected these focused runs:

| Gate | Before correction | After correction |
| --- | --- | --- |
| Home and recommendation tests | 4 intended failures, 42 passes | 46 passes |
| Clarification context tests | 3 intended failures, 4 passes | 7 passes |
| Shared orchestration tests | 30 passes, including the already-fixed search guard | No runtime change after this pass |

The seven failures covered attachment/assistant profile authority, historical prefixed input, exact new-input carriage, rejection before initial or correction-state mutation, and editable recovery in Home. Positive checks also preserve a new draft typed while an earlier request returns. The existing evidence-retention test now checks uploaded facts in provider messages rather than requiring them in the profile-selection hint; those facts were not removed.

Local logs: `knowledge-integration-red-{web,edge,shared}-20260908.log` and `knowledge-integration-green-{web,edge}-20260908.log`. Commands were:

```sh
pnpm --filter @prompted/web exec vitest run src/hooks/useRecommendation.knowledge.test.tsx 'src/app/(app)/home/HomeScreen.test.tsx'
pnpm --filter @prompted/shared exec vitest run src/orchestration.test.ts
deno test --allow-env --allow-read supabase/functions/clarify/context.test.ts
```

**Source reviewed.** The review included Home, the recommendation/intent hooks, shared coercion and initial-confirmation guard, clarification context and handler, intent handler, output schemas, prompt builder, and the profile instruction changes. No additional concrete release blocker was identified in this bounded source pass. User confirmation remains a statement of accepted information, not independent factual verification or document approval.

**Unverified in this report.** Complete lint/type/build and broader tests for the final integrated candidate remain the parent's next gate. The original task recorded its own browser artifacts; this review did not inspect or execute those artifacts and does not count them as browser proof for the corrected source. No live-model evaluation, independently read persistence, approved-document/export inspection, CI verification or production exercise is established by these focused tests. Existing application-wide release blockers remain tracked in the main evidence ledger.

**Subsequent local verification — 8 September 2026:** `master-web-gate-20260908125140321` completed the integrated web gate after the corrections above. Later F4 runs `db-20260908131248224-81ab4600` and `upload-source-edge-gate-20260908131901909` also passed the full web and Edge suites on their recorded overlay. The former included actual upload/Profile browser and independently read persistence checks, which do not substitute for a browser journey through knowledge confirmation. The broad lint/type/build/test limitation above is superseded for those recorded source snapshots; live-model, knowledge-flow persistence, approved wording/export, exact-commit CI and production acceptance remain distinct and unverified here.
