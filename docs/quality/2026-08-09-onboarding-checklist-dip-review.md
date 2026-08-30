# Onboarding Checklist — DIP Review

**Profile:** `onboarding-checklist`  
**Benchmark:** Resume-standard DIP  
**Review date:** 2026-08-09  
**Strict review gate:** `document-intelligence-profile-pass-gate.md`  
**Result:** PASS, subject to repository CI

## What was reviewed

This review covers the Onboarding Checklist profile itself. Resume remains the benchmark for information-contract depth, and the existing strict 12-point DIP review remains the pass gate.

The hand-authored contract covers pre-start tasks, first-day tasks, first-week tasks, role training and access, and owner/due-date/status/evidence tracking. Required facts include new starter, role, start date, pre-start requirements, first-day plan, first-day owner, first-week training and walkthroughs, required access, role training, task owners, due timing, and status/evidence handling.

Each required fact has the same nine-decision definition depth as Resume.

## Profile-specific findings

### Reusable versus person-specific checklists

A checklist may be created before a specific employee is known. The profile therefore allows a neutral "the new starter" reference without fabricating a name, while role and task requirements remain independently resolvable.

### Start date and timing

Exact dates are optional where stage-based timing is sufficient. TED must not invent calendar dates merely to make the checklist appear scheduled.

### Access and systems

System, equipment, location and information access requirements are role-specific operational facts. They cannot be inferred from a generic role title unless already confirmed in context.

### Training

Mandatory modules, licences, competency checks and role training must be supplied or sourced. The checklist must not silently create compliance requirements.

### Ownership

Task ownership is essential for an operational checklist. Where the exact owner is unknown, the profile can use a role-based onboarding owner without marking the task complete or assigning it to a fabricated person.

### Status and evidence

The neutral status model may provide fields such as not started, in progress and complete, but TED must never infer actual completion. Evidence and notes remain user- or system-supplied facts.

## Placeholder and clarification behaviour

Role, employee identity and start-date facts can reuse intentional shared resolution keys. Access, training, task ownership and evidence remain separate to prevent one clarification answer from mutating unrelated onboarding requirements.

## Zero-blank determination

All checklist stages remain visible and usable even when every person-specific detail is unresolved. Missing facts appear as interactive placeholders or approved stage-based wording rather than disappearing sections.

## Pass decision

The Onboarding Checklist profile passes the existing strict 12-point gate only when its hand-authored contract matches Resume depth, unresolved tasks remain operationally usable, no completion or compliance fact is invented, and all-facts-missing plus full CI verification remain green.
