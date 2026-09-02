import {
  buildCkanSearchUrl,
  CkanDispatchError,
  normaliseCkanDatasets,
  searchGovernmentCatalogue,
} from "./ckan-client.ts";
// deno-lint-ignore no-import-prefix -- repository test dependency is pinned by the Deno lockfile.
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

Deno.test("buildCkanSearchUrl limits requests to approved government catalogues", () => {
  const url = buildCkanSearchUrl("australia", "employment services", 8);
  const expected =
    "https://data.gov.au/data/api/3/action/package_search?q=employment+services&rows=8";
  if (url !== expected) throw new Error(`Unexpected URL: ${url}`);
});

Deno.test("buildCkanSearchUrl rejects unknown catalogues", () => {
  let rejected = false;
  try {
    buildCkanSearchUrl("other", "test", 5);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Expected unknown catalogue to be rejected.");
});

Deno.test("normaliseCkanDatasets returns source-backed dataset summaries", () => {
  const result = normaliseCkanDatasets("victoria", {
    success: true,
    result: {
      results: [{
        id: "abc",
        name: "employment-data",
        title: "Victorian employment data",
        notes: "Official employment dataset.",
        metadata_modified: "2026-07-01T00:00:00.000000",
        organization: { title: "Department of Jobs" },
        license_title: "Creative Commons Attribution 4.0",
        resources: [{
          id: "resource-1",
          name: "CSV",
          format: "CSV",
          url: "https://example.vic.gov.au/employment.csv",
        }],
      }],
    },
  });

  if (result.length !== 1) throw new Error("Expected one dataset.");
  if (result[0].publisher !== "Department of Jobs") {
    throw new Error(`Unexpected publisher: ${result[0].publisher}`);
  }
  if (!result[0].catalogueUrl.includes("employment-data")) {
    throw new Error(`Unexpected catalogue URL: ${result[0].catalogueUrl}`);
  }
});

Deno.test("normaliseCkanDatasets bounds text and excludes non-HTTP resource URLs", () => {
  const result = normaliseCkanDatasets("australia", {
    success: true,
    result: {
      results: [{
        id: "safe",
        name: "safe",
        title: "T".repeat(500),
        notes: "N".repeat(3_000),
        resources: [
          { name: "unsafe", url: "javascript:alert(1)" },
          { name: "credentials", url: "https://user:secret@example.test/data" },
          { name: "safe", url: "https://data.example.test/resource.csv" },
        ],
      }],
    },
  });
  assertEquals(result[0].title.length, 300);
  assertEquals(result[0].description.length, 2_000);
  assertEquals(result[0].resources.map((resource) => resource.name), ["safe"]);
});

Deno.test("searchGovernmentCatalogue classifies known and ambiguous dispatch outcomes", async () => {
  const known = await assertRejects(
    () =>
      searchGovernmentCatalogue({
        catalogue: "australia",
        query: "employment services",
        fetchImpl: () =>
          Promise.resolve(new Response("private", { status: 503 })),
      }),
    CkanDispatchError,
  );
  assertEquals(known.dispatchCertain, true);
  assertEquals(known.message.includes("private"), false);

  const ambiguous = await assertRejects(
    () =>
      searchGovernmentCatalogue({
        catalogue: "victoria",
        query: "employment services",
        fetchImpl: () => Promise.reject(new Error("network")),
      }),
    CkanDispatchError,
  );
  assertEquals(ambiguous.dispatchCertain, false);
});
