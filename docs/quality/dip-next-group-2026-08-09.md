# Document Intelligence next-group verification — 2026-08-09

Profiles migrated to Resume-standard information contracts in this group:

- `pay-rise-request` — Pay-rise Request & Conversation Script
- `promotion-case` — Promotion Case
- `personal-statement` — Personal Statement
- `education-cover-letter` — Application Letter — Education
- `reference-request` — Reference Request

## Required invariant

Missing information must never produce an empty section or empty document. Every unresolved required fact remains represented by a declared interactive placeholder with an exact contextual clarification question, or by a template-approved neutral/automatic fallback where the profile explicitly permits one. Unsupported factual claims are rewritten around or remain unresolved; they are never invented.

## Focused gate evidence

The catalogue migration workflow applied the five contracts, formatted the migrated profile registry, and passed the shared placeholder tests plus `catalogue-next-group-strict-workflow-review.test.ts` before committing the generated profile changes.

## Release state

This record does not mark PR #89 merge-ready. Full repository CI, Repair Stack CI, Edge Function validation and production build must pass on the migrated human-authored head before this group is treated as fully verified.
