# Master Workspace original browsing and protected import handoff

**Implemented; locally verified retained-original browser workflow, fresh and upgrade database acceptance, and full web gate. The narrow-layout correction is browser-verified; an adjacent web unit-test sequencing correction awaits the broad web gate. File-picker upload, preserving edits, CI and production remain pending.** Target remains `/Users/kaichurchw/PrompTED.AI`, `Thought-Enhanced-Document`, HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the current overlay. Claim revision 30 has no overlapping executable writer. No hosted mutation, provider dispatch, catalogue activation or original data rewrite occurred.

## Change and authority

The Master page previously offered only import review. It rebuilt binary extraction previews as generic editor sections and could not reopen a retained original after classification failure. Existing `uploads` and private `original-documents` Storage remain authoritative. New migration `20260907124000_workspace_upload_reads.sql` adds two owner-read RPCs and one private projector, without table grants, persistence stores or mutation commands. Fixed 20-row keyset paging preserves microsecond cursors. Detail separates original catalog availability, persisted upload/ingest status, read-only preview completeness and owner-verified historical document links. Full manifests, leases and provider responses stay private. Unknown or absent original availability is never byte verification.

The shared `ingest-upload.ts` contract validates exact envelope/owner/resource identity, closed keys, discriminants, sizes, paths, preview bounds (20000 Unicode code points), duplicates and cursor identity. `import-workspace.ts` uses the existing owner client for reads and rereads the selected source before downloading. The installed Storage SDK streams encoded exact path segments with no-store/error-on-redirect Fetch options. A fixed buffer bounds bytes at the recorded length/8 MiB, a 30-second absolute deadline bounds elapsed time, and read/empty-chunk limits bound work. Available accepted SHA evidence is checked before Blob creation; absent historical SHA is not invented. Every read, EOF, hash and return rechecks owner/selection/deadline. Readers, cancellation listeners and temporary URLs are cleaned up. The owner transport now cancels a Response body that arrives after lease retirement, without waiting on potentially stalled cleanup or replacing the original stale error.

`RetainedWorkspaceUploads` adds owner-scoped list/detail/refresh/pagination and original download on `/workspace?upload=<uuid>`. The selected file precedes the importer on deep links. Preview text is inert and keyboard-readable in a labelled read-only control. Missing and failed reads are separate states. Owner, selection, refresh and unmount retire requests; a same-tab link click retires a download immediately before navigation commits. Changed account epochs hide stale content and offer reconnect. Existing historical document links remain available separately. Download UI says prepared for download, not saved to disk or exported.

Master import now captures the existing prepared upload ID without changing its identity-bearing situation text. Binary and truncated results lead to the retained original view instead of manufactured editor sections. Classification/transport failure can read back the same ID; a failed read leaves retention unknown. Existing complete text review remains owner-entered wording and is **not** raw TXT/Markdown formatting-preservation proof. PDF/DOCX/RTF preserving editing and export still require subsequent implementation. RTF/new-v3 admission has subsequently been implemented locally with focused regressions; see `Upload-Source-Admission-Verification.md` for its separate broad/browser/hosted gates. XLSX/CSV admission remains present.

## Verification and bounded evidence

- The new read parsers first had 22 intended failures because the read API did not yet exist; 27 prior cases passed. Current shared focused suite: **51 passed** (`workspace-upload-contract-green.log`). This is a feature absence reproduction, not 22 production defects.
- The owner transport regression reproduced **1 failure, 6 passes** on the prior implementation: a late response body was not cancelled (`workspace-upload-owner-cleanup-red.log`). Its fix now passes.
- Current web focused checks: **78 passed in 5 files**, covering import receipts, source handoff/recovery, real installed SDK URL/stream boundaries, limits/timeouts/digest rejection, late owner cleanup, selection/account/deep-link initial reads, inert previews and existing workspace navigation (`workspace-upload-web-focused.log`).
- Web and shared type checking passed. Focused web/shared lint passed. The initial direct ESLint invocation bypassed pnpm's generated NODE_PATH shim and could not resolve the Next plugin; rerunning with the existing pnpm shim resolved that invocation issue without dependency installation or a configuration change. A preview tabindex lint finding was corrected with a native read-only text control.
- Static migration validation: **76 files**. Deployment contract: **26 functions**, plus the two new declared browser RPC dependencies and signatures. `git diff --check` passes.
- Source review: SQL/fixtures and browser/download boundaries independently reviewed; final review found no blocker. No-service preflight `db-20260907100302352-5856b06a` passed before the final reconnect tests/copy changes. Full isolated acceptance is next.

SQL tests positively create two owners, historical source rows and exact Storage catalog entries before denial checks. Current v1/v2/v3 checkpoints use real claim/advance/record commands and explicitly expired leases. The suite covers unknown historical completeness, partial checkpoint format, Unicode clipping, missing/malformed/contradictory Storage metadata, unchanged owner grants, committed destination and mismatched linkage, equal-timestamp pagination and anonymous/other-owner denial. Catalog fixtures are not uploaded bytes or an authenticated HTTP/browser exercise.

## Remaining gates

Fresh and exact-upgrade SQL plus retained-original Auth/PostgREST/Storage/browser read and download acceptance now pass as recorded below. Next verify the narrow-layout correction and exercise actual new file-picker uploads. Actual PDF/DOCX format-preserving editing, raw text/Markdown round-trip representation, RTF activation, full export inspection and the broader WP0–WP10 release gates remain unverified. This is an intermediate source-protection and retrieval milestone, not completion of the flagship editing feature or the entire app.


## Fresh database and full web gate — 20:09 Melbourne

`job-mtr2ub1m-8c54687c` passed in 105 seconds, evidence `db-20260907100737954-50e0967b`. All 76 migrations and all 2167 database assertions in 45 files passed, including 68 new owner-source-read assertions. Full `pnpm verify:web` passed through production build and progressive bundle checks: 321 shared tests and 937 web tests. Completion inspection confirmed unchanged HEAD, all 823 source files, the tracked before/after diff and Docker resource inventories; see `completion-comparison.json`. This proves the new SQL and current integrated local gate, not an authenticated browser or hosted workflow. Next is local original browse/reopen/download acceptance through real Auth, PostgREST, Storage and the web UI.


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
