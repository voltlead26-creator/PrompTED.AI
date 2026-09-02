// =====================================================
// PrompTED — render-export
//
// Server-side export pipeline. Re-validates the approval gate (never
// trusting the UI), renders the document, records export_history for
// signed-in users, and returns the artifact. The only activated format is an
// inspected PDF produced by the configured external HTML-to-PDF renderer.
//
// Rendering NEVER includes a section whose status is not 'approved'.
// =====================================================

import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { AuthError, guardRequest } from "../_shared/auth-guard.ts";
import { USER_SAFE_ERROR } from "../_shared/provider-router.ts";
import {
  approvedOnly,
  type BrandKit,
  buildExportHtml,
  type ExportSection,
  unapprovedRequired,
} from "./html-template.ts";
import { validateSection } from "../_shared/draft-validator.ts";
import {
  determinePlaceholderExportDecision,
  parseDocumentPlaceholderTokens,
  renderDocumentPlaceholderLabels,
  type UnresolvedDocumentPlaceholder,
} from "../_shared/document-placeholder-policy.ts";
import {
  capturedExportStoragePath,
  type CapturedPdfInspectionExpectation,
  classifyCapturedExportReceipt,
  classifyLegacyPdfExportReceipt,
  createCapturedPdfInspectionExpectation,
  createLegacyPdfExportBinding,
  createLegacyPdfExportInputIdentity,
  inspectCapturedPdfArtifact,
  inspectStoredCapturedPdfArtifact,
  type LegacyPdfExportBinding,
  type LegacyPdfExportInputIdentity,
  legacyPdfExportRpcBinding,
  type LegacyPdfExportTarget,
  ownedBuffer,
  reconcileCapturedExportCompletion,
  type RenderedPdfRequestResult,
  type RenderServiceContract,
  requestCapturedExportStorageObject,
  requestRenderedPdf,
  restoreLegacyPdfExportBinding,
  sha256Hex,
  validateCapturedExportStorageContract,
  validateLegacyExportRequestIdentity,
  validateRenderServiceContract,
} from "./captured-artifact.ts";
import { resolveExportFormat } from "./export-format-policy.ts";
import {
  type AuthoritativeBrandSnapshot,
  createCapturedBrandInspectionExpectation,
  parseAuthoritativeBrandSnapshot,
  resolveCapturedBrandLogoSource,
} from "./export-brand-snapshot.ts";
import {
  artifactBlockIsApproved,
  decideArtifactExport,
  decideDocumentExport,
  decideExportTarget,
} from "./export-authorization.ts";

interface ExportBody {
  request_id?: string;
  document_id?: string;
  artifact_id?: string;
  title?: string;
  format?: unknown;
  sections?: ExportSection[];
  brand_kit?: BrandKit | null;
  lede?: string;
  unresolved_placeholders?: UnresolvedDocumentPlaceholder[];
  placeholder_acknowledged?: boolean;
  /** Required only for captured documents; obtained from the immutable request RPC. */
  captured_export_id?: string;
  captured_operation_id?: string;
  captured_expected_operation_revision?: number;
}

interface AuthoritativeDocumentRow {
  id: string;
  title: string;
  status: string;
  ledger_binding_status: "legacy_unversioned" | "captured";
  current_revision: number;
  approved_revision: number | null;
  unresolved_placeholders: UnresolvedDocumentPlaceholder[] | null;
}

interface AuthoritativeArtifactRow {
  id: string;
  title: string;
  status: string;
  quality_status: string;
  current_revision: number;
  approved_revision: number | null;
}

interface AuthoritativeArtifactBlockRow {
  heading: string | null;
  payload: Record<string, unknown>;
  approval_status: string;
  revision: number;
  approved_revision: number | null;
  is_required: boolean | null;
  section_state: string | null;
  order_index: number;
  kind: string;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseDocumentExportSnapshot(value: unknown): {
  target: AuthoritativeDocumentRow;
  sections: ExportSection[];
  brandSnapshot: AuthoritativeBrandSnapshot;
} | null {
  const snapshot = objectRecord(value);
  const target = objectRecord(snapshot?.target);
  const sections = snapshot?.sections;
  const brandSnapshot = parseAuthoritativeBrandSnapshot(
    snapshot?.brand_snapshot,
  );
  if (
    snapshot?.target_kind !== "document" || !target || !brandSnapshot ||
    !Array.isArray(sections) || typeof target.id !== "string" ||
    typeof target.title !== "string" || typeof target.status !== "string" ||
    !["legacy_unversioned", "captured"].includes(
      String(target.ledger_binding_status ?? ""),
    ) || !Number.isInteger(target.current_revision) ||
    Number(target.current_revision) < 1 ||
    (target.approved_revision !== null &&
      (!Number.isInteger(target.approved_revision) ||
        Number(target.approved_revision) < 1)) ||
    (target.unresolved_placeholders !== null &&
      !Array.isArray(target.unresolved_placeholders))
  ) {
    return null;
  }
  const parsedSections: ExportSection[] = [];
  for (const value of sections) {
    const section = objectRecord(value);
    if (
      !section || typeof section.name !== "string" ||
      typeof section.content !== "string" ||
      typeof section.status !== "string" ||
      typeof section.is_required !== "boolean" ||
      !Number.isInteger(section.order_index)
    ) {
      return null;
    }
    parsedSections.push(section as unknown as ExportSection);
  }
  return {
    target: target as unknown as AuthoritativeDocumentRow,
    sections: parsedSections,
    brandSnapshot,
  };
}

function parseArtifactExportSnapshot(value: unknown): {
  target: AuthoritativeArtifactRow;
  blocks: AuthoritativeArtifactBlockRow[];
  brandSnapshot: AuthoritativeBrandSnapshot;
} | null {
  const snapshot = objectRecord(value);
  const target = objectRecord(snapshot?.target);
  const blocks = snapshot?.blocks;
  const brandSnapshot = parseAuthoritativeBrandSnapshot(
    snapshot?.brand_snapshot,
  );
  if (
    snapshot?.target_kind !== "artifact" || !target || !brandSnapshot ||
    !Array.isArray(blocks) || typeof target.id !== "string" ||
    typeof target.title !== "string" ||
    typeof target.status !== "string" ||
    typeof target.quality_status !== "string" ||
    !Number.isInteger(target.current_revision) ||
    Number(target.current_revision) < 1 ||
    (target.approved_revision !== null &&
      (!Number.isInteger(target.approved_revision) ||
        Number(target.approved_revision) < 1))
  ) {
    return null;
  }
  const parsedBlocks: AuthoritativeArtifactBlockRow[] = [];
  for (const value of blocks) {
    const block = objectRecord(value);
    if (
      !block || (block.heading !== null && typeof block.heading !== "string") ||
      !objectRecord(block.payload) ||
      typeof block.approval_status !== "string" ||
      !Number.isInteger(block.revision) || Number(block.revision) < 1 ||
      (block.approved_revision !== null &&
        (!Number.isInteger(block.approved_revision) ||
          Number(block.approved_revision) < 1)) ||
      (block.is_required !== null && typeof block.is_required !== "boolean") ||
      (block.section_state !== null &&
        typeof block.section_state !== "string") ||
      !Number.isInteger(block.order_index) || typeof block.kind !== "string"
    ) {
      return null;
    }
    parsedBlocks.push(block as unknown as AuthoritativeArtifactBlockRow);
  }
  return {
    target: target as unknown as AuthoritativeArtifactRow,
    blocks: parsedBlocks,
    brandSnapshot,
  };
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document"
  );
}

async function renderPdf(
  html: string,
  inspection: CapturedPdfInspectionExpectation | null,
  suppliedContract?: RenderServiceContract | null,
  dispatchLease?: { leaseExpiresAt: string },
): Promise<RenderedPdfRequestResult | { state: "unavailable" }> {
  const contract = suppliedContract === undefined
    ? configuredRenderServiceContract()
    : suppliedContract;
  if (!contract) return { state: "unavailable" };
  return await requestRenderedPdf(
    contract,
    {
      html,
      ...(inspection
        ? {
          inspection: {
            version: inspection.version,
            expected_content_sha256: inspection.contentSha256,
            expected_section_order_sha256: inspection.sectionOrderSha256,
            expected_document: inspection.source,
          },
        }
        : {}),
      ...(inspection?.brand
        ? {
          expected_brand: {
            snapshot_version: inspection.brand.snapshotVersion,
            snapshot_sha256: inspection.brand.snapshotSha256,
            brand_present: inspection.brand.brandPresent,
            logo_storage_path: inspection.brand.logoStoragePath,
            logo_content_sha256: inspection.brand.logoContentSha256,
            logo_media_type: inspection.brand.logoMediaType,
            logo_byte_length: inspection.brand.logoByteLength,
            footer_sha256: inspection.brand.footerSha256,
            primary_colour: inspection.brand.primaryColour,
            secondary_colour: inspection.brand.secondaryColour,
            brand_evidence_sha256: inspection.brand.brandEvidenceSha256,
          },
        }
        : {}),
    },
    fetch,
    dispatchLease,
  );
}

function configuredRenderServiceContract(): RenderServiceContract | null {
  try {
    return validateRenderServiceContract({
      serviceUrl: Deno.env.get("RENDER_SERVICE_URL"),
      allowedOrigin: Deno.env.get("RENDER_SERVICE_ALLOWED_ORIGIN"),
      timeoutMs: Deno.env.get("RENDER_SERVICE_TIMEOUT_MS"),
      maxResponseBytes: Deno.env.get("RENDER_SERVICE_MAX_BYTES"),
    });
  } catch {
    return null;
  }
}

function capturedStorageContract() {
  return validateCapturedExportStorageContract({
    baseUrl: Deno.env.get("SUPABASE_URL"),
    serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    timeoutMs: Deno.env.get("PRIVATE_STORAGE_REQUEST_TIMEOUT_MS"),
  });
}

function legacyPdfResponse(
  bytes: Uint8Array,
  filename: string,
  approvedSections: number,
  origin: string | null,
): Response {
  return new Response(ownedBuffer(bytes), {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Approved-Sections": String(approvedSections),
    },
  });
}

function uuid(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
    ? candidate
    : null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(
      { error: { message: "Method not allowed" } },
      405,
      origin,
    );
  }

  // Export supports guest workspaces. Signed-in exports are recorded below.
  let auth;
  try {
    auth = await guardRequest(req, { enforceCap: false });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse(err.payload, err.status, origin);
    }
    return jsonResponse(USER_SAFE_ERROR, 500, origin);
  }

  // The shared guard performs the one bounded, structurally validated parse.
  // Re-reading the original stream here would duplicate memory and bypass that
  // admission contract.
  const body = (auth.body ?? {}) as ExportBody;

  const formatDecision = resolveExportFormat(body.format);
  if (!formatDecision.ok) {
    return jsonResponse(
      {
        error: {
          code: formatDecision.code,
          message: formatDecision.message,
        },
        retryable: false,
      },
      formatDecision.status,
      origin,
    );
  }
  const format = formatDecision.format;
  let title = String(body.title ?? "Document").slice(0, 200);
  let sections = Array.isArray(body.sections) ? body.sections : [];
  let capturedDocument: AuthoritativeDocumentRow | null = null;
  let legacyTarget: LegacyPdfExportTarget | null = null;
  const targetDecision = decideExportTarget(body.document_id, body.artifact_id);
  if (!targetDecision.ok) {
    return jsonResponse(
      {
        error: {
          code: targetDecision.code,
          message: targetDecision.code === "EXPORT_TARGET_REQUIRED"
            ? "Save and approve this document before exporting."
            : "Choose either a document or an artifact to export.",
        },
      },
      targetDecision.code === "EXPORT_TARGET_REQUIRED" ? 409 : 400,
      origin,
    );
  }

  // Export presentation is derived only from the authoritative target. These
  // legacy caller fields remain parseable for wire compatibility but cannot
  // append unapproved wording or branding to a revision-bound artifact.
  let authoritativeBrandKit: BrandKit | null = null;
  let capturedBrandSnapshot: AuthoritativeBrandSnapshot | null = null;
  let capturedBrandLogoSource: string | null | undefined = undefined;
  const authoritativeLede: string | null = null;

  // A signed-in document export always reloads the authoritative persisted
  // revision and ignores caller-supplied replacement wording.
  if (body.document_id) {
    const documentId = uuid(body.document_id);
    if (!documentId) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_DOCUMENT_INVALID",
            message: "The document reference is invalid.",
          },
        },
        400,
        origin,
      );
    }
    const { data: snapshotData, error: snapshotError } = await auth.admin.rpc(
      "load_legacy_export_snapshot",
      {
        p_user_id: auth.userId,
        p_document_id: documentId,
        p_artifact_id: null,
      },
    );
    if (snapshotError) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_DOCUMENT_UNAVAILABLE",
            message: "The approved revision could not be loaded.",
          },
        },
        503,
        origin,
      );
    }
    if (snapshotData === null) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_DOCUMENT_NOT_FOUND",
            message: "That document is unavailable for this account.",
          },
        },
        404,
        origin,
      );
    }
    const snapshot = parseDocumentExportSnapshot(snapshotData);
    if (!snapshot) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_DOCUMENT_UNAVAILABLE",
            message: "The approved revision could not be loaded.",
          },
        },
        503,
        origin,
      );
    }
    const authoritative = snapshot.target;
    title = authoritative.title;
    sections = snapshot.sections;
    if (authoritative.ledger_binding_status === "legacy_unversioned") {
      authoritativeBrandKit = snapshot.brandSnapshot.brandKit;
    }
    body.unresolved_placeholders = authoritative.unresolved_placeholders ?? [];
    legacyTarget = {
      kind: "document",
      id: authoritative.id,
      currentRevision: authoritative.current_revision,
      approvedRevision: authoritative.approved_revision,
    };

    const approvalDecision = decideDocumentExport(authoritative);
    if (!approvalDecision.ok) {
      return jsonResponse(
        {
          error: {
            code: authoritative.ledger_binding_status === "captured"
              ? "CAPTURED_EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL"
              : approvalDecision.code,
            message: "Approve the exact current revision before exporting.",
          },
        },
        409,
        origin,
      );
    }

    if (authoritative.ledger_binding_status === "captured") {
      capturedDocument = authoritative;
      if (
        !uuid(body.captured_export_id) ||
        !uuid(body.captured_operation_id) ||
        !Number.isInteger(body.captured_expected_operation_revision) ||
        Number(body.captured_expected_operation_revision) < 1
      ) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_REQUEST_REQUIRED",
              message:
                "Record the revision-bound export request before rendering.",
            },
          },
          409,
          origin,
        );
      }
    }
  }

  if (body.artifact_id) {
    const artifactId = uuid(body.artifact_id);
    if (!artifactId) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_ARTIFACT_INVALID",
            message: "The artifact reference is invalid.",
          },
        },
        400,
        origin,
      );
    }
    const { data: snapshotData, error: snapshotError } = await auth.admin.rpc(
      "load_legacy_export_snapshot",
      {
        p_user_id: auth.userId,
        p_document_id: null,
        p_artifact_id: artifactId,
      },
    );
    if (snapshotError) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_ARTIFACT_UNAVAILABLE",
            message: "The approved artifact revision could not be loaded.",
          },
        },
        503,
        origin,
      );
    }
    if (snapshotData === null) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_GATE",
            message: "This output is not ready to export.",
          },
        },
        400,
        origin,
      );
    }
    const snapshot = parseArtifactExportSnapshot(snapshotData);
    if (!snapshot) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_ARTIFACT_UNAVAILABLE",
            message: "The approved artifact revision could not be loaded.",
          },
        },
        503,
        origin,
      );
    }
    const authoritativeArtifact = snapshot.target;
    authoritativeBrandKit = snapshot.brandSnapshot.brandKit;
    const artifactApproval = decideArtifactExport(
      authoritativeArtifact,
      snapshot.blocks,
    );
    if (!artifactApproval.ok) {
      return jsonResponse(
        {
          error: {
            code: artifactApproval.code,
            message:
              "Approve the exact current artifact revision before exporting.",
            unapproved: artifactApproval.unapproved,
          },
        },
        409,
        origin,
      );
    }
    title = authoritativeArtifact.title;
    sections = snapshot.blocks
      .filter((block) =>
        block.is_required !== false || artifactBlockIsApproved(block)
      )
      .map((block) => {
        const payload = block.payload;
        const actionText = block.kind === "action"
          ? [
            String(payload.objective ?? ""),
            ...((payload.instructions as string[] | undefined) ?? []).map((
              value,
              index,
            ) => `${index + 1}. ${value}`),
            ...((payload.included_materials as
              | Array<{ label?: string; content?: string }>
              | undefined) ?? [])
              .map((material) =>
                `${material.label ?? "Included material"}:\n${
                  material.content ?? ""
                }`
              ),
            `Finished when:\n${
              ((payload.completion_criteria as string[] | undefined) ?? []).map(
                (
                  value,
                ) => `- ${value}`,
              ).join("\n")
            }`,
          ].filter(Boolean).join("\n\n")
          : String(payload.content ?? payload.summary ?? "");
        return {
          name: block.heading || String(payload.title ?? "Section"),
          content: actionText,
          is_required: block.is_required !== false,
          status: artifactBlockIsApproved(block) ? "approved" : "draft",
          order_index: block.order_index,
        };
      });
    legacyTarget = {
      kind: "artifact",
      id: authoritativeArtifact.id,
      currentRevision: authoritativeArtifact.current_revision,
      approvedRevision: authoritativeArtifact.approved_revision,
    };
  }

  if (!legacyTarget) {
    return jsonResponse(
      {
        error: {
          code: "EXPORT_TARGET_UNAVAILABLE",
          message: "The authoritative export target could not be loaded.",
        },
      },
      503,
      origin,
    );
  }
  const authoritativeTarget = legacyTarget;

  if (
    capturedDocument === null &&
    authoritativeBrandKit?.logo_status === "reconciliation_required"
  ) {
    return jsonResponse(
      {
        error: {
          code: "BRAND_KIT_RECONCILIATION_REQUIRED",
          message:
            "The business logo is still being reconciled. Retry after the brand save is complete.",
        },
        retryable: true,
      },
      409,
      origin,
    );
  }

  // Only an authoritatively loaded captured document receives the captured
  // identity contract. Caller-supplied captured_* fields cannot exempt a
  // legacy export from binding an explicit body request_id to both headers.
  if (
    !validateLegacyExportRequestIdentity({
      captured: capturedDocument !== null,
      bodyRequestId: body.request_id,
      idempotencyHeader: req.headers.get("x-idempotency-key"),
      requestHeader: req.headers.get("x-request-id"),
    })
  ) {
    return jsonResponse(
      {
        error: {
          code: "EXPORT_REQUEST_IDENTITY_MISMATCH",
          message:
            "The export request identity does not match both request headers.",
        },
      },
      409,
      origin,
    );
  }

  const unresolvedPlaceholders = Array.isArray(body.unresolved_placeholders)
    ? body.unresolved_placeholders
    : [];
  const tokensInDocument = sections.flatMap((section) =>
    parseDocumentPlaceholderTokens(section.content)
  );
  if (tokensInDocument.length > 0) {
    const metadataIds = new Set(unresolvedPlaceholders.map((item) => item.id));
    const missingMetadata = tokensInDocument.filter((token) =>
      !metadataIds.has(token.id)
    );
    if (missingMetadata.length > 0) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_PLACEHOLDER_METADATA_MISSING",
            message:
              "This document contains unresolved details that could not be verified for export.",
            placeholder_ids: missingMetadata.map((token) => token.id),
          },
        },
        409,
        origin,
      );
    }
  }

  const placeholderDecision = determinePlaceholderExportDecision(
    unresolvedPlaceholders,
  );
  if (
    placeholderDecision.status === "acknowledgement_required" &&
    body.placeholder_acknowledged !== true
  ) {
    return jsonResponse(
      {
        error: {
          code: "EXPORT_PLACEHOLDER_ACK_REQUIRED",
          message:
            "This document still contains required unresolved details. Explicit acknowledgement is required before export.",
          counts: placeholderDecision.counts,
        },
      },
      409,
      origin,
    );
  }

  // Export renders the visible placeholder label, never the raw internal token.
  if (tokensInDocument.length > 0) {
    sections = sections.map((section) => ({
      ...section,
      content: renderDocumentPlaceholderLabels(section.content),
    }));
  }

  // ---- Server-side approval gate (defence in depth) ----
  {
    const missing = unapprovedRequired(sections);
    if (sections.length === 0 || missing.length > 0) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_GATE",
            message: "All required sections must be approved before export.",
            unapproved: missing,
          },
        },
        400,
        origin,
      );
    }
  }

  {
    const notFinal = sections
      .filter((s) => s.status === "approved")
      .filter((s) => validateSection({ content: s.content }).length > 0)
      .map((s) => s.name);
    if (notFinal.length > 0) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_NOT_FINAL",
            message:
              "Some sections still contain draft or placeholder text. Ask TED to finish them, then try again.",
            sections: notFinal,
          },
        },
        400,
        origin,
      );
    }
  }

  const filenameStem = slugify(title);
  const legacyExactRequestId = capturedDocument === null && format === "pdf" &&
      body.request_id !== undefined
    ? uuid(body.request_id)
    : null;
  let payload: ArrayBuffer | string;
  let contentType: string;
  let filename: string;
  let renderedPdf: { bytes: Uint8Array; headers: Headers } | null = null;
  let legacyExactBinding: LegacyPdfExportBinding | null = null;
  let legacyRenderContract: RenderServiceContract | null = null;
  let capturedInspectionExpectation: CapturedPdfInspectionExpectation | null =
    null;

  if (capturedDocument) {
    const exportId = uuid(body.captured_export_id)!;
    const operationId = uuid(body.captured_operation_id)!;
    const replayFilename = filenameStem + ".pdf";
    const replayStoragePath = capturedExportStoragePath(
      auth.userId,
      exportId,
      replayFilename,
    );
    const { data: replayReceiptData, error: replayReceiptError } = await auth
      .admin.rpc("get_captured_document_export_receipt", {
        p_user_id: auth.userId,
        p_export_id: exportId,
        p_operation_id: operationId,
      });
    if (replayReceiptError) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_RECEIPT_UNAVAILABLE",
            message: "The durable export receipt could not be loaded safely.",
          },
        },
        503,
        origin,
      );
    }

    const receiptRecord = objectRecord(replayReceiptData);
    capturedBrandSnapshot = parseAuthoritativeBrandSnapshot(
      receiptRecord?.brand_snapshot,
    );
    if (!capturedBrandSnapshot) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_BRAND_SNAPSHOT_INVALID",
            message:
              "The durable export branding did not match this exact request.",
          },
        },
        503,
        origin,
      );
    }
    authoritativeBrandKit = capturedBrandSnapshot.brandKit;
    if (authoritativeBrandKit?.logo_status === "reconciliation_required") {
      return jsonResponse(
        {
          error: {
            code: "BRAND_KIT_RECONCILIATION_REQUIRED",
            message:
              "The business logo is still being reconciled. Retry after the brand save is complete.",
          },
          retryable: true,
        },
        409,
        origin,
      );
    }
    try {
      const brandExpectation = await createCapturedBrandInspectionExpectation(
        capturedBrandSnapshot,
      );
      capturedInspectionExpectation =
        await createCapturedPdfInspectionExpectation(
          title,
          approvedOnly(sections),
          brandExpectation ?? undefined,
        );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return jsonResponse(
        {
          error: {
            code: code === "CAPTURED_EXPORT_BRAND_LOGO_UNVERIFIED"
              ? code
              : "CAPTURED_EXPORT_BRAND_SNAPSHOT_INVALID",
            message: code === "CAPTURED_EXPORT_BRAND_LOGO_UNVERIFIED"
              ? "Replace or remove the legacy logo before creating a captured export."
              : "The durable export branding did not form a valid inspection identity.",
          },
          retryable: false,
        },
        409,
        origin,
      );
    }

    let replayReceipt;
    try {
      replayReceipt = classifyCapturedExportReceipt(replayReceiptData, {
        exportId,
        operationId,
        storagePath: replayStoragePath,
        inspectionExpectation: capturedInspectionExpectation,
      });
    } catch {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_RECEIPT_INVALID",
            message:
              "The durable export receipt did not match this approved export.",
          },
        },
        503,
        origin,
      );
    }
    if (replayReceipt.state === "processing") {
      const response = jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_RENDER_PROCESSING",
            message: "This exact export is already being created.",
          },
          retryable: true,
          retry_after_seconds: replayReceipt.retryAfterSeconds,
        },
        409,
        origin,
      );
      response.headers.set(
        "Retry-After",
        String(replayReceipt.retryAfterSeconds),
      );
      return response;
    }
    if (replayReceipt.state === "storage_recovery") {
      let storedBytes: Uint8Array | null = null;
      try {
        const storage = capturedStorageContract();
        storedBytes = await requestCapturedExportStorageObject({
          ...storage,
          bucket: "captured-exports",
          path: replayReceipt.storagePath,
          method: "GET",
          maximumResponseBytes: storage.maxResponseBytes,
          signal: req.signal,
        });
      } catch {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_RECOVERY_STORAGE_UNAVAILABLE",
              message:
                "The retained export could not be read right now. Retry this exact export without creating a new one.",
            },
            retryable: true,
          },
          503,
          origin,
        );
      }
      if (!storedBytes) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_RECOVERY_ARTIFACT_MISSING",
              message:
                "The durable recovery receipt points to a missing artifact. The export will not be rendered again automatically.",
            },
            retryable: false,
          },
          409,
          origin,
        );
      }
      const replayInspection = await inspectStoredCapturedPdfArtifact(
        storedBytes,
        replayReceipt.artifactSha256,
        replayReceipt.artifactValidationResult,
        capturedInspectionExpectation,
      );
      if (
        storedBytes.byteLength !== replayReceipt.artifactByteLength ||
        !replayInspection.passed || !replayInspection.artifactInspected
      ) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_RECOVERY_INSPECTION_FAILED",
              message:
                "The retained export did not match its immutable SHA, length, document, section-order, and brand evidence.",
            },
            retryable: false,
          },
          409,
          origin,
        );
      }
      if (
        replayReceipt.storageState === "dispatched" &&
        replayReceipt.storageDispatchToken
      ) {
        const storagePathSha256 = await sha256Hex(
          new TextEncoder().encode(replayReceipt.storagePath),
        );
        const { error } = await auth.admin.rpc(
          "complete_user_storage_dispatch",
          {
            p_user_id: auth.userId,
            p_operation_id: exportId,
            p_dispatch_kind: "captured-export",
            p_storage_path_sha256: storagePathSha256,
            p_artifact_sha256: replayReceipt.artifactSha256,
            p_dispatch_token: replayReceipt.storageDispatchToken,
          },
        );
        if (error) {
          return jsonResponse(
            {
              error: {
                code: "CAPTURED_EXPORT_STORAGE_ACK_UNRESOLVED",
                message:
                  "The exact retained export was verified, but its Storage acknowledgement remains unresolved.",
              },
              retryable: true,
            },
            503,
            origin,
          );
        }
      }
      const completion = await reconcileCapturedExportCompletion(
        async () => {
          const { data, error } = await auth.admin.rpc(
            "complete_captured_document_export",
            {
              p_export_id: exportId,
              p_operation_id: operationId,
              p_expected_operation_revision:
                replayReceipt.expectedOperationRevision,
              p_storage_path: replayReceipt.storagePath,
              p_artifact_sha256: replayReceipt.artifactSha256,
              p_renderer_version: replayReceipt.rendererVersion,
              p_artifact_validation_result:
                replayReceipt.artifactValidationResult,
            },
          );
          return { data, error };
        },
        {
          exportId,
          operationId,
          storagePath: replayReceipt.storagePath,
          artifactSha256: replayReceipt.artifactSha256,
          rendererVersion: replayReceipt.rendererVersion,
        },
      );
      if (!completion.completed) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_FINALIZATION_FAILED",
              message:
                "The retained export is intact, but its durable completion still could not be confirmed.",
            },
            retryable: true,
          },
          503,
          origin,
        );
      }
      return new Response(ownedBuffer(storedBytes), {
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="' + replayFilename +
            '"',
          "X-Approved-Sections": String(approvedOnly(sections).length),
          "X-Captured-Export-Id": exportId,
        },
      });
    }
    if (replayReceipt.state === "reconciliation_required") {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_RECONCILIATION_REQUIRED",
            message:
              "This export has an earlier ambiguous render or storage attempt and will not be repeated until reconciled.",
          },
          retryable: false,
        },
        409,
        origin,
      );
    }
    if (replayReceipt.state === "completed") {
      let storedBytes: Uint8Array;
      try {
        const storage = capturedStorageContract();
        const downloaded = await requestCapturedExportStorageObject({
          ...storage,
          bucket: "captured-exports",
          path: replayReceipt.storagePath,
          method: "GET",
          maximumResponseBytes: storage.maxResponseBytes,
          signal: req.signal,
        });
        if (!downloaded) throw new Error("CAPTURED_EXPORT_REPLAY_MISSING");
        storedBytes = downloaded;
      } catch {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_REPLAY_STORAGE_UNAVAILABLE",
              message:
                "The completed export receipt exists, but its stored artifact could not be loaded.",
            },
          },
          503,
          origin,
        );
      }
      const replayInspection = await inspectStoredCapturedPdfArtifact(
        storedBytes,
        replayReceipt.artifactSha256,
        replayReceipt.artifactValidationResult,
        capturedInspectionExpectation,
      );
      if (!replayInspection.passed || !replayInspection.artifactInspected) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_ARTIFACT_INSPECTION_FAILED",
              message:
                "The stored export did not match its approved content, section order, PDF evidence, and SHA-256 receipt.",
            },
          },
          502,
          origin,
        );
      }
      return new Response(ownedBuffer(storedBytes), {
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="' + replayFilename +
            '"',
          "X-Approved-Sections": String(approvedOnly(sections).length),
          "X-Captured-Export-Id": exportId,
        },
      });
    }
    try {
      capturedBrandLogoSource = await resolveCapturedBrandLogoSource(
        capturedBrandSnapshot,
        async (path) => {
          const { data, error } = await auth.admin.storage.from("assets")
            .download(path);
          if (error || !data) {
            const status = Number(
              (error as { statusCode?: unknown } | null)?.statusCode ?? 0,
            );
            const message = String(
              (error as { message?: unknown } | null)?.message ?? "",
            );
            if (
              (status === 400 || status === 404) &&
              /not found|does not exist/i.test(message)
            ) return null;
            throw new Error("CAPTURED_EXPORT_BRAND_STORAGE_UNAVAILABLE");
          }
          return new Uint8Array(await data.arrayBuffer());
        },
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const retryable = code === "CAPTURED_EXPORT_BRAND_STORAGE_UNAVAILABLE";
      return jsonResponse(
        {
          error: {
            code: retryable
              ? code
              : code === "CAPTURED_EXPORT_BRAND_LOGO_MISMATCH"
              ? code
              : "CAPTURED_EXPORT_BRAND_LOGO_UNAVAILABLE",
            message: retryable
              ? "The frozen logo could not be read right now. Retry this exact export."
              : code === "CAPTURED_EXPORT_BRAND_LOGO_MISMATCH"
              ? "The frozen logo bytes no longer match the admitted brand snapshot."
              : "The frozen logo object is unavailable, so this export cannot be reproduced safely.",
          },
          retryable,
        },
        retryable ? 503 : 409,
        origin,
      );
    }
  }

  const html = buildExportHtml(
    title,
    sections,
    authoritativeBrandKit,
    authoritativeLede ?? undefined,
    Deno.env.get("SUPABASE_URL"),
    capturedDocument ? capturedBrandLogoSource ?? null : undefined,
  );
  if (legacyExactRequestId) {
    const replayFilename = `${filenameStem}.pdf`;
    let inputIdentity: LegacyPdfExportInputIdentity;
    try {
      inputIdentity = await createLegacyPdfExportInputIdentity({
        ownerUserId: auth.userId,
        requestId: legacyExactRequestId,
        target: authoritativeTarget,
        title,
        sections: approvedOnly(sections),
        brandKit: authoritativeBrandKit,
        lede: authoritativeLede,
        html,
        filename: replayFilename,
      });
    } catch {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_BINDING_INVALID",
            message: "The exact PDF export identity could not be created.",
          },
        },
        409,
        origin,
      );
    }

    const { data: storedBindingData, error: storedBindingError } = await auth
      .admin.rpc("get_legacy_pdf_export_binding", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
      });
    if (storedBindingError) {
      const deletionFenced = String(storedBindingError.message ?? "")
        .includes("ACCOUNT_DELETION_FENCED");
      return jsonResponse(
        {
          error: {
            code: deletionFenced
              ? "ACCOUNT_DELETION_FENCED"
              : "LEGACY_PDF_EXPORT_RECEIPT_UNAVAILABLE",
            message: deletionFenced
              ? "Account deletion has started; this export cannot continue."
              : "The exact PDF export receipt could not be loaded safely.",
          },
        },
        deletionFenced ? 409 : 503,
        origin,
      );
    }
    let storedBinding: LegacyPdfExportBinding | null;
    try {
      storedBinding = await restoreLegacyPdfExportBinding(
        storedBindingData,
        inputIdentity,
      );
    } catch (error) {
      return jsonResponse(
        {
          error: {
            code: String((error as Error).message).includes("CONFLICT")
              ? "LEGACY_PDF_EXPORT_REQUEST_CONFLICT"
              : "LEGACY_PDF_EXPORT_RECEIPT_INVALID",
            message:
              "This request UUID does not match the exact legacy PDF input and receipt.",
          },
        },
        409,
        origin,
      );
    }

    if (storedBinding) {
      legacyExactBinding = storedBinding;
    } else {
      legacyRenderContract = configuredRenderServiceContract();
      if (!legacyRenderContract) {
        return jsonResponse(
          {
            error: {
              code: "LEGACY_PDF_RENDERER_UNAVAILABLE",
              message:
                "The inspected PDF renderer is unavailable. No export was recorded.",
            },
          },
          503,
          origin,
        );
      }
      legacyExactBinding = await createLegacyPdfExportBinding({
        ownerUserId: auth.userId,
        requestId: legacyExactRequestId,
        target: authoritativeTarget,
        title,
        sections: approvedOnly(sections),
        brandKit: authoritativeBrandKit,
        lede: authoritativeLede,
        html,
        filename: replayFilename,
        renderContract: legacyRenderContract,
      });
    }

    const { data: legacyReceiptData, error: legacyReceiptError } = await auth
      .admin.rpc("claim_persisted_pdf_export", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
        p_binding: legacyPdfExportRpcBinding(legacyExactBinding),
      });
    if (legacyReceiptError) {
      const message = String(legacyReceiptError.message ?? "");
      return jsonResponse(
        {
          error: {
            code: message.includes("ACCOUNT_DELETION_FENCED")
              ? "ACCOUNT_DELETION_FENCED"
              : message.includes("BINDING_CONFLICT")
              ? "LEGACY_PDF_EXPORT_REQUEST_CONFLICT"
              : "LEGACY_PDF_EXPORT_RECEIPT_UNAVAILABLE",
            message: message.includes("ACCOUNT_DELETION_FENCED")
              ? "Account deletion has started; this export cannot continue."
              : "The exact PDF request could not be admitted safely.",
          },
        },
        message.includes("ACCOUNT_DELETION_FENCED") ? 409 : 503,
        origin,
      );
    }
    let legacyReceipt;
    try {
      legacyReceipt = classifyLegacyPdfExportReceipt(legacyReceiptData, {
        requestId: legacyExactRequestId,
        bindingSha256: legacyExactBinding.bindingSha256,
        storagePath: legacyExactBinding.storagePath,
      });
    } catch {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_RECEIPT_INVALID",
            message:
              "The exact PDF receipt did not match this authoritative input.",
          },
        },
        503,
        origin,
      );
    }
    if (legacyReceipt.state === "processing") {
      const response = jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_PROCESSING",
            message: "This exact PDF export is already being created.",
          },
          retryable: true,
          retry_after_seconds: legacyReceipt.retryAfterSeconds,
        },
        409,
        origin,
      );
      response.headers.set(
        "Retry-After",
        String(legacyReceipt.retryAfterSeconds),
      );
      return response;
    }
    if (legacyReceipt.state === "reconciliation_required") {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED",
            message:
              "An earlier PDF render or storage attempt cannot be repeated until it is reconciled.",
          },
          retryable: false,
        },
        409,
        origin,
      );
    }
    if (
      legacyReceipt.state === "completed" ||
      legacyReceipt.state === "storage_recovery"
    ) {
      let storedBytes: Uint8Array | null = null;
      try {
        const storage = capturedStorageContract();
        storedBytes = await requestCapturedExportStorageObject({
          ...storage,
          bucket: "captured-exports",
          path: legacyReceipt.storagePath,
          method: "GET",
          maximumResponseBytes: storage.maxResponseBytes,
        });
      } catch {
        return jsonResponse(
          {
            error: {
              code: "LEGACY_PDF_EXPORT_STORAGE_READ_UNAVAILABLE",
              message:
                "The exact stored PDF could not be read right now. Retry this UUID without recreating it.",
            },
            retryable: true,
          },
          503,
          origin,
        );
      }
      const markReconciliation = async (code: string) => {
        await auth.admin.rpc("mark_legacy_pdf_export_reconciliation", {
          p_user_id: auth.userId,
          p_request_id: legacyExactRequestId,
          p_binding_sha256: legacyExactBinding!.bindingSha256,
          p_reconciliation_code: code,
        });
      };
      if (storedBytes === null) {
        await markReconciliation("storage_object_unavailable");
        return jsonResponse(
          {
            error: {
              code: "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED",
              message:
                "The exact stored PDF could not be verified and will not be recreated.",
            },
            retryable: false,
          },
          409,
          origin,
        );
      }
      const replayInspection = await inspectStoredCapturedPdfArtifact(
        storedBytes,
        legacyReceipt.artifactSha256,
        legacyReceipt.artifactValidationResult,
        legacyExactBinding.inspectionExpectation,
      );
      if (
        !replayInspection.passed || !replayInspection.artifactInspected ||
        storedBytes.byteLength !== legacyReceipt.artifactByteLength
      ) {
        await markReconciliation("stored_artifact_mismatch");
        return jsonResponse(
          {
            error: {
              code: "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED",
              message:
                "The stored PDF failed its SHA, length, content, structure, or order inspection.",
            },
            retryable: false,
          },
          409,
          origin,
        );
      }
      if (
        legacyReceipt.state === "storage_recovery" &&
        legacyReceipt.storageState === "dispatched"
      ) {
        const { error } = await auth.admin.rpc(
          "complete_user_storage_dispatch",
          {
            p_user_id: auth.userId,
            p_operation_id: legacyExactRequestId,
            p_dispatch_kind: "legacy-export",
            p_storage_path_sha256: legacyExactBinding.storagePathSha256,
            p_artifact_sha256: legacyReceipt.artifactSha256,
            p_dispatch_token: legacyReceipt.storageDispatchToken,
          },
        );
        if (error) {
          return jsonResponse(
            {
              error: {
                code: "LEGACY_PDF_EXPORT_STORAGE_ACK_UNRESOLVED",
                message:
                  "The exact stored PDF was verified, but its durable acknowledgement remains unresolved.",
              },
            },
            503,
            origin,
          );
        }
      }
      if (legacyReceipt.state === "storage_recovery") {
        let completionData: unknown = null;
        let completionError: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await auth.admin.rpc(
            "complete_legacy_pdf_export",
            {
              p_user_id: auth.userId,
              p_request_id: legacyExactRequestId,
              p_binding_sha256: legacyExactBinding.bindingSha256,
            },
          );
          completionData = result.data;
          completionError = result.error;
          if (!result.error) break;
        }
        if (completionError) {
          return jsonResponse(
            {
              error: {
                code: "LEGACY_PDF_EXPORT_FINALIZATION_UNRESOLVED",
                message:
                  "The exact artifact was retained; completion can be reconciled safely by retrying this UUID.",
              },
            },
            503,
            origin,
          );
        }
        try {
          const completionReceipt = classifyLegacyPdfExportReceipt(
            completionData,
            {
              requestId: legacyExactRequestId,
              bindingSha256: legacyExactBinding.bindingSha256,
              storagePath: legacyExactBinding.storagePath,
            },
          );
          if (completionReceipt.state !== "completed") {
            throw new Error("LEGACY_PDF_EXPORT_COMPLETION_INVALID");
          }
        } catch {
          return jsonResponse(
            {
              error: {
                code: "LEGACY_PDF_EXPORT_FINALIZATION_UNRESOLVED",
                message:
                  "The exact artifact was retained, but completion was not confirmed.",
              },
            },
            503,
            origin,
          );
        }
      }
      return legacyPdfResponse(
        storedBytes,
        replayFilename,
        approvedOnly(sections).length,
        origin,
      );
    }

    legacyRenderContract = configuredRenderServiceContract();
    if (!legacyRenderContract) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_RENDERER_UNAVAILABLE",
            message:
              "The inspected PDF renderer is unavailable. No export was recorded.",
          },
        },
        503,
        origin,
      );
    }
    const currentBinding = await createLegacyPdfExportBinding({
      ownerUserId: auth.userId,
      requestId: legacyExactRequestId,
      target: authoritativeTarget,
      title,
      sections: approvedOnly(sections),
      brandKit: authoritativeBrandKit,
      lede: authoritativeLede,
      html,
      filename: replayFilename,
      renderContract: legacyRenderContract,
    });
    if (currentBinding.bindingSha256 !== legacyExactBinding.bindingSha256) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_RENDERER_POLICY_CONFLICT",
            message:
              "This request UUID is bound to a different renderer policy. Start a deliberate new export.",
          },
        },
        409,
        origin,
      );
    }
  }

  let renderDispatch:
    | { resourceSha256: string; token: string; leaseExpiresAt: string }
    | null = null;
  {
    const operationId = capturedDocument
      ? uuid(body.captured_operation_id)!
      : null;
    const exportId = capturedDocument ? uuid(body.captured_export_id)! : null;
    const htmlSha256 = await sha256Hex(new TextEncoder().encode(html));
    const identity = capturedDocument
      ? `captured-render:${operationId}:${exportId}`
      : `legacy-render:${auth.generationRequestId ?? htmlSha256}:${htmlSha256}`;
    const resourceSha256 = legacyExactBinding
      ? legacyExactBinding.rendererResourceSha256
      : await sha256Hex(new TextEncoder().encode(identity));
    const token = crypto.randomUUID();
    let admitted = false;
    let leaseExpiresAt: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.admin.rpc(
        "claim_user_external_egress",
        {
          p_user_id: auth.userId,
          p_egress_kind: "render-service",
          p_egress_route: "pdf",
          p_resource_sha256: resourceSha256,
          p_dispatch_token: token,
        },
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        !error && receipt?.egress_permitted === true &&
        receipt.dispatch_token === token &&
        typeof receipt.lease_expires_at === "string" &&
        receipt.lease_expires_at.length <= 64 &&
        Number.isFinite(Date.parse(receipt.lease_expires_at))
      ) {
        admitted = true;
        leaseExpiresAt = receipt.lease_expires_at;
        break;
      }
      if (
        String(error?.message ?? "").includes("ACCOUNT_DELETION_FENCED")
      ) {
        return jsonResponse(
          {
            error: {
              code: "ACCOUNT_DELETION_FENCED",
              message:
                "Account deletion has started; this export cannot be rendered.",
            },
          },
          409,
          origin,
        );
      }
      if (!error && receipt?.egress_permitted === false) {
        const egressOutcome = String(receipt.outcome ?? "");
        if (
          egressOutcome === "completed" ||
          egressOutcome === "reconciliation_required"
        ) {
          return jsonResponse(
            {
              error: {
                code: legacyExactBinding
                  ? "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED"
                  : "CAPTURED_EXPORT_RENDER_RECONCILIATION_REQUIRED",
                message:
                  "An earlier renderer request may have completed without a recoverable artifact and will not be sent again.",
              },
              retryable: false,
            },
            409,
            origin,
          );
        }
        const processingResponse = jsonResponse(
          {
            error: {
              code: legacyExactBinding
                ? "LEGACY_PDF_EXPORT_PROCESSING"
                : "CAPTURED_EXPORT_RENDER_PROCESSING",
              message: "This exact export render is already active.",
            },
            retryable: true,
            retry_after_seconds: 2,
          },
          409,
          origin,
        );
        processingResponse.headers.set("Retry-After", "2");
        return processingResponse;
      }
    }
    if (!admitted) {
      return jsonResponse(
        {
          error: {
            code: legacyExactBinding
              ? "LEGACY_PDF_EXPORT_RENDER_DISPATCH_UNRESOLVED"
              : "CAPTURED_EXPORT_RENDER_DISPATCH_UNRESOLVED",
            message: "The external renderer could not be admitted safely.",
          },
        },
        503,
        origin,
      );
    }
    renderDispatch = {
      resourceSha256,
      token,
      leaseExpiresAt: leaseExpiresAt!,
    };
  }
  let renderResult:
    | RenderedPdfRequestResult
    | { state: "unavailable" };
  try {
    renderResult = await renderPdf(
      html,
      capturedInspectionExpectation ??
        legacyExactBinding?.inspectionExpectation ?? null,
      legacyExactBinding ? legacyRenderContract : undefined,
      { leaseExpiresAt: renderDispatch.leaseExpiresAt },
    );
  } catch {
    renderResult = { state: "ambiguous_after_dispatch" };
  }
  const renderTerminalState = renderResult.state ===
      "ambiguous_after_dispatch"
    ? "reconciliation_required"
    : "completed";
  if (renderResult.state === "success") {
    renderedPdf = {
      bytes: renderResult.bytes,
      headers: renderResult.headers,
    };
  }
  if (renderDispatch) {
    let completionAcknowledged = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.admin.rpc(
        "complete_user_external_egress",
        {
          p_user_id: auth.userId,
          p_egress_kind: "render-service",
          p_egress_route: "pdf",
          p_resource_sha256: renderDispatch.resourceSha256,
          p_dispatch_token: renderDispatch.token,
          p_terminal_state: renderTerminalState,
        },
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        !error && ["completed", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        )
      ) {
        completionAcknowledged = true;
        break;
      }
    }
    if (!completionAcknowledged) {
      return jsonResponse(
        {
          error: {
            code: legacyExactBinding
              ? "LEGACY_PDF_EXPORT_RENDER_ACK_UNRESOLVED"
              : "CAPTURED_EXPORT_RENDER_ACK_UNRESOLVED",
            message:
              "The renderer outcome and its durable receipt could not be confirmed.",
          },
        },
        503,
        origin,
      );
    }
  }
  if (renderResult.state === "ambiguous_after_dispatch") {
    if (legacyExactBinding && legacyExactRequestId) {
      await auth.admin.rpc("mark_legacy_pdf_export_reconciliation", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
        p_binding_sha256: legacyExactBinding.bindingSha256,
        p_reconciliation_code: "renderer_ambiguous",
      });
    }
    return jsonResponse(
      {
        error: {
          code: legacyExactBinding
            ? "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED"
            : "CAPTURED_EXPORT_RENDER_RECONCILIATION_REQUIRED",
          message:
            "TED could not confirm the external renderer outcome. It will not send the document again until reconciled.",
        },
        retryable: false,
      },
      503,
      origin,
    );
  }
  if (renderedPdf) {
    payload = ownedBuffer(renderedPdf.bytes);
    contentType = "application/pdf";
    filename = `${filenameStem}.pdf`;
  } else {
    if (legacyExactBinding && legacyExactRequestId) {
      await auth.admin.rpc("mark_legacy_pdf_export_reconciliation", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
        p_binding_sha256: legacyExactBinding.bindingSha256,
        p_reconciliation_code: "renderer_outcome_unrecoverable",
      });
      return jsonResponse(
        {
          error: {
            code: renderResult.state === "unavailable"
              ? "LEGACY_PDF_RENDERER_UNAVAILABLE"
              : "LEGACY_PDF_RENDER_FAILED",
            message:
              "The inspected PDF renderer did not produce a recoverable exact artifact. No export was recorded.",
          },
          retryable: false,
        },
        503,
        origin,
      );
    }
    if (capturedDocument) {
      const rendererUnavailable = renderResult.state === "unavailable";
      return jsonResponse(
        {
          error: {
            code: rendererUnavailable
              ? "CAPTURED_PDF_RENDERER_UNAVAILABLE"
              : "CAPTURED_PDF_RENDER_FAILED",
            message: rendererUnavailable
              ? "The inspected PDF renderer is not available. No export was recorded."
              : "The renderer returned no valid inspected PDF. No export was recorded.",
          },
        },
        503,
        origin,
      );
    }
    const rendererUnavailable = renderResult.state === "unavailable";
    return jsonResponse(
      {
        error: {
          code: rendererUnavailable
            ? "PDF_RENDERER_UNAVAILABLE"
            : "PDF_RENDER_FAILED",
          message: rendererUnavailable
            ? "The inspected PDF renderer is not available. No export was recorded."
            : "The renderer returned no valid inspected PDF. No export was recorded.",
        },
        retryable: false,
      },
      503,
      origin,
    );
  }

  if (legacyExactBinding && legacyExactRequestId) {
    if (contentType !== "application/pdf" || !renderedPdf) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_ARTIFACT_INSPECTION_FAILED",
            message: "The exact legacy PDF renderer returned no artifact.",
          },
        },
        502,
        origin,
      );
    }
    let legacyInspection = await inspectCapturedPdfArtifact(
      renderedPdf.bytes,
      renderedPdf.headers,
      legacyExactBinding.inspectionExpectation,
    );
    if (!legacyInspection.passed || !legacyInspection.artifactInspected) {
      await auth.admin.rpc("mark_legacy_pdf_export_reconciliation", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
        p_binding_sha256: legacyExactBinding.bindingSha256,
        p_reconciliation_code: "renderer_outcome_unrecoverable",
      });
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_ARTIFACT_INSPECTION_FAILED",
            message:
              "The renderer did not prove PDF structure, exact content, section order, and artifact SHA.",
          },
        },
        502,
        origin,
      );
    }
    const durableValidation = {
      ...legacyInspection.validationResult,
      content_type: "application/pdf",
    };
    let artifactEvidenceRecorded = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.admin.rpc(
        "record_legacy_pdf_export_artifact",
        {
          p_user_id: auth.userId,
          p_request_id: legacyExactRequestId,
          p_binding_sha256: legacyExactBinding.bindingSha256,
          p_artifact_sha256: legacyInspection.artifactSha256,
          p_artifact_byte_length: renderedPdf.bytes.byteLength,
          p_renderer_version: legacyExactBinding.rendererVersion,
          p_artifact_validation_result: durableValidation,
        },
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        !error && ["recorded", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        )
      ) {
        artifactEvidenceRecorded = true;
        break;
      }
    }
    if (!artifactEvidenceRecorded) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_ARTIFACT_RECEIPT_UNRESOLVED",
            message:
              "The inspected PDF evidence could not be confirmed before storage.",
          },
        },
        503,
        origin,
      );
    }

    const storageDispatchToken = crypto.randomUUID();
    const storageDispatchArguments = {
      p_user_id: auth.userId,
      p_operation_id: legacyExactRequestId,
      p_dispatch_kind: "legacy-export",
      p_storage_path_sha256: legacyExactBinding.storagePathSha256,
      p_artifact_sha256: legacyInspection.artifactSha256,
      p_dispatch_token: storageDispatchToken,
    };
    let storagePermitted = false;
    let storageDispatchAcknowledged = false;
    let storageAlreadyCompleted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.admin.rpc(
        "claim_user_storage_dispatch",
        storageDispatchArguments,
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (!error && typeof receipt?.storage_permitted === "boolean") {
        if (
          receipt.storage_permitted === false &&
          receipt.outcome === "processing"
        ) {
          const response = jsonResponse(
            {
              error: {
                code: "LEGACY_PDF_EXPORT_STORAGE_PROCESSING",
                message: "This exact PDF is already being stored.",
              },
              retryable: true,
              retry_after_seconds: 2,
            },
            409,
            origin,
          );
          response.headers.set("Retry-After", "2");
          return response;
        }
        storagePermitted = receipt.storage_permitted;
        storageAlreadyCompleted = receipt.outcome === "completed";
        storageDispatchAcknowledged = true;
        break;
      }
      if (String(error?.message ?? "").includes("ACCOUNT_DELETION_FENCED")) {
        return jsonResponse(
          {
            error: {
              code: "ACCOUNT_DELETION_FENCED",
              message:
                "Account deletion has started; this export cannot be stored.",
            },
          },
          409,
          origin,
        );
      }
    }
    if (!storageDispatchAcknowledged) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_STORAGE_DISPATCH_UNRESOLVED",
            message: "The immutable PDF upload could not be admitted safely.",
          },
        },
        503,
        origin,
      );
    }
    let storage;
    try {
      storage = capturedStorageContract();
    } catch {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_STORAGE_FAILED",
            message: "The inspected PDF could not be stored durably.",
          },
        },
        503,
        origin,
      );
    }
    if (storagePermitted) {
      try {
        await requestCapturedExportStorageObject({
          ...storage,
          bucket: "captured-exports",
          path: legacyExactBinding.storagePath,
          method: "POST",
          bytes: renderedPdf.bytes,
          contentType: "application/pdf",
          maximumResponseBytes: 0,
        });
      } catch {
        // A lost upload acknowledgement is recovered only from the exact
        // immutable object below; this execution never issues a second POST.
      }
    }
    let persistedBytes: Uint8Array | null = null;
    try {
      persistedBytes = await requestCapturedExportStorageObject({
        ...storage,
        bucket: "captured-exports",
        path: legacyExactBinding.storagePath,
        method: "GET",
        maximumResponseBytes: storage.maxResponseBytes,
      });
    } catch {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_STORAGE_READ_UNAVAILABLE",
            message:
              "The immutable PDF readback is temporarily unavailable. Retry this UUID without rerendering or re-uploading it.",
          },
          retryable: true,
        },
        503,
        origin,
      );
    }
    const markLegacyReconciliation = async (code: string) => {
      await auth.admin.rpc("mark_legacy_pdf_export_reconciliation", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
        p_binding_sha256: legacyExactBinding!.bindingSha256,
        p_reconciliation_code: code,
      });
    };
    if (persistedBytes === null) {
      await markLegacyReconciliation("storage_object_unavailable");
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED",
            message:
              "The immutable PDF object could not be verified and will not be recreated.",
          },
          retryable: false,
        },
        409,
        origin,
      );
    }
    legacyInspection = await inspectStoredCapturedPdfArtifact(
      persistedBytes,
      legacyInspection.artifactSha256,
      durableValidation,
      legacyExactBinding.inspectionExpectation,
    );
    if (
      !legacyInspection.passed || !legacyInspection.artifactInspected ||
      persistedBytes.byteLength !== renderedPdf.bytes.byteLength
    ) {
      await markLegacyReconciliation("stored_artifact_mismatch");
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_RECONCILIATION_REQUIRED",
            message:
              "The immutable PDF failed its SHA, length, content, structure, or order inspection.",
          },
          retryable: false,
        },
        409,
        origin,
      );
    }
    payload = ownedBuffer(persistedBytes);

    let storageCompletionAcknowledged = storageAlreadyCompleted;
    for (
      let attempt = 0;
      !storageCompletionAcknowledged && attempt < 2;
      attempt += 1
    ) {
      const { data, error } = await auth.admin.rpc(
        "complete_user_storage_dispatch",
        storageDispatchArguments,
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        !error && ["completed", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        )
      ) {
        storageCompletionAcknowledged = true;
      }
    }
    if (!storageCompletionAcknowledged) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_STORAGE_ACK_UNRESOLVED",
            message:
              "The exact object was retained; its durable acknowledgement can be recovered safely.",
          },
        },
        503,
        origin,
      );
    }

    let legacyCompletionData: unknown = null;
    let legacyCompletionError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await auth.admin.rpc("complete_legacy_pdf_export", {
        p_user_id: auth.userId,
        p_request_id: legacyExactRequestId,
        p_binding_sha256: legacyExactBinding.bindingSha256,
      });
      legacyCompletionData = result.data;
      legacyCompletionError = result.error;
      if (!result.error) break;
    }
    if (legacyCompletionError) {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_FINALIZATION_UNRESOLVED",
            message:
              "The exact artifact was retained; retry this UUID to reconcile completion without rerendering.",
          },
        },
        503,
        origin,
      );
    }
    try {
      const completionReceipt = classifyLegacyPdfExportReceipt(
        legacyCompletionData,
        {
          requestId: legacyExactRequestId,
          bindingSha256: legacyExactBinding.bindingSha256,
          storagePath: legacyExactBinding.storagePath,
        },
      );
      if (completionReceipt.state !== "completed") {
        throw new Error("LEGACY_PDF_EXPORT_COMPLETION_INVALID");
      }
    } catch {
      return jsonResponse(
        {
          error: {
            code: "LEGACY_PDF_EXPORT_FINALIZATION_UNRESOLVED",
            message:
              "The exact artifact was retained, but completion was not confirmed.",
          },
        },
        503,
        origin,
      );
    }
  }

  let capturedExportId: string | null = null;
  if (capturedDocument) {
    if (!capturedBrandSnapshot) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_BRAND_SNAPSHOT_INVALID",
            message:
              "The durable export branding did not match this exact request.",
          },
        },
        503,
        origin,
      );
    }
    const exportId = uuid(body.captured_export_id)!;
    const operationId = uuid(body.captured_operation_id)!;
    const expectedOperationRevision = Number(
      body.captured_expected_operation_revision,
    );
    if (
      contentType !== "application/pdf" ||
      !renderedPdf ||
      !capturedInspectionExpectation
    ) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_ARTIFACT_INSPECTION_FAILED",
            message:
              "The rendered artifact failed PDF inspection and was not recorded.",
          },
        },
        502,
        origin,
      );
    }
    const inspection = await inspectCapturedPdfArtifact(
      renderedPdf.bytes,
      renderedPdf.headers,
      capturedInspectionExpectation,
    );
    if (!inspection.passed || !inspection.artifactInspected) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_ARTIFACT_INSPECTION_FAILED",
            message:
              "The renderer did not prove structural, content, and section-order integrity.",
          },
        },
        502,
        origin,
      );
    }
    const bytes = renderedPdf.bytes;
    const storagePath = capturedExportStoragePath(
      auth.userId,
      exportId,
      filename,
    );
    const storagePathSha256 = await sha256Hex(
      new TextEncoder().encode(storagePath),
    );
    const storageDispatchToken = crypto.randomUUID();
    const dispatchArguments = {
      p_user_id: auth.userId,
      // The storage receipt is export-scoped. Using the export UUID avoids one
      // operation's earlier artifact becoming authority for a later export.
      p_operation_id: exportId,
      p_dispatch_kind: "captured-export",
      p_storage_path_sha256: storagePathSha256,
      p_artifact_sha256: inspection.artifactSha256,
      // Per execution, but reused for the two bounded acknowledgement calls.
      // A concurrent worker receives processing/false and cannot upload.
      p_dispatch_token: storageDispatchToken,
    };
    let storagePermitted = false;
    let dispatchAcknowledged = false;
    let storageAlreadyCompleted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.admin.rpc(
        "claim_user_storage_dispatch",
        dispatchArguments,
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (!error && receipt && typeof receipt.storage_permitted === "boolean") {
        if (
          receipt.storage_permitted === false &&
          receipt.outcome === "processing"
        ) {
          const response = jsonResponse(
            {
              error: {
                code: "CAPTURED_EXPORT_STORAGE_PROCESSING",
                message: "This exact export is already being stored.",
              },
              retryable: true,
              retry_after_seconds: 2,
            },
            409,
            origin,
          );
          response.headers.set("Retry-After", "2");
          return response;
        }
        storagePermitted = receipt.storage_permitted;
        storageAlreadyCompleted = receipt.outcome === "completed";
        dispatchAcknowledged = true;
        break;
      }
      if (String(error?.message ?? "").includes("ACCOUNT_DELETION_FENCED")) {
        return jsonResponse(
          {
            error: {
              code: "ACCOUNT_DELETION_FENCED",
              message:
                "Account deletion has started; this export cannot be stored.",
            },
          },
          409,
          origin,
        );
      }
    }
    if (!dispatchAcknowledged) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_STORAGE_DISPATCH_UNRESOLVED",
            message:
              "The export storage operation could not be admitted safely.",
          },
        },
        503,
        origin,
      );
    }
    let storage;
    try {
      storage = capturedStorageContract();
    } catch {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_STORAGE_FAILED",
            message: "The inspected artifact could not be stored durably.",
          },
        },
        503,
        origin,
      );
    }
    const rendererVersion = "render-export.pdf.4";
    const durableValidation = {
      ...inspection.validationResult,
      content_type: contentType,
      ...(capturedBrandSnapshot.snapshotVersion ===
          "prompted.export-brand-snapshot.legacy-unbound.v0"
        ? {
          brand_snapshot_version: capturedBrandSnapshot.snapshotVersion,
          brand_snapshot_sha256: null,
        }
        : {}),
    };
    if (storagePermitted) {
      try {
        await requestCapturedExportStorageObject({
          ...storage,
          bucket: "captured-exports",
          path: storagePath,
          method: "POST",
          bytes,
          contentType,
          maximumResponseBytes: 0,
          signal: req.signal,
        });
      } catch {
        // The response may have been lost after Storage committed. The exact
        // immutable object is read and verified below; this execution never
        // issues a second upload.
      }
    }
    // A successful upload acknowledgement is not proof that the durable
    // object has the admitted bytes. Always read the exact immutable path and
    // bind recovery to that object before completing the dispatch.
    let persistedBytes: Uint8Array | null = null;
    try {
      persistedBytes = await requestCapturedExportStorageObject({
        ...storage,
        bucket: "captured-exports",
        path: storagePath,
        method: "GET",
        maximumResponseBytes: storage.maxResponseBytes,
        signal: req.signal,
      });
    } catch {
      // Keep the dispatch unresolved. A retry may only read this exact path;
      // it may not render or upload a replacement artifact.
    }
    if (!persistedBytes) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_STORAGE_FAILED",
            message:
              "The exact stored export could not be verified. Retry this export without creating or uploading a replacement.",
          },
          retryable: true,
        },
        503,
        origin,
      );
    }
    const storedInspection = await inspectStoredCapturedPdfArtifact(
      persistedBytes,
      inspection.artifactSha256,
      durableValidation,
      capturedInspectionExpectation,
    );
    if (
      persistedBytes.byteLength !== bytes.byteLength ||
      !storedInspection.passed || !storedInspection.artifactInspected
    ) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_ARTIFACT_INSPECTION_FAILED",
            message:
              "The stored artifact did not match the renderer's verified SHA, length, document, section-order, and brand evidence.",
          },
          retryable: false,
        },
        409,
        origin,
      );
    }
    payload = ownedBuffer(persistedBytes);

    const recoveryArguments = {
      p_user_id: auth.userId,
      p_export_id: exportId,
      p_operation_id: operationId,
      p_expected_operation_revision: expectedOperationRevision,
      p_storage_path: storagePath,
      p_artifact_sha256: inspection.artifactSha256,
      p_artifact_byte_length: persistedBytes.byteLength,
      p_renderer_version: rendererVersion,
      p_artifact_validation_result: durableValidation,
      p_storage_dispatch_token: storageDispatchToken,
    };
    let recoveryRecorded = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data, error } = await auth.admin.rpc(
        "record_captured_export_storage_recovery",
        recoveryArguments,
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        !error && ["recorded", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        )
      ) {
        recoveryRecorded = true;
        break;
      }
    }
    if (!recoveryRecorded) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_RECOVERY_RECEIPT_UNRESOLVED",
            message:
              "The exact stored export is intact, but its durable recovery receipt could not be confirmed.",
          },
          retryable: true,
        },
        503,
        origin,
      );
    }

    let storageCompletionAcknowledged = storageAlreadyCompleted;
    for (
      let attempt = 0;
      !storageCompletionAcknowledged && attempt < 2;
      attempt += 1
    ) {
      const { data, error } = await auth.admin.rpc(
        "complete_user_storage_dispatch",
        dispatchArguments,
      );
      const receipt = data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      if (
        !error && ["completed", "idempotent_replay"].includes(
          String(receipt?.outcome ?? ""),
        )
      ) {
        storageCompletionAcknowledged = true;
        break;
      }
    }
    if (!storageCompletionAcknowledged) {
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_STORAGE_ACK_UNRESOLVED",
            message: "The stored export could not be confirmed safely.",
          },
        },
        503,
        origin,
      );
    }
    const artifactSha256 = inspection.artifactSha256;
    const completionArguments = {
      p_export_id: exportId,
      p_operation_id: operationId,
      p_expected_operation_revision: expectedOperationRevision,
      p_storage_path: storagePath,
      p_artifact_sha256: artifactSha256,
      p_renderer_version: rendererVersion,
      p_artifact_validation_result: durableValidation,
    };
    const completion = await reconcileCapturedExportCompletion(
      async () => {
        const { data, error } = await auth.admin.rpc(
          "complete_captured_document_export",
          completionArguments,
        );
        return { data, error };
      },
      {
        exportId,
        operationId,
        storagePath,
        artifactSha256,
        rendererVersion,
      },
    );
    if (!completion.completed) {
      // The RPC may have committed even if both responses were lost. Retain
      // the immutable artifact for safe replay; deleting it could leave a
      // successfully completed database record pointing at missing storage.
      return jsonResponse(
        {
          error: {
            code: "CAPTURED_EXPORT_FINALIZATION_FAILED",
            message:
              "Export completion could not be confirmed. The artifact was retained for a safe retry.",
          },
        },
        503,
        origin,
      );
    }
    capturedExportId = exportId;
  }

  // ---- Record the export (best-effort, never blocks the download) ----
  if (auth.userId !== "anonymous" && legacyExactRequestId === null) {
    void (async () => {
      await auth.admin.from("export_history").insert({
        user_id: auth.userId,
        document_id: body.document_id ?? null,
        artifact_id: body.artifact_id ?? null,
        format,
        filename,
      });
    })().catch(() => {});
  }

  // Echo approved-section count so clients can confirm the gate ran.
  const approvedCount = approvedOnly(sections).length;
  const responseBody: BodyInit = payload;

  return new Response(responseBody, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Approved-Sections": String(approvedCount),
      ...(capturedExportId ? { "X-Captured-Export-Id": capturedExportId } : {}),
    },
  });
});
