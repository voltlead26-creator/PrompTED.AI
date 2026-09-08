import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert";
import {
  type OllamaConfiguration,
  OllamaError,
  type OllamaInput,
  requestOllama,
  validateOllamaConfiguration,
} from "./ollama-transport.ts";

const config: OllamaConfiguration = {
  baseUrl: "http://127.0.0.1:11434",
  model: "gpt-oss:20b",
  modelDigest: "a".repeat(64),
  configurationVersion: "ollama-local.1",
  contextTokens: 8192,
};
const schema = {
  type: "object",
  additionalProperties: false,
  properties: { decision: { type: "string", enum: ["approve", "reject"] } },
  required: ["decision"],
};
function input(overrides: Partial<OllamaInput> = {}): OllamaInput {
  return {
    systemPrompt: "Synthetic task",
    messages: [{ role: "user", content: "Synthetic document" }],
    maxOutputTokens: 100,
    reasoningEffort: "low",
    schema,
    allowedTools: [],
    attemptId: "synthetic-attempt-1",
    signal: new AbortController().signal,
    timeoutMs: 1000,
    ...overrides,
  };
}
function completed(overrides: Record<string, unknown> = {}) {
  return {
    model: config.model,
    done: true,
    done_reason: "stop",
    message: { role: "assistant", content: '{"decision":"approve"}' },
    prompt_eval_count: 10,
    eval_count: 5,
    ...overrides,
  };
}
async function withFetch(
  run: (calls: { url: string; init?: RequestInit }[]) => Promise<void>,
  reply?: (
    url: string,
    init?: RequestInit,
    index?: number,
  ) => Response | Promise<Response> | undefined,
) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((url, init) => {
    const name = String(url);
    calls.push({ url: name, init });
    return Promise.resolve(
      reply?.(name, init, calls.length) ??
        (name.endsWith("/api/tags")
          ? Response.json({
            models: [{ name: config.model, digest: config.modelDigest }],
          })
          : Response.json(completed())),
    );
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}
function hasCode(
  code: string,
  dispatched?: boolean,
  reconciliationRequired?: boolean,
) {
  return (error: unknown) =>
    error instanceof OllamaError && error.code === code &&
    (dispatched === undefined || error.dispatched === dispatched) &&
    (reconciliationRequired === undefined ||
      error.reconciliationRequired === reconciliationRequired);
}

Deno.test("Ollama executes schema-bound local inference with actual provenance and no API key", async () => {
  await withFetch(async (calls) => {
    const result = await requestOllama(config, input(), "local");
    deepStrictEqual(result.structured, { decision: "approve" });
    strictEqual(result.provider, "ollama");
    strictEqual(result.model, config.model);
    strictEqual(result.modelDigest, config.modelDigest);
    strictEqual(result.responseId, "ollama:synthetic-attempt-1");
    strictEqual(result.inputTokens, 10);
    strictEqual(result.outputTokens, 5);
    deepStrictEqual(calls.map((call) => new URL(call.url).pathname), [
      "/api/tags",
      "/api/chat",
      "/api/tags",
    ]);
    for (const call of calls) {
      strictEqual(new Headers(call.init?.headers).has("Authorization"), false);
      strictEqual(call.init?.redirect, "error");
    }
    const body = JSON.parse(String(calls[1].init?.body));
    deepStrictEqual(body.format, schema);
    strictEqual(body.model, config.model);
    strictEqual(body.stream, false);
    strictEqual(body.options.num_predict, 100);
  });
});

Deno.test("Ollama configuration rejects remote local-mode targets, cloud models and invalid identity", () => {
  for (
    const override of [
      { baseUrl: "https://ollama.com" },
      { baseUrl: "http://10.0.0.1:11434" },
      { baseUrl: "http://localhost.evil.example" },
      { baseUrl: "http://user:password@localhost" },
      { baseUrl: "http://localhost/api" },
      { baseUrl: "http://localhost/?token=x" },
      { baseUrl: "file:///api/chat" },
      { model: "gpt-oss:120b-cloud" },
      { modelDigest: "unpinned" },
      { configurationVersion: "" },
      { contextTokens: 1 },
      { apiKey: "secret\nheader" },
    ]
  ) {
    throws(
      () => validateOllamaConfiguration({ ...config, ...override }, "local"),
      hasCode("OLLAMA_CONFIGURATION_INVALID"),
    );
  }
  for (const environment of ["production", "staging", "preview", "unknown"]) {
    throws(
      () => validateOllamaConfiguration(config, environment),
      hasCode("OLLAMA_CONFIGURATION_INVALID"),
    );
  }
  validateOllamaConfiguration({
    ...config,
    baseUrl: "http://host.docker.internal:11434",
  }, "local");
  validateOllamaConfiguration({
    ...config,
    baseUrl: "https://inference.example.com",
    apiKey: "synthetic-dedicated-key",
  }, "production");
});

Deno.test("Ollama rejects unsupported tools, invalid inputs and context overflow before network dispatch", async () => {
  await withFetch(async (calls) => {
    await rejects(
      () =>
        requestOllama(config, input({ allowedTools: ["web_search"] }), "local"),
      hasCode("OLLAMA_TOOLS_UNAVAILABLE", false),
    );
    for (
      const override of [{ maxOutputTokens: 0 }, { timeoutMs: 0 }, {
        attemptId: "",
      }, { systemPrompt: "" }]
    ) {
      await rejects(
        () => requestOllama(config, input(override), "local"),
        hasCode("OLLAMA_INPUT_INVALID", false),
      );
    }
    await rejects(
      () =>
        requestOllama(config, input({ schema: { type: "object" } }), "local"),
      hasCode("OLLAMA_SCHEMA_INVALID", false),
    );
    await rejects(
      () =>
        requestOllama(
          config,
          input({ messages: [{ role: "user", content: "x".repeat(8192) }] }),
          "local",
        ),
      hasCode("OLLAMA_CONTEXT_LIMIT_EXCEEDED", false),
    );
    strictEqual(calls.length, 0);
  });
});

Deno.test("Ollama rejects schema violations instead of coercing, dropping or inventing fields", async () => {
  for (
    const content of [
      '{"decision":"maybe"}',
      '{"decision":1}',
      "{}",
      '{"decision":"approve","extra":true}',
      "[]",
      "not JSON",
    ]
  ) {
    await withFetch(
      async () => {
        await rejects(
          () => requestOllama(config, input(), "local"),
          hasCode("OLLAMA_STRUCTURED_OUTPUT_INVALID", true),
        );
      },
      (url) =>
        url.endsWith("/api/chat")
          ? Response.json(
            completed({ message: { role: "assistant", content } }),
          )
          : undefined,
    );
  }
});

Deno.test("Ollama validates completion, model, role, tool calls and token accounting", async () => {
  for (
    const override of [
      { model: "different-model" },
      { done: false },
      { done_reason: "length" },
      { prompt_eval_count: -1 },
      { eval_count: "5" },
      { eval_count: 1.5 },
      { message: { role: "user", content: "wrong role" } },
      { message: { role: "assistant", content: "" } },
      {
        message: {
          role: "assistant",
          content: '{"decision":"approve"}',
          tool_calls: [{}],
        },
      },
    ]
  ) {
    await withFetch(
      async () => {
        await rejects(
          () => requestOllama(config, input(), "local"),
          hasCode("OLLAMA_RESPONSE_INVALID", true),
        );
      },
      (url) =>
        url.endsWith("/api/chat")
          ? Response.json(completed(override))
          : undefined,
    );
  }
});

Deno.test("Ollama refuses missing or changed model digests before and after inference", async () => {
  for (const changeAt of [1, 3]) {
    await withFetch(
      async (calls) => {
        await rejects(
          () => requestOllama(config, input(), "local"),
          hasCode("OLLAMA_MODEL_CHANGED_OR_UNAVAILABLE", changeAt === 3),
        );
        strictEqual(calls.length, changeAt);
      },
      (_url, _init, index) =>
        index === changeAt
          ? Response.json({
            models: [{ name: config.model, digest: "b".repeat(64) }],
          })
          : undefined,
    );
  }
});

Deno.test("Ollama transport does not retry HTTP failures or ambiguous dispatches", async () => {
  for (const status of [401, 404, 429, 500, 503]) {
    await withFetch(
      async (calls) => {
        await rejects(
          () => requestOllama(config, input(), "local"),
          hasCode("OLLAMA_UPSTREAM_ERROR", true, status >= 500),
        );
        strictEqual(calls.length, 2);
      },
      (url) =>
        url.endsWith("/api/chat")
          ? new Response("rejected", { status })
          : undefined,
    );
  }
  await withFetch(async (calls) => {
    await rejects(
      () => requestOllama(config, input(), "local"),
      hasCode("OLLAMA_UNAVAILABLE", true, true),
    );
    strictEqual(calls.length, 2);
  }, (url) => {
    if (url.endsWith("/api/chat")) throw new TypeError("network loss");
    return undefined;
  });
});

Deno.test("Ollama cancellation before dispatch sends nothing; cancellation after dispatch stays ambiguous", async () => {
  const before = new AbortController();
  before.abort();
  await withFetch(async (calls) => {
    await rejects(
      () => requestOllama(config, input({ signal: before.signal }), "local"),
      { name: "AbortError" },
    );
    strictEqual(calls.length, 0);
  });
  const after = new AbortController();
  await withFetch(async () => {
    await rejects(
      () => requestOllama(config, input({ signal: after.signal }), "local"),
      hasCode("OLLAMA_CANCELLED", true, true),
    );
  }, (url) => {
    if (url.endsWith("/api/chat")) {
      after.abort();
      throw after.signal.reason;
    }
    return undefined;
  });
});

Deno.test("Ollama request deadline aborts inference without an automatic retry", async () => {
  await withFetch(async (calls) => {
    await rejects(
      () => requestOllama(config, input({ timeoutMs: 10 }), "local"),
      hasCode("OLLAMA_TIMEOUT", true, true),
    );
    strictEqual(calls.length, 2);
  }, (url, init) => {
    if (!url.endsWith("/api/chat")) return undefined;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
  });
});

Deno.test("rejected local wording retains measured token usage without being accepted", async () => {
  await withFetch(
    async () => {
      await rejects(
        () => requestOllama(config, input(), "local"),
        (error: unknown) => {
          if (!(error instanceof OllamaError)) return false;
          strictEqual(error.code, "OLLAMA_STRUCTURED_OUTPUT_INVALID");
          strictEqual(error.reconciliationRequired, false);
          deepStrictEqual(error.usage, {
            inputTokens: 10,
            outputTokens: 5,
            responseId: "ollama:synthetic-attempt-1",
          });
          return true;
        },
      );
    },
    (url) =>
      url.endsWith("/api/chat")
        ? Response.json(
          completed({
            message: {
              role: "assistant",
              content: '{"decision":"unsupported"}',
            },
          }),
        )
        : undefined,
  );
});
