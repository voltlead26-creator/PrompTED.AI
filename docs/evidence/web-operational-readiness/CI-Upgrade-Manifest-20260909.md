# Historical upgrade acceptance after upload source preparation

CI run [34346539533](https://github.com/voltlead26-creator/PrompTED.AI/actions/runs/34346539533)
on `4b0238e` passed the web, Edge and fresh SQL jobs but failed the workspace
upgrade preflight. Artifact `10102191125`, run `db-20260909114526750-b19fabcc`,
records the exact cause: the copied current SQL includes the new upload source
preparation migration/test, while the acceptance plan admits only 80 migrations.
No database service was started by that failing upgrade invocation.

The local regression exercising actual current SQL reproduced the same manifest
rejection (68 existing tests passed, one new test failed for this reason).

The repair preserves the immutable reviewed 79-migration/48-test predecessor
baseline and adds exact path/hash pins for the already reviewed source
preparation migration and its regression. The disposable runner now holds both
forward migrations and both tests while reconstructing the predecessor, then
restores and applies the exact ordered 79-to-81 upgrade. It retains all catalog,
ownership, row, historical-receipt, revision, replay and sibling-preservation
assertions and runs all current SQL after upgrading.

All 79 focused tests pass, including rejection of missing/changed upload SQL,
unknown additional files, and incorrect held-file state. Historical baseline
bytes and migration contents were not changed.

`job-mtu1znof-ad5c631c` completed all three sequential commands successfully at
12:13 UTC (22:13 AEST), against `5795d07` plus the four-file CI/upgrade overlay:

- `test:db:workspace-core-upgrade`: run `db-20260909120706660-6f0101e9`.
  Fresh, predecessor and upgraded SQL suites passed. The actual 79-to-81
  migration preserved the public RPC's catalog identity/properties, historical
  rows, sibling wording and revision-specific receipts. Two owners and 23 real
  local HTTP checks exercised replay, current revision writes and denials.
- `test:e2e:tedit`: run `tedit-browser-20260909120941709`.
  Chromium at 1440×1000 and 390×844 proved the shared approval component stays
  in the viewport after page scrolling, keyboard containment and focus recovery,
  and visible recovery after failed apply/discard. This is component/CSS proof
  using synthetic local actions; it is separate from application persistence.
- `test:e2e:uploads`: run `db-20260909120943925-6ea10165`.
  Both Chromium projects passed without skips/flakiness: 16 retained originals,
  independent byte/hash and database reads, Markdown review/import/reload/replay,
  and Profile save/reload/new-tab/initial-read recovery. Provider dispatches: zero.
- Both database runs passed the full web gate and their exact disposable cleanup.
  Recorded source hashes stayed unchanged; copied acceptance inputs and runner
  hashes matched the final reviewed source before committing.

The concise receipt is `CI-Upgrade-Chromium-Verification.json`. Final-commit CI
and production remain pending. This is local upgrade proof, not a declaration
that the current hosted schema has been upgraded or that binary-format editing
and generated exports are accepted.
