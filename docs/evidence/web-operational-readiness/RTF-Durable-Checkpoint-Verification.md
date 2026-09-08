# RTF durable checkpoint verification

Prepared 7 September 2026, Australia/Melbourne. This report describes a local
forward migration on the dirty `Thought-Enhanced-Document` overlay based on
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. It is not hosted or product acceptance.

## Defect and intended behavior

The private extraction client/handler can now validate explicit v3 source
results, but current database commands reject v3 admission and cannot bind the
RTF manifest durably. The previous recursive public-result privacy guard also
does not reject the RTF identity keys. A retained original and extracted preview
must share one owner, upload, request, claim token and immutable accepted version.
An RTF source-only checkpoint is not permission for format-preserving editing.

The baseline regression ran through the actual existing database commands and
private helper seams on a uniquely identified disposable Supabase instance.
`job-mtqd12v9-54eba0ce` recorded 1,682 assertions: 1,674 passed and only the eight
intended new regressions failed. See
[saved SQL output](db-20260906220503917-00b44fba/fresh-tests.log) and
[run receipt](db-20260906220503917-00b44fba/summary.json).
No unexpected old/foreign SQL failure remained in that run.

## Implemented and verified on a fresh local database

| Changed file | Purpose |
| --- | --- |
| `supabase/migrations/20260907081500_upload_source_checkpoint_v3.sql` | Extend existing upload constraints and RPCs, add private RTF validation and metadata comparison, preserve accepted history and fence expired v3 work. |
| `supabase/tests/upload_source_checkpoint_v3.test.sql` | Actual command/readback, typed manifest, privacy, immutable source, recovery, failure and terminal replay regressions with positive owned fixtures. |
| `supabase/tests/upload_source_checkpoint_v3_leases.test.sql` | Bounded real two-session lock waits, expiry rejection and v1/v2/v3 claim timing compatibility. |
| `supabase/deployment-contract.json` | Require this ordered migration for `extract-upload` and `ingest-upload` deployment readiness. |

The forward migration extends the existing private checkpoint fields; it does
not add a second store or rewrite rows. Existing nine-argument claim and
twelve-argument record signatures retain `.1`/SQL-null defaults. The original
v1/v2 constraint predicates and terminal receipt replay remain literal.
The base migration and current draft hashes are recorded in
[migration provenance](format-preservation/rtf-v3-migration-provenance.json).

V3 requires policy `.2`. RTF and DOCX require their own source manifest; PDF,
XLSX and text require SQL-null source fields. The RTF normalizer uses exact typed
manifest keys, accepted original SHA/length, recomputed UTF-8 wording digest,
the one-MiB bound and 20,000 UTF-16 unit preview bound. The existing database
JSONB digest domain remains authoritative. Normalization canonicalizes an
integral JSON length but never trims or normalizes source wording. Filename/MIME
comparison follows existing NFKC/trim rules; stored metadata stays unchanged.

V3 attempts and records reject expiry after row-lock waits; recording checks
again after normalization. Provider replay checks the live checkpoint lease
before returning idempotent success. New-v3 insertion time is separate from the
historical invocation clock. Same-current-token late completion remains valid;
rotated tokens and changed terminal results reject. Uncertain storage does not
permit a blind second Storage write. Failure/reconciliation can settle without a
checkpoint and must exclude private source metadata.

## Evidence and review

Independent read-only reviews checked production changes and fixture reasoning.
The timestamp compatibility issue was corrected before execution. Review also
identified a size-limit test that would reject for a mismatched length; both
manifest and accepted lengths now match, with exact-limit positive coverage.
Lease tests observe the exact waiting backend and blocker, drain each async
result, and independently inspect unchanged/rotated tokens and durable state.
Their normal cleanup names only their six uploads and one synthetic owner;
unexpected SQL-abort cleanup belongs to the disposable runner.

The RTF fixture embeds the independently inspected 449-byte AppKit file and its
exact multilingual preview. SQL tests verify those byte/text hashes separately.
Boundary tests with changed accepted lengths are normalizer-only fixtures and do
not claim that larger original RTF files were parsed. DOCX reuses the established
1,370-byte archive manifest. Lease fixtures test checkpoint state rather than
parser behavior. Positive v3 PDF/XLSX parsing is not established by these SQL
fixtures; their old execution behavior remains covered separately.

Before fresh execution: `node scripts/check-migrations.mjs` passes (72 files).
`node --test scripts/database-test-isolation.test.mjs scripts/check-deployment-contract.test.mjs docs/evidence/web-operational-readiness/disposable-database-reset.test.mjs docs/evidence/web-operational-readiness/upload-source-sql-scope.test.mjs`
passes 95 checks. The unchanged runner's `--preflight-only` passes:
[preflight receipt](db-20260907010754242-672e3022/summary.json).

## Outstanding gates

**Historical/HTTP/Storage execution passed at 11:35 AEST:**
`job-mtqkgbbt-5d952092` ran approximately 139 seconds. Every one of the 1,850 SQL
assertions passed on both the fresh and upgraded database. The probe passed
163 real HTTP checks, preserved five full historical rows, and verified ten
original Storage objects byte-for-byte. Independent SQL verified source digests
and settled state. Actual local access/duplicate errors were HTTP 400 with
`NoSuchKey`, `NoSuchBucket`, `KeyAlreadyExists` and `AccessDenied`; the probe did
not turn an unexpected server fault into denial proof. Complete web verification,
exact owned cleanup and resource/source identity checks passed.
See [acceptance receipt](db-20260907013252038-6d0938c8/upload-v3-upgrade-acceptance.json),
[original hashes](db-20260907013252038-6d0938c8/upload-v3-originals.json) and
[run receipt](db-20260907013252038-6d0938c8/summary.json).
This supersedes the preparation-only status below. It remains local
Auth/PostgREST/Storage proof with controlled extraction/classification fixtures.

The historical/HTTP/Storage probe is prepared in
`upload-source-v3-upgrade-acceptance.mjs`, with 24 passing guard/error-contract
tests. The existing runner's explicit v3-mode preflight passed at
[preflight receipt](db-20260907013117148-1e0f9b39/summary.json). It uses every
current SQL file, a pre-service exact predecessor/suffix check, unchanged target
attestation and reset guard, and hashes/copies all added modules and fixtures.
Two independent source reviews cleared the final draft. This is preparation;
actual upgrade and HTTP/Storage execution has not yet passed.

The probe compares five complete historical rows across the sole forward
migration: v1 and v2 processing/completed operations plus a labelled SQL-seeded
NULL-contract processing row. Old claim defaults and recorded versions remain
observable through real PostgREST. Its new v3 rows cover RTF, DOCX, UTF-16 BOM
TextEdit text, Markdown and a positively authenticated second owner. Actual
Storage writes precede retention acknowledgement; bounded authenticated GETs
must return identical bytes before and after checkpoint/recovery/settlement.
Classification and extracted text are controlled fixtures. A discarded
application acknowledgement is explicitly not a dropped-network simulation.

Storage denials require a recognised access/not-found result, and duplicates
require a recognised conflict result; neither 5xx nor arbitrary client errors
count. Both legacy and current error envelopes are documented by
[Supabase Storage error codes](https://supabase.com/docs/guides/storage/debugging/error-codes).
The run must confirm the actual local envelope. Original readback after rejected
overwrite, a second owner's positive object, cross-owner and anonymous reads,
private public-route rejection and browser insertion denial complete this
bounded Storage proof. Full browser upload/editing/export remains separate.

**Fresh execution passed at 11:15 AEST:** `job-mtqjrokv-5cb50a05` completed in
approximately 101 seconds. All 72 migrations and the explicit fresh reset
passed; **1,850 SQL assertions across 41 files passed**. The complete web gate
also passed, including build and bundles. Exact owned cleanup and resource/source
identity checks passed, and completion inspection found no source drift.
See [SQL output](db-20260907011342822-ed25ab1c/fresh-tests.log) and
[run receipt](db-20260907011342822-ed25ab1c/summary.json).
This accepts the private fresh-DB slice at migration SHA
`effa693913ca50244456fbb40d10fe320311a69e59cdf44e3fe4ed26424d1727`.

The first forward-v3 execution, `job-mtqjn2u8-1a41d66d`, failed after about
57 seconds during startup migration application. PostgreSQL reported SQLSTATE
`42601` at statement 12: the CASE expression in the PL/pgSQL IF policy check
needed parentheses. See [migration failure](db-20260907011008017-dd75b6c2/start.log)
and [run receipt](db-20260907011008017-dd75b6c2/summary.json). The explicit fresh
reset and SQL tests were not reached. The narrow syntax correction preserves
the exact policy comparison; no test assertion was weakened. All web checks
passed, exact owned cleanup passed, resource inventories and source/HEAD matched,
and the completion-turn source comparison found no intervening edits. This
execution supersedes source-review confidence about SQL validity; acceptance
still requires an actual passing migration and behavioral tests.

- Existing foreign `credit_fallback` completed-result extra-key conflict, which
  the unchanged closed v2/v3 settlement envelope still rejects.
- V3 ingest/browser admission, actual Storage retry/reload/cancellation,
  historical failed-upload recovery and authenticated Master upload acceptance.
- Actual PDF/Word formatting-preserving editing and export. The mandatory RTF
  `rtf-format-preserving-editing-unverified` blocker remains truthful.
- Exact release revision, CI, protected hosted changes and production acceptance.

The broad web gate passed with the RED run, but that proves neither the new SQL
nor a signed-in user upload. No hosted schema, Storage, function, secret or
Netlify mutation is part of this local verification slice.
