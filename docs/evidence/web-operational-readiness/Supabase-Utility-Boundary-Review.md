# Active utility function boundary review — 6 September 2026

Repository: `/Users/kaichurchw/PrompTED.AI`, `Thought-Enhanced-Document`, HEAD
`e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b` plus the documented readiness overlay.
Independent read-only review; no new external-data requests or hosted mutations.

All three functions below are deployed with gateway JWT verification in the
saved hosted inventory. No active web/internal consumer was found in current
source. Absence of a web caller does not establish absence of hosted exposure.
Do not add routes or describe these utilities as fully integrated to close an
inventory row. The following source findings need intended-failure regressions
before bounded repair and acceptance.

| Boundary | Evidence and consequence | Required proof / smallest repair |
| --- | --- | --- |
| Deadline admission | `calculate-deadline/index.ts:51` uses `req.json()` and the holiday client without the shared confirmed-account, rate or deletion/egress guard. Incorrect optional jurisdiction types silently default/omit. | Test anonymous/unconfirmed/expired/deletion/rate/oversize paths with zero external requests. Reuse the existing bounded request guard and owner-bound external-egress commands; preserve legitimate omission defaults and reject invalid supplied values. Update deployment-contract declarations with implementation. |
| Deadline error classification | `calculate-deadline/index.ts:84` catches caller, provider, timeout and malformed-response errors as HTTP400 and exposes the caught message. | Valid input plus upstream failure must return a safe dependency error, not blame caller input or expose upstream text. Preserve separate cancellation and input-validation states. |
| Holiday response | `_shared/public-holidays.ts:103–113` checks only array shape then casts entries. Truthy malformed `nationalHoliday` and invalid dates can influence or silently omit holidays. | Validate bounded records, real date, requested country/year, booleans and subdivision types before calculation; valid empty collections remain valid. |
| CKAN response | `_shared/ckan-client.ts:115–135` accepts truthy nonboolean success and can invent an `unknown` identity for an empty dataset. `{success:"false",result:{results:[{}]}}` is a source-derived malformed-success candidate, not an executed reproduction. | Require `success === true`, proper envelopes/collections and real identity/scalar types. Limit collections before mapping. Preserve legitimate optional metadata; never manufacture dataset identity. |
| PTV response | `_shared/ptv-client.ts:120–123` casts arbitrary JSON to T. `transport-victoria/handler.ts:757–809` settles the exchange and returns it as source-labelled200. | Establish each action's response schema from official provider contracts; test null, scalar, empty/error objects and positive empty/result collections. Malformed known responses must not publish data success or be mislabeled as dispatch uncertainty. |
| Response bounds and redirects | CKAN, PTV and holiday clients read unbounded JSON and use default redirect following. Only the original host is bound to admission identity. | Reject redirects, validate media types, bound bytes/UTF-8/depth/counts, clean up readers and retain existing timeouts. Test chunked/declared oversized responses, wrong MIME and302/307 with no redirected dispatch. No actual redirect attack or credential disclosure was observed. |
| Cancellation | None of the three clients receives the request's signal. Government/transport can move from an awaited claim directly into dispatch after that request was aborted. | Hold claim acknowledgement, abort and release it: no provider dispatch should occur. Propagate signal and add a post-claim pre-dispatch fence. Settle admitted records truthfully; retain uncertainty/reconciliation if dispatch may already have happened. Government's paired requests must both finish bounded settlement before reporting their aggregate. |

Existing government and transport strengths remain authoritative: confirmed
users, explicit public-lookup consent, stable owner/request identity, query
minimization, deletion/egress admission, same-token acknowledgement retries,
processing/completed/uncertain replay rejection, and withholding data when
completion acknowledgement fails. Extend these mechanisms; no new egress
ledger or persistence path is needed.

Relevant regression seams are the existing `ckan-client.test.ts`,
`ptv-client.test.ts`, `public-holidays.test.ts` and government/transport handler
tests. Deadline needs a bounded testable handler seam. Tests and provider schema
review are outstanding; the earlier passing aggregate suite does not cover
these newly identified cases.

Missing hosted PTV configuration is a separate operational blocker. Current
transport code returns `TRANSPORT_NOT_CONFIGURED` before admission. Function
installation and route additions cannot supply credentials or establish a
supported product workflow.

**Implemented:** no utility repair in this review. **Verified locally:** source
trace only; proposed regressions unexecuted. **Verified in CI:** no new revision.
**Production exercised:** saved inventory only. **Persistence proven:** no new
fixture. **Blocked:** operational acceptance of these boundaries. **Unverified:**
actual hosted response/failure behavior and any new product integration.
