// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  BOUNDED_RTF_POLICY,
  BoundedRtfError,
  scanBoundedRtf,
} from "./bounded-rtf.ts";

const encode = (value: string) => new TextEncoder().encode(value);
const scan = (value: string) => scanBoundedRtf(encode(value));

Deno.test("RTF scanner preserves exact parameter and delimiter byte ownership", () => {
  const input = String.raw`{\rtf1\ansi\b0Hello\b  X}`;
  const tokens = scan(input);
  assertEquals(
    tokens.filter((token) => token.kind === "text").map(
      (token) => input.slice(token.start, token.end),
    ),
    ["Hello", " X"],
  );
  const controls = tokens.filter((token) => token.kind === "word");
  assertEquals(
    controls.map((
      token,
    ) => [
      token.name,
      token.parameter,
      input.slice(token.controlEnd, token.end),
    ]),
    [
      ["rtf", 1, ""],
      ["ansi", null, ""],
      ["b", 0, ""],
      ["b", null, " "],
    ],
  );
  assertEquals(Object.isFrozen(tokens), true);
  assertEquals(tokens.every(Object.isFrozen), true);
});

Deno.test("RTF scanner handles binary braces and backslash as one opaque token", () => {
  const input = String.raw`{\rtf1\ansi{\*\future\bin3 {}\}Z}`;
  const tokens = scan(input);
  assertEquals(
    tokens.filter((token) => token.kind === "group_start").length,
    2,
  );
  assertEquals(tokens.filter((token) => token.kind === "group_end").length, 2);
  const binary = tokens.find((token) => token.kind === "binary")!;
  assertEquals(input.slice(binary.payloadStart, binary.end), "{}\\");
  assertEquals(binary.byteLength, 3);
  assertEquals(
    tokens.filter((token) => token.kind === "text").map(
      (token) => input.slice(token.start, token.end),
    ),
    ["Z"],
  );
});

Deno.test("RTF scanner preserves escaped punctuation, hex bytes and raw CRLF distinctly", () => {
  const tokens = scan("{\\rtf1\\ansi \\'e9\\{\\}\\\\\r\nX}");
  assertEquals(
    tokens.filter((token) => token.kind === "hex").map((
      token,
    ) => [token.byte, token.end - token.start]),
    [[233, 4]],
  );
  assertEquals(
    tokens.filter((token) => token.kind === "symbol").map((
      token,
    ) => [token.symbol, token.end - token.start]),
    [["{", 2], ["}", 2], ["\\", 2]],
  );
  assertEquals(tokens.filter((token) => token.kind === "newline").length, 1);
});

const invalid = [
  "",
  String.raw`{\rtf2 A}`,
  String.raw` {\rtf1 A}`,
  String.raw`{\RTF1 A}`,
  String.raw`{\rtf1 A}{\rtf1 B}`,
  String.raw`{\rtf1 A`,
  String.raw`{\rtf1 A}}`,
  "{\\rtf1 " + "\\",
  String.raw`{\rtf1 \'a}`,
  String.raw`{\rtf1 \'xz}`,
  String.raw`{\rtf1 \abcdefghijklmnopqrstuvwxyzABCDEFG1}`,
  String.raw`{\rtf1 \foo2147483648}`,
  String.raw`{\rtf1 \foo-2147483649}`,
  String.raw`{\rtf1 \foo00000000000}`,
  String.raw`{\rtf1 \foo- A}`,
  String.raw`{\rtf1 \bin-1 A}`,
  String.raw`{\rtf1 \bin A}`,
  String.raw`{\rtf1 \bin99 A}`,
  "{\\rtf1 A\u0000B}",
];
for (const [index, input] of invalid.entries()) {
  Deno.test(`RTF scanner rejects incomplete or ambiguous grammar ${index + 1}`, () => {
    assertThrows(() => scan(input), BoundedRtfError, "INVALID");
  });
}

Deno.test("RTF scanner accepts signed32 lexical endpoints and ASCII whitespace trailer", () => {
  const tokens = scan(
    String.raw`{\rtf1\foo2147483647\bar-2147483648}` + " \t\r\n",
  );
  assertEquals(
    tokens.filter((token) => token.kind === "word").map(
      (token) => token.parameter,
    ),
    [1, 2147483647, -2147483648],
  );
});

Deno.test("RTF scanner bounds complete input bytes, depth and tokens including opaque groups", () => {
  const byteCap = BOUNDED_RTF_POLICY.maxInputBytes;
  const exact = String.raw`{\rtf1 ` + "x".repeat(byteCap - 8) + "}";
  assertEquals(encode(exact).length, byteCap);
  scan(exact);
  assertThrows(() => scan(exact + " "), BoundedRtfError, "RESOURCE_LIMIT");
  const nested = (depth: number) =>
    String.raw`{\rtf1 ` + "{".repeat(depth - 1) +
    "x" + "}".repeat(depth);
  scan(nested(BOUNDED_RTF_POLICY.maxDepth));
  assertThrows(
    () => scan(nested(BOUNDED_RTF_POLICY.maxDepth + 1)),
    BoundedRtfError,
    "RESOURCE_LIMIT",
  );
  // Header/root/end use three tokens; every escaped backslash is one token.
  const exactTokens = String.raw`{\rtf1` +
    "\\\\".repeat(BOUNDED_RTF_POLICY.maxTokens - 3) + "}";
  assertEquals(scan(exactTokens).length, BOUNDED_RTF_POLICY.maxTokens);
  assertThrows(
    () => scan(exactTokens.slice(0, -1) + "\\\\}"),
    BoundedRtfError,
    "RESOURCE_LIMIT",
  );
});

Deno.test("RTF scanner checks cancellation and deadline without mutating caller bytes", () => {
  const bytes = encode(String.raw`{\rtf1 A}`);
  const before = bytes.slice();
  assertThrows(
    () => scanBoundedRtf(bytes, { signal: AbortSignal.abort() }),
    BoundedRtfError,
    "CANCELLED",
  );
  assertThrows(
    () => scanBoundedRtf(bytes, { deadline: Date.now() - 1 }),
    BoundedRtfError,
    "DEADLINE_EXCEEDED",
  );
  assertThrows(
    () => scanBoundedRtf(bytes, { deadline: NaN }),
    BoundedRtfError,
    "INVALID",
  );
  scanBoundedRtf(bytes);
  assertEquals(bytes, before);
});

Deno.test("RTF scanner rejects shared buffers and non-byte typed arrays at its input boundary", () => {
  const original = encode(String.raw`{\rtf1\ansi A}`);
  const shared = new Uint8Array(new SharedArrayBuffer(original.length));
  shared.set(original);
  assertThrows(() => scanBoundedRtf(shared), BoundedRtfError, "INVALID");
  // Exercise a real untyped caller without suppressing type diagnostics in production.
  assertThrows(
    () => Reflect.apply(scanBoundedRtf, null, [new Uint16Array(original)]),
    BoundedRtfError,
    "INVALID",
  );
});

Deno.test("RTF scanner accepts exact control limit, empty/binary payload and view-relative spans", () => {
  scan(String.raw`{\rtf1\abcdefghijklmnopqrstuvwxyzABCDEF1}`);
  const empty = scan(String.raw`{\rtf1\bin0}`);
  const binary = empty.find((token) => token.kind === "binary")!;
  assertEquals(binary.payloadStart, binary.end);
  assertEquals(binary.byteLength, 0);
  const original = new Uint8Array([
    ...encode(String.raw`{\rtf1\bin2 `),
    0,
    255,
    125,
  ]);
  const backing = new Uint8Array(original.length + 2);
  backing.set(original, 1);
  const tokens = scanBoundedRtf(backing.subarray(1, -1));
  assertEquals(tokens[0].start, 0);
  assertEquals(tokens.at(-1)!.end, original.length);
  assertEquals(
    tokens.every((token, index) =>
      index === 0 || tokens[index - 1].end === token.start
    ),
    true,
  );
});
