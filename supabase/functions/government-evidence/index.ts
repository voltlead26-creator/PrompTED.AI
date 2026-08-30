import {
  handleOptions,
  jsonResponse,
  rejectForbiddenOrigin,
} from "../_shared/cors.ts";
import {
  searchGovernmentCatalogue,
  type GovernmentCatalogue,
} from "../_shared/ckan-client.ts";

interface EvidenceRequest {
  query?: unknown;
  jurisdictions?: unknown;
  limitPerCatalogue?: unknown;
}

function parseRequest(body: unknown): {
  query: string;
  jurisdictions: GovernmentCatalogue[];
  limitPerCatalogue: number;
} {
  if (!body || typeof body !== "object") {
    throw new Error("A JSON request body is required.");
  }
  const input = body as EvidenceRequest;
  if (typeof input.query !== "string") {
    throw new Error("query is required.");
  }
  const query = input.query.trim();
  if (query.length < 2 || query.length > 200) {
    throw new Error("query must contain between 2 and 200 characters.");
  }

  const requested = Array.isArray(input.jurisdictions)
    ? input.jurisdictions
    : ["australia", "victoria"];
  const jurisdictions = requested.filter(
    (value): value is GovernmentCatalogue =>
      value === "australia" || value === "victoria",
  );
  if (jurisdictions.length === 0 || jurisdictions.length !== requested.length) {
    throw new Error("jurisdictions may only contain australia and victoria.");
  }

  const limitPerCatalogue = input.limitPerCatalogue === undefined
    ? 8
    : Number(input.limitPerCatalogue);
  if (
    !Number.isInteger(limitPerCatalogue) ||
    limitPerCatalogue < 1 ||
    limitPerCatalogue > 20
  ) {
    throw new Error("limitPerCatalogue must be an integer between 1 and 20.");
  }

  return { query, jurisdictions, limitPerCatalogue };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const forbidden = rejectForbiddenOrigin(req);
  if (forbidden) return forbidden;

  const origin = req.headers.get("origin");
  if (req.method !== "POST") {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
      405,
      origin,
    );
  }

  try {
    const input = parseRequest(await req.json());
    const settled = await Promise.allSettled(
      input.jurisdictions.map(async (catalogue) => ({
        catalogue,
        datasets: await searchGovernmentCatalogue({
          catalogue,
          query: input.query,
          limit: input.limitPerCatalogue,
        }),
      })),
    );

    const results = settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value.datasets : []
    );
    const unavailable = settled.flatMap((result, index) =>
      result.status === "rejected"
        ? [{
          catalogue: input.jurisdictions[index],
          message: result.reason instanceof Error
            ? result.reason.message
            : "Catalogue search failed.",
        }]
        : []
    );

    if (results.length === 0 && unavailable.length === settled.length) {
      throw new Error("Government data catalogues are temporarily unavailable.");
    }

    return jsonResponse(
      {
        data: {
          query: input.query,
          datasets: results,
          unavailable,
          retrievedAt: new Date().toISOString(),
        },
        source: "official-government-open-data-catalogues",
      },
      200,
      origin,
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Government evidence search failed.";
    console.error("GOVERNMENT_EVIDENCE_ERROR", { message });
    return jsonResponse(
      {
        error: {
          code: "GOVERNMENT_EVIDENCE_FAILED",
          message,
        },
      },
      400,
      origin,
    );
  }
});
