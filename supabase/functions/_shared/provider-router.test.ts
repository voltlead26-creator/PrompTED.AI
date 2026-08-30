import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  buildOpenAIRequestBody,
  isRetryableProviderStatus,
  OpenAIAdapterError,
  resolveOpenAIRoute,
  routeRequest,
} from "./provider-router.ts";

const strictSchema = {
  name: "prompted_test_result",
  schema: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["approve", "reject"] },
    },
    required: ["decision"],
    additionalProperties: false,
  },
};

const hostedRouteEnvironment = {
  OPENAI_FAST_MODEL: "hosted-fast",
  OPENAI_DEEP_MODEL: "hosted-deep",
  OPENAI_RESEARCH_MODEL: "hosted-research",
  OPENAI_REVIEW_MODEL: "hosted-review",
  OPENAI_ROUTING_VERSION: "routing.hosted.test.1",
};

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map(
    Object.keys(values).map((name) => [name, Deno.env.get(name)]),
  );
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

Deno.test("semantic tasks resolve to the four approved OpenAI routes", async () => {
  assertEquals(resolveOpenAIRoute("intent").semanticRoute, "fast");
  assertEquals(resolveOpenAIRoute("clarify").model, "gpt-5.6-luna");
  assertEquals(resolveOpenAIRoute("document").semanticRoute, "deep");
  assertEquals(resolveOpenAIRoute("document").reasoningEffort, "medium");
  assertEquals(resolveOpenAIRoute("research").semanticRoute, "research");
  assertEquals(resolveOpenAIRoute("review").semanticRoute, "review");
  assertEquals(resolveOpenAIRoute("review").reasoningEffort, "high");
  await assertRejects(
    async () => resolveOpenAIRoute("client-selected-model"),
    OpenAIAdapterError,
    "OPENAI_UNKNOWN_TASK",
  );
});

Deno.test("background processing stays disabled until its durable contract is activated", async () => {
  await assertRejects(
    async () =>
      buildOpenAIRequestBody({
        task: "document",
        systemPrompt: "Draft",
        messages: [{ role: "user", content: "Synthetic input" }],
        background: true,
      }),
    OpenAIAdapterError,
    "OPENAI_BACKGROUND_NOT_ACTIVATED",
  );
});

Deno.test("route configuration uses only the versioned OpenAI environment contract", () => {
  Deno.env.set("OPENAI_FAST_MODEL", "approved-fast");
  Deno.env.set("OPENAI_ROUTING_VERSION", "routing.test.7");
  try {
    assertEquals(resolveOpenAIRoute("recommend"), {
      provider: "openai",
      semanticRoute: "fast",
      model: "approved-fast",
      reasoningEffort: "low",
      routingVersion: "routing.test.7",
      structuredOutputSchemaVersion: "text.compatibility.v1",
      allowedTools: [],
      timeoutMs: 30_000,
      maxAttempts: 2,
      background: false,
      store: false,
      fallback: null,
    });
  } finally {
    Deno.env.delete("OPENAI_FAST_MODEL");
    Deno.env.delete("OPENAI_ROUTING_VERSION");
  }
});

Deno.test("candidate routes remain defaults only for local and test fixtures", async () => {
  for (const environment of ["local", "test"]) {
    await withEnvironment({
      PROMPTED_DEPLOYMENT_ENV: environment,
      OPENAI_FAST_MODEL: undefined,
      OPENAI_DEEP_MODEL: undefined,
      OPENAI_RESEARCH_MODEL: undefined,
      OPENAI_REVIEW_MODEL: undefined,
      OPENAI_ROUTING_VERSION: undefined,
    }, () => {
      assertEquals(resolveOpenAIRoute("intent").model, "gpt-5.6-luna");
      assertEquals(resolveOpenAIRoute("document").model, "gpt-5.6-sol");
      assertEquals(resolveOpenAIRoute("research").model, "gpt-5.6-terra");
      assertEquals(resolveOpenAIRoute("review").model, "gpt-5.6-sol");
    });
  }
});

Deno.test("every hosted environment requires the complete frozen routing contract", async () => {
  for (const environment of ["production", "staging", "preview"]) {
    for (const missingName of Object.keys(hostedRouteEnvironment)) {
      await withEnvironment({
        PROMPTED_DEPLOYMENT_ENV: environment,
        ...hostedRouteEnvironment,
        [missingName]: undefined,
      }, async () => {
        const error = await assertRejects(
          async () => resolveOpenAIRoute("intent"),
          OpenAIAdapterError,
          "OPENAI_HOSTED_ROUTING_CONFIG_MISSING",
        );
        assertEquals(error.code, "OPENAI_HOSTED_ROUTING_CONFIG_MISSING");
        assertEquals(error.status, 503);
        assertEquals(error.retryable, false);
      });
    }
  }
});

Deno.test("captured machine output uses strict Structured Outputs and store false", () => {
  const body = buildOpenAIRequestBody({
    task: "document",
    systemPrompt: "Stable non-personal instructions",
    messages: [{ role: "user", content: "Synthetic input" }],
    outputSchema: strictSchema,
  });

  assertEquals(body.model, "gpt-5.6-sol");
  assertEquals(body.store, false);
  assertEquals(body.reasoning, { effort: "medium" });
  assertEquals(body.text, {
    format: {
      type: "json_schema",
      name: "prompted_test_result",
      schema: strictSchema.schema,
      strict: true,
    },
  });
  assertEquals(body.instructions, "Stable non-personal instructions");
  assert(
    !("metadata" in body),
    "document content must not be copied into metadata",
  );
});

Deno.test("web search is available only on the approved research route", () => {
  const research = buildOpenAIRequestBody({
    task: "research",
    systemPrompt: "Research",
    messages: [{ role: "user", content: "Synthetic public fact" }],
    webSearch: true,
  });
  assertEquals(research.tools, [{ type: "web_search" }]);
  assertEquals(research.include, ["web_search_call.action.sources"]);

  assertRejects(
    async () =>
      buildOpenAIRequestBody({
        task: "document",
        systemPrompt: "Draft",
        messages: [{ role: "user", content: "No web tool" }],
        webSearch: true,
      }),
    OpenAIAdapterError,
    "OPENAI_TOOL_NOT_ALLOWED",
  );
});

Deno.test("retry classification is bounded to transient failures", () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert(isRetryableProviderStatus(status), `${status} should retry`);
  }
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert(!isRetryableProviderStatus(status), `${status} should not retry`);
  }
});

Deno.test("the OpenAI adapter retries one transient failure without changing route", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const requests: Array<Record<string, unknown>> = [];
  const logs: unknown[][] = [];
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_RETRY_BASE_MS", "0");

  globalThis.fetch = ((_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    if (requests.length === 1) {
      return Promise.resolve(
        new Response("private upstream diagnostic", { status: 503 }),
      );
    }
    return Promise.resolve(Response.json({
      id: "resp_test",
      status: "completed",
      output_text: '{"decision":"approve"}',
      usage: { input_tokens: 11, output_tokens: 3 },
    }));
  }) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    const response = await routeRequest({
      task: "intent",
      systemPrompt: "system",
      messages: [{ role: "user", content: "hello" }],
      outputSchema: strictSchema,
    });
    assertEquals(response.structured, { decision: "approve" });
    assertEquals(response.routeSnapshot.semanticRoute, "fast");
    assertEquals(
      response.routeSnapshot.structuredOutputSchemaVersion,
      "prompted_test_result",
    );
    assertEquals(response.routeSnapshot.allowedTools, []);
    assertEquals(response.sources, []);
    assertEquals(
      response.attempts.map((attempt) => ({
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        errorCode: attempt.errorCode,
        responseId: attempt.responseId,
      })),
      [
        {
          attemptNumber: 1,
          status: "failed",
          errorCode: "OPENAI_UPSTREAM_ERROR",
          responseId: "",
        },
        {
          attemptNumber: 2,
          status: "succeeded",
          errorCode: null,
          responseId: "resp_test",
        },
      ],
    );
    assertEquals(requests.length, 2);
    assertEquals(requests[0].model, requests[1].model);
    assert(!JSON.stringify(logs).includes("private upstream diagnostic"));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_RETRY_BASE_MS");
  }
});

Deno.test("captured routing executes the immutable accepted model and durable attempt identity", async () => {
  const originalFetch = globalThis.fetch;
  const events: string[] = [];
  const requestBodies: Array<Record<string, unknown>> = [];
  let clientRequestId = "";
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("OPENAI_DEEP_MODEL", "changed-after-acceptance");

  globalThis.fetch = ((_url, init) => {
    events.push("fetch");
    requestBodies.push(JSON.parse(String(init?.body)));
    clientRequestId = new Headers(init?.headers).get("X-Client-Request-Id") ??
      "";
    return Promise.resolve(Response.json({
      id: "resp_accepted_route",
      status: "completed",
      output_text: '{"decision":"approve"}',
      usage: { input_tokens: 5, output_tokens: 2 },
    }));
  }) as typeof fetch;

  try {
    const acceptedRoute = {
      ...resolveOpenAIRoute("document"),
      model: "accepted-deep",
      routingVersion: "routing.accepted.1",
      structuredOutputSchemaVersion: "prompted_test_result",
      maxAttempts: 1 as const,
    };
    const response = await routeRequest({
      task: "document",
      systemPrompt: "system",
      messages: [{ role: "user", content: "synthetic" }],
      outputSchema: strictSchema,
      routeSnapshot: acceptedRoute,
      attemptLifecycle: {
        async prepare(input) {
          events.push(`prepare:${input.localAttemptNumber}`);
          assertEquals(input.routeSnapshot, acceptedRoute);
          assertEquals(input.requestSha256.length, 64);
          return {
            attemptNumber: 7,
            clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          };
        },
        async complete(input) {
          events.push(`complete:${input.attempt.attemptNumber}`);
          assertEquals(input.structuredOutput, { decision: "approve" });
        },
      },
    });

    assertEquals(events, ["prepare:1", "fetch", "complete:7"]);
    assertEquals(response.attempts[0]?.attemptNumber, 7);
    assertEquals(response.routeSnapshot, acceptedRoute);
    assertEquals(requestBodies[0]?.model, "accepted-deep");
    assertEquals(
      clientRequestId,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("OPENAI_DEEP_MODEL");
  }
});

Deno.test("an accepted route cannot bypass incomplete hosted activation", async () => {
  const acceptedRoute = await withEnvironment(
    { PROMPTED_DEPLOYMENT_ENV: "local" },
    () => ({
      ...resolveOpenAIRoute("document"),
      structuredOutputSchemaVersion: "prompted_test_result",
      maxAttempts: 1 as const,
    }),
  );

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");

  try {
    await withEnvironment({
      PROMPTED_DEPLOYMENT_ENV: "preview",
      ...hostedRouteEnvironment,
      OPENAI_REVIEW_MODEL: undefined,
    }, async () => {
      const error = await assertRejects(
        () =>
          routeRequest({
            task: "document",
            systemPrompt: "system",
            messages: [{ role: "user", content: "synthetic" }],
            outputSchema: strictSchema,
            routeSnapshot: acceptedRoute,
          }),
        OpenAIAdapterError,
        "OPENAI_HOSTED_ROUTING_CONFIG_MISSING",
      );
      assertEquals(error.code, "OPENAI_HOSTED_ROUTING_CONFIG_MISSING");
    });
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("an invalid accepted route fails before provider dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response(null, { status: 500 }));
  }) as typeof fetch;

  try {
    await assertRejects(
      () =>
        routeRequest({
          task: "document",
          systemPrompt: "system",
          messages: [{ role: "user", content: "synthetic" }],
          outputSchema: strictSchema,
          routeSnapshot: {
            ...resolveOpenAIRoute("document"),
            structuredOutputSchemaVersion: "different-schema",
          },
        }),
      OpenAIAdapterError,
      "OPENAI_ACCEPTED_ROUTE_INVALID",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("research sources are HTTPS-normalized and stably de-duplicated", async () => {
  const originalFetch = globalThis.fetch;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() =>
    Promise.resolve(Response.json({
      id: "resp_research_sources",
      status: "completed",
      output_text: "Grounded summary",
      output: [{
        type: "web_search_call",
        action: {
          sources: [
            {
              id: "source-one",
              title: "Primary source",
              url: "https://Example.com/fact#fragment",
            },
            {
              id: "duplicate",
              title: "Duplicate",
              url: "https://example.com/fact",
            },
            {
              id: "insecure",
              title: "Insecure",
              url: "http://example.com/not-allowed",
            },
            {
              title: "Second source",
              url: "https://example.org/report?q=1",
            },
          ],
        },
      }],
    }))) as typeof fetch;

  try {
    const response = await routeRequest({
      task: "research",
      systemPrompt: "research",
      messages: [{ role: "user", content: "synthetic public question" }],
      webSearch: true,
    });
    assertEquals(response.sources, [
      {
        id: "source-one",
        title: "Primary source",
        url: "https://example.com/fact",
        type: "web",
      },
      {
        id: "https://example.org/report?q=1",
        title: "Second source",
        url: "https://example.org/report?q=1",
        type: "web",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("invalid structured output fails closed without logging model text", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs: unknown[][] = [];
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() =>
    Promise.resolve(Response.json({
      id: "resp_invalid",
      status: "completed",
      output_text: "private malformed output",
    }))) as typeof fetch;
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    let captured: OpenAIAdapterError | null = null;
    try {
      await routeRequest({
        task: "intent",
        systemPrompt: "system",
        messages: [{ role: "user", content: "hello" }],
        outputSchema: strictSchema,
      });
    } catch (error) {
      if (error instanceof OpenAIAdapterError) captured = error;
    }
    assert(captured);
    assertEquals(captured.code, "OPENAI_INVALID_STRUCTURED_OUTPUT");
    assertEquals(captured.attempts.length, 1);
    assertEquals(captured.attempts[0]?.status, "failed");
    assertEquals(captured.attempts[0]?.responseId, "resp_invalid");
    assert(!JSON.stringify(logs).includes("private malformed output"));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    Deno.env.delete("OPENAI_API_KEY");
  }
});
