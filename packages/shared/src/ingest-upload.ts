export interface UploadStructureSection {
  title: string;
  items: string[];
}

export const UPLOAD_RESOURCE_POLICY_VERSION = "upload-resource-policy.1";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_UPLOAD_BYTES = 1024 * 1024;
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/csv",
].join(",");
export const UPLOAD_REQUIREMENT =
  "PDF, DOCX or XLSX up to 8MB; TXT, Markdown or CSV up to 1MB.";

export type UploadPreflightFormat = "pdf" | "docx" | "xlsx" | "text";
export type UploadPreflightErrorCode =
  | "UPLOAD_FILE_EMPTY"
  | "UPLOAD_FORMAT_MISMATCH"
  | "UPLOAD_FORMAT_UNSUPPORTED"
  | "UPLOAD_LEGACY_FORMAT_UNSUPPORTED"
  | "UPLOAD_TEXT_RESOURCE_LIMIT"
  | "UPLOAD_TOO_LARGE";

export type UploadMetadataPreflightResult =
  | {
    ok: true;
    format: UploadPreflightFormat;
    maximumBytes: number;
  }
  | {
    ok: false;
    code: UploadPreflightErrorCode;
    message: string;
    format?: UploadPreflightFormat;
    maximumBytes?: number;
  };

const GENERIC_UPLOAD_MIMES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);
const UPLOAD_FORMATS: Record<
  string,
  {
    format: UploadPreflightFormat;
    maximumBytes: number;
    mimes: ReadonlySet<string>;
  }
> = {
  pdf: {
    format: "pdf",
    maximumBytes: MAX_UPLOAD_BYTES,
    mimes: new Set(["application/pdf"]),
  },
  docx: {
    format: "docx",
    maximumBytes: MAX_UPLOAD_BYTES,
    mimes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
      "application/x-zip-compressed",
    ]),
  },
  xlsx: {
    format: "xlsx",
    maximumBytes: MAX_UPLOAD_BYTES,
    mimes: new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "application/x-zip-compressed",
    ]),
  },
  txt: {
    format: "text",
    maximumBytes: MAX_TEXT_UPLOAD_BYTES,
    mimes: new Set(["text/plain"]),
  },
  md: {
    format: "text",
    maximumBytes: MAX_TEXT_UPLOAD_BYTES,
    mimes: new Set([
      "text/plain",
      "text/markdown",
      "text/x-markdown",
      "application/markdown",
    ]),
  },
  csv: {
    format: "text",
    maximumBytes: MAX_TEXT_UPLOAD_BYTES,
    mimes: new Set(["text/plain", "text/csv", "application/vnd.ms-excel"]),
  },
};

function uploadExtension(fileName: string): string {
  const normalized = fileName.normalize("NFKC").trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot < 0 ? "" : normalized.slice(dot + 1);
}

export function preflightUploadMetadata(input: {
  fileName: string;
  mimeType: string;
  byteLength: number;
}): UploadMetadataPreflightResult {
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) {
    return {
      ok: false,
      code: "UPLOAD_FILE_EMPTY",
      message: "That file is empty. Choose a file that contains readable content.",
    };
  }
  const extension = uploadExtension(input.fileName);
  if (["doc", "docm", "xls", "xlsm"].includes(extension)) {
    return {
      ok: false,
      code: "UPLOAD_LEGACY_FORMAT_UNSUPPORTED",
      message:
        "TED cannot read .doc, .docm, .xls or .xlsm files. Save a macro-free PDF, DOCX or XLSX copy and try again.",
    };
  }
  const policy = UPLOAD_FORMATS[extension];
  if (!policy) {
    return {
      ok: false,
      code: "UPLOAD_FORMAT_UNSUPPORTED",
      message:
        "TED can read PDF, DOCX, XLSX, TXT, Markdown or CSV files. Save this file in one of those formats and try again.",
    };
  }
  const mime = input.mimeType.normalize("NFKC").trim().toLowerCase();
  if (
    mime.length > 200 ||
    (!GENERIC_UPLOAD_MIMES.has(mime) && !policy.mimes.has(mime))
  ) {
    return {
      ok: false,
      code: "UPLOAD_FORMAT_MISMATCH",
      message:
        "That file's name and type do not match. Save it again in a supported format and try again.",
      format: policy.format,
      maximumBytes: policy.maximumBytes,
    };
  }
  if (input.byteLength > policy.maximumBytes) {
    return policy.format === "text"
      ? {
        ok: false,
        code: "UPLOAD_TEXT_RESOURCE_LIMIT",
        message: "TXT, Markdown and CSV files need to be 1MB or smaller.",
        format: policy.format,
        maximumBytes: policy.maximumBytes,
      }
      : {
        ok: false,
        code: "UPLOAD_TOO_LARGE",
        message: "PDF, DOCX and XLSX files need to be 8MB or smaller.",
        format: policy.format,
        maximumBytes: policy.maximumBytes,
      };
  }
  return {
    ok: true,
    format: policy.format,
    maximumBytes: policy.maximumBytes,
  };
}

export interface IngestUploadConfirmPayload {
  /** TED's own-words summary of what the document is for (1-3 sentences). */
  summary: string;
  /** Plain-words name for the kind of document, e.g. "training checklist". */
  document_type: string;
  /** Mirror of the document's own headings and entries, in its own order. */
  structure: UploadStructureSection[];
  filename: string;
  char_count: number;
  truncated: boolean;
}

function invalidConfirmation(): never {
  throw new Error("UPLOAD_CONFIRMATION_INVALID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimmedBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim()
  );
}

/**
 * The one pure parser for the confirmation envelope returned directly by
 * ingest-upload and later embedded in a durable Home intake snapshot.
 */
export function parseIngestUploadConfirmPayload(
  value: unknown,
  expectedFileName: string,
  extractedText: string | null,
): IngestUploadConfirmPayload {
  if (!isRecord(value)) invalidConfirmation();
  const charCount = value.char_count;
  if (
    !trimmedBoundedString(value.summary, 600) ||
    !trimmedBoundedString(value.document_type, 80) ||
    !trimmedBoundedString(value.filename, 300) ||
    value.filename !== expectedFileName ||
    !Number.isSafeInteger(charCount) ||
    Number(charCount) <= 0 ||
    Number(charCount) > 20_000 ||
    (extractedText !== null && charCount !== extractedText.length) ||
    typeof value.truncated !== "boolean" ||
    (value.truncated && charCount !== 20_000) ||
    !Array.isArray(value.structure) ||
    value.structure.length < 1 ||
    value.structure.length > 12
  ) {
    invalidConfirmation();
  }
  const structure = value.structure.map((raw): UploadStructureSection => {
    if (!isRecord(raw) || !trimmedBoundedString(raw.title, 120) || !Array.isArray(raw.items)) {
      invalidConfirmation();
    }
    if (
      raw.items.length > 12 ||
      raw.items.some((item) => !trimmedBoundedString(item, 200))
    ) {
      invalidConfirmation();
    }
    return { title: raw.title, items: [...raw.items] as string[] };
  });
  return {
    summary: value.summary,
    document_type: value.document_type,
    structure,
    filename: value.filename,
    char_count: Number(charCount),
    truncated: value.truncated,
  };
}
