export interface UploadStructureSection {
  title: string;
  items: string[];
}

/** Read-only source availability; this contract never authorises an editable copy. */
export interface WorkspaceUploadSummary {
  upload_id: string;
  file_name: string;
  mime_type: string;
  byte_length: number | null;
  created_at: string;
  status: "processing" | "ready" | "committed" | "failed";
  ingest_status: "legacy" | "processing" | "completed" | "failed" | "reconciliation_required";
  format: "pdf" | "docx" | "rtf" | "xlsx" | "text" | null;
  original: { storage_path: string; sha256: string | null } | null;
  imported_document: { document_id: string; outcome_id: string } | null;
}
export interface WorkspaceUploadDetail extends WorkspaceUploadSummary {
  preview: { text: string; truncated: boolean | null } | null;
}
export interface WorkspaceUploadCursor { created_at: string; upload_id: string }
export interface WorkspaceUploadPage {
  items: WorkspaceUploadSummary[];
  next_cursor: WorkspaceUploadCursor | null;
}

export function isWorkspaceUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function invalidWorkspaceUpload(): never { throw new Error("WORKSPACE_UPLOAD_INVALID_RESPONSE"); }
function exactUploadKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function uploadTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}
function workspaceUploadEnvelope(value: unknown, owner: string, keys: string[]): Record<string, unknown> {
  if (!exactUploadKeys(value, ["version", "owner_user_id", ...keys]) ||
    value.version !== "workspace-upload.1" || !isWorkspaceUploadId(owner) ||
    typeof value.owner_user_id !== "string" || value.owner_user_id.toLowerCase() !== owner.toLowerCase()) invalidWorkspaceUpload();
  return value;
}
function parseUploadSummary(value: unknown, owner: string, detail = false): WorkspaceUploadSummary {
  if (!exactUploadKeys(value, ["upload_id", "file_name", "mime_type", "byte_length", "created_at",
    "status", "ingest_status", "format", "original", "imported_document", ...(detail ? ["preview"] : [])]) ||
    !isWorkspaceUploadId(value.upload_id) || typeof value.file_name !== "string" ||
    !value.file_name.trim() || value.file_name.length > 300 || typeof value.mime_type !== "string" ||
    value.mime_type.length > 200 || !uploadTimestamp(value.created_at) ||
    (value.byte_length !== null && (!Number.isSafeInteger(value.byte_length) || Number(value.byte_length) < 0 || Number(value.byte_length) > MAX_UPLOAD_BYTES)) ||
    typeof value.status !== "string" || !["processing", "ready", "committed", "failed"].includes(value.status) ||
    typeof value.ingest_status !== "string" || !["legacy", "processing", "completed", "failed", "reconciliation_required"].includes(value.ingest_status) ||
    (value.format !== null && (typeof value.format !== "string" || !["pdf", "docx", "rtf", "xlsx", "text"].includes(value.format)))) invalidWorkspaceUpload();
  const original = value.original;
  if (original !== null && (!exactUploadKeys(original, ["storage_path", "sha256"]) ||
    typeof original.storage_path !== "string" || !original.storage_path.startsWith(`${owner.toLowerCase()}/`) ||
    original.storage_path.length <= owner.length + 1 || original.storage_path.length > 800 ||
    /(^|\/)\.{1,2}(\/|$)/.test(original.storage_path) ||
    (original.sha256 !== null && (typeof original.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(original.sha256))))) invalidWorkspaceUpload();
  const document = value.imported_document;
  if (document !== null && (!exactUploadKeys(document, ["document_id", "outcome_id"]) ||
    value.status !== "committed" || !isWorkspaceUploadId(document.document_id) || !isWorkspaceUploadId(document.outcome_id))) invalidWorkspaceUpload();
  // All fields above have a closed shape and validated discriminants.
  return value as unknown as WorkspaceUploadSummary;
}
export function parseWorkspaceUploadDetail(value: unknown, owner: string, uploadId: string): WorkspaceUploadDetail | null {
  if (!isWorkspaceUploadId(uploadId)) invalidWorkspaceUpload();
  const envelope = workspaceUploadEnvelope(value, owner, ["source"]);
  if (envelope.source === null) return null;
  const source = parseUploadSummary(envelope.source, owner, true) as WorkspaceUploadDetail;
  if (source.upload_id.toLowerCase() !== uploadId.toLowerCase()) invalidWorkspaceUpload();
  if (source.preview !== null && (!exactUploadKeys(source.preview, ["text", "truncated"]) ||
    typeof source.preview.text !== "string" || source.preview.text.length === 0 || source.preview.text.length > 40000 ||
    [...source.preview.text].length > 20000 ||
    (source.preview.truncated !== null && typeof source.preview.truncated !== "boolean"))) invalidWorkspaceUpload();
  return source;
}
export function parseWorkspaceUploadPage(value: unknown, owner: string): WorkspaceUploadPage {
  const envelope = workspaceUploadEnvelope(value, owner, ["items", "next_cursor"]);
  if (!Array.isArray(envelope.items) || envelope.items.length > 20) invalidWorkspaceUpload();
  const items = envelope.items.map((row) => parseUploadSummary(row, owner));
  if (new Set(items.map((row) => row.upload_id.toLowerCase())).size !== items.length) invalidWorkspaceUpload();
  const cursor = envelope.next_cursor;
  const last = items.at(-1);
  if (cursor !== null && (!exactUploadKeys(cursor, ["created_at", "upload_id"]) ||
    items.length !== 20 || !last || cursor.created_at !== last.created_at || cursor.upload_id !== last.upload_id)) invalidWorkspaceUpload();
  return { items, next_cursor: cursor as WorkspaceUploadCursor | null };
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

// Explicit opt-in for source-preserving admission. The original policy exports
// and default preflight remain unchanged for existing upload consumers.
export const UPLOAD_RESOURCE_POLICY_VERSION_V2 = "upload-resource-policy.2";
export const UPLOAD_ACCEPT_ATTRIBUTE_V2 = `${UPLOAD_ACCEPT_ATTRIBUTE},.rtf,application/rtf,text/rtf`;
export const UPLOAD_REQUIREMENT_V2 =
  "PDF, DOCX or XLSX up to 8MB; RTF, TXT, Markdown or CSV up to 1MB.";
export type UploadPreflightFormatV2 = UploadPreflightFormat | "rtf";
export type UploadMetadataPreflightResultV2 = UploadMetadataPreflightResult
  | { ok: true; format: "rtf"; maximumBytes: number }
  | { ok: false; code: UploadPreflightErrorCode; message: string; format: "rtf"; maximumBytes: number };
const RTF_UPLOAD_MIMES = new Set(["application/rtf", "text/rtf", "rtf"]);

export function preflightUploadMetadataV2(input: {
  fileName: string; mimeType: string; byteLength: number;
}): UploadMetadataPreflightResultV2 {
  if (uploadExtension(input.fileName) !== "rtf" || !Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) {
    return preflightUploadMetadata(input);
  }
  const mime = input.mimeType.normalize("NFKC").trim().toLowerCase();
  if (mime.length > 200 || (!GENERIC_UPLOAD_MIMES.has(mime) && !RTF_UPLOAD_MIMES.has(mime))) {
    return { ok: false, code: "UPLOAD_FORMAT_MISMATCH",
      message: "That file's name and type do not match. Save it again in a supported format and try again.",
      format: "rtf", maximumBytes: MAX_TEXT_UPLOAD_BYTES };
  }
  if (input.byteLength > MAX_TEXT_UPLOAD_BYTES) {
    return { ok: false, code: "UPLOAD_TEXT_RESOURCE_LIMIT", message: "RTF files need to be 1MB or smaller.",
      format: "rtf", maximumBytes: MAX_TEXT_UPLOAD_BYTES };
  }
  return { ok: true, format: "rtf", maximumBytes: MAX_TEXT_UPLOAD_BYTES };
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
