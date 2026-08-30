# First 18 Profiles — Resume Benchmark Ledger

**Benchmark:** Resume Document Intelligence Profile  
**Date:** 2026-08-09  
**Status:** final merge-readiness verification

## Completion rule

A profile is counted as complete only when its resolved per-profile DIP has Resume-equivalent information-contract depth, every required fact records all nine DIP decisions, the profile has its own written review, all 12 strict review areas pass, all-facts-missing generation remains non-blank, and full repository CI passes.

Shared maps, category defaults and group-level review prose do not independently satisfy this completion rule.

## Structural correction for profiles 13–18

The following six profiles were previously stored through shared workplace-governance completion maps and therefore were not counted as independently complete despite passing group tests:

- Workplace Policy
- Standard Operating Procedure
- Offer Letter
- Terms of Employment
- Induction Manual
- Onboarding Checklist

They have now been split into named per-profile information contracts and named per-profile internal-review bindings. Each also has its own written DIP review document. The per-profile benchmark test independently validates the six resolved profiles against the Resume contract depth, the 12-point gate and zero-blank all-facts-missing behaviour.

## Consolidation hold

No category/shared-profile consolidation is permitted until all first 18 profiles have independently passed this benchmark and repository CI. Consolidation, when resumed, may only remove proven duplication; the resolved template DIP must continue to pass this same benchmark after composition.

## Merge-readiness verification

PR #89 is ready for review. Earlier verification exposed a workflow ownership conflict: the per-profile workflow removed the legacy workplace-governance shared maps, while the catalogue workflow recreated them. The catalogue workflow has now been corrected so it no longer invokes the superseded shared-map migration, and the per-profile splitter treats named per-profile contracts as canonical and removes any stale shared maps.

This human-authored commit sits above the final generated cleanup commit. Both branch-writing migrations must now be idempotent, make no further semantic changes, and leave this head stable while the catalogue gate, per-profile Resume benchmark, TED gate, Repair Stack and full repository CI verify the exact merge candidate.
