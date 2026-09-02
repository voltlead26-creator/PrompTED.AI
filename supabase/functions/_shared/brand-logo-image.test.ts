// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  BrandLogoImageError,
  validateBrandLogoImage,
} from "./brand-logo-image.ts";

const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

function jpeg1x1(metadataMarker?: number): Uint8Array {
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
  ];
  if (metadataMarker !== undefined) {
    bytes.push(0xff, metadataMarker, 0x00, 0x04, 0x00, 0x00);
  }
  bytes.push(
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x00,
    0x01,
    0x00,
    0x01,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x00,
    0x03,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x0c,
    0x03,
    0x01,
    0x00,
    0x02,
    0x00,
    0x03,
    0x00,
    0x00,
    0x3f,
    0x00,
    0x00,
    0xff,
    0xd9,
  );
  return Uint8Array.from(bytes);
}

function webp1x1(extraChunk?: string): Uint8Array {
  const chunks: number[] = [];
  const appendChunk = (type: string, data: number[]) => {
    chunks.push(...new TextEncoder().encode(type));
    chunks.push(data.length & 0xff, (data.length >>> 8) & 0xff, 0, 0, ...data);
    if (data.length % 2 === 1) chunks.push(0);
  };
  appendChunk("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  if (extraChunk) appendChunk(extraChunk, [0, 0]);
  const size = 4 + chunks.length;
  return Uint8Array.from([
    ...new TextEncoder().encode("RIFF"),
    size & 0xff,
    (size >>> 8) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 24) & 0xff,
    ...new TextEncoder().encode("WEBP"),
    ...chunks,
  ]);
}

function codeFor(bytes: Uint8Array, mediaType: string): string {
  const error = assertThrows(
    () => validateBrandLogoImage(bytes, mediaType),
    BrandLogoImageError,
  );
  return error.code;
}

Deno.test("brand image validation derives exact PNG, JPEG and WebP dimensions", () => {
  assertEquals(validateBrandLogoImage(PNG_1X1, "image/png"), {
    mediaType: "image/png",
    extension: "png",
    width: 1,
    height: 1,
  });
  assertEquals(validateBrandLogoImage(jpeg1x1(), "image/jpeg"), {
    mediaType: "image/jpeg",
    extension: "jpg",
    width: 1,
    height: 1,
  });
  assertEquals(validateBrandLogoImage(webp1x1(), "image/webp"), {
    mediaType: "image/webp",
    extension: "webp",
    width: 1,
    height: 1,
  });
});

Deno.test("brand image validation rejects MIME confusion and trailing polyglot bytes", () => {
  assertEquals(codeFor(PNG_1X1, "image/jpeg"), "BRAND_LOGO_MEDIA_MISMATCH");
  const polyglot = new Uint8Array(PNG_1X1.length + 4);
  polyglot.set(PNG_1X1);
  polyglot.set([1, 2, 3, 4], PNG_1X1.length);
  assertEquals(codeFor(polyglot, "image/png"), "BRAND_LOGO_IMAGE_INVALID");
});

Deno.test("brand image validation rejects sensitive metadata and animation", () => {
  assertEquals(
    codeFor(jpeg1x1(0xe1), "image/jpeg"),
    "BRAND_LOGO_METADATA_UNSAFE",
  );
  assertEquals(
    codeFor(webp1x1("EXIF"), "image/webp"),
    "BRAND_LOGO_METADATA_UNSAFE",
  );
  assertEquals(
    codeFor(webp1x1("ANIM"), "image/webp"),
    "BRAND_LOGO_ANIMATION_UNSUPPORTED",
  );
});

Deno.test("brand image validation rejects corruption, truncation and excessive dimensions", () => {
  const corruptedPng = Uint8Array.from(PNG_1X1);
  corruptedPng[20] ^= 0xff;
  assertEquals(codeFor(corruptedPng, "image/png"), "BRAND_LOGO_IMAGE_INVALID");
  assertEquals(
    codeFor(jpeg1x1().slice(0, -1), "image/jpeg"),
    "BRAND_LOGO_IMAGE_INVALID",
  );

  const largeWebp = webp1x1();
  largeWebp[24] = 0x00;
  largeWebp[25] = 0x20;
  assertEquals(
    codeFor(largeWebp, "image/webp"),
    "BRAND_LOGO_DIMENSIONS_INVALID",
  );
});
