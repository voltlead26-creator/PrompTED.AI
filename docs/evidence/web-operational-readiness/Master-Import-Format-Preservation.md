# Master Workspace upload and protected-format evidence

6 September 2026, Australia/Melbourne. Maintained checkout
`/Users/kaichurchw/PrompTED.AI`, branch `Thought-Enhanced-Document`, HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the recorded dirty overlay.
This is implementation evidence and a contract-change map, not an activation
approval or a claim that format-preserving editing works.

The owner explicitly requires PDF, DOCX, TextEdit TXT/RTF and Markdown import
into Master Workspace, with PDF/Word formatting and structure protected during
upload and editing. Existing XLSX/CSV behavior remains in scope and unchanged.
Retaining original file bytes alone does not satisfy the requirement.

## Implemented recovery slice

`commitDocumentImport` now validates the actual four-field committed receipt:
status, outcome ID, document ID and boolean replay flag. Fresh receipts must
match the submitted destination. Replays can return a previously committed
destination, as required by the existing database command.

Master import now retains its accepted owner/epoch/lifetime lease, rejects
duplicate callbacks synchronously, hides previous-owner review content and
blocks late UI/cache/navigation changes on account changes or unmount. Its
controller retires in the layout-effect cleanup during the unmount commit;
the passive-effect scheduling concern was preventative review feedback, not a
reproduced exploit. Same-owner epoch recovery has a positive re-upload test.

Once the owner confirms a review, its submitted sections remain immutable
during uncertain-save reconciliation. Inputs and structural controls stay
locked while "Check saved import" retries the same upload/destination/wording.
The UI says the save could not be confirmed, rather than asserting no rows were
created. A same-ID replay opens the canonical saved workspace without writing
either candidate cache. A different-ID replay keeps the review visible and
explicitly explains that its changes have not replaced the earlier document;
the owner can then choose "Open saved workspace". No replacement wording is
silently published or discarded by automatic navigation in that case.

Changed executable files for this slice:

- `apps/web/src/lib/api/import-workspace.ts`: receipt validation only; guest
  import behavior retained.
- `apps/web/src/app/(app)/workspace/MasterWorkspaceImport.tsx`: receipt adoption,
  confirmed-review snapshot, owner/lifetime/single-flight fences and accurate
  retry/replay wording.
- `apps/web/src/app/(app)/workspace/ImportReviewPanel.tsx`: optional read-only
  review state and explicit confirmation label. Ordinary pre-confirmation
  editing and existing callers retain their defaults.
- `MasterWorkspaceImport.test.tsx` and new `lib/api/import-workspace.test.ts`:
  behavioral receipt, replay, lost-response, owner, unmount, Strict Mode,
  single-flight, cache-unavailable and same-owner recovery regressions.

The first isolated red run had 18 intended failures and seven passes. The
earlier red log had one test-fixture contamination (`clearAllMocks` retained a
queued one-shot implementation); resetting mock implementations fixed the
fixture, and the isolated red run reproduced unmount failure for its intended
reason. Evidence: `master-import-receipt-red-isolated.log`.

Review subsequently exposed that editable wording after a lost response could
be discarded on replay. New intended regressions failed twice before the
confirmed-review lock and explicit earlier-workspace result were implemented;
see `master-import-review-lock-red.log`. Latest adjacent run:
**77 passed across nine files**, including **17 Master UI and 13 receipt cases**.
Focused ESLint and web type checking exited zero after the final local changes.
The full post-change web gate was inspected on the 22:47 completion turn:
`master-web-gate-20260906124622670`, job `job-mtpt2lnv-be86356f`, exit0 in
about34 seconds. Deployment-contract165, root223, shared291 and web895 tests
passed, as did lint, type checking, production build and progressive bundles.
Recorded source/HEAD hashes were unchanged. This remains overlay-scoped local
evidence, not exact-commit CI or hosted acceptance.

These are local component/API-wrapper tests, not a signed-in browser upload or
an independently read database workflow. Existing atomic import SQL coverage
passed in the earlier isolated 1,520-assertion DB run; no SQL was changed by
this recovery slice, and that result is not represented as a new HTTP upload.

## Reproduced formatting loss

`format-preservation/generate-fixtures.py` creates synthetic files with no user
content. `format-preservation/reproduce.ts` calls the **actual production text
extractor**, with no mocked parser, provider or hosted service.

| Source | Controlled difference | Current result |
| --- | --- | --- |
| Two actual DOCX archives | Arial 12pt/left/one-inch margins versus Times New Roman 20pt/centred/half-inch margins; same words | Different original hashes; identical extraction object |
| Two actual PDFs | Helvetica 12pt versus Times-Bold 20pt; different text coordinates and page dimensions; same words | Different original hashes; identical extraction object |
| TXT | Plain synthetic UTF-8 wording | Text extraction accepted; complete edit/reload/export preservation unverified |
| MD | Heading and ordered-list source | Text extraction accepted; complete syntax/structure preservation unverified |
| RTF | Valid synthetic RTF header/font table/bold text | Rejected with `UPLOAD_FORMAT_UNSUPPORTED` |

Results and original hashes are in
`format-preservation/reproduction-results.log`. Exit zero for this evidence
script means the **defects were reproduced**, not that formatting acceptance
passed. The first attempt hashed PDF buffers after the parser disposed of
them; hashes are now taken before extraction. The initial harness failure is
preserved in `reproduction-first-attempt.log`. PDF.js also emitted a standard
font-data warning; the extractor returned identical complete text in both
cases. No visual rendering acceptance is inferred from this reproduction.

Source trace confirms that PDF extraction retains `str`/`hasEOL` but drops
coordinates/styles. DOCX extraction reduces XML to text and whitespace. Master
then guesses headings, removes possible page markers and normalises paragraphs.
The editor's current HTML schema/sanitizer cannot represent arbitrary Word
styles, tables, images or page layout. The current export template reconstructs
branded HTML and strips style/image content. No faithful rich-document adapter
was found in the inspected current repository.

## Compatible implementation direction, not implemented yet

Keep original uploads in existing private Storage and keep `Section.content`
as the single editable wording authority. Extend the accepted extraction,
document/section, operation and export contracts with an immutable, server-owned
source binding. Do not place a second mutable edited archive in a new store.

For DOCX, bind the original archive hash and exact package parts to a stable
text-node manifest, then permit replacements only at validated source nodes.
Word represents text in runs with formatting properties and stores headers,
footers and styles in separate package parts; a flattened string cannot retain
those relationships. See Microsoft's
[WordprocessingML structure documentation](https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document).
Source-node patching must preserve protected XML and unchanged part bytes;
changed ZIP offsets and archive hash are expected. Even preserved styles do
not prove unchanged pagination when wording length changes: fixed-layout
overflow and unsupported changes must be detected before applying the edit.

The first coherent DOCX slice needs the following existing boundaries extended
together through a **new forward migration**, preserving old contracts:

1. Bounded extraction/XML scanner: source locations, immutable part manifest,
   full-document coverage and exact supported-feature status. The scanner now
   supplies raw UTF-16 ranges as described below. Namespace resolution and
   byte/encoding agreement are still required before compiling lexical patches.
2. Existing extraction checkpoint/client: validate and persist the original hash,
   manifest identity and actual contract version without relabelling old results.
3. Existing atomic import: derive source/section bindings server-side; reject
   caller-invented mapping, fuzzy title mapping and unsupported roster changes.
4. Shared types and owned workspace snapshot: carry exact immutable bindings.
   Do not widen the separate Profile upload read grant for private ingest data.
5. Existing section save/history/restore and TED edit operation: bind owner,
   resource, base revision/digest, source node/range and permitted transformation;
   reject source-bound mutations through older commands/direct DML that cannot
   validate them. Use the existing operation/attempt/receipt store.
6. Editor: preserve stable source-node identities and show accurate original
   formatting. StarterKit's current normalization is not a faithful Word editor.
7. Approval/export: include exact section IDs/revisions and source-map identity
   in the authoritative export snapshot, compile actual DOCX from the original
   package and approved wording, and extend the existing format/receipt family.
   The current legacy snapshot omits section IDs/revisions and its receipt is
   explicitly PDF-only. Historical PDF receipts remain unchanged.

PDF and RTF require their own source-format representations within these same
document contracts. Drawing replacement text over an original PDF is not proof
of correct text replacement, preserved accessibility or unchanged layout.
RTF needs real group/code-page/Unicode/style/table handling; stripping control
words is not acceptable. Microsoft's
[RTF 1.9.1 specification](https://officeprotocoldoc.z19.web.core.windows.net/files/Archive_References/%5BMSFT-RTF%5D.pdf)
is a source reference. Neither format is closed by the proposed DOCX slice.

Adding RTF must update the shared preflight, isolated parser, accepted extraction
response/checkpoint and SQL format constraints together. Preserve `.1`
checkpoints literally through an explicit format/version matrix. Current
request identities omit capability version and terminal errors replay; a
previously rejected RTF needs a defined successor intent, not overwritten
history or a global identity change.

Acceptance requires actual styled documents through import, constrained edit,
save, new-tab reload, exact revision approval and inspected real exports, with
independent row/receipt/part-hash verification. Cover lists, tables, mixed runs,
headers/footers, images, repeated text, entities/emoji, protected relationships,
overflow, unsupported edits, cancellation, stale revision and changed owner.
No activated format may claim preservation from an original-file hash alone.

## XML location and source-admission foundation

The next local slice extends the existing `bounded-xml.ts` reader, not a second
parser. Its original event objects are unchanged; a second visitor argument
supplies half-open UTF-16 ranges into the unchanged input string. It distinguishes
ordinary raw entity-bearing text, CDATA payloads, lexical tags and zero-width
synthetic ends. Decoded text offsets are not byte offsets or raw-source offsets.
The visitor must finish a successful full scan before relying on any range.

Source admission now rejects the reproduced malformed scalar, attribute,
comment, PI/declaration, numeric-entity, outside-root CDATA and whitespace cases.
Literal line endings and attribute whitespace are normalized before references,
so referenced CR/tab characters keep their meaning. Comments, PIs and empty
CDATA consume the same bounded work allowance. Review also reproduced and
closed one-character attribute overflow and a self-closing leaf exceeding the
depth bound. Valid one-argument extraction callers retain their interface.
Grammar basis: [XML 1.0](https://www.w3.org/TR/xml/), including its character,
line-ending and attribute-value rules. This bounded subset is not a claim of
complete XML/OOXML namespace validation.

Evidence in `format-preservation/`: `xml-locations-red.log` (2 intended failures),
`xml-source-admission-red.log` (29 intended failures), plus separate attribute
and depth red logs. Latest `xml-source-admission-green.log` has **48 passed**
across the scanner and actual Office/PDF/text extraction tests. Type checking
within Deno tests and focused Deno lint pass. An exact visitor-error case proves
immediate propagation without later events. Independent source review passed
after confirming both resource-bound regressions and their fixes. The broad
Edge gate `job-mtptr5ct-62b4fc94` passed: **721 tests, zero failures**, all
26 existing entry points type-checked, focused lint and diff checks green.
Evidence: `upload-source-edge-gate-20260906130527900`. Source and HEAD snapshots
match; dormant entry points were checked, not activated.

No source manifest, original-part compiler, database binding, rich editor or
preserved-format export has been activated by this foundation. Complete
source-preserving import/edit/export remains open; the next adapter must still
resolve namespaces, own immutable UTF-8 bytes, preserve BOM/encoding agreement,
validate all preserved package parts and enforce exact node/patch identities.

## Word XML source-part mapping and patch compilation

Implemented locally in `supabase/functions/_shared/wordprocessingml-source.ts`
and its behavioral tests. This unactivated primitive reuses the existing bounded
XML scanner. It is **source-only**, not a Word visibility, layout, document
approval or package-wide assessment, and is not yet a consumer of upload or
export handlers.

The mapping copies the exact original UTF-8 bytes before any await, preserves
BOM and declaration, hashes that private snapshot, resolves namespace bindings
with scoped restoration, rejects ambiguous expanded attributes, and records all
Word text nodes with source identities. Whole ordinary text payloads have raw
UTF-16 source ranges; empty, mixed, nested and CDATA payloads remain ineligible
for replacement. It admits explicit transitional/strict Word namespace URIs,
without treating matching local names in foreign namespaces as Word text.

Compilation regenerates the map from the original part; caller offsets and
extra fields are rejected. A request binds the version, original SHA-256, unique
node IDs and exact expected wording. All patches are checked before output, and
unchanged slices preserve surrounding XML byte-for-byte. Semantic no-ops return
identical bytes, including entity spellings. Unsupported whitespace, empty text,
invalid scalars, unresolved structures, fields/revisions and foreign semantics
cannot be patched. Output is independently limited by final character count and
UTF-8 bytes, reparsed, and checked against the original node roster plus intended
changes. Cancellation/deadline fences cover the public async continuation and
no-op return. No owner, resource, revision or approval authorization is inferred
from this low-level syntax contract.

**Regression evidence:** `format-preservation/word-source-red.log` records three
intended failures while the capability was explicitly unimplemented. The first
implementation attempt exposed TypeScript control-flow narrowing errors; these
were corrected without disabling type checks. The expanded tests then passed.
Independent review reproduced three additional issues before their fixes:

- `word-source-cancellation-red.log`: two missing public continuation fences.
- `word-source-pi-red.log`: literal comment/CDATA syntax falsely treated as a PI.
- `word-source-output-bound-red.log`: valid final combined size rejected after
  an intermediate positive delta.

Latest `word-source-adjacent-green.log`: **85 passed, zero failed** across
36 source-map tests, 39 scanner tests and 10 real extraction tests. Focused Deno
lint/type checks and `git diff --check` pass. The scanner's optional PI observer
preserves existing event contracts; its regression covers lexical recognition,
exact ranges and propagation of the original observer error. Independent final
source review passed after inspecting all three fixes.

**Source-part exercise:** `exercise-word-source.ts` applies one edit to the
actual main XML parts extracted locally from both previously generated synthetic
DOCX fixtures. `word-source-fixture-exercise.log` records exact original/patched
part hashes and proves that only the selected text payload changed. A separate
Python ElementTree inspection confirms unchanged font, size, bold, alignment,
page size and margin elements for both parts; evidence is
`word-source-independent-xml-inspection.json`. These are XML artifacts only:
no DOCX package was rebuilt, opened in Word, rendered, or exercised through the
web UI. The original DOCX fixtures remain intact. The unchanged style elements
do not establish unchanged pagination after different wording.

**Remaining integration:** package-wide validation and part preservation;
immutable source-manifest binding in existing upload/document/section commands;
source-aware editing and revision/approval checks; real DOCX export; rendered
layout/overflow review; separate PDF, RTF and Markdown/TextEdit acceptance.
Source metadata must not become a second mutable wording authority. The existing
original upload remains immutable and documents/sections remain current wording.
The combined gate `job-mtpuhy5o-089231df` has now been inspected. Evidence
`upload-source-full-gate-20260906132618276`: all **758 Edge tests** pass;
26 function entry points plus the source adapter type-check; focused lint and
diff checks pass. The web gate passes 165 deployment-contract,223 root,
291 shared and895 web tests plus preceding lint/types, then fails the real
web dotenv guard before Next compilation. The progressive-bundle check was not
reached. Source/HEAD snapshots match; ignored dotenv files were not part of those
snapshots, so this does not establish unchanged local configuration.

**Observed configuration drift:** at the initial names-only inspection,
`apps/web/.env.local` had confidential/server/deployment names and mtime
2026-09-06T13:21:58Z. During diagnosis it changed again (mtime13:28:46Z) and now
contains only the seven public entries, mode0600. The real guard subsequently
passes under a controlled environment. This task made no dotenv writes and has
not established which external actor changed it, credential exposure, or the
correctness of changed provider values. The provider dotenv and local tools/
backup files also show modification at13:28:46Z; duplicate provider names were
observed, without logging their values or choosing/activating a new route.
No key rotation, provider call or hosted configuration action occurred.

The verification runner now records before/after digests and modes of the eight
automatically loaded web/root dotenv paths (no values). A mismatch fails the
runner in addition to its existing source/HEAD checks. It does not read or load
the separate operator/provider dotenv files. The retry `job-mtpuqn7o-ec05c3d7` passed in35seconds. Evidence
`master-web-gate-20260906133303999`: deployment165/root223/shared291/web895
checks pass, lint/types pass, Next production compilation and29static pages
complete, progressive bundles pass. Source/HEAD and web dotenv fingerprints
match before/after. This supersedes the web build blockage for the inspected
configuration; it is not a provider, production or upload workflow claim.

## Owned upload bytes and complete archive integrity checks

`upload-extraction.ts` and its existing tests now close two further local
source-integrity gaps, using the same parser and public interfaces. The active
caller is `extract-upload/index.ts` through its existing handler; the handler
checks the retained original length/hash before passing bytes to extraction.
Production Storage reads already allocate fresh buffers, so stale-cache
reproduction is an API defect, not evidence of a hosted cross-user occurrence.

**Byte ownership:** each public read validates size/type then copies its source
before awaiting. The old global WeakMap keyed by mutable caller buffers is
removed. A private resolution result passes one inspected archive directly into
DOCX/XLSX extraction, preserving one inspection per request. Public signatures,
extraction response fields, source policy version, original Storage objects and
persistence contracts are unchanged. Cancellation and the original deadline are
checked across async boundaries and before success. The PDF parser consumes its
private working copy, leaving the caller's original bytes intact.

`upload-byte-ownership-red.log` records five intended failures with the prior
implementation (10 existing passes): changed archives bypassed CRC checks,
replaced archives returned earlier wording, text mutation crossed an await,
PDF cleanup detached the caller's buffer, and public cancellation returned
success. The PDF case separately establishes an API ownership defect; the older
format-loss script's after-disposal hash failure remains historical harness
evidence. Further positive controls cover mutation while an earlier ZIP entry
decompresses, fresh retry after a cancelled inspection, exactly one native
decompression per extraction, and rejection of shared buffers. Independent
source review passed this bounded ownership repair.

**All archive parts:** the existing inspector now verifies size and CRC for
all entries, including styles and images that do not contribute wording.
Unretained deflated parts are streamed through the same inflater without saving
chunks or allocating a combined content buffer. Aggregate accounting covers all
validated expanded bytes under the existing16MiB ceiling. Only selected contents
enter the existing text extraction map; no new package store or parser exists.

`upload-all-parts-red.log` records four intended failures/19passes: corrupt
stored styles, corrupt deflated styles, hidden expansion and an otherwise valid
style part skipped by inspection. Latest `upload-all-parts-adjacent-green.log`
records **107 passed, zero failed**:24 extraction,39 scanner,36 Word source,
8 extract-handler tests. This includes an exact16MiB aggregate positive and
one-byte-over rejection. Deno type and diff checks pass. The earlier focused
lint-pass claim was incorrect; its saved output contains the existing PDF
`no-unsafe-finally` errors, now addressed below. Independent
review passed the final source and aggregate test; all execution remains
parent-owned. CRC is archive consistency evidence, not a cryptographic part
manifest or an assessment of style/relationship semantics.

The original real format-loss exercise was repeated in
`reproduction-after-archive-hardening.log`: PDF/DOCX still collapse formatting,
TXT/MD are extracted, and RTF still rejects. Exit0 means the remaining gaps were
reproduced. This does not close the user's complete formatting requirement.
The combined post-change web/Edge gate is prepared; no hosted, database,
provider, CI or deployment action occurred for this slice.

## PDF cleanup and corrected lint evidence

The inspected combined job `job-mtpv5kva-a364e523` failed only its focused lint
step. Evidence `upload-source-full-gate-20260906134440825` records **772 Edge
tests passed**, all entry/adapter type checks passed, full web acceptance passed
(deployment165/root223/shared291/web895, lint/types/build/29pages/bundles), and
matching source/HEAD/web-dotenv snapshots. The failing lint output reports two
pre-existing explicit throws inside PDF cleanup `finally` blocks. No build or
archive-behavior failure occurred in that run.

**Evidence correction:** the preceding focused commands redirected lint output
but returned the status of a later command. That masked lint failure in the
parent's summary. The original logs remain intact and the inaccurate claims
above are corrected. Each subsequent focused lint/type/test command now reports
and propagates its own exit status; the finite broad runner already did so.

The PDF path now uses a small `withPdfCleanup` helper for page/document cleanup.
It captures an explicit success/error result, awaits cleanup, then returns or
throws outside `finally`. Cleanup failure after a successful read remains the
existing retryable503; if both fail, the exact primary failure is preserved,
including falsy thrown values. Page cleanup failure still reaches document
destruction. Existing PDF.js page-cleanup boolean behavior is retained; the
outer document destruction is awaited. No new parser policy or public extraction
response contract is introduced.

**Local checks:** `pdf-cleanup-adjacent-green.log` has **112passed/0failed**
(29 extraction/cleanup,39 scanner,36Word-source,8handler). Five cleanup tests
cover deferred success and failure, synchronous/asynchronous cleanup errors,
primary error precedence and nested page/document cleanup. Actual PDF extraction,
original-buffer preservation and malformed/cancelled input controls still pass.
`pdf-cleanup-lint-green.log` exits0, separately checked; focused types pass. The
first helper test revision triggered `require-await` lint failures, corrected
with explicit resolved/rejected promises rather than disabling rules.
Independent final source review passed all five cleanup cases and the
page/document integration. The full post-cleanup gate `job-mtpvhh8d-8fd10fb0` passed in67seconds.
Evidence `upload-source-full-gate-20260906135355969` records full web acceptance
(165deployment,223root,291shared,895web tests; lint/types/build/29pages/bundles),
777Edge tests, all26entry/adapter type checks, focused lint and diff checks
passing. Source, HEAD and web-dotenv snapshots match before/after. Existing immutable extraction checkpoints retain their historical
contracts; these repairs do not retroactively prove that an earlier saved
checkpoint received the new all-part inspection. Source-preserving activation
will still need a versioned binding validated from its owned original.

## Current release and request status

**Implemented:** bounded Master receipt/recovery repair above.
**Verified locally:** 77 adjacent tests, focused lint and web type check; actual
format-loss/RTF rejection reproductions and the full post-change web gate.
**Verified in CI; Workflow exercised; Production exercised; Persistence proven;
Export inspected:** unverified for this upload repair. Prior separate SQL and
Profile HTTP results retain their own evidence labels.
**Blocked/unimplemented:** format-preserving import/edit/export and RTF support;
the earlier audited hosted ingest/extract incompatibility and required
configuration/evaluation gates still prevent declaring production upload ready.
No hosted changes, package changes, branch changes, Git publication or deployment
were made by this slice.

Owner's 22:36 `npm install Downloads/PrompTED-ClaudeTED.AI/.../server.ts` message
was checked against the actual supplied source. That file is a TypeScript helper,
not an installable package. Its cookie adapter is already present in the current
helper, which additionally uses `getPublicSupabaseConfig` to validate environment
and exact target. Installed dependencies were verified as `@supabase/ssr@0.6.1`
and `@supabase/supabase-js@2.108.2`. No donor copy or npm install was performed.

## 7 September: package-bound DOCX source manifest, not activated

**Implemented:** `inspectDocxSource` in the existing `upload-extraction.ts`
reuses the owned archive inspector. It records the exact original SHA-256/length,
an ordered versioned roster, and each admitted part's exact path, method, lengths,
CRC and SHA-256 of its actual uncompressed bytes. A nonselected part is retained
only while it is hashed, then discarded; ordinary extraction keeps its prior
streaming behavior. The main Word XML map is attached to that package identity.
No second ZIP parser, decompressor, source store or mutable document authority
was added.

The private manifest is `docx-source-manifest.1`, explicitly `source_only`,
with a 1MiB serialized UTF-8 ceiling. It is deeply immutable. Roster encoding is
a domain/version-prefixed JSON array with fixed field order and exact paths in
code-unit order; it is not PostgreSQL jsonb serialization. All package semantics,
style/visibility interpretation and layout remain unassessed blockers. Usual
signature parts and non-main wording have additional positive flags; their
absence is not an unsigned-package or complete-coverage assertion.

The existing extraction result, 64KiB isolated response, six-key checkpoint,
SQL replay comparisons, classification prompts and Profile projection are
unchanged. This larger map must not be silently appended to those v1 contracts.
A forward private checkpoint extension and document/section revision binding
remain necessary before editing/export activation. Historical checkpoints keep
their exact accepted values and do not acquire retrospective source assessment.

**Regression evidence:** the first 10-case run passed nine and reproduced the
reviewer's error-boundary defect: `WordXmlSourceError` escaped where
`UploadExtractionError` was required. The adapter now maps known malformed
XML/encoding to nonretryable422, structural limits to413, and cancellation or
deadline expiry to retryable503. Unexpected failures propagate unchanged.
The first exact-limit fixture exceeded the independent512-byte ZIP-path limit;
the fixture was corrected to reach the intended manifest limit without changing
any production guard. Both failed logs are preserved.

**Verified locally:** `docx-manifest-adjacent-green.log` records **125passed,
zero failed** (42 extraction/manifest/cleanup,39 scanner,36Word-source,8handler).
The 13 new cases cover formatting identity despite identical wording, exact
uncompressed hashes, one native decompression, deterministic roster encoding and
ZIP-order behavior, literal Unicode paths, caller mutation/shared buffers,
cancellation at every hash, deadline expiry, unexpected runtime failure,
signature/non-main limits, corruption/metadata rejection, malformed Word
sources, and the exact1MiB positive/one-byte-over rejection. Separate focused
Deno lint (six files), entry/adapter type checks and `git diff --check` exit0.
Independent source review passed the bounded implementation after the error fix.

**Source-package exercise:** `exercise-docx-manifest.ts` inspected the two real
synthetic styled DOCX fixtures through the production inspector. Original bytes
were unchanged, wording matched, and differing formatting produced different
archive and roster identities. `inspect-docx-manifests.py` independently
verified every part and main-map hash, size, compression method, CRC and canonical
roster using Python zipfile/hashlib. Results are in
`format-preservation/docx-manifest-fixture-exercise.log`,
`docx-manifest-independent-inspection.json` and each saved fixture manifest.
No edited DOCX was rebuilt/opened; this is not visual, editor, persistence or
export acceptance.

**Production exercised / Workflow exercised / Persistence proven / Export
inspected / Verified in CI:** unverified for this slice. A full post-change
web/Edge gate is prepared. The latest completed broad result remains the
777-Edge/full-web gate recorded above, for the preceding source.

**Hosted read-only refresh:** `hosted-metadata-refresh-20260907.json` records
project `jjsykocqpjlekgsbylkd` ACTIVE_HEALTHY,25 hosted functions and67 migrations
through `20260905000000`. Active contract functions `document-operation`,
`extract-upload` and `brand-logo` are still absent. Hosted `ingest-upload`
remains version328 with bundle hash
`3723543fe07240543ab48985717b918eef0fbca933fa5db1a06512bcc77ef75d`.
This refresh queried metadata only, not hosted rows, secrets, function bodies,
Profile grants or model/capacity/evaluation configuration. Earlier audit findings
in those areas retain their separate observation dates. No hosted mutation
occurred.

**RTF/TextEdit trace:** shared browser admission and the server parser still
reject RTF. Existing original Storage and file_type metadata can represent it;
a distinct extraction format/policy needs a forward checkpoint contract and
matching TS parsers. Master fidelity text must classify RTF as rich source.
Current TXT/MD support is UTF-8; UTF-16/legacy TextEdit encodings remain unsupported.
Previously terminal failed ingest identities cannot simply be overwritten when
support expands. These are implementation work remaining, not newly enabled
capabilities.

**Completed broad verification, 00:14:** `job-mtpw6jrj-7eb51f46` exited0 in
68seconds. Evidence `upload-source-full-gate-20260906141325640` records all790
Edge tests and the full web gate passing (165deployment/223root/291shared/
895web tests; lint/types/build/29pages/progressive bundles), plus all26entrypoint
and Word adapter types, focused Deno lint and diff checks. Source, HEAD and
web-dotenv snapshots match. This supersedes the prepared-gate status above for
the current source-only manifest; its integration/production limits remain.

## Isolated extraction response cancellation and cleanup

**Implemented:** the existing `upload-extraction-client.ts` now captures request
identity and caller signal before awaiting, prevents pre-cancelled dispatch, and
observes its own abort/timeout across both fetch and body reads. A transport that
ignores the fetch signal cannot hold the request open indefinitely. Late fetch
responses are discarded once, including the separate microtask window after a
fetch promise settles. Timer and caller-listener cleanup remain in `finally`.

Rejected metadata, byte overflow and cancelled reads initiate stream cancellation
and release the reader without waiting indefinitely on an underlying cleanup
promise. Late promise/cleanup rejection is observed and does not replace the
primary failure. Successful results still require the original exact identity,
nine-key v1 response and fatal UTF-8 decoding. The 64KiB byte ceiling is unchanged.
A65,536-chunk ceiling also bounds empty-chunk producers that can starve timers;
a complete64KiB response delivered as65,536 one-byte chunks remains accepted.
Only nonempty byte chunks are retained, with owned copies.

The Streams Standard specifies that cancellation's returned promise reflects
underlying shutdown and that releasing a reader rejects pending reads; the
implementation observes cancellation without using unbounded shutdown as its
error-publication gate. Reference:
[WHATWG Streams](https://streams.spec.whatwg.org/#default-reader-release-lock).

**Reproduced:** the isolated red suite has5existing passes and6intended failures:
pre-cancelled dispatch, pending fetch, stalled body, ignored timeout, oversized
metadata's unread body, and stalled cancellation cleanup. Its first harness
revision left the old pending fetch unresolved; the isolated run explicitly
releases baseline resources and uses highWaterMark0 to prove actual pending
reader cancellation. A subsequent microtask disposal test failed once before
the late-value disposal correction. A finite empty-chunk fixture also reproduced
success after exceeding the proposed work bound, then rejected after the fix.
All red outputs are retained in `format-preservation/extraction-client-*.log`.

**Verified locally:**164adjacent tests pass across the client, extraction handler,
ingest exact replay, real parsers and source maps. Final client-only run has
16passes, including exact65,536-chunk success, byte-split Unicode, exact64KiB/
one-byte-over, changed caller identity, late fetch rejection and rejected cleanup.
Separate Deno lint/type checks exit0. Independent source review passed; its exact
chunk-ceiling test gap was subsequently filled and passed. The broad runner now
includes both modified client files in focused lint; full verification is
prepared, not yet reported as completed for this latest change.

The ingest caller maps these new explicit cancellation/timeout codes through its
existing retryable503 checkpoint-unavailable path. Original retention and request
identity remain recoverable, and classification is not dispatched on this
failure. No new HTTP endpoint, dependency, provider call, persistence contract,
retry loop or hosted change was introduced. This remains local boundary/
adjacent evidence, not an authenticated browser/production upload journey.

The private persistence design from two independent source traces is recorded in
[Upload-Source-Checkpoint-Integration.md](./Upload-Source-Checkpoint-Integration.md).
It distinguishes accepted extraction contract version from resource policy and
records single-overload RPC compatibility, DB-owned digest, mandatory checkpoint
adoption, provider/settlement fences and privacy requirements. Those versioned
wire/database changes, RTF, rich editing and export remain unimplemented.

**00:37 full response-recovery verification passed:** `job-mtpwzfmn-3f11053d`
completed in69seconds. Evidence `upload-source-full-gate-20260906143553308`:
801Edge tests,26entrypoints/adapter types,8-file Deno lint and full web gate pass
(165deployment/223root/291shared/895web, lint/types/29page build/bundles).
Source, HEAD and web-dotenv fingerprints match. This is the latest completed
broad local gate, without changing the workflow/production boundaries above.

## Private source validation and one-read extraction

**Implemented locally, 7 September:** `document-source-contract.ts` consolidates
the existing Word/DOCX source types, policy values, canonical part-roster encoding
and blocker derivation. Existing parser exports remain available through
re-exports. The module has no XML, PDF, ZIP, Storage or provider runtime import.
Its normalizer binds a manifest to the expected original SHA and byte length,
validates closed shapes and versions, bounded parts/nodes/text, exact paths,
ordinal node identity, range consistency, hashes/CRC/length metadata, mandatory
source-only blockers and the 1 MiB serialized ceiling. It recomputes the roster
hash and owns/freezes data before asynchronous work. These checks establish
structural consistency and attribution; they do not independently establish that
the map describes the original XML or that an edit preserves layout.

The validator preserves actual producer edge cases: empty and nested text nodes,
postorder emission of node IDs, CDATA, whitespace, revisions, exact Unicode paths
and directory entries. Exact 1 MiB output passes; a one-byte-over variant fails
the resource check. Independent review found a numeric contradiction allowing
positive inflated content with zero compressed bytes after recomputing the
roster hash. `source-contract-zero-compressed-red.log` records the intended
failure; the narrow correction and follow-up review passed. Initial lint rejected
two control-character regexes; equivalent explicit scalar/NUL checks now pass
lint, preserving the XML rejection behavior.

`extractBoundedUploadWithSource` now produces the existing text result plus the
required DOCX source manifest from one owned original and one archive inspection.
Text still follows the existing package relationships, including header wording;
main-part source nodes are not substituted for that text. Both stages share one
absolute deadline. Non-DOCX formats explicitly return a null manifest, and XLSX
keeps ordinary unselected-part streaming without source hashing. The historical
four-field text API and standalone inspector retain their behavior. The new
producer is dormant until the accepted-version handler/checkpoint integration.

`combined-extraction-red.log` proves the combined entry point was absent.
`combined-extraction-cancellation-red.log` then records five passes and one
intended failure: interrupted compressed reading did not cancel its reader.
The existing decompression helper now checks cancellation immediately after a
read and initiates cancellation for unfinished reads in `finally`, observing
cleanup rejection without allowing it to replace or postpone the primary error.
This proves initiation of cleanup, not completion of all underlying shutdown.
A later retry of the same original succeeds. No retry loop was added.

**Verified locally:** `combined-extraction-adjacent.log` records 95 passes and
zero failures: 10 source-contract, 49 upload/extraction and 36 Word-source tests.
The six combined-reader cases cover one inflation per compressed entry, text and
manifest parity, headers, caller mutation, original preservation for real PDF and
XLSX plus TXT/MD/CSV, explicit source absence, required-source failure, cumulative
deadline expiry, compressed-read cancellation and retry. Existing v1 keys remain
exact. Separate `combined-source-lint.log` and `combined-source-types.log` exit0.
Independent source reviews of the validator and combined producer passed.

**Source artifacts exercised:** `combined-source-exercise.log` records both
styled DOCX fixtures passing the combined reader and JSON/normalizer roundtrip.
Their original bytes and previous archive identities remain unchanged.
`combined-source-independent-inspection.log` records independent Python zipfile/
hashlib confirmation of archive, part, CRC/size, main-source and roster identity.
No edited DOCX package or PDF export was produced or visually inspected here.

**Prepared broad gate:** the runner includes both new source-contract files in
lint and the new module in type checking, followed by the complete Edge suite and
full web verification. The preceding completed broad run remains 801 Edge tests
and full web green until the new run finishes and its saved results are inspected.

**Unverified/open:** accepted v2 wire and private upload persistence, durable
checkpoint adoption, provider/settlement fences, real browser upload/reload,
RTF/TextEdit rich-text support, format-preserving editing and exact-revision
export/visual inspection. CI, hosted schema/functions and production are unchanged
by this slice. Manifest presence never enables editing or claims formatting
approval. No private source map is added to public ingest, classification or
Profile payloads.

## Broader result and compatible private transport

**01:08 AEST full gate failed; source checks passed.**
`job-mtpy41rn-9c850225` exited1 after58seconds. Saved evidence
`upload-source-full-gate-20260906150728252` records 818 Edge passes, all26
entrypoints and source-adapter types, ten-file Deno lint and diff checks passing.
The web gate passed 165 deployment, 223 root, 291 shared and 895 web tests,
deployment static checks, lint and types. Its build step stopped in the real
dotenv security guard before Next.js compilation; bundle checks were not reached.

Source and HEAD fingerprints matched. Web dotenv fingerprints did not: the root
`.env.local` disappeared, and its exact whole-file hash appeared at
`apps/web/.env.local`. The guard reported eighteen confidential-variable names
and a retired deployment identifier there. No environment write was performed by
this task, values were not logged, and the observations do not identify the actor
or establish credential exposure. A question about competing environment work
was sent while independent source work continued.

At01:37, a read-only refresh found that same whole-file hash at `.env.tools.local`
and a new0600 web dotenv with eight public variable names. The real guard passed
against the current files with a controlled empty outer environment. Evidence:
`format-preservation/environment-refresh-after-wire.json`. No values were
changed by this task. This permits another attributable build attempt; it does
not retroactively turn the failed gate green or verify private credentials.

**Implemented locally:** the existing extraction client and handler now support
closed `.1` and `.2` internal contracts, separately from resource policy. Missing
historical versions mean `.1`; present invalid versions are rejected. A `.2`
request must match the accepted snapshot before Storage access, and a missing
source-capable reader returns retryable503 without reading the original or
falling back. The client requires the accepted original SHA/length. The handler
uses the combined producer once and validates the returned manifest against its
snapshot before returning an owned result. Existing ingest/default checkpoints
remain `.1`; there is no new admission, persistence or activation yet.

V1 retains four request keys, nine response keys, its result shape and 64 KiB raw
limit. V2 adds version to the request and version/content length/source manifest
to success: exactly five/twelve keys. A DOCX requires its normalized manifest;
other formats require literal null. V2 success is capped at1,114,240 raw bytes,
with independent1 MiB manifest and64 KiB ordinary-envelope ceilings; error
responses stay64 KiB. One fixed buffer owns received bytes, and chunk work is
bounded by the selected byte ceiling. Exact inner/outer ceilings and full-size
one-byte delivery pass. No source map is sent to current provider, public ingest,
Profile or document persistence paths.

**Reproduced and corrected:** the initial v2 client test first encountered a
test type-inference error; an isolated copy of the preceding verified client,
reconstructed from its saved patch and matched to its saved source hash, then
failed at runtime with `UPLOAD_EXTRACTION_RESPONSE_INVALID` as intended.
The old handler separately returned400 for the new request. These results are
`extraction-v2-client-runtime-red.log` and `extraction-v2-handler-red.log`.

Independent review then found and reproduced three failures in
`extraction-v2-review-red.log`: immediate streams consumed remaining chunks after
their absolute deadline, v1 success escaped while a timeout callback was queued,
and a producer could report an accepted DOCX as text to omit its manifest.
The existing client now checks the same deadline before/after reads and before
publication, retaining the existing timeout/cancellation codes and cleanup.
The handler reuses the existing metadata policy (exported through an alias) to
reject the format downgrade with sanitized retryable503, without a second ZIP
inspection. A malformed-manifest fixture was corrected to use actual DOCX bytes
and metadata so it continued to reach its intended validation check; its original
assertion was retained.

**Verified locally:** `extraction-v2-adjacent.log` records159 passes/zero failures
across27 client,13 handler,49 extraction,10 source-contract,36 Word-source,
23 ingest replay and1 classification-accounting cases. The handler/client
integration uses a real1370-byte synthetic styled DOCX, one controlled retained
read, the actual combined parser and actual client normalization. It verifies
unchanged originals, exact source identity, wording and source-only blockers.
It uses synthetic accepted metadata and a controlled Storage dependency; it is
not a hosted/authenticated browser or database persistence journey.

Separate final type/lint checks exit0, and both reviewers passed the corrections.
The existing JSR dependency in the entry point remains unchanged; a line-scoped
lint annotation follows the repository's explicit-import convention. Test-only
unnecessary async declarations were removed without changing their assertions.
The broad runner now includes all six changed contract/client/handler files in
lint. A new full web/Edge run is prepared against the refreshed environment.

**Still unverified/open:** v2 admission and private SQL checkpoint, authoritative
checkpoint adoption after both acknowledged and uncertain writes, full-manifest
replay comparison, provider/settlement fences, real browser upload/reload,
RTF/TextEdit rich text, format-preserving editing and exact approved export.
CI and production have not exercised or received these changes.

**01:42 AEST — full local verification completed:**
`job-mtpzbct2-685fbfc6`, exit 0 in 76 seconds, evidence
`upload-source-full-gate-20260906154108753`. All 834 Edge tests, 26 entrypoints
plus source/Word type checks, 14-file focused Deno lint and `git diff --check`
pass. The complete web gate passes: 165 deployment, 223 root, 291 shared and
895 web tests, lint/types, 29-page production build and progressive bundle
checks (11 deferred modules, three critical modules and one catalogue check).
Source, HEAD and web-dotenv snapshots are identical before/after. Runtime is
Node 22.23.2, pnpm 10.33.0 and Deno 2.9.5 on the dirty `e1d514d` overlay.
This closes the local gate for the compatible extraction transport slice only.
It does not establish durable source persistence, format-preserving editing,
actual browser/production upload, CI or export inspection.

**Next bounded repair — authoritative extraction readback:** ingestion now
loads and adopts the exact stored extraction after both an acknowledged record
and a lost acknowledgement. The existing owner/upload/request/claim identity
and stage CAS remain authoritative. Null or unavailable readback returns a
retryable 503 with the upload still processing; null can also mean an expired
or superseded claim, so it is not labelled a content conflict. A non-null
mismatch retains the existing reconciliation 409 and terminal replay. No
classification starts from the in-memory candidate alone.

`checkpoint-adoption-red.log` records eight intended cases: three existing
compatibility cases passed and five regressions failed. The old acknowledged
path returned 200 despite missing/unavailable/different readback; lost-ACK null
returned terminal 409, and the order assertion showed no post-record read.
An initial filter selected zero tests; it was corrected before accepting any
regression evidence. The actual RPC adapter also accepted `format: ["text"]`;
it now requires a string before membership validation. That regression initially
stopped at missing model-call test context; after binding the normal guard
context, `checkpoint-format-red.log` proves the intended old behavior reached
the downstream stage fence instead of rejecting the malformed checkpoint.
No assertion was weakened, and all downstream RPCs were fenced from real work.

**Verified locally:** 34 ingest cases pass, including held readback, claim
handoff, acknowledged/lost-ACK failure variants, immediate processing replay,
same-checkpoint recovery without another extraction/write/retention, identical
completed replay, malformed RPC format and existing historical behavior.
`checkpoint-adoption-adjacent.log` records 169 passing tests across the client,
extractor, combined parser, source contract, Word adapter and ingest suites.
Separate `checkpoint-adoption-lint.log` and `checkpoint-adoption-types.log`
exit 0. Independent read-only review passed. The production change is limited
to `ingest-upload/handler.ts`; regressions are in `exact-replay.test.ts`.

These tests use controlled in-process persistence and RPC collaborators; they
do not prove actual database writes, Storage, provider execution or browser
upload. The full runner now includes both ingest files in focused lint. A new
full gate is prepared; the preceding 834-test full gate predates this repair.
Private v2 SQL acceptance, manifest digest/adoption, RTF, formatting-preserving
editing/export and production acceptance remain open. No schema or protected
deployment action was performed.

**01:59 AEST — readback broad verification completed:**
`job-mtpzx7di-ac9bd3a0` passed in 70 seconds. Saved results in
`upload-source-full-gate-20260906155808143` show 844 Edge tests, all 26 entrypoint
and source types, 16-file Deno lint and the complete web gate passing (165/223/
291/895 tests, lint/types, 29-page build and progressive bundle checks).
Source/HEAD/web-dotenv before-after fingerprints match. This closes local broad
verification for authoritative v1 readback, without claiming durable v2 source
persistence, CI, hosted/browser workflow or edited artifact fidelity.


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
