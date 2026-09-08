# Catalogue persistence repair — 8 September 2026

**Implemented and verified on the parent-run fresh database; composed upgrade verification pending.** This bounded repair adds the 37 current catalogue UUIDs missing from the historical production seed migrations. It does not establish catalogue-wide output quality, close the separate 18 profile/section mapping defects, activate captured generation, or prove a production release.

The working source remains a dirty overlay on `Thought-Enhanced-Document`, based on `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. No clean-commit, CI or hosted claim is made here. See [Template-Contract-Coverage-20260908.md](Template-Contract-Coverage-20260908.md) for the earlier source inventory and remaining contract/format gaps.

## Reproduced failure

The browser selects a slug from the bundled shared catalogue and resolves its exact UUID. `apps/web/src/lib/guest-workspace-migration.ts:30` then passes that UUID to the real authenticated `commit_guest_workspace_import` command. Its immutable receipt replay occurs before the template lookup; a new import requires an existing `public.templates` FK target. The separate authenticated `save_own_legacy_workspace_v1` command has the same persistence requirement.

The unchanged historical migrations seed 49 of the 86 current UUIDs. A valid complaint-letter UUID therefore produced `GUEST_IMPORT_TEMPLATE_NOT_FOUND`; a valid selection-criteria UUID produced `LEGACY_WORKSPACE_TEMPLATE_UNAVAILABLE`. Neither is a malformed user request or permission to silently drop the selected template.

The first attempted RED run, `db-20260908133838262-892f1afd`, aborted the new fixture after six passing assertions because it incorrectly selected `public.templates` as authenticated. That result did not prove the seed defect. Migration `20260831120000_browser_data_api_privileges.sql` deliberately revoked the older broad table grant; the actual browser reads bundled catalogue JSON. The fixture was corrected to inventory persistence targets as the database test owner while retaining actual authenticated command execution and owned document/section reads. It now also asserts that direct browser template SELECT is absent. No production grants were changed.

The corrected parent-run RED, **`db-20260908134623129-85ca604c`**, completed with exactly **47 failures out of 114 assertions in the new test**, with 67 passing controls. All other 46 SQL files passed; the complete run contained 2,365 assertions. The parent also reported full web verification passed, unchanged source/HEAD, and successful exact disposable cleanup. Evidence is in that run's `fresh-tests.log` and the top-level `catalogue-seed-database-red-2-20260908.log`.

The 47 failures comprise 37 absent UUIDs, three complaint persistence assertions, two selection-criteria persistence assertions, two unavailable-result replay assertions, and three final document/receipt counts. Positive setup included two real authenticated identities, independently owned outcomes, and an actual seeded-resume guest import with all six durable sections. Errors remain visible through a test-only diagnostic wrapper; there is no fallback insertion or substituted production command.

## Exact change

New forward migration: `supabase/migrations/20260908140000_complete_catalogue_persistence_seeds.sql`.

Source SHA-256: `fca22da9bc8280d49ba38eb97eed8664b8385e59e19759e09d9b42b44de67350`.

The payload copies all persisted fields of the 37 missing entries from these frozen authoritative sources:

| Source | SHA-256 |
| --- | --- |
| `packages/shared/src/templates/templates.data.json` | `652b3e8f745274de93339eb5f7c2bc12ab4b15adea811948225c2bd6a57e83f8` |
| `packages/shared/src/templates/phase2-templates.data.json` | `6e8957d3391d309f219cbd1e3de34a8c5f1cb6f2b130d3a073eb85c7845053c3` |

The exact write roster is UUIDs `11111111-0000-4000-8000-000000000024` through `...000053`, and `22222222-0000-4000-8000-000000000080` through `...000086`. Every UUID/slug pair is independently listed in the migration identity manifest and checked against the payload. The database schema has no slug column: this migration does not add one or infer identity from titles.

Only missing rows are inserted. The 49 previously seeded current IDs are outside the write roster. For a target UUID that already exists, every persisted metadata column must equal the frozen payload, excluding only `created_at`. An identical row is retained literally, including its original creation time. Different metadata, including an unpublished target, raises **`CATALOGUE_TEMPLATE_IDENTITY_CONFLICT`** before the first insertion. It does not overwrite or republish that row. The whole migration is transactional and locks catalogue writes while it checks/inserts; ordinary reads remain possible.

The migration contains no UPDATE, generic ON CONFLICT, schema change, function replacement, grant change, provider configuration or activation. After insertion it compares every target row with the exact expected persisted metadata. Optional absent source flags use the existing `{}` default; newly inserted catalogue entries use the existing published default. Sections, required facts, advice boundaries, related-document IDs, descriptions and flags are copied without remapping historical prose.

The existing historical seed migrations are unchanged. No attempt was made to run their obsolete documented generator path or regenerate their upserts.

## Regression and next gates

`supabase/tests/template_catalogue_persistence.test.sql` is the regression fixture. It covers the 86 exact targets, real authenticated guest/workspace persistence, independent stored text and original history, immutable receipt replay, no duplicate documents, unknown-template refusal, positive two-owner isolation and full-row preservation across denied requests. The only post-RED test change accompanying the migration clarifies the future collision/preservation fixture comments; assertions and intended behaviour are unchanged.

The parent-run fresh gate `db-20260908140608693-35c7238e` passed all 47 SQL files and 2,365 assertions, including the unchanged 114 catalogue assertions, with all 78 migrations applied. The parent also reported the complete web gate passed (component counts 165, 223, 382 and 1,035, followed by the production build), identical source/HEAD snapshots and successful exact disposable cleanup. These are dirty-overlay local results, not exact-commit CI or hosted proof.

The composed upgrade is now implemented in `catalogue-upgrade-acceptance.mjs` and the existing isolated runner, with an explicit `--catalogue-upgrade-acceptance` mode. Its curated `catalogue-upgrade-sql-baseline.json` contains only the exact 125 SQL paths and hashes from that fresh gate, with the source manifest hash and run identity. It rejects extra, omitted or changed SQL before starting services. Only after full-manifest acceptance does it derive the exact policy prefix and call the unchanged `validateLegacyPolicyUpgradePlan`; the old mode still rejects future migrations.

The runner first exercises all current SQL, holds only the reviewed `140000` file outside the migration directory, and checks both the copied phase inventory and held bytes at every target boundary. It runs the existing `124000 → 130000` fixture, restores the file in `finally`, then tests the actual `130000 → 140000` seed. Collision and idempotence probes stream the exact 151 KB migration over stdin to avoid Linux per-argument limits. The expected collision must return SQLSTATE `23505` and the exact target identity, with no partial template, workspace or allowance-history mutation. Real local Auth/PostgREST guest and workspace saves include positive owned reads, immutable replay, unknown-template rejection and owner isolation. New guard tests cover baseline tampering, phase drift, wrong SQL errors and mutually exclusive mode admission.

Required remaining steps are:

1. Run the new helper guard tests and no-service preflight, then execute the composed local upgrade mode and inspect the complete results.
2. Confirm the existing F4 exact `124000 → 130000` fixture still passes. Then verify the positive template/history baseline at `130000`, the single named/digested additive seed, new UUID persistence and preservation of every existing template/document/section/receipt row.
3. Exercise an identical pre-existing target with a historical creation timestamp, and a conflicting/unpublished pre-existing target. The former must remain unchanged; the latter must abort the seed transaction without any partial insert or overwrite. Preserve exact historical guest/save receipt replay.
4. Review the parent-maintained release prerequisites and guarded publication inputs. The package/CI/publication gate now invokes the explicit composed mode; the old F4 validator and its historical command are unchanged. The separate publication file-count limit is unchanged and remains parent-owned.

**Verified locally:** the pre-change behavioural RED and parent-run post-change fresh SQL/full web results recorded above. **Implemented:** additive migration, SQL regression, exact composed upgrade helper/guards and CI invocation. **Unverified:** composed upgrade/guard execution, collision execution, real browser recovery after this seed change, exact-commit CI and production behaviour. **Production exercised / deployed:** no action performed for this slice. Model quality, meaningful export formats and all other advertised workflow gates remain separate requirements.


### 9 September 2026 — composed upgrade execution passed

`db-20260908143641420-e9870b03` passed the complete78-migration chain and all2,365 assertions in47 SQL files on both the fresh and upgraded database. The unchanged policy helper exercised124000→130000, followed by the actual catalogue seed130000→140000. The25 catalogue HTTP checks used two real local Auth users and PostgREST; independent SQL preserved49 historical template rows, one identical target timestamp, two historical documents, two guest receipts and one title-save receipt. The precise23505 collision left all rows unchanged; the successful migration produced86 catalogue rows; executing the same file again was a data no-op. Old policy reservation/result/claim/usage rows remained exact.

The full web gate passed165 deployment,223 root,382 shared and1,035 web tests, lint/types, production build and progressive bundles. All911 source hashes and HEAD were unchanged; cleanup completed with exit0. This mode did not run browser/provider/export/hosted workflows. The subsequent full Edge gate `upload-source-edge-gate-20260908144147075` passed1,436 tests plus184 steps, entry-point types and the existing28-file lint gate; source/HEAD/selected dotenv stayed unchanged. No commit, push, CI or hosted deployment is claimed.
