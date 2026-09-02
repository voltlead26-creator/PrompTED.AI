export const UPLOAD_RESOURCE_POLICY_VERSION = "upload-resource-policy.1";
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
