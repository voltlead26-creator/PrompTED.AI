// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "jsr:@std/assert@1";
import {
  compileDocxSourceCandidate,
  compileDocxSourceUnitCandidate,
  DOCX_SOURCE_CANDIDATE_VERSION,
  DOCX_SOURCE_POLICY,
  DOCX_SOURCE_UNITS_VERSION,
  extractBoundedUploadText,
  extractBoundedUploadWithSource,
  inspectDocxSource,
  inspectDocxSourceUnits,
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  resolveUploadFormat,
  UPLOAD_RESOURCE_POLICY_VERSION,
  UploadExtractionError,
  withPdfCleanup,
} from "./upload-extraction.ts";
import {
  DocumentSourceContractError,
  normalizeDocxSourceManifest,
} from "./document-source-contract.ts";
import * as uploadExtraction from "./upload-extraction.ts";
import {
  deriveWordXmlUnitPatches,
  mapWordXmlSourceUnits,
  WordXmlSourceError,
} from "./wordprocessingml-source.ts";

interface ZipFixtureEntry {
  name: string;
  data?: Uint8Array;
  compressedData?: Uint8Array;
  method?: 0 | 8;
  declaredUncompressedSize?: number;
  localExtra?: Uint8Array;
  centralExtra?: Uint8Array;
  comment?: Uint8Array;
  gapAfter?: Uint8Array;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (
    let start = 0;
    start <= haystack.length - needle.length;
    start += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) continue outer;
    }
    return start;
  }
  return -1;
}

function storedZip(
  entries: ZipFixtureEntry[],
  options: { reverseDirectory?: boolean; comment?: Uint8Array } = {},
): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data ?? new Uint8Array();
    const archiveData = entry.compressedData ?? data;
    const method = entry.method ?? 0;
    const declared = entry.declaredUncompressedSize ?? data.byteLength;
    const localExtra = entry.localExtra ?? new Uint8Array();
    const centralExtra = entry.centralExtra ?? new Uint8Array();
    const comment = entry.comment ?? new Uint8Array();
    const local = new Uint8Array(
      30 + name.byteLength + localExtra.length + archiveData.byteLength,
    );
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc32(data), true);
    localView.setUint32(18, archiveData.byteLength, true);
    localView.setUint32(22, declared, true);
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, localExtra.length, true);
    local.set(name, 30);
    local.set(localExtra, 30 + name.byteLength);
    local.set(archiveData, 30 + name.byteLength + localExtra.length);
    locals.push(local);
    if (entry.gapAfter) locals.push(entry.gapAfter);

    const central = new Uint8Array(
      46 + name.byteLength + centralExtra.length + comment.length,
    );
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc32(data), true);
    centralView.setUint32(20, archiveData.byteLength, true);
    centralView.setUint32(24, declared, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint16(30, centralExtra.length, true);
    centralView.setUint16(32, comment.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    central.set(centralExtra, 46 + name.byteLength);
    central.set(comment, 46 + name.byteLength + centralExtra.length);
    centrals.push(central);
    localOffset += local.byteLength + (entry.gapAfter?.length ?? 0);
  }

  const centralBytes = concatBytes(
    options.reverseDirectory ? centrals.reverse() : centrals,
  );
  const end = new Uint8Array(22 + (options.comment?.length ?? 0));
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes.byteLength, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, options.comment?.length ?? 0, true);
  if (options.comment) end.set(options.comment, 22);
  return concatBytes([...locals, centralBytes, end]);
}

const encoder = new TextEncoder();
const DOCX_CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";
const XLSX_CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  "</Types>";

function rootRelationships(target: string): string {
  return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>` +
    "</Relationships>";
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(bytes)]).stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function docxEntries(
  body = "Reliable document text",
  extras: ZipFixtureEntry[] = [],
): ZipFixtureEntry[] {
  return [
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(rootRelationships("word/document.xml")),
    },
    {
      name: "word/document.xml",
      data: encoder.encode(
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>' + body +
          "</w:t></w:r></w:p></w:body></w:document>",
      ),
    },
    ...extras,
  ];
}

function minimalDocx(
  body = "Reliable document text",
  extras: ZipFixtureEntry[] = [],
): Uint8Array {
  return storedZip(docxEntries(body, extras));
}

function sourceDocxEntries(body: string, extras: ZipFixtureEntry[] = []) {
  return docxEntries(body, extras).map((entry) =>
    entry.name === "word/document.xml"
      ? {
        ...entry,
        data: encoder.encode(
          new TextDecoder().decode(entry.data).replace(
            "urn:w",
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
          ),
        ),
      }
      : entry
  );
}

Deno.test("DOCX candidate changes exact wording while retaining sibling parts and source-only assessment", async () => {
  const original = storedZip(sourceDocxEntries("Original wording", [{
    name: "word/styles.xml",
    data: encoder.encode(
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    ),
  }]));
  const before = await inspectDocxSource(original, "source.docx", "");
  const result = await compileDocxSourceCandidate(original, {
    version: "docx-source-candidate.1",
    archiveSha256: before.archiveSha256,
    patches: [{
      nodeId: "t:1",
      expectedText: "Original wording",
      text: "Revised & supported wording",
    }],
  });
  const after = await inspectDocxSource(result.bytes, "candidate.docx", "");
  assertEquals(result.version, "docx-source-candidate.1");
  assertEquals(result.originalArchiveSha256, before.archiveSha256);
  assertEquals(result.manifest, after);
  assertEquals(
    after.mainPart.source.nodes[0]?.text,
    "Revised & supported wording",
  );
  assertEquals(
    after.parts.filter((part) => part.path !== "word/document.xml"),
    before.parts.filter((part) => part.path !== "word/document.xml"),
  );
  assertEquals(after.assessment, "source_only");
  assertEquals(after.blockers, before.blockers);
  assertEquals(await sha256(original), before.archiveSha256);
});

async function candidateRequest(bytes: Uint8Array, text = "Changed wording") {
  return {
    version: DOCX_SOURCE_CANDIDATE_VERSION,
    archiveSha256: await sha256(bytes),
    patches: [{ nodeId: "t:1", expectedText: "Original wording", text }],
  };
}

Deno.test("DOCX current source unit roster retains an earlier edit when a second unit changes", async () => {
  const entries = sourceDocxEntries(
    "Original A</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Original B</w:t></w:r><w:r><w:t>Unchanged C",
    [{
      name: "word/styles.xml",
      data: encoder.encode("<styles>retained source</styles>"),
    }],
  );
  const original = storedZip(entries);
  const before = await inspectDocxSource(original, "original.docx", "");
  const mainBytes = entries[2]!.data!;
  const mapped = await mapWordXmlSourceUnits(mainBytes);
  const current = {
    version: mapped.version,
    originalSha256: mapped.source.originalSha256,
    units: mapped.units.map((unit) => ({
      nodeId: unit.nodeId,
      content: unit.content,
    })),
  };
  current.units[0]!.content = "Accepted first edit";
  const firstPlan = await deriveWordXmlUnitPatches(mainBytes, current);
  const first = await compileDocxSourceCandidate(original, {
    version: DOCX_SOURCE_CANDIDATE_VERSION,
    archiveSha256: before.archiveSha256,
    patches: firstPlan.patches,
  });
  assertEquals(first.manifest.mainPart.source.nodes.map((node) => node.text), [
    "Accepted first edit",
    "Original B",
    "Unchanged C",
  ]);
  current.units[1]!.content = "Accepted second edit";
  const fullPlan = await deriveWordXmlUnitPatches(mainBytes, current);
  assertEquals(fullPlan.patches.map((patch) => patch.nodeId), ["t:1", "t:2"]);
  const second = await compileDocxSourceCandidate(original, {
    version: DOCX_SOURCE_CANDIDATE_VERSION,
    archiveSha256: before.archiveSha256,
    patches: fullPlan.patches,
  });
  assertEquals(second.manifest.mainPart.source.nodes.map((node) => node.text), [
    "Accepted first edit",
    "Accepted second edit",
    "Unchanged C",
  ]);
  assertEquals(
    second.manifest.parts.filter((part) => part.path !== "word/document.xml"),
    before.parts.filter((part) => part.path !== "word/document.xml"),
  );
  assertEquals(await sha256(original), before.archiveSha256);
  await assertRejects(
    () =>
      deriveWordXmlUnitPatches(mainBytes, {
        ...current,
        units: [current.units[1]],
      }),
    WordXmlSourceError,
    "IDENTITY_MISMATCH",
  );
});

Deno.test("DOCX archive source units are derived from the same owned package as their manifest", async () => {
  assert(
    "inspectDocxSourceUnits" in uploadExtraction &&
      typeof uploadExtraction.inspectDocxSourceUnits === "function",
    "The server needs a whole-DOCX source-unit projection; callers must not supply extracted XML or node mappings.",
  );
  const original = storedZip(sourceDocxEntries(
    "First</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Second",
  ));
  const result = await inspectDocxSourceUnits(original);
  assertEquals(
    result.manifest,
    await inspectDocxSource(original, "source.docx", ""),
  );
  assertEquals(result.mainPartUnits.source, result.manifest.mainPart.source);
  assertEquals(result.mainPartUnits.units.map((unit) => unit.content), [
    "First",
    "Second",
  ]);
  assertEquals(result.mainPartUnits.paragraphs, [{
    id: "p:1",
    unitIds: ["t:1", "t:2"],
  }]);
  assertEquals(result.version, DOCX_SOURCE_UNITS_VERSION);
  assertEquals(result.assessment, "source_only");
  assertEquals(result.blockers, result.manifest.blockers);
  for (
    const value of [
      result,
      result.blockers,
      result.manifest,
      result.mainPartUnits,
      result.mainPartUnits.units,
      ...result.mainPartUnits.units,
    ]
  ) {
    assert(Object.isFrozen(value));
  }
});

Deno.test("DOCX archive source units compile the complete current roster against the exact original", async () => {
  assert(
    "compileDocxSourceUnitCandidate" in uploadExtraction &&
      typeof uploadExtraction.compileDocxSourceUnitCandidate === "function",
    "The compiler needs the whole archive identity and complete current source-unit roster, not independently supplied XML patches.",
  );
  const original = storedZip(sourceDocxEntries(
    "First</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Second</w:t></w:r><w:r><w:t>Third",
  ));
  const result = await compileDocxSourceUnitCandidate(original, {
    version: "docx-source-units.1",
    archiveSha256: await sha256(original),
    units: [
      { nodeId: "t:1", content: "Previously saved first edit" },
      { nodeId: "t:2", content: "New second edit" },
      { nodeId: "t:3", content: "Third" },
    ],
  });
  assertEquals(result.manifest.mainPart.source.nodes.map((node) => node.text), [
    "Previously saved first edit",
    "New second edit",
    "Third",
  ]);
  assertEquals(result.originalArchiveSha256, await sha256(original));
  assertEquals(result.manifest.assessment, "source_only");
});

async function sourceUnitRequest(bytes: Uint8Array) {
  const original = await inspectDocxSourceUnits(bytes);
  return {
    version: DOCX_SOURCE_UNITS_VERSION,
    archiveSha256: original.manifest.archiveSha256,
    units: original.mainPartUnits.units.map(({ nodeId, content }) => ({
      nodeId,
      content,
    })),
  };
}

Deno.test("DOCX archive source units reject another archive with identical text but different styles", async () => {
  const left = storedZip(
    sourceDocxEntries("Same wording", [{
      name: "word/styles.xml",
      data: encoder.encode("<styles>left</styles>"),
    }]),
  );
  const right = storedZip(
    sourceDocxEntries("Same wording", [{
      name: "word/styles.xml",
      data: encoder.encode("<styles>right</styles>"),
    }]),
  );
  const request = await sourceUnitRequest(left);
  request.units[0]!.content = "Changed wording";
  await assertRejects(
    () => compileDocxSourceUnitCandidate(right, request),
    WordXmlSourceError,
    "IDENTITY_MISMATCH",
  );
  // A main XML hash is not the whole package identity.
  const projection = await inspectDocxSourceUnits(left);
  await assertRejects(
    () =>
      compileDocxSourceUnitCandidate(left, {
        ...request,
        archiveSha256: projection.manifest.mainPart.source.originalSha256,
      }),
    WordXmlSourceError,
    "IDENTITY_MISMATCH",
  );
});

Deno.test("DOCX archive source units reject partial, reordered, duplicate, unknown and caller-authored maps", async () => {
  const original = storedZip(
    sourceDocxEntries("First</w:t></w:r><w:r><w:t>Second"),
  );
  const request = await sourceUnitRequest(original);
  for (
    const units of [[], request.units.slice(1), [...request.units].reverse(), [{
      nodeId: "t:3",
      content: "Forged",
    }, request.units[1]]]
  ) {
    await assertRejects(
      () => compileDocxSourceUnitCandidate(original, { ...request, units }),
      WordXmlSourceError,
      "IDENTITY_MISMATCH",
    );
  }
  for (
    const value of [
      null,
      [],
      {},
      { ...request, version: "word-xml-units.1" },
      { ...request, archiveSha256: "A".repeat(64) },
      { ...request, units: null },
      { ...request, units: [request.units[0], request.units[0]] },
      { ...request, units: [{ ...request.units[0], paragraphId: "p:2" }] },
      { ...request, units: [{ nodeId: "t:1", content: 42 }] },
      { ...request, main: "caller XML" },
      { ...request, patches: [] },
    ]
  ) {
    await assertRejects(
      () => compileDocxSourceUnitCandidate(original, value),
      WordXmlSourceError,
      "INVALID_PATCH",
    );
  }
});

Deno.test("DOCX archive source units preserve literal wording, exact no-op bytes and deterministic replay", async () => {
  const entries = sourceDocxEntries("Original wording");
  const main = entries[2]!;
  const compressedData = await deflateRaw(main.data!);
  const original = storedZip(
    entries.map((entry) =>
      entry === main ? { ...entry, method: 8, compressedData } : entry
    ),
  );
  const request = await sourceUnitRequest(original);
  const noOp = await compileDocxSourceUnitCandidate(original, request);
  assertEquals(noOp.bytes, original);
  const literal =
    "<b>owner wording</b> & cafe\u0301 📝 [[TED:unchanged literal]]";
  request.units[0]!.content = literal;
  const changed = await compileDocxSourceUnitCandidate(original, request);
  assertEquals(changed.manifest.mainPart.source.nodes[0]!.text, literal);
  assertEquals(
    (await compileDocxSourceUnitCandidate(original, request)).bytes,
    changed.bytes,
  );
  assertEquals(changed.manifest.blockers, noOp.manifest.blockers);
  for (const text of [" padded ", "line\nbreak", "null\0byte"]) {
    await assertRejects(
      () =>
        compileDocxSourceUnitCandidate(original, {
          ...request,
          units: [{ nodeId: "t:1", content: text }],
        }),
      WordXmlSourceError,
    );
  }
});

Deno.test("DOCX archive source units capture source and current wording before asynchronous inspection", async () => {
  const original = storedZip(sourceDocxEntries("Original wording"));
  const immutable = Uint8Array.from(original);
  const request = await sourceUnitRequest(original);
  request.units[0]!.content = "Accepted wording";
  const pending = compileDocxSourceUnitCandidate(original, request);
  original.fill(0);
  request.archiveSha256 = "0".repeat(64);
  request.units[0]!.content = "Late replacement";
  request.units.push({ nodeId: "t:2", content: "Late injection" });
  const result = await pending;
  assertEquals(result.originalArchiveSha256, await sha256(immutable));
  assertEquals(result.manifest.mainPart.source.nodes.map((node) => node.text), [
    "Accepted wording",
  ]);
  const readable = Uint8Array.from(immutable);
  const projection = inspectDocxSourceUnits(readable);
  readable.fill(0);
  assertEquals(
    (await projection).manifest.archiveSha256,
    await sha256(immutable),
  );
  for (
    const inspect of [
      () => inspectDocxSourceUnits(new Uint8Array(new SharedArrayBuffer(8))),
      () =>
        compileDocxSourceUnitCandidate(
          new Uint8Array(new SharedArrayBuffer(8)),
          request,
        ),
    ]
  ) {
    await assertRejects(inspect, UploadExtractionError);
  }
});

Deno.test("DOCX archive source units retain observed blockers and reject changed unmapped structure", async () => {
  for (
    const original of [
      storedZip(sourceDocxEntries("Original</w:t><w:tab/><w:t>wording")),
      storedZip(
        sourceDocxEntries("Original wording", [{
          name: "word/header1.xml",
          data: encoder.encode("<header>retained</header>"),
        }]),
      ),
    ]
  ) {
    const projection = await inspectDocxSourceUnits(original);
    assert(
      projection.blockers.some((blocker) =>
        ["wording_controls_unmapped", "non_main_wording_unmapped"].includes(
          blocker,
        )
      ),
    );
    const request = await sourceUnitRequest(original);
    request.units[0]!.content = "Changed wording";
    await assertRejects(
      () => compileDocxSourceUnitCandidate(original, request),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
  }
});

Deno.test("DOCX archive source units enforce existing unit and aggregate content bounds", async () => {
  const original = storedZip(sourceDocxEntries("Original wording"));
  const request = await sourceUnitRequest(original);
  for (
    const units of [
      [{ nodeId: "t:1", content: "x".repeat(20_001) }],
      Array.from(
        { length: 513 },
        (_, index) => ({ nodeId: `t:${index + 1}`, content: "x" }),
      ),
      Array.from(
        { length: 53 },
        (_, index) => ({
          nodeId: `t:${index + 1}`,
          content: "x".repeat(20_000),
        }),
      ),
    ]
  ) {
    await assertRejects(
      () => compileDocxSourceUnitCandidate(original, { ...request, units }),
      WordXmlSourceError,
      "RESOURCE_LIMIT",
    );
  }
});

Deno.test("DOCX archive source units reject cancellation and invalid deadlines before publishing a candidate", async () => {
  const original = storedZip(sourceDocxEntries("Original wording"));
  const request = await sourceUnitRequest(original);
  request.units[0]!.content = "Changed wording";
  for (
    const work of [
      (signal?: AbortSignal, deadline?: number) =>
        inspectDocxSourceUnits(original, signal, deadline),
      (signal?: AbortSignal, deadline?: number) =>
        compileDocxSourceUnitCandidate(original, request, signal, deadline),
    ]
  ) {
    const pre = new AbortController();
    pre.abort();
    await assertRejects(
      () => work(pre.signal),
      UploadExtractionError,
      "RESOURCE_UNAVAILABLE",
    );
    const mid = new AbortController();
    const pending = work(mid.signal);
    mid.abort();
    await assertRejects(
      () => pending,
      UploadExtractionError,
      "RESOURCE_UNAVAILABLE",
    );
    await assertRejects(
      () => work(undefined, Date.now() - 1),
      UploadExtractionError,
      "RESOURCE_UNAVAILABLE",
    );
    for (const deadline of [NaN, Infinity, -Infinity]) {
      await assertRejects(
        () => work(undefined, deadline),
        WordXmlSourceError,
        "INVALID_PATCH",
      );
    }
  }
  assertEquals(
    (await inspectDocxSourceUnits(original)).manifest.archiveSha256,
    await sha256(original),
  );
});

Deno.test("DOCX archive source units share one deadline and cancellation fence through final candidate inspection", async () => {
  const original = storedZip(sourceDocxEntries("Original wording"));
  const request = await sourceUnitRequest(original);
  request.units[0]!.content = "Longer changed wording";
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, "digest");
  const now = Date.now;
  try {
    for (const failure of ["abort", "deadline"] as const) {
      const controller = new AbortController();
      const started = now();
      let triggered = false;
      Date.now = () => started;
      Object.defineProperty(crypto.subtle, "digest", {
        configurable: true,
        value: async (algorithm: AlgorithmIdentifier, input: BufferSource) => {
          const bytes = ArrayBuffer.isView(input)
            ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            : new Uint8Array(input);
          const result = await digest(algorithm, input);
          if (
            bytes[0] === 0x50 && bytes[1] === 0x4b &&
            bytes.length !== original.length
          ) {
            triggered = true;
            if (failure === "abort") controller.abort();
            else Date.now = () => started + 20_000;
          }
          return result;
        },
      });
      await assertRejects(
        () =>
          compileDocxSourceUnitCandidate(
            original,
            request,
            controller.signal,
            started + 60_000,
          ),
        UploadExtractionError,
        "RESOURCE_UNAVAILABLE",
      );
      assert(
        triggered,
        "Fault must occur while inspecting the generated archive, after projection and patch derivation.",
      );
    }
  } finally {
    Date.now = now;
    if (descriptor) Object.defineProperty(crypto.subtle, "digest", descriptor);
    else Reflect.deleteProperty(crypto.subtle, "digest");
  }
});

Deno.test("DOCX candidate preserves exact ZIP records with compression, reversed directory, gaps, comments and main positions", async (test) => {
  for (const compressed of [false, true]) {
    for (const position of [0, 1, 3]) {
      for (
        const text of [
          "Short",
          "Longer revised wording & <safe> Unicode café 🦘",
        ]
      ) {
        await test.step(`${compressed ? "deflated" : "stored"} main ${position}, ${text.length} chars`, async () => {
          const entries = sourceDocxEntries("Original wording", [{
            name: "word/styles.xml",
            data: encoder.encode("<styles>keep exactly</styles>"),
          }]);
          const [main] = entries.splice(2, 1);
          entries.splice(position, 0, main!);
          const packed: ZipFixtureEntry[] = await Promise.all(
            entries.map(async (entry) => ({
              ...entry,
              method: compressed ? 8 as const : 0 as const,
              compressedData: compressed
                ? await deflateRaw(entry.data!)
                : entry.data,
              comment: encoder.encode("part comment 🦘"),
              gapAfter: encoder.encode("opaque gap retained"),
            })),
          );
          const options = {
            reverseDirectory: true,
            comment: encoder.encode("archive comment"),
          };
          const original = storedZip(packed, options);
          const request = await candidateRequest(original, text);
          const result = await compileDocxSourceCandidate(original, request);
          const changedXml = new TextDecoder().decode(main!.data).replace(
            "Original wording",
            text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
              ">",
              "&gt;",
            ),
          );
          const expected = storedZip(
            packed.map((entry) =>
              entry.name === "word/document.xml"
                ? {
                  ...entry,
                  data: encoder.encode(changedXml),
                  compressedData: encoder.encode(changedXml),
                  method: 0,
                }
                : entry
            ),
            options,
          );
          // Independent fixture producer proves every byte, including untouched
          // local records and only the permitted central-header changes.
          assertEquals(result.bytes, expected);
          assertEquals(
            (await compileDocxSourceCandidate(original, request)).bytes,
            result.bytes,
          );
          assertEquals(result.manifest.archiveSha256, await sha256(expected));
          assertEquals(await sha256(original), request.archiveSha256);
        });
      }
    }
  }
});

Deno.test("DOCX candidate no-op preserves compressed original, entity spelling and archive metadata exactly", async () => {
  const entries = await Promise.all(
    sourceDocxEntries("Original &#119;ording").map(async (entry) => ({
      ...entry,
      method: 8 as const,
      compressedData: await deflateRaw(entry.data!),
    })),
  );
  const bytes = storedZip(entries, {
    comment: encoder.encode("unchanged comment"),
  });
  for (
    const patches of [[], [{
      nodeId: "t:1",
      expectedText: "Original wording",
      text: "Original wording",
    }]]
  ) {
    const result = await compileDocxSourceCandidate(bytes, {
      ...await candidateRequest(bytes),
      patches,
    });
    assertEquals(result.bytes, bytes);
    assert(result.bytes !== bytes);
    assertEquals(result.manifest.archiveSha256, result.originalArchiveSha256);
  }
});

Deno.test("DOCX candidate owns original bytes and nested patches before asynchronous inspection", async () => {
  const bytes = storedZip(sourceDocxEntries("Original wording"));
  const request = await candidateRequest(bytes);
  const expectedHash = request.archiveSha256;
  const pending = compileDocxSourceCandidate(bytes, request);
  bytes.fill(0);
  request.archiveSha256 = "f".repeat(64);
  request.patches[0]!.text = "Late overwrite";
  request.patches.push({
    nodeId: "t:2",
    expectedText: "invented",
    text: "injected",
  });
  const result = await pending;
  assertEquals(result.originalArchiveSha256, expectedHash);
  assertEquals(result.manifest.mainPart.source.nodes.map((node) => node.text), [
    "Changed wording",
  ]);
});

Deno.test("DOCX candidate rejects archive, node and wording identity mismatches including no-op", async () => {
  const bytes = storedZip(sourceDocxEntries("Original wording"));
  const valid = await candidateRequest(bytes);
  for (
    const request of [
      { ...valid, archiveSha256: "0".repeat(64) },
      { ...valid, archiveSha256: "0".repeat(64), patches: [] },
      { ...valid, patches: [{ ...valid.patches[0], nodeId: "t:2" }] },
      { ...valid, patches: [{ ...valid.patches[0], expectedText: "stale" }] },
    ]
  ) {
    await assertRejects(
      () => compileDocxSourceCandidate(bytes, request),
      WordXmlSourceError,
      "IDENTITY_MISMATCH",
    );
  }
});

Deno.test("DOCX candidate rejects malformed or oversized patch contracts without widening XML authority", async () => {
  const bytes = storedZip(sourceDocxEntries("Original wording"));
  const valid = await candidateRequest(bytes);
  for (
    const request of [
      null,
      [],
      {},
      { ...valid, version: "unknown" },
      { ...valid, offset: 10 },
      { ...valid, patches: [valid.patches[0], valid.patches[0]] },
      { ...valid, patches: [{ ...valid.patches[0], offset: 4 }] },
      { ...valid, patches: [{ ...valid.patches[0], text: 42 }] },
    ]
  ) {
    await assertRejects(
      () => compileDocxSourceCandidate(bytes, request),
      WordXmlSourceError,
      "INVALID_PATCH",
    );
  }
  for (
    const text of ["", " leading", "trailing ", "line\nbreak", "tab\tbreak"]
  ) {
    await assertRejects(
      () =>
        compileDocxSourceCandidate(bytes, {
          ...valid,
          patches: [{ ...valid.patches[0], text }],
        }),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
  }
  await assertRejects(
    () =>
      compileDocxSourceCandidate(bytes, {
        ...valid,
        patches: [{ ...valid.patches[0], text: "a".repeat(65_537) }],
      }),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
});

Deno.test("DOCX candidate preserves styled XML slices and sibling nodes; provider-looking XML stays text", async () => {
  const entries = sourceDocxEntries(
    "Original wording</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Bold sibling",
  );
  const main = entries[2]!;
  const bytes = storedZip(entries);
  const text = "</w:t><w:r><w:t>injection & other text";
  const result = await compileDocxSourceCandidate(
    bytes,
    await candidateRequest(bytes, text),
  );
  assertEquals(result.manifest.mainPart.source.nodes.map((node) => node.text), [
    text,
    "Bold sibling",
  ]);
  const expected = encoder.encode(
    new TextDecoder().decode(main.data).replace(
      "Original wording",
      "&lt;/w:t&gt;&lt;w:r&gt;&lt;w:t&gt;injection &amp; other text",
    ),
  );
  assertEquals(
    result.bytes,
    storedZip(
      entries.map((entry) =>
        entry === main ? { ...entry, data: expected } : entry
      ),
    ),
  );
});

Deno.test("DOCX candidate rejects observed signatures, non-main wording and dynamic XML even for no-op", async () => {
  const fixtures = [
    sourceDocxEntries("Original wording", [{
      name: "_xmlsignatures/sig1.xml",
      data: encoder.encode("<Signature/>"),
    }]),
    sourceDocxEntries("Original wording", [{
      name: "word/header1.xml",
      data: encoder.encode("<header/>"),
    }]),
    sourceDocxEntries(
      'Original wording</w:t><w:fldChar w:fldCharType="begin"/><w:t>Field',
    ),
  ];
  for (const entries of fixtures) {
    const bytes = storedZip(entries);
    const archiveSha256 = await sha256(bytes);
    for (
      const patches of [[], [{
        nodeId: "t:1",
        expectedText: "Original wording",
        text: "Changed",
      }]]
    ) {
      await assertRejects(
        () =>
          compileDocxSourceCandidate(bytes, {
            version: DOCX_SOURCE_CANDIDATE_VERSION,
            archiveSha256,
            patches,
          }),
        WordXmlSourceError,
        "UNSUPPORTED_EDIT",
      );
    }
  }
});

Deno.test("DOCX candidate applies multiple exact nodes in source order regardless of request order", async () => {
  const entries = sourceDocxEntries(
    "Original wording</w:t></w:r><w:r><w:t>Sibling wording",
  );
  const bytes = storedZip(entries);
  const result = await compileDocxSourceCandidate(bytes, {
    ...await candidateRequest(bytes),
    patches: [
      {
        nodeId: "t:2",
        expectedText: "Sibling wording",
        text: "Second revised",
      },
      { nodeId: "t:1", expectedText: "Original wording", text: "First" },
    ],
  });
  assertEquals(result.manifest.mainPart.source.nodes.map((node) => node.text), [
    "First",
    "Second revised",
  ]);
  const expected = entries.map((entry) =>
    entry.name === "word/document.xml"
      ? {
        ...entry,
        data: encoder.encode(
          new TextDecoder().decode(entry.data).replace(
            "Original wording",
            "First",
          ).replace("Sibling wording", "Second revised"),
        ),
      }
      : entry
  );
  assertEquals(result.bytes, storedZip(expected));
});

Deno.test("DOCX candidate rejects opaque local or central extras only when rebuilding; source admission and exact no-op survive", async () => {
  for (const key of ["localExtra", "centralExtra"] as const) {
    for (const index of [1, 2]) {
      const entries: ZipFixtureEntry[] = sourceDocxEntries("Original wording");
      entries[index] = {
        ...entries[index]!,
        [key]: new Uint8Array([0x99, 0x99, 0, 0]),
      };
      const bytes = storedZip(entries);
      await inspectDocxSource(bytes, "source.docx", "");
      const request = await candidateRequest(bytes);
      await assertRejects(
        () => compileDocxSourceCandidate(bytes, request),
        WordXmlSourceError,
        "UNSUPPORTED_EDIT",
      );
      assertEquals(
        (await compileDocxSourceCandidate(bytes, { ...request, patches: [] }))
          .bytes,
        bytes,
      );
    }
  }
});

Deno.test("DOCX candidate validates corrupt unselected parts and rejects before any result", async () => {
  const bytes = storedZip(
    sourceDocxEntries("Original wording", [{
      name: "word/styles.xml",
      data: encoder.encode("untouched style data"),
    }]),
  );
  bytes[indexOfBytes(bytes, encoder.encode("untouched style data"))] ^= 1;
  const request = await candidateRequest(bytes);
  await assertRejects(
    () => compileDocxSourceCandidate(bytes, request),
    UploadExtractionError,
    "UPLOAD_ARCHIVE",
  );
});

Deno.test("DOCX candidate honours pre-abort, in-flight abort and finite cumulative deadline", async () => {
  const bytes = storedZip(sourceDocxEntries("Original wording"));
  const request = await candidateRequest(bytes);
  for (const noOp of [false, true]) {
    const accepted = noOp ? { ...request, patches: [] } : request;
    const pre = new AbortController();
    pre.abort();
    await assertRejects(
      () => compileDocxSourceCandidate(bytes, accepted, pre.signal),
      UploadExtractionError,
      "RESOURCE_UNAVAILABLE",
    );
    const mid = new AbortController();
    const pending = compileDocxSourceCandidate(bytes, accepted, mid.signal);
    mid.abort();
    await assertRejects(
      () => pending,
      UploadExtractionError,
      "RESOURCE_UNAVAILABLE",
    );
  }
  await assertRejects(
    () => compileDocxSourceCandidate(bytes, request, undefined, Date.now() - 1),
    UploadExtractionError,
    "RESOURCE_UNAVAILABLE",
  );
  for (const deadline of [NaN, Infinity, -Infinity]) {
    await assertRejects(
      () => compileDocxSourceCandidate(bytes, request, undefined, deadline),
      WordXmlSourceError,
      "INVALID_PATCH",
    );
  }
});

Deno.test("DOCX candidate enforces the final stored archive byte limit before allocation", async () => {
  const mainEntries = sourceDocxEntries("Original wording");
  const main = mainEntries[2]!;
  const compressedData = await deflateRaw(main.data!);
  const text =
    "A longer replacement that increases the complete stored archive size";
  const changedLength = main.data!.length + text.length -
    "Original wording".length;
  const delta = changedLength - compressedData.length;
  const entries: ZipFixtureEntry[] = mainEntries.map((entry) =>
    entry === main ? { ...entry, method: 8, compressedData } : entry
  );
  entries.push({ name: "word/media/retained.dat", data: new Uint8Array() });
  const overhead = storedZip(entries).length;
  for (const excess of [0, 1]) {
    entries[3] = {
      ...entries[3]!,
      data: new Uint8Array(MAX_UPLOAD_BYTES - overhead - delta + excess),
    };
    const original = storedZip(entries);
    assert(original.length < MAX_UPLOAD_BYTES);
    const request = await candidateRequest(original, text);
    if (excess === 0) {
      const result = await compileDocxSourceCandidate(original, request);
      assertEquals(result.bytes.length, MAX_UPLOAD_BYTES);
    } else {
      await assertRejects(
        () => compileDocxSourceCandidate(original, request),
        WordXmlSourceError,
        "RESOURCE_LIMIT",
      );
    }
  }
});

Deno.test("DOCX candidate cancels during final candidate inspection and last no-op assessment", async () => {
  const entries = sourceDocxEntries("Original wording");
  const original = storedZip(entries);
  const request = await candidateRequest(
    original,
    "Longer replacement wording",
  );
  const mainLength = entries[2]!.data!.length;
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, "digest");
  try {
    for (const noOp of [false, true]) {
      const controller = new AbortController();
      let sawArchive = false;
      let triggered = false;
      Object.defineProperty(crypto.subtle, "digest", {
        configurable: true,
        value: async (algorithm: AlgorithmIdentifier, input: BufferSource) => {
          const bytes = ArrayBuffer.isView(input)
            ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            : new Uint8Array(input);
          const isArchive = bytes[0] === 0x50 && bytes[1] === 0x4b;
          const cancel = noOp
            ? sawArchive && bytes.length === mainLength
            : isArchive && bytes.length !== original.length;
          if (isArchive) sawArchive = true;
          const result = await digest(algorithm, input);
          if (cancel) {
            triggered = true;
            controller.abort();
          }
          return result;
        },
      });
      await assertRejects(
        () =>
          compileDocxSourceCandidate(
            original,
            noOp ? { ...request, patches: [] } : request,
            controller.signal,
          ),
        UploadExtractionError,
        "RESOURCE_UNAVAILABLE",
      );
      assert(
        triggered,
        "Cancellation must occur at the intended final assessment boundary",
      );
    }
  } finally {
    if (descriptor) Object.defineProperty(crypto.subtle, "digest", descriptor);
    else Reflect.deleteProperty(crypto.subtle, "digest");
  }
});

Deno.test("combined extraction retains wording and source from exactly one archive inspection", async () => {
  const extract = Reflect.get(
    uploadExtraction,
    "extractBoundedUploadWithSource",
  );
  assert(
    typeof extract === "function",
    "Combined source extraction is missing",
  );
  const entries = await Promise.all(
    sourceDocxEntries("Body wording", [
      {
        name: "word/styles.xml",
        data: encoder.encode('<styles><font name="Arial"/></styles>'),
      },
      {
        name: "word/_rels/document.xml.rels",
        data: encoder.encode(
          '<Relationships><Relationship Id="h1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>',
        ),
      },
      {
        name: "word/header1.xml",
        data: encoder.encode(
          '<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>Header wording</w:t></w:r></w:p></w:hdr>',
        ),
      },
    ]).map(async (entry) => ({
      ...entry,
      method: 8 as const,
      compressedData: await deflateRaw(entry.data!),
    })),
  );
  const bytes = storedZip(entries);
  const legacy = await extractBoundedUploadText(bytes, "source.docx", "");
  assert(legacy.text.includes("Header wording"));
  assertEquals(Object.keys(legacy).sort(), [
    "format",
    "resourcePolicyVersion",
    "text",
    "truncated",
  ]);
  const manifest = await inspectDocxSource(bytes, "source.docx", "");
  const NativeDecompressionStream = globalThis.DecompressionStream;
  let decompressions = 0;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format: CompressionFormat) {
      super(format);
      decompressions += 1;
    }
  };
  try {
    const combined = await extract(bytes, "source.docx", "");
    assert(combined.format === "docx");
    assertEquals(combined, {
      ...legacy,
      format: "docx",
      sourceManifest: manifest,
    });
    assertEquals(decompressions, entries.length);
    assertEquals(
      combined.sourceManifest.mainPart.source.nodes.map((
        node: { text: string },
      ) => node.text),
      ["Body wording"],
    );
    assert(
      combined.sourceManifest.blockers.includes("non_main_wording_unmapped"),
    );
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
});

Deno.test("combined extraction owns one original for text and manifest across caller mutation", async () => {
  const bytes = storedZip(sourceDocxEntries("Original wording"));
  const original = Uint8Array.from(bytes);
  const pending = extractBoundedUploadWithSource(bytes, "source.docx", "");
  bytes.fill(0);
  const result = await pending;
  assert(result.format === "docx");
  assertEquals(result.text, "Original wording");
  assertEquals(result.sourceManifest.archiveSha256, await sha256(original));
  assertEquals(
    result.sourceManifest.mainPart.source.nodes[0]?.text,
    "Original wording",
  );
  assert(Object.isFrozen(result));
  const pristine = Uint8Array.from(original);
  await extractBoundedUploadWithSource(pristine, "source.docx", "");
  assertEquals(pristine, original);
});

Deno.test("combined extraction keeps explicit source absence for PDF XLSX TXT MD and CSV", async () => {
  for (
    const fixture of [
      {
        bytes: minimalPdf("PDF original"),
        filename: "source.pdf",
        mime: "application/pdf",
      },
      { bytes: minimalXlsx(), filename: "source.xlsx", mime: "" },
      {
        bytes: encoder.encode("TextEdit plain text 😀"),
        filename: "source.txt",
        mime: "text/plain",
      },
      {
        bytes: encoder.encode("# Heading\n\n**Markdown**"),
        filename: "source.md",
        mime: "text/markdown",
      },
      {
        bytes: encoder.encode("Name,Value\nExample,1"),
        filename: "source.csv",
        mime: "text/csv",
      },
    ]
  ) {
    const original = Uint8Array.from(fixture.bytes);
    const legacy = await extractBoundedUploadText(
      fixture.bytes,
      fixture.filename,
      fixture.mime,
    );
    const result = await extractBoundedUploadWithSource(
      fixture.bytes,
      fixture.filename,
      fixture.mime,
    );
    assert(result.format !== "docx");
    assertEquals(result, {
      ...legacy,
      format: result.format,
      sourceManifest: null,
    });
    assertEquals(fixture.bytes, original);
  }
});

Deno.test("combined extraction cannot return successful text when required source mapping fails", async () => {
  for (
    const fixture of [
      {
        bytes: minimalDocx("Legacy readable but unsupported source namespace"),
        code: "UPLOAD_DOCX_SOURCE_INVALID",
      },
      {
        bytes: storedZip(
          sourceDocxEntries(
            "é".repeat(DOCX_SOURCE_POLICY.maxManifestBytes / 2),
          ),
        ),
        code: "UPLOAD_DOCX_SOURCE_LIMIT",
      },
    ]
  ) {
    const legacy = await extractBoundedUploadText(
      fixture.bytes,
      "source.docx",
      "",
    );
    assert(legacy.text.length > 0);
    await assertRejects(
      () => extractBoundedUploadWithSource(fixture.bytes, "source.docx", ""),
      UploadExtractionError,
      fixture.code,
    );
  }
});

Deno.test("combined extraction preserves one cumulative deadline across text and source stages", async () => {
  const bytes = storedZip(sourceDocxEntries("Keep exact source"));
  const nativeDigest = crypto.subtle.digest;
  const nativeNow = Date.now;
  let now = 1_000;
  let digests = 0;
  Date.now = () => now;
  crypto.subtle.digest = async function (algorithm, data) {
    const result = await nativeDigest.call(this, algorithm, data);
    digests += 1;
    if (digests === 1) now += 15_000;
    // Three part hashes, roster, archive, then the Word source hash.
    if (digests === 6) now += 6_000;
    return result;
  };
  try {
    const error = await assertRejects(
      () => extractBoundedUploadWithSource(bytes, "source.docx", ""),
      UploadExtractionError,
      "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
    );
    assertEquals(digests, 6);
    assertEquals(error.retryable, true);
  } finally {
    crypto.subtle.digest = nativeDigest;
    Date.now = nativeNow;
  }
});

Deno.test("combined extraction cancels an unfinished compressed read and allows a fresh retry", async () => {
  const entries = sourceDocxEntries("Retry the same original");
  entries[0]!.method = 8;
  entries[0]!.compressedData = await deflateRaw(entries[0]!.data!);
  const bytes = storedZip(entries);
  const original = Uint8Array.from(bytes);
  const controller = new AbortController();
  const NativeDecompressionStream = globalThis.DecompressionStream;
  let cancelled = 0;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format: CompressionFormat) {
      super(format);
      const reader = this.readable.getReader();
      Object.defineProperty(this, "readable", {
        value: new ReadableStream<Uint8Array>({
          async pull(output) {
            const next = await reader.read();
            if (next.done) {
              output.close();
              reader.releaseLock();
            } else {
              output.enqueue(next.value);
              controller.abort();
            }
          },
          async cancel(reason) {
            cancelled += 1;
            try {
              await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          },
        }, { highWaterMark: 0 }),
      });
    }
  };
  try {
    await assertRejects(
      () =>
        extractBoundedUploadWithSource(
          bytes,
          "source.docx",
          "",
          controller.signal,
        ),
      UploadExtractionError,
      "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
    );
    assertEquals(cancelled, 1);
    assertEquals(bytes, original);
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
  const retry = await extractBoundedUploadWithSource(bytes, "source.docx", "");
  assertEquals(retry.text, "Retry the same original");
  assert(retry.format === "docx");
  assertEquals(retry.sourceManifest.archiveSha256, await sha256(original));
});

async function sha256(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function minimalXlsx(): Uint8Array {
  return storedZip([
    { name: "[Content_Types].xml", data: encoder.encode(XLSX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(rootRelationships("xl/workbook.xml")),
    },
    {
      name: "xl/workbook.xml",
      data: encoder.encode(
        '<workbook xmlns:r="urn:r"><sheets>' +
          '<sheet name="Visible" sheetId="1" r:id="rId1"/>' +
          '<sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/>' +
          "</sheets></workbook>",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(
        '<Relationships xmlns="urn:r">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: encoder.encode(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Visible value</t></is></c></row></sheetData></worksheet>',
      ),
    },
    {
      name: "xl/worksheets/sheet2.xml",
      data: encoder.encode(
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>HIDDEN SENTINEL</t></is></c></row></sheetData></worksheet>',
      ),
    },
  ]);
}

function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(pdf);
}

Deno.test("upload format identity is content-led and rejects conflicting metadata", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nsynthetic");
  assertEquals(
    await resolveUploadFormat(pdf, "source.pdf", "application/pdf"),
    "pdf",
  );
  await assertRejects(
    () => resolveUploadFormat(pdf, "source.docx", "application/pdf"),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
  await assertRejects(
    () => resolveUploadFormat(pdf, "source", "application/pdf"),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );

  const legacyOle = Uint8Array.from([
    0xd0,
    0xcf,
    0x11,
    0xe0,
    0xa1,
    0xb1,
    0x1a,
    0xe1,
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(legacyOle, "legacy.xls", "application/vnd.ms-excel"),
    UploadExtractionError,
    "UPLOAD_LEGACY_FORMAT_UNSUPPORTED",
  );

  assertEquals(
    await resolveUploadFormat(
      encoder.encode("name,value\nTED,reliable"),
      "source.csv",
      "application/vnd.ms-excel",
    ),
    "text",
  );
  assertEquals(
    await resolveUploadFormat(
      encoder.encode("# Reliable"),
      "source.md",
      "application/markdown",
    ),
    "text",
  );
  await assertRejects(
    () =>
      resolveUploadFormat(
        encoder.encode("not a spreadsheet"),
        "source.txt",
        "application/vnd.ms-excel",
      ),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
  await assertRejects(
    () =>
      resolveUploadFormat(
        encoder.encode("extension required"),
        "source",
        "text/plain",
      ),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
});

Deno.test("Office archives are classified only after bounded entry inspection", async () => {
  const docx = minimalDocx();
  assertEquals(
    await resolveUploadFormat(
      docx,
      "letter.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "docx",
  );

  const traversal = storedZip([
    { name: "[Content_Types].xml" },
    { name: "word/document.xml" },
    { name: "../escape.xml" },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(traversal, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_PATH_INVALID",
  );

  const macro = storedZip([
    { name: "[Content_Types].xml" },
    { name: "xl/workbook.xml" },
    { name: "xl/vbaProject.bin" },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(macro, "workbook.xlsx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ACTIVE_CONTENT_UNSUPPORTED",
  );
});

Deno.test("DOCX and XLSX extraction follows only package-reachable visible content", async () => {
  const docx = minimalDocx("Reachable text", [
    {
      name: "word/header1.xml",
      data: encoder.encode(
        '<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>UNREFERENCED HEADER</w:t></w:r></w:p></w:hdr>',
      ),
    },
  ]);
  const docxResult = await extractBoundedUploadText(
    docx,
    "letter.docx",
    "application/zip",
  );
  assertEquals(docxResult.format, "docx");
  assert(docxResult.text.includes("Reachable text"));
  assertEquals(docxResult.text.includes("UNREFERENCED HEADER"), false);

  const xlsxResult = await extractBoundedUploadText(
    minimalXlsx(),
    "workbook.xlsx",
    "application/x-zip-compressed",
  );
  assertEquals(xlsxResult.format, "xlsx");
  assert(xlsxResult.text.includes("Visible value"));
  assertEquals(xlsxResult.text.includes("HIDDEN SENTINEL"), false);
});

Deno.test("deflated Office entries verify CRC while enforcing the declared streaming ceiling", async () => {
  const entries = await Promise.all(
    docxEntries("Deflated reliable text").map(
      async (entry): Promise<ZipFixtureEntry> => {
        const data = entry.data ?? new Uint8Array();
        return {
          ...entry,
          method: 8,
          compressedData: await deflateRaw(data),
        };
      },
    ),
  );
  const result = await extractBoundedUploadText(
    storedZip(entries),
    "letter.docx",
    "application/octet-stream",
  );
  assert(result.text.includes("Deflated reliable text"));

  const expanded = encoder.encode("A".repeat(100_000));
  const expansionBomb = storedZip([
    ...docxEntries().slice(0, 2),
    {
      name: "word/document.xml",
      data: expanded,
      compressedData: await deflateRaw(expanded),
      method: 8,
      declaredUncompressedSize: 100,
    },
  ]);
  const failure = await assertRejects(
    () =>
      resolveUploadFormat(
        expansionBomb,
        "letter.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
  assertEquals(failure.status, 413);
});

Deno.test("Office archive CRC, canonical names, entities, and external relationships fail closed", async () => {
  const damaged = minimalDocx();
  const textOffset = indexOfBytes(
    damaged,
    encoder.encode("Reliable document text"),
  );
  assert(textOffset >= 0);
  damaged[textOffset] ^= 0x01;
  await assertRejects(
    () =>
      resolveUploadFormat(damaged, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_CRC_INVALID",
  );

  const duplicate = storedZip([
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(rootRelationships("word/document.xml")),
    },
    { name: "word/document.xml", data: encoder.encode("<x/>") },
    { name: "WORD/DOCUMENT.XML", data: encoder.encode("<x/>") },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(duplicate, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_DUPLICATE_PATH",
  );

  const invalidEntity = minimalDocx("&#x110000;");
  await assertRejects(
    () =>
      extractBoundedUploadText(
        invalidEntity,
        "letter.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_OFFICE_XML_INVALID",
  );

  const external = storedZip([
    { name: "[Content_Types].xml", data: encoder.encode(DOCX_CONTENT_TYPES) },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://example.invalid/document.xml" TargetMode="External"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      data: encoder.encode('<w:document xmlns:w="urn:w"/>'),
    },
  ]);
  await assertRejects(
    () =>
      resolveUploadFormat(external, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_OFFICE_EXTERNAL_RELATIONSHIP_UNSUPPORTED",
  );
});

Deno.test("declared or actual archive expansion cannot exceed the resource policy", async () => {
  const oversized = storedZip([
    { name: "[Content_Types].xml" },
    {
      name: "word/document.xml",
      declaredUncompressedSize: 32 * 1024 * 1024,
    },
  ]);
  const error = await assertRejects(
    () =>
      resolveUploadFormat(oversized, "letter.docx", "application/octet-stream"),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
  assertEquals(error.status, 413);
  assertEquals(error.code, "UPLOAD_ARCHIVE_EXPANSION_LIMIT");
});

Deno.test("plain-text parsing is fatal UTF-8, byte bounded, and output bounded", async () => {
  const text = new TextEncoder().encode("Reliable text\n".repeat(3_000));
  const result = await extractBoundedUploadText(
    text,
    "notes.txt",
    "text/plain",
  );
  assertEquals(result.format, "text");
  assertEquals(result.resourcePolicyVersion, UPLOAD_RESOURCE_POLICY_VERSION);
  assert(result.text.length <= 20_000);
  assert(result.truncated);

  const oversized = new Uint8Array(MAX_TEXT_UPLOAD_BYTES + 1).fill(0x61);
  const error = await assertRejects(
    () => extractBoundedUploadText(oversized, "notes.txt", "text/plain"),
    UploadExtractionError,
    "UPLOAD_TEXT_RESOURCE_LIMIT",
  );
  assertEquals(error.status, 413);
});

Deno.test("DOCX text bounds preserve complete supplementary characters after source-reader truncation", async () => {
  for (const length of [19_999, 20_000]) {
    const prefix = "A".repeat(length);
    const result = await extractBoundedUploadText(
      minimalDocx(`${prefix}😀Z`),
      "source.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    assertEquals(result.text, prefix);
    assertEquals(result.truncated, true);
  }
});

Deno.test("PDF extraction source is sequential and has no eager all-pages fan-out", async () => {
  const source = await Deno.readTextFile(
    new URL("./upload-extraction.ts", import.meta.url),
  );
  assert(
    source.includes(
      "for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1)",
    ),
  );
  assert(!source.includes("Promise.all"));
});

Deno.test("PDF extraction is behavioral, bounded, and maps malformed input deterministically", async () => {
  const result = await extractBoundedUploadText(
    minimalPdf("Reliable PDF text"),
    "source.pdf",
    "application/pdf",
  );
  assertEquals(result.format, "pdf");
  assert(result.text.includes("Reliable PDF text"));

  const malformed = await assertRejects(
    () =>
      extractBoundedUploadText(
        encoder.encode("%PDF-1.7\nnot a valid PDF"),
        "source.pdf",
        "application/pdf",
      ),
    UploadExtractionError,
  );
  assertEquals(malformed.status, 422);
  assertEquals(malformed.code, "UPLOAD_PDF_INVALID");

  const controller = new AbortController();
  controller.abort();
  const cancelled = await assertRejects(
    () =>
      extractBoundedUploadText(
        minimalPdf("cancelled"),
        "source.pdf",
        "application/pdf",
        controller.signal,
      ),
    UploadExtractionError,
  );
  assertEquals(cancelled.status, 503);
  assertEquals(cancelled.retryable, true);
});

Deno.test("the ingest function source closure excludes the heavy parser", async () => {
  const root = new URL("../ingest-upload/index.ts", import.meta.url);
  const visited = new Set<string>();
  const visit = async (url: URL): Promise<string> => {
    if (visited.has(url.href)) return "";
    visited.add(url.href);
    const source = await Deno.readTextFile(url);
    let closure = `\n// ${url.pathname}\n${source}`;
    for (
      const match of source.matchAll(
        /(?:from\s+|import\s*\()?["'](\.\.?\/[^"']+)["']/g,
      )
    ) {
      const child = new URL(match[1], url);
      if (child.pathname.endsWith(".ts")) closure += await visit(child);
    }
    return closure;
  };
  const closure = await visit(root);
  assertEquals(closure.includes("npm:unpdf"), false);
  assertEquals(
    Array.from(visited).some((href) => href.endsWith("/upload-extraction.ts")),
    false,
  );
});

Deno.test("Office extraction rejects a changed archive after an earlier successful inspection", async () => {
  const bytes = minimalDocx("Original");
  assertEquals(
    await resolveUploadFormat(bytes, "source.docx", "application/octet-stream"),
    "docx",
  );
  const textOffset = indexOfBytes(bytes, encoder.encode("Original"));
  assert(textOffset >= 0);
  bytes[textOffset] = "X".charCodeAt(0); // Keep old CRC so the changed package is invalid.
  await assertRejects(
    () =>
      extractBoundedUploadText(
        bytes,
        "source.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_CRC_INVALID",
  );
});

Deno.test("Office extraction never replays text from a different archive in the same buffer", async () => {
  const bytes = minimalDocx("Original");
  const replacement = minimalDocx("Replaced");
  assertEquals(bytes.length, replacement.length);
  await resolveUploadFormat(bytes, "source.docx", "application/octet-stream");
  bytes.set(replacement);
  const result = await extractBoundedUploadText(
    bytes,
    "source.docx",
    "application/octet-stream",
  );
  assertEquals(result.text, "Replaced");
});

Deno.test("text extraction owns its accepted bytes before the asynchronous continuation", async () => {
  const bytes = encoder.encode("Before");
  const result = extractBoundedUploadText(bytes, "source.txt", "text/plain");
  bytes.set(encoder.encode("After!"));
  assertEquals((await result).text, "Before");
});

Deno.test("PDF extraction preserves caller-owned original bytes after parser cleanup", async () => {
  const bytes = minimalPdf("Preserve original bytes");
  const before = Uint8Array.from(bytes);
  const result = await extractBoundedUploadText(
    bytes,
    "source.pdf",
    "application/pdf",
  );
  assert(result.text.includes("Preserve original bytes"));
  assertEquals(bytes, before);
});

Deno.test("public upload readers reject cancellation across their asynchronous continuation", async () => {
  for (const operation of ["classify Office", "extract text"]) {
    const controller = new AbortController();
    const pending = operation === "classify Office"
      ? resolveUploadFormat(
        minimalDocx(),
        "source.docx",
        "application/octet-stream",
        controller.signal,
      )
      : extractBoundedUploadText(
        encoder.encode("A"),
        "source.txt",
        "text/plain",
        controller.signal,
      );
    controller.abort();
    await assertRejects(
      () => pending,
      UploadExtractionError,
      "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
    );
  }
});

async function docxWithDeflatedFirstEntry(body: string): Promise<Uint8Array> {
  const entries = docxEntries(body);
  const first = entries[0]!;
  first.method = 8;
  first.compressedData = await deflateRaw(first.data!);
  return storedZip(entries);
}

Deno.test("a cancelled Office inspection cannot poison a later read of the same caller buffer", async () => {
  const bytes = await docxWithDeflatedFirstEntry("Retry works");
  const firstController = new AbortController();
  const first = resolveUploadFormat(
    bytes,
    "source.docx",
    "application/octet-stream",
    firstController.signal,
  );
  firstController.abort();
  await assertRejects(
    () => first,
    UploadExtractionError,
    "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
  );
  const result = await extractBoundedUploadText(
    bytes,
    "source.docx",
    "application/octet-stream",
    new AbortController().signal,
  );
  assertEquals(result.text, "Retry works");
});

Deno.test("Office inspection owns later entry bytes while an earlier entry decompresses", async () => {
  const bytes = await docxWithDeflatedFirstEntry("Original");
  const replacement = await docxWithDeflatedFirstEntry("Replaced");
  assertEquals(bytes.length, replacement.length);
  const pending = extractBoundedUploadText(
    bytes,
    "source.docx",
    "application/octet-stream",
  );
  bytes.set(replacement);
  assertEquals((await pending).text, "Original");
});

Deno.test("one extraction reuses its own Office inspection without decompressing twice", async () => {
  const bytes = await docxWithDeflatedFirstEntry("Inspect once");
  const NativeDecompressionStream = globalThis.DecompressionStream;
  let decompressions = 0;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format: CompressionFormat) {
      super(format);
      decompressions += 1;
    }
  };
  try {
    assertEquals(
      (await extractBoundedUploadText(
        bytes,
        "source.docx",
        "application/octet-stream",
      )).text,
      "Inspect once",
    );
    assertEquals(decompressions, 1);
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
});

Deno.test("public extraction rejects shared buffers before accepting a racy source snapshot", async () => {
  const bytes = new Uint8Array(new SharedArrayBuffer(4));
  bytes.set(encoder.encode("Text"));
  await assertRejects(
    () => extractBoundedUploadText(bytes, "source.txt", "text/plain"),
    UploadExtractionError,
    "UPLOAD_BUFFER_UNSUPPORTED",
  );
  await assertRejects(
    () => resolveUploadFormat(bytes, "source.txt", "text/plain"),
    UploadExtractionError,
    "UPLOAD_BUFFER_UNSUPPORTED",
  );
});

Deno.test("Office inspection validates CRC of stored style parts excluded from text extraction", async () => {
  const style = encoder.encode("<styles>STYLE SENTINEL</styles>");
  const bytes = minimalDocx("Good wording", [{
    name: "word/styles.xml",
    data: style,
  }]);
  const offset = indexOfBytes(bytes, encoder.encode("STYLE SENTINEL"));
  assert(offset >= 0);
  bytes[offset] = "X".charCodeAt(0);
  await assertRejects(
    () =>
      extractBoundedUploadText(
        bytes,
        "source.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_CRC_INVALID",
  );
});

Deno.test("Office inspection validates CRC of deflated parts excluded from text extraction", async () => {
  const original = encoder.encode("Original style data");
  const changed = encoder.encode("Modified style data");
  assertEquals(original.length, changed.length);
  const bytes = minimalDocx("Good wording", [{
    name: "word/styles.xml",
    data: original,
    method: 8,
    compressedData: await deflateRaw(changed),
  }]);
  await assertRejects(
    () =>
      extractBoundedUploadText(
        bytes,
        "source.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_CRC_INVALID",
  );
});

Deno.test("unretained Office parts cannot hide actual expansion behind small declared sizes", async () => {
  const data = encoder.encode("Style".repeat(20_000));
  const bytes = minimalDocx("Good wording", [{
    name: "word/styles.xml",
    data,
    method: 8,
    compressedData: await deflateRaw(data),
    declaredUncompressedSize: 100,
  }]);
  await assertRejects(
    () =>
      extractBoundedUploadText(
        bytes,
        "source.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
});

Deno.test("valid preserved Office style parts are inspected once and never appended as document wording", async () => {
  const data = encoder.encode("<styles>NOT DOCUMENT WORDING</styles>");
  const bytes = minimalDocx("Good wording", [{
    name: "word/styles.xml",
    data,
    method: 8,
    compressedData: await deflateRaw(data),
  }]);
  const NativeDecompressionStream = globalThis.DecompressionStream;
  let decompressions = 0;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format: CompressionFormat) {
      super(format);
      decompressions += 1;
    }
  };
  try {
    const result = await extractBoundedUploadText(
      bytes,
      "source.docx",
      "application/octet-stream",
    );
    assertEquals(result.text, "Good wording");
    assertEquals(decompressions, 1);
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
});

Deno.test("all Office parts share the exact aggregate expansion ceiling", async () => {
  const entries = docxEntries("Keep wording");
  const maximum = 16 * 1024 * 1024;
  let remaining = maximum -
    entries.reduce((total, entry) => total + entry.data!.length, 0);
  const full = encoder.encode("A".repeat(1024 * 1024));
  const compressedFull = await deflateRaw(full);
  let index = 1;
  while (remaining > 0) {
    const data = remaining >= full.length ? full : full.slice(0, remaining);
    entries.push({
      name: `word/media/part${index}.dat`,
      data,
      method: 8,
      compressedData: data === full ? compressedFull : await deflateRaw(data),
    });
    remaining -= data.length;
    index += 1;
  }
  const result = await extractBoundedUploadText(
    storedZip(entries),
    "source.docx",
    "application/octet-stream",
  );
  assertEquals(result.text, "Keep wording");
  const tooLarge = storedZip([...entries, {
    name: "word/media/one-over.dat",
    data: new Uint8Array([1]),
  }]);
  await assertRejects(
    () =>
      extractBoundedUploadText(
        tooLarge,
        "source.docx",
        "application/octet-stream",
      ),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_EXPANSION_LIMIT",
  );
});

Deno.test("DOCX source distinguishes identical wording with different preserved style parts", async () => {
  const create = (style: string) =>
    storedZip(sourceDocxEntries("Same wording", [
      { name: "word/styles.xml", data: encoder.encode(style) },
    ]));
  const left = create('<styles><font name="Arial"/></styles>');
  const right = create('<styles><font name="Times"/></styles>');
  assertEquals(
    await extractBoundedUploadText(left, "a.docx", ""),
    await extractBoundedUploadText(right, "b.docx", ""),
  );
  const first = await inspectDocxSource(left, "a.docx", "");
  const second = await inspectDocxSource(right, "b.docx", "");
  assertEquals(first.archiveSha256, await sha256(left));
  assertEquals(first.archiveByteLength, left.byteLength);
  assert(first.archiveSha256 !== second.archiveSha256);
  assert(first.partRosterSha256 !== second.partRosterSha256);
  assertEquals(first.mainPart, second.mainPart);
  assertEquals(first.mainPart.source.nodes.map((node) => node.text), [
    "Same wording",
  ]);
  assertEquals(first.assessment, "source_only");
  assertEquals(first.blockers, [
    "layout_unassessed",
    "package_semantics_unassessed",
    "styles_and_visibility_unassessed",
  ]);
  assert(Object.isFrozen(first) && Object.isFrozen(first.parts));
  assert(first.parts.every(Object.isFrozen));
  assert(Object.isFrozen(first.mainPart) && Object.isFrozen(first.blockers));
});

Deno.test("DOCX source hashes actual uncompressed parts once and defines exact roster encoding", async () => {
  const style = encoder.encode('<styles><font name="Arial"/></styles>');
  const entries = sourceDocxEntries("Source text", [{
    name: "word/styles.xml",
    data: style,
    compressedData: await deflateRaw(style),
    method: 8,
  }, { name: "word/media/empty", data: new Uint8Array() }]);
  const NativeDecompressionStream = globalThis.DecompressionStream;
  let count = 0;
  globalThis.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format: CompressionFormat) {
      super(format);
      count += 1;
    }
  };
  try {
    const manifest = await inspectDocxSource(
      storedZip(entries),
      "source.docx",
      "",
    );
    assertEquals(count, 1);
    assertEquals(manifest.parts.map((part) => part.path), [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/media/empty",
      "word/styles.xml",
    ]);
    for (const part of manifest.parts) {
      const original = entries.find((entry) => entry.name === part.path)!;
      assertEquals(part.contentSha256, await sha256(original.data!));
      assertEquals(part.uncompressedByteLength, original.data!.byteLength);
      assertEquals(part.crc32, crc32(original.data!));
    }
    assertEquals(manifest.parts.at(-1)?.compressionMethod, 8);
    const expectedRoster = encoder.encode(JSON.stringify([
      "office-part-roster-json.1",
      manifest.parts.map((
        part,
      ) => [
        part.path,
        part.compressionMethod,
        part.compressedByteLength,
        part.uncompressedByteLength,
        part.crc32,
        part.contentSha256,
      ]),
    ]));
    assertEquals(manifest.partRosterSha256, await sha256(expectedRoster));
  } finally {
    globalThis.DecompressionStream = NativeDecompressionStream;
  }
});

Deno.test("DOCX source roster is order independent while original archive identity is exact", async () => {
  const entries = sourceDocxEntries("Exact archive");
  const original = await inspectDocxSource(
    storedZip(entries),
    "source.docx",
    "",
  );
  const reordered = await inspectDocxSource(
    storedZip([...entries].reverse()),
    "source.docx",
    "",
  );
  assertEquals(original.parts, reordered.parts);
  assertEquals(original.partRosterSha256, reordered.partRosterSha256);
  assert(original.archiveSha256 !== reordered.archiveSha256);
});

Deno.test("DOCX source keeps exact Unicode part paths without normalising them into replacements", async () => {
  const path = "word/media/cafe\u0301.png";
  const manifest = await inspectDocxSource(
    storedZip(sourceDocxEntries("Text", [
      { name: path, data: new Uint8Array([1, 2, 3]) },
    ])),
    "source.docx",
    "",
  );
  assert(manifest.parts.some((part) => part.path === path));
  assert(!manifest.parts.some((part) => part.path === path.normalize("NFC")));
});

Deno.test("DOCX source owns bytes before hashing and does not mutate caller originals", async () => {
  const original = storedZip(sourceDocxEntries("Original wording"));
  const before = Uint8Array.from(original);
  const pending = inspectDocxSource(original, "source.docx", "");
  original.fill(0);
  const source = await pending;
  assertEquals(source.archiveSha256, await sha256(before));
  assertEquals(source.mainPart.source.nodes[0]?.text, "Original wording");
  const readable = Uint8Array.from(before);
  await inspectDocxSource(readable, "source.docx", "");
  assertEquals(readable, before);
  await assertRejects(
    () =>
      inspectDocxSource(
        new Uint8Array(new SharedArrayBuffer(5)),
        "source.docx",
        "",
      ),
    UploadExtractionError,
    "UPLOAD_BUFFER_UNSUPPORTED",
  );
});

Deno.test("DOCX source cancellation is fenced across every digest boundary", async () => {
  const originalDigest = crypto.subtle.digest;
  const bytes = storedZip(sourceDocxEntries("Source"));
  // Three part hashes, roster, archive and the main source-part hash.
  for (let cancelAt = 1; cancelAt <= 6; cancelAt += 1) {
    const controller = new AbortController();
    let calls = 0;
    crypto.subtle.digest = async function (algorithm, data) {
      calls += 1;
      const result = await originalDigest.call(this, algorithm, data);
      if (calls === cancelAt) controller.abort();
      return result;
    };
    try {
      const error = await assertRejects(
        () => inspectDocxSource(bytes, "source.docx", "", controller.signal),
        UploadExtractionError,
        "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
      );
      assertEquals(error.status, 503);
      assertEquals(error.retryable, true);
      assertEquals(calls, cancelAt);
    } finally {
      crypto.subtle.digest = originalDigest;
    }
  }
  await assertRejects(
    () =>
      inspectDocxSource(bytes, "source.docx", "", undefined, Date.now() - 1),
    UploadExtractionError,
    "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
  );
  assertEquals(
    (await inspectDocxSource(bytes, "source.docx", "")).mainPart.source.nodes[0]
      ?.text,
    "Source",
  );
});

Deno.test("DOCX source never describes headers or signatures as approved main-body coverage", async () => {
  const source = await inspectDocxSource(
    storedZip(sourceDocxEntries("Body only", [
      {
        name: "word/header1.xml",
        data: encoder.encode(
          '<w:hdr xmlns:w="urn:w"><w:t>Header words</w:t></w:hdr>',
        ),
      },
      { name: "_xmlsignatures/sig1.xml", data: encoder.encode("<Signature/>") },
      {
        name: "word/_rels/styles.xml.rels",
        data: encoder.encode(
          '<Relationships><Relationship Type="unknown"/></Relationships>',
        ),
      },
    ])),
    "source.docx",
    "",
  );
  assertEquals(source.mainPart.source.nodes.map((node) => node.text), [
    "Body only",
  ]);
  assert(source.blockers.includes("non_main_wording_unmapped"));
  assert(source.blockers.includes("digital_signature_parts_present"));
  assert(source.blockers.includes("package_semantics_unassessed"));
  assertEquals(source.assessment, "source_only");
});

Deno.test("DOCX source does not reclassify unexpected digest failures as bad user input", async () => {
  const originalDigest = crypto.subtle.digest;
  const failure = new Error("Synthetic digest runtime failure");
  let calls = 0;
  crypto.subtle.digest = function (algorithm, data) {
    calls += 1;
    // Fail inside the Word source adapter after all package identities exist.
    if (calls === 6) return Promise.reject(failure);
    return originalDigest.call(this, algorithm, data);
  };
  try {
    const observed = await assertRejects(() =>
      inspectDocxSource(
        storedZip(sourceDocxEntries("Text")),
        "source.docx",
        "",
      )
    );
    assertStrictEquals(observed, failure);
    assertEquals(calls, 6);
  } finally {
    crypto.subtle.digest = originalDigest;
  }
});

Deno.test("DOCX source deadline expiry during the Word hash remains a retryable processing failure", async () => {
  const originalDigest = crypto.subtle.digest;
  const originalNow = Date.now;
  const deadline = originalNow() + 60_000;
  let calls = 0;
  crypto.subtle.digest = async function (algorithm, data) {
    calls += 1;
    const hash = await originalDigest.call(this, algorithm, data);
    if (calls === 6) Date.now = () => deadline;
    return hash;
  };
  try {
    const error = await assertRejects(
      () =>
        inspectDocxSource(
          storedZip(sourceDocxEntries("Text")),
          "source.docx",
          "",
          undefined,
          deadline,
        ),
      UploadExtractionError,
      "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
    );
    assertEquals(error.status, 503);
    assertEquals(error.retryable, true);
  } finally {
    crypto.subtle.digest = originalDigest;
    Date.now = originalNow;
  }
});

Deno.test("DOCX source rejects other formats, metadata mismatch and corrupt non-text parts", async () => {
  await assertRejects(
    () => inspectDocxSource(encoder.encode("Text"), "source.txt", "text/plain"),
    UploadExtractionError,
    "UPLOAD_DOCX_SOURCE_REQUIRED",
  );
  const original = storedZip(sourceDocxEntries("Text", [
    { name: "word/styles.xml", data: encoder.encode("Style marker") },
  ]));
  await assertRejects(
    () => inspectDocxSource(original, "source.xlsx", ""),
    UploadExtractionError,
    "UPLOAD_FORMAT_MISMATCH",
  );
  original[indexOfBytes(original, encoder.encode("Style marker"))] ^= 1;
  await assertRejects(
    () => inspectDocxSource(original, "source.docx", ""),
    UploadExtractionError,
    "UPLOAD_ARCHIVE_CRC_INVALID",
  );
});

Deno.test("DOCX source refuses an oversized manifest without a truncated or usable result", async () => {
  const original = storedZip(
    sourceDocxEntries("é".repeat(DOCX_SOURCE_POLICY.maxManifestBytes / 2)),
  );
  await assertRejects(
    () => inspectDocxSource(original, "source.docx", ""),
    UploadExtractionError,
    "UPLOAD_DOCX_SOURCE_LIMIT",
  );
});

Deno.test("DOCX source accepts the exact serialized UTF-8 ceiling and rejects one byte over", async () => {
  // Only an empty part's path length changes. Its CRC/content digest remain
  // fixed; archive size and node range stay in the same decimal digit bands.
  const create = (padding: number, bodyLength = 1_040_000) =>
    storedZip(sourceDocxEntries("x".repeat(bodyLength), [
      { name: `word/media/p${"x".repeat(padding)}`, data: new Uint8Array() },
    ]));
  const initial = await inspectDocxSource(create(0), "source.docx", "");
  const bodyLength = 1_040_000 + DOCX_SOURCE_POLICY.maxManifestBytes -
    encoder.encode(JSON.stringify(initial)).byteLength - 200;
  const baseline = await inspectDocxSource(
    create(0, bodyLength),
    "source.docx",
    "",
  );
  const padding = DOCX_SOURCE_POLICY.maxManifestBytes -
    encoder.encode(JSON.stringify(baseline)).byteLength;
  assert(padding > 0 && padding < 400);
  const exact = await inspectDocxSource(
    create(padding, bodyLength),
    "source.docx",
    "",
  );
  assertEquals(
    encoder.encode(JSON.stringify(exact)).byteLength,
    DOCX_SOURCE_POLICY.maxManifestBytes,
  );
  const binding = {
    contentSha256: exact.archiveSha256,
    byteLength: exact.archiveByteLength,
  };
  assertEquals(await normalizeDocxSourceManifest(exact, binding), exact);
  // One extra admitted path character leaves the other shape checks intact;
  // the wire validator must reject size before spending work hashing a roster.
  const oversized = {
    ...exact,
    parts: exact.parts.map((part) =>
      part.path.startsWith("word/media/p")
        ? { ...part, path: `${part.path}x` }
        : part
    ),
  };
  await assertRejects(
    () => normalizeDocxSourceManifest(oversized, binding),
    DocumentSourceContractError,
    "DOCUMENT_SOURCE_CONTRACT_RESOURCE_LIMIT",
  );
  await assertRejects(
    () => inspectDocxSource(create(padding + 1, bodyLength), "source.docx", ""),
    UploadExtractionError,
    "UPLOAD_DOCX_SOURCE_LIMIT",
  );
});

Deno.test("DOCX source maps known Word parser failures into exact upload failure contracts", async () => {
  for (
    const invalid of [
      encoder.encode(
        '<w:document xmlns:w="urn:untrusted"><w:body/></w:document>',
      ),
      encoder.encode(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
      ),
      new Uint8Array([0xff, 0xfe, 0x00, 0x61]),
    ]
  ) {
    const entries = sourceDocxEntries("Text");
    entries[2]!.data = invalid;
    const error = await assertRejects(
      () => inspectDocxSource(storedZip(entries), "source.docx", ""),
      UploadExtractionError,
      "UPLOAD_DOCX_SOURCE_INVALID",
    );
    assertEquals(error.status, 422);
    assertEquals(error.retryable, false);
  }
  const manyNodes = "A</w:t></w:r><w:r><w:t>".repeat(20_001);
  const error = await assertRejects(
    () =>
      inspectDocxSource(
        storedZip(sourceDocxEntries(manyNodes)),
        "source.docx",
        "",
      ),
    UploadExtractionError,
    "UPLOAD_DOCX_SOURCE_LIMIT",
  );
  assertEquals(error.status, 413);
});

Deno.test("DOCX source wire validation preserves actual package output and unusual admitted paths", async () => {
  for (
    const body of ["Text", "A<w:t>B</w:t>C", "<![CDATA[Rich text]]>", " ", ""]
  ) {
    const bytes = storedZip(sourceDocxEntries(body, [
      { name: "word/media/empty", data: new Uint8Array() },
      { name: "word/media/cafe\u0301:percent%.dat", data: new Uint8Array([1]) },
      { name: "word/media/control\u0001.dat", data: new Uint8Array([2]) },
      { name: "word/media/directory/", data: new Uint8Array([3]) },
    ]));
    const manifest = await inspectDocxSource(bytes, "source.docx", "");
    assertEquals(
      await normalizeDocxSourceManifest(manifest, {
        contentSha256: manifest.archiveSha256,
        byteLength: bytes.byteLength,
      }),
      manifest,
    );
  }
});

Deno.test("PDF cleanup finishes before returning a successful extraction result", async () => {
  const events: string[] = [];
  const value = { text: "Exact wording" };
  let release!: () => void;
  const cleanupFinished = new Promise<void>((resolve) => {
    release = resolve;
  });
  const work = withPdfCleanup(() => {
    events.push("read");
    return Promise.resolve(value);
  }, async () => {
    events.push("cleanup");
    await cleanupFinished;
    events.push("released");
  });
  let settled = false;
  const observed = work.then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(events, ["read", "cleanup"]);
  assertEquals(settled, false);
  release();
  assertStrictEquals(await observed, value);
  assertEquals(events, ["read", "cleanup", "released"]);
});

Deno.test("PDF cleanup failure after success returns a safe retryable failure", async () => {
  for (const asyncCleanup of [false, true]) {
    const failure = await assertRejects(
      () =>
        withPdfCleanup(
          () => Promise.resolve("Usable wording"),
          asyncCleanup
            ? () => Promise.reject(new Error("private cleanup detail"))
            : () => {
              throw new Error("private cleanup detail");
            },
        ),
      UploadExtractionError,
      "UPLOAD_PDF_RUNTIME_UNAVAILABLE",
    );
    assertEquals(failure.status, 503);
    assertEquals(failure.retryable, true);
    assertEquals(failure.message.includes("private cleanup detail"), false);
  }
});

Deno.test("PDF cleanup never masks the original read failure, including a falsy thrown value", async () => {
  for (
    const original of [
      new UploadExtractionError(413, "UPLOAD_PDF_TEXT_LIMIT", "Too much text."),
      null,
      undefined,
      false,
      0,
      "",
    ]
  ) {
    for (const cleanupFails of [false, true]) {
      let cleaned = false;
      const failure = await withPdfCleanup(() => {
        throw original;
      }, () => {
        cleaned = true;
        if (cleanupFails) throw new Error("secondary failure");
      }).then(
        () => ({ returned: true as const }),
        (error) => ({ returned: false as const, error }),
      );
      assertEquals(cleaned, true);
      assertEquals(failure.returned, false);
      if (!failure.returned) assertStrictEquals(failure.error, original);
    }
  }
});

Deno.test("PDF page cleanup failure still destroys the document and retains the first failure", async () => {
  const events: string[] = [];
  const failure = await assertRejects(() =>
    withPdfCleanup(async () => {
      return await withPdfCleanup(() => Promise.resolve("Wording"), () => {
        events.push("page cleanup");
        throw new Error("page private detail");
      });
    }, () => {
      events.push("document destroy");
      throw new Error("document private detail");
    }), UploadExtractionError);
  assertEquals(events, ["page cleanup", "document destroy"]);
  assertEquals(
    failure.publicMessage,
    "TED cannot safely finish reading that PDF right now.",
  );
});

Deno.test("PDF read rejection waits for deferred cleanup before becoming observable", async () => {
  const primary = new Error("primary read failure");
  let cleanupStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    cleanupStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  let settled = false;
  const result = withPdfCleanup(() => Promise.reject(primary), async () => {
    cleanupStarted();
    await finished;
  }).then(() => {
    settled = true;
    return null;
  }, (error) => {
    settled = true;
    return error;
  });
  await started;
  await Promise.resolve();
  assertEquals(settled, false);
  release();
  assertStrictEquals(await result, primary);
});
