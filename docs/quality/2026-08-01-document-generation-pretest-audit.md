# Document Generation Pre-Test Audit

**Date:** 1 August 2026  
**Branch:** `fix/document-generation-hardening`  
**Status:** `in_progress`

## Objective

Audit every production path that can create or improve user-facing document content before manual testing begins. The acceptance standard is not merely that a provider returns text. A successful workflow must preserve confirmed user facts, avoid invented claims, retain usable content when one clause or audit step fails, expose actionable missing information, and never replace a recoverable result with a blank document.

## Production workflow inventory

| Workflow | Entry point | Engine | Current hardening result |
|---|---|---|---|
| Catalogue document generation | Workspace `streamInitialDraft` | `generate-document` → shared document pipeline | Unified behind the audited document pipeline |
| Bespoke document generation | Workspace with no matched template | `generate-document` → section designer → shared document pipeline | Uses the same audit, repair and release rules as catalogue documents |
| Resume/CV improvement | Workspace with uploaded source text | `generate-document` → shared document pipeline | Audit incompleteness no longer becomes a high-severity factual failure |
| Cover letter and communication documents | Workspace catalogue/bespoke path | `generate-document` → shared document pipeline | Missing optional names/dates remain missing-info prompts rather than blank-document failures |
| Single-section regeneration | `useDocument.retryGenerationSection` | Same workspace document pipeline with one selected section | Uses the same final-text validation and factual gate as initial generation |
| Action plans and checklists | `generate-artifact` | TED artifact pipeline | Repaired output is now deterministically validated and independently re-audited before release |
| Reports, recommendations, research briefs and job matches | `generate-artifact` | TED artifact pipeline | Repaired output is now re-audited; malformed audit keys degrade to artifact-level failure |
| Client section acceptance | `applyGeneratedSection` | Deterministic client integrity check | Rejects blank, scaffold and instruction-like section events |
| Missing-information delivery | SSE `missing_info` | Shared document pipeline → workspace | Remains separate from section content; client tests cover pass-through |
| Credit charging | Successful generation stream | Server-side cost tracker | Charge remains after successful section production only |

## Root defects confirmed

### 1. Two engines could produce the same workspace document

The workspace attempted the v2 artifact engine first and accepted it whenever every required key appeared. That allowed a complete-looking artifact to bypass the document pipeline's section planning, factual grounding and targeted repair.

**Resolution:** Workspace documents now use the shared document pipeline exclusively. Artifact-native outputs remain on the artifact engine.

### 2. Auditor omission was treated as proof of unsafe wording

The factual audit required one result per sentence or bullet. A missing result, malformed classification or evidence-format mismatch became a high-severity factual issue. Long resumes therefore had a failure mode where audit truncation could block every section.

**Resolution:**

- Explicit `unsupported` classifications and unsupported fragments remain high-severity factual failures.
- Missing audit entries, invalid classifications and evidence-format mismatches are low-severity audit-completeness issues.
- Audit-completeness warnings trigger re-audit without asking the writer to replace otherwise valid wording.
- Evidence matching now tolerates punctuation and Unicode formatting differences.

### 3. Artifact repair bypassed the independent audit

The artifact pipeline audited the first draft, regenerated on failure, then ran deterministic validation only. A repaired artifact could therefore be released without the same independent model review that rejected the original.

**Resolution:** The repaired artifact now passes deterministic validation and a second independent audit before release.

### 4. Good sections could be rewritten because the audit itself failed

The repair-target helper previously treated every issue as a writing problem.

**Resolution:** Low-severity factual-audit infrastructure warnings produce no rewrite keys. The unchanged draft is re-audited instead.

## Safety invariants retained

- Explicit unsupported personal, employment, credential, historical and numeric claims remain blocking.
- Missing or malformed required blocks remain blocking.
- Placeholder, scaffold and instruction-like output remains rejected.
- Unknown audit section/block keys degrade safely to document/artifact-level handling.
- Failed generation does not consume a document credit.
- User-facing workspace documents do not use provider names or raw technical errors.

## Regression coverage added or updated

### Shared document pipeline utilities

- Omitted factual-audit units are classified as audit incompleteness, not unsafe wording.
- Explicit unsupported wording remains a blocking factual issue.
- Punctuation-only evidence differences do not create false failures.
- Fabricated or malformed evidence quotes do not prove that the user's wording is unsafe.
- Audit infrastructure warnings re-audit without rewriting good sections.

### Workspace generation routing

- Workspace documents call the audited document stream once.
- Template section keys and requirements are forwarded to the shared pipeline.
- Scaffold output is rejected client-side.
- Final usable output is accepted.
- Missing-information events remain separate from section content.

## Remaining verification gates

These items require fresh CI or rendered runtime evidence before the branch can be marked `verified`:

1. Deno type-check and Edge Function tests for the shared pipeline changes.
2. Web type-check and Vitest execution for workspace routing changes.
3. Production web build.
4. A real uploaded resume improvement run with enough bullets to exercise factual-audit coverage.
5. A bespoke fresh document run.
6. A single-section retry after one unsupported claim is removed.
7. An artifact-native checklist that fails first audit, repairs, and passes the second audit.
8. Confirmation that the UI displays detailed `missing_info` corrections alongside any generic generation issue.

## Known residual risk

The frontend still creates the generic message `TED did not produce safe final wording for this section` whenever a required section remains blank. The backend now prevents audit incompleteness from causing that state, but the UI wording still collapses provider failure, missing identity information and genuine factual rejection into one sentence. This should be refined before public release, but it does not weaken the backend release boundary.

## Rollback position

The branch is isolated from `ClaudeTED.AI`. No deployment or merge has been performed. The workspace routing change can be rolled back independently from the factual-audit classification changes if CI reveals an unrelated compatibility problem.
