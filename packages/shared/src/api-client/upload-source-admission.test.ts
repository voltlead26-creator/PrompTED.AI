import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_TEXT_UPLOAD_BYTES, preflightUploadMetadata, preflightUploadMetadataV2,
  UPLOAD_ACCEPT_ATTRIBUTE, UPLOAD_ACCEPT_ATTRIBUTE_V2,
  UPLOAD_RESOURCE_POLICY_VERSION, UPLOAD_RESOURCE_POLICY_VERSION_V2,
} from "../ingest-upload";
import { configureApiClient, ingestUpload, type IngestUploadOptions } from "./index";

const owner = "11111111-1111-4111-8111-111111111111";
const v2 = "upload-resource-policy.2";
const context = () => ({ expectedUserId: owner, principalEpoch: 1,
  signal: new AbortController().signal, assertCurrent() {} });
beforeEach(() => configureApiClient({ baseUrl: "https://upload.test/api",
  getToken: () => `header.${btoa(JSON.stringify({ sub: owner }))}.signature` }));
afterEach(() => { vi.unstubAllGlobals(); configureApiClient({ baseUrl: "/api" }); });

describe("explicit source metadata policy", () => {
  it("keeps the frozen legacy policy and picker while exposing the new policy", () => {
    expect(UPLOAD_RESOURCE_POLICY_VERSION).toBe("upload-resource-policy.1");
    expect(UPLOAD_RESOURCE_POLICY_VERSION_V2).toBe(v2);
    expect(UPLOAD_ACCEPT_ATTRIBUTE.split(",")).not.toContain(".rtf");
    expect(UPLOAD_ACCEPT_ATTRIBUTE_V2.split(",")).toEqual(expect.arrayContaining([".rtf", "application/rtf", "text/rtf"]));
    expect(preflightUploadMetadata({ fileName: "source.rtf", mimeType: "application/rtf", byteLength: 20 }))
      .toMatchObject({ ok: false, code: "UPLOAD_FORMAT_UNSUPPORTED" });
  });
  it.each(["", "application/octet-stream", "binary/octet-stream", "application/rtf", "text/rtf", "rtf"])
    ("accepts RTF at exactly 1 MiB with supported MIME %s", mimeType => {
      expect(preflightUploadMetadataV2({ fileName: "Source.RTF", mimeType, byteLength: MAX_TEXT_UPLOAD_BYTES }))
        .toEqual({ ok: true, format: "rtf", maximumBytes: MAX_TEXT_UPLOAD_BYTES });
    });
  it.each(["text/plain", "application/x-rtf", "text/richtext", "application/rtf; charset=utf-8"])
    ("rejects unsupported RTF MIME %s", mimeType => {
      expect(preflightUploadMetadataV2({ fileName: "source.rtf", mimeType, byteLength: 20 }))
        .toMatchObject({ ok: false, code: "UPLOAD_FORMAT_MISMATCH" });
    });
  it("enforces the RTF byte ceiling and invalid-size guard", () => {
    expect(preflightUploadMetadataV2({ fileName: "source.rtf", mimeType: "text/rtf", byteLength: MAX_TEXT_UPLOAD_BYTES + 1 }))
      .toMatchObject({ ok: false, maximumBytes: MAX_TEXT_UPLOAD_BYTES, message: "RTF files need to be 1MB or smaller." });
    for (const byteLength of [0, -1, NaN, 1.2]) expect(preflightUploadMetadataV2({ fileName: "source.rtf", mimeType: "text/rtf", byteLength }))
      .toMatchObject({ ok: false, code: "UPLOAD_FILE_EMPTY" });
  });
  it.each(["source.pdf", "source.docx", "source.xlsx", "source.txt", "source.md", "source.csv", "source.exe"])
    ("preserves prior metadata results for %s", fileName => {
      for (const byteLength of [0, 1, MAX_TEXT_UPLOAD_BYTES + 1, 8 * MAX_TEXT_UPLOAD_BYTES + 1]) {
        const input = { fileName, mimeType: "", byteLength };
        expect(preflightUploadMetadataV2(input)).toEqual(preflightUploadMetadata(input));
      }
    });
});

function respond(text: string, mutate: (body: Record<string, unknown>) => void = () => {}) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const form = await new Request(url, init).formData();
    const file = form.get("file") as File;
    const extension = file.name.split(".").at(-1) ?? "";
    expect(Array.from(form.keys()).sort()).toEqual(["file", "request_id", "upload_id"]);
    const body: Record<string, unknown> = {
      upload_id: form.get("upload_id"), extracted_text: text, original_retained: true,
      storage_path: `${owner}/${form.get("upload_id")}/${file.name}`,
      classification_status: "completed", extraction_format: ["pdf", "docx", "xlsx", "rtf"].includes(extension) ? extension : "text",
      resource_policy_version: v2,
      confirm_payload: { filename: file.name, summary: "Synthetic document.", document_type: "document",
        structure: [{ title: "Source", items: ["Synthetic wording"] }], char_count: text.length, truncated: true },
    };
    mutate(body); return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}

describe("exact accepted source success through the public client", () => {
  it.each(["A".repeat(19_999) + " ", "A".repeat(19_999) + "\n", "  Accepted 😀 wording. \n", "\ufeffAccepted wording ", "😀".repeat(10_000)])
    ("preserves bounded v3 preview whitespace and UTF-16 counts %#", async text => {
      const fetchMock = respond(text);
      const result = await ingestUpload(new File(["original"], "source.txt", { type: "text/plain" }), "", context());
      expect(result.extracted_text).toBe(text);
      expect(result.confirm_payload.char_count).toBe(text.length);
      expect(result).toMatchObject({ extraction_format: "text", resource_policy_version: v2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  it.each(["", "application/rtf", "text/rtf"])("admits RTF only on the explicit policy and preserves multipart bytes: %s", async type => {
    const file = new File(["{\\rtf1 Original source}"], "source.rtf", { type });
    const fetchMock = respond("Original source");
    await expect(ingestUpload(file, "", context())).rejects.toMatchObject({ code: "UPLOAD_FORMAT_UNSUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await ingestUpload(file, "", context(), { metadataPolicyVersion: v2 })).extracted_text).toBe("Original source");
    const form = fetchMock.mock.calls[0]?.[1].body as FormData;
    const dispatched = form.get("file") as File;
    expect(await dispatched.text()).toBe(await file.text());
    expect(dispatched.type).toBe(type);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not change existing file request identity when metadata policy changes", async () => {
    const ids: string[] = []; respond("Source");
    for (const metadataPolicyVersion of ["upload-resource-policy.1", v2] as const) {
      await ingestUpload(new File(["Source"], "source.txt"), "", context(), {
        metadataPolicyVersion, beforeDispatch: prepared => { ids.push(prepared.uploadId); },
      });
    }
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  });
  it.each(["pdf", "docx", "xlsx"])("accepts the supported protected-source response format %s", async format => {
    respond("Accepted source");
    const result = await ingestUpload(new File(["original"], `source.${format}`), "", context());
    expect(result.extraction_format).toBe(format);
    expect(result.resource_policy_version).toBe(v2);
  });
  it("captures metadata admission once before asynchronous byte reading", async () => {
    const bytes = new TextEncoder().encode("{\\rtf1 Original}");
    const file = new File([bytes], "source.rtf");
    const options: IngestUploadOptions = { metadataPolicyVersion: v2 };
    vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
      Object.assign(options, { metadataPolicyVersion: "upload-resource-policy.1" });
      return bytes.buffer;
    });
    respond("Original");
    expect((await ingestUpload(file, "", context(), options)).extraction_format).toBe("rtf");
  });
  it.each(["unknown", null, 3, {}])("rejects an unknown metadata policy before reading file bytes or dispatch %#", async metadataPolicyVersion => {
    const file = new File(["Source"], "source.txt"); const read = vi.spyOn(file, "arrayBuffer");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(Reflect.apply(ingestUpload, undefined, [file, "", context(), { metadataPolicyVersion }]))
      .rejects.toThrow("UPLOAD_METADATA_POLICY_UNSUPPORTED");
    expect(read).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([" \n\t", "A".repeat(20_001), "😀".repeat(10_001), "Source\u0000text", "Source\ud800", "\udc00Source"])
    ("rejects blank, excessive or invalid v3 text %#", async text => {
      const fetchMock = respond(text);
      await expect(ingestUpload(new File(["original"], "source.txt"), "", context())).rejects.toThrow("UPLOAD_RESPONSE_INVALID");
      // The existing recovery contract permits one same-request replay after
      // unreadable completion. It must remain bounded and reuse its identity.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bodies = fetchMock.mock.calls.map(([, init]) => init.body as FormData);
      expect(bodies[0]?.get("upload_id")).toBe(bodies[1]?.get("upload_id"));
    });
  it.each([
    ["unknown policy", (b: Record<string, unknown>) => { b.resource_policy_version = "unknown"; }],
    ["missing policy", (b: Record<string, unknown>) => { delete b.resource_policy_version; }],
    ["missing format", (b: Record<string, unknown>) => { delete b.extraction_format; }],
    ["wrong format", (b: Record<string, unknown>) => { b.extraction_format = "docx"; }],
    ["private manifest", (b: Record<string, unknown>) => { b.source_manifest = {}; }],
    ["new wire version", (b: Record<string, unknown>) => { b.extraction_contract_version = "upload-extraction.3"; }],
    ["wrong count", (b: Record<string, unknown>) => { (b.confirm_payload as Record<string, unknown>).char_count = 1; }],
    ["private confirmation", (b: Record<string, unknown>) => { (b.confirm_payload as Record<string, unknown>).source_manifest = {}; }],
    ["foreign original", (b: Record<string, unknown>) => { b.storage_path = "other-owner/original.txt"; }],
    ["traversal original", (b: Record<string, unknown>) => { b.storage_path = String(b.storage_path).replace("/source.txt", "/../source.txt"); }],
    ["missing original path", (b: Record<string, unknown>) => { delete b.storage_path; }],
  ] as const)("rejects malformed v3 response: %s", async (_name, mutate) => {
    respond("Source", mutate);
    await expect(ingestUpload(new File(["original"], "source.txt"), "", context())).rejects.toThrow("UPLOAD_RESPONSE_INVALID");
  });
  it.each([false, true])("retains legacy response normalization rules; metadata present=%s", async metadata => {
    const mutate = (b: Record<string, unknown>) => {
      if (metadata) b.resource_policy_version = "upload-resource-policy.1";
      else { delete b.resource_policy_version; delete b.extraction_format; }
    };
    respond("Source", mutate);
    expect((await ingestUpload(new File(["original"], "source.txt"), "", context())).extracted_text).toBe("Source");
    respond(" Source ", mutate);
    await expect(ingestUpload(new File(["original"], "source.txt"), "", context())).rejects.toThrow("UPLOAD_RESPONSE_INVALID");
  });
  it("does not accept RTF under legacy response policy", async () => {
    respond("Source", b => { b.resource_policy_version = "upload-resource-policy.1"; });
    const options: IngestUploadOptions = { metadataPolicyVersion: v2 };
    await expect(ingestUpload(new File(["{\\rtf1 Source}"], "source.rtf"), "", context(), options)).rejects.toThrow("UPLOAD_RESPONSE_INVALID");
  });
  it("preserves accepted fallback provenance under the closed source response", async () => {
    const fallback = { provider: "ollama", model: "gpt-oss:20b", modelDigest: "a".repeat(64), configurationVersion: "local.1" };
    respond("Accepted source ", b => { b.credit_fallback = fallback; });
    expect((await ingestUpload(new File(["original"], "source.txt"), "", context())).credit_fallback).toEqual(fallback);
    respond("Accepted source ", b => { b.credit_fallback = { ...fallback, extra: true }; });
    await expect(ingestUpload(new File(["original"], "source.txt"), "", context())).rejects.toThrow("UPLOAD_RESPONSE_INVALID");
  });
  it("recovers a lost source acknowledgement with the same request and exact text", async () => {
    const text = "A".repeat(19_999) + " "; const fetchMock = respond(text);
    fetchMock.mockRejectedValueOnce(new TypeError("Synthetic acknowledgement lost"));
    const result = await ingestUpload(new File(["original"], "source.txt"), "", context());
    expect(result.extracted_text).toBe(text); expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => init.body as FormData);
    expect(bodies[0]?.get("upload_id")).toBe(bodies[1]?.get("upload_id"));
  });
});
