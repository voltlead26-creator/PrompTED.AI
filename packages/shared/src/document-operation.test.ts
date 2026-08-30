import { describe, expect, it } from "vitest";
import {
  FIRST_CAPTURED_TEMPLATE_IDS,
  resolveFirstCapturedTemplateId,
  validateCapturedSectionRevision,
  validateCohortActivationPointer,
  validateCohortActivationTransition,
  validateDurableGenerationOperation,
  validateHistoricalProviderProvenance,
  validateOpenAIRouteSnapshot,
  validateRevisionBoundApproval,
  validateRevisionBoundExport,
  type CapturedSectionRevision,
  type CohortActivationPointer,
  type DurableGenerationOperation,
  type OpenAIRouteSnapshot,
  type RevisionBoundApproval,
  type RevisionBoundExport,
} from "./document-operation";

const DIGEST = "a".repeat(64);

describe("closed captured cohort resolution", () => {
  it("resolves only reviewed slugs and their canonical catalogue UUIDs", () => {
    expect(resolveFirstCapturedTemplateId("resume")).toBe("resume");
    expect(
      resolveFirstCapturedTemplateId("11111111-0000-4000-8000-000000000024"),
    ).toBe("selection-criteria-response");
    expect(resolveFirstCapturedTemplateId("cover-letter")).toBeNull();
    expect(resolveFirstCapturedTemplateId(null)).toBeNull();
  });
});

function route(overrides: Partial<OpenAIRouteSnapshot> = {}): OpenAIRouteSnapshot {
  return {
    provider: "openai",
    semanticRoute: "deep",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    routingVersion: "routing.2026-08-pilot.1",
    structuredOutputSchemaVersion: "document-output.1",
    allowedTools: [],
    timeoutMs: 90_000,
    maxAttempts: 2,
    background: false,
    store: false,
    fallback: null,
    ...overrides,
  };
}

function operation(
  overrides: Partial<DurableGenerationOperation> = {},
): DurableGenerationOperation {
  return {
    contractVersion: "generation-operation.1",
    operationId: "operation-1",
    operationRevision: 1,
    idempotencyReference: "idempotency-1",
    documentId: "document-1",
    acceptedDocumentRevision: 3,
    acceptedInputRevision: 3,
    templateId: "resume",
    ledgerVersion: "ledger.2026-08-first-cohort.1",
    generationSnapshotId: "snapshot-1",
    status: "generating",
    safeSectionKeys: ["contact_details"],
    blockedSectionKeys: ["experience"],
    retryable: false,
    reconnectPath: "/api/generation-operations/operation-1",
    route: route(),
    ...overrides,
  };
}

function section(overrides: Partial<CapturedSectionRevision> = {}): CapturedSectionRevision {
  return {
    sectionKey: "summary",
    required: true,
    state: "final",
    content: "An evidence-backed professional summary.",
    documentRevision: 3,
    sectionRevision: 2,
    blockingIssueIds: [],
    ...overrides,
  };
}

function approval(overrides: Partial<RevisionBoundApproval> = {}): RevisionBoundApproval {
  return {
    approvalId: "approval-1",
    documentId: "document-1",
    operationId: "operation-1",
    generationSnapshotId: "snapshot-1",
    ledgerVersion: "ledger.2026-08-first-cohort.1",
    approvedRevision: 3,
    revisionSha256: DIGEST,
    approvedByUserId: "user-1",
    approvedAt: "2026-08-31T01:00:00.000Z",
    ...overrides,
  };
}

function exportIdentity(overrides: Partial<RevisionBoundExport> = {}): RevisionBoundExport {
  return {
    exportId: "export-1",
    exportIdempotencyReference: "export-request-1",
    approvalId: "approval-1",
    documentId: "document-1",
    operationId: "operation-1",
    ledgerVersion: "ledger.2026-08-first-cohort.1",
    approvedRevision: 3,
    format: "docx",
    rendererVersion: "docx-renderer.1",
    validationVersion: "export-validation.1",
    artifactId: "artifact-1",
    artifactSha256: DIGEST,
    createdAt: "2026-08-31T01:05:00.000Z",
    ...overrides,
  };
}

function pointer(overrides: Partial<CohortActivationPointer> = {}): CohortActivationPointer {
  return {
    pointerId: "pointer-1",
    pointerRevision: 1,
    changeKind: "activate",
    mode: "shadow",
    environment: "local",
    userCohort: "internal-owners",
    workflowIds: ["master-workspace"],
    templateIds: [...FIRST_CAPTURED_TEMPLATE_IDS],
    ledgerVersion: "ledger.2026-08-first-cohort.1",
    routingVersion: "routing.2026-08-pilot.1",
    previousPointerId: null,
    rollbackOfPointerId: null,
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("OpenAI-only route snapshots", () => {
  it("captures the four selected semantic route shapes", () => {
    const candidates: OpenAIRouteSnapshot[] = [
      route({
        semanticRoute: "fast",
        model: "gpt-5.6-luna",
        reasoningEffort: "low",
        timeoutMs: 15_000,
      }),
      route(),
      route({
        semanticRoute: "research",
        model: "gpt-5.6-terra",
        allowedTools: ["web_search", "file_search"],
      }),
      route({
        semanticRoute: "review",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
      }),
    ];

    for (const candidate of candidates) {
      expect(validateOpenAIRouteSnapshot(candidate)).toEqual([]);
    }
  });

  it("accepts a complete deep route and rejects runtime provider drift", () => {
    expect(validateOpenAIRouteSnapshot(route())).toEqual([]);
    expect(
      validateOpenAIRouteSnapshot({
        ...route(),
        provider: "anthropic",
      }).map((issue) => issue.code),
    ).toContain("active_provider_not_openai");
  });

  it("enforces route reasoning, privacy, and fast-only fallback", () => {
    const issues = validateOpenAIRouteSnapshot({
      ...route(),
      reasoningEffort: "high",
      store: true,
      fallback: {
        fromModel: "gpt-5.6-sol",
        reason: "capacity",
        evaluatedConfigurationVersion: "eval.1",
      },
    });

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalid_route_reasoning",
        "provider_storage_enabled",
        "fallback_not_fast_route",
      ]),
    );
  });

  it("preserves arbitrary historical provider provenance as readable data", () => {
    expect(
      validateHistoricalProviderProvenance({
        provider: "anthropic",
        model: "historical-model",
        providerOperationId: null,
        recordedAt: "2025-01-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("durable generation operation contract", () => {
  it("accepts a complete captured operation", () => {
    expect(validateDurableGenerationOperation(operation())).toEqual([]);
  });

  it("rejects non-cohort templates, overlapping sections, and retry drift", () => {
    const issues = validateDurableGenerationOperation({
      ...operation(),
      templateId: "cover-letter",
      safeSectionKeys: ["summary"],
      blockedSectionKeys: ["summary"],
      retryable: true,
    });

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "template_not_in_first_cohort",
        "section_partition_overlap",
        "retryability_mismatch",
      ]),
    );
  });

  it("requires ready-for-review operations to have no blocked sections", () => {
    expect(
      validateDurableGenerationOperation(
        operation({
          status: "ready_for_review",
          blockedSectionKeys: ["experience"],
        }),
      ).map((issue) => issue.code),
    ).toContain("ready_operation_has_blockers");
  });
});

describe("explicit section state and no-blank invariant", () => {
  it("accepts visible final content", () => {
    expect(validateCapturedSectionRevision(section())).toEqual([]);
  });

  it("rejects markup-only final content and required omission", () => {
    expect(
      validateCapturedSectionRevision(
        section({
          content: "<p><br></p>&nbsp;",
        }),
      ).map((issue) => issue.code),
    ).toContain("output_state_is_blank");

    expect(
      validateCapturedSectionRevision(
        section({
          state: "omitted_optional",
          content: null,
        }),
      ).map((issue) => issue.code),
    ).toContain("required_section_omitted");
  });

  it("requires durable blocker identity for blocked states", () => {
    expect(
      validateCapturedSectionRevision(
        section({
          state: "needs_clarification",
          content: null,
        }),
      ).map((issue) => issue.code),
    ).toContain("blocked_state_without_issue");
  });

  it("does not hide content behind an omitted state", () => {
    expect(
      validateCapturedSectionRevision(
        section({
          required: false,
          state: "omitted_optional",
          content: "Content that would otherwise be rendered",
        }),
      ).map((issue) => issue.code),
    ).toContain("omitted_section_has_content");
  });
});

describe("revision-bound approval and export", () => {
  it("accepts exact revision identities", () => {
    expect(validateRevisionBoundApproval(approval())).toEqual([]);
    expect(validateRevisionBoundExport(exportIdentity(), approval())).toEqual([]);
  });

  it("rejects an export that is not bound to the approval revision", () => {
    expect(
      validateRevisionBoundExport(
        exportIdentity({
          approvedRevision: 4,
        }),
        approval(),
      ).map((issue) => issue.code),
    ).toContain("export_approval_mismatch");
  });
});

describe("cohort activation and rollback pointers", () => {
  it("requires the exact ordered first cohort", () => {
    expect(validateCohortActivationPointer(pointer())).toEqual([]);
    expect(
      validateCohortActivationPointer(
        pointer({
          templateIds: ["resume"],
        }),
      ).map((issue) => issue.code),
    ).toContain("activation_cohort_mismatch");
  });

  it("accepts an immutable rollback successor and rejects broken ancestry", () => {
    const active = pointer({ mode: "captured" });
    const rollback = pointer({
      pointerId: "pointer-2",
      pointerRevision: 2,
      changeKind: "rollback",
      mode: "legacy",
      previousPointerId: active.pointerId,
      rollbackOfPointerId: active.pointerId,
      createdAt: "2026-08-31T02:00:00.000Z",
    });

    expect(validateCohortActivationTransition(active, rollback)).toEqual([]);
    expect(
      validateCohortActivationTransition(active, {
        ...rollback,
        previousPointerId: "another-pointer",
      }).map((issue) => issue.code),
    ).toContain("pointer_ancestry_mismatch");
  });
});
