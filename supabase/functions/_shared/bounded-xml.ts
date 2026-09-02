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

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

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

export function decodeBoundedXmlText(value: string): string {
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
      const hexadecimal = entity.startsWith("#x") || entity.startsWith("#X");
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
    while (cursor < length && /\s/.test(source[cursor]!)) cursor += 1;
  };
  skipWhitespace();
  const nameStart = cursor;
  while (cursor < length && !/[\s/]/.test(source[cursor]!)) cursor += 1;
  const name = source.slice(nameStart, cursor);
  if (!XML_NAME.test(name)) invalid();
  const attributes = new Map<string, string>();
  let selfClosing = false;
  while (cursor < length) {
    skipWhitespace();
    if (cursor >= length) break;
    if (source[cursor] === "/") {
      cursor += 1;
      skipWhitespace();
      if (cursor !== length) invalid();
      selfClosing = true;
      break;
    }
    const attributeStart = cursor;
    while (cursor < length && !/[\s=]/.test(source[cursor]!)) cursor += 1;
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
    cursor += 1;
    attributes.set(attributeName, decodeBoundedXmlText(attributeValue));
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
  visitor: (event: BoundedXmlEvent) => void,
): void {
  if (xml.length > BOUNDED_XML_POLICY.maxInputChars) resourceLimit();
  const stack: string[] = [];
  let cursor = 0;
  let tokens = 0;
  let roots = 0;
  let decodedChars = 0;
  const emit = (event: BoundedXmlEvent) => {
    tokens += 1;
    if (tokens > BOUNDED_XML_POLICY.maxTokens) resourceLimit();
    if (event.kind === "text") {
      decodedChars += event.text.length;
      if (decodedChars > BOUNDED_XML_POLICY.maxDecodedChars) resourceLimit();
    }
    visitor(event);
  };

  while (cursor < xml.length) {
    const opening = xml.indexOf("<", cursor);
    if (opening < 0) {
      const text = decodeBoundedXmlText(xml.slice(cursor));
      if (stack.length === 0 && text.trim()) invalid();
      if (text) emit({ kind: "text", text });
      cursor = xml.length;
      break;
    }
    if (opening > cursor) {
      const text = decodeBoundedXmlText(xml.slice(cursor, opening));
      if (stack.length === 0 && text.trim()) invalid();
      if (text) emit({ kind: "text", text });
    }
    if (xml.startsWith("<!--", opening)) {
      const end = xml.indexOf("-->", opening + 4);
      if (end < 0 || end - opening > BOUNDED_XML_POLICY.maxTagChars) invalid();
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", opening)) {
      const end = xml.indexOf("?>", opening + 2);
      if (end < 0 || end - opening > BOUNDED_XML_POLICY.maxTagChars) invalid();
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", opening)) {
      const end = xml.indexOf("]]>", opening + 9);
      if (end < 0) invalid();
      const text = xml.slice(opening + 9, end);
      if (stack.length === 0 && text.trim()) invalid();
      if (text) emit({ kind: "text", text });
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<!", opening)) {
      throw new BoundedXmlError("unsafe");
    }
    const end = tagEnd(xml, opening + 1);
    const source = xml.slice(opening + 1, end);
    if (source.startsWith("/")) {
      const name = source.slice(1).trim();
      if (!XML_NAME.test(name) || stack.pop() !== name) invalid();
      emit({ kind: "end", name });
    } else {
      const parsed = parseStartTag(source);
      if (stack.length === 0) roots += 1;
      if (roots > 1) invalid();
      emit({ kind: "start", ...parsed });
      if (!parsed.selfClosing) {
        stack.push(parsed.name);
        if (stack.length > BOUNDED_XML_POLICY.maxDepth) resourceLimit();
      } else {
        emit({ kind: "end", name: parsed.name });
      }
    }
    cursor = end + 1;
  }
  if (stack.length !== 0 || roots !== 1) invalid();
}
