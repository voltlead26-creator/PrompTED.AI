# Profile refresh repair and browser acceptance preparation

**Implemented; Verified locally; Workflow exercised; Persistence proven (local).**
8 September 2026,Australia/Melbourne. Repository `/Users/kaichurchw/PrompTED.AI`,
branch `Thought-Enhanced-Document`,HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`
plus recorded overlay. Claim30 includes all changed paths; foreign design claim
untouched. Node22.23.2,pnpm10.33.0,Deno2.9.5. No hosted/provider/publication change.

## Trace and reproduced failures

The TopBar's `Your profile` link opens `/settings/profile`. AuthProvider remounts
on owner identity. Profile reads owner-scoped `profiles` and
`profile_resume_versions` with an explicit `uploads!inner` resource projection.
The existing local `20260906010846_profile_resume_upload_reads.sql` supplies the
six required upload-column grants under existing RLS; prior real local Data API
acceptance reproduced the old403 and verified this repair. Profile opening and
personal-detail saving require no Edge Function. Saving uses the existing
`update_own_profile_details` RPC,which derives its owner from Auth and leaves
privileged/accounting fields outside the writable projection.

Source review found two adjacent page failures. Resume upload/restore calls
`reload`,which previously replaced all personal form values and saved baseline.
That discarded unsaved edits and could undo a just-completed save in browser
state. `reload` also swallowed read failures; callers then showed ordinary
success while stale resume cards remained with no visible error.

`profile-refresh-red.log`:6 intended failures/7existing passes before repair.
Four failures lose edited/saved values;two cannot find the required refresh
alert. The initial reproduction exposed queued-mock spillover after failures;
`resetAllMocks` isolates each case and the saved RED was rerun for the intended
reasons. No existing expectation was weakened.

## Changes and focused evidence

- `apps/web/src/app/(app)/settings/profile/page.tsx`: explicit boolean reload
  result; resume refresh/retry preserve the form and its saved baseline; initial
  load still hydrates them. Failed post-mutation reads show the acknowledged
  change plus unavailable refresh,and an in-page stale-resource alert. Resume
  actions are disabled while loading or stale;retry only repeats the read.
  Personal edits/save remain available;no extra state store or command is added.
- `ProfilePage.test.tsx`:dirty edits before/during upload and restore;failed
  refresh/retry;initial read failure;disabled repeated retry;both completion
  orders of personal save and held resume refresh;newer edits and Discard's exact
  saved baseline. Existing seven tests remain.
- `tests/e2e/workspace-upload.spec.ts`: extends the real two-owner upload journey
  with Profile navigation,one controlled initial resume-read503 and retry,real
  detail save204,reload,independent tab,distinct-field account isolation and
  anonymous redirect. Empty resume state is explicit. No extra upload/provider
  calls or resume fixture writes.
- `workspace-upload-browser-acceptance.mjs`: exact required browser stages;
  independently reads both saved profile rows and compares all non-personal
  fields against pre-run state (excluding the expected updated timestamp),then
  requires owned positive Data API reads and cross-owner empty results. Resume
  slots must remain empty. Existing original/accounting proofs are unchanged.

`profile-refresh-green.log`:39PASS/5files,including14Profile page tests,resource
API/selection/selector and owner-client tests. Web and E2E TypeScript,focused
ESLint and syntax checks pass. Root ESLint prints the known Next pages-directory
configuration note;files were checked,not ignored. Independent source review
passes the bounded production fix. Browser review strengthened distinct-field
owner checks. Preflight `db-20260907162011623-aa5fdafb` passed before that final
assertion refinement;the full run must fingerprint final input again.

## Remaining gates

**Unverified:** the new actual Profile browser/independent DB proof,full web gate
on this overlay,CI,hosted activation and production access. Resume replacement,
restore and signed-URL download still need populated actual browser journeys;
their focused tests do not establish that proof. Missing hosted migrations and
function/configuration alignment remain separate release work. PDF/Word
format-preserving edits,approved exports and wider WP0–WP10 acceptance remain open.

The latest upload-only actual browser proof remains
`db-20260907155930992-74ef6363/completion-comparison.json`;it predates this Profile
change and is not being re-labelled as proof of it.

Final source and SQL/auth review PASS. The distinct owner-field checks now cover
Full name,Preferred name,Contact number and Address line1. Final E2E types/lint,
syntax,diff check and preflight `db-20260907162235853-e9784c5c` pass. Updated
`profile-browser-recovery-inputs.json` fingerprints these final source inputs.

## Actual run and harness correction — 8 September 2026,02:43 AEST

`job-mtrg9aex-2f2019d1` exited1 after225s. Detailed logs/results,all16 downloaded
originals and both failure screenshots were inspected. Evidence
`db-20260907162311989-6f30460d/completion-comparison.json`.

**Verified locally:** fresh76 migrations/2175 SQL/45files and full web gate379
shared/951web tests,lint/types/build/bundles pass on the Profile production fix.
All833 source hashes,HEAD,tracked diff and Docker resources match before/after;
cleanup succeeds and private fixture credentials were removed.

**Workflow exercised (partial):** both browser projects completed8 upload cases,
including original download/replay and Markdown reload. All16 original downloads
were independently byte/hash compared;16 controlled classifier calls. Bounded
failure SQL independently reads16 owned uploads and2 committed Markdown
documents with2 sections each. The final full source/accounting/Storage proof
was not reached in this run. Earlier complete upload acceptance remains intact.

Both screenshots show the Profile form successfully loaded. The test expected an
error after a one-shot temporary503,but the installed PostgREST SDK retries
GET503 by default. A separate actual-SDK controlled reproduction proves that
one503 followed by200 resolves successfully with2 attempts. Holding503 produces
the error after4 attempts; releasing it permits a new successful read.
`profile-sdk-retry.test.mjs`/`profile-sdk-retry-reproduction.log`:2PASS. This is a
fault-injection error,not evidence that production Profile retries are broken.
The old browser report did not record intercepted attempts;the diagnosis combines
its successful actual reads/rendering with the controlled installed-SDK proof.

The corrected harness holds the exact owner resume GET fault across the SDK's
initial attempt and3 retries,records attempt headers,and scopes its alert to the
Profile region (excluding Next's route announcer). Only after the alert does it
remove the fault and click Try again. Synthetic Retry-After0 bounds fixture
latency;production retry policy is unchanged. The independent report requires
attempts0,1,2,3. Preflight also runs and fingerprints the new SDK guard.

Changed-owner checks now compare the form with that owner's real200 Profile GET,
validate its exact11-column response,and retain all prior-owner unique-field
absence checks. This respects the existing preferred-name/display-name fallback;
an untouched synthetic account need not have a blank preferred name.
E2Etypes/lint,syntax and diff checks pass after the harness correction.

**Unverified:** completed Profile failure/retry,save/reload/new-tab/owner-isolation
browser journey and final independent Profile proof;CI/hosted,resume lifecycle,
format-preserving editing/export and full application acceptance. No new
production source/schema/secret/provider changes were required by this failure.

Final corrected-harness source review PASS and preflight
`db-20260907172528555-382f4051` PASS,including the two real-SDK retry guards.
The next actual run fingerprints all final inputs;pending browser claims remain
unverified until its detailed results and artifacts are inspected.

## Completed local browser verification — 8 September 2026

`job-mtriiezl-ea7baaed` exited0 in211s. Detailed results,independent SQL/Storage
proofs,all16 downloaded original byte/hash comparisons and4 saved browser
screenshots were inspected. Evidence
`db-20260907172617062-91024083/completion-comparison.json`. This supersedes the
pending basic Profile browser and independent-proof statements above.

Both desktop1440×1000 and narrow390×844 projects pass with one worker,no retries
or skips. Each exercises the actual Profile link,held read503 with exact
attempts0,1,2,3,visible failure and manual retry,real owner detail-save204,reload,
independent new tab,changed-owner field isolation and anonymous redirect. Both
complete reports have no browser errors or external requests. Independent SQL
and fresh authenticated Data API reads prove exact persisted personal values,
unchanged protected fields and cross-owner denial. Resume slots correctly remain
empty;this does not verify browser resume replacement/restore/download.

All16 Master upload cases also pass with exact original/replay/Markdown-document
and provider-accounting proofs. Only synthetic Responses transport is controlled;
Auth,RPC,Storage,Next gateway and ingest/extract entrypoints execute locally.
Full fresh76 migrations/2175SQL/45files and `pnpm verify:web` pass:379shared,
951web,lint/types/build/bundles.833 source hashes,HEAD,tracked diff and Docker
resources match before/after. Execution and cleanup pass;private credentials
removed. Node22.23.2,pnpm10.33.0,Deno2.9.5;branch/HEAD unchanged plus overlay.

**Unverified:** CI,hosted activation/production,live model quality/cost/latency,
populated Profile resume lifecycle browser,XLSX new chooser/full upload failure
matrix,PDF/Word format-preserving edits,approved generated exports and remaining
WP0–WP10 release gates. This milestone does not claim the whole application is
complete or released.
