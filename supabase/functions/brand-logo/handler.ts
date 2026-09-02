// deno-lint-ignore-file no-import-prefix
import type { AuthContext } from "../_shared/auth-guard.ts";
import { jsonResponse } from "../_shared/cors.ts";
import {
  BrandKitOperationInputError,
  type BrandLogoAction,
  prepareBrandKitOperation,
} from "../../../packages/shared/src/brand-kit-operation.ts";
import {
  BrandLogoImageError,
  validateBrandLogoImage,
} from "../_shared/brand-logo-image.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V8_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BRAND_PATH_PATTERN =
  /^brand-kits\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(?:logo[.](?:png|jpg|webp)|logos\/[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](?:png|jpg|webp))$/;

export interface BrandLogoClaimInput {
  userId: string;
  operationId: string;
  businessId: string;
  expectedRevision: number;
  bindingSha256: string;
  action: BrandLogoAction;
  primaryColour: string;
  secondaryColour: string | null;
  footerText: string | null;
  contentSha256: string | null;
  byteLength: number | null;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | null;
}

export interface BrandLogoClaimReceipt {
  outcome: "accepted" | "resumed" | "completed" | "failed" | "cancelled";
  operation_id: string;
  state:
    | "accepted"
    | "storage_verified"
    | "activated"
    | "reconciliation_required"
    | "completed"
    | "failed"
    | "cancelled";
  claim_token: string;
  publish_dispatch_token: string;
  delete_dispatch_token: string;
  business_id: string;
  action: BrandLogoAction;
  expected_revision: number;
  new_storage_path: string | null;
  new_content_sha256: string | null;
  new_byte_length: number | null;
  new_media_type: "image/png" | "image/jpeg" | "image/webp" | null;
  old_storage_paths: string[];
  reconciliation_code: "storage_bytes_mismatch" | null;
  observed_content_sha256: string | null;
  observed_byte_length: number | null;
  reconciliation_evidence_sha256: string | null;
  terminal_http_status: number | null;
  terminal_response: Record<string, unknown> | null;
}

interface StorageDispatchInput {
  userId: string;
  operationId: string;
  kind: "brand-logo-publish" | "brand-logo-delete";
  storagePathSha256: string;
  artifactSha256: string;
  dispatchToken: string;
}

export interface BrandLogoDependencies {
  claim(input: BrandLogoClaimInput): Promise<BrandLogoClaimReceipt>;
  claimStorageDispatch(
    input: StorageDispatchInput,
  ): Promise<{ storage_permitted: boolean }>;
  completeStorageDispatch(input: StorageDispatchInput): Promise<void>;
  publish(input: {
    path: string;
    bytes: Uint8Array;
    mediaType: string;
    contentSha256: string;
    operationId: string;
    upsert: false;
  }): Promise<"uploaded" | "exists">;
  read(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<void>;
  recordVerified(input: {
    userId: string;
    operationId: string;
    claimToken: string;
    storagePath: string;
    contentSha256: string;
    byteLength: number;
    mediaType: string;
  }): Promise<void>;
  activate(input: {
    userId: string;
    operationId: string;
    claimToken: string;
    logoUrl: string;
  }): Promise<void>;
  markReconciliation(input: {
    userId: string;
    operationId: string;
    claimToken: string;
    observedContentSha256: string | null;
    observedByteLength: number | null;
    reconciliationEvidenceSha256: string;
  }): Promise<void>;
  resolveReconciliation(input: {
    userId: string;
    operationId: string;
    claimToken: string;
    resolution: "failed" | "cancelled";
    cleanupEvidenceSha256: string;
  }): Promise<Record<string, unknown>>;
  complete(input: {
    userId: string;
    operationId: string;
    claimToken: string;
    action: BrandLogoAction;
    cleanupEvidenceSha256: string;
  }): Promise<Record<string, unknown>>;
  publicUrl(path: string): string;
}

class BrandLogoFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  if (typeof value !== "string") {
    throw new BrandLogoFailure(
      400,
      "BRAND_LOGO_REQUEST_INVALID",
      "The brand-kit save request is incomplete.",
      false,
    );
  }
  return value;
}

function exactRevision(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new BrandLogoFailure(
      400,
      "BRAND_KIT_REVISION_INVALID",
      "Reload the brand kit before saving again.",
      false,
    );
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new BrandLogoFailure(
      400,
      "BRAND_KIT_REVISION_INVALID",
      "Reload the brand kit before saving again.",
      false,
    );
  }
  return revision;
}

function validReceipt(
  value: BrandLogoClaimReceipt,
  input: BrandLogoClaimInput,
): BrandLogoClaimReceipt {
  if (
    !value ||
    !["accepted", "resumed", "completed", "failed", "cancelled"].includes(
      value.outcome,
    ) ||
    ![
      "accepted",
      "storage_verified",
      "activated",
      "reconciliation_required",
      "completed",
      "failed",
      "cancelled",
    ].includes(value.state) ||
    value.operation_id !== input.operationId ||
    value.business_id !== input.businessId || value.action !== input.action ||
    value.expected_revision !== input.expectedRevision ||
    !UUID_PATTERN.test(value.claim_token) ||
    !UUID_PATTERN.test(value.publish_dispatch_token) ||
    !UUID_PATTERN.test(value.delete_dispatch_token) ||
    !Array.isArray(value.old_storage_paths) ||
    value.old_storage_paths.length > 20 ||
    value.old_storage_paths.some((path) => {
      const match = BRAND_PATH_PATTERN.exec(path);
      return !match || match[1] !== input.businessId;
    })
  ) {
    throw new BrandLogoFailure(
      500,
      "BRAND_LOGO_RECEIPT_INVALID",
      "The brand-kit operation could not be verified.",
      true,
    );
  }
  if (input.action === "replace") {
    const expectedExtension = input.mediaType === "image/jpeg"
      ? "jpg"
      : input.mediaType?.split("/")[1];
    const expectedPath =
      `brand-kits/${input.businessId}/logos/${input.operationId}.${expectedExtension}`;
    if (
      value.new_storage_path !== expectedPath ||
      value.new_content_sha256 !== input.contentSha256 ||
      value.new_byte_length !== input.byteLength ||
      value.new_media_type !== input.mediaType
    ) {
      throw new BrandLogoFailure(
        409,
        "BRAND_LOGO_OPERATION_CONFLICT",
        "This brand-kit save conflicts with an existing operation.",
        false,
      );
    }
  } else if (
    value.new_storage_path !== null || value.new_content_sha256 !== null ||
    value.new_byte_length !== null || value.new_media_type !== null
  ) {
    throw new BrandLogoFailure(
      409,
      "BRAND_LOGO_OPERATION_CONFLICT",
      "This brand-kit save conflicts with an existing operation.",
      false,
    );
  }
  if (
    value.state === "reconciliation_required" &&
    (value.reconciliation_code !== "storage_bytes_mismatch" ||
      !SHA256_PATTERN.test(value.reconciliation_evidence_sha256 ?? "") ||
      ((value.observed_content_sha256 === null) !==
        (value.observed_byte_length === null)) ||
      (value.observed_content_sha256 !== null &&
        (!SHA256_PATTERN.test(value.observed_content_sha256) ||
          !Number.isSafeInteger(value.observed_byte_length) ||
          (value.observed_byte_length ?? 0) < 1)))
  ) {
    throw new BrandLogoFailure(
      500,
      "BRAND_LOGO_RECEIPT_INVALID",
      "The brand-kit reconciliation could not be verified.",
      true,
    );
  }
  if (
    ["completed", "failed", "cancelled"].includes(value.state) &&
    !record(value.terminal_response)
  ) {
    throw new BrandLogoFailure(
      500,
      "BRAND_LOGO_RECEIPT_INVALID",
      "The completed brand kit could not be verified.",
      true,
    );
  }
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const retained = new Uint8Array(bytes.byteLength);
  retained.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", retained.buffer),
  );
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hashText(value: string): Promise<string> {
  return sha256(new TextEncoder().encode(value));
}

function failureFromUnknown(error: unknown): BrandLogoFailure {
  if (error instanceof BrandLogoFailure) return error;
  if (error instanceof BrandLogoImageError) {
    const metadata = error.code === "BRAND_LOGO_METADATA_UNSAFE" ||
      error.code === "BRAND_LOGO_ANIMATION_UNSUPPORTED";
    return new BrandLogoFailure(
      400,
      error.code,
      metadata
        ? "Choose a non-animated logo without embedded metadata."
        : "Choose a valid PNG, JPG or WebP logo.",
      false,
    );
  }
  if (error instanceof BrandKitOperationInputError) {
    return new BrandLogoFailure(
      400,
      error.code,
      "Check the brand-kit fields and try again.",
      false,
    );
  }
  const message = error instanceof Error ? error.message : "";
  const mappings: Array<[string, number, string, string, boolean]> = [
    [
      "BRAND_LOGO_FORBIDDEN",
      403,
      "BRAND_LOGO_FORBIDDEN",
      "You cannot change this business brand kit.",
      false,
    ],
    [
      "BRAND_KIT_NOT_FOUND",
      404,
      "BRAND_KIT_NOT_FOUND",
      "The business brand kit is no longer available.",
      false,
    ],
    [
      "BRAND_KIT_REVISION_CONFLICT",
      409,
      "BRAND_KIT_REVISION_CONFLICT",
      "The brand kit changed. Reload it before saving again.",
      false,
    ],
    [
      "BRAND_LOGO_OPERATION_IN_PROGRESS",
      409,
      "BRAND_LOGO_OPERATION_IN_PROGRESS",
      "A previous brand-kit save is still being reconciled.",
      true,
    ],
    [
      "BRAND_LOGO_OPERATION_CONFLICT",
      409,
      "BRAND_LOGO_OPERATION_CONFLICT",
      "This brand-kit save conflicts with an existing operation.",
      false,
    ],
    [
      "BRAND_LOGO_STORAGE_INVENTORY_REQUIRED",
      409,
      "BRAND_LOGO_STORAGE_INVENTORY_REQUIRED",
      "Existing brand assets need review before they can be changed.",
      false,
    ],
    [
      "ACCOUNT_DELETION_FENCED",
      409,
      "ACCOUNT_DELETION_FENCED",
      "Account deletion has started, so the brand kit cannot be changed.",
      false,
    ],
    [
      "BRAND_LOGO_CLEANUP_INCOMPLETE",
      503,
      "BRAND_LOGO_CLEANUP_INCOMPLETE",
      "The old logo has not been fully retired yet. Try the same save again.",
      true,
    ],
    [
      "BRAND_LOGO_REMOVE_INCOMPLETE",
      503,
      "BRAND_LOGO_REMOVE_INCOMPLETE",
      "The logo has not been fully removed yet. Try the same save again.",
      true,
    ],
  ];
  for (const [needle, status, code, publicMessage, retryable] of mappings) {
    if (message.includes(needle)) {
      return new BrandLogoFailure(status, code, publicMessage, retryable);
    }
  }
  return new BrandLogoFailure(
    503,
    "BRAND_LOGO_OPERATION_UNAVAILABLE",
    "The brand kit could not be saved safely. Try the same save again.",
    true,
  );
}

async function cleanOldPaths(
  dependencies: BrandLogoDependencies,
  receipt: BrandLogoClaimReceipt,
  input: BrandLogoClaimInput,
): Promise<string> {
  const paths = receipt.action === "replace"
    ? receipt.old_storage_paths.filter((path) =>
      path !== receipt.new_storage_path
    )
    : receipt.old_storage_paths;
  const evidence = await hashText(JSON.stringify({
    contract: "prompted.brand-logo-cleanup.v1",
    business_id: input.businessId,
    action: input.action,
    paths,
    retained_path: receipt.action === "replace"
      ? receipt.new_storage_path
      : null,
  }));
  if (paths.length === 0) return evidence;
  const storagePathSha256 = await hashText(JSON.stringify(paths));
  const dispatch: StorageDispatchInput = {
    userId: input.userId,
    operationId: input.operationId,
    kind: "brand-logo-delete",
    storagePathSha256,
    artifactSha256: input.bindingSha256,
    dispatchToken: receipt.delete_dispatch_token,
  };
  const claim = await dependencies.claimStorageDispatch(dispatch);
  if (claim.storage_permitted) await dependencies.remove(paths);
  for (const path of paths) {
    if (await dependencies.read(path) !== null) {
      throw new BrandLogoFailure(
        503,
        "BRAND_LOGO_CLEANUP_INCOMPLETE",
        input.action === "remove"
          ? "The logo has not been fully removed yet. Try the same save again."
          : "The old logo has not been fully retired yet. Try the same save again.",
        true,
      );
    }
  }
  await dependencies.completeStorageDispatch(dispatch);
  return evidence;
}

async function reconciliationEvidence(
  receipt: BrandLogoClaimReceipt,
  observedContentSha256: string | null,
  observedByteLength: number | null,
): Promise<string> {
  return await hashText([
    "prompted.brand-logo-reconciliation.v1",
    receipt.business_id,
    receipt.operation_id,
    receipt.new_content_sha256,
    receipt.new_byte_length,
    observedContentSha256 ?? "~",
    observedByteLength ?? "~",
  ].join("|"));
}

async function resolveRetainedLogoMismatch(
  dependencies: BrandLogoDependencies,
  receipt: BrandLogoClaimReceipt,
  input: BrandLogoClaimInput,
): Promise<Record<string, unknown>> {
  if (!receipt.new_storage_path) {
    throw new BrandLogoFailure(
      500,
      "BRAND_LOGO_RECEIPT_INVALID",
      "The logo reconciliation could not be verified.",
      true,
    );
  }
  const paths = [receipt.new_storage_path];
  const dispatch: StorageDispatchInput = {
    userId: input.userId,
    operationId: input.operationId,
    kind: "brand-logo-delete",
    storagePathSha256: await hashText(JSON.stringify(paths)),
    artifactSha256: input.bindingSha256,
    dispatchToken: receipt.delete_dispatch_token,
  };
  const claim = await dependencies.claimStorageDispatch(dispatch);
  if (claim.storage_permitted) await dependencies.remove(paths);
  if (await dependencies.read(receipt.new_storage_path) !== null) {
    throw new BrandLogoFailure(
      503,
      "BRAND_LOGO_RECONCILIATION_CLEANUP_INCOMPLETE",
      "The conflicting logo bytes could not be retired safely. Retry the same save.",
      true,
    );
  }
  await dependencies.completeStorageDispatch(dispatch);
  const cleanupEvidenceSha256 = await hashText([
    "prompted.brand-logo-mismatch-cleanup.v1",
    input.businessId,
    input.operationId,
    receipt.new_storage_path,
    "absent",
  ].join("|"));
  return await dependencies.resolveReconciliation({
    userId: input.userId,
    operationId: input.operationId,
    claimToken: receipt.claim_token,
    resolution: "failed",
    cleanupEvidenceSha256,
  });
}

function runtimeDependencies(auth: AuthContext): BrandLogoDependencies {
  const rpc = async (name: string, parameters: Record<string, unknown>) => {
    const { data, error } = await auth.admin.rpc(name, parameters);
    if (error) {
      throw new Error(String(error.message ?? "BRAND_LOGO_RPC_FAILED"));
    }
    const result = record(data);
    if (!result) throw new Error("BRAND_LOGO_RPC_INVALID");
    return result;
  };
  return {
    async claim(input) {
      return await rpc("claim_brand_logo_operation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_business_id: input.businessId,
        p_expected_revision: input.expectedRevision,
        p_binding_sha256: input.bindingSha256,
        p_action: input.action,
        p_primary_colour: input.primaryColour,
        p_secondary_colour: input.secondaryColour,
        p_footer_text: input.footerText,
        p_content_sha256: input.contentSha256,
        p_byte_length: input.byteLength,
        p_media_type: input.mediaType,
      }) as unknown as BrandLogoClaimReceipt;
    },
    async claimStorageDispatch(input) {
      const result = await rpc("claim_user_storage_dispatch", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_dispatch_kind: input.kind,
        p_storage_path_sha256: input.storagePathSha256,
        p_artifact_sha256: input.artifactSha256,
        p_dispatch_token: input.dispatchToken,
      });
      return { storage_permitted: result.storage_permitted === true };
    },
    async completeStorageDispatch(input) {
      await rpc("complete_user_storage_dispatch", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_dispatch_kind: input.kind,
        p_storage_path_sha256: input.storagePathSha256,
        p_artifact_sha256: input.artifactSha256,
        p_dispatch_token: input.dispatchToken,
      });
    },
    async publish(input) {
      const { error } = await auth.admin.storage.from("assets").upload(
        input.path,
        input.bytes,
        {
          upsert: input.upsert,
          contentType: input.mediaType,
          cacheControl: "60",
          metadata: {
            content_sha256: input.contentSha256,
            operation_id: input.operationId,
          },
        },
      );
      if (!error) return "uploaded";
      const status = Number(
        (error as { statusCode?: unknown }).statusCode ?? 0,
      );
      const message = String((error as { message?: unknown }).message ?? "");
      if (status === 409 || /already exists|duplicate/i.test(message)) {
        return "exists";
      }
      throw new BrandLogoFailure(
        503,
        "BRAND_LOGO_STORAGE_UNAVAILABLE",
        "The logo could not be retained safely. Try the same save again.",
        true,
      );
    },
    async read(path) {
      const { data, error } = await auth.admin.storage.from("assets").download(
        path,
      );
      if (!error && data) return new Uint8Array(await data.arrayBuffer());
      const status = Number(
        (error as { statusCode?: unknown } | null)?.statusCode ?? 0,
      );
      const message = String(
        (error as { message?: unknown } | null)?.message ?? "",
      );
      if (
        (status === 400 || status === 404) &&
        /not found|does not exist/i.test(message)
      ) {
        return null;
      }
      throw new BrandLogoFailure(
        503,
        "BRAND_LOGO_STORAGE_UNAVAILABLE",
        "Brand Storage could not be verified. Try the same save again.",
        true,
      );
    },
    async remove(paths) {
      const { error } = await auth.admin.storage.from("assets").remove(paths);
      if (error) {
        throw new BrandLogoFailure(
          503,
          "BRAND_LOGO_STORAGE_UNAVAILABLE",
          "The old logo could not be retired safely. Try the same save again.",
          true,
        );
      }
    },
    async recordVerified(input) {
      await rpc("record_brand_logo_storage_verified", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_claim_token: input.claimToken,
        p_storage_path: input.storagePath,
        p_content_sha256: input.contentSha256,
        p_byte_length: input.byteLength,
        p_media_type: input.mediaType,
      });
    },
    async activate(input) {
      await rpc("activate_brand_logo_operation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_claim_token: input.claimToken,
        p_logo_url: input.logoUrl,
      });
    },
    async markReconciliation(input) {
      await rpc("mark_brand_logo_reconciliation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_claim_token: input.claimToken,
        p_observed_content_sha256: input.observedContentSha256,
        p_observed_byte_length: input.observedByteLength,
        p_reconciliation_evidence_sha256: input.reconciliationEvidenceSha256,
      });
    },
    async resolveReconciliation(input) {
      return await rpc("resolve_brand_logo_reconciliation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_claim_token: input.claimToken,
        p_resolution: input.resolution,
        p_cleanup_evidence_sha256: input.cleanupEvidenceSha256,
      });
    },
    async complete(input) {
      return await rpc("complete_brand_logo_operation", {
        p_user_id: input.userId,
        p_operation_id: input.operationId,
        p_claim_token: input.claimToken,
        p_cleanup_evidence_sha256: input.cleanupEvidenceSha256,
      });
    },
    publicUrl(path) {
      return auth.admin.storage.from("assets").getPublicUrl(path).data
        .publicUrl;
    },
  };
}

export async function handleBrandLogo(
  req: Request,
  auth: AuthContext,
  dependencies: BrandLogoDependencies = runtimeDependencies(auth),
): Promise<Response> {
  const origin = req.headers.get("origin");
  try {
    const form = auth.multipartBody;
    if (!form) {
      throw new BrandLogoFailure(
        400,
        "BRAND_LOGO_REQUEST_INVALID",
        "A brand-kit save form is required.",
        false,
      );
    }
    const action = textField(form, "logo_action") as BrandLogoAction;
    const fileValue = form.get("file");
    const file = fileValue instanceof File ? fileValue : null;
    let bytes: Uint8Array | null = null;
    let mediaType: "image/png" | "image/jpeg" | "image/webp" | null = null;
    if (file) {
      bytes = new Uint8Array(await file.arrayBuffer());
      mediaType = validateBrandLogoImage(bytes, file.type).mediaType;
    }
    const prepared = await prepareBrandKitOperation({
      ownerUserId: auth.userId,
      businessId: textField(form, "business_id"),
      expectedRevision: exactRevision(textField(form, "expected_revision")),
      logoAction: action,
      primaryColour: textField(form, "primary_colour"),
      secondaryColour: textField(form, "secondary_colour") || null,
      footerText: textField(form, "footer_text") || null,
      file: bytes && mediaType ? { bytes, mediaType } : null,
    });
    const suppliedOperationId = textField(form, "operation_id");
    const suppliedBinding = textField(form, "binding_sha256");
    if (
      !UUID_V8_PATTERN.test(suppliedOperationId) ||
      !SHA256_PATTERN.test(suppliedBinding) ||
      suppliedOperationId !== prepared.operationId ||
      suppliedBinding !== prepared.bindingSha256 ||
      auth.generationRequestId !== prepared.operationId
    ) {
      throw new BrandLogoFailure(
        409,
        "BRAND_LOGO_BINDING_CONFLICT",
        "The brand-kit save identity does not match its contents.",
        false,
      );
    }

    const input: BrandLogoClaimInput = {
      userId: prepared.ownerUserId,
      operationId: prepared.operationId,
      businessId: prepared.businessId,
      expectedRevision: prepared.expectedRevision,
      bindingSha256: prepared.bindingSha256,
      action: prepared.logoAction,
      primaryColour: prepared.primaryColour,
      secondaryColour: prepared.secondaryColour,
      footerText: prepared.footerText,
      contentSha256: prepared.contentSha256,
      byteLength: prepared.byteLength,
      mediaType: prepared.mediaType,
    };
    const receipt = validReceipt(await dependencies.claim(input), input);
    if (["completed", "failed", "cancelled"].includes(receipt.state)) {
      return jsonResponse(
        receipt.terminal_response!,
        receipt.terminal_http_status ?? 200,
        origin,
      );
    }
    if (receipt.state === "reconciliation_required") {
      const terminal = await resolveRetainedLogoMismatch(
        dependencies,
        receipt,
        input,
      );
      return jsonResponse(terminal, 409, origin);
    }

    if (input.action === "replace") {
      if (
        !bytes || !input.contentSha256 || !input.byteLength ||
        !input.mediaType || !receipt.new_storage_path
      ) {
        throw new BrandLogoFailure(
          500,
          "BRAND_LOGO_RECEIPT_INVALID",
          "The logo operation could not be verified.",
          true,
        );
      }
      if (receipt.state === "accepted") {
        const dispatch: StorageDispatchInput = {
          userId: input.userId,
          operationId: input.operationId,
          kind: "brand-logo-publish",
          storagePathSha256: await hashText(receipt.new_storage_path),
          artifactSha256: input.contentSha256,
          dispatchToken: receipt.publish_dispatch_token,
        };
        const dispatchClaim = await dependencies.claimStorageDispatch(dispatch);
        if (dispatchClaim.storage_permitted) {
          await dependencies.publish({
            path: receipt.new_storage_path,
            bytes,
            mediaType: input.mediaType,
            contentSha256: input.contentSha256,
            operationId: input.operationId,
            upsert: false,
          });
        }
        const retained = await dependencies.read(receipt.new_storage_path);
        const observedContentSha256 = retained ? await sha256(retained) : null;
        const observedByteLength = retained?.byteLength ?? null;
        if (
          observedByteLength !== input.byteLength ||
          observedContentSha256 !== input.contentSha256
        ) {
          const reconciliationEvidenceSha256 = await reconciliationEvidence(
            receipt,
            observedContentSha256,
            observedByteLength,
          );
          await dependencies.markReconciliation({
            userId: input.userId,
            operationId: input.operationId,
            claimToken: receipt.claim_token,
            observedContentSha256,
            observedByteLength,
            reconciliationEvidenceSha256,
          });
          const terminal = await resolveRetainedLogoMismatch(
            dependencies,
            receipt,
            input,
          );
          return jsonResponse(terminal, 409, origin);
        }
        await dependencies.completeStorageDispatch(dispatch);
        await dependencies.recordVerified({
          userId: input.userId,
          operationId: input.operationId,
          claimToken: receipt.claim_token,
          storagePath: receipt.new_storage_path,
          contentSha256: input.contentSha256,
          byteLength: input.byteLength,
          mediaType: input.mediaType,
        });
      }
      if (
        receipt.state === "accepted" || receipt.state === "storage_verified"
      ) {
        await dependencies.activate({
          userId: input.userId,
          operationId: input.operationId,
          claimToken: receipt.claim_token,
          logoUrl: dependencies.publicUrl(receipt.new_storage_path),
        });
      }
    }

    const cleanupEvidenceSha256 = input.action === "keep"
      ? await hashText(JSON.stringify({
        contract: "prompted.brand-logo-cleanup.v1",
        business_id: input.businessId,
        action: "keep",
      }))
      : await cleanOldPaths(dependencies, receipt, input);
    const completed = await dependencies.complete({
      userId: input.userId,
      operationId: input.operationId,
      claimToken: receipt.claim_token,
      action: input.action,
      cleanupEvidenceSha256,
    });
    return jsonResponse(completed, 200, origin);
  } catch (error) {
    const failure = failureFromUnknown(error);
    return jsonResponse(
      {
        error: {
          code: failure.code,
          message: failure.publicMessage,
          retryable: failure.retryable,
        },
      },
      failure.status,
      origin,
    );
  }
}
