import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import {
  allowanceRequestSha256,
  AllowanceReservationError,
  holdDocumentAllowanceForReconciliation,
  isProviderReconciliationRequired,
  releaseDocumentAllowance,
  requireAllowanceRequestId,
  reserveDocumentAllowance,
  resolveAllowanceRequestIdentity,
  settleDocumentAllowance,
} from "./allowance-reservations.ts";

function fakeAdmin(
  handler: (
    name: string,
    args: Record<string, unknown>,
  ) =>
    | { data: unknown; error: unknown }
    | Promise<{ data: unknown; error: unknown }>,
) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      return Promise.resolve(handler(name, args));
    },
  } as never;
}

const base = {
  userId: "10000000-0000-4000-8000-000000000001",
  requestId: "generation-1",
  routeKey: "generate-document",
  body: { template_id: "resume", generation_request_id: "generation-1" },
  plan: "free" as const,
  monthlyCap: 3,
};

Deno.test("request fingerprints are canonical and route-bound", async () => {
  const first = await allowanceRequestSha256("generate-document", {
    nested: { second: 2, first: 1 },
    alpha: true,
  });
  const reordered = await allowanceRequestSha256("generate-document", {
    alpha: true,
    nested: { first: 1, second: 2 },
  });
  const otherRoute = await allowanceRequestSha256("generate-report", {
    alpha: true,
    nested: { first: 1, second: 2 },
  });
  assertEquals(first, reordered);
  assertEquals(first.length, 64);
  assertEquals(first === otherRoute, false);
});

Deno.test("request IDs reject missing, unsafe and silently truncated values", () => {
  for (const value of [undefined, "", "has spaces", "x".repeat(161)]) {
    const error = (() => {
      try {
        requireAllowanceRequestId(value);
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    assertEquals(error instanceof AllowanceReservationError, true);
    assertEquals((error as AllowanceReservationError).status, 400);
  }
  assertEquals(
    requireAllowanceRequestId("retry:1.alpha_beta-2"),
    "retry:1.alpha_beta-2",
  );
});

Deno.test("old clients receive a stable bounded legacy request identity", async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (message) => warnings.push(String(message));
  try {
    const params = {
      userId: base.userId,
      routeKey: "generate-document" as const,
      body: { template_id: "resume", situation: "Synthetic" },
    };
    const first = await resolveAllowanceRequestIdentity(undefined, params);
    const replay = await resolveAllowanceRequestIdentity(undefined, {
      ...params,
      body: { situation: "Synthetic", template_id: "resume" },
    });
    const changed = await resolveAllowanceRequestIdentity(undefined, {
      ...params,
      body: { template_id: "cover-letter", situation: "Synthetic" },
    });
    assertEquals(first, replay);
    assertEquals(first.provenance, "server_derived_legacy_v1");
    assertEquals(first.requestId.startsWith("legacy:generate-document:"), true);
    assertEquals(first.requestId === changed.requestId, false);
    assertStringIncludes(warnings[0], "legacy_generation_request_id_adapter");
    assertStringIncludes(
      warnings[0],
      "PROMPTED_LEGACY_REQUEST_ID_ADAPTER=disabled",
    );
  } finally {
    console.warn = originalWarn;
  }
});

Deno.test("legacy identity adapter has an explicit removal gate", async () => {
  Deno.env.set("PROMPTED_LEGACY_REQUEST_ID_ADAPTER", "disabled");
  try {
    await assertRejects(
      () =>
        resolveAllowanceRequestIdentity(undefined, {
          userId: base.userId,
          routeKey: "generate-checklist",
          body: { situation: "Synthetic" },
        }),
      AllowanceReservationError,
    );
  } finally {
    Deno.env.delete("PROMPTED_LEGACY_REQUEST_ID_ADAPTER");
  }
});

Deno.test("reserve passes the frozen cap snapshot and returns the DB token", async () => {
  let captured: Record<string, unknown> = {};
  const admin = fakeAdmin((name, args) => {
    assertEquals(name, "reserve_document_allowance_with_result");
    captured = args;
    return {
      data: {
        reservation_id: "20000000-0000-4000-8000-000000000001",
        state: "reserved",
        provider_permitted: true,
        expires_at: "2026-09-01T01:00:00Z",
        execution_claim_token: "30000000-0000-4000-8000-000000000001",
      },
      error: null,
    };
  });
  const reservation = await reserveDocumentAllowance(admin, base);
  assertEquals(reservation.requestId, "generation-1");
  assertEquals(
    reservation.executionClaimToken,
    "30000000-0000-4000-8000-000000000001",
  );
  assertEquals(captured.p_plan, "free");
  assertEquals(captured.p_monthly_cap, 3);
  assertEquals(captured.p_ttl_seconds, 1800);
  assertEquals(String(captured.p_request_sha256).length, 64);
});

Deno.test("cap rejection preserves the stable paywall response", async () => {
  const admin = fakeAdmin(() => ({
    data: null,
    error: { message: "ALLOWANCE_CAP_REACHED" },
  }));
  const error = await assertRejects(
    () => reserveDocumentAllowance(admin, base),
    AllowanceReservationError,
  );
  assertEquals(error.status, 402);
  assertEquals(error.code, "PAYWALL");
  assertEquals(
    (error.payload.error as Record<string, unknown>).paywall_trigger,
    true,
  );
});

Deno.test("active and settled replays never receive provider permission", async () => {
  for (const state of ["reserved", "settled"]) {
    const admin = fakeAdmin(() => ({
      data: {
        reservation_id: "20000000-0000-4000-8000-000000000001",
        state,
        provider_permitted: false,
      },
      error: null,
    }));
    const error = await assertRejects(
      () => reserveDocumentAllowance(admin, base),
      AllowanceReservationError,
    );
    assertEquals(error.status, 409);
    assertEquals(
      error.code,
      state === "settled"
        ? "GENERATION_REQUEST_COMPLETED"
        : "GENERATION_REQUEST_IN_PROGRESS",
    );
  }
});

Deno.test("a settled exact replay returns its immutable result without provider permission", async () => {
  const admin = fakeAdmin(() => ({
    data: {
      reservation_id: "20000000-0000-4000-8000-000000000001",
      state: "settled",
      provider_permitted: false,
      replay_result: {
        contract_version: "allowance-result.1",
        route_key: "generate-document",
        transport: "sse",
        payload: { events: [{ type: "section", content: "Saved" }] },
      },
    },
    error: null,
  }));
  const replay = await reserveDocumentAllowance(admin, base);
  assertEquals(replay.replayResult?.payload.events, [
    { type: "section", content: "Saved" },
  ]);
});

Deno.test("an ambiguous exact replay stays nonretryable and cannot regain provider permission", async () => {
  const admin = fakeAdmin(() => ({
    data: {
      reservation_id: "20000000-0000-4000-8000-000000000001",
      state: "awaiting_reconciliation",
      provider_permitted: false,
      reconciliation_required: true,
      reconciliation_code: "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
    },
    error: null,
  }));
  const error = await assertRejects(
    () => reserveDocumentAllowance(admin, base),
    AllowanceReservationError,
  );
  assertEquals(error.status, 409);
  assertEquals(error.code, "GENERATION_RECONCILIATION_REQUIRED");
  assertEquals(
    (error.payload.error as Record<string, unknown>).retryable,
    false,
  );
});

Deno.test("ambiguous provider work is held through the existing release RPC without release semantics", async () => {
  let releaseCode = "";
  const admin = fakeAdmin((name, args) => {
    assertEquals(name, "release_document_allowance");
    releaseCode = String(args.p_release_code);
    return {
      data: { state: "reserved", idempotent_replay: false },
      error: null,
    };
  });
  await holdDocumentAllowanceForReconciliation(admin, {
    userId: base.userId,
    reservation: {
      reservationId: "20000000-0000-4000-8000-000000000001",
      requestId: base.requestId,
      routeKey: base.routeKey,
      expiresAt: "2026-09-01T01:00:00Z",
    },
  });
  assertEquals(releaseCode, "provider_reconciliation_required");
  assertEquals(
    isProviderReconciliationRequired({
      code: "OPENAI_PROVIDER_RECONCILIATION_REQUIRED",
    }),
    true,
  );
  assertEquals(
    isProviderReconciliationRequired({
      code: "OPENAI_MODEL_CALL_RECONCILIATION_REQUIRED",
    }),
    true,
  );
  assertEquals(isProviderReconciliationRequired(new Error("timeout")), false);
});

Deno.test("settlement requires the atomic RPC to return a usage row", async () => {
  const calls: string[] = [];
  const admin = fakeAdmin((name, args) => {
    calls.push(name);
    assertEquals(name, "settle_document_allowance_with_result");
    assertEquals(args.p_provider, "openai");
    return {
      data: {
        state: "settled",
        usage_ledger_id: "30000000-0000-4000-8000-000000000001",
      },
      error: null,
    };
  });
  await settleDocumentAllowance(admin, {
    userId: base.userId,
    reservation: {
      reservationId: "20000000-0000-4000-8000-000000000001",
      requestId: base.requestId,
      routeKey: base.routeKey,
      expiresAt: "2026-09-01T01:00:00Z",
    },
    task: "document",
    inputTokens: 4,
    outputTokens: 8,
    result: {
      contract_version: "allowance-result.1",
      route_key: base.routeKey,
      transport: "sse",
      payload: { events: [{ type: "section", content: "Saved" }] },
    },
  });
  assertEquals(calls, ["settle_document_allowance_with_result"]);
});

Deno.test("settlement persistence failure is user-safe and blocks success", async () => {
  const admin = fakeAdmin(() => ({
    data: null,
    error: { message: "relation private.document_allowance_reservations" },
  }));
  const error = await assertRejects(
    () =>
      settleDocumentAllowance(admin, {
        userId: base.userId,
        reservation: {
          reservationId: "20000000-0000-4000-8000-000000000001",
          requestId: base.requestId,
          routeKey: base.routeKey,
          expiresAt: "2026-09-01T01:00:00Z",
        },
        task: "document",
        result: {
          contract_version: "allowance-result.1",
          route_key: base.routeKey,
          transport: "sse",
          payload: { events: [] },
        },
      }),
    AllowanceReservationError,
  );
  assertEquals(error.status, 500);
  assertEquals(error.code, "ALLOWANCE_PERSISTENCE_FAILED");
  assertStringIncludes(
    JSON.stringify(error.payload),
    "Nothing has been marked complete",
  );
});

Deno.test("failed provider work releases through the service-only RPC", async () => {
  let releaseCode = "";
  const admin = fakeAdmin((name, args) => {
    assertEquals(name, "release_document_allowance");
    releaseCode = String(args.p_release_code);
    return { data: { state: "released" }, error: null };
  });
  await releaseDocumentAllowance(admin, {
    userId: base.userId,
    reservation: {
      reservationId: "20000000-0000-4000-8000-000000000001",
      requestId: base.requestId,
      routeKey: base.routeKey,
      expiresAt: "2026-09-01T01:00:00Z",
    },
    releaseCode: "provider_failed",
  });
  assertEquals(releaseCode, "provider_failed");
});

Deno.test("legacy generation routes derive missing identities and expose output only after atomic settlement", async () => {
  const routeFiles = [
    ["generate-document", "../generate-document/index.ts"],
    ["generate-checklist", "../generate-checklist/index.ts"],
    ["generate-report", "../generate-report/index.ts"],
  ] as const;
  for (const [routeKey, relativePath] of routeFiles) {
    const source = await Deno.readTextFile(
      new URL(relativePath, import.meta.url),
    );
    assertStringIncludes(source, "resolveAllowanceRequestIdentity(");
    assertStringIncludes(source, `routeKey: "${routeKey}"`);
    assertStringIncludes(source, "reservation.replayResult");
    assertStringIncludes(source, "settleDocumentAllowance(auth.admin");
  }

  const document = await Deno.readTextFile(
    new URL("../generate-document/index.ts", import.meta.url),
  );
  const checklist = await Deno.readTextFile(
    new URL("../generate-checklist/index.ts", import.meta.url),
  );
  const report = await Deno.readTextFile(
    new URL("../generate-report/index.ts", import.meta.url),
  );
  const artifact = await Deno.readTextFile(
    new URL("../generate-artifact/index.ts", import.meta.url),
  );
  assertEquals(
    document.lastIndexOf("controller.enqueue(sseEvent(event))") >
      document.lastIndexOf("await settleDocumentAllowance"),
    true,
  );
  assertEquals(
    checklist.lastIndexOf("return jsonResponse(normalised") >
      checklist.lastIndexOf("await settleDocumentAllowance"),
    true,
  );
  assertEquals(
    report.lastIndexOf("controller.enqueue(sseEvent(section))") >
      report.lastIndexOf("await settleDocumentAllowance"),
    true,
  );
  assertEquals(
    artifact.lastIndexOf("controller.enqueue(sseEvent(event))") >
      artifact.lastIndexOf("await settleDocumentAllowance"),
    true,
  );
});
