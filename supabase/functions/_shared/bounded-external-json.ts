// Bounded transport for the existing public-data clients. This helper owns no
// credentials, provider routes, egress records or retry policy.
export type ExternalJsonFailure =
  | "invalid_response"
  | "http_error"
  | "transport_uncertain"
  | "cancelled"
  | "timeout";

export class ExternalJsonError extends Error {
  constructor(
    readonly failure: ExternalJsonFailure,
    readonly dispatchCertain: boolean,
    readonly httpStatus?: number,
  ) {
    // Never copy an upstream message or credential-bearing URL into an error.
    super(`EXTERNAL_JSON_${failure.toUpperCase()}`);
  }
}

const TIMEOUT_REASON = Symbol("external-json-timeout");
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;
const MAX_COLLECTION_ITEMS = 5_000;
const MAX_EMPTY_CHUNKS = 32;

function cancelUnread(
  source: ReadableStream<Uint8Array> | ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    // Cleanup must be initiated, but an uncooperative source cannot postpone or
    // replace the truthful failure indefinitely.
    void source.cancel("EXTERNAL_JSON_READ_ABANDONED").catch(() => {});
  } catch {
    // The established operation result takes precedence over cleanup failure.
  }
}

function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  interruption: () => ExternalJsonError,
  discardLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(interruption());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) {
          discardLate?.(value);
          reject(interruption());
        } else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? interruption() : error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function validJsonMediaType(value: string | null): boolean {
  if (value === null) return false;
  const [mediaType, ...parameters] = value.toLowerCase().split(";");
  if (mediaType?.trim() !== "application/json") return false;
  return parameters.every((parameter) => {
    const part = parameter.trim();
    if (!part.startsWith("charset")) return true;
    return /^charset\s*=\s*(?:utf-8|"utf-8")$/.test(part);
  });
}

function validateJsonWork(value: unknown, assertBudget: () => void): void {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    assertBudget();
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new Error("JSON_WORK_LIMIT");
    }
    if (typeof item === "string") {
      // Fatal UTF-8 decoding cannot catch invalid surrogate escapes in JSON.
      for (let index = 0; index < item.length; index += 1) {
        const code = item.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = item.charCodeAt(index + 1);
          if (!(low >= 0xdc00 && low <= 0xdfff)) {
            throw new Error("JSON_UNICODE");
          }
          index += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          throw new Error("JSON_UNICODE");
        }
      }
    } else if (Array.isArray(item)) {
      if (item.length > MAX_COLLECTION_ITEMS) {
        throw new Error("JSON_WORK_LIMIT");
      }
      for (const child of item) visit(child, depth + 1);
    } else if (item !== null && typeof item === "object") {
      const entries = Object.entries(item);
      if (entries.length > MAX_COLLECTION_ITEMS) {
        throw new Error("JSON_WORK_LIMIT");
      }
      for (const [key, child] of entries) {
        visit(key, depth + 1);
        visit(child, depth + 1);
      }
    } else if (typeof item === "number" && !Number.isFinite(item)) {
      throw new Error("JSON_NUMBER");
    }
  };
  visit(value, 0);
}

export async function fetchBoundedExternalJson<T>(input: {
  url: string;
  maximumBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  validate(value: unknown): T;
}): Promise<T> {
  // Capture all caller-controlled references before the first asynchronous step.
  const { url, maximumBytes, timeoutMs, signal: callerSignal, validate } =
    input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const target = new URL(url);
  if (
    target.protocol !== "https:" || target.username || target.password ||
    target.hash ||
    !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
    maximumBytes > 8 * 1024 * 1024 ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
  ) throw new Error("EXTERNAL_JSON_CONFIGURATION_INVALID");

  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let dispatchStarted = false;
  let receivedResponse = false;
  const interruption = () =>
    new ExternalJsonError(
      controller.signal.reason === TIMEOUT_REASON ? "timeout" : "cancelled",
      !dispatchStarted || receivedResponse,
    );
  const assertBudget = () => {
    if (Date.now() >= deadline && !controller.signal.aborted) {
      controller.abort(TIMEOUT_REASON);
    }
    if (controller.signal.aborted) throw interruption();
  };
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let fullyRead = false;
  try {
    assertBudget();
    dispatchStarted = true;
    try {
      response = await untilAborted(
        fetchImpl(target.toString(), {
          headers: { Accept: "application/json" },
          signal: controller.signal,
          redirect: "error",
        }),
        controller.signal,
        interruption,
        (lateResponse) => {
          if (lateResponse.body) cancelUnread(lateResponse.body);
        },
      );
      receivedResponse = true;
      assertBudget();
    } catch (error) {
      assertBudget();
      if (error instanceof ExternalJsonError) throw error;
      throw new ExternalJsonError("transport_uncertain", false);
    }
    if (
      response.redirected ||
      (response.url && response.url !== target.toString())
    ) {
      throw new ExternalJsonError("invalid_response", true);
    }
    if (!response.ok) {
      throw new ExternalJsonError("http_error", true, response.status);
    }
    if (
      !validJsonMediaType(response.headers.get("content-type")) ||
      !response.body
    ) {
      throw new ExternalJsonError("invalid_response", true);
    }
    const length = response.headers.get("content-length");
    if (
      length !== null && (!/^\d+$/.test(length) ||
        !Number.isSafeInteger(Number(length)) || Number(length) > maximumBytes)
    ) throw new ExternalJsonError("invalid_response", true);

    reader = response.body.getReader();
    const bytes = new Uint8Array(maximumBytes);
    let total = 0;
    let chunks = 0;
    let emptyChunks = 0;
    while (true) {
      assertBudget();
      const { done, value } = await untilAborted(
        reader.read(),
        controller.signal,
        interruption,
      );
      assertBudget();
      if (done) {
        fullyRead = true;
        break;
      }
      chunks += 1;
      if (
        !(value instanceof Uint8Array) || chunks > maximumBytes ||
        value.byteLength > maximumBytes - total
      ) {
        throw new ExternalJsonError("invalid_response", true);
      }
      emptyChunks = value.byteLength === 0 ? emptyChunks + 1 : 0;
      if (emptyChunks > MAX_EMPTY_CHUNKS) {
        throw new ExternalJsonError("invalid_response", true);
      }
      bytes.set(value, total);
      total += value.byteLength;
    }
    const parsed: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, total),
      ),
    );
    validateJsonWork(parsed, assertBudget);
    const result = validate(parsed);
    assertBudget();
    return result;
  } catch (error) {
    assertBudget();
    if (error instanceof ExternalJsonError) throw error;
    throw new ExternalJsonError(
      "invalid_response",
      receivedResponse || !dispatchStarted,
    );
  } finally {
    if (reader) {
      if (!fullyRead) cancelUnread(reader);
      reader.releaseLock();
    } else if (response?.body) cancelUnread(response.body);
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
