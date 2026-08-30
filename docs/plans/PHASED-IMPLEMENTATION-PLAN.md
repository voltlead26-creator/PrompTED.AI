# PrompTED — Phased Implementation Plan

> **Provenance:** transcribed from `Full_implementation_plan.pdf` on 31 July 2026 so
> that the authoritative spec lives in the repository rather than in a chat session.
> Verify against the source PDF before treating any clause as final.

## Delivery principle

Provider stability → flagship workflow proof → recoverable generation →
factual-integrity hardening → mobile parity → deployment hardening → broader
catalogue rollout.

Do not expand the document catalogue while the flagship résumé flow remains
unreliable. More templates merely create more exciting varieties of failure.

---

# Phase 0 — Stabilise the Anthropic switch

**Objective:** make Anthropic the reliable primary provider across development,
staging and production without weakening research, fallback or safety behaviour.

## Step 0.1 — Confirm production credentials

Verify in Supabase Edge Function secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_AI_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `OPENAI_SEARCH_MODEL`,
`GOOGLE_AI_MODEL`, `DEFAULT_PROVIDER`, `PROVIDER_FALLBACK_ORDER`.

**Checks:** Anthropic key active; credits available; key belongs to the correct
workspace; key not exposed in Netlify or browser env; no key in logs, commits,
screenshots, fixtures or error responses; staging and production use separate
configuration where practical.

**Acceptance:** Anthropic returns a successful basic completion from the deployed
Edge Function; generation logs record provider `anthropic`; no client response
exposes Anthropic's name or raw provider error; missing credentials trigger fallback
rather than crashing.

## Step 0.2 — Select Anthropic models by task

| Task class | Examples | Model priority |
|---|---|---|
| Lightweight interpretation | intent classification, simple clarification | fastest reliable Claude model |
| Document generation | résumé, letters, proposals | balanced quality model |
| Factual review | grounding, unsupported-claim detection | stronger reasoning model |
| Complex planning | action plans, legal-style structure, multi-source synthesis | strongest approved model |
| Editing | section rewrites, tone changes | balanced model |

Environment structure: `ANTHROPIC_FAST_MODEL`, `ANTHROPIC_DOCUMENT_MODEL`,
`ANTHROPIC_REVIEW_MODEL`, `ANTHROPIC_REASONING_MODEL`.

Extend `ProviderRequest` with a capability tier:

```ts
type ModelTier = "fast" | "document" | "review" | "reasoning";
```

Never pass raw model names from the client.

**Variables to consider:** cost per input token, cost per output token, max context
window, max output size, JSON reliability, latency, rate limits, availability by
account or region, prompt-caching support, suitability for long evidence-heavy
documents, behaviour under long system prompts.

**Acceptance:** each task maps to a documented tier; changing a model requires an
environment update, not code scattered across functions; logs record tier and actual
model without exposing secrets; tests confirm fallback when a configured model is
invalid.

## Step 0.3 — Test provider fallback behaviour

Deterministic tests for: (1) Anthropic succeeds; (2) 401; (3) 429; (4) 500;
(5) timeout; (6) empty content; (7) invalid JSON where JSON is required;
(8) OpenAI fallback succeeds; (9) Google succeeds after Anthropic and OpenAI fail;
(10) all providers fail; (11) aborted request stops immediately; (12) web research
skips providers without grounded search capability.

**Assertions:** providers run in intended order; a failed provider is never returned
as a user-visible raw error; a valid fallback response is accepted; JSON-required
tasks reject malformed output; research never silently falls back to an ungrounded
provider; abort signals prevent unnecessary fallback calls.

**Acceptance:** all routing tests pass consistently without calling live provider
APIs.

## Step 0.4 — Add provider health and cooldown

Track per provider: `last_success_at`, `last_failure_at`, `failure_type`,
`consecutive_failures`, `cooldown_until`, `rate_limit_reset_at`.

Failure classifications: `authentication`, `quota_exhausted`, `rate_limited`,
`invalid_model`, `timeout`, `network`, `server_error`, `invalid_response`,
`empty_response`.

**Behaviour:** 401/invalid-key triggers a long cooldown; credit exhaustion triggers a
meaningful cooldown and operational alert; 429 honours retry headers where available;
temporary 5xx uses bounded exponential backoff; invalid JSON counts as a
task-specific failure, not total provider outage; one capability's failure does not
disable the provider for every capability.

**Acceptance:** depleted-credit providers are not retried on every user request;
healthy providers re-enter rotation after cooldown; health state survives multiple
function instances (database or cache); provider-health logic cannot permanently
disable all providers without administrative recovery.

## Step 0.5 — Deploy and run smoke tests

Deploy shared Edge Function code to staging first. Run: intent, clarify, recommend,
document, edit, checklist, research, factual review.

Record for each request: task, provider, model, latency, input tokens, output tokens,
fallback count, result status, JSON validity. Deploy production only after staging
passes.

**Rollback conditions:** increased blank outputs; invalid JSON rate rises materially;
factual-review failures not repairable; Anthropic latency exceeds threshold; cost per
completed document exceeds ceiling; provider errors exceed error budget.

**Rollback action:** `DEFAULT_PROVIDER=openai`, or restore the prior Edge Function
release while leaving the new router code available for investigation.

---

# Phase 1 — Prove the résumé workflow

**Objective:** demonstrate that PrompTED can repeatedly produce one complete, useful,
factual résumé from real user evidence.

## Step 1.1 — Freeze the benchmark fixture

Fixture contains: personal details; employment history; education; skills explicitly
supplied; achievements with and without numeric evidence; missing non-critical
information; missing critical information; ambiguous dates; uploaded résumé text;
conversation context; contradictory information; intentionally tempting assumptions.

Store expected **rules**, not a single exact prose output: must include supplied role
titles; must not invent employer names, percentages or qualifications; must not
convert ordinary duties into achievements; must ask only for blocking information;
must generate usable wording despite non-critical gaps.

## Step 1.2 — Define completion criteria

A run passes only when all occur: context accepted; clarification complete; document
plan created; sections generated; factual review passed; quality review passed;
repairs completed; document persisted; workspace populated; preview rendered; PDF
exported; document reopened successfully.

The pipeline must not report success merely because an approved status was inserted
into a database.

## Step 1.3 — Run repeated generation tests

Run at least: 20 consecutive Anthropic-primary generations; 10 forced OpenAI-fallback;
5 forced total-provider-failure; 5 expired-session recovery; 5 interrupted or
timed-out.

**Measure:** completion rate, average duration, p95 duration, fallback rate,
repair-pass count, unsupported-claim count, blank-section count, export success rate,
cost per successful résumé.

**Pass thresholds:** 100% no invented hard facts; 100% no blank required sections;
100% no placeholder scaffolding; 100% persisted successful outputs; 100% export for
approved documents; 95% successful completion under healthy-provider conditions.

## Step 1.4 — Validate document quality manually

Review for: relevance, specificity, readability, natural professional tone,
duplication, chronology, truthful representation, excessive verbosity, vague
corporate filler, consistency between sections, ATS-safe formatting, Australian
spelling and conventions. Use a scored rubric with explicit fail conditions.

## Step 1.5 — Prove persistence and reload

Generate → close workspace → sign out → sign back in → reopen → edit one section →
save → export → reopen exported version. Confirm content and section order remain
intact. Content-retention failures have already existed in repository history.

---

# Phase 2 — Recoverable generation state machine

**Objective:** prevent provider or network failures from leaving users with a blank
workspace and no recovery path.

## Step 2.1 — Define generation states

`queued`, `collecting_context`, `awaiting_clarification`, `planning`, `drafting`,
`reviewing_facts`, `reviewing_quality`, `repairing`, `approved`, `persisting`,
`export_ready`, `failed_recoverable`, `failed_terminal`, `cancelled`.

Each state includes: `entered_at`, `completed_at`, `attempt`, `provider`, `model`,
`error_class`, `recoverable`, `next_action`.

## Step 2.2 — Persist stage outputs

Persist separately: outcome brief; section plan; raw draft sections; factual-review
result; quality-review result; repair instructions; approved sections; export
metadata. This allows resuming from `reviewing_facts` rather than regenerating
everything because one API request tripped over its own shoelaces.

**Privacy:** do not persist raw provider prompts indefinitely unless required. Define
retention rules for user evidence, uploaded text, model requests, model responses,
review evidence and provider errors.

## Step 2.3 — Add idempotency

Every generation request needs a stable idempotency key. Repeated requests with the
same key must not create duplicate documents, duplicate sections, repeated allowance
deductions, repeated provider charges where avoidable, or duplicate exports.

Potential key: `user_id + outcome_id + generation_version + request_nonce`.

## Step 2.4 — Implement safe retry

| Stage | Retry behaviour |
|---|---|
| Context collection | resume immediately |
| Planning | rerun plan only |
| Drafting | rerun missing sections only |
| Factual review | rerun audit only |
| Repair | rerun failed sections only |
| Persistence | retry database write without regenerating |
| Export | rerender from approved stored content |

Never regenerate an approved document merely because PDF rendering failed.

## Step 2.5 — Build user recovery UI

> TED safely paused your document because the generation service did not complete.
> Your information and completed sections have been saved.

Actions: Retry; Continue from saved progress; Review completed sections; Add missing
information; Cancel generation; Contact support. Avoid provider names, API codes and
raw technical detail.

## Step 2.6 — Protect billing and allowances

Reserve allowance when generation starts; finalise deduction after approved document
persistence; release reservation after terminal provider failure; do not charge again
for technical retry; charge separately only for explicit user-requested regeneration
after a successful outcome.

**Acceptance:** a provider outage never consumes multiple credits for one requested
document.

---

# Phase 3 — Factual-integrity hardening

**Objective:** ensure every material claim is traceable to user evidence while still
producing polished, useful writing.

## Step 3.1 — Create a structured evidence ledger

```ts
interface EvidenceItem {
  id: string;
  sourceType: "conversation" | "upload" | "profile" | "user_confirmation";
  sourceLocation: string;
  exactText: string;
  claimType: string;
  confidence: number;
  userConfirmed: boolean;
}
```

Claim types: identity, employment, date, qualification, institution, skill, duty,
achievement, metric, award, location, licence, membership, financial, legal, medical.

## Step 3.2 — Attach evidence to generated claims

```ts
interface GeneratedClaim {
  text: string;
  evidenceIds: string[];
  classification: "supported" | "convention" | "guidance";
}
```

This metadata need not appear in the final résumé, but must be available to the audit
pipeline.

## Step 3.3 — Add deterministic checks

Before AI review, detect: numbers not present in evidence; dates not present;
named institutions not present; qualifications not present; employer names not
present; job titles not present; awards not present; proficiency claims ("advanced",
"expert", "certified"); causal claims ("resulting in"); improvement claims
("increased", "reduced", "improved").

These checks are faster, cheaper and less impressionable than asking another model
whether everything seems trustworthy.

## Step 3.4 — Add entailment review

For each claim the review model decides: fully entailed; partially entailed; not
entailed; standard convention; recommendation or guidance. **Partial support fails
factual release.**

> Evidence: Managed customer enquiries.
> Claim: Increased customer satisfaction through proactive issue resolution.

Only partially supported — rewrite.

## Step 3.5 — Separate factual and stylistic repairs

**Factual repair:** remove unsupported clauses; use only confirmed duties and
outcomes; do not replace missing facts with plausible alternatives.

**Style repair:** improve clarity; reduce repetition; strengthen verbs without
changing factual meaning; improve section flow.

Do not let a style rewrite reintroduce claims already removed by factual review.

## Step 3.6 — Add user confirmation for uncertain claims

Ask targeted questions ("Did you manage staff in this role?"), not vague ones
("Please provide more details about your experience"). Every question: asks one
thing; explains why it matters where useful; is answerable quickly; does not ask the
user to write the finished prose themselves.

---

# Phase 4 — Mobile readiness

**Objective:** bring the Expo application to functional and test parity with the
proven web workflow.

## Step 4.1 — Define shared contracts

Move generation-state types, response schemas and validation into
`@prompted/shared`. The shared package must contain no DOM APIs, Next.js imports,
React Native imports, Supabase server secrets or provider SDKs.

## Step 4.2 — Build the mobile vertical slice

Implement only this flow first: sign in; select résumé; provide or upload context;
answer clarification; start generation; observe progress; open completed résumé; edit
a section; save; share or export. Do not build every template screen before this
works.

## Step 4.3 — Add mobile tests

Authentication restoration; expired session handling; generation request;
progress-state rendering; recoverable failure; successful document rendering; section
editing; offline interruption; app background and resume; subscription entitlement;
account deletion; accessibility labels; deep link and callback handling. Replace "no
mobile tests" with an actual test command.

## Step 4.4 — Account for the 2013 MacBook

CI for complete iOS builds; EAS Build where appropriate; targeted TypeScript locally;
small Jest or Vitest subsets; physical-device or simulator smoke testing only when
needed; one local dev server at a time; cached pnpm store; no local AI model
requirements.

The laptop should coordinate the work, not reenact the heat death of the universe
compiling three platforms simultaneously.

## Step 4.5 — Apple-specific checks

Privacy manifest; account deletion; subscription restoration; Sign in with Apple
rules where applicable; permission descriptions; data collection disclosures; app
tracking declarations; export and file-sharing behaviour; accessibility; error
handling without developer jargon; no placeholder screens; production API endpoints;
support and privacy-policy URLs.

---

# Phase 5 — Deployment and operational hardening

**Objective:** make deployment repeatable, observable, secure and reversible.

## Step 5.1 — Separate environments

Distinct configuration for local, test, staging and production. Each defines:
Supabase project; Netlify site; provider routing; model selection; logging level;
analytics; billing environment; allowed origins; feature flags.

## Step 5.2 — Remove hardcoded backend routing

Replace repeated literal Supabase URLs in `netlify.toml`. Options: generate Netlify
configuration from environment; route through Next.js server endpoints; use a single
proxy function mapping safe endpoint names; maintain separate environment-specific
Netlify files.

Must preserve: authentication headers; request bodies; streaming where used; CORS;
timeout behaviour; webhook signature integrity.

## Step 5.3 — Add full verification commands

`pnpm check:web`, `pnpm check:shared`, `pnpm check:mobile`, `pnpm check:edge`,
`pnpm verify`.

`pnpm verify` runs: encoding checks; product-promise checks; migration checks;
TypeScript; lint; unit tests; Edge Function tests; production web build; mobile
type-check. Full iOS build may remain CI-only.

## Step 5.4 — Establish CI gates

**Before merge to `ClaudeTED.AI`:** root type-check; lint with zero warnings; shared
tests; web tests; mobile tests; Deno checks; provider-router tests; document-pipeline
tests; production web build; migration validation; secret scan.

**Before production:** staging smoke test; résumé benchmark; export test;
authentication test; billing entitlement test; account deletion test.

## Step 5.5 — Improve observability

Capture: generation ID; outcome type; pipeline stage; provider; model; fallback
sequence; latency; token use; repair count; error class; completion status; export
status.

Never log: API keys; complete résumés by default; raw personal information;
authentication tokens; private uploaded files; full prompts containing sensitive
information.

Alert on: elevated provider failure; repeated fallback; blank-document prevention;
export failures; unusual generation cost; stuck generation states; allowance
discrepancies.

## Step 5.6 — Tighten browser security

Review CSP and remove `unsafe-eval` in production where possible. Verify strict
origin allowlists; no service-role keys in clients; secure cookie settings; correct
Supabase session handling; webhook signature validation; rate limiting; request-size
limits; upload type validation; uploaded-document sanitisation; account deletion
completeness.

---

# Phase 6 — Controlled catalogue expansion

**Objective:** expand beyond résumés only after the core platform is proven.

## Step 6.1 — Categorise document risk

**Lower risk:** meeting agendas; simple checklists; thank-you letters; internal
summaries.

**Moderate risk:** résumés; cover letters; business proposals; complaints; school
applications.

**Higher risk:** legal correspondence; financial documents; employment disputes;
medical-support documents; regulatory submissions. These require stronger evidence
rules and clearer user review.

## Step 6.2 — Create a certification process per template

Every document profile must pass: profile schema validation; required-section
validation; clarification test; grounding test; blank-output test; placeholder test;
export test; mobile rendering test; manual quality review.

**No document profile is "deployed" merely because its JSON exists.**

## Step 6.3 — Roll out in batches

Order: (1) résumé; (2) cover letter; (3) job application action plan; (4) professional
email and letter set; (5) business proposals; (6) education documents; (7) complaints
and disputes; (8) higher-risk regulated documents.

Each batch has: feature flag; usage monitoring; rollback capability; benchmark
fixtures; cost limits; support guidance.

---

# Global variables to track across every phase

**Product:** does this help complete an outcome? is the user asked only necessary
questions? does the output reduce confusion? can the user correct or reject AI
decisions? is the output finished wording rather than scaffolding?

**Technical:** provider availability; rate limits; context size; model output size;
database transaction boundaries; timeouts; retries; idempotency; caching;
concurrency; export rendering; mobile lifecycle; local hardware limits.

**Safety:** invented facts; unsupported inference; private-data logging; prompt
injection through uploads; malicious file content; cross-user data access; RLS;
secret exposure; account deletion; billing duplication.

**Commercial:** cost per generation; cost per successful outcome; retry cost;
subscription allowance; one-off purchases; model-tier pricing; support burden;
failed-generation refunds or allowance restoration.

**Operational:** staging parity; deployment rollback; provider outage response; audit
trail; incident alerts; support diagnostics; model-version changes; prompt-version
changes.

---

# Recommended immediate execution order

**Now:** deploy the updated provider router to staging; confirm the Anthropic secret
and selected model; run one basic Anthropic completion; run the fixed résumé fixture;
confirm factual audit, persistence, workspace display and export; inspect token use
and cost; force an Anthropic failure and verify OpenAI fallback; force total provider
failure and verify recoverable user state.

**Next:** add provider-router unit tests; add provider health and cooldown; implement
persistent generation stages; add idempotent retries; create the résumé benchmark
suite; add deterministic factual-claim checks.

**Only after those pass:** build mobile parity; harden deployment; resume catalogue
expansion; begin formal App Store readiness work.

---

# Decisive recommendation

Anthropic remains PrompTED's primary writing and reasoning provider. OpenAI remains
available for grounded web research, fallback, and independent cross-provider review
where useful. Google remains a tertiary fallback until its credit health and output
quality are proven under the same benchmark.

Most importantly, PrompTED should not be architected around loyalty to any provider.
Anthropic is the current primary supplier, not the product's nervous system. The
provider router, evidence layer, state machine and deterministic quality rules must
remain capable of surviving whichever AI company changes its pricing, model names,
limits or personality next Tuesday.
