import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  parseIngestUploadConfirmPayload,
  parseWorkspaceUploadDetail,
  parseWorkspaceUploadPage,
  preflightUploadMetadata,
  UPLOAD_ACCEPT_ATTRIBUTE,
} from "./ingest-upload";

describe("owner-bound workspace original reads", () => {
  const owner = "95071240-0000-4000-8000-000000000001";
  const id = "95071240-0000-8000-8000-000000000011";
  const row = {
    upload_id: id, file_name: "<script>source</script>.pdf", mime_type: "application/pdf",
    byte_length: 120, created_at: "2026-09-07T01:02:03.123456+00:00",
    status: "failed", ingest_status: "failed", format: "pdf",
    original: { storage_path: `${owner}/${id}/source.pdf`, sha256: "a".repeat(64) },
    imported_document: null,
  };
  const detail = { version: "workspace-upload.1", owner_user_id: owner,
    source: { ...row, preview: { text: "  <script>inert preview</script>\n", truncated: null } } };
  it("preserves preview whitespace, historical uncertainty and an available failed-upload original", () => {
    expect(parseWorkspaceUploadDetail(detail, owner, id)).toEqual(detail.source);
  });
  it("distinguishes a confirmed missing record from malformed data", () => {
    expect(parseWorkspaceUploadDetail({ ...detail, source: null }, owner, id)).toBeNull();
    expect(() => parseWorkspaceUploadDetail(null, owner, id)).toThrow("WORKSPACE_UPLOAD_INVALID_RESPONSE");
  });
  it("accepts a whole 20000-code-point astral preview", () => {
    const source = { ...detail.source, preview: { text: "😀".repeat(20000), truncated: true } };
    expect(parseWorkspaceUploadDetail({ ...detail, source }, owner, id)?.preview).toEqual(source.preview);
  });
  it.each([
    { ...detail, owner_user_id: id },
    { ...detail, version: "workspace-upload.2" },
    { ...detail, secret: "not permitted" },
    { ...detail, source: { ...detail.source, upload_id: owner } },
    { ...detail, source: { ...detail.source, format: "editable_pdf" } },
    { ...detail, source: { ...detail.source, format: ["pdf"] } },
    { ...detail, source: { ...detail.source, status: ["failed"] } },
    { ...detail, source: { ...detail.source, byte_length: -1 } },
    { ...detail, source: { ...detail.source, created_at: "invalid" } },
    { ...detail, source: { ...detail.source, ingest_status: "ready" } },
    { ...detail, source: { ...detail.source, original: { ...row.original, storage_path: `${id}/source.pdf` } } },
    { ...detail, source: { ...detail.source, original: { ...row.original, storage_path: `${owner}/../source.pdf` } } },
    { ...detail, source: { ...detail.source, original: { ...row.original, sha256: "invented" } } },
    { ...detail, source: { ...detail.source, preview: { text: "😀".repeat(20001), truncated: true } } },
    { ...detail, source: { ...detail.source, preview: { text: "preview", truncated: "false" } } },
    { ...detail, source: { ...detail.source, ingest_source_manifest: {} } },
  ])("rejects malformed, unowned or excessive detail %#", (input) => {
    expect(() => parseWorkspaceUploadDetail(input, owner, id)).toThrow("WORKSPACE_UPLOAD_INVALID_RESPONSE");
  });
  it("retains the precise cursor string for paging without Date rounding", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ ...row,
      upload_id: `95071240-0000-4000-8000-${String(index + 10).padStart(12, "0")}` }));
    const last = items.at(-1);
    if (!last) throw new Error("Missing page fixture");
    const next_cursor = { upload_id: last.upload_id, created_at: row.created_at };
    expect(parseWorkspaceUploadPage({ version: detail.version, owner_user_id: owner, items, next_cursor }, owner))
      .toEqual({ items, next_cursor });
  });
  it.each([
    { items: [row, row], next_cursor: null },
    { items: [row], next_cursor: { upload_id: id, created_at: row.created_at } },
    { items: Array(21).fill(row), next_cursor: null },
    { items: [{ ...row, preview: detail.source.preview }], next_cursor: null },
  ])("rejects duplicate, excessive or inconsistent pages %#", (page) => {
    expect(() => parseWorkspaceUploadPage({ version: detail.version, owner_user_id: owner, ...page }, owner))
      .toThrow("WORKSPACE_UPLOAD_INVALID_RESPONSE");
  });
});

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

  it("accepts truncated text ending before a supplementary character and its durable receipt", () => {
    const extracted = "A".repeat(19_999);
    const truncated = { ...payload, char_count: extracted.length, truncated: true };
    expect(parseIngestUploadConfirmPayload(truncated, "source.pdf", extracted)).toEqual(truncated);
    expect(parseIngestUploadConfirmPayload(truncated, "source.pdf", null)).toEqual(truncated);
  });

  it("accepts the exact extracted count after bounded text whitespace cleanup", () => {
    const truncated = { ...payload, truncated: true };
    expect(parseIngestUploadConfirmPayload(truncated, "source.pdf", text)).toEqual(truncated);
    expect(() => parseIngestUploadConfirmPayload({ ...truncated, char_count: text.length + 1 },
      "source.pdf", text)).toThrow("UPLOAD_CONFIRMATION_INVALID");
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
