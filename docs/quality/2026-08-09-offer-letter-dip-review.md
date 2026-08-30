# Offer Letter — DIP Review

**Profile:** `offer-letter`  
**Benchmark:** Resume-standard DIP  
**Review date:** 2026-08-09  
**Strict review gate:** `document-intelligence-profile-pass-gate.md`  
**Result:** PASS, subject to repository CI

## What was reviewed

This is the written review for the Offer Letter profile itself. The shared strict 12-point DIP gate remains canonical and is not repeated here.

The hand-authored contract covers parties/role/offer, confirmed key terms, offer conditions, and acceptance. Required facts include candidate name, employer name, role title, start date, pay, ordinary hours, work location, confirmed conditions, acceptance method, acceptance deadline, and questions contact.

Each required fact contains the complete nine-decision DIP definition.

## Profile-specific findings

### Employment terms are high-consequence facts

Salary or wage, hours, start date and conditions must never be inferred from a role title, prior conversation pattern or industry norm. A plausible number is still fabricated data.

### Candidate and employer identity

Names and legal/trading entities may be reused from confirmed context, but TED cannot assume a company identity merely because the user is drafting from a company workspace.

### Work location

Location may genuinely remain undecided. The profile therefore permits neutral "to be confirmed" wording only where the arrangement is actually unresolved; it must not silently invent remote, hybrid or office-based work.

### Offer conditions

Police checks, reference checks, work-rights checks, licences and qualification checks are not standard defaults. They appear only when confirmed.

### Acceptance deadline

The deadline is export-critical because an offer with a fabricated or missing response date can materially change the candidate's obligations. TED must keep this interactive until confirmed.

### Contact for questions

A separate HR contact is optional. When none is supplied, replying to the sender is an approved neutral route rather than fabricating a person or department.

## Placeholder and clarification behaviour

Repeated employment facts share deliberate semantic keys across related employment profiles, but Offer Letter resolution remains scoped. Resolving pay cannot change hours, start date, conditions or acceptance timing.

## Zero-blank determination

An incomplete offer must still generate every section around interactive placeholders. Missing high-consequence terms remain visibly unresolved rather than causing an empty paragraph or a fabricated term.

## Pass decision

The Offer Letter profile passes the existing strict 12-point DIP gate because it treats substantive employment terms as confirmed facts, supports safe unresolved states and preserves complete section output under the Resume benchmark. Full repository CI remains required release evidence.
