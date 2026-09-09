# Installed interface fonts

10 September 2026, Australia/Melbourne. Worktree base:
`993d95fd1658945b61d25e62e979f571cb1b2195`, `Thought-Enhanced-Document`,
`/Users/kaichurchw/PrompTED.AI`.

The owner requested a font usable across platforms. The interface now uses
`Arial, Helvetica, sans-serif`: a locally installed face or the browser's
generic sans-serif fallback, without downloading a typeface. A single named
font is not guaranteed to be installed on every device; the fallback preserves
text rendering where Arial and Helvetica are unavailable.

## Implemented

- `apps/web/src/design-system/tokens.css`: installed font stack and shared
  body/display aliases.
- `apps/web/src/app/globals.css`: root and Tailwind sans-serif consumers use
  the existing authoritative typography token.
- `apps/web/src/app/layout.tsx`: removed the downloaded font class/import.
- `apps/web/src/design-system/fonts.ts`: removed the unused Google font loader.

This is interface typography. Original uploaded bytes, explicit document font
formatting, document/export contracts and the Content Security Policy were not
changed. Font widths can differ from the former DM Sans interface font.

## Verified locally

- Node `22.23.2`, pnpm `10.33.0`.
- Repository coordination board refreshed: existing root source claim reused;
  separate owner-access design preserved; no same-hunk conflict.
- Tracked tree clean before this change; existing untracked work preserved.
- `pnpm check:web-build-environment`: passed against the current local layout.
- Existing `next-config-csp.test.ts`: 1 test passed in 499 ms.
- `git diff --check`: passed.
- Actual Next.js local sign-in page in Chrome at 1440 and 390 pixels wide:
  headings, buttons and inputs use the installed stack, with no horizontal
  page overflow and all form controls inside the viewport. Chrome reported
  `Arial-BoldMT`, `isCustomFont: false`, for heading glyphs at both widths.
  No font preload links or first-party font network requests were observed.
  The narrow page was visually inspected. Reload retained the installed stack.

The same 26 separate embedded-font requests still appeared in this browser
profile. Their producer remains unverified, as recorded in the preceding
DevTools diagnosis. This interface change does not claim to eliminate
browser-injected requests or all console warnings.

## First full gate and resource diagnosis

`job-mtu98l0p-ab44a94c` exited 1 after about seven minutes. Deployment-contract
tests (165), script tests (223), shared tests (423), lint and type checks passed.
The web run recorded 945 passes, eight failures in six files and seven worker
startup errors; the build and Chromium suites were not reached. Six failures
were five-second timeouts; two were assertion failures following timed-out
interaction tests. The Mac was using approximately 17 GB of swap immediately
after the failed run. Tracked source hashes were identical before and after.

The same six failing files were then run with `--maxWorkers=1`: all 130 tests
passed in 9.32 seconds, with no source or assertion changes. This supports local
resource contention as the failure cause. The following complete run uses the
installed Vitest release's supported `VITEST_MAX_WORKERS=1` environment setting;
it retains the same test inventory, assertions and timeouts. The seven files
whose workers failed to start still require that complete run.

Raw evidence remains in the local archive at
`/Users/kaichurchw/PrompTED.AI-local-archive/2026-09-10/`:
`system-font-gate.json` and `system-font-focused-one-worker.log`. The next run
writes `system-font-gate-one-worker.json`, preserving the failed run.

## Full web gate and Chromium review

`job-mtu9kq8t-b7d99e08` passed `pnpm verify:web` with one Vitest worker:
165 deployment-contract tests, 223 script tests, 423 shared tests, all 1,035 web
tests across 117 files, lint, type checks, Next.js production build (29 static
pages), and progressive-bundle checks. Chromium tEdit passed at desktop and
narrow widths; its receipt is
`tedit-browser-20260909154053775/summary.json`.

The job then stopped in upload-suite source inventory, before starting its
disposable database or exercising an upload: `git ls-files --cached` still
listed the deliberately removed `apps/web/src/design-system/fonts.ts` because
the deletion had not been staged. The inventory correctly refused an absent
file. Staging the intended deletion aligns the index with the reviewed working
tree; the inventory guard and browser tests are unchanged.

No tracked source changed during either full-gate attempt. Independently reading
the completed production build's `next-font-manifest.json` showed empty `app`
and `pages` maps, both size-adjust flags false. The obsolete font loader no
longer contributes font assets to the build.

## Upload/Profile acceptance completed

`job-mtu9p5ni-df261c22` completed with exit 0 after staging the intended
deletion. The run's evidence directory is
`db-20260909154253679-71aa8084/` under this directory:

- All 50 fresh database-test files passed: 2,643 assertions.
- Desktop and narrow Chromium journeys both passed; zero skips or flaky tests.
- Sixteen uploaded originals across PDF, DOCX, RTF, UTF-16 LE/BE TextEdit TXT,
  UTF-8 TXT, Markdown and CSV were independently read and matched their exact
  source hashes. Two Markdown documents were imported, reopened and replayed.
- Both Profile journeys saved/reloaded details, with independent owned reads
  and denial to the other synthetic owner. Resume slots were empty: this run
  does not prove resume replacement or download.
- The final web gate passed again, and source fingerprints before/after matched.
- No AI classification was dispatched. This does not prove formatting-preserving
  editing/export, paid inference or hosted persistence.

The source change has passed its local verification gates. The former failed
runs remain recorded above; neither required weakening an application guard,
test assertion or timeout.

## Publication and remaining scope

This report is prepared for the commit that contains the reviewed font change.
Its enclosing Git revision identifies the published source; CI and deployment
have separate receipts. Windows, Linux, Safari and Android device rendering have
not been directly exercised in the local Mac font check.

Netlify's read-only site check on this completion turn still reported the
production deployment locked at `6a9fc526610f2efb8c05454f`, source
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`. This font change introduces no backend
or environment mutation. Existing backend/release prerequisites remain separate
from acceptance of this interface change; a pushed commit is not a live release.
