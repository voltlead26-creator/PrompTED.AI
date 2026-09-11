# Dormant DOCX source binding — local verification

The previously empty migration now implements
`prepare_docx_source_document_v1(uuid, uuid, text, jsonb)`. It binds a completed,
owned DOCX upload checkpoint to the existing outcome/document/section aggregate.
The original upload receipt, manifest, content digest and retained path remain
unchanged. Literal source wording lives in `public.sections`; the private binding
stores immutable identities and digests, not a second editable document.

The service-only command validates the manifest and complete source-unit roster,
serializes requests through the existing account-deletion fence and upload lock,
and returns the same document/outcome for identical replay. It rejects foreign
owners, changed source text, stale digests, missing/duplicate units, invalid
paragraph partitions, changed assessments and an unavailable retained path.

The binding is dormant. Restrictive browser policies, privileged mutation guards,
and existing workspace/export reader guards prevent it from entering unsupported
HTML editing or legacy export. Ordinary deletion cannot erase replay identity;
the existing account-erasure cascade remains supported. Activation requires a
separate reviewed editing/export/deletion contract.

## Evidence

Disposable run `db-20260911120042849-794c4b18`, against the uncommitted overlay on
`Thought-Enhanced-Document` at `c3c2ef6dd49bbdf12330b8a4ae5a0c87b2fc3316`:

- All 52 DOCX SQL assertions passed.
- All 51 SQL files passed: 2,695 assertions, including adjacent upload,
  workspace, allowance, ownership, export and deletion contracts.
- Fresh startup/reset, cleanup and source-integrity comparison passed.
- `pnpm verify:web` passed, including 1,155 web tests, 423 shared tests, lint,
  type checking, production build and progressive bundle budgets.
- Static migration validation passed for 82 migrations; deployment-contract
  validation passed for 26 functions.

The detailed logs and immutable source hashes are in the ignored directory
`docs/evidence/web-operational-readiness/db-20260911120042849-794c4b18`.
The test's Storage metadata fixture is transaction-local; it does not prove real
Storage object contents. The existing manifest producer has separate tests.

This is fresh local database evidence, not a hosted migration, deployed feature,
browser DOCX workflow, concurrent multi-connection replay exercise, schema-lint
result or inspected Word export. Those outcomes are not claimed by this report.
