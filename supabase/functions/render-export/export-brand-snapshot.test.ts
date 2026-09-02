import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
} from "jsr:@std/assert@1";
import {
  createCapturedBrandInspectionExpectation,
  parseAuthoritativeBrandSnapshot,
  resolveCapturedBrandLogoSource,
} from "./export-brand-snapshot.ts";

const BUSINESS_ID = "b7000000-0000-4000-8000-000000000001";
const OTHER_BUSINESS_ID = "b7000000-0000-4000-8000-000000000002";
const OPERATION_ID = "b9000000-0000-8000-8000-000000000001";

function snapshot(overrides: Record<string, unknown> = {}) {
  const storagePath = `brand-kits/${BUSINESS_ID}/logos/${OPERATION_ID}.png`;
  return {
    snapshot_version: "prompted.export-brand-snapshot.v1",
    snapshot_sha256: "a".repeat(64),
    brand_kit: {
      id: "b8000000-0000-4000-8000-000000000001",
      business_id: BUSINESS_ID,
      logo_url:
        `https://project.supabase.co/storage/v1/object/public/assets/${storagePath}`,
      primary_colour: "#123456",
      secondary_colour: "#abcdef",
      footer_text: "ACME Pty Ltd",
      revision: 3,
      logo_operation_id: OPERATION_ID,
      logo_storage_path: storagePath,
      logo_content_sha256: "b".repeat(64),
      logo_media_type: "image/png",
      logo_byte_length: 1024,
      logo_status: "ready",
      updated_at: "2026-09-02T00:00:00.000Z",
      ...overrides,
    },
  };
}

Deno.test("authoritative export brand parser accepts a complete exact v1 snapshot", () => {
  const parsed = parseAuthoritativeBrandSnapshot(snapshot());
  assert(parsed);
  assertEquals(parsed.snapshotVersion, "prompted.export-brand-snapshot.v1");
  assertEquals(parsed.brandKit?.business_id, BUSINESS_ID);
  assertEquals(parsed.brandKit?.logo_operation_id, OPERATION_ID);
});

Deno.test("authoritative export brand parser preserves explicit legacy-unbound replay", () => {
  assertEquals(
    parseAuthoritativeBrandSnapshot({
      snapshot_version: "prompted.export-brand-snapshot.legacy-unbound.v0",
      snapshot_sha256: null,
      brand_kit: null,
    }),
    {
      snapshotVersion: "prompted.export-brand-snapshot.legacy-unbound.v0",
      snapshotSha256: null,
      brandKit: null,
    },
  );
});

Deno.test("authoritative export brand parser rejects incomplete and cross-business identity", () => {
  const missingRevision = snapshot();
  delete (missingRevision.brand_kit as Record<string, unknown>).revision;
  assertEquals(parseAuthoritativeBrandSnapshot(missingRevision), null);

  const crossBusinessPath = snapshot({
    logo_storage_path:
      `brand-kits/${OTHER_BUSINESS_ID}/logos/${OPERATION_ID}.png`,
  });
  assertEquals(parseAuthoritativeBrandSnapshot(crossBusinessPath), null);
});

Deno.test("authoritative export brand parser rejects forged legacy and v1 envelopes", () => {
  assertEquals(
    parseAuthoritativeBrandSnapshot({
      snapshot_version: "prompted.export-brand-snapshot.legacy-unbound.v0",
      snapshot_sha256: "a".repeat(64),
      brand_kit: null,
    }),
    null,
  );
  assertEquals(
    parseAuthoritativeBrandSnapshot({
      ...snapshot(),
      snapshot_sha256: "not-a-hash",
    }),
    null,
  );
});

Deno.test("captured brand expectation binds the frozen snapshot, logo, footer, and colours", async () => {
  const parsed = parseAuthoritativeBrandSnapshot(snapshot());
  assert(parsed);
  const first = await createCapturedBrandInspectionExpectation(parsed);
  const second = await createCapturedBrandInspectionExpectation(parsed);

  assert(first);
  assertEquals(first, second);
  assertEquals(first.snapshotVersion, "prompted.export-brand-snapshot.v1");
  assertEquals(first.snapshotSha256, "a".repeat(64));
  assertEquals(first.brandPresent, true);
  assertEquals(first.logoStoragePath, snapshot().brand_kit.logo_storage_path);
  assertEquals(first.logoContentSha256, "b".repeat(64));
  assertEquals(first.logoMediaType, "image/png");
  assertEquals(first.logoByteLength, 1024);
  assertMatch(first.footerSha256!, /^[0-9a-f]{64}$/);
  assertEquals(first.primaryColour, "#123456");
  assertEquals(first.secondaryColour, "#abcdef");
  assertMatch(first.brandEvidenceSha256, /^[0-9a-f]{64}$/);
});

Deno.test("captured brand logo source is built only from exact frozen Storage bytes", async () => {
  const bytes = new TextEncoder().encode("exact-logo");
  const digest = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ).map((value) => value.toString(16).padStart(2, "0")).join("");
  const parsed = parseAuthoritativeBrandSnapshot(snapshot({
    logo_content_sha256: digest,
    logo_byte_length: bytes.byteLength,
  }));
  assert(parsed);
  const calls: string[] = [];
  const source = await resolveCapturedBrandLogoSource(parsed, (path) => {
    calls.push(path);
    return Promise.resolve(bytes);
  });
  assertMatch(source!, /^data:image\/png;base64,/);
  assertEquals(calls, [snapshot().brand_kit.logo_storage_path]);

  await assertRejects(
    () =>
      resolveCapturedBrandLogoSource(
        parsed,
        () => Promise.resolve(new TextEncoder().encode("different")),
      ),
    Error,
    "CAPTURED_EXPORT_BRAND_LOGO_MISMATCH",
  );
  await assertRejects(
    () => resolveCapturedBrandLogoSource(parsed, () => Promise.resolve(null)),
    Error,
    "CAPTURED_EXPORT_BRAND_LOGO_UNAVAILABLE",
  );
});

Deno.test("legacy-unverified logo snapshots cannot enter a new captured render", async () => {
  const parsed = parseAuthoritativeBrandSnapshot(snapshot({
    logo_operation_id: null,
    logo_storage_path: null,
    logo_content_sha256: null,
    logo_media_type: null,
    logo_byte_length: null,
    logo_status: "legacy_unverified",
  }));
  assert(parsed);
  await assertRejects(
    () => createCapturedBrandInspectionExpectation(parsed),
    Error,
    "CAPTURED_EXPORT_BRAND_LOGO_UNVERIFIED",
  );
});
