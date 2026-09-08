import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureApiClient, ingestUpload, type PreparedUploadDispatch } from "./index";

const OWNER = "11111111-1111-4111-8111-111111111111";
const context = () => ({
  expectedUserId: OWNER,
  principalEpoch: 1,
  signal: new AbortController().signal,
  assertCurrent() {},
});

beforeEach(() => {
  configureApiClient({
    baseUrl: "https://upload.test/api",
    getToken: () => `header.${btoa(JSON.stringify({ sub: OWNER }))}.signature`,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  configureApiClient({ baseUrl: "/api" });
});

describe("actual multipart upload serialization", () => {
  it.each([
    ["source.md", ""],
    ["source.pdf", ""],
    ["source.docx", ""],
    ["source.md", "text/markdown"],
    ["source.pdf", "application/pdf"],
    ["source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["source.md", "application/octet-stream"],
    ["source.md", "binary/octet-stream"],
  ])("preserves accepted bytes and MIME across the wire for %s (%s)", async (name, type) => {
    let prepared: Readonly<PreparedUploadDispatch> | undefined;
    let wireMime: string | undefined;
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      // This traverses the real multipart encoder/parser. Reading init.body
      // directly misses default file MIME and field/filename transformations.
      const request = new Request(input, init);
      const body = await request.formData();
      const file = body.get("file") as File;
      wireMime = file.type;
      expect(await file.text()).toBe("Synthetic source");
      expect(file.name).toBe(name);
      expect(body.get("upload_id")).toBe(prepared?.uploadId);
      expect(request.headers.get("x-idempotency-key")).toBe(prepared?.uploadId);
      return new Response(JSON.stringify({
        upload_id: body.get("upload_id"),
        original_retained: true,
        extracted_text: "Synthetic source",
        classification_status: "completed",
        confirm_payload: {
          filename: name, summary: "A synthetic document.", document_type: "document",
          structure: [{ title: "Source", items: ["Synthetic source"] }],
          char_count: 16, truncated: false,
        },
      }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await ingestUpload(new File(["Synthetic source"], name, { type }), "", context(), {
      beforeDispatch: (value) => { prepared = value; },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(prepared?.mimeType).toBe(wireMime);
    expect(prepared?.persistedFileType).toBe(wireMime);
  });

  it("gives an untyped file the same identity as its explicit wire MIME", async () => {
    const identities: string[] = [];
    const stopBeforeNetwork = new Error("identity captured before dispatch");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const type of ["", "application/octet-stream"]) {
      await expect(ingestUpload(new File(["Synthetic source"], "source.md", { type }), "", context(), {
        beforeDispatch: (value) => {
          identities.push(value.uploadId);
          throw stopBeforeNetwork;
        },
      })).rejects.toBe(stopBeforeNetwork);
    }
    expect(identities).toHaveLength(2);
    expect(identities[0]).toBe(identities[1]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
