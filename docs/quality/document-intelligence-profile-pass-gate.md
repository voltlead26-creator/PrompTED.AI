# Document Intelligence Profile Pass Gate

A Document Intelligence profile may move to `complete` only when every item below passes. Failure in any item keeps the profile `in_progress`.

## 1. Contract completeness

Every required fact defines all nine profile-specific items:

1. required information;
2. optional information;
3. fact type;
4. placeholder label;
5. exact contextual question;
6. safe automatic fallback, when one is genuinely safe;
7. export requirement;
8. shared replacement key, when one answer should resolve multiple occurrences;
9. approved neutral replacement options, including an explicit empty list when none are safe.

## 2. Section coverage

- Every output section in the profile has a section information contract.
- Required facts are mapped to the exact sections that use them.
- Optional information improves quality but never blocks generation.
- Multiple placeholders may exist in the same section or document.

## 3. Missing-information generation

- A complete, user-facing section is generated when every required fact is missing.
- Unknown facts become declared structured placeholders.
- Missing information never causes the section or document to be blanked, discarded or failed.
- TED continues to author transitions, summaries, conventional wording and structure.

## 4. Factual safety

- No employer, person, date, amount, address, credential, metric, event or other factual claim is invented.
- Safe inference is limited to wording and structure, never unsupported facts.
- Genuine blank output, instruction leakage, malformed undeclared placeholders and unsupported factual claims remain blocking.

## 5. Neutral replacements

- Every approved neutral option is factually non-committal and appropriate to the exact document context.
- Each option declares its inserted value, suitability, export-warning behaviour and whether surrounding wording must be regenerated.
- High-stakes facts use an empty option list when no vague replacement is safe.
- TED never invents or silently selects an undeclared neutral replacement.

## 6. Contradiction review

The profile and all rules it consumes contain no active instruction that:

- prohibits placeholders;
- requires asking instead of drafting;
- requires a section to fail because a vital fact is unavailable;
- treats declared placeholders as unsupported final wording;
- requires all placeholders to be resolved before any document can be generated.

## 7. Resolution behaviour

- Repeated occurrences of the same placeholder ID resolve together.
- Shared replacement keys resolve only intentionally linked facts within the same outcome.
- Resolving one unrelated fact does not modify another.
- Empty answers are rejected.
- Failed persistence leaves the placeholder unresolved.

## 8. Proofread and quality review

- Placeholder labels are excluded from grammar, style and editorial findings.
- Surrounding prose remains reviewable.
- Quality checks do not reject a document merely because declared placeholders remain.
- The document remains coherent before and after placeholder resolution.

## 9. Export behaviour

- Unresolved counts are correct by section, document and export requirement.
- Optional or fallback-safe unresolved values produce a warning.
- Required-for-export unresolved values require explicit acknowledgement.
- Applying a neutral option follows the option's export-warning rule.

## 10. Automated verification

The profile must pass:

- contract validation;
- contradiction scanning;
- all-required-facts-missing generation test;
- multiple-placeholder test;
- shared-resolution test;
- neutral-option test;
- proofread exclusion test;
- export decision test;
- existing profile regression tests.

## Internal review result

A profile passes only when the reviewer records:

- profile key and label;
- sections reviewed;
- number of required facts;
- number of neutral options;
- contradiction scan result;
- tests run and result;
- unresolved risks;
- final status: `PASS` or `FAIL`.

After `PASS`, migration continues automatically to the next profile in catalogue order without an approval checkpoint.
