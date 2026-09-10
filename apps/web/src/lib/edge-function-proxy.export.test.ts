// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureApiClient, renderExport } from "@prompted/shared/api-client";
import { proxyEdgeFunctionRequest } from "./edge-function-proxy";

const originalEnv = { ...process.env };
const ownerId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0xff, 0x80]);

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_ENV = "preview";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-value";
  process.env.NEXT_PUBLIC_PRODUCTION_SUPABASE_PROJECT_REF = "jjsykocqpjlekgsbylkd";
  configureApiClient({
    baseUrl: "https://preview.example/api",
    getToken: () => `header.${btoa(JSON.stringify({ sub: ownerId }))}.signature`,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
  configureApiClient({ baseUrl: "/api" });
  vi.unstubAllGlobals();
});

function exportThroughGateway(receipt: string | null) {
  const headers = new Headers({
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": 'attachment; filename="approved.docx"',
    "X-Approved-Sections": "3",
    "Cache-Control": "public, max-age=3600",
    "Set-Cookie": "private=value",
    "X-Internal-Token": "must-not-leak",
  });
  if (receipt !== null) headers.set("X-Captured-Export-Id", receipt);
  const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { headers }));
  const gateway = vi.fn<typeof fetch>(async (input, init) => {
    const response = await proxyEdgeFunctionRequest(new Request(input, init), ["render-export"], upstream);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-internal-token")).toBeNull();
    return response;
  });
  vi.stubGlobal("fetch", gateway);
  const result = renderExport({
    document_id: "33333333-3333-4333-8333-333333333333",
    title: "Approved document", format: "word", sections: [],
    captured_export_id: exportId,
    captured_operation_id: "44444444-4444-4444-8444-444444444444",
    captured_expected_operation_revision: 7,
  }, {
    expectedUserId: ownerId, principalEpoch: 1,
    signal: new AbortController().signal, assertCurrent: () => {},
  });
  return { result, upstream, gateway };
}

describe("shared export client through the same-origin gateway", () => {
  it("preserves the exact receipt, approved count, filename and binary artifact", async () => {
    const { result, upstream, gateway } = exportThroughGateway(exportId);
    const exported = await result;
    expect(exported.capturedExportId).toBe(exportId);
    expect(exported.approvedSections).toBe(3);
    expect(exported.filename).toBe("approved.docx");
    expect(new Uint8Array(await exported.blob.arrayBuffer())).toEqual(bytes);
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
    const request = upstream.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error("Expected forwarded request");
    expect(await request.json()).toMatchObject({ captured_export_id: exportId, captured_expected_operation_revision: 7 });
    expect(request.headers.get("authorization")).toContain("Bearer ");
  });

  it.each([null, "stale-receipt"])("rejects a missing or stale receipt (%s) without retrying", async (receipt) => {
    const { result, upstream, gateway } = exportThroughGateway(receipt);
    await expect(result).rejects.toMatchObject({ code: "CAPTURED_EXPORT_RESPONSE_INVALID" });
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
