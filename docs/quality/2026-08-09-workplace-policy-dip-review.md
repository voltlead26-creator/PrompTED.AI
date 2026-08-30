# Workplace Policy — DIP Review

**Profile:** `workplace-policy`  
**Benchmark:** Resume-standard DIP  
**Review date:** 2026-08-09  
**Strict review gate:** `document-intelligence-profile-pass-gate.md`  
**Result:** PASS, subject to repository CI

## What was reviewed

This review assesses the Workplace Policy profile itself. The existing strict 12-point DIP review remains the common pass gate and is not reproduced here.

The contract is hand-authored around four policy-specific areas: purpose and scope, policy statements, roles and responsibilities, and breaches and review. Required facts include organisation, policy topic, policy scope, required and prohibited behaviours, thresholds or approvals, employee and manager responsibilities, policy ownership, breach process, and review timing.

Each required fact has the full nine-decision DIP definition: key, label, fact type, placeholder label, contextual clarification question, automatic-fallback decision, export requirement, shared-resolution key, and neutral replacement options.

## Profile-specific findings

### Missing policy scope

Scope is substantive. TED must not guess which workers, locations, systems or activities are covered. The section remains complete around an interactive scope placeholder until the user confirms it.

### Missing prohibited conduct

A policy does not automatically require a separate prohibition list. Where prohibited conduct has not been supplied, the contract permits wording around confirmed positive requirements rather than inventing misconduct rules.

### Breach and consequence handling

A missing consequence must never be converted into a fabricated warning, disciplinary sanction, termination outcome or legal consequence. The approved fallback is procedural wording that directs the document through the organisation's confirmed reporting and review process without presuming an outcome.

### Legal and compliance references

The policy topic alone is not enough to infer legislation, awards, regulations or industry standards. Any such reference must come from supplied material, confirmed user context or an authoritative source used deliberately for the task.

### Responsibilities and ownership

Employee duties, manager duties and policy-owner responsibilities are distinct facts. TED must not infer one from another. The exact policy owner may remain unresolved or role-based without blanking the section.

### Review timing

A fixed annual or biennial review cycle is not assumed. Where no cadence is supplied, the profile permits bounded "review on material change" wording rather than manufacturing a calendar date.

## Placeholder and clarification behaviour

The profile supports multiple unresolved facts inside the same policy section. Each remains independently selectable and answerable. Shared organisation and policy facts may resolve linked occurrences, but a response about scope cannot silently alter breach wording, ownership or policy requirements.

## Zero-blank determination

With every factual input unresolved, all four policy areas can still render usable final wording around declared interactive placeholders or approved neutral process language. Missing information is therefore an incompleteness state, never a valid reason for an empty section or document.

## Pass decision

The profile passes the existing strict 12-point DIP review because its policy-specific contract is complete, non-contradictory, generation-safe and testable against the Resume benchmark. Full repository CI remains the release evidence for this branch state.
