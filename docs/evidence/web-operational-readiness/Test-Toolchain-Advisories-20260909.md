# Test and lint dependency advisory repair — 9 September 2026

Status: implemented and verified locally, including the full web gate and
desktop/narrow Chromium upload, Profile and foreground tEdit checks. Both full
and production dependency audits report no known vulnerabilities. The first
run's missing direct Node type dependency is corrected; the full follow-up passed.
Parent commit: `6b24cecab79ddaf59f21818eb92af6c554b090ab`.

The production-only audit passed earlier. The full audit now reports three
affected packages: `js-yaml`4.3.1 (high), `vitest`3.2.6 and its
`@vitest/mocker`3.2.6 dependency (moderate). GitHub lists five open alerts
because manifest and lockfile occurrences are reported separately. These are
dependency findings, not five independently demonstrated production exploits.

`pnpm why` traces YAML through ESLint and Vitest through web/shared development
dependencies. No active app consumer was found for the affected standalone
Vitest redirect-mock plugin. The scope assessment does not waive the update.
Full pre-change audit:
`/Users/kaichurchw/PrompTED.AI-local-archive/2026-09-09/dependency-audit-before-toolchain.json`.

The existing YAML overrides move to patched3.15.2/4.3.2; the currently installed
family is4.x. Web and shared Vitest move together to exact4.1.11. The maintainer
does not provide a3.x fix for this advisory. The selected version supports
Node22 and the already locked Vite7.3.5. `vitest-axe` declares a compatible peer
range. No production app implementation, upload format policy, database SQL,
provider route or allowance setting changes in this dependency slice.

Primary references, checked9 September 2026:

- [YAML empty-merge CPU limit advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh)
- [Vitest redirect-mock file-read advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
- [Vitest4 migration guide](https://v4.vitest.dev/guide/migration)

Verification must include the refreshed lockfile diff, frozen installation,
full and production dependency audits, all existing web/shared assertions,
lint/types/production build, and the actual upload/Profile/tEdit Chromium suite.
If Vitest4 reveals incompatible test doubles, preserve their asserted behaviour
and correct the doubles to represent the actual process or browser interface;
do not drop assertions or add skips.

## First verification result and correction

Run `job-mtu52jrg-9e47dc07` completed with exit1 at
2026-09-09T13:33:31.835Z. Installation succeeded and both dependency audits
reported no known vulnerabilities. All165 deployment-contract tests, the
static deployment contract and lint passed. Shared type checking then failed
on `process` and `node:crypto` in existing tests. Broader unit tests, the build
and Chromium steps were not reached by this invocation.

The shared package used Node test APIs without declaring `@types/node` itself;
it had obtained those declarations through the old test-runner dependency graph.
`packages/shared/package.json` now directly declares the repository's existing
Node type version22.20.1. This corrects dependency ownership without changing
the TypeScript checks or excluding tests. Offline installation and frozen-lockfile
installation passed, followed by both shared and web type checks.

The lockfile review retains Vite7.3.5 and confines graph changes to YAML,
Vitest and its dependencies. The Sentry optional Vite peer warning existed in
the parent lockfile with the same Sentry/Vite versions; no setting was added to
suppress it. The actual web build passed in the follow-up below.

## Completed follow-up verification

`job-mtu560oq-387137c2` ran from 2026-09-09T13:36:02.098Z to
2026-09-09T13:40:11.151Z and exited 0 with empty stderr:

```sh
pnpm install --offline --frozen-lockfile &&
pnpm audit && pnpm audit --prod &&
pnpm verify:web && pnpm test:e2e:tedit && pnpm test:e2e:uploads
```

- Frozen installation and both audits passed.
- All 165 deployment tests, static deployment validation, lint, shared/web type
  checks, 223 script tests, 423 shared tests and 1,035 web tests passed.
- Next.js 15.5.24 built 29 pages; progressive bundle checks passed.
- The actual tEdit component passed desktop and narrow Chromium checks for a
  foreground modal, keyboard containment, failed-action recovery and restored focus.
- The actual web app passed both Chromium journeys against disposable local
  Auth, RPCs and Storage. Sixteen uploaded originals (eight file/encoding cases
  per viewport) were independently read and matched their original hashes.
  The cases include PDF, DOCX, RTF, UTF-16LE/BE TextEdit TXT, UTF-8 TXT, MD and CSV.
  Two Markdown imports reopened both saved sections and replayed the same result.
  Profile persistence was independently read for both viewport journeys.
- No AI classification dispatch was needed for these source uploads. This proves
  local original retention and the exercised import boundary, not arbitrary
  format-preserving PDF/DOCX/RTF editing or live-model quality.
- Browser source manifests cover 922 paths; before/after hashes are identical.
  The four changed dependency files match the tested source hashes recorded in
  `Test-Toolchain-Verification-20260909.json`. No test assertions or skips changed.

Detailed local receipts are in `tedit-browser-20260909133637617/` and
`db-20260909133639837-542998c7/` beside this report. Raw CPJ logs are retained at
`/Users/kaichurchw/.codex/process-jobs/logs/job-mtu560oq-387137c2.stdout.log`.

All four CI jobs passed for the parent commit in
[run 34357359359](https://github.com/voltlead26-creator/PrompTED.AI/actions/runs/34357359359).
That CI result does not cover this dependency overlay. Exact new-commit CI is
required after publication. No production deployment, hosted mutation or exported
artifact inspection was performed by this verification run.
