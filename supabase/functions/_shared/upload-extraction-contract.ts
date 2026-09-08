export const UPLOAD_RESOURCE_POLICY_VERSION = "upload-resource-policy.1";
// Captured wire/persistence contract, independent of parser resource policy.
export const UPLOAD_EXTRACTION_CONTRACT_V1 = "upload-extraction.1";
export const UPLOAD_EXTRACTION_CONTRACT_V2 = "upload-extraction.2";
// SQL admission must explicitly adopt v3 before activation. Preserve the legacy
// union for old callers; readers that handle all three versions opt in below.
export const UPLOAD_EXTRACTION_CONTRACT_V3 = "upload-extraction.3";
export const UPLOAD_RESOURCE_POLICY_VERSION_V2 = "upload-resource-policy.2";
export type UploadExtractionContractVersion =
  | typeof UPLOAD_EXTRACTION_CONTRACT_V1
  | typeof UPLOAD_EXTRACTION_CONTRACT_V2;
export type ReadableUploadExtractionContractVersion =
  | UploadExtractionContractVersion
  | typeof UPLOAD_EXTRACTION_CONTRACT_V3;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_UPLOAD_BYTES = 1024 * 1024;
export const MAX_EXTRACTED_TEXT_CHARS = 20_000;

export type UploadFormat = "pdf" | "docx" | "xlsx" | "text";

export interface UploadExtractionResult {
  text: string;
  format: UploadFormat;
  truncated: boolean;
  resourcePolicyVersion: typeof UPLOAD_RESOURCE_POLICY_VERSION;
}

export interface UploadExtractionResultV3 {
  text: string;
  format: UploadFormat | "rtf";
  truncated: boolean;
  resourcePolicyVersion: typeof UPLOAD_RESOURCE_POLICY_VERSION_V2;
}
