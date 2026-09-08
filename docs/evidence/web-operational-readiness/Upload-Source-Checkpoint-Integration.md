# Private upload source checkpoint integration

7 September 2026. Implementation preparation from the current dirty overlay at
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. The lightweight source contract,
combined owned extraction producer and dual-version internal transport are
implemented with focused and broad local proof. The active ingest path remains
v1. The forward migration passed fresh local SQL acceptance and representative
historical upgrade with 39 real local Auth/PostgREST checks. The complete fresh/upgrade acceptance later passed. Dual-reading ingest is
implemented with focused verification; review reopened a v2 lease-clock race
requiring a new SQL regression and correction. Activation remains off. No hosted migration or deployment described here has been
performed. This is not protected-action approval.

The verified DOCX inspector produces source identity, not edit/layout approval.
Keep its manifest solely on the existing private upload checkpoint. The original
remains in private Storage; documents/sections remain the editable authority.
Do not duplicate the map into classification prompts, `extracted_payload`, public
ingest responses, recommendation JSON, Profile projections or browser caches.

## Version and compatibility

Capture an explicit extraction **contract** version on new upload admission,
before extraction. Keep this distinct from the existing resource-policy version:
wire shape/source attribution and resource/parser semantics are different
contracts. An absent historical contract means v1. Existing v1 checkpoints and
terminal responses retain their exact fields/values and are never upgraded on
retry. A resumed claim uses its accepted version, not the new caller's preference.

Use closed result variants. V1 keeps the four-key internal request, nine-key
response, six-key checkpoint and 64KiB transport limit. A new accepted variant
must define exactly when DOCX requires its source manifest and when non-DOCX
requires absence. Do not use an optional manifest as implicit capability
negotiation. RTF requires its own truthful source-format/parser contract and
must not be relabelled as originally plain text.

Select the response ceiling from the accepted request version before reading
untrusted bytes. A larger variant needs independent limits for its ordinary
envelope (64KiB), manifest (1MiB serialized UTF-8) and complete transport.
Error responses keep the small bound. No fallback to v1 after a v2 mismatch.

## Existing boundaries to extend together

| Boundary | Required change |
| --- | --- |
| Lightweight server source contract | Consolidate existing source policies/types/encoding and strict manifest validation without importing XML/PDF/ZIP/provider runtime into ingest. Preserve parser exports through re-exports. |
| Owned extraction | Derive text and source manifest from one owned inspection and cumulative deadline. Do not call both public helpers sequentially and decompress twice. |
| `claim_upload_ingest` | Capture contract version on insert only; append a trailing defaulted argument if the caller selects it. Historical default remains v1. |
| `load_upload_extraction_snapshot` | Return the captured version with the exact owner/request/token/hash/length. Extractor version selection must agree with the snapshot. |
| `begin_upload_extraction_attempt` | Preserve attempt limits, checkpoint-exists precedence and claim/lease rules. Never recapture a version. |
| `record_upload_extraction_snapshot` | Accept the private manifest, validate its source binding, compute its database digest and atomically store it with the existing text checkpoint. Preserve immutable-conflict precedence. |
| `get_upload_extraction_checkpoint` | Preserve exact v1 output; return a strict versioned manifest/digest variant only for new contracts. |
| Ingest record/adoption | Both successful and lost-ACK recording now read, compare and adopt the authoritative v1 checkpoint before dispatch. Extend that proven sequence to the new closed v2 result and DB-owned digest. |
| `sameExtraction` | Compare the entire normalized manifest/authoritative identity, including nodes/ranges/text/blockers, not only archive/roster hashes. |
| `advance_upload_ingest` | New contracts must have the matching checkpoint before provider dispatch; retain deletion and identity fences. |
| `settle_upload_ingest` | New-contract completion must match the checkpoint's text/format/truncation/policy/source identity. Keep historical terminal replay and valid early failures. |

The first two rows now have local implementations:
`_shared/document-source-contract.ts` owns the existing source types/policies,
roster encoding, blocker derivation and bounded manifest normalization;
`extractBoundedUploadWithSource` uses a single owned archive inspection and one
absolute deadline for the existing text extraction and private manifest builder.
Its closed internal result requires a DOCX manifest or explicit non-DOCX null.
The extractor now selects it only when a v2 request agrees with a v2 accepted
snapshot; absent historical versions remain v1. The active ingest and database
still produce only v1. The old text-only API and standalone inspector retain
their signatures and output shapes. A source mapping failure rejects the
combined result, even when text extraction succeeds.

Focused proof is recorded in `Master-Import-Format-Preservation.md`: 159 adjacent
tests, independent review, a real synthetic DOCX through client/handler/combined
reader/client normalization, and earlier independent Python archive/part hash
checks. The full local gate passed in `upload-source-full-gate-20260906154108753`
(834 Edge tests and the complete web gate, unchanged source/HEAD/web dotenv).
Actual Storage/RPC/browser
transport, durable replay, editing and export fidelity remain unverified.

The implemented wire contract uses `upload-extraction.1` and `.2`, while retaining
`upload-resource-policy.1`. V1 retains four request keys, nine response keys and
64 KiB transport. V2 has five request keys and twelve success-response keys,
including exact version, accepted content length and mandatory source manifest
(DOCX object, other formats null). Its client requires the accepted content SHA
and length before dispatch. V2 success allows 1 MiB + 64 KiB + 128 raw bytes;
manifest and ordinary envelope have independent 1 MiB and 64 KiB serialized
ceilings. Errors remain 64 KiB. Fixed storage avoids retaining a per-chunk array;
chunk work is bounded by the selected byte ceiling, with exact one-byte delivery
and one-over empty-chunk tests. Absolute deadlines are checked during reads and
before publication, in addition to the existing timer and cancellation signal.

The handler reuses the existing format/metadata policy to prevent an accepted
DOCX being reported as source-absent text. No private map enters the current
ingest response, provider payload or Profile projection. These compatible readers
do not enable v2 admission or waive the RPC changes and provider/settlement
fences below.

The v1 ingestion readback prerequisite is now implemented with 34 ingest and
169 adjacent tests passing: both write outcomes require an authoritative read;
null/unavailable readback is retryable, a confirmed mismatch reconciles, and
the existing stage CAS fences a claim handoff. Exact v1 public shapes remain
unchanged. The actual RPC normalizer also rejects non-string format values.
Full local re-verification passed in `upload-source-full-gate-20260906155808143`
(844 Edge tests and complete web gate, unchanged source/HEAD/web dotenv).
The later fresh SQL run below proves controlled v2 checkpoint persistence at
the database boundary; active ingest adoption remains v1.

Use one forward migration and existing upload columns/RPC families. The release
probe requires exactly one overload per RPC. When adding defaulted arguments,
replace only the old exact signature transactionally with `DROP ... RESTRICT`,
after dependency inspection; never use CASCADE or keep ambiguous overloads.
Reapply service-role-only execute grants and fixed empty search paths. Update
the exact deployment signatures and migration requirements. Prove old-arity
named and positional calls, including real local PostgREST, still resolve.

## Identity, privacy and validation

The manifest's archive SHA/length must match the accepted upload. Strictly
validate keys/types, versions, bounded arrays/text/paths, sorted unique parts,
method/length/CRC integers, hashes, main-part/source digest equality, ordinal
nodes, range/null rules, and mandatory source-only blockers. Recompute the
declared canonical roster hash. These checks do not independently reconstruct
source XML semantics or validate layout without the original.

PostgreSQL should compute the whole-manifest digest using an explicitly
domain/versioned normalized-JSONB encoding. JavaScript retains it as an opaque
database identity; it must not compare it with a `JSON.stringify` digest. The
existing `office-part-roster-json.1` hash remains separate. Include explicit null
and type checks so SQL CHECK's unknown result cannot admit incomplete state.
Keep new columns outside authenticated grants and the six-column Profile read.

## Required proof before activation

Prove old checkpoints/replays are unchanged; source hash/length/type/version
mismatch rejects; malformed replacement keeps conflict precedence; object-key
order leaves the DB digest unchanged while semantic changes alter it; retries,
two claims and lost acknowledgements adopt one exact checkpoint; no provider
dispatch/settlement precedes required durable proof; and maps cannot leak into
public/provider payloads. Add fresh and representative-upgrade SQL plus real
PostgREST old-call compatibility and positive owner fixtures before denial tests.

Stage compatible readers before new admission: database support with v1 default,
dual-reading ingest/extractor, acceptance proof, then controlled new-version
admission. Rollback readers must continue handling accepted new records.
Existing function-install authorization does not waive release attestations;
hosted schema/grants and activation remain separate exact protected actions.

## Prepared forward migration and acceptance

`20260906160000_upload_source_checkpoint_v2.sql` extends the existing upload row
with accepted extraction contract, private manifest, server digest and digest
version. Historical rows remain SQL null and are never relabelled on retry.
Two exact signatures are replaced with `RESTRICT` and trailing defaults; the
other readers/transitions retain their signatures and service-only execution.
The deployment contract and exact-signature SQL assertion were updated, while
old-arity behavioral calls remain in place.

The SQL normalizer reuses the existing exact-key helper, bounds manifest parts,
nodes, strings and bytes, normalizes integers before hashing, reconstructs the
separate compact roster, and measures compact manifest bytes without deleting
string whitespace. UTF-16 units preserve JavaScript path order and text lengths.
Full Unicode NFC/en-US path-collision detection remains mandatory in the
existing TypeScript normalizer before recording and after reading; SQL defends
exact/ASCII path collisions without guessing the database locale. None of these
checks attests to visual layout or source editing eligibility.

The new v2-only state constraint rejects unknown/null partial tuples. The
trigger protects accepted version and established checkpoint/source identity.
Provider advance requires the checkpoint before same-stage replay as well as
new dispatch. Completion binds exact text, format, truncation, policy, path,
filename and UTF-16 length. Source review identified that extra response fields
could bypass private-column ACLs; closed successful response shapes and bounded
recursive source-field rejection now prevent that path through public replay.
Early failures and historical terminal replay retain their existing behavior.

`upload_source_checkpoint_v2.test.sql` covers genuine synthetic manifest data,
numeric spellings and CRC bounds, Unicode, private reads, idempotent/conflicting
recording, claim handoff, missing checkpoint, completed output identity, source
privacy, non-DOCX explicit absence, early failure and old positional calls.
The disposable runner also prepares real local Auth/PostgREST old named calls,
an expected missing-v2-signature response before upgrade, representative
historical processing/completed rows, exact forward migration, literal history
and null-version preservation, private source readback and independent SQL.
Both owners have positive fixture reads before isolation tests. Deliberately
discarding an application acknowledgement is not a network-drop reproduction.

Source reviews passed after correcting parse-error shielding, target rechecks,
exact pending-migration/history checks and final control-file fingerprints.
Preflights `db-20260906162602265-91b11e8d` and
`db-20260906162955195-b5483ff1` passed without starting services. Final JavaScript
syntax, 70-migration static validation and diff checks pass. These are preparation
checks, not PostgreSQL execution. Fresh and upgrade acceptance is the next gate.

Serialization decisions were checked against PostgreSQL 17 documentation:
[JSON types](https://www.postgresql.org/docs/17/datatype-json.html) explains
numeric rendering versus equality; [string functions](https://www.postgresql.org/docs/17/functions-string.html)
documents Unicode code points and locale-dependent case conversion.


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
