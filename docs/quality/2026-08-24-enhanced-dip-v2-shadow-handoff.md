# Enhanced Document Intelligence Profiles V2 — Shadow Handoff

- **Recorded:** 24 August 2026 (Australia/Melbourne)
- **Workflow ID:** `01a029df-a620-7e23-bcf6-7bea2617354b`
- **Status:** ledger-ready shadow profile representation owner-approved and individually verified locally; live integration, persistence, workflow exercise, and hosted proof remain outstanding
- **Repository:** `https://github.com/voltlead26-creator/PrompTED.git`
- **Git common directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED/.git`
- **Worktree and durable output directory:** `/Users/kaichurchw/PrompTED - Historical/PrompTED/PrompTED`
- **Branch:** `reliably-prompTED`
- **HEAD:** `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Comparison base:** `reliably-prompTED` at `e7f4e37e3087ee166c16ab242b17c60b3877f16b`
- **Configured web build output:** ignored branch-local `apps/web/.next`; no build was run for this isolated shadow-only profile task

## What changed

Added a standalone Profile V2 migration representation that compiles all 86 reviewed Enhanced Document Intelligence Profiles into the owner-approved future ledger vocabulary without changing the live `DIPS` registry.

The V2 representation records:

- immutable schema and profile versions;
- template identity, routing, outcome, lifecycle, locale, risk and source policy;
- 344 explicit profile sections in reviewed profile order;
- 789 required factual inputs with source, sensitivity, clarification, placeholder/fallback and export consequences;
- 1,692 optional quality inputs that do not block sections or export;
- section requiredness, purpose, output form, missing-information behaviour, validation and document-specific quality expectations;
- benchmark source observations and per-section quality maps without copying benchmark wording;
- 68 exact catalogue/profile structures;
- 18 owner-approved compatibility-governed structures;
- permanent historical-read preservation while any document or consumer references a legacy key;
- four owner-approved profile-only sections as `new_canonical_section`: optional candidate questions, optional interview closing, required follow-up-email sign-off and jurisdiction-controlled employment acknowledgement;
- explicit shadow-only, no-live-authority, no-live-migration and no-model-redistribution invariants.

The live profile registry, catalogue, ledger, generation pipeline, persistence, Workspace, Find a Role, export, billing, GitHub Actions, package scripts and deployment configuration were not changed by this task.

## Why

The existing Enhanced DIPs contain valuable document-specific facts, clarification questions, safety rules and benchmarks, but their monolithic runtime shape predates the accepted future immutable Universal Document Generation Ledger. Directly renaming or replacing live profile sections would be unsafe because historical rows do not yet persist a ledger version or durable section key.

The V2 shadow representation establishes a testable migration seam. It demonstrates how the existing reviewed profile knowledge can become structured ledger input while preserving historical identities and owner decisions. It does not create a second production ledger and is not imported by live code.

## Product-Purpose Alignment

- **Target user/segment:** non-expert job seekers, small operators, employers and individuals completing consequential documents.
- **Problem:** loosely separated profile facts, quality rules and section identities can produce repeated questions, unsupported wording, blank sections or unsafe structural migration.
- **Intended completed outcome:** every future document section can use explicit evidence, clarification, quality, compatibility and export rules without losing historical content.
- **Outcome-progression step:** `Required facts and evidence → Clarification → Final user-ready documents → Review, persistence and export`.
- **Burden and risk reduced:** missing facts are attached to the affected section; optional improvements do not block; unsupported profile-only mappings fail closed; historical content is never silently redistributed.
- **Evidence:** all 86 source profiles compile, every generated V2 profile passes the standalone validator, and deliberate invalid variants are rejected.
- **Unverified assumptions:** production cohort sizes, historical key distribution, hosted persistence, provider behaviour, signed-in workflow state and export artifacts were not inspected.

## Council Challenge

- **Strategist — PASS:** one versioned profile migration representation feeds the future immutable ledger and keeps old identities readable.
- **Skeptic — PASS:** the V2 contract cannot claim live authority; unsupported conversions and any attempt to reintroduce unresolved requiredness fail closed.
- **Creative — PASS:** the existing 86 reviewed profiles are preserved as source evidence instead of being discarded or duplicated by a hand-authored replacement catalogue.
- **Operator — PASS:** two isolated source/test files can be reviewed and removed without touching live consumers; tests are standalone.
- **Audience Advocate — PASS:** clarification is section-scoped, optional context remains optional, required export facts are explicit and user content is not automatically redistributed.

**Chosen position:** compile the reviewed Enhanced DIPs into a shadow V2 migration representation aligned with the ledger types.

**Strongest rejected alternative:** rewrite or replace the live `DIPS` registry and switch consumers immediately. That would pre-empt persistence/version work and could orphan content, approvals, repair and export.

## Files changed

- `supabase/functions/_shared/document-intelligence-profiles-v2.ts` — shadow V2 types, compiler, compatibility projection and fail-closed validator.
- `supabase/functions/_shared/document-intelligence-profiles-v2.test.ts` — 14 standalone positive and deliberate negative tests.
- this handoff — durable scope, evidence and next gate.

## Individual testing performed

Environment:

- local macOS worktree;
- Deno `2.9.5` (`aarch64-apple-darwin`);
- required release baseline remains Node `22.23.2` and pnpm `10.33.0`, although the isolated files execute under Deno and were not wired into package workflows.

Commands:

```text
deno fmt --check supabase/functions/_shared/document-intelligence-profiles-v2.ts supabase/functions/_shared/document-intelligence-profiles-v2.test.ts
deno lint supabase/functions/_shared/document-intelligence-profiles-v2.ts supabase/functions/_shared/document-intelligence-profiles-v2.test.ts
deno check supabase/functions/_shared/document-intelligence-profiles-v2.ts supabase/functions/_shared/document-intelligence-profiles-v2.test.ts
deno test --allow-read supabase/functions/_shared/document-intelligence-profiles-v2.test.ts
git diff --check -- supabase/functions/_shared/document-intelligence-profiles-v2.ts supabase/functions/_shared/document-intelligence-profiles-v2.test.ts
```

Results:

- **Verified locally:** formatting passed for both files.
- **Verified locally:** scoped lint passed with zero findings.
- **Verified locally:** type checking passed for both files.
- **Verified locally:** 14 tests passed, 0 failed.
- **Verified locally:** V2 inventory is 86 profiles, 344 sections, 789 required inputs, 1,692 optional inputs, 68 exact profiles, 18 owner-approved shadow compatibility profiles and four resolved new canonical sections.
- **Verified locally:** no live source imports `document-intelligence-profiles-v2.ts`.
- **Verified locally:** the task added no workflow, package-script or release wiring.
- **Verified in CI:** unverified; no commit or push.
- **Workflow exercised:** not applicable and intentionally not attempted. The user required individual testing only at this stage.
- **Hosted/production:** unverified; no hosted mutation.

## Review gates

- **Document Quality — PASS for the shadow contract:** every section has explicit quality, missing-information and forbidden-output rules. Generated document wording was not exercised.
- **Builder — PASS:** focused format, lint, type and test checks pass; only the claimed files changed.
- **Systems — PASS for isolation:** no persistence, replay, billing, export or live runtime behaviour changed.
- **Architect — PASS:** shared ledger types are reused; the V2 registry declares itself source evidence, not a second live authority.
- **Workflow — PASS for scope:** no workflow behaviour was changed or claimed.
- **UI — not applicable:** no interface change.
- **Compliance — PASS for the shadow contract:** source precedence, provenance, personal-data sensitivity and no-log/no-invention rules are explicit.
- **Product Identity — PASS:** TED remains the sole product-facing intelligence; the profile representation exposes no provider choice to users.

## Owner decisions recorded and remaining risks

On 25 August 2026, the PrompTED owner approved:

1. `interview-script.candidate_questions` — optional `new_canonical_section` in the base contract; only an explicit immutable template variant may require it.
2. `interview-script.closing` — optional `new_canonical_section`.
3. `job-follow-up-email.sign_off` — required `new_canonical_section`, stored separately even when rendered adjacent to `next_step`.
4. `terms-of-employment.acknowledgement` — jurisdiction-controlled `new_canonical_section`, optional in the generic contract and required only by an approved jurisdiction-specific immutable contract.

Historical documents never gain these sections automatically. Their existing aggregate sections remain unchanged, and the shadow compiler rejects unresolved requiredness. No profile can become live runtime authority or claim a live migration through this shadow module. Production cohort size and historical key/version distributions remain unknown. The existing repository worktree contains substantial recovery changes that were preserved.

## Exact next gate

Profile V2 owner approval is now recorded. The foundation files are locally placed in `reliably-prompTED`, but the **F0 — Recovery Foundation Successor acceptance** gate still requires review of the exact target diff and fresh local evidence. After F0 and separate owner authorization, the next ledger implementation phase is **Phase L0.2 — Immutable Ledger Persistence and Versioned Compatibility Foundation**. That task must add the durable version/key boundary before any V2 profile can be selected by live generation.

The Profile V2 work is recorded as **L0.1A** in the Bible-integrated adoption sequence. It does not skip directly to runtime integration:

```text
L0.1A shadow restructuring
→ F0 recovery-foundation successor acceptance
→ L0.2 immutable persistence/version boundary
→ L0.3 approved adapters and local migration rehearsal
→ L0.4 representative cohort shadow validation
→ L1 first explicitly authorised application workflow exercise
→ L2 all-86 cohort expansion and CI/runtime enforcement
→ L3 bypass removal and controlled release
```

Until L1 is explicitly authorised, V2 verification remains individual and standalone. Until L2 is explicitly authorised, no V2 or compatibility validator is wired into CI, GitHub Actions, package workflows or runtime enforcement. This defers workflow testing to the point where persisted versions, historical aliases, stale-write protection and rollback can be exercised safely; it does not remove the eventual workflow acceptance requirement.

Commit, push, PR, merge, hosted migration, deployment and runtime integration remain separate protected actions and were not performed.
