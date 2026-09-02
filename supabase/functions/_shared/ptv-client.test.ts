import {
  buildPtvRequestPath,
  buildSignedPtvUrl,
  PtvClient,
  PtvDispatchError,
} from "./ptv-client.ts";
// deno-lint-ignore no-import-prefix -- repository test dependency is pinned by the Deno lockfile.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.test("buildPtvRequestPath appends query values before developer id", () => {
  const path = buildPtvRequestPath(
    "/v3/departures/route_type/0/stop/1071",
    "3004190",
    { max_results: 5, include_cancelled: true, ignored: undefined },
  );

  if (
    path !==
      "/v3/departures/route_type/0/stop/1071?max_results=5&include_cancelled=true&devid=3004190"
  ) {
    throw new Error(`Unexpected request path: ${path}`);
  }
});

Deno.test("buildPtvRequestPath rejects non-v3 paths", () => {
  let rejected = false;
  try {
    buildPtvRequestPath("/v2/search/test", "3004190");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected non-v3 path to be rejected.");
});

Deno.test("buildSignedPtvUrl produces a deterministic uppercase SHA-1 signature", async () => {
  const url = await buildSignedPtvUrl(
    "/v3/route_types",
    "123456",
    "test-key",
  );

  const expected =
    "https://timetableapi.ptv.vic.gov.au/v3/route_types?devid=123456&signature=1BFE4CAD7170CAD157C5326CBE694232613C69D4";
  if (url !== expected) {
    throw new Error(`Unexpected signed URL: ${url}`);
  }
});

Deno.test("PtvClient does not expose an upstream response body", async () => {
  const client = new PtvClient({
    developerId: "123456",
    apiKey: "test-key",
    fetchImpl: () =>
      Promise.resolve(new Response("private upstream detail", { status: 503 })),
  });
  const error = await assertRejects(
    () => client.get("/v3/route_types"),
    PtvDispatchError,
  );
  assertEquals(error.dispatchCertain, true);
  assertEquals(error.message.includes("private upstream detail"), false);
});

Deno.test("PtvClient marks a transport failure as an ambiguous dispatch", async () => {
  const client = new PtvClient({
    developerId: "123456",
    apiKey: "test-key",
    fetchImpl: () => Promise.reject(new Error("network failure")),
  });
  const error = await assertRejects(
    () => client.get("/v3/route_types"),
    PtvDispatchError,
  );
  assertEquals(error.dispatchCertain, false);
});
