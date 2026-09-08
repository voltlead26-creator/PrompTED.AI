// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  extractBoundedUploadText,
  extractBoundedUploadWithSource,
  extractBoundedUploadWithSourceV3,
  UploadExtractionError,
} from "./upload-extraction.ts";
import {
  DocumentSourceContractError,
  normalizeRtfSourceManifest,
  RTF_SOURCE_POLICY,
} from "./document-source-contract.ts";

const encode = (value: string) => new TextEncoder().encode(value);
const original = encode(
  String
    .raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Helvetica;}}\f0\fs24\b Caf\'e9 \u-10179?\u-8704?\b0\par}`,
);
const expectedText = "Café 😀";
const extract = (
  bytes = original,
  mime = "application/rtf",
  filename = "TextEdit.rtf",
  signal?: AbortSignal,
) => extractBoundedUploadWithSourceV3(bytes, filename, mime, signal);
async function sha(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

Deno.test("v3 reads the retained literal RTF MIME alias without changing source identity", async () => {
  for (const mime of ["rtf", " RTF ", "ｒｔｆ"]) {
    const result = await extract(original, mime);
    assertEquals(result.text, expectedText);
    assert(result.format === "rtf");
    assertEquals(result.sourceManifest.originalSha256, await sha(original));
    assertEquals(result.sourceManifest?.blockers, [
      RTF_SOURCE_POLICY.editingBlocker,
    ]);
  }
});

Deno.test("the v3 RTF alias cannot override a different filename, MIME parameter or document body", async () => {
  for (
    const filename of ["source.txt", "source.pdf", "source.docx", "source"]
  ) {
    await assertRejects(
      () => extract(original, "rtf", filename),
      UploadExtractionError,
      "UPLOAD_FORMAT_MISMATCH",
    );
  }
  for (const mime of ["rtf; charset=utf-8", "rtf-extra", "text/plain"]) {
    await assertRejects(
      () => extract(original, mime),
      UploadExtractionError,
      "UPLOAD_FORMAT_MISMATCH",
    );
  }
  for (
    const bytes of [
      encode("Ordinary text"),
      encode("%PDF-1.7\n"),
      encode(String.raw`{\rtf1\ansi Broken`),
    ]
  ) {
    await assertRejects(
      () => extract(bytes, "rtf"),
      UploadExtractionError,
      "UPLOAD_RTF_INVALID",
    );
  }
  await assertRejects(
    () =>
      extract(
        encode(String.raw`{\rtf1\ansi Paid \strike 500\strike0 50}`),
        "rtf",
      ),
    UploadExtractionError,
    "UPLOAD_RTF_CONTENT_UNSUPPORTED",
  );
});

Deno.test("v1 and v2 do not gain RTF admission from v3 alias compatibility", async () => {
  for (
    const old of [extractBoundedUploadText, extractBoundedUploadWithSource]
  ) {
    await assertRejects(
      () => old(original, "TextEdit.rtf", "rtf"),
      UploadExtractionError,
    );
  }
});

for (
  const mime of ["application/rtf", "text/rtf", "", "application/octet-stream"]
) {
  Deno.test(`prepared RTF producer binds original bytes and exact normalized wording for ${mime || "empty MIME"}`, async () => {
    const bytes = original.slice();
    const result = await extract(bytes, mime);
    assertEquals(result.format, "rtf");
    assertEquals(result.text, expectedText);
    assertEquals(result.truncated, false);
    assertEquals(result.resourcePolicyVersion, "upload-resource-policy.2");
    assertEquals(result.sourceManifest, {
      version: "rtf-source-manifest.1",
      assessment: "source_only",
      originalSha256: await sha(original),
      originalByteLength: original.length,
      extractedTextSha256: await sha(encode(expectedText)),
      blockers: ["rtf-format-preserving-editing-unverified"],
    });
    assertEquals(
      await normalizeRtfSourceManifest(result.sourceManifest, {
        contentSha256: await sha(original),
        byteLength: original.length,
        extractedText: result.text,
      }),
      result.sourceManifest,
    );
    assertEquals(bytes, original);
    assertEquals(Object.isFrozen(result.sourceManifest), true);
  });
}

Deno.test("RTF producer owns bytes before yielding and preserves v1/v2 admission", async () => {
  const bytes = original.slice();
  const pending = extract(bytes);
  bytes.fill(0);
  assertEquals((await pending).text, expectedText);
  for (
    const old of [extractBoundedUploadText, extractBoundedUploadWithSource]
  ) {
    await assertRejects(
      () => old(original, "TextEdit.rtf", "application/rtf"),
      UploadExtractionError,
      "UPLOAD_FORMAT_UNSUPPORTED",
    );
  }
  assertEquals(
    await extractBoundedUploadWithSource(
      encode("Text"),
      "old.md",
      "text/markdown",
    ),
    {
      text: "Text",
      format: "text",
      truncated: false,
      resourcePolicyVersion: "upload-resource-policy.1",
      sourceManifest: null,
    },
  );
  assertEquals(
    await extractBoundedUploadWithSourceV3(
      encode("Text"),
      "new.md",
      "text/markdown",
    ),
    {
      text: "Text",
      format: "text",
      truncated: false,
      resourcePolicyVersion: "upload-resource-policy.2",
      sourceManifest: null,
    },
  );
});

for (
  const [filename, mime] of [["false.txt", "text/plain"], [
    "real.rtf",
    "text/plain",
  ], ["false.pdf", "application/rtf"]]
) {
  Deno.test(`RTF producer refuses type downgrade ${filename}/${mime}`, async () => {
    const error = await assertRejects(
      () => extract(original, mime, filename),
      UploadExtractionError,
      "UPLOAD_FORMAT_MISMATCH",
    );
    assertEquals([error.status, error.retryable], [422, false]);
  });
}

for (
  const [body, code] of [
    [String.raw`{\rtf1\ansi A`, "UPLOAD_RTF_INVALID"],
    [String.raw`{\rtf1\ansi\ansicpg932 A}`, "UPLOAD_RTF_ENCODING_UNSUPPORTED"],
    [String.raw`{\rtf1\ansi A{\*\future B}}`, "UPLOAD_RTF_CONTENT_UNSUPPORTED"],
    [
      String.raw`{\rtf1\ansi Paid \strike 500\strike0 50}`,
      "UPLOAD_RTF_CONTENT_UNSUPPORTED",
    ],
    [String.raw`{\rtf1\ansi\u0?}`, "UPLOAD_RTF_INVALID"],
  ]
) {
  Deno.test(`RTF producer gives explicit permanent rejection ${code}`, async () => {
    const error = await assertRejects(
      () => extract(encode(body)),
      UploadExtractionError,
      code,
    );
    assertEquals([error.status, error.retryable], [422, false]);
  });
}

Deno.test("RTF producer differentiates structural limit and parser deadline", async () => {
  const oversized = encode(
    String.raw`{\rtf1\ansi ` + "A".repeat(1024 * 1024) + "}",
  );
  const limit = await assertRejects(
    () => extract(oversized),
    UploadExtractionError,
    "UPLOAD_RTF_RESOURCE_LIMIT",
  );
  assertEquals([limit.status, limit.retryable], [413, false]);
  const originalNow = Date.now;
  let calls = 0;
  const base = originalNow();
  // Deadline is set on call1. Expire after copy/scanner work has begun; no sleep.
  Date.now = () => base + (++calls > 7 ? 20_001 : 0);
  try {
    const deadline = await assertRejects(
      () => extract(),
      UploadExtractionError,
      "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
    );
    assertEquals([deadline.status, deadline.retryable], [503, true]);
  } finally {
    Date.now = originalNow;
  }
});

Deno.test("RTF producer rejects cancellation after asynchronous original hashing", async () => {
  const controller = new AbortController();
  const pending = extract(
    original,
    "application/rtf",
    "a.rtf",
    controller.signal,
  );
  controller.abort();
  const error = await assertRejects(
    () => pending,
    UploadExtractionError,
    "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
  );
  assertEquals([error.status, error.retryable], [503, true]);
});

Deno.test("RTF source digest binds surrogate-safe truncated preview and complete input validation", async () => {
  const prefix = "A".repeat(19_999);
  const input = String.raw`{\rtf1\ansi ` + prefix +
    String.raw`\u-10179?\u-8704?B}`;
  const result = await extract(encode(input));
  assertEquals([result.text, result.truncated], [prefix, true]);
  await normalizeRtfSourceManifest(result.sourceManifest, {
    contentSha256: await sha(encode(input)),
    byteLength: encode(input).length,
    extractedText: prefix,
  });
  await assertRejects(
    () => extract(encode(input.slice(0, -1) + String.raw`\field X}`)),
    UploadExtractionError,
    "UPLOAD_RTF_CONTENT_UNSUPPORTED",
  );
});

Deno.test("RTF manifest rejects unbound identities, altered wording, omitted blocker and private additions", async () => {
  const result = await extract();
  const binding = {
    contentSha256: await sha(original),
    byteLength: original.length,
    extractedText: expectedText,
  };
  for (
    const patch of [
      { version: "rtf-source-manifest.2" },
      { assessment: "format_preserved" },
      { originalSha256: "a".repeat(64) },
      { originalByteLength: original.length + 1 },
      { extractedTextSha256: "a".repeat(64) },
      { blockers: [] },
      { editRanges: [] },
    ]
  ) {
    await assertRejects(
      () =>
        normalizeRtfSourceManifest(
          { ...result.sourceManifest, ...patch },
          binding,
        ),
      DocumentSourceContractError,
      "INVALID",
    );
  }
  for (
    const extractedText of [
      "Different text",
      "\ud800",
      "A\u0000B",
      "A".repeat(20_001),
    ]
  ) {
    await assertRejects(
      () =>
        normalizeRtfSourceManifest(result.sourceManifest, {
          ...binding,
          extractedText,
        }),
      DocumentSourceContractError,
      "INVALID",
    );
  }
  const candidate = structuredClone(result.sourceManifest);
  const pending = normalizeRtfSourceManifest(candidate, binding);
  Object.assign(candidate!, { assessment: "format_preserved", blockers: [] });
  binding.extractedText = "Changed later";
  assertEquals((await pending).blockers, [RTF_SOURCE_POLICY.editingBlocker]);
  const controller = new AbortController();
  const cancelled = normalizeRtfSourceManifest(result.sourceManifest, {
    ...binding,
    extractedText: expectedText,
    signal: controller.signal,
  });
  controller.abort();
  await assertRejects(
    () => cancelled,
    DocumentSourceContractError,
    "CANCELLED",
  );
});
