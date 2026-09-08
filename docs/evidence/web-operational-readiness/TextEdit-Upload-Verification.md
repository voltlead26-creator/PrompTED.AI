# TextEdit upload verification

**06:22 AEST completion — upload SQL GREEN, combined source gate failed.**
`job-mtq9aaql-702e8bce` ran approximately 138 seconds and exited 1. Evidence:
`db-20260906202015598-0546af45`. All **1,617/1,617 SQL assertions** passed in
both the fresh and representative historical-upgrade databases (37 test files,
70 selected migrations), including all 97 source-checkpoint assertions. All
**39 real local Auth/PostgREST checks** passed, including old named-call
compatibility, source readback after discarded acknowledgement, private-column
and cross-owner denials, terminal replay and independent SQL persistence read.
Every copied SQL input still matches its manifest and current selected SQL.
Disposable resource inventories before/after are identical; cleanup succeeded.

`pnpm verify:web` also exited 0 (295 shared tests, 896 web tests, production
build 29 pages, bundle gate 11 deferred boundaries/3 critical routes/1 catalogue
chunk). However, the source guard detected changes to MasterWorkspaceImport.test,
ingest exact-replay.test, plus newly added upload-fallback-provenance.test and
ollama_captured_fallback.test. Final tracked/HEAD comparisons after that guard
were not reached. The wrapper correctly did not start its Edge phase. This is a
failed whole-source run with attributable immutable SQL/HTTP success, not a
stable combined revision pass. The temporary database-action claim was removed
after verified cleanup; the unfinished source claim remains owned.

Independent read-only review found a separate integration conflict in foreign
provider work: valid fallback metadata adds a ninth response and sixth payload
key, while accepted upload-extraction.2 settlement permits exact eight/five-key
sets. Its draft provider migration does not redefine settle_upload_ingest.
That future combination rejects with UPLOAD_INGEST_SOURCE_PRIVACY_INVALID after
classification. The active old-arity admission still defaults to v1; this does
not explain all current failures. Do not remove the private-source key guards
or adopt the foreign policy by implication. No destructive same-hunk overwrite
of the owned checkpoint/identity/Master lease protections was found.

**Next implemented slice — TextEdit decoding and safe Unicode truncation.**
The existing resolver now decodes a copied original once: fatal UTF-8 by default,
or strict UTF-16LE/BE only when the byte-order mark declares that encoding.
Decoded NUL, malformed sequences and resource excess still reject explicitly.
The derived immutable text is reused after the async boundary; original bytes,
request identities, versioned checkpoints and provider policy are unchanged.
The common output ceiling no longer splits a supplementary character, and the
shared confirmation parser accepts the exact positive bounded extracted count
after safe truncation/whitespace cleanup instead of requiring all truncated
results to contain exactly 20,000 code units. Exact count/filename checks remain.

Regressions reproduced 12 text-parser failures and 2 confirmation failures for
the intended reasons before the fix. Initial fixture typing errors are saved
separately and are not RED behavioral evidence. Current verification records
`format-preservation/textedit-local-verification.json`: **200 Edge tests** and
**40 shared upload tests** pass, including 30 new encoding/boundary cases and
four real extractor-handler/client roundtrips, plus an adjacent DOCX boundary
case. Extract/ingest entry types, shared types, three changed Edge-file lint,
shared lint and diff checks pass. The five selected production/test file hashes
are unchanged across these commands. Full web/Edge verification of this new
slice remains pending.

The roundtrips use controlled original reads and HTTP dispatch; they are not
real Storage, provider, browser, hosted or exported-artifact proof. No hosted
migration, deployment, secret, original user file, plugin or native-app change
occurred. Previously failed identical uploads still replay their immutable
failure; an explicit linked recovery contract is required before claiming that
case repaired. RTF needs its own bounded parser/source/wire/SQL/UI contract.
Format-preserving PDF/DOCX editing/export remains incomplete.


**06:42 AEST completion — broader TextEdit checks and lint repair.**
`job-mtqa156e-5f37305f` exited 1 after approximately 73 seconds. Its evidence
`upload-source-full-gate-20260906204108085` records **939/939 Edge tests**,
all **26** active entry-point type checks, and complete `pnpm verify:web`
success: 165 deployment tests, 223 root checks, 297 shared tests, 896 web tests,
29 generated pages and the progressive-bundle gate. Source, HEAD and the web
dotenv metadata/hash snapshot stayed unchanged throughout that run.

Only source lint failed: a foreign import was placed before the existing
file-level Deno import-policy directive in ingest-upload/handler.ts, so the
previously permitted base64 import triggered two lint errors. The directive has
been returned to the first line without changing the executable import order or
body. All **18** targeted files now pass lint; diff checks pass. Saved
`lint-correction.json` proves reversing that two-line swap exactly recreates
the handler hash used by the broad run. The failed CPJ result remains recorded;
`source-lint-corrected.log` is the separate post-fix result.

A later full source comparison also observed foreign model-call-context and
model-call-dispatch-contract test changes, plus its plan update. Therefore the
939-test result must not be promoted to current combined-source acceptance.
The TextEdit slice has focused/adjacent/types/lint and broader runtime evidence,
with historical retry, authenticated browser/Storage, CI and production still
unverified. The continuing RTF implementation must retain its own actual source
format and protected original; enabling a file extension alone is insufficient.
