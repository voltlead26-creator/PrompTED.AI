import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { AuthError, guardRequest } from "./auth-guard.ts";
import { prepareLegacyModelAttempt, requireLegacyCheckpointContext, ModelCallContextError } from "./model-call-context.ts";

type UserFixture = {
  id: string;
  is_anonymous: boolean;
  email?: string;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  identities?: Array<Record<string, unknown>>;
};

function request(
  body: unknown,
  headers: Record<string, string> = {},
  route = "test",
): Request {
  return new Request(`https://example.test/functions/v1/${route}`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function withUser<T>(
  user: UserFixture,
  run: () => Promise<T>,
  observeRateLimit?: (payload: Record<string, unknown>) => void,
  observeCheckpoint?: (payload: Record<string, unknown>) => void,
  accessOptions: { access?: unknown; status?: number; usage?: number | null; usageStatus?: number; beforeAccess?: (signal: AbortSignal | null | undefined) => Promise<void> | void; observeAccess?: (payload: unknown) => void } = {},
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const previous = {
    url: Deno.env.get("SUPABASE_URL"),
    anon: Deno.env.get("SUPABASE_ANON_KEY"),
    service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };
  Deno.env.set("SUPABASE_URL", "https://project.test");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  let rateLimitCount = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/get_effective_product_access_v1")) {
      accessOptions.observeAccess?.(JSON.parse(String(init?.body)));
      await accessOptions.beforeAccess?.(init?.signal);
      return Response.json(accessOptions.access ?? accessFixture(user.id), { status: accessOptions.status ?? 200 });
    }
    if (url.includes("/rest/v1/usage_ledger")) {
      const count = accessOptions.usage === undefined ? 0 : accessOptions.usage;
      return new Response(null, { status: accessOptions.usageStatus ?? 200,
        headers: count === null ? {} : { "content-range": `*/${count}` } });
    }
    if (url.includes("/rest/v1/rpc/consume_rate_limit")) {
      rateLimitCount += 1;
      if (observeRateLimit && typeof init?.body === "string") {
        observeRateLimit(JSON.parse(init.body) as Record<string, unknown>);
      }
      return new Response(JSON.stringify(rateLimitCount <= 60), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/read_legacy_model_call_checkpoint")) {
      if (observeCheckpoint && typeof init?.body === "string") {
        observeCheckpoint(JSON.parse(init.body) as Record<string, unknown>);
      }
      return new Response(
        JSON.stringify({
          state: "prepared",
          provider_permitted: true,
          attempt_number: 1,
          attempt_admission_id: "20000000-0000-4000-8000-000000000001",
          execution_claim_token: "30000000-0000-4000-8000-000000000001",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      const envKey = key === "url"
        ? "SUPABASE_URL"
        : key === "anon"
        ? "SUPABASE_ANON_KEY"
        : "SUPABASE_SERVICE_ROLE_KEY";
      if (value === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, value);
    }
  }
}

const verifiedUser: UserFixture = {
  id: "81000000-0000-4000-8000-000000000001",
  is_anonymous: false,
  email: "verified@example.test",
  email_confirmed_at: "2026-08-05T00:00:00Z",
  identities: [{ provider: "email" }],
};

function accessFixture(userId: string, owner = false) {
  return { contract_version: "product-access.1", user_id: userId,
    subscription_plan: "free", effective_plan: "free", subscription_status: null,
    current_period_end: null, access_profile: owner ? "owner" : "subscription",
    monthly_document_cap: owner ? 1000 : 3, ai_editing: owner, business_features: owner };
}

Deno.test("owner access admits creation after the Free cap using the exact account RPC", async () => {
  let requested: unknown;
  await withUser(verifiedUser, async () => {
    const auth = await guardRequest(request({ prompt: "hello" }));
    assertEquals(auth.plan, "free");
    assertEquals(auth.monthlyDocumentCap, 1000);
    assertEquals(requested, { p_user_id: verifiedUser.id });
  }, undefined, undefined, { access: accessFixture(verifiedUser.id, true), usage: 3,
    observeAccess: payload => { requested = payload; } });
});

Deno.test("access service failure rejects admission instead of inventing a Free plan", async () => {
  await withUser(verifiedUser, async () => {
    const error = await assertRejects(() => guardRequest(request({}), { enforceCap: false }), AuthError);
    assertEquals(error.status, 503);
    assertEquals(error.code, "PRODUCT_ACCESS_UNAVAILABLE");
  }, undefined, undefined, { status: 503 });
});

for (const [label, change] of [
  ["foreign account", { user_id: "81000000-0000-4000-8000-000000000099" }],
  ["unlimited owner", { access_profile: "owner", monthly_document_cap: null, ai_editing: true, business_features: true }],
  ["unversioned response", { contract_version: "unknown" }],
  ["invented feature", { business_features: true }],
] as const) {
  Deno.test(`guard rejects ${label} access before model admission`, async () => {
    await withUser(verifiedUser, async () => {
      const error = await assertRejects(() => guardRequest(request({}), { enforceCap: false }), AuthError);
      assertEquals(error.code, "PRODUCT_ACCESS_INVALID");
      assertEquals(error.status, 503);
    }, undefined, undefined, { access: { ...accessFixture(verifiedUser.id), ...change } });
  });
}

Deno.test("owner cap is finite and does not advertise an upgrade", async () => {
  await withUser(verifiedUser, async () => {
    const error = await assertRejects(() => guardRequest(request({})), AuthError);
    assertEquals(error.status, 402);
    const detail = error.payload.error as Record<string, unknown>;
    assertEquals(detail.code, "DOCUMENT_LIMIT_REACHED");
    assertEquals(detail.paywall_trigger, false);
    assertEquals(detail.plan_required, undefined);
  }, undefined, undefined, { access: accessFixture(verifiedUser.id, true), usage: 1000 });
});

Deno.test("non-creation requests remain available at the owner cap", async () => {
  await withUser(verifiedUser, async () => {
    const auth = await guardRequest(request({}), { enforceCap: false });
    assertEquals(auth.access?.accessProfile, "owner");
  }, undefined, undefined, { access: accessFixture(verifiedUser.id, true), usageStatus: 503 });
});

Deno.test("ordinary admission enforces the returned cap instead of a copied plan table", async () => {
  await withUser(verifiedUser, async () => {
    const error = await assertRejects(() => guardRequest(request({})), AuthError);
    assertEquals(error.status, 402);
  }, undefined, undefined, { access: { ...accessFixture(verifiedUser.id), monthly_document_cap: 2 }, usage: 2 });
});

for (const fixture of [
  { usageStatus: 503, expected: "ACCOUNT_USAGE_UNAVAILABLE" },
  { usage: null, expected: "ACCOUNT_USAGE_INVALID" },
  { usage: -1, expected: "ACCOUNT_USAGE_UNAVAILABLE" },
  { usage: 1.5, expected: "ACCOUNT_USAGE_UNAVAILABLE" },
]) {
  Deno.test(`usage ${JSON.stringify(fixture)} cannot be treated as zero`, async () => {
    await withUser(verifiedUser, async () => {
      const error = await assertRejects(() => guardRequest(request({})), AuthError);
      assertEquals(error.code, fixture.expected);
      assertEquals(error.status, 503);
    }, undefined, undefined, fixture);
  });
}

Deno.test("cancellation rejects an access read that ignores abort and cannot publish its late reply", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let transportSignal: AbortSignal | null | undefined;
  await withUser(verifiedUser, async () => {
    const req = new Request(request({}), { signal: controller.signal });
    const error = await assertRejects(() => guardRequest(req, { enforceCap: false }), AuthError);
    assertEquals(error.code, "REQUEST_CANCELLED");
    assertEquals(transportSignal?.aborted, true);
    release();
    await held;
    await new Promise(resolve => setTimeout(resolve, 0));
    assertThrows(() => requireLegacyCheckpointContext(req.signal), ModelCallContextError);
  }, undefined, undefined, { beforeAccess(signal) { transportSignal = signal; controller.abort(); return held; } });
});

Deno.test("hung access read has a deadline even when the transport ignores abort", async () => {
  const originalTimer = globalThis.setTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    if (args[1] === 10_000) args[1] = 0;
    return originalTimer(...args);
  }) as typeof setTimeout;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let transportSignal: AbortSignal | null | undefined;
  try {
    await withUser(verifiedUser, async () => {
      const req = request({});
      const error = await assertRejects(() => guardRequest(req, { enforceCap: false }), AuthError);
      assertEquals(error.code, "PRODUCT_ACCESS_UNAVAILABLE");
      assertEquals(transportSignal?.aborted, true);
      release();
      await held;
      await new Promise(resolve => setTimeout(resolve, 0));
      assertThrows(() => requireLegacyCheckpointContext(req.signal), ModelCallContextError);
    }, undefined, undefined, { beforeAccess(signal) { transportSignal = signal; return held; } });
  } finally { release(); globalThis.setTimeout = originalTimer; }
});

Deno.test("multipart guard parses once and hands the sanitised body to the route", async () => {
  await withUser(verifiedUser, async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["reliable text"], "resume.txt", {
        type: "text/plain",
      }),
    );
    form.append("situation_text", "<b>Tailor</b> this resume");
    const guardedRequest = new Request(
      "https://example.test/functions/v1/ingest-upload",
      {
        method: "POST",
        headers: { authorization: "Bearer test-token" },
        body: form,
      },
    );
    const auth = await guardRequest(guardedRequest, { enforceCap: false });
    assertEquals(guardedRequest.bodyUsed, true);
    const handedOff = auth.multipartBody;
    assertEquals((handedOff?.get("file") as File).name, "resume.txt");
    assertEquals(handedOff?.get("situation_text"), "Tailor this resume");
  });
});

Deno.test("multipart guard rejects oversized envelopes before native form parsing", async () => {
  await withUser(verifiedUser, async () => {
    const guardedRequest = new Request(
      "https://example.test/functions/v1/ingest-upload",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "multipart/form-data; boundary=synthetic",
          "content-length": String(8 * 1024 * 1024 + 65_537),
        },
        body: "--synthetic--\r\n",
      },
    );
    const error = await assertRejects(
      () => guardRequest(guardedRequest, { enforceCap: false }),
      AuthError,
    );
    assertEquals(error.status, 413);
    assertEquals(guardedRequest.bodyUsed, false);
  });
});

Deno.test("multipart guard admits the exact source preparation field alongside the existing identity", async () => {
  await withUser(verifiedUser, async () => {
    const form = new FormData();
    form.append("file", new File(["Retained source"], "source.md", { type: "text/markdown" }));
    form.append("upload_id", "71000000-0000-8000-8000-000000000001");
    form.append("request_id", "71000000-0000-8000-8000-000000000001");
    form.append("situation_text", "Review this source");
    form.append("processing_policy_version", "upload-source-preparation.1");
    const auth = await guardRequest(new Request("https://example.test/functions/v1/ingest-upload", {
      method: "POST", headers: { authorization: "Bearer test-token" }, body: form,
    }), { enforceCap: false });
    assertEquals(auth.multipartBody?.get("processing_policy_version"), "upload-source-preparation.1");
    assertEquals(auth.multipartBody?.get("request_id"), "71000000-0000-8000-8000-000000000001");
    form.append("processing_policy_version", "upload-source-preparation.1");
    const error = await assertRejects(() => guardRequest(new Request("https://example.test/functions/v1/ingest-upload", {
      method: "POST", headers: { authorization: "Bearer test-token" }, body: form,
    }), { enforceCap: false }), AuthError);
    assertEquals(error.status, 400);
  });
});

Deno.test("multipart guard rejects duplicate and unknown parts", async () => {
  await withUser(verifiedUser, async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["reliable"], "resume.txt", {
        type: "text/plain",
      }),
    );
    form.append("situation_text", "First");
    form.append("situation_text", "Second");
    form.append("unexpected", "value");
    const error = await assertRejects(
      () =>
        guardRequest(
          new Request("https://example.test/functions/v1/ingest-upload", {
            method: "POST",
            headers: { authorization: "Bearer test-token" },
            body: form,
          }),
          { enforceCap: false },
        ),
      AuthError,
    );
    assertEquals(error.status, 400);
  });
});

Deno.test("brand-logo multipart admission is route-specific and bounded to 5 MB", async () => {
  await withUser(verifiedUser, async () => {
    const form = new FormData();
    form.append("operation_id", "81000000-0000-8000-8000-000000000001");
    form.append("binding_sha256", "a".repeat(64));
    form.append("business_id", "82000000-0000-4000-8000-000000000001");
    form.append("expected_revision", "3");
    form.append("logo_action", "replace");
    form.append("primary_colour", "#dc5430");
    form.append("secondary_colour", "");
    form.append("footer_text", "A trusted footer");
    form.append(
      "file",
      new File(["logo-bytes"], "logo.png", {
        type: "image/png",
      }),
    );
    const guardedRequest = new Request(
      "https://example.test/functions/v1/brand-logo",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "x-idempotency-key": "81000000-0000-8000-8000-000000000001",
        },
        body: form,
      },
    );

    const auth = await guardRequest(guardedRequest, { enforceCap: false });
    assertEquals(
      auth.multipartBody?.get("operation_id"),
      "81000000-0000-8000-8000-000000000001",
    );
    assertEquals(auth.multipartBody?.get("primary_colour"), "#dc5430");
    assertEquals((auth.multipartBody?.get("file") as File).size, 10);
    assertEquals(
      auth.generationRequestId,
      "81000000-0000-8000-8000-000000000001",
    );

    const oversized = new Request(
      "https://example.test/functions/v1/brand-logo",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "multipart/form-data; boundary=synthetic",
          "content-length": String(5 * 1024 * 1024 + 65_537),
        },
        body: "--synthetic--\r\n",
      },
    );
    const error = await assertRejects(
      () => guardRequest(oversized, { enforceCap: false }),
      AuthError,
    );
    assertEquals(error.status, 413);
    assertEquals(oversized.bodyUsed, false);
  });
});

Deno.test("multipart route policies cannot admit each other's fields", async () => {
  await withUser(verifiedUser, async () => {
    const brandForm = new FormData();
    brandForm.append("operation_id", "81000000-0000-8000-8000-000000000001");
    brandForm.append("situation_text", "must remain ingest-only");
    const brandError = await assertRejects(
      () =>
        guardRequest(
          new Request("https://example.test/functions/v1/brand-logo", {
            method: "POST",
            headers: { authorization: "Bearer test-token" },
            body: brandForm,
          }),
          { enforceCap: false },
        ),
      AuthError,
    );
    assertEquals(brandError.code, "MULTIPART_FIELD_INVALID");

    const ingestForm = new FormData();
    ingestForm.append(
      "file",
      new File(["reliable"], "resume.txt", {
        type: "text/plain",
      }),
    );
    ingestForm.append("operation_id", "81000000-0000-8000-8000-000000000001");
    const ingestError = await assertRejects(
      () =>
        guardRequest(
          new Request("https://example.test/functions/v1/ingest-upload", {
            method: "POST",
            headers: { authorization: "Bearer test-token" },
            body: ingestForm,
          }),
          { enforceCap: false },
        ),
      AuthError,
    );
    assertEquals(ingestError.code, "MULTIPART_FIELD_INVALID");
  });
});

Deno.test("JSON upload admission is byte bounded before parsing and handed off once", async () => {
  await withUser(verifiedUser, async () => {
    const oversized = new Request(
      "https://example.test/functions/v1/ingest-upload",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
          "content-length": String(Math.ceil(8 * 1024 * 1024 * 4 / 3) + 65_537),
        },
        body: "{}",
      },
    );
    const error = await assertRejects(
      () => guardRequest(oversized, { enforceCap: false }),
      AuthError,
    );
    assertEquals(error.status, 413);
    assertEquals(oversized.bodyUsed, false);

    const admitted = request(
      {
        upload_id: "72000000-0000-4000-8000-000000000001",
        request_id: "72000000-0000-4000-8000-000000000001",
        filename: "resume.txt",
        mime: "text/plain",
        content_base64: btoa("reliable"),
      },
      {
        "x-idempotency-key": "72000000-0000-4000-8000-000000000001",
      },
      "ingest-upload",
    );
    const auth = await guardRequest(admitted, { enforceCap: false });
    assertEquals(admitted.bodyUsed, true);
    assertEquals(auth.body?.filename, "resume.txt");
    assertEquals(auth.multipartBody, null);
  });
});

Deno.test("JSON admission rejects chunked oversized bodies without Content-Length", async () => {
  await withUser(verifiedUser, async () => {
    const chunk = new TextEncoder().encode(`{"prompt":"${"x".repeat(600_000)}`);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(new TextEncoder().encode(`${"x".repeat(600_000)}"}`));
        controller.close();
      },
    });
    const guardedRequest = new Request("https://example.test/functions/v1/clarify", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body,
    });
    const error = await assertRejects(
      () => guardRequest(guardedRequest, { enforceCap: false }),
      AuthError,
    );
    assertEquals(error.status, 413);
    assertEquals(error.code, "JSON_TOO_LARGE");
    assertEquals(guardedRequest.bodyUsed, true);
  });
});

Deno.test("JSON admission rejects excessive depth, keys, items, and malformed input", async () => {
  await withUser(verifiedUser, async () => {
    let deeplyNested: Record<string, unknown> = { value: "safe" };
    for (let depth = 0; depth < 34; depth += 1) deeplyNested = { child: deeplyNested };
    const excessiveKeys = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, index) => [`field_${index}`, index]),
    );
    const cases = [
      request(deeplyNested, {}, "clarify"),
      request(excessiveKeys, {}, "clarify"),
      request({ items: Array.from({ length: 5_001 }, (_, index) => index) }, {}, "clarify"),
    ];
    for (const candidate of cases) {
      const error = await assertRejects(
        () => guardRequest(candidate, { enforceCap: false }),
        AuthError,
      );
      assertEquals(error.status, 400);
      assertEquals(error.code, "JSON_STRUCTURE_LIMIT");
    }

    const malformed = new Request("https://example.test/functions/v1/clarify", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: "{not-json",
    });
    const malformedError = await assertRejects(
      () => guardRequest(malformed, { enforceCap: false }),
      AuthError,
    );
    assertEquals(malformedError.status, 400);
    assertEquals(malformedError.code, "INVALID_TYPE");
  });
});

Deno.test("guard binds a route-scoped durable admission before model work", async () => {
  const observed: Array<Record<string, unknown>> = [];
  await withUser(
    { ...verifiedUser, id: "40000000-0000-4000-8000-000000000001" },
    async () => {
      const guardedRequest = request(
        { generation_request_id: "clarify-request-1", prompt: "hello" },
        {},
        "clarify",
      );
      await guardRequest(guardedRequest, { enforceCap: false });
      const prepared = await prepareLegacyModelAttempt(guardedRequest.signal, {
        logicalStageKey: "clarify.primary",
        requestSha256: "a".repeat(64),
        attemptNumber: 1,
      });
      assertEquals(
        prepared.durableAdmissionId,
        "20000000-0000-4000-8000-000000000001",
      );
    },
    undefined,
    (payload) => observed.push(payload),
  );
  assertEquals(observed[0].p_checkpoint_scope, "clarify");
  assertEquals(observed[0].p_origin_reservation_id, null);
  assertEquals(observed[0].p_execution_claim_token, null);
  assertEquals(observed[0].p_logical_request_id, "clarify-request-1");
});

Deno.test("anonymous Supabase users are rejected before paid model access", async () => {
  await withUser(
    { id: "anonymous-user", is_anonymous: true, identities: [] },
    async () => {
      const error = await assertRejects(
        () => guardRequest(request({ prompt: "hello" }), { enforceCap: false }),
        AuthError,
      );
      assertEquals(error.status, 401);
      assertEquals(error.code, "anonymous_user");
    },
  );
});

Deno.test("unverified permanent users are rejected", async () => {
  await withUser(
    {
      id: "unverified-user",
      is_anonymous: false,
      email: "waiting@example.test",
      email_confirmed_at: null,
      identities: [{ provider: "email" }],
    },
    async () => {
      const error = await assertRejects(
        () => guardRequest(request({ prompt: "hello" }), { enforceCap: false }),
        AuthError,
      );
      assertEquals(error.status, 401);
      assertEquals(error.code, "unverified_user");
    },
  );
});

Deno.test("request strings over 20,000 characters return the InputError contract", async () => {
  await withUser(verifiedUser, async () => {
    const error = await assertRejects(
      () =>
        guardRequest(request({ prompt: "x".repeat(25_000) }), {
          enforceCap: false,
        }),
      AuthError,
    );
    assertEquals(error.status, 400);
    assertEquals(error.code, "INPUT_TOO_LONG");
    assertEquals(error.payload, {
      error: {
        code: "INPUT_TOO_LONG",
        message: "prompt exceeds the maximum length of 20000 characters.",
      },
    });
  });
});

Deno.test("document context fields honour the 30,000-character generation contract", async () => {
  await withUser(verifiedUser, async () => {
    const conversationContext = "c".repeat(23_315);
    const uploadContext = "u".repeat(7_595);
    const auth = await guardRequest(
      request({
        template_id: "resume",
        conversation_context: conversationContext,
        upload_context: uploadContext,
      }),
      { enforceCap: false },
    );

    assertEquals(auth.body?.conversation_context, conversationContext);
    assertEquals(auth.body?.upload_context, uploadContext);
  });
});

Deno.test("document context fields still reject payloads above 30,000 characters", async () => {
  await withUser(verifiedUser, async () => {
    const error = await assertRejects(
      () =>
        guardRequest(
          request({ conversation_context: "c".repeat(30_001) }),
          { enforceCap: false },
        ),
      AuthError,
    );

    assertEquals(error.status, 400);
    assertEquals(error.code, "INPUT_TOO_LONG");
  });
});

Deno.test("authenticated bursts are limited per user", async () => {
  await withUser({ ...verifiedUser, id: "81000000-0000-4000-8000-000000000002" }, async () => {
    for (let index = 0; index < 60; index += 1) {
      await guardRequest(request({ prompt: `request-${index}` }), {
        enforceCap: false,
      });
    }
    const error = await assertRejects(
      () =>
        guardRequest(request({ prompt: "request-61" }), { enforceCap: false }),
      AuthError,
    );
    assertEquals(error.status, 429);
    assertEquals(error.code, "RATE_LIMITED");
  });
});

Deno.test("multiplexed routes can isolate status polling from mutation recovery buckets", async () => {
  const observed: Array<Record<string, unknown>> = [];
  await withUser(
    { ...verifiedUser, id: "81000000-0000-4000-8000-000000000003" },
    async () => {
      await guardRequest(request({}), {
        enforceCap: false,
        rateLimitOperation: "document-operation:status",
        rateLimitLimit: 120,
        rateLimitWindowSeconds: 60,
      });
      await guardRequest(request({ action: "cancel" }), {
        enforceCap: false,
        rateLimitOperation: "document-operation:cancel",
        rateLimitLimit: 30,
        rateLimitWindowSeconds: 60,
      });
    },
    (payload) => observed.push(payload),
  );

  assertEquals(observed, [
    {
      p_user_id: "81000000-0000-4000-8000-000000000003",
      p_operation: "document-operation:status",
      p_limit: 120,
      p_window_seconds: 60,
    },
    {
      p_user_id: "81000000-0000-4000-8000-000000000003",
      p_operation: "document-operation:cancel",
      p_limit: 30,
      p_window_seconds: 60,
    },
  ]);
});

Deno.test("guard returns the sanitised request body and caller identity", async () => {
  const bodyUser = { ...verifiedUser, id: "81000000-0000-4000-8000-000000000004" };
  await withUser(bodyUser, async () => {
    const auth = await guardRequest(
      request({
        generation_request_id: "request-123",
        prompt: "<b>Hello</b>",
      }),
      { enforceCap: false },
    );
    const secured = auth as typeof auth & {
      body: Record<string, unknown>;
      generationRequestId?: string;
    };
    assertEquals(secured.userId, bodyUser.id);
    assertEquals(secured.body.prompt, "Hello");
    assertEquals(secured.generationRequestId, "request-123");
    assertEquals(secured.monthlyDocumentCap, 3);
  });
});

Deno.test("guard derives one canonical compatibility identity for an exact old-client replay", async () => {
  await withUser({ ...verifiedUser, id: "81000000-0000-4000-8000-000000000005" }, async () => {
    const first = await guardRequest(
      request({ nested: { beta: 2, alpha: 1 }, prompt: "same" }, {}, "clarify"),
      { enforceCap: false },
    );
    const replay = await guardRequest(
      request({ prompt: "same", nested: { alpha: 1, beta: 2 } }, {}, "clarify"),
      { enforceCap: false },
    );
    const otherRoute = await guardRequest(
      request(
        { prompt: "same", nested: { alpha: 1, beta: 2 } },
        {},
        "recommend",
      ),
      { enforceCap: false },
    );

    assertEquals(first.generationRequestId, replay.generationRequestId);
    assertEquals(first.generationRequestId?.startsWith("compat-"), true);
    assertEquals(
      first.generationRequestId === otherRoute.generationRequestId,
      false,
    );
  });
});

Deno.test("guard accepts one explicit idempotency header and rejects conflicting identities", async () => {
  await withUser({ ...verifiedUser, id: "81000000-0000-4000-8000-000000000006" }, async () => {
    const explicit = await guardRequest(
      request(
        { prompt: "hello" },
        { "x-idempotency-key": "8cc7fb61-683c-45ef-b21f-295ce0c6a544" },
        "interpret-intent",
      ),
      { enforceCap: false },
    );
    assertEquals(
      explicit.generationRequestId,
      "8cc7fb61-683c-45ef-b21f-295ce0c6a544",
    );

    const conflict = await assertRejects(
      () =>
        guardRequest(
          request(
            { generation_request_id: "body-request" },
            { "x-idempotency-key": "header-request" },
          ),
          { enforceCap: false },
        ),
      AuthError,
    );
    assertEquals(conflict.status, 400);
    assertEquals(conflict.code, "request_identity_conflict");

    const bodyConflict = await assertRejects(
      () =>
        guardRequest(
          request({
            generation_request_id: "generation-request",
            request_id: "artifact-request",
          }),
          { enforceCap: false },
        ),
      AuthError,
    );
    assertEquals(bodyConflict.status, 400);
    assertEquals(bodyConflict.code, "request_identity_conflict");
  });
});

Deno.test("guard rejects malformed explicit request identities before model work", async () => {
  await withUser({ ...verifiedUser, id: "81000000-0000-4000-8000-000000000007" }, async () => {
    const error = await assertRejects(
      () =>
        guardRequest(
          request({ generation_request_id: "contains spaces" }),
          { enforceCap: false },
        ),
      AuthError,
    );
    assertEquals(error.status, 400);
    assertEquals(error.code, "request_identity_invalid");
  });
});
