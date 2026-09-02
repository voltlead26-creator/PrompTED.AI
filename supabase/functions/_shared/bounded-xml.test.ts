// deno-lint-ignore-file no-import-prefix
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import {
  BOUNDED_XML_POLICY,
  BoundedXmlError,
  decodeBoundedXmlText,
  localXmlName,
  scanBoundedXml,
} from "./bounded-xml.ts";

Deno.test("bounded XML scanner emits decoded, namespace-aware events in one pass", () => {
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
