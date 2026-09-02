export type ActivatedExportFormat = "pdf";

export type ExportFormatDecision =
  | { ok: true; format: ActivatedExportFormat }
  | {
    ok: false;
    status: 400 | 409;
    code: "EXPORT_FORMAT_INVALID" | "LEGACY_EXPORT_FORMAT_NOT_ACTIVATED";
    message: string;
  };

/**
 * Keep the historical request vocabulary readable while only activating
 * formats whose returned bytes are independently inspected and truthful.
 */
export function resolveExportFormat(value: unknown): ExportFormatDecision {
  if (value === undefined || value === "pdf") {
    return { ok: true, format: "pdf" };
  }
  if (value === "word" || value === "excel") {
    return {
      ok: false,
      status: 409,
      code: "LEGACY_EXPORT_FORMAT_NOT_ACTIVATED",
      message:
        "Inspected PDF is currently the only activated export format. Existing historical exports are unchanged.",
    };
  }
  return {
    ok: false,
    status: 400,
    code: "EXPORT_FORMAT_INVALID",
    message: "Choose an activated export format.",
  };
}
