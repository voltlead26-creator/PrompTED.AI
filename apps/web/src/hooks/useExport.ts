"use client";

import { useCallback, useState } from "react";
import { renderExport, ApiError, type DocumentExportFormat } from "@prompted/shared/api-client";
import type { DocumentPlaceholderMetadata, Section } from "@prompted/shared/browser";
import { useAuth } from "@/components/providers";
import { ensureApiConfigured } from "@/lib/api";
import { ownerDispatchIsCurrent, type OwnerDispatchLease } from "@/lib/browser-principal-state";

export interface ExportParams {
  documentId: string;
  title: string;
  format: DocumentExportFormat;
  sections: Section[];
  lede?: string;
  unresolvedPlaceholders?: DocumentPlaceholderMetadata[];
  placeholderAcknowledged?: boolean;
  capturedExport?: {
    exportId: string;
    operationId: string;
    expectedOperationRevision: number;
  };
}

export interface UseExport {
  exporting: boolean;
  error: string | null;
  /** Delivers an inspected artifact to the browser; this cannot prove an OS-level save. */
  run: (
    params: ExportParams,
    requestContext: OwnerDispatchLease,
  ) => Promise<ExportDeliveryResult | null>;
}

export interface ExportDeliveryResult {
  state: "artifact_delivered_to_browser";
  capturedExportId: string | null;
  deliveredAt: string;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * useExport — drives the server-side export and downloads the artifact.
 * Surfaces the approval-gate error in plain language; the binary render and
 * gate re-check both happen server-side.
 */
export function useExport(): UseExport {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run: UseExport["run"] = useCallback(
    async (params: ExportParams, requestContext: OwnerDispatchLease) => {
      if (!user?.id || requestContext.expectedUserId !== user.id.toLowerCase()) {
        setError("Sign in again before exporting this document.");
        return null;
      }
      requestContext.assertCurrent();
      ensureApiConfigured();
      setExporting(true);
      setError(null);
      try {
        const result = await renderExport(
          {
            document_id: params.documentId,
            title: params.title,
            format: params.format,
            sections: params.sections,
            lede: params.lede,
            unresolved_placeholders: params.unresolvedPlaceholders ?? [],
            placeholder_acknowledged: params.placeholderAcknowledged ?? false,
            captured_export_id: params.capturedExport?.exportId,
            captured_operation_id: params.capturedExport?.operationId,
            captured_expected_operation_revision: params.capturedExport?.expectedOperationRevision,
          },
          requestContext,
        );
        requestContext.assertCurrent();
        triggerDownload(result.blob, result.filename);
        return {
          state: "artifact_delivered_to_browser",
          capturedExportId: result.capturedExportId,
          deliveredAt: new Date().toISOString(),
        };
      } catch (err) {
        if (!ownerDispatchIsCurrent(requestContext)) return null;
        if (err instanceof ApiError && err.code === "EXPORT_GATE") {
          setError("Approve every required section before exporting.");
        } else if (err instanceof ApiError && err.code === "EXPORT_PLACEHOLDER_ACK_REQUIRED") {
          setError(
            "This document still contains required missing details. Confirm that you want to export with those placeholders visible.",
          );
        } else if (err instanceof ApiError && err.code === "EXPORT_PLACEHOLDER_METADATA_MISSING") {
          setError(
            "PrompTED could not verify the document's unresolved details. Reopen the document and try again.",
          );
        } else if (err instanceof ApiError && err.code === "LEGACY_EXPORT_FORMAT_NOT_ACTIVATED") {
          setError("Inspected PDF is currently the only available export format.");
        } else {
          setError("That export didn't go through. Please try again in a moment.");
        }
        return null;
      } finally {
        if (ownerDispatchIsCurrent(requestContext)) setExporting(false);
      }
    },
    [user?.id],
  );

  return { exporting, error, run };
}
