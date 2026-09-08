# Exact Word source units — dormant mapping verification

8 September 2026, Australia/Melbourne. Existing maintained checkout,
`Thought-Enhanced-Document`, HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`
plus the recorded local overlay. This slice follows the independently inspected
whole-DOCX compiler; no document editing, approval, export or schema activation
is claimed.

## Implemented

`document-source-contract.ts` adds the dormant `word-xml-units.1` projection with
explicit `literal-text.1` content encoding. `wordprocessingml-source.ts` derives
paragraph membership within the existing namespace-aware XML traversal. It
retains empty direct-body paragraphs and distinct text nodes, including
adjacent differently formatted runs. It does not guess grouping from wording,
titles, offsets or extracted paragraphs. The original `word-xml-source.1`
serialized shape and immutable source manifests remain unchanged.

Each node is one exact literal content value. The result is an initial source
projection, not fabricated document/section rows or a mutable content store.
Future current wording belongs in `Section.content`; the existing HTML editor
must not consume this encoding until its source-aware path is implemented.
HTML, TED tokens, whitespace and Unicode receive no interpretation or trimming.

The reverse helper captures all caller bytes and nested values before its
first await, rederives the original source, and requires its exact main-part
hash and **complete ordered unit roster**. It emits every current changed unit
against the original and validates representability through the existing Word
patcher. Sending only the latest edit is rejected: otherwise recompiling from
the original could restore an earlier accepted edit. Missing, duplicate,
unknown, reordered or stale identities reject.

Both projection and patch plans remain frozen and `source_only`. Package
semantics, style/visibility and layout assessment remain mandatory blockers.
Unmapped wording controls, unsupported ancestry, fields/revisions and
unpatchable payloads reject changed output. No-op projection preserves original
bytes. Paragraph tab-stop properties are distinguished from literal run tabs.

The dormant mapping admits at most512units,512paragraphs,20,000characters per
unit and1MiB combined literal values, with a cumulative20s deadline. These do
not weaken the existing XML patch contract: its independent1MiB budget counts
**both expected and replacement text**. A1MiB current roster can be observed
unchanged; rewriting every value can exceed the stricter patch budget and must
fail explicitly. No editing capability or capacity promise is inferred.

## Verified locally

- RED: one missing-projection regression failed for the intended reason in
  `word-source-units-red.log`.
- Latest adjacent suite: **159 tests plus12 archive steps passed**, zero
  failures, in3s. See `word-source-units-adjacent.log`.
- Nine unit-projection cases and one complete-DOCX integration case cover
  distinct/adjacent/repeated source nodes, empty paragraphs/nodes, comments,
  CDATA, nested content, aliases/default/strict namespaces and shadowing;
  whitespace/NBSP/combining/supplementary Unicode/literal markup/TED tokens;
  exact complete-roster identity; no-op; first edit then second edit preserving
  all current wording and untouched siblings; unsupported changes; source and
  current-value limits; caller mutation; pre/in-flight cancellation/deadlines.
- Exact512unit/paragraph,20,000character and1MiB observation boundaries pass;
  one-over source/current aggregate limits reject. The stricter full-rewrite
  patch budget also has an explicit rejection test.
- Focused lint and frozen/no-network type checks pass. Independent read-only
  source review found no concrete blocker; its exact-limit coverage refinement
  was added and tested.
- Regenerating all three prior DOCX pairs under this code yields **six
  byte-identical artifacts**. Independent Python ZIP/XML inspection passes.
  Those exact bytes were already opened/rendered with LibreOffice and all six
  pages visually inspected in the preceding completed run. See
  `word-units-artifact-compatibility-20260908/byte-compatibility.json`.

The fresh combined web/Edge gate **passed and was inspected** on8September2026,
07:06AEST. Source inputs and local evidence are pinned in
`word-source-units-preflight.json`.

Job `job-mtrqb96c-fedaf569` exited0 in82.158s. Full web verification passes:
165deployment contracts,223root,379shared and951web tests,lint/types,production
build and progressive bundles. Full Edge verification passes **1,195tests
plus12steps**,26entrypoints+2helpers type checking and28-file lint. All35outer
check dispositions have exit0 with no signal/error.905source hashes,
9accepted input hashes and raw copies,6DOCX inputs,HEAD and tracked diff remain
unchanged, independently rechecked on the completion turn before report edits.

LibreOffice opened/rendered all six original/candidate DOCX files again. Text,
fonts, parsed page coordinates and PNG bytes match the previously inspected
six pages. Both distinct candidate layouts were visually reopened this turn.
The first raw comparison of the HTML position wrappers failed because their
PDF CreationDate metadata changed; the difference was read and recorded, then
the page/word coordinates and previews were independently compared. This was
an evidence-comparison correction, not a layout defect or failed test gate.

Exact result:
`docx-candidate-20260908/verification-20260907210439836/completion-comparison.json`;
full source gate: `upload-source-full-gate-20260907210443368`.
**Verified locally; synthetic artifact workflow exercised and inspected.**
Source-bound persistence, product approval/export, CI, production and source
editing activation remain unverified. No SQL or hosted mutation occurred.

## Required next integration

Use the existing owned upload/checkpoint, document/section aggregate, atomic
legacy workspace save receipts and transaction-capability mechanism. The
source binder must derive real section IDs and immutable node mappings from
the owned original, validate them against the private checkpoint, and bind
subsequent saves to expected source/document/section identities. Do not accept
browser-authored mappings as independently verified structure. Do not put a
plain-text source value through the generic HTML editor.

A forward dormant SQL change must preserve historical V1 hashes/replays,
private manifest digest encoding, direct-DML protection, source lifetime and
account-deletion behavior. Source-bound approval/export remains blocked until
exact revision preservation assessment and genuine DOCX export receipts are
connected. No schema migration or runtime caller was added by this slice.

**Unverified:** persisted source binding; browser source editing/save/reload;
revision-specific source approval/export; general complex Word/PDF/RTF
formatting; CI and hosted behavior. The previously proven local upload/Profile
workflows and prior synthetic artifact inspection remain separate evidence.
