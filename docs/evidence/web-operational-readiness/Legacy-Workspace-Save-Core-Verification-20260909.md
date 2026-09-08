# Legacy workspace save core — local verification

Verified 9 September 2026, Australia/Melbourne.

**Implemented; Verified locally; Workflow exercised; Persistence proven:** the existing owner-authenticated legacy workspace save now delegates to a private explicit-actor core. Its original body changes only the actor initializer. The existing public function retains its OID, owner, ACL, argument contract, defaults, security mode, search path and every other catalog property except its intentionally replaced body.

This is a prerequisite for atomic generation attachment and allowance settlement. It does not activate that finalizer or establish deployment readiness.

## Attributable source

- Repository: `voltlead26-creator/PrompTED.AI`.
- Checkout: `/Users/kaichurchw/PrompTED.AI`.
- Branch: `Thought-Enhanced-Document`.
- Base HEAD: `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`; verified dirty implementation overlay, not a new release commit.
- Runtime: Node22.23.2, pnpm10.33.0, Deno2.9.5; identified disposable local Supabase instance.
- Migration: `supabase/migrations/20260908160000_legacy_workspace_save_core.sql`, SHA256 `2c1d3624c48f5f6c2abb7adc888515095cff44fb8b27e7b8b345e81db95576d6`.
- Regression: `supabase/tests/legacy_workspace_core.test.sql`, SHA256 `25e4515639774158b963ea788d21afd22a489787686b6869dd9608f65198e982`.
- Existing body SHA256: `6a7eb1228611c35c64720b3d3c2654f039d510c797010739b34046639fa5897b`.
- Extracted body SHA256: `cbebe21e2b42c68b96ee588075889c1c2f83e90ca7d644e59d5de1164057a756`.

The migration checks the expected predecessor body before replacement, preserves the complete public catalog identity, transfers the private core to the existing wrapper owner, and rejects any effective non-owner execute grant. No JWT substitution, alternate persistence table, API default or billing limit was introduced. The web deployment contract requires the new migration without exposing a new public RPC.

## Regression and historical acceptance

The full intended negative baseline is `db-20260908165924298-b9ed843e`: all2,511 older assertions passed, while the new62 assertions recorded35 passes and27 expected missing-core failures. This established the absent extraction contract, not27 distinct application defects.

The completed corrected run is [db-20260908171929839-fa874a7a/summary.json](db-20260908171929839-fa874a7a/summary.json), associated with `job-mtsxpjg3-3c4803a7`:

| Gate | Observed result |
| --- | --- |
| Fresh database | 80 migrations; 49 SQL files; 2,573 assertions passed |
| Exact predecessor | 79 migrations; 48 SQL files; 2,511 assertions passed |
| Historical upgrade | Only migration160000 applied; upgraded49 files /2,573 assertions passed |
| Harness | 276 assertions passed |
| Real Auth/PostgREST | 23 requests passed with two authenticated synthetic owners |
| Web gate | 165 deployment,223 root,382 shared and1,035 web tests passed; lint/types/build/progressive checks passed |
| Source attribution | All918 source hashes, HEAD and tracked diff unchanged |
| Cleanup | Exact disposable stack cleanup exited0 |

The historical exercise created two outcomes, two documents, four sections and three receipts before migration. Every column of those records remained exact across migration. It changed one section before migration, retained its history and omitted sibling, then replayed the older creation receipt against the newer document revision. Old public receipts also replayed after migration and after another new save. A trusted explicit-actor core call returned the same public receipt without another mutation.

Four final stored receipt results independently matched the real public RPC acknowledgements. Anonymous, service and other-owner public calls were denied. Actual SQL calls under authenticated, anonymous and service roles could not execute the positively resolved private core. Stale revision and changed intent failures preserved all rows.

The62-assertion regression additionally covers literal whitespace, explicit actor isolation from ambient JWT settings, full-roster conflicts, parent revision5→8 after section and metadata changes, approval invalidation, and injected receipt-storage failure after pending writes followed by complete rollback.

The first upgrade harness run stopped because PostgreSQL emits OID values as JSON strings. That fixture boundary was corrected with a63-pass/5-intended-failure reproduction followed by68 focused passes. Direct PostgREST's stale `40001` status expectation was also corrected to500; exact error and persistence assertions remain. Production migration bytes did not change during these harness corrections.

## Remaining boundaries

**Verified in CI:** unverified for this overlay.

**Production exercised:** no new hosted mutation or deployment in this slice.

**Export inspected:** not applicable to this save-core extraction; no export acceptance is inferred.

**Blocked / Unverified:** F2 remains open. The generation handler still needs a workspace/source admission before provider dispatch, a claim- and cancellation-bound finalizer that saves and settles in one transaction, and browser reload/adoption of its exact persisted receipt. Actual provider quality, browser generation, approval/export integration and release acceptance remain separate gates.
