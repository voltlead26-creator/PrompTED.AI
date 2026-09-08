/** Parser ceilings for the first RTF subset; these are product limits, not RTF limits. */
export const BOUNDED_RTF_POLICY = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxTokens: 100_000,
  maxDepth: 64,
  maxControlNameBytes: 32,
});

export class BoundedRtfError extends Error {
  constructor(
    readonly code:
      | "invalid"
      | "resource_limit"
      | "deadline_exceeded"
      | "cancelled",
  ) {
    super(`BOUNDED_RTF_${code.toUpperCase()}`);
    this.name = "BoundedRtfError";
  }
}

interface ByteSpan {
  /** Half-open offsets into the original bytes, including any consumed delimiter. */
  readonly start: number;
  readonly end: number;
}

export type BoundedRtfToken =
  & ByteSpan
  & (
    | { readonly kind: "group_start" | "group_end"; readonly depth: number }
    | { readonly kind: "text" | "newline" }
    | { readonly kind: "symbol"; readonly symbol: string }
    | { readonly kind: "hex"; readonly byte: number }
    | {
      readonly kind: "word";
      readonly name: string;
      readonly parameter: number | null;
      /** End before an optional delimiter space. Important for future source edits. */
      readonly controlEnd: number;
    }
    | {
      readonly kind: "binary";
      readonly payloadStart: number;
      readonly byteLength: number;
      readonly controlEnd: number;
    }
  );

export interface RtfWorkBoundary {
  readonly signal?: AbortSignal;
  readonly deadline?: number;
}

export function assertRtfWork(boundary: RtfWorkBoundary): void {
  if (boundary.signal?.aborted) throw new BoundedRtfError("cancelled");
  if (boundary.deadline !== undefined) {
    if (!Number.isFinite(boundary.deadline)) {
      throw new BoundedRtfError("invalid");
    }
    if (Date.now() >= boundary.deadline) {
      throw new BoundedRtfError("deadline_exceeded");
    }
  }
}

const letter = (byte: number) =>
  byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
const digit = (byte: number) => byte >= 48 && byte <= 57;
const space = (byte: number) =>
  byte === 32 || byte === 9 || byte === 10 || byte === 13;
const hex = (byte: number): number => {
  if (digit(byte)) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  if (byte >= 97 && byte <= 102) return byte - 87;
  throw new BoundedRtfError("invalid");
};

/**
 * Synchronous lexical validation of a complete RTF document. No decoding,
 * destination interpretation, file access or callbacks occur here. Tokens are
 * immutable spans; consumers must own the same bytes before asynchronous work.
 * Even opaque destinations and binary payloads count against the input budget.
 */
export function scanBoundedRtf(
  bytes: Uint8Array,
  boundary: RtfWorkBoundary = {},
): readonly BoundedRtfToken[] {
  assertRtfWork(boundary);
  if (
    !(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer
  ) {
    throw new BoundedRtfError("invalid");
  }
  if (bytes.length > BOUNDED_RTF_POLICY.maxInputBytes) {
    throw new BoundedRtfError("resource_limit");
  }
  const invalid = (): never => {
    throw new BoundedRtfError("invalid");
  };
  if (bytes.length < 7 || bytes[0] !== 123) invalid();
  const tokens: BoundedRtfToken[] = [];
  const emit = (token: BoundedRtfToken) => {
    if (tokens.length >= BOUNDED_RTF_POLICY.maxTokens) {
      throw new BoundedRtfError("resource_limit");
    }
    tokens.push(Object.freeze(token));
  };
  let cursor = 0;
  let depth = 0;
  let closed = false;
  while (cursor < bytes.length) {
    assertRtfWork(boundary);
    const start = cursor;
    const byte = bytes[cursor++]!;
    if (closed) {
      if (!space(byte)) invalid();
      continue;
    }
    if (byte === 123) {
      if (++depth > BOUNDED_RTF_POLICY.maxDepth) {
        throw new BoundedRtfError("resource_limit");
      }
      emit({ kind: "group_start", start, end: cursor, depth });
    } else if (byte === 125) {
      if (depth <= 0) invalid();
      emit({ kind: "group_end", start, end: cursor, depth });
      if (--depth === 0) closed = true;
    } else if (byte === 92) {
      if (cursor >= bytes.length) invalid();
      const first = bytes[cursor++]!;
      if (letter(first)) {
        let name = String.fromCharCode(first);
        while (cursor < bytes.length && letter(bytes[cursor]!)) {
          if (name.length >= BOUNDED_RTF_POLICY.maxControlNameBytes) invalid();
          name += String.fromCharCode(bytes[cursor++]!);
        }
        let parameter: number | null = null;
        const negative = bytes[cursor] === 45;
        if (negative) cursor++;
        if (negative && !digit(bytes[cursor]!)) invalid();
        if (digit(bytes[cursor]!)) {
          let magnitude = 0;
          let digits = 0;
          while (digit(bytes[cursor]!)) {
            if (++digits > 10) invalid();
            magnitude = magnitude * 10 + bytes[cursor++]! - 48;
            if (magnitude > (negative ? 2147483648 : 2147483647)) invalid();
          }
          parameter = negative ? -magnitude : magnitude;
        }
        const controlEnd = cursor;
        if (bytes[cursor] === 32) cursor++;
        if (name === "bin") {
          if (
            parameter === null || parameter < 0 ||
            parameter > bytes.length - cursor
          ) {
            invalid();
          }
          const payloadStart = cursor;
          cursor += parameter!;
          emit({
            kind: "binary",
            start,
            end: cursor,
            payloadStart,
            byteLength: parameter!,
            controlEnd,
          });
        } else {
          emit({
            kind: "word",
            name,
            parameter,
            start,
            end: cursor,
            controlEnd,
          });
        }
      } else if (first === 39) {
        if (cursor + 2 > bytes.length) invalid();
        const value = hex(bytes[cursor++]!) * 16 + hex(bytes[cursor++]!);
        emit({ kind: "hex", byte: value, start, end: cursor });
      } else {
        if (first < 32 && first !== 10 && first !== 13 || first > 126) {
          invalid();
        }
        if (first === 13 && bytes[cursor] === 10) cursor++;
        emit({
          kind: "symbol",
          symbol: first === 13 ? "\n" : String.fromCharCode(first),
          start,
          end: cursor,
        });
      }
    } else if (byte === 10 || byte === 13) {
      if (byte === 13 && bytes[cursor] === 10) cursor++;
      emit({ kind: "newline", start, end: cursor });
    } else {
      if (byte < 32 && byte !== 9) invalid();
      // Bound each run so semantic scanning and deadline checks cannot starve.
      while (cursor < bytes.length && cursor - start < 4096) {
        const next = bytes[cursor]!;
        if (
          next === 123 || next === 125 || next === 92 || next === 10 ||
          next === 13
        ) break;
        if (next < 32 && next !== 9) invalid();
        cursor++;
      }
      emit({ kind: "text", start, end: cursor });
    }
  }
  const header = tokens[1];
  if (
    !closed || depth !== 0 || header?.kind !== "word" ||
    header.start !== 1 || header.name !== "rtf" || header.parameter !== 1
  ) invalid();
  assertRtfWork(boundary);
  return Object.freeze(tokens);
}
