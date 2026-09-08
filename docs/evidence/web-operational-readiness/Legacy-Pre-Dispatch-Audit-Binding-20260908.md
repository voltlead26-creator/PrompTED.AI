# Legacy pre-dispatch review identity — local implementation record

Recorded 9 September 2026 AEST in `/Users/kaichurchw/PrompTED.AI`, branch
`Thought-Enhanced-Document`, HEAD `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`.
These are dirty-overlay results, not an accepted commit, CI or production release.

## Problem and scope

The existing terminal checkpoint receipt identified the provider response but did
not retain a pre-dispatch commitment to the exact wording and sources reviewed.
This slice adds that identity to the existing reservation/admission records and
passes it through the existing accounting, router and dormant pipeline assessment.
It creates no alternate document, billing or provider authority.

It does not yet bind a writer to a workspace revision, attach generated sections,
settle a completed-document credit atomically with a save, or activate the new
assessment in the generation handler. F2 remains open. Stored review metadata is
identity evidence; the actual reviewer outputs still require semantic validation.

## Implemented source

- `supabase/functions/_shared/document-audit-binding.ts`: owned, closed source and
  audit metadata; versioned, length-framed UTF-8 commitments. No alteration to
  existing provider request/result hash serialization.
- `cost-tracker.ts`, `model-call-context.ts`, `provider-router.ts` in that same
  directory: paired metadata/source capture, exact twelve-argument audit read,
  four-key response validation, stored-versus-requested equality, and admission
  UUID/digest qualification after the unchanged terminal acknowledgement. Both
  replay paths and lost acknowledgements use actual stored evidence. Default
  callers retain their previous wire contracts.
- `document-pipeline.ts`: one immutable target/unit snapshot per review round,
  shared accepted sources, separate quality/grounding metadata and receipts,
  cancellation fences, and exact round-3 binding after final cleanup. Empty-unit
  drafts retain bounded recovery but cannot acquire a grounding receipt.
- Corresponding five test files plus `document-audit-digest.fixtures.json`:
  independent digest vectors, hostile object/array boundaries, real router
  transport fixtures, actual outbound reviewer schema rosters and failure paths.
- `supabase/migrations/20260908150000_legacy_document_audit_binding.sql` and
  `supabase/tests/legacy_document_audit_binding.test.sql`: existing private source
  and admission commitments, immutable fields, owned replay lineage, pre-locking
  before unchanged readers, private helper grants and the new service-only RPC.
  The first execution reproduced an identifier-whitespace mismatch; the narrow
  correction is implemented and independently reviewed, awaiting its re-test.
- `supabase/deployment-contract.json`: the exact RPC signature and migration
  requirement enter the existing shared runtime prerequisite checks.
- `run-master-import-web-gate.mjs`: the source lint roster includes the two new
  codec files, bringing the existing roster to 44 files.

## Executed evidence

1. Corrected SQL predecessor `db-20260908161352471-1eadec09`, job
   `job-mtsvd5cn-3f27abd9`, applied 78 migrations and ran 48 SQL test files.
   All 2,365 assertions in the 47 existing files passed. The new file completed
   all 137 assertions: 51 passed and 86 failed because the audited contract and
   immutable fields were absent. The TAP plan completed normally. These are
   grouped contract failures, not 86 separate production bugs.
2. That run's complete web gate passed 165 deployment, 223 root, 382 shared and
   1,035 web tests, lint/types, production build and progressive-bundle checks.
   All 915 source hashes, HEAD and tracked diff stayed unchanged. Exact cleanup
   exited zero. No upgraded-history, browser, provider or hosted journey ran.
3. `legacy-audit-admission-transport-red-3-20260908.log` is the clean transport
   predecessor: 102 controls/16 steps passed and 22 new cases failed. Earlier
   compilation-only and overlapping-source attempts remain diagnostic records.
4. `legacy-audit-pipeline-dispatch-red-20260908.log` passed 27 controls and failed
   five new cases: no audit-binding preparations, and missing/malformed/changed
   binding responses did not prevent success.
5. `legacy-audit-admission-integrated-first-20260908.log` passed **196 tests and
   34 steps** in 30 seconds across the tracker, context, router, codec and final
   audit pipeline. This includes the later nonallocating historical probe
   controls, pre-dispatch schema/binding comparisons, source budget, 512-unit
   ceiling and cancellation during digest preparation. HTTP/RPC transport is
   controlled; no paid provider or real database call is inferred.
6. `legacy-audit-admission-integrated-lint-20260908.log` passed all ten changed
   source/test files. The deployment checker passed 26 functions, the migration
   checker passed 79 migration files, and `git diff --check` passed.
7. Completed `job-mtsvvef6-4cb63c65` first ran the full Edge gate
   `upload-source-edge-gate-20260908162804040`: **1,564 tests and 220 steps**
   passed in 44 seconds, together with 26 entry-point types, two helper type
   checks and 44-file lint. Source, HEAD and the selected web dotenv were unchanged.
8. Its database run `db-20260908162851217-e37cdf8b` applied all 79 migrations
   and executed 2,508 assertions in 48 files: **2,506 passed, two failed**.
   The new audit-binding file passed 141 of 143 assertions. Assertion 52 proved
   that a whitespace-prefixed identifier roster was incorrectly accepted;
   assertion 55 independently detected the resulting unwanted row mutation.
   Every assertion in the 47 older files passed. The complete web gate also
   passed (165 deployment, 223 root, 382 shared, 1,035 web tests, lint/types,
   build and progressive checks). All 916 source hashes, HEAD and tracked diff
   stayed unchanged, and exact disposable cleanup exited zero.
9. `job-mtsweend-30474aa9` / `db-20260908164250794-48b24216` ran the
   corrected migration. All 2,494 executed assertions passed, including the
   identifier rejection and unchanged-row sentinel. The new SQL file stopped
   after 129 assertions because its new positive label fixture called
   `to_jsonb` with an untyped Unicode string. PostgreSQL could not infer the
   polymorphic argument type; the last 17 assertions and historical upgrade
   were not reached. The complete web gate, unchanged 916 source hashes, HEAD,
   tracked diff and exact cleanup passed. This is partial post-fix evidence,
   not a completed SQL acceptance pass.
10. The fixture now casts that literal to `text`. No assertion or production
    SQL changed. Independent source review checked all remaining polymorphic
    fixture calls; `legacy-audit-upgrade-fixture-guards-20260908.log` passed all
    30 helper guards against the updated exact test-file hash
    `878ffb2325dd55e738f621d507200f4daa6861f6ad3e5d5a26d765e8f8361a15`.
11. Completed `job-mtswjsfw-07e3aa5c` /
    `db-20260908164701953-5aab36ed` passed **2,511 assertions in 48 files**
    on both the fresh and upgraded database. The exact predecessor passed
    2,365 assertions in 47 files. All 146 new audit-binding assertions passed.
    Its **66 real local Auth/PostgREST checks** exercised positive historical
    and new records, paired admissions, exact replay, owner/role denials,
    malformed and conflicting inputs, and independent SQL reads. Complete
    old-column hashes preserved six reservations, six execution claims, five
    admissions, two model results, one allowance result and four usage rows
    across migration. Already-dispatched or completed historical work could
    not acquire retrospective audit metadata. Safe undispatched adoption kept
    the original admission ID. The full web gate and 208 harness checks passed;
    all 916 source hashes, HEAD and tracked diff stayed unchanged, and exact
    disposable cleanup exited zero.

Independent source reviews covered the codec, migration, transport and pipeline.
They identified the descriptor reread and SQL identifier-trim issues. The codec
descriptor correction has its own intended failure and passing tests. The SQL
trim issue failed for the intended reason in the first 79-migration run. Its
correction now requires trim equality only for section keys, unit IDs and unit
section keys. It preserves literal label whitespace. Independent source review
passed; three added positive checks exercise preparation, the returned label
and an independent admission-row read with tabs, spaces and a nonbreaking space.

## Pending gates

The corrected migration SHA-256 is
`c50026119bda6235692d13adfa78d857427eb544e8358685d8811914ce8ef32a`.
The SQL file passed all 146 assertions, preserving all original 143. The fresh
database and exact 140000-to-150000 historical upgrade passed as recorded above.
The full Edge gate passed for the runtime source; the later correction changes
SQL only. The atomic workspace save/credit finalizer, browser recovery, approval,
export and actual provider evaluation remain separate unfinished work.

**Implemented:** the source above, including the independently reviewed trim fix.
**Verified locally:** the attributed focused, full Edge and predecessor checks;
the complete post-fix fresh and historical-upgrade SQL acceptance.
**Workflow exercised; Persistence proven:** this internal audit-binding contract
through real local Auth/PostgREST and independent operation/usage SQL reads.
This does not prove generated document attachment, browser recovery or approval.
**Verified in CI; Production exercised; Export inspected:** unverified.
No commit, push, new hosted mutation or deployment occurred in this slice.
