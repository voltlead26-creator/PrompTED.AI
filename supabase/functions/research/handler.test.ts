import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { AuthError } from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  handleResearchRequest,
  type ResearchGateDependencies,
} from "./handler.ts";

Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");

function request(method = "POST"): Request {
  return new Request("https://example.invalid/functions/v1/research", {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
    body: method === "POST"
      ? JSON.stringify({ query: "synthetic" })
      : undefined,
  });
}

function dependencies(authenticated: boolean) {
  const calls = { auth: 0, memory: 0, database: 0, provider: 0 };
  const value: ResearchGateDependencies = {
    handleOptions,
    jsonResponse,
    guardRequest() {
      calls.auth += 1;
      if (!authenticated) {
        throw new AuthError(401, "UNAUTHORIZED", {
          error: { code: "UNAUTHORIZED", message: "Authentication required." },
        });
      }
      return Promise.resolve({ userId: "synthetic-user" });
    },
    downstream: {
      readMemory() {
        calls.memory += 1;
        return Promise.resolve(null);
      },
      readDatabaseContent() {
        calls.database += 1;
        return Promise.resolve(null);
      },
      callProvider() {
        calls.provider += 1;
        return Promise.resolve(null);
      },
    },
  };
  return { calls, value };
}

Deno.test("research preserves method and authentication rejection before its gate", async () => {
  const unauthenticated = dependencies(false);
  const optionsResponse = await handleResearchRequest(
    request("OPTIONS"),
    unauthenticated.value,
  );
  assertEquals(optionsResponse.status, 200);
  assertStringIncludes(
    optionsResponse.headers.get("access-control-allow-methods") ?? "",
    "POST",
  );
  assertEquals(unauthenticated.calls.auth, 0);

  const methodResponse = await handleResearchRequest(
    request("GET"),
    unauthenticated.value,
  );
  assertEquals(methodResponse.status, 405);
  assertEquals(unauthenticated.calls.auth, 0);

  const authResponse = await handleResearchRequest(
    request(),
    unauthenticated.value,
  );
  assertEquals(authResponse.status, 401);
  assertEquals(await authResponse.json(), {
    error: { code: "UNAUTHORIZED", message: "Authentication required." },
  });
  assertEquals(unauthenticated.calls, {
    auth: 1,
    memory: 0,
    database: 0,
    provider: 0,
  });
});

Deno.test("the research gate has no environment reactivation switch", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, "handleResearchRequest");
  assertEquals(source.includes("Deno.env.get"), false);
});

Deno.test("authenticated research returns the verification gate with zero downstream work", async () => {
  const authenticated = dependencies(true);
  const response = await handleResearchRequest(request(), authenticated.value);
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: {
      code: "RESEARCH_CLAIM_VERIFICATION_REQUIRED",
      message:
        "Research results are temporarily unavailable until source-linked claims can be independently verified.",
      retryable: false,
    },
    grounding_status: "source_linked_not_independently_verified",
    persistence_eligible: false,
    completion_eligible: false,
  });
  assertEquals(authenticated.calls, {
    auth: 1,
    memory: 0,
    database: 0,
    provider: 0,
  });
});
