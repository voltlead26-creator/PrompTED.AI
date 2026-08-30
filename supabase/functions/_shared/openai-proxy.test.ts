import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  callOpenAIResponses,
  chatToResponsesBody,
  normalizeResponsesBody,
  parsePromptedControl,
} from "./openai-proxy.ts";

Deno.test("legacy proxy normalization removes client model and arbitrary tools", () => {
  const normalized = normalizeResponsesBody({
    model: "client-selected-model",
    input: [{ role: "user", content: "Synthetic input" }],
    tools: [{ type: "code_interpreter" }, { type: "web_search" }],
    prompted_control: { task: "document_generation", highReasoning: true },
  });

  assert(!("model" in normalized));
  assert(!("tools" in normalized));
  assertEquals(normalized.task, "document_generation");
  assertEquals(normalized.input, [{ role: "user", content: "Synthetic input" }]);
});

Deno.test("chat compatibility converts messages without preserving provider policy", () => {
  const control = parsePromptedControl({ prompted_control: { task: "clarify" } });
  const normalized = chatToResponsesBody({
    model: "untrusted-model",
    messages: [
      { role: "system", content: "Stable instructions" },
      { role: "user", content: "Synthetic question" },
    ],
  }, control);

  assertEquals(normalized.task, "clarify");
  assertEquals(normalized.input, [
    { role: "system", content: "Stable instructions" },
    { role: "user", content: "Synthetic question" },
  ]);
  assert(!("model" in normalized));
});

Deno.test("raw compatibility endpoint delegates to the semantic Responses adapter", async () => {
  const originalFetch = globalThis.fetch;
  let outbound: Record<string, unknown> | null = null;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = ((_url, init) => {
    outbound = JSON.parse(String(init?.body));
    return Promise.resolve(Response.json({
      id: "resp_proxy_test",
      status: "completed",
      output_text: "Synthetic answer",
      usage: { input_tokens: 5, output_tokens: 2 },
    }));
  }) as typeof fetch;

  try {
    const response = await callOpenAIResponses(
      normalizeResponsesBody({
        model: "untrusted-model",
        input: [
          { role: "system", content: "Stable instructions" },
          { role: "user", content: "Synthetic question" },
        ],
      }, { task: "clarify", reviewOutput: false, highReasoning: false, reason: "" }),
      { task: "clarify", reviewOutput: false, highReasoning: false, reason: "" },
    );
    assertEquals(response.status, 200);
    assert(outbound);
    const sent = outbound as Record<string, unknown>;
    assertEquals(sent.model, "gpt-5.6-luna");
    assertEquals(sent.store, false);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});

Deno.test("failed required review never returns an unreviewed draft as success", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  globalThis.fetch = (() => {
    callCount += 1;
    if (callCount === 1) {
      return Promise.resolve(Response.json({
        id: "resp_draft",
        status: "completed",
        output_text: "Unreviewed draft",
      }));
    }
    return Promise.resolve(new Response("private review error", { status: 422 }));
  }) as typeof fetch;

  try {
    const response = await callOpenAIResponses(
      normalizeResponsesBody({
        input: [
          { role: "system", content: "Draft safely" },
          { role: "user", content: "Synthetic document" },
        ],
      }, { task: "document_generation", reviewOutput: true, highReasoning: false, reason: "risk" }),
      { task: "document_generation", reviewOutput: true, highReasoning: false, reason: "risk" },
    );
    const payload = await response.json();
    assertEquals(response.status, 422);
    assertEquals(payload.error.code, "OPENAI_UPSTREAM_ERROR");
    assert(!JSON.stringify(payload).includes("Unreviewed draft"));
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
  }
});
