// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert@1";
import {
  BOUNDED_XML_POLICY,
  BoundedXmlError,
  decodeBoundedXmlText,
  localXmlName,
  scanBoundedXml,
} from "./bounded-xml.ts";

Deno.test("bounded XML scanner emits decoded, qualified-name events in one pass", () => {
  const events: string[] = [];
  scanBoundedXml(
    '<?xml version="1.0"?><w:p data="A &amp; B"><w:t>Hello &#x1F44B;</w:t><w:br/></w:p>',
    (event) => {
      if (event.kind === "start") {
        events.push(
          `start:${localXmlName(event.name)}:${
            event.attributes.get("data") ?? ""
          }`,
        );
      } else if (event.kind === "end") {
        events.push(`end:${localXmlName(event.name)}`);
      } else if (event.text.trim()) events.push(`text:${event.text}`);
    },
  );
  assertEquals(events, [
    "start:p:A & B",
    "start:t:",
    "text:Hello 👋",
    "end:t",
    "start:br:",
    "end:br",
    "end:p",
  ]);
});

Deno.test("bounded XML rejects DTDs, external entities, and invalid Unicode scalars", () => {
  assertThrows(
    () =>
      scanBoundedXml(
        '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
        () => {},
      ),
    BoundedXmlError,
    "BOUNDED_XML_UNSAFE",
  );
  assertThrows(
    () => decodeBoundedXmlText("&#x110000;"),
    BoundedXmlError,
    "BOUNDED_XML_INVALID",
  );
  assertThrows(
    () => decodeBoundedXmlText("&#0;"),
    BoundedXmlError,
    "BOUNDED_XML_INVALID",
  );
});

Deno.test("bounded XML stops on exact depth and input budgets", async () => {
  const exactDepth = "<x>".repeat(BOUNDED_XML_POLICY.maxDepth) +
    "</x>".repeat(BOUNDED_XML_POLICY.maxDepth);
  scanBoundedXml(exactDepth, () => {});
  assertThrows(
    () =>
      scanBoundedXml(
        "<x>".repeat(BOUNDED_XML_POLICY.maxDepth + 1) +
          "</x>".repeat(BOUNDED_XML_POLICY.maxDepth + 1),
        () => {},
      ),
    BoundedXmlError,
    "BOUNDED_XML_RESOURCE_LIMIT",
  );
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        scanBoundedXml(
          `<x>${"a".repeat(BOUNDED_XML_POLICY.maxInputChars)}</x>`,
          () => {},
        )
      ),
    BoundedXmlError,
    "BOUNDED_XML_RESOURCE_LIMIT",
  );
});

Deno.test("bounded XML locations identify exact original tokens without rewriting event contracts", () => {
  const xml = '<?xml version="1.0"?><w:p data="a > b">' +
    "<!-- retained comment --><w:t>Hi 👋 &amp; all</w:t>" +
    "<w:t><![CDATA[<literal>]]></w:t><w:br/></w:p>";
  const observed: Array<{ kind: string; raw: string; syntax: string }> = [];
  const events: unknown[] = [];
  scanBoundedXml(xml, (event, location?: {
    start: number;
    end: number;
    syntax: string;
  }) => {
    if (!location) throw new Error("XML_SOURCE_LOCATION_MISSING");
    observed.push({
      kind: event.kind,
      raw: xml.slice(location.start, location.end),
      syntax: location.syntax,
    });
    events.push(event);
  });
  assertEquals(observed, [
    { kind: "start", raw: '<w:p data="a > b">', syntax: "tag" },
    { kind: "start", raw: "<w:t>", syntax: "tag" },
    { kind: "text", raw: "Hi 👋 &amp; all", syntax: "text" },
    { kind: "end", raw: "</w:t>", syntax: "tag" },
    { kind: "start", raw: "<w:t>", syntax: "tag" },
    { kind: "text", raw: "<literal>", syntax: "cdata" },
    { kind: "end", raw: "</w:t>", syntax: "tag" },
    { kind: "start", raw: "<w:br/>", syntax: "tag" },
    { kind: "end", raw: "", syntax: "synthetic" },
    { kind: "end", raw: "</w:p>", syntax: "tag" },
  ]);
  assertEquals(events[2], { kind: "text", text: "Hi 👋 & all" });
  assertEquals(events[5], { kind: "text", text: "<literal>" });
});

Deno.test("bounded XML source locations distinguish repeated text after multibyte characters", () => {
  const xml = "<r>👋<t>same</t><t>same</t></r>\n";
  const repeated: number[] = [];
  let tail: unknown;
  scanBoundedXml(
    xml,
    (event, location?: { start: number; end: number; syntax: string }) => {
      if (!location) throw new Error("XML_SOURCE_LOCATION_MISSING");
      if (event.kind === "text" && event.text === "same") {
        repeated.push(
          location.start,
        );
      }
      if (event.kind === "text" && event.text === "\n") tail = location;
    },
  );
  assertEquals(repeated, [8, 19]);
  assertEquals(tail, {
    start: xml.length - 1,
    end: xml.length,
    syntax: "text",
  });
});

for (
  const [name, xml] of [
    ["raw control", "<r>bad\u0000</r>"],
    ["lone surrogate", "<r>\ud800</r>"],
    ["CDATA control", "<r><![CDATA[\u0001]]></r>"],
    ["attribute less-than", '<r a="<x>"/>'],
    ["adjacent attributes", '<r a="1"b="2"/>'],
    ["non-XML tag whitespace", '<r\u00a0a="1"/>'],
    ["leading tag whitespace", "< r/>"],
    ["spaced self-close delimiter", "<r/ >"],
    ["spaced closing name", "<r></ r>"],
    ["non-XML outer whitespace", "\u00a0<r/>"],
    ["double-hyphen comment", "<r><!--a--b--></r>"],
    ["trailing-hyphen comment", "<r><!--a---></r>"],
    ["uppercase numeric reference marker", "<r>&#X41;</r>"],
    ["unescaped CDATA terminator", "<r>bad]]>text</r>"],
    ["outer whitespace CDATA", "<![CDATA[ ]]><r/>"],
    ["outer empty CDATA", "<r/><![CDATA[]]>"],
    ["missing PI target", "<??><r/>"],
    ["invalid PI target", "<?1bad?><r/>"],
    ["missing PI separator", "<?target?data?><r/>"],
    [
      "nested XML declaration",
      '<?xml version="1.0"?><r><?xml version="1.0"?></r>',
    ],
    ["misplaced XML declaration", '<!--before--><?xml version="1.0"?><r/>'],
    ["case-variant XML declaration", '<?XML version="1.0"?><r/>'],
    ["missing declaration version", '<?xml encoding="UTF-8"?><r/>'],
    [
      "duplicate declaration attribute",
      '<?xml version="1.0" encoding="UTF-8" encoding="UTF-8"?><r/>',
    ],
    [
      "declaration attribute order",
      '<?xml version="1.0" standalone="yes" encoding="UTF-8"?><r/>',
    ],
  ] as const
) {
  Deno.test(`bounded XML rejects invalid source syntax: ${name}`, () => {
    assertThrows(
      () => scanBoundedXml(xml, () => {}),
      BoundedXmlError,
      "BOUNDED_XML_INVALID",
    );
  });
}

Deno.test("bounded XML enforces the exact attribute value limit before decoding", () => {
  scanBoundedXml(
    `<r a="${"x".repeat(BOUNDED_XML_POLICY.maxAttributeValueChars)}"/>`,
    () => {},
  );
  assertThrows(
    () =>
      scanBoundedXml(
        `<r a="${"x".repeat(BOUNDED_XML_POLICY.maxAttributeValueChars + 1)}"/>`,
        () => {},
      ),
    BoundedXmlError,
    "BOUNDED_XML_RESOURCE_LIMIT",
  );
});

Deno.test("bounded XML counts a self-closing leaf in the exact depth limit", () => {
  const allowed = "<r>".repeat(BOUNDED_XML_POLICY.maxDepth - 1) + "<leaf/>" +
    "</r>".repeat(BOUNDED_XML_POLICY.maxDepth - 1);
  scanBoundedXml(allowed, () => {});
  const rejected = `<r>${allowed}</r>`;
  assertThrows(
    () => scanBoundedXml(rejected, () => {}),
    BoundedXmlError,
    "BOUNDED_XML_RESOURCE_LIMIT",
  );
});

Deno.test("bounded XML retains valid declarations, literal source and escaped delimiters", () => {
  const text: string[] = [];
  scanBoundedXml(
    `<?xml version='1.0' encoding="utf-8" standalone='no' ?>\n<?app source?>` +
      `<r a="&lt;tag&gt;">&#x41;&#65;&lt;]]&gt;<?inner payload?><!-- retained --></r><?after?>`,
    (event) => {
      if (event.kind === "text" && event.text.trim()) text.push(event.text);
    },
  );
  assertEquals(text, ["AA<]]>"]);
});

Deno.test("bounded XML propagates an exact visitor error before any further events", () => {
  const sentinel = new Error("SOURCE_MAPPING_CANCELLED");
  const seen: string[] = [];
  const thrown = assertThrows(() =>
    scanBoundedXml("<r>hello<t/>after</r>", (event, source) => {
      seen.push(event.kind);
      assertEquals(source.start >= 0 && source.end > source.start, true);
      if (event.kind === "text") throw sentinel;
    })
  );
  assertStrictEquals(thrown, sentinel);
  assertEquals(seen, ["start", "text"]);
});

Deno.test("bounded XML normalises only literal XML whitespace while preserving raw locations", () => {
  const xml = '\ufeff<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<r a="one\r\ntwo\tthree&#xD;&#x9;">a\r\nb\rc&#xD;<![CDATA[d\r\ne]]></r>';
  const text: string[] = [];
  const raw: string[] = [];
  let attribute = "";
  scanBoundedXml(xml, (event, location) => {
    if (event.kind === "start") attribute = event.attributes.get("a") ?? "";
    if (event.kind === "text") {
      text.push(event.text);
      raw.push(xml.slice(location.start, location.end));
    }
  });
  assertEquals(attribute, "one two three\r\t");
  assertEquals(text, ["a\nb\nc\r", "d\ne"]);
  assertEquals(raw, ["a\r\nb\rc&#xD;", "d\r\ne"]);
});

for (
  const [name, token] of [
    ["comments", "<!--x-->"],
    ["processing instructions", "<?x?>"],
    ["empty CDATA", "<![CDATA[]]>"],
  ] as const
) {
  Deno.test(`bounded XML counts ${name} against its work budget`, () => {
    const exact = `<r>${token.repeat(BOUNDED_XML_POLICY.maxTokens - 2)}</r>`;
    scanBoundedXml(exact, () => {});
    assertThrows(
      () => scanBoundedXml(`<r>${token}${exact.slice(3)}`, () => {}),
      BoundedXmlError,
      "BOUNDED_XML_RESOURCE_LIMIT",
    );
  });
}

Deno.test("bounded XML observes only lexical PIs with exact source and preserves observer errors", () => {
  const xml = '<?xml version="1.0"?><!-- <?comment?> -->' +
    "<r><![CDATA[<?literal?>]]><?real data?></r>";
  const observed: string[] = [];
  scanBoundedXml(xml, () => {}, {
    onProcessingInstruction: (target, range) =>
      observed.push(`${target}:${xml.slice(range.start, range.end)}`),
  });
  assertEquals(observed, ['xml:<?xml version="1.0"?>', "real:<?real data?>"]);
  const sentinel = new Error("observer stopped");
  const events: string[] = [];
  assertStrictEquals(
    assertThrows(() =>
      scanBoundedXml("<r><?stop?><later/></r>", (event) => {
        events.push(event.kind);
      }, {
        onProcessingInstruction: () => {
          throw sentinel;
        },
      })
    ),
    sentinel,
  );
  assertEquals(events, ["start"]);
});
