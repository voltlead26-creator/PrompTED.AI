import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  configureApiClient,
  editSectionStream as editSectionStreamRequest,
  generateArtifactStream as generateArtifactStreamRequest,
  ingestUpload as ingestUploadRequest,
  jobMatch as jobMatchRequest,
  renderExport as renderExportRequest,
  type IngestUploadOptions,
  type ApiRequestContext,
} from "./index";
import { MAX_TEXT_UPLOAD_BYTES } from "../ingest-upload";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
let expectedUserId = USER_A;

function token(subject: unknown): string {
  const payload = btoa(JSON.stringify({ sub: subject }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `eyJhbGciOiJub25lIn0.${payload}.signature`;
}

function requestContext(signal = new AbortController().signal): ApiRequestContext {
  return {
    expectedUserId,
    principalEpoch: 1,
    signal,
    assertCurrent: () => {
      if (signal.aborted) throw signal.reason;
    },
  };
}

function editSectionStream(
  input: Parameters<typeof editSectionStreamRequest>[0],
  onDelta: Parameters<typeof editSectionStreamRequest>[1],
  onChanges?: Parameters<typeof editSectionStreamRequest>[2],
  signal?: AbortSignal,
) {
  return editSectionStreamRequest(input, onDelta, onChanges, requestContext(signal));
}

function generateArtifactStream(
  input: Parameters<typeof generateArtifactStreamRequest>[0],
  onEvent: Parameters<typeof generateArtifactStreamRequest>[1],
  signal?: AbortSignal,
) {
  return generateArtifactStreamRequest(input, onEvent, requestContext(signal));
}

function ingestUpload(
  file: File,
  situationText = "",
  signal?: AbortSignal,
  options?: IngestUploadOptions,
) {
  return ingestUploadRequest(file, situationText, requestContext(signal), options);
}

function jobMatch(input: Parameters<typeof jobMatchRequest>[0], signal?: AbortSignal) {
  return jobMatchRequest(input, requestContext(signal));
}

function renderExport(input: Parameters<typeof renderExportRequest>[0], signal?: AbortSignal) {
  return renderExportRequest(input, requestContext(signal));
}

function uploadPayload(uploadId: string, overrides: Record<string, unknown> = {}) {
  return {
    upload_id: uploadId,
    extracted_text: "Synthetic text",
    original_retained: true,
    classification_status: "completed",
    confirm_payload: {
      summary: "A synthetic source for upload tests.",
      document_type: "text file",
      structure: [{ title: "Source", items: ["Synthetic fact"] }],
      filename: "replay.txt",
      char_count: "Synthetic text".length,
      truncated: false,
    },
    storage_path: `${USER_A}/${uploadId}/replay.txt`,
    ...overrides,
  };
}

function uploadResponse(
  uploadId: string,
  overrides: Record<string, unknown> = {},
  filename = "replay.txt",
): Response {
  const payload = uploadPayload(uploadId, overrides);
  payload.confirm_payload = {
    ...payload.confirm_payload,
    filename,
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function uploadFilename(init?: RequestInit): string {
  const file = (init?.body as FormData | undefined)?.get("file") as File | null;
  return String(file?.name || "upload")
    .normalize("NFKC")
    .trim()
    .slice(0, 300);
}

beforeEach(() => {
  expectedUserId = USER_A;
  configureApiClient({ baseUrl: "/api", getToken: () => token(USER_A) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  configureApiClient({ baseUrl: "/api" });
});

describe("model request identity", () => {
  function editStream(
    operationId?: string,
    overrides: {
      operation?: Record<string, unknown>;
      result?: Record<string, unknown>;
    } = {},
  ): Response {
    const operation = operationId
      ? `data: ${JSON.stringify({
          type: "operation",
          operation_id: operationId,
          accepted_section_revision: 4,
          accepted_content_sha256:
            "88d759ea02cef4b82885c6c620473162757c75522805707c20e2be76a40a2825",
          idempotent_replay: false,
          ...overrides.operation,
        })}\n\n`
      : "";
    const result = operationId
      ? `data: ${JSON.stringify({
          type: "result",
          operation_id: operationId,
          accepted_section_revision: 4,
          result_sha256: "7117f0807129493fd1f4d6942340d55e82980ef0a82bf629871829666824c7b3",
          applied_candidate_content: "<p>Edited</p>",
          applied_candidate_sha256:
            "6da2688132585706aad4d93c4cd1736841c2ba28358578a2b4e8cccc905d5ee2",
          state: "ready",
          idempotent_replay: false,
          ...overrides.result,
        })}\n\n`
      : "";
    return new Response(
      `${operation}data: {"type":"delta","text":"Edited"}\n\n${result}data: [DONE]\n\n`,
      {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  }

  it("replays one edit transport loss with an identical body and dual identity headers", async () => {
    const operationId = "44444444-4444-4444-8444-444444444444";
    const attempts: Array<{ body: string; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        attempts.push({
          body: String(init?.body),
          headers: new Headers(init?.headers),
        });
        if (attempts.length === 1) throw new TypeError("response lost");
        return editStream(operationId);
      }),
    );

    const deltas: string[] = [];
    await expect(
      editSectionStream(
        {
          action: "improve",
          content: "Original",
          persistence: {
            operation_id: operationId,
            document_id: "55555555-5555-4555-8555-555555555555",
            section_id: "66666666-6666-4666-8666-666666666666",
            expected_section_revision: 4,
          },
        },
        (delta) => deltas.push(delta),
      ),
    ).resolves.toMatchObject({
      operation: { operation_id: operationId },
      result: { operation_id: operationId },
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.body).toBe(attempts[0]!.body);
    for (const attempt of attempts) {
      const body = JSON.parse(attempt.body) as Record<string, unknown>;
      expect(body.generation_request_id).toBe(operationId);
      expect(attempt.headers.get("x-idempotency-key")).toBe(operationId);
      expect(attempt.headers.get("x-request-id")).toBe(operationId);
    }
    expect(deltas).toEqual(["Edited"]);
  });

  it.each([
    ["operation identity", { operation: { operation_id: "99999999-9999-4999-8999-999999999999" } }],
    ["accepted revision", { result: { accepted_section_revision: 5 } }],
    ["accepted content digest", { operation: { accepted_content_sha256: "not-a-sha256" } }],
    ["result digest", { result: { result_sha256: "b".repeat(64) } }],
    ["empty persisted candidate", { result: { applied_candidate_content: "   " } }],
    ["persisted candidate digest", { result: { applied_candidate_sha256: "c".repeat(64) } }],
  ])("rejects a malformed durable %s with one stable code", async (_label, overrides) => {
    const operationId = "44444444-4444-4444-8444-444444444444";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => editStream(operationId, overrides)),
    );

    await expect(
      editSectionStream(
        {
          action: "improve",
          content: "Original",
          persistence: {
            operation_id: operationId,
            document_id: "55555555-5555-4555-8555-555555555555",
            section_id: "66666666-6666-4666-8666-666666666666",
            expected_section_revision: 4,
          },
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "EDIT_DURABLE_RESULT_INVALID",
    } satisfies Partial<ApiError>);
  });

  it("rejects syntactically malformed durable SSE with the stable invalid-result code", async () => {
    const operationId = "44444444-4444-4444-8444-444444444444";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `data: ${JSON.stringify({
              type: "operation",
              operation_id: operationId,
              accepted_section_revision: 4,
              accepted_content_sha256:
                "88d759ea02cef4b82885c6c620473162757c75522805707c20e2be76a40a2825",
              idempotent_replay: false,
            })}\n\ndata: {"type":"result"\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } },
          ),
      ),
    );

    await expect(
      editSectionStream(
        {
          action: "improve",
          content: "Original",
          persistence: {
            operation_id: operationId,
            document_id: "55555555-5555-4555-8555-555555555555",
            section_id: "66666666-6666-4666-8666-666666666666",
            expected_section_revision: 4,
          },
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "EDIT_DURABLE_RESULT_INVALID",
    } satisfies Partial<ApiError>);
  });

  it("replays one unparseable edit error acknowledgement and then stops", async () => {
    const attempts: Array<{ body: string; requestId: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = String(init?.body);
        const requestId = String(new Headers(init?.headers).get("x-request-id"));
        attempts.push({ body, requestId });
        return attempts.length === 1 ? new Response("{", { status: 503 }) : editStream();
      }),
    );

    await expect(
      editSectionStream(
        {
          action: "shorten",
          content: "Synthetic",
        },
        () => undefined,
      ),
    ).resolves.toEqual({ operation: null, result: null });
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(JSON.parse(attempts[0]!.body).generation_request_id).toBe(attempts[0]!.requestId);
  });

  it("does not replay a valid edit application error", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "EDIT_CONFLICT" },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      editSectionStream(
        {
          action: "improve",
          content: "Synthetic",
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "EDIT_CONFLICT",
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("replays one transport loss with the same UUIDv4 in body and headers", async () => {
    const attempts: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      attempts.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      });
      if (attempts.length === 1) throw new TypeError("response lost");
      return new Response(JSON.stringify({ listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await jobMatch({ situation: "Synthetic role search" });

    expect(attempts).toHaveLength(2);
    const requestId = String(attempts[0]!.body.generation_request_id);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    for (const attempt of attempts) {
      expect(attempt.body.generation_request_id).toBe(requestId);
      expect(attempt.headers.get("x-idempotency-key")).toBe(requestId);
      expect(attempt.headers.get("x-request-id")).toBe(requestId);
    }
  });

  it("honours an explicit caller UUID and does not retry an HTTP failure", async () => {
    const requestId = "33333333-3333-4333-8333-333333333333";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).generation_request_id).toBe(requestId);
      expect(new Headers(init?.headers).get("x-idempotency-key")).toBe(requestId);
      return new Response(JSON.stringify({ error: { code: "INVALID" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      jobMatch({
        situation: "Synthetic",
        generation_request_id: requestId,
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID" } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("replays a truncated successful JSON acknowledgement with the same identity", async () => {
    const attempts: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const identity = String(
        (JSON.parse(String(init?.body)) as Record<string, unknown>).generation_request_id,
      );
      attempts.push(identity);
      if (attempts.length === 1) {
        return new Response('{"listings":', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(jobMatch({ situation: "Synthetic" })).resolves.toMatchObject({
      listings: [],
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(attempts[0]);
  });

  it("binds the artifact stream body and both headers to its existing UUID", async () => {
    const requestId = "77777777-7777-4777-8777-777777777777";
    const attempts: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        attempts.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          headers: new Headers(init?.headers),
        });
        if (attempts.length === 1) throw new TypeError("connection lost");
        return new Response(JSON.stringify({ error: { code: "SYNTHETIC" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    await expect(
      generateArtifactStream(
        {
          request_id: requestId,
          outcome_id: "88888888-8888-4888-8888-888888888888",
          kind: "action_plan",
          situation: "Synthetic",
        },
        () => undefined,
      ),
    ).rejects.toMatchObject({
      code: "ARTIFACT_STREAM_FAILED",
    });
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt.body.request_id).toBe(requestId);
      expect(attempt.body.generation_request_id).toBe(requestId);
      expect(attempt.headers.get("x-idempotency-key")).toBe(requestId);
      expect(attempt.headers.get("x-request-id")).toBe(requestId);
    }
  });

  it("binds one fresh legacy export UUID across body, both headers, and one uncertain replay", async () => {
    const attempts: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        attempts.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          headers: new Headers(init?.headers),
        });
        if (attempts.length === 1) throw new TypeError("response lost");
        return new Response("synthetic-export", {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="test.pdf"' },
        });
      }),
    );
    const input = {
      document_id: "55555555-5555-4555-8555-555555555555",
      title: "Test export",
      format: "pdf" as const,
      sections: [],
    };

    await expect(renderExport(input)).resolves.toMatchObject({ filename: "test.pdf" });
    await expect(renderExport(input)).resolves.toMatchObject({ filename: "test.pdf" });

    expect(attempts).toHaveLength(3);
    const firstIdentity = String(attempts[0]!.body.request_id);
    expect(firstIdentity).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(attempts[1]!.body).toEqual(attempts[0]!.body);
    for (const attempt of attempts.slice(0, 2)) {
      expect(attempt.headers.get("x-idempotency-key")).toBe(firstIdentity);
      expect(attempt.headers.get("x-request-id")).toBe(firstIdentity);
    }
    const secondIdentity = String(attempts[2]!.body.request_id);
    expect(secondIdentity).not.toBe(firstIdentity);
    expect(attempts[2]!.headers.get("x-idempotency-key")).toBe(secondIdentity);
    expect(attempts[2]!.headers.get("x-request-id")).toBe(secondIdentity);
  });

  it("does not retry a known legacy export terminal response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "EXPORT_GATE" } }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      renderExport({
        title: "Known terminal export",
        format: "pdf",
        sections: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "EXPORT_GATE",
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves captured export identity and does not add a legacy request UUID", async () => {
    const attempts: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        attempts.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          headers: new Headers(init?.headers),
        });
        return new Response("captured-export", {
          status: 200,
          headers: {
            "X-Captured-Export-Id": "77777777-7777-4777-8777-777777777777",
          },
        });
      }),
    );
    const input = {
      document_id: "55555555-5555-4555-8555-555555555555",
      title: "Captured export",
      format: "pdf" as const,
      sections: [],
      captured_export_id: "77777777-7777-4777-8777-777777777777",
      captured_operation_id: "88888888-8888-4888-8888-888888888888",
      captured_expected_operation_revision: 9,
    };

    await renderExport(input);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.body).toEqual(input);
    expect(attempts[0]!.body).not.toHaveProperty("request_id");
    expect(attempts[0]!.headers.get("x-idempotency-key")).toBeNull();
    expect(attempts[0]!.headers.get("x-request-id")).toBeNull();
  });

  it("rejects a captured export response whose immutable identity is absent or mismatched", async () => {
    const input = {
      document_id: "55555555-5555-4555-8555-555555555555",
      title: "Captured export",
      format: "pdf" as const,
      sections: [],
      captured_export_id: "77777777-7777-4777-8777-777777777777",
      captured_operation_id: "88888888-8888-4888-8888-888888888888",
      captured_expected_operation_revision: 9,
    };

    for (const responseId of [null, "99999999-9999-4999-8999-999999999999"]) {
      const headers = responseId ? { "X-Captured-Export-Id": responseId } : undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("captured-export", { status: 200, headers })),
      );
      await expect(renderExport(input)).rejects.toMatchObject({
        status: 502,
        code: "CAPTURED_EXPORT_RESPONSE_INVALID",
      } satisfies Partial<ApiError>);
    }
  });
});

describe("upload request identity", () => {
  async function run(
    userId: string,
    file: File,
    situation = "  Ａ role change  ",
  ): Promise<string> {
    expectedUserId = userId;
    configureApiClient({ baseUrl: "/api", getToken: () => token(userId) });
    const expectedSituation = situation.normalize("NFKC").trim();
    let identity = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const form = init?.body as FormData;
        identity = String(form.get("upload_id"));
        const headers = new Headers(init?.headers);
        expect(form.get("request_id")).toBe(identity);
        expect(headers.get("x-idempotency-key")).toBe(identity);
        expect(headers.get("x-request-id")).toBe(identity);
        expect(form.get("situation_text")).toBe(expectedSituation);
        return uploadResponse(identity, {}, uploadFilename(init));
      }),
    );
    const result = await ingestUpload(file, situation);
    expect(result.upload_id).toBe(identity);
    return identity;
  }

  it("is deterministic across equivalent reload inputs and uses UUIDv8", async () => {
    const first = await run(
      USER_A,
      new File(["same bytes"], "  résumé.txt  ", {
        type: "TEXT/PLAIN",
      }),
    );
    vi.unstubAllGlobals();
    const second = await run(
      USER_A,
      new File(["same bytes"], "résumé.txt", {
        type: "text/plain",
      }),
    );
    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("diverges for changed payloads and different authenticated users", async () => {
    const base = await run(
      USER_A,
      new File(["bytes-a"], "resume.txt", {
        type: "text/plain",
      }),
      "Situation A",
    );
    vi.unstubAllGlobals();
    const changed = await run(
      USER_A,
      new File(["bytes-b"], "resume.txt", {
        type: "text/plain",
      }),
      "Situation A",
    );
    vi.unstubAllGlobals();
    const otherUser = await run(
      USER_B,
      new File(["bytes-a"], "resume.txt", {
        type: "text/plain",
      }),
      "Situation A",
    );
    expect(changed).not.toBe(base);
    expect(otherUser).not.toBe(base);
  });

  it("preserves exact 300/301 filename normalization for supported metadata", async () => {
    const filename300 = `${"a".repeat(296)}.txt`;
    const filename301 = `${filename300}b`;

    const exact = await run(
      USER_A,
      new File(["boundary-fixture"], filename300, { type: "text/plain" }),
      "Boundary situation",
    );
    vi.unstubAllGlobals();
    const truncated = await run(
      USER_A,
      new File(["boundary-fixture"], filename301, { type: "text/plain" }),
      "Boundary situation",
    );

    expect(filename300).toHaveLength(300);
    expect(filename301).toHaveLength(301);
    expect(truncated).toBe(exact);
  });

  it("fails closed before fetch without a valid JWT subject", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({
      baseUrl: "/api",
      getToken: () => token("not-a-uuid"),
    });
    await expect(ingestUpload(new File(["x"], "x.txt"))).rejects.toMatchObject({
      status: 401,
      code: "AUTH_SUBJECT_MISMATCH",
    });
    configureApiClient({ baseUrl: "/api" });
    await expect(ingestUpload(new File(["x"], "x.txt"))).rejects.toMatchObject({
      status: 401,
      code: "AUTH_RESOLVER_UNAVAILABLE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid upload metadata before reading or dispatching file bytes", async () => {
    const fetchMock = vi.fn();
    const file = new File(["not read"], "oversized.csv", { type: "text/csv" });
    Object.defineProperty(file, "size", { value: MAX_TEXT_UPLOAD_BYTES + 1 });
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");
    vi.stubGlobal("fetch", fetchMock);

    await expect(ingestUpload(file)).rejects.toMatchObject({
      status: 413,
      code: "UPLOAD_TEXT_RESOURCE_LIMIT",
      payload: {
        error: {
          code: "UPLOAD_TEXT_RESOURCE_LIMIT",
          message: "TXT, Markdown and CSV files need to be 1MB or smaller.",
        },
      },
    });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs one frozen deterministic intake hook before the first upload dispatch", async () => {
    const events: string[] = [];
    const preparedValues: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        events.push("fetch");
        const identity = String((init?.body as FormData).get("upload_id"));
        return uploadResponse(identity, {}, uploadFilename(init));
      }),
    );
    const file = new File(["hook bytes"], " evidence.PDF ", { type: "" });

    const result = await ingestUpload(file, "  Ａ durable intake  ", undefined, {
      beforeDispatch: async (prepared) => {
        events.push("begin");
        preparedValues.push(prepared);
        expect(Object.isFrozen(prepared)).toBe(true);
        expect(prepared).toMatchObject({
          fileName: "evidence.PDF",
          mimeType: "",
          persistedFileType: "pdf",
          fileSizeBytes: file.size,
          situationText: "A durable intake",
          contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          uploadId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
        });
      },
    });

    expect(events).toEqual(["begin", "fetch"]);
    expect(preparedValues).toHaveLength(1);
    expect(result).not.toHaveProperty("storage_path");
  });

  it("performs no upload request when durable intake registration fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ingestUpload(new File(["blocked"], "blocked.txt", { type: "text/plain" }), "", undefined, {
        beforeDispatch: async () => {
          throw new Error("HOME_UPLOAD_INTAKE_UNAVAILABLE");
        },
      }),
    ).rejects.toThrow("HOME_UPLOAD_INTAKE_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not dispatch when the owner lease is cancelled during intake registration", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ingestUpload(
        new File(["cancelled"], "cancelled.txt", { type: "text/plain" }),
        "",
        controller.signal,
        {
          beforeDispatch: async () => {
            controller.abort(new DOMException("Owner changed", "AbortError"));
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries one lost response with the identical form and identities", async () => {
    configureApiClient({ baseUrl: "/api", getToken: () => token(USER_A) });
    const identities: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const identity = String(form.get("upload_id"));
      identities.push(identity);
      expect(new Headers(init?.headers).get("x-request-id")).toBe(identity);
      if (identities.length === 1) throw new TypeError("lost response");
      return uploadResponse(identity, {}, uploadFilename(init));
    });
    vi.stubGlobal("fetch", fetchMock);
    const beforeDispatch = vi.fn();
    await ingestUpload(new File(["replay"], "replay.txt", { type: "text/plain" }), "", undefined, {
      beforeDispatch,
    });
    expect(identities).toHaveLength(2);
    expect(identities[1]).toBe(identities[0]);
    expect(beforeDispatch).toHaveBeenCalledTimes(1);
  });

  it("replays one structurally invalid success with the same upload identity", async () => {
    const identities: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const identity = String((init?.body as FormData).get("upload_id"));
        identities.push(identity);
        return identities.length === 1
          ? uploadResponse("99999999-9999-8999-8999-999999999999", {}, uploadFilename(init))
          : uploadResponse(identity, {}, uploadFilename(init));
      }),
    );

    await ingestUpload(new File(["invalid replay"], "invalid.txt", { type: "text/plain" }));
    expect(identities).toHaveLength(2);
    expect(new Set(identities).size).toBe(1);
  });

  it("fails after two malformed successful acknowledgements without a third request", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const identity = String((init?.body as FormData).get("upload_id"));
      return uploadResponse(
        identity,
        {
          confirm_payload: {
            summary: "A synthetic source for upload tests.",
            document_type: "text file",
            structure: [{ title: "Source", items: ["Synthetic fact"] }],
            filename: uploadFilename(init),
            char_count: 999,
            truncated: false,
          },
        },
        uploadFilename(init),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ingestUpload(new File(["invalid twice"], "invalid.txt", { type: "text/plain" })),
    ).rejects.toMatchObject({ status: 502, code: "UPLOAD_RESPONSE_INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replays one truncated successful upload acknowledgement exactly", async () => {
    configureApiClient({ baseUrl: "/api", getToken: () => token(USER_A) });
    const identities: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const identity = String((init?.body as FormData).get("upload_id"));
        identities.push(identity);
        return identities.length === 1
          ? new Response('{"upload_id":', { status: 200 })
          : uploadResponse(identity, {}, uploadFilename(init));
      }),
    );

    await ingestUpload(
      new File(["truncated"], "truncated.txt", {
        type: "text/plain",
      }),
    );
    expect(identities).toHaveLength(2);
    expect(identities[1]).toBe(identities[0]);
  });

  it("boundedly rechecks the same in-flight upload after a lost response", async () => {
    configureApiClient({ baseUrl: "/api", getToken: () => token(USER_A) });
    const identities: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const identity = String((init?.body as FormData).get("upload_id"));
        identities.push(identity);
        if (identities.length === 1) throw new TypeError("first response lost");
        if (identities.length === 2) {
          return new Response(
            JSON.stringify({
              error: {
                code: "UPLOAD_PROCESSING",
                message: "TED is already processing this exact upload.",
              },
              upload_id: identity,
              classification_status: "processing",
              durable_stage: "provider_dispatched",
              retryable: true,
              retry_after_seconds: 0,
            }),
            {
              status: 409,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": "0",
              },
            },
          );
        }
        return uploadResponse(identity, {}, uploadFilename(init));
      }),
    );

    await ingestUpload(
      new File(["in flight"], "in-flight.txt", {
        type: "text/plain",
      }),
    );
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(1);
  });
});
