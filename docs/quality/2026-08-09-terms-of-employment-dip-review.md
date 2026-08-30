# Terms of Employment — DIP Review

**Profile:** `terms-of-employment`  
**Benchmark:** Resume-standard DIP  
**Review date:** 2026-08-09  
**Strict review gate:** `document-intelligence-profile-pass-gate.md`  
**Result:** PASS, subject to repository CI

## What was reviewed

This review covers the Terms of Employment profile itself. Resume remains the depth benchmark for the hand-authored information contract, and the existing strict 12-point DIP gate remains the only pass standard.

The contract is hand-authored across parties and role; pay, hours and location; duties, policies and obligations; leave and ending employment; and acknowledgement. Required facts include employer legal name, employee name, role title, start date, pay rate, pay frequency, ordinary hours, work location, core duties, applicable policies, special obligations, leave basis, ending-employment terms, acknowledgement method and questions contact.

Each required fact has the same nine-decision depth as Resume: key, label, fact type, placeholder label, contextual clarification question, automatic-fallback decision, export requirement, shared-resolution key, and neutral replacement options.

## Profile-specific findings

### Contractual terms must remain sourced

Pay, hours, location, duties, probation, notice, leave and other employment conditions cannot be inferred from market norms, job titles or another employee's terms.

### Leave and statutory entitlements

Where exact entitlements are not supplied, TED may refer only to the applicable statutory, award, agreement or employer basis. It must not invent leave quantities, loading, accrual rates or eligibility.

### Notice and ending employment

A notice period or termination consequence must never be guessed. Where no specific term is confirmed, the profile uses bounded wording referring to the applicable contract, policy and law rather than fabricating a period.

### Special obligations

Confidentiality, intellectual-property, restraint and post-employment obligations are not assumed defaults. They appear only when confirmed by the user or source document.

### Policies

The contract may reference applicable policies that are actually issued and communicated, but it must not manufacture policy titles or imply obligations from policies that have not been supplied.

### Acknowledgement

Acceptance method is substantive because it determines how the terms become acknowledged. It remains export-critical until confirmed.

## Placeholder and clarification behaviour

Employment identity and role facts may share deliberate semantic resolution with related employment profiles, but terms remain independently scoped. Resolving pay cannot silently resolve pay frequency, hours, location, leave or notice.

## Zero-blank determination

Every section remains renderable with complete connective wording and interactive placeholders when terms are unresolved. High-consequence unknowns remain visible and answerable rather than blanked or guessed.

## Pass decision

The Terms of Employment profile passes the existing strict 12-point gate only because its information contract matches Resume depth, preserves factual boundaries and survives all-facts-missing generation without empty sections. Full repository CI remains required release evidence.
