export const BOUNDED_XML_POLICY = {
  maxInputChars: 8 * 1024 * 1024,
  maxTokens: 250_000,
  maxDepth: 128,
  maxTagChars: 64 * 1024,
  maxAttributesPerElement: 64,
  maxAttributeValueChars: 4_096,
  maxDecodedChars: 16 * 1024 * 1024,
} as const;

export class BoundedXmlError extends Error {
  constructor(readonly code: "invalid" | "resource_limit" | "unsafe") {
    super(`BOUNDED_XML_${code.toUpperCase()}`);
    this.name = "BoundedXmlError";
  }
}

export type BoundedXmlEvent =
  | {
    kind: "start";
    name: string;
    attributes: ReadonlyMap<string, string>;
    selfClosing: boolean;
  }
  | { kind: "end"; name: string }
  | { kind: "text"; text: string };

/**
 * Half-open UTF-16 offsets into the exact input string (not decoded text or
 * UTF-8 bytes). Tag ranges include their delimiters; CDATA ranges cover only
 * the literal payload. Synthetic self-close ends have zero width after />.
 * Source-aware consumers must validate the complete scan before using ranges.
 */
export interface BoundedXmlSourceRange {
  readonly start: number;
  readonly end: number;
  readonly syntax: "tag" | "text" | "cdata" | "synthetic";
}

export interface BoundedXmlObservations {
  /** Lexically recognised PIs, including the XML declaration; comments/CDATA never qualify. */
  readonly onProcessingInstruction?: (
    target: string,
    source: BoundedXmlSourceRange,
  ) => void;
}

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const XML_SPACE = /^[ \t\r\n]$/;
const XML_DECLARATION =
  /^xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(['"])(?:yes|no)\3)?[ \t\r\n]*$/;

function invalid(): never {
  throw new BoundedXmlError("invalid");
}

function resourceLimit(): never {
  throw new BoundedXmlError("resource_limit");
}

function validXmlScalar(value: number): boolean {
  return value === 0x9 || value === 0xa || value === 0xd ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff);
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    if (!validXmlScalar(character.codePointAt(0)!)) invalid();
  }
}

function normaliseLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function decodeBoundedXmlText(value: string): string {
  assertXmlCharacters(value);
  let cursor = 0;
  let decoded = "";
  while (cursor < value.length) {
    const ampersand = value.indexOf("&", cursor);
    if (ampersand < 0) {
      decoded += value.slice(cursor);
      break;
    }
    decoded += value.slice(cursor, ampersand);
    const semicolon = value.indexOf(";", ampersand + 1);
    if (semicolon < 0 || semicolon - ampersand > 16) invalid();
    const entity = value.slice(ampersand + 1, semicolon);
    let replacement: string;
    if (entity === "amp") replacement = "&";
    else if (entity === "lt") replacement = "<";
    else if (entity === "gt") replacement = ">";
    else if (entity === "quot") replacement = '"';
    else if (entity === "apos") replacement = "'";
    else {
      const hexadecimal = entity.startsWith("#x");
      const decimal = entity.startsWith("#") && !hexadecimal;
      const digits = entity.slice(hexadecimal ? 2 : decimal ? 1 : 0);
      if (
        (!hexadecimal && !decimal) || !digits ||
        !(hexadecimal ? /^[0-9a-fA-F]+$/ : /^\d+$/).test(digits)
      ) invalid();
      const scalar = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isSafeInteger(scalar) || !validXmlScalar(scalar)) invalid();
      replacement = String.fromCodePoint(scalar);
    }
    decoded += replacement;
    if (decoded.length > BOUNDED_XML_POLICY.maxDecodedChars) resourceLimit();
    cursor = semicolon + 1;
  }
  if (decoded.length > BOUNDED_XML_POLICY.maxDecodedChars) resourceLimit();
  return decoded;
}

function tagEnd(xml: string, start: number): number {
  let quote = "";
  for (let index = start; index < xml.length; index += 1) {
    if (index - start > BOUNDED_XML_POLICY.maxTagChars) resourceLimit();
    const character = xml[index]!;
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return invalid();
}

function parseStartTag(
  source: string,
): {
  name: string;
  attributes: ReadonlyMap<string, string>;
  selfClosing: boolean;
} {
  let cursor = 0;
  const length = source.length;
  const skipWhitespace = () => {
    while (cursor < length && XML_SPACE.test(source[cursor]!)) cursor += 1;
  };
  const nameStart = cursor;
  while (cursor < length && !/[ \t\r\n/]/.test(source[cursor]!)) cursor += 1;
  const name = source.slice(nameStart, cursor);
  if (!XML_NAME.test(name)) invalid();
  const attributes = new Map<string, string>();
  let selfClosing = false;
  while (cursor < length) {
    const beforeWhitespace = cursor;
    skipWhitespace();
    if (cursor >= length) break;
    if (source[cursor] === "/") {
      cursor += 1;
      if (cursor !== length) invalid();
      selfClosing = true;
      break;
    }
    if (cursor === beforeWhitespace) invalid();
    const attributeStart = cursor;
    while (cursor < length && !/[ \t\r\n=]/.test(source[cursor]!)) cursor += 1;
    const attributeName = source.slice(attributeStart, cursor);
    if (!XML_NAME.test(attributeName) || attributes.has(attributeName)) {
      invalid();
    }
    skipWhitespace();
    if (source[cursor] !== "=") invalid();
    cursor += 1;
    skipWhitespace();
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") invalid();
    cursor += 1;
    const valueStart = cursor;
    while (cursor < length && source[cursor] !== quote) {
      if (cursor - valueStart > BOUNDED_XML_POLICY.maxAttributeValueChars) {
        resourceLimit();
      }
      cursor += 1;
    }
    if (cursor >= length) invalid();
    const attributeValue = source.slice(valueStart, cursor);
    if (attributeValue.length > BOUNDED_XML_POLICY.maxAttributeValueChars) {
      resourceLimit();
    }
    if (attributeValue.includes("<")) invalid();
    cursor += 1;
    // XML normalises literal whitespace before resolving references. A
    // referenced CR/tab remains that character, rather than becoming a space.
    attributes.set(
      attributeName,
      decodeBoundedXmlText(
        normaliseLineEndings(attributeValue).replace(/[\t\n]/g, " "),
      ),
    );
    if (attributes.size > BOUNDED_XML_POLICY.maxAttributesPerElement) {
      resourceLimit();
    }
  }
  return { name, attributes, selfClosing };
}

export function localXmlName(name: string): string {
  const separator = name.indexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

export function scanBoundedXml(
  xml: string,
  visitor: (event: BoundedXmlEvent, source: BoundedXmlSourceRange) => void,
  observations: BoundedXmlObservations = {},
): void {
  if (xml.length > BOUNDED_XML_POLICY.maxInputChars) resourceLimit();
  assertXmlCharacters(xml);
  const stack: string[] = [];
  const contentStart = xml.startsWith("\ufeff") ? 1 : 0;
  let cursor = contentStart;
  let tokens = 0;
  let roots = 0;
  let decodedChars = 0;
  const consumeToken = () => {
    tokens += 1;
    if (tokens > BOUNDED_XML_POLICY.maxTokens) resourceLimit();
  };
  const emit = (
    event: BoundedXmlEvent,
    start: number,
    end: number,
    syntax: BoundedXmlSourceRange["syntax"],
  ) => {
    consumeToken();
    if (event.kind === "text") {
      decodedChars += event.text.length;
      if (decodedChars > BOUNDED_XML_POLICY.maxDecodedChars) resourceLimit();
    }
    visitor(event, { start, end, syntax });
  };

  while (cursor < xml.length) {
    const opening = xml.indexOf("<", cursor);
    if (opening < 0) {
      const raw = xml.slice(cursor);
      if (raw.includes("]]>")) invalid();
      if (stack.length === 0 && /[^ \t\r\n]/.test(raw)) invalid();
      const text = decodeBoundedXmlText(normaliseLineEndings(raw));
      if (text) emit({ kind: "text", text }, cursor, xml.length, "text");
      cursor = xml.length;
      break;
    }
    if (opening > cursor) {
      const raw = xml.slice(cursor, opening);
      if (raw.includes("]]>")) invalid();
      if (stack.length === 0 && /[^ \t\r\n]/.test(raw)) invalid();
      const text = decodeBoundedXmlText(normaliseLineEndings(raw));
      if (text) emit({ kind: "text", text }, cursor, opening, "text");
    }
    if (xml.startsWith("<!--", opening)) {
      const end = xml.indexOf("-->", opening + 4);
      if (end < 0 || end - opening > BOUNDED_XML_POLICY.maxTagChars) invalid();
      const body = xml.slice(opening + 4, end);
      if (body.includes("--") || body.endsWith("-")) invalid();
      consumeToken();
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const end = xml.indexOf("?>", opening + 2);
      if (end < 0 || end - opening > BOUNDED_XML_POLICY.maxTagChars) invalid();
      const body = xml.slice(opening + 2, end);
      const target = body.match(
        /^([A-Za-z_][A-Za-z0-9_.:-]*)(?:[ \t\r\n]+[\s\S]*)?$/,
      )?.[1];
      if (!target) invalid();
      if (
        target.toLowerCase() === "xml" && (
          opening !== contentStart || !XML_DECLARATION.test(body)
        )
      ) invalid();
      consumeToken();
      observations.onProcessingInstruction?.(target, {
        start: opening,
        end: end + 2,
        syntax: "tag",
      });
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const end = xml.indexOf("]]>", opening + 9);
      if (end < 0 || stack.length === 0) invalid();
      const text = normaliseLineEndings(xml.slice(opening + 9, end));
      if (text) emit({ kind: "text", text }, opening + 9, end, "cdata");
      else consumeToken();
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new BoundedXmlError("unsafe");
    }
    const end = tagEnd(xml, opening + 1);
    const source = xml.slice(opening + 1, end);
    if (source.startsWith("/")) {
      const name = source.match(/^\/([A-Za-z_][A-Za-z0-9_.:-]*)[ \t\r\n]*$/)
        ?.[1];
      if (!name || stack.pop() !== name) invalid();
      emit({ kind: "end", name }, opening, end + 1, "tag");
    } else {
      const parsed = parseStartTag(source);
      if (stack.length === 0) roots += 1;
      if (roots > 1) invalid();
      if (stack.length + 1 > BOUNDED_XML_POLICY.maxDepth) resourceLimit();
      emit({ kind: "start", ...parsed }, opening, end + 1, "tag");
      if (!parsed.selfClosing) {
        stack.push(parsed.name);
      } else {
        emit({ kind: "end", name: parsed.name }, end + 1, end + 1, "synthetic");
      }
    }
    cursor = end + 1;
  }
  if (stack.length !== 0 || roots !== 1) invalid();
}
