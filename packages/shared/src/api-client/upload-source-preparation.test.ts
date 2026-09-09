import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./index";

const OWNER = "11111111-1111-4111-8111-111111111111";
const POLICY = "upload-source-preparation.1";
const SOURCE = "  Source wording — 日本語 😀.\n";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const context = (controller = new AbortController()): api.ApiRequestContext => ({
  expectedUserId: OWNER, principalEpoch: 1, signal: controller.signal, assertCurrent() {},
});

// Use the public module seam before the new export exists. An absent capability
// fails behaviorally, without a missing-module or TypeScript compilation error.
async function prepareSource(...args: Parameters<typeof api.ingestUpload>): Promise<unknown> {
  const prepare = Reflect.get(api, "prepareUploadSource");
  if (typeof prepare !== "function") throw new Error("SOURCE_PREPARATION_API_UNAVAILABLE");
  return await Reflect.apply(prepare, undefined, args);
}

function expectedIdentity(file: File, situation: string, source: boolean, owner = OWNER): string {
  const request = {
    contract: source ? "ingest-upload.request.v2" : "ingest-upload.request.v1",
    ...(source ? { processing_policy_version: POLICY } : {}),
    filename: file.name.normalize("NFKC").trim().slice(0, 300),
    mime: file.type.normalize("NFKC").trim().toLowerCase().slice(0, 200) || "application/octet-stream",
    byte_length: file.size,
    content_sha256: sha("Original bytes"),
    situation_text: situation.normalize("NFKC").trim(),
  };
  const digest = sha(JSON.stringify({ contract: source ? "ingest-upload.identity.v2" : "ingest-upload.identity.v1",
    user_id: owner, request }));
  const variant = ((Number.parseInt(digest[16]!, 16) & 3) | 8).toString(16);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function sourceBody(uploadId: string, file: File, text = SOURCE): Record<string, unknown> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return {
    contract_version: POLICY, upload_id: uploadId,
    storage_path: `${OWNER}/${uploadId}/${file.name}`,
    original_retained: true, classification_status: "not_requested",
    extracted_text: text,
    extraction_format: ["pdf", "docx", "rtf", "xlsx"].includes(extension ?? "") ? extension : "text",
    resource_policy_version: "upload-resource-policy.2", extraction_text_sha256: sha(text), truncated: false,
  };
}

function classifiedBody(uploadId: string, file: File): Record<string, unknown> {
  return { upload_id: uploadId, original_retained: true, extracted_text: "Original bytes",
    classification_status: "completed", confirm_payload: {
      filename: file.name, summary: "A classified document.", document_type: "document",
      structure: [{ title: "Original", items: ["Original bytes"] }], char_count: 14, truncated: false,
    } };
}

function respond(mutate: (body: Record<string, unknown>) => void = () => {}) {
  const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    expect(input).toBe("https://upload.test/api/ingest-upload");
    const request = new Request(input, init);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Synthetic multipart file absent");
    const uploadId = String(form.get("upload_id"));
    const body = sourceBody(uploadId, file); mutate(body);
    return Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => api.configureApiClient({ baseUrl: "https://upload.test/api",
  getToken: () => `header.${btoa(JSON.stringify({ sub: OWNER }))}.signature` }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); api.configureApiClient({ baseUrl: "/api" }); });

describe("explicit source preparation transport", () => {
  it.each([
    ["Source.pdf", "application/pdf"],
    ["Source.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["Source.txt", "text/plain"], ["Source.md", "text/markdown"],
    ["Source.rtf", "application/rtf"], ["Source.rtf", "text/rtf"], ["Source.rtf", ""],
  ])("prepares %s without a classification envelope (%s)", async (name, type) => {
    const file = new File(["Original bytes"], name, { type });
    const fetchMock = respond(); let prepared: Readonly<api.PreparedUploadDispatch> | undefined;
    const result = await prepareSource(file, "  Review the source  ", context(), {
      beforeDispatch(value) { prepared = value; },
    });
    const expectedId = expectedIdentity(file, "  Review the source  ", true);
    expect(result).toEqual(sourceBody(expectedId, file));
    expect(prepared?.uploadId).toBe(expectedId); expect(Object.isFrozen(prepared)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1]; const form = await new Request(fetchMock.mock.calls[0]![0], init).formData();
    expect([...form.keys()].sort()).toEqual(["file", "processing_policy_version", "request_id", "situation_text", "upload_id"]);
    expect(form.get("processing_policy_version")).toBe(POLICY);
    expect(form.get("upload_id")).toBe(expectedId); expect(form.get("request_id")).toBe(expectedId);
    expect(form.get("situation_text")).toBe("Review the source");
    expect(new Headers(init.headers).get("x-idempotency-key")).toBe(expectedId);
    expect(await (form.get("file") as File).text()).toBe("Original bytes");
    expect(result).not.toHaveProperty("confirm_payload"); expect(result).not.toHaveProperty("credit_fallback");
  });

  it("preserves literal legacy v1 identity and response while source preparation has a different identity", async () => {
    const file = new File(["Original bytes"], "Source.txt");
    const calls: FormData[] = [];
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      const form = await new Request(input, init).formData(); calls.push(form);
      const uploadId = String(form.get("upload_id"));
      return Response.json(form.has("processing_policy_version") ? sourceBody(uploadId, file) : classifiedBody(uploadId, file));
    });
    vi.stubGlobal("fetch", fetchMock);
    const legacy = await api.ingestUpload(file, "Source", context());
    expect(legacy).toEqual(classifiedBody(expectedIdentity(file, "Source", false), file));
    const source = await prepareSource(file, "Source", context());
    expect(source).toEqual(sourceBody(expectedIdentity(file, "Source", true), file));
    expect(calls[0]!.has("processing_policy_version")).toBe(false);
    expect(calls[0]!.get("upload_id")).not.toBe(calls[1]!.get("upload_id"));
  });

  it("keeps the legacy classified upload API usable before source preparation is activated", async () => {
    const file = new File(["Original bytes"], "Source.txt");
    const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
      const form = await new Request(input, init).formData();
      expect(form.has("processing_policy_version")).toBe(false);
      return Response.json(classifiedBody(String(form.get("upload_id")), file));
    }); vi.stubGlobal("fetch", fetchMock);
    expect(await api.ingestUpload(file, "", context())).toEqual(classifiedBody(expectedIdentity(file, "", false), file));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers lost acknowledgement with the identical prepared source request", async () => {
    const fetchMock = respond(); fetchMock.mockRejectedValueOnce(new TypeError("Synthetic lost acknowledgement"));
    const file = new File(["Original bytes"], "Source.md");
    expect(await prepareSource(file, "", context())).toEqual(sourceBody(expectedIdentity(file, "", true), file));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
  });

  it("rechecks a matching processing receipt once without another request identity", async () => {
    const fetchMock = respond();
    fetchMock.mockImplementationOnce(async (input, init) => {
      const form = await new Request(input, init).formData();
      return Response.json({ upload_id: form.get("upload_id"), error: { code: "UPLOAD_PROCESSING" } },
        { status: 409, headers: { "Retry-After": "0" } });
    });
    const file = new File(["Original bytes"], "Source.txt");
    expect(await prepareSource(file, "", context())).toEqual(sourceBody(expectedIdentity(file, "", true), file));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
  });

  it("preserves server rejection without falling back to classified ingestion", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { code: "UPLOAD_PROCESSING_POLICY_UNSUPPORTED" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(prepareSource(new File(["Original bytes"], "Source.txt"), "", context()))
      .rejects.toMatchObject({ status: 400, code: "UPLOAD_PROCESSING_POLICY_UNSUPPORTED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("captures metadata policy before asynchronous original-byte reading", async () => {
    const file = new File(["Original bytes"], "Source.rtf");
    const options: api.IngestUploadOptions = { metadataPolicyVersion: "upload-resource-policy.2" };
    vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
      Object.assign(options, { metadataPolicyVersion: "upload-resource-policy.1" });
      return new TextEncoder().encode("Original bytes").buffer;
    });
    respond();
    expect(await prepareSource(file, "", context(), options)).toEqual(sourceBody(expectedIdentity(file, "", true), file));
  });

  it("rejects unknown metadata policy before file reading or dispatch", async () => {
    const file = new File(["Original bytes"], "Source.txt"); const bytes = vi.spyOn(file, "arrayBuffer");
    const fetchMock = respond();
    await expect(Reflect.apply(prepareSource, undefined, [file, "", context(), { metadataPolicyVersion: "unknown" }]))
      .rejects.toThrow("UPLOAD_METADATA_POLICY_UNSUPPORTED");
    expect(bytes).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancellation before preparation dispatches nothing", async () => {
    const controller = new AbortController(); const reason = new Error("Source cancelled"); controller.abort(reason);
    const file = new File(["Original bytes"], "Source.txt"); const bytes = vi.spyOn(file, "arrayBuffer"); const fetchMock = respond();
    await expect(prepareSource(file, "", context(controller))).rejects.toBe(reason);
    expect(bytes).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancellation after preparation and before dispatch retains the existing fence", async () => {
    const controller = new AbortController(); const reason = new Error("Source cancelled before network"); const fetchMock = respond();
    await expect(prepareSource(new File(["Original bytes"], "Source.txt"), "", context(controller), {
      beforeDispatch() { controller.abort(reason); },
    })).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("owner change during the response cannot publish or replay another owner's source", async () => {
    let active = true; const lease = { ...context(), assertCurrent() { if (!active) throw new Error("Owner changed"); } };
    const fetchMock = respond(() => { active = false; });
    await expect(prepareSource(new File(["Original bytes"], "Source.txt"), "", lease)).rejects.toThrow("Owner changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("closed source preparation result", () => {
  const malformed: Array<[string, (body: Record<string, unknown>) => void]> = [
    ["wrong version", b => { b.contract_version = "upload-source-preparation.2"; }],
    ["wrong upload", b => { b.upload_id = "11111111-1111-8111-8111-111111111111"; }],
    ["foreign original", b => { b.storage_path = String(b.storage_path).replace(OWNER, "22222222-2222-4222-8222-222222222222"); }],
    ["other upload original", b => { b.storage_path = `${OWNER}/11111111-1111-8111-8111-111111111111/Source.txt`; }],
    ["traversal", b => { b.storage_path = String(b.storage_path).replace("/Source.txt", "/../Source.txt"); }],
    ["unretained source", b => { b.original_retained = false; }],
    ["claimed classification", b => { b.classification_status = "completed"; }],
    ["old metadata policy", b => { b.resource_policy_version = "upload-resource-policy.1"; }],
    ["wrong format", b => { b.extraction_format = "pdf"; }],
    ["wrong text digest", b => { b.extraction_text_sha256 = "a".repeat(64); }],
    ["malformed digest", b => { b.extraction_text_sha256 = "A".repeat(64); }],
    ["missing digest", b => { delete b.extraction_text_sha256; }],
    ["unknown completeness", b => { b.truncated = null; }],
    ["extra confirmation", b => { b.confirm_payload = {}; }],
    ["extra provider provenance", b => { b.credit_fallback = {}; }],
    ["extra private source", b => { b.source_manifest = {}; }],
    ["extra char count", b => { b.char_count = SOURCE.length; }],
  ];
  it.each(malformed)("rejects %s with only one same-request recovery", async (_label, mutate) => {
    const fetchMock = respond(mutate);
    await expect(prepareSource(new File(["Original bytes"], "Source.txt"), "", context()))
      .rejects.toMatchObject({ status: 502, code: "UPLOAD_RESPONSE_INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
  });
  it.each(["", " \n\t", "A".repeat(20_001), "invalid\u0000text", "invalid\ud800", "\udc00invalid"])
    ("rejects invalid exact source text %#", async text => {
      const fetchMock = respond(b => { b.extracted_text = text; b.extraction_text_sha256 = sha(text); });
      await expect(prepareSource(new File(["Original bytes"], "Source.txt"), "", context()))
        .rejects.toMatchObject({ code: "UPLOAD_RESPONSE_INVALID" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  it("retains incomplete preview status without granting complete-document authority", async () => {
    const file = new File(["Original bytes"], "Source.txt"); respond(b => { b.truncated = true; });
    expect(await prepareSource(file, "", context())).toEqual({ ...sourceBody(expectedIdentity(file, "", true), file), truncated: true });
  });
});
