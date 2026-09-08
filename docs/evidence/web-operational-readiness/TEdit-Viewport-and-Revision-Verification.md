# tEdit visible review and exact-source recovery

Prepared 8 September 2026, Australia/Melbourne. Current base revision: `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`; the implementation remains a local working-tree overlay. No new commit, CI run or web deployment is claimed.

## Implemented

TED suggestions now open in the current viewport using the shared native modal dialog instead of depending on their position at the end of a checklist. The actual design tokens and branded review layout remain in use. The labelled content area scrolls by keyboard; the action controls remain visible at the verified desktop and narrow viewports. Initial focus, forward/backward Tab containment, pending-action focus, Escape handling and focus return have explicit behavior. Apply, Try again and Discard await their own result and reject duplicate activation. Errors stay with the retained proposal.

Checklist, document-section and supporting-artifact callers bind accepted proposals to the current owner, outcome/document, item/section, exact original wording and current revision/lifetime. Retry keeps the same source and selection. Missing items, failed reads, stale responses and unconfirmed saves cannot silently replace a newer source or clear the proposal. Checklist saving returns confirmed persistence status. Artifact title/description editing from the separately completed task is preserved.

The SectionEditor recovery effect requires a saved workspace before checking persisted edit receipts. Unsaved typing leaves the first tEdit control reachable; the existing save requirement still prevents provider dispatch. A confirmed save restarts recovery against the saved revision.

## Verified locally

- The intended RED cases cover viewport placement/focus, stale original text, retry selection, late callbacks, duplicate actions, removed rows, failed persistence and artifact identity. Their original failing logs are retained locally.
- `tedit-all-focused-20260908.log`: 103 tests in nine files passed before the additional keyboard regressions.
- `tedit-keyboard-green-20260908.log`: all 15 shared-dialog tests passed after the actual-browser Tab failure was reproduced and repaired. These counts overlap the earlier focused run and must not be added together.
- `tedit-save-queue-green-20260908.log`: 70 tests passed, including all 54 generation-adoption and 16 SectionEditor revision-edit cases. The unchanged first-click regression failed for the intended reason before the recovery prerequisite was repaired.
- Focused lint and web types passed before the final small keyboard/recovery updates. The broader web gate then passed its deployment checks, lint and types, but stopped on that first-click regression: 1,026 web tests passed and one failed. Build was not reached by that invocation. A complete gate on the final integrated source remains required.
- The same broader invocation passed Edge types and lint, and 1,200 Edge tests with 12 nested steps.

## Workflow exercised

`node scripts/verify-tedit-dialog.mjs` builds the real shared React component and its CSS into a loopback-only browser fixture. Playwright Chromium uses one browser workflow at a time, with synthetic held actions, explicit failure injection and no provider, account or hosted access.

The successful run is `tedit-browser-20260908121932756/summary.json`: both 1440×1000 and 390×844 passed. Each starts with the page scrolled 700 pixels; the modal opens within the viewport without moving the underlying page. The check verifies native modal state, background focus exclusion, Tab/Shift+Tab containment, keyboard scrolling to paragraph 50, disabled-action focus, retained failed Apply, visible Retry, discard focus return, and retained failed Discard. Source hashes were unchanged and browser/server cleanup succeeded. The two actual screenshots were independently opened and visually inspected.

Earlier fresh foreground attempts recorded a missing default browser cache, a real backwards-Tab escape, and a keyboard-scroll assertion that used a non-working key combination. The installed pinned cache is now selected explicitly; the actual Tab behavior is repaired; the scrolling test uses the browser-supported End key rather than scripting scroll position. The older failed CPJ notification remains uninspected because the CPJ lifecycle guard rejected its result lookup; it is not used as passing evidence.

## Evidence boundaries

**Implemented:** shared dialog and its three caller families. **Verified locally:** the focused checks and actual component-browser behavior above. **Workflow exercised:** desktop/narrow presentation with synthetic actions. **Verified in CI:** unverified for this overlay. **Production exercised:** unverified for this tEdit change. **Persistence proven:** mocked caller receipt/conflict tests only in this slice; component-browser callbacks are synthetic. **Export inspected:** not applicable to dialog placement and not newly proven. **Blocked/unverified:** final full gate, exact published revision, real signed-in tEdit persistence journey and the separate full-app release prerequisites.

The current account's existing Business limit remains unchanged under the owner's latest instruction.

## Complete web gate after integration

At 22:52:14 AEST, `master-web-gate-20260908125140321` completed successfully: 165 deployment tests, 223 root tests, 382 shared tests and 1,035 web tests; lint, types, production build and progressive bundles passed. Source, HEAD and selected web dotenv hashes were unchanged. This closes the previously pending local web gate for the tEdit/knowledge/CI-portability overlay at that point. Subsequent F4 admission and schema work needs its own integrated gate. It does not establish a new commit, CI, live application persistence or deployment.
