// Server-only source contract. No XML/PDF/ZIP, Storage or provider runtime.
import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  type UploadExtractionResult,
  type UploadExtractionResultV3,
  type UploadFormat,
} from "./upload-extraction-contract.ts";

/** Source syntax only, never Word visibility, pagination or approval. */
export const WORD_XML_SOURCE_POLICY = {
  version: "word-xml-source.1",
  maxPartBytes: MAX_UPLOAD_BYTES,
  maxTextNodes: 20_000,
  maxPatches: 2_000,
  maxReplacementChars: 64 * 1024,
  maxTotalReplacementChars: 1024 * 1024,
} as const;

export interface WordXmlSourceNode {
  readonly id: string;
  readonly text: string;
  /** UTF-16 ranges in the exact decoded UTF-8 part, including any initial BOM. */
  readonly start: number | null;
  readonly end: number | null;
  readonly xmlSpace: "default" | "preserve";
  readonly lexicallyPatchable: boolean;
}

export interface WordXmlSource {
  readonly version: typeof WORD_XML_SOURCE_POLICY.version;
  readonly originalSha256: string;
  readonly assessment: "source_only";
  readonly blockers: readonly string[];
  readonly nodes: readonly WordXmlSourceNode[];
}

/** Dormant exact content projection, never HTML or authority to edit a document. */
export const WORD_XML_UNIT_POLICY = Object.freeze(
  {
    version: "word-xml-units.1",
    contentEncoding: "literal-text.1",
    maxUnits: 512,
    maxParagraphs: 512,
    maxContentChars: 20_000,
    maxTotalContentChars: 1024 * 1024,
    maxWorkMs: 20_000,
  } as const,
);

export interface WordXmlSourceUnits {
  readonly version: typeof WORD_XML_UNIT_POLICY.version;
  readonly contentEncoding: typeof WORD_XML_UNIT_POLICY.contentEncoding;
  readonly assessment: "source_only";
  readonly source: WordXmlSource;
  readonly blockers: readonly string[];
  readonly paragraphs: readonly {
    readonly id: string;
    readonly unitIds: readonly string[];
  }[];
  readonly units: readonly {
    readonly nodeId: string;
    readonly paragraphId: string | null;
    /** Initial decoded value only; future current wording belongs in Section.content. */
    readonly content: string;
    readonly lexicallyPatchable: boolean;
  }[];
}

export const DOCX_SOURCE_POLICY = {
  version: "docx-source-manifest.1",
  rosterEncodingVersion: "office-part-roster-json.1",
  maxManifestBytes: 1024 * 1024,
} as const;

export interface OfficeSourcePart {
  readonly path: string;
  readonly compressionMethod: number;
  readonly compressedByteLength: number;
  readonly uncompressedByteLength: number;
  readonly crc32: number;
  /** Actual uncompressed content hash, not a compressed-payload hash. */
  readonly contentSha256: string;
}

export interface DocxSourceManifest {
  readonly version: typeof DOCX_SOURCE_POLICY.version;
  readonly assessment: "source_only";
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly rosterEncodingVersion:
    typeof DOCX_SOURCE_POLICY.rosterEncodingVersion;
  readonly partRosterSha256: string;
  readonly parts: readonly OfficeSourcePart[];
  readonly mainPart: {
    readonly path: "word/document.xml";
    readonly source: WordXmlSource;
  };
  readonly blockers: readonly string[];
}

/** Internal producer result; activation and durable contract version are separate. */
export type SourceUploadExtractionResult =
  | (UploadExtractionResult & {
    format: "docx";
    sourceManifest: DocxSourceManifest;
  })
  | (UploadExtractionResult & {
    format: Exclude<UploadFormat, "docx">;
    sourceManifest: null;
  });

export const RTF_SOURCE_POLICY = Object.freeze(
  {
    version: "rtf-source-manifest.1",
    editingBlocker: "rtf-format-preserving-editing-unverified",
    maxOriginalBytes: MAX_TEXT_UPLOAD_BYTES,
  } as const,
);

/** Source identity only; deliberately contains no editable ranges or layout claim. */
export interface RtfSourceManifest {
  readonly version: typeof RTF_SOURCE_POLICY.version;
  readonly assessment: "source_only";
  readonly originalSha256: string;
  readonly originalByteLength: number;
  readonly extractedTextSha256: string;
  readonly blockers: readonly [typeof RTF_SOURCE_POLICY.editingBlocker];
}

export type SourceUploadExtractionResultV3 =
  | (UploadExtractionResultV3 & {
    format: "rtf";
    sourceManifest: RtfSourceManifest;
  })
  | (UploadExtractionResultV3 & {
    format: "docx";
    sourceManifest: DocxSourceManifest;
  })
  | (UploadExtractionResultV3 & {
    format: Exclude<UploadFormat, "docx">;
    sourceManifest: null;
  });

export class DocumentSourceContractError extends Error {
  constructor(readonly code: "invalid" | "resource_limit" | "cancelled") {
    super(`DOCUMENT_SOURCE_CONTRACT_${code.toUpperCase()}`);
    this.name = "DocumentSourceContractError";
  }
}

function invalid(): never {
  throw new DocumentSourceContractError("invalid");
}

function limit(): never {
  throw new DocumentSourceContractError("resource_limit");
}

export interface DocumentSourceBinding {
  readonly contentSha256: string;
  readonly byteLength: number;
  readonly signal?: AbortSignal;
  readonly deadline?: number;
}

function active(signal: AbortSignal | undefined, deadline: number): void {
  if (signal?.aborted) throw new DocumentSourceContractError("cancelled");
  if (Date.now() >= deadline) limit();
}

function exact(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) invalid();
  return value as Record<string, unknown>;
}

function list(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value)) invalid();
  if (value.length > maximum) limit();
  return value;
}

function integer(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
    value > maximum
  ) invalid();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) invalid();
  return value;
}

/** Exact private contract, bound to accepted original bytes and final preview text. */
export async function normalizeRtfSourceManifest(
  value: unknown,
  binding: DocumentSourceBinding & { readonly extractedText: string },
): Promise<RtfSourceManifest> {
  const expected = { ...binding };
  const deadline = expected.deadline ?? Date.now() + 20_000;
  if (!Number.isFinite(deadline)) invalid();
  active(expected.signal, deadline);
  const originalSha256 = hash(expected.contentSha256);
  const originalByteLength = integer(
    expected.byteLength,
    RTF_SOURCE_POLICY.maxOriginalBytes,
  );
  if (
    !originalByteLength || typeof expected.extractedText !== "string" ||
    expected.extractedText.length > MAX_EXTRACTED_TEXT_CHARS
  ) invalid();
  for (const character of expected.extractedText) {
    const scalar = character.codePointAt(0)!;
    if (
      scalar >= 0xd800 && scalar <= 0xdfff || scalar === 0 ||
      scalar < 32 && scalar !== 9 && scalar !== 10 ||
      scalar >= 0x7f && scalar <= 0x9f || scalar === 0xfffe || scalar === 0xffff
    ) invalid();
  }
  const manifest = exact(value, [
    "version",
    "assessment",
    "originalSha256",
    "originalByteLength",
    "extractedTextSha256",
    "blockers",
  ]);
  if (
    manifest.version !== RTF_SOURCE_POLICY.version ||
    manifest.assessment !== "source_only" ||
    manifest.originalSha256 !== originalSha256 ||
    manifest.originalByteLength !== originalByteLength
  ) invalid();
  const extractedTextSha256 = hash(manifest.extractedTextSha256);
  const blockers = list(manifest.blockers, 1);
  if (
    blockers.length !== 1 || blockers[0] !== RTF_SOURCE_POLICY.editingBlocker
  ) invalid();
  // Own every accepted field before yielding; later mutation of the received
  // object or binding cannot alter the validated result.
  const result: RtfSourceManifest = Object.freeze({
    version: RTF_SOURCE_POLICY.version,
    assessment: "source_only",
    originalSha256,
    originalByteLength,
    extractedTextSha256,
    blockers: Object.freeze([RTF_SOURCE_POLICY.editingBlocker] as const),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(expected.extractedText),
  );
  active(expected.signal, deadline);
  const actualHash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actualHash !== extractedTextSha256) invalid();
  return result;
}

const WORD_BLOCKERS = new Set([
  "unreviewed_attribute_semantics",
  "foreign_element_semantics",
  "dynamic_or_revision_content",
  "unreviewed_structure",
  "unmapped_character_content",
  "processing_instruction",
]);

function wordBlockers(value: unknown): readonly string[] {
  const blockers: string[] = [];
  for (const item of list(value, WORD_BLOCKERS.size)) {
    if (
      typeof item !== "string" || !WORD_BLOCKERS.has(item) ||
      (blockers.length > 0 && blockers.at(-1)! >= item)
    ) invalid();
    blockers.push(item);
  }
  return Object.freeze(blockers);
}

export function docxSourceBlockers(
  parts: readonly OfficeSourcePart[],
  sourceBlockers: readonly string[],
): readonly string[] {
  const blockers = new Set([
    "package_semantics_unassessed",
    "styles_and_visibility_unassessed",
    "layout_unassessed",
    ...sourceBlockers,
  ]);
  if (
    parts.some((part) =>
      /^word\/(?:header\d+|footer\d+|footnotes|endnotes)[.]xml$/.test(part.path)
    )
  ) {
    blockers.add("non_main_wording_unmapped");
  }
  // A positive observation only; absence does not attest to an unsigned file.
  if (parts.some((part) => /^_xmlsignatures\//i.test(part.path))) {
    blockers.add("digital_signature_parts_present");
  }
  return Object.freeze([...blockers].sort());
}

/** Fixed field order, exact paths in admitted order; not PostgreSQL jsonb text. */
export function encodeOfficePartRoster(
  parts: readonly OfficeSourcePart[],
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([
    DOCX_SOURCE_POLICY.rosterEncodingVersion,
    parts.map(
      (part) => [
        part.path,
        part.compressionMethod,
        part.compressedByteLength,
        part.uncompressedByteLength,
        part.crc32,
        part.contentSha256,
      ],
    ),
  ]));
}

function assertXmlText(text: string): void {
  for (const character of text) {
    const scalar = character.codePointAt(0)!;
    if (
      (scalar < 0x20 && scalar !== 0x09 && scalar !== 0x0a &&
        scalar !== 0x0d) ||
      (scalar >= 0xd800 && scalar <= 0xdfff) ||
      scalar === 0xfffe || scalar === 0xffff
    ) invalid();
  }
}

/**
 * Validate and own a manifest before asynchronous work. This proves contract
 * consistency and source attribution, not the truth of XML/layout semantics.
 * Existing source versions and node order are preserved literally.
 */
export async function normalizeDocxSourceManifest(
  value: unknown,
  binding: DocumentSourceBinding,
): Promise<DocxSourceManifest> {
  const expected = { ...binding };
  const deadline = expected.deadline ?? Date.now() + 20_000;
  if (!Number.isFinite(deadline)) invalid();
  active(expected.signal, deadline);
  const expectedHash = hash(expected.contentSha256);
  const expectedLength = integer(expected.byteLength, MAX_UPLOAD_BYTES);
  if (expectedLength === 0) invalid();
  const manifest = exact(value, [
    "version",
    "assessment",
    "archiveSha256",
    "archiveByteLength",
    "rosterEncodingVersion",
    "partRosterSha256",
    "parts",
    "mainPart",
    "blockers",
  ]);
  if (
    manifest.version !== DOCX_SOURCE_POLICY.version ||
    manifest.assessment !== "source_only" ||
    manifest.rosterEncodingVersion !==
      DOCX_SOURCE_POLICY.rosterEncodingVersion ||
    manifest.archiveSha256 !== expectedHash ||
    manifest.archiveByteLength !== expectedLength
  ) invalid();
  const partRosterSha256 = hash(manifest.partRosterSha256);
  const paths = new Set<string>();
  const parts: OfficeSourcePart[] = [];
  let inflatedBytes = 0;
  let compressedBytes = 0;
  for (const value of list(manifest.parts, 512)) {
    active(expected.signal, deadline);
    const part = exact(value, [
      "path",
      "compressionMethod",
      "compressedByteLength",
      "uncompressedByteLength",
      "crc32",
      "contentSha256",
    ]);
    if (
      typeof part.path !== "string" || part.path.length > 512 ||
      part.path.includes("\u0000") || /[\ud800-\udfff]/u.test(part.path) ||
      new TextEncoder().encode(part.path).byteLength > 512
    ) invalid();
    const path = part.path;
    const segments = (path.endsWith("/") ? path.slice(0, -1) : path).split("/");
    if (
      !path || path.startsWith("/") || path.includes("\\") ||
      segments.some((segment) =>
        !segment || segment === "." || segment === ".."
      ) ||
      (parts.length > 0 && parts.at(-1)!.path >= path)
    ) invalid();
    const canonical = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (paths.has(canonical)) invalid();
    paths.add(canonical);
    const compressionMethod = integer(part.compressionMethod, 8);
    if (compressionMethod !== 0 && compressionMethod !== 8) invalid();
    const compressedByteLength = integer(
      part.compressedByteLength,
      expectedLength,
    );
    const uncompressedByteLength = integer(
      part.uncompressedByteLength,
      MAX_UPLOAD_BYTES,
    );
    if (
      compressionMethod === 0 && compressedByteLength !== uncompressedByteLength
    ) invalid();
    if (compressedByteLength === 0 && uncompressedByteLength > 0) invalid();
    if (
      uncompressedByteLength > 1024 * 1024 &&
      (compressedByteLength === 0 ||
        uncompressedByteLength / compressedByteLength > 100)
    ) invalid();
    compressedBytes += compressedByteLength;
    inflatedBytes += uncompressedByteLength;
    if (compressedBytes > expectedLength || inflatedBytes > 16 * 1024 * 1024) {
      invalid();
    }
    const crc32 = integer(part.crc32, 0xffffffff);
    const contentSha256 = hash(part.contentSha256);
    if (
      uncompressedByteLength === 0 && (crc32 !== 0 || contentSha256 !==
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    ) invalid();
    parts.push(
      Object.freeze({
        path,
        compressionMethod,
        compressedByteLength,
        uncompressedByteLength,
        crc32,
        contentSha256,
      }),
    );
  }
  const mainEntry = parts.find((part) => part.path === "word/document.xml");
  if (
    !mainEntry || mainEntry.uncompressedByteLength === 0 ||
    !parts.some((part) => part.path === "[Content_Types].xml") ||
    !parts.some((part) => part.path === "_rels/.rels")
  ) invalid();
  const main = exact(manifest.mainPart, ["path", "source"]);
  if (main.path !== "word/document.xml") invalid();
  const source = exact(main.source, [
    "version",
    "originalSha256",
    "assessment",
    "blockers",
    "nodes",
  ]);
  if (
    source.version !== WORD_XML_SOURCE_POLICY.version ||
    source.assessment !== "source_only" ||
    source.originalSha256 !== mainEntry.contentSha256
  ) invalid();
  const sourceBlockers = wordBlockers(source.blockers);
  const rawNodes = list(source.nodes, WORD_XML_SOURCE_POLICY.maxTextNodes);
  const ids = new Set<number>();
  const nodes: WordXmlSourceNode[] = [];
  let textChars = 0;
  let previousEnd = 0;
  for (const value of rawNodes) {
    active(expected.signal, deadline);
    const node = exact(value, [
      "id",
      "text",
      "start",
      "end",
      "xmlSpace",
      "lexicallyPatchable",
    ]);
    if (
      typeof node.id !== "string" || !/^t:[1-9]\d{0,4}$/.test(node.id) ||
      typeof node.text !== "string" ||
      typeof node.lexicallyPatchable !== "boolean" ||
      (node.xmlSpace !== "default" && node.xmlSpace !== "preserve")
    ) invalid();
    const ordinal = Number(node.id.slice(2));
    if (ids.has(ordinal) || ordinal > rawNodes.length) invalid();
    ids.add(ordinal);
    textChars += node.text.length;
    if (textChars > DOCX_SOURCE_POLICY.maxManifestBytes) limit();
    assertXmlText(node.text);
    const start = node.start === null
      ? null
      : integer(node.start, mainEntry.uncompressedByteLength);
    const end = node.end === null
      ? null
      : integer(node.end, mainEntry.uncompressedByteLength);
    if (
      (start === null) !== (end === null) ||
      (node.lexicallyPatchable && start === null)
    ) invalid();
    if (start !== null && end !== null) {
      if (
        end <= start || start < previousEnd || node.text.length === 0 ||
        node.text.length > end - start
      ) invalid();
      previousEnd = end;
    }
    nodes.push(
      Object.freeze({
        id: node.id,
        text: node.text,
        start,
        end,
        xmlSpace: node.xmlSpace,
        lexicallyPatchable: node.lexicallyPatchable,
      }),
    );
  }
  const blockers = docxSourceBlockers(parts, sourceBlockers);
  const receivedBlockers = list(manifest.blockers, WORD_BLOCKERS.size + 5);
  if (
    receivedBlockers.length !== blockers.length ||
    receivedBlockers.some((item, index) => item !== blockers[index])
  ) invalid();
  const result: DocxSourceManifest = Object.freeze({
    version: DOCX_SOURCE_POLICY.version,
    assessment: "source_only",
    archiveSha256: expectedHash,
    archiveByteLength: expectedLength,
    rosterEncodingVersion: DOCX_SOURCE_POLICY.rosterEncodingVersion,
    partRosterSha256,
    parts: Object.freeze(parts),
    mainPart: Object.freeze({
      path: "word/document.xml",
      source: Object.freeze({
        version: WORD_XML_SOURCE_POLICY.version,
        originalSha256: mainEntry.contentSha256,
        assessment: "source_only",
        blockers: sourceBlockers,
        nodes: Object.freeze(nodes),
      }),
    }),
    blockers,
  });
  if (
    new TextEncoder().encode(JSON.stringify(result)).byteLength >
      DOCX_SOURCE_POLICY.maxManifestBytes
  ) limit();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encodeOfficePartRoster(parts),
  );
  active(expected.signal, deadline);
  const rosterHash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  if (rosterHash !== partRosterSha256) invalid();
  return result;
}
