# RTF source preparation — 7 September 2026

**Implemented; Verified locally:** a bounded RTF text reader, v3 source producer
and additive private wire reader (see `RTF-Private-Wire-Verification.md`).
**Master RTF upload, durable v3 persistence, formatting-preserving
editing and export remain unimplemented/unverified.** This is a dependency of the
owner's complete upload/edit requirement, not a replacement for it.

The maintained checkout is `/Users/kaichurchw/PrompTED.AI`, branch
`Thought-Enhanced-Document`, HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`, with the existing dirty overlay and
no staged changes. Node 22.23.2, pnpm 10.33.0 and Deno 2.9.5 were rechecked.
The source claim remains revision 27, with no exclusive action or board conflict.
No branch/worktree, commit, publication, hosted mutation, credentials or plugin
settings changed. The current root instructions now explicitly document the
other task's narrow local Ollama exception; earlier observations that AGENTS
was still unchanged/OpenAI-only are superseded. That other implementation and
its upload-v2 settlement metadata conflict remain separate review concerns.

## Reproduction and implementation

`format-preservation/rtf-current-reproduction.log` records that both registered
RTF MIME types are rejected by current browser admission and the existing
extractor. `.rtf` has not been added to an active picker prematurely.

The new `bounded-rtf.ts` scans one complete root from raw bytes, with explicit
control-word/delimiter spans, signed32 parameters, binary payload ownership,
balanced groups and trailer validation. It rejects shared/non-byte buffers.
The policy caps input at 1 MiB, depth at 64 and lexical tokens at 100,000.
Deadline expiry is distinct from a structural limit. It is synchronous; clock
checks bound CPU work, but timer-delivered cancellation cannot interrupt a
non-yielding scan. Abort is checked before work and after asynchronous hashing.

`rtf-source.ts` interprets a defined ordinary-text subset: Windows-1252 with
active-font encoding checks, scoped Unicode fallback, paired UTF-16 units,
escaped bytes, paragraph/line/tab controls and required header destinations.
It checks the complete original even after the classifier's preview ceiling.
Fields, hidden/revised text, tables, generated lists, images, objects,
attachments, unimplemented encodings and consequential strike/super/subscript
representations reject explicitly. Unknown destinations remain marked opaque
at the reader; the upload producer refuses to classify their partial text.

The existing extraction module now exposes a prepared
`extractBoundedUploadWithSourceV3`, using one owned byte snapshot and the same
legacy extraction helper for existing formats. RTF metadata must agree with its
actual format. Malformed/unsupported content returns 422, complexity returns
413, and deadline/cancellation returns retryable 503. Existing v1/v2 accepted
unions, wire contracts, claim defaults, RPC signatures and SQL admission remain.
V3 and resource policy `.2` are explicitly prepared constants/types, not active
server admission.

The existing lightweight source-contract module defines and validates the
closed six-field `rtf-source-manifest.1`: original SHA/length, exact final
normalized preview SHA, `source_only` assessment and the mandatory editing
blocker. It contains no guessed edit ranges, layout attestation or alternative
persistence path. The normalizer copies accepted input before yielding and
checks digest/cancellation afterward. Existing DOCX manifest semantics remain.

## Review-driven regressions

Independent read-only reviewers found, and parent-run behavioral regressions
confirmed, four initial failures: shared input accepted, strikethrough flattened,
superscript flattened and subscript flattened. The saved
`rtf-review-regressions-red.log` reports 96 passed/4 failed for those reasons;
the corrections passed. Three font-definition boundary acceptance failures are
saved in `rtf-font-boundary-behavior-red.log` and corrected. The earlier
`rtf-font-boundary-red.log` hit an incidental encoding rejection and is not
equivalent behavioral RED evidence.

Initial test syntax/type errors are retained separately in `rtf-scanner-initial.log`
and `rtf-source-initial.log`. One test expectation was corrected against the
RTF brace-terminated Unicode fallback rule; a closing brace may end fallback
early. These are test-development corrections, not claimed product defects.

## Independent reader exercise

The parent created a synthetic UTF-8 text fixture, wrote an RTF with the Mac's
`/usr/bin/textutil -convert rtf -font Helvetica -fontsize 12`, then read it back
with `/usr/bin/textutil -convert txt`. This is actual AppKit-produced source,
not a claim that a user operated TextEdit or that its visual layout was inspected.

The 449-byte original has SHA-256
`c544c9bbf850cd478a42d530a5243ac6acca35c633e3b92c2db486c28357bc84`.
The first producer attempt rejected its unimplemented Apple controls; that
failure is preserved in `rtf-appkit-producer-red.log`. The reviewed extension
accepts only observed neutral zero-valued writer controls, a header-only empty
expanded-colour table with exactly matching ordinary-table slots, natural
logical writing direction, and signed or unsigned UTF-16 unit spelling. Larger
values and invalid surrogate sequences still reject. General expanded colours,
nonzero unreviewed controls and visual-order equivalence are not accepted claims.

The genuine writer uses unsigned surrogate units; the earlier strict signed-only
test was therefore updated to reject 65536 and to accept actual 16-bit units.
`rtf-appkit-compatibility-red.log` proves the missing compatibility before repair.
The observed writer marker is metadata, never evidence of trusted provenance.

`exercise-rtf-source.ts` and `rtf-appkit-producer-green.json` prove unchanged
original bytes and exact agreement between supplied text, native readback and
the prepared extractor, including Renée, an em dash, Japanese, emoji and both
newlines. The manifest normalizes against those exact bytes and wording.
The original, input and readback are saved beside the exercise. No file was
edited or exported through PrompTED's document workflow.

The encoding/control design was checked against [Microsoft's extraction guidance](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfex/205e1abf-b794-4fd0-b1e4-5210882233ab)
and [Apple's RTF extensions](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/AttributedStrings/Tasks/RTFAndAttrStrings.html).
[Apple's WWDC 2016 wide-colour slides](https://devstreaming-cdn.apple.com/videos/wwdc/2016/712ugi7vg8jznn3pc3u/712/712_working_with_wide_color.pdf)
document nonempty extended colour components; the empty-table acceptance rule
here is narrower. Modern neutral writer-control compatibility is based on the
inspected local AppKit output, not undocumented general-semantic assumptions.

## Current evidence and remaining integration

`format-preservation/rtf-local-verification.json` records eight selected source
and test hashes unchanged across:

- 146 new scanner/reader/producer/normalizer checks; all passed.
- 355 combined RTF and adjacent extraction, DOCX source, TextEdit encoding,
  client, extractor-handler and ingest tests; all passed.
- Extract/ingest entry-point type checking, eight-file lint and diff checks;
  all passed.

The broader web/all-Edge gate is prepared with the five new RTF files included
in the lint list. Its result must be read separately and must include the whole
source-drift check; earlier broad success is not current combined acceptance.

**Next integration gate after the private wire slice below:** authoritative claim,
snapshot, checkpoint, lease and settlement handling, with a new forward SQL
migration preserving literal v1/v2 behavior. Extend both generations of upload
constraints, private source validation/digests, post-lock lease checks and
public-response privacy guards. Then prove fresh and historical upgrade,
lost acknowledgement, replay and real local Auth/PostgREST persistence.

Master currently has a plaintext import path; its `readOnly` prop does not
disable confirmation. Source-only admission therefore needs an actual commit
eligibility fence before any activation. Original retention alone cannot
satisfy the owner's formatting-preserving edit promise. PDF/DOCX source editing,
RTF edit/render/export, historical failed-request recovery, signed-in browser
flows, CI, hosted deployment and production acceptance remain open. The complete
Supabase/Profile/readiness scope remains in the main evidence register.

**Final independent source review:** the prepared producer/normalizer and the
subsequent narrow AppKit compatibility changes both received read-only PASS
reviews after corrections. Reviewers did not run tests; the 146/355 results are
parent-executed. All eight focused input hashes still match immediately before
the broader gate, with no staged files (`rtf-before-broad-review.json`).


**07:27 AEST — completed broad RTF preparation verification.**
`job-mtqbmiaq-99af46ea` completed in approximately 70 seconds with exit 0.
`upload-source-full-gate-20260906212544478` records 1,086 Edge tests, all 26
active entry-point type checks, all 23 targeted lint files, and complete
`pnpm verify:web`: 165 deployment tests, 223 root checks, 297 shared tests,
896 web tests, 29 generated pages and the 11/3/1 progressive-bundle gate.
Source, HEAD and web dotenv metadata/hash snapshots are identical before/after;
the completion-turn comparison also found no source changes. This is attributable
local verification of the recorded dirty overlay at e1d514d, not committed, CI,
hosted or browser-persistence acceptance. The new v3 reader remains unactivated.
The next authorized slice is its explicit private wire/extractor integration,
followed by v3 durable checkpoint SQL/ingest and Master source-editing admission.
