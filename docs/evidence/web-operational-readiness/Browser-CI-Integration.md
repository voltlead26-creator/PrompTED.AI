# Browser CI integration — 8 September 2026

The canonical CI workflow now invokes the existing real upload/Profile browser
acceptance and the shared tEdit dialog browser check. This change makes those
checks executable in GitHub Actions. Linux CI execution has not yet been proven.

Implementation target: `voltlead26-creator/PrompTED.AI`, branch
`Thought-Enhanced-Document`, based on
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the current reviewed working-tree
changes. The results below describe that overlay, not a clean release commit.

| Evidence label | Result |
| --- | --- |
| Implemented | CI wiring, exact GitHub source identity, tested Mac/Linux runtime selection and local-only Docker admission. |
| Verified locally | Identity/runtime boundary tests: 37 passed, 0 failed, 0 skipped. Current Mac upload-browser preflight passed. The parent verification also reported the web type check passing. |
| Verified in CI | Unverified. The new job has not run on the exact committed candidate. |
| Workflow exercised | Earlier local runs exercised the underlying browser workflows. The portability verification recorded here was preflight only and did not repeat the database/browser journey. |
| Production exercised | No production execution by this slice. |
| Persistence proven | Not newly proven by the portability preflight; the existing harness still requires independent local SQL and Storage reads during its full execution. |
| Export inspected | No generated export or format-preserving editing proof from this slice. |

## Change and boundaries

The `browser-workflows` job in `.github/workflows/ci.yml` runs on every canonical
branch push and every pull request targeting that branch. The condition is
explicit; existing jobs retain their previous pull-request scope. Checkout is
bound to the event SHA, with persisted Git credentials disabled. The job uses the
existing pinned action revisions and exact Node 22.23.2, pnpm 10.33.0, Deno 2.9.5
and Supabase CLI 2.114.0 versions.

`pnpm test:e2e:tedit` invokes `scripts/verify-tedit-dialog.mjs`.
`pnpm test:e2e:uploads` invokes the existing isolated database runner with
`--workspace-upload-browser-acceptance`. The following sequential step invokes
`pnpm test:db:workspace-core-upgrade` through the same isolated runner with
`--legacy-workspace-core-upgrade-acceptance`. It checks all 80 current migrations
and 49 SQL files fresh, then the exact 79-migration predecessor and the
`20260908150000` to `20260908160000` successor pair, including historical public
workspace receipt replay. No second application harness was added. Historical
policy/catalogue commands, manifests and exact-pair validators remain unchanged;
those intentionally reject later SQL and are not substitutes for the current
80-migration CI gate.
The job installs the locked Playwright Chromium browser into the cache already
used by both runners. It populates Deno's cache using the frozen lockfile before
the existing import-denied preflight and cached-only function execution.

The source identity guard preserves the local canonical branch/repository
requirements. Detached GitHub checkout additionally requires the canonical
repository, supported event/ref/base branch, an explicit expected SHA and the
exact event SHA matching Git HEAD. Pull-request checks use the merge revision;
`pull_request_target`, unrelated base branches and moving or malformed revision
values are rejected.

The runtime selector preserves the selected Mac checkout and local Docker
socket. Linux admission requires GitHub Actions and a workspace matching the
script-derived repository root. It selects `/var/run/docker.sock`; TCP, SSH,
alternate Unix socket, Docker context, TLS and certificate overrides are rejected.
The runner still attests the actual socket, tool versions, Git root and source
identity before starting its unique disposable project. Child environments retain
only the small runtime allowlist; hosted credentials, provider settings and
arbitrary process options are not forwarded.

The existing SQL-copy hashes, scratch ownership marker, no-hosted-project guard,
container/cluster/network/volume/port attestations, reset checks, exact-project
cleanup and before/after source checks remain in place. The new runtime helper
and its tests are included in the runner's hashed and copied inputs.

The full upload workflow continues to use real local Auth, RPCs, Storage and
production upload entrypoints with controlled synthetic Responses. It exercises
PDF, DOCX, RTF, UTF-8/UTF-16 text, Markdown and CSV originals, two browser widths,
lost acknowledgement recovery, original-byte downloads, Profile read failure
and retry, detail save/reload, and owner isolation. This is distinct from live
model quality, protected-format editing and generated export acceptance.

Artifacts are restricted to selected summaries, manifests, source digests,
independent synthetic proofs, failure reports and screenshots. Scratch credentials,
Auth/status response dumps, traces, private environment files and generated
bundles are excluded. The manifest glob also includes the few committed historical
baseline manifests consumed by the harness; their original revisions and hashes
remain explicit and must not be treated as fresh run results.

## Attributable verification

The regression-first extraction preserved the original hard-coded Mac behavior.
The [RED log](browser-ci-portability-red-20260908.log) recorded 35 tests:
26 failed and 9 passed. Failures included Linux root/socket selection, ignored
Docker overrides and valid detached GitHub revisions. These were behavior
failures, not missing-module or fixture bootstrap failures.

After the portability implementation and two additional Docker TLS/certificate
rejection cases, the [GREEN log](browser-ci-portability-green-20260908.log)
recorded 37 passed, 0 failed and 0 skipped:

```sh
node --test \
  docs/evidence/web-operational-readiness/acceptance-source-identity.test.mjs \
  docs/evidence/web-operational-readiness/acceptance-runtime.test.mjs
```

The current Mac preflight passed for
`prompted-db-20260908124230015-67b9e1cc`:

```sh
node docs/evidence/web-operational-readiness/run-isolated-db-baseline.mjs \
  --workspace-upload-browser-acceptance --preflight-only
```

The [preflight summary](db-20260908124230015-67b9e1cc/summary.json) explicitly
reports no database/service mutation or web gate. Its
[log](browser-ci-preflight-20260908.log) and source manifests identify the
reviewed inputs. Preflight success does not establish a fresh migration,
browser, persistence or cleanup result for the changed runner.

Required next evidence is a full current-source local workflow run and exact
committed-revision Linux CI. Cold dependency caching, Docker mount/network
representation, image start timing and Chromium keyboard behavior must be
observed there. A timed-out, cancelled or incomplete job remains a failed gate.

## Publication evidence update — 9 September 2026 AEST

The current CI command above supersedes the earlier policy-only and catalogue
upgrade step. Exact-commit Linux CI remains unverified. The latest completed
local run, `db-20260908171929839-fa874a7a`, passed fresh and upgraded SQL
(80 migrations, 49 files, 2,573 assertions), the exact 79-migration predecessor,
23 actual local Auth/PostgREST checks and the full web gate. Its 918 source
hashes, HEAD and tracked diff remained unchanged, and exact disposable cleanup
passed. The earlier portability preflight alone does not establish those results.

For the owner-requested publication, the parent will reuse completed GREEN
evidence only where the candidate runtime inputs still match. The package/CI
wiring correction requires focused CI/command validation and the existing
no-service preflight; final source, index and secret-exclusion verification are
separate required checks. This is the publication plan, not a claim that those
final checks or an exact-commit CI run have completed. It does not require
repeating every already-passed suite solely because report or CI wiring changed.

The older publication wrapper's fixed input manifest and sequential commands
are historical tooling, not evidence that it can accept this expanded candidate
unchanged. Any interrupted disposable run still requires exact cleanup-state
reconciliation. Commit/push, CI, hosted database/functions and production release
remain distinct: this report establishes no production release.
