import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  callOpenAIResponses,
  chatToResponsesBody,
  normalizeResponsesBody,
  parsePromptedControl,
} from "./openai-proxy.ts";
import { bindModelCallContext } from "./model-call-context.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function meteredSignal(): AbortSignal {
  const controller = new AbortController();
  bindModelCallContext(controller.signal, {
    userId: "33333333-3333-4333-8333-333333333333",
    generationRequestId: "openai-proxy-test",
    admin: {
      rpc(name: string, args: Record<string, unknown>) {
        if (name === "claim_openai_capacity_lease") {
          const routeLeaseIds: Record<string, string> = {
            fast: "77777777-7777-4777-8777-777777777777",
            deep: "88888888-8888-4888-8888-888888888888",
            research: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            review: "99999999-9999-4999-8999-999999999999",
          };
          return Promise.resolve({
            data: {
              outcome: "admitted",
              capacity_admitted: true,
              capacity_lease_id: routeLeaseIds[String(args.p_semantic_route)],
              lease_token: args.p_lease_token,
              environment: args.p_environment,
              semantic_route: args.p_semantic_route,
              estimated_tokens: args.p_estimated_tokens,
              config_revision: 1,
              expires_at: "2099-01-01T00:00:00.000Z",
            },
            error: null,
          });
        }
        if (name === "mark_openai_capacity_lease_dispatched") {
          return Promise.resolve({
            data: {
              outcome: "dispatched",
              capacity_lease_id: args.p_capacity_lease_id,
              dispatched_at: "2026-09-01T00:00:00.000Z",
            },
            error: null,
          });
        }
        if (name === "release_openai_capacity_lease") {
          return Promise.resolve({
            data: {
              outcome: "released",
              capacity_lease_id: args.p_capacity_lease_id,
              terminal_outcome: args.p_terminal_outcome,
            },
            error: null,
          });
        }
        if (name === "read_legacy_model_call_checkpoint") {
          const admissionId = String(args.p_logical_stage_key).includes("review")
            ? "66666666-6666-4666-8666-666666666666"
            : "55555555-5555-4555-8555-555555555555";
          return Promise.resolve({
            data: {
              state: "prepared",
              provider_permitted: true,
              attempt_number: 1,
              attempt_admission_id: admissionId,
              execution_claim_token: args.p_execution_claim_token,
            },
            error: null,
          });
        }
        if (name === "mark_legacy_model_attempt_dispatched") {
          return Promise.resolve({
            data: {
              state: "dispatched",
              attempt_admission_id: args.p_attempt_admission_id,
              provider_attempt_id: args.p_attempt_admission_id,
            },
            error: null,
          });
        }
        if (name === "claim_user_external_egress") {
          return Promise.resolve({
            data: {
              outcome: "accepted",
              egress_permitted: true,
              dispatch_token: args.p_dispatch_token,
            },
            error: null,
          });
        }
        if (name === "complete_user_external_egress") {
          return Promise.resolve({
            data: { outcome: "completed" },
            error: null,
          });
        }
        return Promise.resolve({
          data: {
            usage_ledger_id: "44444444-4444-4444-8444-444444444444",
            model_call_key: "b".repeat(64),
          },
          error: null,
        });
      },
    } as unknown as SupabaseClient,
  });
  return controller.signal;
}

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
  assertEquals(normalized.input, [{
    role: "user",
    content: "Synthetic input",
  }]);
});

Deno.test("chat compatibility converts messages without preserving provider policy", () => {
  const control = parsePromptedControl({
    prompted_control: { task: "clarify" },
  });
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
  Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");
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
      }, {
        task: "clarify",
        reviewOutput: false,
        highReasoning: false,
        reason: "",
      }),
      {
        task: "clarify",
        reviewOutput: false,
        highReasoning: false,
        reason: "",
      },
      meteredSignal(),
    );
    assertEquals(response.status, 200);
    assert(outbound);
    const sent = outbound as Record<string, unknown>;
    assertEquals(sent.model, "gpt-5.6-luna");
    assertEquals(sent.store, false);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("PROMPTED_DEPLOYMENT_ENV");
  }
});

Deno.test("failed required review never returns an unreviewed draft as success", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  Deno.env.set("OPENAI_API_KEY", "synthetic-test-key");
  Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");
  globalThis.fetch = (() => {
    callCount += 1;
    if (callCount === 1) {
      return Promise.resolve(Response.json({
        id: "resp_draft",
        status: "completed",
        output_text: "Unreviewed draft",
      }));
    }
    return Promise.resolve(
      new Response("private review error", { status: 422 }),
    );
  }) as typeof fetch;

  try {
    const response = await callOpenAIResponses(
      normalizeResponsesBody({
        input: [
          { role: "system", content: "Draft safely" },
          { role: "user", content: "Synthetic document" },
        ],
      }, {
        task: "document_generation",
        reviewOutput: true,
        highReasoning: false,
        reason: "risk",
      }),
      {
        task: "document_generation",
        reviewOutput: true,
        highReasoning: false,
        reason: "risk",
      },
      meteredSignal(),
    );
    const payload = await response.json();
    assertEquals(response.status, 422);
    assertEquals(payload.error.code, "OPENAI_UPSTREAM_ERROR");
    assert(!JSON.stringify(payload).includes("Unreviewed draft"));
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("OPENAI_API_KEY");
    Deno.env.delete("PROMPTED_DEPLOYMENT_ENV");
  }
});
