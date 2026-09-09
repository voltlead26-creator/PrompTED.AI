/** Retained source extraction. This receipt does not assert AI classification or editable fidelity. */
export const UPLOAD_SOURCE_PREPARATION_VERSION = "upload-source-preparation.1";

export interface SourcePreparedUpload {
  contract_version: typeof UPLOAD_SOURCE_PREPARATION_VERSION;
  upload_id: string;
  storage_path: string;
  original_retained: true;
  classification_status: "not_requested";
  extracted_text: string;
  extraction_format: "text" | "pdf" | "docx" | "rtf" | "xlsx";
  resource_policy_version: "upload-resource-policy.2";
  extraction_text_sha256: string;
  truncated: boolean;
}

const KEYS = ["contract_version", "upload_id", "storage_path", "original_retained",
  "classification_status", "extracted_text", "extraction_format", "resource_policy_version",
  "extraction_text_sha256", "truncated"];

export async function parseSourcePreparedUpload(value: unknown, expected: {
  uploadId: string;
  ownerId: string;
  format: SourcePreparedUpload["extraction_format"];
}): Promise<SourcePreparedUpload> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("UPLOAD_RESPONSE_INVALID");
  const record = value as Record<string, unknown>;
  const text = record.extracted_text;
  if (Object.keys(record).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(record, key)) ||
    record.contract_version !== UPLOAD_SOURCE_PREPARATION_VERSION ||
    record.upload_id !== expected.uploadId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expected.uploadId) ||
    typeof record.storage_path !== "string" || record.storage_path.length > 800 ||
    !record.storage_path.startsWith(`${expected.ownerId}/${expected.uploadId}/`) ||
    record.storage_path.split("/").some(part => !part || part === "." || part === "..") ||
    record.original_retained !== true || record.classification_status !== "not_requested" ||
    record.extraction_format !== expected.format || record.resource_policy_version !== "upload-resource-policy.2" ||
    typeof record.truncated !== "boolean" || typeof text !== "string" || !text.trim() ||
    text.length > 20_000 || text.includes("\u0000") ||
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(text)) !== text ||
    typeof record.extraction_text_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.extraction_text_sha256)) {
    throw new Error("UPLOAD_RESPONSE_INVALID");
  }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== record.extraction_text_sha256) throw new Error("UPLOAD_RESPONSE_INVALID");
  return {
    contract_version: UPLOAD_SOURCE_PREPARATION_VERSION, upload_id: expected.uploadId,
    storage_path: record.storage_path, original_retained: true, classification_status: "not_requested",
    extracted_text: text, extraction_format: expected.format, resource_policy_version: "upload-resource-policy.2",
    extraction_text_sha256: digest, truncated: record.truncated,
  };
}
