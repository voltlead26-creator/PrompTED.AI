import {
  BOUNDED_XML_POLICY,
  BoundedXmlError,
  type BoundedXmlSourceRange,
  scanBoundedXml,
} from "./bounded-xml.ts";

import {
  docxSourceBlockers,
  WORD_XML_SOURCE_POLICY,
  WORD_XML_UNIT_POLICY,
  type WordXmlSource,
  type WordXmlSourceNode,
  type WordXmlSourceUnits,
} from "./document-source-contract.ts";
export {
  WORD_XML_SOURCE_POLICY,
  WORD_XML_UNIT_POLICY,
  type WordXmlSource,
  type WordXmlSourceNode,
  type WordXmlSourceUnits,
} from "./document-source-contract.ts";

export class WordXmlSourceError extends Error {
  constructor(
    readonly code:
      | "invalid_xml"
      | "unsupported_encoding"
      | "resource_limit"
      | "identity_mismatch"
      | "unsupported_edit"
      | "invalid_patch"
      | "cancelled",
  ) {
    super(`WORD_XML_SOURCE_${code.toUpperCase()}`);
    this.name = "WordXmlSourceError";
  }
}

export interface WordXmlSourceOptions {
  readonly signal?: AbortSignal;
  readonly deadline?: number;
}

const WORD_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
const XML = "http://www.w3.org/XML/1998/namespace";
const XMLNS = "http://www.w3.org/2000/xmlns/";
const NCNAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const BASIC_CONTENT = new Set([
  "document",
  "body",
  "p",
  "r",
  "t",
  "pPr",
  "rPr",
  "sectPr",
  "tab",
  "br",
  "cr",
  "noBreakHyphen",
  "softHyphen",
  "lastRenderedPageBreak",
]);
const DYNAMIC_CONTENT = new Set([
  "fldChar",
  "instrText",
  "fldSimple",
  "delInstrText",
  "ins",
  "del",
  "moveFrom",
  "moveTo",
  "sdt",
  "customXml",
  "subDoc",
  "altChunk",
]);
function fail(code: WordXmlSourceError["code"]): never {
  throw new WordXmlSourceError(code);
}
function checkActive(options: WordXmlSourceOptions): void {
  if (options.signal?.aborted) fail("cancelled");
  if (options.deadline !== undefined && Date.now() >= options.deadline) {
    fail("resource_limit");
  }
}
function qname(name: string): [string, string] {
  const parts = name.split(":");
  if (parts.length > 2 || !parts.every((part) => NCNAME.test(part))) {
    fail("invalid_xml");
  }
  return parts.length === 1 ? ["", parts[0]!] : [parts[0]!, parts[1]!];
}
interface Frame {
  namespace: string;
  local: string;
  property: boolean;
  xmlSpace: "default" | "preserve";
  declarations: Array<[string, string | undefined]>;
  paragraphId?: string;
  node?: {
    id: string;
    contentStart: number;
    text: string[];
    ranges: BoundedXmlSourceRange[];
    contextAllowed: boolean;
  };
}

interface UnitStructure {
  paragraphs: Array<{ id: string; unitIds: string[] }>;
  membership: Map<string, string | null>;
  wordingControls: boolean;
}

function inspectXml(
  xml: string,
  options: WordXmlSourceOptions,
  structure?: UnitStructure,
) {
  const namespaces = new Map<string, string>([["xml", XML]]);
  const stack: Frame[] = [];
  const nodes: WordXmlSourceNode[] = [];
  const blockers = new Set<string>();
  let wordNamespace = "";
  let bodyCount = 0;
  let textCount = 0;
  const resolve = (name: string, attribute = false): [string, string] => {
    const [prefix, local] = qname(name);
    if (prefix === "xmlns") fail("invalid_xml");
    if (!prefix) return [attribute ? "" : namespaces.get("") ?? "", local];
    const namespace = namespaces.get(prefix);
    if (!namespace) fail("invalid_xml");
    return [namespace, local];
  };
  try {
    scanBoundedXml(xml, (event, range) => {
      checkActive(options);
      if (event.kind === "start") {
        const declarations: Frame["declarations"] = [];
        // Bind declarations before resolving this element and its attributes.
        for (const [name, value] of event.attributes) {
          qname(name);
          if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
          const prefix = name === "xmlns" ? "" : name.slice(6);
          if (
            prefix === "xmlns" || value === XMLNS ||
            (prefix === "xml" ? value !== XML : value === XML) ||
            (prefix !== "" && value === "")
          ) fail("invalid_xml");
          declarations.push([prefix, namespaces.get(prefix)]);
          namespaces.set(prefix, value);
        }
        const [namespace, local] = resolve(event.name);
        const parent = stack.at(-1);
        let xmlSpace = parent?.xmlSpace ?? "default";
        const expandedAttributes = new Set<string>();
        for (const [name, value] of event.attributes) {
          if (name === "xmlns" || name.startsWith("xmlns:")) continue;
          const [attributeNamespace, attributeLocal] = resolve(name, true);
          const key = JSON.stringify([attributeNamespace, attributeLocal]);
          if (expandedAttributes.has(key)) fail("invalid_xml");
          expandedAttributes.add(key);
          if (attributeNamespace === XML && attributeLocal === "space") {
            if (value !== "default" && value !== "preserve") {
              fail("invalid_xml");
            }
            xmlSpace = value;
          } else if (
            attributeNamespace !== XML && attributeNamespace !== namespace
          ) {
            blockers.add("unreviewed_attribute_semantics");
          }
        }
        if (!parent) {
          if (local !== "document" || !WORD_NAMESPACES.has(namespace)) {
            fail("invalid_xml");
          }
          wordNamespace = namespace;
        }
        const isWord = namespace === wordNamespace;
        const property = Boolean(parent?.property) ||
          (isWord && ["pPr", "rPr", "sectPr"].includes(local));
        if (!isWord) blockers.add("foreign_element_semantics");
        if (
          isWord && (DYNAMIC_CONTENT.has(local) || local.endsWith("PrChange"))
        ) blockers.add("dynamic_or_revision_content");
        if (isWord && !property && !BASIC_CONTENT.has(local)) {
          blockers.add("unreviewed_structure");
        }
        if (isWord && local === "body") {
          bodyCount += 1;
          if (stack.length !== 1 || parent?.local !== "document") {
            fail("invalid_xml");
          }
        }
        const frame: Frame = {
          namespace,
          local,
          property,
          xmlSpace,
          declarations,
        };
        if (structure && isWord) {
          if (
            !property &&
            ["tab", "br", "cr", "noBreakHyphen", "softHyphen"].includes(local)
          ) {
            structure.wordingControls = true;
          }
          if (
            local === "p" && stack.length === 2 &&
            stack.every((ancestor, index) =>
              ancestor.namespace === wordNamespace &&
              ancestor.local === ["document", "body"][index]
            )
          ) {
            if (
              structure.paragraphs.length >= WORD_XML_UNIT_POLICY.maxParagraphs
            ) fail("resource_limit");
            frame.paragraphId = `p:${structure.paragraphs.length + 1}`;
            structure.paragraphs.push({ id: frame.paragraphId, unitIds: [] });
          }
        }
        if (isWord && local === "t") {
          textCount += 1;
          if (textCount > WORD_XML_SOURCE_POLICY.maxTextNodes) {
            fail("resource_limit");
          }
          frame.node = {
            id: `t:${textCount}`,
            contentStart: range.end,
            text: [],
            ranges: [],
            contextAllowed: stack.length === 4 &&
              stack.every((ancestor, index) =>
                ancestor.namespace === wordNamespace &&
                ancestor.local === ["document", "body", "p", "r"][index]
              ),
          };
          if (structure) {
            if (textCount > WORD_XML_UNIT_POLICY.maxUnits) {
              fail("resource_limit");
            }
            const paragraphId = frame.node.contextAllowed
              ? stack[2]?.paragraphId ?? null
              : null;
            structure.membership.set(frame.node.id, paragraphId);
            if (paragraphId) {
              structure.paragraphs.at(-1)!.unitIds.push(frame.node.id);
            }
          }
        }
        stack.push(frame);
      } else if (event.kind === "text") {
        const current = stack.at(-1);
        if (current?.node) {
          current.node.text.push(event.text);
          current.node.ranges.push(range);
        } else if (/[^ \t\r\n]/.test(event.text)) {
          blockers.add("unmapped_character_content");
        }
      } else {
        const current = stack.pop()!;
        if (current.node) {
          const node = current.node;
          const span = node.ranges.length === 1 ? node.ranges[0] : undefined;
          // A single callback is insufficient: skipped comments/empty CDATA can
          // still occupy part of the payload. Require the complete inner range.
          const simple = span?.syntax === "text" &&
            span.start === node.contentStart && span.end === range.start;
          nodes.push(Object.freeze({
            id: node.id,
            text: node.text.join(""),
            start: simple ? span.start : null,
            end: simple ? span.end : null,
            xmlSpace: current.xmlSpace,
            lexicallyPatchable: Boolean(simple && node.contextAllowed),
          }));
        }
        for (const [prefix, previous] of current.declarations.reverse()) {
          if (previous === undefined) namespaces.delete(prefix);
          else namespaces.set(prefix, previous);
        }
      }
    }, {
      onProcessingInstruction: (target) => {
        checkActive(options);
        if (target !== "xml") blockers.add("processing_instruction");
      },
    });
  } catch (error) {
    if (error instanceof BoundedXmlError) {
      fail(error.code === "resource_limit" ? "resource_limit" : "invalid_xml");
    }
    throw error;
  }
  if (bodyCount !== 1) fail("invalid_xml");
  return {
    nodes: Object.freeze(nodes),
    blockers: Object.freeze([...blockers].sort()),
  };
}

function copyPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    !(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer
  ) {
    fail("invalid_xml");
  }
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > WORD_XML_SOURCE_POLICY.maxPartBytes
  ) {
    fail("resource_limit");
  }
  return new Uint8Array(bytes);
}
function decodePart(bytes: Uint8Array): string {
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return fail("unsupported_encoding");
  }
  const declaration = xml.match(/^\ufeff?<\?xml[ \t\r\n][\s\S]*?\?>/)?.[0];
  const encoding = declaration?.match(/\bencoding\s*=\s*(['"])([^'"]+)\1/)?.[2];
  if (encoding && encoding.toLowerCase() !== "utf-8") {
    fail("unsupported_encoding");
  }
  return xml;
}
async function describePart(
  bytes: Uint8Array<ArrayBuffer>,
  options: WordXmlSourceOptions,
  structure?: UnitStructure,
) {
  checkActive(options);
  const xml = decodePart(bytes);
  const inspected = inspectXml(xml, options, structure);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  checkActive(options);
  const originalSha256 = Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const source: WordXmlSource = Object.freeze({
    version: WORD_XML_SOURCE_POLICY.version,
    originalSha256,
    assessment: "source_only",
    ...inspected,
  });
  return { xml, source };
}

/** Own the bytes before the first await; no mutable archive cache or caller manifest. */
export async function mapWordXmlSource(
  bytes: Uint8Array,
  options: WordXmlSourceOptions = {},
): Promise<WordXmlSource> {
  const observation = { ...options };
  const { source } = await describePart(copyPart(bytes), observation);
  checkActive(observation);
  return source;
}

function unitObservation(options: WordXmlSourceOptions): WordXmlSourceOptions {
  const observation = { ...options };
  if (
    observation.deadline !== undefined && !Number.isFinite(observation.deadline)
  ) fail("invalid_patch");
  observation.deadline = Math.min(
    observation.deadline ?? Infinity,
    Date.now() + WORD_XML_UNIT_POLICY.maxWorkMs,
  );
  checkActive(observation);
  return observation;
}

/**
 * Dormant projection of the exact original. One text node is one literal value;
 * paragraph grouping is metadata, never permission to merge formatted runs.
 * The original v1 source manifest keeps its exact serialized shape/meaning.
 */
export async function mapWordXmlSourceUnits(
  bytes: Uint8Array,
  options: WordXmlSourceOptions = {},
): Promise<WordXmlSourceUnits> {
  const observation = unitObservation(options);
  const owned = copyPart(bytes);
  const structure: UnitStructure = {
    paragraphs: [],
    membership: new Map(),
    wordingControls: false,
  };
  const { source } = await describePart(owned, observation, structure);
  let total = 0;
  const units = source.nodes.map((node) => {
    total += node.text.length;
    if (
      node.text.length > WORD_XML_UNIT_POLICY.maxContentChars ||
      total > WORD_XML_UNIT_POLICY.maxTotalContentChars
    ) fail("resource_limit");
    return Object.freeze({
      nodeId: node.id,
      paragraphId: structure.membership.get(node.id) ?? null,
      content: node.text,
      lexicallyPatchable: node.lexicallyPatchable,
    });
  });
  const blockers = docxSourceBlockers([], [
    ...source.blockers,
    ...(structure.wordingControls ? ["wording_controls_unmapped"] : []),
    ...(units.some((unit) => unit.paragraphId === null)
      ? ["source_unit_context_unmapped"]
      : []),
  ]);
  checkActive(observation);
  return Object.freeze({
    version: WORD_XML_UNIT_POLICY.version,
    contentEncoding: WORD_XML_UNIT_POLICY.contentEncoding,
    assessment: "source_only",
    source,
    blockers,
    paragraphs: Object.freeze(
      structure.paragraphs.map((paragraph) =>
        Object.freeze({
          id: paragraph.id,
          unitIds: Object.freeze(paragraph.unitIds),
        })
      ),
    ),
    units: Object.freeze(units),
  });
}

/**
 * Derive patches from the COMPLETE current literal-value roster, freshly bound
 * to original bytes. A later persistence consumer must obtain those values from
 * exact owned section revisions, not treat this helper as authorisation.
 */
export async function deriveWordXmlUnitPatches(
  bytes: Uint8Array,
  request: unknown,
  options: WordXmlSourceOptions = {},
): Promise<
  {
    readonly version: typeof WORD_XML_SOURCE_POLICY.version;
    readonly originalSha256: string;
    readonly patches: readonly WordXmlSourcePatch[];
  }
> {
  const observation = unitObservation(options);
  const owned = copyPart(bytes);
  if (
    !exactObject(request, ["version", "originalSha256", "units"]) ||
    request.version !== WORD_XML_UNIT_POLICY.version ||
    typeof request.originalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.originalSha256) ||
    !Array.isArray(request.units)
  ) fail("invalid_patch");
  if (request.units.length > WORD_XML_UNIT_POLICY.maxUnits) {
    fail("resource_limit");
  }
  const originalSha256 = request.originalSha256;
  const seen = new Set<string>();
  let total = 0;
  const units = request.units.map((unit) => {
    if (
      !exactObject(unit, ["nodeId", "content"]) ||
      typeof unit.nodeId !== "string" ||
      !/^t:[1-9]\d{0,4}$/.test(unit.nodeId) ||
      typeof unit.content !== "string" || seen.has(unit.nodeId)
    ) fail("invalid_patch");
    seen.add(unit.nodeId);
    total += unit.content.length;
    if (
      unit.content.length > WORD_XML_UNIT_POLICY.maxContentChars ||
      total > WORD_XML_UNIT_POLICY.maxTotalContentChars
    ) fail("resource_limit");
    return { nodeId: unit.nodeId, content: unit.content };
  });
  const original = await mapWordXmlSourceUnits(owned, observation);
  checkActive(observation);
  if (
    original.source.originalSha256 !== originalSha256 ||
    original.units.length !== units.length
  ) fail("identity_mismatch");
  const patches: WordXmlSourcePatch[] = [];
  original.units.forEach((unit, index) => {
    const current = units[index]!;
    if (unit.nodeId !== current.nodeId) fail("identity_mismatch");
    if (unit.content === current.content) return;
    if (!unit.lexicallyPatchable || unit.paragraphId === null) {
      fail("unsupported_edit");
    }
    patches.push(
      Object.freeze({
        nodeId: unit.nodeId,
        expectedText: unit.content,
        text: current.content,
      }),
    );
  });
  const unassessed = new Set([
    "package_semantics_unassessed",
    "styles_and_visibility_unassessed",
    "layout_unassessed",
  ]);
  if (
    patches.length &&
    original.blockers.some((blocker) => !unassessed.has(blocker))
  ) fail("unsupported_edit");
  const plan = Object.freeze({
    version: WORD_XML_SOURCE_POLICY.version,
    originalSha256,
    patches: Object.freeze(patches),
  });
  // Validate representability through the existing patcher; never trim, parse
  // HTML/TED tokens, normalise Unicode, or split new prose across old runs.
  await applyWordXmlSourcePatches(owned, plan, observation);
  checkActive(observation);
  return plan;
}

export interface WordXmlSourcePatch {
  nodeId: string;
  expectedText: string;
  text: string;
}
function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function copyRequest(request: unknown) {
  if (
    !exactObject(request, ["version", "originalSha256", "patches"]) ||
    request.version !== WORD_XML_SOURCE_POLICY.version ||
    typeof request.originalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(request.originalSha256)
  ) fail("invalid_patch");
  return {
    originalSha256: request.originalSha256,
    patches: captureWordXmlSourcePatches(request.patches),
  };
}

/** Capture bounded primitive values before asynchronous source inspection. */
export function captureWordXmlSourcePatches(
  value: unknown,
): WordXmlSourcePatch[] {
  if (!Array.isArray(value)) fail("invalid_patch");
  if (value.length > WORD_XML_SOURCE_POLICY.maxPatches) {
    fail("resource_limit");
  }
  const seen = new Set<string>();
  let total = 0;
  const patches: WordXmlSourcePatch[] = [];
  for (const patch of value) {
    if (
      !exactObject(patch, ["nodeId", "expectedText", "text"]) ||
      typeof patch.nodeId !== "string" ||
      !/^t:[1-9]\d{0,4}$/.test(patch.nodeId) ||
      typeof patch.expectedText !== "string" ||
      typeof patch.text !== "string" ||
      seen.has(patch.nodeId)
    ) fail("invalid_patch");
    seen.add(patch.nodeId);
    total += patch.expectedText.length + patch.text.length;
    if (
      patch.expectedText.length > WORD_XML_SOURCE_POLICY.maxReplacementChars ||
      patch.text.length > WORD_XML_SOURCE_POLICY.maxReplacementChars ||
      total > WORD_XML_SOURCE_POLICY.maxTotalReplacementChars
    ) fail("resource_limit");
    patches.push({
      nodeId: patch.nodeId,
      expectedText: patch.expectedText,
      text: patch.text,
    });
  }
  return patches;
}
function escapedReplacement(text: string): string {
  if (!text || /[\t\r\n]/.test(text)) fail("unsupported_edit");
  for (const character of text) {
    const value = character.codePointAt(0)!;
    if (
      value < 0x20 || (value >= 0xd800 && value <= 0xdfff) ||
      value === 0xfffe || value === 0xffff
    ) {
      fail("invalid_patch");
    }
  }
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

/**
 * Compile only selected ordinary XML payloads from the immutable original.
 * This primitive does not authorise edits or establish layout/visible wording.
 * A future package/operation consumer must bind owner, document and revision,
 * assess all parts/styles/fields, and validate the rendered approved result.
 */
export async function applyWordXmlSourcePatches(
  bytes: Uint8Array,
  request: unknown,
  options: WordXmlSourceOptions = {},
): Promise<Uint8Array> {
  const original = copyPart(bytes);
  const accepted = copyRequest(request);
  const observation = { ...options };
  const { xml, source } = await describePart(original, observation);
  checkActive(observation);
  if (accepted.originalSha256 !== source.originalSha256) {
    fail("identity_mismatch");
  }
  const nodes = new Map(source.nodes.map((node) => [node.id, node]));
  const changes: Array<
    { node: WordXmlSourceNode; escaped: string; text: string }
  > = [];
  for (const patch of accepted.patches) {
    const node = nodes.get(patch.nodeId);
    if (!node || node.text !== patch.expectedText) fail("identity_mismatch");
    if (patch.text === node.text) continue; // Preserve original entity spelling.
    if (!node.lexicallyPatchable || source.blockers.length > 0) {
      fail("unsupported_edit");
    }
    if (/[\t\r\n]/.test(node.text)) fail("unsupported_edit");
    if (node.xmlSpace !== "preserve" && /^[ ]|[ ]$/.test(patch.text)) {
      fail("unsupported_edit");
    }
    changes.push({
      node,
      escaped: escapedReplacement(patch.text),
      text: patch.text,
    });
  }
  if (changes.length === 0) {
    checkActive(observation);
    return original;
  }
  changes.sort((left, right) => left.node.start! - right.node.start!);
  const finalChars = changes.reduce(
    (length, { node, escaped }) =>
      length + escaped.length - (node.end! - node.start!),
    xml.length,
  );
  if (finalChars > BOUNDED_XML_POLICY.maxInputChars) fail("resource_limit");
  const pieces: string[] = [];
  let cursor = 0;
  for (const { node, escaped } of changes) {
    if (node.start! < cursor || node.end! < node.start!) fail("invalid_patch");
    pieces.push(xml.slice(cursor, node.start!), escaped);
    cursor = node.end!;
  }
  pieces.push(xml.slice(cursor));
  const changedXml = pieces.join("");
  const output = new TextEncoder().encode(changedXml);
  if (output.length > WORD_XML_SOURCE_POLICY.maxPartBytes) {
    fail("resource_limit");
  }
  const verified = inspectXml(changedXml, observation);
  const expectedChanges = new Map(
    changes.map(({ node, text }) => [node.id, text]),
  );
  if (
    verified.nodes.length !== source.nodes.length ||
    verified.blockers.length !== 0
  ) {
    fail("invalid_patch");
  }
  for (let index = 0; index < source.nodes.length; index += 1) {
    const before = source.nodes[index]!;
    const after = verified.nodes[index]!;
    if (
      after.id !== before.id || after.xmlSpace !== before.xmlSpace ||
      after.lexicallyPatchable !== before.lexicallyPatchable ||
      after.text !== (expectedChanges.get(before.id) ?? before.text)
    ) fail("invalid_patch");
  }
  checkActive(observation);
  return output;
}
