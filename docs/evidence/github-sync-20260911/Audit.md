# GitHub and local source alignment audit — 11 September 2026

## Scope and baseline

The owner authorised auditing and updating GitHub `voltlead26-creator/PrompTED.AI`, branch `Thought-Enhanced-Document`, to match the latest reviewed local web application, then requested local folder cleanup and supplied the audited atlas as reference. This is source synchronisation and local organisation, not hosted release acceptance.

- Primary and only worktree: `/Users/kaichurchw/PrompTED.AI`.
- Git common directory: `/Users/kaichurchw/PrompTED.AI/.git`.
- Remote: `https://github.com/voltlead26-creator/PrompTED.AI.git`.
- Local HEAD and live remote branch at audit start: `0b9dbc1aeb07dddc43398d598fd05bfd64606ebc`.
- GitHub default branch: `Thought-Enhanced-Document`.
- Existing baseline CI: [successful run 34487499373](https://github.com/voltlead26-creator/PrompTED.AI/actions/runs/34487499373).
- Required and observed runtime: Node 22.23.2, pnpm 10.33.0; Deno 2.9.5.
- Coordination task: `01a08e3a-324c-7401-b20c-d262ad88379f`. The separate owner-access plan claim does not overlap the published files.
- Initially: ten modified tracked source/test files, an empty index, new guidance tests/harness, and historical untracked evidence/reference material.

Current root `AGENTS.md` governs this repository. Historical `origin/reliably-prompTED:AGENTS.md` was inspected in the historical PrompTED repository for standing process/product guidance; its older repository and branch assumptions do not replace this exact authorised target.

## Atlas correspondence and findings

The supplied `PrompTED-audited-atlas-bundle` is pinned to the same `0b9dbc1` baseline and indexes 1,049 tracked files. Comparing its SHA-256 manifest against the live worktree identified exactly the ten modified guidance source/test files listed below; all other indexed paths matched. The existing `final-source-manifest.json` for the guidance work also matched all sixteen implementation/test/harness inputs byte for byte.

The gap was unpublished local guidance work, not remote-only commits or a divergent branch. Earlier account usage/upgrade, export receipt forwarding, DOCX inspection and retained-text recovery improvements were already present in the shared baseline.

Two other local files are explicitly unfinished: the empty `20260910060401_dormant_docx_source_binding.sql` placeholder and the `docx_source_binding.test.sql` regression that expects the missing `prepare_docx_source_document_v1` command. They remain unchanged and outside publication. The owner-access design plan remains with its separate owner. This audit does not claim these database or design tasks are complete.

The atlas remains a historical baseline. Regenerating its graph/viewer for the subsequent commit is separate work; this audit does not relabel its old revision or claim its source graph includes the new guidance files.

## Reviewed improvement and product-purpose alignment

The target user is a non-expert document owner reviewing wording before use. Direct explanation access, readable meaning/check/next-step cards and tone/fact clarification reduce guessing at the Understanding → Review stage. TED still proposes changes for explicit review and Apply/Discard; explanations never edit or persist documents.

Trace reviewed: WorkspacePane → SectionEditor → ExplainWithTED / useExplainWithTED → shared explainSection client and response validation → existing gateway → explain-section authentication and output validation → existing provider router and explanation prompt. EditWithTED also serves checklist and artifact screens. No competing document store, provider policy, response schema, persistence route or approval authority was introduced.

Review covered cancellation, immediate/duplicate requests, late responses, changing owner/wording/selection, unmount cleanup, error/retry presentation, typed instructions, accessible text rendering and proposal approval boundaries. Real-provider quality and customer satisfaction remain unverified.

## Fresh local verification

| Command / check | Result and evidence boundary |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; reviewed lockfile already current |
| Focused Vitest run of WorkspaceAssistance, useExplainWithTED, SectionEditor revision editing, TedChangeReview, ArtifactActionScreen and SectionedChecklistScreen | 70 tests passed across six files |
| `node scripts/verify-workspace-guidance.mjs` | Passed at 1440×1000 and 390×844 using real components/CSS and controlled provider hooks |
| Browser assertions and visual inspection | Explanation visible and structured, no horizontal overflow or page jump, tone requested before dispatch, review/discard required, cancellation ignores late reply, retry succeeds, section history resets; desktop tone and narrow explanation screenshots inspected |
| `pnpm verify:web` | Passed deployment-contract tests and validation, lint, types, root script tests (223), shared tests (423), web tests (1,138), Next.js production build and progressive bundle checks |
| `deno check supabase/functions/*/index.ts` | All 26 active entry points passed |
| `deno test --allow-env --allow-read supabase/functions` | 1,586 tests and 220 steps passed; zero failures |
| Tracked-file hashes before/after execution | No unexpected modification |
| `git diff --check`, harness JavaScript syntax | Passed |

The 165 deployment tests also occur in the 223 root script tests and must not be added as unique cases. Local logs are categorised under `.local/verification/github-sync-20260911/`; guidance screenshots, browser summaries and previous run details are under `.local/verification/workspace-guidance-20260911/`.

## Cleanup and categorisation

6,443 untracked historical evidence files were consolidated into `.local/archive/historical-verification-20260911.zip`: 143,258,816 original bytes became 18,165,473 archive bytes. The archive stores 2,176 distinct content objects, eliminating 4,267 duplicate stored copies. Every object and every original file was SHA-256 checked before loose originals were removed. Tracked files were not removed. No literal dependency on the archived untracked paths was found in tracked package scripts or CI workflow files.

The original-path/hash/mode manifest is inside the archive. Its SHA-256 is `b306a4da179b743990153b70c3f3f4eb3d2c0b3e3303997957ced183ae075673`. The private cleanup receipt lists the reference moves and their hashes. Current guidance verification material was categorised separately with 27 hash-verified moves.

- Architecture and clarification HTML maps: `.local/reference/maps/`.
- Loose `Untitled 2.rtf`: `.local/reference/documents/untitled-2.rtf`, byte-preserved.
- Environment files/backups, installed dependencies, active coordination and Docker storage: retained at their existing tool-defined locations.
- Local reference/archive/tooling and reproducible output are ignored to prevent accidental publication.
- [Repository guide](../../REPOSITORY-GUIDE.md) describes canonical source, tests, plans, evidence, local references and unfinished work.

## Exact publication inputs

Guidance source and regression inputs:

- `apps/web/src/components/organisms/EditWithTED.module.css`
- `apps/web/src/components/organisms/EditWithTED.tsx`
- `apps/web/src/components/organisms/ExplainWithTED.tsx`
- `apps/web/src/components/organisms/SectionEditor.module.css`
- `apps/web/src/components/organisms/SectionEditor.revision-edit.test.tsx`
- `apps/web/src/components/organisms/SectionEditor.tsx`
- `apps/web/src/components/organisms/editor.test.tsx`
- `apps/web/src/components/organisms/WorkspaceAssistance.test.tsx`
- `apps/web/src/hooks/useExplainWithTED.ts`
- `apps/web/src/hooks/useExplainWithTED.test.tsx`
- `apps/web/src/test/browser/workspace-guidance-actions.ts`
- `apps/web/src/test/browser/workspace-guidance-harness.html`
- `apps/web/src/test/browser/workspace-guidance-harness.tsx`
- `scripts/verify-workspace-guidance.mjs`
- `supabase/functions/_shared/prompt-builder.test.ts`
- `supabase/functions/_shared/prompt-builder.ts`

Organisation and reviewed evidence:

- `.gitignore`
- `docs/REPOSITORY-GUIDE.md`
- `docs/evidence/github-sync-20260911/Audit.md`
- `docs/evidence/workspace-guidance-20260911/Verification.md`
- `docs/evidence/workspace-guidance-20260911/final-source-manifest.json`

## Release and evidence limits

At the live pre-publication check, Netlify site `aiprompted` (`f278cbcf-0161-43f7-a132-fd224aef2d9f`) still published locked deploy `6a9fc526610f2efb8c05454f`, commit `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. GitHub production deployment is separately triggered by `workflow_dispatch`. This task does not unlock or replace production, deploy Edge Functions, apply hosted migrations or change secrets.

**Implemented / verified locally / workflow exercised:** the bounded guidance change and verified local organisation described above. **Verified in CI:** only the baseline run is established in this pre-publication report; check the exact pushed revision's new CI run separately. **Production exercised / persistence proven / export inspected:** no new claim from this task. The browser fixture is transient, and the changed explanation prompt requires a future authorised function release to take effect on the hosted backend.

The final local/remote commit identities and CI result belong to the post-push receipt. Source equality is established only after the live remote ref matches local HEAD and the published tracked files have no remaining worktree or index differences.
