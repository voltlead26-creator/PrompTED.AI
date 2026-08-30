"use client";

import { useCallback, useState } from "react";
import {
  renderExport,
  ApiError,
  type DocumentExportFormat,
} from "@prompted/shared/api-client";
import type {
  DocumentPlaceholderMetadata,
  Section,
} from "@prompted/shared/browser";
import { ensureApiConfigured } from "@/lib/api";

export interface ExportParams {
  documentId?: string;
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
  /** Render + download. Resolves true on success, false on a handled failure. */
  run: (params: ExportParams) => Promise<boolean>;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * useExport — drives the server-side export and downloads the artifact.
 * Surfaces the approval-gate error in plain language; the binary render and
 * gate re-check both happen server-side.
 */
export function useExport(): UseExport {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (params: ExportParams) => {
    ensureApiConfigured();
    setExporting(true);
    setError(null);
    try {
      const result = await renderExport({
        document_id: params.documentId,
        title: params.title,
        format: params.format,
        sections: params.sections,
        lede: params.lede,
        unresolved_placeholders: params.unresolvedPlaceholders ?? [],
        placeholder_acknowledged: params.placeholderAcknowledged ?? false,
        captured_export_id: params.capturedExport?.exportId,
        captured_operation_id: params.capturedExport?.operationId,
        captured_expected_operation_revision:
          params.capturedExport?.expectedOperationRevision,
      });
      triggerDownload(result.blob, result.filename);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "EXPORT_GATE") {
        setError("Approve every required section before exporting.");
      } else if (
        err instanceof ApiError &&
        err.code === "EXPORT_PLACEHOLDER_ACK_REQUIRED"
      ) {
        setError("This document still contains required missing details. Confirm that you want to export with those placeholders visible.");
      } else if (
        err instanceof ApiError &&
        err.code === "EXPORT_PLACEHOLDER_METADATA_MISSING"
      ) {
        setError("PrompTED could not verify the document's unresolved details. Reopen the document and try again.");
      } else {
        setError("That export didn't go through. Please try again in a moment.");
      }
      return false;
    } finally {
      setExporting(false);
    }
  }, []);

  return { exporting, error, run };
}
