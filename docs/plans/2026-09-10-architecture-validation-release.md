# Architecture validation and release plan

## Target and acceptance

The owner requested review of the architecture atlas, validation of its seven
suggestions, implementation of accepted repairs, review/integration of outstanding
work, and deployment of a functioning PrompTED app. The target is the existing
`voltlead26-creator/PrompTED.AI` repository, `Thought-Enhanced-Document`, inspected
at `77e48ed20893a3bc33f738ee700510793ba6abd7`. The atlas matches that HEAD but
also includes uncommitted source. Historical `reliably-prompTED` belongs to the
older repository and is not the release target.

Completion requires an attributable reviewed commit, required local and CI
checks, compatible hosted database/functions, exact Netlify release identity,
and synthetic signed-in facts/clarification/generation/edit/save/reload/retry/
cancel/approve/export acceptance with independent persistence and artifact checks.
Build success alone does not satisfy this request.

## Suggestion decisions

| Proposal | Decision | Implementation or evidence gate |
| --- | --- | --- |
| Preserve export receipts | Accept: concrete defect | Shared `renderExport` through real gateway loses captured ID and approved count. Add failing integration regression, forward the two existing public headers, preserve identity rejection and private caching. |
| Separate endpoint deployment and capability readiness | Accept direction; contract migration requires a full consumer slice | `active` currently means deploy/allowlist, not successful feature readiness. Research/live-source/report intentionally gate. Preserve routes and their authentication; introduce readiness only through the existing contract and migrate validators, handler codes and UI together. Do not label other endpoints operational merely because deployed. |
| Complete dormant billing before enabling checkout | Agree with keeping it unavailable | SDK helper has no installed SDK/runtime integration; identity binding, real offerings, cancellation, webhook ordering and Supabase entitlement reconciliation are prerequisites. No paid checkout activation or invented success. |
| Split export orchestration | Defer | Module size is not a reproduced defect. Characterise legacy/captured lifecycle, storage ambiguity, approval and artifact behaviour before a maintenance-driven extraction. |
| Retain and test same-origin gateway | Accept | Cover receipt identity/binary bytes, methods/auth, SSE, cancellation, errors and private cache headers. Deployed adapter still needs live acceptance. |
| Consolidate upload function hop | Defer pending measurement | Compare p50/p95, memory, request limits and recovery. The separate extraction worker may be beneficial. Do not remove it or its identity boundary on a static map's suggestion. |
| Prove background recovery | Accept verification work | Existing database operations/leases remain authority. Exercise accepted/provider-started/persisting interruption, expiry, replay, cancellation, exactly-once allowance and stale-write rejection. No speculative queue. |

## Ordered work

1. Reconcile source and ownership. Preserve the foreign owner-access design claim.
   Record tracked, staged and untracked files, source digests, runtime and remote.
   Review source separately from generated logs, screenshots, local tooling and
   incomplete database work. Never stage the entire worktree indiscriminately.
2. Repair export metadata and run the gateway/shared-client contract regressions.
3. Review and verify existing recovery, retained-text import, paragraph rendering,
   navigation and DOCX source-unit changes. Keep the unfinished source-binding
   migration/test explicitly incomplete; it must not enter a release as a no-op.
4. Run the full web gate, Edge types/tests and isolated database/upgrade checks.
   Compare source before and after. Reproduce failures and repair coherent defects.
5. Review open Netlify PRs against current contracts. PRs 1 and 2 change workspace
   enumeration/build wrapper/base assumptions and are not safe to merge as-is.
   Merge only changes still necessary and independently verified on current HEAD.
6. Prepare exact reviewed commits and verify CI. Source publication does not
   authorize claiming backend or production compatibility.
7. Resolve hosted release prerequisites with the existing deployment contract:
   exact migration-ledger reconciliation, missing functions/RPCs, dormant and
   undeclared function inventory, and approved OpenAI capacity/routing/evaluation
   inputs. Rehearse the exact upgrade before hosted mutation; preserve history.
8. Deploy compatible backend before frontend to Netlify `aiprompted`, site
   `f278cbcf-0161-43f7-a132-fd224aef2d9f`, production URL
   `https://ted.littlemissscarlett.co`. Revalidate live linkage and baseline first.
   Preserve the last known deployment and additive-schema recovery options.
9. Exercise the actual signed-in workflow and inspect real exports. Report each
   gate independently, including any unavailable feature or unresolved blocker.

## Live prerequisites identified during this review

Read-only hosted inspection on 10 September found 68 recorded migrations,
25 functions, and no workspace-upload read/source-completion RPCs. The local
tree has 81 implemented migrations plus one unimplemented DOCX-binding scaffold.
`extract-upload`, `document-operation` and `brand-logo` are absent live.
The production Actions environment has fast/deep model names but lacks the
other 12 required model/routing/evaluation/capacity inputs. No values were exposed.
The active Netlify deploy remains `6a9fc526610f2efb8c05454f`.

The live attestation RPCs separately returned `configured:false` for all four
capacity routes and all four routing/evaluation routes. Netlify confirms the
current production deployment is locked and still serves `e1d514d`, not the
inspected source HEAD. Source publication must preserve that lock until the
compatible backend and actual workflow acceptance are ready.

## Verification on 10–11 September

- The new shared-client/gateway regression failed with
  `CAPTURED_EXPORT_RESPONSE_INVALID` before the two-header repair. All eight
  gateway tests subsequently passed, including unchanged bytes/filename/count,
  exact receipt acceptance, stale/missing receipt rejection without retry,
  authentication forwarding and private-response protections.
- The complete web gate passed under Node 22.23.2 / pnpm 10.33.0: 165
  deployment tests, 223 root tests, 423 shared tests, 1,110 web tests, lint,
  type checks, production build and progressive-bundle checks. An initial new
  test type error was corrected with a checked optional mock-call read before
  the full rerun passed.
- Deno 2.9.5 checked every active entry point. All 1,585 Edge tests and 220
  steps passed. The two historical upgrade guard suites passed independently.
- The first database run stopped before SQL while attempting to read the
  untracked 994,609,987,584-byte logical Docker virtual disk. An exact
  `/DockerDesktop/Docker.raw` ignore rule excludes that runtime artifact from
  source inventory without deleting or reading it; the runner was unchanged.
- The rerun applied the current migration set to a fresh disposable database.
  Across 51 SQL files / 2,656 assertions, exactly three assertions failed in
  the unfinished DOCX source-binding test: the missing command, document and
  literal section. The other 50 SQL files passed. The final web gate, source
  fingerprint comparison, HEAD/diff stability and disposable cleanup passed.
  Evidence run: `db-20260910135629950-8d1b6453`. The complete DB gate is FAILED,
  not green. The empty migration and its failing test are excluded from the
  reviewed source commits and remain available for their implementation.
- Both open PR heads were evaluated against the current Netlify validator.
  Each fails because it reintroduces three unreviewed secret-scan exemptions;
  PR 1 additionally removes `packages/shared` from workspace enumeration.
  Current HEAD passes the same check. Neither PR is accepted for merger.
- Signed-in production Home, Master Workspace, My Work and Settings were
  inspected. My Work lists existing resources; this is read-only availability
  evidence, not new generation, saved-edit, upload or export acceptance.

The outstanding reviewed web changes retain browser wording for explicit
recovery, reopen retained text review without reupload, preserve paragraph
display in the editor and dismiss the Create menu correctly. The reviewed
DOCX helper changes are source-only adapters with no activated source-binding,
editing, approval or export path. Their tests passed as described above.

These are release dependencies, not permission to bypass validation, fabricate
attestations, rewrite applied migration history, delete functions, or activate
an unverified feature. A deploy cannot be described as a fully functioning app
while these prerequisites and workflow evidence remain absent.
