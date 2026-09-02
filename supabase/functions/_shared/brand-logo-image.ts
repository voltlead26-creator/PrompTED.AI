const MAX_BRAND_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_BRAND_LOGO_DIMENSION = 8192;
const MAX_BRAND_LOGO_PIXELS = 16_000_000;
const MAX_IMAGE_CHUNKS = 4096;

export type BrandLogoMediaType = "image/png" | "image/jpeg" | "image/webp";

export interface ValidatedBrandLogoImage {
  mediaType: BrandLogoMediaType;
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
}

export class BrandLogoImageError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BrandLogoImageError";
  }
}

function invalid(code = "BRAND_LOGO_IMAGE_INVALID"): never {
  throw new BrandLogoImageError(code);
}

function assertDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width < 1 || height < 1 ||
    width > MAX_BRAND_LOGO_DIMENSION || height > MAX_BRAND_LOGO_DIMENSION ||
    width * height > MAX_BRAND_LOGO_PIXELS
  ) {
    invalid("BRAND_LOGO_DIMENSIONS_INVALID");
  }
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) invalid();
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  ) >>> 0;
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) invalid();
  return (
    bytes[offset]! +
    (bytes[offset + 1]! << 8) +
    (bytes[offset + 2]! << 16) +
    bytes[offset + 3]! * 0x1000000
  ) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || start + length > bytes.length) invalid();
  let value = "";
  for (let index = start; index < start + length; index += 1) {
    const byte = bytes[index]!;
    if (byte < 0x20 || byte > 0x7e) invalid();
    value += String.fromCharCode(byte);
  }
  return value;
}

function validatePng(bytes: Uint8Array): ValidatedBrandLogoImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) invalid();
  let cursor = 8;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let sawImageData = false;
  while (cursor < bytes.length) {
    chunks += 1;
    if (chunks > MAX_IMAGE_CHUNKS || cursor + 12 > bytes.length) invalid();
    const length = readUint32Be(bytes, cursor);
    const typeOffset = cursor + 4;
    const type = ascii(bytes, typeOffset, 4);
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(dataEnd) || chunkEnd > bytes.length) invalid();
    if (readUint32Be(bytes, dataEnd) !== crc32(bytes, typeOffset, dataEnd)) {
      invalid();
    }

    if (chunks === 1) {
      if (type !== "IHDR" || length !== 13) invalid();
      width = readUint32Be(bytes, dataOffset);
      height = readUint32Be(bytes, dataOffset + 4);
      assertDimensions(width, height);
    } else if (type === "IHDR") {
      invalid();
    }
    if (["tEXt", "zTXt", "iTXt", "eXIf"].includes(type)) {
      invalid("BRAND_LOGO_METADATA_UNSAFE");
    }
    if (["acTL", "fcTL", "fdAT"].includes(type)) {
      invalid("BRAND_LOGO_ANIMATION_UNSUPPORTED");
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !sawImageData || chunkEnd !== bytes.length) invalid();
      return { mediaType: "image/png", extension: "png", width, height };
    }
    cursor = chunkEnd;
  }
  invalid();
}

function jpegSegmentLength(bytes: Uint8Array, cursor: number): number {
  if (cursor + 2 > bytes.length) invalid();
  const length = (bytes[cursor]! << 8) | bytes[cursor + 1]!;
  if (length < 2 || cursor + length > bytes.length) invalid();
  return length;
}

function validateJpeg(bytes: Uint8Array): ValidatedBrandLogoImage {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let cursor = 2;
  let inScan = false;
  let segments = 0;
  let width = 0;
  let height = 0;

  while (cursor < bytes.length) {
    if (inScan && bytes[cursor] !== 0xff) {
      cursor += 1;
      continue;
    }
    if (bytes[cursor] !== 0xff) invalid();
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) invalid();
    const marker = bytes[cursor]!;
    cursor += 1;
    if (inScan && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) {
      continue;
    }
    if (marker === 0xd9) {
      if (cursor !== bytes.length || width === 0 || height === 0) invalid();
      return { mediaType: "image/jpeg", extension: "jpg", width, height };
    }
    if (
      marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
    ) {
      if (marker === 0xd8) invalid();
      inScan = false;
      continue;
    }

    inScan = false;
    segments += 1;
    if (segments > MAX_IMAGE_CHUNKS) invalid();
    const length = jpegSegmentLength(bytes, cursor);
    const dataOffset = cursor + 2;
    const dataEnd = cursor + length;
    if (marker === 0xe1 || marker === 0xed || marker === 0xfe) {
      invalid("BRAND_LOGO_METADATA_UNSAFE");
    }
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) invalid();
      height = (bytes[dataOffset + 1]! << 8) | bytes[dataOffset + 2]!;
      width = (bytes[dataOffset + 3]! << 8) | bytes[dataOffset + 4]!;
      assertDimensions(width, height);
    } else if (
      (marker >= 0xc0 && marker <= 0xcf) &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      invalid("BRAND_LOGO_IMAGE_UNSUPPORTED");
    }
    cursor = dataEnd;
    if (marker === 0xda) inScan = true;
  }
  invalid();
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 3 > bytes.length) invalid();
  return bytes[offset]! | (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16);
}

function validateWebp(bytes: Uint8Array): ValidatedBrandLogoImage {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") invalid();
  if (readUint32Le(bytes, 4) + 8 !== bytes.length) invalid();
  let cursor = 12;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let imageChunks = 0;
  while (cursor < bytes.length) {
    chunks += 1;
    if (chunks > MAX_IMAGE_CHUNKS || cursor + 8 > bytes.length) invalid();
    const type = ascii(bytes, cursor, 4);
    const length = readUint32Le(bytes, cursor + 4);
    const dataOffset = cursor + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + (length % 2);
    if (!Number.isSafeInteger(dataEnd) || chunkEnd > bytes.length) invalid();
    if (["EXIF", "XMP "].includes(type)) invalid("BRAND_LOGO_METADATA_UNSAFE");
    if (["ANIM", "ANMF"].includes(type)) {
      invalid("BRAND_LOGO_ANIMATION_UNSUPPORTED");
    }

    let chunkWidth = 0;
    let chunkHeight = 0;
    if (type === "VP8X") {
      if (length !== 10 || (bytes[dataOffset]! & 0x02) !== 0) {
        invalid("BRAND_LOGO_ANIMATION_UNSUPPORTED");
      }
      chunkWidth = readUint24Le(bytes, dataOffset + 4) + 1;
      chunkHeight = readUint24Le(bytes, dataOffset + 7) + 1;
    } else if (type === "VP8 ") {
      if (
        length < 10 || bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a
      ) invalid();
      chunkWidth = ((bytes[dataOffset + 7]! << 8) | bytes[dataOffset + 6]!) &
        0x3fff;
      chunkHeight = ((bytes[dataOffset + 9]! << 8) | bytes[dataOffset + 8]!) &
        0x3fff;
      imageChunks += 1;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) invalid();
      const b1 = bytes[dataOffset + 1]!;
      const b2 = bytes[dataOffset + 2]!;
      const b3 = bytes[dataOffset + 3]!;
      const b4 = bytes[dataOffset + 4]!;
      chunkWidth = 1 + b1 + ((b2 & 0x3f) << 8);
      chunkHeight = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
      imageChunks += 1;
    }
    if (chunkWidth > 0 || chunkHeight > 0) {
      assertDimensions(chunkWidth, chunkHeight);
      if (width !== 0 && (width !== chunkWidth || height !== chunkHeight)) {
        invalid();
      }
      width = chunkWidth;
      height = chunkHeight;
    }
    cursor = chunkEnd;
  }
  if (
    cursor !== bytes.length || width === 0 || height === 0 || imageChunks > 1
  ) invalid();
  return { mediaType: "image/webp", extension: "webp", width, height };
}

export function validateBrandLogoImage(
  bytes: Uint8Array,
  declaredMediaType: string,
): ValidatedBrandLogoImage {
  if (
    !(bytes instanceof Uint8Array) || bytes.length < 12 ||
    bytes.length > MAX_BRAND_LOGO_BYTES
  ) {
    invalid();
  }
  let validated: ValidatedBrandLogoImage;
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    validated = validatePng(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    validated = validateJpeg(bytes);
  } else if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    validated = validateWebp(bytes);
  } else {
    invalid("BRAND_LOGO_MEDIA_UNSUPPORTED");
  }
  if (declaredMediaType.trim().toLowerCase() !== validated.mediaType) {
    invalid("BRAND_LOGO_MEDIA_MISMATCH");
  }
  return validated;
}
