// deno-lint-ignore-file no-import-prefix no-unversioned-import

import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_RESOURCE_POLICY_VERSION,
  type UploadExtractionResult,
  type UploadFormat,
} from "./upload-extraction-contract.ts";
import {
  BoundedXmlError,
  type BoundedXmlEvent,
  localXmlName,
  scanBoundedXml,
} from "./bounded-xml.ts";
export {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_RESOURCE_POLICY_VERSION,
  type UploadExtractionResult,
  type UploadFormat,
} from "./upload-extraction-contract.ts";

const MAX_PDF_PAGES = 80;
const MAX_ARCHIVE_ENTRIES = 512;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSION_RATIO = 100;
const MAX_XLSX_SHEETS = 32;
const MAX_XLSX_ROWS_PER_SHEET = 10_000;
const MAX_XLSX_CELLS_PER_SHEET = 100_000;
const MAX_XLSX_TOTAL_CELLS = 200_000;
const MAX_XML_RELATIONSHIPS = 2_048;
const MAX_PDF_TEXT_CHUNKS = 10_000;
const MAX_PDF_TEXT_ITEMS = 100_000;
const MAX_PDF_ITEM_CHARS = 50_000;
const PARSER_DEADLINE_MS = 20_000;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

export class UploadExtractionError extends Error {
  constructor(
    readonly status: 413 | 422 | 503,
    readonly code: string,
    readonly publicMessage: string,
    readonly retryable = false,
  ) {
    super(`${code}: ${publicMessage}`);
    this.name = "UploadExtractionError";
  }
}

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

interface ArchiveInspection {
  names: Set<string>;
  selectedContents: Map<string, Uint8Array>;
}

const archiveInspections = new WeakMap<
  Uint8Array,
  Promise<ArchiveInspection>
>();

function extractionError(
  status: 413 | 422 | 503,
  code: string,
  message: string,
  retryable = false,
): UploadExtractionError {
  return new UploadExtractionError(status, code, message, retryable);
}

function assertParserWork(
  signal: AbortSignal | undefined,
  deadline: number,
): void {
  if (signal?.aborted || Date.now() > deadline) {
    throw extractionError(
      503,
      "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
      "TED could not safely finish reading that file right now. Please try again.",
      true,
    );
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
})();

function updateCrc32(state: number, bytes: Uint8Array): number {
  let crc = state >>> 0;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function crc32(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

function rejectZip64Extra(
  bytes: Uint8Array,
  offset: number,
  length: number,
): void {
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    ensureRange(bytes, cursor, 4);
    const id = readUint16(bytes, cursor);
    const size = readUint16(bytes, cursor + 2);
    cursor += 4;
    ensureRange(bytes, cursor, size);
    if (cursor + size > end) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_INVALID",
        "That Office file contains invalid archive metadata.",
      );
    }
    if (id === 0x0001) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_FEATURE_UNSUPPORTED",
        "That Office file uses an unsupported large-archive feature.",
      );
    }
    cursor += size;
  }
  if (cursor !== end) {
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_INVALID",
      "That Office file contains invalid archive metadata.",
    );
  }
}

function extensionOf(filename: string): string {
  const normalized = filename.normalize("NFKC").trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  return index < 0 ? "" : normalized.slice(index + 1);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function ensureRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  code = "UPLOAD_ARCHIVE_INVALID",
): void {
  if (
    !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
    offset < 0 || length < 0 || offset + length > bytes.byteLength
  ) {
    throw extractionError(
      422,
      code,
      "That Office file is incomplete or malformed.",
    );
  }
}

function readUint16(bytes: Uint8Array, offset: number): number {
  ensureRange(bytes, offset, 2);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(
    0,
    true,
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  ensureRange(bytes, offset, 4);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
    0,
    true,
  );
}

function findZipEnd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readUint32(bytes, offset) !== ZIP_END_SIGNATURE) continue;
    const commentLength = readUint16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw extractionError(
    422,
    "UPLOAD_ARCHIVE_INVALID",
    "That Office file is incomplete or malformed.",
  );
}

function validateArchivePath(name: string): void {
  const path = name.normalize("NFC");
  const pathWithoutDirectorySuffix = path.endsWith("/")
    ? path.slice(0, -1)
    : path;
  const segments = pathWithoutDirectorySuffix.split("/");
  if (
    !pathWithoutDirectorySuffix || path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\u0000") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_PATH_INVALID",
      "That Office file contains an unsafe internal path.",
    );
  }
}

function parseCentralDirectory(bytes: Uint8Array): {
  entries: ZipEntry[];
  centralOffset: number;
} {
  const endOffset = findZipEnd(bytes);
  const diskNumber = readUint16(bytes, endOffset + 4);
  const centralDisk = readUint16(bytes, endOffset + 6);
  const diskEntries = readUint16(bytes, endOffset + 8);
  const totalEntries = readUint16(bytes, endOffset + 10);
  const centralSize = readUint32(bytes, endOffset + 12);
  const centralOffset = readUint32(bytes, endOffset + 16);
  if (
    diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries ||
    totalEntries === 0 || totalEntries === 0xffff ||
    centralSize === 0xffffffff || centralOffset === 0xffffffff ||
    totalEntries > MAX_ARCHIVE_ENTRIES ||
    centralOffset + centralSize !== endOffset
  ) {
    throw extractionError(
      totalEntries > MAX_ARCHIVE_ENTRIES ? 413 : 422,
      totalEntries > MAX_ARCHIVE_ENTRIES
        ? "UPLOAD_ARCHIVE_ENTRY_LIMIT"
        : "UPLOAD_ARCHIVE_INVALID",
      totalEntries > MAX_ARCHIVE_ENTRIES
        ? "That Office file contains too many internal files to process safely."
        : "That Office file is incomplete or malformed.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const canonicalNames = new Set<string>();
  let cursor = centralOffset;
  let declaredTotal = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    ensureRange(bytes, cursor, 46);
    if (readUint32(bytes, cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_INVALID",
        "That Office file has an invalid directory.",
      );
    }
    const flags = readUint16(bytes, cursor + 8);
    const method = readUint16(bytes, cursor + 10);
    const entryCrc32 = readUint32(bytes, cursor + 16);
    const compressedSize = readUint32(bytes, cursor + 20);
    const uncompressedSize = readUint32(bytes, cursor + 24);
    const nameLength = readUint16(bytes, cursor + 28);
    const extraLength = readUint16(bytes, cursor + 30);
    const commentLength = readUint16(bytes, cursor + 32);
    const startDisk = readUint16(bytes, cursor + 34);
    const localOffset = readUint32(bytes, cursor + 42);
    ensureRange(bytes, cursor + 46, nameLength + extraLength + commentLength);
    if (nameLength === 0 || nameLength > 512) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_PATH_INVALID",
        "That Office file contains an invalid internal path.",
      );
    }
    rejectZip64Extra(bytes, cursor + 46 + nameLength, extraLength);

    let name: string;
    try {
      name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_PATH_INVALID",
        "That Office file contains an invalid internal path.",
      );
    }
    validateArchivePath(name);
    const canonicalName = name.normalize("NFC").toLocaleLowerCase("en-US");
    if (canonicalNames.has(canonicalName)) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_DUPLICATE_PATH",
        "That Office file contains duplicate internal paths.",
      );
    }
    canonicalNames.add(canonicalName);
    if (
      startDisk !== 0 || localOffset === 0xffffffff ||
      (flags & ~0x0800) !== 0 ||
      ![0, 8].includes(method)
    ) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_FEATURE_UNSUPPORTED",
        "That Office file uses an encrypted or unsupported archive feature.",
      );
    }
    if (
      uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES ||
      declaredTotal + uncompressedSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES ||
      (uncompressedSize > 1024 * 1024 &&
        (compressedSize === 0 ||
          uncompressedSize / compressedSize > MAX_ARCHIVE_COMPRESSION_RATIO))
    ) {
      throw extractionError(
        413,
        "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
        "That Office file expands beyond the safe processing limit.",
      );
    }
    declaredTotal += uncompressedSize;
    entries.push({
      name,
      flags,
      method,
      crc32: entryCrc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== endOffset) {
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_INVALID",
      "That Office file has trailing directory data.",
    );
  }
  return { entries, centralOffset };
}

function shouldRetainArchiveEntry(name: string): boolean {
  return name === "[Content_Types].xml" ||
    name === "_rels/.rels" ||
    name === "word/document.xml" ||
    name === "word/_rels/document.xml.rels" ||
    /^word\/(?:header|footer)\d+[.]xml$/.test(name) ||
    ["word/footnotes.xml", "word/endnotes.xml"].includes(name) ||
    ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"]
      .includes(name) ||
    /^xl\/worksheets\/sheet\d+[.]xml$/.test(name);
}

async function inspectInflatedEntry(
  compressed: Uint8Array,
  maximumBytes: number,
  expectedCrc32: number,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<{ size: number; bytes?: Uint8Array }> {
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([Uint8Array.from(compressed)]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
  } catch {
    throw extractionError(
      503,
      "UPLOAD_ARCHIVE_RUNTIME_UNAVAILABLE",
      "TED cannot safely inspect that Office file right now. Please try again.",
      true,
    );
  }
  const reader = stream.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  let crcState = 0xffffffff;
  try {
    while (true) {
      assertParserWork(signal, deadline);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel("UPLOAD_ARCHIVE_EXPANSION_LIMIT");
        } catch {
          // Preserve the resource-limit result if cancellation fails.
        }
        throw extractionError(
          413,
          "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
          "That Office file expands beyond the safe processing limit.",
        );
      }
      crcState = updateCrc32(crcState, value);
      chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    if (error instanceof UploadExtractionError) throw error;
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_INVALID",
      "That Office file contains invalid compressed data.",
    );
  } finally {
    reader.releaseLock();
  }
  if (((crcState ^ 0xffffffff) >>> 0) !== expectedCrc32) {
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_CRC_INVALID",
      "That Office file contains damaged internal data.",
    );
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { size: total, bytes: output };
}

async function inspectOfficeArchiveUncached(
  bytes: Uint8Array,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<ArchiveInspection> {
  const { entries, centralOffset } = parseCentralDirectory(bytes);
  const names = new Set<string>();
  const selectedContents = new Map<string, Uint8Array>();
  const resolved: Array<
    ZipEntry & { contentOffset: number; endOffset: number }
  > = [];
  for (const entry of entries) {
    assertParserWork(signal, deadline);
    ensureRange(bytes, entry.localOffset, 30);
    if (readUint32(bytes, entry.localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_INVALID",
        "That Office file contains an invalid local entry.",
      );
    }
    const localFlags = readUint16(bytes, entry.localOffset + 6);
    const localMethod = readUint16(bytes, entry.localOffset + 8);
    const localCrc32 = readUint32(bytes, entry.localOffset + 14);
    const localCompressedSize = readUint32(bytes, entry.localOffset + 18);
    const localUncompressedSize = readUint32(bytes, entry.localOffset + 22);
    const localNameLength = readUint16(bytes, entry.localOffset + 26);
    const localExtraLength = readUint16(bytes, entry.localOffset + 28);
    const contentOffset = entry.localOffset + 30 + localNameLength +
      localExtraLength;
    ensureRange(
      bytes,
      entry.localOffset + 30,
      localNameLength + localExtraLength,
    );
    rejectZip64Extra(
      bytes,
      entry.localOffset + 30 + localNameLength,
      localExtraLength,
    );
    ensureRange(bytes, contentOffset, entry.compressedSize);
    if (
      contentOffset + entry.compressedSize > centralOffset ||
      localFlags !== entry.flags || localMethod !== entry.method ||
      localCrc32 !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_INVALID",
        "That Office file contains inconsistent archive entries.",
      );
    }
    let localName: string;
    try {
      localName = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(
          entry.localOffset + 30,
          entry.localOffset + 30 + localNameLength,
        ),
      );
    } catch {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_PATH_INVALID",
        "That Office file contains an invalid internal path.",
      );
    }
    if (localName !== entry.name) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_INVALID",
        "That Office file contains inconsistent internal paths.",
      );
    }

    resolved.push({
      ...entry,
      contentOffset,
      endOffset: contentOffset + entry.compressedSize,
    });
    names.add(entry.name);
  }

  const ranges = [...resolved].sort((left, right) =>
    left.localOffset - right.localOffset
  );
  let previousEnd = 0;
  for (const entry of ranges) {
    if (entry.localOffset < previousEnd) {
      throw extractionError(
        422,
        "UPLOAD_ARCHIVE_INVALID",
        "That Office file contains overlapping internal entries.",
      );
    }
    previousEnd = entry.endOffset;
  }

  let retainedTotal = 0;
  for (const entry of resolved) {
    if (!shouldRetainArchiveEntry(entry.name)) continue;
    assertParserWork(signal, deadline);
    const remaining = MAX_ARCHIVE_UNCOMPRESSED_BYTES - retainedTotal;
    const maximumBytes = Math.min(
      entry.uncompressedSize,
      MAX_ARCHIVE_ENTRY_BYTES,
      remaining,
    );
    if (maximumBytes < entry.uncompressedSize) {
      throw extractionError(
        413,
        "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
        "That Office file expands beyond the safe processing limit.",
      );
    }
    const compressed = bytes.subarray(entry.contentOffset, entry.endOffset);
    let content: Uint8Array;
    if (entry.method === 0) {
      if (
        compressed.byteLength !== entry.uncompressedSize ||
        crc32(compressed) !== entry.crc32
      ) {
        throw extractionError(
          422,
          "UPLOAD_ARCHIVE_CRC_INVALID",
          "That Office file contains damaged internal data.",
        );
      }
      content = Uint8Array.from(compressed);
    } else {
      const inspected = await inspectInflatedEntry(
        compressed,
        maximumBytes,
        entry.crc32,
        signal,
        deadline,
      );
      if (inspected.size !== entry.uncompressedSize || !inspected.bytes) {
        throw extractionError(
          422,
          "UPLOAD_ARCHIVE_INVALID",
          "That Office file contains inconsistent size metadata.",
        );
      }
      content = inspected.bytes;
    }
    retainedTotal += content.byteLength;
    selectedContents.set(entry.name, content);
  }
  return { names, selectedContents };
}

function inspectOfficeArchive(
  bytes: Uint8Array,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<ArchiveInspection> {
  const cached = archiveInspections.get(bytes);
  if (cached) return cached;
  const inspection = inspectOfficeArchiveUncached(bytes, signal, deadline);
  archiveInspections.set(bytes, inspection);
  return inspection;
}

function assertFormatMetadata(
  format: UploadFormat,
  filename: string,
  mime: string,
): void {
  const extension = extensionOf(filename);
  const normalizedMime = mime.normalize("NFKC").trim().toLowerCase();
  const genericMimes = new Set([
    "",
    "application/octet-stream",
    "binary/octet-stream",
  ]);
  const extensions: Record<UploadFormat, Set<string>> = {
    pdf: new Set(["pdf"]),
    docx: new Set(["docx"]),
    xlsx: new Set(["xlsx"]),
    text: new Set(["txt", "md", "csv"]),
  };
  const mimes: Record<Exclude<UploadFormat, "text">, Set<string>> = {
    pdf: new Set(["application/pdf"]),
    docx: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
      "application/x-zip-compressed",
    ]),
    xlsx: new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "application/x-zip-compressed",
    ]),
  };
  const textMimes = extension === "csv"
    ? new Set(["text/csv", "text/plain", "application/vnd.ms-excel"])
    : extension === "md"
    ? new Set([
      "text/markdown",
      "text/x-markdown",
      "application/markdown",
      "text/plain",
    ])
    : new Set(["text/plain"]);
  const allowedMime = format === "text" ? textMimes : mimes[format];
  if (
    !extensions[format].has(extension) ||
    (!genericMimes.has(normalizedMime) && !allowedMime.has(normalizedMime))
  ) {
    throw extractionError(
      422,
      "UPLOAD_FORMAT_MISMATCH",
      "The file contents do not match its name or declared file type.",
    );
  }
}

export async function resolveUploadFormat(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<UploadFormat> {
  assertParserWork(signal, deadline);
  if (bytes.byteLength === 0) {
    throw extractionError(
      422,
      "UPLOAD_FILE_EMPTY",
      "The uploaded file is empty.",
    );
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw extractionError(
      413,
      "UPLOAD_TOO_LARGE",
      "Files need to be 8MB or smaller.",
    );
  }
  const extension = extensionOf(filename);
  const normalizedMime = mime.normalize("NFKC").trim().toLowerCase();
  if (
    ["doc", "xls", "docm", "xlsm"].includes(extension) ||
    normalizedMime.includes("macroenabled") ||
    startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  ) {
    throw extractionError(
      422,
      "UPLOAD_LEGACY_FORMAT_UNSUPPORTED",
      "Legacy and macro-enabled Office files are not supported. Save a macro-free PDF, DOCX, or XLSX copy and try again.",
    );
  }
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(bytes, [0xff, 0xd8, 0xff]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) ||
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
  ) {
    throw extractionError(
      422,
      "UPLOAD_IMAGE_UNSUPPORTED",
      "TED cannot read photos yet. Use a text-based PDF, DOCX, XLSX, or text file.",
    );
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    assertFormatMetadata("pdf", filename, mime);
    return "pdf";
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const archive = await inspectOfficeArchive(bytes, signal, deadline);
    if (
      Array.from(archive.names).some((name) =>
        /(?:^|\/)(?:vbaproject[.]bin|activex\/|embeddings\/)/i.test(name) ||
        /[.](?:bin|exe|dll|js|vbs)$/i.test(name)
      )
    ) {
      throw extractionError(
        422,
        "UPLOAD_ACTIVE_CONTENT_UNSUPPORTED",
        "Macro-enabled Office files are not supported. Save a macro-free copy and try again.",
      );
    }
    const isDocx = archive.names.has("[Content_Types].xml") &&
      archive.names.has("word/document.xml");
    const isXlsx = archive.names.has("[Content_Types].xml") &&
      archive.names.has("xl/workbook.xml");
    if (isDocx === isXlsx) {
      throw extractionError(
        422,
        "UPLOAD_OFFICE_FORMAT_INVALID",
        "That archive is not a supported Word or Excel document.",
      );
    }
    const format: UploadFormat = isDocx ? "docx" : "xlsx";
    validateOfficePackage(
      archive,
      isDocx ? "word/document.xml" : "xl/workbook.xml",
      isDocx
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    );
    assertFormatMetadata(format, filename, mime);
    return format;
  }

  if (
    normalizedMime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension)
  ) {
    throw extractionError(
      422,
      "UPLOAD_IMAGE_UNSUPPORTED",
      "TED cannot read photos yet. Use a text-based PDF, DOCX, XLSX, or text file.",
    );
  }
  if (
    normalizedMime.startsWith("text/") ||
    ["txt", "md", "csv"].includes(extension)
  ) {
    if (bytes.byteLength > MAX_TEXT_UPLOAD_BYTES) {
      throw extractionError(
        413,
        "UPLOAD_TEXT_RESOURCE_LIMIT",
        "Text files need to be 1MB or smaller.",
      );
    }
    if (bytes.includes(0)) {
      throw extractionError(
        422,
        "UPLOAD_TEXT_ENCODING_INVALID",
        "That text file contains unsupported binary data.",
      );
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw extractionError(
        422,
        "UPLOAD_TEXT_ENCODING_INVALID",
        "Text files must use UTF-8 encoding.",
      );
    }
    assertFormatMetadata("text", filename, mime);
    return "text";
  }
  throw extractionError(
    422,
    "UPLOAD_FORMAT_UNSUPPORTED",
    "That file type is not supported. Use a text-based PDF, DOCX, XLSX, or text file.",
  );
}

function boundedResult(
  rawText: string,
  format: UploadFormat,
  alreadyTruncated = false,
): UploadExtractionResult {
  const cleaned = rawText
    .split("\u0000")
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  const truncated = alreadyTruncated ||
    cleaned.length > MAX_EXTRACTED_TEXT_CHARS;
  return {
    text: cleaned.slice(0, MAX_EXTRACTED_TEXT_CHARS),
    format,
    truncated,
    resourcePolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION,
  };
}

function normalizePdfFailure(error: unknown): UploadExtractionError {
  if (error instanceof UploadExtractionError) return error;
  const name = error instanceof Error ? error.name : "";
  if (
    [
      "InvalidPDFException",
      "MissingPDFException",
      "PasswordException",
      "UnexpectedResponseException",
    ].includes(name)
  ) {
    return extractionError(
      422,
      "UPLOAD_PDF_INVALID",
      "That PDF is malformed, incomplete, or password protected.",
    );
  }
  return extractionError(
    503,
    "UPLOAD_PDF_RUNTIME_UNAVAILABLE",
    "TED cannot safely read that PDF right now. Please try again.",
    true,
  );
}

async function extractPdf(
  bytes: Uint8Array,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<UploadExtractionResult> {
  let getDocumentProxy: typeof import("npm:unpdf")["getDocumentProxy"];
  try {
    ({ getDocumentProxy } = await import("npm:unpdf"));
  } catch {
    throw extractionError(
      503,
      "UPLOAD_PDF_RUNTIME_UNAVAILABLE",
      "TED cannot safely read that PDF right now. Please try again.",
      true,
    );
  }
  assertParserWork(signal, deadline);
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes, {
      disableAutoFetch: true,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      enableXfa: false,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
    });
  } catch (error) {
    throw normalizePdfFailure(error);
  }
  let primaryError: unknown = null;
  try {
    if (
      !Number.isInteger(pdf.numPages) || pdf.numPages < 1 ||
      pdf.numPages > MAX_PDF_PAGES
    ) {
      throw extractionError(
        413,
        "UPLOAD_PDF_PAGE_LIMIT",
        `PDF files may contain at most ${MAX_PDF_PAGES} pages.`,
      );
    }
    const parts: string[] = [];
    let textChars = 0;
    let chunks = 0;
    let items = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      assertParserWork(signal, deadline);
      const page = await pdf.getPage(pageNumber);
      let pageError: unknown = null;
      try {
        const reader = page.streamTextContent().getReader();
        try {
          while (!truncated) {
            assertParserWork(signal, deadline);
            const { done, value } = await reader.read();
            if (done) break;
            chunks += 1;
            if (
              chunks > MAX_PDF_TEXT_CHUNKS || !value ||
              !Array.isArray(value.items)
            ) {
              throw extractionError(
                413,
                "UPLOAD_PDF_TEXT_LIMIT",
                "That PDF contains too much text structure to process safely.",
              );
            }
            for (const item of value.items) {
              items += 1;
              if (items > MAX_PDF_TEXT_ITEMS) {
                throw extractionError(
                  413,
                  "UPLOAD_PDF_TEXT_LIMIT",
                  "That PDF contains too much text structure to process safely.",
                );
              }
              if (!item || typeof item !== "object" || !("str" in item)) {
                continue;
              }
              const candidate = item as { str?: unknown; hasEOL?: unknown };
              if (typeof candidate.str !== "string") continue;
              if (candidate.str.length > MAX_PDF_ITEM_CHARS) {
                throw extractionError(
                  413,
                  "UPLOAD_PDF_TEXT_LIMIT",
                  "That PDF contains an oversized text item.",
                );
              }
              const suffix = candidate.hasEOL === true ? "\n" : "";
              const remaining = MAX_EXTRACTED_TEXT_CHARS + 1 - textChars;
              const piece = `${candidate.str}${suffix}`.slice(
                0,
                Math.max(0, remaining),
              );
              if (piece) {
                parts.push(piece);
                textChars += piece.length;
              }
              if (candidate.str.length + suffix.length > remaining) {
                truncated = true;
                try {
                  await reader.cancel("UPLOAD_TEXT_LIMIT_REACHED");
                } catch {
                  // Preserve the successful bounded truncation decision.
                }
                break;
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        pageError = error;
        throw error;
      } finally {
        try {
          page.cleanup();
        } catch {
          if (!pageError) {
            throw extractionError(
              503,
              "UPLOAD_PDF_RUNTIME_UNAVAILABLE",
              "TED cannot safely finish reading that PDF right now.",
              true,
            );
          }
        }
      }
      if (truncated) break;
      if (textChars < MAX_EXTRACTED_TEXT_CHARS + 1) {
        parts.push("\n");
        textChars += 1;
      }
    }
    return boundedResult(parts.join(""), "pdf", truncated);
  } catch (error) {
    primaryError = normalizePdfFailure(error);
    throw primaryError;
  } finally {
    try {
      await pdf.destroy();
    } catch {
      if (!primaryError) {
        throw extractionError(
          503,
          "UPLOAD_PDF_RUNTIME_UNAVAILABLE",
          "TED cannot safely finish reading that PDF right now.",
          true,
        );
      }
    }
  }
}

function xmlBytesToText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_XML_INVALID",
      "That Office file contains invalid XML text encoding.",
    );
  }
}

function scanOfficeXml(
  xml: string,
  visitor: (event: BoundedXmlEvent) => void,
): void {
  try {
    scanBoundedXml(xml, visitor);
  } catch (error) {
    if (error instanceof UploadExtractionError) throw error;
    if (error instanceof BoundedXmlError) {
      throw extractionError(
        error.code === "resource_limit" ? 413 : 422,
        error.code === "resource_limit"
          ? "UPLOAD_OFFICE_XML_RESOURCE_LIMIT"
          : error.code === "unsafe"
          ? "UPLOAD_OFFICE_ACTIVE_XML_UNSUPPORTED"
          : "UPLOAD_OFFICE_XML_INVALID",
        error.code === "resource_limit"
          ? "That Office file contains too much XML data to process safely."
          : "That Office file contains malformed or unsafe XML.",
      );
    }
    throw extractionError(
      503,
      "UPLOAD_OFFICE_XML_RUNTIME_UNAVAILABLE",
      "TED cannot safely read that Office file right now. Please try again.",
      true,
    );
  }
}

function xmlAttribute(
  attributes: ReadonlyMap<string, string>,
  name: string,
): string | null {
  const exact = attributes.get(name);
  if (exact !== undefined) return exact;
  for (const [candidate, value] of attributes) {
    if (localXmlName(candidate) === name) return value;
  }
  return null;
}

function normalizedPartTarget(sourcePart: string, target: string): string {
  if (
    !target || target.length > 800 || target.includes("\\") ||
    target.includes("?") || target.includes("#") || target.includes("%") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
      "That Office file contains an unsafe internal relationship.",
    );
  }
  const base = sourcePart.includes("/")
    ? sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1)
    : "";
  const combined = target.startsWith("/")
    ? target.slice(1)
    : `${base}${target.replace(/^\.\//, "")}`;
  const segments = combined.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
      "That Office file contains an unsafe internal relationship.",
    );
  }
  return segments.join("/");
}

interface OfficeRelationship {
  id: string;
  type: string;
  target: string;
}

function officeRelationships(
  xml: string,
  sourcePart: string,
): Map<string, OfficeRelationship> {
  const relationships = new Map<string, OfficeRelationship>();
  scanOfficeXml(xml, (event) => {
    if (event.kind !== "start" || localXmlName(event.name) !== "Relationship") {
      return;
    }
    const id = xmlAttribute(event.attributes, "Id");
    const type = xmlAttribute(event.attributes, "Type");
    const target = xmlAttribute(event.attributes, "Target");
    const targetMode = xmlAttribute(event.attributes, "TargetMode");
    if (!id || !type || !target || relationships.has(id)) {
      throw extractionError(
        422,
        "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
        "That Office file contains invalid internal relationships.",
      );
    }
    if (targetMode?.toLowerCase() === "external") {
      throw extractionError(
        422,
        "UPLOAD_OFFICE_EXTERNAL_RELATIONSHIP_UNSUPPORTED",
        "Office files with external links are not supported.",
      );
    }
    relationships.set(id, {
      id,
      type,
      target: normalizedPartTarget(sourcePart, target),
    });
    if (relationships.size > MAX_XML_RELATIONSHIPS) {
      throw extractionError(
        413,
        "UPLOAD_OFFICE_RELATIONSHIP_LIMIT",
        "That Office file contains too many internal relationships.",
      );
    }
  });
  return relationships;
}

function contentTypeOverrides(xml: string): Map<string, string> {
  const overrides = new Map<string, string>();
  scanOfficeXml(xml, (event) => {
    if (event.kind !== "start") return;
    const name = localXmlName(event.name);
    if (name !== "Override" && name !== "Default") return;
    const contentType = xmlAttribute(event.attributes, "ContentType") ?? "";
    const partName = name === "Override"
      ? xmlAttribute(event.attributes, "PartName") ?? ""
      : xmlAttribute(event.attributes, "Extension") ?? "";
    const unsafe = `${partName} ${contentType}`.toLowerCase();
    if (
      !partName || !contentType ||
      /(?:macroenabled|vba|activex|oleobject|embeddedpackage)/.test(unsafe)
    ) {
      throw extractionError(
        422,
        "UPLOAD_ACTIVE_CONTENT_UNSUPPORTED",
        "Macro-enabled or embedded active Office content is not supported.",
      );
    }
    if (name === "Override") {
      const normalized = normalizedPartTarget("", partName);
      if (overrides.has(normalized)) {
        throw extractionError(
          422,
          "UPLOAD_OFFICE_FORMAT_INVALID",
          "That Office file contains duplicate content declarations.",
        );
      }
      overrides.set(normalized, contentType);
    }
  });
  return overrides;
}

function validateOfficePackage(
  archive: ArchiveInspection,
  expectedMainPart: "word/document.xml" | "xl/workbook.xml",
  expectedMainContentType: string,
): Map<string, string> {
  const contentTypesBytes = archive.selectedContents.get("[Content_Types].xml");
  const rootRelationshipsBytes = archive.selectedContents.get("_rels/.rels");
  if (!contentTypesBytes || !rootRelationshipsBytes) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_FORMAT_INVALID",
      "That Office file is missing required package metadata.",
    );
  }
  const contentTypes = contentTypeOverrides(xmlBytesToText(contentTypesBytes));
  if (contentTypes.get(expectedMainPart) !== expectedMainContentType) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_FORMAT_INVALID",
      "That Office file has an invalid main document type.",
    );
  }
  const rootRelationships = officeRelationships(
    xmlBytesToText(rootRelationshipsBytes),
    "",
  );
  const mainRelationships = Array.from(rootRelationships.values()).filter((
    item,
  ) => item.type.endsWith("/officeDocument"));
  if (
    mainRelationships.length !== 1 ||
    mainRelationships[0]?.target !== expectedMainPart
  ) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_FORMAT_INVALID",
      "That Office file does not identify one supported main document.",
    );
  }
  return contentTypes;
}

function wordPartText(xml: string): string {
  const output: string[] = [];
  let outputChars = 0;
  let textDepth = 0;
  let truncated = false;
  const append = (value: string) => {
    if (!value || truncated) return;
    const remaining = MAX_EXTRACTED_TEXT_CHARS + 1 - outputChars;
    if (remaining <= 0) {
      truncated = true;
      return;
    }
    output.push(value.slice(0, remaining));
    outputChars += Math.min(value.length, remaining);
    if (value.length > remaining) truncated = true;
  };
  scanOfficeXml(xml, (event) => {
    if (event.kind === "start") {
      const name = localXmlName(event.name);
      if (name === "t") textDepth += 1;
      else if (name === "tab") append("\t");
      else if (name === "br" || name === "cr") append("\n");
    } else if (event.kind === "end") {
      const name = localXmlName(event.name);
      if (name === "t") textDepth = Math.max(0, textDepth - 1);
      else if (name === "p" || name === "tr") append("\n");
      else if (name === "tc") append("\t");
    } else if (textDepth > 0) append(event.text);
  });
  return output.join("");
}

async function extractDocx(
  bytes: Uint8Array,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<UploadExtractionResult> {
  const archive = await inspectOfficeArchive(bytes, signal, deadline);
  validateOfficePackage(
    archive,
    "word/document.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  );
  const documentBytes = archive.selectedContents.get("word/document.xml");
  if (!documentBytes) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_FORMAT_INVALID",
      "That Word document is missing its main content.",
    );
  }
  const orderedNames = ["word/document.xml"];
  const relationshipsBytes = archive.selectedContents.get(
    "word/_rels/document.xml.rels",
  );
  if (relationshipsBytes) {
    const relationships = officeRelationships(
      xmlBytesToText(relationshipsBytes),
      "word/document.xml",
    );
    const allowed = new Set(["header", "footer", "footnotes", "endnotes"]);
    for (const relationship of relationships.values()) {
      const type = relationship.type.slice(
        relationship.type.lastIndexOf("/") + 1,
      );
      if (!allowed.has(type)) continue;
      if (!archive.selectedContents.has(relationship.target)) {
        throw extractionError(
          422,
          "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
          "That Word document references missing content.",
        );
      }
      orderedNames.push(relationship.target);
    }
  }
  let text = "";
  let truncated = false;
  for (const name of Array.from(new Set(orderedNames))) {
    assertParserWork(signal, deadline);
    const content = archive.selectedContents.get(name);
    if (!content) continue;
    const extracted = wordPartText(xmlBytesToText(content));
    const remaining = MAX_EXTRACTED_TEXT_CHARS - text.length;
    if (extracted.length > remaining) {
      text += extracted.slice(0, Math.max(0, remaining));
      truncated = true;
      break;
    }
    text += `${extracted}\n`;
  }
  return boundedResult(text, "docx", truncated);
}

function sharedStringValues(xml: string): string[] {
  const values: string[] = [];
  let inSharedString = 0;
  let inText = 0;
  let current = "";
  let aggregateCharacters = 0;
  scanOfficeXml(xml, (event) => {
    if (event.kind === "start") {
      const name = localXmlName(event.name);
      if (name === "si") {
        inSharedString += 1;
        current = "";
      } else if (name === "t" && inSharedString > 0) inText += 1;
    } else if (event.kind === "end") {
      const name = localXmlName(event.name);
      if (name === "t" && inText > 0) inText -= 1;
      else if (name === "si" && inSharedString > 0) {
        inSharedString -= 1;
        const value = current.replace(/\s+/g, " ").trim();
        aggregateCharacters += value.length;
        if (
          values.length >= MAX_XLSX_TOTAL_CELLS ||
          aggregateCharacters > 2 * 1024 * 1024
        ) {
          throw extractionError(
            413,
            "UPLOAD_XLSX_CELL_LIMIT",
            "That Excel file contains too many shared text values to process safely.",
          );
        }
        values.push(value);
      }
    } else if (inText > 0 && current.length <= 4_096) {
      current += event.text.slice(0, 4_097 - current.length);
      if (current.length > 4_096) {
        throw extractionError(
          413,
          "UPLOAD_XLSX_CELL_LIMIT",
          "That Excel file contains a text value that is too large to process safely.",
        );
      }
    }
  });
  return values;
}

interface WorkbookSheet {
  name: string;
  path: string;
}

function workbookSheets(
  archive: ArchiveInspection,
  relationships: Map<string, OfficeRelationship>,
): WorkbookSheet[] {
  const workbookBytes = archive.selectedContents.get("xl/workbook.xml");
  if (!workbookBytes) return [];
  const sheets: WorkbookSheet[] = [];
  let declaredSheets = 0;
  scanOfficeXml(xmlBytesToText(workbookBytes), (event) => {
    if (event.kind !== "start" || localXmlName(event.name) !== "sheet") return;
    declaredSheets += 1;
    if (declaredSheets > MAX_XLSX_SHEETS) {
      throw extractionError(
        413,
        "UPLOAD_XLSX_SHEET_LIMIT",
        `Excel files may contain at most ${MAX_XLSX_SHEETS} sheets.`,
      );
    }
    const id = xmlAttribute(event.attributes, "id");
    const name = xmlAttribute(event.attributes, "name");
    const state = (xmlAttribute(event.attributes, "state") ?? "visible")
      .toLowerCase();
    const relationship = id ? relationships.get(id) : undefined;
    if (
      !id || !name || name.length > 120 || !relationship ||
      !relationship.type.endsWith("/worksheet") ||
      !/^xl\/worksheets\/[^/]+[.]xml$/.test(relationship.target)
    ) {
      throw extractionError(
        422,
        "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
        "That Excel workbook contains an invalid worksheet relationship.",
      );
    }
    if (state === "hidden" || state === "veryhidden") return;
    if (state !== "visible") {
      throw extractionError(
        422,
        "UPLOAD_OFFICE_XML_INVALID",
        "That Excel workbook contains an invalid worksheet state.",
      );
    }
    sheets.push({ name, path: relationship.target });
  });
  return sheets;
}

function worksheetText(
  xml: string,
  sharedStrings: string[],
  remainingGlobalCells: number,
): { text: string; cells: number; rows: number; truncated: boolean } {
  const lines: string[] = [];
  let rowValues: string[] | null = null;
  let cellType = "";
  let cellValue = "";
  let captureValueDepth = 0;
  let cells = 0;
  let rows = 0;
  let totalChars = 0;
  let truncated = false;
  const appendCellText = (value: string) => {
    if (cellValue.length + value.length > 4_096) {
      throw extractionError(
        413,
        "UPLOAD_XLSX_CELL_LIMIT",
        "That Excel file contains a text value that is too large to process safely.",
      );
    }
    cellValue += value;
  };
  scanOfficeXml(xml, (event) => {
    if (event.kind === "start") {
      const name = localXmlName(event.name);
      if (name === "row") {
        if (rowValues !== null) {
          throw extractionError(
            422,
            "UPLOAD_OFFICE_XML_INVALID",
            "That Excel worksheet contains invalid nested rows.",
          );
        }
        rows += 1;
        if (rows > MAX_XLSX_ROWS_PER_SHEET) {
          throw extractionError(
            413,
            "UPLOAD_XLSX_CELL_LIMIT",
            "That Excel file contains too many rows or cells to process safely.",
          );
        }
        rowValues = [];
      } else if (name === "c" && rowValues !== null) {
        cells += 1;
        if (
          cells > MAX_XLSX_CELLS_PER_SHEET || cells > remainingGlobalCells
        ) {
          throw extractionError(
            413,
            "UPLOAD_XLSX_CELL_LIMIT",
            "That Excel file contains too many rows or cells to process safely.",
          );
        }
        const reference = xmlAttribute(event.attributes, "r") ?? "";
        if (reference.length > 32) {
          throw extractionError(
            413,
            "UPLOAD_XLSX_CELL_LIMIT",
            "That Excel file contains an oversized cell reference.",
          );
        }
        cellType = xmlAttribute(event.attributes, "t") ?? "";
        cellValue = "";
      } else if (
        (name === "v" || (name === "t" && cellType === "inlineStr")) &&
        rowValues !== null
      ) captureValueDepth += 1;
    } else if (event.kind === "text" && captureValueDepth > 0) {
      appendCellText(event.text);
    } else if (event.kind === "end") {
      const name = localXmlName(event.name);
      if (
        (name === "v" || (name === "t" && cellType === "inlineStr")) &&
        captureValueDepth > 0
      ) captureValueDepth -= 1;
      else if (name === "c" && rowValues !== null) {
        const raw = cellValue.trim();
        const value = cellType === "s" && /^\d+$/.test(raw)
          ? sharedStrings[Number(raw)] ?? ""
          : raw;
        rowValues.push(value.replace(/[\t\r\n]+/g, " ").trim());
        cellType = "";
        cellValue = "";
        captureValueDepth = 0;
      } else if (name === "row" && rowValues !== null) {
        const line = rowValues.join(",").replace(/,+$/, "");
        rowValues = null;
        if (!line || truncated) return;
        const remaining = MAX_EXTRACTED_TEXT_CHARS - totalChars;
        if (line.length + 1 > remaining) {
          lines.push(line.slice(0, Math.max(0, remaining)));
          truncated = true;
          return;
        }
        lines.push(line);
        totalChars += line.length + 1;
      }
    }
  });
  return { text: lines.join("\n"), cells, rows, truncated };
}

async function extractXlsx(
  bytes: Uint8Array,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<UploadExtractionResult> {
  const archive = await inspectOfficeArchive(bytes, signal, deadline);
  validateOfficePackage(
    archive,
    "xl/workbook.xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  );
  const relationshipsBytes = archive.selectedContents.get(
    "xl/_rels/workbook.xml.rels",
  );
  if (!relationshipsBytes) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_FORMAT_INVALID",
      "That Excel workbook is missing its worksheet relationships.",
    );
  }
  const relationships = officeRelationships(
    xmlBytesToText(relationshipsBytes),
    "xl/workbook.xml",
  );
  const sheets = workbookSheets(archive, relationships);
  const sharedRelationship = Array.from(relationships.values()).find((item) =>
    item.type.endsWith("/sharedStrings")
  );
  const sharedBytes = sharedRelationship
    ? archive.selectedContents.get(sharedRelationship.target)
    : undefined;
  if (sharedRelationship && !sharedBytes) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
      "That Excel workbook references missing shared strings.",
    );
  }
  const sharedStrings = sharedBytes
    ? sharedStringValues(xmlBytesToText(sharedBytes))
    : [];
  const parts: string[] = [];
  let totalCells = 0;
  let totalChars = 0;
  let truncated = false;
  for (const sheet of sheets) {
    assertParserWork(signal, deadline);
    const content = archive.selectedContents.get(sheet.path);
    if (!content) {
      throw extractionError(
        422,
        "UPLOAD_OFFICE_RELATIONSHIP_INVALID",
        "That Excel workbook references a missing worksheet.",
      );
    }
    const extracted = worksheetText(
      xmlBytesToText(content),
      sharedStrings,
      MAX_XLSX_TOTAL_CELLS - totalCells,
    );
    totalCells += extracted.cells;
    if (!extracted.text) continue;
    const part = `## Sheet: ${sheet.name}\n${extracted.text}`;
    const remaining = MAX_EXTRACTED_TEXT_CHARS - totalChars;
    if (part.length > remaining) {
      parts.push(part.slice(0, Math.max(0, remaining)));
      truncated = true;
      break;
    }
    parts.push(part);
    totalChars += part.length + 2;
    if (extracted.truncated) {
      truncated = true;
      break;
    }
  }
  return boundedResult(parts.join("\n\n"), "xlsx", truncated);
}

export async function extractBoundedUploadText(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal?: AbortSignal,
): Promise<UploadExtractionResult> {
  const deadline = Date.now() + PARSER_DEADLINE_MS;
  const format = await resolveUploadFormat(
    bytes,
    filename,
    mime,
    signal,
    deadline,
  );
  if (format === "pdf") return await extractPdf(bytes, signal, deadline);
  if (format === "docx") return await extractDocx(bytes, signal, deadline);
  if (format === "xlsx") return await extractXlsx(bytes, signal, deadline);
  return boundedResult(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    "text",
  );
}
