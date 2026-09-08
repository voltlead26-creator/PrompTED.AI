import {
  assertRtfWork,
  BoundedRtfError,
  type BoundedRtfToken,
  type RtfWorkBoundary,
  scanBoundedRtf,
} from "./bounded-rtf.ts";

export const RTF_TEXT_POLICY = Object.freeze({
  version: "rtf-text-subset.1",
  maxDecodedChars: 1024 * 1024,
  maxFonts: 256,
  maxColors: 256,
  maxUnicodeFallbackBytes: 255,
});

export class RtfSourceError extends Error {
  constructor(
    readonly code:
      | "invalid_rtf"
      | "unsupported_encoding"
      | "unsupported_content",
  ) {
    super(`RTF_SOURCE_${code.toUpperCase()}`);
    this.name = "RtfSourceError";
  }
}

type Word = Extract<BoundedRtfToken, { kind: "word" }>;
type Destination =
  | "body"
  | "fonttbl"
  | "colortbl"
  | "expandedcolortbl"
  | "opaque";
interface Frame {
  destination: Destination;
  atStart: boolean;
  starred: boolean;
  uc: number;
  font: number | null;
  fontDefinition: number | null;
}
interface Font {
  charset: number;
  codepage: number | null;
  closed: boolean;
}

function invalid(): never {
  throw new RtfSourceError("invalid_rtf");
}
function unsupported(): never {
  throw new RtfSourceError("unsupported_content");
}
function encoding(): never {
  throw new RtfSourceError("unsupported_encoding");
}
const requiredNumber = (word: Word, min = 0, max = 32767): number => {
  if (word.parameter === null || word.parameter < min || word.parameter > max) {
    invalid();
  }
  return word.parameter;
};
const noNumber = (word: Word) => {
  if (word.parameter !== null) invalid();
};

// These affect formatting, not text visibility or ordering. Their interpretation
// for a renderer/editor is deliberately NOT attested by this text-only reader.
const TOGGLES = new Set(["b", "i", "ul", "outl", "shad", "ulnone"]);
const NUMERIC_FORMAT = new Set([
  "fs",
  "fsmilli",
  "cf",
  "cb",
  "highlight",
  "expnd",
  "expndtw",
  "kerning",
  "li",
  "ri",
  "fi",
  "sb",
  "sa",
  "sl",
  "slmult",
  "tx",
  "deftab",
  "pardeftab",
  "paperw",
  "paperh",
  "margl",
  "margr",
  "margt",
  "margb",
  "viewkind",
  "viewscale",
  "vieww",
  "viewh",
  "cocoartf",
  "CocoaLigature",
  "expansion",
  "obliqueness",
  "slleading",
  "slmaximum",
  "slminimum",
]);
const FLAG_FORMAT = new Set([
  "ql",
  "qr",
  "qc",
  "qj",
  "qnatural",
  "ltrpar",
  "ltrch",
  "widowctrl",
  "nowidctlpar",
  "keep",
  "keepn",
  "hyphauto",
]);
const FONT_FAMILIES = new Set([
  "fnil",
  "froman",
  "fswiss",
  "fmodern",
  "fscript",
  "fdecor",
  "ftech",
  "fbidi",
]);
const TEXT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  par: "\n",
  line: "\n",
  tab: "\t",
  emdash: "—",
  endash: "–",
  emspace: "\u2003",
  enspace: "\u2002",
  qmspace: "\u2005",
  bullet: "•",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
});
// They can change visible wording, text order, or representation. Reject them
// even in starred destinations instead of admitting an incomplete ordinary file.
const UNSUPPORTED_CONTENT = new Set([
  // Removing these representations can change numeric or correction meaning.
  "strike",
  "striked",
  "sub",
  "super",
  "nosupersub",
  "upr",
  "ud",
  "field",
  "fldinst",
  "fldrslt",
  "v",
  "deleted",
  "revised",
  "intbl",
  "trowd",
  "cell",
  "row",
  "nestcell",
  "nestrow",
  "pn",
  "listtext",
  "listtable",
  "listoverridetable",
  "ls",
  "pntxtb",
  "pntxta",
  "header",
  "headerl",
  "headerr",
  "headerf",
  "footer",
  "footerl",
  "footerr",
  "footerf",
  "footnote",
  "endnote",
  "object",
  "objdata",
  "pict",
  "shp",
  "shpinst",
  "nonshppict",
  "shppict",
  "NeXTGraphic",
  "mmath",
  "fromhtml",
  "fromtext",
  "htmlrtf",
  "htmltag",
  "fontemb",
  "falt",
  "rtlpar",
  "rtlch",
  "cs",
  "s",
  "ds",
  "ts",
]);

/**
 * Read the explicitly supported ordinary RTF text subset. The complete original
 * is scanned and interpreted, including text after any caller's preview ceiling.
 * This is a derived text view only: it neither edits bytes nor attests layout,
 * formatting, document completeness for unknown destinations, or export safety.
 */
export function readRtfText(
  bytes: Uint8Array,
  boundary: RtfWorkBoundary = {},
): Readonly<{ text: string; hasOpaqueDestinations: boolean }> {
  const tokens = scanBoundedRtf(bytes, boundary);
  const frames: Frame[] = [];
  const fonts = new Map<number, Font>();
  const decoder = new TextDecoder("windows-1252", { fatal: true });
  let defaultFont: number | null = null;
  let codepage = 1252;
  let hasAnsi = false;
  let fontTableSeen = false;
  let colorTableSeen = false;
  let colorCount = 0;
  let expandedColorCount = 0;
  let expandedColorsSeen = false;
  let bodyStarted = false;
  let hasOpaqueDestinations = false;
  let fallback = 0;
  let pendingHigh = "";
  let text = "";

  function append(value: string) {
    // Validate every decoded unit before exposing any result. Do not replace
    // malformed UTF-16, silently strip NULs, or truncate validation at 20k.
    for (const character of value) {
      const scalar = character.codePointAt(0)!;
      if (scalar >= 0xd800 && scalar <= 0xdbff) {
        if (pendingHigh) invalid();
        pendingHigh = character;
      } else if (scalar >= 0xdc00 && scalar <= 0xdfff) {
        if (!pendingHigh) invalid();
        text += pendingHigh + character;
        pendingHigh = "";
      } else {
        if (
          pendingHigh || scalar < 32 && scalar !== 9 && scalar !== 10 ||
          scalar >= 0x7f && scalar <= 0x9f || scalar === 0xfffe ||
          scalar === 0xffff
        ) invalid();
        text += character;
      }
      if (text.length > RTF_TEXT_POLICY.maxDecodedChars) {
        throw new BoundedRtfError("resource_limit");
      }
    }
    if (value) bodyStarted = true;
  }

  function assertBodyEncoding(frame: Frame) {
    if (!hasAnsi) encoding();
    const id = frame.font ?? defaultFont;
    if (id === null) {
      if (fontTableSeen || codepage !== 1252) encoding();
      return;
    }
    const font = fonts.get(id);
    if (!font?.closed) encoding();
    // DEFAULT_CHARSET (1) inherits the declared document encoding. Symbol and
    // other character sets are not equivalent to ANSI even for ASCII byte values.
    if (font.charset !== 0 && font.charset !== 1) encoding();
    if ((font.codepage ?? codepage) !== 1252) encoding();
  }

  for (const [index, token] of tokens.entries()) {
    assertRtfWork(boundary);
    if (token.kind === "group_start") {
      fallback = 0;
      const parent = frames.at(-1);
      if (parent?.starred) invalid();
      if (parent?.destination === "expandedcolortbl") unsupported();
      if (parent) parent.atStart = false;
      frames.push(
        parent ? { ...parent, atStart: true, starred: false } : {
          destination: "body",
          atStart: true,
          starred: false,
          uc: 1,
          font: null,
          fontDefinition: null,
        },
      );
      continue;
    }
    const frame = frames.at(-1);
    if (!frame) invalid();
    if (token.kind === "group_end") {
      if (frame.starred) invalid();
      if (
        frame.destination === "expandedcolortbl" &&
        expandedColorCount !== colorCount
      ) invalid();
      if (
        frame.destination === "fonttbl" && frame.fontDefinition !== null &&
        !fonts.get(frame.fontDefinition)?.closed
      ) invalid();
      fallback = 0;
      frames.pop();
      continue;
    }
    if (token.kind === "newline") continue;
    // Binary syntax is understood but its content is outside this reader's subset.
    if (token.kind === "binary") unsupported();
    if (fallback > 0) {
      if (token.kind === "text") {
        const skipped = Math.min(fallback, token.end - token.start);
        fallback -= skipped;
        if (token.start + skipped < token.end) {
          assertBodyEncoding(frame);
          append(
            decoder.decode(bytes.subarray(token.start + skipped, token.end)),
          );
        }
      } else fallback--;
      continue;
    }
    if (token.kind === "symbol" && token.symbol === "*") {
      if (!frame.atStart || frame.starred || frames.length === 1) invalid();
      frame.starred = true;
      continue;
    }
    if (frame.starred) {
      if (token.kind !== "word") invalid();
      if (UNSUPPORTED_CONTENT.has(token.name)) unsupported();
      // The observed AppKit empty extension adds no text or colour values.
      // Non-empty extended colour semantics remain outside this subset.
      if (token.name === "expandedcolortbl") {
        if (
          frames.length !== 2 || bodyStarted || !colorTableSeen ||
          expandedColorsSeen
        ) invalid();
        noNumber(token);
        expandedColorsSeen = true;
        frame.destination = "expandedcolortbl";
        frame.starred = false;
        frame.atStart = false;
        continue;
      }
      frame.destination = "opaque";
      frame.starred = false;
      frame.atStart = false;
      hasOpaqueDestinations = true;
      continue;
    }
    if (frame.destination === "opaque") continue;
    if (token.kind === "word" && UNSUPPORTED_CONTENT.has(token.name)) {
      unsupported();
    }
    if (
      token.kind === "word" &&
      ["fonttbl", "colortbl", "info", "generator"].includes(token.name)
    ) {
      if (!frame.atStart || frames.length !== 2 || bodyStarted) invalid();
      noNumber(token);
      if (token.name === "fonttbl") {
        if (fontTableSeen) invalid();
        fontTableSeen = true;
        frame.destination = "fonttbl";
      } else if (token.name === "colortbl") {
        if (colorTableSeen) invalid();
        colorTableSeen = true;
        frame.destination = "colortbl";
      } else frame.destination = "opaque";
      frame.atStart = false;
      continue;
    }
    frame.atStart = false;
    if (frame.destination === "expandedcolortbl") {
      if (token.kind !== "text") unsupported();
      for (let offset = token.start; offset < token.end; offset++) {
        if (bytes[offset] === 59) {
          if (++expandedColorCount > colorCount) invalid();
        } else if (bytes[offset] !== 32 && bytes[offset] !== 9) unsupported();
      }
      continue;
    }
    if (frame.destination === "fonttbl") {
      if (token.kind === "word") {
        if (token.name === "f") {
          const id = requiredNumber(token);
          if (fonts.has(id)) invalid();
          if (fonts.size >= RTF_TEXT_POLICY.maxFonts) {
            throw new BoundedRtfError("resource_limit");
          }
          fonts.set(id, { charset: 0, codepage: null, closed: false });
          frame.fontDefinition = id;
        } else if (token.name === "fcharset" || token.name === "cpg") {
          const font = fonts.get(frame.fontDefinition ?? -1);
          if (!font || font.closed) invalid();
          const value = requiredNumber(token, 0, 65535);
          if (token.name === "fcharset") font.charset = value;
          else font.codepage = value;
        } else if (FONT_FAMILIES.has(token.name) || token.name === "fprq") {
          const font = fonts.get(frame.fontDefinition ?? -1);
          if (!font || font.closed) invalid();
          if (token.name === "fprq") requiredNumber(token, 0, 2);
          else noNumber(token);
        } else unsupported();
      } else if (token.kind === "text") {
        for (let offset = token.start; offset < token.end; offset++) {
          if (bytes[offset] === 59) {
            const font = fonts.get(frame.fontDefinition ?? -1);
            if (!font || font.closed) invalid();
            font.closed = true;
          } else if (bytes[offset]! > 32) {
            const font = fonts.get(frame.fontDefinition ?? -1);
            if (!font || font.closed) invalid();
          }
        }
      } else if (token.kind === "hex") {
        const font = fonts.get(frame.fontDefinition ?? -1);
        if (!font || font.closed) invalid();
      } else unsupported();
      continue;
    }
    if (frame.destination === "colortbl") {
      if (token.kind === "word") {
        if (!["red", "green", "blue"].includes(token.name)) unsupported();
        requiredNumber(token, 0, 255);
      } else if (token.kind === "text") {
        for (let offset = token.start; offset < token.end; offset++) {
          if (bytes[offset] === 59) {
            if (++colorCount > RTF_TEXT_POLICY.maxColors) {
              throw new BoundedRtfError("resource_limit");
            }
          } else if (bytes[offset] !== 32 && bytes[offset] !== 9) invalid();
        }
      } else invalid();
      continue;
    }
    if (token.kind === "text" || token.kind === "hex") {
      assertBodyEncoding(frame);
      append(
        decoder.decode(
          token.kind === "hex"
            ? new Uint8Array([token.byte])
            : bytes.subarray(token.start, token.end),
        ),
      );
    } else if (token.kind === "symbol") {
      assertBodyEncoding(frame);
      const symbols: Readonly<Record<string, string>> = {
        "\\": "\\",
        "{": "{",
        "}": "}",
        "~": "\u00a0",
        "_": "\u2011",
        "-": "\u00ad",
        "\n": "\n",
      };
      if (!Object.hasOwn(symbols, token.symbol)) unsupported();
      append(symbols[token.symbol]!);
    } else if (token.kind === "word") {
      if (token.name === "rtf") {
        if (index !== 1 || token.parameter !== 1) invalid();
      } else if (token.name === "ansi") {
        if (bodyStarted || frames.length !== 1 || hasAnsi) invalid();
        noNumber(token);
        hasAnsi = true;
      } else if (["mac", "pc", "pca"].includes(token.name)) encoding();
      else if (token.name === "ansicpg") {
        if (bodyStarted || frames.length !== 1) invalid();
        codepage = requiredNumber(token, 1, 65535);
      } else if (token.name === "deff") {
        if (bodyStarted || frames.length !== 1 || defaultFont !== null) {
          invalid();
        }
        defaultFont = requiredNumber(token);
      } else if (token.name === "f") {
        frame.font = requiredNumber(token);
        assertBodyEncoding(frame);
      } else if (token.name === "plain") {
        noNumber(token);
        frame.font = defaultFont;
      } else if (token.name === "pard") noNumber(token);
      else if (token.name === "uc") {
        frame.uc = requiredNumber(
          token,
          0,
          RTF_TEXT_POLICY.maxUnicodeFallbackBytes,
        );
      } else if (token.name === "u") {
        assertBodyEncoding(frame);
        // RTF defines signed UTF-16 units; the observed AppKit writer also
        // emits unsigned units (including surrogate pairs). Accept exactly one
        // 16-bit unit in either representation, never modulo-wrap larger values.
        const unit = requiredNumber(token, -32768, 65535);
        append(String.fromCharCode(unit < 0 ? unit + 65536 : unit));
        fallback = frame.uc;
      } else if (Object.hasOwn(TEXT_WORDS, token.name)) {
        noNumber(token);
        assertBodyEncoding(frame);
        append(TEXT_WORDS[token.name]!);
      } else if (
        token.name === "cocoatextscaling" || token.name === "cocoaplatform"
      ) {
        if (frames.length !== 1 || bodyStarted) invalid();
        if (requiredNumber(token, -2147483648, 2147483647) !== 0) unsupported();
      } else if (token.name === "partightenfactor") {
        if (requiredNumber(token, -2147483648, 2147483647) !== 0) unsupported();
      } else if (token.name === "pardirnatural") noNumber(token);
      else if (TOGGLES.has(token.name)) {
        if (token.parameter !== null) requiredNumber(token, 0, 1);
      } else if (NUMERIC_FORMAT.has(token.name)) {
        requiredNumber(token, -2147483648, 2147483647);
      } else if (FLAG_FORMAT.has(token.name)) noNumber(token);
      else unsupported();
    }
  }
  if (
    pendingHigh || !hasAnsi || [...fonts.values()].some((font) => !font.closed)
  ) invalid();
  assertRtfWork(boundary);
  return Object.freeze({ text, hasOpaqueDestinations });
}
