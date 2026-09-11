# Next.js and React library audit — 11 September 2026

Repository: `voltlead26-creator/PrompTED.AI`, branch `Thought-Enhanced-Document`.
Reviewed baseline: `0ff068d2405d417562df639db56740d7b752bb4b`.
Runtime: Node 22.23.2, pnpm 10.33.0, Next.js 15.5.24, React 19.

The user requested front-end performance, responsive behaviour, sound React
structure and reliable API flow in the existing local and GitHub application.
The existing Next.js App Router, CSS Modules, design tokens, owner-bound
Supabase client and database RPCs remain the implementation authorities.
The supplied audited atlas bundle is historical guidance; its older snapshot
does not override current source or imply deployment parity.

## Findings and repairs

The affected flow is `/library` → `LibraryList` → `useLibrary` →
`withOwnerSupabase` → PostgREST outcome/document reads or the existing
`update_own_outcome` RPC. No database or provider contract changed.

| Reproduced finding | Resulting behaviour |
| --- | --- |
| A previous tab's delayed request could replace the selected tab. | Each read is bound to its owner, tab and request; obsolete reads are aborted and late responses rejected. |
| Repeated Load more requests could dispatch the same page and duplicate cards. | One pending page per scope; stable ordering and duplicate outcome suppression. |
| Thrown reads could leave an unhandled failure with no recovery. | A bounded request lifetime and safe refresh action; existing cards remain visible on page failure. |
| Bookmark requests had no pending state or error recovery. | Duplicate writes are prevented; uncertain results require refresh; confirmed writes re-read membership and ordering through the existing RPC/client. |
| Template filtering only filtered an embedded relation. | An inner document join excludes outcomes without a matching template. |
| Library reads fetched unused recommendation and document metadata. | The projection contains only rendered card fields and ownership identities, validated before display. |
| Tabs lacked keyboard navigation and a single tab stop. | Arrow/Home/End navigation, roving focus and labelled tab/panel relationships. |
| Narrow layouts could overflow, and bookmark hit areas were small. | Contained tabs, wrapping metadata/titles and 44 px bookmark targets. |
| Both bookmark icon names resolved to question-mark fallbacks. | Outline and filled bookmark symbols in the existing icon registry. |

The query reduction is a concrete reduction in requested fields, not a measured
production latency or Core Web Vitals improvement. Pagination remains the
existing offset-based contract; it does not promise a snapshot across concurrent
edits from other sessions.

## Verification

- Before repairs: six hook regressions, three UI regressions and two bookmark
  icon regressions failed for their intended reasons.
- Focused and adjacent tests: **36 passed**, including owner-client and browser
  principal contracts.
- `pnpm verify:web`: **passed** — lint, TypeScript, 223 root tests, 423 shared
  tests, 1,155 web tests, the production build and progressive bundle budgets.
  The deployment-contract subset also passed (165 tests).
- Production build: `/library` reports 8.08 kB route code and 210 kB first-load
  JavaScript. Existing 11 deferred boundaries and three route budgets passed.
- Local browser exercise: **Chromium passed at 320×740, 390×844 and 1440×1000**;
  no page overflow, uncaught page errors, external requests or detected
  WCAG A/AA axe violations. Screenshots were visually inspected.
- The browser harness uses the real library component, hook, update API and
  Supabase SDK against a synthetic local HTTP server. It exercises encoded query
  filters, pagination, keyboard tabs, delayed responses, request failure/retry,
  bookmark acknowledgement and reload. Reload proves retention in that test
  server, not hosted database persistence or RLS.
- Firefox and WebKit were unavailable locally. GitHub CI now installs all three
  pinned engines, runs this harness, fails if an engine is skipped, and uploads
  selected synthetic screenshots and results.
- No deployment, hosted mutation, real-account persistence or export acceptance
  is implied by this front-end repair.

## Reproduction and evidence

```sh
pnpm --filter @prompted/web exec vitest run \
  src/hooks/useLibrary.test.tsx \
  src/components/organisms/LibraryList.test.tsx \
  src/components/atoms/Icon.test.tsx \
  src/lib/supabase/owner-client.test.ts \
  src/lib/browser-principal-state.test.ts --maxWorkers=1
node scripts/verify-library-browser.mjs
pnpm verify:web
```

Local logs and screenshots live in
`.local/verification/frontend-library-20260911/`. They are ignored generated
evidence. Reusable tests stay with their source; the browser harness stays under
`apps/web/src/test/browser/`; its runner stays under `scripts/`.
The earlier repository/folder cleanup is documented in
`docs/evidence/github-sync-20260911/Audit.md` and `docs/REPOSITORY-GUIDE.md`.

The baseline GitHub run `34556757165` passed its web, Edge and fresh-database
jobs, but its upload/Profile job failed on occupied preflight port 58324.
That independent issue was not bypassed or altered by this repair. New GitHub
results must be read at the published revision before calling them verified.

Technical references: [React effect cleanup](https://react.dev/reference/react/useEffect)
and [Supabase joins and nested filtering](https://supabase.com/docs/guides/database/joins-and-nesting).
