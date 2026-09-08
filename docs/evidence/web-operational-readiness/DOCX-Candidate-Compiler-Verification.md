# DOCX source candidate compiler — local evidence

8 September 2026, Australia/Melbourne. Maintained repository
`/Users/kaichurchw/PrompTED.AI`, `Thought-Enhanced-Document`, HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the existing, separately
fingerprinted dirty overlay. This is a necessary compiler slice of the owner's
format-preserving editing requirement, **not completion or activation of that
feature**.

## Implemented

`supabase/functions/_shared/upload-extraction.ts` now exposes the unactivated
`docx-source-candidate.1` compiler. Its closed request binds the original whole
archive SHA and bounded exact Word text-node patches. It owns caller bytes and
patch values before asynchronous inspection, uses the existing Office archive
reader/CRC/resource limits, obtains the main XML hash from the accepted source,
and invokes the existing lexical patch primitive. No second ZIP reader,
document store, provider route or persistence path was added.

A changed main part is emitted as stored ZIP data. All other raw archive slices
remain intact. Only its compression method, CRC, sizes and affected local-entry
and central-directory offsets change. Physical record order is independent of
central-directory order. Opaque local/central extra fields block a rebuild;
this restriction does not change ordinary upload admission. Exact no-op
requests retain original bytes, compression and XML entity spelling, including
admitted opaque extras. Observed signature/non-main wording/XML blockers reject
even no-op requests. These are positive observations, not complete package
security or visibility assessment.

The candidate undergoes the existing full Office/source inspection again.
Same part/node roster, unchanged sibling parts/text/metadata and exact requested
wording are required. Input and final archive limits are 8 MiB, and all stages
share a bounded cumulative deadline. Cancellation is checked before publication.
The result records its original archive SHA separately from the candidate hash.

`wordprocessingml-source.ts` factors its existing bounded patch capture into a
reusable function without changing the immutable `word-xml-source.1` contract.
Current manifests remain `.1`, `source_only`, with all three mandatory package,
styles/visibility and layout-unassessed blockers. No runtime caller, SQL
activation, import eligibility, editor or export policy was changed.

## Verified locally

- Initial RED: one behavioral case failed because the whole-DOCX compiler was
  absent; `docx-candidate-red.log`. This proves a missing implementation, not a
  new deployed production defect.
- Latest adjacent run: **149 tests plus 12 steps passed, zero failures**, covering
  upload extraction, Word source mapping/patching, source contracts and bounded
  XML. See `docx-candidate-adjacent.log`.
- Four changed source/test/artifact-generator files passed Deno lint; the
  verification runner passed Node syntax checking; `git diff --check` passed.
- Fourteen candidate cases cover stored/deflated archives; shorter/longer and
  Unicode wording; physical/central order differences; gaps/comments; exact
  replay/no-op; copied caller inputs; stale archive/node/wording identity;
  malformed/oversized patches; escaped XML; styled siblings and reordered
  multi-node patches; observed feature blockers; opaque extras; unselected-part
  corruption; exact maximum/one-byte-over output; cancellation during initial,
  final-candidate and final-no-op inspection; expired/nonfinite deadlines.
- The first size-boundary fixture used a `.bin` part rejected by the existing
  active-content guard. That attempt is preserved in
  `docx-candidate-limit-fixture-first-attempt.log`. The synthetic opaque part was
  changed to `.dat` so the test reaches its intended byte boundary; the guard
  and its production behavior were preserved.
- Independent read-only code review found no blocking compiler defect. Its
  multi-node coverage suggestion was added. Actual artifact records also cover
  nondefault DOS timestamps and external attributes.

## Artifact inspection

`docx-candidate-artifacts.ts` produced three pairs of synthetic original and
candidate DOCX files under `docx-candidate-20260908`. The source-preservation,
left-aligned and centre-aligned examples use different actual font/alignment/
margin settings. Recompiling the same requests produced identical candidates.

`inspect-docx-candidate-artifacts.py` independently opens the bytes using Python
stdlib `zipfile` and parses XML with `ElementTree`. **All three pairs pass**:
original source bytes/hash match, ZIP CRCs and XML parse, exact part order,
unchanged non-main local records/content, permitted central-header differences
only, unchanged metadata including timestamps/attributes, and exactly one
literal main-XML text replacement. Results are in
`docx-candidate-20260908/independent-inspection.json`.

LibreOffice opening/rendering, PDF text/font/position/preview inspection and a
fresh combined web/Edge gate are prepared in `verify-docx-candidate.mjs`.
Their results were inspected on the automatic completion turn below.

Prelaunch review identified and corrected verification-wrapper issues before
any LibreOffice/background execution: SIGTERM timeout could hang or be accepted
after exit zero; evidence executables/manifest were outside the general source
hash exclusion; and an empty artifact roster could pass an empty inspection.
The wrapper now awaits bounded owned process groups, rejects timeout/error/
signal outcomes, removes remaining owned descendants, pins/copies/rechecks its
exact inputs, and admits the exact three unique pairs. The inner web/Edge gate
also rejects interrupted commands explicitly. Four real-child process guards
pass, including ignored/zero-exit SIGTERM handlers, output bounds, spawn errors,
cancellation and child cleanup. Three independent negative roster checks reject
empty/wrong/duplicate rosters before creating a success report. Evidence:
`docx-candidate-runner-guards.log`, `docx-candidate-roster-guards.json`.

## Completed verification — 8 September 2026, 06:38 AEST

Job `job-mtrpc1bv-43cbca77` exited zero in 82.209 seconds. Its result was read
with `--peek`, then every check disposition, source/input comparison, actual
ZIP inspection, PDF text/font/position output and six page previews was read.
The raw run summary retains `visualInspection: pending`; the subsequent actual
inspection is recorded separately in
`docx-candidate-20260908/verification-20260907203716713/completion-comparison.json`.

- **Verified locally:** full `pnpm verify:web` passed: deployment-contract165,
  root223, shared379/19files and web951/113files; lint/types,29-page production
  build and progressive bundle checks all pass. Full Edge suite:
  **1,185 tests plus12 steps pass**,26entry points+2helpers type checked,
  28source/test files linted. Inner evidence:
  `upload-source-full-gate-20260907203721123`.
- **Artifact workflow exercised; Export inspected (synthetic candidates):**
  LibreOffice26.2.5.2 opened all three original and candidate pairs in an
  isolated profile and rendered six genuine PDFs. Exact text matches and all
  six page previews were visually opened. These are source-candidate artifacts,
  not product approval/export receipts.
- Arial Bold/12pt/left/one-inch margins and Times New Roman Bold/20pt/centred/
  half-inch margins remain intact in the controlled examples. Each pair has
  one A4 page, matching font, vertical text position and text height. Left
  anchors remain exact. The centred text moves horizontally to retain its
  centre after the word width changes; midpoint difference is under0.05pt.
  No clipping, overlap or extra page was observed. Three pairs cover only
  **two distinct, single-heading formatting configurations**.
- **Evidence integrity:**905source hashes,9accepted input hashes and raw
  evidence copies, all6DOCX inputs,HEAD and tracked diff remained unchanged.
  This was independently rechecked on completion before report edits. No
  execution error, signal or timeout was recorded. LibreOffice logged a
  macOS task-policy diagnostic; it exited zero and all6artifacts were created,
  parsed and inspected. It was not silently treated as a failed conversion.
- **Unverified:** Microsoft Word rendering; representative multipage/tables/
  images/fields/overflow; source-bound database saving; in-app edit/reload/
  approval/export; CI and production. No SQL, hosted mutation or activation
  occurred. All source-only blockers remain mandatory.

## Remaining authority and feature gates

The existing atomic `save_own_legacy_workspace_v1` aggregate and immutable save
receipts remain the persistence authority for legacy/imported documents.
Source-aware imports require a new server-created binding to the existing
upload manifest/digest and exact section/node mapping, with revision-specific
assessment. Its DB-issued manifest digest encoding must not be replaced by a
JavaScript JSON hash. New source-bound saves, direct-DML guards, revision
approval, owned projections and real DOCX export receipts must move together.
Historical text imports, unbound documents and immutable PDF receipts remain
compatible. Captured operation tables cannot simply accept a legacy import.

**Unverified:** formatting-preserving editing in the app; rendered pagination
and overflow assessment; saved source bindings; revision-specific DOCX
approval/export; PDF/RTF source editing; CI and hosted behavior. Original upload
retention and a source-only candidate do not satisfy those gates. No protected
hosted, Git publication or deployment action was performed by this slice.
