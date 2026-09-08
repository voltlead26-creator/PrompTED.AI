// deno-lint-ignore-file no-import-prefix
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  applyWordXmlSourcePatches,
  deriveWordXmlUnitPatches,
  mapWordXmlSource,
  mapWordXmlSourceUnits,
  WORD_XML_SOURCE_POLICY,
  WORD_XML_UNIT_POLICY,
  WordXmlSourceError,
} from "./wordprocessingml-source.ts";

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const encode = (xml: string) => new TextEncoder().encode(xml);
const decode = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
const document = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD}"><w:body>${body}</w:body></w:document>`;
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

Deno.test("Word units preserve run boundaries and previous edits when compiling a complete current roster", async () => {
  const bytes = encode(
    document(
      "<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo</w:t></w:r></w:p>" +
        paragraph("Sibling"),
    ),
  );
  const projection = await mapWordXmlSourceUnits(bytes);
  assertEquals(projection.paragraphs, [{ id: "p:1", unitIds: ["t:1", "t:2"] }, {
    id: "p:2",
    unitIds: ["t:3"],
  }]);
  const request = {
    version: "word-xml-units.1",
    originalSha256: projection.source.originalSha256,
    units: [{ nodeId: "t:1", content: "First edit" }, {
      nodeId: "t:2",
      content: "lo",
    }, { nodeId: "t:3", content: "Sibling" }],
  };
  const first = await applyWordXmlSourcePatches(
    bytes,
    await deriveWordXmlUnitPatches(bytes, request),
  );
  assertEquals((await mapWordXmlSource(first)).nodes.map((node) => node.text), [
    "First edit",
    "lo",
    "Sibling",
  ]);
  request.units[1]!.content = "Second edit";
  const second = await applyWordXmlSourcePatches(
    bytes,
    await deriveWordXmlUnitPatches(bytes, request),
  );
  assertEquals(
    (await mapWordXmlSource(second)).nodes.map((node) => node.text),
    ["First edit", "Second edit", "Sibling"],
  );
});

async function unitRequest(bytes: Uint8Array) {
  const projection = await mapWordXmlSourceUnits(bytes);
  return {
    version: WORD_XML_UNIT_POLICY.version,
    originalSha256: projection.source.originalSha256,
    units: projection.units.map((unit) => ({
      nodeId: unit.nodeId,
      content: unit.content,
    })),
  };
}

Deno.test("Word units keep empty paragraphs and distinct repeated text identities without changing v1 source", async () => {
  const bytes = encode(
    document(
      "<w:p/>" + paragraph("Same") + "<w:p><w:r><w:t/></w:r></w:p>" +
        paragraph("Same"),
    ),
  );
  const mapped = await mapWordXmlSourceUnits(bytes);
  assertEquals(mapped.paragraphs, [
    { id: "p:1", unitIds: [] },
    { id: "p:2", unitIds: ["t:1"] },
    { id: "p:3", unitIds: ["t:2"] },
    { id: "p:4", unitIds: ["t:3"] },
  ]);
  assertEquals(
    mapped.units.map(
      (unit) => [
        unit.nodeId,
        unit.paragraphId,
        unit.content,
        unit.lexicallyPatchable,
      ],
    ),
    [
      ["t:1", "p:2", "Same", true],
      ["t:2", "p:3", "", false],
      ["t:3", "p:4", "Same", true],
    ],
  );
  assertEquals(mapped.source, await mapWordXmlSource(bytes));
  assertEquals(Object.keys(mapped.source).sort(), [
    "assessment",
    "blockers",
    "nodes",
    "originalSha256",
    "version",
  ]);
  assertEquals(mapped.assessment, "source_only");
  assertEquals(mapped.blockers, [
    "layout_unassessed",
    "package_semantics_unassessed",
    "styles_and_visibility_unassessed",
  ]);
  assert(
    Object.isFrozen(mapped.units) && Object.isFrozen(mapped.units[0]) &&
      Object.isFrozen(mapped.paragraphs[0]?.unitIds),
  );
  assertEquals(
    await applyWordXmlSourcePatches(
      bytes,
      await deriveWordXmlUnitPatches(bytes, await unitRequest(bytes)),
    ),
    bytes,
  );
});

Deno.test("Word units group by resolved ancestry across aliases, defaults, strict namespace and shadowing", async () => {
  for (
    const namespace of [
      WORD,
      "http://purl.oclc.org/ooxml/wordprocessingml/main",
    ]
  ) {
    for (const prefix of ["alias:", ""]) {
      const binding = prefix ? "xmlns:alias" : "xmlns";
      const bytes = encode(
        `<${prefix}document ${binding}="${namespace}"><${prefix}body><${prefix}p><${prefix}r><${prefix}t>A</${prefix}t></${prefix}r></${prefix}p></${prefix}body></${prefix}document>`,
      );
      const mapped = await mapWordXmlSourceUnits(bytes);
      assertEquals(mapped.paragraphs, [{ id: "p:1", unitIds: ["t:1"] }]);
      assertEquals(mapped.units[0]?.paragraphId, "p:1");
    }
  }
  const shadowed = await mapWordXmlSourceUnits(
    encode(
      document(
        '<w:p xmlns:w="urn:foreign"><w:r><w:t>Ignored</w:t></w:r></w:p>' +
          paragraph("Real"),
      ),
    ),
  );
  assertEquals(shadowed.paragraphs, [{ id: "p:1", unitIds: ["t:1"] }]);
  assertEquals(shadowed.units[0]?.content, "Real");
  assert(shadowed.blockers.includes("foreign_element_semantics"));
  const outside = await mapWordXmlSourceUnits(
    encode(
      document("<w:r><w:t>Outside paragraph</w:t></w:r>" + paragraph("Inside")),
    ),
  );
  assertEquals(outside.units.map((unit) => unit.paragraphId), [null, "p:1"]);
  assertEquals(outside.paragraphs[0]?.unitIds, ["t:2"]);
  assert(outside.blockers.includes("source_unit_context_unmapped"));
});

Deno.test("Word units round-trip literal whitespace, Unicode, markup and TED tokens without interpretation", async () => {
  const literal =
    "  A  B\u00a0e\u0301 🦘 <tag> & {{TED_PLACEHOLDER:FACT:keep}}  ";
  const escaped = literal.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const bytes = encode(
    document(
      `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`,
    ),
  );
  const mapped = await mapWordXmlSourceUnits(bytes);
  assertEquals(mapped.contentEncoding, "literal-text.1");
  assertEquals(mapped.units[0]?.content, literal);
  const request = await unitRequest(bytes);
  const unchanged = await deriveWordXmlUnitPatches(bytes, request);
  assertEquals(unchanged.patches, []);
  assertEquals(await applyWordXmlSourcePatches(bytes, unchanged), bytes);
  request.units[0]!.content = literal.replace("A  B", "Revised  B");
  const plan = await deriveWordXmlUnitPatches(bytes, request);
  const result = await applyWordXmlSourcePatches(bytes, plan);
  assertEquals(decode(result), decode(bytes).replace("A  B", "Revised  B"));
});

Deno.test("Word units reject partial, reordered, duplicate, unknown and stale current rosters", async () => {
  const bytes = encode(document(paragraph("Same") + paragraph("Same")));
  const request = await unitRequest(bytes);
  for (
    const invalid of [
      { ...request, units: request.units.slice(1) },
      { ...request, units: [...request.units].reverse() },
      {
        ...request,
        units: [request.units[0], { nodeId: "t:3", content: "Same" }],
      },
      { ...request, originalSha256: "0".repeat(64) },
    ]
  ) {
    await assertRejects(
      () => deriveWordXmlUnitPatches(bytes, invalid),
      WordXmlSourceError,
      "IDENTITY_MISMATCH",
    );
  }
  for (
    const invalid of [
      null,
      {},
      { ...request, version: "unknown" },
      { ...request, sections: [] },
      { ...request, units: [request.units[0], request.units[0]] },
      {
        ...request,
        units: [{ ...request.units[0], paragraphId: "p:1" }, request.units[1]],
      },
      { ...request, units: [{ nodeId: "t:1", content: 3 }, request.units[1]] },
    ]
  ) {
    await assertRejects(
      () => deriveWordXmlUnitPatches(bytes, invalid),
      WordXmlSourceError,
      "INVALID_PATCH",
    );
  }
});

Deno.test("Word units preserve unsupported source as no-op and reject edits instead of flattening it", async () => {
  const cases = [
    "<w:p><w:r><w:t/></w:r></w:p>",
    paragraph("A<!-- comment -->B"),
    paragraph("<![CDATA[A]]>"),
    "<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t></w:r></w:p>",
    "<w:p><w:r><w:t>A</w:t><w:softHyphen/></w:r></w:p>",
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:t>A</w:t></w:r></w:p>',
    "<w:r><w:t>Outside</w:t></w:r>",
    "<w:p><w:r><w:t>Nested<w:t>Inner</w:t></w:t></w:r></w:p>",
  ];
  for (const body of cases) {
    const bytes = encode(document(body));
    const request = await unitRequest(bytes);
    assertEquals(
      await applyWordXmlSourcePatches(
        bytes,
        await deriveWordXmlUnitPatches(bytes, request),
      ),
      bytes,
    );
    request.units[0]!.content = "Changed";
    await assertRejects(
      () => deriveWordXmlUnitPatches(bytes, request),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
  }
  // Tab-stop paragraph properties are formatting, not unmapped wording.
  const properties = encode(
    document(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>A</w:t></w:r></w:p>',
    ),
  );
  const request = await unitRequest(properties);
  request.units[0]!.content = "Changed";
  assertEquals(
    (await deriveWordXmlUnitPatches(properties, request)).patches[0]?.text,
    "Changed",
  );
});

Deno.test("Word units reject unrepresentable changes and enforce source and current-value bounds without truncation", async () => {
  const bytes = encode(document(paragraph("A")));
  const request = await unitRequest(bytes);
  for (
    const content of ["", " leading", "trailing ", "line\nbreak", "tab\tbreak"]
  ) {
    await assertRejects(
      () =>
        deriveWordXmlUnitPatches(bytes, {
          ...request,
          units: [{ nodeId: "t:1", content }],
        }),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
  }
  for (
    const body of [
      paragraph("x".repeat(20_001)),
      paragraph("A").repeat(513),
      "<w:p/>".repeat(513),
    ]
  ) {
    await assertRejects(
      () => mapWordXmlSourceUnits(encode(document(body))),
      WordXmlSourceError,
      "RESOURCE_LIMIT",
    );
  }
  await assertRejects(
    () =>
      deriveWordXmlUnitPatches(bytes, {
        ...request,
        units: [{ nodeId: "t:1", content: "x".repeat(20_001) }],
      }),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
  await assertRejects(
    () =>
      deriveWordXmlUnitPatches(bytes, {
        ...request,
        units: Array.from(
          { length: 513 },
          (_, i) => ({ nodeId: `t:${i + 1}`, content: "A" }),
        ),
      }),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
});

Deno.test("Word units capture caller values before hash await and enforce cancellation/deadlines", async () => {
  const immutable = encode(document(paragraph("A")));
  const bytes = immutable.slice();
  const request = await unitRequest(bytes);
  request.units[0]!.content = "Accepted";
  const pending = deriveWordXmlUnitPatches(bytes, request);
  bytes.fill(0);
  request.originalSha256 = "0".repeat(64);
  request.units[0]!.content = "Late overwrite";
  const plan = await pending;
  assertEquals(plan.patches[0]?.text, "Accepted");
  assertEquals(
    (await mapWordXmlSource(await applyWordXmlSourcePatches(immutable, plan)))
      .nodes[0]?.text,
    "Accepted",
  );
  const valid = await unitRequest(immutable);
  for (const pre of [true, false]) {
    const controller = new AbortController();
    if (pre) controller.abort();
    const operation = deriveWordXmlUnitPatches(immutable, valid, {
      signal: controller.signal,
    });
    if (!pre) controller.abort();
    await assertRejects(() => operation, WordXmlSourceError, "CANCELLED");
  }
  await assertRejects(
    () =>
      deriveWordXmlUnitPatches(immutable, valid, { deadline: Date.now() - 1 }),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
  await assertRejects(
    () => mapWordXmlSourceUnits(immutable, { deadline: NaN }),
    WordXmlSourceError,
    "INVALID_PATCH",
  );
});

Deno.test("Word units accept exact unit, paragraph and content ceilings while preserving the stricter patch budget", async () => {
  const exactUnits = encode(document(paragraph("A").repeat(512)));
  const mapped = await mapWordXmlSourceUnits(exactUnits);
  assertEquals(mapped.paragraphs.length, 512);
  assertEquals(mapped.units.length, 512);
  assertEquals(
    (await deriveWordXmlUnitPatches(exactUnits, await unitRequest(exactUnits)))
      .patches,
    [],
  );
  assertEquals(
    (await mapWordXmlSourceUnits(encode(document("<w:p/>".repeat(512)))))
      .paragraphs.length,
    512,
  );
  const atSingleLimit = encode(document(paragraph("x".repeat(20_000))));
  const current = await unitRequest(atSingleLimit);
  current.units[0]!.content = "y".repeat(20_000);
  assertEquals(
    (await deriveWordXmlUnitPatches(atSingleLimit, current)).patches[0]?.text
      .length,
    20_000,
  );

  const contents = Array.from(
    { length: 53 },
    (_, index) => "x".repeat(index === 52 ? 8576 : 20_000),
  );
  assertEquals(
    contents.reduce((sum, value) => sum + value.length, 0),
    1024 * 1024,
  );
  const aggregate = encode(document(contents.map(paragraph).join("")));
  const request = await unitRequest(aggregate);
  assertEquals(
    (await deriveWordXmlUnitPatches(aggregate, request)).patches,
    [],
  );
  const excessive = {
    ...request,
    units: request.units.map((unit) => ({ ...unit })),
  };
  excessive.units[52]!.content += "x";
  await assertRejects(
    () => deriveWordXmlUnitPatches(aggregate, excessive),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
  await assertRejects(
    () =>
      mapWordXmlSourceUnits(
        encode(
          document(
            [...contents.slice(0, 52), contents[52] + "x"].map(paragraph).join(
              "",
            ),
          ),
        ),
      ),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
  // The existing patch contract counts BOTH expected and replacement wording.
  // Current-roster acceptance does not promise all values can change in one plan.
  const allChanged = {
    ...request,
    units: request.units.map((unit) => ({
      ...unit,
      content: "y".repeat(unit.content.length),
    })),
  };
  await assertRejects(
    () => deriveWordXmlUnitPatches(aggregate, allChanged),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
});

Deno.test("Word source maps distinct repeated text nodes and exact entity-bearing locations", async () => {
  const xml = document(paragraph("👋 &amp; same") + paragraph("same"));
  const source = await mapWordXmlSource(encode(xml));
  assertEquals(source.nodes.map((node) => [node.id, node.text]), [
    ["t:1", "👋 & same"],
    ["t:2", "same"],
  ]);
  assertEquals(source.nodes.map((node) => xml.slice(node.start!, node.end!)), [
    "👋 &amp; same",
    "same",
  ]);
  assertEquals(source.assessment, "source_only");
});

Deno.test("Word source patches one exact node while retaining BOM, styles, spelling and comments", async () => {
  const xml = "\ufeff" + document(
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><!-- keep -->' +
      '<w:r><w:rPr><w:b/><w:sz w:val="40"/></w:rPr><w:t>A &#38; B</w:t></w:r>' +
      "<w:r><w:t>A &#38; B</w:t></w:r></w:p>",
  );
  const bytes = encode(xml);
  const source = await mapWordXmlSource(bytes);
  const changed = await applyWordXmlSourcePatches(bytes, {
    version: source.version,
    originalSha256: source.originalSha256,
    patches: [{ nodeId: "t:2", expectedText: "A & B", text: "C < D 👋" }],
  });
  assertEquals(
    decode(changed),
    xml.replace(
      "<w:r><w:t>A &#38; B</w:t></w:r>",
      "<w:r><w:t>C &lt; D 👋</w:t></w:r>",
    ),
  );
  assertEquals(bytes, encode(xml));
});

Deno.test("Word source semantic no-op preserves original entity spellings byte for byte", async () => {
  const bytes = encode(document(paragraph("&#65; &#x26; B")));
  const source = await mapWordXmlSource(bytes);
  for (
    const patches of [[], [{
      nodeId: "t:1",
      expectedText: "A & B",
      text: "A & B",
    }]]
  ) {
    assertEquals(
      await applyWordXmlSourcePatches(bytes, {
        version: source.version,
        originalSha256: source.originalSha256,
        patches,
      }),
      bytes,
    );
  }
});

Deno.test("Word source accepts namespace aliases, defaults and the explicit strict namespace", async () => {
  for (
    const namespace of [
      WORD,
      "http://purl.oclc.org/ooxml/wordprocessingml/main",
    ]
  ) {
    for (const prefix of ["alias:", ""]) {
      const binding = prefix ? "xmlns:alias" : "xmlns";
      const xml =
        `<${prefix}document ${binding}="${namespace}"><${prefix}body>` +
        `<${prefix}p><${prefix}r><${prefix}t>A</${prefix}t></${prefix}r></${prefix}p>` +
        `</${prefix}body></${prefix}document>`;
      const source = await mapWordXmlSource(encode(xml));
      assertEquals(
        source.nodes.map(
          (node) => [node.id, node.text, node.lexicallyPatchable],
        ),
        [["t:1", "A", true]],
      );
      assertEquals(source.blockers, []);
    }
  }
});

Deno.test("Word source restores namespace bindings after a shadowed subtree", async () => {
  const source = await mapWordXmlSource(encode(document(
    '<w:p xmlns:w="urn:foreign"><w:r><w:t>Other</w:t></w:r></w:p>' +
      paragraph("Real"),
  )));
  assertEquals(source.nodes.map((node) => [node.id, node.text]), [[
    "t:1",
    "Real",
  ]]);
  assertEquals(source.blockers.includes("foreign_element_semantics"), true);
});

const invalidXmlCases = [
  `<w:document xmlns:w="urn:wrong"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}"><x:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:xml="urn:wrong"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:x="http://www.w3.org/XML/1998/namespace"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns="http://www.w3.org/XML/1998/namespace"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:xmlns="urn:x"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:x="http://www.w3.org/2000/xmlns/"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:x=""><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:x:y="urn:x"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}" xmlns:x="${WORD}" w:a="1" x:a="2"><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}"><w:body/><w:body/></w:document>`,
  `<w:document xmlns:w="${WORD}"><w:body><w:body/></w:body></w:document>`,
  `<w:document xmlns:w="${WORD}"/>`,
  document(paragraph("ok")) + "<extra/>",
  document('<w:p xml:space="invalid"><w:r><w:t>A</w:t></w:r></w:p>'),
];
for (const [index, xml] of invalidXmlCases.entries()) {
  Deno.test(`Word source rejects invalid namespace/root/attribute contract ${index + 1}`, async () => {
    await assertRejects(
      () => mapWordXmlSource(encode(xml)),
      WordXmlSourceError,
      "INVALID_XML",
    );
  });
}

Deno.test("Word source does not apply the default namespace to unprefixed attributes", async () => {
  const xml =
    `<document xmlns="${WORD}" xmlns:w="${WORD}" a="1" w:a="2"><body/></document>`;
  const source = await mapWordXmlSource(encode(xml));
  assertEquals(source.blockers, ["unreviewed_attribute_semantics"]);
});

Deno.test("Word source preserves but does not edit mixed, empty, nested or CDATA payloads", async () => {
  for (
    const payload of [
      "A<![CDATA[]]>",
      "A<!--x-->",
      "<!--x-->A",
      "A<?x ok?>",
      "A<!--x-->B",
      "<![CDATA[A]]>",
      "A<w:tab/>B",
      "",
      "A<w:t>B</w:t>",
    ]
  ) {
    const bytes = encode(document(paragraph(payload)));
    const source = await mapWordXmlSource(bytes);
    const node = source.nodes.find((node) => node.id === "t:1")!;
    assertEquals(node.lexicallyPatchable, false, payload);
    assertEquals(node.start, null, payload);
    await assertRejects(
      () =>
        applyWordXmlSourcePatches(bytes, {
          version: source.version,
          originalSha256: source.originalSha256,
          patches: [{
            nodeId: node.id,
            expectedText: node.text,
            text: "Changed",
          }],
        }),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
  }
  const source = await mapWordXmlSource(encode(document(
    "<w:p><w:r><w:t/><w:t>Second</w:t></w:r></w:p>",
  )));
  assertEquals(source.nodes.map((node) => [node.id, node.lexicallyPatchable]), [
    ["t:1", false],
    ["t:2", true],
  ]);
});

Deno.test("Word source does not mistake field results or revision branches for editable prose", async () => {
  for (
    const before of [
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText></w:r></w:p>',
      '<w:p><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>',
      "<w:ins><w:p><w:r><w:t>Tracked</w:t></w:r></w:p></w:ins>",
      "<w:p><w:pPr><w:pPrChange/></w:pPr></w:p>",
      '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice/><mc:Fallback/></mc:AlternateContent>',
      "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
    ]
  ) {
    const bytes = encode(document(before + paragraph("Result")));
    const source = await mapWordXmlSource(bytes);
    assertEquals(source.blockers.length > 0, true);
    const node = source.nodes.find((node) => node.text === "Result")!;
    await assertRejects(
      () =>
        applyWordXmlSourcePatches(bytes, {
          version: source.version,
          originalSha256: source.originalSha256,
          patches: [{
            nodeId: node.id,
            expectedText: "Result",
            text: "Changed",
          }],
        }),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
    assertEquals(
      await applyWordXmlSourcePatches(bytes, {
        version: source.version,
        originalSha256: source.originalSha256,
        patches: [],
      }),
      bytes,
    );
  }
});

Deno.test("Word source treats hidden/styled content as source only, never visibility evidence", async () => {
  const source = await mapWordXmlSource(encode(document(
    '<w:p><w:r><w:rPr><w:vanish/><w:rStyle w:val="UnresolvedStyle"/></w:rPr><w:t>Hidden</w:t></w:r></w:p>',
  )));
  assertEquals(source.assessment, "source_only");
  assertEquals(source.nodes[0]!.text, "Hidden");
});

Deno.test("Word source enforces inherited xml:space without modifying protected attributes", async () => {
  const bytes = encode(document(
    '<w:p xml:space="preserve"><w:r><w:t>A</w:t>' +
      '<w:t xml:space="default">B</w:t></w:r></w:p>',
  ));
  const source = await mapWordXmlSource(bytes);
  assertEquals(source.nodes.map((node) => node.xmlSpace), [
    "preserve",
    "default",
  ]);
  const request = {
    version: source.version,
    originalSha256: source.originalSha256,
    patches: [{ nodeId: "t:1", expectedText: "A", text: " C " }],
  };
  const changed = await applyWordXmlSourcePatches(bytes, request);
  assertEquals(
    decode(changed),
    decode(bytes).replace("<w:t>A</w:t>", "<w:t> C </w:t>"),
  );
  request.patches = [{ nodeId: "t:2", expectedText: "B", text: " C " }];
  await assertRejects(
    () => applyWordXmlSourcePatches(bytes, request),
    WordXmlSourceError,
    "UNSUPPORTED_EDIT",
  );
});

Deno.test("Word source rejects stale hash, expected text, unknown identity and duplicate patches", async () => {
  const bytes = encode(document(paragraph("A")));
  const source = await mapWordXmlSource(bytes);
  const request = {
    version: source.version,
    originalSha256: source.originalSha256,
    patches: [{ nodeId: "t:1", expectedText: "A", text: "B" }],
  };
  for (
    const changed of [
      { ...request, originalSha256: "0".repeat(64) },
      {
        ...request,
        patches: [{ nodeId: "t:1", expectedText: "Wrong", text: "B" }],
      },
      {
        ...request,
        patches: [{ nodeId: "t:2", expectedText: "A", text: "B" }],
      },
    ]
  ) {
    await assertRejects(
      () => applyWordXmlSourcePatches(bytes, changed),
      WordXmlSourceError,
      "IDENTITY_MISMATCH",
    );
  }
  for (
    const changed of [
      { ...request, patches: [request.patches[0], request.patches[0]] },
      { ...request, version: "invented" },
      { ...request, patches: [{ ...request.patches[0], start: 1 }] },
      { ...request, offsets: [] },
      null,
      [],
    ]
  ) {
    await assertRejects(
      () => applyWordXmlSourcePatches(bytes, changed),
      WordXmlSourceError,
      "INVALID_PATCH",
    );
  }
});

Deno.test("Word source validates every patch before returning any changed part", async () => {
  const bytes = encode(document(paragraph("A") + paragraph("B")));
  const source = await mapWordXmlSource(bytes);
  await assertRejects(
    () =>
      applyWordXmlSourcePatches(bytes, {
        version: source.version,
        originalSha256: source.originalSha256,
        patches: [{ nodeId: "t:1", expectedText: "A", text: "Changed" }, {
          nodeId: "t:2",
          expectedText: "Wrong",
          text: "Bad",
        }],
      }),
    WordXmlSourceError,
    "IDENTITY_MISMATCH",
  );
  assertEquals(decode(bytes), document(paragraph("A") + paragraph("B")));
});

Deno.test("Word source owns request and original bytes before yielding, with frozen metadata", async () => {
  const xml = document(paragraph("A"));
  const bytes = encode(xml);
  const mapping = mapWordXmlSource(bytes);
  bytes.fill(0);
  const source = await mapping;
  assertEquals(source.nodes[0]!.text, "A");
  assertThrows(() => Object.assign(source.nodes[0]!, { start: 0 }), TypeError);
  assertThrows(
    () => Object.assign(source, { originalSha256: "0".repeat(64) }),
    TypeError,
  );
  const original = encode(xml);
  const request = {
    version: source.version,
    originalSha256: source.originalSha256,
    patches: [{ nodeId: "t:1", expectedText: "A", text: "B" }],
  };
  const applying = applyWordXmlSourcePatches(original, request);
  original.fill(0);
  request.originalSha256 = "0".repeat(64);
  request.patches[0]!.text = "Attacker";
  assertEquals(
    decode(await applying),
    xml.replace("<w:t>A</w:t>", "<w:t>B</w:t>"),
  );
});

Deno.test("Word source rejects unsupported encoding and invalid scalars", async () => {
  for (
    const bytes of [
      new Uint8Array([0xff, 0xfe, 0x3c, 0]),
      new Uint8Array([0xc0, 0xaf]),
      encode(document(paragraph("A")).replace("UTF-8", "ISO-8859-1")),
      encode(document(paragraph("A")).replace("UTF-8", "UTF-16")),
    ]
  ) {
    await assertRejects(
      () => mapWordXmlSource(bytes),
      WordXmlSourceError,
      "UNSUPPORTED_ENCODING",
    );
  }
  const bytes = encode(document(paragraph("A")));
  const source = await mapWordXmlSource(bytes);
  for (const text of ["\u0000", "\ud800", "\uffff"]) {
    await assertRejects(
      () =>
        applyWordXmlSourcePatches(bytes, {
          version: source.version,
          originalSha256: source.originalSha256,
          patches: [{ nodeId: "t:1", expectedText: "A", text }],
        }),
      WordXmlSourceError,
      "INVALID_PATCH",
    );
  }
  for (const text of ["", "line\nbreak", "tab\there", "cr\rhere"]) {
    await assertRejects(
      () =>
        applyWordXmlSourcePatches(bytes, {
          version: source.version,
          originalSha256: source.originalSha256,
          patches: [{ nodeId: "t:1", expectedText: "A", text }],
        }),
      WordXmlSourceError,
      "UNSUPPORTED_EDIT",
    );
  }
});

Deno.test("Word source aborts before and after the digest and honours an expired deadline", async () => {
  const bytes = encode(document(paragraph("A")));
  const cancelled = new AbortController();
  cancelled.abort();
  await assertRejects(
    () => mapWordXmlSource(bytes, { signal: cancelled.signal }),
    WordXmlSourceError,
    "CANCELLED",
  );
  const controller = new AbortController();
  const mapping = mapWordXmlSource(bytes, { signal: controller.signal });
  controller.abort();
  await assertRejects(() => mapping, WordXmlSourceError, "CANCELLED");
  await assertRejects(
    () => mapWordXmlSource(bytes, { deadline: 0 }),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
});

Deno.test("Word source enforces exact node and replacement boundaries", async () => {
  const exact = document(
    "<w:p><w:r>" + "<w:t>A</w:t>".repeat(WORD_XML_SOURCE_POLICY.maxTextNodes) +
      "</w:r></w:p>",
  );
  assertEquals(
    (await mapWordXmlSource(encode(exact))).nodes.length,
    WORD_XML_SOURCE_POLICY.maxTextNodes,
  );
  await assertRejects(
    () =>
      mapWordXmlSource(encode(exact.replace("</w:r>", "<w:t>B</w:t></w:r>"))),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
  const bytes = encode(document(paragraph("A")));
  const source = await mapWordXmlSource(bytes);
  const request = {
    version: source.version,
    originalSha256: source.originalSha256,
    patches: [{
      nodeId: "t:1",
      expectedText: "A",
      text: "B".repeat(WORD_XML_SOURCE_POLICY.maxReplacementChars),
    }],
  };
  const changed = await applyWordXmlSourcePatches(bytes, request);
  assertEquals(
    (await mapWordXmlSource(changed)).nodes[0]!.text.length,
    WORD_XML_SOURCE_POLICY.maxReplacementChars,
  );
  request.patches[0]!.text += "B";
  await assertRejects(
    () => applyWordXmlSourcePatches(bytes, request),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
  await assertRejects(
    () =>
      applyWordXmlSourcePatches(bytes, {
        ...request,
        patches: Array(WORD_XML_SOURCE_POLICY.maxPatches + 1).fill(
          request.patches[0],
        ),
      }),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
});

for (const mode of ["map", "no-op patch"] as const) {
  Deno.test(`Word source ${mode} fences abort between digest helper and public continuation`, async () => {
    const bytes = encode(document(paragraph("A")));
    const source = await mapWordXmlSource(bytes);
    const controller = new AbortController();
    const originalDigest = crypto.subtle.digest;
    crypto.subtle.digest = async function (algorithm, data) {
      const result = await originalDigest.call(this, algorithm, data);
      queueMicrotask(() => queueMicrotask(() => controller.abort()));
      return result;
    };
    try {
      await assertRejects(
        () =>
          mode === "map"
            ? mapWordXmlSource(bytes, { signal: controller.signal })
            : applyWordXmlSourcePatches(bytes, {
              version: source.version,
              originalSha256: source.originalSha256,
              patches: [],
            }, { signal: controller.signal }),
        WordXmlSourceError,
        "CANCELLED",
      );
    } finally {
      crypto.subtle.digest = originalDigest;
    }
  });
}

Deno.test("Word source distinguishes real processing instructions from literal comment/CDATA syntax", async () => {
  for (
    const before of [
      "<!-- retain <?example?> literally -->",
      "<w:p><w:r><w:t><![CDATA[<?literal?>]]></w:t></w:r></w:p>",
    ]
  ) {
    const bytes = encode(document(before + paragraph("Safe")));
    const source = await mapWordXmlSource(bytes);
    assertEquals(source.blockers, []);
    const node = source.nodes.find((node) => node.text === "Safe")!;
    const changed = await applyWordXmlSourcePatches(bytes, {
      version: source.version,
      originalSha256: source.originalSha256,
      patches: [{ nodeId: node.id, expectedText: "Safe", text: "Changed" }],
    });
    assertEquals(
      decode(changed),
      decode(bytes).replace("<w:t>Safe</w:t>", "<w:t>Changed</w:t>"),
    );
  }
  const source = await mapWordXmlSource(
    encode(document("<?actual instruction?>" + paragraph("A"))),
  );
  assertEquals(source.blockers, ["processing_instruction"]);
});

Deno.test("Word source accounts for the final combined output at the exact part limit", async () => {
  const small = document(paragraph("A") + paragraph("BB"));
  const xml = small.replace(
    "</w:body>",
    " ".repeat(WORD_XML_SOURCE_POLICY.maxPartBytes - encode(small).length) +
      "</w:body>",
  );
  const bytes = encode(xml);
  assertEquals(bytes.length, WORD_XML_SOURCE_POLICY.maxPartBytes);
  const source = await mapWordXmlSource(bytes);
  const changed = await applyWordXmlSourcePatches(bytes, {
    version: source.version,
    originalSha256: source.originalSha256,
    patches: [{ nodeId: "t:2", expectedText: "BB", text: "B" }, {
      nodeId: "t:1",
      expectedText: "A",
      text: "AA",
    }],
  });
  assertEquals(changed.length, WORD_XML_SOURCE_POLICY.maxPartBytes);
  assertEquals(
    decode(changed),
    xml.replace("<w:t>A</w:t>", "<w:t>AA</w:t>").replace(
      "<w:t>BB</w:t>",
      "<w:t>B</w:t>",
    ),
  );
});

Deno.test("Word source rejects one-over output characters and multibyte output bytes", async () => {
  const small = document(paragraph("A"));
  const bytes = encode(
    small.replace(
      "</w:body>",
      " ".repeat(WORD_XML_SOURCE_POLICY.maxPartBytes - encode(small).length) +
        "</w:body>",
    ),
  );
  const source = await mapWordXmlSource(bytes);
  for (const text of ["AB", "é"]) {
    await assertRejects(
      () =>
        applyWordXmlSourcePatches(bytes, {
          version: source.version,
          originalSha256: source.originalSha256,
          patches: [{ nodeId: "t:1", expectedText: "A", text }],
        }),
      WordXmlSourceError,
      "RESOURCE_LIMIT",
    );
  }
  const tooLarge = new Uint8Array(WORD_XML_SOURCE_POLICY.maxPartBytes + 1);
  await assertRejects(
    () => mapWordXmlSource(tooLarge),
    WordXmlSourceError,
    "RESOURCE_LIMIT",
  );
});
