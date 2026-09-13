import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  configureApiClient,
  generateDocumentStream,
  type ApiRequestContext,
  type GenerateDocumentInput,
} from "./index";

const userId = "11111111-1111-4111-8111-111111111111";
const encoder = new TextEncoder();
const section = (key = "issue", content = "I was charged $10 twice.") => ({
  type: "section",
  key,
  label: key,
  content,
});
const frame = (value: unknown) => "data: " + JSON.stringify(value) + "\n\n";
const done = "data: [DONE]\n\n";
const input: GenerateDocumentInput = {
  template_id: "complaint-letter",
  generation_request_id: "synthetic-document-stream",
  sections: [
    { key: "issue", label: "Issue", required: true },
    { key: "request", label: "Request", required: false },
  ],
};
const complete = frame(section()) + frame(section("request", "Please review the charge."));

function context(signal = new AbortController().signal): ApiRequestContext {
  return { expectedUserId: userId, principalEpoch: 1, signal, assertCurrent: () => undefined };
}

function response(
  chunks: Array<string | Uint8Array>,
  close = true,
  cancelFailure?: Error,
  contentType = "text/event-stream",
) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn(() => {
    if (cancelFailure) throw cancelFailure;
  });
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      for (const chunk of chunks) {
        value.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      if (close) value.close();
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { headers: { "Content-Type": contentType } })),
  );
  return { body, cancel, controller };
}

beforeEach(() => {
  configureApiClient({
    baseUrl: "/api",
    getToken: () => "header." + btoa(JSON.stringify({ sub: userId })) + ".signature",
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  configureApiClient({ baseUrl: "/api" });
});

describe("legacy document stream acceptance", () => {
  it.each([
    { name: "JSON null allowance response", status: 402, wire: "null", payload: null },
    { name: "malformed authentication response", status: 401, wire: "{", payload: {} },
    { name: "malformed permission response", status: 403, wire: "{", payload: {} },
    { name: "malformed server response", status: 500, wire: "{", payload: {} },
  ])("retains HTTP$status for a $name without publishing a document", async ({ status, wire, payload }) => {
    const httpResponse = new Response(wire, {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValue(httpResponse);
    vi.stubGlobal("fetch", fetchMock);
    const onSection = vi.fn();
    const onDesign = vi.fn();
    const onMissing = vi.fn();
    const onUnresolved = vi.fn();
    const onDraft = vi.fn();
    const lease = context();
    const request = generateDocumentStream(input, onSection, lease, onDesign, onMissing, onUnresolved, onDraft);

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status, code: "STREAM_FAILED", payload });
    expect(httpResponse.bodyUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSection).not.toHaveBeenCalled();
    expect(onDesign).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
    expect(onUnresolved).not.toHaveBeenCalled();
    expect(onDraft).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/generate-document");
    expect(init.signal).toBe(lease.signal);
    expect(JSON.parse(String(init.body)).generation_request_id).toBe(input.generation_request_id);
  });

  it.each<{ name: string; code: unknown }>([
    { name: "an object with a non-callable toString", code: { toString: null } },
    { name: "an empty object", code: {} },
    { name: "an array", code: [] },
    { name: "a number", code: 42 },
    { name: "a boolean", code: false },
  ])("retains HTTP402 and the original payload when the document error code is $name", async ({ code }) => {
    const payload = { error: { code, message: "Synthetic allowance response." } };
    const httpResponse = new Response(JSON.stringify(payload), {
      status: 402,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValue(httpResponse);
    vi.stubGlobal("fetch", fetchMock);
    const onSection = vi.fn();
    const onDesign = vi.fn();
    const onMissing = vi.fn();
    const onUnresolved = vi.fn();
    const onDraft = vi.fn();
    const lease = context();
    const request = generateDocumentStream(input, onSection, lease, onDesign, onMissing, onUnresolved, onDraft);

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ status: 402, code: "STREAM_FAILED" });
    await expect(request).rejects.toHaveProperty("payload", payload);
    expect(httpResponse.bodyUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onSection).not.toHaveBeenCalled();
    expect(onDesign).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
    expect(onUnresolved).not.toHaveBeenCalled();
    expect(onDraft).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/generate-document");
    expect(init.signal).toBe(lease.signal);
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("delivers supported nested clarification metadata after the complete section set", async () => {
    const missing = {
      type: "missing_info",
      sections: [{ key: "request", label: "Request", missing: ["Preferred response date"] }],
    };
    const unresolved = {
      type: "unresolved_placeholders",
      placeholders: [
        {
          id: "complaint_letter.request.response_date",
          profileKey: "complaint_letter",
          sectionKey: "request",
          informationKey: "response_date",
          label: "Response date",
          question: "When would you like a response?",
          factType: "date",
          requiredForExport: false,
          automaticFallback: "Please respond at your earliest convenience.",
          sharedResolutionKey: "response_date",
          neutralReplacementOptions: [
            {
              id: "omit_date",
              label: "Use a general request",
              value: "Please respond at your earliest convenience.",
              suitability: "No specific date is needed.",
              clearsExportWarning: true,
              regenerateSurroundingWording: false,
            },
          ],
        },
      ],
    };
    response(
      [
        complete +
          frame(missing) +
          frame(unresolved) +
          frame({ type: "advice_boundary", level: "light" }) +
          done,
      ],
      true,
      undefined,
      "text/event-stream; charset=utf-8",
    );
    const onSection = vi.fn();
    const onMissing = vi.fn();
    const onUnresolved = vi.fn();
    await generateDocumentStream(input, onSection, context(), undefined, onMissing, onUnresolved);
    expect(onSection.mock.calls.map(([event]) => event.key)).toEqual(["issue", "request"]);
    expect(onMissing).toHaveBeenCalledExactlyOnceWith(missing);
    expect(onUnresolved).toHaveBeenCalledExactlyOnceWith(unresolved);
    expect(onMissing.mock.invocationCallOrder[0]).toBeGreaterThan(
      onSection.mock.invocationCallOrder[1]!,
    );
  });

  it("requires the exact event-stream MIME token", async () => {
    response([complete + done], true, undefined, "text/event-stream-invalid");
    await expect(generateDocumentStream(input, vi.fn(), context())).rejects.toMatchObject({
      code: "DOCUMENT_STREAM_CONTENT_TYPE_INVALID",
    });
  });

  it("rejects a coerced advice level", async () => {
    response([complete + frame({ type: "advice_boundary", level: ["light"] }) + done]);
    await expect(generateDocumentStream(input, vi.fn(), context())).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("rejects an oversized raw chunk before allocating decoded text", async () => {
    response([new Uint8Array(8_380_000 + 64 * 1024 + 1)]);
    const decode = vi.spyOn(TextDecoder.prototype, "decode");
    await expect(generateDocumentStream(input, vi.fn(), context())).rejects.toMatchObject({
      code: "DOCUMENT_STREAM_LIMIT_EXCEEDED",
    });
    expect(decode.mock.calls.length).toBe(0);
  });

  it("does not charge an initial BOM against a later maximum-size frame", async () => {
    const frameOverhead = encoder.encode(frame(section("issue", "x"))).byteLength - 1;
    const maximumFrame = frame(section("issue", "x".repeat(1024 * 1024 - frameOverhead)));
    response([
      "\uFEFF: heartbeat\n\n",
      maximumFrame.slice(0, -1),
      maximumFrame.slice(-1) + frame(section("request")) + done,
    ]);
    const callback = vi.fn();
    await generateDocumentStream(input, callback, context());
    expect(callback).toHaveBeenCalledTimes(2);
  });
  it.each(["\n", "\r\n", "\r"])(
    "accepts complete SSE with %j line endings and split Unicode",
    async (separator) => {
      const text = (
        "\uFEFF: heartbeat\n\nid: ignored\nevent: message\n" +
        frame(section("issue", "A café in Melbourne.")) +
        frame(section("request", "Please review the charge.")) +
        done
      ).replace(/\n/g, separator);
      const wire = encoder.encode(text);
      const { body } = response(Array.from(wire, (byte) => new Uint8Array([byte])));
      const onSection = vi.fn();
      await generateDocumentStream(input, onSection, context());
      expect(onSection.mock.calls.map(([event]) => event.content)).toEqual([
        "A café in Melbourne.",
        "Please review the charge.",
      ]);
      expect(body.locked).toBe(false);
    },
  );

  it("joins multiline data fields, ignores comments/control fields and permits data without a space", async () => {
    response([
      ': heartbeat\n\ndata:{"type":"section",\ndata:"key":"issue","label":"issue",\n' +
        'data:"content":"Known wording."}\n\n' +
        frame(section("request")) +
        "data:[DONE]\n\n",
    ]);
    const callback = vi.fn();
    await generateDocumentStream(input, callback, context());
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("keeps repeated out-of-order draft previews provisional until the ordered reviewed set completes", async () => {
    const drafts = ["request", "issue", "issue"]
      .map((key) => frame({ ...section(key), type: "draft_section" }))
      .join("");
    response([drafts + complete + frame({ type: "advice_boundary", level: "light" }) + done]);
    const onSection = vi.fn();
    const onDraft = vi.fn();
    await generateDocumentStream(
      input,
      onSection,
      context(),
      undefined,
      undefined,
      undefined,
      onDraft,
    );
    expect(onDraft).toHaveBeenCalledTimes(3);
    expect(onSection.mock.calls.map(([event]) => event.key)).toEqual(["issue", "request"]);
  });

  it("accepts an early bespoke design as the expected section roster", async () => {
    response([
      frame({
        type: "document_design",
        name: "Designed note",
        sections: [{ key: "bespoke", label: "Bespoke", required: true }],
      }) +
        frame(section("bespoke")) +
        done,
    ]);
    const onDesign = vi.fn();
    const onSection = vi.fn();
    await generateDocumentStream(
      { ...input, design_bespoke: true },
      onSection,
      context(),
      onDesign,
    );
    expect(onDesign).toHaveBeenCalledTimes(1);
    expect(onSection).toHaveBeenCalledWith(expect.objectContaining({ key: "bespoke" }));
  });

  it("retains supplied expected keys when bespoke design falls back without a design event", async () => {
    response([complete + done]);
    const callback = vi.fn();
    await generateDocumentStream({ ...input, design_bespoke: true }, callback, context());
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["malformed JSON", complete + "data: {not JSON}\n\n" + done],
    [
      "wrong section shape",
      frame({ ...section(), content: 42 }) + frame(section("request")) + done,
    ],
    ["unknown event", complete + frame({ type: "surprise" }) + done],
    ["missing terminal", complete],
    ["draft only", frame({ ...section(), type: "draft_section" })],
    ["draft only terminal", frame({ ...section(), type: "draft_section" }) + done],
    ["missing optional selected section", frame(section()) + done],
    ["duplicate final", frame(section()) + complete + done],
    ["unknown final key", frame(section("unrequested")) + frame(section("request")) + done],
    ["out-of-order final", frame(section("request")) + frame(section()) + done],
    ["late draft", complete + frame({ ...section(), type: "draft_section" }) + done],
    [
      "late design",
      complete + frame({ type: "document_design", name: "Late", sections: input.sections }) + done,
    ],
    [
      "invalid advice boundary",
      complete + frame({ type: "advice_boundary", level: "disabled" }) + done,
    ],
    [
      "unknown metadata section",
      complete +
        frame({
          type: "missing_info",
          sections: [{ key: "elsewhere", label: "Elsewhere", missing: ["A fact"] }],
        }) +
        done,
    ],
    [
      "invalid nested placeholder",
      complete +
        frame({
          type: "unresolved_placeholders",
          placeholders: [{ id: "x", sectionKey: "issue", neutralReplacementOptions: [{}] }],
        }) +
        done,
    ],
    [
      "duplicate metadata",
      complete +
        frame({ type: "missing_info", sections: [] }) +
        frame({ type: "missing_info", sections: [] }) +
        done,
    ],
    ["trailing event", complete + done + frame(section())],
    ["duplicate terminal", complete + done + done],
    ["unfinished terminal frame", complete + "data: [DONE]"],
  ])("rejects %s without publishing any final result or metadata", async (_name, wire) => {
    const { body } = response([wire]);
    const onSection = vi.fn();
    const onDesign = vi.fn();
    const onMissing = vi.fn();
    const onUnresolved = vi.fn();
    await expect(
      generateDocumentStream(input, onSection, context(), onDesign, onMissing, onUnresolved),
    ).rejects.toBeInstanceOf(ApiError);
    expect(onSection).not.toHaveBeenCalled();
    expect(onDesign).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
    expect(onUnresolved).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it.each([new Uint8Array([0xff]), new Uint8Array([0xe2, 0x82])])(
    "rejects invalid or unfinished UTF-8 instead of accepting replacement characters",
    async (bytes) => {
      response([complete, bytes, done]);
      const callback = vi.fn();
      await expect(generateDocumentStream(input, callback, context())).rejects.toMatchObject({
        code: "DOCUMENT_STREAM_ENCODING_INVALID",
      });
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it("rejects terminal success without an independently expected section roster", async () => {
    response([frame(section()) + done]);
    await expect(
      generateDocumentStream({ ...input, sections: undefined }, vi.fn(), context()),
    ).rejects.toMatchObject({ code: "DOCUMENT_STREAM_SECTION_SET_INVALID" });
  });

  it("preserves a reconciliation error even without a section roster or terminal marker", async () => {
    const failure = {
      type: "error",
      http_status: 409,
      error: {
        code: "GENERATION_RECONCILIATION_REQUIRED",
        retryable: false,
      },
    };
    response([frame(failure)]);
    await expect(
      generateDocumentStream({ ...input, sections: undefined }, vi.fn(), context()),
    ).rejects.toMatchObject({ code: failure.error.code, status: 409, payload: failure });
  });

  it("propagates synchronous consumer failure instead of treating it as malformed JSON", async () => {
    const { body } = response([complete + done]);
    const failure = new DOMException("Synthetic storage quota exceeded", "QuotaExceededError");
    await expect(
      generateDocumentStream(
        input,
        () => {
          throw failure;
        },
        context(),
      ),
    ).rejects.toBe(failure);
    expect(body.locked).toBe(false);
  });

  it("awaits asynchronous consumer failure without retry or a later callback", async () => {
    response([complete + done]);
    const failure = new Error("Synthetic save failed");
    const callback = vi.fn(() => {
      const rejected = Promise.reject(failure);
      void rejected.catch(() => undefined);
      return rejected;
    });
    await expect(generateDocumentStream(input, callback, context())).rejects.toBe(failure);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks owner identity between accepted callbacks", async () => {
    response([complete + done]);
    let current = true;
    const failure = new Error("Owner changed");
    const lease = {
      ...context(),
      assertCurrent: () => {
        if (!current) throw failure;
      },
    };
    const callback = vi.fn(() => {
      current = false;
    });
    await expect(generateDocumentStream(input, callback, lease)).rejects.toBe(failure);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("unblocks an outstanding read on cancellation and releases the reader", async () => {
    const { body, cancel, controller } = response([], false);
    const abort = new AbortController();
    const failure = new DOMException("Cancelled synthetic stream", "AbortError");
    const request = generateDocumentStream(input, vi.fn(), context(abort.signal));
    void request.catch(() => undefined);
    await vi.waitFor(() => expect(body.locked).toBe(true));
    abort.abort(failure);
    try {
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1), { timeout: 200 });
      await expect(request).rejects.toBe(failure);
      expect(body.locked).toBe(false);
    } finally {
      if (cancel.mock.calls.length === 0) controller.close();
      await request.catch(() => undefined);
    }
  });

  it("preserves the primary server error when unfinished-reader cleanup fails", async () => {
    const failure = {
      type: "error",
      http_status: 409,
      error: { code: "GENERATION_RECONCILIATION_REQUIRED" },
    };
    const { body } = response([frame(failure)], false, new Error("Synthetic cleanup failure"));
    await expect(generateDocumentStream(input, vi.fn(), context())).rejects.toMatchObject({
      code: failure.error.code,
      status: 409,
    });
    expect(body.locked).toBe(false);
  });

  it("does not wait for an unresolved transport cancellation to expose a known server error", async () => {
    const { body, cancel } = response(
      [
        frame({
          type: "error",
          error: {
            code: "GENERATION_RECONCILIATION_REQUIRED",
          },
          http_status: 409,
        }),
      ],
      false,
    );
    let release!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    cancel.mockImplementation(() => cleanup);
    let failure: unknown;
    const request = generateDocumentStream(input, vi.fn(), context()).catch((error) => {
      failure = error;
    });
    try {
      await vi.waitFor(
        () => expect(failure).toMatchObject({ code: "GENERATION_RECONCILIATION_REQUIRED" }),
        { timeout: 200 },
      );
      expect(body.locked).toBe(false);
    } finally {
      release();
      await request;
    }
  });

  it("bounds a stalled response even after the terminal marker, without publishing incomplete transport", async () => {
    vi.useFakeTimers();
    const { body, cancel } = response([complete + done], false);
    const abort = new AbortController();
    const onSection = vi.fn();
    let failure: unknown;
    const request = generateDocumentStream(input, onSection, context(abort.signal)).catch(
      (error) => {
        failure = error;
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(60_001);
      expect(failure).toMatchObject({ code: "DOCUMENT_STREAM_IDLE_TIMEOUT" });
      expect(onSection).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    } finally {
      abort.abort();
      await request;
      vi.useRealTimers();
    }
  });

  it("rejects oversized pending records with bounded memory", async () => {
    response(["data: " + "x".repeat(1024 * 1024 + 1)]);
    await expect(generateDocumentStream(input, vi.fn(), context())).rejects.toMatchObject({
      code: "DOCUMENT_STREAM_LIMIT_EXCEEDED",
    });
  });
});
