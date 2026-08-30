import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allowedOriginsForEnvironment,
  corsHeaders,
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "./cors.ts";

Deno.test("production CORS has no implicit historical or localhost origins", () => {
  assertEquals(allowedOriginsForEnvironment(undefined, "production"), []);
  assertEquals(
    allowedOriginsForEnvironment("https://app.prompted.example", "production"),
    ["https://app.prompted.example"],
  );
});

Deno.test("local origins are added only in an explicit local environment", () => {
  assert(
    allowedOriginsForEnvironment(undefined, "local").includes(
      "http://localhost:3000",
    ),
  );
  assertEquals(
    allowedOriginsForEnvironment(undefined, "production").includes(
      "http://localhost:3000",
    ),
    false,
  );
});

Deno.test("configured origins must be exact credential-free HTTP origins", () => {
  for (const value of [
    "not-a-url",
    "ftp://app.prompted.example",
    "https://user:pass@app.prompted.example",
    "https://app.prompted.example/path",
  ]) {
    assertThrows(() => allowedOriginsForEnvironment(value, "production"));
  }
});

Deno.test("shared responses carry private no-store cache headers", () => {
  const headers = new Headers(corsHeaders(null));
  assertEquals(headers.get("cache-control"), "private, no-store, max-age=0");
  assertEquals(headers.get("pragma"), "no-cache");
  assert(headers.get("vary")?.includes("Authorization"));

  const response = jsonResponse({ ok: true });
  assertEquals(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

Deno.test("forbidden browser origins fail closed including preflight", () => {
  const request = new Request("https://functions.example/test", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" },
  });
  assertEquals(rejectForbiddenOrigin(request)?.status, 403);
  assertEquals(handleOptions(request)?.status, 403);
});
