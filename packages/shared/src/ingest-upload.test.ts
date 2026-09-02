import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  parseIngestUploadConfirmPayload,
  preflightUploadMetadata,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "./ingest-upload";

describe("preflightUploadMetadata", () => {
  it.each([
    ["source.pdf", "application/pdf", MAX_UPLOAD_BYTES, "pdf"],
    [
      "source.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      MAX_UPLOAD_BYTES,
      "docx",
    ],
    [
      "source.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      MAX_UPLOAD_BYTES,
      "xlsx",
    ],
    ["source.TXT", "text/plain", MAX_TEXT_UPLOAD_BYTES, "text"],
    ["source.md", "application/markdown", MAX_TEXT_UPLOAD_BYTES, "text"],
    ["source.csv", "application/vnd.ms-excel", MAX_TEXT_UPLOAD_BYTES, "text"],
    ["source.docx", "application/zip", 1, "docx"],
    ["source.xlsx", "application/x-zip-compressed", 1, "xlsx"],
    ["source.md", "text/x-markdown", 1, "text"],
    ["source.csv", "", 1, "text"],
  ])("accepts %s at its exact supported boundary", (fileName, mimeType, byteLength, format) => {
    expect(preflightUploadMetadata({ fileName, mimeType, byteLength })).toEqual({
      ok: true,
      format,
      maximumBytes: format === "text" ? MAX_TEXT_UPLOAD_BYTES : MAX_UPLOAD_BYTES,
    });
  });

  it.each([
    ["source.txt", "text/plain", MAX_TEXT_UPLOAD_BYTES + 1, "UPLOAD_TEXT_RESOURCE_LIMIT"],
    ["source.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1, "UPLOAD_TOO_LARGE"],
    ["source.docm", "application/pdf", 1, "UPLOAD_LEGACY_FORMAT_UNSUPPORTED"],
    ["source.xlsm", "text/plain", 1, "UPLOAD_LEGACY_FORMAT_UNSUPPORTED"],
    ["source.exe", "text/plain", 1, "UPLOAD_FORMAT_UNSUPPORTED"],
    ["source.pdf", "text/plain", 1, "UPLOAD_FORMAT_MISMATCH"],
    ["source.txt", "application/vnd.ms-excel", 1, "UPLOAD_FORMAT_MISMATCH"],
    ["source.csv", "text/csv", 0, "UPLOAD_FILE_EMPTY"],
  ])("rejects invalid metadata for %s", (fileName, mimeType, byteLength, code) => {
    expect(preflightUploadMetadata({ fileName, mimeType, byteLength })).toMatchObject({
      ok: false,
      code,
    });
  });

  it("exposes supported picker extensions without legacy or generic ZIP formats", () => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain(".xlsx");
    expect(UPLOAD_ACCEPT_ATTRIBUTE).not.toMatch(/\.docm|\.xlsm|application\/zip/);
  });
});

describe("parseIngestUploadConfirmPayload", () => {
  const text = "Confirmed source text.";
  const payload = {
    summary: "A concise source document.",
    document_type: "source document",
    structure: [{ title: "Details", items: ["Confirmed fact"] }],
    filename: "source.pdf",
    char_count: text.length,
    truncated: false,
  };

  it("supports both direct extraction and withheld durable snapshots", () => {
    expect(parseIngestUploadConfirmPayload(payload, "source.pdf", text)).toEqual(payload);
    expect(parseIngestUploadConfirmPayload(payload, "source.pdf", null)).toEqual(payload);
  });

  it.each([
    ["wrong filename", { filename: "other.pdf" }],
    ["bad count", { char_count: 0 }],
    ["oversized count", { char_count: 20_001 }],
    ["empty structure", { structure: [] }],
    ["blank item", { structure: [{ title: "Details", items: [""] }] }],
  ])("rejects a %s", (_label, replacement) => {
    expect(() =>
      parseIngestUploadConfirmPayload(
        { ...payload, ...replacement },
        "source.pdf",
        null,
      ),
    ).toThrow("UPLOAD_CONFIRMATION_INVALID");
  });
});
