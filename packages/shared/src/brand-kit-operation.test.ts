import { describe, expect, it } from "vitest";
import {
  BRAND_LOGO_MAX_BYTES,
  BrandKitOperationInputError,
  prepareBrandKitOperation,
} from "./brand-kit-operation";

const OWNER_ID = "b1000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "b2000000-0000-4000-8000-000000000001";

function input() {
  return {
    ownerUserId: OWNER_ID,
    businessId: BUSINESS_ID,
    expectedRevision: 2,
    logoAction: "replace" as const,
    primaryColour: "#DC5430",
    secondaryColour: " #EFE5D4 ",
    footerText: "  Example footer  ",
    file: {
      bytes: new Uint8Array([1, 2, 3, 4]),
      mediaType: "image/png",
    },
  };
}

describe("brand-kit operation identity", () => {
  it("derives one deterministic UUID and binding from normalized owner input", async () => {
    const first = await prepareBrandKitOperation(input());
    const replay = await prepareBrandKitOperation({
      ...input(),
      primaryColour: "#dc5430",
      secondaryColour: "#efe5d4",
      footerText: "Example footer",
      file: { ...input().file, bytes: Uint8Array.from([1, 2, 3, 4]) },
    });

    expect(first).toEqual(replay);
    expect(first.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.bindingSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.primaryColour).toBe("#dc5430");
    expect(first.secondaryColour).toBe("#efe5d4");
    expect(first.footerText).toBe("Example footer");
  });

  it("changes identity for a material edit and never accepts a file for keep/remove", async () => {
    const first = await prepareBrandKitOperation(input());
    const changed = await prepareBrandKitOperation({ ...input(), footerText: "Different" });
    expect(changed.operationId).not.toBe(first.operationId);

    for (const logoAction of ["keep", "remove"] as const) {
      await expect(
        prepareBrandKitOperation({ ...input(), logoAction }),
      ).rejects.toMatchObject({ code: "BRAND_LOGO_FILE_UNEXPECTED" });
    }
  });

  it("requires exact owner/business/revision/colour/text/file bounds", async () => {
    const invalid = [
      { ...input(), ownerUserId: "not-a-uuid" },
      { ...input(), businessId: "not-a-uuid" },
      { ...input(), expectedRevision: -1 },
      { ...input(), primaryColour: "red" },
      { ...input(), secondaryColour: "#abc" },
      { ...input(), footerText: "x".repeat(201) },
      { ...input(), file: { ...input().file, mediaType: "image/svg+xml" } },
      {
        ...input(),
        file: {
          ...input().file,
          bytes: new Uint8Array(BRAND_LOGO_MAX_BYTES + 1),
        },
      },
    ];
    for (const value of invalid) {
      await expect(prepareBrandKitOperation(value)).rejects.toBeInstanceOf(
        BrandKitOperationInputError,
      );
    }
  });

  it("requires a file only for replacement", async () => {
    await expect(
      prepareBrandKitOperation({ ...input(), file: null }),
    ).rejects.toMatchObject({ code: "BRAND_LOGO_FILE_REQUIRED" });

    const keep = await prepareBrandKitOperation({
      ...input(),
      logoAction: "keep",
      file: null,
    });
    expect(keep.contentSha256).toBeNull();
    expect(keep.mediaType).toBeNull();
    expect(keep.byteLength).toBeNull();
  });
});
