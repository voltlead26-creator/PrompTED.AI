// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  extractBoundedUploadText,
  extractBoundedUploadWithSource,
  MAX_TEXT_UPLOAD_BYTES,
  resolveUploadFormat,
  UploadExtractionError,
} from "./upload-extraction.ts";
import { requestIsolatedUploadExtraction } from "./upload-extraction-client.ts";
import {
  handleExtractUpload,
  type UploadExtractorDependencies,
} from "../extract-upload/handler.ts";
import { parseIngestUploadConfirmPayload } from "../../../packages/shared/src/ingest-upload.ts";

// Synthetic equivalents of BOM-marked Unicode text saved by TextEdit. The
// expected string includes two-byte and surrogate-pair characters deliberately.
const wording = "TextEdit notes\nRenée — 日本語 😀\nKeep this wording.";
function utf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0xfeff, littleEndian);
  for (let index = 0; index < text.length; index++) {
    view.setUint16(2 + index * 2, text.charCodeAt(index), littleEndian);
  }
  return bytes;
}

for (const littleEndian of [true, false]) {
  const encoding = littleEndian ? "UTF-16LE" : "UTF-16BE";
  for (
    const [filename, mime] of [
      ["TextEdit.txt", "text/plain"],
      ["TextEdit.txt", "application/octet-stream"],
      ["Notes.md", "text/markdown"],
      ["Notes.csv", "text/csv"],
    ]
  ) {
    Deno.test(`${encoding} ${filename} extracts the exact text and preserves original bytes`, async () => {
      const bytes = utf16(wording, littleEndian);
      const original = Uint8Array.from(bytes);
      assertEquals(await resolveUploadFormat(bytes, filename, mime), "text");
      const result = await extractBoundedUploadText(bytes, filename, mime);
      assertEquals(result.text, wording);
      assertEquals(result.format, "text");
      assertEquals(result.truncated, false);
      const source = await extractBoundedUploadWithSource(
        bytes,
        filename,
        mime,
      );
      assertEquals(source.text, wording);
      assertEquals(source.sourceManifest, null);
      assertEquals(bytes, original);
    });
  }
}

for (
  const [label, bytes] of [
    ["odd-length LE", new Uint8Array([0xff, 0xfe, 0x41])],
    ["odd-length BE", new Uint8Array([0xfe, 0xff, 0x00])],
    ["lone high surrogate", new Uint8Array([0xff, 0xfe, 0x00, 0xd8])],
    ["lone low surrogate", new Uint8Array([0xfe, 0xff, 0xdc, 0x00])],
    [
      "high surrogate followed by ordinary LE character",
      utf16("\ud800X", true),
    ],
    [
      "high surrogate followed by ordinary BE character",
      utf16("\ud800X", false),
    ],
    ["decoded NUL", utf16("Before\u0000After", true)],
    ["missing BOM", utf16("Before", false).subarray(2)],
    ["invalid UTF-8", new Uint8Array([0xc3, 0x28])],
    [
      "UTF-32LE",
      new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00]),
    ],
    [
      "UTF-32BE",
      new Uint8Array([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x41]),
    ],
  ] as const
) {
  Deno.test(`rejects ${label} instead of replacing or deleting malformed text`, async () => {
    const error = await assertRejects(
      () => extractBoundedUploadText(bytes, "TextEdit.txt", "text/plain"),
      UploadExtractionError,
      "UPLOAD_TEXT_ENCODING_INVALID",
    );
    assertEquals(error.status, 422);
  });
}

Deno.test("UTF-16 retains the exact original-byte ceiling", async () => {
  const bytes = utf16("A".repeat((MAX_TEXT_UPLOAD_BYTES - 2) / 2), true);
  assertEquals(bytes.byteLength, MAX_TEXT_UPLOAD_BYTES);
  const result = await extractBoundedUploadText(
    bytes,
    "TextEdit.txt",
    "text/plain",
  );
  assertEquals(result.text, "A".repeat(20_000));
  assertEquals(result.truncated, true);
  const error = await assertRejects(
    () =>
      extractBoundedUploadText(
        new Uint8Array(MAX_TEXT_UPLOAD_BYTES + 1),
        "TextEdit.txt",
        "text/plain",
      ),
    UploadExtractionError,
    "UPLOAD_TEXT_RESOURCE_LIMIT",
  );
  assertEquals(error.status, 413);
});

Deno.test("UTF-16 extraction owns bytes before asynchronous continuation and honours cancellation", async () => {
  const bytes = utf16(wording, true);
  const pending = extractBoundedUploadText(bytes, "TextEdit.txt", "text/plain");
  bytes.fill(0);
  assertEquals((await pending).text, wording);
  const controller = new AbortController();
  const cancelled = extractBoundedUploadText(
    utf16(wording, false),
    "TextEdit.txt",
    "text/plain",
    controller.signal,
  );
  controller.abort();
  await assertRejects(
    () => cancelled,
    UploadExtractionError,
    "UPLOAD_EXTRACTION_RESOURCE_UNAVAILABLE",
  );
});

for (
  const [encoding, encode] of [
    ["UTF-8", (text: string) => new TextEncoder().encode(text)],
    ["UTF-16", (text: string) => utf16(text, true)],
  ] as const
) {
  Deno.test(`${encoding} truncation stops before a whole supplementary character`, async () => {
    const prefix = "A".repeat(19_999);
    const result = await extractBoundedUploadText(
      encode(`${prefix}😀Z`),
      "TextEdit.txt",
      "text/plain",
    );
    assertEquals(result.text, prefix);
    assertEquals(result.truncated, true);
    assert(!result.text.includes("\ufffd"));
  });
  Deno.test(`${encoding} preserves a supplementary character that fits the exact output ceiling`, async () => {
    const expected = `${"A".repeat(19_998)}😀`;
    for (const suffix of ["", "Z"]) {
      const result = await extractBoundedUploadText(
        encode(expected + suffix),
        "TextEdit.txt",
        "text/plain",
      );
      assertEquals(result.text, expected);
      assertEquals(result.text.length, 20_000);
      assertEquals(result.truncated, suffix.length > 0);
    }
  });
}

Deno.test("UTF-8 BOM compatibility and empty UTF-16 text remain explicit", async () => {
  const utf8 = new TextEncoder().encode(wording);
  const withBom = new Uint8Array(3 + utf8.length);
  withBom.set([0xef, 0xbb, 0xbf]);
  withBom.set(utf8, 3);
  assertEquals(
    (await extractBoundedUploadText(withBom, "TextEdit.txt", "text/plain"))
      .text,
    wording,
  );
  for (const littleEndian of [true, false]) {
    const result = await extractBoundedUploadText(
      utf16("", littleEndian),
      "TextEdit.txt",
      "text/plain",
    );
    assertEquals(result.text, "");
    assertEquals(result.truncated, false);
  }
});

for (const version of ["upload-extraction.1", "upload-extraction.2"] as const) {
  for (const longText of [false, true]) {
    Deno.test(`${version} carries UTF-16 through the real extractor/client and confirmation boundaries (${longText ? "truncated" : "complete"})`, async () => {
      const expected = longText ? "A".repeat(19_999) : wording;
      const bytes = utf16(longText ? `${expected}😀Z` : wording, !longText);
      const original = Uint8Array.from(bytes);
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", original)),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const identity = {
        uploadId: "72000000-0000-8000-8000-000000000002",
        userId: "71000000-0000-4000-8000-000000000002",
        claimToken: "73000000-0000-4000-8000-000000000002",
        requestSha256: "c".repeat(64),
      };
      const runtime = {
        baseUrl: "http://127.0.0.1:54321",
        serviceRoleKey: "synthetic-text-test-key",
        timeoutMs: 1_000,
      };
      let reads = 0;
      const deps: UploadExtractorDependencies = {
        serviceRoleKey: runtime.serviceRoleKey,
        loadSnapshot: () =>
          Promise.resolve({
            ...identity,
            storagePath: `${identity.userId}/${identity.uploadId}/TextEdit.txt`,
            filename: "TextEdit.txt",
            fileType: "text/plain",
            byteLength: bytes.byteLength,
            contentSha256: digest,
            stage: "storage_completed",
            extractionContractVersion: version,
          }),
        readOriginal: () => {
          reads += 1;
          return Promise.resolve(bytes);
        },
        extract: extractBoundedUploadText,
        extractWithSource: extractBoundedUploadWithSource,
      };
      const fetcher = (url: string | URL | Request, init?: RequestInit) =>
        handleExtractUpload(new Request(url, init), deps);
      const result = version === "upload-extraction.2"
        ? await requestIsolatedUploadExtraction(
          {
            ...identity,
            extractionContractVersion: version,
            expectedContentSha256: digest,
            expectedByteLength: bytes.byteLength,
          },
          runtime,
          fetcher,
        )
        : await requestIsolatedUploadExtraction(identity, runtime, fetcher);
      assertEquals(result.text, expected);
      assertEquals(result.format, "text");
      assertEquals(result.contentSha256, digest);
      assertEquals(result.truncated, longText);
      if (version === "upload-extraction.2") {
        assert("sourceManifest" in result);
        assertEquals(result.sourceManifest, null);
        assert("contentByteLength" in result);
        assertEquals(result.contentByteLength, original.byteLength);
      } else {
        assert(!("sourceManifest" in result));
      }
      const confirmation = {
        summary: "Retained TextEdit notes.",
        document_type: "notes",
        structure: [{ title: "Notes", items: [] }],
        filename: "TextEdit.txt",
        char_count: result.text.length,
        truncated: result.truncated,
      };
      assertEquals(
        parseIngestUploadConfirmPayload(
          confirmation,
          "TextEdit.txt",
          result.text,
        ),
        confirmation,
      );
      assertEquals(reads, 1);
      assertEquals(bytes, original);
    });
  }
}
