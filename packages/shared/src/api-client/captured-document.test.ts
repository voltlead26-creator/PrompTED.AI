import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelCapturedDocumentOperation,
  configureApiClient,
  getCapturedDocumentOperation,
  resumeCapturedDocumentOperation,
  startCapturedDocumentOperation,
} from "./index";

const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  configureApiClient({ baseUrl: "/api" });
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
});

describe("captured document operation API", () => {
  it("starts one authenticated idempotent operation", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        generation_request_id: "request-1",
        template_id: "resume",
      });
      return new Response(JSON.stringify({
        operation_id: "operation-1",
        document_id: "document-1",
        operation_revision: 4,
        status: "ready_for_review",
        retryable: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({ baseUrl: "/api", getToken: () => "token" });

    const result = await startCapturedDocumentOperation({
      outcome_id: "outcome-1",
      document_id: "document-1",
      title: "Resume",
      template_id: "resume",
      generation_request_id: "request-1",
      input_revision: 1,
      input_values: { full_name: "Synthetic Person" },
    });

    expect(result.status).toBe("ready_for_review");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/document-operation",
      expect.any(Object),
    );
  });

  it("reconnects with an encoded operation identity", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/document-operation?operation_id=operation%2Fone");
      return new Response(JSON.stringify({
        operation_id: "operation/one",
        document_id: "document-1",
        operation_revision: 2,
        status: "generating",
        retryable: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({ baseUrl: "/api" });

    expect((await getCapturedDocumentOperation("operation/one")).status).toBe(
      "generating",
    );
  });

  it("resumes the exact accepted operation without changing request identity", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        action: "resume",
        operation_id: "operation-1",
        generation_request_id: "request-1",
        document_id: "document-1",
      });
      return new Response(JSON.stringify({
        operation_id: "operation-1",
        document_id: "document-1",
        operation_revision: 5,
        status: "generating",
        retryable: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await resumeCapturedDocumentOperation({
      action: "resume",
      operation_id: "operation-1",
      outcome_id: "outcome-1",
      document_id: "document-1",
      title: "Resume",
      template_id: "resume",
      generation_request_id: "request-1",
      input_revision: 1,
      input_values: { full_name: "Synthetic Person" },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("records cancellation against the current durable revision", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "cancel",
        operation_id: "operation-1",
        expected_operation_revision: 5,
        cancellation_code: "owner_cancelled",
      });
      return new Response(JSON.stringify({
        operation_id: "operation-1",
        operation_revision: 6,
        status: "cancelled",
        idempotent_replay: false,
        reconnect: "/api/document-operation?operation_id=operation-1",
        retryable: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelCapturedDocumentOperation({
      operation_id: "operation-1",
      expected_operation_revision: 5,
      cancellation_code: "owner_cancelled",
    });

    expect(result.status).toBe("cancelled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never bypasses the stable API path after a service failure", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCapturedDocumentOperation("operation-1")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/document-operation?operation_id=operation-1",
    );
  });

  it("preserves the server's stable pre-admission activation error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        error: { code: "CAPTURED_ACTIVATION_DISABLED" },
        retryable: false,
      }), { status: 409, headers: { "Content-Type": "application/json" } })
    ));

    await expect(startCapturedDocumentOperation({
      outcome_id: "outcome-1",
      document_id: "document-1",
      title: "Resume",
      template_id: "resume",
      generation_request_id: "request-1",
      input_revision: 1,
      input_values: {},
    })).rejects.toMatchObject({
      status: 409,
      code: "CAPTURED_ACTIVATION_DISABLED",
    });
  });
});
