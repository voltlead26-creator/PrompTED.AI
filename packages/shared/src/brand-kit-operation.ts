export const BRAND_LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const BRAND_LOGO_OPERATION_CONTRACT = "prompted.brand-kit-operation.v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type BrandLogoAction = "keep" | "replace" | "remove";

export class BrandKitOperationInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BrandKitOperationInputError";
  }
}

export interface BrandKitOperationFileInput {
  bytes: Uint8Array;
  mediaType: string;
}

export interface BrandKitOperationInput {
  ownerUserId: string;
  businessId: string;
  expectedRevision: number;
  logoAction: BrandLogoAction;
  primaryColour: string;
  secondaryColour: string | null;
  footerText: string | null;
  file: BrandKitOperationFileInput | null;
}

export interface PreparedBrandKitOperation {
  operationId: string;
  bindingSha256: string;
  ownerUserId: string;
  businessId: string;
  expectedRevision: number;
  logoAction: BrandLogoAction;
  primaryColour: string;
  secondaryColour: string | null;
  footerText: string | null;
  contentSha256: string | null;
  byteLength: number | null;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | null;
}

function fail(code: string): never {
  throw new BrandKitOperationInputError(code);
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

function uuidV8FromSha256(hex: string): string {
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function normalizedOptional(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export async function prepareBrandKitOperation(
  input: BrandKitOperationInput,
): Promise<Readonly<PreparedBrandKitOperation>> {
  if (!UUID_PATTERN.test(input.ownerUserId)) fail("BRAND_KIT_OWNER_INVALID");
  if (!UUID_PATTERN.test(input.businessId)) fail("BRAND_KIT_BUSINESS_INVALID");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    fail("BRAND_KIT_REVISION_INVALID");
  }
  if (!["keep", "replace", "remove"].includes(input.logoAction)) {
    fail("BRAND_LOGO_ACTION_INVALID");
  }

  const primaryColour = input.primaryColour.trim().toLowerCase();
  const secondaryColour = normalizedOptional(input.secondaryColour)?.toLowerCase() ?? null;
  const footerText = normalizedOptional(input.footerText);
  if (!COLOUR_PATTERN.test(primaryColour)) fail("BRAND_PRIMARY_COLOUR_INVALID");
  if (secondaryColour !== null && !COLOUR_PATTERN.test(secondaryColour)) {
    fail("BRAND_SECONDARY_COLOUR_INVALID");
  }
  if (footerText !== null && footerText.length > 200) fail("BRAND_FOOTER_INVALID");

  if (input.logoAction === "replace" && input.file === null) {
    fail("BRAND_LOGO_FILE_REQUIRED");
  }
  if (input.logoAction !== "replace" && input.file !== null) {
    fail("BRAND_LOGO_FILE_UNEXPECTED");
  }

  let contentSha256: string | null = null;
  let byteLength: number | null = null;
  let mediaType: PreparedBrandKitOperation["mediaType"] = null;
  if (input.file) {
    if (!(input.file.bytes instanceof Uint8Array)) fail("BRAND_LOGO_FILE_INVALID");
    byteLength = input.file.bytes.byteLength;
    if (byteLength < 1 || byteLength > BRAND_LOGO_MAX_BYTES) {
      fail("BRAND_LOGO_FILE_SIZE_INVALID");
    }
    if (!MEDIA_TYPES.has(input.file.mediaType)) fail("BRAND_LOGO_MEDIA_TYPE_INVALID");
    mediaType = input.file.mediaType as NonNullable<PreparedBrandKitOperation["mediaType"]>;
    contentSha256 = await sha256(input.file.bytes);
  }

  const binding = JSON.stringify({
    contract: BRAND_LOGO_OPERATION_CONTRACT,
    user_id: input.ownerUserId.toLowerCase(),
    business_id: input.businessId.toLowerCase(),
    expected_revision: input.expectedRevision,
    logo_action: input.logoAction,
    primary_colour: primaryColour,
    secondary_colour: secondaryColour,
    footer_text: footerText,
    file: contentSha256 === null
      ? null
      : {
        content_sha256: contentSha256,
        byte_length: byteLength,
        media_type: mediaType,
      },
  });
  const bindingSha256 = await sha256(new TextEncoder().encode(binding));

  return Object.freeze({
    operationId: uuidV8FromSha256(bindingSha256),
    bindingSha256,
    ownerUserId: input.ownerUserId.toLowerCase(),
    businessId: input.businessId.toLowerCase(),
    expectedRevision: input.expectedRevision,
    logoAction: input.logoAction,
    primaryColour,
    secondaryColour,
    footerText,
    contentSha256,
    byteLength,
    mediaType,
  });
}
