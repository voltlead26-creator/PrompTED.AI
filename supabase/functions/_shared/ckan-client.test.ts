import {
  buildCkanSearchUrl,
  normaliseCkanDatasets,
} from "./ckan-client.ts";

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
