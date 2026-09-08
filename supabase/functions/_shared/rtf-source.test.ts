// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { BoundedRtfError } from "./bounded-rtf.ts";
import { readRtfText, RtfSourceError } from "./rtf-source.ts";

const encode = (value: string) => new TextEncoder().encode(value);
const read = (value: string) => readRtfText(encode(value));
const wrap = (body: string) => String.raw`{\rtf1\ansi ` + body + "}";

const positive: readonly [string, string, string][] = [
  [
    "AppKit unsigned Unicode units",
    wrap(String.raw`\uc0\u32768\u55357\u56832`),
    "耀😀",
  ],
  [
    "AppKit neutral writer controls and empty extended colour table",
    String
      .raw`{\rtf1\ansi\cocoatextscaling0\cocoaplatform0{\colortbl;;}{\*\expandedcolortbl;;}\pardirnatural\partightenfactor0 A}`,
    "A",
  ],
  [
    "synthetic TextEdit-style fixture",
    String
      .raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Helvetica;}}\f0\fs24\b Format protected document\b0\par}`,
    "Format protected document\n",
  ],
  ["delimiter ownership", wrap(String.raw`\b0Hello\b  X`), "Hello X"],
  [
    "nested groups and paragraph controls",
    wrap(String.raw`A{\b B{\i C}D}E\par\pard F\line G\tab H`),
    "ABCDE\nF\nG\tH",
  ],
  [
    "escaped punctuation and CP1252",
    wrap(String.raw`Caf\'e9 \'93Q\'94 \\ \{x\}`),
    "Café “Q” \\ {x}",
  ],
  [
    "scoped Unicode fallback",
    wrap(String.raw`\uc1\u945?{\uc0\u946}\u947?`),
    "αβγ",
  ],
  [
    "fallback control is not a state change",
    wrap(String.raw`\b\uc2\u945\b0?X`),
    "αX",
  ],
  ["fallback stops at group boundary", wrap(String.raw`\uc2\u945?{X}Y`), "αXY"],
  ["root close terminates fallback", wrap(String.raw`\u945`), "α"],
  ["surrogate escapes", wrap(String.raw`\uc1\u-10179?\u-8704?`), "😀"],
  ["escaped fallback counts once", wrap(String.raw`\uc2\u945\{\'3fX`), "αX"],
  ["raw CRLF is not a paragraph", wrap("A\r\nB\\par C"), "AB\nC"],
  [
    "plain resets font but preserves uc",
    String
      .raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\fcharset0 Other;}}\uc0\f1\plain\u945}`,
    "α",
  ],
  [
    "reviewed Apple formatting controls",
    wrap(
      String
        .raw`\cocoartf100\CocoaLigature1\pardeftab720\qnatural\fsmilli12500 A`,
    ),
    "A",
  ],
  [
    "font codepage overrides document default",
    String
      .raw`{\rtf1\ansi\ansicpg932\deff0{\fonttbl{\f0\fcharset0\cpg1252 Arial;}}\f0 Caf\'e9}`,
    "Café",
  ],
  [
    "unused Symbol font excluded",
    String
      .raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\fcharset2 Symbol;}}\f0 A}`,
    "A",
  ],
  [
    "font selection restores with group",
    String
      .raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\cpg1252 Other;}}\f0 A{\f1 B}C}`,
    "ABC",
  ],
  [
    "colour and metadata destinations excluded",
    String
      .raw`{\rtf1\ansi{\colortbl;\red255\green0\blue0;}{\info{\title Not body}{\author Not body}}\cf1 A}`,
    "A",
  ],
  [
    "text controls",
    wrap(String.raw`\lquote A\rquote\emdash\ldblquote B\rdblquote\tab\bullet`),
    "‘A’—“B”\t•",
  ],
  ["empty supported file remains empty", String.raw`{\rtf1\ansi}`, ""],
];
for (const [label, input, expected] of positive) {
  Deno.test(`RTF text subset: ${label}`, () => {
    assertEquals(read(input), { text: expected, hasOpaqueDestinations: false });
  });
}

Deno.test("RTF source reads raw CP1252 bytes without UTF-8 replacement or source mutation", () => {
  const prefix = encode(String.raw`{\rtf1\ansi Caf`);
  const bytes = new Uint8Array([...prefix, 0xe9, 32, 0x93, 81, 0x94, 125]);
  const before = bytes.slice();
  assertEquals(readRtfText(bytes).text, "Café “Q”");
  assertEquals(bytes, before);
});

Deno.test("RTF source reports opaque extensions and restores outer text state", () => {
  const input = wrap(String.raw`A{\*\future {\b SECRET}\uc0\u945}B\u947?`);
  assertEquals(read(input), { text: "ABγ", hasOpaqueDestinations: true });
});

const unsupported = [
  String.raw`\cocoatextscaling1 A`,
  String.raw`\cocoaplatform-1 A`,
  String.raw`\partightenfactor1 A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;\cssrgb\c0; }A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;\'3b}A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;TEXT;}A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;{};}A`,
  String.raw`\cocoatextscaling0{\colortbl;;}{\*\expandedcolortbl;;}\v Hidden`,
  String.raw`Paid \strike 500\strike0 50`,
  String.raw`10\super 6\nosupersub`,
  String.raw`H\sub 2\nosupersub O`,
  String.raw`\unknown7 A`,
  String.raw`\cocoaligature1 A`,
  String.raw`\v A`,
  String.raw`\v0 A`,
  String.raw`\revised A`,
  String.raw`\deleted A`,
  String.raw`{\field{\fldinst HYPERLINK path}{\fldrslt A}}`,
  String.raw`\intbl A\cell\row`,
  String.raw`{\*\listtable x}A`,
  String.raw`\ls1 A`,
  String.raw`{\pict 1234}A`,
  String.raw`{\object\objdata 1234}A`,
  String.raw`{\NeXTGraphic path}A`,
  String.raw`{\header A}B`,
  String.raw`{\footnote A}B`,
  String.raw`{\upr{A}{\*\ud B}}`,
  String.raw`\rtlch A`,
  String.raw`\s1 A`,
  String.raw`{\*\future\bin3 {}\}A`,
  String.raw`\uc1\u65\bin1 x`,
];
for (const [index, body] of unsupported.entries()) {
  Deno.test(`RTF source rejects unsupported meaningful content ${index + 1}`, () => {
    assertThrows(() => read(wrap(body)), RtfSourceError, "UNSUPPORTED_CONTENT");
  });
}

const malformed = [
  String.raw`\cocoatextscaling A`,
  String.raw`\cocoaplatform A`,
  String.raw`\partightenfactor A`,
  String.raw`A\cocoaplatform0`,
  String.raw`{\cocoatextscaling0 A}`,
  String.raw`\pardirnatural1 A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;}A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;;;}A`,
  String.raw`{\*\expandedcolortbl;;}{\colortbl;;}A`,
  String.raw`{\colortbl;;}A{\*\expandedcolortbl;;}`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl;;}{\*\expandedcolortbl;;}A`,
  String.raw`{\colortbl;;}{{\*\expandedcolortbl;;}}A`,
  String.raw`{\colortbl;;}{\*\expandedcolortbl1;;}A`,
  String.raw`\u-32769?`,
  String.raw`\uc0\u56832\u55357`,
  String.raw`\u-10179?`,
  String.raw`\u-8704?`,
  String.raw`\u-10179?A`,
  String.raw`\u-10179?\u-10179?`,
  String.raw`\u65536?`,
  String.raw`\u0?`,
  String.raw`\uc-1 A`,
  String.raw`\uc256 A`,
  String.raw`A\*\future B`,
  String.raw`{\*}A`,
  String.raw`{\* A}B`,
  String.raw`\u-1?`,
  String.raw`{{A}\*\future B}`,
  String.raw`{\*{\future A}}`,
  String.raw`{\fonttbl{\f0 Arial;}{\f0 Arial;}}A`,
  String.raw`{\fonttbl{\f0 Arial}}A`,
  String.raw`A{\fonttbl{\f0 Arial;}}B`,
  String.raw`{\fonttbl{\f0 Arial;NOT_FONT_TEXT}}A`,
  String.raw`{\fonttbl{\f0 Arial;\'41}}\f0 A`,
  String.raw`{\fonttbl\'41}`,
  String.raw`{\fonttbl{\f0 Arial;\fswiss}}\f0 A`,
  String.raw`\'81`,
  String.raw`{\colortbl\red256;}A`,
  String.raw`\rtf1 A`,
];
for (const [index, body] of malformed.entries()) {
  Deno.test(`RTF source rejects invalid semantic content ${index + 1}`, () => {
    assertThrows(() => read(wrap(body)), RtfSourceError, "INVALID_RTF");
  });
}

const badEncoding = [
  String.raw`{\rtf1 A}`,
  String.raw`{\rtf1\mac A}`,
  wrap(String.raw`\ansicpg932 A`),
  wrap(String.raw`\f9 A`),
  String
    .raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}{\f1\fcharset2 Symbol;}}\f0 A\f1 B}`,
  String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\fcharset128 Arial;}}\f0 A}`,
  String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0\cpg932 Arial;}}\f0 A}`,
];
for (const [index, input] of badEncoding.entries()) {
  Deno.test(`RTF source rejects ambiguous/unsupported active encoding ${index + 1}`, () => {
    assertThrows(() => read(input), RtfSourceError, "UNSUPPORTED_ENCODING");
  });
}

Deno.test("RTF source validates all content beyond the classifier preview limit", () => {
  const large = "A".repeat(20_000);
  assertEquals(
    read(wrap(large + String.raw`\u-10179?\u-8704?`)).text,
    large + "😀",
  );
  assertThrows(
    () => read(wrap(large + String.raw`\field X`)),
    RtfSourceError,
    "UNSUPPORTED_CONTENT",
  );
  assertThrows(() => read(wrap(large) + "}"), BoundedRtfError, "INVALID");
  assertThrows(
    () => read(wrap(large + String.raw`\u-10179?`)),
    RtfSourceError,
    "INVALID_RTF",
  );
});

Deno.test("RTF source applies font/color limits including unused definitions", () => {
  const fonts = (count: number) =>
    String.raw`{\rtf1\ansi\deff0{\fonttbl` +
    Array.from({ length: count }, (_, i) => `{\\f${i} Arial;}`).join("") +
    "}A}";
  assertEquals(read(fonts(256)).text, "A");
  assertThrows(() => read(fonts(257)), BoundedRtfError, "RESOURCE_LIMIT");
  assertEquals(read(wrap("{\\colortbl" + ";".repeat(256) + "}A")).text, "A");
  assertThrows(
    () => read(wrap("{\\colortbl" + ";".repeat(257) + "}A")),
    BoundedRtfError,
    "RESOURCE_LIMIT",
  );
});
