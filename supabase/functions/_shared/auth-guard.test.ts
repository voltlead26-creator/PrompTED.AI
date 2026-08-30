import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { AuthError, guardRequest } from "./auth-guard.ts";

type UserFixture = {
  id: string;
  is_anonymous: boolean;
  email?: string;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  identities?: Array<Record<string, unknown>>;
};

function request(body: unknown): Request {
  return new Request("https://example.test/functions/v1/test", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function withUser<T>(
  user: UserFixture,
  run: () => Promise<T>,
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
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/subscriptions")) {
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rest/v1/rpc/consume_rate_limit")) {
      rateLimitCount += 1;
      return new Response(JSON.stringify(rateLimitCount <= 60), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
  id: "verified-user",
  is_anonymous: false,
  email: "verified@example.test",
  email_confirmed_at: "2026-08-05T00:00:00Z",
  identities: [{ provider: "email" }],
};

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
  await withUser({ ...verifiedUser, id: "burst-user" }, async () => {
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

Deno.test("guard returns the sanitised request body and caller identity", async () => {
  const bodyUser = { ...verifiedUser, id: "body-user" };
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
  });
});
