// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "jsr:@std/assert@1";
import {
  DocumentSourceContractError,
  DOCX_SOURCE_POLICY,
  docxSourceBlockers,
  type DocxSourceManifest,
  encodeOfficePartRoster,
  normalizeDocxSourceManifest,
  type OfficeSourcePart,
  WORD_XML_SOURCE_POLICY,
} from "./document-source-contract.ts";
import { BOUNDED_XML_POLICY } from "./bounded-xml.ts";
import { mapWordXmlSource } from "./wordprocessingml-source.ts";

const encoder = new TextEncoder();
const binding = { contentSha256: "a".repeat(64), byteLength: 4096 };
async function sha(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

// A wire fixture with real mapped XML and declared package metadata. This is
// not an actual ZIP; producer-package roundtrips are tested in upload-extraction.
async function fixture(
  body = "<w:p><w:r><w:t>Source text</w:t></w:r></w:p>",
): Promise<DocxSourceManifest> {
  const bytes = encoder.encode(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  const source = await mapWordXmlSource(bytes);
  const parts: OfficeSourcePart[] = [
    {
      path: "[Content_Types].xml",
      compressionMethod: 0,
      compressedByteLength: 64,
      uncompressedByteLength: 64,
      crc32: 1,
      contentSha256: "b".repeat(64),
    },
    {
      path: "_rels/.rels",
      compressionMethod: 0,
      compressedByteLength: 64,
      uncompressedByteLength: 64,
      crc32: 2,
      contentSha256: "c".repeat(64),
    },
    {
      path: "word/document.xml",
      compressionMethod: 0,
      compressedByteLength: bytes.length,
      uncompressedByteLength: bytes.length,
      crc32: 3,
      contentSha256: source.originalSha256,
    },
  ];
  return {
    version: DOCX_SOURCE_POLICY.version,
    assessment: "source_only",
    archiveSha256: binding.contentSha256,
    archiveByteLength: binding.byteLength,
    rosterEncodingVersion: DOCX_SOURCE_POLICY.rosterEncodingVersion,
    partRosterSha256: await sha(encodeOfficePartRoster(parts)),
    parts,
    mainPart: { path: "word/document.xml", source },
    blockers: docxSourceBlockers(parts, source.blockers),
  };
}

function changed(
  value: unknown,
  path: Array<string | number>,
  replacement: unknown,
): unknown {
  const copy: unknown = structuredClone(value);
  let cursor = copy;
  for (const part of path.slice(0, -1)) {
    assert(cursor !== null && typeof cursor === "object");
    cursor = Reflect.get(cursor, part);
  }
  assert(cursor !== null && typeof cursor === "object");
  Reflect.set(cursor, path.at(-1)!, replacement);
  return copy;
}

Deno.test("source contract retains current versions, limits and canonical manifest encoding", async () => {
  assertEquals(
    WORD_XML_SOURCE_POLICY.maxPartBytes,
    BOUNDED_XML_POLICY.maxInputChars,
  );
  const original = await fixture();
  const accepted = await normalizeDocxSourceManifest(
    JSON.parse(JSON.stringify(original)),
    binding,
  );
  assertEquals(accepted, original);
  assert(Object.isFrozen(accepted) && Object.isFrozen(accepted.parts));
  assert(accepted.parts.every(Object.isFrozen));
  assert(
    Object.isFrozen(accepted.mainPart) &&
      Object.isFrozen(accepted.mainPart.source),
  );
  assert(
    Object.isFrozen(accepted.mainPart.source.nodes) &&
      accepted.mainPart.source.nodes.every(Object.isFrozen),
  );
  assert(
    Object.isFrozen(accepted.blockers) &&
      Object.isFrozen(accepted.mainPart.source.blockers),
  );
  const keysReordered = Object.fromEntries(Object.entries(original).reverse());
  assertEquals(
    JSON.stringify(await normalizeDocxSourceManifest(keysReordered, binding)),
    JSON.stringify(accepted),
  );
});

Deno.test("source contract accepts mapper edge cases without imposing edit eligibility", async () => {
  for (
    const body of [
      "",
      "<w:p><w:r><w:t/></w:r></w:p>",
      "<w:p><w:r><w:t>A<w:t>B</w:t>C</w:t></w:r></w:p>",
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
      "<w:p><w:r><w:t>A<!-- preserved -->B</w:t><w:t><![CDATA[Text]]></w:t></w:r></w:p>",
      '<w:p><w:r><w:t xml:space="preserve"> 😀 &amp; \r\n\t </w:t></w:r></w:p>',
      "<w:p><w:r><w:t>Simple sibling</w:t></w:r></w:p><w:ins><w:p><w:r><w:t>Revision</w:t></w:r></w:p></w:ins>",
    ]
  ) {
    const original = await fixture(body);
    assertEquals(
      await normalizeDocxSourceManifest(original, binding),
      original,
    );
  }
  const nested = await fixture(
    "<w:p><w:r><w:t>A<w:t>B</w:t>C</w:t></w:r></w:p>",
  );
  assertEquals(nested.mainPart.source.nodes.map((node) => node.id), [
    "t:2",
    "t:1",
  ]);
});

Deno.test("source contract rejects unsupported shapes, source substitutions and assessment upgrades", async () => {
  const source = await fixture();
  const candidates: unknown[] = [
    null,
    [],
    {},
    changed(source, ["version"], "docx-source-manifest.2"),
    changed(source, ["assessment"], "approved"),
    changed(source, ["passed"], true),
    changed(source, ["archiveSha256"], "d".repeat(64)),
    changed(source, ["archiveByteLength"], "4096"),
    changed(source, ["rosterEncodingVersion"], "other"),
    changed(source, ["partRosterSha256"], "f".repeat(64)),
    changed(source, ["mainPart", "path"], "word/styles.xml"),
    changed(source, ["mainPart", "source", "originalSha256"], "f".repeat(64)),
    changed(source, ["mainPart", "source", "version"], "word-xml-source.2"),
    changed(source, ["mainPart", "source", "assessment"], "verified"),
    changed(source, ["blockers"], []),
    changed(source, ["mainPart", "source", "blockers"], ["made_up_check"]),
  ];
  for (const value of candidates) {
    await assertRejects(
      () => normalizeDocxSourceManifest(value, binding),
      DocumentSourceContractError,
    );
  }
  await assertRejects(
    () => normalizeDocxSourceManifest(source, { ...binding, byteLength: 4095 }),
    DocumentSourceContractError,
  );
});

Deno.test("source contract rejects malformed part metadata and unsafe or ambiguous paths", async () => {
  const source = await fixture();
  for (
    const path of [
      "",
      "/word/document.xml",
      "word//document.xml",
      "word/../document.xml",
      "word\\document.xml",
      "word/\u0000.xml",
      "x".repeat(513),
      "é".repeat(257),
    ]
  ) {
    await assertRejects(
      () =>
        normalizeDocxSourceManifest(
          changed(source, ["parts", 2, "path"], path),
          binding,
        ),
      DocumentSourceContractError,
    );
  }
  for (
    const [field, value] of [
      ["compressionMethod", 7],
      ["compressionMethod", "0"],
      ["compressedByteLength", -1],
      ["uncompressedByteLength", 1.5],
      ["crc32", 0x100000000],
      ["crc32", null],
      ["contentSha256", "ABC"],
      ["compressedByteLength", 1],
    ]
  ) {
    await assertRejects(
      () =>
        normalizeDocxSourceManifest(
          changed(source, ["parts", 2, String(field)], value),
          binding,
        ),
      DocumentSourceContractError,
    );
  }
  await assertRejects(
    () =>
      normalizeDocxSourceManifest(
        changed(source, ["parts"], [...source.parts].reverse()),
        binding,
      ),
    DocumentSourceContractError,
  );
  await assertRejects(
    () =>
      normalizeDocxSourceManifest(
        changed(source, ["parts", 1, "path"], "[content_types].xml"),
        binding,
      ),
    DocumentSourceContractError,
  );
});

Deno.test("source contract checks node identity and spans without accepting missing verification", async () => {
  const source = await fixture();
  for (
    const [field, value] of [
      ["id", "t:01"],
      ["id", "t:2"],
      ["start", -1],
      ["end", 9000],
      ["start", null],
      ["end", 1],
      ["start", "1"],
      ["text", "\u0000"],
      ["text", "\ud800"],
      ["text", {}],
      ["xmlSpace", "inherit"],
      ["lexicallyPatchable", "true"],
    ]
  ) {
    await assertRejects(
      () =>
        normalizeDocxSourceManifest(
          changed(
            source,
            ["mainPart", "source", "nodes", 0, String(field)],
            value,
          ),
          binding,
        ),
      DocumentSourceContractError,
    );
  }
  await assertRejects(
    () =>
      normalizeDocxSourceManifest(
        changed(source, ["mainPart", "source", "nodes"], [
          source.mainPart.source.nodes[0],
          source.mainPart.source.nodes[0],
        ]),
        binding,
      ),
    DocumentSourceContractError,
  );
});

Deno.test("source contract rejects oversized collections before allocating their normalized copies", async () => {
  const source = await fixture();
  await assertRejects(
    () =>
      normalizeDocxSourceManifest(
        changed(source, ["parts"], Array(513).fill(source.parts[0])),
        binding,
      ),
    DocumentSourceContractError,
    "DOCUMENT_SOURCE_CONTRACT_RESOURCE_LIMIT",
  );
  await assertRejects(
    () =>
      normalizeDocxSourceManifest(
        changed(
          source,
          ["mainPart", "source", "nodes"],
          Array(20_001).fill(source.mainPart.source.nodes[0]),
        ),
        binding,
      ),
    DocumentSourceContractError,
    "DOCUMENT_SOURCE_CONTRACT_RESOURCE_LIMIT",
  );
});

Deno.test("source contract owns both source data and expected binding across hashing", async () => {
  const source = await fixture();
  const candidate: unknown = structuredClone(source);
  const expected = { ...binding };
  const pending = normalizeDocxSourceManifest(candidate, expected);
  assert(candidate !== null && typeof candidate === "object");
  Reflect.set(candidate, "parts", []);
  Reflect.set(candidate, "blockers", []);
  expected.contentSha256 = "e".repeat(64);
  assertEquals(await pending, source);
});

Deno.test("source contract cancellation and deadline expiry cannot publish a completed digest", async () => {
  const source = await fixture();
  const controller = new AbortController();
  const pending = normalizeDocxSourceManifest(source, {
    ...binding,
    signal: controller.signal,
  });
  controller.abort();
  await assertRejects(
    () => pending,
    DocumentSourceContractError,
    "DOCUMENT_SOURCE_CONTRACT_CANCELLED",
  );
  await assertRejects(
    () =>
      normalizeDocxSourceManifest(source, {
        ...binding,
        deadline: Date.now() - 1,
      }),
    DocumentSourceContractError,
    "DOCUMENT_SOURCE_CONTRACT_RESOURCE_LIMIT",
  );
  const digest = crypto.subtle.digest;
  const now = Date.now;
  const deadline = now() + 20_000;
  crypto.subtle.digest = async function (algorithm, bytes) {
    const result = await digest.call(this, algorithm, bytes);
    Date.now = () => deadline;
    return result;
  };
  try {
    await assertRejects(
      () => normalizeDocxSourceManifest(source, { ...binding, deadline }),
      DocumentSourceContractError,
      "DOCUMENT_SOURCE_CONTRACT_RESOURCE_LIMIT",
    );
  } finally {
    crypto.subtle.digest = digest;
    Date.now = now;
  }
});

Deno.test("source contract preserves unexpected digest failures as operational errors", async () => {
  const source = await fixture();
  const digest = crypto.subtle.digest;
  const failure = new Error("Synthetic digest failure");
  crypto.subtle.digest = () => Promise.reject(failure);
  try {
    assertStrictEquals(
      await assertRejects(() => normalizeDocxSourceManifest(source, binding)),
      failure,
    );
  } finally {
    crypto.subtle.digest = digest;
  }
});

Deno.test("source contract rejects positive inflated content with zero compressed bytes even with a matching roster hash", async () => {
  const source = await fixture();
  const parts = source.parts.map((part) =>
    part.path === "word/document.xml"
      ? { ...part, compressionMethod: 8, compressedByteLength: 0 }
      : part
  );
  const candidate = {
    ...source,
    parts,
    partRosterSha256: await sha(encodeOfficePartRoster(parts)),
  };
  await assertRejects(
    () => normalizeDocxSourceManifest(candidate, binding),
    DocumentSourceContractError,
    "DOCUMENT_SOURCE_CONTRACT_INVALID",
  );
});
