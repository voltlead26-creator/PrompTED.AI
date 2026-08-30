<!--
PrompTED review gates — see AGENTS.md.
Complete the review areas required by the change surface. Do not remove a
required row to avoid a BLOCK.
-->

## What

<!-- One paragraph. What changes and why. -->

## Change surface

- [ ] Generation, prompts, templates
- [ ] Storage, migrations, allowance
- [ ] Edge Functions, API routes
- [ ] UI components, screens, copy
- [ ] Upload, parsing, extraction
- [ ] Dependencies, CI, deploy config
- [ ] Docs only

---

## Required review sign-off

Every required review area records PASS / REVISE / BLOCK. A BLOCK cites the rule it
enforces. "PASS with concerns" is not a verdict — that is REVISE.

| Review area | Required? | Verdict | Notes |
|---|---|---|---|
| **Document Quality Officer** | **ALWAYS for any user-visible output** | | |
| Builder | | | |
| Systems Engineer | | | |
| Architect | | | |
| Workflow Engineer | | | |
| UI Designer | | | |
| Compliance & Regulations Manager | | | |
| Product Identity & User Advocate | | | |

### Document Quality Officer — mandatory checks

Cannot be skipped when this PR can affect anything a user reads. Tick or
explain why not applicable:

- [ ] No path allows an artifact to save with zero usable content blocks
- [ ] No required section can ship empty
- [ ] No bracketed placeholders reach final output without an explicit template request
- [ ] No instruction-like scaffolding ("Use this section to…", "Insert your…") can reach output
- [ ] Output is written *for* the user, not *about* the user
- [ ] Every generation path passes deterministic validation — including seed → approve → export
- [ ] No personal, employment, financial or legal facts are invented rather than sourced

> Reminder: an `approved` status flag is **not** a content gate. Status and
> content validity are independent checks.

---

## Checks run

Paste real output. "Should pass" is not a result.

```
pnpm lint
pnpm typecheck
pnpm build
deno lint / check / test
```

- [ ] All checks green
- [ ] Checks NOT run — reason stated below

## Risk

<!-- What could this break that a green typecheck would not catch? -->

## Review

- [ ] Draft — not for merge
- [ ] Owner approval required before merge to protected `main`
