# Legacy wording assessment and durable model receipt

Work item: WP1/WP2, F2 persistence prerequisite and F3 exact final wording review.
Source: working overlay on `Thought-Enhanced-Document` at
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. This report is not a clean-commit,
database attachment, live-provider, browser approval, export or production claim.

## Implemented boundaries

`cost-tracker.ts` returns a frozen typed terminal-attempt receipt from the
existing accounting/result record. Fresh acknowledgements validate database
UUID identities and the existing stage/request/attempt model-call key. Exact
lost-acknowledgement readback and checkpoint replay validate owner, logical
request, stage, request digest, provider attempt, terminal state, route facts
and the opaque database result digest. Input and readback data are owned before
asynchronous hashing. Historical text provider-attempt identifiers remain
valid. `authorityReservationId` identifies the current reservation authorising
the read or write; it does not relabel the original result's reservation.

`model-call-context.ts` and `provider-router.ts` add an internal, explicitly
requested checkpoint receipt. Captured lifecycle calls cannot use that option.
The option requires an accepted legacy context and a structured-output contract
before dispatch. Owner/request/scope/authority identity is retained across
reads; cancellation fences replay and fresh publication after required terminal
accounting, dispatch completion and capacity handling. Nested messages, schema
and route policy are copied before asynchronous work. The field is not part of
the provider body, provider request digest or browser stream.

An unresolved provider dispatch completion acknowledgement previously became
`OPENAI_PROVIDER_DISPATCH_COMPLETION_FAILED`. It now retains the existing
reconciliation-required classification, including when cancellation also
arrives. This correction applies to ordinary legacy calls as well as the new
internal option, preventing uncertain dispatched work from being treated as an
ordinary failure eligible for release.

`document-pipeline.ts` has a dormant `legacy-wording-assessment.1` option. It
owns accepted source/template/profile/policy data and binds the last actual
quality and grounding verdicts to their checkpoint receipts, accepted source
digest, execution-policy digest, reviewed section/unit digests and final wording
digest. A cleanup rewrite uses its own final audit round. A rejected section's
deterministic replacement cannot inherit the rejected prose's review; safe
sibling support and whole-document composition support remain distinct. The
final assessed roster is an immutable copy, including while digests resolve.
Ordinary callers still return the existing three-field pipeline result.

Grounding unit selection now includes Unicode letters and numbers. The quality
review receives upload and saved-context facts already used by factual review.
The existing evidence helper retains narrowly defined typography compatibility
while preserving signs, meaningful punctuation and Unicode; symbol-only
quotations cannot establish support. The new assessment requires verbatim
quotes. Quote mismatch remains an incomplete-review error, not a claim that the
owner supplied false facts.

## Attributable verification

- Initial receipt regressions: 1 passed, 12 intended failures, followed by
  20 passed with 12 steps. Route/readback review then found four mismatched
  usage facts accepted against a valid saved route. Their separate RED recorded
  21 passed with 12 steps and one failed test with four intended failed steps.
- Adapter regressions recorded 59 passed / 13 failures, then 59 passed /
  17 intended failures, covering context, replay, cancellation and unresolved
  completion acknowledgements. The additional route mutation RED was
  attributable; the first schema-hash RED also contained a test comparator bug.
- The corrected schema test uses the actual outbound JSON bytes, matching the
  production insertion-order hash contract. An isolated shallow-copy
  counterfactual reproduced the actual changed schema: 0 passed, one intended
  failure, 64 filtered tests, 22 ms. Original source and test hashes were
  unchanged; no shared production file was reverted. See
  `legacy-receipt-schema-corrected-counterfactual-red-20260908.json` and its log.
- Initial pipeline assessment RED: 15 passed, four intended failures. Additional
  reviewer findings produced 22 passed / four intended failures for empty
  normalised quote support, omitted non-Latin wording, a retained draft reference
  changing final bytes during hashing, and a reviewer missing upload facts.
- Evidence helper RED: 16 passed / four intended failures. Pipeline plus helper
  GREEN: 46 passed. A subsequent symbol-present control recorded 20 passed /
  one failed test with two intended failed steps before the meaningful-quote
  guard was added.

- Final combined regression: **148 passed, 18 steps, zero failures**, 30 s,
  `legacy-wording-receipt-final-focused-20260908.log`, exit 0. Independent source
  review closed the reported tracker, router and assessment findings in this
  bounded slice.
- Four adjacent generation/proxy/designer files initially reported 60 passed,
  23 failed and 86 failed substeps because their synthetic acknowledgements used
  dummy model-call keys. Their fixtures now return the exact existing
  stage/request/attempt digest and the six-field SQL acknowledgement shape;
  no behavior assertion was weakened. Re-run: **83 passed, 172 steps, zero
  failures**, 548 ms, `legacy-receipt-adjacent-fixture-green-20260908.log`, exit 0.

- Focused lint passed all 14 affected files. The original direct locked JSR
  imports now carry narrow import-style explanations; synchronous validator
  tests use `assertThrows`, and lifecycle fixtures return explicit promises.
  No behavior rule was suppressed. A heading-only pipeline control also passed,
  proving no fabricated grounding receipt can fill an empty audit-unit set.
- Full Edge gate `upload-source-edge-gate-20260908152635463`: **1,496 tests and
  202 steps passed**, zero failures, 44 s. Entry-point/helper type checking,
  the expanded 42-file lint gate and diff checks passed. Source, HEAD and the
  owner's selected web dotenv file were unchanged. Top-level log:
  `legacy-wording-receipt-integrated-edge-20260908.log`, exit 0.

The controlled transports exercise production routing/pipeline/contract logic;
their synthetic acknowledgement UUIDs and digests do not prove real PostgreSQL
storage or model quality.

## Remaining acceptance

No handler activates this assessment option. Atomic workspace attachment,
reservation-bound document/section identity and revisions, durable cancellation,
allowance settlement, reload adoption and exact approved-revision export still
need integration through the existing authoritative records. A checkpoint
receipt alone is neither semantic approval nor durable document attachment.
SQL, browser, CI, live-model, persistence and export gates remain separate.
