import {
  buildCkanSearchUrl,
  CkanDispatchError,
  normaliseCkanDatasets,
  searchGovernmentCatalogue,
} from "./ckan-client.ts";
// deno-lint-ignore no-import-prefix -- repository test dependency is pinned by the Deno lockfile.
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

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

// The Action API's HTTP status does not establish success. Its documented
// success field is boolean and package_search returns dataset dictionaries.
// https://docs.ckan.org/en/2.11/api/#making-an-api-request
// https://docs.ckan.org/en/2.11/api/#ckan.logic.action.get.package_search
// These are synthetic HTTP fixtures; no government request is made by a test.
const CKAN_TEST_RESPONSE_BYTES = 1024 * 1024;
const ckanEncoder = new TextEncoder();

function syntheticDataset() {
  return {
    id: "71000000-0000-4000-8000-000000000001",
    name: "synthetic-employment",
    title: "Synthetic employment data",
    notes: "Synthetic data; no personal information.",
    organization: { title: "Synthetic public publisher" },
    resources: [{
      id: "72000000-0000-4000-8000-000000000001",
      name: "CSV",
      format: "CSV",
      url: "https://example.test/synthetic.csv",
      datastore_active: false,
    }],
  };
}

function searchResponse(results: unknown[] = [syntheticDataset()]) {
  return { success: true, result: { count: results.length, results } };
}

function controlledCatalogue(response: Response, limit = 10) {
  let fetchCalls = 0;
  return {
    run: () =>
      searchGovernmentCatalogue({
        catalogue: "australia",
        query: "synthetic employment",
        limit,
        fetchImpl: () => {
          fetchCalls += 1;
          return Promise.resolve(response);
        },
      }),
    calls: () => fetchCalls,
  };
}

async function rejectsKnownCatalogueResponse(response: Response, limit = 10) {
  const fixture = controlledCatalogue(response, limit);
  const error = await assertRejects(fixture.run, CkanDispatchError);
  assertEquals(error.dispatchCertain, true);
  assertEquals(fixture.calls(), 1);
  return error;
}

function jsonCatalogue(body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": contentType },
  });
}

Deno.test("CKAN HTTP accepts typed data, nullable optional metadata and genuine empty results", async () => {
  const supplied = syntheticDataset();
  const suppliedResource = supplied.resources[0];
  assert(
    suppliedResource,
    "The positive fixture must contain its source resource.",
  );
  const response = jsonCatalogue(
    searchResponse([{
      ...supplied,
      notes: null,
      metadata_modified: null,
      license_title: null,
      organization: null,
      resources: [{ ...suppliedResource, name: null, format: null }],
    }]),
    "application/json; charset=utf-8",
  );
  const fixture = controlledCatalogue(response);
  const actual = await fixture.run();
  assertEquals(actual.length, 1);
  const summary = actual[0];
  assert(summary, "The positive fixture must produce its actual dataset.");
  assertEquals(summary.id, supplied.id);
  assertEquals(summary.title, supplied.title);
  assertEquals(
    summary.catalogueUrl,
    "https://data.gov.au/data/dataset/synthetic-employment",
  );
  assertEquals(summary.description, "");
  assertEquals(summary.modifiedAt, null);
  assertEquals(summary.resources.length, 1);
  assertEquals(summary.resources[0]?.url, suppliedResource.url);
  assertEquals(fixture.calls(), 1);

  const empty = controlledCatalogue(jsonCatalogue(searchResponse([])));
  assertEquals(await empty.run(), []);
  assertEquals(empty.calls(), 1);
});

const malformedCkanSuccesses: ReadonlyArray<readonly [string, unknown]> = [
  ["string false success", { ...searchResponse(), success: "false" }],
  ["numeric success", { ...searchResponse(), success: 1 }],
  ["dataset without identity", searchResponse([{}])],
  ["whitespace identity", searchResponse([{ id: " ", name: " " }])],
  ["numeric identity", searchResponse([{ ...syntheticDataset(), id: 123 }])],
  [
    "object title",
    searchResponse([{ ...syntheticDataset(), title: { value: "invented" } }]),
  ],
  ["boolean notes", searchResponse([{ ...syntheticDataset(), notes: true }])],
  [
    "string organization",
    searchResponse([{ ...syntheticDataset(), organization: "publisher" }]),
  ],
  [
    "numeric publisher",
    searchResponse([{ ...syntheticDataset(), organization: { title: 123 } }]),
  ],
  [
    "string resource boolean",
    searchResponse([{
      ...syntheticDataset(),
      resources: [{
        url: "https://example.test/a.csv",
        datastore_active: "false",
      }],
    }]),
  ],
  [
    "numeric resource label",
    searchResponse([{
      ...syntheticDataset(),
      resources: [{ url: "https://example.test/a.csv", name: 123 }],
    }]),
  ],
  ["string result count", {
    success: true,
    result: { count: "1", results: [syntheticDataset()] },
  }],
  ["negative result count", {
    success: true,
    result: { count: -1, results: [] },
  }],
  ["count smaller than returned collection", {
    success: true,
    result: { count: 0, results: [syntheticDataset()] },
  }],
];

for (const [name, body] of malformedCkanSuccesses) {
  Deno.test(`CKAN HTTP rejects ${name} instead of manufacturing successful data`, async () => {
    await rejectsKnownCatalogueResponse(jsonCatalogue(body));
  });
}

Deno.test("CKAN HTTP rejects a reported API failure without exposing its private error", async () => {
  const error = await rejectsKnownCatalogueResponse(jsonCatalogue({
    success: false,
    error: { message: "synthetic private upstream error" },
  }));
  assertEquals(
    error.message.includes("synthetic private upstream error"),
    false,
  );
});

for (const contentType of ["text/html", "application/jsonp", "text/plain"]) {
  Deno.test(`CKAN HTTP rejects ${contentType} before treating its body as data`, async () => {
    await rejectsKnownCatalogueResponse(
      jsonCatalogue(searchResponse([]), contentType),
    );
  });
}

Deno.test("CKAN HTTP requires redirect rejection before the controlled transport can follow Location", async () => {
  const requested: string[] = [];
  const error = await assertRejects(() =>
    searchGovernmentCatalogue({
      catalogue: "australia",
      query: "synthetic employment",
      fetchImpl: (input, init) => {
        requested.push(String(input));
        if (init?.redirect === "error") {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: {
                location: "https://outside-admitted-host.test/private",
              },
            }),
          );
        }
        requested.push("https://outside-admitted-host.test/private");
        return Promise.resolve(jsonCatalogue(searchResponse([])));
      },
    }), CkanDispatchError);
  assertEquals(error.dispatchCertain, true);
  assertEquals(requested, [
    "https://data.gov.au/data/api/3/action/package_search?q=synthetic+employment&rows=10",
  ]);
  assertEquals(error.message.includes("outside-admitted-host"), false);
});

Deno.test("CKAN HTTP rejects a response already marked redirected by its transport", async () => {
  const response = jsonCatalogue(searchResponse([]));
  Object.defineProperties(response, {
    redirected: { value: true },
    url: { value: "https://outside-admitted-host.test/private" },
  });
  await rejectsKnownCatalogueResponse(response);
});

Deno.test("CKAN HTTP rejects invalid UTF8 instead of accepting replacement characters", async () => {
  const prefix = ckanEncoder.encode(
    '{"success":true,"result":{"count":0,"results":[]},"help":"',
  );
  const suffix = ckanEncoder.encode('"}');
  const bytes = new Uint8Array(prefix.byteLength + 1 + suffix.byteLength);
  bytes.set(prefix);
  bytes[prefix.byteLength] = 0xff;
  bytes.set(suffix, prefix.byteLength + 1);
  await rejectsKnownCatalogueResponse(
    new Response(bytes, {
      headers: { "content-type": "application/json" },
    }),
  );
});

Deno.test("CKAN HTTP accepts its exact 1MiB body ceiling and rejects one additional byte", async () => {
  const body = JSON.stringify(searchResponse([]));
  const exact = body.padEnd(CKAN_TEST_RESPONSE_BYTES, " ");
  const positive = controlledCatalogue(
    new Response(exact, {
      headers: { "content-type": "application/json" },
    }),
  );
  assertEquals(await positive.run(), []);
  assertEquals(positive.calls(), 1);
  await rejectsKnownCatalogueResponse(
    new Response(`${exact} `, {
      headers: { "content-type": "application/json" },
    }),
  );
});

Deno.test("CKAN HTTP rejects an oversized declared body without reading it", async () => {
  let reads = 0;
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      controller.enqueue(
        ckanEncoder.encode(JSON.stringify(searchResponse([]))),
      );
      controller.close();
    },
    cancel() {
      cancelled += 1;
    },
  }, { highWaterMark: 0 });
  await rejectsKnownCatalogueResponse(
    new Response(stream, {
      headers: {
        "content-type": "application/json",
        "content-length": String(CKAN_TEST_RESPONSE_BYTES + 1),
      },
    }),
  );
  assertEquals(reads, 0);
  assertEquals(cancelled, 1);
});

Deno.test("CKAN HTTP accepts an ordinary Unicode scalar split between response chunks", async () => {
  const body = ckanEncoder.encode(JSON.stringify(searchResponse([{
    ...syntheticDataset(),
    title: "Synthetic café",
  }])));
  const split = body.indexOf(0xc3) + 1;
  assert(split > 0, "The fixture must split the real multi-byte scalar.");
  let reads = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        if (reads === 1) controller.enqueue(body.slice(0, split));
        else if (reads === 2) controller.enqueue(body.slice(split));
        else controller.close();
      },
    }, { highWaterMark: 0 }),
    {
      headers: { "content-type": "application/json" },
    },
  );
  const result = await controlledCatalogue(response).run();
  assertEquals(result[0]?.title, "Synthetic café");
  assertEquals(reads, 3);
});

Deno.test("CKAN HTTP rejects more datasets than the accepted rows request", async () => {
  await rejectsKnownCatalogueResponse(
    jsonCatalogue(searchResponse([
      syntheticDataset(),
      { ...syntheticDataset(), id: "second", name: "second" },
      { ...syntheticDataset(), id: "third", name: "third" },
    ])),
    2,
  );
});

Deno.test("CKAN HTTP rejects excessive resources before output slicing can hide them", async () => {
  await rejectsKnownCatalogueResponse(jsonCatalogue(searchResponse([{
    ...syntheticDataset(),
    resources: Array.from({ length: 1001 }, (_, index) => ({
      id: `resource-${index}`,
      url: `https://example.test/${index}.csv`,
    })),
  }])));
});

Deno.test("CKAN HTTP preserves a resource identity instead of Unicode-normalising it", async () => {
  const id = "\u212b-synthetic-resource";
  const result = await controlledCatalogue(jsonCatalogue(searchResponse([{
    ...syntheticDataset(),
    resources: [{ id, url: "https://example.test/original.csv" }],
  }]))).run();
  const resource = result[0]?.resources[0];
  assert(resource, "The positive source fixture must retain its actual resource.");
  assertEquals(resource.id, id);
  assertEquals(resource.url, "https://example.test/original.csv");
});

Deno.test("CKAN HTTP accepts an exact 300-character resource identity and rejects truncation of a longer one", async () => {
  const id = "r".repeat(300);
  const supplied = (resourceId: string) => jsonCatalogue(searchResponse([{
    ...syntheticDataset(),
    resources: [{ id: resourceId, url: "https://example.test/original.csv" }],
  }]));
  const result = await controlledCatalogue(supplied(id)).run();
  const resource = result[0]?.resources[0];
  assert(resource, "The exact-boundary source resource must remain available.");
  assertEquals(resource.id, id);
  await rejectsKnownCatalogueResponse(supplied(`${id}x`));
});

Deno.test("CKAN HTTP rejects an embedded control character in a resource identity", async () => {
  await rejectsKnownCatalogueResponse(jsonCatalogue(searchResponse([{
    ...syntheticDataset(),
    resources: [{ id: "synthetic\u0000resource", url: "https://example.test/original.csv" }],
  }])));
});
