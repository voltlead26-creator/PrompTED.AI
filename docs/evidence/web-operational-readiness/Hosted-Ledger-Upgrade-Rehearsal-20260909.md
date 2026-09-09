# Hosted migration-ledger upgrade rehearsal — 9 September 2026

Status: implemented and verified locally, including the database exercise and
full web gate; publication of this additional test infrastructure pending.
The latest committed application revision is `4f13e7f623a08cbe426e316fe2966857bd324c62`
on GitHub `Thought-Enhanced-Document`. Exact-head CI run34350046691 passed all
four jobs at2026-09-09T12:29:19Z. The Netlify candidate is built but unpublished.

## Reproduction and scope

The read-only hosted inventory at2026-09-09T12:49:59.736Z returned68 recorded
migrations for Supabase `jjsykocqpjlekgsbylkd`. The repository contains81.
Migration `20260906000500_captured_exact_wording_assessment.sql` is absent on
the hosted target, while later `20260906010846_profile_resume_upload_reads.sql`
is recorded. The existing release preflight correctly returns
`MIGRATION_LEDGER_DIVERGED`; the hosted version list is not an exact prefix.

The same preflight found two undeclared functions and three dormant deployed
functions. Its checked Storage policy and saved-role aggregate invariants passed.
These read-only receipts are retained outside the production tree at
`/Users/kaichurchw/PrompTED.AI-local-archive/2026-09-09/hosted-full-preflight-4f13e7f.json`.
Production's OpenAI route/capacity configuration remains a separate release gate.

This addition rehearses the actual observed version order using reviewed local
migration files. It does not assert that hosted SQL definitions are identical
to those files. It does not authorise a hosted mutation, remove an endpoint,
relax the production prefix guard, or enable a captured cohort.

## Changed files and invariants

- `hosted-ledger-upgrade-baseline.json` pins the68 observed versions and every
  current migration/test SHA-256 at source commit4f13e7f.
- `hosted-ledger-upgrade-acceptance.mjs` validates the exact81-migration,
  50-test source manifest. It exercises real local Auth, PostgREST workspace
  commands, original-file Storage and historical receipt replay for two owners.
- `hosted-ledger-upgrade-acceptance.test.mjs` rejects altered or omitted SQL,
  unknown migrations, changed observation evidence, incorrect file phases,
  empty historical fixtures, changed row identities, wording and provenance.
- `run-isolated-db-baseline.mjs` adds one exclusive rehearsal mode, using its
  existing disposable database ownership, source hashes, runtime checks,
  cleanup and broad web verification. It temporarily holds exactly13 copied
  migrations, resets only its own database to the68-version history, seeds
  positive historical fixtures, restores the13 files and applies them locally.

Historical fields must remain identical, including nulls and whitespace.
Additive schema columns are allowed. Both owners must positively read their
documents; cross-owner reads must return no rows. Replaying each original
workspace request must return the same receipt with only its replay flag changed.
Original DOCX bytes must match before and after the upgrade. These are original
file preservation checks, not proof of format-preserving editing or export.

## Verification before the database exercise

-8 focused new guard checks: passed.
-120 combined rehearsal, predecessor, source-identity and disposable-reset
  checks: passed.
-45 adjacent database-isolation, backend-baseline and live-probe checks: passed.
-`node --check` for the integrated runner and `git diff --check`: passed.
-`--hosted-ledger-upgrade-acceptance --preflight-only`: passed;
  evidence `db-20260909132148840-335fba57`. No database was started or reset.
-Supabase CLI2.114.0 help confirms `migration up --local --include-all` is
  supported. This flag is confined to this isolated rehearsal; the production
  workflow is unchanged.

The full command
`node docs/evidence/web-operational-readiness/run-isolated-db-baseline.mjs --hosted-ledger-upgrade-acceptance`
passed on2026-09-09T13:25:42.702Z. Saved evidence is in
`db-20260909132320192-d9c9aec2`; the reviewed summary is
`Hosted-Ledger-Upgrade-Verification.json`.

- Fresh81-migration and upgraded68-to81 databases each passed50 SQL files and
  2,643 assertions.
- Two real authenticated local owners created two outcomes, two documents,
  four sections, two uploads and two immutable save receipts before upgrade.
-22 local HTTP checks passed, including positive owned reads, cross-owner
  denial, byte-identical original DOCX reads and exact historical receipt replay.
- Independent SQL snapshots before/after migration and after replay retained
  every existing field on all12 fixture rows across the five authority tables.
-`pnpm verify:web` passed, including lint, types, unit/contract tests,
  production build and progressive-bundle checks.
- The disposable resources were cleaned up, HEAD stayed fixed and tracked
  source plus the copied rehearsal inputs remained unchanged during execution.

## Release status

No production migration, function deployment, provider request, configuration
mutation or Netlify publication was performed for this rehearsal. A passing
result supports a separately reviewed reconciliation procedure. The other
hosted inventory failures and missing actual OpenAI evidence must still be
resolved before production release.
