// deno-lint-ignore-file no-import-prefix -- repository Edge tests pin the JSR assertion API.
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import type { AuthContext } from "../_shared/auth-guard.ts";
import type {
  ProviderRequest,
  ProviderResponse,
} from "../_shared/provider-router.ts";
import { OpenAIAdapterError } from "../_shared/provider-router.ts";
import { EDIT_SECTION_OUTPUT_SCHEMA } from "../_shared/document-output-contracts.ts";
import { buildPersistedApplyCandidate, handleEditSection } from "./index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const STORED_CONTENT = "<p>Original wording.</p>";

async function sha256(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value),
      ),
    ),
  ).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function providerResponse(): ProviderResponse {
  const structured = {
    content: "Clear revised wording.",
    changes: ["Made the wording clearer."],
  };
  return {
    text: JSON.stringify(structured),
    structured,
    inputTokens: 20,
    outputTokens: 10,
    _provider: "openai",
    responseId: "response-test-1",
    status: "completed",
    routeSnapshot: {
      provider: "openai",
      semanticRoute: "fast",
      model: "gpt-test",
      reasoningEffort: "low",
      routingVersion: "test.1",
      structuredOutputSchemaVersion: "edit.1",
      allowedTools: [],
      timeoutMs: 1_000,
      maxAttempts: 1,
      background: false,
      store: false,
      fallback: null,
    },
    attempts: [{
      attemptNumber: 1,
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:00:01.000Z",
      status: "succeeded",
      responseId: "response-test-1",
      inputTokens: 20,
      outputTokens: 10,
      errorCode: null,
    }],
    sources: [],
  };
}

async function requestBody(): Promise<Record<string, unknown>> {
  return {
    action: "improve",
    content: "caller text must not be provider authority",
    operation_id: OPERATION_ID,
    generation_request_id: OPERATION_ID,
    document_id: DOCUMENT_ID,
    section_id: SECTION_ID,
    expected_section_revision: 7,
    accepted_content_sha256: await sha256(STORED_CONTENT),
  };
}

function request(signal?: AbortSignal): Request {
  return new Request("http://localhost/edit-section", {
    method: "POST",
    signal,
  });
}

async function assertPreDispatchTerminal(input: {
  authoritativeContent: string;
  selection?: string;
  detailCode: string;
}): Promise<void> {
  const body = {
    ...await requestBody(),
    selection: input.selection,
    accepted_content_sha256: await sha256(input.authoritativeContent),
  };
  let dispatchCalls = 0;
  let providerCalls = 0;
  let memoryCalls = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: {
            state: "accepted",
            operation_id: OPERATION_ID,
            accepted_section_revision: 7,
            accepted_content_sha256: body.accepted_content_sha256,
            authoritative_content: input.authoritativeContent,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") dispatchCalls += 1;
      assertEquals(name, "settle_legacy_section_edit");
      assertEquals(args.p_terminal_state, "terminal_failure");
      assertEquals(args.p_terminal_code, input.detailCode);
      return Promise.resolve({
        data: {
          state: "terminal_failure",
          operation_id: OPERATION_ID,
          terminal_code: args.p_terminal_code,
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => {
      memoryCalls += 1;
      return Promise.resolve("");
    },
    route: () => {
      providerCalls += 1;
      return Promise.resolve(providerResponse());
    },
  } as never);
  const payload = await response.text();

  assertEquals(dispatchCalls, 0);
  assertEquals(providerCalls, 0);
  assertEquals(memoryCalls, 0);
  assertStringIncludes(
    payload,
    `"code":"LEGACY_SECTION_EDIT_TERMINAL_FAILURE"`,
  );
  assertStringIncludes(payload, `"detail_code":"${input.detailCode}"`);
}

Deno.test("persisted Apply candidate is exact for a whole section and a unique selection", () => {
  assertEquals(
    buildPersistedApplyCandidate(
      "<p>Ignored old body.</p>",
      "",
      "One\n\nTwo & more",
    ),
    "<p>One</p><p>Two &amp; more</p>",
  );
  assertEquals(
    buildPersistedApplyCandidate(
      "<p>Hello exact selection.</p>",
      "exact selection",
      "clearer wording",
    ),
    "<p>Hello clearer wording.</p>",
  );
  assertThrows(
    () =>
      buildPersistedApplyCandidate(
        "<p>repeat and repeat</p>",
        "repeat",
        "replacement",
      ),
    Error,
    "LEGACY_SECTION_EDIT_SELECTION_AMBIGUOUS",
  );
});

Deno.test("empty and ambiguous durable inputs terminalise before provider dispatch", async () => {
  await assertPreDispatchTerminal({
    authoritativeContent: "",
    detailCode: "LEGACY_SECTION_EDIT_EMPTY_SOURCE",
  });
  await assertPreDispatchTerminal({
    authoritativeContent: "<p>repeat and repeat</p>",
    selection: "repeat",
    detailCode: "LEGACY_SECTION_EDIT_SELECTION_AMBIGUOUS",
  });
});

Deno.test("durable edit prepares before provider work and persists before SSE success", async () => {
  const order: string[] = [];
  const body = await requestBody();
  const completedCalls: Array<Record<string, unknown>> = [];
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        order.push("prepare");
        return Promise.resolve({
          data: {
            state: "accepted",
            operation_id: OPERATION_ID,
            accepted_section_revision: 7,
            accepted_content_sha256: body.accepted_content_sha256,
            authoritative_content: STORED_CONTENT,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") {
        order.push("dispatch");
        return Promise.resolve({
          data: {
            state: "provider_dispatched",
            operation_id: OPERATION_ID,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      assertEquals(name, "complete_legacy_section_edit");
      order.push("complete");
      completedCalls.push(args);
      return Promise.resolve({
        data: {
          state: "ready",
          operation_id: OPERATION_ID,
          result_sha256: "a".repeat(64),
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => {
      order.push("memory");
      return Promise.resolve("");
    },
    route: (providerRequest: ProviderRequest) => {
      order.push("provider");
      assertEquals(providerRequest.outputSchema, EDIT_SECTION_OUTPUT_SCHEMA);
      assertEquals(providerRequest.requireJson, undefined);
      assertStringIncludes(
        providerRequest.messages[0]!.content,
        "Original wording.",
      );
      assert(
        !providerRequest.messages[0]!.content.includes("caller text must"),
      );
      return Promise.resolve(providerResponse());
    },
  } as never);
  const events = await response.text();

  assertEquals(order, [
    "prepare",
    "memory",
    "dispatch",
    "provider",
    "complete",
  ]);
  assertEquals(completedCalls[0]?.p_operation_id, OPERATION_ID);
  assertEquals(
    completedCalls[0]?.p_applied_candidate_content,
    "<p>Clear revised wording.</p>",
  );
  assertStringIncludes(events, `"type":"operation"`);
  assertStringIncludes(events, `"type":"result"`);
  assertStringIncludes(events, `"operation_id":"${OPERATION_ID}"`);
  assertStringIncludes(events, `"text":"Clear "`);
  assertStringIncludes(events, `"text":"wording."`);
});

Deno.test("schema-invalid durable edit output terminalises without persisting a suggestion", async () => {
  const body = await requestBody();
  let completedCalls = 0;
  let settlementCalls = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: {
            state: "accepted",
            operation_id: OPERATION_ID,
            accepted_section_revision: 7,
            accepted_content_sha256: body.accepted_content_sha256,
            authoritative_content: STORED_CONTENT,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") {
        return Promise.resolve({
          data: {
            state: "provider_dispatched",
            operation_id: OPERATION_ID,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "complete_legacy_section_edit") {
        completedCalls += 1;
        throw new Error("schema-invalid output reached persistence");
      }
      assertEquals(name, "settle_legacy_section_edit");
      assertEquals(args.p_terminal_state, "terminal_failure");
      assertEquals(
        args.p_terminal_code,
        "LEGACY_SECTION_EDIT_RESULT_INVALID",
      );
      settlementCalls += 1;
      return Promise.resolve({
        data: {
          state: "terminal_failure",
          operation_id: OPERATION_ID,
          terminal_code: args.p_terminal_code,
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const invalidStructured = {
    content: "Clear revised wording.",
    changes: ["Made the wording clearer."],
    explanation: "This undeclared key must fail closed.",
  };
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () =>
      Promise.resolve({
        ...providerResponse(),
        text: JSON.stringify(invalidStructured),
        structured: invalidStructured,
      }),
  } as never);
  const payload = await response.text();

  assertEquals(completedCalls, 0);
  assertEquals(settlementCalls, 1);
  assertStringIncludes(
    payload,
    `"detail_code":"LEGACY_SECTION_EDIT_RESULT_INVALID"`,
  );
});

Deno.test("lost response replay returns the persisted suggestion without a second provider call", async () => {
  const body = await requestBody();
  let state: "accepted" | "ready" = "accepted";
  let providerCalls = 0;
  const resultHash = "b".repeat(64);
  const admin = {
    rpc(name: string) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: state === "accepted"
            ? {
              state,
              operation_id: OPERATION_ID,
              accepted_section_revision: 7,
              accepted_content_sha256: body.accepted_content_sha256,
              authoritative_content: STORED_CONTENT,
              idempotent_replay: false,
            }
            : {
              state,
              operation_id: OPERATION_ID,
              accepted_section_revision: 7,
              accepted_content_sha256: body.accepted_content_sha256,
              suggested_content: "Clear revised wording.",
              result_sha256: resultHash,
              applied_candidate_content: "<p>Clear revised wording.</p>",
              applied_candidate_sha256: "c".repeat(64),
              changes: ["Made the wording clearer."],
              idempotent_replay: true,
            },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") {
        return Promise.resolve({
          data: {
            state: "provider_dispatched",
            operation_id: OPERATION_ID,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      state = "ready";
      return Promise.resolve({
        data: {
          state: "ready",
          operation_id: OPERATION_ID,
          result_sha256: resultHash,
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const dependencies = {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () => {
      providerCalls += 1;
      return Promise.resolve(providerResponse());
    },
  } as never;

  // Simulate a committed server result whose first response never reaches the
  // caller; reading drives the stream to completion, but its bytes are ignored.
  await (await handleEditSection(request(), dependencies)).text();
  const replay = await (await handleEditSection(request(), dependencies))
    .text();

  assertEquals(providerCalls, 1);
  assertStringIncludes(replay, `"idempotent_replay":true`);
  assertStringIncludes(replay, `"result_sha256":"${resultHash}"`);
  assertStringIncludes(replay, `"text":"Clear "`);
  assertStringIncludes(replay, `"text":"wording."`);
});

Deno.test("ready replay made stale by an external save exposes no suggestion and never redispatches", async () => {
  const body = await requestBody();
  let providerCalls = 0;
  let nonPrepareRpcCalls = 0;
  const admin = {
    rpc(name: string) {
      if (name !== "prepare_legacy_section_edit") nonPrepareRpcCalls += 1;
      return Promise.resolve({
        data: {
          state: "stale",
          code: "LEGACY_SECTION_EDIT_STALE",
          operation_id: OPERATION_ID,
          accepted_section_revision: 7,
          accepted_content_sha256: body.accepted_content_sha256,
          current_section_revision: 8,
          current_content_sha256: "d".repeat(64),
          idempotent_replay: true,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () => {
      providerCalls += 1;
      return Promise.resolve(providerResponse());
    },
  } as never);
  const payload = await response.text();

  assertEquals(response.status, 409);
  assertEquals(nonPrepareRpcCalls, 0);
  assertEquals(providerCalls, 0);
  assertStringIncludes(payload, `"code":"LEGACY_SECTION_EDIT_STALE"`);
  assert(!payload.includes("suggested_content"));
});

Deno.test("an admitted in-flight replay is retryable and never redispatches", async () => {
  const body = await requestBody();
  let providerCalls = 0;
  let nonPrepareRpcCalls = 0;
  const admin = {
    rpc(name: string) {
      if (name !== "prepare_legacy_section_edit") nonPrepareRpcCalls += 1;
      return Promise.resolve({
        data: {
          state: "provider_dispatched",
          operation_id: OPERATION_ID,
          accepted_section_revision: 7,
          accepted_content_sha256: body.accepted_content_sha256,
          idempotent_replay: true,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () => {
      providerCalls += 1;
      return Promise.resolve(providerResponse());
    },
  } as never);
  const payload = await response.text();

  assertEquals(response.status, 409);
  assertEquals(nonPrepareRpcCalls, 0);
  assertEquals(providerCalls, 0);
  assertStringIncludes(payload, `"code":"LEGACY_SECTION_EDIT_IN_PROGRESS"`);
  assertStringIncludes(payload, `"retryable":true`);
});

Deno.test("terminal provider failure settles once and exact replay never redispatches", async () => {
  const body = await requestBody();
  let state: "accepted" | "provider_dispatched" | "terminal_failure" =
    "accepted";
  let providerCalls = 0;
  let settlementCalls = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: state === "accepted"
            ? {
              state,
              operation_id: OPERATION_ID,
              accepted_section_revision: 7,
              accepted_content_sha256: body.accepted_content_sha256,
              authoritative_content: STORED_CONTENT,
              idempotent_replay: false,
            }
            : {
              state,
              operation_id: OPERATION_ID,
              accepted_section_revision: 7,
              accepted_content_sha256: body.accepted_content_sha256,
              terminal_code: "OPENAI_KEY_UNAVAILABLE",
              idempotent_replay: true,
            },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") {
        state = "provider_dispatched";
        return Promise.resolve({
          data: {
            state,
            operation_id: OPERATION_ID,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      assertEquals(name, "settle_legacy_section_edit");
      assertEquals(args.p_terminal_state, "terminal_failure");
      assertEquals(args.p_terminal_code, "OPENAI_KEY_UNAVAILABLE");
      settlementCalls += 1;
      state = "terminal_failure";
      return Promise.resolve({
        data: {
          state,
          operation_id: OPERATION_ID,
          terminal_code: "OPENAI_KEY_UNAVAILABLE",
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const dependencies = {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () => {
      providerCalls += 1;
      throw new OpenAIAdapterError("OPENAI_KEY_UNAVAILABLE", 503, false);
    },
  } as never;

  const first = await (await handleEditSection(request(), dependencies)).text();
  const replay = await (await handleEditSection(request(), dependencies))
    .text();

  assertEquals(providerCalls, 1);
  assertEquals(settlementCalls, 1);
  assertStringIncludes(first, `"code":"LEGACY_SECTION_EDIT_TERMINAL_FAILURE"`);
  assertStringIncludes(first, `"detail_code":"OPENAI_KEY_UNAVAILABLE"`);
  assertStringIncludes(replay, `"code":"LEGACY_SECTION_EDIT_TERMINAL_FAILURE"`);
  assertStringIncludes(replay, `"detail_code":"OPENAI_KEY_UNAVAILABLE"`);
  assertStringIncludes(replay, `"idempotent_replay":true`);
});

Deno.test("pre-dispatch cancellation settles cancelled without provider dispatch", async () => {
  const body = await requestBody();
  let dispatchCalls = 0;
  let providerCalls = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: {
            state: "accepted",
            operation_id: OPERATION_ID,
            accepted_section_revision: 7,
            accepted_content_sha256: body.accepted_content_sha256,
            authoritative_content: STORED_CONTENT,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") dispatchCalls += 1;
      assertEquals(name, "settle_legacy_section_edit");
      assertEquals(args.p_terminal_state, "cancelled");
      return Promise.resolve({
        data: {
          state: "cancelled",
          operation_id: OPERATION_ID,
          terminal_code: "LEGACY_SECTION_EDIT_CANCELLED_BEFORE_DISPATCH",
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const controller = new AbortController();
  controller.abort();
  const response = await handleEditSection(request(controller.signal), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () => {
      providerCalls += 1;
      return Promise.resolve(providerResponse());
    },
  } as never);
  const events = await response.text();

  assertEquals(dispatchCalls, 0);
  assertEquals(providerCalls, 0);
  assertStringIncludes(events, `"code":"LEGACY_SECTION_EDIT_CANCELLED"`);
});

Deno.test("pre-dispatch context failure is terminal before provider dispatch", async () => {
  const body = await requestBody();
  let dispatchCalls = 0;
  let providerCalls = 0;
  let settlementCalls = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: {
            state: "accepted",
            operation_id: OPERATION_ID,
            accepted_section_revision: 7,
            accepted_content_sha256: body.accepted_content_sha256,
            authoritative_content: STORED_CONTENT,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") dispatchCalls += 1;
      assertEquals(name, "settle_legacy_section_edit");
      assertEquals(args.p_terminal_state, "terminal_failure");
      assertEquals(
        args.p_terminal_code,
        "LEGACY_SECTION_EDIT_CONTEXT_UNAVAILABLE",
      );
      settlementCalls += 1;
      return Promise.resolve({
        data: {
          state: "terminal_failure",
          operation_id: OPERATION_ID,
          terminal_code: args.p_terminal_code,
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.reject(new Error("synthetic context failure")),
    route: () => {
      providerCalls += 1;
      return Promise.resolve(providerResponse());
    },
  } as never);
  const payload = await response.text();

  assertEquals(response.status, 503);
  assertEquals(dispatchCalls, 0);
  assertEquals(providerCalls, 0);
  assertEquals(settlementCalls, 1);
  assertStringIncludes(
    payload,
    `"code":"LEGACY_SECTION_EDIT_TERMINAL_FAILURE"`,
  );
  assertStringIncludes(
    payload,
    `"detail_code":"LEGACY_SECTION_EDIT_CONTEXT_UNAVAILABLE"`,
  );
});

Deno.test("ambiguous post-dispatch outcome settles reconciliation required", async () => {
  const body = await requestBody();
  let providerCalls = 0;
  const admin = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "prepare_legacy_section_edit") {
        return Promise.resolve({
          data: {
            state: "accepted",
            operation_id: OPERATION_ID,
            accepted_section_revision: 7,
            accepted_content_sha256: body.accepted_content_sha256,
            authoritative_content: STORED_CONTENT,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      if (name === "mark_legacy_section_edit_dispatched") {
        return Promise.resolve({
          data: {
            state: "provider_dispatched",
            operation_id: OPERATION_ID,
            idempotent_replay: false,
          },
          error: null,
        });
      }
      assertEquals(name, "settle_legacy_section_edit");
      assertEquals(args.p_terminal_state, "reconciliation_required");
      assertEquals(
        args.p_terminal_code,
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
      );
      return Promise.resolve({
        data: {
          state: "reconciliation_required",
          operation_id: OPERATION_ID,
          terminal_code: args.p_terminal_code,
          idempotent_replay: false,
        },
        error: null,
      });
    },
  };
  const auth = {
    userId: USER_ID,
    isAnonymous: false,
    plan: "free",
    monthlyDocumentCap: 3,
    admin,
    body,
    generationRequestId: OPERATION_ID,
  } as unknown as AuthContext;
  const response = await handleEditSection(request(), {
    guard: () => Promise.resolve(auth),
    loadMemory: () => Promise.resolve(""),
    route: () => {
      providerCalls += 1;
      throw new OpenAIAdapterError(
        "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
        502,
        false,
      );
    },
  } as never);
  const events = await response.text();

  assertEquals(providerCalls, 1);
  assertStringIncludes(
    events,
    `"code":"LEGACY_SECTION_EDIT_RECONCILIATION_REQUIRED"`,
  );
});
