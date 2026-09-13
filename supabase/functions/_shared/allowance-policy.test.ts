// deno-lint-ignore-file no-import-prefix -- Edge test dependencies use direct JSR specifiers pinned by the repository lockfile.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type AllowanceExecutionPolicy,
  allowanceRequestSha256,
  AllowanceReservationError,
  type DurableAllowanceResult,
  readDocumentAllowanceReplay,
  reserveDocumentAllowance,
} from "./allowance-reservations.ts";

const OWNER = "71000000-0000-4000-8000-000000000001";
const OTHER = "71000000-0000-4000-8000-000000000002";
const RESERVATION = "72000000-0000-4000-8000-000000000001";
const TOKEN = "73000000-0000-4000-8000-000000000001";
const VERSION = "legacy-template-policy.1";
const request = () => ({
  userId: OWNER,
  requestId: "policy-request.1",
  routeKey: "generate-document" as const,
  body: {
    template_id: "complaint-letter",
    situation: "Synthetic duplicate charge.",
  },
});
const reserve = (): Parameters<typeof reserveDocumentAllowance>[1] & {
  executionPolicy: AllowanceExecutionPolicy;
} => ({
  ...request(),
  plan: "business",
  monthlyCap: 1000,
  ttlSeconds: 7200,
  executionPolicy: { version: VERSION, sha256: "b".repeat(64) },
});
const durable: DurableAllowanceResult = {
  contract_version: "allowance-result.1",
  route_key: "generate-document",
  transport: "sse",
  payload: {
    events: [{
      type: "section",
      key: "issue",
      label: "The issue",
      content: "Original synthetic wording.",
    }],
  },
};

function identity(args: Record<string, unknown>) {
  return {
    user_id: args.p_user_id,
    request_id: args.p_request_id,
    route_key: args.p_route_key,
    request_sha256: args.p_request_sha256,
  };
}

function absent(args: Record<string, unknown>): Record<string, unknown> {
  return {
    contract_version: "allowance-replay.1",
    ...identity(args),
    state: "absent",
    reservation_id: null,
    reservation_status: null,
    expires_at: null,
    execution_policy_version: null,
    execution_policy_sha256: null,
    has_prior_provider_work: false,
    reconciliation_required: false,
    replay_result: null,
  };
}

function settled(args: Record<string, unknown>): Record<string, unknown> {
  return {
    ...absent(args),
    state: "settled",
    reservation_id: RESERVATION,
    reservation_status: "settled",
    expires_at: "2026-09-09T00:00:00Z",
    has_prior_provider_work: true,
    replay_result: durable,
  };
}

function admitted(args: Record<string, unknown>): Record<string, unknown> {
  return {
    contract_version: "allowance-policy-reservation.1",
    ...identity(args),
    reservation_id: RESERVATION,
    expires_at: "2026-09-09T00:00:00Z",
    state: "reserved",
    provider_permitted: true,
    execution_claim_token: TOKEN,
    execution_policy_version: args.p_execution_policy_version,
    execution_policy_sha256: args.p_execution_policy_sha256,
    replay_result: null,
  };
}

function fixture(
  reply: (
    args: Record<string, unknown>,
    path: string,
    signal: AbortSignal | undefined,
  ) => unknown | Promise<unknown>,
) {
  const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
  const admin = createClient(
    "https://allowance-policy.invalid",
    "synthetic-service-key",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        async fetch(input, init) {
          const path =
            new URL(input instanceof Request ? input.url : String(input))
              .pathname;
          assertEquals(init?.method, "POST");
          assert(typeof init?.body === "string");
          assert(path.startsWith("/rest/v1/rpc/"));
          const args: Record<string, unknown> = JSON.parse(init.body);
          calls.push({ path, args });
          const result = await reply(args, path, init.signal ?? undefined);
          return result instanceof Response
            ? result
            : new Response(JSON.stringify(result), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
        },
      },
    },
  );
  return { admin, calls };
}

Deno.test("allowance policy reader invokes only the exact owner/request/hash read command", async () => {
  const test = fixture(absent);
  const input = request();
  const result = await readDocumentAllowanceReplay(test.admin, input);
  assertEquals(result, {
    state: "absent",
    reservation: null,
    hasPriorProviderWork: false,
    reconciliationRequired: false,
  });
  assertEquals(test.calls, [{
    path: "/rest/v1/rpc/read_document_allowance_replay",
    args: {
      p_user_id: OWNER,
      p_request_id: input.requestId,
      p_route_key: input.routeKey,
      p_request_sha256: await allowanceRequestSha256(
        input.routeKey,
        input.body,
      ),
    },
  }]);
});

Deno.test("allowance policy reader preserves exact settled history with null legacy policy", async () => {
  const test = fixture(settled);
  const result = await readDocumentAllowanceReplay(test.admin, request());
  assertEquals(result.state, "settled");
  assertEquals(result.reservation?.replayResult, durable);
  assertEquals(result.reservation?.executionPolicy, undefined);
  assertEquals(result.reservation?.executionClaimToken, undefined);
  assertEquals(test.calls.length, 1);
});

Deno.test("allowance policy reader preserves recoverable infinity without inventing reconciliation", async () => {
  const test = fixture((args) => ({
    ...settled(args),
    state: "unsettled",
    reservation_status: "reserved",
    expires_at: "infinity",
    has_prior_provider_work: true,
    reconciliation_required: false,
    replay_result: null,
    execution_policy_version: VERSION,
    execution_policy_sha256: "b".repeat(64),
  }));
  const result = await readDocumentAllowanceReplay(test.admin, request());
  assertEquals(result.reservation?.expiresAt, "infinity");
  assertEquals(result.reconciliationRequired, false);
  assertEquals(result.hasPriorProviderWork, true);
  assertEquals(result.reservation?.executionPolicy, {
    version: VERSION,
    sha256: "b".repeat(64),
  });
});

for (
  const [name, change] of [
    ["wrong owner", { user_id: OTHER }],
    ["wrong request", { request_id: "other" }],
    ["wrong route", { route_key: "generate-checklist" }],
    ["wrong body digest", { request_sha256: "f".repeat(64) }],
    ["unknown state", { state: "ready" }],
    ["missing settled response", { replay_result: null }],
    ["unpaired policy", { execution_policy_version: VERSION }],
    ["extra private data", { private_source: "Do not expose" }],
    ["coerced prior work", { has_prior_provider_work: "false" }],
    ["malformed expiration", { expires_at: "tomorrow" }],
  ] as const
) {
  Deno.test(`allowance policy reader rejects ${name}`, async () => {
    const test = fixture((args) => ({ ...settled(args), ...change }));
    const error = await assertRejects(
      () => readDocumentAllowanceReplay(test.admin, request()),
      AllowanceReservationError,
    );
    assertEquals(error.code, "ALLOWANCE_PERSISTENCE_FAILED");
    assertEquals(test.calls.length, 1);
  });
}

Deno.test("allowance policy reader rejects null response instead of treating it as absent", async () => {
  const test = fixture(() => null);
  await assertRejects(
    () => readDocumentAllowanceReplay(test.admin, request()),
    AllowanceReservationError,
  );
});

Deno.test("allowance policy admission binds current and historical policy arguments in the exact RPC", async () => {
  const test = fixture(admitted);
  const input = {
    ...reserve(),
    executionPolicy: {
      ...reserve().executionPolicy,
      legacySha256: "b".repeat(64),
    },
  };
  const result = await reserveDocumentAllowance(test.admin, input);
  assertEquals(result.executionPolicy, {
    version: VERSION,
    sha256: "b".repeat(64),
  });
  assertEquals(result.executionClaimToken, TOKEN);
  assertEquals(test.calls, [{
    path: "/rest/v1/rpc/reserve_document_allowance_with_policy",
    args: {
      p_user_id: OWNER,
      p_request_id: input.requestId,
      p_route_key: input.routeKey,
      p_request_sha256: await allowanceRequestSha256(
        input.routeKey,
        input.body,
      ),
      p_plan: "business",
      p_monthly_cap: 1000,
      p_ttl_seconds: 7200,
      p_execution_policy_version: VERSION,
      p_execution_policy_sha256: "b".repeat(64),
      p_legacy_execution_policy_sha256: "b".repeat(64),
    },
  }]);
});

Deno.test("allowance policy admission preserves a concurrently completed older policy response", async () => {
  const test = fixture((args) => ({
    ...admitted(args),
    state: "settled",
    provider_permitted: false,
    execution_claim_token: null,
    execution_policy_sha256: "c".repeat(64),
    replay_result: durable,
  }));
  const result = await reserveDocumentAllowance(test.admin, reserve());
  assertEquals(result.replayResult, durable);
  assertEquals(result.executionPolicy?.sha256, "c".repeat(64));
  assertEquals(result.executionClaimToken, undefined);
});

for (
  const [name, change] of [
    ["missing token", { execution_claim_token: null }],
    ["wrong policy", { execution_policy_sha256: "c".repeat(64) }],
    ["wrong owner", { user_id: OTHER }],
    ["extra keys", { private_claim: TOKEN }],
    ["unexpected result", { replay_result: durable }],
    ["unknown state", { state: "done" }],
  ] as const
) {
  Deno.test(`allowance policy admission rejects ${name} before returning execution authority`, async () => {
    const test = fixture((args) => ({ ...admitted(args), ...change }));
    const error = await assertRejects(
      () => reserveDocumentAllowance(test.admin, reserve()),
      AllowanceReservationError,
    );
    assertEquals(error.code, "ALLOWANCE_PERSISTENCE_FAILED");
  });
}

for (const state of ["reserved", "awaiting_reconciliation"] as const) {
  Deno.test(`allowance policy ${state} without execution authority stays an explicit recovery state`, async () => {
    const test = fixture((args) => ({
      ...admitted(args),
      state,
      provider_permitted: false,
      execution_claim_token: null,
    }));
    const error = await assertRejects(
      () => reserveDocumentAllowance(test.admin, reserve()),
      AllowanceReservationError,
    );
    assertEquals(
      error.code,
      state === "reserved"
        ? "GENERATION_REQUEST_IN_PROGRESS"
        : "GENERATION_RECONCILIATION_REQUIRED",
    );
  });
}

Deno.test("allowance policy command snapshots body and policy before its first hash await", async () => {
  const test = fixture(admitted);
  const input = reserve();
  const expectedHash = await allowanceRequestSha256(input.routeKey, input.body);
  const pending = reserveDocumentAllowance(test.admin, input);
  input.userId = OTHER;
  input.body.situation = "Changed after acceptance";
  input.executionPolicy.sha256 = "f".repeat(64);
  const result = await pending;
  assertEquals(test.calls[0]?.args.p_user_id, OWNER);
  assertEquals(test.calls[0]?.args.p_request_sha256, expectedHash);
  assertEquals(result.executionPolicy?.sha256, "b".repeat(64));
});

Deno.test("allowance policy reader snapshots original identity and body before hashing", async () => {
  const test = fixture(absent);
  const input = request();
  const expectedHash = await allowanceRequestSha256(input.routeKey, input.body);
  const pending = readDocumentAllowanceReplay(test.admin, input);
  input.userId = OTHER;
  input.body.situation = "Changed after acceptance";
  await pending;
  assertEquals(test.calls[0]?.args.p_user_id, OWNER);
  assertEquals(test.calls[0]?.args.p_request_sha256, expectedHash);
});

Deno.test("allowance policy reader pre-abort makes no RPC call", async () => {
  const test = fixture(absent);
  const controller = new AbortController();
  const reason = new Error("SYNTHETIC_OWNER_CANCELLED");
  controller.abort(reason);
  const error = await assertRejects(
    () =>
      readDocumentAllowanceReplay(test.admin, {
        ...request(),
        signal: controller.signal,
      }),
    Error,
  );
  assertEquals(error, reason);
  assertEquals(test.calls, []);
});

Deno.test("allowance policy reader cancels actual SDK transport and keeps the original reason", async () => {
  let dispatched: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const test = fixture((_args, _path, signal) =>
    new Promise((_resolve, reject) => {
      assert(signal);
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
      dispatched?.();
    })
  );
  const controller = new AbortController();
  const reason = new Error("SYNTHETIC_OWNER_CANCELLED");
  const pending = readDocumentAllowanceReplay(test.admin, {
    ...request(),
    signal: controller.signal,
  });
  await started;
  controller.abort(reason);
  const error = await assertRejects(() => pending, Error);
  assertEquals(error, reason);
  assertEquals(test.calls.length, 1);
});

for (const [plan, cap, nextPlan] of [
  ["free", 3, "pro"],
  ["pro", 20, "premium"],
  ["premium", 40, "business"],
] as const) {
  Deno.test(`${plan} policy reservation cap rejection recommends only the next subscription plan`, async () => {
    const test = fixture(() => Response.json({ message: "ALLOWANCE_CAP_REACHED", code: "P0001" }, { status: 400 }));
    const error = await assertRejects(
      () => reserveDocumentAllowance(test.admin, { ...reserve(), plan, monthlyCap: cap }),
      AllowanceReservationError,
    );
    assertEquals(test.calls.length, 1);
    assertEquals(test.calls[0].path, "/rest/v1/rpc/reserve_document_allowance_with_policy");
    assertEquals(test.calls[0].args.p_user_id, OWNER);
    assertEquals(test.calls[0].args.p_plan, plan);
    assertEquals(test.calls[0].args.p_monthly_cap, cap);
    assertEquals(error.status, 402);
    assertEquals(error.code, "PAYWALL");
    assertEquals(error.payload, { error: {
      code: "PAYWALL",
      message: "You've reached your document limit for this month. Upgrade to keep going.",
      paywall_trigger: true,
      current_plan: plan,
      plan_required: nextPlan,
    } });
  });
}

Deno.test("business policy reservation cap rejection reports the monthly limit without an upgrade", async () => {
  const test = fixture(() => Response.json({ message: "ALLOWANCE_CAP_REACHED", code: "P0001" }, { status: 400 }));
  const error = await assertRejects(
    () => reserveDocumentAllowance(test.admin, { ...reserve(), plan: "business", monthlyCap: 50 }),
    AllowanceReservationError,
  );
  assertEquals(test.calls.length, 1);
  assertEquals(test.calls[0].path, "/rest/v1/rpc/reserve_document_allowance_with_policy");
  assertEquals(test.calls[0].args.p_user_id, OWNER);
  assertEquals(test.calls[0].args.p_plan, "business");
  assertEquals(test.calls[0].args.p_monthly_cap, 50);
  assertEquals(error.status, 402);
  assertEquals(error.code, "DOCUMENT_LIMIT_REACHED");
  const detail = error.payload.error as Record<string, unknown>;
  assertEquals(error.payload, { error: {
    code: "DOCUMENT_LIMIT_REACHED",
    message: detail.message,
    paywall_trigger: false,
    current_plan: "business",
  } });
  assert(typeof detail.message === "string");
  assert(detail.message.includes("month"));
  assert(detail.message.includes("next month"));
  assertEquals(/\bupgrade\b/i.test(detail.message), false);
  assertEquals(Object.hasOwn(detail, "plan_required"), false);
});

Deno.test("policy reservation cap rejection preserves owner-specific limit messaging", async () => {
  const test = fixture(() => Response.json({ message: "ALLOWANCE_CAP_REACHED", code: "P0001" }, { status: 400 }));
  const error = await assertRejects(() => reserveDocumentAllowance(test.admin, { ...reserve(), accessProfile: "owner" }), AllowanceReservationError);
  assertEquals(error.status, 402);
  assertEquals(error.code, "DOCUMENT_LIMIT_REACHED");
  assertEquals((error.payload.error as Record<string, unknown>).paywall_trigger, false);
  assertEquals(error.payload, { error: {
    code: "DOCUMENT_LIMIT_REACHED",
    message: "You have used your 1,000 documents for this month. New allowance becomes available next month.",
    paywall_trigger: false,
    current_plan: "business",
  } });
  assertEquals(test.calls.length, 1);
  assertEquals(test.calls[0].path, "/rest/v1/rpc/reserve_document_allowance_with_policy");
  assertEquals(test.calls[0].args.p_user_id, OWNER);
  assertEquals(test.calls[0].args.p_plan, "business");
  assertEquals(test.calls[0].args.p_monthly_cap, 1000);
});
