import type { BrandKit } from "./html-template.ts";

export interface AuthoritativeBrandSnapshot {
  snapshotVersion:
    | "prompted.export-brand-snapshot.legacy-unbound.v0"
    | "prompted.export-brand-snapshot.v1";
  snapshotSha256: string | null;
  brandKit: BrandKit | null;
}

export interface CapturedBrandInspectionExpectation {
  snapshotVersion: "prompted.export-brand-snapshot.v1";
  snapshotSha256: string;
  brandPresent: boolean;
  logoStoragePath: string | null;
  logoContentSha256: string | null;
  logoMediaType: "image/png" | "image/jpeg" | "image/webp" | null;
  logoByteLength: number | null;
  footerSha256: string | null;
  primaryColour: string | null;
  secondaryColour: string | null;
  brandEvidenceSha256: string;
}

type FrozenLogoReader = (path: string) => Promise<Uint8Array | null>;

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uuidAny(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(candidate)
    ? candidate.toLowerCase()
    : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", owned.buffer),
  );
  return Array.from(digest)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function evidencePart(value: string | number | null): string {
  return value === null ? "~" : String(value);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8_192;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)),
    );
  }
  return btoa(binary);
}

function parseBrandKit(value: unknown): BrandKit | null {
  const brand = objectRecord(value);
  if (!brand) return null;
  const requiredKeys = [
    "id",
    "business_id",
    "logo_url",
    "primary_colour",
    "secondary_colour",
    "footer_text",
    "revision",
    "logo_operation_id",
    "logo_storage_path",
    "logo_content_sha256",
    "logo_media_type",
    "logo_byte_length",
    "logo_status",
    "updated_at",
  ];
  if (
    requiredKeys.some((key) => !Object.hasOwn(brand, key)) ||
    typeof brand.id !== "string" || typeof brand.business_id !== "string" ||
    (brand.logo_url !== null && typeof brand.logo_url !== "string") ||
    typeof brand.primary_colour !== "string" ||
    (brand.secondary_colour !== null &&
      typeof brand.secondary_colour !== "string") ||
    (brand.footer_text !== null && typeof brand.footer_text !== "string") ||
    typeof brand.revision !== "number" ||
    (brand.logo_operation_id !== null &&
      typeof brand.logo_operation_id !== "string") ||
    (brand.logo_storage_path !== null &&
      typeof brand.logo_storage_path !== "string") ||
    (brand.logo_content_sha256 !== null &&
      typeof brand.logo_content_sha256 !== "string") ||
    (brand.logo_media_type !== null &&
      typeof brand.logo_media_type !== "string") ||
    (brand.logo_byte_length !== null &&
      typeof brand.logo_byte_length !== "number") ||
    typeof brand.logo_status !== "string" ||
    typeof brand.updated_at !== "string"
  ) return null;

  const id = uuidAny(brand.id);
  const businessId = uuidAny(brand.business_id);
  const logoOperationId = brand.logo_operation_id === null
    ? null
    : uuidAny(brand.logo_operation_id);
  const logoUrl = brand.logo_url;
  const storagePath = brand.logo_storage_path;
  const contentSha256 = brand.logo_content_sha256?.toLowerCase() ?? null;
  const mediaType = brand.logo_media_type;
  const byteLength = brand.logo_byte_length;
  const primaryColour = brand.primary_colour;
  const secondaryColour = brand.secondary_colour;
  const footerText = brand.footer_text;
  const revision = brand.revision;
  const logoStatus = brand.logo_status;
  const updatedAt = brand.updated_at;
  if (
    !id || !businessId || !/^#[0-9a-f]{6}$/i.test(primaryColour) ||
    (secondaryColour !== null && !/^#[0-9a-f]{6}$/i.test(secondaryColour)) ||
    (footerText !== null && footerText.length > 200) ||
    !Number.isSafeInteger(revision) || revision < 0 ||
    !["ready", "legacy_unverified", "reconciliation_required"].includes(
      logoStatus,
    ) || !updatedAt ||
    (logoUrl !== null && (logoUrl.length < 1 || logoUrl.length > 2048))
  ) return null;

  const hasNoLogoIdentity = logoOperationId === null && storagePath === null &&
    contentSha256 === null && mediaType === null && byteLength === null;
  if (logoUrl === null) {
    if (!hasNoLogoIdentity || logoStatus !== "ready") return null;
  } else if (logoStatus === "legacy_unverified") {
    if (!hasNoLogoIdentity) return null;
  } else {
    if (
      !logoOperationId || !storagePath ||
      !/^[0-9a-f]{64}$/.test(contentSha256 ?? "") ||
      !["image/png", "image/jpeg", "image/webp"].includes(mediaType ?? "") ||
      !Number.isSafeInteger(byteLength) || (byteLength ?? 0) < 1 ||
      (byteLength ?? 0) > 5 * 1024 * 1024
    ) return null;
    const extension = mediaType === "image/png"
      ? "png"
      : mediaType === "image/jpeg"
      ? "jpg"
      : "webp";
    if (
      storagePath !==
        `brand-kits/${businessId}/logos/${logoOperationId}.${extension}`
    ) return null;
    try {
      const parsedLogoUrl = new URL(logoUrl);
      if (
        parsedLogoUrl.pathname !==
          `/storage/v1/object/public/assets/${storagePath}` ||
        parsedLogoUrl.search !== "" || parsedLogoUrl.hash !== ""
      ) return null;
    } catch {
      return null;
    }
  }

  return {
    id,
    business_id: businessId,
    logo_url: logoUrl,
    primary_colour: primaryColour,
    secondary_colour: secondaryColour,
    footer_text: footerText,
    revision,
    logo_operation_id: logoOperationId,
    logo_storage_path: storagePath,
    logo_content_sha256: contentSha256,
    logo_media_type: mediaType as BrandKit["logo_media_type"],
    logo_byte_length: byteLength,
    logo_status: logoStatus as BrandKit["logo_status"],
    updated_at: updatedAt,
  };
}

export function parseAuthoritativeBrandSnapshot(
  value: unknown,
): AuthoritativeBrandSnapshot | null {
  const snapshot = objectRecord(value);
  if (!snapshot || !Object.hasOwn(snapshot, "brand_kit")) return null;
  const snapshotVersion = snapshot.snapshot_version;
  if (snapshotVersion === "prompted.export-brand-snapshot.legacy-unbound.v0") {
    if (snapshot.snapshot_sha256 !== null || snapshot.brand_kit !== null) {
      return null;
    }
    return { snapshotVersion, snapshotSha256: null, brandKit: null };
  }
  if (
    snapshotVersion !== "prompted.export-brand-snapshot.v1" ||
    typeof snapshot.snapshot_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(snapshot.snapshot_sha256)
  ) return null;
  const brandKit = snapshot.brand_kit === null
    ? null
    : parseBrandKit(snapshot.brand_kit);
  if (snapshot.brand_kit !== null && !brandKit) return null;
  return {
    snapshotVersion,
    snapshotSha256: snapshot.snapshot_sha256,
    brandKit,
  };
}

/**
 * Derives the renderer/receipt brand identity from the immutable database
 * snapshot only. The delimiter format is deliberately simple so Postgres can
 * recompute the same evidence hash without depending on JSON key ordering.
 */
export async function createCapturedBrandInspectionExpectation(
  snapshot: AuthoritativeBrandSnapshot,
): Promise<CapturedBrandInspectionExpectation | null> {
  if (
    snapshot.snapshotVersion ===
      "prompted.export-brand-snapshot.legacy-unbound.v0"
  ) {
    return null;
  }
  if (!snapshot.snapshotSha256) {
    throw new Error("CAPTURED_EXPORT_BRAND_SNAPSHOT_INVALID");
  }
  const brand = snapshot.brandKit;
  if (brand?.logo_status === "legacy_unverified") {
    throw new Error("CAPTURED_EXPORT_BRAND_LOGO_UNVERIFIED");
  }
  if (brand?.logo_status === "reconciliation_required") {
    throw new Error("CAPTURED_EXPORT_BRAND_RECONCILIATION_REQUIRED");
  }
  const footerSha256 = brand?.footer_text
    ? await sha256Hex(new TextEncoder().encode(brand.footer_text))
    : null;
  const expectationWithoutHash = {
    snapshotVersion: snapshot.snapshotVersion,
    snapshotSha256: snapshot.snapshotSha256,
    brandPresent: brand !== null,
    logoStoragePath: brand?.logo_storage_path ?? null,
    logoContentSha256: brand?.logo_content_sha256 ?? null,
    logoMediaType: brand?.logo_media_type ?? null,
    logoByteLength: brand?.logo_byte_length ?? null,
    footerSha256,
    primaryColour: brand?.primary_colour.toLowerCase() ?? null,
    secondaryColour: brand?.secondary_colour?.toLowerCase() ?? null,
  };
  const evidenceBinding = [
    "prompted.export-brand-evidence.v1",
    expectationWithoutHash.snapshotVersion,
    expectationWithoutHash.snapshotSha256,
    expectationWithoutHash.brandPresent ? "1" : "0",
    evidencePart(expectationWithoutHash.logoStoragePath),
    evidencePart(expectationWithoutHash.logoContentSha256),
    evidencePart(expectationWithoutHash.logoMediaType),
    evidencePart(expectationWithoutHash.logoByteLength),
    evidencePart(expectationWithoutHash.footerSha256),
    evidencePart(expectationWithoutHash.primaryColour),
    evidencePart(expectationWithoutHash.secondaryColour),
  ].join("|");
  return {
    ...expectationWithoutHash,
    brandEvidenceSha256: await sha256Hex(
      new TextEncoder().encode(evidenceBinding),
    ),
  };
}

/**
 * Loads and hash-checks the exact frozen logo object before it can enter HTML.
 * A captured render never falls back to the mutable public URL in the snapshot.
 */
export async function resolveCapturedBrandLogoSource(
  snapshot: AuthoritativeBrandSnapshot,
  read: FrozenLogoReader,
): Promise<string | null> {
  const expectation = await createCapturedBrandInspectionExpectation(snapshot);
  if (!expectation?.logoStoragePath) return null;
  const bytes = await read(expectation.logoStoragePath);
  if (!bytes) throw new Error("CAPTURED_EXPORT_BRAND_LOGO_UNAVAILABLE");
  if (
    bytes.byteLength !== expectation.logoByteLength ||
    await sha256Hex(bytes) !== expectation.logoContentSha256
  ) {
    throw new Error("CAPTURED_EXPORT_BRAND_LOGO_MISMATCH");
  }
  if (!expectation.logoMediaType) {
    throw new Error("CAPTURED_EXPORT_BRAND_SNAPSHOT_INVALID");
  }
  return `data:${expectation.logoMediaType};base64,${encodeBase64(bytes)}`;
}
