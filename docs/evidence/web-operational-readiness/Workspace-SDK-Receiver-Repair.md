# Workspace and deferred section SDK receiver repair

**Implemented; Verified locally; Workflow exercised; Persistence proven (local).**
`Thought-Enhanced-Document` at `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus
the recorded overlay in `/Users/kaichurchw/PrompTED.AI`. Current root instruction
and claim30 boundaries retained; no staged/publication/hosted/provider change.

## Reproduction and cause

Actual browser run `job-mtrer7m2-12063d31` failed in both desktop and narrow
projects after Markdown import returned HTTP200. Reload rendered the explicit
“Your saved workspace is temporarily unavailable” boundary. There was no
`get_workspace_snapshot_v1` request in the local proxy. Screenshots were opened
and inspected. PDF,DOCX,RTF,UTF16LE/BE TextEdit TXT and UTF8 TXT had already
uploaded,reopened,replayed and downloaded. All12 downloaded artifacts were
independently compared with run inputs; bytes and hashes match.14 controlled
classifier dispatches occurred. Markdown final DB proof and CSV were not reached.

The server loader extracted `supabase.rpc` into a local variable and called it
without its receiver. The actual installed Supabase SDK2.108.2 method invokes
`this.rest.rpc`,so it threw before network dispatch;the existing catch correctly
returned unavailable. The same defect existed in `fetchWorkspaceSectionBody`,
used by `useWorkspace` for deferred body loading and save preparation. Existing
mocked `vi.fn` RPCs did not need a receiver and therefore missed both failures.

Actual-SDK regression before repair:server2 failures/4 passes,exactly zero
expected POST calls;section1 failure/6 passes,with the real SDK TypeError reading
`this.rest`. See `workspace-sdk-receiver-red.log` and
`section-sdk-receiver-red.log`. No hosted cause is inferred from this local run.

## Smallest coherent correction

`apps/web/src/lib/workspace-initial-state.server.ts` and
`apps/web/src/lib/api/sections.ts` now call `supabase.rpc(...)` directly. Removed
only the detached callable assertions and now-unused response interface. Inputs,
RPC names,args,owner lease,transactional snapshot/adapters,revision/body digest
checks and fail-closed behavior are unchanged. No schema or persistence path was
added. Source review independently confirmed both causes and found no further
detached-RPC instances in the targeted production source search.

The two corresponding test files instantiate the real installed SDK with
controlled transport;server authentication is controlled for this focused test.
They check exact RPC POST bodies and actual decoding. The server test also
requires a foreign-owner response to remain unavailable. Existing malformed,
stale-revision/digest and lease tests remain. These are not real hosted Auth/DB
proof;the next actual local browser run retains those boundaries.

Focused GREEN:32 tests across5 files (server loader,snapshot adapter,owner client,
section loader,useWorkspace). Web types and focused ESLint pass.
`workspace-section-sdk-receiver-green.log` records the test result.

## Evidence and harness correction

Failed-run evidence:`db-20260907154108941-cf51607a/completion-comparison.json`.
76 fresh migrations/2175 SQL across45 files and complete web gate379 shared/941
web tests,lint/types/build/bundles passed on that pre-repair overlay.833 source
hashes,HEAD,tracked diff and Docker resources were unchanged. This does not
verify the later receiver repairs.

The nested harness mislabeled a completed exit1 Playwright command as a cleanup
failure and obscured the original browser failure. All Deno children actually
stopped with SIGTERM,Next exited0,and disposable cleanup passed. The old runtime
artifact is preserved;the completion comparison explains this defect.

The new pure disposition helper distinguishes work failure from cleanup failure,
preserves the primary exception,tracks intended shutdown/necessary force,and
continues remaining cleanup after diagnostic-write failures. Four focused cases
and14 transport cases pass. The browser now persists partial per-file stages,
actual import receipts and `complete:false` before later assertions;failure
reads only bounded rows for the exact synthetic owners before teardown. Partial
reports cannot satisfy the full acceptance roster.

**Unverified:** complete new browser flow after these fixes,independent final
accounting/document proof,broader web gate on the fixed overlay,CI,deployment,
profile browser flow,live model evaluation,format-preserving edits and approved
generated exports. These changes do not claim the entire app is complete.

Final source review passes both direct-method repairs. The harness now binds
import receipt observation to the exact proxy origin and POST method,and a
failed final report write preserves an earlier browser assertion. Updated
preflight `db-20260907155802682-d32f3ba6` passed;the final receipt-predicate/report
changes were subsequently typechecked and linted. The forthcoming full run
fingerprints the final sources again. No required browser assertion was relaxed.

## Completed re-test — 8 September 2026

Job `job-mtrfetyh-3791d4c6` exited0. Saved detailed results and artifacts were
inspected; this supersedes the pending local browser/broad-gate statements above.
Evidence: `db-20260907155930992-74ef6363/completion-comparison.json`.

Both desktop1440×1000 and narrow390×844 browser projects passed with one worker,
no retries and no skips. The actual snapshot and deferred section RPCs returned
200; both Markdown workspaces reopened after reload and displayed both exact
saved sections. Repeat import returned the same destination. Independent SQL
proved the owner, document/outcome link and ordered section wording.

All16 new uploads completed across PDF,DOCX,AppKit RTF,UTF16LE/BE and UTF8 TXT,
MD and CSV. Actual downloaded originals were independently compared with inputs:
all16 byte lengths and SHA256 values match. Desktop/narrow source-view screenshots
were opened and visually inspected. These are original downloads, not generated
approved exports or proof of format-preserving editing.

Fresh76 migrations and2175 SQL assertions/45files pass. Full web gate passes:
379 shared and944 web tests,lint,types,production build and progressive bundles.
All833 source hashes,HEAD,tracked diff and Docker resources match before/after.
Execution and cleanup independently pass; private fixture credentials removed.
The16 classifier calls use controlled synthetic Responses transport, with real
local Auth/RPC/Storage, production ingest/extract entrypoints and independent
accounting/Storage proof. No live provider or hosted claim is made.

**Unverified:** CI,hosted deployment/production,Profile browser journey,XLSX new
chooser,the full failure matrix,live model evaluations,format-preserving edits
and approved generated exports. Full application acceptance remains open.
