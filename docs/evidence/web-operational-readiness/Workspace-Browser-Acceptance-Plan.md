# Master Workspace browser acceptance

Prepared 7 September 2026, Australia/Melbourne. Status: implementation preparation;
no browser workflow has passed this plan yet. Base HEAD remains `e1d514d` with the
recorded local overlay. The latest fresh SQL and complete web gate passed in
`db-20260907100737954-50e0967b` (2,167 SQL assertions, 321 shared and 937 web tests).

The flow under test is: sign in to the disposable local app → open Master
Workspace → select a retained original → reload or reopen it in another tab →
download bytes matching the stored original → sign out/change owner without
exposing the previous owner's source.

## Tooling and authority

- The owner explicitly requires Playwright dependency/configuration, real fixture
  bootstrap and CI invocation in WP7. The Browser plugin and `browser` skill are
  absent: **Browser plugin not available**. Ordinary Playwright is selected under
  the frontend testing and debugging skill; no plugin changes are needed.
- Pin the root development dependency to `@playwright/test@1.63.0`, the stable
  version observed on the [official npm package](https://www.npmjs.com/package/%40playwright/test).
  Use Node 22.23.2/pnpm 10.33.0. The [official installation requirements](https://playwright.dev/docs/intro)
  support Node 22 and macOS 14+. Install Chromium into ignored repository-local
  `node_modules/.cache/playwright`; begin with one worker.
- `install-browser-acceptance-dependency.mjs` records the before/after source
  hashes and permits changes only to root `package.json` and `pnpm-lock.yaml`.
  It does not scaffold over existing tests or execute app/provider workflows.
- Claim revision 30 includes `tests/e2e`, `playwright.config.ts` and the existing
  CI workflow, preserving all earlier path claims. No conflicting claim exists.

## Application and database integration

1. Add a bounded workspace-read upgrade probe under the existing isolated runner.
   The runner remains the sole owner of target attestation, historical reset,
   migration application and resource cleanup. Pin the exact reviewed
   `20260907112000` → `20260907124000` migration pair and all-current SQL inputs;
   do not weaken any earlier version-specific probe.
2. Create two real local authenticated owners and actual Storage originals before
   denial checks. Preserve historical NULL/v1/v2 imports and complete v3 text
   imports. Keep v3 PDF/DOCX/RTF as source-only records, as required by 112000.
   Compare existing rows and original hashes before and after the read migration.
3. Build the web app with explicit child environment values:
   `NEXT_PUBLIC_APP_ENV=local`, Supabase URL `http://127.0.0.1:58321`, and the
   identified disposable instance's anon key. Keep credentials out of evidence.
   The prior test build embeds its earlier URL and cannot be reused through
   `next start` environment changes. Preserve the production project reference
   injected by the existing deployment contract.
4. Use the real sign-in UI and existing public read RPCs and Storage SDK. Check
   list/detail identity, pagination, missing originals, unavailable reads,
   reload/new-tab continuity, original download filename/length/hash and owner
   isolation. Capture desktop and narrow-browser screenshots, relevant console
   diagnostics and independent database reads with synthetic facts only.
5. Wire only the new executable acceptance scope initially. The obsolete
   anonymous/test-outcome-id core-loop files remain an explicit WP7 gap until
   replaced by their own seeded journeys; they must not be represented as run
   or passed by the retained-original suite.

## Evidence limits

This slice proves browsing and downloading already retained source files through
the real app and services. It does not yet prove the file-picker upload journey,
RTF activation, extraction/model execution, format-preserving editing, approved
export, production deployment or the complete catalogue. Each remains a separate
required gate in the main evidence register.

## 7 September, 21:03 Melbourne — implementation prepared for first execution

The tooling job `job-mtr3l4hy-4bcc6930` passed in about117 seconds. Independent
comparison against the saved pre-install files confirms exactly three added
packages (`@playwright/test`, `playwright`, `playwright-core`, all1.63.0), with
existing Next/Sentry lock identities changing only to resolve Next's optional
Playwright peer. Frozen install and Chromium installation passed. No unrelated
versions or scripts changed during installation; existing Vite/Sentry peer and
deprecated-package warnings predate it.

Implemented the separate workspace read/upgrade probe, the existing runner's
exclusive `--workspace-read-browser-acceptance` mode, a finite browser exercise,
`playwright.config.ts`, the retained-original spec and bounded private fixture
loader. `pnpm test:e2e:workspace` invokes this Mac-local isolated workflow. The
runner still owns all Supabase reset/migration/cleanup; its browser exercise owns
one Next process group and one finite test process group. Build/start environment
uses the actual local public anon credential only. Passwords remain outside the
web build/server environment; traces/video are disabled and text diagnostics
redact passwords/JWTs without changing downloaded originals.

The probe creates25 sources for two positive authenticated owners, including12
actual original objects, a completed v3 source, nine expired modern checkpoints,
failed and missing originals, and one genuine historical import. It preserves
all domain rows across112000→124000, checks exact list/detail state, keeps the
microsecond pagination cursor, and verifies download bytes via the returned
Storage path. Browser projects cover1440×1000 and390×844, one worker, no retries.

**Verified locally (preflight only):** 77 existing/new upgrade and rejection
guard tests,12 fixture-boundary tests, strict browser TypeScript, syntax and
diff checks passed. ESLint evaluated the four TypeScript test/config files with
no rule diagnostics; its reused Next configuration emitted root-level React/
pages-directory auto-detection notes. The exact isolated preflight
`db-20260907105959393-85377ba4` passed before any services started. Independent
SQL/API fixture review is clear. Actual browser and migration-upgrade execution
remain pending; the test files are not yet invoked in CI.

Final independent browser/process/fixture review: **PASS** after the cleanup,
path and diagnostic corrections. Final exact-input preflight
`db-20260907110417786-49449f7c` passed, including the explicit same-origin API
environment override. `workspace-browser-inputs.json` binds11 changed tooling,
configuration and test inputs. The next finite execution is the actual fresh
and historical-upgrade/browser gate; these preparation results do not preclaim
its outcome.

## 7 September, 21:29 Melbourne — first combined run diagnosed

`job-mtr4w5rg-fdd72370` / `db-20260907110503663-7ab776c9` exited1 after164 seconds.
**Verified locally:** 76 fresh migrations and2167 SQL assertions/45 files; exact
112000→124000 migration application;124 real local Auth/PostgREST/Storage checks;
12 independently byte-checked originals;25 uploads and the existing outcome,
document and section unchanged immediately after upgrade and after HTTP reads.
The local-bound production web build passed and its owned Next server started
and stopped cleanly. The later full web gate also passed (321 shared/937 web
tests, lint/types/build/bundles). All828 source hashes, HEAD, tracked diff and
pre-existing Docker resources matched at completion.

**Blocked at browser discovery:** Playwright clears outputDir after reading its
configuration, before importing the test specification. The fixture loader
incorrectly required that child directory to exist on every load, so it raised
`ENOENT`. Zero browser tests ran; no screenshot or browser workflow proof exists
from this run. The upgraded full SQL rerun was not reached after that failure.
The migration/HTTP checks above remain distinct evidence, not a complete upgrade
or browser gate.

**Implemented; Verified locally (regression):** a deletion/re-admission test failed
with that exact `ENOENT` (1 failure,12 passes) before the correction. The loader
now requires the exact canonical parent and all run/manifest/original identities
while permitting Playwright's absent output child. Existing symlink/file children
remain rejected. All15 fixture tests and strict types pass; focused ESLint has no
rule diagnostics, with the previously noted root-level framework detection notes.
The cleanup path also treats that exact absent directory as no diagnostics,
preserving the original failure. Independent admission review confirms the actual
installed Playwright lifecycle and the retained path protections. The corrected
browser run remains **Unverified** until execution.


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


## Next bounded slice: actual new file-picker upload

Independent read-only caller/SQL/provider tracing identified these activation
prerequisites, without changing them in the layout slice:

- Shared preflight has no RTF entry. Add an explicit new policy version with
  format rtf, canonical/alias MIME support and the existing1MiB RTF source limit;
  preserve earlier frozen versions, deterministic request IDs and binary limits.
- Production ingest claims omit extraction version, so fresh requests select
  the SQL default .1. Explicitly request .3 server-side while preserving that SQL
  default and each accepted historical request's stored version/terminal receipt.
- The browser success parser requires trimmed extracted text. V3 preserves
  checkpoint whitespace. Add exact v3 policy/format evidence validation and
  regressions through the public parser; never trim the stored source to make
  the parser pass or relax historical response identities. Trace the existing
  eight-key success/settlement contract before any response-shape change.
- Declare112000 source-import guard as an ingest deployment prerequisite before
  v3 activation. Keep124000 web owner-read prerequisite and backend-first rollout.
  PDF/DOCX/RTF/XLSX/truncated sources stay retained originals, never generic HTML
  editor imports. This activation is not preserving-edit implementation.

Use the actual file picker, web gateway, Auth, production ingest/extract entries,
private extraction checkpoint, Storage, settlement and owner readback. Controlled
classification must remain an explicitly synthetic local boundary. A test-only
exact Responses transport can keep the existing route/capacity/attempt accounting
in the exercised path; do not change production provider routing to enable it.
The isolated runner currently excludes Edge runtime. Any added finite local
front door/processes must remain owned by its exact disposable instance and keep
existing closed origin/secret/cleanup protections. Docker-internal HTTP is not an
approved extraction/storage origin; do not widen that guard for tests.

Required cases include PDF,DOCX,UTF16 TextEdit TXT,RTF,MD (preserving existing
XLSX/CSV); original byte/hash verification, exact persisted checkpoints, reload,
same-file replay without another provider call, lost completion acknowledgement,
rejected extraction without classification, and original recovery after failure.
Raw-text editing, protected format editing/export, real model evaluations, CI
integration, Profile and hosted acceptance remain subsequent gates.


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
