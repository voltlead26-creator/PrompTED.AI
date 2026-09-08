# Template contract coverage — 8 September 2026

**Publication update — 9 September 2026 AEST:** the matrix below and its JSON
companion preserve the earlier source inventory. Their statements that 18
catalogue/profile mappings and 37 persistence seeds are missing are historical,
superseded by the locally verified implementations in
[Generation-Policy-Admission-20260908.md](Generation-Policy-Admission-20260908.md)
and [Template-Catalogue-Persistence-Repair-20260908.md](Template-Catalogue-Persistence-Repair-20260908.md).
The original rows, hashes and source references have not been rewritten as a new
runtime inventory. Those repairs do not establish catalogue-wide model quality,
browser generation, approval/export, exact-commit CI or production acceptance.

**Status: read-only source audit complete; catalogue-wide release acceptance blocked.** This is a derived evidence matrix for the current shared working tree in `/Users/kaichurchw/PrompTED.AI`, on the parent task’s `Thought-Enhanced-Document` implementation line. It is not a new runtime registry. Parent verification runs independently; this audit did not execute application modules, tests, services, provider calls, database commands, Git mutations or hosted actions. Source hashes are recorded in the companion JSON. A dirty working tree is not attributed to a clean commit.

The machine-readable [86-row matrix](../../../docs/evidence/web-operational-readiness/Template-Contract-Coverage-20260908.json) records the exact UUID, source contract and line, catalogue and profile section order, required fields and per-section fact definitions, advice/risk policy, captured/legacy execution path, declared benchmarks, migration references, formats and verification status for every template. Values were extracted using the TypeScript parser’s literal AST and JSON/SQL literals, without importing application modules. No benchmark URL was fetched or evaluated.

## Concrete release findings

- **F4 catalogue/profile integration:** 86/86 profiles have an information contract; 68 match catalogue keys and order. The remaining 18 have **48 catalogue sections without a same-key information contract**. This disconnects **163 authored fact definitions, including 80 marked `requiredForExport`**, from the pipeline’s section lookup. These are counts of contract definitions, not 163 distinct user facts or observed production failures.
- **Authority versus compatibility:** none of the 18 mismatches is classified as `legacy_alias_only` in the existing approved compatibility record. Its exact current arrays still match all 18. Seven separate profile-name aliases are intentional and preserve the full ordered key set.
- **Distinct migration/guest-recovery defect:** only 49 current catalogue UUIDs are seeded by the checked-in production migrations; **37 are absent**. Guest migration converts a known slug to its catalogue UUID and the server requires that UUID in `public.templates`, so fresh-database recovery for those valid templates cannot succeed. This is a source-confirmed reachable failure; a focused database/browser reproduction remains required. Hosted rows were not queried.
- **Coverage is not functionality:** the adapter test currently asserts only a count of 18 and non-empty arrays; it does not verify exact identities, mappings or runtime section facts. It sorts keys when comparing, so an order regression could evade that test. There is no additional order-only mismatch in the current snapshot.
- **Formats remain bounded:** the live export-format policy activates only PDF. Nine catalogue entries advertise `excel`; the five captured specifications declare DOCX/PDF, and moving-house also declares XLSX. Those declarations do not prove corresponding active renderers or inspected output.

## Live consumer trace

1. [Shared catalogue](../../../packages/shared/src/templates/index.ts#L80) supplies BrowseModal, recommendation/name resolution and browser generation preparation. [Server resolveTemplate](../../../supabase/functions/_shared/template-engine.ts) now selects exact catalogue IDs/slugs and orders the returned sections by their authoritative order.
2. [resolvedProfileFor and exact-key joins](../../../supabase/functions/_shared/document-pipeline.ts#L96) select a DIP from the admitted template name/ID. `informationKeysBySection` returns `[]` for a catalogue key absent from the DIP; `contractItemsForSection` does the same. Static reproduction of the inspected selector over the 86 literal profiles resolves the expected profile for both slug and UUID/name inputs, so wrong profile selection does not explain this defect.
3. The same pipeline renders the DIP into intent, planning, writing and review prompts. [Intent output validation](../../../supabase/functions/_shared/document-output-contracts.ts#L367) rejects missing-information keys outside that empty allowlist. A model correctly returning a profile fact key for a mismatched section can therefore fail `DOCUMENT_INTENT_OUTPUT_INVALID`; returning only prose missing information reaches `missingContractItems`, which produces no per-fact placeholder when the contract list is empty. Later generic section fallback does not restore the missing authored fact contract.
4. Placeholder metadata carries exact profile/section/information identity, shared-resolution key and export-required flag. These feed scoped editing and export eligibility. Old stored placeholder IDs and source metadata must remain readable; generating a new projected contract must not rewrite old metadata.
5. [Shadow adapter](../../../supabase/functions/_shared/document-ledger-adapter.ts#L75) refuses mismatched keys. [Enhanced DIP V2](../../../supabase/functions/_shared/document-intelligence-profiles-v2.ts#L1) already reads the existing compatibility proposal but explicitly remains shadow-only. Neither is evidence that live generation currently translates the 18 conflicts.
6. Existing captured documents use accepted immutable ledger snapshots and their operation/revision boundaries. The five current captured template keys match catalogue order. This audit does not establish per-user captured activation, model evaluations or every captured workflow. Historical or explicit fallback paths still need the legacy contract fix.

## Existing compatibility decision and smallest coherent correction

The existing [machine-readable compatibility decision](../../../docs/architecture/document-section-key-compatibility.proposed.json) and [ADR-001](../../../docs/architecture/ADR-001-section-key-authority-and-compatibility.md) are historical evidence, not an instruction to activate their future structure wholesale. The decision contains 19 one-to-one renames, 17 splits, 14 semantic replacements, four new canonical sections, five unchanged relationships and one many-to-one merge. Current owner scope authorizes repairs, but the old provenance and immutable contract versions must not be relabelled as newly reviewed.

Recommended bounded repair: derive the current catalogue’s section-fact contract at the existing profile-resolution boundary from the authored DIP plus these exact mappings. Keep current catalogue section keys/order/requiredness, original fact definitions, factual source identity, neutral/fallback conditions and shared-resolution identities. Apply this **metadata projection only to new current-contract generation**, not to persisted prose. This is a compatibility adapter for the existing authority, not another independently editable registry. Bind its version/content digest to the existing accepted execution-policy receipt; currently the handler digest covers prepared template/destinations but not the resolved DIP mapping. A changed mapping must not reuse an in-flight provider checkpoint as though its policy were unchanged. Settled historical receipts remain exact replayable results.

For many-profile-sections-to-one-current-section cases, aggregate facts in the exact approved profile order and reject duplicate/colliding scoped identities. The present literal maps have no duplicate information keys within those proposed aggregate groups, but this must become a guard. Carry semantic requirements even for child sections with no required facts. Do not treat a semantic expansion as proof that old prose contains the new facts.

Three cases need explicit treatment rather than a generic reverse lookup: `promotion-case` has a future merge, `job-follow-up-email.sign_off` has a required sender fact without a current destination, and `terms-of-employment.acknowledgement` has a jurisdiction-controlled future policy. Optional interview-script candidate questions/closing also have no historical destination. Preserve their original policy. Do not enable future-only sections by rewriting the live catalogue, map required sign-off into an optional section and claim closure, or silently introduce a new legal requirement.

Keep authored profile constants, their original audit dates, existing saved placeholder metadata, shadow compatibility evidence and captured ledger v1/v2 immutable. Use a distinct derived adapter assessment date/version. If a current-contract projection cannot meet the stated semantic/output policy for a particular template, that template remains a named release blocker until a reviewed versioned contract is implemented; do not silently hide it to manufacture a complete-catalogue claim.

Regression sequence before implementation:

1. Drive the real admitted catalogue template through the actual pipeline boundary with controlled intent output. A valid authored fact key in a mismatched section must demonstrate the intended failure; a later fixed test must prove the exact projected fact metadata. Include all 18 exact mapping fixtures and all 86 ordered contract comparisons.
2. Preserve the original historical 18-conflict inventory as historical evidence, but test the new resolved runtime contract separately. Do not merely change the expected count to zero or soften the intent validator.
3. Cover missing required and optional facts, safe neutral replacements, split aggregates, semantic additions, the promotion merge, the future-only sections and duplicate metadata. Assert no required flag, question, source/shared-resolution identity or neutral condition is dropped.
4. Exercise a complete request, a scoped section repair and old/new receipt retry: unchanged siblings, previous approvals and exact historical wording remain untouched; changed mapping identity cannot reuse earlier provider work.
5. Reopen historical records containing old keys and placeholders, resolve one fact, save/reload, approve an exact revision and export. Independently read persisted sections and inspect the artifact. Existing profile-only fixture tests are supplementary.

## Individual resolution record for the 18 mismatches

### cover-letter

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [COVER_LETTER_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L583). Advice boundary: `none`. Unmapped fact definitions: 12 (6 export-required).

**Current catalogue order:** `opening` → `fit` → `motivation` → `closing`.

**Authored profile order:** `sender_and_date` → `recipient_and_salutation` → `opening` → `evidence_of_fit` → `employer_motivation` → `closing_and_signature`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `opening` | `sender_and_date` + `recipient_and_salutation` + `opening` | `one_to_many_split` |
| `fit` | `evidence_of_fit` | `one_to_one_rename` |
| `motivation` | `employer_motivation` | `one_to_one_rename` |
| `closing` | `closing_and_signature` | `semantic_replacement` |

**Smallest remediation and required assertion:** The existing opening is an aggregate: retain sender_and_date, recipient_and_salutation and opening facts there. Use the exact fit and motivation mappings. Closing includes expanded signature facts; missing candidate/sign-off identity must remain explicit. No historical opening may be split into new rows. The regression must assert these exact destinations and preserve all unaffected sections.

### job-search-checklist

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [JOB_SEARCH_CHECKLIST_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L959). Advice boundary: `none`. Unmapped fact definitions: 3 (1 export-required).

**Current catalogue order:** `items`.

**Authored profile order:** `objective_and_cadence` → `setup_and_evidence_preparation` → `role_discovery` → `role_screening` → `tailoring_and_submission` → `tracking_and_follow_up` → `interview_preparation` → `weekly_review`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `items` | `objective_and_cadence` + `setup_and_evidence_preparation` + `role_discovery` + `role_screening` + `tailoring_and_submission` + `tracking_and_follow_up` + `interview_preparation` + `weekly_review` | `one_to_many_split` |

**Smallest remediation and required assertion:** Keep one items section and apply the eight ordered profile groups as metadata/semantic requirements. Only objective_and_cadence carries three fact definitions, one export-required. Do not split existing checklist prose or replace checklist item identities. The regression must assert these exact destinations and preserve all unaffected sections.

### interview-prep-questions

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [INTERVIEW_PREP_QUESTIONS_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1145). Advice boundary: `none`. Unmapped fact definitions: 6 (1 export-required).

**Current catalogue order:** `about_you` → `role_specific` → `your_questions`.

**Authored profile order:** `role_and_evidence_map` → `opening_and_motivation_questions` → `behavioural_questions` → `role_specific_questions` → `difficult_question_preparation` → `questions_to_ask_interviewer` → `final_preparation_checklist`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `about_you` | `opening_and_motivation_questions` + `behavioural_questions` + `difficult_question_preparation` | `one_to_many_split` |
| `role_specific` | `role_and_evidence_map` + `role_specific_questions` + `final_preparation_checklist` | `one_to_many_split` |
| `your_questions` | `questions_to_ask_interviewer` | `one_to_one_rename` |

**Smallest remediation and required assertion:** Use the exact three-group mapping below, including role_and_evidence_map under role_specific. Practice questions are illustrative; personal STAR facts and confirmed results remain distinct from invented biography. Empty-fact profile sections still carry semantic expectations. The regression must assert these exact destinations and preserve all unaffected sections.

### interview-script

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [INTERVIEW_SCRIPT_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1370). Advice boundary: `none`. Unmapped fact definitions: 10 (1 export-required).

**Current catalogue order:** `intro` → `stories` → `tricky`.

**Authored profile order:** `opening_introduction` → `why_this_role` → `strength_and_capability_answers` → `star_evidence_stories` → `role_specific_answers` → `difficult_question_answers` → `candidate_questions` → `closing`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `intro` | `opening_introduction` + `why_this_role` | `one_to_many_split` |
| `stories` | `strength_and_capability_answers` + `star_evidence_stories` + `role_specific_answers` | `one_to_many_split` |
| `tricky` | `difficult_question_answers` | `one_to_one_rename` |
| No historical section | `candidate_questions` | `new_canonical_section` |
| No historical section | `closing` | `new_canonical_section` |

**Smallest remediation and required assertion:** Map the approved intro and stories groups and tricky rename. candidate_questions and closing are future-only optional sections with no historical destination and no required fact definitions. Do not create stored rows or silently treat those future sections as mandatory in the existing three-section contract. The regression must assert these exact destinations and preserve all unaffected sections.

### job-follow-up-email

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [JOB_FOLLOW_UP_EMAIL_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1670). Advice boundary: `light`. Unmapped fact definitions: 9 (4 export-required).

**Current catalogue order:** `thanks` → `value` → `next`.

**Authored profile order:** `subject_line` → `greeting` → `event_reference` → `continued_interest_and_value` → `next_step` → `sign_off`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `thanks` | `subject_line` + `greeting` + `event_reference` | `one_to_many_split` |
| `value` | `continued_interest_and_value` | `one_to_one_rename` |
| `next` | `next_step` | `one_to_one_rename` |
| No historical section | `sign_off` | `new_canonical_section` |

**Smallest remediation and required assertion:** Map the three thanks components, value and next exactly. The separate sign_off has required candidate_name but no historical destination. This prevents blind reverse-mapping: the generic next section is optional. A reviewed current-contract identity/signature rule or a new captured contract is required; do not discard the fact or silently promote optional next to required. The regression must assert these exact destinations and preserve all unaffected sections.

### pay-rise-request

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [PAY_RISE_REQUEST_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1934). Advice boundary: `light`. Unmapped fact definitions: 10 (3 export-required).

**Current catalogue order:** `case` → `ask` → `script`.

**Authored profile order:** `conversation_context` → `case_for_review` → `compensation_request` → `conversation_script` → `close_and_next_step`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `case` | `conversation_context` + `case_for_review` | `one_to_many_split` |
| `ask` | `compensation_request` | `one_to_one_rename` |
| `script` | `conversation_script` + `close_and_next_step` | `one_to_many_split` |

**Smallest remediation and required assertion:** Keep case as conversation_context plus case_for_review, ask as compensation_request, and script as conversation_script plus close_and_next_step. Market evidence and current/requested compensation must retain their original grounding and fallback rules. The regression must assert these exact destinations and preserve all unaffected sections.

### promotion-case

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [PROMOTION_CASE_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2203). Advice boundary: `light`. Unmapped fact definitions: 9 (6 export-required).

**Current catalogue order:** `impact` → `readiness` → `proposal`.

**Authored profile order:** `target_promotion` → `readiness_evidence` → `capability_match` → `development_and_gaps` → `request_and_next_step`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `impact` | `readiness_evidence` | `semantic_replacement` |
| `readiness` | `development_and_gaps` | `semantic_replacement` |
| `impact` + `readiness` | `capability_match` | `many_to_one_merge` |
| `proposal` | `target_promotion` + `request_and_next_step` | `one_to_many_split` |

**Smallest remediation and required assertion:** Preserve impact/readiness/proposal. The approved future mapping includes a merge from impact and readiness into capability_match; its facts cannot be assigned by an arbitrary reverse-map. A metadata projection must explicitly scope promotion_requirements and capability_evidence to the consuming current sections while retaining shared resolution and never merging saved text or approvals. The regression must assert these exact destinations and preserve all unaffected sections.

### personal-statement

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [PERSONAL_STATEMENT_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2415). Advice boundary: `none`. Unmapped fact definitions: 6 (3 export-required).

**Current catalogue order:** `motivation` → `background` → `goals`.

**Authored profile order:** `purpose_and_target` → `motivation` → `preparation_and_evidence` → `program_fit` → `future_direction`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `motivation` | `purpose_and_target` + `motivation` | `one_to_many_split` |
| `background` | `preparation_and_evidence` + `program_fit` | `one_to_many_split` |
| `goals` | `future_direction` | `one_to_one_rename` |

**Smallest remediation and required assertion:** Current motivation already matches one profile section but also needs purpose_and_target. background combines preparation_and_evidence and program_fit. goals maps to future_direction. An exact-key-only repair of missing names would still omit the extra purpose facts. The regression must assert these exact destinations and preserve all unaffected sections.

### education-cover-letter

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [EDUCATION_COVER_LETTER_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2606). Advice boundary: `none`. Unmapped fact definitions: 10 (6 export-required).

**Current catalogue order:** `intro` → `suitability` → `close`.

**Authored profile order:** `recipient_and_application` → `opening` → `fit_and_evidence` → `motivation_and_fit` → `closing`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `intro` | `recipient_and_application` + `opening` | `one_to_many_split` |
| `suitability` | `fit_and_evidence` + `motivation_and_fit` | `one_to_many_split` |
| `close` | `closing` | `one_to_one_rename` |

**Smallest remediation and required assertion:** Aggregate recipient_and_application plus opening facts under intro; fit_and_evidence plus motivation_and_fit under suitability; closing under close. The two aggregates are not mere aliases. Preserve all ten fact definitions and their original shared-resolution identities. The regression must assert these exact destinations and preserve all unaffected sections.

### reference-request

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [REFERENCE_REQUEST_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2833). Advice boundary: `none`. Unmapped fact definitions: 8 (5 export-required).

**Current catalogue order:** `ask` → `details`.

**Authored profile order:** `recipient_and_relationship` → `request_purpose` → `helpful_context` → `request_and_opt_out` → `signoff`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `ask` | `recipient_and_relationship` + `request_and_opt_out` + `signoff` | `one_to_many_split` |
| `details` | `request_purpose` + `helpful_context` | `one_to_many_split` |

**Smallest remediation and required assertion:** Map recipient_and_relationship, request_and_opt_out and signoff to ask; request_purpose and helpful_context to details, exactly as the existing decision. Preserve consent/opt-out semantics and do not infer the referee agreed. The regression must assert these exact destinations and preserve all unaffected sections.

### business-email

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [BUSINESS_EMAIL_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L3032). Advice boundary: `none`. Unmapped fact definitions: 9 (4 export-required).

**Current catalogue order:** `subject` → `body` → `action`.

**Authored profile order:** `subject_and_greeting` → `message` → `call_to_action`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `subject` | `subject_and_greeting` | `one_to_one_rename` |
| `body` | `message` | `one_to_one_rename` |
| `action` | `call_to_action` | `one_to_one_rename` |

**Smallest remediation and required assertion:** Three intent-preserving renames. Project subject_and_greeting facts to subject, message facts to body, and call_to_action facts to action. Preserve all nine fact definitions and the four export-required flags. The regression must assert these exact destinations and preserve all unaffected sections.

### workplace-policy

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [WORKPLACE_POLICY_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20230). Advice boundary: `light`. Unmapped fact definitions: 11 (4 export-required).

**Current catalogue order:** `purpose` → `policy` → `responsibilities` → `breach`.

**Authored profile order:** `purpose_and_scope` → `policy_statements` → `roles_and_responsibilities` → `breaches_and_review`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `purpose` | `purpose_and_scope` | `one_to_one_rename` |
| `policy` | `policy_statements` | `one_to_one_rename` |
| `responsibilities` | `roles_and_responsibilities` | `one_to_one_rename` |
| `breach` | `breaches_and_review` | `semantic_replacement` |

**Smallest remediation and required assertion:** Three one-to-one relationships preserve purpose/policy/responsibility intent. breach additionally contains review cadence. Retain explicit owner, behaviours and breach-process facts; no generic legal-compliance conclusion follows from the template label. The regression must assert these exact destinations and preserve all unaffected sections.

### sop

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [SOP_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20470). Advice boundary: `none`. Unmapped fact definitions: 11 (6 export-required).

**Current catalogue order:** `overview` → `steps` → `roles`.

**Authored profile order:** `purpose_scope_prerequisites` → `procedure_steps_and_controls` → `roles_records_and_review`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `overview` | `purpose_scope_prerequisites` | `semantic_replacement` |
| `steps` | `procedure_steps_and_controls` | `semantic_replacement` |
| `roles` | `roles_records_and_review` | `semantic_replacement` |

**Smallest remediation and required assertion:** All three relationships are semantic expansions, not safe text-renaming evidence. overview needs scope/prerequisites, steps needs owners/decision points/completion controls, and roles needs records/review. Missing operating or safety facts cannot be inferred from historical prose. The regression must assert these exact destinations and preserve all unaffected sections.

### offer-letter

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [OFFER_LETTER_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20674). Advice boundary: `high-stakes`. Unmapped fact definitions: 7 (6 export-required).

**Current catalogue order:** `offer` → `terms` → `conditions` → `acceptance`.

**Authored profile order:** `parties_role_and_offer` → `confirmed_key_terms` → `conditions` → `acceptance`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `offer` | `parties_role_and_offer` | `semantic_replacement` |
| `terms` | `confirmed_key_terms` | `one_to_one_rename` |
| `conditions` | `conditions` | `unchanged` |
| `acceptance` | `acceptance` | `unchanged` |

**Smallest remediation and required assertion:** Offer is a semantic expansion into parties/role/start date; terms is a rename. conditions and acceptance are unchanged. Restore all seven missing offer/terms facts, six export-required, without implying legal or recipient acceptance. The regression must assert these exact destinations and preserve all unaffected sections.

### terms-of-employment

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [TERMS_OF_EMPLOYMENT_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20870). Advice boundary: `high-stakes`. Unmapped fact definitions: 15 (10 export-required).

**Current catalogue order:** `parties` → `pay` → `obligations` → `ending`.

**Authored profile order:** `parties_and_role` → `pay_hours_and_location` → `duties_policies_and_obligations` → `leave_and_ending_employment` → `acknowledgement`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `parties` | `parties_and_role` | `semantic_replacement` |
| `pay` | `pay_hours_and_location` | `semantic_replacement` |
| `obligations` | `duties_policies_and_obligations` | `semantic_replacement` |
| `ending` | `leave_and_ending_employment` | `semantic_replacement` |
| No historical section | `acknowledgement` | `new_canonical_section` |

**Smallest remediation and required assertion:** All four mapped groups expand their current section semantics. Preserve pay/hours/location, duties/policies and leave/end-term facts. acknowledgement is future-only and jurisdiction-controlled, optional in the generic approved future contract; it must not become an assumed current legal requirement or inferred acceptance. The regression must assert these exact destinations and preserve all unaffected sections.

### induction-manual

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [INDUCTION_MANUAL_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L21141). Advice boundary: `none`. Unmapped fact definitions: 12 (7 export-required).

**Current catalogue order:** `welcome` → `how_we_work` → `policies` → `contacts`.

**Authored profile order:** `welcome_and_context` → `how_work_is_performed` → `policies_and_safety` → `systems_contacts_and_first_period`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `welcome` | `welcome_and_context` | `one_to_one_rename` |
| `how_we_work` | `how_work_is_performed` | `one_to_one_rename` |
| `policies` | `policies_and_safety` | `semantic_replacement` |
| `contacts` | `systems_contacts_and_first_period` | `semantic_replacement` |

**Smallest remediation and required assertion:** Welcome and how_we_work have rename mappings. Policies adds safety requirements, and contacts adds systems/first-period context. Preserve the broader required facts instead of assuming that existing policy or contact prose proves them. The regression must assert these exact destinations and preserve all unaffected sections.

### onboarding-checklist

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [ONBOARDING_CHECKLIST_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L21371). Advice boundary: `none`. Unmapped fact definitions: 12 (7 export-required).

**Current catalogue order:** `items`.

**Authored profile order:** `pre_start_tasks` → `first_day_tasks` → `first_week_tasks` → `role_training_and_access` → `owner_due_status_and_evidence`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `items` | `pre_start_tasks` + `first_day_tasks` + `first_week_tasks` + `role_training_and_access` + `owner_due_status_and_evidence` | `one_to_many_split` |

**Smallest remediation and required assertion:** Keep one items section and apply the five ordered timing/owner/evidence groups. Preserve all twelve facts, seven export-required, without interpreting suggested tasks as completed or assigning unconfirmed access. The regression must assert these exact destinations and preserve all unaffected sections.

### resignation-letter

**Classification:** current live integration defect; historical mapping is explicit, not already implemented. Contract: [RESIGNATION_LETTER_INFORMATION_CONTRACT](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L9774). Advice boundary: `high-stakes`. Unmapped fact definitions: 3 (0 export-required).

**Current catalogue order:** `notice` → `appreciation` → `transition` → `close`.

**Authored profile order:** `notice` → `appreciation` → `handover` → `close`.

| Current catalogue identity | Authored/future profile identity | Existing classification |
|---|---|---|
| `notice` | `notice` | `unchanged` |
| `appreciation` | `appreciation` | `unchanged` |
| `transition` | `handover` | `one_to_one_rename` |
| `close` | `close` | `unchanged` |

**Smallest remediation and required assertion:** Only transition -> handover is a rename. The three missing handover facts are not export-required and have declared neutral choices. Restore contextual clarification while keeping optionality; notice, appreciation and close remain exact. The regression must assert these exact destinations and preserve all unaffected sections.

## Complete 86-row matrix

C = core JSON, P = phase-2 JSON. Each DIP link identifies the exact authored information-contract constant. “Facts” counts all requiredInformation definitions, with export-required definitions in parentheses; optional fallback decisions still apply. L = legacy catalogue route. C/L = first captured cohort when admitted, plus historical/explicit legacy compatibility. “Contract only” describes inspected test source; no per-template browser/provider/artifact acceptance is asserted. All exact fact keys, flags, source definitions and UUIDs are in the JSON.

| Template / source contract | Current ordered section keys | DIP relation / facts | Advice | Path | Seed | Declared format / active | Test status |
|---|---|---|---|---|---|---|---|
| `resume` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L179) | `contact_details`, `summary`, `experience`, `education`, `skills`, `referees` | Exact order; 19 (9) | none | C/L | Present; resume old shape | docx/pdf / PDF | Contract only |
| `cover-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L583) | `opening`, `fit`, `motivation`, `closing` | **Mismatch**; 15 (7) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `job-search-checklist` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L959) | `items` | **Mismatch**; 3 (1) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `interview-prep-questions` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1145) | `about_you`, `role_specific`, `your_questions` | **Mismatch**; 6 (1) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `interview-script` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1370) | `intro`, `stories`, `tricky` | **Mismatch**; 10 (1) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `job-follow-up-email` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1670) | `thanks`, `value`, `next` | **Mismatch**; 9 (4) | light | L | Present | unspecified / PDF | **Mapping blocked** |
| `pay-rise-request` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L1934) | `case`, `ask`, `script` | **Mismatch**; 10 (3) | light | L | Present | unspecified / PDF | **Mapping blocked** |
| `promotion-case` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2203) | `impact`, `readiness`, `proposal` | **Mismatch**; 9 (6) | light | L | Present | unspecified / PDF | **Mapping blocked** |
| `personal-statement` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2415) | `motivation`, `background`, `goals` | **Mismatch**; 7 (4) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `education-cover-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2606) | `intro`, `suitability`, `close` | **Mismatch**; 10 (6) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `reference-request` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L2833) | `ask`, `details` | **Mismatch**; 8 (5) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `business-email` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L3032) | `subject`, `body`, `action` | **Mismatch**; 9 (4) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `workplace-policy` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20230) | `purpose`, `policy`, `responsibilities`, `breach` | **Mismatch**; 11 (4) | light | L | Present | unspecified / PDF | **Mapping blocked** |
| `sop` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20470) | `overview`, `steps`, `roles` | **Mismatch**; 11 (6) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `offer-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20674) | `offer`, `terms`, `conditions`, `acceptance` | **Mismatch**; 11 (8) | high-stakes | L | Present | unspecified / PDF | **Mapping blocked** |
| `terms-of-employment` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L20870) | `parties`, `pay`, `obligations`, `ending` | **Mismatch**; 15 (10) | high-stakes | L | Present | unspecified / PDF | **Mapping blocked** |
| `induction-manual` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L21141) | `welcome`, `how_we_work`, `policies`, `contacts` | **Mismatch**; 12 (7) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `onboarding-checklist` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L21371) | `items` | **Mismatch**; 12 (7) | none | L | Present | unspecified / PDF | **Mapping blocked** |
| `performance-review` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L7532) | `summary`, `strengths`, `development`, `goals` | Exact order; 13 (12) | light | L | Present | unspecified / PDF | Contract only |
| `meeting-minutes` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L7055) | `attendees`, `discussion`, `decisions`, `actions` | Exact order; 12 (7) | none | L | Present | unspecified / PDF | Contract only |
| `service-agreement` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L10956) | `parties`, `scope`, `payment`, `terms` | Exact order; 14 (14) | high-stakes | L | Present | unspecified / PDF | Contract only |
| `proposal` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L8608) | `summary`, `understanding`, `solution`, `pricing`, `next` | Exact order; 13 (13) | none | L | Present | unspecified / PDF | Contract only |
| `budget-workbook` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L3885) | `income`, `expenses`, `savings`, `debt` | Exact order; 7 (6) | none | L | Present | excel / PDF | Contract only |
| `selection-criteria-response` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L10772) | `heading`, `claim`, `evidence`, `relevance` | Exact order; 9 (9) | light | C/L | **Absent** | docx/pdf / PDF | Contract only |
| `linkedin-profile-rewrite` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L6383) | `headline`, `about`, `featured`, `direction` | Exact order; 11 (9) | none | L | **Absent** | unspecified / PDF | Contract only |
| `star-achievement-bank` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L11198) | `situation`, `task`, `action`, `result` | Exact order; 11 (10) | none | L | **Absent** | unspecified / PDF | Contract only |
| `professional-reference-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L8198) | `relationship`, `performance`, `evidence`, `recommendation` | Exact order; 11 (11) | light | L | **Absent** | unspecified / PDF | Contract only |
| `personal-brand-statement` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L7774) | `identity`, `value`, `proof`, `direction` | Exact order; 11 (11) | none | L | **Absent** | unspecified / PDF | Contract only |
| `career-change-plan` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L4334) | `direction`, `strengths`, `gaps`, `timeline` | Exact order; 10 (9) | none | L | **Absent** | unspecified / PDF | Contract only |
| `resignation-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L9774) | `notice`, `appreciation`, `transition`, `close` | **Mismatch**; 10 (3) | high-stakes | L | **Absent** | unspecified / PDF | **Mapping blocked** |
| `networking-outreach-message` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L7312) | `intro`, `reason`, `ask`, `close` | Exact order; 10 (7) | none | L | **Absent** | unspecified / PDF | Contract only |
| `recruiter-introduction-email` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L9363) | `subject`, `summary`, `fit`, `close` | Exact order; 10 (9) | none | L | **Absent** | unspecified / PDF | Contract only |
| `business-plan` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L4062) | `concept`, `market`, `operating_model`, `financials`, `milestones` | Exact order; 16 (16) | light | L | **Absent** | unspecified / PDF | Contract only |
| `executive-summary` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L5001) | `purpose`, `situation`, `recommendation`, `decision` | Exact order; 10 (10) | none | L | **Absent** | unspecified / PDF | Contract only |
| `pitch-deck-outline` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L7982) | `problem`, `solution`, `market`, `model`, `ask` | Exact order; 11 (11) | light | L | **Absent** | unspecified / PDF | Contract only |
| `scope-of-work` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L10498) | `overview`, `in_scope`, `out_of_scope`, `acceptance`, `assumptions` | Exact order; 14 (12) | high-stakes | L | **Absent** | unspecified / PDF | Contract only |
| `board-report` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L3667) | `overview`, `performance`, `risks`, `decisions` | Exact order; 11 (10) | light | L | **Absent** | unspecified / PDF | Contract only |
| `quarterly-business-review` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L8991) | `summary`, `metrics`, `insights`, `priorities` | Exact order; 11 (11) | none | L | **Absent** | unspecified / PDF | Contract only |
| `risk-assessment` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L10031) | `context`, `risks`, `rating`, `controls`, `review` | Exact order; 13 (13) | high-stakes | L | **Absent** | unspecified / PDF | Contract only |
| `financial-review` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L5441) | `summary`, `revenue`, `expenses`, `cashflow`, `actions` | Exact order; 10 (10) | light | L | **Absent** | unspecified / PDF | Contract only |
| `marketing-brief` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L6824) | `objective`, `audience`, `message`, `deliverables`, `success` | Exact order; 12 (12) | none | L | **Absent** | unspecified / PDF | Contract only |
| `grant-funding-proposal` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L5823) | `summary`, `need`, `activities`, `outcomes`, `budget` | Exact order; 12 (12) | light | L | **Absent** | unspecified / PDF | Contract only |
| `scholarship-application` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L10277) | `profile`, `case`, `evidence`, `impact` | Exact order; 12 (12) | none | L | **Absent** | unspecified / PDF | Contract only |
| `statement-of-purpose` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L11416) | `focus`, `preparation`, `fit`, `direction` | Exact order; 10 (10) | none | L | **Absent** | unspecified / PDF | Contract only |
| `study-plan` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L11836) | `goal`, `level`, `schedule`, `accountability` | Exact order; 10 (7) | none | L | **Absent** | unspecified / PDF | Contract only |
| `research-proposal` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L9566) | `title_question`, `background`, `methodology`, `contribution` | Exact order; 11 (11) | light | L | **Absent** | unspecified / PDF | Contract only |
| `literature-review` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L6616) | `scope`, `themes`, `tension`, `gap` | Exact order; 11 (11) | none | L | **Absent** | unspecified / PDF | Contract only |
| `academic-appeal-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L3248) | `decision`, `grounds`, `explanation`, `outcome` | Exact order; 12 (12) | high-stakes | L | **Absent** | unspecified / PDF | Contract only |
| `extension-request-letter` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L5192) | `request`, `reason`, `proposed_date`, `close` | Exact order; 12 (9) | light | L | **Absent** | unspecified / PDF | Contract only |
| `student-support-plan` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L11615) | `context`, `strengths`, `needs`, `actions` | Exact order; 12 (12) | light | L | **Absent** | unspecified / PDF | Contract only |
| `course-comparison-matrix` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L4680) | `options`, `criteria`, `notes`, `recommendation` | Exact order; 10 (10) | none | L | **Absent** | unspecified / PDF | Contract only |
| `academic-reference-request` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L3458) | `request`, `context`, `application`, `close` | Exact order; 9 (7) | none | L | **Absent** | unspecified / PDF | Contract only |
| `profit-and-loss-statement` (C); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L8408) | `revenue`, `cogs_gross_profit`, `operating_expenses`, `net_profit` | Exact order; 9 (8) | light | L | **Absent** | unspecified / PDF | Contract only |
| `forecasted-earnings` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L5655) | `basis`, `forecast`, `earnings`, `risks` | Exact order; 9 (9) | high-stakes | L | Present | excel / PDF | Contract only |
| `ebitda-analysis` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L4880) | `source_result`, `reconciliation`, `adjustments`, `limitations` | Exact order; 5 (5) | high-stakes | L | Present | excel / PDF | Contract only |
| `investment-capital-gains-report` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L6061) | `coverage`, `transactions`, `calculations`, `summary` | Exact order; 9 (9) | high-stakes | L | Present | excel / PDF | Contract only |
| `quote-estimate` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L9201) | `parties`, `pricing`, `terms` | Exact order; 10 (10) | high-stakes | L | Present | unspecified / PDF | Contract only |
| `invoice` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L6224) | `identity`, `items`, `payment` | Exact order; 10 (10) | high-stakes | L | Present | unspecified / PDF | Contract only |
| `purchase-order` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L8851) | `order`, `items`, `terms` | Exact order; 8 (8) | high-stakes | L | Present | unspecified / PDF | Contract only |
| `cash-flow-forecast` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L4544) | `basis`, `movements`, `position` | Exact order; 6 (5) | high-stakes | L | Present | excel / PDF | Contract only |
| `expense-claim` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12068) | `claim`, `expenses`, `approval` | Exact order; 7 (6) | light | L | Present | unspecified / PDF | Contract only |
| `project-plan` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12189) | `foundation`, `delivery`, `controls` | Exact order; 8 (7) | none | L | Present | unspecified / PDF | Contract only |
| `project-status-report` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12322) | `status`, `progress`, `attention` | Exact order; 7 (7) | none | L | Present | unspecified / PDF | Contract only |
| `meeting-agenda` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12453) | `details`, `agenda`, `outcomes` | Exact order; 7 (6) | none | L | Present | unspecified / PDF | Contract only |
| `action-register` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12572) | `register`, `evidence` | Exact order; 5 (3) | none | L | Present | unspecified / PDF | Contract only |
| `decision-log` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12668) | `decisions`, `reasoning` | Exact order; 5 (5) | none | L | Present | unspecified / PDF | Contract only |
| `handover-document` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12761) | `scope`, `operations`, `risks` | Exact order; 6 (5) | light | L | Present | unspecified / PDF | Contract only |
| `change-request` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12886) | `request`, `impact`, `control` | Exact order; 5 (4) | none | L | Present | unspecified / PDF | Contract only |
| `leave-availability-request` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L12989) | `request`, `handover`, `approval` | Exact order; 6 (4) | light | L | Present | unspecified / PDF | Contract only |
| `performance-improvement-plan` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13105) | `expectations`, `plan`, `review` | Exact order; 7 (7) | high-stakes | L | Present | unspecified / PDF | Contract only |
| `training-plan-skills-matrix` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13232) | `requirements`, `matrix`, `training` | Exact order; 7 (6) | light | L | Present | unspecified / PDF | Contract only |
| `incident-near-miss-report` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13358) | `details`, `facts`, `response` | Exact order; 7 (6) | high-stakes | C/L | Present | docx/pdf / PDF | Contract only |
| `asset-register-maintenance-log` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13495) | `assets`, `condition`, `maintenance` | Exact order; 6 (4) | light | L | Present | excel / PDF | Contract only |
| `stocktake-inventory-count` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13610) | `control`, `count`, `review` | Exact order; 7 (6) | none | L | Present | excel / PDF | Contract only |
| `business-case` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13731) | `case`, `options`, `recommendation` | Exact order; 6 (6) | light | L | Present | unspecified / PDF | Contract only |
| `customer-feedback-summary` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13842) | `method`, `findings`, `actions` | Exact order; 5 (5) | light | L | Present | unspecified / PDF | Contract only |
| `competitor-comparison` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L13946) | `scope`, `matrix`, `recommendation` | Exact order; 5 (5) | light | L | Present | unspecified / PDF | Contract only |
| `timesheet` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14046) | `period`, `entries`, `totals` | Exact order; 9 (6) | high-stakes | L | Present | excel / PDF | Contract only |
| `staff-roster` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14188) | `basis`, `schedule`, `checks` | Exact order; 9 (7) | high-stakes | L | Present | excel / PDF | Contract only |
| `moving-house-checklist` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14331) | `items` | Exact order; 4 (4) | none | C/L | **Absent** | docx/pdf/xlsx / PDF | Contract only |
| `new-tenancy-checklist` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14411) | `items` | Exact order; 4 (4) | none | L | **Absent** | unspecified / PDF | Contract only |
| `complaint-letter` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14492) | `issue`, `impact`, `resolution`, `close` | Exact order; 4 (4) | none | C/L | **Absent** | docx/pdf / PDF | Contract only |
| `insurance-claim-letter` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14597) | `policy`, `incident`, `loss`, `request` | Exact order; 6 (6) | none | L | **Absent** | unspecified / PDF | Contract only |
| `client-engagement-letter` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14717) | `scope`, `fees`, `responsibilities`, `terms` | Exact order; 4 (4) | light | L | **Absent** | unspecified / PDF | Contract only |
| `non-disclosure-agreement` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14827) | `parties`, `confidential_info`, `obligations`, `term` | Exact order; 5 (5) | light | L | **Absent** | unspecified / PDF | Contract only |
| `research-report` (P); [DIP](../../../supabase/functions/_shared/document-intelligence-profiles.ts#L14945) | `introduction`, `method`, `findings`, `analysis`, `conclusion` | Exact order; 4 (4) | none | L | **Absent** | unspecified / PDF | Contract only |

## Migration gap: 37 exact missing catalogue identities

This is separate from the 18 profile mappings. No change to `20260908130000_legacy_generation_policy_binding.sql` is proposed here. Prepare a separate additive migration after the current predecessor-to-policy upgrade has passed. Seed only the missing authoritative catalogue rows under their exact UUIDs, with reviewed fields and bounded validation. Preserve existing rows, document references, section prose, approvals and historical seed migrations. An `ON CONFLICT DO NOTHING` add-only strategy preserves existing rows but must be paired with post-migration identity/collision validation; it must not hide a conflicting pre-existing row. Do not regenerate or overwrite the old seed migrations.

The checked-in `20260609000000_seed_templates_v1.sql` contains 23 matching current UUIDs and `20260812172000_seed_phase2_templates.sql` contains 26. The historical generator path named in their headers is absent. Resume’s historical seed has five section keys and omits current `contact_details`; preserve that historical row unless a separately reviewed change is required. No live app consumer reads `public.templates.sections` as the generation authority in the inspected path; the immediate seed failure is the UUID existence guard.

Reachable failure: [guest migration](../../../apps/web/src/lib/guest-workspace-migration.ts#L30) resolves known slugs with `getTemplate(...).id`, then [atomic guest import](../../../supabase/migrations/20260831110000_atomic_guest_workspace_import.sql#L284) rejects a missing UUID with `GUEST_IMPORT_TEMPLATE_NOT_FOUND`. [legacy workspace save](../../../supabase/migrations/20260901110000_atomic_legacy_workspace_save.sql#L464) rejects a missing non-null UUID with `LEGACY_WORKSPACE_TEMPLATE_UNAVAILABLE`. The normal browser hook retains UUID values but sanitizes slugs to null, so the latter does not prove every ordinary slug-based save currently fails. Hosted inventory is still unverified.

| Template | Exact missing UUID |
|---|---|
| `selection-criteria-response` | `11111111-0000-4000-8000-000000000024` |
| `linkedin-profile-rewrite` | `11111111-0000-4000-8000-000000000025` |
| `star-achievement-bank` | `11111111-0000-4000-8000-000000000026` |
| `professional-reference-letter` | `11111111-0000-4000-8000-000000000027` |
| `personal-brand-statement` | `11111111-0000-4000-8000-000000000028` |
| `career-change-plan` | `11111111-0000-4000-8000-000000000029` |
| `resignation-letter` | `11111111-0000-4000-8000-000000000030` |
| `networking-outreach-message` | `11111111-0000-4000-8000-000000000031` |
| `recruiter-introduction-email` | `11111111-0000-4000-8000-000000000032` |
| `business-plan` | `11111111-0000-4000-8000-000000000033` |
| `executive-summary` | `11111111-0000-4000-8000-000000000034` |
| `pitch-deck-outline` | `11111111-0000-4000-8000-000000000035` |
| `scope-of-work` | `11111111-0000-4000-8000-000000000036` |
| `board-report` | `11111111-0000-4000-8000-000000000037` |
| `quarterly-business-review` | `11111111-0000-4000-8000-000000000038` |
| `risk-assessment` | `11111111-0000-4000-8000-000000000039` |
| `financial-review` | `11111111-0000-4000-8000-000000000040` |
| `marketing-brief` | `11111111-0000-4000-8000-000000000041` |
| `grant-funding-proposal` | `11111111-0000-4000-8000-000000000042` |
| `scholarship-application` | `11111111-0000-4000-8000-000000000043` |
| `statement-of-purpose` | `11111111-0000-4000-8000-000000000044` |
| `study-plan` | `11111111-0000-4000-8000-000000000045` |
| `research-proposal` | `11111111-0000-4000-8000-000000000046` |
| `literature-review` | `11111111-0000-4000-8000-000000000047` |
| `academic-appeal-letter` | `11111111-0000-4000-8000-000000000048` |
| `extension-request-letter` | `11111111-0000-4000-8000-000000000049` |
| `student-support-plan` | `11111111-0000-4000-8000-000000000050` |
| `course-comparison-matrix` | `11111111-0000-4000-8000-000000000051` |
| `academic-reference-request` | `11111111-0000-4000-8000-000000000052` |
| `profit-and-loss-statement` | `11111111-0000-4000-8000-000000000053` |
| `moving-house-checklist` | `22222222-0000-4000-8000-000000000080` |
| `new-tenancy-checklist` | `22222222-0000-4000-8000-000000000081` |
| `complaint-letter` | `22222222-0000-4000-8000-000000000082` |
| `insurance-claim-letter` | `22222222-0000-4000-8000-000000000083` |
| `client-engagement-letter` | `22222222-0000-4000-8000-000000000084` |
| `non-disclosure-agreement` | `22222222-0000-4000-8000-000000000085` |
| `research-report` | `22222222-0000-4000-8000-000000000086` |

Required seed acceptance: assert all 86 identities exist after a fresh migration chain; preserve positive fixtures for existing template rows/documents/sections across upgrade; create a valid guest workspace using one of the 37 (for example business-plan), show predecessor import failure for the exact absent UUID, apply the new migration, import/save/reload successfully, replay without duplicate rows and deny another owner. Include representative captured-cohort UUID references and a seed collision case. Add the new forward migration to an exact historical upgrade mode; do not loosen accepted historical manifests or let an older mode silently omit it.

## Intentional profile-name aliases

| Current catalogue/profile key | Retained authored profile key | Current section relation |
|---|---|---|
| `selection-criteria-response` | `selection-criteria` | Exact keys and order |
| `linkedin-profile-rewrite` | `linkedin` | Exact keys and order |
| `professional-reference-letter` | `reference-letter` | Exact keys and order |
| `quarterly-business-review` | `qbr` | Exact keys and order |
| `grant-funding-proposal` | `funding-proposal` | Exact keys and order |
| `scholarship-application` | `scholarship` | Exact keys and order |
| `complaint-letter` | `formal-complaint` | Exact keys and order |

## Benchmark, export and verification limits

Every row records declared benchmark authority/URL and authored-example source. These are source declarations, not a fresh reviewed model evaluation. Existing all-profile tests check profile shape, information contracts, placeholder metadata, review fields and fixture declarations. Dedicated strict-workflow tests often construct sections directly from profile keys; they can pass without exercising catalogue-to-pipeline mapping. The captured benchmark examples array remains empty in the inspected base specification, and v2 deliberately preserves historical provenance.

The nine catalogue `excel` declarations are: `budget-workbook`, `forecasted-earnings`, `ebitda-analysis`, `investment-capital-gains-report`, `cash-flow-forecast`, `asset-register-maintenance-log`, `stocktake-inventory-count`, `timesheet`, `staff-roster`. [Live format policy](../../../supabase/functions/render-export/export-format-policy.ts#L1) permits PDF and rejects historical Word/Excel aliases as not activated. Genuine DOCX/XLSX activation and artifact inspection remain separate work packages.

**Implemented:** this report and derived JSON only. **Verified locally:** static source inventory, exact key/order comparison, compatibility-array identity, name/UUID profile selection trace and migration seed enumeration. **Verified in CI:** not established by this audit. **Workflow exercised:** not performed in this audit. **Production exercised:** not performed. **Persistence proven:** no database execution in this audit; reachable missing-seed failure is traced in source. **Export inspected:** none. **Blocked:** 18 current profile mappings, 37 missing catalogue seeds, and any unactivated required output format. **Unverified:** current hosted data/cohort state and per-template factual-quality, browser, persistence and artifact acceptance.
