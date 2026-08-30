// =====================================================
// PrompTED — render-export
//
// Server-side export pipeline. Re-validates the approval gate (never
// trusting the UI), renders the document, records export_history for
// signed-in users, and returns the artifact. PDF is produced by an
// external HTML→PDF render service when configured (RENDER_SERVICE_URL);
// otherwise the canonical HTML is returned. Word is served as a
// Word-openable HTML document; Excel (Budget Workbook) as SpreadsheetML
// with locked formula cells.
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
  createCapturedPdfInspectionExpectation,
  inspectCapturedPdfArtifact,
  ownedBuffer,
  reconcileCapturedExportCompletion,
  requestRenderedPdf,
  validateRenderServiceContract,
} from "./captured-artifact.ts";

type ExportFormat = "pdf" | "word" | "excel";

interface ExportBody {
  document_id?: string;
  artifact_id?: string;
  title?: string;
  format?: ExportFormat;
  sections?: ExportSection[];
  brand_kit?: BrandKit | null;
  lede?: string;
  /** Budget Workbook inputs, when format = excel. */
  budget?: Record<string, number>;
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
): Promise<{ bytes: Uint8Array; headers: Headers } | null> {
  let contract;
  try {
    contract = validateRenderServiceContract({
      serviceUrl: Deno.env.get("RENDER_SERVICE_URL"),
      allowedOrigin: Deno.env.get("RENDER_SERVICE_ALLOWED_ORIGIN"),
      timeoutMs: Deno.env.get("RENDER_SERVICE_TIMEOUT_MS"),
      maxResponseBytes: Deno.env.get("RENDER_SERVICE_MAX_BYTES"),
    });
  } catch {
    return null;
  }
  if (!contract) return null;
  return await requestRenderedPdf(contract, {
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
  });
}

function uuid(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
    ? candidate
    : null;
}

function buildBudgetXml(budget: Record<string, number>): string {
  const n = (k: string) => Number(budget[k] ?? 0) || 0;
  const income = n("income_salary") + n("income_other");
  const outgoings = n("expense_housing") + n("expense_living") +
    n("savings_monthly") + n("debt_repayment");
  const row = (
    label: string,
    value: number,
    locked: boolean,
    formula?: string,
  ) =>
    `<Row><Cell><Data ss:Type="String">${label}</Data></Cell><Cell ss:StyleID="${
      locked ? "locked" : "input"
    }"${
      formula ? ` ss:Formula="${formula}"` : ""
    }><Data ss:Type="Number">${value}</Data></Cell></Row>`;

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="locked"><Protection ss:Protected="1"/></Style>
  <Style ss:ID="input"><Protection ss:Protected="0"/></Style>
</Styles>
<Worksheet ss:Name="Inputs"><Table>
${row("Salary / wages", n("income_salary"), false)}
${row("Other income", n("income_other"), false)}
${row("Housing", n("expense_housing"), false)}
${row("Living costs", n("expense_living"), false)}
${row("Savings", n("savings_monthly"), false)}
${row("Debt repayments", n("debt_repayment"), false)}
</Table></Worksheet>
<Worksheet ss:Name="Dashboard" ss:Protected="1"><Table>
${row("Total income", income, true, "=SUM(Inputs!R1C2:R2C2)")}
${row("Total outgoings", outgoings, true, "=SUM(Inputs!R3C2:R6C2)")}
${row("Surplus", income - outgoings, true, "=R1C2-R2C2")}
</Table></Worksheet>
</Workbook>`;
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

  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return jsonResponse(
      { error: { message: "Invalid JSON body" } },
      400,
      origin,
    );
  }

  const format: ExportFormat = body.format ?? "pdf";
  let title = String(body.title ?? "Document").slice(0, 200);
  let sections = Array.isArray(body.sections) ? body.sections : [];
  let capturedDocument: AuthoritativeDocumentRow | null = null;

  if (body.document_id && body.artifact_id) {
    return jsonResponse(
      {
        error: {
          code: "EXPORT_TARGET_AMBIGUOUS",
          message: "Choose either a document or an artifact to export.",
        },
      },
      400,
      origin,
    );
  }

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
    const { data: document, error: documentError } = await auth.admin
      .from("documents")
      .select(
        "id,title,status,ledger_binding_status,current_revision,approved_revision,unresolved_placeholders",
      )
      .eq("id", documentId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (documentError || !document) {
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
    const authoritative = document as AuthoritativeDocumentRow;
    const { data: documentSections, error: sectionError } = await auth.admin
      .from("sections")
      .select("name,content,status,is_required,order_index")
      .eq("document_id", documentId)
      .eq("user_id", auth.userId)
      .order("order_index", { ascending: true });
    if (sectionError) {
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
    title = authoritative.title;
    sections = (documentSections ?? []) as ExportSection[];
    body.unresolved_placeholders = authoritative.unresolved_placeholders ?? [];

    if (authoritative.ledger_binding_status === "captured") {
      capturedDocument = authoritative;
      if (
        authoritative.status !== "approved" ||
        authoritative.approved_revision === null ||
        authoritative.approved_revision !== authoritative.current_revision
      ) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_REQUIRES_EXACT_CURRENT_APPROVAL",
              message: "Approve the exact current revision before exporting.",
            },
          },
          409,
          origin,
        );
      }
      if (format !== "pdf") {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_EXPORT_FORMAT_NOT_ACTIVATED",
              message:
                "The captured cohort currently exports inspected PDF artifacts only.",
            },
          },
          409,
          origin,
        );
      }
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
    const { data: artifact } = await auth.admin
      .from("ted_artifacts")
      .select("id,title,quality_status")
      .eq("id", body.artifact_id)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (!artifact || artifact.quality_status !== "passed") {
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
    const { data: blocks } = await auth.admin
      .from("ted_artifact_blocks")
      .select("heading,payload,approval_status,order_index,kind")
      .eq("artifact_id", artifact.id)
      .eq("user_id", auth.userId)
      .order("order_index", { ascending: true });
    title = artifact.title;
    sections = (blocks ?? []).map((block) => {
      const payload = block.payload as Record<string, unknown>;
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
            ((payload.completion_criteria as string[] | undefined) ?? []).map((
              value,
            ) => `- ${value}`).join("\n")
          }`,
        ].filter(Boolean).join("\n\n")
        : String(payload.content ?? payload.summary ?? "");
      return {
        name: block.heading || String(payload.title ?? "Section"),
        content: actionText,
        is_required: true,
        status:
          block.kind === "action" || block.approval_status === "approved" ||
            block.approval_status === "locked"
            ? "approved"
            : "draft",
        order_index: block.order_index,
      };
    });
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
  let payload: ArrayBuffer | string;
  let contentType: string;
  let filename: string;
  let renderedPdf: { bytes: Uint8Array; headers: Headers } | null = null;
  const capturedInspectionExpectation = capturedDocument
    ? await createCapturedPdfInspectionExpectation(
      title,
      approvedOnly(sections),
    )
    : null;

  if (format === "excel") {
    const hasBudgetData = Object.values(body.budget ?? {}).some((value) =>
      Number(value) > 0
    );
    if (!hasBudgetData) {
      return jsonResponse(
        {
          error: {
            code: "EXPORT_EMPTY",
            message:
              "This spreadsheet doesn't have any figures yet. Add your numbers with TED first, then export again.",
          },
        },
        400,
        origin,
      );
    }
    payload = buildBudgetXml(body.budget ?? {});
    contentType = "application/vnd.ms-excel";
    filename = `${filenameStem}.xls`;
  } else {
    const html = buildExportHtml(
      title,
      sections,
      body.brand_kit,
      body.lede,
      Deno.env.get("SUPABASE_URL"),
    );
    if (format === "word") {
      payload = html;
      contentType = "application/msword";
      filename = `${filenameStem}.doc`;
    } else {
      renderedPdf = await renderPdf(html, capturedInspectionExpectation);
      if (renderedPdf) {
        payload = ownedBuffer(renderedPdf.bytes);
        contentType = "application/pdf";
        filename = `${filenameStem}.pdf`;
      } else {
        if (capturedDocument) {
          return jsonResponse(
            {
              error: {
                code: "CAPTURED_PDF_RENDERER_UNAVAILABLE",
                message:
                  "The inspected PDF renderer is not available. No export was recorded.",
              },
            },
            503,
            origin,
          );
        }
        // No render service configured — return canonical HTML source.
        payload = html;
        contentType = "text/html; charset=utf-8";
        filename = `${filenameStem}.html`;
      }
    }
  }

  let capturedExportId: string | null = null;
  if (capturedDocument) {
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
    let inspection = await inspectCapturedPdfArtifact(
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
    const { error: uploadError } = await auth.admin.storage
      .from("captured-exports")
      .upload(storagePath, bytes, {
        contentType,
        upsert: false,
      });
    let persistedBytes = bytes;
    if (uploadError) {
      // A response can be lost after a successful upload. Reuse only the exact
      // immutable path and inspect its bytes; never overwrite an existing
      // artifact during an idempotent replay.
      const { data: existing, error: downloadError } = await auth.admin.storage
        .from("captured-exports")
        .download(storagePath);
      if (downloadError || !existing) {
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
      persistedBytes = new Uint8Array(await existing.arrayBuffer());
      inspection = await inspectCapturedPdfArtifact(
        persistedBytes,
        renderedPdf.headers,
        capturedInspectionExpectation,
      );
      if (!inspection.passed || !inspection.artifactInspected) {
        return jsonResponse(
          {
            error: {
              code: "CAPTURED_ARTIFACT_INSPECTION_FAILED",
              message:
                "The stored artifact did not match the renderer's verified inspection evidence.",
            },
          },
          502,
          origin,
        );
      }
      payload = ownedBuffer(persistedBytes);
    }
    const artifactSha256 = inspection.artifactSha256;
    const rendererVersion = "render-export.pdf.2";
    const completionArguments = {
      p_export_id: exportId,
      p_operation_id: operationId,
      p_expected_operation_revision: expectedOperationRevision,
      p_storage_path: storagePath,
      p_artifact_sha256: artifactSha256,
      p_renderer_version: rendererVersion,
      p_artifact_validation_result: {
        ...inspection.validationResult,
        content_type: contentType,
      },
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
  if (auth.userId !== "anonymous") {
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
