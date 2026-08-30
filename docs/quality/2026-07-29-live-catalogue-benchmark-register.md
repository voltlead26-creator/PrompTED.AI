# Live catalogue generation and benchmark register

Date started: 29 July 2026
Production surface: `https://ted.littlemissscarlett.co`
Production Edge Function observed: `generate-document` version 318

## Pass contract

A document passes only when fresh production evidence confirms:

1. TED routes the request to the correct document;
2. TED asks only material missing-information questions;
3. relevant uploads are suggested without blocking a sufficiently grounded request;
4. every required section contains final user-facing wording;
5. every factual claim is traceable to the fixture conversation or upload;
6. structure, order, depth, length, tone and formality meet the profile's real-world benchmark;
7. no placeholders, coaching instructions, blank sections or invented facts remain;
8. preview and export are available and the document is usable without rewriting.

`PASS` requires all eight gates. A correct recommendation is not a generation pass.

## Stage 1 — job-application bundle

| Document | Routing | Clarification | Upload guidance | Final wording | Factual integrity | Benchmark | Preview/export | Verdict |
|---|---|---|---|---|---|---|---|---|
| Résumé / CV | Pass | Pass — complete fixture required no extra questions | Pass — existing résumé, job advertisement, performance review and KPI material suggested as optional | Fail — workspace did not become reviewable during the observed run | Inconclusive — no complete final document | Fail — no completed document to compare | Fail — no reviewable/exportable result | **FAIL** |
| Cover letter | Pass | Pass — complete fixture required no extra questions | Pass — résumé and job advertisement suggested as optional | Fail — all four sections were blank; three were explicitly reported as unsafe | Inconclusive — no factual prose to validate | Fail — blank output cannot meet the one-page, 250–450 word professional benchmark | Fail — PDF export disabled | **FAIL** |
| Selection criteria response | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| LinkedIn profile | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| Job-search checklist | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| Interview preparation questions | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| Interview script | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| Job-application follow-up email | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| STAR achievement bank | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |
| Recruiter introduction email | Not run | Not run | Not run | Not run | Not run | Not run | Not run | **BLOCKED** |

### Live evidence

#### Résumé / CV

- Fixture: complete Australian Warehouse Operations Manager résumé request with confirmed contact details, two roles and dates, team size, two measured achievements, qualification, licence, location, tone and an explicit no-invention instruction.
- Recommendation: `Resume`.
- Upload gate: correct and optional.
- Outcome: `d57a90aa-2948-4b06-ab21-9648cee1d8bd`.
- Observed behaviour: after **Build now**, the outcome remained at **Loading your workspace** throughout the observation window. Reload returned to the pre-build upload gate rather than a completed document.

#### Cover letter

- Fixture: complete Warehouse Operations Manager cover-letter request naming the employer, role requirements, candidate evidence, supported employer motivation, contact details, tone and explicit factual prohibitions.
- Recommendation: `Cover Letter`.
- Upload gate: correct and optional.
- Outcome: `32c2f732-c7ca-4f3d-a502-361cee219842`.
- Observed behaviour: generation eventually opened a four-section workspace. `Opening & Role`, `Why You Fit`, `Why This Employer`, and `Closing & Next Step` were blank. The latter three were reported as sections TED could not safely finish. PDF export was disabled.

### Shared production boundary

The current blocker is after correct routing and upload guidance, at initial document drafting/workspace completion. Supabase Edge Function logs show successful `interpret-intent` and `recommend` requests and a production `generate-document` version 318 request returning HTTP 200, but the browser did not receive a complete usable document.

Running the remaining eight Stage 1 documents before this shared boundary is corrected would consume live generations without producing benchmarkable artefacts. They remain explicitly blocked, not passed or silently skipped.

## Next release gate

1. Diagnose why successful or initiated generation requests leave required sections blank or the workspace loading indefinitely.
2. Correct and deploy the shared generation/workspace boundary.
3. Retest résumé and cover letter first.
4. Continue the remaining eight Stage 1 documents only after both flagship retests produce complete previewable and exportable documents.
5. Advance to later catalogue stages only after Stage 1 has a recorded verdict for every document.

## Production retest — generation version 319

### Résumé / CV

- Outcome: `8a96750d-38b0-4aec-964c-793909e070ae`.
- Routing: passed with the explicit `Resume` recommendation and no unnecessary clarification.
- Upload guidance: passed; existing résumé, job advertisement, performance review and KPI material were optional.
- Generation: failed before the writing pipeline. Production logs recorded `POST 401` for `generate-document` version 319 after 2.094 seconds.
- User-facing handling: failed. The workspace reported five sections as unsafe and left Contact Details blank instead of identifying the expired authentication session.
- Export: failed; PDF remained disabled.
- Verdict: **FAIL**.

The next repair must validate or refresh the browser session immediately before generation and present authentication-specific recovery when refresh is impossible. This is an authentication boundary failure, not evidence that the supplied résumé facts were insufficient.

## Production retest — web commit d06dc23 / generation version 319

### Résumé / CV

- Outcome: `2faacec4-406f-45b2-8c98-5f6d27268f57`.
- Authentication: passed. The fresh `generate-document` request returned HTTP 200 after the web client validated/refreshed the session.
- Generation: failed. `generation_logs` recorded zero completed sections and the exact pipeline error identified `Professional Summary` as blocked because the intent stage asked for a prewritten personal statement.
- Validity finding: the supplied roles, dates, responsibilities and measured achievements were sufficient for TED to author the professional summary. Requiring the user to draft that wording defeats TED's purpose and is not an identity-critical factual gap.
- Export: failed; PDF remained disabled because no complete document was produced.
- Verdict: **FAIL**.

Repair gate: ordinary professional wording must be generated from confirmed evidence. Only genuinely identity-critical missing facts may stop a section; all other missing information is reported for improvement without erasing the draft.

## Production retest — generation version 320

### Résumé / CV

- Outcome: `89a71e6f-e84c-4c32-9970-de9b3dcf7237`.
- Structure and completion: passed. All seven sections contained readable wording.
- Clarification validity: failed. TED asked the user to supply a professional summary even though TED had already produced one, and asked for either referee details or wording TED had already safely selected.
- Factual integrity: failed. The draft invented a 15% picking-error reduction, a reduction in workplace incidents, process audits, staff training, workflow changes, performance-target history, and training-provider accreditation. None appeared in the fixture.
- Export: remained disabled pending section approval, but the document was not eligible for approval because of the invented claims.
- Verdict: **FAIL**.

Repair gate: every past/present factual clause must be traceable to source evidence; unsupported numeric claims are a deterministic hard failure. Requests for TED-authored wording are not valid clarification questions.

## Production retest — generation version 321

### Résumé / CV

- Outcome: `349a4289-39f1-4e91-b618-776dba64b713`.
- Structure and clarification: passed. Seven sections were produced and no invalid “write the summary” clarification remained.
- Numeric integrity: passed; the prior invented 15% metric did not recur.
- Factual integrity: failed. The draft still invented scheduling and inventory duties, stock-accuracy and productivity improvements, client/business effects, `TAFE Melbourne`, advanced Excel proficiency, and problem-solving ability.
- Verdict: **FAIL**.

Repair gate: factual review is separated from style review. Every generated unit must receive a source-grounding classification, and claimed supporting quotations must occur in the supplied source. Missing or invalid grounding fails closed and triggers targeted rewriting.

## Production retest — generation version 322

### Résumé / CV

- Outcome: `787c9862-c60e-4616-893e-b770f90a3e36`.
- Factual-gate execution: inconclusive. The generation failed before a reviewed document was released.
- Provider evidence: `generation_logs` recorded Google HTTP 429 `RESOURCE_EXHAUSTED` with the provider reporting depleted prepaid credits. The router attempted its configured chain and surfaced the final provider failure.
- Safety behaviour: passed. No unreviewed or potentially invented draft escaped the new gate.
- Usability and export: failed; the workspace remained blank and PDF export was disabled.
- Verdict: **FAIL**.

Immediate release gate: restore at least one healthy configured model provider (or valid fallback) and repeat the identical fixture. Provider availability is not a document-quality pass.
