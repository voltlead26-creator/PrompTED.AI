// deno-lint-ignore-file no-import-prefix no-unversioned-import

import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_RESOURCE_POLICY_VERSION,
  UPLOAD_RESOURCE_POLICY_VERSION_V2,
  type UploadExtractionResult,
  type UploadFormat,
} from "./upload-extraction-contract.ts";
import {
  BoundedXmlError,
  type BoundedXmlEvent,
  localXmlName,
  scanBoundedXml,
} from "./bounded-xml.ts";
import {
  applyWordXmlSourcePatches,
  captureWordXmlSourcePatches,
  mapWordXmlSource,
  WORD_XML_SOURCE_POLICY,
  type WordXmlSource,
  WordXmlSourceError,
} from "./wordprocessingml-source.ts";
import {
  DOCX_SOURCE_POLICY,
  docxSourceBlockers,
  type DocxSourceManifest,
  encodeOfficePartRoster,
  type OfficeSourcePart,
  RTF_SOURCE_POLICY,
  type RtfSourceManifest,
  type SourceUploadExtractionResult,
  type SourceUploadExtractionResultV3,
} from "./document-source-contract.ts";
import { readRtfText, RtfSourceError } from "./rtf-source.ts";
import { BoundedRtfError } from "./bounded-rtf.ts";
export {
  DOCX_SOURCE_POLICY,
  type DocxSourceManifest,
  type OfficeSourcePart,
  type SourceUploadExtractionResult,
} from "./document-source-contract.ts";
export {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_RESOURCE_POLICY_VERSION,
  type UploadExtractionResult,
  type UploadFormat,
} from "./upload-extraction-contract.ts";
export { assertFormatMetadata as assertUploadFormatMetadata };

/** V3 metadata authority is shared by the producer and its privileged publisher. */
export function assertUploadFormatMetadataV3(
  format: SourceUploadExtractionResultV3["format"],
  filename: string,
  mime: string,
): void {
  if (format !== "rtf") return assertFormatMetadata(format, filename, mime);
  const normalizedMime = mime.normalize("NFKC").trim().toLowerCase();
  if (
    extensionOf(filename) !== "rtf" ||
    ![
      "",
      "application/octet-stream",
      "binary/octet-stream",
      "application/rtf",
      "text/rtf",
      // Existing empty-MIME JSON claims retain the extension as file_type.
      "rtf",
    ].includes(normalizedMime)
  ) {
    throw extractionError(
      422,
      "UPLOAD_FORMAT_MISMATCH",
      "The file contents do not match its name or declared file type.",
    );
  }
}

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
  centralEntryOffset: number;
}

interface ArchiveInspection {
  names: Set<string>;
  selectedContents: Map<string, Uint8Array>;
  sourceParts?: readonly OfficeSourcePart[];
}

type ResolvedUpload =
  | { format: "docx"; archive: ArchiveInspection }
  | { format: "xlsx"; archive: ArchiveInspection }
  | { format: "pdf" }
  | { format: "text"; text: string };

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
      centralEntryOffset: cursor,
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
  retain: boolean,
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
  let finished = false;
  try {
    while (true) {
      assertParserWork(signal, deadline);
      const { done, value } = await reader.read();
      assertParserWork(signal, deadline);
      if (done) {
        finished = true;
        break;
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        throw extractionError(
          413,
          "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
          "That Office file expands beyond the safe processing limit.",
        );
      }
      crcState = updateCrc32(crcState, value);
      if (retain) chunks.push(Uint8Array.from(value));
    }
  } catch (error) {
    if (error instanceof UploadExtractionError) throw error;
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_INVALID",
      "That Office file contains invalid compressed data.",
    );
  } finally {
    if (!finished) {
      try {
        // Abandon remaining work on cancellation, deadline or malformed data.
        // Cleanup cannot postpone or replace the primary extraction failure.
        void reader.cancel("UPLOAD_ARCHIVE_READ_ABANDONED").catch(() => {});
      } catch {
        // Preserve the existing failure if cleanup cannot be initiated.
      }
    }
    reader.releaseLock();
  }
  if (((crcState ^ 0xffffffff) >>> 0) !== expectedCrc32) {
    throw extractionError(
      422,
      "UPLOAD_ARCHIVE_CRC_INVALID",
      "That Office file contains damaged internal data.",
    );
  }
  if (!retain) return { size: total };
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { size: total, bytes: output };
}

async function inspectOfficeArchive(
  bytes: Uint8Array,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
  describeSourceParts = false,
): Promise<ArchiveInspection> {
  const { entries, centralOffset } = parseCentralDirectory(bytes);
  const names = new Set<string>();
  const selectedContents = new Map<string, Uint8Array>();
  // Only a DOCX candidate needs a source roster. Keep non-DOCX extraction's
  // existing streaming resource behaviour when this reader is requested.
  const sourceParts: OfficeSourcePart[] | undefined = describeSourceParts &&
      entries.some((entry) => entry.name === "word/document.xml")
    ? []
    : undefined;
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

  let inspectedTotal = 0;
  for (const entry of resolved) {
    const retain = shouldRetainArchiveEntry(entry.name);
    // Manifest inspection hashes one additional part at a time and discards
    // it. Ordinary text extraction still streams unselected parts without
    // collecting them. Both use this same inspection and expansion budget.
    const inspectContent = retain || sourceParts !== undefined;
    assertParserWork(signal, deadline);
    const remaining = MAX_ARCHIVE_UNCOMPRESSED_BYTES - inspectedTotal;
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
    let content: Uint8Array | undefined;
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
      if (inspectContent) content = Uint8Array.from(compressed);
    } else {
      const inspected = await inspectInflatedEntry(
        compressed,
        maximumBytes,
        entry.crc32,
        signal,
        deadline,
        inspectContent,
      );
      if (
        inspected.size !== entry.uncompressedSize ||
        (inspectContent && !inspected.bytes)
      ) {
        throw extractionError(
          422,
          "UPLOAD_ARCHIVE_INVALID",
          "That Office file contains inconsistent size metadata.",
        );
      }
      content = inspected.bytes;
    }
    // Every entry has now passed actual-size and CRC checks, even styles,
    // images and other parts that do not contribute extracted wording.
    inspectedTotal += entry.uncompressedSize;
    if (sourceParts && content) {
      sourceParts.push(Object.freeze({
        path: entry.name,
        compressionMethod: entry.method,
        compressedByteLength: entry.compressedSize,
        uncompressedByteLength: entry.uncompressedSize,
        crc32: entry.crc32,
        contentSha256: await sourceSha256(content, signal, deadline),
      }));
    }
    if (retain && content) selectedContents.set(entry.name, content);
  }
  assertParserWork(signal, deadline);
  return { names, selectedContents, sourceParts };
}

async function sourceSha256(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<string> {
  assertParserWork(signal, deadline);
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  assertParserWork(signal, deadline);
  return Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Build from the owned original, never a caller-supplied part list or offsets.
 * Kept private to the server source adapter: the v1 extraction response and
 * immutable checkpoints are unchanged and do not carry this larger manifest.
 */
export async function inspectDocxSource(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<DocxSourceManifest> {
  const owned = copyUploadBytes(bytes, signal, deadline);
  const resolved = await resolveOwnedUpload(
    owned,
    filename,
    mime,
    signal,
    deadline,
    true,
  );
  assertParserWork(signal, deadline);
  if (resolved.format !== "docx") {
    throw extractionError(
      422,
      "UPLOAD_DOCX_SOURCE_REQUIRED",
      "That source inspection requires a Word DOCX document.",
    );
  }
  return await assembleDocxSource(owned, resolved.archive, signal, deadline);
}

export const DOCX_SOURCE_CANDIDATE_VERSION = "docx-source-candidate.1" as const;

export interface DocxSourceCandidate {
  readonly version: typeof DOCX_SOURCE_CANDIDATE_VERSION;
  readonly originalArchiveSha256: string;
  readonly bytes: Uint8Array;
  readonly manifest: DocxSourceManifest;
}

/**
 * Unactivated source compiler, not edit/approval/export authority. Rebuild only
 * exact main-part text nodes from the owned original. Package semantics,
 * visibility and rendered layout remain unassessed in the immutable manifest.
 * A future consumer must bind owner, source, section and document revisions.
 */
export async function compileDocxSourceCandidate(
  bytes: Uint8Array,
  request: unknown,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<DocxSourceCandidate> {
  if (!Number.isFinite(deadline)) throw new WordXmlSourceError("invalid_patch");
  const boundedDeadline = Math.min(deadline, Date.now() + PARSER_DEADLINE_MS);
  const owned = copyUploadBytes(bytes, signal, boundedDeadline);
  if (
    request === null || typeof request !== "object" || Array.isArray(request) ||
    Object.keys(request).length !== 3 ||
    !Object.hasOwn(request, "version") ||
    !Object.hasOwn(request, "archiveSha256") ||
    !Object.hasOwn(request, "patches") ||
    !("version" in request) ||
    request.version !== DOCX_SOURCE_CANDIDATE_VERSION ||
    !("archiveSha256" in request) ||
    typeof request.archiveSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.archiveSha256) || !("patches" in request)
  ) throw new WordXmlSourceError("invalid_patch");
  const archiveSha256 = request.archiveSha256;
  const patches = captureWordXmlSourcePatches(request.patches);
  const resolved = await resolveOwnedUpload(
    owned,
    "source.docx",
    "",
    signal,
    boundedDeadline,
    true,
  );
  if (resolved.format !== "docx") {
    throw new WordXmlSourceError("unsupported_edit");
  }
  const before = await assembleDocxSource(
    owned,
    resolved.archive,
    signal,
    boundedDeadline,
  );
  if (before.archiveSha256 !== archiveSha256) {
    throw new WordXmlSourceError("identity_mismatch");
  }
  const unassessed = new Set([
    "package_semantics_unassessed",
    "styles_and_visibility_unassessed",
    "layout_unassessed",
  ]);
  if (before.blockers.some((blocker) => !unassessed.has(blocker))) {
    throw new WordXmlSourceError("unsupported_edit");
  }
  const main = resolved.archive.selectedContents.get("word/document.xml")!;
  const changed = await applyWordXmlSourcePatches(main, {
    version: WORD_XML_SOURCE_POLICY.version,
    originalSha256: before.mainPart.source.originalSha256,
    patches,
  }, { signal, deadline: boundedDeadline });
  assertParserWork(signal, boundedDeadline);
  if (
    changed.length === main.length &&
    changed.every((byte, i) => byte === main[i])
  ) {
    return {
      version: DOCX_SOURCE_CANDIDATE_VERSION,
      originalArchiveSha256: archiveSha256,
      bytes: owned,
      manifest: before,
    };
  }

  // The same reader has already validated every local record, payload and CRC.
  // Central order need not be physical order. Preserve every other raw record;
  // only the main payload and its ZIP method/CRC/sizes/offsets may change.
  const { entries, centralOffset } = parseCentralDirectory(owned);
  for (const entry of entries) {
    if (
      readUint16(owned, entry.localOffset + 28) !== 0 ||
      readUint16(owned, entry.centralEntryOffset + 30) !== 0
    ) {
      // Unknown extras can contain content- or offset-dependent metadata.
      // This compiler restriction does not change original upload admission.
      throw new WordXmlSourceError("unsupported_edit");
    }
  }
  const entry = entries.find((part) => part.name === "word/document.xml")!;
  const payloadOffset = entry.localOffset + 30 +
    readUint16(owned, entry.localOffset + 26);
  const delta = changed.length - entry.compressedSize;
  if (owned.length + delta > MAX_UPLOAD_BYTES) {
    throw new WordXmlSourceError("resource_limit");
  }
  const output = new Uint8Array(owned.length + delta);
  output.set(owned.subarray(0, payloadOffset));
  output.set(changed, payloadOffset);
  output.set(
    owned.subarray(payloadOffset + entry.compressedSize),
    payloadOffset + changed.length,
  );
  const view = new DataView(output.buffer);
  const changedCrc = crc32(changed);
  view.setUint16(entry.localOffset + 8, 0, true);
  view.setUint32(entry.localOffset + 14, changedCrc, true);
  view.setUint32(entry.localOffset + 18, changed.length, true);
  view.setUint32(entry.localOffset + 22, changed.length, true);
  for (const part of entries) {
    const central = part.centralEntryOffset + delta;
    if (part.localOffset > entry.localOffset) {
      view.setUint32(central + 42, part.localOffset + delta, true);
    }
    if (part === entry) {
      view.setUint16(central + 10, 0, true);
      view.setUint32(central + 16, changedCrc, true);
      view.setUint32(central + 20, changed.length, true);
      view.setUint32(central + 24, changed.length, true);
    }
  }
  view.setUint32(findZipEnd(owned) + delta + 16, centralOffset + delta, true);
  assertParserWork(signal, boundedDeadline);
  const after = await inspectDocxSource(
    output,
    "candidate.docx",
    "",
    signal,
    boundedDeadline,
  );
  const expectedText = new Map(
    patches.map((patch) => [patch.nodeId, patch.text]),
  );
  if (
    after.parts.length !== before.parts.length ||
    after.mainPart.source.nodes.length !==
      before.mainPart.source.nodes.length ||
    JSON.stringify(after.blockers) !== JSON.stringify(before.blockers)
  ) throw new WordXmlSourceError("invalid_patch");
  for (let i = 0; i < before.parts.length; i += 1) {
    const previous = before.parts[i]!;
    const current = after.parts[i]!;
    if (
      current.path !== previous.path ||
      (previous.path !== "word/document.xml" && (
        current.contentSha256 !== previous.contentSha256 ||
        current.crc32 !== previous.crc32 ||
        current.compressionMethod !== previous.compressionMethod ||
        current.compressedByteLength !== previous.compressedByteLength ||
        current.uncompressedByteLength !== previous.uncompressedByteLength
      ))
    ) throw new WordXmlSourceError("invalid_patch");
  }
  for (let i = 0; i < before.mainPart.source.nodes.length; i += 1) {
    const previous = before.mainPart.source.nodes[i]!;
    const current = after.mainPart.source.nodes[i]!;
    if (
      current.id !== previous.id || current.xmlSpace !== previous.xmlSpace ||
      current.lexicallyPatchable !== previous.lexicallyPatchable ||
      current.text !== (expectedText.get(previous.id) ?? previous.text)
    ) throw new WordXmlSourceError("invalid_patch");
  }
  assertParserWork(signal, boundedDeadline);
  return {
    version: DOCX_SOURCE_CANDIDATE_VERSION,
    originalArchiveSha256: archiveSha256,
    bytes: output,
    manifest: after,
  };
}

async function assembleDocxSource(
  owned: Uint8Array,
  archive: ArchiveInspection,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<DocxSourceManifest> {
  assertParserWork(signal, deadline);
  const mainBytes = archive.selectedContents.get("word/document.xml");
  if (!mainBytes || !archive.sourceParts) {
    throw extractionError(
      422,
      "UPLOAD_OFFICE_FORMAT_INVALID",
      "That Word document is missing its source parts.",
    );
  }
  // Exact admitted paths, code-unit order (not locale order). JSON arrays with
  // fixed field order and a domain/version prefix define the roster encoding;
  // PostgreSQL jsonb serialisation is not this hash encoding.
  const parts = Object.freeze(
    [...archive.sourceParts].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    ),
  );
  const rosterBytes = encodeOfficePartRoster(parts);
  const partRosterSha256 = await sourceSha256(rosterBytes, signal, deadline);
  const archiveSha256 = await sourceSha256(owned, signal, deadline);
  let source: WordXmlSource;
  try {
    source = await mapWordXmlSource(mainBytes, { signal, deadline });
  } catch (error) {
    if (!(error instanceof WordXmlSourceError)) throw error;
    if (
      error.code === "cancelled" ||
      (error.code === "resource_limit" && Date.now() >= deadline)
    ) {
      throw extractionError(
        503,
        "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
        "TED could not safely finish reading that file right now. Please try again.",
        true,
      );
    }
    if (error.code === "resource_limit") {
      throw extractionError(
        413,
        "UPLOAD_DOCX_SOURCE_LIMIT",
        "That Word source is too complex to map completely within the safe limit.",
      );
    }
    if (error.code === "invalid_xml" || error.code === "unsupported_encoding") {
      throw extractionError(
        422,
        "UPLOAD_DOCX_SOURCE_INVALID",
        "That Word document contains malformed or unsupported source text.",
      );
    }
    throw error;
  }
  assertParserWork(signal, deadline);
  const blockers = docxSourceBlockers(parts, source.blockers);
  const manifest: DocxSourceManifest = Object.freeze({
    version: DOCX_SOURCE_POLICY.version,
    assessment: "source_only",
    archiveSha256,
    archiveByteLength: owned.byteLength,
    rosterEncodingVersion: DOCX_SOURCE_POLICY.rosterEncodingVersion,
    partRosterSha256,
    parts,
    mainPart: Object.freeze({ path: "word/document.xml", source }),
    blockers,
  });
  if (
    new TextEncoder().encode(JSON.stringify(manifest)).byteLength >
      DOCX_SOURCE_POLICY.maxManifestBytes
  ) {
    throw extractionError(
      413,
      "UPLOAD_DOCX_SOURCE_LIMIT",
      "That Word source is too complex to map completely within the safe limit.",
    );
  }
  assertParserWork(signal, deadline);
  return manifest;
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

// Each public read owns a stable source before yielding. PDF parser cleanup may
// detach its working buffer; the caller's original must remain intact.
function copyUploadBytes(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
  deadline: number,
): Uint8Array {
  assertParserWork(signal, deadline);
  if (
    !(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer
  ) {
    throw extractionError(
      422,
      "UPLOAD_BUFFER_UNSUPPORTED",
      "TED cannot safely read that file. Please try the original file again.",
    );
  }
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
  return Uint8Array.from(bytes);
}

export async function resolveUploadFormat(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal?: AbortSignal,
  deadline = Date.now() + PARSER_DEADLINE_MS,
): Promise<UploadFormat> {
  const owned = copyUploadBytes(bytes, signal, deadline);
  const resolved = await resolveOwnedUpload(
    owned,
    filename,
    mime,
    signal,
    deadline,
  );
  assertParserWork(signal, deadline);
  return resolved.format;
}

async function resolveOwnedUpload(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal: AbortSignal | undefined,
  deadline: number,
  describeSourceParts = false,
): Promise<ResolvedUpload> {
  assertParserWork(signal, deadline);
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
    return { format: "pdf" };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const archive = await inspectOfficeArchive(
      bytes,
      signal,
      deadline,
      describeSourceParts,
    );
    assertParserWork(signal, deadline);
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
    const format = isDocx ? "docx" : "xlsx";
    validateOfficePackage(
      archive,
      isDocx ? "word/document.xml" : "xl/workbook.xml",
      isDocx
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    );
    assertFormatMetadata(format, filename, mime);
    return { format, archive };
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
    // UTF-16 text contains zero bytes as part of ordinary characters. Decode
    // only a BOM-declared byte order, then reject actual NUL characters. The
    // original owned bytes remain unchanged for retention and request identity.
    const encoding = startsWith(bytes, [0xff, 0xfe])
      ? "utf-16le"
      : startsWith(bytes, [0xfe, 0xff])
      ? "utf-16be"
      : "utf-8";
    let text: string;
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw extractionError(
        422,
        "UPLOAD_TEXT_ENCODING_INVALID",
        "Save this file as UTF-8 or Unicode (UTF-16) text and try again.",
      );
    }
    assertParserWork(signal, deadline);
    if (text.includes("\u0000")) {
      throw extractionError(
        422,
        "UPLOAD_TEXT_ENCODING_INVALID",
        "That text file contains unsupported binary data.",
      );
    }
    assertFormatMetadata("text", filename, mime);
    return { format: "text", text };
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
  let end = Math.min(cleaned.length, MAX_EXTRACTED_TEXT_CHARS);
  // A UTF-16 code-unit ceiling must not emit half of a supplementary character.
  // This also handles a source reader that reached its own bound mid-pair.
  const lastUnit = cleaned.charCodeAt(end - 1);
  if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) end -= 1;
  const truncated = alreadyTruncated || end < cleaned.length;
  return {
    text: cleaned.slice(0, end),
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

/** Always finish PDF resource cleanup, preserving the original failure if both fail. */
export async function withPdfCleanup<T>(
  read: () => Promise<T>,
  cleanup: () => void | Promise<void>,
): Promise<T> {
  let result: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    result = { ok: true, value: await read() };
  } catch (error) {
    result = { ok: false, error };
  }
  try {
    await cleanup();
  } catch {
    if (result.ok) {
      throw extractionError(
        503,
        "UPLOAD_PDF_RUNTIME_UNAVAILABLE",
        "TED cannot safely finish reading that PDF right now.",
        true,
      );
    }
  }
  if (!result.ok) throw result.error;
  return result.value;
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
  try {
    return await withPdfCleanup(async () => {
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
        await withPdfCleanup(async () => {
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
        }, () => {
          page.cleanup();
        });
        if (truncated) break;
        if (textChars < MAX_EXTRACTED_TEXT_CHARS + 1) {
          parts.push("\n");
          textChars += 1;
        }
      }
      return boundedResult(parts.join(""), "pdf", truncated);
    }, () => pdf.destroy());
  } catch (error) {
    throw normalizePdfFailure(error);
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

function extractDocx(
  archive: ArchiveInspection,
  signal: AbortSignal | undefined,
  deadline: number,
): UploadExtractionResult {
  assertParserWork(signal, deadline);
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

function extractXlsx(
  archive: ArchiveInspection,
  signal: AbortSignal | undefined,
  deadline: number,
): UploadExtractionResult {
  assertParserWork(signal, deadline);
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
  const owned = copyUploadBytes(bytes, signal, deadline);
  // Share one inspection only inside this read. No caller-owned buffer identity,
  // failed promise or old cancellation/deadline can be replayed across calls.
  const resolved = await resolveOwnedUpload(
    owned,
    filename,
    mime,
    signal,
    deadline,
  );
  return await extractResolvedUploadText(owned, resolved, signal, deadline);
}

async function extractResolvedUploadText(
  owned: Uint8Array,
  resolved: ResolvedUpload,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<UploadExtractionResult> {
  assertParserWork(signal, deadline);
  let result: UploadExtractionResult;
  if (resolved.format === "pdf") {
    result = await extractPdf(owned, signal, deadline);
  } else if (resolved.format === "docx") {
    result = extractDocx(resolved.archive, signal, deadline);
  } else if (resolved.format === "xlsx") {
    result = extractXlsx(resolved.archive, signal, deadline);
  } else {
    result = boundedResult(resolved.text, "text");
  }
  assertParserWork(signal, deadline);
  return result;
}

/**
 * A single owned read for the forthcoming private source checkpoint. This is
 * not the v1 wire response, and source_only never authorizes an edit or export.
 * A required DOCX manifest failure rejects the whole result, without fallback.
 */
export async function extractBoundedUploadWithSource(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal?: AbortSignal,
): Promise<SourceUploadExtractionResult> {
  const deadline = Date.now() + PARSER_DEADLINE_MS;
  const owned = copyUploadBytes(bytes, signal, deadline);
  return await extractOwnedUploadWithSource(
    owned,
    filename,
    mime,
    signal,
    deadline,
  );
}

async function extractOwnedUploadWithSource(
  owned: Uint8Array,
  filename: string,
  mime: string,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<SourceUploadExtractionResult> {
  const resolved = await resolveOwnedUpload(
    owned,
    filename,
    mime,
    signal,
    deadline,
    true,
  );
  const result = await extractResolvedUploadText(
    owned,
    resolved,
    signal,
    deadline,
  );
  if (resolved.format === "docx") {
    const sourceManifest = await assembleDocxSource(
      owned,
      resolved.archive,
      signal,
      deadline,
    );
    assertParserWork(signal, deadline);
    return Object.freeze({ ...result, format: "docx", sourceManifest });
  }
  assertParserWork(signal, deadline);
  return Object.freeze({
    ...result,
    format: resolved.format,
    sourceManifest: null,
  });
}

/** Prepared v3 producer; stored contract identity must select it before any read. */
export async function extractBoundedUploadWithSourceV3(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  signal?: AbortSignal,
): Promise<SourceUploadExtractionResultV3> {
  const deadline = Date.now() + PARSER_DEADLINE_MS;
  const owned = copyUploadBytes(bytes, signal, deadline);
  const extension = extensionOf(filename);
  const normalizedMime = mime.normalize("NFKC").trim().toLowerCase();
  const rtfMimes = new Set(["application/rtf", "text/rtf"]);
  const hasRtfSignature = startsWith(owned, [123, 92, 114, 116, 102]);
  if (
    extension !== "rtf" && !rtfMimes.has(normalizedMime) && !hasRtfSignature
  ) {
    const result = await extractOwnedUploadWithSource(
      owned,
      filename,
      mime,
      signal,
      deadline,
    );
    assertParserWork(signal, deadline);
    return Object.freeze({
      ...result,
      resourcePolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION_V2,
    });
  }
  assertUploadFormatMetadataV3("rtf", filename, mime);
  let rawText: string;
  try {
    const read = readRtfText(owned, { signal, deadline });
    // An unknown destination can contain semantics outside this subset. Keep
    // source inspection separate from accepting a prefix as classifier evidence.
    if (read.hasOpaqueDestinations) {
      throw new RtfSourceError("unsupported_content");
    }
    rawText = read.text;
  } catch (error) {
    if (error instanceof RtfSourceError) {
      const failures = {
        invalid_rtf: [
          "UPLOAD_RTF_INVALID",
          "That RTF file is malformed or incomplete. Save a new RTF copy and upload it again.",
        ],
        unsupported_encoding: [
          "UPLOAD_RTF_ENCODING_UNSUPPORTED",
          "TED cannot safely read this RTF file's character encoding. Save a supported copy and upload it again.",
        ],
        unsupported_content: [
          "UPLOAD_RTF_CONTENT_UNSUPPORTED",
          "This RTF contains content TED cannot safely interpret yet. Its text has not been used.",
        ],
      } as const;
      const [code, message] = failures[error.code];
      throw extractionError(422, code, message);
    }
    if (error instanceof BoundedRtfError) {
      if (error.code === "invalid") {
        throw extractionError(
          422,
          "UPLOAD_RTF_INVALID",
          "That RTF file is malformed or incomplete. Save a new RTF copy and upload it again.",
        );
      }
      if (error.code === "resource_limit") {
        throw extractionError(
          413,
          "UPLOAD_RTF_RESOURCE_LIMIT",
          "That RTF is too complex to read completely within the safe limit. Upload a smaller supported copy.",
        );
      }
      throw extractionError(
        503,
        "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
        "TED could not safely finish reading that file right now. Please try again.",
        true,
      );
    }
    throw error;
  }
  // Reuse the existing preview normalization and surrogate-safe text ceiling.
  // RTF rejects decoded NUL before reaching this compatibility helper.
  const preview = boundedResult(rawText, "text");
  const sourceManifest: RtfSourceManifest = Object.freeze({
    version: RTF_SOURCE_POLICY.version,
    assessment: "source_only",
    originalSha256: await sourceSha256(owned, signal, deadline),
    originalByteLength: owned.byteLength,
    extractedTextSha256: await sourceSha256(
      new TextEncoder().encode(preview.text),
      signal,
      deadline,
    ),
    blockers: Object.freeze([RTF_SOURCE_POLICY.editingBlocker] as const),
  });
  assertParserWork(signal, deadline);
  return Object.freeze({
    ...preview,
    format: "rtf",
    sourceManifest,
    resourcePolicyVersion: UPLOAD_RESOURCE_POLICY_VERSION_V2,
  });
}
