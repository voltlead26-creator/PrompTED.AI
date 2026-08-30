# TED document-generation benchmark

Date: 28 July 2026

## Product truth

The user's complete conversation is TED's primary source of truth and TED's
largest quality asset. It contains the user's goal, facts, constraints,
corrections, priorities, tone and interpreted desired outcome.

Uploads, profile memory and real-world benchmark documents may strengthen the
result. They must not overwrite, contradict, dilute or silently replace what the
user said. Benchmarks govern professional structure, length, depth and
formality; they do not supply facts about the user.

## Acceptance gates

A generated document passes only when:

1. every relevant fact and constraint from the conversation reaches the
   appropriate final section;
2. the wording reflects the user's goal and natural voice while remaining
   suitable for the intended reader;
3. clarification asks only for facts whose absence materially prevents an
   accurate, relevant or usable final document;
4. uploads are requested when they materially improve accuracy, particularly
   for resumes, job advertisements, financial statements, performance evidence
   and proposals;
5. no achievement, qualification, employer fact, date, metric, financial value
   or source is invented;
6. every required section contains final wording rather than instructions,
   placeholders, section-purpose summaries or blank content;
7. structure, order, length, depth, tone and formality meet lawful real-world
   benchmark standards for that document type;
8. the output is genuinely usable without the user rewriting it.

## Live baseline

Synthetic fixture: a complete Warehouse Operations Manager resume request with
two roles, dates, team sizes, three measured achievements, qualifications,
skills, location, tone and an explicit prohibition on invention.

- Recommendation: PASS. TED selected Resume without unnecessary clarification.
- Upload suggestion: PASS. Existing resume, job advertisement, performance
  review and KPI material were suggested but remained optional.
- Generation: FAIL. Two fresh attempts ended in
  `DOCUMENT_QUALITY_FAILED`.
- Final wording: FAIL. The workspace displayed six empty sections, four marked
  as unsafe, with export disabled.
- Conversation sufficiency: PASS. The fixture supplied enough grounded content
  to produce a strong resume. The failure occurred after the conversation was
  accepted, inside generation/review.

## Source and deployment boundary

- Test source: `phase-2/document-intelligence-templates` at `f63a4f3`.
- Production deployment branch: `ClaudeTED.AI`.
- The phase-2 source exposes 79 catalogue templates through the combined
  TypeScript catalogue.
- Production's deployed `generate-document` bundle still contains the older
  document-intelligence profile file and does not contain the phase-2
  seven-part final-quality gates.
- Therefore production is not yet running the 79-profile intelligence system.

## Local structural baseline

- Catalogue integrity: 19/19 tests passed.
- The first full workspace seed audit exposed
  `forecasted-earnings:basis` because Phase 2 templates had no registered
  starter draft.
- The starter-draft registry is now derived from the Phase 2 catalogue metadata
  so every new template section participates in the non-blank workspace
  guarantee.
- Corrected workspace seed audit: 2/2 passed.
- Hermetic document-intelligence and pipeline suite: 33/33 passed, including all
  79 profiles, job-document routing, no invented job facts, benchmark-quality
  rules, parsing, validation, bounded concurrency, conversation-source
  preservation, quality-release severity and résumé-contract consistency.
- Correctly configured web suite: 217/217 passed across 31 files, including
  mobile input layout, generation recovery, output integrity, accessibility and
  the provider-key source scan.
- Shared package TypeScript check: passed.
- Diff whitespace check: passed.

## Real-world benchmark comparison

The review uses public career guidance as a quality reference, not as a source
of user facts or wording to copy.

### Resume

Australian Government guidance expects a short, professional, tailored resume
with contact details, relevant skills, work history, qualifications and concise
factual language. Harvard and Berkeley examples similarly favour role-relevant
evidence, readable hierarchy and achievement-led detail.

The synthetic conversation contained enough content to meet that standard.
TED's deployed output did not: blank sections cannot be assessed for depth,
professionalism or submit-readiness and therefore fail every final-wording
gate.

### Cover letter and other job documents

The benchmark standard is a concise, employer-specific document that connects
the user's evidence to the opportunity without inventing employer facts.
Phase-2 profiles encode those constraints, but deployed final wording has not
yet been provider-tested because production is running the older profile
bundle. Structural tests are evidence of coverage, not proof of final prose
quality.

## Implementation change under test

Each section-writing request now receives the user's bounded conversation
explicitly labelled as the primary source of truth. Ordinary conversations are
preserved in full. If a conversation exceeds the safety budget, the opening
goal and latest corrections are retained with an explicit omission marker.

The writer is instructed to:

- carry the user's facts, constraints, priorities, tone and intended reader
  into the relevant final sections;
- use uploads, profile memory and document conventions only to strengthen the
  conversation evidence;
- never let supporting sources overwrite or dilute what the user said.

The quality review now permits two targeted repair passes. Remaining medium or
high severity completeness, relevance, evidence, fact, tone or submit-readiness
issues still block the document. Low-severity editorial preferences alone no
longer erase an otherwise safe completed document.

## Release decision

Production Edge Function version 311 confirmed the current 79-profile bundle and
conversation-first logic were deployed, but the first live résumé still failed
with medium layout, structure, completeness and tone findings. The investigation
found contradictions in the résumé profile and a missing contact-header section
in the web template.

The coordinated fix now:

- requires candidate contact details and target role;
- adds a dedicated Contact Details section to the résumé workspace;
- removes contradictory first-person and Markdown rules;
- keeps medium/high factual and completeness failures blocking;
- prevents exhausted low-severity editorial preferences from erasing a safe
  document.

**Not ready to claim complete until the coordinated web and function release is
live and a fresh résumé produces every final section.** A green local build or
active Edge Function version alone is not production proof.
