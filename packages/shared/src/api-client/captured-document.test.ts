import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  cancelCapturedDocumentOperation as cancelCapturedDocumentOperationRequest,
  configureApiClient as configureApiClientRequest,
  generateDocumentStream as generateDocumentStreamRequest,
  getCapturedDocumentOperation as getCapturedDocumentOperationRequest,
  resumeCapturedDocumentOperation as resumeCapturedDocumentOperationRequest,
  startCapturedDocumentOperation as startCapturedDocumentOperationRequest,
  type ApiClientConfig,
  type ApiRequestContext,
} from "./index";

const ORIGINAL_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const USER_ID = "11111111-1111-4111-8111-111111111111";

function token(): string {
  const payload = btoa(JSON.stringify({ sub: USER_ID }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

function requestContext(signal = new AbortController().signal): ApiRequestContext {
  return {
    expectedUserId: USER_ID,
    principalEpoch: 1,
    signal,
    assertCurrent: () => {
      if (signal.aborted) throw signal.reason;
    },
  };
}

function configureApiClient(next: ApiClientConfig): void {
  configureApiClientRequest({
    ...next,
    getToken: next.getToken ?? (() => token()),
  });
}

function generateDocumentStream(
  ...args: [
    Parameters<typeof generateDocumentStreamRequest>[0],
    Parameters<typeof generateDocumentStreamRequest>[1],
    AbortSignal?,
    Parameters<typeof generateDocumentStreamRequest>[3]?,
    Parameters<typeof generateDocumentStreamRequest>[4]?,
    Parameters<typeof generateDocumentStreamRequest>[5]?,
    Parameters<typeof generateDocumentStreamRequest>[6]?,
  ]
) {
  const [input, onSection, signal, ...callbacks] = args;
  return generateDocumentStreamRequest(input, onSection, requestContext(signal), ...callbacks);
}

function startCapturedDocumentOperation(
  input: Parameters<typeof startCapturedDocumentOperationRequest>[0],
  signal?: AbortSignal,
) {
  return startCapturedDocumentOperationRequest(input, requestContext(signal));
}

function resumeCapturedDocumentOperation(
  input: Parameters<typeof resumeCapturedDocumentOperationRequest>[0],
  signal?: AbortSignal,
) {
  return resumeCapturedDocumentOperationRequest(input, requestContext(signal));
}

function cancelCapturedDocumentOperation(
  input: Parameters<typeof cancelCapturedDocumentOperationRequest>[0],
  signal?: AbortSignal,
) {
  return cancelCapturedDocumentOperationRequest(input, requestContext(signal));
}

function getCapturedDocumentOperation(operationId: string, signal?: AbortSignal) {
  return getCapturedDocumentOperationRequest(operationId, requestContext(signal));
}

beforeEach(() => configureApiClient({ baseUrl: "/api" }));

afterEach(() => {
  vi.unstubAllGlobals();
  configureApiClient({ baseUrl: "/api" });
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
});

describe("captured document operation API", () => {
  it("preserves a streamed reconciliation hold as an exact non-retryable 409", async () => {
    const reconciliation = {
      type: "error",
      error: {
        code: "GENERATION_RECONCILIATION_REQUIRED",
        retryable: false,
        workflow_state: "awaiting_provider_reconciliation",
      },
      http_status: 409,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`data: ${JSON.stringify(reconciliation)}\n\n`, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
      ),
    );

    const result = generateDocumentStream(
      {
        template_id: "resume",
        generation_request_id: "request-reconciliation",
      },
      () => undefined,
    );

    await expect(result).rejects.toMatchObject({
      status: 409,
      code: "GENERATION_RECONCILIATION_REQUIRED",
      payload: reconciliation,
    } satisfies Partial<ApiError>);
  });

  it("starts one authenticated idempotent operation", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token()}`);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        generation_request_id: "request-1",
        template_id: "resume",
      });
      return new Response(
        JSON.stringify({
          operation_id: "operation-1",
          document_id: "document-1",
          operation_revision: 4,
          status: "ready_for_review",
          retryable: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({ baseUrl: "/api", getToken: () => token() });

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
    expect(fetchMock).toHaveBeenCalledWith("/api/document-operation", expect.any(Object));
  });

  it("reconnects with an encoded operation identity", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("/api/document-operation?operation_id=operation%2Fone");
      return new Response(
        JSON.stringify({
          operation_id: "operation/one",
          document_id: "document-1",
          operation_revision: 2,
          status: "generating",
          retryable: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({ baseUrl: "/api" });

    expect((await getCapturedDocumentOperation("operation/one")).status).toBe("generating");
  });

  it("resumes by durable identity so the server reconstructs the accepted request", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "resume",
        operation_id: "operation-1",
      });
      return new Response(
        JSON.stringify({
          operation_id: "operation-1",
          document_id: "document-1",
          operation_revision: 5,
          status: "generating",
          retryable: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await resumeCapturedDocumentOperation({
      action: "resume",
      operation_id: "operation-1",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves pending cancellation truth against the current durable revision", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "cancel",
        operation_id: "operation-1",
        expected_operation_revision: 5,
        cancellation_code: "owner_cancelled",
      });
      return new Response(
        JSON.stringify({
          operation_id: "operation-1",
          document_id: "document-1",
          operation_revision: 6,
          status: "generating",
          cancellation_requested: true,
          idempotent_replay: false,
          reconnect: "/api/document-operation?operation_id=operation-1",
          retryable: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await cancelCapturedDocumentOperation({
      operation_id: "operation-1",
      expected_operation_revision: 5,
      cancellation_code: "owner_cancelled",
    });

    expect(result.status).toBe("generating");
    expect(result.cancellation_requested).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never bypasses the stable API path after a service failure", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ error: { code: "TEMPORARY" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCapturedDocumentOperation("operation-1")).rejects.toMatchObject({
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/document-operation?operation_id=operation-1");
  });

  it("preserves the server's stable pre-admission activation error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "CAPTURED_ACTIVATION_DISABLED" },
              retryable: false,
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(
      startCapturedDocumentOperation({
        outcome_id: "outcome-1",
        document_id: "document-1",
        title: "Resume",
        template_id: "resume",
        generation_request_id: "request-1",
        input_revision: 1,
        input_values: {},
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "CAPTURED_ACTIVATION_DISABLED",
    });
  });

  it.each([
    {
      name: "start",
      request: () =>
        startCapturedDocumentOperation({
          outcome_id: "outcome-1",
          document_id: "document-1",
          title: "Resume",
          template_id: "resume",
          generation_request_id: "request-1",
          input_revision: 1,
          input_values: {},
        }),
    },
    {
      name: "resume",
      request: () =>
        resumeCapturedDocumentOperation({
          action: "resume",
          operation_id: "operation-1",
        }),
    },
    {
      name: "cancel",
      request: () =>
        cancelCapturedDocumentOperation({
          operation_id: "operation-1",
          expected_operation_revision: 5,
          cancellation_code: "owner_cancelled",
        }),
    },
    {
      name: "status",
      request: () => getCapturedDocumentOperation("operation-1"),
    },
  ])("rejects a malformed successful $name receipt", async ({ request }) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ operation_id: "operation-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({
      status: 502,
      code: "CAPTURED_OPERATION_RESPONSE_INVALID",
      payload: {},
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a truncated successful receipt without retrying or inventing state", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"operation_id":"operation-1"', {
          status: 202,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCapturedDocumentOperation("operation-1")).rejects.toMatchObject({
      status: 502,
      code: "CAPTURED_OPERATION_RESPONSE_INVALID",
      payload: {},
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a cancellation receipt that does not confirm durable cancellation intent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              operation_id: "operation-1",
              document_id: "document-1",
              operation_revision: 6,
              status: "generating",
              cancellation_requested: false,
              idempotent_replay: false,
              reconnect: "/api/document-operation?operation_id=operation-1",
              retryable: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(
      cancelCapturedDocumentOperation({
        operation_id: "operation-1",
        expected_operation_revision: 5,
        cancellation_code: "owner_cancelled",
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "CAPTURED_OPERATION_RESPONSE_INVALID",
    } satisfies Partial<ApiError>);
  });

  it.each([
    {
      name: "start document",
      response: {
        operation_id: "operation-1",
        document_id: "different-document",
        operation_revision: 1,
        status: "accepted",
        retryable: false,
      },
      request: () =>
        startCapturedDocumentOperation({
          outcome_id: "outcome-1",
          document_id: "document-1",
          title: "Resume",
          template_id: "resume",
          generation_request_id: "request-1",
          input_revision: 1,
          input_values: {},
        }),
    },
    {
      name: "resume operation",
      response: {
        operation_id: "different-operation",
        document_id: "document-1",
        operation_revision: 2,
        status: "generating",
        retryable: false,
      },
      request: () =>
        resumeCapturedDocumentOperation({
          action: "resume",
          operation_id: "operation-1",
        }),
    },
    {
      name: "status operation",
      response: {
        operation_id: "different-operation",
        document_id: "document-1",
        operation_revision: 2,
        status: "generating",
        retryable: false,
      },
      request: () => getCapturedDocumentOperation("operation-1"),
    },
  ])(
    "rejects a valid-shaped receipt for the wrong $name identity",
    async ({ response, request }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify(response), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );

      await expect(request()).rejects.toMatchObject({
        status: 502,
        code: "CAPTURED_OPERATION_RESPONSE_INVALID",
      } satisfies Partial<ApiError>);
    },
  );
});
