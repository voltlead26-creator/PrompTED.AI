import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { AuthError } from "../_shared/auth-guard.ts";
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import {
  handleGenerateReportGate,
  type ReportGateDependencies,
} from "./gate-handler.ts";

Deno.env.set("PROMPTED_DEPLOYMENT_ENV", "test");

const gatePayload = {
  error: {
    code: "REPORT_DURABLE_CHECKPOINT_REQUIRED",
    message:
      "Report generation is temporarily unavailable until every generated section can be durably recovered.",
    retryable: false,
  },
  persistence_eligible: false,
  completion_eligible: false,
};

function request(method = "POST"): Request {
  return new Request("https://example.invalid/functions/v1/generate-report", {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
    body: method === "POST"
      ? JSON.stringify({ extracted_text: "synthetic" })
      : undefined,
  });
}

function dependencies(authenticated: boolean) {
  const calls = { auth: 0, memory: 0, database: 0, allowance: 0, provider: 0 };
  const value: ReportGateDependencies = {
    handleOptions,
    jsonResponse,
    gatePayload,
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
      reserveAllowance() {
        calls.allowance += 1;
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

Deno.test("report preserves method and authentication rejection before its gate", async () => {
  const unauthenticated = dependencies(false);
  const optionsResponse = await handleGenerateReportGate(
    request("OPTIONS"),
    unauthenticated.value,
  );
  assertEquals(optionsResponse.status, 200);
  assertStringIncludes(
    optionsResponse.headers.get("access-control-allow-methods") ?? "",
    "POST",
  );
  assertEquals(unauthenticated.calls.auth, 0);

  const methodResponse = await handleGenerateReportGate(
    request("GET"),
    unauthenticated.value,
  );
  assertEquals(methodResponse.status, 405);
  assertEquals(unauthenticated.calls.auth, 0);

  const authResponse = await handleGenerateReportGate(
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
    allowance: 0,
    provider: 0,
  });
});

Deno.test("authenticated report returns the checkpoint gate with zero downstream work", async () => {
  const authenticated = dependencies(true);
  const response = await handleGenerateReportGate(
    request(),
    authenticated.value,
  );
  assertEquals(response.status, 409);
  assertEquals(await response.json(), gatePayload);
  assertEquals(authenticated.calls, {
    auth: 1,
    memory: 0,
    database: 0,
    allowance: 0,
    provider: 0,
  });
});

Deno.test("the report gate has no environment reactivation switch", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assertStringIncludes(source, "handleGenerateReportGate");
  assertEquals(source.includes("Deno.env.get"), false);
});
