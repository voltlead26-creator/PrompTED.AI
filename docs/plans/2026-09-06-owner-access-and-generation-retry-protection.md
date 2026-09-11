# Owner Product Access and Bounded Generation Retry Protection

- **Status:** Implementation in progress; bounded browser observation has focused local coverage
- **Owner approval:** Plan approved with retry protection on 6 September 2026
- **Repository:** `voltlead26-creator/PrompTED.AI`
- **Implementation line:** `Thought-Enhanced-Document`
- **Design baseline:** `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`
- **Runtime:** Node `22.23.2`, pnpm `10.33.0`
- **Applies to:** authenticated product access, subscription presentation,
  document allowance admission, OpenAI dispatch, durable generation operations,
  cancellation, reconciliation, reconnect polling, and usage evidence

## Decision in plain English

PrompTED will recognise one owner account through server-controlled Supabase Auth
metadata. That account may use every PrompTED product capability without buying
a subscription, with an allowance of 1,000 completed documents per month.

Owner access does not make the account an infrastructure administrator. It does
not permit access to another user's data and does not bypass authentication,
ownership checks, rate limits, generation-attempt limits, cancellation, safety,
validation, approval, export rules, or model-cost recording.

Generation will stop automatically after its small recorded failure budget is
used. Reloading the page, reopening a browser, restarting a worker, opening a
second tab, or pressing a button repeatedly must not reset that budget or create
another provider call for the same operation. Status checks remain read-only and
will stop polling after a bounded period instead of making the interface look
stuck forever.

The implementation must extend the existing access, allowance, provider-router,
operation, checkpoint, and UI contracts. It must not create a second billing
system, provider router, operation state machine, or persistence authority.

## Product-Purpose Alignment

- **Target users:** the PrompTED owner and every user relying on dependable
  document generation and recovery.
- **Problem:** the owner needs full product access without a subscription, while
  failed or uncertain generation must not repeat indefinitely, waste provider
  usage, or leave users in a misleading active state.
- **Intended outcome:** authorised users reach a usable, persisted document or a
  clear and durable next state: clarification required, waiting for capacity,
  reconciliation required, cancelled, or terminally failed.
- **Outcome progression improved:** generation, validation, persistence,
  recovery, review, and the explicit next action.
- **Burden and risk reduced:** the owner is not blocked by commercial feature
  gates; all users can understand whether TED is still working; duplicated model
  calls and false completion are prevented.
- **Evidence required:** access-isolation tests, attempt-budget tests,
  duplicate-dispatch tests, usage and allowance tests, cancellation and
  reconciliation tests, bounded-polling tests, regression suites, a production
  build, and an exercised failure/recovery workflow.
- **Unverified assumption:** the exact production incident that prompted the
  retry concern has not been tied to a captured operation ID or hosted logs.
  Implementation must reproduce structural failure cases locally and must not
  claim that a particular production incident is diagnosed without that evidence.

## Scope

### Included

1. A server-controlled owner product-access profile attached to one stable
   Supabase Auth user ID.
2. One effective-access resolver used by server admission and database allowance
   enforcement.
3. Truthful account and paywall presentation for owner access.
4. Durable, bounded provider failure and repair budgets for all model-backed
   generation paths.
5. Exactly-once provider-attempt and usage recording.
6. Reconciliation instead of redispatch when provider completion is uncertain.
7. Definitive cancellation and blocked post-cancellation dispatch.
8. Bounded, read-only browser status observation with a manual status check.
9. Compatibility and regression proof for surrounding product functions.

### Not included

- Supabase dashboard, organisation, project, service-role, or database-admin
  privileges for the owner account.
- Cross-user data access or an RLS bypass.
- A fake paid subscription or fabricated RevenueCat entitlement.
- Exemption from rate limiting, OpenAI capacity policy, validation, safety,
  approval, export, or provider-cost accounting.
- A second provider, provider fallback, queue, worker platform, schema registry,
  or client-owned generation state machine.
- A catalogue-wide generation rewrite.
- Changes to paid plan names or unrelated customer feature eligibility. The
  owner's 11 September correction separately authorises the Business/Premium
  pricing and allowance alignment described below.
- The original 6 September design approval did not include hosted actions.
  The owner explicitly authorised required PrompTED environment/service changes
  and completion of production readiness on 11 September at 23:15 AEST; the
  implementation and release gates still apply.

## Current verified baseline

The code already contains protections that must be preserved and strengthened:

- `guardRequest` authenticates a confirmed Supabase user, performs rate limiting,
  resolves the subscription plan, and checks the completed-document cap.
- document allowance reservation and settlement are server-controlled and
  distinguish a completed-document credit from actual provider usage;
- the OpenAI provider router accepts an immutable route snapshot with one or two
  attempts for a logical provider stage;
- legacy provider checkpoints use the stable generation request and logical stage
  to block duplicate or ambiguous redispatch;
- captured operations persist stage attempts and reject attempts above the
  accepted route budget across worker restarts;
- captured cancellation, reconciliation, idempotent replay, and allowance release
  contracts already exist;
- the captured browser component polls operation status with GET requests rather
  than starting generation from the polling loop.

The design must close gaps without replacing these controls:

1. ordinary plan and allowance logic has no explicit owner-access overlay;
2. server admission and database-side plan snapshots can disagree if owner access
   is added to only one layer;
3. several legacy generation workflows contain multiple logical stages, so a
   per-stage limit alone does not express a cumulative failure ceiling for the
   user's operation;
4. a validation-repair stage can be a separate provider request and must not open
   an unbounded new failure sequence;
5. browser status polling currently backs off but can continue indefinitely;
6. every database attempt-limit rejection must leave or move the operation into a
   truthful durable non-dispatchable state, rather than only returning an error.

## Authoritative access design

### Stable owner identity

The exact owner email is an operator input for the later hosted setup action. It
must not be committed to source, test fixtures, logs, analytics, generated
artifacts, or public documentation.

The hosted setup procedure will:

1. resolve exactly one confirmed Supabase Auth user by the owner-nominated email;
2. fail closed if zero or more than one account matches;
3. record the exact user UUID before mutation;
4. merge, rather than replace, the account's existing `app_metadata`;
5. add a versioned PrompTED product-access marker such as
   `prompted.access_profile = "owner_1000_v1"`;
6. re-read the exact account and verify the marker;
7. avoid exposing the email, token, service-role key, or full metadata in logs.

Normal runtime decisions use the stable authenticated user UUID and validated
server-controlled metadata. They do not repeatedly compare email strings. An
email change therefore cannot silently transfer owner access to another account.

### Effective access is an overlay

Owner access must not pretend that a paid subscription exists. The authoritative
resolved shape will remain equivalent to:

```ts
type EffectiveProductAccess = {
  subscriptionPlan: "free" | "pro" | "premium" | "business";
  accessProfile: "subscription" | "owner";
  monthlyDocumentCap: number | null;
  aiEditing: boolean;
  businessFeatures: boolean;
};
```

This is a conceptual shape. Implementation must extend the current authoritative
types rather than creating a parallel type system.

For ordinary users, effective access remains exactly subscription-derived. For
the nominated owner UUID, the resolver returns:

- `accessProfile: "owner"`;
- `monthlyDocumentCap: 1000`;
- all current PrompTED product feature capabilities enabled;
- the real subscription plan and subscription status unchanged for billing truth.

### One server and database decision

The implementation will add one narrow, versioned effective-access authority
that both of these paths consume:

1. Edge Function request admission through the existing auth guard; and
2. database-side document allowance reservation for captured and legacy work.

The resolver must:

- accept only a validated Auth user UUID;
- read server-controlled Auth metadata and the current subscription record;
- validate the exact metadata version and value;
- fail closed to subscription access for absent, malformed, unknown, or disabled
  metadata;
- return no secret or unrelated metadata;
- use a fixed safe `search_path` if implemented as `SECURITY DEFINER` SQL;
- be callable only through the minimum service-role or authenticated surface
  required by the existing architecture;
- preserve RLS and record ownership for every data operation.

The browser may display the resolved access profile, but browser state is never
the enforcement authority.

### User-visible account truth

The account screen will show `Owner access` separately from subscription status.
It will show 1,000 documents per month and all product capabilities. It will not
show an upgrade button for the owner profile. Its usage meter and limit warning
must accurately enforce the owner's finite allowance.

This reflects the owner's 11 September 2026, 23:17 AEST correction and supersedes
the original unlimited-owner proposal. Business must share Premium's document
allowance at $50 per user/month versus Premium at $40, with business capabilities
including branding. Exact Pro/Premium document caps remain to be confirmed.

It will not display `Business subscription`, `Premium subscription`, a renewal
date, or a paid entitlement unless that billing record genuinely exists.

Every other account retains its current plan name, feature list, usage meter,
paywall, and upgrade behavior.

## Authoritative retry and generation design

### Terms

- **Operation:** one user-authorised generation or targeted repair with a stable
  PrompTED idempotency identity.
- **Planned stage:** a deliberate part of the generation contract, such as draft,
  review, or a permitted section repair.
- **Provider dispatch:** a request that crosses the boundary to OpenAI and may
  consume provider usage.
- **Transient failure:** a specifically classified timeout, rate limit, or
  temporary upstream failure for which safe retry is permitted.
- **Permanent failure:** invalid input, unsupported operation, authentication,
  authorisation, configuration, schema, validation, attempt-limit, or other
  failure that retrying unchanged cannot safely solve.
- **Ambiguous result:** a provider request may have completed, but PrompTED cannot
  safely prove its outcome.
- **Status observation:** a read-only operation query. It is not generation and
  cannot allocate a provider attempt.

### Attempt and failure rules

1. The accepted route snapshot keeps an immutable `maxAttempts` of one or two for
   each logical provider stage.
2. A second attempt is allowed only when the first dispatched attempt has a
   durable, explicitly retryable transient failure.
3. Permanent failures receive no automatic retry.
4. The same operation also keeps a cumulative failed-provider-attempt count.
   After two dispatched provider failures across its stages, no later stage or
   automatic repair may dispatch automatically.
5. A syntactically successful but unusable model result counts against a separate
   bounded validation-repair allowance. At most one automatic repair is allowed
   for the affected logical result, and it still obeys the operation's cumulative
   failure ceiling.
6. Successful planned stages do not count as failures. The design must not break
   legitimate multi-stage generation merely because a document needs drafting
   and review.
7. A browser reload, second tab, worker restart, lease reclaim, reconnect, or
   idempotent replay does not reset any count.
8. A manual targeted repair after terminal failure is a new, deliberate operation
   with a new identity and exact section/revision scope. It is never silently
   created by polling or component remount.
9. Owner product access does not alter these limits.

The exact counters and transition command must live beside the existing durable
operation/checkpoint authority. They must not be inferred from UI state or array
positions.

### Atomic provider permission

Immediately before every provider dispatch, the server must atomically obtain
permission for the exact tuple:

```text
authenticated user
+ operation or logical request
+ logical stage
+ request digest
+ accepted route version
+ attempt number
+ current operation revision or execution lease
```

Only one caller may receive permission. Concurrent tabs, requests, or workers
must receive the existing checkpoint, in-progress state, replay result,
reconciliation state, or attempt-limit result.

The transition that admits an attempt and the durable attempt record must share
one database boundary. No provider request may occur first and be counted later.

### Terminal attempt limit

When an attempt or cumulative failure limit is exhausted, the authoritative
operation must become non-dispatchable with a stable error such as:

```text
GENERATION_ATTEMPT_LIMIT_REACHED
```

The returned state must contain:

- `retryable: false` for unchanged automatic execution;
- the affected operation and section state;
- a plain-language explanation;
- the smallest safe next action;
- the existing correlation identity;
- no provider body, prompt, SQL detail, secret, or private document text.

Valid completed sections and user edits remain available. A required unresolved
section becomes explicit clarification, placeholder, failed validation, or a
targeted-repair opportunity according to its ledger contract. The document and
outcome must not be marked complete.

### Capacity is not a provider attempt

If capacity admission fails before provider dispatch:

- do not allocate or record a provider attempt;
- do not consume provider tokens or completed-document allowance;
- persist `awaiting_capacity` and the server-defined retry time;
- allow a later idempotent resume only when the server says it is available;
- keep browser checks read-only.

Repeated capacity checks remain subject to the normal rate limiter and must not
turn into an automatic model-call loop.

### Ambiguous completion and reconciliation

If PrompTED cannot prove whether a dispatched request completed:

- record a reconciliation hold;
- do not redispatch the same provider work;
- preserve the allowance reservation until the outcome can be settled safely;
- read the durable checkpoint or known provider result;
- settle success once, release only after safe terminal proof, or remain visibly
  blocked with an exact next step;
- never fabricate failure, success, saved state, or completion.

### Cancellation

Cancellation must be persisted before further work is admitted. After the cancel
transition:

- every future attempt admission fails;
- the active request is aborted where possible;
- an already dispatched ambiguous request enters reconciliation;
- unused completed-document allowance is released only when safe;
- actual provider usage remains recorded once;
- delayed output cannot overwrite newer user work or resurrect the operation.

### Usage and allowance truth

PrompTED must preserve two separate facts:

1. **Completed-document allowance:** consumed exactly once only when the first
   usable `ready_for_review` document revision is durably committed.
2. **Provider usage:** recorded exactly once for every request that actually
   reached OpenAI, including failed or cancelled work where usage occurred.

Therefore:

- failed, validation-blocked, cancelled, and safely expired operations consume no
  completed-document allowance;
- replay, polling, reconnect, capacity wait, and undispatched rejection consume no
  provider usage;
- retries that reached OpenAI are visible as actual internal cost;
- owner access substitutes the owner-specific 1,000-document monthly allowance;
  it never bypasses provider attempt or cost evidence.

## Bounded browser observation

Captured operation polling remains a GET-only observation loop. It must never
call start, resume, generate, repair, or provider routes.

Recommended browser policy:

- check every two seconds initially;
- retain the existing exponential backoff for connection failures;
- stop automatic observation after five consecutive read failures;
- stop automatic observation after two minutes without reaching a user-actionable
  or terminal state;
- clear every timer and abort controller on unmount, owner change, operation
  change, cancellation, terminal state, or observation stop;
- show `Check latest status` and `Cancel operation` when appropriate;
- explain that automatic checking stopped and that the durable operation remains
  recorded;
- never label an unknown status as cancelled, failed, saved, or complete.

A successful status response may update visible progress but does not extend the
two-minute browser observation ceiling indefinitely. The server operation and
lease rules, not an open browser tab, own completion.

## Surrounding-code and compatibility contract

The change is acceptable only if it preserves all behavior outside the exact
owner-access and retry-control seams.

### Must remain unchanged for ordinary users

- authentication and confirmed-account requirements;
- normal free, pro, premium, and business subscription meanings;
- current subscription and RevenueCat records;
- ordinary monthly document caps and feature gates;
- account deletion and sign-out;
- rate limits and provider-capacity protection;
- row ownership, RLS, grants, and cross-user isolation;
- input validation and request sanitisation;
- template, ledger, clarification, grounding, and no-blank rules;
- section editing, autosave, revision conflicts, approval, and export eligibility;
- upload retention and original-document preservation;
- legacy document readability and replay;
- captured operation cohort selection;
- stable public API paths and existing response fields;
- Netlify build, routing, security headers, secret scanning, and deployment
  contracts.

### Additive interface policy

- Do not rename or reinterpret the existing `Plan` values.
- Add an access-profile field instead of adding `owner` as a paid plan.
- Preserve finite owner cap semantics: 1,000 completed documents/month, with the
  existing reservation, usage settlement and replay protections.
- Keep existing response fields; add only versioned, backward-compatible fields
  where the UI requires them.
- Old clients without access-profile awareness continue to receive safe
  subscription behavior and cannot gain owner access.
- Unknown access-profile or retry-policy versions fail closed.
- Do not modify section keys, ledger versions, document schemas, export formats,
  or user-owned historical rows for this change.

### Caller and consumer trace required before each source edit

Before modifying a file, implementation must re-read and map:

- `guardRequest` callers and every `enforceCap` choice;
- every direct subscription, usage-ledger, and allowance-cap read;
- shared plan and usage types and every browser consumer;
- captured and legacy allowance reservation, settlement, release, and
  reconciliation;
- every `routeRequest` call and logical stage key;
- captured attempt preparation/completion and database attempt guards;
- legacy model checkpoints and replay behavior;
- document, artifact, checklist, report, edit, proofread, recommend, and role
  generation surfaces;
- operation receipt types, API adapters, workspace truth, and user-visible error
  consumers;
- all timers, abort paths, and unmount/owner-change cleanup around generation.

If a discovered caller cannot safely consume the proposed contract, stop and
revise the design before editing that caller. Do not add a local exception that
creates a competing policy.

## Preliminary implementation surfaces

These paths are candidates, not permission to edit them all. The implementation
must select the smallest coherent subset after failing regression tests prove the
gap:

- `supabase/functions/_shared/auth-guard.ts` and its tests;
- `supabase/functions/_shared/allowance-reservations.ts` and its tests;
- `supabase/functions/_shared/provider-router.ts` and its tests;
- `supabase/functions/_shared/captured-operation-runner.ts` and its tests;
- the existing generation route that contains any unshared validation-repair
  retry, with checklist generation already identified for inspection;
- one additive migration extending the existing effective allowance and attempt
  authorities, plus pgTAP tests;
- shared API/usage types only where an additive field is needed;
- `apps/web/src/lib/usage.ts` and account presentation tests;
- `apps/web/src/components/organisms/SubscriptionPlan.tsx` and tests;
- `apps/web/src/components/organisms/CapturedAdmission.tsx` and tests;
- deployment and migration contract manifests only if the existing checks require
  exact registration of the additive SQL/RPC contract.

No route-specific source is changed if the shared authority and tests already
prove it receives the correct behavior.

## Implementation sequence

### Phase 1 — Reproduce with failing tests

Add tests that fail for the intended reasons before implementation:

1. owner metadata is ignored today and cap admission blocks the owner profile;
2. server and database allowance resolution would disagree if only one layer were
   changed;
3. a multi-stage or validation-repair flow can request work after the cumulative
   failure ceiling;
4. attempt-limit handling cannot leave a resumable or generating state;
5. two callers racing the same attempt can never both receive dispatch authority;
6. browser polling does not currently stop at the required bound.

If a suspected defect cannot be reproduced because the current implementation
already prevents it, preserve the existing implementation and add a passing
contract test rather than rewriting the code.

### Phase 2 — Effective owner access

1. Add the validated server/database effective-access resolver.
2. Make auth admission and both allowance paths consume it.
3. Preserve rate limiting and all ownership checks.
4. Add the additive browser access-profile projection and truthful account UI.
5. Prove absent, malformed, forged, stale, and cross-user metadata cannot grant
   access.

### Phase 3 — Durable retry protection

1. Extend the existing checkpoint/operation authority with the minimum cumulative
   failure and validation-repair state needed.
2. Enforce atomic dispatch permission before OpenAI work.
3. Convert exhausted limits to an exact durable terminal or scoped blocked state.
4. Preserve capacity, reconciliation, cancellation, partial-section, usage, and
   allowance semantics.
5. Remove no retry code unless the authoritative shared path fully replaces it
   and every caller test proves compatibility.

### Phase 4 — Bounded browser observation

1. Add explicit observation counters and elapsed-time bounds.
2. Keep polling GET-only.
3. stop and clean up deterministically;
4. expose truthful manual status and cancellation actions;
5. preserve reload/resume from durable operation identity.

### Phase 5 — Review and verification

1. Run focused tests after each coherent slice.
2. Run adjacent integration and contract suites.
3. Run fresh local database migrations and pgTAP acceptance.
4. Run type checking, linting, the full web verification gate, and the production
   build under the required runtime.
5. inspect the final diff for unintended changes, access leakage, stale writes,
   duplicate calls, missing awaits, timer leaks, unsafe fallbacks, secret or email
   exposure, and misleading UI state;
6. confirm tests and builds did not unexpectedly modify tracked source;
7. exercise normal account, owner account, failure, transient retry,
   reconciliation, cancellation, reload, multi-tab, manual status, persistence,
   approval, and export paths locally where the environment permits;
8. report local, CI, hosted, persistence, export, and production evidence
   separately.

### Phase 6 — Protected hosted actions

After local implementation, review, and verification, request separate approval
for each exact hosted action:

1. apply the named Supabase migration to the linked project;
2. deploy the named Edge Functions;
3. attach the versioned access marker to the exact nominated Auth user UUID;
4. deploy the exact Git revision to Netlify;
5. exercise the signed-in owner and normal-user workflows in the hosted
   environment.

No hosted action is implied by approval of this design or local implementation.

## Required regression tests

### Access and isolation

- an ordinary free user retains the free cap and feature set;
- pro, premium, and business users retain their current behavior;
- the owner profile receives all product features and no completed-document cap;
- owner access works without an active subscription row;
- owner access does not create or alter a subscription record;
- the account UI says `Owner access`, not a false paid plan;
- no owner upgrade prompt or paywall is shown;
- absent, malformed, disabled, or unknown metadata grants nothing;
- browser-supplied metadata grants nothing;
- editing email text does not transfer access;
- a different user cannot reuse the owner's UUID, token context, cached usage, or
  projected access state;
- owner access cannot read, edit, approve, export, or delete another user's data;
- owner access remains rate-limited and attempt-limited.

### Attempt budget and dispatch

- a permanent provider failure receives zero automatic retries;
- a classified transient provider failure receives no more than one automatic
  retry for that logical stage;
- two cumulative dispatched failures stop later automatic stage/repair dispatch;
- one permitted validation repair cannot recursively repair itself;
- successful planned stages still run normally;
- a worker restart cannot reset the accepted attempt or failure counters;
- a lease reclaim cannot duplicate a dispatched request;
- two tabs and repeated clicks permit one provider dispatch;
- replay returns the same checkpoint/result without another provider call;
- exhausted database attempt permission produces a non-dispatchable durable state;
- capacity rejection before dispatch creates no provider-attempt or model-usage
  row;
- ambiguous completion enters reconciliation and never redispatches;
- cancellation blocks every subsequent attempt and delayed result;
- valid sibling sections and newer user edits survive a failure.

### Usage and allowance

- failed, cancelled, validation-blocked, and safely expired generation consume no
  completed-document allowance;
- successful durable completion consumes exactly one completed-document allowance;
- each actual provider call records model usage exactly once;
- replay, polling, capacity wait, and rejected admission record no model usage;
- owner access bypasses the completed-document cap but does not bypass provider
  usage recording or retry limits;
- reconciliation settles success or release exactly once.

### Browser and workflow

- polling invokes only the operation-status GET path;
- polling stops after five consecutive read failures;
- polling stops after two minutes even if the server remains active;
- manual status check works after automatic observation stops;
- the UI does not claim cancellation, failure, save, or completion when status is
  unknown;
- every timer and request is cleaned up on unmount, user change, operation change,
  cancellation, or terminal state;
- reload reconnects to the same durable operation;
- surrounding document creation, editing, autosave, clarification, approval,
  export, checklist, report, artifact, role, upload, and account workflows retain
  their prior behavior.

## Verification commands and evidence gates

Exact focused test commands will be selected from the files actually changed.
The required broad local gate remains:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
corepack pnpm verify:web
```

Database verification must include a fresh local Supabase reset, migration
ordering checks, schema lint, RLS/grant/security-definer review, and the complete
pgTAP suite. Changed Edge Functions receive scoped Deno checks and tests. The
production build output is `apps/web/.next` under the current Netlify contract.

Passing local tests or a build is not hosted proof. Completion reporting must use
the repository evidence labels: Implemented, Verified locally, Verified in CI,
Workflow exercised, Preview/staging exercised, Production exercised, Persistence
proven, Export inspected, Blocked, or Unverified.

## Council challenge

- **Strategist — PASS:** this extends the existing access and durable operation
  contracts and directly protects product usability and cost.
- **Skeptic — REVISE until tested:** owner metadata could be read inconsistently,
  and per-stage retry limits could hide cumulative amplification. Both must be
  enforced at the server/database boundary with cross-user and multi-stage tests.
- **Creative — PASS:** a product-access overlay is smaller and more truthful than
  inventing an owner subscription. Strengthening existing checkpoints is smaller
  than adding a queue or new orchestrator.
- **Operator — PASS with protected-action gate:** local code and additive schema
  can be built and reversed safely; hosted migration, function deployment, Auth
  metadata mutation, and web deployment remain separately authorised.
- **Audience Advocate — REVISE until exercised:** the UI must say when automatic
  checking stopped and offer a clear next action without implying that model work
  is still consuming usage.

### Chosen position

Use a server-controlled access overlay plus the existing durable
operation/checkpoint system, with one cumulative failure ceiling and bounded
read-only observation.

### Strongest rejected alternative

Creating an active Business subscription row for the owner was rejected. It
would misstate billing truth, couple internal ownership to commercial systems,
and could cause RevenueCat, renewal, analytics, or support behavior to treat the
account as a real paid subscription.

Disabling all retries was also rejected. One strictly classified transient retry
is already part of the architecture and can recover a genuine temporary timeout
without asking the user to repeat work. The durable failure ceiling prevents that
single recovery allowance from becoming a loop.

## Rollback and recovery

- Database changes are expand-only and must preserve existing rows and contracts.
- Unknown or absent owner metadata behaves as normal subscription access.
- Removing the versioned owner marker returns only that account to ordinary
  subscription behavior; it does not delete documents or usage history.
- Old clients ignore additive access fields and remain safely subscription-bound.
- If source rollback is required, additive database fields/functions remain inert
  and are removed only by a later reviewed fix-forward migration.
- Existing attempts, usage, allowances, operations, sections, approvals, and
  documents are never deleted or relabelled to roll back the policy.
- A retry hardening rollback must not reopen already terminal or cancelled
  operations or make an exhausted attempt dispatchable.
- No feature flag may knowingly bypass authentication, ownership, safety,
  duplicate-dispatch, or attempt-limit protection.

## Approval and next gate

This design records the owner's approved direction and the added requirement that
surrounding code and functions continue to operate as before.

The owner's 11 September request to complete the unfinished work authorises
local implementation. Bounded browser observation now stops after five failed
reads or two minutes, aborts a hung read, rejects late responses after stopping,
and preserves the manual status command and last confirmed operation state.
Its 19 focused component tests and the complete web gate pass; browser exercise
remains pending. The initial terminal-status refresh remains intact.

Effective owner access now uses one database response across account UI and Edge
admission, with the corrected finite 1,000 monthly allowance and unchanged real
billing. Legacy admission and dispatch enforce two durable failures across stages;
captured preparation/dispatch now checks failed attempts bound to exact dispatch
receipts. Historical captured failures without those receipts and the separate
validation-repair budget still require acceptance work. Current combined evidence
passes 54 SQL files / 2,752 assertions, 1,609 Edge tests, 445 shared tests, 1,163
web tests, repository lint/types and the production build. Both 79-to-86 and
68-to-86 upgrade rehearsals preserve synthetic historical content and receipts.
Source hashes were unchanged; schema lint reports zero errors and 23 older warnings.

The owner's 11 September 23:15 AEST instruction separately authorises necessary
configuration and release work on the existing named services after compatibility
gates. No hosted owner grant, migration or new deployment has been performed for
this slice. Hosted upgrade rehearsal, browser recovery/persistence acceptance and
the exact ordinary paid allowances remain outstanding. See the dated
[work plan](../evidence/unfinished-production-20260911/Work-plan.md) for evidence
and the three pre-existing additional Edge lint findings. The entire approved
plan is not yet implemented or production verified.
