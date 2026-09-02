/** Owns bounded rendering, deterministic inspection evidence, and identity. */

import type { CapturedBrandInspectionExpectation } from "./export-brand-snapshot.ts";

const LEGACY_INSPECTION_VERSION = "prompted.rendered-pdf.v1";
const CAPTURED_INSPECTION_VERSION = "prompted.rendered-pdf.v2";
const LEGACY_PDF_BINDING_VERSION = "prompted.legacy-pdf-export.v2";
const LEGACY_PDF_RENDERER_VERSION = "render-export.pdf.3";
const DEFAULT_RENDER_TIMEOUT_MS = 15_000;
const MAX_RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const DEFAULT_STORAGE_TIMEOUT_MS = 60_000;
const MAX_STORAGE_TIMEOUT_MS = 90_000;
const RENDER_DISPATCH_START_SAFETY_MS = 1_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RenderServiceContract {
  endpoint: string;
  origin: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface RenderDispatchLease {
  leaseExpiresAt: string;
  now?: () => number;
}

export interface CapturedExportStorageContract {
  baseUrl: string;
  serviceRoleKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface CapturedExportStorageRequest {
  baseUrl: string;
  serviceRoleKey: string;
  bucket: "captured-exports";
  path: string;
  method: "GET" | "POST";
  bytes?: Uint8Array;
  contentType?: string;
  timeoutMs: number;
  maximumResponseBytes: number;
  signal?: AbortSignal;
}

export interface CapturedPdfInspectionExpectation {
  version:
    | typeof LEGACY_INSPECTION_VERSION
    | typeof CAPTURED_INSPECTION_VERSION;
  contentSha256: string;
  sectionOrderSha256: string;
  source: {
    title: string;
    sections: ExpectedSection[];
  };
  brand?: CapturedBrandInspectionExpectation;
}

export interface ExpectedSection {
  name: string;
  content: string;
  order_index: number;
}

export type LegacyPdfExportTarget =
  | {
    kind: "document" | "artifact";
    id: string;
    currentRevision: number;
    approvedRevision: number | null;
  }
  | {
    kind: "inline";
    id: null;
    currentRevision: null;
    approvedRevision: null;
  };

export interface LegacyPdfExportInputIdentityInput {
  ownerUserId: string;
  requestId: string;
  target: LegacyPdfExportTarget;
  title: string;
  sections: ExpectedSection[];
  brandKit: {
    id: string;
    business_id: string;
    logo_url: string | null;
    primary_colour: string;
    secondary_colour: string | null;
    footer_text: string | null;
    revision: number;
    logo_operation_id: string | null;
    logo_storage_path: string | null;
    logo_content_sha256: string | null;
    logo_media_type: "image/png" | "image/jpeg" | "image/webp" | null;
    logo_byte_length: number | null;
    logo_status: "ready" | "legacy_unverified" | "reconciliation_required";
    updated_at: string;
  } | null;
  lede: string | null;
  html: string;
  filename: string;
}

export interface LegacyPdfExportBindingInput
  extends LegacyPdfExportInputIdentityInput {
  renderContract: RenderServiceContract;
}

export interface LegacyPdfExportInputIdentity {
  ownerUserId: string;
  requestId: string;
  targetKind: LegacyPdfExportTarget["kind"];
  targetId: string | null;
  targetRevision: number | null;
  approvedRevision: number | null;
  targetIdentitySha256: string;
  format: "pdf";
  inputSha256: string;
  htmlSha256: string;
  storagePath: string;
  storagePathSha256: string;
  filename: string;
  inspectionExpectation: CapturedPdfInspectionExpectation;
}

export interface LegacyPdfExportBinding extends LegacyPdfExportInputIdentity {
  bindingVersion: typeof LEGACY_PDF_BINDING_VERSION;
  rendererPolicySha256: string;
  rendererResourceSha256: string;
  bindingSha256: string;
  rendererVersion: typeof LEGACY_PDF_RENDERER_VERSION;
}

interface LegacyPdfReceiptIdentity {
  requestId: string;
  bindingSha256: string;
  storagePath: string;
}

interface LegacyPdfStoredArtifactReceipt {
  storagePath: string;
  artifactSha256: string;
  artifactByteLength: number;
  rendererVersion: string;
  artifactValidationResult: Record<string, unknown>;
}

export type LegacyPdfExportReceiptState =
  | { state: "requested" }
  | { state: "processing"; retryAfterSeconds: number }
  | { state: "reconciliation_required" }
  | ({
    state: "storage_recovery";
    storageState: "dispatched" | "completed";
    storageDispatchToken: string | null;
  } & LegacyPdfStoredArtifactReceipt)
  | (
    & { state: "completed"; historyId: string }
    & LegacyPdfStoredArtifactReceipt
  );

interface CapturedCompletionIdentity {
  exportId: string;
  operationId: string;
  storagePath: string;
  artifactSha256: string;
  rendererVersion: string;
}

interface CapturedReceiptIdentity {
  exportId: string;
  operationId: string;
  storagePath: string;
  inspectionExpectation?: CapturedPdfInspectionExpectation;
}

export type CapturedExportReceiptState =
  | { state: "requested" }
  | { state: "processing"; retryAfterSeconds: number }
  | { state: "reconciliation_required" }
  | ({
    state: "storage_recovery";
    expectedOperationRevision: number;
    storageState: "dispatched" | "completed";
    storageDispatchToken: string | null;
  } & CapturedStoredArtifactReceipt)
  | ({
    state: "completed";
  } & CapturedStoredArtifactReceipt);

interface CapturedStoredArtifactReceipt {
  storagePath: string;
  artifactSha256: string;
  artifactByteLength: number;
  rendererVersion: string;
  artifactValidationResult: Record<string, unknown>;
}

export interface CapturedPdfInspectionResult {
  passed: boolean;
  artifactInspected: boolean;
  artifactSha256: string;
  validationResult: {
    passed: boolean;
    artifact_inspected: boolean;
    inspection_contract:
      | typeof LEGACY_INSPECTION_VERSION
      | typeof CAPTURED_INSPECTION_VERSION;
    artifact_sha256: string;
    byte_length: number;
    content_sha256: string;
    section_order_sha256: string;
    brand_snapshot_version?: string;
    brand_snapshot_sha256?: string;
    brand_present?: boolean;
    brand_logo_storage_path?: string | null;
    brand_logo_sha256?: string | null;
    brand_logo_media_type?: string | null;
    brand_logo_byte_length?: number | null;
    brand_footer_sha256?: string | null;
    brand_primary_colour?: string | null;
    brand_secondary_colour?: string | null;
    brand_evidence_sha256?: string;
    checks: {
      transport_envelope: boolean;
      inspection_version: boolean;
      renderer_status: boolean;
      renderer_structural: boolean;
      content_matches: boolean;
      section_order_matches: boolean;
      artifact_hash_matches: boolean;
      brand_snapshot_matches?: boolean;
      brand_logo_matches?: boolean;
      brand_footer_matches?: boolean;
      brand_colours_match?: boolean;
    };
  };
}

export type RenderedPdfRequestResult =
  | { state: "success"; bytes: Uint8Array; headers: Headers }
  | { state: "definitive_terminal_failure" }
  | { state: "ambiguous_after_dispatch" };

type RenderFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export function validateLegacyExportRequestIdentity(input: {
  captured: boolean;
  bodyRequestId: unknown;
  idempotencyHeader: string | null;
  requestHeader: string | null;
}): boolean {
  if (input.captured || input.bodyRequestId === undefined) return true;
  if (typeof input.bodyRequestId !== "string") return false;
  const body = input.bodyRequestId.trim();
  const idempotency = input.idempotencyHeader?.trim() ?? "";
  const request = input.requestHeader?.trim() ?? "";
  return UUID_PATTERN.test(body) && idempotency === body && request === body;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return "{" +
    Object.keys(record).sort().map((key) =>
      JSON.stringify(key) + ":" + canonicalJson(record[key])
    ).join(",") + "}";
}

async function sha256Canonical(value: unknown): Promise<string> {
  return await sha256Hex(artifactBytes(canonicalJson(value)));
}

function positiveRevision(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value > 0);
}

export function legacyPdfExportStoragePath(
  ownerUserId: string,
  requestId: string,
): string {
  if (!UUID_PATTERN.test(ownerUserId) || !UUID_PATTERN.test(requestId)) {
    throw new Error("LEGACY_PDF_EXPORT_IDENTITY_INVALID");
  }
  return `${ownerUserId.toLowerCase()}/${requestId.toLowerCase()}/legacy.pdf`;
}

export async function createLegacyPdfExportInputIdentity(
  input: LegacyPdfExportInputIdentityInput,
): Promise<LegacyPdfExportInputIdentity> {
  const ownerUserId = input.ownerUserId.trim().toLowerCase();
  const requestId = input.requestId.trim().toLowerCase();
  const targetId = input.target.id?.trim().toLowerCase() ?? null;
  if (
    !UUID_PATTERN.test(ownerUserId) || !UUID_PATTERN.test(requestId) ||
    !input.title.trim() || !input.html.trim() ||
    !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(input.filename) ||
    !positiveRevision(input.target.currentRevision) ||
    !positiveRevision(input.target.approvedRevision) ||
    (input.target.kind === "inline" &&
      (targetId !== null || input.target.currentRevision !== null ||
        input.target.approvedRevision !== null)) ||
    (input.target.kind !== "inline" &&
      (!targetId || !UUID_PATTERN.test(targetId) ||
        input.target.currentRevision === null)) ||
    input.sections.length === 0 ||
    input.sections.some((section) =>
      !section.name.trim() || !section.content.trim() ||
      !Number.isInteger(section.order_index) || section.order_index < 0
    )
  ) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_INVALID");
  }

  const canonicalTarget = {
    kind: input.target.kind,
    id: targetId,
    current_revision: input.target.currentRevision,
    approved_revision: input.target.approvedRevision,
  };
  const canonicalSections = input.sections.map((section) => ({
    name: section.name,
    content: section.content,
    order_index: section.order_index,
  }));
  const canonicalInput = {
    target: canonicalTarget,
    title: input.title,
    sections: canonicalSections,
    brand_kit: input.brandKit
      ? {
        id: input.brandKit.id,
        business_id: input.brandKit.business_id,
        revision: input.brandKit.revision,
        logo_status: input.brandKit.logo_status,
        logo_url: input.brandKit.logo_url,
        logo_operation_id: input.brandKit.logo_operation_id,
        logo_storage_path: input.brandKit.logo_storage_path,
        logo_content_sha256: input.brandKit.logo_content_sha256,
        logo_media_type: input.brandKit.logo_media_type,
        logo_byte_length: input.brandKit.logo_byte_length,
        primary_colour: input.brandKit.primary_colour,
        secondary_colour: input.brandKit.secondary_colour,
        footer_text: input.brandKit.footer_text,
        updated_at: input.brandKit.updated_at,
      }
      : null,
    lede: input.lede ?? null,
    filename: input.filename,
    format: "pdf",
  };
  const targetIdentitySha256 = await sha256Canonical(canonicalTarget);
  const inputSha256 = await sha256Canonical(canonicalInput);
  const htmlSha256 = await sha256Hex(artifactBytes(input.html));
  const storagePath = legacyPdfExportStoragePath(ownerUserId, requestId);
  const storagePathSha256 = await sha256Hex(artifactBytes(storagePath));
  return {
    ownerUserId,
    requestId,
    targetKind: input.target.kind,
    targetId,
    targetRevision: input.target.currentRevision,
    approvedRevision: input.target.approvedRevision,
    targetIdentitySha256,
    format: "pdf",
    inputSha256,
    htmlSha256,
    storagePath,
    storagePathSha256,
    filename: input.filename,
    inspectionExpectation: await createCapturedPdfInspectionExpectation(
      input.title,
      canonicalSections,
    ),
  };
}

async function completeLegacyPdfExportBinding(
  inputIdentity: LegacyPdfExportInputIdentity,
  rendererPolicySha256: string,
  rendererResourceSha256?: string,
): Promise<LegacyPdfExportBinding> {
  const effectiveRendererResourceSha256 = rendererResourceSha256 ??
    await sha256Canonical({
      version: LEGACY_PDF_BINDING_VERSION,
      request_id: inputIdentity.requestId,
      target_identity_sha256: inputIdentity.targetIdentitySha256,
      input_sha256: inputIdentity.inputSha256,
      html_sha256: inputIdentity.htmlSha256,
      renderer_policy_sha256: rendererPolicySha256,
    });
  const bindingIdentity = {
    version: LEGACY_PDF_BINDING_VERSION,
    owner_user_id: inputIdentity.ownerUserId,
    request_id: inputIdentity.requestId,
    target: {
      kind: inputIdentity.targetKind,
      id: inputIdentity.targetId,
      current_revision: inputIdentity.targetRevision,
      approved_revision: inputIdentity.approvedRevision,
    },
    target_identity_sha256: inputIdentity.targetIdentitySha256,
    format: "pdf",
    input_sha256: inputIdentity.inputSha256,
    html_sha256: inputIdentity.htmlSha256,
    renderer_policy_sha256: rendererPolicySha256,
    renderer_resource_sha256: effectiveRendererResourceSha256,
    storage_path_sha256: inputIdentity.storagePathSha256,
    filename: inputIdentity.filename,
  };
  return {
    ...inputIdentity,
    bindingVersion: LEGACY_PDF_BINDING_VERSION,
    rendererPolicySha256,
    rendererResourceSha256: effectiveRendererResourceSha256,
    bindingSha256: await sha256Canonical(bindingIdentity),
    rendererVersion: LEGACY_PDF_RENDERER_VERSION,
  };
}

export async function createLegacyPdfExportBinding(
  input: LegacyPdfExportBindingInput,
): Promise<LegacyPdfExportBinding> {
  const inputIdentity = await createLegacyPdfExportInputIdentity(input);
  const rendererPolicySha256 = await sha256Canonical({
    renderer_version: LEGACY_PDF_RENDERER_VERSION,
    inspection_version: LEGACY_INSPECTION_VERSION,
    endpoint: input.renderContract.endpoint,
    origin: input.renderContract.origin,
    timeout_ms: input.renderContract.timeoutMs,
    max_response_bytes: input.renderContract.maxResponseBytes,
  });
  return await completeLegacyPdfExportBinding(
    inputIdentity,
    rendererPolicySha256,
  );
}

export async function restoreLegacyPdfExportBinding(
  value: unknown,
  inputIdentity: LegacyPdfExportInputIdentity,
): Promise<LegacyPdfExportBinding | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_RECEIPT_INVALID");
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.request_id !== inputIdentity.requestId) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_CONFLICT");
  }
  if (receipt.outcome === "not_found") return null;
  if (
    receipt.outcome !== "found" || !receipt.binding ||
    typeof receipt.binding !== "object" || Array.isArray(receipt.binding)
  ) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_RECEIPT_INVALID");
  }
  const binding = receipt.binding as Record<string, unknown>;
  if (
    binding.binding_version !== LEGACY_PDF_BINDING_VERSION ||
    binding.target_kind !== inputIdentity.targetKind ||
    binding.target_id !== inputIdentity.targetId ||
    binding.target_revision !== inputIdentity.targetRevision ||
    binding.approved_revision !== inputIdentity.approvedRevision ||
    binding.target_identity_sha256 !== inputIdentity.targetIdentitySha256 ||
    binding.format !== "pdf" ||
    binding.input_sha256 !== inputIdentity.inputSha256 ||
    binding.html_sha256 !== inputIdentity.htmlSha256 ||
    binding.storage_path !== inputIdentity.storagePath ||
    binding.storage_path_sha256 !== inputIdentity.storagePathSha256 ||
    binding.filename !== inputIdentity.filename
  ) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_CONFLICT");
  }
  const rendererPolicySha256 = String(
    binding.renderer_policy_sha256 ?? "",
  );
  const rendererResourceSha256 = String(
    binding.renderer_resource_sha256 ?? "",
  );
  const bindingSha256 = String(binding.binding_sha256 ?? "");
  if (
    !/^[0-9a-f]{64}$/.test(rendererPolicySha256) ||
    !/^[0-9a-f]{64}$/.test(rendererResourceSha256) ||
    !/^[0-9a-f]{64}$/.test(bindingSha256)
  ) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_RECEIPT_INVALID");
  }
  const restored = await completeLegacyPdfExportBinding(
    inputIdentity,
    rendererPolicySha256,
    rendererResourceSha256,
  );
  if (restored.bindingSha256 !== bindingSha256) {
    throw new Error("LEGACY_PDF_EXPORT_BINDING_RECEIPT_INVALID");
  }
  return restored;
}

export function legacyPdfExportRpcBinding(
  binding: LegacyPdfExportBinding,
): Record<string, unknown> {
  return {
    binding_version: binding.bindingVersion,
    binding_sha256: binding.bindingSha256,
    target_kind: binding.targetKind,
    target_id: binding.targetId,
    target_revision: binding.targetRevision,
    approved_revision: binding.approvedRevision,
    target_identity_sha256: binding.targetIdentitySha256,
    format: binding.format,
    input_sha256: binding.inputSha256,
    html_sha256: binding.htmlSha256,
    renderer_policy_sha256: binding.rendererPolicySha256,
    renderer_resource_sha256: binding.rendererResourceSha256,
    storage_path: binding.storagePath,
    storage_path_sha256: binding.storagePathSha256,
    filename: binding.filename,
  };
}

function validInspectionReceipt(
  validation: Record<string, unknown>,
  byteLength: number,
  expectation?: CapturedPdfInspectionExpectation,
): boolean {
  const checks = validation.checks;
  if (!checks || typeof checks !== "object" || Array.isArray(checks)) {
    return false;
  }
  const checkRecord = checks as Record<string, unknown>;
  const commonValid = validation.passed === true &&
    validation.artifact_inspected === true &&
    validation.inspection_contract ===
      (expectation?.version ?? LEGACY_INSPECTION_VERSION) &&
    validation.content_type === "application/pdf" &&
    validation.byte_length === byteLength &&
    (!expectation || (
      typeof validation.artifact_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(validation.artifact_sha256)
    )) &&
    typeof validation.content_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(validation.content_sha256) &&
    typeof validation.section_order_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(validation.section_order_sha256) &&
    [
      "transport_envelope",
      "inspection_version",
      "renderer_status",
      "renderer_structural",
      "content_matches",
      "section_order_matches",
      "artifact_hash_matches",
    ].every((key) => checkRecord[key] === true);
  if (!commonValid) return false;
  if (!expectation?.brand) return true;
  const brand = expectation.brand;
  return validation.brand_snapshot_version === brand.snapshotVersion &&
    validation.brand_snapshot_sha256 === brand.snapshotSha256 &&
    validation.brand_present === brand.brandPresent &&
    validation.brand_logo_storage_path === brand.logoStoragePath &&
    validation.brand_logo_sha256 === brand.logoContentSha256 &&
    validation.brand_logo_media_type === brand.logoMediaType &&
    validation.brand_logo_byte_length === brand.logoByteLength &&
    validation.brand_footer_sha256 === brand.footerSha256 &&
    validation.brand_primary_colour === brand.primaryColour &&
    validation.brand_secondary_colour === brand.secondaryColour &&
    validation.brand_evidence_sha256 === brand.brandEvidenceSha256 &&
    [
      "brand_snapshot_matches",
      "brand_logo_matches",
      "brand_footer_matches",
      "brand_colours_match",
    ].every((key) => checkRecord[key] === true);
}

export function classifyLegacyPdfExportReceipt(
  value: unknown,
  expected: LegacyPdfReceiptIdentity,
): LegacyPdfExportReceiptState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LEGACY_PDF_EXPORT_RECEIPT_INVALID");
  }
  const receipt = value as Record<string, unknown>;
  if (
    receipt.request_id !== expected.requestId ||
    receipt.binding_sha256 !== expected.bindingSha256
  ) {
    throw new Error("LEGACY_PDF_EXPORT_RECEIPT_CONFLICT");
  }
  const outcome = String(receipt.outcome ?? "");
  if (outcome === "requested") return { state: "requested" };
  if (outcome === "processing") {
    const retryAfterSeconds = Number(receipt.retry_after_seconds);
    if (
      !Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 ||
      retryAfterSeconds > 30
    ) {
      throw new Error("LEGACY_PDF_EXPORT_RECEIPT_INVALID");
    }
    return { state: "processing", retryAfterSeconds };
  }
  if (outcome === "reconciliation_required") {
    return { state: "reconciliation_required" };
  }

  const artifactSha256 = String(receipt.artifact_sha256 ?? "");
  const artifactByteLength = Number(receipt.artifact_byte_length);
  const rendererVersion = String(receipt.renderer_version ?? "");
  const artifactValidationResult = receipt.artifact_validation_result;
  if (
    !["storage_recovery", "completed"].includes(outcome) ||
    receipt.storage_path !== expected.storagePath ||
    !/^[0-9a-f]{64}$/.test(artifactSha256) ||
    !Number.isInteger(artifactByteLength) || artifactByteLength < 100 ||
    artifactByteLength > DEFAULT_MAX_RESPONSE_BYTES ||
    rendererVersion !== LEGACY_PDF_RENDERER_VERSION ||
    !artifactValidationResult ||
    typeof artifactValidationResult !== "object" ||
    Array.isArray(artifactValidationResult) ||
    !validInspectionReceipt(
      artifactValidationResult as Record<string, unknown>,
      artifactByteLength,
    )
  ) {
    throw new Error("LEGACY_PDF_EXPORT_RECEIPT_INVALID");
  }
  const stored = {
    storagePath: expected.storagePath,
    artifactSha256,
    artifactByteLength,
    rendererVersion,
    artifactValidationResult: artifactValidationResult as Record<
      string,
      unknown
    >,
  };
  if (outcome === "storage_recovery") {
    const storageState = String(receipt.storage_state ?? "");
    const dispatchToken = receipt.storage_dispatch_token;
    if (
      !["dispatched", "completed"].includes(storageState) ||
      (storageState === "dispatched" &&
        (typeof dispatchToken !== "string" ||
          !UUID_PATTERN.test(dispatchToken))) ||
      (storageState === "completed" && dispatchToken !== null)
    ) {
      throw new Error("LEGACY_PDF_EXPORT_RECEIPT_INVALID");
    }
    return {
      state: "storage_recovery",
      ...stored,
      storageState: storageState as "dispatched" | "completed",
      storageDispatchToken: storageState === "dispatched"
        ? dispatchToken as string
        : null,
    };
  }
  if (
    typeof receipt.history_id !== "string" ||
    !UUID_PATTERN.test(receipt.history_id)
  ) {
    throw new Error("LEGACY_PDF_EXPORT_RECEIPT_INVALID");
  }
  return {
    state: "completed",
    ...stored,
    historyId: receipt.history_id,
  };
}

export function classifyCapturedExportReceipt(
  value: unknown,
  expected: CapturedReceiptIdentity,
): CapturedExportReceiptState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CAPTURED_EXPORT_RECEIPT_INVALID");
  }
  const receipt = value as Record<string, unknown>;
  if (
    receipt.export_id !== expected.exportId ||
    receipt.operation_id !== expected.operationId
  ) {
    throw new Error("CAPTURED_EXPORT_RECEIPT_INVALID");
  }
  const outcome = String(receipt.outcome ?? "");
  if (outcome === "requested") return { state: "requested" };
  if (outcome === "processing") {
    const retryAfterSeconds = Number(receipt.retry_after_seconds);
    if (
      !Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 1 ||
      retryAfterSeconds > 30
    ) {
      throw new Error("CAPTURED_EXPORT_RECEIPT_INVALID");
    }
    return { state: "processing", retryAfterSeconds };
  }
  if (outcome === "reconciliation_required") {
    return { state: "reconciliation_required" };
  }
  const validation = receipt.artifact_validation_result;
  const validationRecord = validation && typeof validation === "object" &&
      !Array.isArray(validation)
    ? validation as Record<string, unknown>
    : null;
  const artifactSha256 = String(receipt.artifact_sha256 ?? "");
  const artifactByteLength = outcome === "storage_recovery"
    ? Number(receipt.artifact_byte_length)
    : Number(validationRecord?.byte_length);
  const rendererVersion = String(receipt.renderer_version ?? "");
  if (
    !["storage_recovery", "completed"].includes(outcome) ||
    (outcome === "completed" && receipt.status !== "created") ||
    receipt.storage_path !== expected.storagePath ||
    !/^[0-9a-f]{64}$/.test(artifactSha256) ||
    !Number.isInteger(artifactByteLength) || artifactByteLength < 100 ||
    artifactByteLength > DEFAULT_MAX_RESPONSE_BYTES ||
    rendererVersion.trim() === "" || !validationRecord ||
    validationRecord.passed !== true ||
    validationRecord.artifact_inspected !== true ||
    (expected.inspectionExpectation
      ? !validInspectionReceipt(
        validationRecord,
        artifactByteLength,
        expected.inspectionExpectation,
      ) || validationRecord.artifact_sha256 !== artifactSha256
      : false)
  ) {
    throw new Error("CAPTURED_EXPORT_RECEIPT_INVALID");
  }
  const stored = {
    storagePath: expected.storagePath,
    artifactSha256,
    artifactByteLength,
    rendererVersion,
    artifactValidationResult: validationRecord,
  };
  if (outcome === "storage_recovery") {
    const expectedOperationRevision = Number(
      receipt.expected_operation_revision,
    );
    const storageState = String(receipt.storage_state ?? "");
    const storageDispatchToken = receipt.storage_dispatch_token;
    if (
      !expected.inspectionExpectation ||
      rendererVersion !== "render-export.pdf.4" ||
      !Number.isInteger(expectedOperationRevision) ||
      expectedOperationRevision < 1 ||
      !["dispatched", "completed"].includes(storageState) ||
      (storageState === "dispatched" &&
        (typeof storageDispatchToken !== "string" ||
          !UUID_PATTERN.test(storageDispatchToken))) ||
      (storageState === "completed" && storageDispatchToken !== null)
    ) {
      throw new Error("CAPTURED_EXPORT_RECEIPT_INVALID");
    }
    return {
      state: "storage_recovery",
      ...stored,
      expectedOperationRevision,
      storageState: storageState as "dispatched" | "completed",
      storageDispatchToken: storageState === "dispatched"
        ? storageDispatchToken as string
        : null,
    };
  }
  return { state: "completed", ...stored };
}

export function artifactBytes(payload: ArrayBuffer | string): Uint8Array {
  return typeof payload === "string"
    ? new TextEncoder().encode(payload)
    : new Uint8Array(payload);
}

export function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedBuffer(bytes));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function hasPdfTransportEnvelope(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 100) return false;
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  const tail = new TextDecoder().decode(bytes.slice(-1024));
  return head === "%PDF-" && tail.includes("%%EOF");
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }
  return parsed;
}

function isPublicDnsHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !normalized.includes(".") ||
    normalized.includes(":") ||
    /^\d+(?:\.\d+){3}$/.test(normalized)
  ) {
    return false;
  }
  if (
    [
      ".local",
      ".localhost",
      ".internal",
      ".lan",
      ".home",
      ".test",
      ".invalid",
      ".example",
    ].some((suffix) => normalized.endsWith(suffix))
  ) {
    return false;
  }
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
    normalized,
  );
}

export function validateRenderServiceContract(input: {
  serviceUrl?: string;
  allowedOrigin?: string;
  timeoutMs?: string;
  maxResponseBytes?: string;
}): RenderServiceContract | null {
  const rawServiceUrl = input.serviceUrl?.trim() ?? "";
  const rawAllowedOrigin = input.allowedOrigin?.trim() ?? "";
  if (!rawServiceUrl && !rawAllowedOrigin) return null;
  if (!rawServiceUrl || !rawAllowedOrigin) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }

  let endpoint: URL;
  let allowed: URL;
  try {
    endpoint = new URL(rawServiceUrl);
    allowed = new URL(rawAllowedOrigin);
  } catch {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }
  const hasCredentials = (value: URL) =>
    Boolean(value.username || value.password);
  if (
    endpoint.protocol !== "https:" ||
    allowed.protocol !== "https:" ||
    hasCredentials(endpoint) ||
    hasCredentials(allowed) ||
    !isPublicDnsHostname(endpoint.hostname) ||
    !isPublicDnsHostname(allowed.hostname) ||
    endpoint.origin !== allowed.origin ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    allowed.pathname !== "/" ||
    allowed.search !== "" ||
    allowed.hash !== ""
  ) {
    throw new Error("RENDER_SERVICE_CONFIGURATION_INVALID");
  }

  return {
    endpoint: endpoint.toString(),
    origin: allowed.origin,
    timeoutMs: boundedInteger(
      input.timeoutMs,
      DEFAULT_RENDER_TIMEOUT_MS,
      1_000,
      MAX_RENDER_TIMEOUT_MS,
    ),
    maxResponseBytes: boundedInteger(
      input.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      DEFAULT_MAX_RESPONSE_BYTES,
    ),
  };
}

export function validateCapturedExportStorageContract(input: {
  baseUrl?: string;
  serviceRoleKey?: string;
  timeoutMs?: string;
}): CapturedExportStorageContract {
  const baseUrl = input.baseUrl?.trim() ?? "";
  const serviceRoleKey = input.serviceRoleKey?.trim() ?? "";
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("PRIVATE_STORAGE_CONFIGURATION_INVALID");
  }
  return {
    baseUrl,
    serviceRoleKey,
    timeoutMs: boundedInteger(
      input.timeoutMs,
      DEFAULT_STORAGE_TIMEOUT_MS,
      1_000,
      MAX_STORAGE_TIMEOUT_MS,
    ),
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
  };
}

function capturedStorageObjectUrl(
  baseUrl: string,
  bucket: string,
  path: string,
): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("PRIVATE_STORAGE_CONFIGURATION_INVALID");
  }
  const localHttp = base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !localHttp) || base.username ||
    base.password || base.search || base.hash ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(bucket)
  ) {
    throw new Error("PRIVATE_STORAGE_CONFIGURATION_INVALID");
  }
  const segments = path.split("/");
  if (
    segments.length < 3 || !UUID_PATTERN.test(segments[0] ?? "") ||
    !UUID_PATTERN.test(segments[1] ?? "") ||
    segments.some((segment) =>
      !segment || segment === "." || segment === ".." || segment.includes("\\")
    )
  ) {
    throw new Error("PRIVATE_STORAGE_PATH_INVALID");
  }
  return new URL(
    "/storage/v1/object/" + encodeURIComponent(bucket) + "/" +
      segments.map(encodeURIComponent).join("/"),
    base.origin,
  );
}

async function readBoundedStorageBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    throw new Error("PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new Error("PRIVATE_STORAGE_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
        throw new Error("PRIVATE_STORAGE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function requestCapturedExportStorageObject(
  input: CapturedExportStorageRequest,
  fetcher: RenderFetcher = fetch,
): Promise<Uint8Array | null> {
  if (
    !input.serviceRoleKey || !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 || input.timeoutMs > MAX_STORAGE_TIMEOUT_MS ||
    !Number.isSafeInteger(input.maximumResponseBytes) ||
    input.maximumResponseBytes < 0 ||
    input.maximumResponseBytes > DEFAULT_MAX_RESPONSE_BYTES
  ) {
    throw new Error("PRIVATE_STORAGE_CONFIGURATION_INVALID");
  }
  if (
    input.method === "POST" &&
    (!input.bytes || !input.contentType || input.maximumResponseBytes !== 0)
  ) {
    throw new Error("PRIVATE_STORAGE_REQUEST_INVALID");
  }
  if (input.method === "GET" && input.maximumResponseBytes === 0) {
    throw new Error("PRIVATE_STORAGE_REQUEST_INVALID");
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromCaller();
  else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetcher(
      capturedStorageObjectUrl(input.baseUrl, input.bucket, input.path),
      {
        method: input.method,
        headers: {
          Authorization: "Bearer " + input.serviceRoleKey,
          apikey: input.serviceRoleKey,
          ...(input.method === "POST"
            ? {
              "Content-Type": input.contentType!,
              "cache-control": "max-age=3600",
              "x-upsert": "false",
            }
            : {}),
        },
        body: input.method === "POST"
          ? Uint8Array.from(input.bytes!).buffer
          : undefined,
        signal: controller.signal,
        redirect: "error",
      },
    );
    if (!response.ok) {
      if (input.method === "GET" && response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      await response.body?.cancel();
      throw new Error("PRIVATE_STORAGE_REQUEST_FAILED");
    }
    if (input.method === "POST") {
      await response.body?.cancel();
      return null;
    }
    return await readBoundedStorageBytes(response, input.maximumResponseBytes);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new Error("RENDER_SERVICE_RESPONSE_INVALID");
    }
    if (Number(contentLength) > maximumBytes) {
      throw new Error("RENDER_SERVICE_RESPONSE_TOO_LARGE");
    }
  }
  if (!response.body) throw new Error("RENDER_SERVICE_RESPONSE_INVALID");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("RENDER_SERVICE_RESPONSE_TOO_LARGE");
        throw new Error("RENDER_SERVICE_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function requestRenderedPdf(
  contract: RenderServiceContract,
  request: Record<string, unknown>,
  fetcher: RenderFetcher = fetch,
  dispatchLease?: RenderDispatchLease,
): Promise<RenderedPdfRequestResult> {
  let renderTimeoutMs = contract.timeoutMs;
  if (dispatchLease) {
    const leaseExpiresAtMs = dispatchLease.leaseExpiresAt.length <= 64
      ? Date.parse(dispatchLease.leaseExpiresAt)
      : Number.NaN;
    const nowMs = (dispatchLease.now ?? Date.now)();
    const remainingMs = leaseExpiresAtMs - nowMs;
    if (
      !Number.isFinite(leaseExpiresAtMs) || !Number.isFinite(nowMs) ||
      remainingMs < contract.timeoutMs + RENDER_DISPATCH_START_SAFETY_MS
    ) {
      // The durable database lease is the authority to start external work.
      // A stale or suspended claimant must fail before fetch is invoked.
      return { state: "definitive_terminal_failure" };
    }
    renderTimeoutMs = Math.min(
      contract.timeoutMs,
      Math.max(
        1,
        Math.floor(remainingMs - RENDER_DISPATCH_START_SAFETY_MS),
      ),
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), renderTimeoutMs);
  try {
    const response = await fetcher(contract.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
      redirect: "error",
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.toLowerCase().startsWith(
        "application/pdf",
      )
    ) {
      await response.body?.cancel();
      return { state: "definitive_terminal_failure" };
    }
    return {
      state: "success",
      bytes: await readBoundedResponseBytes(
        response,
        contract.maxResponseBytes,
      ),
      headers: response.headers,
    };
  } catch {
    // Once fetch has been attempted, a timeout, abort, connection loss, or
    // truncated response cannot prove that the remote renderer stopped
    // processing. The durable egress receipt must remain deletion-blocking.
    return { state: "ambiguous_after_dispatch" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createCapturedPdfInspectionExpectation(
  title: string,
  sections: ExpectedSection[],
  brand?: CapturedBrandInspectionExpectation,
): Promise<CapturedPdfInspectionExpectation> {
  const canonicalSections = sections.map((section) => ({
    name: section.name,
    content: section.content,
    order_index: section.order_index,
  }));
  const contentSha256 = await sha256Hex(
    artifactBytes(JSON.stringify({ title, sections: canonicalSections })),
  );
  const sectionOrderSha256 = await sha256Hex(
    artifactBytes(JSON.stringify(canonicalSections.map((section) => ({
      name: section.name,
      order_index: section.order_index,
    })))),
  );
  return {
    version: brand ? CAPTURED_INSPECTION_VERSION : LEGACY_INSPECTION_VERSION,
    contentSha256,
    sectionOrderSha256,
    source: { title, sections: canonicalSections },
    ...(brand ? { brand } : {}),
  };
}

export async function inspectCapturedPdfArtifact(
  bytes: Uint8Array,
  rendererHeaders: Headers,
  expectation: CapturedPdfInspectionExpectation,
): Promise<CapturedPdfInspectionResult> {
  // The approved TLS renderer is the inspection authority: it must parse the
  // produced PDF, compare extracted content and section order with the exact
  // `expected_document` request, then return all evidence headers below. The
  // local signature/EOF envelope is only transport sanity and cannot pass on
  // its own.
  const artifactSha256 = await sha256Hex(bytes);
  const commonChecks = {
    transport_envelope: hasPdfTransportEnvelope(bytes),
    inspection_version: rendererHeaders.get("x-prompted-inspection-version") ===
      expectation.version,
    renderer_status:
      rendererHeaders.get("x-prompted-inspection-status") === "passed",
    renderer_structural:
      rendererHeaders.get("x-prompted-pdf-structure") === "passed",
    content_matches: rendererHeaders.get("x-prompted-content-sha256") ===
      expectation.contentSha256,
    section_order_matches:
      rendererHeaders.get("x-prompted-section-order-sha256") ===
        expectation.sectionOrderSha256,
    artifact_hash_matches:
      rendererHeaders.get("x-prompted-artifact-sha256") === artifactSha256,
  };
  const brand = expectation.brand;
  const brandChecks = brand
    ? {
      brand_snapshot_matches:
        rendererHeaders.get("x-prompted-brand-snapshot-status") === "passed" &&
        rendererHeaders.get("x-prompted-brand-snapshot-sha256") ===
          brand.snapshotSha256 &&
        rendererHeaders.get("x-prompted-brand-evidence-sha256") ===
          brand.brandEvidenceSha256,
      brand_logo_matches:
        rendererHeaders.get("x-prompted-brand-logo-status") === "passed" &&
        rendererHeaders.get("x-prompted-brand-logo-sha256") ===
          (brand.logoContentSha256 ?? "null"),
      brand_footer_matches:
        rendererHeaders.get("x-prompted-brand-footer-status") === "passed" &&
        rendererHeaders.get("x-prompted-brand-footer-sha256") ===
          (brand.footerSha256 ?? "null"),
      brand_colours_match:
        rendererHeaders.get("x-prompted-brand-colours-status") === "passed" &&
        rendererHeaders.get("x-prompted-brand-primary-colour") ===
          (brand.primaryColour ?? "null") &&
        rendererHeaders.get("x-prompted-brand-secondary-colour") ===
          (brand.secondaryColour ?? "null"),
    }
    : {};
  const checks = { ...commonChecks, ...brandChecks };
  const passed = Object.values(checks).every(Boolean);
  return {
    passed,
    artifactInspected: passed,
    artifactSha256,
    validationResult: {
      passed,
      artifact_inspected: passed,
      inspection_contract: expectation.version,
      artifact_sha256: artifactSha256,
      byte_length: bytes.byteLength,
      content_sha256: expectation.contentSha256,
      section_order_sha256: expectation.sectionOrderSha256,
      ...(brand
        ? {
          brand_snapshot_version: brand.snapshotVersion,
          brand_snapshot_sha256: brand.snapshotSha256,
          brand_present: brand.brandPresent,
          brand_logo_storage_path: brand.logoStoragePath,
          brand_logo_sha256: brand.logoContentSha256,
          brand_logo_media_type: brand.logoMediaType,
          brand_logo_byte_length: brand.logoByteLength,
          brand_footer_sha256: brand.footerSha256,
          brand_primary_colour: brand.primaryColour,
          brand_secondary_colour: brand.secondaryColour,
          brand_evidence_sha256: brand.brandEvidenceSha256,
        }
        : {}),
      checks,
    },
  };
}

export async function inspectStoredCapturedPdfArtifact(
  bytes: Uint8Array,
  expectedArtifactSha256: string,
  storedValidation: Record<string, unknown>,
  expectation: CapturedPdfInspectionExpectation,
): Promise<CapturedPdfInspectionResult> {
  const artifactSha256 = await sha256Hex(bytes);
  const priorChecks =
    storedValidation.checks && typeof storedValidation.checks === "object" &&
      !Array.isArray(storedValidation.checks)
      ? storedValidation.checks as Record<string, unknown>
      : {};
  const commonChecks = {
    transport_envelope: hasPdfTransportEnvelope(bytes),
    inspection_version:
      storedValidation.inspection_contract === expectation.version &&
      priorChecks.inspection_version === true,
    renderer_status: priorChecks.renderer_status === true,
    renderer_structural: priorChecks.renderer_structural === true,
    content_matches:
      storedValidation.content_sha256 === expectation.contentSha256 &&
      priorChecks.content_matches === true,
    section_order_matches: storedValidation.section_order_sha256 ===
        expectation.sectionOrderSha256 &&
      priorChecks.section_order_matches === true,
    artifact_hash_matches: artifactSha256 === expectedArtifactSha256 &&
      storedValidation.artifact_sha256 === expectedArtifactSha256 &&
      priorChecks.artifact_hash_matches === true,
  };
  const brand = expectation.brand;
  const brandChecks = brand
    ? {
      brand_snapshot_matches:
        storedValidation.brand_snapshot_version === brand.snapshotVersion &&
        storedValidation.brand_snapshot_sha256 === brand.snapshotSha256 &&
        storedValidation.brand_present === brand.brandPresent &&
        storedValidation.brand_evidence_sha256 === brand.brandEvidenceSha256 &&
        priorChecks.brand_snapshot_matches === true,
      brand_logo_matches:
        storedValidation.brand_logo_storage_path === brand.logoStoragePath &&
        storedValidation.brand_logo_sha256 === brand.logoContentSha256 &&
        storedValidation.brand_logo_media_type === brand.logoMediaType &&
        storedValidation.brand_logo_byte_length === brand.logoByteLength &&
        priorChecks.brand_logo_matches === true,
      brand_footer_matches:
        storedValidation.brand_footer_sha256 === brand.footerSha256 &&
        priorChecks.brand_footer_matches === true,
      brand_colours_match:
        storedValidation.brand_primary_colour === brand.primaryColour &&
        storedValidation.brand_secondary_colour === brand.secondaryColour &&
        priorChecks.brand_colours_match === true,
    }
    : {};
  const checks = { ...commonChecks, ...brandChecks };
  const passed = storedValidation.passed === true &&
    storedValidation.artifact_inspected === true &&
    storedValidation.byte_length === bytes.byteLength &&
    Object.values(checks).every(Boolean);
  return {
    passed,
    artifactInspected: passed,
    artifactSha256,
    validationResult: {
      passed,
      artifact_inspected: passed,
      inspection_contract: expectation.version,
      artifact_sha256: artifactSha256,
      byte_length: bytes.byteLength,
      content_sha256: expectation.contentSha256,
      section_order_sha256: expectation.sectionOrderSha256,
      ...(brand
        ? {
          brand_snapshot_version: brand.snapshotVersion,
          brand_snapshot_sha256: brand.snapshotSha256,
          brand_present: brand.brandPresent,
          brand_logo_storage_path: brand.logoStoragePath,
          brand_logo_sha256: brand.logoContentSha256,
          brand_logo_media_type: brand.logoMediaType,
          brand_logo_byte_length: brand.logoByteLength,
          brand_footer_sha256: brand.footerSha256,
          brand_primary_colour: brand.primaryColour,
          brand_secondary_colour: brand.secondaryColour,
          brand_evidence_sha256: brand.brandEvidenceSha256,
        }
        : {}),
      checks,
    },
  };
}

export function capturedExportCompletionMatches(
  value: unknown,
  expected: CapturedCompletionIdentity,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const validation = row.artifact_validation_result;
  return row.status === "created" &&
    row.export_id === expected.exportId &&
    row.operation_id === expected.operationId &&
    row.storage_path === expected.storagePath &&
    row.artifact_sha256 === expected.artifactSha256 &&
    row.renderer_version === expected.rendererVersion &&
    Boolean(
      validation && typeof validation === "object" &&
        !Array.isArray(validation) &&
        (validation as Record<string, unknown>).passed === true &&
        (validation as Record<string, unknown>).artifact_inspected === true,
    );
}

export async function reconcileCapturedExportCompletion(
  complete: () => Promise<{ data: unknown; error: unknown }>,
  expected: CapturedCompletionIdentity,
): Promise<{ completed: boolean; attempts: number }> {
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    const { data, error } = await complete();
    if (!error && capturedExportCompletionMatches(data, expected)) {
      return { completed: true, attempts };
    }
  }
  return { completed: false, attempts: 2 };
}

export function capturedExportStoragePath(
  userId: string,
  exportId: string,
  filename: string,
): string {
  if (
    !UUID_PATTERN.test(userId) ||
    !UUID_PATTERN.test(exportId) ||
    !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(filename)
  ) {
    throw new Error("CAPTURED_EXPORT_STORAGE_IDENTITY_INVALID");
  }
  return `${userId}/${exportId}/${filename}`;
}
